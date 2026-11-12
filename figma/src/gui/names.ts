import type { Listing } from "./contract.ts"
import type { FigmaEntry, HistoryEntry } from "./definition.ts"
import { fileKey, fileName, nodeId, targetKey } from "./url.ts"

const MAX_HISTORY_FILES = 20
const MAX_SHOWN_FILES = 5

export type NameTarget = "file" | "node"

export type OpenedFile = Pick<FigmaEntry, "url" | "view">

const fileNames = (history: readonly HistoryEntry[], key: string | undefined) => {
	if (!key) return { title: undefined, nodes: undefined }
	let title: string | undefined
	const nodes: Record<string, string> = {}

	for (const entry of history) {
		if (fileKey(entry.url) !== key) continue
		title ??= entry.title

		if (entry.nodes) {
			for (const [id, name] of Object.entries(entry.nodes)) nodes[id] ??= name
		}
	}

	return {
		title,
		nodes: Object.keys(nodes).length ? nodes : undefined,
	}
}

const withNames = (
	entry: { url: string; time: string },
	names: { title?: string; nodes?: Record<string, string> },
): HistoryEntry => ({
	url: entry.url,
	time: entry.time,
	...(names.title ? { title: names.title } : {}),
	...(names.nodes && Object.keys(names.nodes).length ? { nodes: names.nodes } : {}),
})

export const historyEntry = (history: readonly HistoryEntry[], url: string) => {
	const target = targetKey(url)

	return history.find((entry) => targetKey(entry.url) === target)
}

export const fileTitle = (history: readonly HistoryEntry[], url: string) =>
	fileNames(history, fileKey(url)).title || fileName(url)

export const nodeTitle = (history: readonly HistoryEntry[], url: string) => {
	const id = nodeId(url)

	return id ? fileNames(history, fileKey(url)).nodes?.[id] : undefined
}

export const listTitle = (history: readonly HistoryEntry[], url: string, name: string) => {
	const file = fileNames(history, fileKey(url)).title || name
	const node = nodeTitle(history, url)

	return node ? `${file} › ${node}` : file
}

export function visit(history: readonly HistoryEntry[], url: string, time: string): HistoryEntry[] {
	const target = targetKey(url)
	const names = fileNames(history, fileKey(url))

	return [withNames({ url, time }, names), ...history.filter((entry) => targetKey(entry.url) !== target)].slice(
		0,
		MAX_HISTORY_FILES,
	)
}

export function forgetHistory(history: readonly HistoryEntry[], url: string): HistoryEntry[] {
	const target = targetKey(url)

	return history.filter((entry) => targetKey(entry.url) !== target)
}

export function rename(
	history: readonly HistoryEntry[],
	url: string,
	target: NameTarget,
	value: string | undefined,
	time: string,
): HistoryEntry[] {
	const key = fileKey(url)
	const entryKey = targetKey(url)
	const current = fileNames(history, key)
	let names = current

	if (target === "file") {
		if (!history.some((entry) => fileKey(entry.url) === key) && !value) return [...history]
		names = { ...current, title: value }
	} else {
		const id = nodeId(url)

		if (!id) return [...history]

		if (!history.some((entry) => targetKey(entry.url) === entryKey) && !value) return [...history]
		const { [id]: _, ...rest } = current.nodes ?? {}
		const nextNodes = value ? { ...rest, [id]: value } : rest
		names = { ...current, nodes: Object.keys(nextNodes).length ? nextNodes : undefined }
	}

	const updated = history.map((entry) =>
		fileKey(entry.url) === key
			? withNames(
					{
						url: target === "node" && value && targetKey(entry.url) === entryKey ? url : entry.url,
						time: entry.time,
					},
					names,
				)
			: entry,
	)
	const needed =
		target === "file"
			? !updated.some((entry) => fileKey(entry.url) === key)
			: Boolean(value) && !updated.some((entry) => targetKey(entry.url) === entryKey)

	if (!needed) return updated

	return [withNames({ url, time }, names), ...updated].slice(0, MAX_HISTORY_FILES)
}

export function unopened(
	list: readonly Listing[] | null | undefined,
	opened: readonly OpenedFile[],
	history: readonly HistoryEntry[],
	limit = MAX_SHOWN_FILES,
): Listing[] {
	const open = new Set(opened.flatMap((file) => targetKey(file.url, file.view) ?? []))

	return (list ?? [])
		.filter((file) => {
			const key = targetKey(file.url)

			return !key || !open.has(key)
		})
		.slice(0, limit)
		.map((file) => ({ ...file, name: listTitle(history, file.url, file.name) }))
}

export function activeFiles(
	urls: readonly string[] | null | undefined,
	opened: readonly OpenedFile[],
	history: readonly HistoryEntry[],
	limit = MAX_SHOWN_FILES,
): Listing[] {
	const seen = new Set<string>()

	const list = (urls ?? []).flatMap((url) => {
		const key = targetKey(url)

		if (!key || seen.has(key)) return []
		seen.add(key)

		return [{ url, name: fileName(url), time: null }]
	})

	return unopened(list, opened, history, limit)
}

export function historyFiles(
	entries: readonly HistoryEntry[],
	opened: readonly OpenedFile[],
	activeUrls?: readonly string[] | null,
	limit = MAX_SHOWN_FILES,
): Listing[] {
	const active = activeUrls ? new Set(activeUrls.flatMap((url) => targetKey(url) ?? [])) : undefined

	const list = entries
		.filter((file) => {
			const key = targetKey(file.url)

			return !key || !active?.has(key)
		})
		.map((file) => ({
			url: file.url,
			name: fileName(file.url),
			time: file.time,
		}))

	return unopened(list, opened, entries, limit)
}
