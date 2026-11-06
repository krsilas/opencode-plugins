import assert from "node:assert/strict"
import { test } from "node:test"
import type { Json } from "@opencode/plugin/gui"
import plugin from "../src/index.ts"
import type { Figma } from "../src/rpc.ts"

const url = "https://www.figma.com/design/abc/Example"

async function server(initial: Json) {
	const storage = new Map<string, Json>([["session/test", initial]])
	let set: (input: { sessionID: string; files: { url: string; shared: boolean }[] }) => Promise<Record<string, never>>
	type Tool = {
		name: string
		execute: (input: never, context: { sessionID: string }) => Promise<{ content: string }>
	}
	const tools = new Map<string, Tool>()
	const emitted: { name: string; data: unknown }[] = []
	let hook: (event: { sessionID: string; tools: Record<string, Record<string, never>> }) => Promise<void>

	await plugin.setup({
		storage: {
			get: async (key: string) => storage.get(key),
			set: async (key: string, value: Json) => void storage.set(key, value),
			remove: async (key: string) => void storage.delete(key),
		},
		rpc: {
			register: async (_contract: typeof Figma, handlers: { set: typeof set }) => {
				set = handlers.set

				return { events: { emit: async (name: string, data: unknown) => void emitted.push({ name, data }) } }
			},
		},
		tool: {
			transform: async (run: (editor: { add: (value: Tool) => void }) => void) =>
				run({ add: (value) => void tools.set(value.name, value) }),
		},
		session: { hook: async (_event: string, run: typeof hook) => void (hook = run) },
	} as never)

	const files = tools.get("figma_files")!
	const open = tools.get("open")!

	return {
		storage,
		set: set!,
		tool: {
			execute: (input: Record<string, never>, context: { sessionID: string }) => files.execute(input as never, context),
		},
		open: (input: { url: string }, context: { sessionID: string }) => open.execute(input as never, context),
		emitted,
		hook: hook!,
	}
}

test("the server restores, filters, updates, and clears shared session files", async () => {
	const restored = await server({
		files: [
			{ url, shared: true },
			{ url: `${url}-hidden`, shared: false },
		],
	})
	const restoredEvent = { sessionID: "test", tools: { figma_files: {} } }
	await restored.hook(restoredEvent)
	assert.notStrictEqual(restoredEvent.tools.figma_files, undefined)
	assert.deepStrictEqual(JSON.parse((await restored.tool.execute({}, { sessionID: "test" })).content), [
		{ url, name: "Example", kind: "design", fileKey: "abc" },
	])

	const app = await server({ url, shared: true })
	const event = { sessionID: "test", tools: { figma_files: {} } }
	await app.hook(event)
	assert.strictEqual(event.tools.figma_files, undefined)
	assert.ok((await app.tool.execute({}, { sessionID: "test" })).content.includes("No Figma file"))

	const files = [{ url, shared: true }]
	await app.set({ sessionID: "test", files })
	assert.deepStrictEqual(app.storage.get("session/test"), { files })
	assert.strictEqual(JSON.parse((await app.tool.execute({}, { sessionID: "test" })).content).length, 1)

	await app.set({ sessionID: "test", files: [] })
	assert.strictEqual(app.storage.has("session/test"), false)
	assert.ok((await app.tool.execute({}, { sessionID: "test" })).content.includes("No Figma file"))
})

test("the open tool asks the panel to open Figma links only", async () => {
	const app = await server({ files: [] })

	assert.ok(
		(await app.open({ url: "https://example.com/design/abc" }, { sessionID: "test" })).content.includes("Not a Figma"),
	)
	assert.deepStrictEqual(app.emitted, [])

	await app.open({ url: ` ${url} ` }, { sessionID: "test" })
	assert.deepStrictEqual(app.emitted, [{ name: "open", data: { sessionID: "test", url } }])
})
