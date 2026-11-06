import { readFile, stat } from "node:fs/promises"
import { basename, extname, isAbsolute, resolve } from "node:path"
import type { Attachment } from "./types"

const SUPPORTED_CONTENT_TYPES = {
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
	".svg": "image/svg+xml",
	".mp4": "video/mp4",
	".mov": "video/quicktime",
	".webm": "video/webm",
} as const

const EXTENSIONS = new Map<string, string>(Object.entries(SUPPORTED_CONTENT_TYPES))

const MAX_IMAGE = 10 * 1024 * 1024

const MAX_VIDEO = 100 * 1024 * 1024

export const contentType = (path: string) => EXTENSIONS.get(extname(path).toLowerCase())

export const isVideo = (path: string) => !!contentType(path)?.startsWith("video/")

export const uploadsUrl = (host: string) => {
	if (host !== "github.com" && !host.endsWith(".ghe.com"))
		throw new Error(`Attaching files is not supported on GitHub Enterprise Server (${host})`)

	return `https://uploads.${host}/user-attachments/assets`
}

export const validate = async (
	directory: string,
	items: readonly { path: string; alt?: string }[],
): Promise<Attachment[]> => {
	const seen = new Set<string>()
	const result: Attachment[] = []

	for (const item of items) {
		const path = isAbsolute(item.path) ? item.path : resolve(directory, item.path)

		if (seen.has(path)) continue
		seen.add(path)
		const type = contentType(path)

		if (!type)
			throw new Error(
				`${item.path}: unsupported file type; use ${Object.keys(SUPPORTED_CONTENT_TYPES)
					.map((ext) => ext.slice(1))
					.join(", ")}`,
			)
		const info = await stat(path).catch(() => undefined)

		if (!info?.isFile()) throw new Error(`${item.path}: file not found`)

		if (info.size === 0) throw new Error(`${item.path}: file is empty`)
		const video = type.startsWith("video/")

		if (info.size > (video ? MAX_VIDEO : MAX_IMAGE))
			throw new Error(`${item.path}: ${video ? "videos" : "images"} must be at most ${video ? 100 : 10} MB`)

		if (video && item.alt) throw new Error(`${item.path}: videos cannot have alt text`)

		const entry: Attachment = item.alt ? { path, name: basename(path), alt: item.alt } : { path, name: basename(path) }

		result.push(entry)
	}

	return result
}

export const read = async (attachment: Attachment) => {
	const type = contentType(attachment.path)

	if (!type) throw new Error(`${attachment.name}: unsupported file type`)

	return { bytes: await readFile(attachment.path), type }
}

const MARKDOWN_LINK_OR_IMAGE =
	/(!?)\[((?:\\.|[^\]\\])*)\]\(\s*(<[^>\n]*>|[^\s)]+)(\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/g

const unescape = (value: string) => value.replace(/\\([!-/:-@[-`{-~])/g, "$1")

const decode = (value: string) => {
	try {
		return decodeURIComponent(value)
	} catch {
		return value
	}
}

const escapeAlt = (value: string) => value.replace(/[\\[\]]/g, "\\$&").replace(/\n/g, " ")

export const attach = (body: string, directory: string, uploaded: { attachment: Attachment; url: string }[]) => {
	const byPath = new Map(uploaded.map((item) => [item.attachment.path, item]))
	const used = new Set<string>()

	const find = (dest: string) => {
		if (/^[a-z][a-z0-9+.-]+:/i.test(dest) || dest.startsWith("//") || dest.startsWith("#")) return undefined

		for (const spelling of new Set([dest, unescape(dest), decode(dest), decode(unescape(dest))])) {
			const match = byPath.get(isAbsolute(spelling) ? spelling : resolve(directory, spelling))

			if (match) return match
		}

		return undefined
	}

	const rewrite = (text: string, alone: boolean) =>
		text.replace(MARKDOWN_LINK_OR_IMAGE, (whole, bang: string, label: string, raw: string, title = "") => {
			const dest = raw.startsWith("<") ? raw.slice(1, -1) : raw
			const match = find(dest)

			if (!match) return whole
			used.add(match.attachment.path)

			if (!isVideo(match.attachment.path) || !bang) return `${bang}[${label}](${match.url}${title})`

			if (alone && text.trim() === whole) return match.url

			return `[${label || escapeAlt(match.attachment.name)}](${match.url})`
		})

	const out: string[] = []
	let fence: string | undefined
	let paragraph: string[] = []

	const rewriteLine = (line: string, alone: boolean) =>
		line
			.split(/(`+[^`]*`+)/)
			.map((part, index) => (index % 2 ? part : rewrite(part, alone && line.trim() === part.trim())))
			.join("")

	const flush = () => {
		if (!paragraph.length) return
		const alone = paragraph.length === 1

		for (const line of paragraph) out.push(rewriteLine(line, alone))
		paragraph = []
	}

	for (const line of body.split("\n")) {
		const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/)?.[1]

		if (fence) {
			out.push(line)

			if (marker && marker[0] === fence[0] && marker.length >= fence.length) fence = undefined
			continue
		}

		if (marker) {
			flush()
			fence = marker
			out.push(line)
			continue
		}

		if (!line.trim()) {
			flush()
			out.push(line)
			continue
		}

		paragraph.push(line)
	}

	flush()

	const appended = uploaded.flatMap((item) => {
		if (used.has(item.attachment.path)) return []

		const line = isVideo(item.attachment.path)
			? item.url
			: `![${escapeAlt(item.attachment.alt ?? item.attachment.name.replace(/\.[^.]+$/, "").replace(/\./g, " "))}](${item.url})`

		return [line]
	})

	const text = out.join("\n")

	if (!appended.length) return text

	return [text.trimEnd(), ...appended].filter(Boolean).join("\n\n")
}
