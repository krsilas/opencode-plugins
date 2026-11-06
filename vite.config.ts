import { defineConfig } from "vite-plus"

export default defineConfig({
	fmt: {
		printWidth: 120,
		useTabs: true,
		semi: false,
	},
	lint: {
		overrides: [
			{
				files: ["**/*.tsx"],
				rules: {
					"eslint/no-unassigned-vars": "off",
				},
			},
		],
		jsPlugins: [
			{
				name: "vite-plus",
				specifier: "vite-plus/oxlint-plugin",
			},
		],
		rules: {
			"vite-plus/prefer-vite-plus-imports": "error",
		},
	},
})
