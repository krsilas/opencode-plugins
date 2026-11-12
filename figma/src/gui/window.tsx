import { createSignal, onCleanup, Show, type Accessor } from "solid-js"
import {
	Command,
	createKeyed,
	LinkHandler,
	MenuItem,
	Panel,
	SettingsPage,
	Style,
	usePanel,
	usePlugin,
	type MountedSession,
	type PanelTab,
	type Plugin,
	type SessionRef,
} from "@opencode/plugin/gui"
import { Option, Schema } from "effect"
import { FigmaView, viewKey } from "./contract"
import { Figma } from "../rpc"
import { AnnotateLayer, crop, density, type Area } from "./annotate"
import { lineCommentCss } from "./line-comment/shims"
import { Launcher } from "./launcher"
import { FigmaSettings } from "./settings"
import { FigmaEntry, type definition } from "./definition"
import { fileName, figmaUrl, hasNode, nodeId, parseFigmaUrl, supportsDev, toolbarKey, type View } from "./url"
import { fileTitle, nodeTitle, rename, visit, type NameTarget } from "./names"
import css from "./styles.css?inline"

const ICON = "pencil-line"

const LAUNCHER_TAB_ID = "new"

const decodeStoredEntry = Schema.decodeUnknownOption(Schema.fromJsonString(FigmaEntry))

const fileUri = (path: string) => {
	const normalized = path.replace(/\\/g, "/")
	const rooted = /^[A-Za-z]:/.test(normalized) ? `/${normalized}` : normalized

	return `file://${rooted
		.split("/")
		.map((segment, index) => (index === 1 && /^[A-Za-z]:$/.test(segment) ? segment : encodeURIComponent(segment)))
		.join("/")}`
}

const formatTime = (iso: string) => {
	const date = new Date(iso)

	return Number.isNaN(date.getTime())
		? iso
		: date.toLocaleString(undefined, {
				dateStyle: "medium",
				timeStyle: "short",
			})
}

function FigmaLogo() {
	return (
		<svg class="figma-logo" viewBox="0 0 38 57" aria-hidden="true">
			<path fill="#1abcfe" d="M19 28.5a9.5 9.5 0 1 1 19 0 9.5 9.5 0 0 1-19 0z" />
			<path fill="#0acf83" d="M0 47.5A9.5 9.5 0 0 1 9.5 38H19v9.5a9.5 9.5 0 1 1-19 0z" />
			<path fill="#ff7262" d="M19 0v19h9.5a9.5 9.5 0 1 0 0-19H19z" />
			<path fill="#f24e1e" d="M0 9.5A9.5 9.5 0 0 0 9.5 19H19V0H9.5A9.5 9.5 0 0 0 0 9.5z" />
			<path fill="#a259ff" d="M0 28.5A9.5 9.5 0 0 0 9.5 38H19V19H9.5A9.5 9.5 0 0 0 0 28.5z" />
		</svg>
	)
}

type Ctx = Parameters<Plugin.Setup<typeof definition>>[0]

function TitleInput(props: { class: string; value: string; label: string; done: (value?: string) => void }) {
	let finished = false

	const finish = (value?: string) => {
		if (finished) return
		finished = true
		props.done(value)
	}

	return (
		<input
			ref={(element) =>
				requestAnimationFrame(() => {
					element.focus()
					element.select()
				})
			}
			class={`${props.class} figma-title-input`}
			value={props.value}
			placeholder={props.label}
			aria-label={props.label}
			spellcheck={false}
			onKeyDown={(event) => {
				if (event.isComposing) return

				if (event.key === "Enter") {
					event.preventDefault()
					finish(event.currentTarget.value)
				}

				if (event.key === "Escape") {
					event.preventDefault()
					event.stopPropagation()
					finish()
				}
			}}
			onBlur={(event) => finish(event.currentTarget.value)}
		/>
	)
}

function FigmaPane(props: {
	session: MountedSession
	tab: PanelTab
	picked: Accessor<string | undefined>
	setPicked: (key: string) => void
	annotateRequest: Accessor<string | undefined>
	clearAnnotateRequest: () => void
	choose: (session: SessionRef) => void
	open: (session: SessionRef, link: string) => void
	update: (session: SessionRef, id: string, patch: Partial<Omit<FigmaEntry, "id">>) => void
	remove: (session: MountedSession, id: string) => void
	attach: (session: MountedSession, png: string, comment: string, send: boolean) => Promise<void>
}) {
	const ctx = usePlugin<typeof definition>()
	const frame = usePanel()
	const view = ctx.main(FigmaView)
	const loaded = () => !!ctx.stores.file(props.session).value
	const files = () => ctx.stores.file(props.session).value?.files ?? []
	const mobile = () => frame.placement() === "mobile"

	const file = () => {
		const list = files()

		if (!mobile()) return list.find((entry) => entry.id === props.tab.id)

		return list.find((entry) => viewKey(props.session.key, entry.id) === props.picked()) ?? list.at(-1)
	}

	const url = () => file()?.url || ""
	const history = () => ctx.stores.history.value.files
	const title = () => (url() ? fileTitle(history(), url()) : "")

	const key = () => {
		const entry = file()

		return entry ? viewKey(props.session.key, entry.id) : ""
	}

	const update = (patch: Partial<Omit<FigmaEntry, "id">>) => {
		const entry = file()

		if (entry) props.update(props.session, entry.id, patch)
	}

	const [embedId, setEmbedId] = createSignal<string>()
	const [error, setError] = createSignal<string>()
	const [still, setStill] = createSignal<Uint8Array>()
	const [nodeName, setNodeName] = createSignal<string>()
	const [updatedAt, setUpdatedAt] = createSignal<string>()
	const [devAccess, setDevAccess] = createSignal<boolean | null>(null)
	const [accessVersion, setAccessVersion] = createSignal(0)
	const [panel, setPanel] = createSignal<HTMLDivElement>()
	const [narrow, setNarrow] = createSignal(false)

	createKeyed(panel, (element) => {
		const observer = new ResizeObserver(([entry]) => setNarrow(entry.contentRect.width < 420))
		observer.observe(element)
		onCleanup(() => observer.disconnect())
	})

	const [editState, setEditState] = createSignal<{ id: string; target: NameTarget }>()
	const editing = () => {
		const state = editState()

		return state && state.id === file()?.id ? state.target : undefined
	}
	const node = () => (url() ? nodeTitle(history(), url()) : undefined) || nodeName()

	const save = (target: NameTarget, value?: string) => {
		setEditState(undefined)

		if (value === undefined || !url()) return
		const next = value.trim()
		const fallback = target === "file" ? fileName(url()) : nodeName()
		const stored = next && next !== fallback ? next : undefined
		const store = ctx.stores.history
		store.set({ files: rename(store.value.files, url(), target, stored, new Date().toISOString()) })
	}

	const nameMenu = async (event: MouseEvent) => {
		const entry = file()

		if (!entry || event.target instanceof HTMLInputElement) return
		event.preventDefault()
		const choice = await view
			.menu(
				[
					{ id: "file", label: ctx.t("toolbar.rename.file.action") },
					...(scope() === "node" ? [{ id: "node", label: ctx.t("toolbar.rename.node.action") }] : []),
				],
				{ signal: ctx.signal },
			)
			.catch(() => null)

		if (choice === "file" || choice === "node") setEditState({ id: entry.id, target: choice })
	}

	const [toolbar, setToolbar] = createSignal<HTMLDivElement>()
	const [controls, setControls] = createSignal<HTMLDivElement>()
	const [actions, setActions] = createSignal<HTMLDivElement>()
	const [wrap, setWrap] = createSignal(false)

	const fit = () => {
		const bar = toolbar()
		const middle = controls()
		const end = actions()

		if (!bar || !middle || !end) return
		const name = bar.querySelector<HTMLElement>(".figma-name")
		const title = bar.querySelector<HTMLElement>(".figma-file")
		const style = getComputedStyle(bar)
		const gap = parseFloat(style.columnGap) || 0
		const room = bar.clientWidth - parseFloat(style.paddingInlineStart) - parseFloat(style.paddingInlineEnd)
		const margin = name ? parseFloat(getComputedStyle(name).marginInlineEnd) || 0 : 0
		const needed = (title?.scrollWidth ?? 0) + margin + gap + middle.offsetWidth + gap + end.offsetWidth
		setWrap(needed > room)
	}

	createKeyed(
		() => {
			const bar = toolbar()
			const middle = controls()
			const end = actions()

			return bar && middle && end ? [bar, middle, end] : undefined
		},
		(elements) => {
			const observer = new ResizeObserver(() => fit())

			for (const element of elements) observer.observe(element)
			onCleanup(() => observer.disconnect())
		},
	)

	createKeyed(
		() => {
			const base = toolbarKey(url(), updatedAt())

			return base && `${base}\n${title()}\n${node() ?? ""}\n${editing() ?? ""}`
		},
		() => {
			const handle = requestAnimationFrame(fit)
			onCleanup(() => cancelAnimationFrame(handle))
		},
	)

	const shared = () => file()?.shared === true
	const scope = (): View => (!!url() && hasNode(url()) && file()?.view !== "file" ? "node" : "file")
	const dev = () => !!url() && supportsDev(url()) && devAccess() !== false && !!file()?.dev
	const setScope = (value: View) => update({ view: value })

	const annotateKeys = () => {
		const keys = ctx.keybinds.keybind(`${ctx.id}.annotate`)

		return keys.length ? [...keys] : undefined
	}

	const [processing, setProcessing] = createSignal(false)

	const stop = () => {
		if (!processing()) setStill(undefined)
	}

	const shoot = async (area: Area, size: { width: number; height: number }) => {
		const image = still()!
		const ratio = await view.scale(key(), { signal: ctx.signal }).catch(() => null)

		if (!ratio) return crop(image, area, size)

		const design = {
			width: Math.max(1, Math.round(area.width / ratio)),
			height: Math.max(1, Math.round(area.height / ratio)),
		}

		if ((await density(image, size)) * ratio >= 1) return crop(image, area, size, design)
		setProcessing(true)

		try {
			return await view.capture({ key: key(), area }, { signal: ctx.signal })
		} catch {
			return crop(image, area, size)
		} finally {
			setProcessing(false)
		}
	}

	const annotate = async () => {
		const id = embedId()

		if (!id) return
		const image = await ctx.embeds.capture(id)

		if (!image) {
			ctx.toast.show({
				title: ctx.t("annotate.failed"),
				description: ctx.t("annotate.nocapture"),
				variant: "error",
			})

			return
		}

		setStill(image)
	}

	createKeyed(
		() => (key() && props.annotateRequest() === key() ? key() : undefined),
		() => {
			props.clearAnnotateRequest()

			if (still()) stop()
			else void annotate()
		},
	)

	createKeyed(
		() => {
			const id = embedId()
			const target = key()

			return id && target ? { id, target } : undefined
		},
		(current) => {
			setUpdatedAt(undefined)
			let cancelled = false
			onCleanup(() => {
				cancelled = true
			})
			void (async () => {
				for (let attempt = 0; attempt < 20 && !cancelled; attempt++) {
					const value = await view.updated(current.target, { signal: ctx.signal }).catch(() => null)

					if (cancelled) return

					if (value) return setUpdatedAt(value)
					await new Promise((resolve) => window.setTimeout(resolve, 1000))
				}
			})()
		},
		{
			equals: (a, b) => a.id === b.id && a.target === b.target,
			otherwise: () => setUpdatedAt(undefined),
		},
	)

	let accessKey = ""

	createKeyed(
		() => ({ target: key(), current: url(), id: embedId(), visible: frame.visible(), version: accessVersion() }),
		(state) => {
			const identity = JSON.stringify([state.target, state.current])

			if (identity !== accessKey) {
				accessKey = identity
				setDevAccess(null)
			}

			if (!state.id || !state.current || !supportsDev(state.current) || !state.visible) return
			let cancelled = false

			const check = async () => {
				const value = await view.devAccess(state.target, { signal: ctx.signal }).catch(() => null)

				if (cancelled || value === null) return

				if (value === false && file()?.dev) update({ dev: false })
				setDevAccess(value)
			}

			void check()
			const timer = window.setInterval(() => void check(), 30_000)
			onCleanup(() => {
				cancelled = true
				window.clearInterval(timer)
			})
		},
		{
			equals: (a, b) =>
				a.target === b.target &&
				a.current === b.current &&
				a.id === b.id &&
				a.visible === b.visible &&
				a.version === b.version,
		},
	)

	createKeyed(
		() => {
			const id = embedId()
			const node = url() ? nodeId(url()) : undefined
			const target = key()

			return id && node && target ? { id, node, target } : undefined
		},
		(current) => {
			setNodeName(undefined)
			let cancelled = false
			onCleanup(() => {
				cancelled = true
			})
			void (async () => {
				for (let attempt = 0; attempt < 20 && !cancelled; attempt++) {
					const name = await view
						.node({ key: current.target, id: current.node }, { signal: ctx.signal })
						.catch(() => null)

					if (cancelled) return

					if (name) return setNodeName(name)
					await new Promise((resolve) => window.setTimeout(resolve, 1000))
				}
			})()
		},
		{
			equals: (a, b) => a.id === b.id && a.node === b.node && a.target === b.target,
			otherwise: () => setNodeName(undefined),
		},
	)

	let attached = ""

	createKeyed(
		() => ({
			current: url(),
			target: key(),
			options: { view: scope(), dev: dev(), theme: ctx.appearance.mode() },
			visible: frame.visible(),
		}),
		(state) => {
			const signature = JSON.stringify([state.target, state.current, state.options])

			if (signature === attached && !state.visible) return

			if (signature !== attached) {
				setEmbedId(undefined)
				setStill(undefined)
				attached = signature
			}

			if (!state.current) return

			if (ctx.app.platform !== "desktop") return setError(ctx.t("error.unavailable"))
			view
				.attach({ key: state.target, url: state.current, ...state.options }, { signal: ctx.signal })
				.then((id) => {
					if (attached !== signature) return
					setError(undefined)
					setEmbedId(id)
				})
				.catch((cause) => {
					if (attached === signature) setError(cause instanceof Error ? cause.message : String(cause))
				})
		},
		{
			equals: (a, b) =>
				a.current === b.current &&
				a.target === b.target &&
				a.options.view === b.options.view &&
				a.options.dev === b.options.dev &&
				a.options.theme === b.options.theme &&
				a.visible === b.visible,
		},
	)

	return (
		<Show
			when={url()}
			fallback={
				<Show when={loaded()}>
					<Launcher session={props.session} open={(link) => props.open(props.session, link)} logo={FigmaLogo} />
				</Show>
			}
		>
			<div class="figma-panel" ref={setPanel}>
				<div class="figma-toolbar" ref={setToolbar} data-wrap={wrap() ? "" : undefined}>
					<span class="figma-name" onContextMenu={(event) => void nameMenu(event)}>
						<Show
							when={editing() !== "file"}
							fallback={
								<TitleInput
									class="figma-file"
									value={title()}
									label={ctx.t("toolbar.rename.file")}
									done={(value) => save("file", value)}
								/>
							}
						>
							<Show when={updatedAt()} fallback={<span class="figma-file">{title()}</span>}>
								<ctx.ui.Tooltip value={`${ctx.t("toolbar.updated")} ${formatTime(updatedAt()!)}`}>
									<span class="figma-file">{title()}</span>
								</ctx.ui.Tooltip>
							</Show>
						</Show>
						<Show when={scope() === "node" && (node() || editing() === "node")}>
							<Show
								when={editing() !== "node"}
								fallback={
									<TitleInput
										class="figma-node"
										value={node() ?? ""}
										label={ctx.t("toolbar.rename.node")}
										done={(value) => save("node", value)}
									/>
								}
							>
								<span class="figma-node">{node()}</span>
							</Show>
						</Show>
					</span>
					<span class="figma-break" />
					<div class="figma-controls" ref={setControls}>
						<ctx.ui.Tooltip value={ctx.t(shared() ? "toolbar.unshare" : "toolbar.share")}>
							<ctx.ui.IconButton
								icon={shared() ? "outline-eye" : "outline-eye-slash"}
								variant="neutral"
								class="figma-toggle"
								label={ctx.t("toolbar.share")}
								pressed={shared()}
								onClick={() => update({ shared: !shared() })}
							/>
						</ctx.ui.Tooltip>
						<Show when={supportsDev(url())}>
							<ctx.ui.Tooltip value={ctx.t(devAccess() === false ? "toolbar.dev.unavailable" : "toolbar.dev")}>
								<ctx.ui.IconButton
									icon="code-slash"
									variant="neutral"
									class="figma-toggle"
									label={ctx.t("toolbar.dev")}
									pressed={dev()}
									disabled={devAccess() === false}
									onClick={() => {
										if (devAccess() !== false) update({ dev: !dev() })
									}}
								/>
							</ctx.ui.Tooltip>
						</Show>
						<span class="figma-menu">
							<ctx.ui.Menu
								trigger={narrow() ? "icon" : "button"}
								label={ctx.t(scope() === "node" ? "view.node" : "view.file")}
								icon={scope() === "node" ? "window-analytics" : "file-document"}
								placement="bottom-start"
								items={[
									...(hasNode(url())
										? [
												{
													type: "group" as const,
													label: ctx.t("toolbar.view"),
													items: [
														{
															label: ctx.t("view.node"),
															icon: "window-analytics" as const,
															onSelect: () => setScope("node"),
														},
														{
															label: ctx.t("view.file"),
															icon: "file-document" as const,
															onSelect: () => setScope("file"),
														},
													],
												},
												{ type: "separator" as const },
											]
										: []),
									...(mobile() && files().length > 1
										? [
												{
													type: "group" as const,
													label: ctx.t("toolbar.files"),
													items: files().map((entry) => ({
														label: fileTitle(history(), entry.url),
														icon: entry.id === file()?.id ? ("check" as const) : ("file-document" as const),
														onSelect: () => props.setPicked(viewKey(props.session.key, entry.id)),
													})),
												},
												{ type: "separator" as const },
											]
										: []),
									{
										label: ctx.t("toolbar.add"),
										icon: "plus",
										onSelect: () => props.choose(props.session),
									},
									{
										label: ctx.t("toolbar.remove"),
										icon: "trash",
										onSelect: () => props.remove(props.session, file()!.id),
									},
								]}
							/>
						</span>
					</div>
					<div class="figma-actions" ref={setActions}>
						<ctx.ui.Tooltip value={ctx.t("toolbar.annotate")} keys={annotateKeys()}>
							<ctx.ui.IconButton
								icon="outline-browser-annotate"
								variant="ghost"
								label={ctx.t("toolbar.annotate")}
								pressed={!!still()}
								disabled={!embedId()}
								onClick={() => (still() ? stop() : void annotate())}
							/>
						</ctx.ui.Tooltip>
						<ctx.ui.Tooltip value={ctx.t("toolbar.reload")}>
							<ctx.ui.IconButton
								icon="refresh"
								variant="ghost"
								label={ctx.t("toolbar.reload")}
								onClick={() =>
									void view.reload(key(), { signal: ctx.signal }).then(() => setAccessVersion((value) => value + 1))
								}
							/>
						</ctx.ui.Tooltip>
						<ctx.ui.Tooltip value={ctx.t("toolbar.external")}>
							<ctx.ui.IconButton
								icon="square-arrow-top-right"
								variant="ghost"
								label={ctx.t("toolbar.external")}
								onClick={() => ctx.system.openExternal(figmaUrl(url(), { view: scope(), dev: dev() }))}
							/>
						</ctx.ui.Tooltip>
					</div>
				</div>
				<Show when={!error()} fallback={<div class="figma-empty">{error()}</div>}>
					<div class="figma-stage">
						<ctx.embeds.View id={embedId()} page={url()} visible frozen={!!still()} radius={8} class="figma-view" />
						<Show when={still()}>
							<AnnotateLayer
								subject={[title(), scope() === "node" ? node() : undefined].filter(Boolean).join(" › ")}
								onCancel={stop}
								onSubmit={async (area, size, comment, send) => {
									try {
										await props.attach(props.session, await shoot(area, size), comment, send)
										stop()
									} catch (cause) {
										const message = cause instanceof Error ? cause.message : String(cause)
										ctx.toast.show({
											title: ctx.t("annotate.failed"),
											description: /no method|unavailable/.test(message) ? ctx.t("error.stale") : message,
											variant: "error",
										})
									}
								}}
							/>
						</Show>
					</div>
				</Show>
				<Show when={processing()}>
					<div class="figma-processing" role="status">
						<ctx.ui.Loader size="large" />
						<span>{ctx.t("annotate.processing")}</span>
					</div>
				</Show>
			</div>
		</Show>
	)
}

export const setup: Plugin.Setup<typeof definition> = (ctx: Ctx) => {
	const [annotateRequest, setAnnotateRequest] = createSignal<string>()
	const [picked, setPicked] = createSignal<string>()

	const tabKey = (id: string) => `${ctx.id}:${id}`
	const files = (session: SessionRef) => ctx.stores.file(session).value?.files ?? []
	const entryName = (entry: FigmaEntry) => fileTitle(ctx.stores.history.value.files, entry.url)

	ctx.add(Style, css + lineCommentCss)

	const change = (session: SessionRef, next: (files: readonly FigmaEntry[]) => readonly FigmaEntry[]) => {
		const store = ctx.stores.file(session)

		if (!store.value) return
		store.set({
			files: next(store.value.files).map((entry) => ({ ...entry })),
		})
	}

	const update = (session: SessionRef, id: string, patch: Partial<Omit<FigmaEntry, "id">>) =>
		change(session, (list) => list.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)))

	const tabs = new Map<string, PanelTab>()

	const tab = (session: SessionRef, id: string): PanelTab => {
		const cached = tabs.get(viewKey(session.key, id))

		if (cached) return cached

		const name = (ref: SessionRef) => {
			const entry = files(ref).find((file) => file.id === id)

			return entry ? entryName(entry) : ctx.t("title")
		}

		const created: PanelTab = {
			id,
			get title() {
				return name(session)
			},
			label: (state) => (
				<span class="figma-tab">
					<FigmaLogo />
					<span>{name(state.session)}</span>
				</span>
			),
			closable: "compact",
		}

		tabs.set(viewKey(session.key, id), created)

		return created
	}

	const launcher: PanelTab = {
		id: LAUNCHER_TAB_ID,
		get title() {
			return ctx.t("launcher.tab")
		},
		label: () => (
			<span class="figma-tab">
				<FigmaLogo />
				<span>{ctx.t("launcher.tab")}</span>
			</span>
		),
		closable: "compact",
		transient: true,
	}

	const placeholderTabs = new Map<string, PanelTab>()

	const placeholder = (id: string): PanelTab => {
		const cached = placeholderTabs.get(id)

		if (cached) return cached

		const created: PanelTab = {
			id,
			get title() {
				return ctx.t("title")
			},
			hidden: true,
		}

		placeholderTabs.set(id, created)

		return created
	}

	createKeyed(
		() => {
			const session = ctx.sessions.current()

			if (!session || session.server.id !== "sidecar") return undefined
			const value = ctx.stores.file(session).value

			if (!value) return undefined

			return {
				sessionID: session.id,
				files: value.files.map((file) => ({
					url: file.url,
					shared: file.shared === true,
				})),
			}
		},
		(input) => {
			void ctx.client
				.rpc(Figma)
				.set(input)
				.catch(() => {})
		},
		{
			equals: (a, b) => JSON.stringify(a) === JSON.stringify(b),
		},
	)

	const saveArea = async (session: MountedSession, png: string) => {
		const client = session.server.client
		const info = await client.server.info({ signal: ctx.signal })
		const name = `annotation-${new Date().toISOString().replace(/[:.]/g, "-")}.png`

		const written = await client.file.write(
			{
				location: { directory: session.directory },
				path: `${info.paths.tmp}/opencode-figma/${session.id}/${name}`,
				payload: Uint8Array.from(atob(png), (char) => char.charCodeAt(0)),
			},
			{ signal: ctx.signal },
		)

		return written.data.path
	}

	const attachArea = async (session: MountedSession, png: string, comment: string, send: boolean) => {
		const screen = ctx.screen.current()

		if (!screen || ctx.sessions.current()?.key !== session.key) throw new Error(ctx.t("annotate.nosession"))
		const path = await saveArea(session, png)

		if (send) {
			await session.server.client.session.prompt({
				sessionID: session.id,
				text: comment,
				files: [{ uri: fileUri(path), name: path.split(/[\\/]/).pop() }],
			})
			ctx.toast.show({
				title: ctx.t("annotate.sent"),
				variant: "success",
				icon: ICON,
			})

			return
		}

		screen.composer.attach({
			type: "file",
			path: screen.file.resolve(path),
			commentID: `${ctx.id}:area:${Date.now()}`,
			comment: comment || undefined,
		})
		ctx.toast.show({
			title: ctx.t("annotate.done"),
			variant: "success",
			icon: ICON,
		})
	}

	const show = (session: SessionRef, id: string) => {
		setPicked(viewKey(session.key, id))
		ctx.layout.open(tabKey(id), session, { tab: "select" })
	}

	const embed = (session: SessionRef, raw: string) => {
		const link = parseFigmaUrl(raw)

		if (!link) {
			void ctx.dialogs.alert({
				title: ctx.t("invalid.title"),
				description: ctx.t("invalid.description"),
			})

			return false
		}

		const history = ctx.stores.history
		history.set({ files: visit(history.value.files, link.url, new Date().toISOString()) })
		const list = files(session)
		const existing = list.find((file) => file.url === link.url)

		if (existing) {
			show(session, existing.id)

			return true
		}

		const last = list.at(-1)
		const id = `file-${crypto.randomUUID().slice(0, 8)}`
		change(session, (current) => [...current, { id, url: link.url, shared: last?.shared, dev: link.dev || last?.dev }])
		show(session, id)

		return true
	}

	const choose = async (session: SessionRef) => {
		if (!ctx.layout.narrow()) return ctx.layout.open(tabKey(LAUNCHER_TAB_ID), session, { tab: "select" })

		const raw = await ctx.dialogs.prompt({
			title: ctx.t("prompt.title"),
			description: ctx.t("prompt.description"),
			placeholder: "https://www.figma.com/design/…",
			submit: ctx.t("prompt.submit"),
		})

		if (raw) embed(session, raw)
	}

	const pick = (session: SessionRef, raw: string) => {
		if (!embed(session, raw)) return

		if (ctx.layout.state(tabKey(LAUNCHER_TAB_ID), session) !== "closed")
			ctx.layout.close(tabKey(LAUNCHER_TAB_ID), session)
	}

	ctx.add(LinkHandler, {
		priority: 10,
		match: (link) => !!parseFigmaUrl(link.href) && !!(link.session ?? ctx.sessions.current()),
		exists: () => true,
		open: (link) => {
			const session = link.session ?? ctx.sessions.current()

			if (session) embed(session, link.href)
		},
	})

	createKeyed(
		() => ctx.client,
		(client) => {
			onCleanup(
				client.rpc(Figma).events.on("open", (event) => {
					const session = ctx.sessions.list().find((item) => item.id === event.data.sessionID)

					if (session) embed(session, event.data.url)
				}),
			)
		},
	)

	const forget = (session: SessionRef, id: string) => {
		if (!files(session).some((file) => file.id === id)) return
		change(session, (list) => list.filter((file) => file.id !== id))
		tabs.delete(viewKey(session.key, id))

		if (ctx.app.platform === "desktop")
			void ctx
				.main(FigmaView)
				.release(viewKey(session.key, id))
				.catch(() => {})
	}

	const remove = (session: SessionRef, id: string) => {
		if (ctx.layout.state(tabKey(id), session) === "closed") return forget(session, id)
		ctx.layout.close(tabKey(id), session)
	}

	const focused = (session: SessionRef) => {
		const ids = files(session).map((file) => file.id)
		const state = (id: string) => ctx.layout.state(tabKey(id), session)

		return (
			ids.find((id) => state(id) === "visible") ??
			ids.find((id) => state(id) === "active") ??
			ctx.layout.stored(session).find((id) => ids.includes(id))
		)
	}

	ctx.add(Panel, {
		id: "file",
		region: "side",
		wide: true,
		mobile: {
			get title() {
				return ctx.t("title")
			},
			order: 60,
			kind: "menu",
			icon: ICON,
		},
		list: (input) => {
			const loaded = !!ctx.stores.file(input.session).value
			const ids = new Set(files(input.session).map((file) => file.id))

			return input.open.flatMap((id) => {
				if (id === LAUNCHER_TAB_ID) return [launcher]

				if (!loaded) return [placeholder(id)]

				return ids.has(id) ? [tab(input.session, id)] : []
			})
		},
		render: (props) => (
			<Show
				when={props.tab.id !== LAUNCHER_TAB_ID}
				fallback={<Launcher session={props.session} open={(link) => pick(props.session, link)} logo={FigmaLogo} />}
			>
				<FigmaPane
					session={props.session}
					tab={props.tab}
					picked={picked}
					setPicked={setPicked}
					annotateRequest={annotateRequest}
					clearAnnotateRequest={() => setAnnotateRequest(undefined)}
					choose={choose}
					open={pick}
					update={update}
					remove={remove}
					attach={attachArea}
				/>
			</Show>
		),
		close: (props) => forget(props.session, props.tab.id),
		closed: (props) => {
			const file = files(props.session).find((entry) => entry.id === props.tab.id)

			if (!file) return false

			return {
				title: entryName(file),
				detail: ctx.t("title"),
				data: JSON.stringify(file),
			}
		},
		restore: (input) => {
			if (!input.data) return
			const parsed = decodeStoredEntry(input.data)

			if (Option.isNone(parsed)) return
			const file = parsed.value

			if (!files(input.session).some((entry) => entry.id === file.id)) change(input.session, (list) => [...list, file])
			show(input.session, file.id)
		},
	})

	ctx.add(Command, (): Command => ({
		id: "open",
		title: ctx.t("command.open"),
		keywords: "figma design embed",
		slash: { name: "figma", arguments: true },
		enabled: !!ctx.sessions.current(),
		run: (input) => {
			const session = ctx.sessions.current()

			if (!session) return

			if (input?.trim()) embed(session, input)
			else void choose(session)
		},
	}))

	ctx.add(Command, (): Command => ({
		id: "toggle",
		title: ctx.t("command.toggle"),
		bind: "mod+alt+f",
		enabled: !!ctx.sessions.current(),
		run: () => {
			const session = ctx.sessions.current()

			if (!session) return

			if (ctx.layout.state(tabKey(LAUNCHER_TAB_ID), session) === "visible")
				return ctx.layout.hide(tabKey(LAUNCHER_TAB_ID), session)
			const id = focused(session)

			if (id && ctx.layout.state(tabKey(id), session) === "visible") return ctx.layout.hide(tabKey(id), session)

			if (id) return show(session, id)
			const list = files(session)

			if (!list.length) return void choose(session)

			for (const file of list) ctx.layout.open(tabKey(file.id), session, { tab: "append" })
			show(session, list[0].id)
		},
	}))

	ctx.add(Command, (): Command => {
		const session = ctx.sessions.current()

		return {
			id: "annotate",
			title: ctx.t("command.annotate"),
			keywords: "figma annotate select area screenshot",
			bind: "mod+alt+a",
			enabled: !!session && files(session).length > 0,
			run: () => {
				if (!session) return
				const id = focused(session) ?? files(session)[0]?.id

				if (!id) return
				show(session, id)
				setAnnotateRequest(viewKey(session.key, id))
			},
		}
	})

	ctx.add(MenuItem, (): MenuItem => {
		const session = ctx.sessions.current()

		return {
			menu: "session.panel",
			id: "open",
			order: 50,
			title: ctx.t("menu.open"),
			icon: ICON,
			keybind: `${ctx.id}.toggle`,
			opened: !!session && ctx.layout.state(tabKey(LAUNCHER_TAB_ID), session) !== "closed",
			run: () => {
				if (session) void choose(session)
			},
		}
	})

	ctx.add(SettingsPage, {
		id: "figma",
		icon: ICON,
		get title() {
			return ctx.t("settings.title")
		},
		get entries() {
			return [
				{
					id: "figma-token",
					title: ctx.t("settings.token.title"),
					description: ctx.t("settings.token.description"),
					keywords: "figma api key token personal access",
				},
				{
					id: "figma-node-names",
					title: ctx.t("settings.nodeNames.title"),
					description: ctx.t("settings.nodeNames.description"),
					keywords: "figma node name api rate limit",
				},
			]
		},
		render: () => <FigmaSettings />,
	})
}
