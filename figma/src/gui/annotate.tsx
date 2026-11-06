import { createSignal, onCleanup, onMount, Show } from "solid-js"
import { createKeyed, usePlugin } from "@opencode/plugin/gui"
import type { definition } from "./definition"
import { LineCommentEditor } from "./line-comment/line-comment"

export interface Area {
	x: number
	y: number
	width: number
	height: number
}

const MIN_AREA_SIZE = 8

const EDITOR_WIDTH = 320

const GAP = 8

const mac = () => /Mac|iPhone|iPad/.test(navigator.userAgent)

export function AnnotateLayer(props: {
	subject?: string
	onSubmit: (area: Area, size: { width: number; height: number }, comment: string, send: boolean) => Promise<void>
	onCancel: () => void
}) {
	const ctx = usePlugin<typeof definition>()
	let layer!: HTMLDivElement
	const [start, setStart] = createSignal<{ x: number; y: number }>()
	const [area, setArea] = createSignal<Area>()
	const [done, setDone] = createSignal(false)
	const [busy, setBusy] = createSignal(false)
	const [comment, setComment] = createSignal("")
	const [editor, setEditor] = createSignal<HTMLDivElement>()
	const [editorHeight, setEditorHeight] = createSignal(0)

	createKeyed(editor, (element) => {
		const observer = new ResizeObserver(() => setEditorHeight(element.offsetHeight))
		observer.observe(element)
		onCleanup(() => observer.disconnect())
	})

	const point = (event: PointerEvent) => {
		const box = layer.getBoundingClientRect()

		return {
			x: Math.min(Math.max(event.clientX - box.left, 0), box.width),
			y: Math.min(Math.max(event.clientY - box.top, 0), box.height),
		}
	}

	const down = (event: PointerEvent) => {
		if (done()) {
			if (!busy() && !comment().trim()) props.onCancel()

			return
		}

		if (event.button !== 0) return
		layer.setPointerCapture(event.pointerId)
		const p = point(event)
		setStart(p)
		setArea({ ...p, width: 0, height: 0 })
	}

	const move = (event: PointerEvent) => {
		const from = start()

		if (!from || done()) return
		const p = point(event)
		setArea({
			x: Math.min(from.x, p.x),
			y: Math.min(from.y, p.y),
			width: Math.abs(p.x - from.x),
			height: Math.abs(p.y - from.y),
		})
	}

	const up = () => {
		if (!start() || done()) return
		setStart(undefined)
		const current = area()

		if (!current || current.width < MIN_AREA_SIZE || current.height < MIN_AREA_SIZE) return setArea(undefined)
		setDone(true)
	}

	const submit = async (send = false) => {
		const current = area()

		if (!current || busy()) return
		setBusy(true)

		try {
			await props.onSubmit(current, { width: layer.clientWidth, height: layer.clientHeight }, comment().trim(), send)
		} finally {
			setBusy(false)
		}
	}

	onMount(() => {
		const key = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return
			event.preventDefault()
			event.stopPropagation()
			props.onCancel()
		}

		window.addEventListener("keydown", key, true)
		onCleanup(() => window.removeEventListener("keydown", key, true))
	})

	const formTop = () => {
		const current = area()!
		const height = editorHeight()
		const below = current.y + current.height + GAP

		return below + height > layer.clientHeight ? Math.max(current.y - height - GAP, GAP) : below
	}

	return (
		<div
			ref={layer}
			class="figma-annotate"
			classList={{ "figma-annotate-done": done() }}
			onPointerDown={down}
			onPointerMove={move}
			onPointerUp={up}
		>
			<Show when={!area()}>
				<div class="figma-annotate-hint">{ctx.t("annotate.hint")}</div>
			</Show>
			<Show when={area()}>
				{(current) => (
					<div
						class="figma-annotate-area"
						style={{
							left: `${current().x}px`,
							top: `${current().y}px`,
							width: `${current().width}px`,
							height: `${current().height}px`,
						}}
					/>
				)}
			</Show>
			<Show when={done() && !busy() && area()}>
				{(current) => (
					<div
						ref={setEditor}
						class="figma-comment"
						style={{
							left: `${Math.min(current().x, Math.max(layer.clientWidth - EDITOR_WIDTH - GAP, GAP))}px`,
							top: `${formTop()}px`,
							width: `${Math.min(EDITOR_WIDTH, layer.clientWidth - GAP * 2)}px`,
						}}
						onPointerDown={(event) => event.stopPropagation()}
					>
						<LineCommentEditor
							value={comment()}
							onInput={setComment}
							onCancel={props.onCancel}
							onSubmit={() => void submit()}
							label={ctx.t("annotate.submit")}
							placeholder={ctx.t("annotate.placeholder")}
							submitLabel={ctx.t("annotate.submit")}
							alternateSubmit={{
								label: ctx.t("annotate.send"),
								keys: [mac() ? "⌘" : "Ctrl", "⏎"],
								onSubmit: () => void submit(true),
							}}
						/>
					</div>
				)}
			</Show>
		</div>
	)
}

export async function density(still: Uint8Array, size: { width: number; height: number }): Promise<number> {
	const bitmap = await createImageBitmap(new Blob([new Uint8Array(still)]))
	const value = bitmap.width / size.width
	bitmap.close()

	return value
}

export async function crop(
	still: Uint8Array,
	area: Area,
	size: { width: number; height: number },
	output?: { width: number; height: number },
): Promise<string> {
	const bitmap = await createImageBitmap(new Blob([new Uint8Array(still)]))
	const sx = bitmap.width / size.width
	const sy = bitmap.height / size.height
	const width = Math.max(1, Math.round(area.width * sx))
	const height = Math.max(1, Math.round(area.height * sy))
	const canvas = document.createElement("canvas")
	canvas.width = output?.width ?? width
	canvas.height = output?.height ?? height
	const context = canvas.getContext("2d")!
	context.imageSmoothingQuality = "high"
	context.drawImage(
		bitmap,
		Math.round(area.x * sx),
		Math.round(area.y * sy),
		width,
		height,
		0,
		0,
		canvas.width,
		canvas.height,
	)
	bitmap.close()

	return canvas.toDataURL("image/png").split(",")[1]!
}
