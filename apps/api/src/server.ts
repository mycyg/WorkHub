import { serve } from "@hono/node-server";

import app, { attachWebStatic, logger } from "./app.js";
import { settings } from "@workhub/config";
import { getDefaultAgentRunRecoveryScheduler } from "./workers/agent-run-recovery.js";

if (settings.webDistDir) {
  attachWebStatic(app, settings.webDistDir);
}

const recoveryScheduler = getDefaultAgentRunRecoveryScheduler();
recoveryScheduler.start();

const server = serve(
  {
    fetch: app.fetch,
    hostname: settings.apiHost,
    port: settings.port
  },
  (info) => {
    logger.info("server_started", {
      host: settings.apiHost,
      port: info.port,
      app_env: settings.appEnv,
      web_dist: settings.webDistDir || null
    });
  }
);

function shutdown(exitCode: number) {
  logger.info("server_stopping", { exit_code: exitCode });
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
