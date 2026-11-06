import { onCleanup, splitProps, type ComponentProps, type JSX } from "solid-js"
import { usePlugin, type IconName } from "@opencode/plugin/gui"
import lineCommentCss from "./line-comment.css?inline"

export { lineCommentCss }

const ui = () => usePlugin().ui

export function listen(target: EventTarget, type: string, listener: EventListener, options?: AddEventListenerOptions) {
	target.addEventListener(type, listener, options)
	onCleanup(() => target.removeEventListener(type, listener, options))
}

export function Icon(props: { name: IconName }) {
	const UI = ui()

	return <UI.Icon name={props.name} />
}

export function Keybind(props: { keys: readonly string[] }) {
	const UI = ui()

	return <UI.Keybind keys={props.keys} />
}

export function Tooltip(props: {
	value: JSX.Element
	placement?: "top" | "bottom" | "left" | "right"
	children: JSX.Element
}) {
	const UI = ui()

	return (
		<UI.Tooltip value={props.value} placement={props.placement}>
			{props.children}
		</UI.Tooltip>
	)
}

export function IconButton(
	props: ComponentProps<"button"> & {
		icon?: JSX.Element
		size?: "small" | "normal" | "large"
		variant?: "neutral" | "submit" | "ghost-muted"
	},
) {
	const [local, rest] = splitProps(props, ["icon", "size", "variant"])

	return (
		<button
			type="button"
			{...rest}
			data-component="icon-button-v2"
			data-size={local.size || "normal"}
			data-variant={local.variant || "neutral"}
			data-disabled={rest.disabled ? "" : undefined}
		>
			{local.icon}
		</button>
	)
}
