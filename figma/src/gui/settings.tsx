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
			<ctx.ui.SettingsLayout title={ctx.t("settings.title")}>
				<ctx.ui.SettingsSection title={ctx.t("settings.token.title")}>
					<ctx.ui.SettingsRow
						id="figma-token"
						title={ctx.t("settings.token.title")}
						description={
							<Show
								when={connected()}
								fallback={
									<>
										{ctx.t("settings.token.description")}{" "}
										<button type="button" class="figma-settings-link" onClick={() => ctx.system.openExternal(TOKENS)}>
											{ctx.t("settings.token.create")}
										</button>
									</>
								}
							>
								{ctx.t("settings.token.connected", { user: user()! })}
							</Show>
						}
					>
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
					</ctx.ui.SettingsRow>
					<ctx.ui.SettingsRow
						id="figma-node-names"
						title={ctx.t("settings.nodeNames.title")}
						description={
							<>
								{ctx.t("settings.nodeNames.description")}{" "}
								<button type="button" class="figma-settings-link" onClick={() => ctx.system.openExternal(LIMITS)}>
									{ctx.t("settings.nodeNames.limits")}
								</button>
							</>
						}
					>
						<ctx.ui.Switch
							label={ctx.t("settings.nodeNames.title")}
							hideLabel
							checked={account.state()?.nodeNames === true}
							disabled={!connected()}
							onChange={(enabled) => void account.nodeNames(enabled, { signal: ctx.signal }).catch(() => {})}
						/>
					</ctx.ui.SettingsRow>
				</ctx.ui.SettingsSection>
			</ctx.ui.SettingsLayout>
		</Show>
	)
}
