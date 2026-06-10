import { serve } from "@hono/node-server";

import { createCuuR3SmokeApp, type CuuR3RunOutcome } from "./cuu-r3-launcher-harness.js";

const port = Number.parseInt(process.env.PORT ?? "8787", 10);
const hostname = process.env.HOST ?? "127.0.0.1";
const runOutcome = resolveRunOutcome(process.env.WORKHUB_CUU_QA_RUN_OUTCOME);
const { app } = createCuuR3SmokeApp({
  runStream: true,
  runOutcome,
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
      run_outcome: runOutcome,
      base_url: `http://${info.address}:${info.port}`
    }));
  }
);

function resolveRunOutcome(value: string | undefined): CuuR3RunOutcome {
  return value === "failed" ? "failed" : "succeeded";
}

function close() {
  server.close(() => process.exit(0));
}

process.on("SIGINT", close);
process.on("SIGTERM", close);
