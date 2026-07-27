import { getDefaultStructuredLogger } from "../logging.js";
import { getDefaultEventOutboxDrain } from "../services/conversations.js";
import type { EventOutboxDrain, EventOutboxDrainResult } from "../services/event-outbox.js";

// R20 P2-01（事务性 outbox · 崩溃恢复）：event_outbox 里 pending 的领域事件由这个调度器周期性 drain。
// 正常发消息走即席 drain（createMessage 提交后立刻发）；这个后台循环补的是两类残留：
//   1) 进程在「消息事务已提交、事件未 publish」之间崩溃——重启后 start() 先跑一次 drain 把它们补发；
//   2) publish 一时失败（如 broker 抖动）留 pending 的行——按 interval 重放至发出。
// 与 session-sweep 同款：unref 定时器不阻塞进程退出；tick() 可独立直测（不依赖定时器）。

const DEFAULT_INTERVAL_MS = 30 * 1000; // 30s

export type EventOutboxDrainScheduler = {
  tick: () => Promise<EventOutboxDrainResult>;
  start: () => void;
  stop: () => void;
  stats: () => {
    running: boolean;
    tick_count: number;
    published_count: number;
    failed_count: number;
    // R21 加固：drain 顺带清理的过期已发布行累计数（见 services/event-outbox.ts 的 purge）。
    purged_count: number;
    error_count: number;
    last_tick_at?: string;
    last_error_message?: string;
  };
};

export function createEventOutboxDrainScheduler(options: {
  drain: EventOutboxDrain;
  intervalMs?: number;
  now?: () => Date;
  onError?: (error: unknown) => void;
}): EventOutboxDrainScheduler {
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const now = options.now ?? (() => new Date());
  let timer: ReturnType<typeof setInterval> | undefined;
  let running = false;
  let tickCount = 0;
  let publishedCount = 0;
  let failedCount = 0;
  let purgedCount = 0;
  let errorCount = 0;
  let lastTickAt: string | undefined;
  let lastErrorMessage: string | undefined;

  async function tick(): Promise<EventOutboxDrainResult> {
    if (running) {
      // 上一 tick 还没跑完 → 跳过本次（drain 自身已有进程内互斥，这里再挡一层避免堆积）。
      return { scanned: 0, published: 0, failed: 0, purged: 0 };
    }
    running = true;
    try {
      const result = await options.drain();
      tickCount += 1;
      publishedCount += result.published;
      failedCount += result.failed;
      purgedCount += result.purged;
      lastTickAt = now().toISOString();
      return result;
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
    // 启动即跑一次：补发上次进程崩溃残留在 pending 的行（崩溃恢复的关键一跳）。
    void tick().catch((error) => {
      getDefaultStructuredLogger().error("event_outbox_drain_tick_failed", { error });
    });
    timer = setInterval(() => {
      void tick().catch((error) => {
        getDefaultStructuredLogger().error("event_outbox_drain_tick_failed", { error });
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
      published_count: publishedCount,
      failed_count: failedCount,
      purged_count: purgedCount,
      error_count: errorCount,
      ...(lastTickAt ? { last_tick_at: lastTickAt } : {}),
      ...(lastErrorMessage ? { last_error_message: lastErrorMessage } : {})
    })
  };
}

let defaultScheduler: EventOutboxDrainScheduler | undefined;

export function getDefaultEventOutboxDrainScheduler(): EventOutboxDrainScheduler {
  defaultScheduler ??= createEventOutboxDrainScheduler({ drain: getDefaultEventOutboxDrain() });
  return defaultScheduler;
}
