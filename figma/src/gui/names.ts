import type { HistoryEntry } from "./definition.ts"
import { fileKey, fileName, nodeId } from "./url.ts"

const MAX_HISTORY_FILES = 20

export type NameTarget = "file" | "node"

export const historyEntry = (history: readonly HistoryEntry[], url: string) => {
	const key = fileKey(url)

	return history.find((entry) => fileKey(entry.url) === key)
}

export const fileTitle = (history: readonly HistoryEntry[], url: string) =>
	historyEntry(history, url)?.title || fileName(url)

export const nodeTitle = (history: readonly HistoryEntry[], url: string) => {
	const id = nodeId(url)

	return id ? historyEntry(history, url)?.nodes?.[id] : undefined
}

export const listTitle = (history: readonly HistoryEntry[], url: string, name: string) => {
	const file = historyEntry(history, url)?.title || name
	const node = nodeTitle(history, url)

	return node ? `${file} › ${node}` : file
}

export function visit(history: readonly HistoryEntry[], url: string, time: string): HistoryEntry[] {
	const key = fileKey(url)
	const previous = historyEntry(history, url)

	return [{ ...previous, url, time }, ...history.filter((entry) => fileKey(entry.url) !== key)].slice(
		0,
		MAX_HISTORY_FILES,
	)
}

export function rename(
	history: readonly HistoryEntry[],
	url: string,
	target: NameTarget,
	value: string | undefined,
	time: string,
): HistoryEntry[] {
	const key = fileKey(url)
	const index = history.findIndex((entry) => fileKey(entry.url) === key)

	if (index === -1 && !value) return [...history]
	const { title, nodes, ...current } = index === -1 ? { url, time } : history[index]
	let names = { title, nodes }

	if (target === "file") names = { ...names, title: value }
	else {
		const id = nodeId(url)

		if (!id) return [...history]
		const { [id]: _, ...rest } = nodes ?? {}
		names = { ...names, nodes: value ? { ...rest, [id]: value } : rest }

		if (value) current.url = url
	}

	const next: HistoryEntry = {
		...current,
		...(names.title ? { title: names.title } : {}),
		...(names.nodes && Object.keys(names.nodes).length ? { nodes: names.nodes } : {}),
	}

	if (index === -1) return [next, ...history].slice(0, MAX_HISTORY_FILES)

	return history.map((entry, position) => (position === index ? next : entry))
}
