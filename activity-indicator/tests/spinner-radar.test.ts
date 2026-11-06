import assert from "node:assert/strict"
import { test } from "node:test"
import { dotOpacity, levelAt, radarDots } from "../src/spinner-radar.ts"

test("the radar keeps its 5×5 dot grid within the menu bar image's cropped bounds", () => {
	assert.strictEqual(radarDots.length, 25)
	assert.strictEqual(new Set(radarDots.map((dot) => `${dot.x},${dot.y}`)).size, 25)
	const steady = radarDots.filter((dot) => dot.steady)
	assert.strictEqual(steady.length, 1)
	assert.partialDeepStrictEqual(steady[0], { x: 7, y: 7 })

	for (const dot of radarDots) {
		assert.ok(dot.x >= 1)
		assert.ok(dot.y >= 1)
		assert.ok(dot.x + dot.size <= 15)
		assert.ok(dot.y + dot.size <= 15)
	}
})

test("every dot has a bounded opacity throughout the radar loop", () => {
	for (const dot of radarDots) {
		if (!dot.steady) {
			assert.strictEqual(dot.stops[0]?.[0], 0)
			assert.strictEqual(dot.stops.at(-1)?.[0], 100)
		}
		for (let step = 0; step <= 100; step++) {
			const opacity = dotOpacity(dot, step / 100)
			assert.ok(opacity >= 0.2)
			assert.ok(opacity <= 1)
		}
	}
})

test("fade opacity interpolates between keyframes", () => {
	const stops = [
		[0, 1],
		[50, 0],
		[100, 1],
	] as const
	for (const [percent, expected] of [
		[0, 1],
		[25, 0.5],
		[50, 0],
		[75, 0.5],
		[100, 1],
	] as const) {
		assert.strictEqual(levelAt(stops, percent), expected)
	}
})
