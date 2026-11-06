import { Schema } from "effect"
import { Rpc } from "@opencode/plugin/rpc"

export const FigmaFile = Schema.Struct({
	url: Schema.String,
	shared: Schema.Boolean,
})

export type FigmaFile = typeof FigmaFile.Type

export const Figma = Rpc.define({
	id: "opencode-figma",
	methods: {
		set: {
			input: Schema.toStandardSchemaV1(Schema.Struct({ sessionID: Schema.String, files: Schema.Array(FigmaFile) })),
			output: Schema.toStandardSchemaV1(Schema.Struct({})),
		},
	},
	events: {
		open: {
			schema: Schema.toStandardSchemaV1(Schema.Struct({ sessionID: Schema.String, url: Schema.String })),
		},
	},
})
