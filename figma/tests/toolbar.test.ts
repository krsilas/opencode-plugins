import assert from "node:assert/strict"
import { test } from "node:test"
import { toolbarKey } from "../src/gui/url.ts"

test("the toolbar key skips a pane whose files have not loaded", () => {
	assert.strictEqual(toolbarKey("", undefined), undefined)
	assert.strictEqual(toolbarKey("", "2026-11-09T10:00:00Z"), undefined)
})

test("the toolbar key follows the file name and update time", () => {
	const url = "https://www.figma.com/design/abc/My-File?node-id=1-2"

	assert.strictEqual(toolbarKey(url, undefined), "My File\n")
	assert.strictEqual(toolbarKey(url, "2026-11-09T10:00:00Z"), "My File\n2026-11-09T10:00:00Z")
})
