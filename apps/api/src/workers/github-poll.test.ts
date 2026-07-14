import assert from "node:assert/strict";
import test from "node:test";

import { createGithubSyncScheduler } from "./github-poll.js";
import type { GithubSyncRunResult, GithubSyncService } from "../services/github-poll.js";

// R14 批 GH-B：调度节奏(tick/start/stop/stats)测试——照抄
// apps/api/src/workers/conversation-reply-judge.test.ts 的结构与断言口径，只关心薄壳，不重复
// services/github-poll.test.ts 已覆盖的 runOnce() 业务逻辑。

const now = new Date("2026-07-14T12:00:00.000Z");

function tickResult(overrides: Partial<GithubSyncRunResult> = {}): GithubSyncRunResult {
  return {
    scanned: 1,
    synced: 1,
    skipped_not_due: 0,
    failed: 0,
    started_at: now.toISOString(),
    finished_at: now.toISOString(),
    ...overrides
  };
}

test("tick() delegates to the service and accumulates stats across calls", async () => {
  let calls = 0;
  const service: GithubSyncService = {
    async runOnce() {
      calls += 1;
      return tickResult({ synced: calls });
    }
  };
  const scheduler = createGithubSyncScheduler(service, { now: () => now });

  const first = await scheduler.tick();
  const second = await scheduler.tick();

  assert.equal(first.synced, 1);
  assert.equal(second.synced, 2);
  const stats = scheduler.stats();
  assert.equal(stats.tick_count, 2);
  assert.equal(stats.synced_count, 3);
  assert.equal(stats.failed_count, 0);
  assert.equal(stats.error_count, 0);
  assert.equal(stats.running, false);
});

test("tick() is reentrant-safe: a call made while one is already in flight returns a zero result instead of overlapping", async () => {
  let releaseFirst: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  let runs = 0;
  const service: GithubSyncService = {
    async runOnce() {
      runs += 1;
      await gate;
      return tickResult();
    }
  };
  const scheduler = createGithubSyncScheduler(service, { now: () => now });

  const first = scheduler.tick();
  const second = await scheduler.tick();

  assert.equal(second.scanned, 0);
  assert.equal(second.synced, 0);
  assert.equal(runs, 1);

  releaseFirst?.();
  await first;
});

test("tick() records a failure in stats when the service throws, and rethrows so start()'s catch can log it", async () => {
  const service: GithubSyncService = {
    async runOnce() {
      throw new Error("boom");
    }
  };
  const scheduler = createGithubSyncScheduler(service, { now: () => now });

  await assert.rejects(scheduler.tick(), /boom/u);
  const stats = scheduler.stats();
  assert.equal(stats.error_count, 1);
  assert.equal(stats.last_error_message, "boom");
  assert.equal(stats.running, false);
});

test("start()/stop() wire an interval that calls tick and can be torn down without throwing", async () => {
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  const scheduledCallbacks: Array<() => void> = [];
  let cleared = 0;
  // 用假定时器而不是真的等 5 分钟——只验证 start() 真的注册了一个会调用 tick 的回调，以及 stop()
  // 真的清理了它，不依赖真实时间流逝。
  (globalThis as unknown as { setInterval: typeof setInterval }).setInterval = ((callback: () => void) => {
    scheduledCallbacks.push(callback);
    return { unref: () => {} } as unknown as ReturnType<typeof setInterval>;
  }) as typeof setInterval;
  (globalThis as unknown as { clearInterval: typeof clearInterval }).clearInterval = (() => {
    cleared += 1;
  }) as typeof clearInterval;

  try {
    let runs = 0;
    const service: GithubSyncService = {
      async runOnce() {
        runs += 1;
        return tickResult();
      }
    };
    const scheduler = createGithubSyncScheduler(service, { now: () => now, intervalMs: 5 * 60 * 1000 });

    scheduler.start();
    assert.equal(scheduledCallbacks.length, 1);
    scheduledCallbacks[0]?.();
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(runs, 1);

    scheduler.stop();
    assert.equal(cleared, 1);

    // 重复 start() 是幂等的——不会注册第二个定时器。
    scheduler.start();
    scheduler.start();
    assert.equal(scheduledCallbacks.length, 2);
  } finally {
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
  }
});

test("start() does nothing when intervalMs is 0 or negative (disabled scheduling)", () => {
  const service: GithubSyncService = {
    async runOnce() {
      return tickResult();
    }
  };
  const scheduler = createGithubSyncScheduler(service, { now: () => now, intervalMs: 0 });
  scheduler.start();
  // 没有抛错、没有挂起就是通过——没有可观察的定时器状态可断言，这里主要防回归。
  scheduler.stop();
});
