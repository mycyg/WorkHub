import { serve } from "@hono/node-server";

import app from "./app.js";
import { settings } from "@workhub/config";
import { getDefaultAgentRunRecoveryScheduler } from "./workers/agent-run-recovery.js";

const recoveryScheduler = getDefaultAgentRunRecoveryScheduler();
recoveryScheduler.start();

const server = serve(
  {
    fetch: app.fetch,
    hostname: settings.apiHost,
    port: settings.port
  },
  (info) => {
    console.log(`WorkHub API daemon listening on http://${settings.apiHost}:${info.port}`);
  }
);

function shutdown(exitCode: number) {
  recoveryScheduler.stop();
  const forceExit = setTimeout(() => process.exit(exitCode), 2000);
  forceExit.unref?.();
  server.close(() => {
    clearTimeout(forceExit);
    process.exit(exitCode);
  });
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    shutdown(signal === "SIGINT" ? 130 : 143);
  });
}
