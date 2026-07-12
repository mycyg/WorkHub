import assert from "node:assert/strict";
import { test } from "node:test";

import { EMPTY_TYPING_STATE, pruneExpiredTypingUsers, upsertTypingUser } from "./typing-state.js";

test("upsertTypingUser adds a new typer to an empty state", () => {
  const next = upsertTypingUser(EMPTY_TYPING_STATE, { userId: "u1", expiresAtMs: 3000 }, 0);
  assert.deepEqual(next, [{ userId: "u1", expiresAtMs: 3000 }]);
});

test("upsertTypingUser replaces (not duplicates) the same user's entry", () => {
  const first = upsertTypingUser(EMPTY_TYPING_STATE, { userId: "u1", expiresAtMs: 1000 }, 0);
  const second = upsertTypingUser(first, { userId: "u1", expiresAtMs: 4000 }, 1000);
  assert.deepEqual(second, [{ userId: "u1", expiresAtMs: 4000 }]);
});

test("upsertTypingUser keeps distinct users as separate entries", () => {
  const first = upsertTypingUser(EMPTY_TYPING_STATE, { userId: "u1", expiresAtMs: 3000 }, 0);
  const second = upsertTypingUser(first, { userId: "u2", expiresAtMs: 3000 }, 0);
  assert.deepEqual(
    second.slice().sort((a, b) => a.userId.localeCompare(b.userId)),
    [
      { userId: "u1", expiresAtMs: 3000 },
      { userId: "u2", expiresAtMs: 3000 }
    ]
  );
});

test("upsertTypingUser prunes other users' expired entries while inserting the new one", () => {
  const first = upsertTypingUser(EMPTY_TYPING_STATE, { userId: "u1", expiresAtMs: 1000 }, 0);
  const second = upsertTypingUser(first, { userId: "u2", expiresAtMs: 5000 }, 2000);
  assert.deepEqual(second, [{ userId: "u2", expiresAtMs: 5000 }]);
});

test("pruneExpiredTypingUsers drops entries whose expiry is at or before now", () => {
  const state = [
    { userId: "u1", expiresAtMs: 1000 },
    { userId: "u2", expiresAtMs: 2000 }
  ];
  assert.deepEqual(pruneExpiredTypingUsers(state, 1000), [{ userId: "u2", expiresAtMs: 2000 }]);
  assert.deepEqual(pruneExpiredTypingUsers(state, 2000), []);
});

test("pruneExpiredTypingUsers returns the same reference when nothing changed (cheap no-op re-render skip)", () => {
  const state = [{ userId: "u1", expiresAtMs: 5000 }];
  assert.equal(pruneExpiredTypingUsers(state, 0), state);
});
