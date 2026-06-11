import { defineConfig } from "vite";

const apiProxyTarget = process.env["WORKHUB_WEB_API_PROXY_TARGET"] ?? "http://127.0.0.1:8787";

export default defineConfig({
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": apiProxyTarget,
      "/openapi.json": apiProxyTarget
    }
  },
  preview: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true
  },
  build: {
    outDir: "dist",
    emptyOutDir: true
  }
});
