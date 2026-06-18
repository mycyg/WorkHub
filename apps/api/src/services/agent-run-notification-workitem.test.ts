import assert from "node:assert/strict";
import test from "node:test";

import { createAgentRunUserRefResolver } from "./agent-run-notification-workitem.js";

test("R2 audit#5: user-ref resolver maps deleted-inclusive rows, preserving deletedAt", async () => {
  const deletedAt = new Date("2026-06-01T00:00:00.000Z");
  const calls: string[][] = [];
  const resolve = createAgentRunUserRefResolver({
    users: {
      async findRefsByIds(ids) {
        calls.push(ids);
        return [
          { id: "u-active", deletedAt: null },
          { id: "u-gone", deletedAt }
        ];
      }
    }
  });

  const refs = await resolve(["u-active", "u-gone"]);

  assert.deepEqual(calls, [["u-active", "u-gone"]]);
  assert.deepEqual(refs, [
    { id: "u-active", deletedAt: null },
    { id: "u-gone", deletedAt }
  ]);
});

test("R2 audit#5: empty id list short-circuits without touching the repo", async () => {
  let called = false;
  const resolve = createAgentRunUserRefResolver({
    users: {
      async findRefsByIds() {
        called = true;
        return [];
      }
    }
  });

  assert.deepEqual(await resolve([]), []);
  assert.equal(called, false);
});

test("R2 audit#5: repo without findRefsByIds yields no refs (fail-open: all recipients kept)", async () => {
  const resolve = createAgentRunUserRefResolver({ users: {} });
  assert.deepEqual(await resolve(["u-1"]), []);
});
