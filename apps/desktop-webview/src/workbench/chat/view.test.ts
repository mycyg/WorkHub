import assert from "node:assert/strict";
import { test } from "node:test";

import {
  addAttachment,
  clampPickerHighlight,
  createRenderScrollScheduler,
  mapAiProviderHealthState,
  movePickerHighlight,
  removeAttachment,
  shouldShowNoAiProviderBanner,
  type ChatRenderScrollClock
} from "./view.js";

// mountChatView 本身没有直接单测——这个 workspace 的测试运行器没有真实 DOM（node --import tsx --test，
// 无 jsdom；见 shell.test.ts/rail.test.ts 只测 render*/纯函数这一既有事实，boot.test.ts 同理只测
// 导出的纯函数）。这里只测 view.ts 里导出的纯函数——composer 附件列表的去重/移除逻辑，以及 R13 H1
// 键盘可达性的高亮索引状态机（@ picker / 改派 picker / 模式弹层的 DOM 接线本身不在这个文件里测）。

test("addAttachment appends a new attachment", () => {
  const result = addAttachment([], { driveItemId: "d1", name: "a.xlsx" });
  assert.deepEqual(result, [{ driveItemId: "d1", name: "a.xlsx" }]);
});

test("addAttachment does not add a duplicate drive item id twice", () => {
  const existing = [{ driveItemId: "d1", name: "a.xlsx" }];
  const result = addAttachment(existing, { driveItemId: "d1", name: "a.xlsx (renamed alias)" });
  assert.equal(result.length, 1);
  // Keeps the original entry rather than silently overwriting it with the new label.
  assert.equal(result[0]!.name, "a.xlsx");
});

test("addAttachment keeps distinct attachments in insertion order", () => {
  const first = addAttachment([], { driveItemId: "d1", name: "a.xlsx" });
  const second = addAttachment(first, { driveItemId: "d2", name: "b.xlsx" });
  assert.deepEqual(second, [
    { driveItemId: "d1", name: "a.xlsx" },
    { driveItemId: "d2", name: "b.xlsx" }
  ]);
});

test("removeAttachment drops only the matching drive item id", () => {
  const list = [
    { driveItemId: "d1", name: "a.xlsx" },
    { driveItemId: "d2", name: "b.xlsx" }
  ];
  assert.deepEqual(removeAttachment(list, "d1"), [{ driveItemId: "d2", name: "b.xlsx" }]);
});

test("removeAttachment is a no-op when the id is not present", () => {
  const list = [{ driveItemId: "d1", name: "a.xlsx" }];
  assert.deepEqual(removeAttachment(list, "missing"), list);
});

// —— R13 H1：movePickerHighlight / clampPickerHighlight —— //

test("movePickerHighlight starts at the first option on ArrowDown when nothing is highlighted yet", () => {
  assert.equal(movePickerHighlight(undefined, 1, 3), 0);
});

test("movePickerHighlight starts at the last option on ArrowUp when nothing is highlighted yet", () => {
  assert.equal(movePickerHighlight(undefined, -1, 3), 2);
});

test("movePickerHighlight advances forward and wraps past the last option back to the first", () => {
  assert.equal(movePickerHighlight(0, 1, 3), 1);
  assert.equal(movePickerHighlight(1, 1, 3), 2);
  assert.equal(movePickerHighlight(2, 1, 3), 0);
});

test("movePickerHighlight retreats backward and wraps past the first option back to the last", () => {
  assert.equal(movePickerHighlight(2, -1, 3), 1);
  assert.equal(movePickerHighlight(1, -1, 3), 0);
  assert.equal(movePickerHighlight(0, -1, 3), 2);
});

test("movePickerHighlight always returns undefined when there is nothing to highlight", () => {
  assert.equal(movePickerHighlight(undefined, 1, 0), undefined);
  assert.equal(movePickerHighlight(0, -1, 0), undefined);
});

test("clampPickerHighlight defaults to the first option when nothing was highlighted before", () => {
  assert.equal(clampPickerHighlight(undefined, 5), 0);
});

test("clampPickerHighlight leaves an in-range index untouched", () => {
  assert.equal(clampPickerHighlight(2, 5), 2);
});

test("clampPickerHighlight pulls an out-of-range index back to the last option (list shrank)", () => {
  assert.equal(clampPickerHighlight(7, 3), 2);
});

test("clampPickerHighlight returns undefined once the list is empty", () => {
  assert.equal(clampPickerHighlight(0, 0), undefined);
  assert.equal(clampPickerHighlight(undefined, 0), undefined);
});

// —— R14 FIX#8 前端半：无 key 横幅的状态归类/展示判定（纯函数，网络探测本身在 view.ts 内部，不在这里
// 测——同这个文件其它函数一样，只测能剥离出来的纯逻辑）——//

test("mapAiProviderHealthState reports not_configured only when the server explicitly says false", () => {
  assert.equal(mapAiProviderHealthState({ ai_provider_configured: false }), "not_configured");
});

test("mapAiProviderHealthState reports configured when the server says true", () => {
  assert.equal(mapAiProviderHealthState({ ai_provider_configured: true }), "configured");
});

test("mapAiProviderHealthState falls back to unknown when the probe failed (no response at all)", () => {
  assert.equal(mapAiProviderHealthState(undefined), "unknown");
});

test("mapAiProviderHealthState falls back to unknown when the field is missing or the wrong shape", () => {
  assert.equal(mapAiProviderHealthState({}), "unknown");
  assert.equal(mapAiProviderHealthState({ ai_provider_configured: "nope" as unknown as boolean }), "unknown");
});

test("shouldShowNoAiProviderBanner is true only for the explicit not_configured state", () => {
  assert.equal(shouldShowNoAiProviderBanner("not_configured"), true);
  assert.equal(shouldShowNoAiProviderBanner("configured"), false);
  assert.equal(shouldShowNoAiProviderBanner("unknown"), false);
});

// —— R14 批 PERF（切片①）：渲染合帧调度器 createRenderScrollScheduler —— //
// 这个 workspace 的测试运行器没有真实 DOM/rAF（node --import tsx --test，见文件顶部注释）——调度器刻意做成
// 可注入时钟的纯逻辑（同 pet-surface.ts 的 scheduleDesktopPetFirstPaint），用手写 mock clock 驱动，断言合帧
// 语义（N 次触发一帧一渲 / 跨帧不丢 / dispose 取消）。真实浏览器 innerHTML 解析+布局的综合成本只能真机验
// （见 08-perf-design.md §3 方案 C，桌面 DevTools Performance 面板，人工，本批不跑）。

function rafMockClock(): {
  clock: ChatRenderScrollClock;
  flushFrame: () => void;
  cancelled: () => number;
} {
  let queue: Array<() => void> = [];
  let cancels = 0;
  const clock: ChatRenderScrollClock = {
    requestAnimationFrame: (cb) => {
      queue.push(() => cb(0));
      return queue.length; // 句柄 = 1-based 序号（本测试不校验具体值，只要求可传给 cancelAnimationFrame）。
    },
    cancelAnimationFrame: () => {
      cancels += 1;
    }
  };
  return {
    clock,
    // 模拟浏览器进入下一帧：把这一帧排队的所有回调依次触发（真实 rAF 也是攒到帧边界一起跑）。
    flushFrame: () => {
      const batch = queue;
      queue = [];
      for (const cb of batch) {
        cb();
      }
    },
    cancelled: () => cancels
  };
}

test("createRenderScrollScheduler coalesces many schedule() calls in one frame into a single run", () => {
  let runs = 0;
  const { clock, flushFrame } = rafMockClock();
  const scheduler = createRenderScrollScheduler(() => {
    runs += 1;
  }, clock);
  scheduler.schedule();
  scheduler.schedule();
  scheduler.schedule();
  assert.equal(runs, 0, "nothing renders until the frame flushes");
  flushFrame();
  assert.equal(runs, 1, "a whole frame of triggers collapses to exactly one render");
});

test("createRenderScrollScheduler re-arms after a flush so a later trigger still renders (cross-frame not dropped)", () => {
  let runs = 0;
  const { clock, flushFrame } = rafMockClock();
  const scheduler = createRenderScrollScheduler(() => {
    runs += 1;
  }, clock);
  scheduler.schedule();
  flushFrame();
  assert.equal(runs, 1);
  // A trigger arriving after the frame already flushed must queue a fresh frame, not be swallowed.
  scheduler.schedule();
  flushFrame();
  assert.equal(runs, 2);
});

test("createRenderScrollScheduler cancel() drops the pending frame even if the queued callback still fires (dispose)", () => {
  let runs = 0;
  const { clock, flushFrame, cancelled } = rafMockClock();
  const scheduler = createRenderScrollScheduler(() => {
    runs += 1;
  }, clock);
  scheduler.schedule();
  scheduler.cancel();
  flushFrame(); // the host/mock still fires that frame's callback after dispose
  assert.equal(runs, 0, "cancel wins: a disposed view never re-renders");
  assert.equal(cancelled(), 1, "best-effort cancelAnimationFrame ran on the outstanding handle");
});

test("createRenderScrollScheduler falls back to setTimeout(~16ms) when requestAnimationFrame is absent", () => {
  let runs = 0;
  let scheduledMs: number | undefined;
  let timeoutCb: (() => void) | undefined;
  const clock: ChatRenderScrollClock = {
    setTimeout: (cb, ms) => {
      timeoutCb = cb;
      scheduledMs = ms;
      return 7;
    }
  };
  const scheduler = createRenderScrollScheduler(() => {
    runs += 1;
  }, clock);
  scheduler.schedule();
  scheduler.schedule();
  assert.equal(scheduledMs, 16, "one ~16ms frame budget timer for the whole batch");
  assert.equal(runs, 0);
  timeoutCb?.();
  assert.equal(runs, 1, "still coalesced through the timeout fallback path");
});

test("createRenderScrollScheduler cancel() clears the fallback timeout too", () => {
  let runs = 0;
  let cleared: number | undefined;
  let timeoutCb: (() => void) | undefined;
  const clock: ChatRenderScrollClock = {
    setTimeout: (cb) => {
      timeoutCb = cb;
      return 42;
    },
    clearTimeout: (handle) => {
      cleared = handle;
    }
  };
  const scheduler = createRenderScrollScheduler(() => {
    runs += 1;
  }, clock);
  scheduler.schedule();
  scheduler.cancel();
  assert.equal(cleared, 42, "the outstanding fallback timer handle is cleared on dispose");
  timeoutCb?.();
  assert.equal(runs, 0, "and even if the timer still fires, the render is suppressed");
});
