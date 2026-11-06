import assert from "node:assert/strict"
import { test } from "node:test"
import { devModeAccess, readDevModeAccess } from "../src/gui/access.ts"

const key = "file123"

const source = `https://www.figma.com/design/${key}/Example?node-id=1-2&m=dev&mode=dev&t=tracking`

const signal = new AbortController().signal

const page = (
	file: Record<string, string | number | boolean> | null,
	attributes = 'nonce="example" type="application/json" data-initial',
) =>
	`<html><script>window.unrelated = true</script><script ${attributes}>${JSON.stringify({
		INITIAL_OPTIONS: { editing_file: file },
	})}</script></html>`

test("Dev Mode access is read per file from the bootstrap script", () => {
	assert.strictEqual(devModeAccess(page({ key, can_access_full_dev_mode: true }), key), true)
	assert.strictEqual(devModeAccess(page({ key, can_access_full_dev_mode: false }), key), false)
	assert.strictEqual(
		devModeAccess(page({ key, can_access_full_dev_mode: true }, 'data-initial="" type="application/json"'), key),
		true,
	)
	assert.strictEqual(devModeAccess(page({ key: "other", can_access_full_dev_mode: true }), key), null)
	assert.strictEqual(devModeAccess(page({ key: "other", can_access_full_dev_mode: false }), key), null)
})

test("missing, malformed or changed metadata remains unknown rather than denying access", () => {
	for (const html of [
		"<html>Sign in</html>",
		"<script data-initial>{broken}</script>",
		'<script data-initial>{"INITIAL_OPTIONS":null}</script>',
		page(null),
		page({ key }),
		page({ key, can_access_full_dev_mode: "false" }),
		page({ key, can_access_full_dev_mode: 0 }),
		page({ key, can_access_full_dev_mode: false }, "data-initial-options"),
	])
		assert.strictEqual(devModeAccess(html, key), null)
})

test("the permission request strips mode and tracking parameters and forwards the abort signal", async () => {
	const calls: { url: string; init: RequestInit }[] = []

	const fetch = async (url: string, init: RequestInit) => {
		calls.push({ url, init })

		return new Response(page({ key, can_access_full_dev_mode: false }))
	}

	assert.strictEqual(await readDevModeAccess(fetch, source, signal), false)
	assert.deepStrictEqual(calls, [{ url: `https://www.figma.com/design/${key}/Example`, init: { signal } }])
})

test("a failed permission request does not masquerade as an access denial", async () => {
	assert.strictEqual(await readDevModeAccess(async () => new Response("Denied", { status: 403 }), source, signal), null)
	assert.strictEqual(
		await readDevModeAccess(
			async () => {
				throw new Error("offline")
			},
			source,
			signal,
		),
		null,
	)
	assert.strictEqual(await readDevModeAccess(async () => new Response("Sign in"), source, signal), null)
})
