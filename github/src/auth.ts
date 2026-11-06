import { Option, Schema } from "effect"
import type { Json } from "@opencode/plugin/gui"
import { client } from "./api.ts"
import { hostname } from "./hosts.ts"

const PREFIX = "auth/"

const SavedToken = Schema.Struct({
	token: Schema.String.check(Schema.isMinLength(1)),
	user: Schema.String.check(Schema.isMinLength(1)),
})

type SavedToken = typeof SavedToken.Type

const decodeSavedToken = Schema.decodeUnknownOption(SavedToken)

export const Account = Schema.Struct({
	host: Schema.String,
	user: Schema.String,
})

export type Account = typeof Account.Type

export interface Storage {
	get(key: string): Promise<Json | undefined>
	set(key: string, value: SavedToken): Promise<void>
	remove(key: string): Promise<void>
	scan(options: { prefix: string; after?: string }): Promise<{
		entries: readonly { key: string; value: Json }[]
		next?: string
	}>
}

export const tokens = (storage: Storage) => ({
	async get(host: string) {
		const parsed = decodeSavedToken(await storage.get(`${PREFIX}${hostname(host)}`))

		return Option.isSome(parsed) ? parsed.value.token : undefined
	},
	async accounts(): Promise<Account[]> {
		const accounts: Account[] = []
		let after: string | undefined

		do {
			const options = after ? { prefix: PREFIX, after } : { prefix: PREFIX }
			const page = await storage.scan(options)

			for (const entry of page.entries) {
				const parsed = decodeSavedToken(entry.value)

				if (Option.isSome(parsed)) accounts.push({ host: entry.key.slice(PREFIX.length), user: parsed.value.user })
			}

			after = page.next
		} while (after)

		return accounts.sort((a, b) => a.host.localeCompare(b.host))
	},
	async set(host: string, value: string | null, signal?: AbortSignal) {
		const normalized = hostname(host)
		const key = `${PREFIX}${normalized}`

		if (value === null) {
			await storage.remove(key)

			return
		}

		const token = value.trim()

		if (!token || /\s/.test(token)) throw new Error("Enter a personal access token")
		const result = await client(normalized, { get: async () => token }).rest("GET /user", { request: { signal } })
		const user = result.data?.login
		const scopeHeader = result.headers["x-oauth-scopes"]

		if (typeof user !== "string" || !user) throw new Error("GitHub did not return an account for this token")

		const isClassicToken = token.startsWith("ghp_") || /^[a-f0-9]{40}$/i.test(token)
		if (!token.startsWith("github_pat_") && (isClassicToken || scopeHeader !== undefined)) {
			if (scopeHeader === undefined)
				throw new Error("GitHub did not return the classic token's scopes. Cannot verify the required repo scope.")
			const scopes = scopeHeader.split(",").map((scope) => scope.trim())
			if (!scopes.includes("repo"))
				throw new Error(
					"This classic token needs the repo scope. Update its scopes or create a new token and try again.",
				)
		}
		await storage.set(key, { token, user })
	},
})
