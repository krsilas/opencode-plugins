import { Option, Schema } from "effect"
import { fileKey, figmaUrl } from "./url.ts"

const Bootstrap = Schema.fromJsonString(
	Schema.Struct({
		INITIAL_OPTIONS: Schema.Struct({
			editing_file: Schema.Struct({
				key: Schema.String,
				can_access_full_dev_mode: Schema.Boolean,
			}),
		}),
	}),
)

const decodeBootstrap = Schema.decodeUnknownOption(Bootstrap)

export function devModeAccess(html: string, key: string): boolean | null {
	const data = /<script\b(?=[^>]*\bdata-initial(?:\s|=|>))[^>]*>([\s\S]*?)<\/script>/i.exec(html)?.[1]

	if (!data) return null
	const parsed = decodeBootstrap(data)

	if (Option.isNone(parsed)) return null
	const file = parsed.value.INITIAL_OPTIONS.editing_file

	return file.key === key ? file.can_access_full_dev_mode : null
}

export async function readDevModeAccess(
	sessionFetch: (url: string, init: RequestInit) => Promise<Response>,
	source: string,
	signal: AbortSignal,
): Promise<boolean | null> {
	const key = fileKey(source)

	if (!key) return null
	const url = new URL(figmaUrl(source, { view: "file", dev: false }))
	url.hostname = "www.figma.com"
	url.searchParams.delete("m")
	url.searchParams.delete("mode")

	return sessionFetch(url.toString(), { signal })
		.then(async (response) => (response.ok ? devModeAccess(await response.text(), key) : null))
		.catch(() => null)
}
