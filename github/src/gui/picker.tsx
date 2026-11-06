import { createMemo, createSignal, For, onCleanup, Show, type JSX } from "solid-js"
import { Portal } from "solid-js/web"
import { createKeyed } from "@opencode/plugin/gui"
import type { Ctx } from "./state"

const WIDTH = 300

const GAP = 4

export function Picker<T>(props: {
	ctx: Ctx
	label: string
	items: readonly T[]
	key: (item: T) => string
	text: (item: T) => string
	row: (item: T) => JSX.Element
	selected: readonly string[]
	multiple?: boolean
	onChange: (keys: string[]) => void
	loading?: boolean
	empty: string
	trigger: (toggle: () => void, expanded: boolean) => JSX.Element
}) {
	const ui = props.ctx.ui
	const [anchor, setAnchor] = createSignal<DOMRect>()
	const [query, setQuery] = createSignal("")
	const [active, setActive] = createSignal(0)
	let trigger: HTMLSpanElement | undefined
	let popover: HTMLDivElement | undefined
	let list: HTMLUListElement | undefined

	const matches = createMemo(() => {
		const needle = query().trim().toLowerCase()

		return needle ? props.items.filter((item) => props.text(item).toLowerCase().includes(needle)) : [...props.items]
	})

	const open = () => {
		if (!trigger) return
		setQuery("")
		setActive(0)
		locate()
		setAnchor(trigger.getBoundingClientRect())
	}

	const close = (refocus = true) => {
		setAnchor(undefined)

		if (refocus) trigger?.querySelector<HTMLElement>("button, [tabindex]")?.focus()
	}

	const choose = (item: T) => {
		const key = props.key(item)

		if (!props.multiple) {
			props.onChange([key])
			close()

			return
		}

		props.onChange(props.selected.includes(key) ? props.selected.filter((k) => k !== key) : [...props.selected, key])
	}

	const place = (): JSX.CSSProperties => {
		const rect = anchor()!
		const origin = host()?.origin ?? { x: 0, y: 0 }
		const left = Math.max(8, Math.min(rect.left, window.innerWidth - WIDTH - 8)) - origin.x
		const below = window.innerHeight - rect.bottom

		return below >= 260 || below >= rect.top
			? { left: `${left}px`, top: `${rect.bottom + GAP - origin.y}px`, "max-height": `${Math.min(360, below - 16)}px` }
			: {
					left: `${left}px`,
					top: `${rect.top - GAP - origin.y}px`,
					transform: "translateY(-100%)",
					"max-height": `${Math.min(360, rect.top - 16)}px`,
				}
	}

	const [host, setHost] = createSignal<{ mount: HTMLElement; origin: { x: number; y: number } }>()

	const locate = () => {
		const mount = trigger?.closest<HTMLElement>('[role="dialog"]') ?? document.body

		if (mount === document.body) return setHost({ mount, origin: { x: 0, y: 0 } })
		const probe = document.createElement("div")
		probe.style.cssText = "position:fixed;left:0;top:0;width:0;height:0;visibility:hidden"
		mount.appendChild(probe)
		const box = probe.getBoundingClientRect()
		probe.remove()
		setHost({ mount, origin: { x: box.left, y: box.top } })
	}

	createKeyed(anchor, () => {
		const outside = (event: PointerEvent) => {
			const target = event.target

			if (target instanceof Node && !popover?.contains(target) && !trigger?.contains(target)) close(false)
		}

		const dismiss = () => close(false)
		document.addEventListener("pointerdown", outside, true)
		window.addEventListener("resize", dismiss)
		onCleanup(() => {
			document.removeEventListener("pointerdown", outside, true)
			window.removeEventListener("resize", dismiss)
		})
	})

	const scrollTo = (index: number) => queueMicrotask(() => list?.children[index]?.scrollIntoView({ block: "nearest" }))

	const onKeyDown = (event: KeyboardEvent) => {
		if (event.isComposing) return
		const count = matches().length

		if (event.key === "ArrowDown" && count) {
			event.preventDefault()
			setActive((index) => (index + 1) % count)
			scrollTo(active())

			return
		}

		if (event.key === "ArrowUp" && count) {
			event.preventDefault()
			setActive((index) => (index - 1 + count) % count)
			scrollTo(active())

			return
		}

		if (event.key === "Enter") {
			event.preventDefault()
			const item = matches()[active()]

			if (item) choose(item)

			return
		}

		if (event.key === "Escape") {
			event.preventDefault()
			event.stopPropagation()
			close()
		}
	}

	return (
		<>
			<span ref={trigger} class="ghp-picker-trigger">
				{props.trigger(() => (anchor() ? close() : open()), !!anchor())}
			</span>
			<Show when={anchor()}>
				<Portal mount={host()?.mount}>
					<div
						ref={popover}
						class="ghp-picker"
						data-mode={props.ctx.appearance.mode()}
						style={{ ...place(), width: `${WIDTH}px` }}
					>
						<div class="ghp-picker-head">
							<strong>{props.label}</strong>
							<input
								class="ghp-picker-search"
								placeholder={props.ctx.t("picker.filter")}
								aria-label={props.ctx.t("picker.filter")}
								value={query()}
								ref={(element) => queueMicrotask(() => element.focus())}
								onInput={(event) => {
									setQuery(event.currentTarget.value)
									setActive(0)
								}}
								onKeyDown={onKeyDown}
							/>
						</div>
						<Show
							when={!props.loading}
							fallback={
								<div class="ghp-picker-empty">
									<ui.Loader />
								</div>
							}
						>
							<Show when={matches().length > 0} fallback={<div class="ghp-picker-empty">{props.empty}</div>}>
								<ul ref={list} class="ghp-picker-list" role="listbox" aria-multiselectable={props.multiple}>
									<For each={matches()}>
										{(item, index) => {
											const checked = () => props.selected.includes(props.key(item))

											return (
												<li
													role="option"
													class="ghp-picker-item"
													aria-selected={checked()}
													data-active={index() === active() ? "" : undefined}
													onPointerMove={() => setActive(index())}
													onClick={() => choose(item)}
												>
													<span class="ghp-picker-check">
														<Show when={checked()}>
															<ui.Icon name="check-small" size="small" />
														</Show>
													</span>
													{props.row(item)}
												</li>
											)
										}}
									</For>
								</ul>
							</Show>
						</Show>
					</div>
				</Portal>
			</Show>
		</>
	)
}
