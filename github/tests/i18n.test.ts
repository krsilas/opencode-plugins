import assert from "node:assert/strict"
import { test } from "node:test"
import en from "../src/gui/i18n/en.json" with { type: "json" }
import de from "../src/gui/i18n/de.json" with { type: "json" }

const placeholders = (text: string) => [...text.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)].map((match) => match[1]).sort()

test("German translations cover English keys and interpolation placeholders", () => {
	assert.deepStrictEqual(Object.keys(de).sort(), Object.keys(en).sort())

	const german: Record<string, string> = de
	for (const [key, value] of Object.entries(en)) {
		assert.deepStrictEqual(placeholders(german[key]), placeholders(value))
	}
})
