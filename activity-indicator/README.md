# opencode-activity-indicator

This OpenCode plugin serves two purposes:

- **Menu bar**: shows the OpenCode logo when idle, an animated radar spinner while sessions run, and a blue pill shows unread sessions.
- **Dock badge**: shows the total number of pending input prompts, when you need to answer a question or approve a tool call.

The plugin runs in OpenCode Desktop on macOS, so Desktop must remain running even when you work in the TUI.

## Install

Add the package or local plugin directory to `plugins` in your global `~/.config/opencode/opencode.json`:

```json
{
	"$schema": "https://opencode.ai/config.json",
	"plugins": ["opencode-activity-indicator"]
}
```
