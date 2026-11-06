import { createMemo } from "solid-js"
import type { Ctx } from "./state"

const BLOCKED = "script, style, iframe, frame, object, embed, form, link, meta, base, template, noscript"

const URL_ATTRIBUTES = ["href", "src", "srcset", "action", "formaction", "xlink:href"]

export const sanitize = (html: string, base: string, tasks = false) => {
	const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html")
	doc.body.querySelectorAll(BLOCKED).forEach((element) => element.remove())
	doc.body.querySelectorAll("*").forEach((element) => {
		// oxlint-disable-next-line unicorn/no-useless-spread
		for (const attribute of [...element.attributes]) {
			const name = attribute.name.toLowerCase()

			if (name.startsWith("on")) {
				element.removeAttribute(attribute.name)
				continue
			}

			if (!URL_ATTRIBUTES.includes(name)) continue

			if (name === "srcset") {
				element.removeAttribute(attribute.name)
				continue
			}

			try {
				const url = new URL(attribute.value, base)

				if (!["http:", "https:", "mailto:"].includes(url.protocol)) element.removeAttribute(attribute.name)
				else element.setAttribute(attribute.name, url.href)
			} catch {
				element.removeAttribute(attribute.name)
			}
		}
	})
	doc.body.querySelectorAll("img").forEach((image) => {
		image.setAttribute("loading", "lazy")
		image.setAttribute("referrerpolicy", "no-referrer")
	})
	doc.body.querySelectorAll("input").forEach((input) => {
		if (tasks && input.classList.contains("task-list-item-checkbox")) input.removeAttribute("disabled")
		else input.setAttribute("disabled", "")
	})

	return doc.body.innerHTML
}

export function GitHubBody(props: {
	ctx: Ctx
	html: string
	base: string
	onToggle?: (index: number, checked: boolean) => Promise<void>
}) {
	const html = createMemo(() => sanitize(props.html, props.base, !!props.onToggle))

	const click = (event: MouseEvent) => {
		const target = event.target

		if (props.onToggle && target instanceof HTMLInputElement && target.matches("input.task-list-item-checkbox")) {
			const current = event.currentTarget
			const boxes = current instanceof HTMLElement ? [...current.querySelectorAll("input.task-list-item-checkbox")] : []
			const checked = target.checked
			target.disabled = true
			props.onToggle(boxes.indexOf(target), checked).then(
				() => {
					target.disabled = false
				},
				() => {
					target.checked = !checked
					target.disabled = false
				},
			)

			return
		}

		const link = target instanceof Element ? target.closest("a[href]") : null

		if (!link) return
		event.preventDefault()
		const href = link.getAttribute("href")

		if (href) props.ctx.system.openExternal(href)
	}

	return <div class="ghp-markdown" innerHTML={html()} onClick={click} />
}

const TASK = /^(\s*(?:>\s*)*(?:[-+*]|\d+[.)])\s+\[)([ xX])(\])/

const FENCE = /^\s*(?:>\s*)*(```|~~~)/

export const toggleTask = (markdown: string, index: number, checked: boolean) => {
	let fence: string | undefined
	let count = 0
	const lines = markdown.split("\n")

	for (let i = 0; i < lines.length; i++) {
		const marker = lines[i].match(FENCE)?.[1]

		if (marker) {
			if (!fence) fence = marker
			else if (marker === fence) fence = undefined
			continue
		}

		if (fence || !TASK.test(lines[i])) continue

		if (count++ !== index) continue
		lines[i] = lines[i].replace(TASK, `$1${checked ? "x" : " "}$3`)

		return lines.join("\n")
	}

	return undefined
}
