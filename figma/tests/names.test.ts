import assert from "node:assert/strict"
import { test } from "node:test"
import {
	activeFiles,
	fileTitle,
	forgetHistory,
	historyFiles,
	nodeTitle,
	rename,
	unopened,
	visit,
} from "../src/gui/names.ts"

const whole = "https://www.figma.com/design/abc/My-File"
const url = "https://www.figma.com/design/abc/My-File?node-id=1-2"
const other = "https://www.figma.com/design/abc/My-File?node-id=3-4"
const time = "2026-11-10T10:00:00Z"

test("file and node titles are shared across entries of the same file", () => {
	let history = visit(visit([], url, "2026-11-01T10:00:00Z"), other, "2026-11-02T10:00:00Z")
	history = rename(history, url, "file", "Checkout", time)
	history = rename(history, url, "node", "Header", time)
	history = rename(history, other, "node", "Footer", time)

	assert.strictEqual(fileTitle(history, other), "Checkout")
	assert.strictEqual(nodeTitle(history, url), "Header")
	assert.strictEqual(nodeTitle(history, other), "Footer")
	assert.strictEqual(fileTitle(rename(history, other, "file", undefined, time), url), "My File")
	assert.strictEqual(nodeTitle(rename(history, other, "node", undefined, time), other), undefined)
})

test("recent, active, and history lists are unique per node", () => {
	let history = visit(visit([], url, "2026-11-01T10:00:00Z"), other, time)
	history = rename(history, other, "node", "Footer", time)
	const opened = [{ url }]

	assert.deepStrictEqual(unopened([{ url: whole, name: "My File", time }], opened, history), [
		{ url: whole, name: "My File", time },
	])
	assert.deepStrictEqual(activeFiles([url, other], opened, history), [
		{ url: other, name: "My File › Footer", time: null },
	])
	assert.deepStrictEqual(historyFiles(history, opened), [{ url: other, name: "My File › Footer", time }])
	assert.strictEqual(forgetHistory(history, url).length, 1)
})
