import { safeStorage, session } from "electron"
import { Option, Schema } from "effect"
import type { IpcProvider, Plugin } from "@opencode/plugin/gui"
import { FigmaAccount, INVALID_KEY, INVALID_TEAM, Team, type Listing } from "./contract"
import { fileLink } from "./url"

export const PARTITION = "persist:opencode-figma"

const API = "https://api.figma.com"

const CACHE_TTL_MS = 2 * 60 * 1000

const MAX_LISTED_FILES = 10

const Stored = Schema.Struct({
	token: Schema.String,
	encrypted: Schema.Boolean,
	user: Schema.NullOr(Schema.String),
	teams: Schema.Array(Team),
	team: Schema.NullOr(Schema.String),
	hidden: Schema.optional(Schema.Array(Schema.String)),
	nodeNames: Schema.optional(Schema.Boolean),
})

const CachedNodeNames = Schema.Record(
	Schema.String,
	Schema.Struct({ name: Schema.NullOr(Schema.String), at: Schema.Number }),
)

const NODE_NAME_TTL_MS = 30 * 24 * 60 * 60 * 1000

const FAILED_NODE_NAME_TTL_MS = 24 * 60 * 60 * 1000

const RATE_LIMIT_FALLBACK_MS = 60 * 60 * 1000

const MAX_CACHED_NODE_NAMES = 500

class ApiError extends Error {
	constructor(
		readonly status: number,
		message: string,
		readonly retryAfterSeconds?: number,
	) {
		super(message)
	}
}

const ErrorBody = Schema.Struct({
	err: Schema.optional(Schema.String),
	message: Schema.optional(Schema.String),
})

const decodeErrorBody = Schema.decodeUnknownOption(ErrorBody)

const RawFile = Schema.Struct({
	key: Schema.String,
	name: Schema.String,
	last_modified: Schema.optional(Schema.String),
})

const FoldersResponse = Schema.Struct({
	name: Schema.String,
	folders: Schema.Array(Schema.Struct({ id: Schema.String })),
})

const ProjectsResponse = Schema.Struct({
	name: Schema.String,
	projects: Schema.Array(Schema.Struct({ id: Schema.String })),
})

const FilesResponse = Schema.Struct({
	files: Schema.Array(RawFile),
})

const FileMetaResponse = Schema.Struct({
	file: Schema.optional(
		Schema.Struct({
			url: Schema.optional(Schema.String),
			editorType: Schema.optional(Schema.String),
		}),
	),
})

const MeResponse = Schema.Struct({
	handle: Schema.optional(Schema.String),
	email: Schema.optional(Schema.String),
})

const NodesResponse = Schema.Struct({
	nodes: Schema.optional(
		Schema.Record(
			Schema.String,
			Schema.NullOr(
				Schema.Struct({
					document: Schema.optional(
						Schema.Struct({
							name: Schema.optional(Schema.String),
						}),
					),
				}),
			),
		),
	),
})

const WebId = Schema.Union([Schema.String, Schema.Number])

const SessionStateMeta = Schema.Struct({
	orgs: Schema.optional(Schema.Array(Schema.Struct({ id: Schema.optional(WebId) }))),
})

const UserStateMeta = Schema.Struct({
	teams: Schema.optional(
		Schema.Array(
			Schema.Struct({
				id: Schema.optional(WebId),
				name: Schema.optional(Schema.String),
			}),
		),
	),
})

const RecentFilesMeta = Schema.Struct({
	recent_files: Schema.Array(
		Schema.Struct({
			key: Schema.optional(Schema.String),
			name: Schema.optional(Schema.String),
			editor_type: Schema.optional(Schema.NullOr(Schema.String)),
			touched_at: Schema.optional(Schema.NullOr(Schema.String)),
			updated_at: Schema.optional(Schema.NullOr(Schema.String)),
		}),
	),
})

type Decoder = Schema.Top & { readonly DecodingServices: never }

const api = async <S extends Decoder>(
	schema: S,
	token: string,
	path: string,
	signal?: AbortSignal,
): Promise<S["Type"]> => {
	const response = await fetch(`${API}${path}`, { headers: { "X-Figma-Token": token }, signal })
	const json = await response.json().catch(() => ({}))

	if (!response.ok) {
		const body = decodeErrorBody(json)
		const detail = Option.isSome(body) ? (body.value.err ?? body.value.message) : undefined
		const retry = Number(response.headers.get("retry-after"))

		throw new ApiError(
			response.status,
			`Figma: ${detail ?? response.statusText}`,
			Number.isFinite(retry) && retry > 0 ? retry : undefined,
		)
	}

	return Schema.decodeUnknownSync(schema)(json)
}

const folders = async (token: string, team: string, signal?: AbortSignal) => {
	try {
		const result = await api(FoldersResponse, token, `/v2/teams/${team}/folders`, signal)

		return {
			name: result.name,
			ids: result.folders.map((folder) => folder.id),
			files: (id: string) => api(FilesResponse, token, `/v2/folders/${id}/files`, signal),
		}
	} catch (cause) {
		// Keys made before folders:read existed have projects:read, which only the older project endpoints accept.
		if (!(cause instanceof ApiError) || (cause.status !== 403 && cause.status !== 404)) throw cause

		const result = await api(ProjectsResponse, token, `/v1/teams/${team}/projects`, signal).catch(() => {
			throw cause
		})

		return {
			name: result.name,
			ids: result.projects.map((project) => project.id),
			files: (id: string) => api(FilesResponse, token, `/v1/projects/${id}/files`, signal),
		}
	}
}

const each = async <T, R>(items: readonly T[], limit: number, run: (item: T) => Promise<R>) => {
	// oxlint-disable-next-line unicorn/no-new-array
	const results: R[] = new Array(items.length)
	let next = 0

	const worker = async () => {
		while (next < items.length) {
			const index = next++
			results[index] = await run(items[index])
		}
	}

	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))

	return results
}

const kind = (type: string | null | undefined) =>
	type === "whiteboard" || type === "figjam" ? "board" : type === "slides" ? "slides" : "design"

const Envelope = Schema.Struct({ meta: Schema.Unknown })

const web = async <S extends Decoder>(schema: S, path: string, signal?: AbortSignal): Promise<S["Type"]> => {
	const cookies = await session.fromPartition(PARTITION).cookies.get({ domain: "figma.com" })

	if (!cookies.length) throw new Error("Not signed in to Figma")

	const response = await fetch(`https://www.figma.com${path}`, {
		headers: {
			cookie: cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; "),
			accept: "application/json",
			"x-csrf-bypass": "yes",
		},
		signal,
	})

	if (!response.ok) throw new Error(`Figma: ${response.status}`)
	const envelope = Schema.decodeUnknownSync(Envelope)(await response.json())

	return Schema.decodeUnknownSync(schema)(envelope.meta)
}

const id = (value: string | number | undefined) => (value === undefined ? undefined : String(value) || undefined)

const discoverTeams = async (signal?: AbortSignal): Promise<Team[]> => {
	const state = await web(SessionStateMeta, "/api/session/state", signal).catch(() => undefined)
	const orgs = (state?.orgs ?? []).flatMap((org) => id(org.id) ?? [])

	const users = await Promise.all(
		["", ...orgs].map((org) => web(UserStateMeta, `/api/user/state?org_id=${org}`, signal).catch(() => undefined)),
	)

	const teams = new Map<string, Team>()

	for (const user of users) {
		for (const team of user?.teams ?? []) {
			const key = id(team.id)
			const name = team.name || undefined

			if (key && name && !teams.has(key)) teams.set(key, { id: key, name })
		}
	}

	return [...teams.values()]
}

const fetchRecentFiles = async (signal: AbortSignal): Promise<Listing[] | null> =>
	web(RecentFilesMeta, "/api/recent_files", signal)
		.then((meta) =>
			meta.recent_files.slice(0, MAX_LISTED_FILES * 2).flatMap((file) => {
				if (!file.key || !file.name) return []

				return [
					{
						url: fileLink(kind(file.editor_type), file.key, file.name),
						name: file.name,
						time: file.touched_at || file.updated_at || null,
					},
				]
			}),
		)
		.catch(() => null)

export function account(ctx: Parameters<Plugin.MainSetup>[0]) {
	const stored = ctx.storage.store("account", {
		schema: Stored,
		initial: { token: "", encrypted: false, user: null, teams: [], team: null },
	})

	const cache = new Map<string, { at: number; files: Promise<Listing[]> }>()
	const names = ctx.storage.store("node-names", { schema: CachedNodeNames, initial: {} })
	const inflightNodeNames = new Map<string, Promise<string | null>>()
	let rateLimitedUntil = 0
	let discovered: { at: number; done: Promise<void> } | undefined

	const token = () => {
		const current = stored.value

		if (!current.token) return undefined

		return current.encrypted ? safeStorage.decryptString(Buffer.from(current.token, "base64")) : current.token
	}

	const required = () => {
		const value = token()

		if (!value) throw new Error("No Figma API key")

		return value
	}

	const edited = async (team: string, key: string): Promise<Listing[]> => {
		const source = await folders(key, team)

		const files = (
			await each(source.ids, 4, (folderId) =>
				source
					.files(folderId)
					.then((result) => result.files)
					.catch(() => []),
			)
		)
			.flat()
			.sort((a, b) => (b.last_modified ?? "").localeCompare(a.last_modified ?? ""))
			.slice(0, MAX_LISTED_FILES)

		return each(files, 4, async (file) => {
			const meta = await api(FileMetaResponse, key, `/v1/files/${file.key}/meta`).catch(() => undefined)
			const url = meta?.file?.url ?? fileLink(kind(meta?.file?.editorType), file.key, file.name)

			return { url, name: file.name, time: file.last_modified ?? null }
		})
	}

	const provider: IpcProvider<typeof FigmaAccount.spec> = ctx.provide(FigmaAccount, {
		state: () => ({
			user: stored.value.user,
			teams: stored.value.teams,
			team: stored.value.team,
			nodeNames: stored.value.nodeNames === true,
		}),
		token: async (value, caller) => {
			cache.clear()
			rateLimitedUntil = 0
			names.update((draft) => {
				for (const [key, entry] of Object.entries(draft)) if (entry.name === null) delete draft[key]
			})

			if (!value?.trim()) {
				stored.update((draft) => {
					draft.token = ""
					draft.encrypted = false
					draft.user = null
				})

				return provider.changed()
			}

			const key = value.trim()

			const me = await api(MeResponse, key, "/v1/me", caller.signal).catch((cause) => {
				throw cause instanceof ApiError && (cause.status === 401 || cause.status === 403)
					? new Error(INVALID_KEY)
					: cause
			})

			const encrypted = safeStorage.isEncryptionAvailable()
			stored.update((draft) => {
				draft.token = encrypted ? safeStorage.encryptString(key).toString("base64") : key
				draft.encrypted = encrypted
				draft.user = me.handle || me.email || "Figma"
			})
			provider.changed()
		},
		addTeam: async (link, caller) => {
			const teamId = /\/team\/(\d+)/.exec(link)?.[1] ?? /^\s*(\d+)\s*$/.exec(link)?.[1]

			if (!teamId) throw new Error(INVALID_TEAM)
			const team = await folders(required(), teamId, caller.signal)
			stored.update((draft) => {
				draft.teams = [...draft.teams.filter((entry) => entry.id !== teamId), { id: teamId, name: team.name }]
				draft.hidden = draft.hidden?.filter((hidden) => hidden !== teamId)
				draft.team = teamId
			})
			provider.changed()
		},
		removeTeam: (teamId) => {
			cache.delete(teamId)
			stored.update((draft) => {
				draft.teams = draft.teams.filter((team) => team.id !== teamId)
				draft.hidden = [...(draft.hidden ?? []).filter((hidden) => hidden !== teamId), teamId]

				if (draft.team === teamId) draft.team = draft.teams[0]?.id ?? null
			})
			provider.changed()
		},
		discover: () => {
			if (discovered && Date.now() - discovered.at < CACHE_TTL_MS) return discovered.done

			const done = discoverTeams().then((teams) => {
				const hidden = new Set(stored.value.hidden ?? [])
				const known = new Set(stored.value.teams.map((team) => team.id))
				const found = teams.filter((team) => !hidden.has(team.id) && !known.has(team.id))

				if (!found.length) return
				stored.update((draft) => {
					draft.teams = [...draft.teams, ...found]
					draft.team = draft.team ?? found[0].id
				})
				provider.changed()
			})

			discovered = { at: Date.now(), done }

			return done
		},
		selectTeam: (teamId) => {
			stored.update((draft) => {
				draft.team = teamId
			})
			provider.changed()
		},
		nodeNames: (enabled) => {
			stored.update((draft) => {
				draft.nodeNames = enabled
			})
			provider.changed()
		},
		recent: (_input, caller) => fetchRecentFiles(caller.signal),
		edited: async (team) => {
			const key = required()
			const hit = cache.get(team)

			if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.files
			const files = edited(team, key)
			cache.set(team, { at: Date.now(), files })
			files.catch(() => cache.delete(team))

			return files
		},
	})

	return {
		nodeName: (file: string, nodeId: string): Promise<string | null> => {
			const cached = `${file}\n${nodeId}`
			const hit = names.value[cached]

			if (hit && Date.now() - hit.at < (hit.name === null ? FAILED_NODE_NAME_TTL_MS : NODE_NAME_TTL_MS))
				return Promise.resolve(hit.name)
			const key = token()

			if (!key || !stored.value.nodeNames || Date.now() < rateLimitedUntil) return Promise.resolve(hit?.name ?? null)
			const running = inflightNodeNames.get(cached)

			if (running) return running

			const remember = (name: string | null) => {
				names.update((draft) => {
					draft[cached] = { name, at: Date.now() }
					const entries = Object.entries(draft)

					if (entries.length <= MAX_CACHED_NODE_NAMES) return
					entries
						.sort((a, b) => a[1].at - b[1].at)
						.slice(0, entries.length - MAX_CACHED_NODE_NAMES)
						.forEach(([old]) => delete draft[old])
				})

				return name
			}

			const read = api(
				NodesResponse,
				key,
				`/v1/files/${encodeURIComponent(file)}/nodes?ids=${encodeURIComponent(nodeId)}&depth=1`,
				AbortSignal.timeout(15_000),
			)
				.then((result) => remember(result.nodes?.[nodeId]?.document?.name || null))
				.catch((cause) => {
					if (cause instanceof ApiError && cause.status === 429) {
						rateLimitedUntil =
							Date.now() + (cause.retryAfterSeconds ? cause.retryAfterSeconds * 1000 : RATE_LIMIT_FALLBACK_MS)

						return hit?.name ?? null
					}

					if (cause instanceof ApiError) return remember(null)
					rateLimitedUntil = Date.now() + 60_000

					return hit?.name ?? null
				})
				.finally(() => inflightNodeNames.delete(cached))

			inflightNodeNames.set(cached, read)

			return read
		},
	}
}
