import assert from "node:assert/strict";
import { test } from "node:test";

import type { PresenceEntryVm } from "@workhub/contracts";

import { applyPresenceToOnlineIds, onlineUserIdsFromPresence } from "./presence-state.js";

test("onlineUserIdsFromPresence collects only the online user ids", () => {
  const entries: PresenceEntryVm[] = [
    { user_id: "a", is_online: true, last_seen_at: "2026-07-12T09:00:00.000Z" },
    { user_id: "b", is_online: false, last_seen_at: "2026-07-12T08:00:00.000Z" },
    { user_id: "c", is_online: true, last_seen_at: null }
  ];
  const online = onlineUserIdsFromPresence(entries);
  assert.equal(online.has("a"), true);
  assert.equal(online.has("b"), false, "offline users must not be treated as online");
  assert.equal(online.has("c"), true);
  assert.equal(online.size, 2);
});

test("onlineUserIdsFromPresence returns an empty set for no entries (no fabricated presence)", () => {
  assert.equal(onlineUserIdsFromPresence([]).size, 0);
});

// —— R20 DSK-UX（R19-11 presence 单源）：per-user 合并进单源集合 —— //

test("applyPresenceToOnlineIds adds newly-online users and removes newly-offline ones", () => {
  const entries: PresenceEntryVm[] = [
    { user_id: "a", is_online: true, last_seen_at: null },
    { user_id: "b", is_online: false, last_seen_at: null }
  ];
  const next = applyPresenceToOnlineIds(["b", "c"], entries);
  assert.deepEqual([...next].sort(), ["a", "c"], "a comes online, b goes offline, c (not in batch) untouched");
});

test("applyPresenceToOnlineIds leaves users the batch never queried untouched (per-user, not full replace)", () => {
  // 这是修「两处圆点打架」的核心：聊天区只查这条会话的成员，不能把 rail 查过、本批没查的人误清成离线。
  const next = applyPresenceToOnlineIds(["x", "y"], [{ user_id: "x", is_online: true, last_seen_at: null }]);
  assert.deepEqual([...next].sort(), ["x", "y"]);
});

test("applyPresenceToOnlineIds returns the same array reference when nothing changed (stable identity)", () => {
  const current = ["a", "b"];
  const same = applyPresenceToOnlineIds(current, [{ user_id: "a", is_online: true, last_seen_at: null }]);
  assert.equal(same, current, "no-op must keep identity so callers can skip re-render");
});

test("applyPresenceToOnlineIds with no entries is a no-op that keeps identity", () => {
  const current = ["a"];
  assert.equal(applyPresenceToOnlineIds(current, []), current);
});
