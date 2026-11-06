import { onCleanup } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { Option, Schema } from "effect"
import type { Plugin } from "@opencode/plugin/gui"
import { GitHub } from "../rpc.ts"
import {
	sourceKey,
	type CreateDraft,
	type PullList,
	type PullRepo,
	type PullTab,
	type Source,
	type Status,
} from "../types.ts"
import { createDanger } from "./danger.ts"
import type { definition } from "./definition"

export type Ctx = Parameters<Plugin.Setup<typeof definition>>[0]

export type View = "conversation" | "commits" | "checks" | "details"

export type BrowserLists = Partial<PullRepo> & Partial<Record<PullTab, PullList>>

interface Entry {
	status?: Status
	loading: boolean
}

const MessageError = Schema.Struct({
	message: Schema.String,
})

const decodeMessageError = Schema.decodeUnknownOption(MessageError)

export const createState = (ctx: Ctx) => {
	const [entries, setEntries] = createStore<Record<string, Entry>>({})
	const [views, setViews] = createStore<Record<string, View>>({})
	const [attached, setAttached] = createStore<Record<string, true | undefined>>({})
	const [creating, setCreating] = createStore<Record<string, CreateDraft | undefined>>({})

	const [locals, setLocals] = createStore<
		Record<string, { repo: boolean; branch?: string; tracked: boolean; base?: string }>
	>({})

	const inflight = new Map<string, Promise<Status | undefined>>()
	const sources = new Map<string, Source>()
	const browserCache = new Map<string, BrowserLists>()

	const api = () => ctx.client.rpc(GitHub)
	const danger = createDanger(() => ctx.t("menu.delete"))
	onCleanup(danger.dispose)

	const apply = (key: string, status: Status) => {
		if (!entries[key]) setEntries(key, { loading: false })
		setEntries(key, "status", reconcile(status, { key: "id" }))
		setEntries(key, "loading", false)
	}

	const refresh = (source: Source, force = false) => {
		const key = sourceKey(source)
		sources.set(key, source)
		const running = inflight.get(key)

		if (running && !force) return running

		if (entries[key]) setEntries(key, "loading", true)
		else {
			setEntries(key, { loading: true })

			if ("directory" in source)
				void api()
					.local({ directory: source.directory })
					.then(
						(info) => setLocals(source.directory, info),
						() => undefined,
					)
		}

		const request = api()
			.status({ ...source, force })
			.then((status) => {
				if (inflight.get(key) === request) apply(key, status)

				return status
			})
			.catch((cause: unknown) => {
				if (inflight.get(key) === request)
					apply(key, {
						directory: key,
						pushed: false,
						fetched: Date.now(),
						error: { type: "api", message: describe(cause) },
					})

				return undefined
			})
			.finally(() => {
				if (inflight.get(key) === request) inflight.delete(key)
			})

		inflight.set(key, request)

		return request
	}

	const mutate = async (source: Source, run: (client: ReturnType<typeof api>) => Promise<Status>) => {
		const key = sourceKey(source)
		const status = await run(api())
		apply(key, status)
		const id = status.pull?.id

		if (id)
			for (const [other, value] of sources)
				if (other !== key && entries[other]?.status?.pull?.id === id) void refresh(value, true)

		return status
	}

	return {
		danger,
		browserCache,
		get: (source: Source) => entries[sourceKey(source)]?.status,
		local: (directory: string) => locals[directory],
		loading: (source: Source) => !!entries[sourceKey(source)]?.loading,
		refresh,
		mutate,
		markdown: (source: Source, text: string) =>
			api()
				.markdown({ ...source, text })
				.then((result) => result.html),
		options: (source: Source) => api().options(source),
		history: (directory: string, base: string) =>
			api()
				.history({ directory, base })
				.then((result) => result.commits),
		view: (key: string): View => views[key] ?? "conversation",
		setView: (key: string, view: View) => setViews(key, view),
		creating: (key: string) => creating[key],
		setCreating: (key: string, draft: CreateDraft | undefined) => {
			// Clear first so createStore replaces rather than merges fields.
			setCreating(key, undefined)

			if (draft) setCreating(key, { ...draft })
		},
		attached: (id: string) => !!attached[id],
		setAttached: (id: string, value: boolean) => setAttached(id, value ? true : undefined),
		sent: (session: string) =>
			Object.keys(attached)
				.filter((id) => id.startsWith(`${session}|`))
				.forEach((id) => setAttached(id, undefined)),
		api,
	}
}

export type State = ReturnType<typeof createState>

export const describe = (cause: unknown) => {
	if (cause instanceof Error) return cause.message
	const parsed = decodeMessageError(cause)

	return Option.isSome(parsed) ? parsed.value.message : String(cause)
}
