import type { RepoRef } from "../types"

export const authenticatedHosts = (accounts: readonly { host: string }[]) =>
	new Set(accounts.map((account) => account.host.toLowerCase()))

export const parseRepo = (value: string): RepoRef | undefined => {
	const text = value
		.trim()
		.replace(/\.git$/, "")
		.replace(/\/+$/, "")

	const ssh = text.match(/^(?:ssh:\/\/)?git@([^:/\s]+)[:/]([\w.-]+)\/([\w.-]+)$/)

	if (ssh) return { host: ssh[1]!.toLowerCase(), owner: ssh[2]!, name: ssh[3]! }
	const url = text.match(/^(?:https?:\/\/)?([\w-]+(?:\.[\w-]+)+)\/([\w.-]+)\/([\w.-]+)(?:[/?#].*)?$/)

	if (url) return { host: url[1]!.toLowerCase(), owner: url[2]!, name: url[3]! }
	const short = text.match(/^([\w-]+)\/([\w.-]+)$/)

	if (short) return { host: "github.com", owner: short[1]!, name: short[2]! }

	return undefined
}
