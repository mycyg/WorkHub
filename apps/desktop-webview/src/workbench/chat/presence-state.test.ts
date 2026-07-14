import assert from "node:assert/strict";
import { test } from "node:test";

import type { PresenceEntryVm } from "@workhub/contracts";

import { onlineUserIdsFromPresence } from "./presence-state.js";

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
