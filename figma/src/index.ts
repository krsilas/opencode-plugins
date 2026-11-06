import { Option, Schema } from "effect"
import { Plugin } from "@opencode/plugin"
import { Figma, FigmaFile } from "./rpc.ts"

const TOOL = "figma_files"

const FIGMA_PATH = /^\/(file|design|proto|board|slides|deck)\/[A-Za-z0-9]+/

const isFigmaUrl = (raw: string) => {
	if (!URL.canParse(raw)) return false
	const url = new URL(raw)

	return (
		url.protocol === "https:" &&
		(url.hostname === "figma.com" || url.hostname.endsWith(".figma.com")) &&
		FIGMA_PATH.test(url.pathname)
	)
}

const describe = (url: string) => {
	const parsed = new URL(url)
	const [kind, key, slug] = parsed.pathname.split("/").filter(Boolean)

	return {
		url,
		name: slug ? decodeURIComponent(slug).replace(/-/g, " ") : undefined,
		kind,
		fileKey: key,
		nodeId: parsed.searchParams.get("node-id") ?? undefined,
	}
}

const decodeStored = Schema.decodeUnknownOption(Schema.Struct({ files: Schema.Array(FigmaFile) }))

export default Plugin.define({
	id: "opencode-figma",
	async setup(ctx) {
		const sessions = new Map<string, readonly FigmaFile[]>()

		const read = async (sessionID: string): Promise<readonly FigmaFile[]> => {
			const cached = sessions.get(sessionID)

			if (cached) return cached
			const stored = decodeStored(await ctx.storage.get(`session/${sessionID}`))

			if (Option.isNone(stored)) return []
			const files = stored.value.files
			sessions.set(sessionID, files)

			return files
		}

		const shared = async (sessionID: string) => (await read(sessionID)).filter((file) => file.url && file.shared)

		const rpc = await ctx.rpc.register(Figma, {
			set: async (input) => {
				if (!input.files.length) {
					sessions.delete(input.sessionID)
					await ctx.storage.remove(`session/${input.sessionID}`)

					return {}
				}

				sessions.set(input.sessionID, input.files)
				await ctx.storage.set(`session/${input.sessionID}`, { files: input.files })

				return {}
			},
		})

		await ctx.tool.transform((editor) => {
			editor.add({
				name: TOOL,
				description:
					"Get the Figma files the user has open in this session's Figma side panel tabs: for each, its URL, file key, name, and selected node id. Call it when the user refers to a Figma design they are looking at.",
				input: Schema.Struct({}),
				// A direct tool, so the context hook below can withhold it per session (Code Mode tools bypass that list).
				options: { codemode: false },
				execute: async (_input, context) => {
					const files = await shared(context.sessionID)

					if (!files.length) return { content: "No Figma file is shared with the agent in this session." }

					return {
						content: JSON.stringify(
							files.map((file) => describe(file.url)),
							null,
							2,
						),
					}
				},
			})

			editor.add({
				name: "open",
				description:
					"Open a Figma file in this session's Figma side panel in OpenCode Desktop, or select its tab if it's already open. " +
					"Only works while the session is open in a desktop window.",
				input: Schema.Struct({
					url: Schema.String.annotate({
						description:
							"Figma link to a file, design, prototype, board, slides or deck, e.g. https://www.figma.com/design/<key>/<name>.",
					}),
				}),
				options: { namespace: "figma" },
				execute: async (input, context) => {
					const url = input.url.trim()

					if (!isFigmaUrl(url)) return { content: `Not a Figma file link: ${input.url}` }
					await rpc.events.emit("open", { sessionID: context.sessionID, url })

					return { content: `Asked OpenCode Desktop to open ${url} in the Figma panel.` }
				},
			})
		})

		await ctx.session.hook("context", async (event) => {
			if (!(await shared(event.sessionID)).length) delete event.tools[TOOL]
		})
	},
})
