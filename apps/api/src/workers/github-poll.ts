import {
  getDefaultGithubSyncService,
  type GithubSyncRunResult,
  type GithubSyncService
} from "../services/github-poll.js";
import { getDefaultStructuredLogger, type StructuredLogger } from "../logging.js";

// R14 批 GH（GitHub 仓库轮询 worker · 07-gh-design.md §4）：薄壳定时调度——真正的"逐绑定拉
// commits/issues 增量、ETag/限流、写活动表、推进水位"逻辑全部在 apps/api/src/services/github-poll.ts
// 的 runOnce()（依赖注入、可单测）。这个文件只负责 tick 调度节奏，形态照抄
// apps/api/src/workers/conversation-reply-judge.ts（running 守卫 + 独立可测 tick() + 定时器 unref
// 不挡进程退出）。
//
// tick 间隔(5 分钟) != 每绑定同步间隔(15 分钟，在 services/github-poll.ts 内部按 lastSyncedAt/
// lastErrorAt 判定"到期")——两者是不同维度：tick 频率决定"多快发现某个绑定到期该同步了"，同步
// 间隔决定"每个绑定多久真正打一次 GitHub"。5 分钟 tick + 15 分钟同步间隔，最坏延迟 20 分钟，
// 可接受（07-gh-design §4.3）。
//
// 不受 isConfigured 门控——GH 轮询是纯 HTTP 轮询，不调 LLM，与会话观察者/回话判定器不同档
// （07-gh-design §0 结论2）。加密密钥未配置时 runOnce() 内部空转返回零结果，不影响 scheduler 能不能
// start()：挂在 recoveryScheduler/sessionSweepScheduler/riskMonitorScheduler 同一档（无条件启动、
// 内部自行判断要不要真正干活），不挂 conversationObserverScheduler 那一档（isConfigured 门控）。
// 挂载接线归集成者（本工包禁区），snippet 见施工报告 r12-desktop-workbench/reports/r14-gh-worker.md。

const DEFAULT_TICK_INTERVAL_MS = 5 * 60 * 1000;

export type GithubSyncScheduler = {
  tick: () => Promise<GithubSyncRunResult>;
  start: () => void;
  stop: () => void;
  stats: () => {
    running: boolean;
    tick_count: number;
    synced_count: number;
    failed_count: number;
    error_count: number;
    last_tick_at?: string;
    last_error_message?: string;
  };
};

export type GithubSyncSchedulerOptions = {
  intervalMs?: number;
  now?: () => Date;
  logger?: Pick<StructuredLogger, "error">;
};

function zeroResult(startedAt: Date): GithubSyncRunResult {
  const iso = startedAt.toISOString();
  return { scanned: 0, synced: 0, skipped_not_due: 0, failed: 0, started_at: iso, finished_at: iso };
}

export function createGithubSyncScheduler(
  service: GithubSyncService,
  options: GithubSyncSchedulerOptions = {}
): GithubSyncScheduler {
  const now = options.now ?? (() => new Date());
  const logger = options.logger ?? getDefaultStructuredLogger();
  const intervalMs = options.intervalMs ?? DEFAULT_TICK_INTERVAL_MS;
  let timer: ReturnType<typeof setInterval> | undefined;
  let running = false;
  let tickCount = 0;
  let syncedCount = 0;
  let failedCount = 0;
  let errorCount = 0;
  let lastTickAt: string | undefined;
  let lastErrorMessage: string | undefined;

  async function tick(): Promise<GithubSyncRunResult> {
    if (running) {
      return zeroResult(now());
    }
    running = true;
    try {
      const result = await service.runOnce();
      tickCount += 1;
      syncedCount += result.synced;
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
        logger.error?.("github_sync_tick_failed", { error });
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
      synced_count: syncedCount,
      failed_count: failedCount,
      error_count: errorCount,
      ...(lastTickAt ? { last_tick_at: lastTickAt } : {}),
      ...(lastErrorMessage ? { last_error_message: lastErrorMessage } : {})
    })
  };
}

let defaultScheduler: GithubSyncScheduler | undefined;

export function getDefaultGithubSyncScheduler(): GithubSyncScheduler {
  if (!defaultScheduler) {
    defaultScheduler = createGithubSyncScheduler(getDefaultGithubSyncService());
  }
  return defaultScheduler;
}
