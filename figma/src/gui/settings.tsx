import { createSignal, Show } from "solid-js"
import { usePlugin } from "@opencode/plugin/gui"
import { FigmaAccount, INVALID_KEY } from "./contract"
import type { definition } from "./definition"

const TOKENS = "https://help.figma.com/hc/en-us/articles/8085703771159-Manage-personal-access-tokens"

const LIMITS = "https://developers.figma.com/docs/rest-api/rate-limits/"

export function FigmaSettings() {
	const ctx = usePlugin<typeof definition>()
	const account = ctx.main(FigmaAccount)
	const [value, setValue] = createSignal("")
	const [busy, setBusy] = createSignal(false)
	const user = () => account.state()?.user
	const connected = () => !!user()

	const save = async (token: string | null) => {
		if (busy() || (token !== null && !token.trim())) return
		setBusy(true)

		try {
			await account.token(token, { signal: ctx.signal })
			setValue("")
		} catch (cause) {
			const message = cause instanceof Error ? cause.message : String(cause)
			ctx.toast.show({
				title: ctx.t("settings.token.failed"),
				description: message.includes(INVALID_KEY) ? ctx.t("settings.token.invalid") : message,
				variant: "error",
			})
		} finally {
			setBusy(false)
		}
	}

	return (
		<Show when={ctx.app.platform === "desktop"}>
			<div class="settings-tab-header">
				<div class="settings-tab-header-row">
					<h2 class="settings-tab-title">{ctx.t("settings.title")}</h2>
				</div>
			</div>
			<div class="settings-tab-body settings-tab-body--sectioned">
				<section class="settings-section" aria-label={ctx.t("settings.token.title")}>
					<h3 class="settings-section-title">{ctx.t("settings.token.title")}</h3>
					<div data-component="settings-list">
						<div data-component="settings-row" data-action="figma-token">
							<div data-slot="settings-row-copy">
								<div data-slot="settings-row-title">{ctx.t("settings.token.title")}</div>
								<div data-slot="settings-row-description">
									<Show
										when={connected()}
										fallback={
											<>
												{ctx.t("settings.token.description")}{" "}
												<button
													type="button"
													class="figma-settings-link"
													onClick={() => ctx.system.openExternal(TOKENS)}
												>
													{ctx.t("settings.token.create")}
												</button>
											</>
										}
									>
										{ctx.t("settings.token.connected", { user: user()! })}
									</Show>
								</div>
							</div>
							<div data-slot="settings-row-control">
								<Show
									when={!connected()}
									fallback={
										<ctx.ui.Button size="small" variant="neutral" busy={busy()} onClick={() => void save(null)}>
											{ctx.t("settings.token.remove")}
										</ctx.ui.Button>
									}
								>
									<div class="figma-settings-token">
										<ctx.ui.TextInput
											type="password"
											label={ctx.t("settings.token.title")}
											placeholder={ctx.t("settings.token.placeholder")}
											value={value()}
											onInput={setValue}
											onSubmit={(token) => void save(token)}
										/>
										<ctx.ui.Button
											size="small"
											variant="neutral"
											busy={busy()}
											disabled={!value().trim()}
											onClick={() => void save(value())}
										>
											{ctx.t("settings.token.save")}
										</ctx.ui.Button>
									</div>
								</Show>
							</div>
						</div>
						<div data-component="settings-row" data-action="figma-node-names">
							<div data-slot="settings-row-copy">
								<div data-slot="settings-row-title">{ctx.t("settings.nodeNames.title")}</div>
								<div data-slot="settings-row-description">
									{ctx.t("settings.nodeNames.description")}{" "}
									<button type="button" class="figma-settings-link" onClick={() => ctx.system.openExternal(LIMITS)}>
										{ctx.t("settings.nodeNames.limits")}
									</button>
								</div>
							</div>
							<div data-slot="settings-row-control">
								<ctx.ui.Switch
									label={ctx.t("settings.nodeNames.title")}
									hideLabel
									checked={account.state()?.nodeNames === true}
									disabled={!connected()}
									onChange={(enabled) => void account.nodeNames(enabled, { signal: ctx.signal }).catch(() => {})}
								/>
							</div>
						</div>
					</div>
				</section>
			</div>
		</Show>
	)
}
