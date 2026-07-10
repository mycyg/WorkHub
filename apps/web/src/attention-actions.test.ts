import assert from "node:assert/strict";
import test from "node:test";

import { resolveWebMemoryConflictAction } from "./attention-actions.js";

test("web sync-conflict card actions resolve through the typed client instead of pending", async () => {
  const calls: unknown[] = [];
  const result = await resolveWebMemoryConflictAction({
    async resolveMemoryConflict(id: string, payload: unknown) {
      calls.push({ id, payload });
      return { conflict: { id }, attention: { summary_text: "偏好已更新" } };
    }
  }, "/api/memory-conflicts/conflict%201/resolve/accept_incoming?expected_updated_at=2026-07-03T10%3A40%3A00.000Z");

  assert.deepEqual(calls, [{
    id: "conflict 1",
    payload: { resolution: "accept_incoming", expected_updated_at: "2026-07-03T10:40:00.000Z" }
  }]);
  assert.deepEqual(result, { conflict: { id: "conflict 1" }, attention: { summary_text: "偏好已更新" } });
});

// B-R9.6 §3.7：merge_both 提交时把卡上可编辑文本框的内容作为 value_md 覆盖合并草稿；
// 非 merge 动作（含新「都不要」）不带 value_md。
test("B-R9.6 merge_both carries the edited merge draft as value_md", async () => {
  const calls: unknown[] = [];
  const client = {
    async resolveMemoryConflict(id: string, payload: unknown) {
      calls.push({ id, payload });
      return { conflict: { id }, attention: { summary_text: "已合并" } };
    }
  };
  await resolveWebMemoryConflictAction(
    client,
    "/api/memory-conflicts/c1/resolve/merge_both?expected_updated_at=2026-07-03T10%3A40%3A00.000Z",
    "  合并后的一条偏好。  "
  );
  await resolveWebMemoryConflictAction(
    client,
    "/api/memory-conflicts/c1/resolve/discard_both?expected_updated_at=2026-07-03T10%3A40%3A00.000Z",
    "不该被带上的草稿"
  );
  assert.deepEqual(calls, [
    {
      id: "c1",
      payload: {
        resolution: "merge_both",
        expected_updated_at: "2026-07-03T10:40:00.000Z",
        value_md: "合并后的一条偏好。"
      }
    },
    {
      id: "c1",
      payload: { resolution: "discard_both", expected_updated_at: "2026-07-03T10:40:00.000Z" }
    }
  ]);
});
