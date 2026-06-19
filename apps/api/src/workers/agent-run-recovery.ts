import { settings } from "@workhub/config";

import { getDefaultStructuredLogger } from "../logging.js";
import { getDefaultAgentRunQueue, type AgentRunQueue } from "./agent-runner.js";

export type AgentRunRecoveryTickResult = {
  recovered: number;
  /** 本 tick 恢复记录里被重新入队（status==='queued'）、可被 runNext 放行的条数。 */
  requeued: number;
  /** 本 tick 恢复记录里被死信（status==='failed'，超过重试上限）的条数。 */
  dead_lettered: number;
  drained: number;
  started_at: string;
  finished_at: string;
};

export type AgentRunRecoveryScheduler = {
  tick: () => Promise<AgentRunRecoveryTickResult>;
  start: () => void;
  stop: () => void;
  stats: () => {
    running: boolean;
    tick_count: number;
    recovered_count: number;
    requeued_count: number;
    dead_lettered_count: number;
    drained_count: number;
    error_count: number;
    last_tick_at?: string;
    last_error_message?: string;
  };
};

export function createAgentRunRecoveryScheduler(options: {
  queue: Pick<AgentRunQueue, "recoverExpiredClaims" | "runNext">;
  intervalMs?: number;
  autoDrain?: boolean;
  maxDrainPerTick?: number;
  now?: () => Date;
  onError?: (error: unknown) => void;
}): AgentRunRecoveryScheduler {
  const intervalMs = options.intervalMs ?? settings.agentRun.recoveryIntervalMs;
  const autoDrain = options.autoDrain ?? true;
  // L#45：每个 tick 最多放行有限条 run，避免一次恢复 tick 同步跑完整条队列、霸占进程。
  const maxDrainPerTick = Math.max(1, options.maxDrainPerTick ?? 8);
  const now = options.now ?? (() => new Date());
  let timer: ReturnType<typeof setInterval> | undefined;
  let running = false;
  let tickCount = 0;
  let recoveredCount = 0;
  let requeuedCount = 0;
  let deadLetteredCount = 0;
  let drainedCount = 0;
  let errorCount = 0;
  let lastTickAt: string | undefined;
  let lastErrorMessage: string | undefined;

  async function tick(): Promise<AgentRunRecoveryTickResult> {
    const startedAt = now();
    if (running) {
      return {
        recovered: 0,
        requeued: 0,
        dead_lettered: 0,
        drained: 0,
        started_at: startedAt.toISOString(),
        finished_at: startedAt.toISOString()
      };
    }

    running = true;
    try {
      const recovered = await options.queue.recoverExpiredClaims();
      // 恢复记录是 dead-letter(status==='failed') 与 requeued(status==='queued') 的并集。
      // runNext 只放行重新入队的那些；死信永远拿不回来，绝不能进 drain 预算（否则空 runNext 白跑）。
      const requeued = recovered.filter((run) => run.status === "queued").length;
      const deadLettered = recovered.filter((run) => run.status === "failed").length;
      let drained = 0;
      if (autoDrain && requeued > 0) {
        // 上限取「被重新入队的 claim 数」与硬上限的较小值：只放行可放行的那些，且永不超过硬上限。
        const drainBudget = Math.min(requeued, maxDrainPerTick);
        while (drained < drainBudget) {
          const run = await options.queue.runNext();
          if (!run) {
            break;
          }
          drained += 1;
        }
      }
      const finishedAt = now();
      tickCount += 1;
      recoveredCount += recovered.length;
      requeuedCount += requeued;
      deadLetteredCount += deadLettered;
      drainedCount += drained;
      lastTickAt = finishedAt.toISOString();
      return {
        recovered: recovered.length,
        requeued,
        dead_lettered: deadLettered,
        drained,
        started_at: startedAt.toISOString(),
        finished_at: finishedAt.toISOString()
      };
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
        getDefaultStructuredLogger().error("agent_run_recovery_tick_failed", { error });
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
      recovered_count: recoveredCount,
      requeued_count: requeuedCount,
      dead_lettered_count: deadLetteredCount,
      drained_count: drainedCount,
      error_count: errorCount,
      ...(lastTickAt ? { last_tick_at: lastTickAt } : {}),
      ...(lastErrorMessage ? { last_error_message: lastErrorMessage } : {})
    })
  };
}

let defaultScheduler: AgentRunRecoveryScheduler | undefined;

export function getDefaultAgentRunRecoveryScheduler() {
  defaultScheduler ??= createAgentRunRecoveryScheduler({
    queue: getDefaultAgentRunQueue(),
    intervalMs: settings.agentRun.recoveryIntervalMs
  });
  return defaultScheduler;
}
