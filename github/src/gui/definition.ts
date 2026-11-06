import { Schema } from "effect"
import { Plugin, Store } from "@opencode/plugin/gui"
import en from "./i18n/en.json" with { type: "json" }
import de from "./i18n/de.json" with { type: "json" }

const Repo = Schema.Struct({ host: Schema.String, owner: Schema.String, name: Schema.String })

const Browser = Schema.Struct({
	repo: Schema.NullOr(Repo),
	recent: Schema.Array(Repo),
})

export const definition = Plugin.define({
	stores: {
		browser: Store.global(Browser, { repo: null, recent: [] }),
	},
	i18n: { en, de },
})
