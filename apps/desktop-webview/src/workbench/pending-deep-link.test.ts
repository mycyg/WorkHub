import assert from "node:assert/strict";
import { test } from "node:test";

import {
  consumePendingWorkbenchDeepLink,
  PENDING_WORKBENCH_DEEP_LINK_TTL_MS,
  stashPendingWorkbenchDeepLink
} from "./pending-deep-link.js";

function fakeStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    }
  };
}

test("stash then consume round-trips the project id", () => {
  const storage = fakeStorage();
  let now = 1_000;
  stashPendingWorkbenchDeepLink({ projectId: "project-1" }, { storage, now: () => now });

  const result = consumePendingWorkbenchDeepLink({ storage, now: () => now });

  assert.deepEqual(result, { projectId: "project-1" });
});

test("stash then consume round-trips project + conversation id together", () => {
  const storage = fakeStorage();
  stashPendingWorkbenchDeepLink({ projectId: "project-1", conversationId: "conv-1" }, { storage, now: () => 0 });

  const result = consumePendingWorkbenchDeepLink({ storage, now: () => 0 });

  assert.deepEqual(result, { projectId: "project-1", conversationId: "conv-1" });
});

test("consuming clears the stash — it is a one-time token, not replayed on a second read", () => {
  const storage = fakeStorage();
  stashPendingWorkbenchDeepLink({ projectId: "project-1" }, { storage, now: () => 0 });

  const first = consumePendingWorkbenchDeepLink({ storage, now: () => 0 });
  const second = consumePendingWorkbenchDeepLink({ storage, now: () => 0 });

  assert.deepEqual(first, { projectId: "project-1" });
  assert.equal(second, undefined);
});

test("consuming with nothing stashed returns undefined without throwing", () => {
  const storage = fakeStorage();
  assert.equal(consumePendingWorkbenchDeepLink({ storage, now: () => 0 }), undefined);
});

test("an entry older than the TTL is treated as stale and dropped", () => {
  const storage = fakeStorage();
  stashPendingWorkbenchDeepLink({ projectId: "project-1" }, { storage, now: () => 0 });

  const stale = consumePendingWorkbenchDeepLink({
    storage,
    now: () => PENDING_WORKBENCH_DEEP_LINK_TTL_MS + 1
  });

  assert.equal(stale, undefined);
  // 过期条目在读取时也应被清掉（不留在 storage 里污染下一次判断）。
  assert.equal(storage.values.has("workhub_workbench_pending_deep_link"), false);
});

test("an entry exactly at the TTL boundary still counts as fresh", () => {
  const storage = fakeStorage();
  stashPendingWorkbenchDeepLink({ projectId: "project-1" }, { storage, now: () => 0 });

  const result = consumePendingWorkbenchDeepLink({
    storage,
    now: () => PENDING_WORKBENCH_DEEP_LINK_TTL_MS
  });

  assert.deepEqual(result, { projectId: "project-1" });
});

test("malformed JSON is treated as no stash instead of throwing", () => {
  const storage = fakeStorage({ workhub_workbench_pending_deep_link: "{not json" });
  assert.equal(consumePendingWorkbenchDeepLink({ storage, now: () => 0 }), undefined);
});

test("a stash without a projectId is treated as invalid", () => {
  const storage = fakeStorage({
    workhub_workbench_pending_deep_link: JSON.stringify({ stashedAt: 0 })
  });
  assert.equal(consumePendingWorkbenchDeepLink({ storage, now: () => 0 }), undefined);
});

test("stashing without a projectId is a no-op (nothing to route to)", () => {
  const storage = fakeStorage();
  stashPendingWorkbenchDeepLink({ projectId: "" }, { storage, now: () => 0 });
  assert.equal(storage.values.size, 0);
});

test("a storage that throws on access degrades to no stash instead of crashing boot()", () => {
  const throwingStorage = {
    getItem() {
      throw new Error("storage disabled");
    },
    setItem() {
      throw new Error("storage disabled");
    },
    removeItem() {
      throw new Error("storage disabled");
    }
  };
  assert.doesNotThrow(() => stashPendingWorkbenchDeepLink({ projectId: "project-1" }, { storage: throwingStorage }));
  assert.equal(consumePendingWorkbenchDeepLink({ storage: throwingStorage }), undefined);
});
