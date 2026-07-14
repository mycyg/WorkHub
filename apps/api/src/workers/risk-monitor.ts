import {
  getDefaultRiskMonitorService,
  type RiskMonitorRunResult,
  type RiskMonitorService
} from "../services/risk-monitor.js";
import { getDefaultStructuredLogger, type StructuredLogger } from "../logging.js";

// R14 批 RISK（风险预警巡检 worker）：薄壳定时调度——真正的"扫候选 → 三信号判定 → digest 组装 →
// 通知+会话播报"逻辑全部在 apps/api/src/services/risk-monitor.ts 的 runOnce()（依赖注入、可单测）。
// 这个文件只负责 tick 调度节奏，形态照抄 apps/api/src/workers/conversation-reply-judge.ts
// （running 守卫 + 独立可测 tick() + 定时器 unref 不挡进程退出）。
//
// 关键差异：**不受 isConfigured 门控**——三信号全是确定性 SQL 规则判定，不调 LLM（见
// r14-release-readiness/05-risk-design.md §0 的裁定），没配 LLM key 的自托管实例照样开箱可用。
// server.ts 挂载时应与 recoveryScheduler/sessionSweepScheduler 同档（无条件启动），不与
// conversationObserverScheduler 同档（那一档才是 isConfigured 门控）。挂载接线归集成者（本工包禁区），
// snippet 见施工报告 r12-desktop-workbench/reports/r14-risk-server.md。

// 1 小时——信号本身按天变化，不需要 observer 那种 15s 高频；1 小时探测一次足够及时发现
// "今天该发但还没发"的候选并在同一天内补上（24 次/天的扫描量对一个规则查询完全不是负担）。
const DEFAULT_INTERVAL_MS = 60 * 60 * 1000;

export type RiskMonitorScheduler = {
  tick: () => Promise<RiskMonitorRunResult>;
  start: () => void;
  stop: () => void;
  stats: () => {
    running: boolean;
    tick_count: number;
    sent_count: number;
    failed_count: number;
    error_count: number;
    last_tick_at?: string;
    last_error_message?: string;
  };
};

export type RiskMonitorSchedulerOptions = {
  intervalMs?: number;
  now?: () => Date;
  logger?: Pick<StructuredLogger, "error">;
};

function zeroResult(startedAt: Date): RiskMonitorRunResult {
  const iso = startedAt.toISOString();
  return {
    scanned: 0,
    sent: 0,
    refreshed: 0,
    no_signal: 0,
    skipped_no_owner: 0,
    skipped_no_conversation: 0,
    failed: 0,
    started_at: iso,
    finished_at: iso
  };
}

export function createRiskMonitorScheduler(
  service: RiskMonitorService,
  options: RiskMonitorSchedulerOptions = {}
): RiskMonitorScheduler {
  const now = options.now ?? (() => new Date());
  const logger = options.logger ?? getDefaultStructuredLogger();
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  let timer: ReturnType<typeof setInterval> | undefined;
  let running = false;
  let tickCount = 0;
  let sentCount = 0;
  let failedCount = 0;
  let errorCount = 0;
  let lastTickAt: string | undefined;
  let lastErrorMessage: string | undefined;

  async function tick(): Promise<RiskMonitorRunResult> {
    if (running) {
      return zeroResult(now());
    }
    running = true;
    try {
      const result = await service.runOnce();
      tickCount += 1;
      sentCount += result.sent;
      failedCount += result.failed;
      lastTickAt = result.finished_at;
      return result;
    } catch (error) {
      errorCount += 1;
      lastErrorMessage = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      running = false;
    }
  }

  function start() {
    if (timer || intervalMs <= 0) {
      return;
    }
    timer = setInterval(() => {
      void tick().catch((error) => {
        logger.error?.("risk_monitor_tick_failed", { error });
      });
    }, intervalMs);
    timer.unref?.();
  }

  function stop() {
    if (!timer) {
      return;
    }
    clearInterval(timer);
    timer = undefined;
  }

  return {
    tick,
    start,
    stop,
    stats: () => ({
      running,
      tick_count: tickCount,
      sent_count: sentCount,
      failed_count: failedCount,
      error_count: errorCount,
      ...(lastTickAt ? { last_tick_at: lastTickAt } : {}),
      ...(lastErrorMessage ? { last_error_message: lastErrorMessage } : {})
    })
  };
}

let defaultScheduler: RiskMonitorScheduler | undefined;

export function getDefaultRiskMonitorScheduler(): RiskMonitorScheduler {
  if (!defaultScheduler) {
    defaultScheduler = createRiskMonitorScheduler(getDefaultRiskMonitorService());
  }
  return defaultScheduler;
}
