import assert from "node:assert/strict";
import { test } from "node:test";

import {
  addAttachment,
  clampPickerHighlight,
  mapAiProviderHealthState,
  movePickerHighlight,
  removeAttachment,
  shouldShowNoAiProviderBanner
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
