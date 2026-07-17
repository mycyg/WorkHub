import assert from "node:assert/strict";
import test from "node:test";

import { createPulseScheduler } from "./pulse-scheduler.js";

test("pulse scheduler runs a registered task and accumulates stats with an injectable clock", async () => {
  const clock = { value: new Date("2026-07-15T00:00:00.000Z") };
  const seen: Array<{ now: string; maxDrainPerTick: number | undefined }> = [];
  const scheduler = createPulseScheduler({ now: () => clock.value });
  scheduler.register({
    name: "demo",
    intervalMs: 1000,
    maxDrainPerTick: 42,
    tick: (ctx) => {
      seen.push({ now: ctx.now.toISOString(), maxDrainPerTick: ctx.maxDrainPerTick });
      return { processed: 3 };
    }
  });

  const result = await scheduler.runTask("demo");
  assert.deepEqual(result, { status: "ran", value: { processed: 3 } });
  assert.deepEqual(seen, [{ now: "2026-07-15T00:00:00.000Z", maxDrainPerTick: 42 }]);

  const stats = scheduler.stats();
  const demo = stats.tasks.demo!;
  assert.equal(demo.tick_count, 1);
  assert.equal(demo.skipped_count, 0);
  assert.equal(demo.error_count, 0);
  assert.equal(demo.interval_ms, 1000);
  assert.equal(demo.last_tick_at, "2026-07-15T00:00:00.000Z");
  assert.equal(stats.running, false);
  assert.deepEqual(scheduler.taskNames(), ["demo"]);
});

test("pulse scheduler skips a task whose previous tick is still running (single-instance mutex)", async () => {
  let entered = 0;
  const scheduler = createPulseScheduler();
  // tick 阻塞在一个真实的短定时器上：既让 running 标志在 await 期间保持为真以驱动互斥，也让事件循环
  // 有实活可干（避免 node:test 把悬而未决的 tick promise 判成「事件循环已排空」）。
  scheduler.register({
    name: "slow",
    intervalMs: 1000,
    tick: () => new Promise<void>((resolve) => {
      entered += 1;
      setTimeout(resolve, 20);
    })
  });

  const first = scheduler.runTask("slow");
  // 上一 tick 还没跑完 → 第二次调用应命中互斥被跳过，不再进入 tick。
  const second = await scheduler.runTask("slow");
  assert.deepEqual(second, { status: "skipped" });
  assert.equal(entered, 1, "the tick body must not run twice concurrently");

  assert.deepEqual(await first, { status: "ran", value: undefined });

  const stats = scheduler.stats();
  assert.equal(stats.tasks.slow!.tick_count, 1);
  assert.equal(stats.tasks.slow!.skipped_count, 1);

  // 上一 tick 结算后，再驱动应正常放行（running 标志在 finally 清掉）。
  const third = await scheduler.runTask("slow");
  assert.equal(third.status, "ran");
  assert.equal(scheduler.stats().tasks.slow!.tick_count, 2);
});

test("pulse scheduler isolates a throwing task: sibling keeps running, error is counted not rethrown", async () => {
  const errors: Array<{ name: string; message: string }> = [];
  const scheduler = createPulseScheduler({
    onError: (name, error) => errors.push({ name, message: (error as Error).message })
  });
  scheduler.register({
    name: "boom",
    intervalMs: 1000,
    tick: () => {
      throw new Error("tick exploded");
    }
  });
  scheduler.register({
    name: "healthy",
    intervalMs: 1000,
    tick: () => "ok"
  });

  const boom = await scheduler.runTask("boom");
  assert.equal(boom.status, "error");
  assert.equal((boom as { error: Error }).error.message, "tick exploded");

  const healthy = await scheduler.runTask("healthy");
  assert.deepEqual(healthy, { status: "ran", value: "ok" });

  assert.deepEqual(errors, [{ name: "boom", message: "tick exploded" }]);
  const stats = scheduler.stats();
  const boomStats = stats.tasks.boom!;
  const healthyStats = stats.tasks.healthy!;
  assert.equal(boomStats.error_count, 1);
  assert.equal(boomStats.tick_count, 0);
  assert.equal(boomStats.last_error_message, "tick exploded");
  assert.equal(healthyStats.tick_count, 1);
  assert.equal(healthyStats.error_count, 0);
});

test("pulse scheduler start/stop are idempotent and honor a disabled (interval<=0) task", () => {
  const scheduler = createPulseScheduler();
  scheduler.register({ name: "disabled", intervalMs: 0, tick: () => undefined });
  scheduler.register({ name: "live", intervalMs: 1_000_000, tick: () => undefined });

  // stop 前从没 start 过——不应抛。
  scheduler.stop();
  scheduler.start();
  // 重复 start 不重复挂表；重复 stop 幂等。
  scheduler.start();
  scheduler.stop();
  scheduler.stop();

  const stats = scheduler.stats();
  assert.equal(stats.tasks.disabled!.tick_count, 0);
  assert.equal(stats.tasks.live!.tick_count, 0);
  assert.equal(stats.running, false);
});

test("pulse scheduler rejects duplicate registration and unknown task names", async () => {
  const scheduler = createPulseScheduler();
  scheduler.register({ name: "once", intervalMs: 1000, tick: () => undefined });
  assert.throws(() => scheduler.register({ name: "once", intervalMs: 2000, tick: () => undefined }), /already registered/);
  await assert.rejects(() => scheduler.runTask("ghost"), /unknown pulse task/);
});

test("R15 批 D: ddl-chase task drives its service through the shared scheduler contract", async () => {
  let calls = 0;
  const scheduler = createPulseScheduler();
  // 镜像 getDefaultPulseScheduler 里 ddl-chase 的注册形状（名字 + maxDrainPerTick），验证它和
  // approval-sla/notification-reminder 走同一条互斥/错误隔离/stats 水管。
  scheduler.register({
    name: "ddl-chase",
    intervalMs: 1_800_000,
    maxDrainPerTick: 200,
    tick: async () => {
      calls += 1;
      return { scanned: 0, delivered: 0, suppressed_daily_cap: 0, skipped_quiet_hours: 0 };
    }
  });
  const outcome = await scheduler.runTask("ddl-chase");
  assert.equal(outcome.status, "ran");
  assert.equal(calls, 1);
  assert.equal(scheduler.stats().tasks["ddl-chase"]!.interval_ms, 1_800_000);
});

test("R20 REL-2: proactive-intent-recovery task drives recoverStalled through the shared scheduler contract", async () => {
  let seen: { now: string; olderThanMs: number; maxAttempts: number; limit: number } | undefined;
  const scheduler = createPulseScheduler();
  // 镜像 getDefaultPulseScheduler 里 proactive-intent-recovery 的注册形状——驱动崩溃恢复扫描，走同一条
  // 互斥/错误隔离/stats 水管，maxDrainPerTick 透传成 limit。
  scheduler.register({
    name: "proactive-intent-recovery",
    intervalMs: 5 * 60 * 1000,
    maxDrainPerTick: 200,
    tick: async (ctx) => {
      seen = { now: ctx.now.toISOString(), olderThanMs: 5 * 60 * 1000, maxAttempts: 3, limit: ctx.maxDrainPerTick ?? 200 };
      return { scanned: 0, recovered: 0, suppressed: 0, stalled: 0, retryable: 0 };
    }
  });
  const outcome = await scheduler.runTask("proactive-intent-recovery");
  assert.equal(outcome.status, "ran");
  assert.equal(seen?.limit, 200, "maxDrainPerTick is threaded into recoverStalled's limit");
  assert.equal(seen?.maxAttempts, 3);
  assert.equal(scheduler.stats().tasks["proactive-intent-recovery"]!.interval_ms, 5 * 60 * 1000);
});
