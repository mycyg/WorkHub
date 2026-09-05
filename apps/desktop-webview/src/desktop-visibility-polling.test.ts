import assert from "node:assert/strict";
import test from "node:test";

import { startVisibilityAwarePolling } from "./desktop-visibility-polling.js";

// DSK-10：周期刷新随窗口可见性暂停——隐藏停表、可见补刷一次再恢复；disposer 清表 + 摘监听。

function fakeEnv(initialHidden = false) {
  let hidden = initialHidden;
  const timers = new Map<number, () => void>();
  let seq = 0;
  let visibilityHandler: (() => void) | undefined;
  return {
    isHidden: () => hidden,
    onVisibilityChange(handler: () => void) {
      visibilityHandler = handler;
      return () => {
        visibilityHandler = undefined;
      };
    },
    setIntervalFn(handler: () => void) {
      const id = seq;
      seq += 1;
      timers.set(id, handler);
      return id;
    },
    clearIntervalFn(id: unknown) {
      timers.delete(id as number);
    },
    setHidden(next: boolean) {
      hidden = next;
      visibilityHandler?.();
    },
    fire() {
      for (const handler of [...timers.values()]) {
        handler();
      }
    },
    pendingCount: () => timers.size,
    hasListener: () => visibilityHandler !== undefined
  };
}

test("polling pauses while the window is hidden and refreshes once on becoming visible again", () => {
  const env = fakeEnv();
  let refreshes = 0;
  const stop = startVisibilityAwarePolling({
    refresh: () => {
      refreshes += 1;
    },
    intervalMs: 30_000,
    isHidden: env.isHidden,
    onVisibilityChange: env.onVisibilityChange,
    setIntervalFn: env.setIntervalFn,
    clearIntervalFn: env.clearIntervalFn
  });

  assert.equal(env.pendingCount(), 1);
  env.fire();
  assert.equal(refreshes, 1);

  // 隐藏：停表，之后的 tick 不再刷新。
  env.setHidden(true);
  assert.equal(env.pendingCount(), 0);

  // 重新可见：立刻补刷一次 + 恢复节拍。
  env.setHidden(false);
  assert.equal(refreshes, 2, "becoming visible triggers one immediate catch-up refresh");
  assert.equal(env.pendingCount(), 1);
  env.fire();
  assert.equal(refreshes, 3);

  stop();
  assert.equal(env.pendingCount(), 0);
  assert.equal(env.hasListener(), false, "disposer removes the visibilitychange listener");
});

test("starting hidden does not schedule the interval until the window becomes visible", () => {
  const env = fakeEnv(true);
  let refreshes = 0;
  const stop = startVisibilityAwarePolling({
    refresh: () => {
      refreshes += 1;
    },
    intervalMs: 30_000,
    isHidden: env.isHidden,
    onVisibilityChange: env.onVisibilityChange,
    setIntervalFn: env.setIntervalFn,
    clearIntervalFn: env.clearIntervalFn
  });

  assert.equal(env.pendingCount(), 0, "hidden at start = no timer scheduled");
  env.setHidden(false);
  assert.equal(refreshes, 1);
  assert.equal(env.pendingCount(), 1);
  stop();
});
