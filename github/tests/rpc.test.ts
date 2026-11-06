import assert from "node:assert/strict"
import { test } from "node:test"
import { Schema } from "effect"
import { item } from "../src/github.ts"
import { GitHub } from "../src/rpc.ts"

test("RPC output validator omits undefined nested fields and rejects invalid values", async () => {
	const row = item({ number: 7, headRefName: "feature" })
	const input = { total: 1, items: [row] }
	const schema = GitHub.methods.pulls.output
	assert.strictEqual(Schema.isSchema(schema), false)
	const result = await schema["~standard"].validate(input)
	assert.strictEqual(result.issues, undefined)
	if (result.issues) throw new Error("Expected valid PR list")
	assert.strictEqual(Schema.is(Schema.Json)(result.value), true)
	assert.deepStrictEqual(result.value.items[0]?.author, { login: "ghost" })
	assert.ok(!("headOwner" in result.value.items[0]))
	assert.ok(!("checks" in result.value.items[0]))
	assert.ok("name" in input.items[0]!.author)
	assert.strictEqual(input.items[0]!.author.name, undefined)

	const invalid = await schema["~standard"].validate({ total: "one", items: [] })
	assert.notStrictEqual(invalid.issues, undefined)
})
