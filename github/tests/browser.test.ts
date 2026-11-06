import assert from "node:assert/strict"
import { test } from "node:test"
import { chooseRepo, openBrowser } from "../src/gui/browser-actions.ts"

const github = { host: "github.com", owner: "alice", name: "app" }
const enterprise = { host: "git.example.com", owner: "team", name: "app" }
const other = { host: "other.example.com", owner: "team", name: "app" }

test("repository picker lists recent and project repositories only for authenticated hosts", async () => {
	let options: { value: unknown; group?: string }[] = []
	const ctx = {
		t: (key: string) => key,
		stores: { browser: { value: { recent: [github, other] } } },
		sessions: { current: () => undefined },
		servers: { get: () => ({ data: { project: { list: () => [{ canonical: "/project" }] } } }) },
		dialogs: {
			select: async (input: { options: typeof options }) => {
				options = input.options
				return undefined
			},
		},
	}
	const state = {
		api: () => ({
			accounts: async () => ({
				accounts: [
					{ host: "GITHUB.COM", user: "alice" },
					{ host: "git.example.com", user: "bob" },
				],
			}),
			locate: async () => ({
				located: [
					{ repo: github, directory: "/duplicate" },
					{ repo: enterprise, directory: "/project" },
					{ repo: other, directory: "/other" },
				],
			}),
		}),
	}

	await chooseRepo(
		ctx as unknown as Parameters<typeof chooseRepo>[0],
		state as unknown as Parameters<typeof chooseRepo>[1],
	)
	assert.deepStrictEqual(
		options.map((option) => option.value),
		[github, enterprise],
	)
	assert.deepStrictEqual(
		options.map((option) => option.group),
		["pulls.repo.recent", "pulls.repo.projects"],
	)
})

test("opening pull requests without authenticated hosts opens GitHub settings, even with a remembered repository", async () => {
	for (const repo of [undefined, github]) {
		let settings: string | undefined
		let opened = false
		const ctx = {
			stores: { browser: { value: { repo } } },
			layout: {
				settings: (page: string) => {
					settings = page
				},
			},
			dialogs: {
				open: () => {
					opened = true
				},
			},
		}
		const state = { api: () => ({ accounts: async () => ({ accounts: [] }) }) }

		await openBrowser(
			ctx as unknown as Parameters<typeof openBrowser>[0],
			state as unknown as Parameters<typeof openBrowser>[1],
			() => ctx.dialogs.open(),
		)
		assert.strictEqual(settings, "github")
		assert.strictEqual(opened, false)
	}
})

test("opening pull requests with an authenticated host keeps the remembered repository", async () => {
	let opened = false
	let settings = false
	const ctx = {
		stores: { browser: { value: { repo: github } } },
		layout: {
			settings: () => {
				settings = true
			},
		},
		dialogs: {
			open: () => {
				opened = true
			},
		},
	}
	const state = { api: () => ({ accounts: async () => ({ accounts: [{ host: "github.com", user: "alice" }] }) }) }

	await openBrowser(
		ctx as unknown as Parameters<typeof openBrowser>[0],
		state as unknown as Parameters<typeof openBrowser>[1],
		() => ctx.dialogs.open(),
	)
	assert.strictEqual(opened, true)
	assert.strictEqual(settings, false)
})

test("opening pull requests reports account lookup errors without redirecting", async () => {
	let settings = false
	let notification: { variant?: string; title?: string; description?: string } | undefined
	const ctx = {
		t: (key: string) => key,
		layout: {
			settings: () => {
				settings = true
			},
		},
		toast: {
			show: (value: typeof notification) => {
				notification = value
			},
		},
	}
	const state = {
		api: () => ({
			accounts: async () => {
				throw new Error("offline")
			},
		}),
	}

	await openBrowser(
		ctx as unknown as Parameters<typeof openBrowser>[0],
		state as unknown as Parameters<typeof openBrowser>[1],
		() => {},
	)
	assert.strictEqual(settings, false)
	assert.deepStrictEqual(notification, {
		variant: "error",
		title: "pulls.repo.accounts.failed",
		description: "offline",
	})
})
