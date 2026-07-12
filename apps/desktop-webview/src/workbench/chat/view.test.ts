import assert from "node:assert/strict";
import { test } from "node:test";

import { addAttachment, removeAttachment } from "./view.js";

// mountChatView 本身没有直接单测——这个 workspace 的测试运行器没有真实 DOM（node --import tsx --test，
// 无 jsdom；见 shell.test.ts/rail.test.ts 只测 render*/纯函数这一既有事实，boot.test.ts 同理只测
// 导出的纯函数）。这里只测 view.ts 里唯二导出的纯函数——composer 附件列表的去重/移除逻辑。

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
