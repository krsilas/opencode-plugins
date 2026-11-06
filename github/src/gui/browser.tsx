import { createMemo, createSignal, For, Match, onCleanup, Show, Switch } from "solid-js"
import { createKeyed, type ServerRef } from "@opencode/plugin/gui"
import {
	repoKey,
	sourceKey,
	type Located,
	type PullItem,
	type PullList,
	type PullTab,
	type RepoRef,
	type Source,
} from "../types"
import { Avatar, CheckIcon, PullPanel, STATE_ICON, useRelative } from "./panel"
import { chooseRepo, label, openBrowser as openBrowserAction, same } from "./browser-actions"
import { describe, type BrowserLists, type Ctx, type State } from "./state"

const TABS: PullTab[] = ["mine", "open", "merged"]

const SIDECAR_SERVER = "sidecar"

type Session = Awaited<ReturnType<ServerRef["client"]["session"]["list"]>>["data"][number]

const MAX_SESSIONS = 500

export const openBrowser = (ctx: Ctx, state: State) =>
	openBrowserAction(ctx, state, () => {
		ctx.dialogs.open((dialog) => (
			<ctx.ui.Dialog title={ctx.t("pulls.title")}>
				<PullBrowser ctx={ctx} state={state} close={dialog.close} />
			</ctx.ui.Dialog>
		))
	})

function PullBrowser(props: { ctx: Ctx; state: State; close: () => void }) {
	const ui = props.ctx.ui
	const t = props.ctx.t
	const relative = useRelative(props.ctx)
	const repo = () => props.ctx.stores.browser.value.repo ?? undefined
	const [tab, setTab] = createSignal<PullTab>("mine")
	const [lists, setLists] = createSignal<BrowserLists>()
	const [error, setError] = createSignal<string>()
	const [loading, setLoading] = createSignal(false)
	const [pickedActive, setActive] = createSignal<number>()
	const [opened, setOpened] = createSignal<PullItem>()
	const [filter, setFilter] = createSignal("")
	const [scrolled, setScrolled] = createSignal(false)
	let list: HTMLUListElement | undefined

	let latestRequestId = 0

	const load = (target: RepoRef) => {
		const id = ++latestRequestId
		const key = repoKey(target)
		setLists(props.state.browserCache.get(key) ?? {})
		setLoading(true)
		setError(undefined)
		const api = props.state.api()

		const store = (patch: BrowserLists) => {
			if (id !== latestRequestId) return
			const next = { ...lists(), ...patch }
			setLists(next)
			props.state.browserCache.set(key, next)
		}

		const fetchLists = (ref: RepoRef) =>
			Promise.all(
				TABS.map((name) =>
					api.pulls({ ...ref, list: name }).then((result) => {
						const canonical = lists()?.repo

						if (!canonical || same(canonical, ref)) store({ [name]: result })
					}),
				),
			)

		Promise.all([
			api.repo(target).then((info) => {
				store(info)

				if (!same(info.repo, target)) return fetchLists(info.repo)
			}),
			fetchLists(target),
		])
			.catch((cause: unknown) => id === latestRequestId && setError(describe(cause)))
			.finally(() => id === latestRequestId && setLoading(false))
	}

	createKeyed(
		() => {
			const current = repo()

			return current ? repoKey(current) : undefined
		},
		() => {
			setLists(undefined)
			setActive(undefined)
			setOpened(undefined)
			setFilter("")
			const target = repo()

			if (target) load(target)
		},
		{
			otherwise: () => {
				setLists(undefined)
				setActive(undefined)
				setOpened(undefined)
				setFilter("")
			},
		},
	)

	const [found, setFound] = createSignal<{ text: string; lists: Partial<Record<PullTab, PullList>> }>()
	const [searching, setSearching] = createSignal(false)

	const listed = createMemo(() => {
		const value = lists()?.repo

		return value ? repoKey(value) : undefined
	})

	let search = 0

	createKeyed(
		() => ({ text: filter().trim(), key: listed() }),
		(current) => {
			const id = ++search
			const target = lists()?.repo

			if (!current.text || !current.key || !target) {
				setFound(undefined)
				setSearching(false)

				return
			}

			setSearching(true)

			const timer = setTimeout(() => {
				const api = props.state.api()
				const result: Partial<Record<PullTab, PullList>> = {}
				Promise.all(
					TABS.map((name) =>
						api
							.pulls({ host: target.host, owner: target.owner, name: target.name, list: name, search: current.text })
							.then((value) => {
								if (id !== search) return
								result[name] = value
								setFound({ text: current.text, lists: { ...result } })
							}),
					),
				)
					.catch((cause: unknown) => id === search && setError(describe(cause)))
					.finally(() => id === search && setSearching(false))
			}, 300)

			onCleanup(() => clearTimeout(timer))
		},
		{
			equals: (a, b) => a.text === b.text && a.key === b.key,
		},
	)

	const searched = (name: PullTab) => {
		const value = found()

		return value && value.text === filter().trim() ? value.lists[name] : undefined
	}

	const listOf = (name: PullTab) => searched(name) ?? lists()?.[name]
	const current = () => listOf(tab())

	const items = createMemo(() => {
		const result = searched(tab())

		if (result) return result.items
		const all = lists()?.[tab()]?.items ?? []
		const needle = filter().trim().toLowerCase()

		if (!needle) return all

		return all.filter((item) =>
			`#${item.number} ${item.title} ${item.author.login} ${item.head}`.toLowerCase().includes(needle),
		)
	})

	const active = () => {
		const shown = items()
		const selected = pickedActive()

		return selected !== undefined && shown.some((item) => item.number === selected) ? selected : shown[0]?.number
	}

	const canonicalRepo = (): RepoRef | undefined => {
		const value = lists()?.repo

		return value && { host: value.host, owner: value.owner, name: value.name }
	}

	const source = createMemo((): Source | undefined => {
		const target = canonicalRepo()
		const pull = opened()

		return target && pull ? { ref: { ...target, number: pull.number } } : undefined
	})

	createKeyed(source, (value) => void props.state.refresh(value), {
		equals: (a, b) => sourceKey(a) === sourceKey(b),
	})

	const open = (item: PullItem) => {
		setActive(item.number)
		setOpened(item)
	}

	const back = () => {
		setOpened(undefined)
		queueMicrotask(() => {
			list?.focus()
			list?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" })
		})
	}

	const refresh = () => {
		const target = repo()

		if (target) load(target)
		const value = source()

		if (value) void props.state.refresh(value, true)
	}

	const change = async () => {
		const before = repo()
		const next = await chooseRepo(props.ctx, props.state)

		if (next && before && same(next, before)) refresh()
	}

	const move = (step: number) => {
		const shown = items()

		if (!shown.length) return
		const index = shown.findIndex((item) => item.number === active())
		const next = shown[Math.max(0, Math.min(shown.length - 1, index + step))]!
		setActive(next.number)
		queueMicrotask(() =>
			list?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" }),
		)
	}

	const keys = (event: KeyboardEvent) => {
		if (event.defaultPrevented || event.altKey || event.metaKey || event.ctrlKey) return

		if (event.key === "ArrowDown" || event.key === "ArrowUp") {
			event.preventDefault()
			move(event.key === "ArrowDown" ? 1 : -1)

			return
		}

		if (event.key !== "Enter" || (event.target instanceof Element && event.target.closest("button"))) return
		const item = items().find((entry) => entry.number === active())

		if (!item) return
		event.preventDefault()
		open(item)
	}

	const sessions = createSessions(props.ctx, props.state)

	return (
		<div class="ghp ghb" data-mode={props.ctx.appearance.mode()} data-view={opened() ? "pull" : "list"}>
			<div class="ghb-view" hidden={!!opened()} onKeyDown={keys}>
				<div class="ghb-repo-row">
					<button
						type="button"
						class="ghp-branch-button ghb-repo"
						title={t("pulls.repo.change")}
						aria-label={t("pulls.repo.change")}
						onClick={() => void change()}
					>
						<ui.Icon name="branch" size="small" />
						<span>{repo() ? label(repo()!) : t("pulls.repo.choose")}</span>
						<ui.Icon name="chevron-down" size="small" />
					</button>
					<span class="ghp-spacer" />
					<ui.Tooltip value={t("refresh")}>
						<ui.IconButton
							icon="refresh"
							variant="ghost"
							size="small"
							label={t("refresh")}
							busy={loading() || searching()}
							onClick={refresh}
						/>
					</ui.Tooltip>
				</div>
				<Show when={lists()?.mine}>
					<nav class="ghb-tabs" role="tablist">
						<For each={TABS}>
							{(id) => (
								<button
									type="button"
									role="tab"
									class="ghp-tab"
									aria-selected={tab() === id}
									onClick={() => setTab(id)}
								>
									{t(`pulls.tab.${id}`)}
									<Show when={listOf(id)?.open}>{(open) => <span class="ghp-counter">{open()}</span>}</Show>
								</button>
							)}
						</For>
					</nav>
				</Show>
				<div class="ghb-results" data-scrolled={scrolled() && !!current() && items().length > 0 && !error()}>
					<Show when={lists()?.mine && !error()}>
						<div class="ghb-filter" ref={(element) => queueMicrotask(() => element.querySelector("input")?.focus())}>
							<ui.TextInput
								type="search"
								label={t("picker.filter")}
								placeholder={t("picker.filter")}
								value={filter()}
								onInput={setFilter}
							/>
						</div>
					</Show>
					<Switch
						fallback={
							<div class="ghp-center">
								<ui.Loader />
							</div>
						}
					>
						<Match when={!repo()}>
							<p class="ghb-note ghp-weak">{t("pulls.repo.none")}</p>
						</Match>
						<Match when={error()}>
							{(message) => (
								<div class="ghb-note">
									<p class="ghp-error">{message()}</p>
									<div class="ghb-actions">
										<ui.Button size="small" icon="refresh" onClick={refresh}>
											{t("retry")}
										</ui.Button>
										<ui.Button size="small" variant="ghost" onClick={() => props.ctx.layout.settings("github")}>
											{t("settings.open")}
										</ui.Button>
									</div>
								</div>
							)}
						</Match>
						<Match when={searching() && items().length === 0}>
							<div class="ghp-center">
								<ui.Loader />
							</div>
						</Match>
						<Match when={current() && items().length === 0}>
							<p class="ghb-note ghp-weak">{filter().trim() ? t("picker.none") : t(`pulls.empty.${tab()}`)}</p>
						</Match>
						<Match when={current()}>
							<ul
								ref={(element) => {
									list = element
									setScrolled(element.scrollTop > 0)
								}}
								class="ghb-items"
								role="listbox"
								aria-label={t(`pulls.tab.${tab()}`)}
								tabindex="0"
								onScroll={(event) => setScrolled(event.currentTarget.scrollTop > 0)}
							>
								<For each={items()}>
									{(item) => (
										<Row
											ctx={props.ctx}
											item={item}
											selected={item.number === active()}
											relative={relative}
											onSelect={() => open(item)}
											onHover={() => setActive(item.number)}
										/>
									)}
								</For>
							</ul>
							<Show when={!filter().trim() && current()!.total > current()!.items.length}>
								<p class="ghb-more ghp-weak">
									{t("pulls.more", { shown: current()!.items.length, total: current()!.total })}
								</p>
							</Show>
						</Match>
					</Switch>
				</div>
			</div>
			<Show when={source() && opened()}>
				{(pull) => (
					<div
						class="ghb-view ghb-detail"
						onKeyDown={(event) => {
							if (event.key !== "Escape" || event.defaultPrevented) return
							event.preventDefault()
							event.stopPropagation()
							back()
						}}
					>
						<div class="ghb-back-row">
							<ui.Button size="small" variant="ghost" icon="arrow-left" onClick={back}>
								{t("pulls.back")}
							</ui.Button>
							<span class="ghp-weak ghb-back-repo">{repo() ? label(repo()!) : ""}</span>
						</div>
						<Sessions
							ctx={props.ctx}
							pull={pull()}
							repos={[repo()!, canonicalRepo()!]}
							sessions={sessions}
							relative={relative}
							onOpen={(session) => {
								props.ctx.tabs.open({ server: SIDECAR_SERVER, id: session.id }, { focus: true })
								props.close()
							}}
						/>
						<Show when={`${repoKey(canonicalRepo()!)}#${pull().number}`} keyed>
							<PullPanel
								ctx={props.ctx}
								state={props.state}
								source={source()!}
								scope={`${props.ctx.id}:browser`}
								session={props.ctx.sessions.current()}
								screen={props.ctx.screen.current()}
							/>
						</Show>
					</div>
				)}
			</Show>
		</div>
	)
}

function Row(props: {
	ctx: Ctx
	item: PullItem
	selected: boolean
	relative: ReturnType<typeof useRelative>
	onSelect: () => void
	onHover: () => void
}) {
	const ctx = props.ctx

	return (
		<li
			role="option"
			class="ghb-item"
			aria-selected={props.selected}
			title={props.item.title}
			onClick={() => props.onSelect()}
			onMouseMove={() => !props.selected && props.onHover()}
		>
			<span class={`ghb-item-icon ghb-state-${props.item.state}`}>
				<ctx.ui.Icon name={STATE_ICON[props.item.state]} size="small" />
			</span>
			<span class="ghb-item-main">
				<span class="ghb-item-title">{props.item.title}</span>
				<span class="ghb-item-meta">
					<span>#{props.item.number}</span>
					<Avatar author={props.item.author} size={14} />
					<span class="ghb-item-author">{props.item.author.login}</span>
					<span>·</span>
					<span class="ghb-time">{props.relative(props.item.updated)}</span>
					<span class="ghp-spacer" />
					<code class="ghp-ref ghb-item-branch" title={`${props.item.base} ← ${props.item.head}`}>
						{props.item.head}
					</code>
					<Show when={props.item.comments > 0}>
						<span class="ghb-item-count">
							<ctx.ui.Icon name="speech-bubble" size="small" />
							{props.item.comments}
						</span>
					</Show>
					<Show when={props.item.state !== "merged" && props.item.state !== "closed" && props.item.checks}>
						{(checks) => <CheckIcon ctx={ctx} state={checks()} size="small" />}
					</Show>
				</span>
			</span>
		</li>
	)
}

interface Found {
	sessions: Session[]
	located: Map<string, Located>
}

const createSessions = (ctx: Ctx, state: State) => {
	const [found, setFound] = createSignal<Found>()
	const [failed, setFailed] = createSignal(false)
	let alive = true
	onCleanup(() => {
		alive = false
	})
	void (async () => {
		const server = ctx.servers.get(SIDECAR_SERVER)

		if (!server) return setFailed(true)
		const sessions: Session[] = []
		let cursor: string | undefined

		do {
			const baseQuery = {
				parentID: null,
				archived: false,
				order: "desc" as const,
				limit: 100,
			}

			const page = await server.client.session.list(cursor ? { ...baseQuery, cursor } : baseQuery)
			sessions.push(...page.data)
			cursor = page.cursor.next ?? undefined
		} while (cursor && sessions.length < MAX_SESSIONS && alive)

		const roots = sessions.filter((session) => !session.parentID && !session.time.archived)
		const result = await state.api().locate({ directories: roots.map((session) => session.location.directory) })

		if (alive) setFound({ sessions: roots, located: new Map(result.located.map((item) => [item.directory, item])) })
	})().catch(() => alive && setFailed(true))

	return {
		loading: () => !found() && !failed(),
		related: (repos: readonly RepoRef[], pull: PullItem) => {
			const value = found()

			if (!value) return []
			const owner = pull.headOwner?.toLowerCase()

			return value.sessions
				.filter((session) => {
					const place = value.located.get(session.location.directory)

					if (!place || (place.head !== pull.head && place.branch !== pull.head)) return false

					return repos.some(
						(repo) =>
							same(place.repo, repo) || (place.repo.host === repo.host && place.repo.owner.toLowerCase() === owner),
					)
				})
				.sort((a, b) => b.time.updated - a.time.updated)
		},
	}
}

function Sessions(props: {
	ctx: Ctx
	repos: readonly RepoRef[]
	pull: PullItem
	sessions: ReturnType<typeof createSessions>
	relative: ReturnType<typeof useRelative>
	onOpen: (session: Session) => void
}) {
	const ctx = props.ctx
	const t = ctx.t
	const related = () => props.sessions.related(props.repos, props.pull)

	return (
		<Show when={related().length}>
			<div class="ghb-sessions">
				<span class="ghb-sessions-label">{t("pulls.sessions.label")}</span>
				<div class="ghb-sessions-list">
					<For each={related()}>
						{(session) => (
							<ctx.ui.Tooltip value={`${t("pulls.sessions.open")} · ${session.location.directory}`}>
								<button type="button" class="ghb-session" onClick={() => props.onOpen(session)}>
									<span class="ghb-session-title">{session.title || t("pulls.sessions.untitled")}</span>
									<span class="ghb-time">{props.relative(new Date(session.time.updated).toISOString())}</span>
								</button>
							</ctx.ui.Tooltip>
						)}
					</For>
				</div>
			</div>
		</Show>
	)
}
