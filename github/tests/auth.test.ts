import assert from "node:assert/strict"
import { afterEach, beforeEach, mock, test } from "node:test"
import { execFileSync } from "node:child_process"
import { mkdtemp, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import type { Json } from "@opencode/plugin/gui"
import { AuthError, client } from "../src/api.ts"
import { tokens, type Storage } from "../src/auth.ts"
import { hostInput, hostname, settingsHosts, tokenUrl } from "../src/hosts.ts"
import plugin from "../src/index.ts"
import { GitHub } from "../src/rpc.ts"

let fetch: ReturnType<typeof mock.method<typeof globalThis, "fetch">>

beforeEach(() => {
	fetch = mock.method(globalThis, "fetch", async () => {
		throw new Error("Unexpected fetch")
	})
})
afterEach(() => {
	fetch.mock.restore()
})

function storage(): Storage & { values: Map<string, Json> } {
	const values = new Map<string, Json>()

	return {
		values,
		async get(key: string) {
			return values.get(key)
		},
		async set(key: string, value: { token: string; user: string }) {
			values.set(key, value)
		},
		async remove(key: string) {
			values.delete(key)
		},
		async scan(options: { prefix: string; after?: string }) {
			const entries = [...values]
				.filter(([key]) => key.startsWith(options.prefix) && (!options.after || key > options.after))
				.sort(([a], [b]) => a.localeCompare(b))
				.map(([key, value]) => ({ key, value }))

			return { entries: entries.slice(0, 1), next: entries.length > 1 ? entries[0]!.key : undefined }
		},
	}
}

function accountResponse(url: string | URL | Request, login: string, scopes?: string): Response {
	if (!String(url).endsWith("/user")) throw new Error(`Unexpected validation request: ${url}`)
	return Response.json({ login }, scopes === undefined ? undefined : { headers: { "X-OAuth-Scopes": scopes } })
}

test("validates and persists a trimmed PAT, exposing only host and login to settings", async () => {
	const stored = storage()
	const auth = tokens(stored)
	const controller = new AbortController()
	fetch.mock.mockImplementation(async (url) => accountResponse(url, "octocat", "repo, user"))
	await auth.set(" GitHub.COM ", "  ghp_test  ", controller.signal)
	assert.strictEqual(fetch.mock.callCount(), 1)

	assert.partialDeepStrictEqual(fetch.mock.calls[0]?.arguments, [
		"https://api.github.com/user",
		{
			method: "GET",
			signal: controller.signal,
			headers: { authorization: "Bearer ghp_test" },
		},
	])
	assert.strictEqual(await auth.get("github.com"), "ghp_test")
	assert.deepStrictEqual(await auth.accounts(), [{ host: "github.com", user: "octocat" }])
	assert.ok(!JSON.stringify(await auth.accounts()).includes("ghp_test"))
	assert.strictEqual(await tokens(stored).get("github.com"), "ghp_test")
})

test("classic and OAuth tokens require the repo scope before replacing a working token", async () => {
	const stored = storage()
	stored.values.set("auth/github.com", { token: "working", user: "octocat" })
	const auth = tokens(stored)

	for (const [token, scopes] of [
		["ghp_replacement", ""],
		["ghp_replacement", "user, public_repo"],
		["ghp_replacement", "repo:status, repo_deployment"],
		["a".repeat(40), "repo:status"],
	] as const) {
		fetch.mock.mockImplementationOnce(async () =>
			Response.json({ login: "octocat" }, { headers: { "X-OAuth-Scopes": scopes } }),
		)
		await assert.rejects(auth.set("github.com", token), /needs the repo scope/)
		assert.strictEqual(await auth.get("github.com"), "working")
	}

	fetch.mock.mockImplementationOnce(async () => Response.json({ login: "octocat" }))
	await assert.rejects(auth.set("github.com", "ghp_test"), /did not return the classic token's scopes/)
	assert.strictEqual(await auth.get("github.com"), "working")

	fetch.mock.mockImplementationOnce(async (url) => accountResponse(url, "octocat", "user, repo"))
	await auth.set("github.com", "older-token")
	assert.strictEqual(await auth.get("github.com"), "older-token")
})

test("replacement and removal are immediately visible to existing clients and other plugin instances", async () => {
	const stored = storage()
	const auth = tokens(stored)
	const other = tokens(stored)
	const api = client("github.com", other)
	fetch.mock.mockImplementation(async (url) => accountResponse(url, "octocat"))

	await auth.set("github.com", "first")
	await auth.set("github.com", "second")
	await api.rest("GET /user")
	assert.partialDeepStrictEqual(fetch.mock.calls.at(-1)?.arguments[1]?.headers, { authorization: "Bearer second" })

	await auth.set("github.com", null)
	assert.strictEqual(await other.get("github.com"), undefined)
	assert.deepStrictEqual(await auth.accounts(), [])
	const calls = fetch.mock.calls.length
	await assert.rejects(api.rest("GET /user"), AuthError)
	assert.strictEqual(fetch.mock.callCount(), calls)
})

test("HTTP errors, network failures, and invalid account responses preserve existing credentials", async () => {
	const stored = storage()
	stored.values.set("auth/github.com", { token: "working", user: "octocat" })
	const auth = tokens(stored)

	for (const status of [401, 403, 500]) {
		fetch.mock.mockImplementationOnce(async () => Response.json({ message: "Rejected" }, { status }))
		await assert.rejects(auth.set("github.com", "replacement"))
	}
	fetch.mock.mockImplementationOnce(async () => {
		throw new Error("Offline")
	})
	await assert.rejects(auth.set("github.com", "replacement"), /Offline/)
	fetch.mock.mockImplementationOnce(async () => Response.json({}))
	await assert.rejects(auth.set("github.com", "replacement"), /did not return an account/)

	assert.strictEqual(await auth.get("github.com"), "working")
})

test("tokens are isolated per host and settings handles paginated storage without exposing secrets", async () => {
	const stored = storage()
	const auth = tokens(stored)
	fetch.mock.mockImplementation(async (url) => accountResponse(url, "octocat"))
	await auth.set("github.com", "public-token")
	await auth.set("git.example.com", "enterprise-token")
	stored.values.set("auth/invalid.example.com", {})
	stored.values.set("other/settings", { token: "unrelated", user: "other" })

	assert.strictEqual(await auth.get("github.com"), "public-token")
	assert.strictEqual(await auth.get("git.example.com"), "enterprise-token")
	assert.deepStrictEqual(await auth.accounts(), [
		{ host: "git.example.com", user: "octocat" },
		{ host: "github.com", user: "octocat" },
	])
	await auth.set("git.example.com", null)
	assert.strictEqual(await auth.get("github.com"), "public-token")
})

test("the settings list offers github.com and multiple independent ghe.com hosts", () => {
	assert.deepStrictEqual(settingsHosts([]), [{ host: "github.com" }])

	const accounts = [
		{ host: "second.ghe.com", user: "second-user" },
		{ host: "github.com", user: "public-user" },
		{ host: "first.ghe.com", user: "first-user" },
	]

	assert.deepStrictEqual(settingsHosts(accounts), [accounts[1]!, accounts[2]!, accounts[0]!])
	assert.strictEqual(accounts[0]!.host, "second.ghe.com")
	assert.strictEqual(settingsHosts(accounts.filter((item) => item.host !== "github.com")).length, 3)
})

test("host helpers normalize HTTPS host inputs and reject malformed hosts or tokens before sending requests", async () => {
	for (const value of ["https://company.ghe.com", " HTTPS://company.ghe.com/ ", "company.ghe.com/"]) {
		const input = hostInput(value)
		assert.strictEqual(hostname(input), "company.ghe.com")
		assert.strictEqual(tokenUrl(input), "https://company.ghe.com/settings/tokens")
	}

	assert.strictEqual(tokenUrl(" GitHub.COM "), "https://github.com/settings/tokens")
	assert.strictEqual(hostInput("https:/"), "https:/")

	for (const invalid of [
		"",
		"*.ghe.com",
		"https://github.com",
		"http://company.ghe.com",
		"github.com/path",
		"user@github.com",
		"github.com:443",
		"github.com\n.evil",
		"../auth",
		"-github.com",
		"javascript:alert(1)",
	]) {
		assert.throws(() => hostname(invalid), /hostname/)
		assert.strictEqual(tokenUrl(invalid), undefined)
		await assert.rejects(tokens(storage()).set(invalid, "secret"), /hostname/)
	}

	for (const token of ["", "  ", "abc def", "abc\r\ndef"]) {
		await assert.rejects(tokens(storage()).set("github.com", token), /personal access token/)
	}
	assert.strictEqual(fetch.mock.callCount(), 0)
})

type SetupContext = Parameters<typeof plugin.setup>[0]

type RegisteredHandlers = Parameters<SetupContext["rpc"]["register"]>[1]

test("the RPC settings flow invalidates cached auth failures and notifies windows without exposing PATs", async () => {
	const directory = await mkdtemp(join(tmpdir(), "github-auth-test-"))

	try {
		execFileSync("git", ["init", "--initial-branch=main", directory], { stdio: "ignore" })
		execFileSync("git", ["remote", "add", "origin", "https://github.com/acme/repo.git"], { cwd: directory })

		const stored = storage()
		const events: { name: string; data: Record<string, Json> }[] = []
		let handlers!: RegisteredHandlers
		await plugin.setup({
			location: { directory },
			storage: stored,
			rpc: {
				register: async (_definition: typeof GitHub, methods: RegisteredHandlers) => {
					handlers = methods

					return {
						dispose: async () => {},
						events: {
							emit: async (name: string, data: Record<string, Json>) => {
								events.push({ name, data })
							},
						},
					}
				},
			},
			tool: { transform: async () => ({ dispose: async () => {} }) },
		} as never)

		const context = {
			signal: new AbortController().signal,
			error: (_type: "failed", message: string): never => {
				throw new Error(message)
			},
		}

		assert.strictEqual((await handlers.status({ directory }, context)).error?.type, "auth")
		fetch.mock.mockImplementation(async (url) => {
			if (String(url).endsWith("/user"))
				return Response.json({ login: "octocat" }, { headers: { "X-OAuth-Scopes": "repo" } })

			return Response.json({
				data: {
					repository: {
						url: "https://github.com/acme/repo",
						defaultBranchRef: { name: "main" },
						pullRequests: { nodes: [] },
					},
				},
			})
		})
		assert.deepStrictEqual(await handlers.token({ host: "github.com", token: "ghp_rpc_test" }, context), {})
		assert.deepStrictEqual(await handlers.accounts({}, context), {
			accounts: [{ host: "github.com", user: "octocat" }],
		})
		const status = await handlers.status({ directory }, context)
		assert.strictEqual(status.error, undefined)
		assert.strictEqual(status.repo?.name, "repo")
		assert.deepStrictEqual(events, [{ name: "auth", data: {} }])
		assert.ok(!JSON.stringify(events).includes("ghp_rpc_test"))

		await handlers.token({ host: "github.com", token: null }, context)
		assert.strictEqual((await handlers.status({ directory }, context)).error?.type, "auth")
		assert.strictEqual(events.length, 2)

		fetch.mock.mockImplementationOnce(async () => Response.json({ message: "Bad credentials" }, { status: 401 }))
		await assert.rejects(handlers.token({ host: "github.com", token: "rejected" }, context), /rejected the token/)
		assert.deepStrictEqual(await handlers.accounts({}, context), { accounts: [] })
		assert.strictEqual(events.length, 2)
	} finally {
		await rm(directory, { recursive: true, force: true })
	}
})
