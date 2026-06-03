import path from "path"
import { fileURLToPath } from "url"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite-plus"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [
    react(),
    {
      name: "normalize-react-transform-config",
      config(config) {
        config.oxc ??= {}
        config.oxc.jsx ??= {}
        if (!config.oxc.jsx.runtime) config.oxc.jsx.runtime = "automatic"
        if (!config.oxc.jsx.importSource) config.oxc.jsx.importSource = "react"

        config.optimizeDeps ??= {}
        config.optimizeDeps.rolldownOptions ??= {}
        config.optimizeDeps.rolldownOptions.transform ??= {}
        config.optimizeDeps.rolldownOptions.transform.jsx ??= {}
        if (!config.optimizeDeps.rolldownOptions.transform.jsx.runtime) {
          config.optimizeDeps.rolldownOptions.transform.jsx.runtime = "automatic"
        }
        if (!config.optimizeDeps.rolldownOptions.transform.jsx.importSource) {
          config.optimizeDeps.rolldownOptions.transform.jsx.importSource = "react"
        }

        if ("esbuild" in config) delete config.esbuild
        if (config.optimizeDeps && "esbuildOptions" in config.optimizeDeps) {
          delete config.optimizeDeps.esbuildOptions
        }
      },
    },
    tailwindcss(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 1420,
    strictPort: true,
  },
  clearScreen: false,
  run: {
    enablePrePostScripts: true,
    tasks: {
      build: {
        command: "vp build",
        input: ["src/**", "public/**", "index.html", "vite.config.js"],
      },
      check: {
        command: "vp check",
        input: ["src/**"],
      },
    },
  },
})
