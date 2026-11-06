import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import { Predicate } from "effect"
import type { Theme } from "./url"

// The page the view loads: the Embed Kit 2.0 iframe filling the viewport. It is served from loopback so it has a real
// origin to embed from (Figma's embed and its login flow misbehave under the opaque origin of a data: URL).

const BACKGROUND: Record<Theme, string> = { light: "#ffffff", dark: "#1e1e1e" }

const escape = (value: string) =>
	value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

const page = (src: string, theme: Theme) => `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="color-scheme" content="${theme}">
<style>
html, body { margin: 0; height: 100%; overflow: hidden; background: ${BACKGROUND[theme]}; }
iframe { display: block; width: 100%; height: 100%; border: 0; }
</style>
</head>
<body>
<iframe src="${escape(src)}" allow="clipboard-read; clipboard-write; fullscreen" allowfullscreen></iframe>
</body>
</html>
`

const handle = (req: IncomingMessage, res: ServerResponse) => {
	const url = new URL(req.url ?? "/", "http://127.0.0.1")
	const src = url.searchParams.get("src") ?? ""
	const theme: Theme = url.searchParams.get("theme") === "dark" ? "dark" : "light"

	if (req.method !== "GET" || url.pathname !== "/" || !src.startsWith("https://embed.figma.com/")) {
		res.writeHead(404).end()

		return
	}

	res
		.writeHead(200, {
			"content-type": "text/html; charset=utf-8",
			"cache-control": "no-store",
			"content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; frame-src https://*.figma.com",
		})
		.end(page(src, theme))
}

export function createHost() {
	let server: Server | undefined
	let port: Promise<number> | undefined

	const start = () =>
		(port ??= new Promise<number>((resolve, reject) => {
			const created = createServer(handle)
			server = created
			created.once("error", (cause) => {
				port = undefined
				reject(cause)
			})
			created.listen(0, "127.0.0.1", () => {
				const address = created.address()

				if (!address || Predicate.isString(address)) {
					created.close()
					port = undefined
					reject(new Error("Could not bind Figma host server"))

					return
				}

				resolve(address.port)
			})
		}))

	return {
		// Each view gets its own `<label>.localhost` subdomain because Chromium shares page zoom per host.
		url: async (src: string, theme: Theme, label: string) => {
			const bound = await start()
			const target = new URL(`http://${label}.localhost:${bound}/`)
			target.searchParams.set("src", src)
			target.searchParams.set("theme", theme)

			return target.toString()
		},
		owns: (raw: string) => {
			if (!server?.listening || !URL.canParse(raw)) return false
			const address = server.address()

			if (!address || Predicate.isString(address)) return false
			const url = new URL(raw)

			return url.protocol === "http:" && url.hostname.endsWith(".localhost") && url.port === String(address.port)
		},
		close: () => {
			server?.close()
			server = undefined
			port = undefined
		},
	}
}
