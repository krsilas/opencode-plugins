import { type CallToolResult, Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client"
import type { CopilotAuth } from "./types.ts"

const CLIENT_INFO = { name: "opencode-copilot-websearch", version: "0.1.0" }

export function createMcpClient(toolset: string) {
	let token = ""
	let connection: { url: string; client: Promise<Client> } | undefined

	const connect = async (url: string, signal: AbortSignal): Promise<Client> => {
		const client = new Client(CLIENT_INFO, { versionNegotiation: { mode: "auto" } })
		const transport = new StreamableHTTPClientTransport(new URL(url), {
			authProvider: { token: async () => token },
			requestInit: {
				headers: { "X-MCP-Host": "copilot-cli", "X-MCP-Toolsets": toolset, "X-MCP-Tools": toolset },
			},
		})
		await client.connect(transport, { signal })
		return client
	}

	const close = async () => {
		const current = connection
		connection = undefined
		await current?.client.then((client) => client.close()).catch(() => undefined)
	}

	return {
		async callTool(
			auth: CopilotAuth,
			name: string,
			args: Record<string, unknown>,
			signal: AbortSignal,
		): Promise<CallToolResult> {
			token = auth.token
			if (connection?.url !== auth.url) {
				await close()
				const client = connect(auth.url, signal)
				connection = { url: auth.url, client }
				client.catch(() => {
					if (connection?.client === client) connection = undefined
				})
			}
			const client = await connection.client
			return client.callTool({ name, arguments: args }, { signal })
		},

		close,
	}
}
