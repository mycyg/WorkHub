import type { SessionRepository } from "@workhub/db";

import { getDefaultAuthDependencies } from "../middleware/auth.js";

// R2 auth epic：会话清扫调度器。周期性硬删绝对过期的死会话（sessions.deleteExpired），防止会话表无界增长。
// 仅 AUTH_MODE!='nickname' 时由 server 启动（nickname 模式不签发会话 → 无需清扫）。mirror agent-run-recovery：
// unref 的定时器不阻止进程退出；tick() 可独立直测（不依赖定时器，避免 node:test 挂起）。

const DEFAULT_INTERVAL_MS = 60 * 60 * 1000; // 1 小时

export type SessionSweepTickResult = {
  deleted: number;
  started_at: string;
  finished_at: string;
};

export type SessionSweepScheduler = {
  tick: () => Promise<SessionSweepTickResult>;
  start: () => void;
  stop: () => void;
  stats: () => {
    running: boolean;
    tick_count: number;
    deleted_count: number;
    error_count: number;
    last_tick_at?: string;
    last_error_message?: string;
  };
};

export function createSessionSweepScheduler(options: {
  sessions: Pick<SessionRepository, "deleteExpired">;
  intervalMs?: number;
  now?: () => Date;
  onError?: (error: unknown) => void;
}): SessionSweepScheduler {
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const now = options.now ?? (() => new Date());
  let timer: ReturnType<typeof setInterval> | undefined;
  let running = false;
  let tickCount = 0;
  let deletedCount = 0;
  let errorCount = 0;
  let lastTickAt: string | undefined;
  let lastErrorMessage: string | undefined;

  async function tick(): Promise<SessionSweepTickResult> {
    const startedAt = now();
    if (running) {
      // 上一 tick 还没跑完 → 跳过本次（清扫不必抢跑）。
      return { deleted: 0, started_at: startedAt.toISOString(), finished_at: startedAt.toISOString() };
    }
    running = true;
    try {
      const deleted = await options.sessions.deleteExpired(now());
      const finishedAt = now();
      tickCount += 1;
      deletedCount += deleted;
      lastTickAt = finishedAt.toISOString();
      return { deleted, started_at: startedAt.toISOString(), finished_at: finishedAt.toISOString() };
    } catch (error) {
      errorCount += 1;
      lastErrorMessage = error instanceof Error ? error.message : String(error);
      options.onError?.(error);
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
        console.warn("WorkHub session sweep tick failed", error);
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
      deleted_count: deletedCount,
      error_count: errorCount,
      ...(lastTickAt ? { last_tick_at: lastTickAt } : {}),
      ...(lastErrorMessage ? { last_error_message: lastErrorMessage } : {})
    })
  };
}

let defaultScheduler: SessionSweepScheduler | undefined;

export function getDefaultSessionSweepScheduler(): SessionSweepScheduler {
  const deps = getDefaultAuthDependencies();
  if (!deps.sessions) {
    throw new Error("session repository not configured");
  }
  defaultScheduler ??= createSessionSweepScheduler({ sessions: deps.sessions });
  return defaultScheduler;
}
