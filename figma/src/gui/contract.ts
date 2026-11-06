import { Schema } from "effect"
import { Ipc } from "@opencode/plugin/gui"

const Target = Schema.Struct({
	key: Schema.String,
	url: Schema.String,
	view: Schema.Literals(["node", "file"]),
	dev: Schema.Boolean,
	theme: Schema.Literals(["light", "dark"]),
})

export const FigmaView = Ipc.define({
	id: "opencode-figma.view",
	methods: {
		attach: { input: Target, output: Schema.String },
		reload: { input: Schema.String },
		release: { input: Schema.String },
		active: { output: Schema.Array(Schema.String) },
		scale: { input: Schema.String, output: Schema.NullOr(Schema.Number) },
		updated: { input: Schema.String, output: Schema.NullOr(Schema.String) },
		devAccess: { input: Schema.String, output: Schema.NullOr(Schema.Boolean) },
		node: {
			input: Schema.Struct({ key: Schema.String, id: Schema.String }),
			output: Schema.NullOr(Schema.String),
		},
		capture: {
			input: Schema.Struct({
				key: Schema.String,
				area: Schema.Struct({ x: Schema.Number, y: Schema.Number, width: Schema.Number, height: Schema.Number }),
			}),
			output: Schema.String,
		},
		menu: {
			input: Schema.Array(Schema.NullOr(Schema.Struct({ id: Schema.String, label: Schema.String }))),
			output: Schema.NullOr(Schema.String),
		},
	},
})

export const viewKey = (session: string, file: string) => `${session}\n${file}`

export const Team = Schema.Struct({ id: Schema.String, name: Schema.String })

export type Team = typeof Team.Type

export const Listing = Schema.Struct({ url: Schema.String, name: Schema.String, time: Schema.NullOr(Schema.String) })

export type Listing = typeof Listing.Type

export const INVALID_KEY = "opencode-figma:invalid-key"

export const INVALID_TEAM = "opencode-figma:invalid-team"

export const FigmaAccount = Ipc.define({
	id: "opencode-figma.account",
	state: Schema.Struct({
		user: Schema.NullOr(Schema.String),
		teams: Schema.Array(Team),
		team: Schema.NullOr(Schema.String),
		nodeNames: Schema.Boolean,
	}),
	methods: {
		token: { input: Schema.NullOr(Schema.String) },
		nodeNames: { input: Schema.Boolean },
		addTeam: { input: Schema.String },
		removeTeam: { input: Schema.String },
		discover: {},
		selectTeam: { input: Schema.String },
		recent: { output: Schema.NullOr(Schema.Array(Listing)) },
		edited: { input: Schema.String, output: Schema.Array(Listing) },
	},
})
