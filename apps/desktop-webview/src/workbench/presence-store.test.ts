import assert from "node:assert/strict";
import { test } from "node:test";

import { createPresenceHandle } from "./presence-store.js";
import { createWorkbenchStore } from "./store.js";

// R20 DSK-UX（R19-11 presence 单源）：presence handle 是 store.onlineUserIds 的读/写/订阅门面。这里钉死
// 「两个消费者写同一个源、互相可见、无变化不通知」的核心契约（聊天区 + rail 曾各刷各的、圆点打架）。

test("createPresenceHandle reads the single source, and applyPresence merges per-user into the same store", () => {
  const store = createWorkbenchStore();
  const presence = createPresenceHandle(store);

  presence.applyPresence([{ user_id: "a", is_online: true, last_seen_at: null }]);
  assert.deepEqual([...presence.getOnline()], ["a"]);
  // getOnline reads the shared store, so a write from any other consumer is visible here too.
  store.setState({ onlineUserIds: ["a", "b"] });
  assert.deepEqual([...presence.getOnline()].sort(), ["a", "b"]);

  // per-user merge: b goes offline, a stays, c (not queried) untouched.
  store.setState({ onlineUserIds: ["a", "b", "c"] });
  presence.applyPresence([{ user_id: "b", is_online: false, last_seen_at: null }]);
  assert.deepEqual([...presence.getOnline()].sort(), ["a", "c"]);
});

test("createPresenceHandle.subscribe fires on online-set changes but not on unrelated store changes", () => {
  const store = createWorkbenchStore();
  const presence = createPresenceHandle(store);
  let hits = 0;
  const unsub = presence.subscribe(() => {
    hits += 1;
  });

  // Unrelated field change must NOT notify presence subscribers.
  store.setState({ inboxCount: 3 });
  assert.equal(hits, 0);

  // Online set change notifies once.
  presence.applyPresence([{ user_id: "a", is_online: true, last_seen_at: null }]);
  assert.equal(hits, 1);

  // A no-op applyPresence keeps identity → no extra notification.
  presence.applyPresence([{ user_id: "a", is_online: true, last_seen_at: null }]);
  assert.equal(hits, 1);

  unsub();
  presence.applyPresence([{ user_id: "z", is_online: true, last_seen_at: null }]);
  assert.equal(hits, 1, "no callbacks after unsubscribe");
});
