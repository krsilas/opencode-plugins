const span = 5
const size = 2
const pitch = 3

export const radarLoop = 1.8
export const radarDim = 0.2

const fade = [1, 0.987, 0.934, 0.812, 0.599, 0.384, 0.238, 0.143, 0.081, 0.041, 0.017, 0.004, 0]
const trail = [...fade.map((level, index) => [index * 4, round(0.55 * level)] as const), [100, 0] as const]

type Cell = { gx: number; gy: number }

const placed = Array.from({ length: span * span }, (_, index) => {
	const cell = { gx: (index % span) - (span - 1) / 2, gy: Math.floor(index / span) - (span - 1) / 2 }
	return { cell, at: clockwiseTurn(cell), steady: cell.gx === 0 && cell.gy === 0 }
})

const ringOf = (cell: Cell) => Math.max(Math.abs(cell.gx), Math.abs(cell.gy))

export const radarDots = placed.map((dot) => {
	const others = placed.filter((other) => other !== dot && !other.steady && ringOf(other.cell) === ringOf(dot.cell))
	const behind = dot.steady ? 0 : Math.min(...others.map((other) => frac(dot.at - other.at)))
	const ahead = dot.steady ? 0 : Math.min(...others.map((other) => frac(other.at - dot.at)))
	return {
		x: round(8 + dot.cell.gx * pitch - size / 2),
		y: round(8 + dot.cell.gy * pitch - size / 2),
		size,
		at: round(dot.at),
		steady: dot.steady,
		stops: dot.steady ? [] : headStops(round(behind) * 100, round(ahead) * 100),
	}
})

export function dotOpacity(dot: (typeof radarDots)[number], progress: number, dim = radarDim) {
	if (dot.steady) return round(radarDim + (1 - radarDim) * trail[0]![1])
	return dim + (1 - dim) * levelAt(dot.stops, frac(progress - dot.at) * 100)
}

function headStops(behind: number, ahead: number): (readonly [number, number])[] {
	const edge = 1.5
	const off = ahead / 2 + edge
	const on = 100 - behind / 2

	return [
		[0, 1],
		[ahead / 2, 1],
		[off, levelAt(trail, off)],
		...trail.filter(([percent]) => percent > off && percent < 100 && percent < on - edge),
		[on - edge, 0],
		[on, 1],
		[100, 1],
	]
}

function clockwiseTurn(cell: Cell) {
	return frac(Math.atan2(cell.gx, -cell.gy) / (2 * Math.PI))
}

export function levelAt(stops: readonly (readonly [number, number])[], percent: number) {
	const next = stops.findIndex(([at]) => at >= percent)

	if (next <= 0) return stops[0]?.[1] ?? 0
	const [p0, l0] = stops[next - 1]!
	const [p1, l1] = stops[next]!

	return l0 + ((l1 - l0) * (percent - p0)) / (p1 - p0 || 1)
}

export function frac(value: number) {
	return value - Math.floor(value)
}

function round(value: number) {
	return Math.round(value * 1000) / 1000
}
