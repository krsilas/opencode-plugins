import { createResource, createSignal, For, onCleanup, Show } from "solid-js"
import { createKeyed, usePlugin } from "@opencode/plugin/gui"
import { GitHub } from "../rpc"
import { hostInput, settingsHosts, tokenUrl, type SettingsHost } from "../hosts"
import type { definition } from "./definition"
import { describe } from "./state"

export function GitHubSettings() {
	const ctx = usePlugin<typeof definition>()
	const [busy, setBusy] = createSignal(false)

	const [accounts, { refetch }] = createResource(
		() => ctx.client,
		(client) =>
			client
				.rpc(GitHub)
				.accounts({})
				.then((result) => result.accounts),
	)

	const list = () => (accounts.error ? [] : (accounts.latest ?? []))
	const hosts = () => settingsHosts(list())

	const edit = (target?: string) => {
		ctx.dialogs.open((dialog) => (
			<HostTokenDialog host={target} hosts={hosts()} busy={busy()} save={save} close={dialog.close} />
		))
	}

	const reload = async () => {
		try {
			await refetch()
		} catch {}
	}

	createKeyed(
		() => ctx.client,
		(client) => onCleanup(client.rpc(GitHub).events.on("auth", () => void reload())),
	)

	const save = async (target: string, token: string | null) => {
		if (busy() || (token !== null && !token.trim())) return { ok: false as const, error: "" }
		setBusy(true)

		try {
			await ctx.client.rpc(GitHub).token({ host: target, token })
			await reload()
			ctx.toast.show({ title: ctx.t(token === null ? "settings.token.removed" : "settings.token.saved") })

			return { ok: true as const }
		} catch (cause) {
			const error = describe(cause)
			if (token === null)
				ctx.toast.show({ title: ctx.t("settings.token.failed"), description: error, variant: "error" })

			return { ok: false as const, error }
		} finally {
			setBusy(false)
		}
	}

	return (
		<>
			<div class="settings-tab-header">
				<div class="settings-tab-header-row">
					<h2 class="settings-tab-title">{ctx.t("settings.title")}</h2>
				</div>
			</div>
			<div class="settings-tab-body settings-tab-body--sectioned">
				<section class="settings-section" aria-label={ctx.t("settings.hosts")} data-action="github-token">
					<h3 class="settings-section-title">{ctx.t("settings.hosts")}</h3>
					<p class="ghp-settings-hint">{ctx.t("settings.hosts.description")}</p>
					<div data-component="settings-list" data-action="github-hosts">
						<For each={hosts()}>
							{(item) => (
								<div data-component="settings-row">
									<div data-slot="settings-row-copy">
										<div data-slot="settings-row-title">{item.host}</div>
										<div data-slot="settings-row-description">
											{item.user
												? ctx.t("settings.token.connected", { user: item.user })
												: ctx.t("settings.token.missing")}
										</div>
									</div>
									<div data-slot="settings-row-control" class="ghp-settings-actions">
										<ctx.ui.Button size="small" variant="neutral" disabled={busy()} onClick={() => edit(item.host)}>
											{ctx.t(item.user ? "settings.token.edit" : "settings.token.set")}
										</ctx.ui.Button>
										<Show when={item.user}>
											<ctx.ui.Button
												size="small"
												variant="neutral"
												disabled={busy()}
												onClick={() => void save(item.host, null)}
											>
												{ctx.t("settings.token.remove")}
											</ctx.ui.Button>
										</Show>
									</div>
								</div>
							)}
						</For>
					</div>
					<div class="ghp-settings-add-host">
						<ctx.ui.Button size="small" variant="ghost" icon="plus" disabled={busy()} onClick={() => edit()}>
							{ctx.t("settings.host.add")}
						</ctx.ui.Button>
					</div>
					<Show when={accounts.error}>
						<p class="ghp-settings-hint" role="alert">
							{describe(accounts.error)}
						</p>
						<ctx.ui.Button size="small" variant="neutral" onClick={() => void reload()}>
							{ctx.t("retry")}
						</ctx.ui.Button>
					</Show>
				</section>
			</div>
		</>
	)
}

function HostTokenDialog(props: {
	host?: string
	hosts: readonly SettingsHost[]
	busy: boolean
	save(host: string, token: string): Promise<{ ok: true } | { ok: false; error: string }>
	close(): void
}) {
	const ctx = usePlugin<typeof definition>()
	const adding = props.host === undefined
	const [host, setHost] = createSignal(props.host ?? "")
	const [value, setValue] = createSignal("")
	const [error, setError] = createSignal<string>()
	const target = () => hostInput(host())
	const account = () => props.hosts.find((item) => item.host === target().trim().toLowerCase())
	const duplicate = () => adding && !!account()
	const valid = () => !!tokenUrl(target()) && !duplicate() && !!value().trim()
	onCleanup(() => setValue(""))

	const submit = async () => {
		if (props.busy || !valid()) return

		setError(undefined)
		const result = await props.save(target(), value())
		if (result.ok) {
			setValue("")
			props.close()
		} else setError(result.error)
	}

	return (
		<ctx.ui.Dialog
			title={ctx.t(adding ? "settings.host.add" : account()?.user ? "settings.token.edit" : "settings.token.set")}
			description={ctx.t("settings.token.description")}
			footer={
				<>
					<ctx.ui.Button variant="neutral" disabled={props.busy} onClick={props.close}>
						{ctx.t("compose.cancel")}
					</ctx.ui.Button>
					<ctx.ui.Button variant="contrast" busy={props.busy} disabled={!valid()} onClick={() => void submit()}>
						{ctx.t(adding ? "settings.host.add" : "settings.token.save")}
					</ctx.ui.Button>
				</>
			}
		>
			<div class="ghp-settings-form">
				<label class="ghp-settings-field">
					<span>{ctx.t("settings.host.title")}</span>
					<ctx.ui.TextInput
						label={ctx.t("settings.host.title")}
						placeholder="company.ghe.com"
						value={host()}
						disabled={props.busy || !adding}
						invalid={duplicate()}
						autofocus={adding}
						onInput={(next) => {
							setHost(next)
							setValue("")
							setError(undefined)
						}}
					/>
				</label>
				<Show when={duplicate()}>
					<p class="ghp-settings-hint" role="alert">
						{ctx.t("settings.host.duplicate")}
					</p>
				</Show>
				<label class="ghp-settings-field">
					<span>{ctx.t("settings.token.title")}</span>
					<ctx.ui.TextInput
						type="password"
						label={ctx.t("settings.token.title")}
						placeholder={ctx.t(account()?.user ? "settings.token.replace" : "settings.token.placeholder")}
						value={value()}
						disabled={props.busy}
						autofocus={!adding}
						onInput={(next) => {
							setValue(next)
							setError(undefined)
						}}
						onSubmit={() => void submit()}
					/>
				</label>
				<Show when={error()}>
					{(message) => (
						<p class="ghp-settings-hint" role="alert">
							{message()}
						</p>
					)}
				</Show>
				<TokenLink host={target()} />
			</div>
		</ctx.ui.Dialog>
	)
}

function TokenLink(props: { host: string }) {
	const ctx = usePlugin<typeof definition>()
	const url = () => tokenUrl(props.host)

	return (
		<a
			class="ghp-settings-link"
			role="link"
			href={url()}
			aria-disabled={!url()}
			tabIndex={url() ? 0 : -1}
			onClick={(event) => {
				event.preventDefault()
				const target = url()

				if (target) ctx.system.openExternal(target)
			}}
		>
			{ctx.t("settings.token.create")}
		</a>
	)
}
