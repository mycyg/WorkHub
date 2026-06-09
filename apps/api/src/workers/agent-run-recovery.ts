import { settings } from "@workhub/config";

import { getDefaultAgentRunQueue, type AgentRunQueue } from "./agent-runner.js";

export type AgentRunRecoveryTickResult = {
  recovered: number;
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
  now?: () => Date;
  onError?: (error: unknown) => void;
}): AgentRunRecoveryScheduler {
  const intervalMs = options.intervalMs ?? settings.agentRun.recoveryIntervalMs;
  const autoDrain = options.autoDrain ?? true;
  const now = options.now ?? (() => new Date());
  let timer: ReturnType<typeof setInterval> | undefined;
  let running = false;
  let tickCount = 0;
  let recoveredCount = 0;
  let drainedCount = 0;
  let errorCount = 0;
  let lastTickAt: string | undefined;
  let lastErrorMessage: string | undefined;

  async function tick(): Promise<AgentRunRecoveryTickResult> {
    const startedAt = now();
    if (running) {
      return {
        recovered: 0,
        drained: 0,
        started_at: startedAt.toISOString(),
        finished_at: startedAt.toISOString()
      };
    }

    running = true;
    try {
      const recovered = await options.queue.recoverExpiredClaims();
      let drained = 0;
      if (autoDrain && recovered.length > 0) {
        for (;;) {
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
      drainedCount += drained;
      lastTickAt = finishedAt.toISOString();
      return {
        recovered: recovered.length,
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
        console.warn("WorkHub AgentRun recovery tick failed", error);
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
