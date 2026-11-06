import { createSignal, For, Show, type JSX } from "solid-js"
import { createKeyed, createLatest, usePanel, usePlugin, type MountedSession } from "@opencode/plugin/gui"
import { FigmaAccount, FigmaView, INVALID_TEAM, type Listing } from "./contract"
import type { definition } from "./definition"
import { embedUrl, fileKey, fileName, hasNode } from "./url"

const MAX_SHOWN_FILES = 5

const units: [Intl.RelativeTimeFormatUnit, number][] = [
	["year", 365 * 24 * 3600],
	["month", 30 * 24 * 3600],
	["week", 7 * 24 * 3600],
	["day", 24 * 3600],
	["hour", 3600],
	["minute", 60],
]

const ago = (iso: string | null) => {
	if (!iso) return ""
	const seconds = (new Date(iso).getTime() - Date.now()) / 1000

	if (Number.isNaN(seconds)) return ""
	const format = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" })

	for (const [unit, size] of units) {
		if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit)
	}

	return format.format(0, "minute")
}

export function Launcher(props: { session: MountedSession; open: (url: string) => void; logo: () => JSX.Element }) {
	const ctx = usePlugin<typeof definition>()
	const frame = usePanel()
	const account = ctx.main(FigmaAccount)
	const view = ctx.main(FigmaView)
	const [link, setLink] = createSignal("")
	const desktop = ctx.app.platform === "desktop"

	const openedFileKeys = () =>
		new Set((ctx.stores.file(props.session).value?.files ?? []).map((file) => fileKey(file.url)))

	const unopened = (list: readonly Listing[] | null | undefined) =>
		(list ?? []).filter((file) => !openedFileKeys().has(fileKey(file.url))).slice(0, MAX_SHOWN_FILES)

	const recent = createLatest(
		() => (desktop && frame.visible() ? {} : undefined),
		(_key, signal) => account.recent({ signal }).catch(() => null),
	)

	const recents = () => unopened(recent.latest)
	const fallback = () => !recent.loading && recents().length === 0

	const active = createLatest(
		() => (frame.visible() ? {} : undefined),
		(_key, signal) => view.active({ signal }).catch((): readonly string[] => []),
	)

	const others = () => {
		const seen = new Set<string | undefined>()

		const list = (active.latest ?? []).flatMap((url) => {
			const key = fileKey(url)

			if (seen.has(key)) return []
			seen.add(key)

			return [{ url, name: fileName(url), time: null }]
		})

		return unopened(list)
	}

	const history = () => {
		const activeFileKeys = new Set((active.latest ?? []).map(fileKey))

		const list = ctx.stores.history.value.files
			.filter((file) => !activeFileKeys.has(fileKey(file.url)))
			.map((file) => ({
				url: file.url,
				name: fileName(file.url),
				time: file.time,
			}))

		return unopened(list)
	}

	const state = () => account.state()
	const connected = () => !!state()?.user
	const team = () => state()?.teams.find((entry) => entry.id === state()?.team)
	const [discovering, setDiscovering] = createSignal(false)

	createKeyed(
		() => fallback() && frame.visible() && connected(),
		() => {
			setDiscovering(true)
			void account
				.discover({ signal: ctx.signal })
				.catch(() => {})
				.finally(() => setDiscovering(false))
		},
	)

	const edited = createLatest(
		() => (fallback() && frame.visible() && connected() ? team()?.id : undefined),
		(id, signal) => account.edited(id, { signal }),
	)

	const addTeam = async () => {
		const raw = await ctx.dialogs.prompt({
			title: ctx.t("team.prompt.title"),
			description: ctx.t("team.prompt.description"),
			placeholder: "https://www.figma.com/files/…/team/…",
			submit: ctx.t("team.prompt.submit"),
		})

		if (!raw) return
		await account.addTeam(raw, { signal: ctx.signal }).catch((cause) => {
			const message = cause instanceof Error ? cause.message : String(cause)
			ctx.toast.show({
				title: ctx.t("team.failed"),
				description: message.includes(INVALID_TEAM) ? ctx.t("team.invalid") : message,
				variant: "error",
			})
		})
	}

	const manageTeams = () =>
		ctx.dialogs.open(() => (
			<ctx.ui.Dialog
				title={ctx.t("team.manage")}
				footer={
					<ctx.ui.Button icon="plus" variant="neutral" onClick={() => void addTeam()}>
						{ctx.t("team.add")}
					</ctx.ui.Button>
				}
			>
				<Show
					when={(state()?.teams.length ?? 0) > 0}
					fallback={<div class="figma-launcher-note">{ctx.t("team.none")}</div>}
				>
					<div class="figma-teams">
						<For each={state()?.teams}>
							{(entry) => (
								<div class="figma-team">
									<ctx.ui.Icon name="folder" />
									<span class="figma-launcher-name">{entry.name}</span>
									<ctx.ui.IconButton
										icon="outline-trash"
										size="small"
										label={ctx.t("team.remove", { name: entry.name })}
										onClick={() => void account.removeTeam(entry.id, { signal: ctx.signal }).catch(() => {})}
									/>
								</div>
							)}
						</For>
					</div>
				</Show>
			</ctx.ui.Dialog>
		))

	const submit = () => {
		const value = link().trim()

		if (!value) return
		setLink("")
		props.open(value)
	}

	const copy = (text: string) =>
		ctx.system
			.copy(text)
			.then(() => ctx.toast.show({ title: ctx.t("launcher.copied"), variant: "success" }))
			.catch(() => {})

	const historyMenu = async (file: Listing) => {
		const choice = await view
			.menu(
				[
					{ id: "figma", label: ctx.t("launcher.copy.figma") },
					{ id: "embed", label: ctx.t("launcher.copy.embed") },
					null,
					{ id: "remove", label: ctx.t("launcher.remove") },
				],
				{ signal: ctx.signal },
			)
			.catch(() => null)

		if (choice === "figma") return copy(file.url)

		if (choice === "embed")
			return copy(
				embedUrl(file.url, {
					view: hasNode(file.url) ? "node" : "file",
					dev: false,
					theme: ctx.appearance.mode(),
				}),
			)

		if (choice === "remove") {
			const historyStore = ctx.stores.history
			historyStore.set({
				files: historyStore.value.files.filter((entry) => fileKey(entry.url) !== fileKey(file.url)),
			})
		}
	}

	const Rows = (list: { files: readonly Listing[]; menu?: (file: Listing) => void }) => (
		<For each={list.files}>
			{(file) => (
				<button
					type="button"
					class="figma-launcher-row"
					onClick={() => props.open(file.url)}
					onContextMenu={(event) => {
						if (!list.menu) return
						event.preventDefault()
						list.menu(file)
					}}
				>
					{props.logo()}
					<span class="figma-launcher-name">{file.name}</span>
					<span class="figma-launcher-time">{ago(file.time)}</span>
				</button>
			)}
		</For>
	)

	return (
		<div class="figma-launcher">
			<h2 class="figma-launcher-title">{ctx.t("launcher.title")}</h2>
			<div class="figma-launcher-paste">
				<ctx.ui.TextInput
					type="url"
					size="large"
					label={ctx.t("launcher.paste")}
					placeholder={ctx.t("launcher.paste")}
					value={link()}
					onInput={setLink}
					onSubmit={submit}
					autofocus
				/>
				<ctx.ui.Button size="large" variant="neutral" disabled={!link().trim()} onClick={submit}>
					{ctx.t("prompt.submit")}
				</ctx.ui.Button>
			</div>
			<Show when={desktop}>
				<Show when={!recent.loading} fallback={<ctx.ui.Loader size="small" />}>
					<Show when={recents().length > 0}>
						<section class="figma-launcher-section">
							<div class="figma-launcher-heading">
								<h3>{ctx.t("launcher.recent")}</h3>
							</div>
							<Rows files={recents()} />
						</section>
					</Show>
					<Show when={fallback() && others().length > 0}>
						<section class="figma-launcher-section">
							<div class="figma-launcher-heading">
								<h3>{ctx.t("launcher.active")}</h3>
							</div>
							<Rows files={others()} />
						</section>
					</Show>
					<Show when={history().length > 0}>
						<section class="figma-launcher-section">
							<div class="figma-launcher-heading">
								<h3>{ctx.t("launcher.opened")}</h3>
							</div>
							<Rows files={history()} menu={historyMenu} />
						</section>
					</Show>
					<Show when={fallback()}>
						<section class="figma-launcher-section">
							<div class="figma-launcher-heading">
								<h3>{ctx.t("launcher.edited")}</h3>
								<Show when={connected() && (state()?.teams.length ?? 0) > 0}>
									<ctx.ui.Menu
										trigger="button"
										label={team()?.name ?? ctx.t("team.label")}
										icon="folder"
										placement="bottom-end"
										items={[
											...((state()?.teams.length ?? 0) > 0
												? [
														{
															type: "group" as const,
															label: ctx.t("team.label"),
															items: (state()?.teams ?? []).map((entry) => ({
																label: entry.name,
																icon: entry.id === team()?.id ? ("check" as const) : ("folder" as const),
																onSelect: () =>
																	void account.selectTeam(entry.id, { signal: ctx.signal }).catch(() => {}),
															})),
														},
														{ type: "separator" as const },
													]
												: []),
											{
												label: ctx.t("team.manage"),
												icon: "settings-gear",
												onSelect: manageTeams,
											},
										]}
									/>
								</Show>
							</div>
							<Show
								when={connected()}
								fallback={
									<div class="figma-launcher-note">
										<span>{ctx.t("launcher.nokey")}</span>
										<ctx.ui.Button size="small" variant="neutral" onClick={() => ctx.layout.settings("figma")}>
											{ctx.t("launcher.settings")}
										</ctx.ui.Button>
									</div>
								}
							>
								<Show
									when={team()}
									fallback={
										<Show when={!discovering()} fallback={<ctx.ui.Loader size="small" />}>
											<div class="figma-launcher-note">
												<span>{ctx.t("launcher.noteam")}</span>
												<ctx.ui.Button size="small" variant="neutral" onClick={() => void addTeam()}>
													{ctx.t("team.add")}
												</ctx.ui.Button>
											</div>
										</Show>
									}
								>
									<Show
										when={!edited.error}
										fallback={
											<div class="figma-launcher-note">
												{edited.error instanceof Error ? edited.error.message : String(edited.error)}
											</div>
										}
									>
										<Show when={!edited.loading || edited.latest} fallback={<ctx.ui.Loader size="small" />}>
											<Show
												when={unopened(edited.latest).length > 0}
												fallback={<div class="figma-launcher-note">{ctx.t("launcher.none")}</div>}
											>
												<Rows files={unopened(edited.latest)} />
											</Show>
										</Show>
									</Show>
								</Show>
							</Show>
						</section>
					</Show>
				</Show>
			</Show>
		</div>
	)
}
