import { fileURLToPath } from "node:url";

import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  server: {
    host: "127.0.0.1",
    port: 1420,
    strictPort: true,
    proxy: {
      "/api": "http://127.0.0.1:8787",
      "/openapi.json": "http://127.0.0.1:8787"
    }
  },
  preview: {
    host: "127.0.0.1",
    port: 1420,
    strictPort: true
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        pet: fileURLToPath(new URL("./pet.html", import.meta.url))
      }
    }
  }
});
