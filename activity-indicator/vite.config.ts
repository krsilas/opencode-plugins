import { defineConfig, lazyPlugins } from "vite-plus"
import { gui } from "@opencode/plugin/gui/vite"

export default defineConfig({ plugins: lazyPlugins(() => [gui()]) })
