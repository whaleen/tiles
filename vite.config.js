import path from "path"
import { fileURLToPath } from "url"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite-plus"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
