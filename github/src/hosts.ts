export const hostname = (value: string) => {
	const host = value.trim().toLowerCase()

	if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(host))
		throw new Error("Enter a hostname such as github.com, without a URL or path")

	return host
}

export const hostInput = (value: string) =>
	value.replace(/^\s*https:\/\//i, "").replace(/^(\s*[a-z0-9.-]+)\/(\s*)$/i, "$1$2")

export const tokenUrl = (value: string): string | undefined => {
	try {
		return `https://${hostname(value)}/settings/tokens`
	} catch {
		return undefined
	}
}

export interface SettingsHost {
	host: string
	user?: string
}

export const settingsHosts = (accounts: readonly SettingsHost[]): SettingsHost[] => [
	accounts.find((item) => item.host === "github.com") ?? { host: "github.com" },
	...accounts.filter((item) => item.host !== "github.com").sort((a, b) => a.host.localeCompare(b.host)),
]
