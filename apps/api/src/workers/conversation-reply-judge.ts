import {
  getDefaultConversationReplyJudgeService,
  type ConversationReplyJudgeService,
  type ConversationReplyJudgeTickResult
} from "../services/conversation-reply-judge.js";
import { getDefaultStructuredLogger, type StructuredLogger } from "../logging.js";

// R13 批4c/G1（回话判定器 worker）：薄壳定时调度——真正的"扫候选 → 判定 → 触发 turn"逻辑全部在
// apps/api/src/services/conversation-reply-judge.ts 的 runOnce()（依赖注入、可单测）。这个文件只负责
// tick 调度节奏，接一个已经构造好的 ConversationReplyJudgeService，形态照抄
// apps/api/src/workers/conversation-observer.ts 的 createConversationObserverScheduler（running 守卫
// + 独立可测 tick() + 定时器 unref 不挡进程退出）。
//
// 挂载现状（R13 集成时已接线）：server.ts 在 provider 已配置时构造并 start() 本 scheduler
// （isConfigured 守卫，与观察者调度器同款语义），shutdown 时同步 stop()。

const DEFAULT_INTERVAL_MS = 15_000;

export type ConversationReplyJudgeScheduler = {
  tick: () => Promise<ConversationReplyJudgeTickResult>;
  start: () => void;
  stop: () => void;
  stats: () => {
    running: boolean;
    tick_count: number;
    replied_count: number;
    failed_count: number;
    error_count: number;
    last_tick_at?: string;
    last_error_message?: string;
  };
};

export type ConversationReplyJudgeSchedulerOptions = {
  intervalMs?: number;
  now?: () => Date;
  logger?: Pick<StructuredLogger, "error">;
};

function zeroResult(startedAt: Date): ConversationReplyJudgeTickResult {
  const iso = startedAt.toISOString();
  return {
    scanned: 0,
    judged: 0,
    replied: 0,
    skipped_merge_window: 0,
    skipped_already_judged: 0,
    skipped_non_text: 0,
    skipped_cuu_disabled: 0,
    failed: 0,
    started_at: iso,
    finished_at: iso
  };
}

export function createConversationReplyJudgeScheduler(
  service: ConversationReplyJudgeService,
  options: ConversationReplyJudgeSchedulerOptions = {}
): ConversationReplyJudgeScheduler {
  const now = options.now ?? (() => new Date());
  const logger = options.logger ?? getDefaultStructuredLogger();
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  let timer: ReturnType<typeof setInterval> | undefined;
  let running = false;
  let tickCount = 0;
  let repliedCount = 0;
  let failedCount = 0;
  let errorCount = 0;
  let lastTickAt: string | undefined;
  let lastErrorMessage: string | undefined;

  async function tick(): Promise<ConversationReplyJudgeTickResult> {
    if (running) {
      return zeroResult(now());
    }
    running = true;
    try {
      const result = await service.runOnce();
      tickCount += 1;
      repliedCount += result.replied;
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
        logger.error?.("conversation_reply_judge_tick_failed", { error });
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
      replied_count: repliedCount,
      failed_count: failedCount,
      error_count: errorCount,
      ...(lastTickAt ? { last_tick_at: lastTickAt } : {}),
      ...(lastErrorMessage ? { last_error_message: lastErrorMessage } : {})
    })
  };
}

let defaultScheduler: ConversationReplyJudgeScheduler | undefined;

export function getDefaultConversationReplyJudgeScheduler(): ConversationReplyJudgeScheduler {
  if (!defaultScheduler) {
    defaultScheduler = createConversationReplyJudgeScheduler(getDefaultConversationReplyJudgeService());
  }
  return defaultScheduler;
}
