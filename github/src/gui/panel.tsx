import { createMemo, createSignal, For, Match, onCleanup, Show, Switch, type JSX } from "solid-js"
import {
	createKeyed,
	usePlugin,
	type IconName,
	type MountedSession,
	type SessionScreen,
	type UiMenuEntry,
	type UiMenuItem,
} from "@opencode/plugin/gui"
import {
	HIDE_REASONS,
	type Attachment,
	type Author,
	type CheckState,
	type Comment,
	type CommentAction,
	type Commit,
	type CreateDraft,
	type CreateOptions,
	type Label,
	type Pull,
	type Review,
	type Reviewer,
	type Source,
	type Status,
	type Thread,
} from "../types"
import type { definition } from "./definition"
import { GitHubBody, toggleTask } from "./body"
import { layout, type GraphRow } from "./graph"
import { Picker } from "./picker"
import { describe, type Ctx, type State, type View } from "./state"
import type { Sync } from "../git"

interface Props {
	ctx: Ctx
	state: State
	source: Source
	scope: string
	session?: MountedSession
	screen?: SessionScreen
	external?: boolean
}

export const STATE_ICON: Record<Pull["state"], IconName> = {
	open: "branch-out",
	draft: "branch-out",
	merged: "branch",
	closed: "circle-ban-sign",
}

export const CHECK_ICON: Record<CheckState, IconName> = {
	success: "circle-check",
	failure: "circle-x",
	pending: "outline-steer",
	neutral: "circle-ban-sign",
}

export function CheckIcon(props: { ctx: Ctx; state: CheckState; size?: "small" | "normal"; tab?: boolean }) {
	const px = () => (props.size === "small" ? 16 : 20)

	return (
		<Switch
			fallback={
				<props.ctx.ui.Icon name={CHECK_ICON[props.state]} size={props.size} class={`ghp-tone-${props.state}`} />
			}
		>
			<Match when={props.state === "success" && !props.tab}>
				<svg
					class="ghp-check-passed"
					width={px()}
					height={px()}
					viewBox="-0.5 -0.5 17 17"
					fill="currentColor"
					aria-hidden="true"
				>
					<path d="M8 16A8 8 0 1 1 8 0a8 8 0 0 1 0 16Zm3.78-9.72a.751.751 0 0 0-.018-1.042.751.751 0 0 0-1.042-.018L6.75 9.19 5.28 7.72a.751.751 0 0 0-1.042.018.751.751 0 0 0-.018 1.042l2 2a.75.75 0 0 0 1.06 0Z" />
				</svg>
			</Match>
			<Match when={props.state === "pending"}>
				<svg class="ghp-running" width={px()} height={px()} viewBox="0 0 16 16" aria-hidden="true">
					<circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" stroke-width="2" opacity="0.3" />
					<path
						class="ghp-running-arc"
						d="M8 1.5a6.5 6.5 0 0 1 6.5 6.5"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
					/>
					<circle cx="8" cy="8" r="3.5" fill="currentColor" />
				</svg>
			</Match>
		</Switch>
	)
}

export function PullPanel(props: Props) {
	const ui = props.ctx.ui
	const status = () => props.state.get(props.source)
	const loading = () => props.state.loading(props.source)
	const directory = () => ("directory" in props.source ? props.source.directory : undefined)
	const creating = () => (directory() ? props.state.creating(props.scope) : undefined)

	return (
		<div class="ghp" data-mode={props.ctx.appearance.mode()}>
			<Switch
				fallback={
					<div class="ghp-center">
						<ui.Loader size="large" />
					</div>
				}
			>
				<Match when={status()?.repo && status()?.branch ? creating() : undefined} keyed>
					{(draft) => <CreatePull {...props} directory={directory()!} status={status()!} draft={draft} />}
				</Match>
				<Match when={status()?.pull}>
					{(pull) => <PullView {...props} pull={pull()} status={status()!} loading={loading()} />}
				</Match>
				<Match when={status()?.error}>
					{(error) => (
						<Blank
							icon={error().type === "auth" ? "lock" : "github"}
							title={props.ctx.t(`error.${error().type}`)}
							description={
								<>
									<p class="ghp-mono">{error().message}</p>
									<Show when={error().type === "auth"}>
										<p>{props.ctx.t("error.auth.hint")}</p>
									</Show>
								</>
							}
						>
							<Show when={error().type === "auth"}>
								<ui.Button onClick={() => props.ctx.layout.settings("github")}>
									{props.ctx.t("settings.open")}
								</ui.Button>
							</Show>
							<ui.Button icon="refresh" busy={loading()} onClick={() => void props.state.refresh(props.source, true)}>
								{props.ctx.t("retry")}
							</ui.Button>
						</Blank>
					)}
				</Match>
				<Match when={status()}>{(value) => <NoPull {...props} status={value()} loading={loading()} />}</Match>
			</Switch>
		</div>
	)
}

function Blank(props: { icon: IconName; title: string; description?: JSX.Element; children?: JSX.Element }) {
	const ctx = usePlugin<typeof definition>()

	return (
		<div class="ghp-blank">
			<div class="ghp-blank-icon">
				<ctx.ui.Icon name={props.icon} size="large" />
			</div>
			<h3>{props.title}</h3>
			<Show when={props.description}>
				<div class="ghp-blank-text">{props.description}</div>
			</Show>
			<Show when={props.children}>
				<div class="ghp-blank-actions">{props.children}</div>
			</Show>
		</div>
	)
}

function NoPull(props: Props & { status: Status; loading: boolean }) {
	const t = props.ctx.t
	const repo = () => props.status.repo
	const suggestion = () => props.status.suggestion
	const onBase = () => props.status.branch === repo()?.base

	return (
		<Blank
			icon="branch-out"
			title={t("empty.title", { branch: props.status.branch ?? "" })}
			description={
				<Switch>
					<Match when={onBase()}>{t("empty.base")}</Match>
					<Match when={suggestion() && suggestion()!.ahead > 0}>
						{props.ctx.plural("empty.ahead", suggestion()!.ahead, {
							base: repo()?.base ?? "",
						})}
					</Match>
					<Match when={true}>{t("empty.none", { base: repo()?.base ?? "" })}</Match>
				</Switch>
			}
		>
			<Show when={!onBase()}>
				<props.ctx.ui.Button variant="contrast" icon="plus" onClick={() => props.state.setCreating(props.scope, {})}>
					{t("empty.create")}
				</props.ctx.ui.Button>
			</Show>
			<props.ctx.ui.IconButton
				icon="refresh"
				variant="ghost"
				label={t("refresh")}
				busy={props.loading}
				onClick={() => void props.state.refresh(props.source, true)}
			/>
		</Blank>
	)
}

function CreatePull(props: Props & { directory: string; status: Status; draft: CreateDraft }) {
	const ui = props.ctx.ui
	const t = props.ctx.t
	const directory = props.directory
	const source = { directory }
	const status = props.status
	const repo = status.repo!
	const [title, setTitle] = createSignal(props.draft.title ?? status.suggestion?.title ?? "")
	const [body, setBody] = createSignal(props.draft.body ?? status.suggestion?.body ?? "")
	const [base, setBase] = createSignal(props.draft.base ?? repo.base)
	const [draft, setDraft] = createSignal(props.draft.draft ?? false)
	const [reviewers, setReviewers] = createSignal<string[]>(props.draft.reviewers ? [...props.draft.reviewers] : [])
	const [labels, setLabels] = createSignal<string[]>(props.draft.labels ? [...props.draft.labels] : [])

	const [attachments, setAttachments] = createSignal<Attachment[]>(
		props.draft.attachments ? [...props.draft.attachments] : [],
	)

	const [busy, setBusy] = createSignal(false)
	const [error, setError] = createSignal<string>()
	const valid = () => !!title().trim() && !!base().trim()

	const [choices, setChoices] = createSignal<CreateOptions>()
	const [choicesError, setChoicesError] = createSignal<string>()
	props.state.options(source).then(setChoices, (cause: unknown) => setChoicesError(describe(cause)))

	const [history, setHistory] = createSignal<{
		base: string
		commits?: readonly Commit[]
		error?: string
	}>()

	createKeyed(base, (current) => {
		setHistory({ base: current })
		props.state.history(directory, current).then(
			(commits) => history()?.base === current && setHistory({ base: current, commits }),
			(cause: unknown) => history()?.base === current && setHistory({ base: current, error: describe(cause) }),
		)
	})

	const branches = () => {
		const list = choices()?.branches ?? []
		const all = list.includes(base()) ? list : [base(), ...list]

		return all.filter((name) => name !== status.branch)
	}

	const reviewerList = () => choices()?.reviewers ?? []
	const labelList = () => choices()?.labels ?? []
	const author = (login: string): Author => reviewerList().find((item) => item.login === login) ?? { login }
	const label = (name: string): Label => labelList().find((item) => item.name === name) ?? { name, color: "8b949e" }

	const close = () => props.state.setCreating(props.scope, undefined)

	const submit = async () => {
		if (!valid() || busy()) return
		setBusy(true)
		setError(undefined)

		try {
			const next = await props.state.mutate(source, (api) =>
				api.create({
					directory,
					title: title().trim(),
					body: body(),
					base: base().trim(),
					draft: draft(),
					reviewers: reviewers(),
					labels: labels(),
					attachments: attachments(),
				}),
			)

			close()
			props.state.setView(props.scope, "conversation")
			props.ctx.toast.show({
				variant: "success",
				title: t("create.done"),
				description: next.pull ? `#${next.pull.number} ${next.pull.title}` : undefined,
				actions: next.pull
					? [
							{
								label: t("open.github"),
								run: () => props.ctx.system.openExternal(next.pull!.url),
							},
						]
					: [],
			})
		} catch (cause) {
			setError(describe(cause))
			void props.state.refresh(source, true)
		} finally {
			setBusy(false)
		}
	}

	return (
		<form
			class="ghp-create"
			onSubmit={(event) => {
				event.preventDefault()
				void submit()
			}}
			onKeyDown={(event) => {
				if (event.key === "Escape" && !busy() && !event.defaultPrevented) {
					event.stopPropagation()
					close()
				}
			}}
		>
			<header class="ghp-header ghp-create-header">
				<div class="ghp-title-row">
					<h2 class="ghp-title">{t("create.title")}</h2>
				</div>
				<div class="ghp-branches">
					<Picker
						ctx={props.ctx}
						label={t("create.field.base")}
						items={branches()}
						key={(name) => name}
						text={(name) => name}
						row={(name) => (
							<span class="ghp-picker-label ghp-mono">
								{name}
								<Show when={name === repo.base}>
									<span class="ghp-chip">{t("create.default")}</span>
								</Show>
							</span>
						)}
						selected={[base()]}
						onChange={([name]) => name && setBase(name)}
						loading={!choices() && !choicesError()}
						empty={choicesError() ?? t("picker.none")}
						trigger={(toggle, expanded) => (
							<button
								type="button"
								class="ghp-branch-button"
								aria-label={t("create.field.base")}
								aria-haspopup="listbox"
								aria-expanded={expanded}
								onClick={toggle}
							>
								<ui.Icon name="branch-out" size="small" />
								<span class="ghp-mono">{base()}</span>
								<ui.Icon name="chevron-down" size="small" />
							</button>
						)}
					/>
					<span class="ghp-weak" aria-hidden="true">
						←
					</span>
					<code class="ghp-ref">{status.branch}</code>
				</div>
				<Show when={!status.pushed}>
					<div class="ghp-stats ghp-create-stats">
						<span class="ghp-chip">
							<ui.Icon name="cloud-upload" size="small" />
							{t("create.pushChip", { remote: "origin" })}
						</span>
					</div>
				</Show>
			</header>

			<div class="ghp-body">
				<div class="ghp-create-fields">
					<label class="ghp-field">
						<span>{t("create.field.title")}</span>
						<input
							class="ghp-input ghp-input-title"
							value={title()}
							placeholder={t("create.field.title")}
							ref={(element) => queueMicrotask(() => element.focus())}
							onInput={(event) => setTitle(event.currentTarget.value)}
							onKeyDown={(event) => {
								if (event.key === "Enter" && !event.isComposing) {
									event.preventDefault()
									void submit()
								}
							}}
						/>
					</label>
					<div class="ghp-field">
						<span>{t("create.field.body")}</span>
						<MarkdownField
							ctx={props.ctx}
							class="ghp-compose-tall"
							value={body()}
							onValue={setBody}
							placeholder={t("compose.placeholder")}
							preview={{
								base: repo.url,
								render: (text) => props.state.markdown(source, text),
							}}
							onSubmit={() => void submit()}
						/>
						<Show when={attachments().length}>
							<ul class="ghp-attachments" aria-label={t("create.attachments")}>
								<For each={attachments()}>
									{(item) => (
										<li class="ghp-attachment" title={item.path}>
											<ui.Icon
												name={/\.(mp4|mov|webm)$/i.test(item.name) ? "outline-video" : "outline-photo"}
												size="small"
											/>
											<span class="ghp-attachment-name">{item.name}</span>
											<ui.IconButton
												icon="close-small"
												size="small"
												variant="ghost-muted"
												label={t("create.remove", { name: item.name })}
												onClick={() => setAttachments(attachments().filter((other) => other.path !== item.path))}
											/>
										</li>
									)}
								</For>
							</ul>
							<p class="ghp-weak ghp-attachments-hint">{t("create.attachments.hint")}</p>
						</Show>
					</div>

					<div class="ghp-meta-grid">
						<section class="ghp-meta-field">
							<div class="ghp-meta-head">
								<span>{t("create.field.reviewers")}</span>
							</div>
							<Show when={reviewers().length} fallback={<span class="ghp-weak">{t("create.none.reviewers")}</span>}>
								<ul class="ghp-meta-list">
									<For each={reviewers()}>
										{(login) => (
											<li class="ghp-person" title={login}>
												<Avatar author={author(login)} size={20} />
												<span class="ghp-person-text">
													<span>{author(login).name ?? login}</span>
													<Show when={author(login).name}>
														<span class="ghp-weak">{login}</span>
													</Show>
												</span>
												<ui.IconButton
													icon="close-small"
													size="small"
													variant="ghost-muted"
													class="ghp-remove"
													label={t("create.remove", {
														name: author(login).name ?? login,
													})}
													onClick={() => setReviewers(reviewers().filter((item) => item !== login))}
												/>
											</li>
										)}
									</For>
								</ul>
							</Show>
							<Picker
								ctx={props.ctx}
								multiple
								label={t("create.pick.reviewers")}
								items={reviewerList()}
								key={(item) => item.login}
								text={(item) => `${item.login} ${item.name ?? ""}`}
								row={(item) => (
									<span class="ghp-picker-label">
										<Avatar author={item} size={18} />
										<span class="ghp-person-text">
											<strong>{item.name ?? item.login}</strong>
											<Show when={item.name}>
												<span class="ghp-weak">{item.login}</span>
											</Show>
										</span>
									</span>
								)}
								selected={reviewers()}
								onChange={setReviewers}
								loading={!choices() && !choicesError()}
								empty={choicesError() ?? t("picker.none")}
								trigger={(toggle) => (
									<ui.Button
										size="small"
										variant="ghost"
										icon={reviewers().length ? "edit" : "plus-small"}
										onClick={toggle}
									>
										{reviewers().length ? t("create.edit.reviewers") : t("create.add.reviewers")}
									</ui.Button>
								)}
							/>
						</section>

						<section class="ghp-meta-field">
							<div class="ghp-meta-head">
								<span>{t("create.field.labels")}</span>
							</div>
							<Show when={labels().length} fallback={<span class="ghp-weak">{t("create.none.labels")}</span>}>
								<ul class="ghp-meta-list ghp-meta-list-wrap">
									<For each={labels()}>
										{(name) => (
											<LabelPill
												label={label(name)}
												remove={t("create.remove", { name })}
												onRemove={() => setLabels(labels().filter((item) => item !== name))}
											/>
										)}
									</For>
								</ul>
							</Show>
							<Picker
								ctx={props.ctx}
								multiple
								label={t("create.pick.labels")}
								items={labelList()}
								key={(item) => item.name}
								text={(item) => `${item.name} ${item.description ?? ""}`}
								row={(item) => (
									<span class="ghp-picker-label ghp-picker-label-stack">
										<span class="ghp-label-row">
											<span class="ghp-label-dot" style={{ background: `#${item.color}` }} />
											{item.name}
										</span>
										<Show when={item.description}>
											<span class="ghp-weak ghp-picker-description">{item.description}</span>
										</Show>
									</span>
								)}
								selected={labels()}
								onChange={setLabels}
								loading={!choices() && !choicesError()}
								empty={choicesError() ?? t("picker.none")}
								trigger={(toggle) => (
									<ui.Button
										size="small"
										variant="ghost"
										icon={labels().length ? "edit" : "plus-small"}
										onClick={toggle}
									>
										{labels().length ? t("create.edit.labels") : t("create.add.labels")}
									</ui.Button>
								)}
							/>
						</section>
					</div>
				</div>

				<section class="ghp-create-history">
					<h3 class="ghp-section-title">
						<Switch fallback={t("create.history")}>
							<Match when={history()?.commits}>
								{(commits) =>
									props.ctx.plural("create.history.count", commits().length, {
										base: base(),
									})
								}
							</Match>
						</Switch>
					</h3>
					<Switch
						fallback={
							<div class="ghp-center ghp-history-state">
								<ui.Loader />
							</div>
						}
					>
						<Match when={history()?.error}>{(message) => <p class="ghp-error">{message()}</p>}</Match>
						<Match when={history()?.commits?.length === 0}>
							<p class="ghp-weak ghp-history-state">{t("empty.none", { base: base() })}</p>
						</Match>
						<Match when={history()?.commits}>{(commits) => <CommitGraph ctx={props.ctx} commits={commits()} />}</Match>
					</Switch>
				</section>
			</div>

			<footer class="ghp-create-footer">
				<Show when={error()}>
					<p class="ghp-error">{error()}</p>
				</Show>
				<div class="ghp-create-actions">
					<ui.Switch label={t("create.field.draft")} checked={draft()} onChange={setDraft} />
					<span class="ghp-spacer" />
					<ui.Button variant="ghost" onClick={close} disabled={busy()}>
						{t("compose.cancel")}
					</ui.Button>
					<ui.Button variant="contrast" busy={busy()} disabled={!valid()} onClick={() => void submit()}>
						{draft() ? t("create.submitDraft") : t("create.submit")}
					</ui.Button>
				</div>
			</footer>
		</form>
	)
}

function LabelPill(props: { label: Label; remove: string; onRemove?: () => void }) {
	return (
		<li class="ghp-label" title={props.label.description} style={{ "--ghp-label-color": `#${props.label.color}` }}>
			{props.label.name}
			<Show when={props.onRemove}>
				{(remove) => (
					<button
						type="button"
						class="ghp-label-remove"
						aria-label={props.remove}
						title={props.remove}
						onClick={remove()}
					>
						×
					</button>
				)}
			</Show>
		</li>
	)
}

function PullView(props: Props & { pull: Pull; status: Status; loading: boolean }) {
	const ui = props.ctx.ui
	const t = props.ctx.t
	const view = () => props.state.view(props.scope)
	const setView = (next: View) => props.state.setView(props.scope, next)
	let nav: HTMLElement | undefined
	let body: HTMLDivElement | undefined
	const [compact, setCompact] = createSignal(false)

	let initialized = false

	createKeyed(view, () => {
		const first = !initialized
		initialized = true

		if (!first) {
			if (body) body.scrollTop = 0
			setCompact(false)
		}

		const tab = nav?.querySelector<HTMLElement>('[aria-selected="true"]')

		if (!nav || !tab) return
		const inset = 8
		const left = tab.offsetLeft - inset
		const right = tab.offsetLeft + tab.offsetWidth + inset - nav.clientWidth
		const target = nav.scrollLeft > left ? left : nav.scrollLeft < right ? right : undefined

		if (target === undefined) return
		const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches
		nav.scrollTo({
			left: target,
			behavior: first || reduced ? "auto" : "smooth",
		})
	})

	const failing = () => props.pull.checks.list.filter((check) => check.state === "failure").length

	const mergeReady = () =>
		props.pull.state === "open" &&
		props.pull.review === "APPROVED" &&
		props.pull.checks.state === "success" &&
		props.pull.mergeable === "MERGEABLE"

	const [merging, setMerging] = createSignal(false)

	const merge = async () => {
		const source = props.source
		setMerging(true)

		try {
			await props.state.mutate(source, (api) => api.merge(source))
			props.ctx.toast.show({ variant: "success", title: t("merge.done") })
		} catch (cause) {
			props.ctx.toast.show({ variant: "error", title: t("merge.failed"), description: describe(cause) })
		} finally {
			setMerging(false)
		}
	}

	const tabs = (): {
		id: View
		count?: number
		tone?: CheckState
	}[] => [
		{ id: "conversation", count: props.pull.counts.comments },
		{ id: "commits", count: props.pull.commitTotal },
		{
			id: "checks",
			count: failing() || props.pull.checks.list.length,
			tone: props.pull.checks.state,
		},
		{ id: "details" },
	]

	const onScroll = () => {
		if (!body) return
		const top = body.scrollTop

		if (!compact() && top > 32 && body.scrollHeight - body.clientHeight > 160) setCompact(true)
		else if (compact() && top < 4) setCompact(false)
	}

	const expand = () => {
		if (!body) return setCompact(false)
		const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches
		body.scrollTo({ top: 0, behavior: reduced ? "auto" : "smooth" })
	}

	return (
		<>
			<header class="ghp-header" data-compact={compact() ? "" : undefined}>
				<div class="ghp-title-row">
					<span class={`ghp-compact-state ghp-state-${props.pull.state}`} aria-hidden="true">
						<props.ctx.ui.Icon name={STATE_ICON[props.pull.state]} size="small" />
					</span>
					<h2 class="ghp-title" title={compact() ? props.pull.title : undefined} onClick={() => compact() && expand()}>
						<span>{props.pull.title}</span> <span class="ghp-number">#{props.pull.number}</span>
					</h2>
					<span class="ghp-compact-stats" aria-hidden="true">
						<span class="ghp-add">+{props.pull.additions}</span>
						<span class="ghp-del">−{props.pull.deletions}</span>
					</span>
					<div class="ghp-actions">
						<ui.Tooltip value={t("refresh")}>
							<ui.IconButton
								icon="refresh"
								variant="ghost"
								size="small"
								label={t("refresh")}
								busy={props.loading}
								onClick={() => void props.state.refresh(props.source, true)}
							/>
						</ui.Tooltip>
						<Show when={props.external !== false}>
							<ui.Tooltip value={t("open.github")}>
								<ui.IconButton
									icon="square-arrow-top-right"
									variant="ghost"
									size="small"
									class="ghp-external"
									label={t("open.github")}
									onClick={() => props.ctx.system.openExternal(props.pull.url)}
								/>
							</ui.Tooltip>
						</Show>
					</div>
				</div>
				<div class="ghp-collapsible" inert={compact()}>
					<div>
						<div class="ghp-meta">
							<StateLabel ctx={props.ctx} state={props.pull.state} />
							<span class="ghp-summary">
								<code class="ghp-ref">{props.pull.base}</code> ← <code class="ghp-ref">{props.pull.head}</code>
							</span>
							<Show when={mergeReady()}>
								<span class="ghp-spacer" />
								<ui.Button size="small" variant="contrast" icon="branch" busy={merging()} onClick={() => void merge()}>
									{t("merge")}
								</ui.Button>
							</Show>
						</div>
						<div class="ghp-stats">
							<span class="ghp-add">+{props.pull.additions}</span>
							<span class="ghp-del">−{props.pull.deletions}</span>
							<span class="ghp-weak">{props.ctx.plural("files", props.pull.files)}</span>
							<Show when={props.pull.reviewers.length}>
								<button
									type="button"
									class="ghp-faces"
									title={props.pull.reviewers
										.map((item) => `${item.author.name ?? item.author.login} · ${t(`reviewer.${item.state}`)}`)
										.join("\n")}
									onClick={() => setView("details")}
								>
									<For each={props.pull.reviewers.slice(0, 5)}>
										{(item) => (
											<span class={`ghp-face ghp-face-${item.state.toLowerCase()}`}>
												<Avatar author={item.author} size={18} />
											</span>
										)}
									</For>
									<Show when={props.pull.reviewers.length > 5}>
										<span class="ghp-weak">+{props.pull.reviewers.length - 5}</span>
									</Show>
								</button>
							</Show>
						</div>
					</div>
				</div>
				<nav class="ghp-tabs" role="tablist" ref={nav}>
					<For each={tabs()}>
						{(tab) => (
							<button
								type="button"
								role="tab"
								class="ghp-tab"
								classList={{
									"ghp-tab-failing": tab.id === "checks" && failing() > 0,
								}}
								aria-selected={view() === tab.id}
								title={
									tab.id === "checks" && failing() > 0 ? props.ctx.plural("pill.checks.failure", failing()) : undefined
								}
								onClick={() => setView(tab.id)}
							>
								<Show when={tab.tone}>
									{(tone) => (
										<Show
											when={tone() === "success"}
											fallback={<CheckIcon ctx={props.ctx} state={tone()} size="small" tab />}
										>
											<svg
												class="ghp-tone-success ghp-tab-checklist"
												width="14"
												height="14"
												viewBox="0 0 16 16"
												fill="none"
												stroke="currentColor"
												stroke-width="1.25"
												stroke-linecap="round"
												stroke-linejoin="round"
												aria-hidden="true"
											>
												<path d="M5.92 14.25H2.75a1 1 0 0 1-1-1V1.75a1 1 0 0 1 1-1h8.5a1 1 0 0 1 1 1v7.74M8.75 13.25l1.94 1.95 4.56-4.45M4.75 4.75h4.5M4.75 7.75h2" />
											</svg>
										</Show>
									)}
								</Show>
								{t(`tab.${tab.id}`)}
								<Show when={tab.count !== undefined}>
									<span class="ghp-counter">{tab.count}</span>
								</Show>
							</button>
						)}
					</For>
				</nav>
			</header>
			<div class="ghp-body" ref={body} onScroll={onScroll}>
				<Switch>
					<Match when={view() === "conversation"}>
						<Conversation {...props} />
					</Match>
					<Match when={view() === "commits"}>
						<Commits {...props} />
					</Match>
					<Match when={view() === "checks"}>
						<Checks {...props} />
					</Match>
					<Match when={view() === "details"}>
						<Details {...props} />
					</Match>
				</Switch>
			</div>
		</>
	)
}

function Details(props: Props & { pull: Pull }) {
	const ui = props.ctx.ui
	const t = props.ctx.t
	const sync = () => props.pull.sync
	const conflicting = () => props.pull.mergeable === "CONFLICTING"
	const [updating, setUpdating] = createSignal(false)

	const update = async () => {
		const source = props.source
		let result: Sync | undefined
		setUpdating(true)

		try {
			await props.state.mutate(source, (api) =>
				api.update(source).then((output) => {
					result = output.sync

					return output.status
				}),
			)
			props.ctx.toast.show(
				result === "synced"
					? {
							variant: "success",
							title: t("sync.done.synced", { base: props.pull.base }),
						}
					: {
							variant: "success",
							title: t("sync.done.remote"),
							description: "directory" in source ? t(`sync.pull.${result ?? "pending"}`) : undefined,
						},
			)
		} catch (cause) {
			props.ctx.toast.show({
				variant: "error",
				title: t("sync.failed"),
				description: describe(cause),
			})
		} finally {
			setUpdating(false)
		}
	}

	return (
		<div class="ghp-details">
			<Reviewers {...props} />
			<Show when={props.pull.review}>
				{(review) => (
					<section class="ghp-detail">
						<h3 class="ghp-detail-title">{t("details.status")}</h3>
						<div class="ghp-detail-value">
							<span class={`ghp-chip ghp-review-${review().toLowerCase()}`}>{t(`review.${review()}`)}</span>
						</div>
					</section>
				)}
			</Show>
			<Labels {...props} />
			<Show when={sync()?.behind || conflicting()}>
				<section class="ghp-detail">
					<h3 class="ghp-detail-title">{t("details.branch")}</h3>
					<div class="ghp-detail-value">
						<div class="ghp-meta-list">
							<Show when={sync()?.behind}>
								{(behind) => (
									<span class="ghp-sync">
										<span class="ghp-sync-icon">
											<ui.Icon name="outline-dots" size="small" />
										</span>
										{props.ctx.plural("sync.behind", behind(), {
											base: props.pull.base,
										})}
									</span>
								)}
							</Show>
							<Show when={conflicting()}>
								<span class="ghp-sync ghp-conflict">
									<span class="ghp-sync-icon">
										<ui.Icon name="outline-hexagonal-warning" size="small" />
									</span>
									{t("mergeable.CONFLICTING")}
								</span>
							</Show>
							<Show when={sync()?.behind && !conflicting()}>
								<ui.Button
									size="small"
									variant="neutral"
									icon="refresh"
									busy={updating()}
									onClick={() => void update()}
								>
									{t("sync.update")}
								</ui.Button>
							</Show>
						</div>
					</div>
				</section>
			</Show>
		</div>
	)
}

function StateLabel(props: { ctx: Ctx; state: Pull["state"] }) {
	return (
		<span class={`ghp-state ghp-state-${props.state}`}>
			<props.ctx.ui.Icon name={STATE_ICON[props.state]} size="small" />
			{props.ctx.t(`state.${props.state}`)}
		</span>
	)
}

const REVIEW_STATE: Record<Reviewer["state"], { icon: IconName; tone?: CheckState }> = {
	REQUESTED: { icon: "outline-dots" },
	APPROVED: { icon: "check", tone: "success" },
	CHANGES_REQUESTED: { icon: "circle-x", tone: "failure" },
	COMMENTED: { icon: "speech-bubble" },
	DISMISSED: { icon: "circle-ban-sign" },
}

function createDebouncedDraft(saved: () => string[], save: (next: string[]) => Promise<void>) {
	const [draft, setDraft] = createSignal<string[]>()
	const [saving, setSaving] = createSignal(false)
	let timer: ReturnType<typeof setTimeout> | undefined
	onCleanup(() => clearTimeout(timer))

	const flush = async () => {
		const next = draft()

		if (!next) return
		setSaving(true)

		try {
			await save(next)
		} finally {
			setSaving(false)

			if (draft() === next) setDraft(undefined)
		}
	}

	return {
		value: () => draft() ?? saved(),
		saving,
		change: (next: string[]) => {
			setDraft(next)
			clearTimeout(timer)
			timer = setTimeout(() => void flush(), 600)
		},
	}
}

function Reviewers(props: Props & { pull: Pull }) {
	const ui = props.ctx.ui
	const t = props.ctx.t
	const [approving, setApproving] = createSignal(false)
	const [choices, setChoices] = createSignal<readonly Author[]>()
	const [choicesError, setChoicesError] = createSignal<string>()
	const editable = () => props.pull.state === "open" || props.pull.state === "draft"
	const assigned = () => props.pull.reviewers.map((item) => item.author.login)
	const candidates = () => (choices() ?? []).filter((item) => item.login !== props.pull.author.login)

	const draft = createDebouncedDraft(assigned, async (next) => {
		const add = next.filter((login) => !assigned().includes(login))

		const remove = props.pull.reviewers
			.filter((item) => item.state === "REQUESTED" && !item.team && !next.includes(item.author.login))
			.map((item) => item.author.login)

		if (!add.length && !remove.length) return

		try {
			await props.state.mutate(props.source, (api) => api.request({ ...props.source, reviewers: add, remove }))
		} catch (cause) {
			props.ctx.toast.show({
				variant: "error",
				title: t("reviewers.failed"),
				description: describe(cause),
			})
		}
	})

	const shown = () => {
		const known = props.pull.reviewers.filter(
			(item) => draft.value().includes(item.author.login) || item.state !== "REQUESTED",
		)

		const added = draft
			.value()
			.filter((login) => !assigned().includes(login))
			.map((login): Reviewer => ({
				author: choices()?.find((item) => item.login === login) ?? { login },
				state: "REQUESTED",
			}))

		return [...known, ...added]
	}

	const approve = async () => {
		setApproving(true)

		try {
			await props.state.mutate(props.source, (api) => api.approve(props.source))
		} catch (cause) {
			props.ctx.toast.show({
				variant: "error",
				title: t("approve.failed"),
				description: describe(cause),
			})
		} finally {
			setApproving(false)
		}
	}

	const load = () => {
		if (choices() || choicesError()) return
		props.state.options(props.source).then(
			(options) => setChoices(options.reviewers),
			(cause: unknown) => setChoicesError(describe(cause)),
		)
	}

	return (
		<section class="ghp-meta-field">
			<div class="ghp-meta-head">
				<span>{t("create.field.reviewers")}</span>
				<Switch>
					<Match when={props.pull.approval === "available"}>
						<ui.Button size="small" variant="neutral" icon="check" busy={approving()} onClick={() => void approve()}>
							{t("approve")}
						</ui.Button>
					</Match>
				</Switch>
			</div>
			<Show when={shown().length} fallback={<span class="ghp-weak">{t("create.none.reviewers")}</span>}>
				<ul class="ghp-meta-list">
					<For each={shown()}>
						{(item) => (
							<li class="ghp-person" title={`${item.author.login} · ${t(`reviewer.${item.state}`)}`}>
								<span class="ghp-reviewer-face">
									<Avatar author={item.author} size={20} />
									<Show when={item.state !== "COMMENTED"}>
										<span class={`ghp-reviewer-badge ghp-reviewer-${item.state.toLowerCase()}`}>
											<ui.Icon name={REVIEW_STATE[item.state].icon} size="small" />
										</span>
									</Show>
								</span>
								<span class="ghp-person-text">
									<span>{item.author.name ?? item.author.login}</span>
									<Show when={item.author.name}>
										<span class="ghp-weak">{item.author.login}</span>
									</Show>
								</span>
								<Show when={editable() && item.state === "REQUESTED" && !item.team}>
									<ui.IconButton
										icon="close-small"
										size="small"
										variant="ghost-muted"
										class="ghp-remove"
										label={t("create.remove", {
											name: item.author.name ?? item.author.login,
										})}
										onClick={() => draft.change(draft.value().filter((login) => login !== item.author.login))}
									/>
								</Show>
							</li>
						)}
					</For>
				</ul>
			</Show>
			<Show when={editable()}>
				<Picker
					ctx={props.ctx}
					multiple
					label={t("create.pick.reviewers")}
					items={candidates()}
					key={(item) => item.login}
					text={(item) => `${item.login} ${item.name ?? ""}`}
					row={(item) => (
						<span class="ghp-picker-label">
							<Avatar author={item} size={18} />
							<span class="ghp-person-text">
								<strong>{item.name ?? item.login}</strong>
								<Show when={item.name}>
									<span class="ghp-weak">{item.login}</span>
								</Show>
							</span>
						</span>
					)}
					selected={draft.value()}
					onChange={draft.change}
					loading={!choices() && !choicesError()}
					empty={choicesError() ?? t("picker.none")}
					trigger={(toggle) => (
						<ui.Button
							size="small"
							variant="ghost"
							icon={shown().length ? "edit" : "plus-small"}
							busy={draft.saving()}
							onClick={() => {
								load()
								toggle()
							}}
						>
							{shown().length ? t("create.edit.reviewers") : t("create.add.reviewers")}
						</ui.Button>
					)}
				/>
			</Show>
		</section>
	)
}

function Labels(props: Props & { pull: Pull }) {
	const ui = props.ctx.ui
	const t = props.ctx.t
	const [choices, setChoices] = createSignal<readonly Label[]>()
	const [choicesError, setChoicesError] = createSignal<string>()
	const editable = () => props.pull.viewer.update

	const label = (name: string): Label =>
		props.pull.labels.find((item) => item.name === name) ??
		choices()?.find((item) => item.name === name) ?? { name, color: "8c959f" }

	const draft = createDebouncedDraft(
		() => props.pull.labels.map((item) => item.name),
		async (next) => {
			try {
				await props.state.mutate(props.source, (api) => api.labels({ ...props.source, labels: next }))
			} catch (cause) {
				props.ctx.toast.show({
					variant: "error",
					title: t("details.labels.failed"),
					description: describe(cause),
				})
			}
		},
	)

	const load = () => {
		if (choices() || choicesError()) return
		props.state.options(props.source).then(
			(options) => setChoices(options.labels),
			(cause: unknown) => setChoicesError(describe(cause)),
		)
	}

	return (
		<section class="ghp-meta-field">
			<div class="ghp-meta-head">
				<span>{t("create.field.labels")}</span>
			</div>
			<Show when={draft.value().length} fallback={<span class="ghp-weak">{t("create.none.labels")}</span>}>
				<ul class="ghp-meta-list ghp-meta-list-wrap">
					<For each={draft.value()}>
						{(name) => (
							<LabelPill
								label={label(name)}
								remove={t("create.remove", { name })}
								onRemove={editable() ? () => draft.change(draft.value().filter((item) => item !== name)) : undefined}
							/>
						)}
					</For>
				</ul>
			</Show>
			<Show when={editable()}>
				<Picker
					ctx={props.ctx}
					multiple
					label={t("create.pick.labels")}
					items={choices() ?? []}
					key={(item) => item.name}
					text={(item) => `${item.name} ${item.description ?? ""}`}
					row={(item) => (
						<span class="ghp-picker-label ghp-picker-label-stack">
							<span class="ghp-label-row">
								<span class="ghp-label-dot" style={{ background: `#${item.color}` }} />
								{item.name}
							</span>
							<Show when={item.description}>
								<span class="ghp-weak ghp-picker-description">{item.description}</span>
							</Show>
						</span>
					)}
					selected={draft.value()}
					onChange={draft.change}
					loading={!choices() && !choicesError()}
					empty={choicesError() ?? t("picker.none")}
					trigger={(toggle) => (
						<ui.Button
							size="small"
							variant="ghost"
							icon={draft.value().length ? "edit" : "plus-small"}
							busy={draft.saving()}
							onClick={() => {
								load()
								toggle()
							}}
						>
							{draft.value().length ? t("create.edit.labels") : t("create.add.labels")}
						</ui.Button>
					)}
				/>
			</Show>
		</section>
	)
}

export function Avatar(props: { author: Author; size?: number }) {
	const [failed, setFailed] = createSignal(false)
	const size = () => props.size ?? 20

	return (
		<span class="ghp-avatar" style={{ width: `${size()}px`, height: `${size()}px` }}>
			<Show when={props.author.avatar && !failed()} fallback={props.author.login.charAt(0).toUpperCase()}>
				<img src={props.author.avatar} alt="" onError={() => setFailed(true)} />
			</Show>
		</span>
	)
}

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
	["year", 31536000],
	["month", 2592000],
	["week", 604800],
	["day", 86400],
	["hour", 3600],
	["minute", 60],
]

export const useRelative = (ctx: Ctx) => {
	const format = createMemo(() => new Intl.RelativeTimeFormat(ctx.locale.locale(), { numeric: "auto" }))

	const parts = (date: string) => {
		const seconds = (new Date(date).getTime() - Date.now()) / 1000

		for (const [unit, size] of UNITS) {
			if (Math.abs(seconds) < size) continue
			const count = Math.round(seconds / size)

			return {
				long: format().format(count, unit),
				short: ctx.t(`time.short.${unit}`, { count: Math.abs(count) }),
			}
		}

		return { long: ctx.t("time.now"), short: ctx.t("time.short.now") }
	}

	return (date: string): JSX.Element => {
		const time = parts(date)

		return (
			<>
				<span class="ghp-time-long">{time.long}</span>
				<span class="ghp-time-short">{time.short}</span>
			</>
		)
	}
}

type Item = Comment | Review | Thread

const isThread = (item: Item): item is Thread => "path" in item

const isReview = (item: Item): item is Review => "state" in item

const isComment = (item: Item): item is Comment => !isThread(item) && !isReview(item)

const itemDate = (item: Item) => (isThread(item) ? item.comments[0]!.date : item.date)

function Conversation(props: Props & { pull: Pull }) {
	const ui = props.ctx.ui
	const t = props.ctx.t
	const relative = useRelative(props.ctx)

	const items = createMemo<Item[]>(() =>
		[
			...props.pull.comments,
			...props.pull.reviews.filter((review) => review.body.trim() || review.state !== "COMMENTED"),
			...props.pull.threads,
		].sort((a, b) => itemDate(a).localeCompare(itemDate(b))),
	)

	const unresolved = () => props.pull.threads.filter((thread) => !thread.resolved)
	const context = contextActions(props)

	const description = createMemo((): Comment => ({
		id: props.pull.id,
		kind: "pull",
		body: props.pull.body,
		html: props.pull.html,
		author: props.pull.author,
		date: props.pull.created,
		url: props.pull.url,
		viewer: props.pull.viewer,
	}))

	const [draft, setDraft] = createSignal("")
	let box: HTMLTextAreaElement | undefined

	const quoteReply = (comment: Comment) => {
		const current = draft()
		setDraft(`${current && !current.endsWith("\n") ? `${current}\n\n` : current}${quote(comment.body)}`)
		box?.scrollIntoView({ block: "center", behavior: "smooth" })
		box?.focus()
	}

	return (
		<div class="ghp-timeline">
			<CommentCard
				{...props}
				comment={description()}
				label={t("comment.description")}
				relative={relative}
				attached={context.attached(`description-${props.pull.id}`)}
				onContext={() => context.description()}
				onQuote={quoteReply}
			/>
			<For each={items()}>
				{(item) => (
					<Switch>
						<Match when={isComment(item) ? item : undefined}>
							{(comment) => (
								<CommentCard
									{...props}
									comment={comment()}
									relative={relative}
									attached={context.attached(comment().id)}
									onContext={() => context.comment(comment())}
									onQuote={quoteReply}
								/>
							)}
						</Match>
						<Match when={isReview(item) ? item : undefined}>
							{(review) => (
								<ReviewItem {...props} review={review()} relative={relative} context={context} onQuote={quoteReply} />
							)}
						</Match>
						<Match when={isThread(item) ? item : undefined}>
							{(thread) => <ThreadCard {...props} thread={thread()} relative={relative} context={context} />}
						</Match>
					</Switch>
				)}
			</For>
			<Show when={unresolved().length > 0 && context.enabled()}>
				<div class="ghp-toolbar">
					<span class="ghp-weak ghp-unresolved-count">
						{props.ctx.plural("unresolved.threads", unresolved().length)}
					</span>
					<ui.Button
						size="small"
						variant="ghost"
						icon="plus-small"
						onClick={() => unresolved().forEach((thread) => context.thread(thread, { only: true }))}
					>
						{t("context.unresolved")}
					</ui.Button>
				</div>
			</Show>
			<div class="ghp-compose-main">
				<Compose
					ctx={props.ctx}
					placeholder={t("compose.placeholder")}
					submit={t("compose.submit")}
					value={draft}
					onValue={setDraft}
					textarea={(element) => {
						box = element
					}}
					preview={preview(props)}
					onSubmit={async (body) => {
						await props.state.mutate(props.source, (api) => api.reply({ ...props.source, body }))
					}}
				/>
			</div>
		</div>
	)
}

type ContextActions = ReturnType<typeof contextActions>

const contextActions = (props: Props & { pull: Pull }) => {
	const where = () => `GitHub pull request #${props.pull.number} "${props.pull.title}"`
	const id = (raw: string) => `${props.ctx.id}.${raw}`
	const key = (raw: string) => `${props.session?.key}|${id(raw)}`

	const toggle = (
		raw: string,
		note: { label: string; subject: string; comment: string; href: string },
		options: { only?: "add" } = {},
	) => {
		const composer = props.screen?.composer

		if (!composer) return

		if (props.state.attached(key(raw))) {
			if (options.only) return
			composer.detach(id(raw))
			props.state.setAttached(key(raw), false)

			return
		}

		composer.attach(
			composer.quotable()
				? {
						type: "quote",
						commentID: id(raw),
						text: note.comment,
						source: {
							label: note.label,
							icon: "github",
							subject: note.subject,
						},
					}
				: {
						type: "note",
						origin: props.ctx.id,
						commentID: id(raw),
						icon: "github",
						label: note.label,
						subject: `${note.subject}:\n\n${quoteBlock(note.comment)}`,
						comment: "",
						href: note.href,
					},
		)
		props.state.setAttached(key(raw), true)
	}

	const threadPlace = (thread: Thread) => {
		const lines = thread.startLine && thread.line ? `${thread.startLine}-${thread.line}` : `${thread.line ?? "?"}`
		const hunk = thread.hunk ? `\n\nDiff context:\n\`\`\`diff\n${tail(thread.hunk, 12)}\n\`\`\`` : ""

		return {
			lines,
			label: `${basename(thread.path)}:${lines}`,
			text: `${thread.path} line ${lines}`,
			hunk,
		}
	}

	return {
		enabled: () => !!props.screen,
		attached: (raw: string) => props.state.attached(key(raw)),
		description: () =>
			toggle(`description-${props.pull.id}`, {
				label: `#${props.pull.number} description`,
				subject: `the description of ${where()} by @${props.pull.author.login} (${props.pull.url})`,
				comment: props.pull.body || "(empty)",
				href: props.pull.url,
			}),
		comment: (comment: Comment, thread?: Thread) => {
			const place = thread && threadPlace(thread)
			toggle(comment.id, {
				label: place
					? `@${comment.author.login} on ${place.label}`
					: `@${comment.author.login} on #${props.pull.number}`,
				subject: place
					? `a review comment by @${comment.author.login} on ${place.text} in ${where()} (${comment.url})${place.hunk}`
					: `a comment by @${comment.author.login} on ${where()} (${comment.url})`,
				comment: comment.body,
				href: comment.url,
			})
		},
		review: (review: Review) =>
			toggle(review.id, {
				label: `@${review.author.login} review`,
				subject: `a review (${review.state.toLowerCase().replace("_", " ")}) by @${review.author.login} on ${where()} (${review.url})`,
				comment: review.body,
				href: review.url,
			}),
		thread: (thread: Thread, options: { only?: boolean } = {}) => {
			const first = thread.comments[0]!
			const place = threadPlace(thread)
			toggle(
				thread.id,
				{
					label: place.label,
					subject:
						`a ${thread.resolved ? "resolved" : "unresolved"}${thread.outdated ? ", outdated" : ""} review thread on ` +
						`${place.text} in ${where()} (${first.url})${place.hunk}`,
					comment: thread.comments.map((comment) => `@${comment.author.login}: ${comment.body}`).join("\n\n"),
					href: first.url,
				},
				{ only: options.only ? "add" : undefined },
			)
		},
	}
}

const quoteBlock = (text: string) =>
	text
		.trim()
		.split("\n")
		.map((line) => `> ${line}`)
		.join("\n")

const tail = (text: string, count: number) => text.split("\n").slice(-count).join("\n")

const basename = (path: string) => path.split("/").pop() ?? path

function ContextButton(props: { ctx: Ctx; attached: boolean; onClick: () => void; label?: string }) {
	const ui = props.ctx.ui
	const t = props.ctx.t
	const label = () => props.label ?? t(props.attached ? "context.remove" : "context.add")

	return (
		<ui.Tooltip value={label()}>
			<ui.IconButton
				icon={props.attached ? "check-small" : "plus-small"}
				variant="ghost"
				size="small"
				pressed={props.attached}
				label={label()}
				onClick={() => props.onClick()}
			/>
		</ui.Tooltip>
	)
}

type Act = (action: CommentAction) => Promise<Status>

function CommentCard(
	props: Props & {
		pull: Pull
		comment: Comment
		label?: string
		variant?: "card" | "thread"
		relative: (date: string) => JSX.Element
		attached: boolean
		onContext: () => void
		onQuote: (comment: Comment) => void
	},
) {
	const ctx = props.ctx
	const [editing, setEditing] = createSignal(false)
	const [revealed, setRevealed] = createSignal(false)
	const hidden = () => !!props.comment.minimized && !revealed()

	const act: Act = (action) => props.state.mutate(props.source, (api) => api.comment({ ...props.source, ...action }))

	const toggle = async (index: number, checked: boolean) => {
		const body = toggleTask(props.comment.body, index, checked)

		try {
			if (body === undefined) throw new Error(ctx.t("task.missing"))
			await act({
				action: "edit",
				kind: props.comment.kind,
				id: props.comment.id,
				body,
			})
		} catch (cause) {
			ctx.toast.show({
				variant: "error",
				title: ctx.t("task.failed"),
				description: describe(cause),
			})
			throw cause
		}
	}

	const header = (
		<header class="ghp-card-header">
			<Avatar author={props.comment.author} />
			<strong>{props.comment.author.login}</strong>
			<Show when={props.comment.author.bot}>
				<span class="ghp-chip">{ctx.t("bot")}</span>
			</Show>
			<span class="ghp-weak ghp-commented">
				<span class="ghp-commented-label">{ctx.t("commented")} </span>
				<a class="ghp-link" href={props.comment.url} onClick={(event) => openUrl(ctx, event, props.comment.url)}>
					{props.relative(props.comment.date)}
				</a>
			</span>
			<Show when={props.label}>
				<span class="ghp-chip">{props.label}</span>
			</Show>
			<span class="ghp-spacer" />
			<Show when={props.screen}>
				<ContextButton ctx={ctx} attached={props.attached} onClick={props.onContext} />
			</Show>
			<CommentMenu
				ctx={ctx}
				comment={props.comment}
				repo={props.pull.url.replace(/\/pull\/\d+$/, "")}
				act={act}
				onOpen={props.state.danger.arm}
				onQuote={() => props.onQuote(props.comment)}
				onEdit={() => setEditing(true)}
			/>
		</header>
	)

	const body = (
		<Switch>
			<Match when={editing()}>
				<div class="ghp-card-edit">
					<Compose
						ctx={ctx}
						autofocus
						initial={props.comment.body}
						placeholder={ctx.t("compose.placeholder")}
						submit={ctx.t("comment.update")}
						preview={preview(props)}
						onCancel={() => setEditing(false)}
						onSubmit={async (text) => {
							await act({
								action: "edit",
								kind: props.comment.kind,
								id: props.comment.id,
								body: text,
							})
							setEditing(false)
						}}
					/>
				</div>
			</Match>
			<Match when={hidden()}>
				<div class="ghp-hidden">
					<span>
						{ctx.t("comment.hidden", {
							reason: ctx.t(`hide.${props.comment.minimized}`),
						})}
					</span>
					<button type="button" class="ghp-link-button" onClick={() => setRevealed(true)}>
						{ctx.t("comment.show")}
					</button>
				</div>
			</Match>
			<Match when={true}>
				<div class={props.variant === "thread" ? "ghp-thread-body" : "ghp-card-body"}>
					<Show when={props.comment.html.trim()} fallback={<p class="ghp-weak">{ctx.t("comment.empty")}</p>}>
						<GitHubBody
							ctx={ctx}
							html={props.comment.html}
							base={props.comment.url}
							onToggle={props.comment.viewer.update ? toggle : undefined}
						/>
					</Show>
				</div>
			</Match>
		</Switch>
	)

	return (
		<Show
			when={props.variant === "thread"}
			fallback={
				<article class="ghp-card">
					{header}
					{body}
				</article>
			}
		>
			<div class="ghp-thread-comment">
				{header}
				{body}
			</div>
		</Show>
	)
}

const quote = (text: string) =>
	text
		.trim()
		.split("\n")
		.map((line) => (line ? `> ${line}` : ">"))
		.join("\n") + "\n\n"

function CommentMenu(props: {
	ctx: Ctx
	comment: Comment
	repo: string
	act: Act
	onQuote: () => void
	onEdit: () => void
	onOpen: () => void
}) {
	const ctx = props.ctx
	const t = ctx.t

	const run = (task: () => Promise<void>) =>
		void task().catch((cause) => ctx.toast.show({ variant: "error", title: describe(cause) }))

	const hide = async () => {
		const reason = await ctx.dialogs.select({
			title: t("hide.title"),
			options: HIDE_REASONS.map((value) => ({
				title: t(`hide.${value.toLowerCase()}`),
				value,
			})),
		})

		if (reason) await props.act({ action: "hide", id: props.comment.id, reason })
	}

	const remove = async () => {
		const ok = await ctx.dialogs.confirm({
			title: t("delete.title"),
			description: t("delete.description"),
			confirm: t("menu.delete"),
			danger: true,
		})

		if (ok)
			await props.act({
				action: "delete",
				kind: props.comment.kind,
				id: props.comment.id,
			})
	}

	const reference = () => {
		const body = `${quote(props.comment.body)}_Originally posted by @${props.comment.author.login} in ${props.comment.url}_`
		ctx.system.openExternal(`${props.repo}/issues/new?body=${encodeURIComponent(body)}`)
	}

	const items = (): UiMenuEntry[] => {
		const comment = props.comment

		const manage: UiMenuItem[] = [
			...(comment.viewer.update ? [{ label: t("menu.edit"), onSelect: props.onEdit }] : []),
			...(comment.viewer.minimize
				? [
						comment.minimized
							? {
									label: t("menu.unhide"),
									onSelect: () =>
										run(async () => {
											await props.act({ action: "unhide", id: comment.id })
										}),
								}
							: { label: t("menu.hide"), onSelect: () => run(hide) },
					]
				: []),
			...(comment.viewer.delete ? [{ label: t("menu.delete"), onSelect: () => run(remove) }] : []),
		]

		return [
			{
				label: t("menu.copyLink"),
				onSelect: () => void ctx.system.copy(comment.url),
			},
			{
				label: t("menu.copyMarkdown"),
				onSelect: () => void ctx.system.copy(comment.body),
			},
			{ label: t("menu.quote"), onSelect: props.onQuote },
			{ label: t("menu.reference"), onSelect: reference },
			...(manage.length ? [{ type: "separator" as const }, ...manage] : []),
		]
	}

	return (
		<span class="ghp-menu" onPointerDown={props.onOpen} onKeyDown={props.onOpen}>
			<ctx.ui.Menu label={t("menu.label")} items={items()} placement="bottom-end" />
		</span>
	)
}

const openUrl = (ctx: Ctx, event: MouseEvent, url: string) => {
	event.preventDefault()
	ctx.system.openExternal(url)
}

const REVIEW_ICON: Record<Review["state"], IconName> = {
	APPROVED: "circle-check",
	CHANGES_REQUESTED: "circle-exclamation",
	COMMENTED: "speech-bubble",
	DISMISSED: "circle-ban-sign",
	PENDING: "status",
}

function ReviewItem(
	props: Props & {
		pull: Pull
		review: Review
		relative: (date: string) => JSX.Element
		context: ContextActions
		onQuote: (comment: Comment) => void
	},
) {
	const ctx = props.ctx

	return (
		<div class="ghp-review">
			<div class="ghp-event">
				<span class={`ghp-event-badge ghp-event-${props.review.state.toLowerCase()}`}>
					<ctx.ui.Icon name={REVIEW_ICON[props.review.state]} size="small" />
				</span>
				<Avatar author={props.review.author} size={16} />
				<span>
					<strong>{props.review.author.login}</strong> {ctx.t(`event.${props.review.state}`)}
				</span>
				<a class="ghp-weak ghp-link" href={props.review.url} onClick={(event) => openUrl(ctx, event, props.review.url)}>
					{props.relative(props.review.date)}
				</a>
			</div>
			<Show when={props.review.body.trim()}>
				<CommentCard
					{...props}
					comment={props.review}
					attached={props.context.attached(props.review.id)}
					onContext={() => props.context.review(props.review)}
				/>
			</Show>
		</div>
	)
}

function ThreadCard(
	props: Props & {
		pull: Pull
		thread: Thread
		relative: (date: string) => JSX.Element
		context: ContextActions
	},
) {
	const ui = props.ctx.ui
	const t = props.ctx.t
	const [expanded, setExpanded] = createSignal(!props.thread.resolved)
	const [replying, setReplying] = createSignal(false)
	const [reply, setReply] = createSignal("")
	const [resolving, setResolving] = createSignal(false)

	const quoteReply = (comment: Comment) => {
		const current = reply()
		setReply(`${current && !current.endsWith("\n") ? `${current}\n\n` : current}${quote(comment.body)}`)
		setReplying(true)
	}

	const lines = () =>
		props.thread.startLine && props.thread.line && props.thread.startLine !== props.thread.line
			? `${props.thread.startLine}-${props.thread.line}`
			: `${props.thread.line ?? ""}`

	const openFile = () => {
		if ("directory" in props.source && props.session) {
			props.ctx.links.open({ href: props.thread.path, exact: true, session: props.session })

			return
		}

		const repo = props.pull.url.replace(/\/pull\/\d+$/, "")
		const line = props.thread.line ? `#L${props.thread.line}` : ""
		props.ctx.system.openExternal(`${repo}/blob/${props.pull.headOid}/${props.thread.path}${line}`)
	}

	const resolve = async () => {
		setResolving(true)

		try {
			await props.state.mutate(props.source, (api) =>
				api.resolve({
					...props.source,
					thread: props.thread.id,
					resolved: !props.thread.resolved,
				}),
			)
		} catch (cause) {
			props.ctx.toast.show({ variant: "error", title: describe(cause) })
		} finally {
			setResolving(false)
		}
	}

	return (
		<article class="ghp-card ghp-thread" classList={{ "ghp-thread-resolved": props.thread.resolved }}>
			<header class="ghp-card-header ghp-thread-header">
				<button type="button" class="ghp-path" onClick={openFile} title={props.thread.path}>
					<ui.Icon name="file-document" size="small" />
					<span class="ghp-path-dir">
						<bdi>{props.thread.path.slice(0, -basename(props.thread.path).length)}</bdi>
					</span>
					<span class="ghp-path-name">{basename(props.thread.path)}</span>
					<Show when={lines()}>
						<span class="ghp-weak">:{lines()}</span>
					</Show>
				</button>
				<span class="ghp-spacer" />
				<Show when={props.thread.outdated}>
					<span class="ghp-chip ghp-chip-warning">{t("thread.outdated")}</span>
				</Show>
				<Show when={props.thread.resolved}>
					<span class="ghp-chip">{t("thread.resolved")}</span>
				</Show>
				<Show when={props.context.enabled()}>
					<ContextButton
						ctx={props.ctx}
						attached={props.context.attached(props.thread.id)}
						label={props.context.attached(props.thread.id) ? t("context.remove") : t("context.thread")}
						onClick={() => props.context.thread(props.thread)}
					/>
				</Show>
				<Show when={props.thread.resolved}>
					<ui.IconButton
						icon={expanded() ? "chevron-down" : "chevron-right"}
						variant="ghost"
						size="small"
						label={expanded() ? t("thread.hide") : t("thread.show")}
						onClick={() => setExpanded(!expanded())}
					/>
				</Show>
			</header>
			<Show when={expanded()}>
				<Show when={props.thread.hunk}>
					{(hunk) => (
						<div class="ghp-hunk">
							<ui.Code content={tail(hunk(), 6)} language="diff" />
						</div>
					)}
				</Show>
				<For each={props.thread.comments}>
					{(comment) => (
						<CommentCard
							{...props}
							comment={comment}
							variant="thread"
							attached={props.context.attached(comment.id)}
							onContext={() => props.context.comment(comment, props.thread)}
							onQuote={quoteReply}
						/>
					)}
				</For>
				<footer class="ghp-thread-footer">
					<Show
						when={replying()}
						fallback={
							<>
								<button type="button" class="ghp-reply-trigger" onClick={() => setReplying(true)}>
									{t("thread.reply")}
								</button>
								<ui.Button busy={resolving()} onClick={() => void resolve()}>
									{props.thread.resolved ? t("thread.unresolve") : t("thread.resolve")}
								</ui.Button>
							</>
						}
					>
						<Compose
							ctx={props.ctx}
							autofocus
							placeholder={t("compose.placeholder")}
							submit={t("compose.reply")}
							preview={preview(props)}
							value={reply}
							onValue={setReply}
							onCancel={() => setReplying(false)}
							onSubmit={async (body) => {
								await props.state.mutate(props.source, (api) =>
									api.reply({
										...props.source,
										thread: props.thread.id,
										body,
									}),
								)
								setReplying(false)
							}}
						/>
					</Show>
				</footer>
			</Show>
		</article>
	)
}

interface Preview {
	base: string
	render: (text: string) => Promise<string>
}

const preview = (props: Props & { pull: Pull }): Preview => ({
	base: props.pull.url,
	render: (text) => props.state.markdown(props.source, text),
})

function Compose(props: {
	ctx: Ctx
	placeholder: string
	submit: string
	autofocus?: boolean
	initial?: string
	value?: () => string
	onValue?: (value: string) => void
	textarea?: (element: HTMLTextAreaElement) => void
	preview: Preview
	onSubmit: (body: string) => Promise<void>
	onCancel?: () => void
}) {
	const ui = props.ctx.ui
	const [local, setLocal] = createSignal(props.initial ?? "")
	const text = () => (props.value ? props.value() : local())
	const setText = (value: string) => (props.onValue ? props.onValue(value) : setLocal(value))
	const [busy, setBusy] = createSignal(false)
	const [reset, setReset] = createSignal(0)

	const submit = async () => {
		const body = text().trim()

		if (!body || busy()) return
		setBusy(true)

		try {
			await props.onSubmit(body)
			setText("")
			setReset((value) => value + 1)
		} catch (cause) {
			props.ctx.toast.show({
				variant: "error",
				title: props.ctx.t("compose.failed"),
				description: describe(cause),
			})
		} finally {
			setBusy(false)
		}
	}

	return (
		<div class="ghp-compose">
			<MarkdownField
				ctx={props.ctx}
				value={text()}
				onValue={setText}
				placeholder={props.placeholder}
				autofocus={props.autofocus}
				textarea={props.textarea}
				preview={props.preview}
				reset={reset()}
				onSubmit={() => void submit()}
				onCancel={props.onCancel}
			/>
			<div class="ghp-compose-actions">
				<Show when={props.onCancel}>
					<ui.Button variant="ghost" onClick={() => props.onCancel?.()}>
						{props.ctx.t("compose.cancel")}
					</ui.Button>
				</Show>
				<ui.Button variant="contrast" busy={busy()} disabled={!text().trim()} onClick={() => void submit()}>
					{props.submit}
				</ui.Button>
			</div>
		</div>
	)
}

function MarkdownField(props: {
	ctx: Ctx
	value: string
	onValue: (value: string) => void
	placeholder?: string
	autofocus?: boolean
	textarea?: (element: HTMLTextAreaElement) => void
	preview: Preview
	reset?: number
	class?: string
	onSubmit?: () => void
	onCancel?: () => void
}) {
	const [mode, setMode] = createSignal<"write" | "preview">("write")
	let area: HTMLTextAreaElement | undefined

	const [rendered, setRendered] = createSignal<{
		source: string
		html?: string
		error?: string
	}>()

	const [height, setHeight] = createSignal(0)
	let lastReset = props.reset

	createKeyed(
		() => props.reset,
		(current) => {
			if (current !== lastReset) {
				lastReset = current
				setMode("write")
			}
		},
	)

	const showPreview = () => {
		if (mode() === "write") setHeight(area?.offsetHeight ?? 0)
		setMode("preview")
		const source = props.value

		if (!source.trim() || rendered()?.source === source) return
		setRendered({ source })
		props.preview.render(source).then(
			(html) => rendered()?.source === source && setRendered({ source, html }),
			(cause: unknown) => rendered()?.source === source && setRendered({ source, error: describe(cause) }),
		)
	}

	const write = () => {
		setMode("write")
		queueMicrotask(() => area?.focus())
	}

	return (
		<div class={`ghp-compose-field ${props.class ?? ""}`}>
			<div class="ghp-compose-tabs" role="tablist">
				<button type="button" role="tab" class="ghp-compose-tab" aria-selected={mode() === "write"} onClick={write}>
					{props.ctx.t("compose.write")}
				</button>
				<button
					type="button"
					role="tab"
					class="ghp-compose-tab"
					aria-selected={mode() === "preview"}
					onClick={showPreview}
				>
					{props.ctx.t("compose.preview")}
				</button>
			</div>
			<Show when={mode() === "preview"}>
				<div class="ghp-compose-preview" style={{ "min-height": height() ? `${height()}px` : undefined }}>
					<Switch>
						<Match when={!props.value.trim()}>
							<span class="ghp-weak">{props.ctx.t("compose.empty")}</span>
						</Match>
						<Match when={rendered()?.error}>
							{(error) => (
								<span class="ghp-weak">
									{props.ctx.t("compose.previewFailed")}: {error()}
								</span>
							)}
						</Match>
						<Match when={rendered()?.html}>
							{(html) => <GitHubBody ctx={props.ctx} html={html()} base={props.preview.base} />}
						</Match>
						<Match when={true}>
							<props.ctx.ui.Loader />
						</Match>
					</Switch>
				</div>
			</Show>
			<textarea
				class="ghp-textarea"
				hidden={mode() === "preview"}
				placeholder={props.placeholder}
				value={props.value}
				autofocus={props.autofocus}
				ref={(element) => {
					area = element
					props.textarea?.(element)

					if (props.autofocus) queueMicrotask(() => element.focus())
				}}
				onInput={(event) => props.onValue(event.currentTarget.value)}
				onKeyDown={(event) => {
					if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && props.onSubmit) {
						event.preventDefault()
						props.onSubmit()
					}

					if (event.key === "Escape" && props.onCancel) {
						event.stopPropagation()
						props.onCancel()
					}
				}}
			/>
		</div>
	)
}

const COMMIT_ROW_HEIGHT = 48

const COMMIT_NODE_Y = 16

const COMMIT_LANE_WIDTH = 14

function Commits(props: Props & { pull: Pull }) {
	return (
		<div class="ghp-commits">
			<Show when={props.pull.commitTotal > props.pull.commits.length}>
				<p class="ghp-weak ghp-commits-note">
					{props.ctx.t("commits.more", {
						shown: props.pull.commits.length,
						total: props.pull.commitTotal,
					})}
				</p>
			</Show>
			<CommitGraph ctx={props.ctx} commits={[...props.pull.commits].reverse()} />
		</div>
	)
}

function CommitGraph(props: { ctx: Ctx; commits: readonly Commit[] }) {
	const relative = useRelative(props.ctx)
	const graph = createMemo(() => layout(props.commits))
	const width = () => graph().width * COMMIT_LANE_WIDTH + 6

	return (
		<ol class="ghp-commit-list">
			<For each={graph().rows}>
				{(row) => <CommitRow ctx={props.ctx} row={row} width={width()} relative={relative} />}
			</For>
		</ol>
	)
}

function CommitRow(props: { ctx: Ctx; row: GraphRow; width: number; relative: (date: string) => JSX.Element }) {
	const x = (lane: number) => 7 + lane * COMMIT_LANE_WIDTH
	const mid = COMMIT_NODE_Y
	const commit = (): Commit => props.row.commit
	const merge = () => commit().parents.length > 1

	const path = (from: number, to: number, y1: number, y2: number) =>
		from === to
			? `M${x(from)} ${y1}V${y2}`
			: `M${x(from)} ${y1}C${x(from)} ${(y1 + y2) / 2} ${x(to)} ${(y1 + y2) / 2} ${x(to)} ${y2}`

	return (
		<li class="ghp-commit" style={{ height: `${COMMIT_ROW_HEIGHT}px` }}>
			<svg class="ghp-graph" width={props.width} height={COMMIT_ROW_HEIGHT} aria-hidden="true">
				<For each={props.row.top}>
					{(edge) => <path d={path(edge.from, edge.to, 0, mid)} class={`ghp-lane ghp-lane-${edge.to % 5}`} />}
				</For>
				<For each={props.row.bottom}>
					{(edge) => (
						<path
							d={path(edge.from, edge.to, mid, COMMIT_ROW_HEIGHT)}
							class={`ghp-lane ghp-lane-${edge.to % 5}`}
							classList={{ "ghp-lane-open": !!edge.open }}
						/>
					)}
				</For>
				<circle
					cx={x(props.row.column)}
					cy={merge() ? mid : mid + 1}
					r={merge() ? 4.5 : 4}
					class={`ghp-node ghp-lane-${props.row.column % 5}`}
					classList={{ "ghp-node-merge": merge() }}
				/>
			</svg>
			<div class="ghp-commit-main">
				<a
					class="ghp-commit-title"
					href={commit().url}
					title={commit().body ? `${commit().headline}\n\n${commit().body}` : commit().headline}
					onClick={(event) => openUrl(props.ctx, event, commit().url)}
				>
					{commit().headline}
				</a>
				<div class="ghp-commit-meta">
					<Avatar author={commit().author} size={14} />
					<span>{commit().author.login}</span>
					<span class="ghp-weak">{props.relative(commit().date)}</span>
				</div>
			</div>
			<Show when={commit().verified}>
				<span class="ghp-verified" title={props.ctx.t("commits.verified")}>
					<props.ctx.ui.Icon name="shield" size="small" />
				</span>
			</Show>
			<Show when={commit().checks}>
				{(checks) => (
					<props.ctx.ui.Tooltip value={props.ctx.t(`checks.${checks()}`)}>
						<span class="ghp-commit-checks">
							<Show when={checks() !== "pending"} fallback={<CheckIcon ctx={props.ctx} state="pending" size="small" />}>
								<props.ctx.ui.Icon
									name={checks() === "failure" ? "circle-exclamation" : "check"}
									size="small"
									class={`ghp-tone-${checks()}`}
								/>
							</Show>
						</span>
					</props.ctx.ui.Tooltip>
				)}
			</Show>
			<button
				type="button"
				class="ghp-sha"
				title={commit().oid}
				onClick={() => void props.ctx.system.copy(commit().oid)}
			>
				{commit().short}
			</button>
		</li>
	)
}

function Checks(props: Props & { pull: Pull }) {
	const ui = props.ctx.ui
	const t = props.ctx.t
	const count = (state: CheckState) => props.pull.checks.list.filter((check) => check.state === state).length
	const overall = () => props.pull.checks.state

	return (
		<div class="ghp-checks">
			<Show
				when={props.pull.checks.list.length > 0}
				fallback={<p class="ghp-weak ghp-checks-empty">{t("checks.none")}</p>}
			>
				<div class={`ghp-checks-summary ghp-checks-${overall() ?? "neutral"}`}>
					<CheckIcon ctx={props.ctx} state={overall() ?? "neutral"} />
					<div>
						<strong>{t(`checks.${overall() ?? "neutral"}`)}</strong>
						<div class="ghp-weak">
							{t("checks.counts", {
								failed: count("failure"),
								pending: count("pending"),
								passed: count("success"),
							})}
						</div>
					</div>
				</div>
				<ul class="ghp-check-list">
					<For each={props.pull.checks.list}>
						{(check) => (
							<li class="ghp-check">
								<CheckIcon ctx={props.ctx} state={check.state} size="small" />
								<div class="ghp-check-name">
									<span>
										<Show when={check.workflow}>
											<span class="ghp-weak">{check.workflow} / </span>
										</Show>
										{check.name}
									</span>
									<Show when={check.description}>
										<span class="ghp-weak ghp-check-description">{check.description}</span>
									</Show>
								</div>
								<Show when={check.url}>
									{(url) => (
										<ui.IconButton
											icon="square-arrow-top-right"
											variant="ghost"
											size="small"
											class="ghp-external"
											label={t("open.github")}
											onClick={() => props.ctx.system.openExternal(url())}
										/>
									)}
								</Show>
							</li>
						)}
					</For>
				</ul>
			</Show>
		</div>
	)
}
