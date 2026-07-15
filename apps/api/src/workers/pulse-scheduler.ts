import { settings } from "@workhub/config";

import { getDefaultStructuredLogger } from "../logging.js";
import { createApprovalService, type ApprovalService } from "../services/approvals.js";
import { createNotificationService, type NotificationService } from "../services/notifications.js";

// R15 批 A（统一调度器 · 01-batch-a-pipeline.md §A1）：通用周期任务注册器。审批 SLA、通知提醒阶梯、
// 后续主动性投递三家共用一条水管，不再各自手搓 setInterval（agent-run-recovery / session-sweep /
// agent-skill-curation 的形状抽出共享部分）。
// 三条既有教训固化在这里：
//  - 单实例进程内互斥：同名任务上一 tick 未结束则跳过本次并计数（session-sweep 的「清扫不必抢跑」）。
//  - 错误隔离：单任务 tick 抛错记日志 + 计数，绝不连累兄弟任务（SIR-1 心跳自停：一条走线的 throw
//    不该杀掉整个 daemon）。
//  - stats() 暴露运行计数给健康页。
// 每个任务一个独立 unref 定时器（各任务 intervalMs 不同），unref 不阻止进程退出；tick 可手动
// runTask() 直驱，不依赖真实定时器（避免 node:test 挂起）。

export type PulseTickContext = {
  now: Date;
  // 任务契约里的 maxDrainPerTick 透传进来——任务据此给本 tick 的批量处理封顶（避免一 tick 拖垮进程）。
  maxDrainPerTick?: number;
};

export type PulseTask = {
  name: string;
  intervalMs: number;
  tick: (ctx: PulseTickContext) => Promise<unknown> | unknown;
  maxDrainPerTick?: number;
};

export type PulseTaskStats = {
  running: boolean;
  interval_ms: number;
  tick_count: number;
  // 上一 tick 未结束而被跳过的次数（互斥命中计数）。
  skipped_count: number;
  error_count: number;
  last_tick_at?: string;
  last_error_message?: string;
};

export type PulseSchedulerStats = {
  running: boolean;
  tasks: Record<string, PulseTaskStats>;
};

export type PulseTaskRunResult =
  | { status: "ran"; value: unknown }
  | { status: "skipped" }
  | { status: "error"; error: unknown };

export type PulseScheduler = {
  register: (task: PulseTask) => void;
  // 手动驱动一个任务的一次 tick（测试用；也是定时器回调走的同一条路径）。互斥/错误隔离对二者一致。
  runTask: (name: string) => Promise<PulseTaskRunResult>;
  start: () => void;
  stop: () => void;
  stats: () => PulseSchedulerStats;
  taskNames: () => string[];
};

type PulseTaskState = {
  task: PulseTask;
  running: boolean;
  tickCount: number;
  skippedCount: number;
  errorCount: number;
  lastTickAt?: string;
  lastErrorMessage?: string;
  // exactOptionalPropertyTypes：显式可赋 undefined（stop 时清空），故用 `| undefined` 而非可选键。
  timer: ReturnType<typeof setInterval> | undefined;
};

export function createPulseScheduler(options: {
  now?: () => Date;
  onError?: (name: string, error: unknown) => void;
} = {}): PulseScheduler {
  const now = options.now ?? (() => new Date());
  const tasks = new Map<string, PulseTaskState>();

  function register(task: PulseTask) {
    if (tasks.has(task.name)) {
      throw new Error(`pulse task already registered: ${task.name}`);
    }
    tasks.set(task.name, {
      task,
      running: false,
      tickCount: 0,
      skippedCount: 0,
      errorCount: 0,
      timer: undefined
    });
  }

  async function runTask(name: string): Promise<PulseTaskRunResult> {
    const state = tasks.get(name);
    if (!state) {
      throw new Error(`unknown pulse task: ${name}`);
    }
    if (state.running) {
      // 单实例进程内互斥：上一 tick 还没跑完 → 跳过本次并计数，不排队堆积。
      state.skippedCount += 1;
      return { status: "skipped" };
    }
    state.running = true;
    const startedAt = now();
    try {
      const value = await state.task.tick({
        now: startedAt,
        ...(state.task.maxDrainPerTick !== undefined ? { maxDrainPerTick: state.task.maxDrainPerTick } : {})
      });
      state.tickCount += 1;
      state.lastTickAt = now().toISOString();
      return { status: "ran", value };
    } catch (error) {
      // 错误隔离：记日志 + 计数，绝不上抛（否则定时器回调的 rejection 无人接，或连累同进程其它任务）。
      state.errorCount += 1;
      state.lastErrorMessage = error instanceof Error ? error.message : String(error);
      getDefaultStructuredLogger().error("pulse_task_tick_failed", { task: name, error });
      options.onError?.(name, error);
      return { status: "error", error };
    } finally {
      state.running = false;
    }
  }

  function start() {
    for (const [name, state] of tasks) {
      if (state.timer || state.task.intervalMs <= 0) {
        continue;
      }
      state.timer = setInterval(() => {
        // runTask 内部已吞掉所有异常（错误隔离），这里不会有未处理 rejection。
        void runTask(name);
      }, state.task.intervalMs);
      state.timer.unref?.();
    }
  }

  function stop() {
    for (const state of tasks.values()) {
      if (!state.timer) {
        continue;
      }
      clearInterval(state.timer);
      state.timer = undefined;
    }
  }

  function stats(): PulseSchedulerStats {
    const taskStats: Record<string, PulseTaskStats> = {};
    let anyRunning = false;
    for (const [name, state] of tasks) {
      anyRunning = anyRunning || state.running;
      taskStats[name] = {
        running: state.running,
        interval_ms: state.task.intervalMs,
        tick_count: state.tickCount,
        skipped_count: state.skippedCount,
        error_count: state.errorCount,
        ...(state.lastTickAt ? { last_tick_at: state.lastTickAt } : {}),
        ...(state.lastErrorMessage ? { last_error_message: state.lastErrorMessage } : {})
      };
    }
    return { running: anyRunning, tasks: taskStats };
  }

  return {
    register,
    runTask,
    start,
    stop,
    stats,
    taskNames: () => [...tasks.keys()]
  };
}

let defaultPulseScheduler: PulseScheduler | undefined;

// R15 批 A（A2）默认调度器：挂两条任务。
//  - approval-sla：调 expireDueApprovals（此前无任何调用方，escalate_pm/notify_reviewer 分流形同虚设）。
//  - notification-reminder：调 runNotificationReminders（24h 提醒阶梯复活推送）。
// 二者纯 DB 驱动的确定性巡检，无 LLM 依赖，与 risk-monitor/github-poll 同档；仅 PULSE_SCHEDULER_ENABLED
// 总开关门控（见 server.ts）。依赖可注入，便于单测直驱。
export function getDefaultPulseScheduler(deps: {
  approvals?: Pick<ApprovalService, "expireDueApprovals">;
  notifications?: Pick<NotificationService, "runNotificationReminders">;
} = {}): PulseScheduler {
  if (defaultPulseScheduler) {
    return defaultPulseScheduler;
  }
  const approvals = deps.approvals ?? createApprovalService();
  const notifications = deps.notifications ?? createNotificationService();
  const scheduler = createPulseScheduler();

  scheduler.register({
    name: "approval-sla",
    intervalMs: settings.pulse.approvalSlaIntervalMs,
    // 一 tick 最多结算这么多到期审批，避免积压时一次同步跑穿整批。
    maxDrainPerTick: 200,
    tick: async (ctx) => {
      const results = await approvals.expireDueApprovals(
        ctx.maxDrainPerTick !== undefined ? { limit: ctx.maxDrainPerTick } : {}
      );
      if (results.length > 0) {
        getDefaultStructuredLogger().info("pulse_approval_sla_swept", {
          expired: results.length,
          escalated: results.filter((result) => result.escalated).length
        });
      }
      return { expired: results.length, escalated: results.filter((result) => result.escalated).length };
    }
  });

  scheduler.register({
    name: "notification-reminder",
    intervalMs: settings.pulse.notificationReminderIntervalMs,
    maxDrainPerTick: 200,
    tick: async (ctx) => {
      const result = await notifications.runNotificationReminders(
        ctx.maxDrainPerTick !== undefined ? { limit: ctx.maxDrainPerTick } : {}
      );
      if (result.reminded > 0) {
        getDefaultStructuredLogger().info("pulse_notification_reminder_swept", result);
      }
      return result;
    }
  });

  defaultPulseScheduler = scheduler;
  return defaultPulseScheduler;
}
