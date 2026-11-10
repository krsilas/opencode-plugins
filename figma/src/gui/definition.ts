import { Schema } from "effect"
import { Plugin, Store } from "@opencode/plugin/gui"
import en from "./i18n/en.json" with { type: "json" }
import de from "./i18n/de.json" with { type: "json" }

const Settings = {
	shared: Schema.optional(Schema.Boolean),
	view: Schema.optional(Schema.Literals(["node", "file"])),
	dev: Schema.optional(Schema.Boolean),
}

export const FigmaEntry = Schema.Struct({ id: Schema.String, url: Schema.String, ...Settings })

export type FigmaEntry = typeof FigmaEntry.Type

export const HistoryEntry = Schema.Struct({
	url: Schema.String,
	time: Schema.String,
	title: Schema.optional(Schema.String),
	nodes: Schema.optional(Schema.Record(Schema.String, Schema.String)),
})

export type HistoryEntry = typeof HistoryEntry.Type

export const definition = Plugin.define({
	stores: {
		file: Store.session(Schema.Struct({ files: Schema.Array(FigmaEntry) }), { files: [] }),
		history: Store.global(Schema.Struct({ files: Schema.Array(HistoryEntry) }), { files: [] }),
	},
	i18n: { en, de },
})
