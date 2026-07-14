import { serve } from "@hono/node-server";

import app, { attachWebStatic, logger } from "./app.js";
import { settings } from "@workhub/config";
import { getDefaultProviderRegistry } from "./services/provider-registry.js";
import { getDefaultAgentRunRecoveryScheduler } from "./workers/agent-run-recovery.js";
import { getDefaultAgentRunSkillCurationScheduler } from "./workers/agent-skill-curation.js";
import { getDefaultConversationObserverScheduler } from "./workers/conversation-observer.js";
import { getDefaultConversationReplyJudgeScheduler } from "./workers/conversation-reply-judge.js";
import { getDefaultSessionSweepScheduler } from "./workers/session-sweep.js";
import { getDefaultRiskMonitorScheduler } from "./workers/risk-monitor.js";
import { getDefaultGithubSyncScheduler } from "./workers/github-poll.js";

// 进程级兜底：未捕获异常/未处理 rejection 此前无人接，一次走线的 throw/reject 会静默杀掉 daemon
// 或留下半死状态。早注册（先于 server start），与下方 SIGINT/SIGTERM 优雅退出互补、不替代。
// uncaughtException：进程已处于不确定状态——记一条 fatal 结构化日志后 exit(1)，让进程管理器干净重启；
// 用 reentrancy guard 防 handler 自身再抛导致递归。unhandledRejection：记 error 不退出（多为可恢复的局部失败）。
let handlingFatalException = false;
process.on("uncaughtException", (error) => {
  if (handlingFatalException) {
    return;
  }
  handlingFatalException = true;
  logger.error("uncaught_exception", { fatal: true, error });
  process.exit(1);
});
process.on("unhandledRejection", (reason) => {
  logger.error("unhandled_rejection", { reason });
});

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

// R14 批 RISK：PM 例行巡检（三信号确定性规则，不依赖 LLM）——与 recovery/sessionSweep 同档
// 无条件启动，不做 isConfigured 门控（无 key 自托管也要能巡检）。
const riskMonitorScheduler = getDefaultRiskMonitorScheduler();
riskMonitorScheduler.start();

// R14 批 GH：GitHub 轮询——加密密钥未配置时 runOnce 自守卫零结果（fail-closed 不哑火进程），
// 故与 risk-monitor 同档无条件启动。
const githubPollScheduler = getDefaultGithubSyncScheduler();
githubPollScheduler.start();

// R12 批3：主区静默观察者——LLM provider 未配置时不启动（tick 会逐会话打 LLM，未配置只会
// 刷 consecutive_failures 噪音），与 meta-planner/cross-agent-judge 的 isConfigured 守卫同款语义。
const conversationObserverScheduler = getDefaultProviderRegistry().isConfigured()
  ? getDefaultConversationObserverScheduler()
  : undefined;
if (conversationObserverScheduler) {
  conversationObserverScheduler.start();
} else {
  logger.info("conversation_observer_disabled", { reason: "llm_provider_not_configured" });
}

// R13 批4c：回话判定器——未被 @ 的群聊消息用便宜档 LLM 判断 Cuu 该不该主动回话（项目经理
// 视角）。与观察者同款 isConfigured 守卫：provider 未配置时不启动。
const conversationReplyJudgeScheduler = getDefaultProviderRegistry().isConfigured()
  ? getDefaultConversationReplyJudgeScheduler()
  : undefined;
if (conversationReplyJudgeScheduler) {
  conversationReplyJudgeScheduler.start();
} else {
  logger.info("conversation_reply_judge_disabled", { reason: "llm_provider_not_configured" });
}

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
  riskMonitorScheduler.stop();
  githubPollScheduler.stop();
  conversationObserverScheduler?.stop();
  conversationReplyJudgeScheduler?.stop();
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
