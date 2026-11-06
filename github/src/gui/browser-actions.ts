import type { SelectOption } from "@opencode/plugin/gui"
import { repoKey, type Located, type RepoRef } from "../types.ts"
import { authenticatedHosts } from "./repo.ts"
import { describe, type Ctx, type State } from "./state.ts"

const SERVER = "sidecar"

export const same = (a: RepoRef, b: RepoRef) => repoKey(a).toLowerCase() === repoKey(b).toLowerCase()

export const label = (repo: RepoRef) => (repo.host === "github.com" ? `${repo.owner}/${repo.name}` : repoKey(repo))

const basename = (path: string) => path.replace(/\/+$/, "").split("/").pop() ?? path

const loadHosts = async (ctx: Ctx, state: State): Promise<Set<string> | undefined> => {
	try {
		return authenticatedHosts((await state.api().accounts({})).accounts)
	} catch (cause) {
		ctx.toast.show({ variant: "error", title: ctx.t("pulls.repo.accounts.failed"), description: describe(cause) })

		return undefined
	}
}

export const chooseRepo = async (ctx: Ctx, state: State, knownHosts?: Set<string>): Promise<RepoRef | undefined> => {
	const t = ctx.t
	const store = ctx.stores.browser
	const current = ctx.sessions.current()?.directory
	const data = ctx.servers.get(SERVER)?.data
	const hosts = knownHosts ?? (await loadHosts(ctx, state))
	if (!hosts) return undefined

	if (data && data.project.list().length === 0) await data.project.sync().catch(() => undefined)

	const directories = [
		...(current ? [current] : []),
		...(data?.project.list() ?? []).map((project) => project.canonical),
	]

	const located = directories.length
		? await state
				.api()
				.locate({ directories })
				.then(
					(result) => result.located,
					(): readonly Located[] => [],
				)
		: []

	const seen = new Set<string>()
	const options: SelectOption<RepoRef>[] = []

	const add = (repo: RepoRef, group: string, description?: string) => {
		const key = repoKey(repo).toLowerCase()

		if (!hosts.has(repo.host.toLowerCase()) || seen.has(key)) return
		seen.add(key)
		options.push({ title: label(repo), value: repo, group, description })
	}

	for (const repo of store.value.recent) add(repo, t("pulls.repo.recent"))

	for (const item of located) add(item.repo, t("pulls.repo.projects"), basename(item.directory))
	const remembered = store.value.repo

	const picked = await ctx.dialogs.select({
		title: t("pulls.repo.choose"),
		placeholder: t("pulls.repo.search"),
		options,
		current: options.find((option) => remembered && same(option.value, remembered))?.value,
	})

	if (!picked) return undefined
	const chosen = { host: picked.host, owner: picked.owner, name: picked.name }
	store.update((draft) => {
		draft.repo = chosen
		draft.recent = [chosen, ...draft.recent.filter((item) => !same(item, chosen))].slice(0, 8)
	})

	return chosen
}

export const openBrowser = async (ctx: Ctx, state: State, open: () => void) => {
	const hosts = await loadHosts(ctx, state)
	if (!hosts) return
	if (hosts.size === 0) {
		ctx.layout.settings("github")

		return
	}
	if (!ctx.stores.browser.value.repo && !(await chooseRepo(ctx, state, hosts))) return
	open()
}
