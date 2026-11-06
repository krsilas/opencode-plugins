# opencode-pull-requests

OpenCode plugin: GitHub pull request panel and composer pill for the session's branch.

- **Panel**: Shows PR details for current branch in the side panel. Every comment can be attached to the prompt as a note. Without a PR it offers to create a pull request.
- **Pill** above the composer: Shows PR number and status, e.g.: `#123 · Merged`
- **Open Pull Requests** (command palette): a dialog listing any repository's PRs. Clicking a PR displays that PR in a dialog.

## Authentication

Open **Settings > GitHub** to see all configured hosts. Authentication is via a Personal Access Token (PAT) for each host.

## Develop

```sh
pnpm install       # run once in the workspace root
pnpm dev           # from github/: rebuilds dist/gui-experimental.cjs; the app reloads the GUI on each build
pnpm lint          # Vite+ lint; lint:fix applies safe fixes
pnpm format        # format source and tests; format:check verifies
pnpm typecheck
pnpm test
```
