import { type BrowserWindow, Menu, screen, shell, WebContentsView } from "electron"
import type { Plugin } from "@opencode/plugin/gui"
import { account, PARTITION } from "./account"
import { readDevModeAccess } from "./access"
import { FigmaView } from "./contract"
import { createHost } from "./host"
import { figmaNodeName, figmaUpdatedAt, figmaZoom, sharpCapture } from "./sharp"
import { embedUrl, fileKey, figmaUrl, supportsDev } from "./url"

const LIVE_VIEW_ITEMS_CACHE_LIMIT = 5

const ACCESS_TTL = 30_000

const isFigmaHost = (raw: string) => {
	if (!URL.canParse(raw)) return false
	const host = new URL(raw).hostname

	return host === "figma.com" || host.endsWith(".figma.com")
}

interface Entry {
	view: WebContentsView
	embed: { id: string; dispose(): void }
	url: string
	source: string
	label: string
	access?: { source: string; until: number; value: Promise<boolean | null> }
}

const parkViewOutsideOfWindowViewport = (view: WebContentsView, window: BrowserWindow) => {
	const bounds = view.getBounds()
	const visible = view.getVisible()
	const [width, height] = window.getContentSize()
	view.setBounds({ ...bounds, x: width - 1, y: height - 1 })
	view.setVisible(true)
	setTimeout(() => {}, 250)

	return () => {
		view.setBounds(bounds)
		view.setVisible(visible)
	}
}

export const main: Plugin.MainSetup = (ctx) => {
	const mode = ctx.options.mode === "editor" ? "editor" : "embed"
	const host = createHost()
	const windows = new Map<number, Map<string, Entry>>()
	let count = 0

	const close = (entry: Entry) => {
		entry.embed.dispose()

		if (!entry.view.webContents.isDestroyed()) entry.view.webContents.close()
	}

	const drop = (window: number, key: string) => {
		const entries = windows.get(window)
		const entry = entries?.get(key)

		if (!entries || !entry) return
		entries.delete(key)
		close(entry)
	}

	const dropWindow = (window: number) => {
		const entries = windows.get(window)

		if (!entries) return
		windows.delete(window)
		entries.forEach(close)
	}

	const create = (window: BrowserWindow): Entry => {
		const view = new WebContentsView({ webPreferences: { partition: PARTITION } })
		view.webContents.setWindowOpenHandler((details) => {
			if (isFigmaHost(details.url) || details.url.startsWith("https://accounts.google.com/")) {
				return {
					action: "allow",
					overrideBrowserWindowOptions: { width: 520, height: 720, webPreferences: { partition: PARTITION } },
				}
			}

			void shell.openExternal(details.url)

			return { action: "deny" }
		})
		view.webContents.on("will-navigate", (event) => {
			if (mode !== "embed" || host.owns(event.url)) return
			event.preventDefault()
			void shell.openExternal(event.url)
		})
		const embed = ctx.embeds.create(view, window)
		embed.show(true)

		return { view, embed, url: "", source: "", label: `view-${++count}` }
	}

	const figma = account(ctx)

	ctx.provide(FigmaView, {
		attach: async (input, caller) => {
			const window = ctx.windows.get(caller.window)

			if (!window) throw new Error("window not found")
			let entries = windows.get(caller.window)

			if (!entries) {
				entries = new Map()
				windows.set(caller.window, entries)
				window.once("closed", () => dropWindow(caller.window))
			}

			const entry = entries.get(input.key) ?? create(window)
			entries.delete(input.key)
			entries.set(input.key, entry)

			for (const [oldest] of entries) {
				if (entries.size <= LIVE_VIEW_ITEMS_CACHE_LIMIT) break
				drop(caller.window, oldest)
			}

			entry.source = input.url
			const options = { view: input.view, dev: input.dev, theme: input.theme }
			const target = mode === "editor" ? figmaUrl(input.url, options) : embedUrl(input.url, options)

			if (entry.url !== target) {
				entry.url = target

				const page =
					mode === "editor"
						? target
						: await host.url(target, input.theme, entry.label).catch((cause) => {
								entry.url = ""
								throw cause
							})

				if (entry.url === target && !entry.view.webContents.isDestroyed()) void entry.view.webContents.loadURL(page)
			}

			return entry.embed.id
		},
		reload: (key, caller) => {
			const entry = windows.get(caller.window)?.get(key)

			if (!entry) return
			entry.access = undefined
			entry.view.webContents.reload()
		},
		release: (key, caller) => drop(caller.window, key),
		active: () => [
			...new Set([...windows.values()].flatMap((entries) => [...entries.values()].map((entry) => entry.source))),
		],
		scale: async (key, caller) => {
			const window = ctx.windows.get(caller.window)
			const entry = windows.get(caller.window)?.get(key)

			if (!window || !entry || entry.view.webContents.isDestroyed()) return null
			const zoom = await figmaZoom(entry.view.webContents)

			return zoom === undefined ? null : zoom / window.webContents.getZoomFactor()
		},
		updated: async (key, caller) => {
			const entry = windows.get(caller.window)?.get(key)

			if (!entry || entry.view.webContents.isDestroyed()) return null

			return (await figmaUpdatedAt(entry.view.webContents)) ?? null
		},
		devAccess: (key, caller) => {
			const entry = windows.get(caller.window)?.get(key)

			if (!entry || entry.view.webContents.isDestroyed() || !supportsDev(entry.source)) return null

			if (entry.access?.source === entry.source && entry.access.until > Date.now()) return entry.access.value
			const contents = entry.view.webContents

			const value = readDevModeAccess(
				(url, init) => contents.session.fetch(url, init),
				entry.source,
				AbortSignal.any([caller.signal, AbortSignal.timeout(10_000)]),
			)

			entry.access = { source: entry.source, until: Date.now() + ACCESS_TTL, value }

			return value
		},
		node: async (input, caller) => {
			const entry = windows.get(caller.window)?.get(input.key)

			if (!entry || entry.view.webContents.isDestroyed()) return null
			const name = await figmaNodeName(entry.view.webContents, input.id)

			if (name) return name
			const file = fileKey(entry.source)

			return file ? figma.nodeName(file, input.id) : null
		},
		capture: async (input, caller) => {
			const window = ctx.windows.get(caller.window)
			const entry = windows.get(caller.window)?.get(input.key)

			if (!window || !entry || entry.view.webContents.isDestroyed()) throw new Error("view not found")
			const zoom = await figmaZoom(entry.view.webContents)

			if (zoom === undefined) throw new Error("Figma zoom unknown")
			const bounds = entry.view.getBounds()
			const windowZoom = window.webContents.getZoomFactor()
			const x = Math.max(0, input.area.x * windowZoom)
			const y = Math.max(0, input.area.y * windowZoom)

			const region = {
				x,
				y,
				width: Math.min(input.area.width * windowZoom, bounds.width - x),
				height: Math.min(input.area.height * windowZoom, bounds.height - y),
			}

			const displayScale = screen.getDisplayMatching(window.getBounds()).scaleFactor
			const restore = parkViewOutsideOfWindowViewport(entry.view, window)

			try {
				return (await sharpCapture(entry.view.webContents, bounds, region, displayScale, 1 / zoom)).toString("base64")
			} finally {
				restore()
			}
		},
		menu: (items, caller) => {
			const window = ctx.windows.get(caller.window)

			if (!window) return null

			return new Promise<string | null>((resolve) => {
				const menu = Menu.buildFromTemplate(
					items.map((item) =>
						item ? { label: item.label, click: () => resolve(item.id) } : { type: "separator" as const },
					),
				)

				// On macOS the menu can report closing before the chosen item's click runs.
				menu.popup({ window, callback: () => setTimeout(() => resolve(null), 100) })
			})
		},
	})

	return () => {
		// oxlint-disable-next-line unicorn/no-useless-spread
		for (const id of [...windows.keys()]) dropWindow(id)
		host.close()
	}
}
