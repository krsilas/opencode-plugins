import { execFile } from "node:child_process"
import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"
import { Schema } from "effect"

export interface Remote {
	name: string
	host: string
	owner: string
	repo: string
}

export const git = (directory: string, args: string[], signal?: AbortSignal) =>
	new Promise<string>((resolve, reject) => {
		execFile(
			"git",
			args,
			{ cwd: directory, signal, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } },
			(error, stdout, stderr) => {
				if (error) return reject(new Error(stderr.trim() || error.message))
				resolve(stdout.trim())
			},
		)
	})

const attempt = (directory: string, args: string[], signal?: AbortSignal) =>
	git(directory, args, signal).catch(() => undefined)

export const parseRemote = (name: string, url: string): Remote | undefined => {
	const match =
		url.match(/^(?:https?|ssh|git):\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/(.+?)\/(.+?)(?:\.git)?\/?$/) ??
		url.match(/^(?:[^@]+@)?([^:/]+):(.+?)\/(.+?)(?:\.git)?\/?$/)

	if (!match) return undefined

	return { name, host: match[1]!.toLowerCase(), owner: match[2]!, repo: match[3]! }
}

export interface Branch {
	local: string
	head: string
	remote: Remote
	upstream: boolean
	ahead: number
}

export const branch = async (directory: string, signal?: AbortSignal): Promise<Branch> => {
	await git(directory, ["rev-parse", "--git-dir"], signal).catch(() => {
		throw new Error("Not a git repository")
	})

	const localBranch = await git(directory, ["symbolic-ref", "--quiet", "--short", "HEAD"], signal).catch(() => {
		throw new Error("HEAD is detached")
	})

	const upstream = await attempt(directory, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], signal)
	const configured = await attempt(directory, ["config", `branch.${localBranch}.remote`], signal)
	const remoteName = configured && configured !== "." ? configured : "origin"

	const url = await git(directory, ["remote", "get-url", remoteName], signal).catch(() => {
		throw new Error(`No remote named ${remoteName}`)
	})

	const remote = parseRemote(remoteName, url)

	if (!remote) throw new Error(`Unsupported remote URL: ${url}`)
	const head = upstream?.startsWith(`${remoteName}/`) ? upstream.slice(remoteName.length + 1) : localBranch

	const ahead = upstream
		? Number((await attempt(directory, ["rev-list", "--count", "@{u}..HEAD"], signal)) ?? 0)
		: Number.NaN

	return { local: localBranch, head, remote, upstream: !!upstream, ahead }
}

export const unmerged = async (directory: string, remote: string, base: string, signal?: AbortSignal) => {
	const output = await attempt(
		directory,
		["log", "--format=%s%x1f%b%x1e", `${remote}/${base}..HEAD`, "--max-count=50"],
		signal,
	)

	if (!output) return []

	return output
		.split("\x1e")
		.map((entry) => entry.trim())
		.filter(Boolean)
		.map((entry) => {
			const [subject = "", body = ""] = entry.split("\x1f")

			return { subject: subject.trim(), body: body.trim() }
		})
}

export const push = (directory: string, remote: string, localBranch: string, head: string, signal?: AbortSignal) =>
	git(directory, ["push", "--set-upstream", remote, `${localBranch}:${head}`], signal)

const TEMPLATE_DIRS = [".github", "", "docs"]

const TEMPLATE_NAMES = ["pull_request_template.md", "pull_request_template.txt", "pull_request_template"]

export const template = async (directory: string, signal?: AbortSignal) => {
	const root = await attempt(directory, ["rev-parse", "--show-toplevel"], signal)

	if (!root) return undefined

	for (const dir of TEMPLATE_DIRS) {
		const entries = await readdir(join(root, dir)).catch((): string[] => [])

		for (const name of TEMPLATE_NAMES) {
			const match = entries.find((entry) => entry.toLowerCase() === name)

			if (!match) continue
			const text = await readFile(join(root, dir, match), "utf8").catch(() => undefined)

			if (text?.trim()) return text
		}
	}

	return undefined
}

export interface LocalCommit {
	oid: string
	short: string
	parents: string[]
	date: string
	author: string
	headline: string
	body: string
}

export const locate = async (directory: string, signal?: AbortSignal) => {
	const current = await attempt(directory, ["symbolic-ref", "--quiet", "--short", "HEAD"], signal)
	const configured = current ? await attempt(directory, ["config", `branch.${current}.remote`], signal) : undefined
	const name = configured && configured !== "." ? configured : "origin"
	const url = await attempt(directory, ["remote", "get-url", name], signal)
	const remote = url ? parseRemote(name, url) : undefined

	if (!remote) return undefined

	const upstream = current
		? await attempt(directory, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], signal)
		: undefined

	const head = upstream?.startsWith(`${name}/`) ? upstream.slice(name.length + 1) : current

	return { remote, branch: current, head }
}

export const local = async (directory: string, signal?: AbortSignal) => {
	const current = await attempt(directory, ["symbolic-ref", "--quiet", "--short", "HEAD"], signal)

	if (current === undefined) {
		const repo = await attempt(directory, ["rev-parse", "--git-dir"], signal)

		return repo === undefined ? undefined : { branch: undefined, tracked: false, base: undefined }
	}

	const [upstream, head] = await Promise.all([
		attempt(directory, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], signal),
		attempt(directory, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"], signal),
	])

	return { branch: current, tracked: !!upstream, base: head?.replace(/^origin\//, "") }
}

export const history = async (directory: string, remote: string, base: string, signal?: AbortSignal) => {
	const ref = `${remote}/${base}`
	const known = await attempt(directory, ["rev-parse", "--verify", "--quiet", `refs/remotes/${ref}`], signal)

	if (!known) await git(directory, ["fetch", "--quiet", remote, `${base}:refs/remotes/${ref}`], signal)

	const output = await git(
		directory,
		["log", "--topo-order", "--max-count=100", "--format=%H%x1f%h%x1f%P%x1f%aI%x1f%an%x1f%s%x1f%b%x1e", `${ref}..HEAD`],
		signal,
	)

	return output
		.split("\x1e")
		.map((entry) => entry.trim())
		.filter(Boolean)
		.map((entry): LocalCommit => {
			const [oid = "", short = "", parents = "", date = "", author = "", headline = "", body = ""] = entry.split("\x1f")

			return { oid, short, parents: parents.split(" ").filter(Boolean), date, author, headline, body: body.trim() }
		})
}

export const Sync = Schema.Literals(["synced", "dirty", "diverged", "pending"])

export type Sync = typeof Sync.Type

export const fastForward = async (
	directory: string,
	remote: string,
	head: string,
	previous: string,
	signal?: AbortSignal,
): Promise<Sync> => {
	const ref = `refs/remotes/${remote}/${head}`
	let moved = false

	for (let tries = 0; tries < 6 && !moved; tries++) {
		if (tries) await new Promise((resolve) => setTimeout(resolve, 1500))
		await git(directory, ["fetch", "--quiet", remote, `+${head}:${ref}`], signal)
		moved = (await git(directory, ["rev-parse", ref], signal)) !== previous
	}

	if (!moved) return "pending"

	if ((await git(directory, ["rev-parse", "HEAD"], signal)) !== previous) return "diverged"

	if (await git(directory, ["status", "--porcelain", "--untracked-files=no"], signal)) return "dirty"
	await git(directory, ["merge", "--ff-only", "--quiet", ref], signal)

	return "synced"
}
