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
