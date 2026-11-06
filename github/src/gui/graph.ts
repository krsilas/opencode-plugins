import type { Commit } from "../types"

export interface Edge {
	from: number
	to: number
	open?: boolean
}

export interface GraphRow {
	commit: Commit
	column: number
	top: Edge[]
	bottom: Edge[]
}

export const layout = (commits: readonly Commit[]) => {
	const known = new Set(commits.map((commit) => commit.oid))
	let lanes: (string | undefined)[] = []
	let width = 1

	const free = () => {
		const index = lanes.indexOf(undefined)

		return index === -1 ? lanes.length : index
	}

	const rows: GraphRow[] = commits.map((commit) => {
		let column = lanes.indexOf(commit.oid)

		if (column === -1) column = free()

		const before = lanes
		const top: Edge[] = []
		before.forEach((oid, index) => {
			if (!oid) return
			top.push({ from: index, to: oid === commit.oid ? column : index })
		})

		const after = before.map((oid) => (oid === commit.oid ? undefined : oid))
		lanes = after
		const bottom: Edge[] = []
		const [first, ...rest] = commit.parents

		if (first && known.has(first)) {
			const existing = lanes.indexOf(first)

			if (existing === -1) {
				lanes[column] = first
				bottom.push({ from: column, to: column })
			} else bottom.push({ from: column, to: existing })
		} else if (first) bottom.push({ from: column, to: column, open: true })

		rest.forEach((parent) => {
			if (!known.has(parent)) {
				const slot = free()
				bottom.push({ from: column, to: slot, open: true })
				width = Math.max(width, slot + 1)

				return
			}

			const existing = lanes.indexOf(parent)

			if (existing !== -1) return bottom.push({ from: column, to: existing })
			const slot = free()
			lanes[slot] = parent
			bottom.push({ from: column, to: slot })
		})

		lanes.forEach((oid, index) => {
			if (oid && before[index] === oid) bottom.push({ from: index, to: index })
		})

		while (lanes.length && !lanes[lanes.length - 1]) lanes.pop()
		width = Math.max(width, before.length, lanes.length, column + 1)

		return { commit, column, top, bottom }
	})

	return { rows, width }
}
