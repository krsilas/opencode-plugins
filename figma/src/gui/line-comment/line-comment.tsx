// Copied from @opencode/ui 2.2.5 (MIT), src/data-display/line-comment/line-comment.tsx.
import { Show, createSignal, onMount, splitProps, type ComponentProps, type JSX } from "solid-js"
import { createKeyed } from "@opencode/plugin/gui"
import { Icon, IconButton, Keybind, Tooltip, listen } from "./shims"
import check from "./quote-check.svg"

export interface LineCommentEditorProps extends Omit<ComponentProps<"div">, "children" | "onInput" | "onSubmit"> {
	label: string
	value: string
	onInput: (value: string) => void
	onCancel: () => void
	onSubmit: (value: string) => void
	placeholder: string
	submitLabel: string
	selection?: JSX.Element
	alternateSubmit?: {
		label: string
		keys: string[]
		disabled?: boolean
		onSubmit: (value: string) => void
	}
}

export function LineCommentEditor(props: LineCommentEditorProps) {
	let textareaRef: HTMLTextAreaElement | undefined

	const [alternate, setAlternate] = createSignal(false)

	const [local, rest] = splitProps(props, [
		"label",
		"value",
		"onInput",
		"onCancel",
		"onSubmit",
		"placeholder",
		"submitLabel",
		"selection",
		"alternateSubmit",
		"class",
		"classList",
	])

	const alternateActive = () => !!local.alternateSubmit && alternate()

	const actionLabel = () => (alternateActive() ? local.alternateSubmit!.label : local.submitLabel)

	createKeyed(
		() => !!local.alternateSubmit,
		() => {
			const update = (event: Event) => {
				if (event instanceof KeyboardEvent) setAlternate(modified(event))
			}

			listen(document, "keydown", update, { capture: true })
			listen(document, "keyup", update, { capture: true })
			listen(window, "blur", () => setAlternate(false))
		},
	)

	const submit = (useAlternate = false) => {
		const v = local.value.trim()

		if (useAlternate && local.alternateSubmit) {
			if (!local.alternateSubmit.disabled) local.alternateSubmit.onSubmit(v)

			return
		}

		local.onSubmit(v)
	}

	onMount(() => {
		requestAnimationFrame(() => textareaRef?.focus())
	})

	return (
		<div
			{...rest}
			data-component="line-comment-v2"
			data-variant="editor"
			data-layout="compact"
			classList={{
				...local.classList,
				[local.class ?? ""]: !!local.class,
			}}
		>
			<div data-slot="line-comment-v2-shell">
				<Show when={local.selection}>
					{(selection) => <div data-slot="line-comment-v2-preview">{selection()}</div>}
				</Show>
				<div data-slot="line-comment-v2-input">
					<div data-slot="line-comment-v2-field">
						<textarea
							ref={(el) => {
								textareaRef = el
							}}
							data-slot="line-comment-v2-textarea"
							data-scrollable
							aria-label={local.label}
							dir="auto"
							rows={1}
							placeholder={local.placeholder}
							value={local.value}
							style={{ "unicode-bidi": "plaintext", "text-align": "start" }}
							onInput={(e) => local.onInput(e.currentTarget.value)}
							onKeyDown={(e) => {
								e.stopPropagation()

								if (e.isComposing || e.keyCode === 229) return

								if (e.key === "Escape") {
									e.preventDefault()
									e.currentTarget.blur()
									local.onCancel()

									return
								}

								if (e.key === "Enter" && !e.shiftKey) {
									e.preventDefault()

									if (e.repeat) return
									submit(modified(e))
								}
							}}
						/>
					</div>
					<Tooltip
						value={
							<div class="flex flex-col gap-1.5">
								<div class="flex items-center gap-1.5">
									{actionLabel()}
									<Keybind keys={alternateActive() ? local.alternateSubmit!.keys : ["⏎"]} />
								</div>
								<Show when={local.alternateSubmit && !alternateActive()}>
									<div class="flex items-center gap-1.5">
										{local.alternateSubmit!.label}
										<Keybind keys={local.alternateSubmit!.keys} />
									</div>
								</Show>
							</div>
						}
						placement="top"
					>
						<IconButton
							data-slot="line-comment-v2-submit"
							type="button"
							size="small"
							variant={alternateActive() ? "submit" : local.value.trim() ? "neutral" : "ghost-muted"}
							disabled={alternateActive() && local.alternateSubmit?.disabled}
							icon={
								alternateActive() ? (
									<Icon name="arrow-up" />
								) : (
									<span
										aria-hidden="true"
										data-slot="line-comment-v2-submit-icon"
										style={{ mask: `url("${check}") center / contain no-repeat` }}
									/>
								)
							}
							aria-label={actionLabel()}
							onPointerEnter={(event) => {
								if (modified(event)) setAlternate(true)
							}}
							onClick={(event) => submit(alternateActive() || modified(event))}
							onKeyDown={(event) => {
								if (event.isComposing) return

								if (event.key === "Enter" && modified(event) && local.alternateSubmit) {
									event.preventDefault()
									event.stopPropagation()

									if (!event.repeat) submit(true)

									return
								}

								if (event.key !== "Escape") return
								event.preventDefault()
								event.stopPropagation()
								local.onCancel()
							}}
						/>
					</Tooltip>
				</div>
			</div>
		</div>
	)
}

function modified(event: Pick<KeyboardEvent, "metaKey" | "ctrlKey" | "altKey" | "shiftKey">) {
	return (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey
}
