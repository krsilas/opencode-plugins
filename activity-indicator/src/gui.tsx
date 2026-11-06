import { Schema } from "effect"
import { app, BrowserWindow, Menu, nativeImage, Tray, type MenuItemConstructorOptions } from "electron"
import { Ipc, Plugin } from "@opencode/plugin/gui"
import { onCleanup } from "solid-js"
import { dotOpacity, frac, radarDots, radarLoop } from "./spinner-radar"

const Bridge = Ipc.define({
	id: "opencode-activity-indicator.bridge",
	methods: {
		phase: { input: Schema.Number },
	},
	events: {
		open: Schema.String,
	},
})

type Session = {
	id: string
	title?: string
	parentID?: string
	time: { idle?: number; viewed?: number; archived?: number; updated: number }
}

const EVENTS = [
	"session.status",
	"session.idle",
	"session.viewed",
	"session.created",
	"session.deleted",
	"session.archived",
	"session.unarchived",
	"session.renamed",
	"session.execution.started",
	"session.execution.succeeded",
	"session.execution.failed",
	"session.execution.interrupted",
	"permission.asked",
	"permission.replied",
	"form.created",
	"form.replied",
	"form.cancelled",
] as const

const SIZE = 18
const SCALE = 2
const FRAMES = Math.round(radarLoop * 60)

const ORANGE = [0xf5, 0xb8, 0x2e] as const
const BLUE = [0x60, 0xa5, 0xfa] as const

type Rgb = readonly [number, number, number]
type Mask = { width: number; alpha: Uint8Array }

const PILL = 22 * SCALE
const PILL_ICON = 16 * SCALE
const PILL_PAD = 7 * SCALE
const PILL_GAP = 3 * SCALE

function radarFrame(t: number, px = SIZE * SCALE, dim?: number) {
	const unit = (px - 2 * SCALE) / 16
	const pad = SCALE
	const buffer = Buffer.alloc(px * px * 4)
	for (const dot of radarDots) {
		const opacity = dotOpacity(dot, t, dim)
		const x0 = pad + dot.x * unit
		const y0 = pad + dot.y * unit
		const side = dot.size * unit
		const radius = dot.size * 0.24 * unit
		for (let y = Math.floor(y0); y < Math.ceil(y0 + side); y++) {
			for (let x = Math.floor(x0); x < Math.ceil(x0 + side); x++) {
				let hit = 0
				for (let s = 0; s < 16; s++) {
					const sx = x + ((s % 4) + 0.5) / 4 - x0
					const sy = y + (Math.floor(s / 4) + 0.5) / 4 - y0
					if (sx < 0 || sy < 0 || sx > side || sy > side) continue
					const cx = Math.max(radius - sx, 0, sx - (side - radius))
					const cy = Math.max(radius - sy, 0, sy - (side - radius))
					if (cx * cx + cy * cy <= radius * radius) hit++
				}
				const offset = (y * px + x) * 4
				buffer[offset + 3] = Math.max(buffer[offset + 3], Math.round((hit / 16) * opacity * 255))
			}
		}
	}
	return buffer
}

function mark(px = SIZE * SCALE) {
	const unit = (px - 4) / 20
	const left = (px - 16 * unit) / 2
	const top = 2
	const buffer = Buffer.alloc(px * px * 4)
	const alpha = (u: number, v: number) => {
		if (u < 0 || v < 0 || u > 16 || v > 20) return 0
		if (u < 4 || u > 12 || v < 4 || v > 16) return 1
		return v >= 8 ? 0.35 : 0
	}
	for (let y = 0; y < px; y++) {
		for (let x = 0; x < px; x++) {
			let sum = 0
			for (let s = 0; s < 16; s++) {
				sum += alpha((x + ((s % 4) + 0.5) / 4 - left) / unit, (y + (Math.floor(s / 4) + 0.5) / 4 - top) / unit)
			}
			buffer[(y * px + x) * 4 + 3] = Math.round((sum / 16) * 255)
		}
	}
	return buffer
}

function pill(icon: Buffer, text?: Mask) {
	const h = PILL
	const w = text ? Math.max(h, PILL_PAD * 2 + PILL_ICON + PILL_GAP + text.width) : h
	const r = h / 2
	const out = Buffer.alloc(w * h * 4)
	const top = (h - PILL_ICON) / 2
	const left = text ? PILL_PAD : (w - PILL_ICON) / 2
	const textX = PILL_PAD + PILL_ICON + PILL_GAP
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			let hit = 0
			for (let s = 0; s < 16; s++) {
				const sx = x + ((s % 4) + 0.5) / 4
				const sy = y + (Math.floor(s / 4) + 0.5) / 4
				const cx = Math.max(r - sx, 0, sx - (w - r))
				const cy = sy - r
				if (cx * cx + cy * cy <= r * r) hit++
			}
			const shape = hit / 16
			let fg = 0
			const ix = x - left
			const iy = y - top
			if (ix >= 0 && iy >= 0 && ix < PILL_ICON && iy < PILL_ICON) fg = icon[(iy * PILL_ICON + ix) * 4 + 3] / 255
			if (text) {
				const tx = x - textX
				if (tx >= 0 && tx < text.width) fg = Math.max(fg, text.alpha[y * text.width + tx] / 255)
			}
			const o = (y * w + x) * 4
			for (let c = 0; c < 3; c++) out[o + c] = Math.round(shape * (255 * fg + BLUE[2 - c] * (1 - fg)))
			out[o + 3] = Math.round(shape * 255)
		}
	}
	return nativeImage.createFromBitmap(out, { width: w, height: h, scaleFactor: SCALE })
}

function textRenderer() {
	const cache = new Map<string, Mask>()
	const inflight = new Map<string, Promise<void>>()
	let window: BrowserWindow | undefined
	const ready = () => {
		if (window && !window.isDestroyed()) return Promise.resolve(window)
		window = new BrowserWindow({ show: false, width: 10, height: 10, webPreferences: { offscreen: true } })
		const w = window
		return w.loadURL("data:text/html,<html></html>").then(() => w)
	}
	return {
		get: (value: string) => cache.get(value),
		load(value: string, done: () => void) {
			if (cache.has(value) || inflight.has(value)) return
			const job = ready()
				.then((w) =>
					w.webContents.executeJavaScript(`(() => {
            const h = ${PILL}, font = "600 ${14 * SCALE}px -apple-system, system-ui"
            const m = new OffscreenCanvas(1, 1).getContext("2d"); m.font = font
            const width = Math.ceil(m.measureText(${JSON.stringify(value)}).width) + 1
            const c = new OffscreenCanvas(width, h), g = c.getContext("2d")
            g.font = font; g.fillStyle = "#fff"; g.textBaseline = "middle"; g.fontVariantNumeric = "tabular-nums"
            g.fillText(${JSON.stringify(value)}, 0, h / 2 + ${SCALE * 0.5})
            const d = g.getImageData(0, 0, width, h).data, alpha = []
            for (let i = 3; i < d.length; i += 4) alpha.push(d[i])
            return { width, alpha }
          })()`),
				)
				.then((mask: { width: number; alpha: number[] }) => {
					cache.set(value, { width: mask.width, alpha: Uint8Array.from(mask.alpha) })
					done()
				})
				.finally(() => inflight.delete(value))
			inflight.set(value, job)
		},
		dispose: () => window && !window.isDestroyed() && window.destroy(),
	}
}

function image(alpha: Buffer, tint?: Rgb) {
	const px = SIZE * SCALE
	const buffer = Buffer.from(alpha)
	if (tint) {
		for (let i = 0; i < buffer.length; i += 4) {
			const a = buffer[i + 3] / 255
			buffer[i] = Math.round(tint[2] * a)
			buffer[i + 1] = Math.round(tint[1] * a)
			buffer[i + 2] = Math.round(tint[0] * a)
		}
	}
	const result = nativeImage
		.createFromBitmap(buffer, { width: px, height: px, scaleFactor: SCALE })
		.crop({ x: 2, y: 0, width: SIZE - 4, height: SIZE })
	result.setTemplateImage(!tint)
	return result
}

function dot(tint: Rgb) {
	const px = 12
	const buffer = Buffer.alloc(px * px * 4)
	for (let y = 0; y < px; y++) {
		for (let x = 0; x < px; x++) {
			let hit = 0
			for (let s = 0; s < 16; s++) {
				const dx = x + ((s % 4) + 0.5) / 4 - px / 2
				const dy = y + (Math.floor(s / 4) + 0.5) / 4 - px / 2
				if (dx * dx + dy * dy <= 16) hit++
			}
			const a = hit / 16
			const o = (y * px + x) * 4
			buffer[o] = Math.round(tint[2] * a)
			buffer[o + 1] = Math.round(tint[1] * a)
			buffer[o + 2] = Math.round(tint[0] * a)
			buffer[o + 3] = Math.round(a * 255)
		}
	}
	return nativeImage.createFromBitmap(buffer, { width: px, height: px, scaleFactor: 2 })
}

const label = (session: Session) => {
	const title = session.title?.trim() || "Untitled"
	return title.length > 48 ? `${title.slice(0, 47)}…` : title
}

export default Plugin.define({
	os: ["macos"],
	setup(ctx) {
		const bridge = ctx.main(Bridge)
		bridge.on("open", (id) => ctx.tabs.open({ server: "sidecar", id }, { focus: true }))
		const syncPhase = () => void bridge.phase(performance.timeOrigin, { signal: ctx.signal }).catch(() => {})
		syncPhase()
		window.addEventListener("focus", syncPhase)
		onCleanup(() => window.removeEventListener("focus", syncPhase))
	},
	main(ctx) {
		const logo = mark()
		const frames = <T,>(fn: (t: number) => T) => Array.from({ length: FRAMES }, (_, i) => fn(i / FRAMES))
		const icons = { idle: image(logo), frames: frames((t) => image(radarFrame(t))) }
		const attention = {
			idle: image(logo, ORANGE),
			frames: frames((t) => image(radarFrame(t, SIZE * SCALE, 0.35), ORANGE)),
		}
		const small = { idle: mark(PILL_ICON), frames: frames((t) => radarFrame(t, PILL_ICON)) }
		const text = textRenderer()
		const waitingDot = dot(ORANGE)
		const unreadDot = dot(BLUE)

		const tray = new Tray(icons.idle)
		tray.setToolTip("OpenCode")

		let running: Session[] = []
		let unread: Session[] = []
		let waiting: Session[] = []
		let spinner: ReturnType<typeof setInterval> | undefined
		let origin = performance.timeOrigin

		const provider = ctx.provide(Bridge, {
			phase: (next) => {
				origin = next
			},
		})

		const focusApp = () => {
			app.focus({ steal: true })
			const window = ctx.windows.focused() ?? ctx.windows.list()[0]
			if (!window) return undefined
			if (window.isMinimized()) window.restore()
			window.show()
			window.focus()
			return window
		}

		const open = (session: Session) => {
			const window = focusApp()
			provider.emit("open", session.id, window?.id)
		}

		const paint = () => {
			const elapsed = performance.timeOrigin + performance.now() - origin
			const frame = Math.floor(frac(elapsed / (radarLoop * 1000)) * FRAMES)
			if (waiting.length > 0) {
				tray.setImage(spinner ? attention.frames[frame] : attention.idle)
				tray.setTitle(unread.length > 0 ? String(unread.length) : "", { fontType: "monospacedDigit" })
				return
			}
			if (unread.length === 0) {
				tray.setImage(spinner ? icons.frames[frame] : icons.idle)
				tray.setTitle("")
				return
			}
			const count = String(unread.length)
			text.load(count, paint)
			tray.setTitle("")
			tray.setImage(pill(spinner ? small.frames[frame] : small.idle, text.get(count)))
		}

		const render = () => {
			if (running.length > 0 && !spinner) {
				spinner = setInterval(paint, (radarLoop * 1000) / FRAMES)
			}
			if (running.length === 0 && spinner) {
				clearInterval(spinner)
				spinner = undefined
			}
			paint()
			tray.setToolTip(
				[
					waiting.length ? `${waiting.length} waiting for you` : undefined,
					running.length ? `${running.length} running` : undefined,
					unread.length ? `${unread.length} unread` : undefined,
				]
					.filter(Boolean)
					.join(", ") || "OpenCode",
			)

			const section = (title: string, list: Session[], icon?: Electron.NativeImage): MenuItemConstructorOptions[] =>
				list.length === 0
					? []
					: [
							{ label: title, enabled: false },
							...list.slice(0, 15).map((session) => ({ label: label(session), icon, click: () => open(session) })),
							{ type: "separator" },
						]
			const waitingIDs = new Set(waiting.map((session) => session.id))

			const items: MenuItemConstructorOptions[] = [
				...section("Waiting for you", waiting, waitingDot),
				...section(
					"Running",
					running.filter((session) => !waitingIDs.has(session.id)),
				),
				...section("Unread", unread, unreadDot),
				...(running.length + unread.length + waiting.length === 0
					? [{ label: "Nothing new", enabled: false }, { type: "separator" as const }]
					: []),
				{ label: "Show OpenCode", click: () => void focusApp() },
			]
			tray.setContextMenu(Menu.buildFromTemplate(items))
		}

		let refreshing = false
		let again = false
		const refresh = async () => {
			if (ctx.signal.aborted) return
			if (refreshing) {
				again = true
				return
			}
			refreshing = true
			try {
				const client = ctx.client
				const [active, list] = await Promise.all([
					client.session.active(),
					client.session.list({ limit: 200, order: "desc", archived: false }),
				])
				const sessions = list.data as Session[]
				const byID = new Map(sessions.map((session) => [session.id, session]))
				const busy = new Set(Object.keys(active))
				running = [...busy]
					.map((id) => byID.get(id))
					.filter((session): session is Session => !!session && !session.parentID)
				// Keep the spinner going for subagents whose parent is not in the recent list.
				if (running.length === 0 && busy.size > 0) running = [...busy].map((id) => ({ id, time: { updated: 0 } }))
				const rootSession = async (id: string) => {
					let session = byID.get(id) ?? (await client.session.get({ sessionID: id }).catch(() => undefined))
					for (let depth = 0; session?.parentID && depth < 10; depth++) {
						const parentID: string = session.parentID
						session = byID.get(parentID) ?? (await client.session.get({ sessionID: parentID }).catch(() => undefined))
					}
					return session
				}
				let prompts = 0
				const waitingSessions = await Promise.all(
					[...busy].map(async (sessionID) => {
						const [permissions, forms] = await Promise.all([
							client.permission.list({ sessionID }).catch(() => []),
							client.session.form.list({ sessionID }).catch(() => []),
						])
						const count = permissions.length + forms.length
						prompts += count
						return count > 0 ? rootSession(sessionID) : undefined
					}),
				)
				if (ctx.signal.aborted) return
				waiting = [...new Map(waitingSessions.filter((s): s is Session => !!s).map((s) => [s.id, s])).values()]
				unread = sessions.filter(
					(session) =>
						!session.parentID &&
						!session.time.archived &&
						!busy.has(session.id) &&
						// Sessions never opened in the app (no `viewed`, e.g. from `opencode run`) aren't marked unread there.
						session.time.idle !== undefined &&
						session.time.viewed !== undefined &&
						session.time.idle > session.time.viewed,
				)
				app.dock?.setBadge(prompts > 0 ? String(prompts) : "")
				render()
			} catch (error) {
				ctx.log.write("warn", "status refresh failed", { error: String(error) })
			} finally {
				refreshing = false
				if (again) {
					again = false
					void refresh()
				}
			}
		}

		let timer: ReturnType<typeof setTimeout> | undefined
		const schedule = () => {
			if (timer) return
			timer = setTimeout(() => {
				timer = undefined
				void refresh()
			}, 250)
		}

		const listen = async () => {
			while (!ctx.signal.aborted) {
				try {
					for await (const event of ctx.client.event.subscribe({ types: [...EVENTS], signal: ctx.signal })) {
						if (event.type === "server.connected") void refresh()
						else schedule()
					}
				} catch (error) {
					if (ctx.signal.aborted) return
					ctx.log.write("debug", "status event stream dropped", { error: String(error) })
				}
				await new Promise((resolve) => setTimeout(resolve, 2000))
			}
		}

		render()
		void refresh()
		void listen()
		const poll = setInterval(() => void refresh(), 30_000)

		return () => {
			clearInterval(poll)
			if (spinner) clearInterval(spinner)
			if (timer) clearTimeout(timer)
			app.dock?.setBadge("")
			text.dispose()
			tray.destroy()
		}
	},
})
