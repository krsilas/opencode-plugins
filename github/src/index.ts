import { Match, Schema } from "effect"
import { Plugin } from "@opencode/plugin"
import { AuthError, client, type Client } from "./api.ts"
import { attach, read, uploadsUrl, validate } from "./attachments.ts"
import { tokens } from "./auth.ts"
import { branch, fastForward, history, local, locate, push, template, unmerged, type Branch, type Sync } from "./git.ts"
import {
	addComment,
	approve,
	commentAction,
	item,
	items,
	LIST_QUERY,
	listQueries,
	type ListQueryData,
	merge,
	MINE_QUERY,
	type MineQueryData,
	NUMBER_QUERY,
	type NumberQueryData,
	options,
	OPTIONS_QUERY,
	type OptionsQueryData,
	pick,
	pull,
	PULL_NUMBER_QUERY,
	PULL_QUERY,
	type PullNumberQueryData,
	type PullQueryData,
	REPO_QUERY,
	type RepoQueryData,
	replyThread,
	resolveThread,
	summary,
} from "./github.ts"
import { hostname } from "./hosts.ts"
import { GitHub, PanelTabName } from "./rpc.ts"
import {
	sourceKey,
	type CommentAction,
	type Commit,
	type Located,
	type Pull,
	type PullRef,
	type PullRepo,
	type Source,
	type Status,
} from "./types.ts"

const STATUS_CACHE_TTL_MS = 15_000

type Input = { directory?: string; ref?: PullRef }

const source = (input: Input): Source => {
	if (input.ref) {
		const ref = input.ref

		return { ref: { host: hostname(ref.host), owner: ref.owner, name: ref.name, number: ref.number } }
	}

	if (input.directory) return { directory: input.directory }

	throw new Error("Pass a directory or a pull request")
}

export default Plugin.define({
	id: "opencode-pull-requests",
	async setup(ctx) {
		const auth = tokens(ctx.storage)
		const clients = new Map<string, Client>()
		const cache = new Map<string, { at: number; value: Promise<Status> }>()

		const api = (host: string) => {
			const existing = clients.get(host)

			if (existing) return existing
			const next = client(host, auth)
			clients.set(host, next)

			return next
		}

		const failure = (
			directory: string,
			cause: unknown,
			partial: Partial<Status> = {},
			type?: "git" | "api",
		): Status => ({
			directory,
			pushed: false,
			...partial,
			fetched: Date.now(),
			error: {
				type: cause instanceof AuthError ? "auth" : (type ?? (partial.branch ? "api" : "git")),
				message: cause instanceof Error ? cause.message : String(cause),
			},
		})

		const compare = async (gh: Client, owner: string, repo: string, current: Pull): Promise<Pull> => {
			if (current.state !== "open" && current.state !== "draft") return current

			const head =
				current.headOwner && current.headOwner !== owner ? `${current.headOwner}:${current.head}` : current.head

			try {
				const { data: result } = await gh.rest("GET /repos/{owner}/{repo}/compare/{basehead}", {
					owner,
					repo,
					basehead: `${current.base}...${head}`,
					per_page: 1,
				})

				return { ...current, sync: { ahead: result.ahead_by, behind: result.behind_by } }
			} catch {
				return current
			}
		}

		const load = async (directory: string): Promise<Status> => {
			let localBranch: Branch

			try {
				localBranch = await branch(directory)
			} catch (cause) {
				return failure(directory, cause)
			}

			const remote = localBranch.remote

			try {
				const data = await api(remote.host).graphql<PullQueryData>(PULL_QUERY, {
					owner: remote.owner,
					name: remote.repo,
					head: localBranch.head,
				})

				if (!data.repository) throw new Error(`Repository ${remote.owner}/${remote.repo} not found`)
				const base = data.repository.defaultBranchRef?.name ?? "main"
				const onBase = localBranch.head === base || localBranch.local === base
				const nodes = onBase ? [] : (data.repository.pullRequests?.nodes ?? []).filter((node) => node != null)
				const raw = pick(nodes)
				const selected = raw ? await compare(api(remote.host), remote.owner, remote.repo, pull(raw)) : undefined

				const suggestion =
					!selected && !onBase
						? await (async () => {
								const commits = await unmerged(directory, remote.name, base)
								const only = commits.length === 1 ? commits[0] : undefined
								const prTemplate = await template(directory)

								return {
									ahead: commits.length,
									title: only?.subject ?? humanize(localBranch.local),
									body: prTemplate ?? (only ? only.body : commits.map((commit) => `- ${commit.subject}`).join("\n")),
								}
							})()
						: undefined

				return {
					directory,
					branch: localBranch.local,
					repo: { host: remote.host, owner: remote.owner, name: remote.repo, url: data.repository.url, base },
					pull: selected,
					pulls: nodes.map(summary),
					pushed: localBranch.upstream && localBranch.ahead === 0,
					suggestion,
					fetched: Date.now(),
				}
			} catch (cause) {
				return failure(directory, cause, { branch: localBranch.local })
			}
		}

		const loadRef = async (ref: PullRef): Promise<Status> => {
			const key = sourceKey({ ref })

			try {
				const gh = api(ref.host)

				const data = await gh.graphql<PullNumberQueryData>(PULL_NUMBER_QUERY, {
					owner: ref.owner,
					name: ref.name,
					number: ref.number,
				})

				if (!data.repository) throw new Error(`Repository ${ref.owner}/${ref.name} not found`)
				const raw = data.repository.pullRequest

				if (!raw) throw new Error(`Pull request #${ref.number} not found in ${ref.owner}/${ref.name}`)

				return {
					directory: key,
					repo: {
						host: ref.host,
						owner: ref.owner,
						name: ref.name,
						url: data.repository.url,
						base: data.repository.defaultBranchRef?.name ?? "main",
					},
					pull: await compare(gh, ref.owner, ref.name, pull(raw)),
					pushed: true,
					fetched: Date.now(),
				}
			} catch (cause) {
				return failure(key, cause, {}, "api")
			}
		}

		const status = (from: Source, force = false) => {
			const key = sourceKey(from)
			const existing = cache.get(key)

			if (!force && existing && Date.now() - existing.at < STATUS_CACHE_TTL_MS) return existing.value
			const value = "ref" in from ? loadRef(from.ref) : load(from.directory)
			cache.set(key, { at: Date.now(), value })

			return value
		}

		const settle = (from: Source) => {
			cache.clear()

			return status(from, true)
		}

		const target = async (from: Source) => {
			const current = await status(from)

			if (!current.repo || ("directory" in from && !current.branch))
				throw new Error(current.error?.message ?? "No GitHub repository")

			return { current, repo: current.repo, client: api(current.repo.host) }
		}

		const parseCommentAction = (input: {
			action: "edit" | "delete" | "hide" | "unhide"
			kind?: "pull" | "issue" | "review" | "review-comment"
			id: string
			body?: string
			reason?: (typeof import("./types").HIDE_REASONS)[number]
		}): CommentAction => {
			switch (input.action) {
				case "edit":
					if (!input.kind || input.body === undefined) throw new Error("Missing comment kind or body")

					return { action: "edit", kind: input.kind, id: input.id, body: input.body }
				case "delete":
					if (!input.kind) throw new Error("Missing comment kind")

					return { action: "delete", kind: input.kind, id: input.id }
				case "hide":
					if (!input.reason) throw new Error("Missing hide reason")

					return { action: "hide", id: input.id, reason: input.reason }
				case "unhide":
					return { action: "unhide", id: input.id }
			}
		}

		const rpc = await ctx.rpc.register(GitHub, {
			accounts: async (_input, context) => guard(context, async () => ({ accounts: await auth.accounts() })),
			token: async (input, context) =>
				guard(context, async () => {
					await auth.set(input.host, input.token, context.signal)
					cache.clear()
					await rpc.events.emit("auth", {})

					return {}
				}),
			status: async (input) => status(source(input), input.force),
			create: async (input, context) =>
				guard(context, async () => {
					const reviewers = input.reviewers ?? []
					const labels = input.labels ?? []
					const attachments = input.attachments ?? []
					let body = input.body
					const localBranch = await branch(input.directory)
					const repo = { owner: localBranch.remote.owner, repo: localBranch.remote.repo }
					const gh = api(localBranch.remote.host)

					if (attachments.length) {
						const { data: repoInfo } = await gh.rest("GET /repos/{owner}/{repo}", repo)
						const uploaded = []

						for (const attachment of attachments) {
							const file = await read(attachment)
							uploaded.push({
								attachment,
								url: await gh.upload(repoInfo.id, attachment.name, file.type, new Blob([file.bytes])),
							})
						}

						body = attach(body, input.directory, uploaded)
					}

					if (!localBranch.upstream || localBranch.ahead !== 0)
						await push(input.directory, localBranch.remote.name, localBranch.local, localBranch.head)

					const { data: created } = await gh.rest("POST /repos/{owner}/{repo}/pulls", {
						...repo,
						title: input.title,
						body,
						base: input.base,
						head: localBranch.head,
						draft: input.draft,
					})

					const extras = await Promise.allSettled([
						reviewers.length
							? gh.rest("POST /repos/{owner}/{repo}/pulls/{pull_number}/requested_reviewers", {
									...repo,
									pull_number: created.number,
									reviewers: [...reviewers],
								})
							: undefined,
						labels.length
							? gh.rest("POST /repos/{owner}/{repo}/issues/{issue_number}/labels", {
									...repo,
									issue_number: created.number,
									labels: [...labels],
								})
							: undefined,
					])

					const result = await status({ directory: input.directory }, true)
					const failed = extras.find((extra) => extra.status === "rejected")

					if (failed) {
						const reason = failed.reason instanceof Error ? failed.reason.message : String(failed.reason)

						throw new Error(`Created #${created.number}, but could not add reviewers or labels: ${reason}`)
					}

					return result
				}),
			local: async (input) => {
				const info = await local(input.directory)

				return { repo: !!info, branch: info?.branch, tracked: !!info?.tracked, base: info?.base }
			},
			options: async (input, context) =>
				guard(context, async () => {
					const resolved = await target(source(input))

					return options(
						await resolved.client.graphql<OptionsQueryData>(OPTIONS_QUERY, {
							owner: resolved.repo.owner,
							name: resolved.repo.name,
						}),
					)
				}),
			history: async (input, context) =>
				guard(context, async () => {
					const localBranch = await branch(input.directory)
					const resolved = await target({ directory: input.directory })

					const commits: Commit[] = (await history(input.directory, localBranch.remote.name, input.base)).map(
						(commit) => ({
							oid: commit.oid,
							short: commit.short,
							headline: commit.headline,
							body: commit.body,
							date: commit.date,
							url: `${resolved.repo.url}/commit/${commit.oid}`,
							author: { login: commit.author },
							parents: commit.parents,
						}),
					)

					return { commits }
				}),
			reply: async (input, context) =>
				guard(context, async () => {
					const from = source(input)
					const resolved = await target(from)

					if (input.thread) await replyThread(resolved.client, input.thread, input.body)
					else if (resolved.current.pull) await addComment(resolved.client, resolved.current.pull.id, input.body)
					else throw new Error("No pull request to comment on")

					return settle(from)
				}),
			comment: async (input, context) =>
				guard(context, async () => {
					const from = source(input)
					const resolved = await target(from)
					await commentAction(resolved.client, parseCommentAction(input))

					return settle(from)
				}),
			markdown: async (input, context) =>
				guard(context, async () => {
					const resolved = await target(source(input))

					const { data: html } = await resolved.client.rest("POST /markdown", {
						text: input.text,
						mode: "gfm",
						context: `${resolved.repo.owner}/${resolved.repo.name}`,
					})

					return { html }
				}),
			approve: async (input, context) =>
				guard(context, async () => {
					const from = source(input)
					const resolved = await target(from)

					if (!resolved.current.pull) throw new Error("No pull request to approve")
					await approve(resolved.client, resolved.current.pull.id)

					return settle(from)
				}),
			merge: async (input, context) =>
				guard(context, async () => {
					const from = source(input)
					const resolved = await target(from)

					if (!resolved.current.pull) throw new Error("No pull request to merge")
					await merge(
						resolved.client,
						resolved.repo.owner,
						resolved.repo.name,
						resolved.current.pull.id,
						resolved.current.pull.headOid,
					)

					return settle(from)
				}),
			request: async (input, context) =>
				guard(context, async () => {
					const remove = input.remove ?? []
					const from = source(input)
					const resolved = await target(from)

					if (!resolved.current.pull) throw new Error("No pull request")
					const params = {
						owner: resolved.repo.owner,
						repo: resolved.repo.name,
						pull_number: resolved.current.pull.number,
					}

					if (input.reviewers.length)
						await resolved.client.rest("POST /repos/{owner}/{repo}/pulls/{pull_number}/requested_reviewers", {
							...params,
							reviewers: [...input.reviewers],
						})

					if (remove.length)
						await resolved.client.rest("DELETE /repos/{owner}/{repo}/pulls/{pull_number}/requested_reviewers", {
							...params,
							reviewers: [...remove],
						})

					return settle(from)
				}),
			update: async (input, context) =>
				guard(context, async () => {
					const from = source(input)
					const resolved = await target(from)

					if (!resolved.current.pull) throw new Error("No pull request")
					const previous = resolved.current.pull.headOid
					await resolved.client.rest("PUT /repos/{owner}/{repo}/pulls/{pull_number}/update-branch", {
						owner: resolved.repo.owner,
						repo: resolved.repo.name,
						pull_number: resolved.current.pull.number,
						expected_head_sha: previous,
					})

					if (!("directory" in from)) return { status: await settle(from) }
					const localBranch = await branch(from.directory)

					const isOwnTrackedBranch =
						localBranch.upstream &&
						localBranch.head === resolved.current.pull.head &&
						(!resolved.current.pull.headOwner || resolved.current.pull.headOwner === localBranch.remote.owner)

					const sync: Sync = isOwnTrackedBranch
						? await fastForward(from.directory, localBranch.remote.name, localBranch.head, previous).catch(
								(): Sync => "diverged",
							)
						: "diverged"

					return { status: await settle(from), sync }
				}),
			push: async (input, context) =>
				guard(context, async () => {
					const localBranch = await branch(input.directory)
					await push(input.directory, localBranch.remote.name, localBranch.local, localBranch.head)

					return settle({ directory: input.directory })
				}),
			labels: async (input, context) =>
				guard(context, async () => {
					const from = source(input)
					const resolved = await target(from)

					if (!resolved.current.pull) throw new Error("No pull request")
					await resolved.client.rest("PUT /repos/{owner}/{repo}/issues/{issue_number}/labels", {
						owner: resolved.repo.owner,
						repo: resolved.repo.name,
						issue_number: resolved.current.pull.number,
						labels: [...input.labels],
					})

					return settle(from)
				}),
			resolve: async (input, context) =>
				guard(context, async () => {
					const from = source(input)
					const resolved = await target(from)
					await resolveThread(resolved.client, input.thread, input.resolved)

					return settle(from)
				}),
			repo: async (input, context) =>
				guard(context, async () => {
					const host = hostname(input.host)
					const found = await api(host).graphql<RepoQueryData>(REPO_QUERY, { owner: input.owner, name: input.name })

					if (!found.repository) throw new Error(`Repository not found on ${host}`)
					const [owner = input.owner, name = input.name] = found.repository.nameWithOwner.split("/")

					const result: PullRepo = {
						repo: { host, owner, name, url: found.repository.url },
						viewer: found.viewer?.login ?? "",
					}

					return result
				}),
			pulls: async (input, context) =>
				guard(context, async () => {
					const gh = api(hostname(input.host))
					const number = input.search?.trim().match(/^#?(\d+)$/)?.[1]

					if (number) {
						const data = await gh.graphql<NumberQueryData>(NUMBER_QUERY, {
							owner: input.owner,
							name: input.name,
							number: Number(number),
						})

						const raw = data.repository?.pullRequest
						const found = raw ? item(raw) : undefined

						const fits =
							!!found &&
							Match.value(input.list).pipe(
								Match.when("mine", () => found.author.login === data.viewer?.login),
								Match.when("open", () => found.state === "open" || found.state === "draft"),
								Match.when("merged", () => found.state === "merged"),
								Match.exhaustive,
							)

						const open = fits && (found.state === "open" || found.state === "draft")

						return { total: fits ? 1 : 0, open: open ? 1 : 0, items: fits ? [found] : [] }
					}

					const queries = listQueries(input.owner, input.name, input.search)

					if (input.list === "mine") {
						const data = await gh.graphql<MineQueryData>(MINE_QUERY, {
							mineOpen: queries.mineOpen,
							mineClosed: queries.mineClosed,
						})

						const open = items(data.mineOpen)
						const closed = items(data.mineClosed)

						return {
							total: open.total + closed.total,
							open: open.total,
							items: [...open.items, ...closed.items],
						}
					}

					const data = await gh.graphql<ListQueryData>(LIST_QUERY, { search: queries[input.list] })
					const list = items(data.list)

					return { ...list, open: input.list === "open" ? list.total : 0 }
				}),
			locate: async (input) => {
				const located: Located[] = []
				await each([...new Set(input.directories)], 8, async (directory) => {
					const found = await locate(directory).catch(() => undefined)

					if (found)
						located.push({
							directory,
							repo: { host: found.remote.host, owner: found.remote.owner, name: found.remote.repo },
							branch: found.branch,
							head: found.head,
						})
				})

				return { located }
			},
		})

		const fail = (message: string): never => {
			throw new Error(message)
		}

		const branchStatus = async (force = false) => {
			const current = await status({ directory: ctx.location.directory }, force)

			if (current.error) fail(current.error.message)

			return current
		}

		await ctx.tool.transform((editor) => {
			editor.namespace({
				name: "github",
				description: "Pull requests for the session's git branch, and the GitHub panel in OpenCode Desktop.",
			})

			editor.add({
				name: "list_prs",
				description:
					"List the GitHub pull requests whose head is the current git branch, most recently updated first. " +
					"Marks the one the GitHub panel shows as selected.",
				input: Schema.Struct({}),
				options: { namespace: "github" },
				execute: async () => {
					const current = await branchStatus(true)
					const pulls = current.pulls ?? []

					if (pulls.length === 0) return { content: `No pull requests for branch ${current.branch}.` }

					return {
						content: pulls
							.map((entry) =>
								[
									`#${entry.number} ${entry.title}`,
									`  state: ${entry.state}${entry.number === current.pull?.number ? " (selected)" : ""}`,
									`  base: ${entry.base}`,
									`  updated: ${entry.updated}`,
									`  url: ${entry.url}`,
								].join("\n"),
							)
							.join("\n\n"),
					}
				},
			})

			editor.add({
				name: "get_pr",
				description:
					"Get basic information about a GitHub pull request: title, description, state, check status, and " +
					"review thread counts. Defaults to the PR the GitHub panel shows for the current branch.",
				input: Schema.Struct({
					number: Schema.optionalKey(Schema.Int).annotate({
						description: "PR number. Omit for the branch's selected PR.",
					}),
				}),
				options: { namespace: "github" },
				execute: async (input) => {
					const current = await branchStatus(true)
					const repo = current.repo ?? fail("No GitHub repository")
					let selected = current.pull

					if (input.number !== undefined && input.number !== selected?.number) {
						const data = await api(repo.host).graphql<PullNumberQueryData>(PULL_NUMBER_QUERY, {
							owner: repo.owner,
							name: repo.name,
							number: input.number,
						})

						const raw = data.repository?.pullRequest
						selected = raw ? pull(raw) : fail(`Pull request #${input.number} not found in ${repo.owner}/${repo.name}`)
					}

					if (!selected) return { content: `No pull request for branch ${current.branch}.` }

					return { content: describePull(selected) }
				},
			})

			editor.add({
				name: "open_panel",
				description:
					"Open the GitHub pull request panel for this session in OpenCode Desktop, optionally on a tab. " +
					"Only works while the session is open in a desktop window.",
				input: Schema.Struct({
					tab: Schema.optionalKey(PanelTabName).annotate({
						description: "Tab to show. Omit to keep the current tab.",
					}),
				}),
				options: { namespace: "github" },
				execute: async (input, context) => {
					const payload = input.tab
						? { sessionID: context.sessionID, tab: input.tab }
						: { sessionID: context.sessionID }

					await rpc.events.emit("open", payload)

					return {
						content: `Asked OpenCode Desktop to open the GitHub panel${input.tab ? ` on the ${input.tab} tab` : ""}.`,
					}
				},
			})

			editor.add({
				name: "create_pr",
				description:
					"Create a GitHub pull request for the current branch. Opens a pre-filled form in OpenCode Desktop " +
					"where the user can edit and must confirm it. Prefer this over the gh cli." +
					"Only works while the session is open in a desktop window.",
				input: Schema.Struct({
					title: Schema.String,
					body: Schema.optionalKey(Schema.String).annotate({
						description:
							"Markdown description. If the repository has a pull request template (such as " +
							".github/pull_request_template.md), fill it in. Omit to start from the template, or from the commits without one.",
					}),
					base: Schema.optionalKey(Schema.String).annotate({
						description: "Base branch. Defaults to the repository's default branch.",
					}),
					draft: Schema.optionalKey(Schema.Boolean).annotate({
						description: "Pre-select creating a draft PR.",
					}),
					reviewers: Schema.optionalKey(Schema.Array(Schema.String)).annotate({
						description: "GitHub logins to request.",
					}),
					labels: Schema.optionalKey(Schema.Array(Schema.String)).annotate({
						description: "Existing label names.",
					}),
					attachments: Schema.optionalKey(
						Schema.Array(
							Schema.Struct({
								path: Schema.String.annotate({ description: "Absolute, or relative to the session's directory." }),
								alt: Schema.optionalKey(Schema.String).annotate({
									description: "Alt text if the file is appended; defaults to the file name.",
								}),
							}),
						),
					).annotate({
						description:
							"Local images or videos (png, jpg, gif, webp, svg, mp4, mov, webm; images up to 10 MB) to upload to " +
							"GitHub when the user creates the PR. Reference a file in the body by its path, as in " +
							"`![Login screen](./screenshots/login.png)`, and the path is replaced with the uploaded URL; a video " +
							"image alone in its paragraph becomes a player. Files the body does not reference are appended. " +
							"Not supported on GitHub Enterprise Server.",
					}),
				}),
				options: { namespace: "github" },
				execute: async (input, context) => {
					const files = input.attachments ?? []
					const current = await branchStatus()

					if (current.branch === current.repo?.base) fail(`Branch ${current.branch} is the default branch.`)

					if (files.length && current.repo) uploadsUrl(current.repo.host)
					const attachments = await validate(ctx.location.directory, files)

					const basePayload = {
						sessionID: context.sessionID,
						title: input.title,
						body: input.body,
						base: input.base,
						draft: input.draft,
						reviewers: input.reviewers,
						labels: input.labels,
					}

					await rpc.events.emit("create", attachments.length ? { ...basePayload, attachments } : basePayload)

					return {
						content:
							"Opened the pull request form for the user to review. It is not created until they confirm; " +
							"use github_list_prs later to check.",
					}
				},
			})
		})
	},
})

const describePull = (current: Pull) => {
	const threads = current.threads.length
	const failing = current.checks.list.flatMap((entry) => (entry.state === "failure" ? [entry.name] : []))

	return [
		`#${current.number} ${current.title}`,
		`url: ${current.url}`,
		`state: ${current.state}`,
		`merged: ${current.state === "merged"}`,
		`branches: ${current.head} → ${current.base}`,
		`checks: ${current.checks.state ?? "none"}${failing.length ? ` (failing: ${failing.join(", ")})` : ""}`,
		`review threads: ${threads} (${current.counts.unresolved} unresolved, ${threads - current.counts.unresolved} resolved)`,
		"",
		"description:",
		current.body.trim() || "(empty)",
	].join("\n")
}

const guard = async <T, E>(
	context: { error: (type: "failed", message: string, data: { message: string }) => E },
	run: () => Promise<T>,
): Promise<T | E> => {
	try {
		return await run()
	} catch (cause) {
		const message = cause instanceof Error ? cause.message : String(cause)

		return context.error("failed", message, { message })
	}
}

const humanize = (name: string) => {
	const leaf = name.split("/").pop() ?? name
	const text = leaf.replace(/[-_]+/g, " ").trim()
	const ticket = name.match(/^([A-Z][A-Z0-9]+-\d+)/)?.[1]
	const sentence = text.charAt(0).toUpperCase() + text.slice(1)

	return ticket && !sentence.startsWith(ticket) ? `${ticket}: ${sentence}` : sentence
}

const each = async <T>(list: readonly T[], limit: number, run: (item: T) => Promise<void>) => {
	let next = 0

	const worker = async () => {
		while (next < list.length) await run(list[next++]!)
	}

	await Promise.all(Array.from({ length: Math.min(limit, list.length) }, worker))
}
