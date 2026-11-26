import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { parseSearchResults } from "../src/results.ts"

const toolResult = (payload: Record<string, unknown>) => ({
	content: [{ type: "text" as const, text: JSON.stringify(payload) }],
	structuredContent: payload,
})

describe("parseSearchResults", () => {
	it("extracts, normalizes, and deduplicates web search results", () => {
		const payload = {
			search_result_groups: [
				{
					search_result_type: "webResults",
					items: [
						{
							title: "Example Page",
							url: "https://example.com/a",
							snippets: ["First snippet", "Second snippet"],
							last_updated_date: "2026-11-01T00:00:00Z",
						},
						{
							title: "Duplicate URL",
							url: "https://example.com/a",
							snippets: ["Ignored"],
						},
						{
							title: "Fallback semantic doc",
							url: "https://example.com/b",
							snippets: [],
							semantic_document: "Semantic content",
						},
						{
							title: "Malformed snippets",
							url: "https://example.com/c",
							snippets: "not an array",
						},
						{
							title: "Invalid URL",
							url: "javascript:alert(1)",
							snippets: ["Ignored"],
						},
					],
				},
			],
		}

		const results = parseSearchResults(toolResult(payload))

		assert.deepEqual(results, [
			{
				url: "https://example.com/a",
				title: "Example Page",
				content: "First snippet\n\nSecond snippet",
				time: { published: Date.parse("2026-11-01T00:00:00Z") },
			},
			{
				url: "https://example.com/b",
				title: "Fallback semantic doc",
				content: "Semantic content",
				time: {},
			},
		])
	})

	it("throws on tool errors and payload error_message", () => {
		assert.throws(
			() => parseSearchResults({ isError: true, content: [{ type: "text", text: "Unauthorized" }] }),
			/Unauthorized/,
		)
		assert.throws(() => parseSearchResults(toolResult({ error_message: "Web search disabled" })), /Web search disabled/)
	})

	it("rejects responses without structured content", () => {
		assert.throws(() => parseSearchResults({ content: [{ type: "text", text: "{}" }] }), /unexpected response/)
	})

	it("reads Bing dates without an offset as UTC", () => {
		const published = Date.parse("2026-10-22T00:00:00Z")
		const results = parseSearchResults(
			toolResult({
				search_result_groups: [
					{
						items: [
							{ url: "https://a.example", last_updated_date: "2026-10-22T00:00:00.0000000" },
							{ url: "https://b.example", last_updated_date: "2026-10-22T02:00:00+02:00" },
						],
					},
				],
			}),
		)
		assert.deepEqual(
			results.map((r) => r.time.published),
			[published, published],
		)
	})
})
