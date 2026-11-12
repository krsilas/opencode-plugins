const PATH = /^\/(file|design|proto|board|slides|deck)\/[A-Za-z0-9]+/

const TRANSIENT_PARAMS = ["t", "m", "mode"]

export type View = "node" | "file"

export type Theme = "light" | "dark"

export interface EmbedOptions {
	view: View
	dev: boolean
	theme: Theme
}

export interface FigmaLink {
	url: string
	dev: boolean
}

export function parseFigmaUrl(input: string): FigmaLink | undefined {
	const raw = input.trim()

	if (!URL.canParse(raw)) return undefined
	const url = new URL(raw)

	if (url.protocol !== "https:") return undefined

	if (url.hostname !== "figma.com" && !url.hostname.endsWith(".figma.com")) return undefined

	if (!PATH.test(url.pathname)) return undefined
	const dev = url.searchParams.get("m") === "dev" || url.searchParams.get("mode") === "dev"
	url.hostname = "www.figma.com"

	for (const key of TRANSIENT_PARAMS) url.searchParams.delete(key)

	return { url: url.toString(), dev }
}

const kind = (url: string) => new URL(url).pathname.split("/").filter(Boolean)[0]

export function hasNode(url: string): boolean {
	return new URL(url).searchParams.has("node-id")
}

export function supportsDev(url: string): boolean {
	const type = kind(url)

	return type === "design" || type === "file"
}

export function figmaUrl(url: string, options: Pick<EmbedOptions, "view" | "dev">): string {
	const target = new URL(url)
	target.searchParams.delete("t")

	if (options.view === "file") target.searchParams.delete("node-id")

	if (options.dev && supportsDev(url)) target.searchParams.set("m", "dev")

	return target.toString()
}

export function embedUrl(url: string, options: EmbedOptions): string {
	const embed = new URL(url)
	embed.hostname = "embed.figma.com"
	embed.pathname = embed.pathname.replace(/^\/file\//, "/design/")

	for (const key of TRANSIENT_PARAMS) embed.searchParams.delete(key)

	if (options.view === "file") embed.searchParams.delete("node-id")
	embed.searchParams.set("embed-host", "opencode-plugin")
	embed.searchParams.set("footer", "false")
	embed.searchParams.set("theme", options.theme)
	embed.searchParams.set("page-selector", "false")

	if (options.dev && supportsDev(url)) embed.searchParams.set("mode", "dev")

	return embed.toString()
}

export function nodeId(url: string): string | undefined {
	if (!URL.canParse(url)) return undefined

	return new URL(url).searchParams.get("node-id")?.replace(/-/g, ":") || undefined
}

export function fileName(url: string): string {
	const segments = new URL(url).pathname.split("/").filter(Boolean)
	const slug = segments[2]

	return slug ? decodeURIComponent(slug).replace(/-/g, " ") : "Figma"
}

export function toolbarKey(url: string, updatedAt: string | undefined): string | undefined {
	return url ? `${fileName(url)}\n${updatedAt ?? ""}` : undefined
}

export function fileKey(url: string): string | undefined {
	if (!URL.canParse(url)) return undefined

	return new URL(url).pathname.split("/").filter(Boolean)[1]
}

export function targetKey(url: string, view?: View): string | undefined {
	const key = fileKey(url)

	if (!key) return undefined
	const node = view === "file" ? undefined : nodeId(url)

	return node ? `${key}\n${node}` : key
}

export function fileLink(kind: "design" | "board" | "slides", key: string, name: string): string {
	const slug = encodeURIComponent(name.trim().replace(/\s+/g, "-"))

	return `https://www.figma.com/${kind}/${encodeURIComponent(key)}${slug ? `/${slug}` : ""}`
}
