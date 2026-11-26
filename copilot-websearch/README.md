# opencode-copilot-websearch

OpenCode plugin: adds a `github-copilot` web search backend powered by GitHub Copilot's hosted Bing MCP `web_search` tool.

- Reuses your existing OpenCode `github-copilot` connection, including a `COPILOT_GITHUB_TOKEN` environment variable.
- Works when **Copilot can search the web** is enabled on your GitHub Copilot plan, even when model-native search is disabled.
- Supports GitHub Enterprise via the connection's `apiEndpoint` or `enterpriseUrl` metadata.

## Configuration

Add the plugin to `opencode.json(c)` and select `github-copilot` as your web search provider:

```jsonc
{
	"websearch": {
		"provider": "github-copilot",
	},
	"plugins": ["opencode-copilot-websearch"],
}
```

## Develop

```sh
pnpm install       # run once in the workspace root
pnpm lint
pnpm format
pnpm typecheck
pnpm test
```
