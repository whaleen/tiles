import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const src = fileURLToPath(new URL("./src", import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      // Pure-logic tests never hit a Tauri runtime; stub the invoke entrypoint
      // so importing modules that re-export it (e.g. api/client) stays clean.
      {
        find: "@tauri-apps/api/core",
        replacement: fileURLToPath(new URL("./src/test/tauri-mock.ts", import.meta.url)),
      },
      { find: /^@\/(.*)$/, replacement: `${src}/$1` },
    ],
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
