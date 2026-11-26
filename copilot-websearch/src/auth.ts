import type { Plugin } from "@opencode/plugin"
import { type CopilotAuth, CopilotMetadata } from "./types.ts"

const DEFAULT_MCP_URL = `https://api.githubcopilot.com/mcp/readonly`

export function resolveMcpUrl(metadata?: unknown): string {
	const parsed = CopilotMetadata.safeParse(metadata ?? {})
	const { apiEndpoint, enterpriseUrl } = parsed.success ? parsed.data : {}

	if (apiEndpoint) {
		return `${apiEndpoint}/mcp/readonly`
	}

	if (enterpriseUrl) {
		return `https://copilot-api.${enterpriseUrl}/mcp/readonly`
	}

	return DEFAULT_MCP_URL
}

export async function resolveAuth(ctx: Plugin.Context): Promise<CopilotAuth> {
	const connection = await ctx.integration.connection.active("github-copilot")
	const credential = connection ? await ctx.integration.connection.resolve(connection) : undefined

	if (credential?.type === "oauth") {
		const token = credential.refresh || credential.access
		if (token) return { token, url: resolveMcpUrl(credential.metadata) }
	}

	if (credential?.type === "key" && credential.key) return { token: credential.key, url: DEFAULT_MCP_URL }

	throw new Error("GitHub Copilot is not connected. Connect GitHub Copilot with /connect.")
}
