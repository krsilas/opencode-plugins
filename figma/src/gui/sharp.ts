import type { WebContents } from "electron"
import { Schema } from "effect"

export interface Region {
	x: number
	y: number
	width: number
	height: number
}

const MAX_SCALE = 8

const MAX_PAGE_EDGE = 8192

const FIRST = 400

const STEP = 250

const SETTLE = 4000

const decodeZoom = Schema.decodeUnknownSync(Schema.Finite.check(Schema.isGreaterThan(0)))

const decodeNonEmptyString = Schema.decodeUnknownSync(Schema.String.check(Schema.isMinLength(1)))

const decodeString = Schema.decodeUnknownSync(Schema.String)

const decodeScreenshot = Schema.decodeUnknownSync(Schema.Struct({ data: Schema.String }))

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

const within = <T>(promise: Promise<T>, ms: number) =>
	Promise.race([
		promise,
		sleep(ms).then((): never => {
			throw new Error("capture timed out")
		}),
	])

const figmaFrame = (contents: WebContents) =>
	contents.mainFrame.framesInSubtree.find(
		(frame) =>
			frame !== contents.mainFrame && URL.canParse(frame.url) && new URL(frame.url).hostname.endsWith("figma.com"),
	)

export async function figmaZoom(contents: WebContents): Promise<number | undefined> {
	const frame = figmaFrame(contents)

	if (!frame) return undefined

	return within(
		frame
			.executeJavaScript(
				"window._fullscreen_ && window._fullscreen_._viewportInfo && window._fullscreen_._viewportInfo.zoomScale",
			)
			.then(decodeZoom),
		1000,
	).catch(() => undefined)
}

export async function figmaUpdatedAt(contents: WebContents): Promise<string | undefined> {
	const frame = figmaFrame(contents)

	if (!frame) return undefined

	return within(
		frame
			.executeJavaScript(
				"(() => { try { const f = window.INITIAL_OPTIONS && window.INITIAL_OPTIONS.file; return f && (f.updated_at || f.touched_at) || null } catch { return null } })()",
			)
			.then(decodeNonEmptyString),
		1000,
	).catch(() => undefined)
}

export async function figmaNodeName(contents: WebContents, id: string): Promise<string | undefined> {
	const frame = figmaFrame(contents)

	if (!frame) return undefined

	const script = `(() => {
    const id = ${JSON.stringify(id)}
    try {
      const node = window.figma && window.figma.getNodeById && window.figma.getNodeById(id)
      if (node && node.name) return node.name
    } catch {}
    try {
      const scene = window._fullscreen_ && window._fullscreen_.getSceneGraph && window._fullscreen_.getSceneGraph()
      const node = scene && scene.get && scene.get(id)
      if (node && node.name) return node.name
    } catch {}
    return null
  })()`

	const name = await within(frame.executeJavaScript(script).then(decodeString), 1000).catch(() => undefined)

	return name?.trim() || undefined
}

// DevTools' device scale override doesn't reach cross-origin iframes, so we combine page zoom with an enlarged emulated viewport.
export async function sharpCapture(
	contents: WebContents,
	page: { width: number; height: number },
	region: Region,
	base: number,
	density: number,
): Promise<Buffer> {
	const scale = Math.max(base, Math.min(density, MAX_SCALE, MAX_PAGE_EDGE / Math.max(page.width, page.height)))
	const zoom = scale / base
	const debug = contents.debugger
	const own = !debug.isAttached()
	const previous = contents.getZoomFactor()

	if (own) debug.attach("1.3")

	const shot = async () => {
		const result = await within(
			debug
				.sendCommand("Page.captureScreenshot", {
					format: "png",
					clip: {
						x: region.x * zoom,
						y: region.y * zoom,
						width: region.width * zoom,
						height: region.height * zoom,
						scale: 1,
					},
					captureBeyondViewport: false,
				})
				.then(decodeScreenshot),
			5000,
		)

		return result.data
	}

	try {
		if (zoom > 1) {
			await debug.sendCommand("Emulation.setDeviceMetricsOverride", {
				width: Math.round(page.width * zoom),
				height: Math.round(page.height * zoom),
				deviceScaleFactor: base,
				mobile: false,
			})
			contents.setZoomFactor(previous * zoom)
		}

		// Figma redraws its canvas over several frames; keep shooting until two shots match.
		await sleep(FIRST)
		let last = await shot()
		const end = Date.now() + SETTLE

		while (Date.now() < end) {
			await sleep(STEP)
			const next = await shot()

			if (next === last) break
			last = next
		}

		return Buffer.from(last, "base64")
	} finally {
		if (!contents.isDestroyed()) contents.setZoomFactor(previous)
		await debug.sendCommand("Emulation.clearDeviceMetricsOverride").catch(() => {})

		if (own && debug.isAttached()) debug.detach()
	}
}
