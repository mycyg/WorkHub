import { serve } from "@hono/node-server";

import { createCuuR3SmokeApp, type CuuR3ApiFault, type CuuR3RunOutcome } from "./cuu-r3-launcher-harness.js";

const port = Number.parseInt(process.env.PORT ?? "8787", 10);
const hostname = process.env.HOST ?? "127.0.0.1";
const runOutcome = resolveRunOutcome(process.env.WORKHUB_CUU_QA_RUN_OUTCOME);
const apiFault = resolveApiFault(process.env.WORKHUB_CUU_QA_API_FAULT);
const { app } = createCuuR3SmokeApp({
  runStream: true,
  runOutcome,
  apiFault,
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
      api_fault: apiFault,
      base_url: `http://${info.address}:${info.port}`
    }));
  }
);

function resolveRunOutcome(value: string | undefined): CuuR3RunOutcome {
  return value === "failed" ? "failed" : "succeeded";
}

function resolveApiFault(value: string | undefined): CuuR3ApiFault {
  return value === "permission-401" || value === "permission-403" || value === "stream-offline"
    ? value
    : "none";
}

function close() {
  server.close(() => process.exit(0));
}

process.on("SIGINT", close);
process.on("SIGTERM", close);
