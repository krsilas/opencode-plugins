import { z } from "zod/mini"

export interface CopilotAuth {
	token: string
	url: string
}

const Text = z.string().check(z.trim())

export const CopilotMetadata = z.object({
	apiEndpoint: z.nullish(Text),
	enterpriseUrl: z.nullish(Text),
})

export const BingSearchItem = z.object({
	url: z.url({ protocol: /^https?$/ }).check(z.trim()),
	title: z.nullish(Text),
	snippets: z.nullish(z.array(Text)),
	semantic_document: z.nullish(Text),
	last_updated_date: z.nullish(Text),
	crawled_at: z.nullish(Text),
})

export type BingSearchItem = z.infer<typeof BingSearchItem>

export const BingSearchPayload = z.object({
	search_result_groups: z.nullish(z.array(z.object({ items: z.nullish(z.array(z.unknown())) }))),
	error_message: z.nullish(Text),
})

export type BingSearchPayload = z.infer<typeof BingSearchPayload>
