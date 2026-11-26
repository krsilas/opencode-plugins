import type { CallToolResult } from "@modelcontextprotocol/client"
import type { WebSearch } from "@opencode/plugin"
import { BingSearchItem, BingSearchPayload } from "./types.ts"

const HAS_UTC_OFFSET = /(?:Z|[+-]\d{2}:?\d{2})$/i

function parseTimestamp(text: string | null | undefined): number | undefined {
	if (!text) return undefined
	/** Bing omits the offset on UTC timestamps, which Date.parse would read as local time. */
	const timeStamp = HAS_UTC_OFFSET.test(text) || !text.includes("T") ? text : `${text}Z`
	const parsed = Date.parse(timeStamp)
	return Number.isFinite(parsed) ? parsed : undefined
}

export function parseSearchResults(result: CallToolResult): WebSearch.Result[] {
	const text = result.content.find((part) => part.type === "text")?.text

	if (result.isError) {
		throw new Error(`Copilot web search failed: ${text || "unknown error"}`)
	}

	const parsed = BingSearchPayload.safeParse(result.structuredContent)
	if (!parsed.success) {
		throw new Error("Copilot web search returned an unexpected response.", { cause: parsed.error })
	}
	const payload = parsed.data

	const results = (payload.search_result_groups ?? [])
		.flatMap((group) => group.items ?? [])
		.map((raw) => BingSearchItem.safeParse(raw).data)
		.filter((item) => item !== undefined)
		.filter((item, index, items) => items.findIndex((other) => other.url === item.url) === index)
		.map((item): WebSearch.Result => {
			const snippets = item.snippets?.filter(Boolean) ?? []
			const content = snippets.length > 0 ? snippets.join("\n\n") : item.semantic_document
			const published = parseTimestamp(item.last_updated_date) ?? parseTimestamp(item.crawled_at)
			return {
				url: item.url,
				...(item.title ? { title: item.title } : {}),
				...(content ? { content } : {}),
				time: published !== undefined ? { published } : {},
			}
		})

	if (results.length === 0 && payload.error_message) {
		throw new Error(`Copilot web search failed: ${payload.error_message}`)
	}

	return results
}
