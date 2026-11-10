import assert from "node:assert/strict"
import { test } from "node:test"
import { fileTitle, listTitle, nodeTitle, rename, visit } from "../src/gui/names.ts"

const url = "https://www.figma.com/design/abc/My-File?node-id=1-2"
const time = "2026-11-10T10:00:00Z"

test("renaming a file stores its title in the history entry", () => {
	const history = [{ url: "https://www.figma.com/design/abc/My-File", time: "2026-11-01T10:00:00Z" }]
	const next = rename(history, url, "file", "Checkout", time)

	assert.deepStrictEqual(next, [{ ...history[0], title: "Checkout" }])
	assert.strictEqual(fileTitle(next, url), "Checkout")
	assert.strictEqual(fileTitle(rename(next, url, "file", undefined, time), url), "My File")
})

test("renaming a node works without a fetched node name and keeps other nodes", () => {
	const other = "https://www.figma.com/design/abc/My-File?node-id=3-4"
	const named = rename(rename([], url, "node", "Header", time), other, "node", "Footer", time)

	assert.deepStrictEqual(named, [{ url: other, time, nodes: { "1:2": "Header", "3:4": "Footer" } }])
	assert.strictEqual(nodeTitle(named, url), "Header")
	assert.deepStrictEqual(rename(named, other, "node", undefined, time), [
		{ url: other, time, nodes: { "1:2": "Header" } },
	])
})

test("opening a file again keeps its stored names", () => {
	const history = rename([], url, "file", "Checkout", "2026-11-01T10:00:00Z")
	const reopened = visit(history, "https://www.figma.com/design/abc/My-File", time)

	assert.deepStrictEqual(reopened, [{ url: "https://www.figma.com/design/abc/My-File", time, title: "Checkout" }])
})
