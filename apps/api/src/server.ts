import { serve } from "@hono/node-server";

import app, { attachWebStatic, logger } from "./app.js";
import { settings } from "@workhub/config";
import { getDefaultAgentRunRecoveryScheduler } from "./workers/agent-run-recovery.js";
import { getDefaultAgentRunSkillCurationScheduler } from "./workers/agent-skill-curation.js";
import { getDefaultSessionSweepScheduler } from "./workers/session-sweep.js";

if (settings.webDistDir) {
  attachWebStatic(app, settings.webDistDir);
}

const recoveryScheduler = getDefaultAgentRunRecoveryScheduler();
recoveryScheduler.start();

// 团队技能闲时自蒸馏（默认关闭：AGENT_RUN_SKILL_CURATION_ENABLED=true 才启）。
const skillCurationScheduler = settings.agentRun.skillCurationEnabled
  ? getDefaultAgentRunSkillCurationScheduler()
  : undefined;
skillCurationScheduler?.start();

// R2 auth epic：会话清扫——仅密码/混合模式启动（nickname 模式不签发会话，无需清扫）。
const sessionSweepScheduler =
  settings.auth.authMode !== "nickname" ? getDefaultSessionSweepScheduler() : undefined;
sessionSweepScheduler?.start();

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
  skillCurationScheduler?.stop();
  sessionSweepScheduler?.stop();
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
