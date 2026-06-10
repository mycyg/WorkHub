import { serve } from "@hono/node-server";

import { createCuuR3SmokeApp } from "./cuu-r3-launcher-harness.js";

const port = Number.parseInt(process.env.PORT ?? "8787", 10);
const hostname = process.env.HOST ?? "127.0.0.1";
const { app } = createCuuR3SmokeApp({
  runStream: true,
  runDelayMs: 2600,
  modelDelayMs: 850,
  logRunStream: true
});

const server = serve(
  {
    fetch: app.fetch,
    hostname,
    port
  },
  (info) => {
    console.log(JSON.stringify({
      ok: true,
      service: "workhub-cuu-r3-tauri-run-stream",
      base_url: `http://${info.address}:${info.port}`
    }));
  }
);

function close() {
  server.close(() => process.exit(0));
}

process.on("SIGINT", close);
process.on("SIGTERM", close);
