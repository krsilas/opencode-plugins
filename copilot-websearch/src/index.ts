import { Plugin } from "@opencode/plugin"
import { resolveAuth } from "./auth.ts"
import { createMcpClient } from "./mcp.ts"
import { parseSearchResults } from "./results.ts"

const PROVIDER_ID = "github-copilot"

export default Plugin.define({
	id: "opencode-copilot-websearch",
	async setup(ctx) {
		const mcp = createMcpClient("web_search")

		await ctx.websearch.transform((editor) => {
			editor.add({
				id: PROVIDER_ID,
				name: "GitHub Copilot",
				execute: async ({ query }, { signal }) => {
					const auth = await resolveAuth(ctx)
					return parseSearchResults(await mcp.callTool(auth, "web_search", { query }, signal))
				},
			})
			if (editor.default.get() === undefined) {
				editor.default.set(PROVIDER_ID)
			}
		})

		return mcp.close
	},
})
