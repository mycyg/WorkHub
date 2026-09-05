import { settings } from "@workhub/config";

import { getDefaultStructuredLogger } from "../logging.js";
import { getDefaultAgentRunQueue, type AgentRunQueue } from "./agent-runner.js";

export type AgentRunRecoveryTickResult = {
  unsettled_settled: number;
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
    unsettled_settled_count?: number;
    requeued_count: number;
    dead_lettered_count: number;
    drained_count: number;
    error_count: number;
    last_tick_at?: string;
    last_error_message?: string;
  };
};

export function createAgentRunRecoveryScheduler(options: {
  queue: Pick<AgentRunQueue, "recoverExpiredClaims" | "runNext"> & Partial<Pick<AgentRunQueue, "recoverUnsettledTaskPlanRuns" | "startNext">>;
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
  let unsettledSettledCount = 0;
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
        unsettled_settled: 0,
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
      const unsettledSettled = options.queue.recoverUnsettledTaskPlanRuns
        ? await options.queue.recoverUnsettledTaskPlanRuns()
        : [];
      const recovered = await options.queue.recoverExpiredClaims();
      // 恢复记录是 dead-letter(status==='failed') 与 requeued(status==='queued') 的并集，
      // 这两个计数只用于上报 stats（见下方 requeuedCount/deadLetteredCount），P1-10 起不再
      // 拿 requeued 给 drain 预算把关——drain 预算见下方 while 循环前的注释。
      const requeued = recovered.filter((run) => run.status === "queued").length;
      const deadLettered = recovered.filter((run) => run.status === "failed").length;
      let drained = 0;
      if (autoDrain) {
        // P1-10：drain 预算不再以「本轮 recoverExpiredClaims 产生了 requeued」为闸——queued 存量的来源
        // 不止「过期租约被重排」这一条：请求进程在 enqueue 落库、claim 之前崩溃，也会留下一条 queued 且
        // 从未被认领的 run，它压根不会出现在 recovered/requeued 里，旧代码 requeued===0 时直接跳过 drain，
        // 这条 run 只能靠请求路径的 auto-pump 捞（routes/agent-runs.ts），但那个 auto-pump 只活在触发它的
        // 请求进程里——进程一旦崩溃重启，这条 run 就永久卡在 queued。这里改成无条件循环调用 runNext()（内部
        // 走 queuedRun()→persistence.claimNextQueued，Postgres 端用 `FOR UPDATE SKIP LOCKED` 事务原子认领，
        // 见 packages/db/src/repositories/agent-runs.ts 的 claimNextQueued——多实例并发调用天然互斥，无需
        // 额外加锁），直到 runNext() 返回 null（队列已空）或撞到硬上限 maxDrainPerTick 为止，效果等价于
        // 「min(可 claim 的 queued 存量, maxDrainPerTick)」。死信 run（status==='failed'）从不会被
        // claimNextQueued 选中（它的查询谓词固定 status='queued'），天然被排除出 drain，不需要额外判断。
        // INF-07：drain 优先走 startNext（只认领、后台启动，不等 run 跑完）——旧路径逐条 await runNext
        // 会把最多 maxDrainPerTick 个 run 的完整执行串行进 tick（单个 run 上限 300s，一个 tick 可堵
        // 40 分钟，期间过期租约回收停摆）。queue 未提供 startNext（旧测试桩/自定义队列）时退回 runNext，
        // 保持原有串行语义不变。
        const drainNext = options.queue.startNext ?? (() => options.queue.runNext());
        while (drained < maxDrainPerTick) {
          const run = await drainNext();
          if (!run) {
            break;
          }
          drained += 1;
        }
      }
      const finishedAt = now();
      tickCount += 1;
      unsettledSettledCount += unsettledSettled.length;
      recoveredCount += recovered.length;
      requeuedCount += requeued;
      deadLetteredCount += deadLettered;
      drainedCount += drained;
      lastTickAt = finishedAt.toISOString();
      return {
        unsettled_settled: unsettledSettled.length,
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
    // P1-10：启动时立即跑一轮完整 tick，不等第一个 interval——否则服务重启前已持久化但未被 claim 的
    // queued run（enqueue 落库、claim 之前进程崩溃）要空等一整个 intervalMs（默认 30s，可配更长）才被
    // 捞回，配置值大时等价于永久卡住。tick() 自带 `running` 重入门禁，不会与随后 setInterval 的首次触发
    // 撞车（即便撞车也只是其中一次直接返回空结果，不会双跑）。
    void tick().catch((error) => {
      getDefaultStructuredLogger().error("agent_run_recovery_tick_failed", { error });
    });
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
      ...(unsettledSettledCount > 0 ? { unsettled_settled_count: unsettledSettledCount } : {}),
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
