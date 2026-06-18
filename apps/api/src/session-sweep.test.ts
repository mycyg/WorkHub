import assert from "node:assert/strict";
import test from "node:test";

import { createSessionSweepScheduler } from "./workers/session-sweep.js";

test("session sweep tick deletes expired sessions and accumulates stats", async () => {
  let deletedAt: Date | undefined;
  const scheduler = createSessionSweepScheduler({
    sessions: {
      async deleteExpired(at: Date) {
        deletedAt = at;
        return 3;
      }
    },
    now: () => new Date("2026-06-18T00:00:00.000Z")
  });

  const result = await scheduler.tick();
  assert.equal(result.deleted, 3);
  assert.ok(deletedAt instanceof Date, "deleteExpired receives the sweep timestamp");

  const stats = scheduler.stats();
  assert.equal(stats.tick_count, 1);
  assert.equal(stats.deleted_count, 3);
  assert.equal(stats.error_count, 0);
});

test("session sweep tick records errors and rethrows without leaving the scheduler running", async () => {
  let captured: unknown;
  const scheduler = createSessionSweepScheduler({
    sessions: {
      async deleteExpired() {
        throw new Error("db down");
      }
    },
    onError: (error) => {
      captured = error;
    }
  });

  await assert.rejects(() => scheduler.tick(), /db down/);
  assert.equal((captured as Error).message, "db down");
  const stats = scheduler.stats();
  assert.equal(stats.error_count, 1);
  assert.equal(stats.running, false, "running flag is cleared in finally so the next tick proceeds");
});
