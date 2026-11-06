import { createSignal, onCleanup, Show } from "solid-js"
import { Match } from "effect"
import {
	Command,
	ComposerPill,
	createKeyed,
	LinkHandler,
	MenuItem,
	Panel,
	SettingsPage,
	Slot,
	Style,
	type ComposerPillRow,
	type ComposerPillView,
	type MountedSession,
	type PanelTab,
	type Plugin,
} from "@opencode/plugin/gui"
import type { Pull, PullRef } from "../types"
import { GitHub } from "../rpc"
import { openBrowser } from "./browser"
import type { definition } from "./definition"
import { CheckIcon, PullPanel, STATE_ICON } from "./panel"
import { createState, describe, type View } from "./state"
import { GitHubSettings } from "./settings"
import css from "./styles.css?inline"

const POLL_INTERVAL_MS = 60_000

export const setup: Plugin.Setup<typeof definition> = (ctx) => {
	const state = createState(ctx)
	const key = `${ctx.id}:main`

	ctx.add(Style, css)

	ctx.add(SettingsPage, {
		id: "github",
		icon: "github",
		get title() {
			return ctx.t("settings.title")
		},
		get entries() {
			return [
				{
					id: "github-hosts",
					title: ctx.t("settings.hosts"),
					description: ctx.t("settings.hosts.description"),
					keywords: "github hosts enterprise ghe.com add",
				},
				{
					id: "github-token",
					title: ctx.t("settings.token.title"),
					description: ctx.t("settings.token.description"),
					keywords: "github authentication personal access token pat enterprise",
				},
			]
		},
		render: () => <GitHubSettings />,
	})

	const open = (session: MountedSession, view?: View) => {
		if (view) state.setView(session.key, view)
		ctx.layout.open(key, session)
	}

	createKeyed(
		() => ctx.sessions.current()?.directory,
		(directory) => {
			void state.refresh({ directory })

			const timer = setInterval(() => {
				if (document.visibilityState === "visible") void state.refresh({ directory })
			}, POLL_INTERVAL_MS)

			const focus = () => void state.refresh({ directory })
			window.addEventListener("focus", focus)
			onCleanup(() => {
				clearInterval(timer)
				window.removeEventListener("focus", focus)
			})
		},
	)

	createKeyed(
		() => ctx.servers.get("sidecar")?.data,
		(data) => {
			onCleanup(data.on("session.execution.started", (event) => state.sent(`sidecar\n${event.data.sessionID}`)))
			onCleanup(
				data.on("session.execution.succeeded", () => {
					const directory = ctx.sessions.current()?.directory

					if (directory) void state.refresh({ directory }, true)
				}),
			)
		},
	)

	createKeyed(
		() => ctx.client,
		(client) => {
			const events = client.rpc(GitHub).events
			onCleanup(
				events.on("auth", () => {
					const directories = new Set(
						ctx.sessions.list().flatMap((session) => (session.location ? [session.location.directory] : [])),
					)

					for (const directory of directories) void state.refresh({ directory }, true)
				}),
			)
			onCleanup(
				events.on("open", (event) => {
					const session = ctx.sessions.list().find((item) => item.id === event.data.sessionID)

					if (!session) return

					if (event.data.tab) state.setView(session.key, event.data.tab)
					ctx.layout.open(key, session, { background: true })
				}),
			)
			onCleanup(
				events.on("create", (event) => {
					const session = ctx.sessions.list().find((item) => item.id === event.data.sessionID)

					if (!session) return
					state.setCreating(session.key, {
						title: event.data.title,
						body: event.data.body,
						base: event.data.base,
						draft: event.data.draft,
						reviewers: event.data.reviewers,
						labels: event.data.labels,
						attachments: event.data.attachments,
					})
					ctx.layout.open(key, session, { background: true })
				}),
			)
		},
	)

	const tab: PanelTab = {
		id: "main",
		get title() {
			return ctx.t("title")
		},
		label: () => (
			<span class="ghp-panel-tab">
				<ctx.ui.Icon name="github" size="small" />
				<span>{ctx.t("title")}</span>
			</span>
		),
		closable: "compact",
	}

	ctx.add(Panel, {
		id: "main",
		region: "side",
		wide: true,
		mobile: {
			get title() {
				return ctx.t("title")
			},
			order: 60,
			kind: "menu",
			icon: "github",
		},
		list: (input) => (input.open.includes("main") ? [tab] : []),
		focus: (input) => void state.refresh({ directory: input.session.directory }),
		render: (props) => (
			<PullPanel
				ctx={ctx}
				state={state}
				source={{ directory: props.session.directory }}
				scope={props.session.key}
				session={props.session}
				screen={props.screen}
				external={false}
			/>
		),
	})

	ctx.add(Command, () => {
		const session = ctx.sessions.current()

		return {
			id: "toggle",
			title: ctx.t("command.toggle"),
			keywords: "github pull request pr review checks ci",
			bind: "ctrl+mod+g",
			enabled: !!session,
			run: () => {
				if (session) ctx.layout.toggle(key, session)
			},
		}
	})

	ctx.add(Command, {
		id: "pulls",
		get title() {
			return ctx.t("command.pulls")
		},
		keywords: "github pull requests prs browse list review mine open merged",
		run: () => openBrowser(ctx, state),
	})

	ctx.add(MenuItem, (): MenuItem => {
		const session = ctx.sessions.current()
		const status = session && state.get({ directory: session.directory })
		const pull = !status?.error && status?.pull

		return {
			menu: "session.panel",
			id: "open",
			title: ctx.t("menu.open"),
			icon: "github",
			keybind: `${ctx.id}.toggle`,
			description: pull ? ctx.plural("pill.comments", pull.counts.comments) : undefined,
			opened: !!session && ctx.layout.state(key, session) !== "closed",
			run: () => {
				if (session) open(session)
			},
		}
	})

	ctx.add(ComposerPill, {
		id: "pull",
		show: (input): ComposerPillView | undefined => {
			const session = input.session
			const status = state.get({ directory: session.directory })

			if (!status) {
				const info = state.local(session.directory)
				const base = info?.base ?? "main"

				if (!info?.repo || !info.branch || !info.tracked || info.branch === base) return undefined

				return { icon: "github", label: ctx.t("pill.loading"), run: () => open(session) }
			}

			if (!status.repo || status.error) return undefined
			const pull = status.pull

			if (!pull) return undefined

			return pillView(pull, session)
		},
	})

	const pullOf = (directory: string) => {
		const status = state.get({ directory })

		return status?.repo && !status.error ? (status.pull ?? undefined) : undefined
	}

	const checksLabel = (pull: Pull) => {
		const checks = pull.checks.state

		if (!checks) return ctx.t("pill.checks.none")

		if (checks === "failure")
			return ctx.plural("pill.checks.failure", pull.checks.list.filter((check) => check.state === "failure").length)

		return ctx.t(`pill.checks.${checks === "neutral" ? "success" : checks}`)
	}

	const HeaderBadges = (props: { session: MountedSession }) => {
		const [pushing, setPushing] = createSignal(false)
		const directory = () => props.session.directory

		const unpushed = () => {
			const status = state.get({ directory: directory() })
			const pull = pullOf(directory())

			return !!pull && !status?.pushed && (pull.state === "open" || pull.state === "draft")
		}

		const push = async () => {
			const source = { directory: directory() }
			setPushing(true)

			try {
				await state.mutate(source, (api) => api.push(source))
				ctx.toast.show({ variant: "success", title: ctx.t("push.done") })
			} catch (cause) {
				ctx.toast.show({ variant: "error", title: ctx.t("push.failed"), description: describe(cause) })
			} finally {
				setPushing(false)
			}
		}

		return (
			<Show when={pullOf(directory())}>
				{(pull) => (
					<span class="ghp-header-badges">
						<Show when={pull().state !== "merged"}>
							<ctx.ui.Tooltip value={checksLabel(pull())}>
								<button
									type="button"
									class="ghp-header-badge"
									aria-label={`${ctx.t("pill.title", { number: pull().number })} · ${checksLabel(pull())}`}
									onClick={() => open(props.session, "checks")}
								>
									<CheckIcon ctx={ctx} state={pull().checks.state ?? "neutral"} size="small" />
								</button>
							</ctx.ui.Tooltip>
						</Show>
						<Show when={unpushed()}>
							<ctx.ui.Tooltip value={ctx.t("push.title")}>
								<ctx.ui.IconButton
									icon="cloud-upload"
									variant="ghost"
									size="normal"
									class="ghp-header-push"
									label={ctx.t("push.title")}
									busy={pushing()}
									onClick={() => void push()}
								/>
							</ctx.ui.Tooltip>
						</Show>
					</span>
				)}
			</Show>
		)
	}

	ctx.add(Slot, {
		at: "session.header",
		render: (input) => <HeaderBadges session={input.session} />,
	})

	ctx.add(Slot, {
		at: "session.panel.end",
		render: (input) => (
			<Show when={pullOf(input.session.directory)}>
				{(pull) => (
					<ctx.ui.Tooltip value={ctx.t("open.github")}>
						<button
							type="button"
							class="ghp-open-github"
							aria-label={ctx.t("open.github")}
							onClick={() => ctx.system.openExternal(pull().url)}
						>
							<ctx.ui.Icon name="github" size="small" />
						</button>
					</ctx.ui.Tooltip>
				)}
			</Show>
		),
	})

	const PULL_URL = /^https?:\/\/(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)(?:\/([\w-]+))?\/?(?:[?#].*)?$/i

	const parsePull = (href: string) => {
		const match = href.match(PULL_URL)

		if (!match) return undefined
		const ref: PullRef = { host: "github.com", owner: match[1]!, name: match[2]!, number: Number(match[3]) }

		const view: View = Match.value(match[4]).pipe(
			Match.when("checks", () => "checks" as const),
			Match.when("commits", () => "commits" as const),
			Match.orElse(() => "conversation" as const),
		)

		return { ref, view }
	}

	ctx.add(LinkHandler, {
		priority: 10,
		match: (link) => !!parsePull(link.href),
		exists: () => true,
		open: (link) => {
			const parsed = parsePull(link.href)

			if (!parsed) return
			const ref = parsed.ref
			const view = parsed.view
			const session = ctx.sessions.current()
			const own = session && pullOf(session.directory)
			const target = own && parsePull(own.url)?.ref

			if (
				session &&
				target &&
				target.number === ref.number &&
				target.owner.toLowerCase() === ref.owner.toLowerCase() &&
				target.name.toLowerCase() === ref.name.toLowerCase()
			) {
				state.setView(session.key, view)
				ctx.layout.open(key, session, { background: link.background })

				return
			}

			const source = { ref }
			const scope = `${ctx.id}:link`
			state.setView(scope, view)
			void state.refresh(source)
			ctx.dialogs.open(() => (
				<ctx.ui.Dialog title={`${ref.owner}/${ref.name} #${ref.number}`}>
					<div class="ghb-link">
						<PullPanel
							ctx={ctx}
							state={state}
							source={source}
							scope={scope}
							session={ctx.sessions.current()}
							screen={ctx.screen.current()}
						/>
					</div>
				</ctx.ui.Dialog>
			))
		},
	})

	const statusLabel = (pull: Pull) =>
		pull.state === "open" && pull.review === "APPROVED" ? ctx.t("review.APPROVED") : ctx.t(`state.${pull.state}`)

	const pillView = (pull: Pull, session: MountedSession): ComposerPillView => {
		const parts = [`#${pull.number}`, statusLabel(pull)]

		if (pull.counts.unresolved > 0) parts.push(ctx.plural("pill.unresolved", pull.counts.unresolved))

		const rows: ComposerPillRow[] = [
			{
				id: "pull",
				label: pull.title,
				icon: STATE_ICON[pull.state],
				detail: statusLabel(pull),
				run: () => open(session, "conversation"),
			},
			{
				id: "comments",
				label: ctx.plural("pill.comments", pull.counts.comments),
				icon: "speech-bubble",
				tone: pull.counts.unresolved > 0 ? "warning" : undefined,
				detail: pull.counts.unresolved > 0 ? ctx.plural("pill.unresolved", pull.counts.unresolved) : undefined,
				run: () => open(session, "conversation"),
			},
			{
				id: "external",
				label: ctx.t("open.github"),
				icon: "square-arrow-top-right",
				run: () => ctx.system.openExternal(pull.url),
			},
		]

		return {
			icon: STATE_ICON[pull.state],
			tone: pull.state === "closed" ? "danger" : undefined,
			label: parts.join(" · "),
			title: ctx.t("pill.title", { number: pull.number }),
			rows,
		}
	}
}
