import assert from "node:assert/strict";
import { test } from "node:test";

import type { ConversationMessageReactionVM } from "@workhub/contracts";

import { hasOwnReaction, REACTION_KEYS, toggleOwnReaction } from "./reactions.js";

const me = "user-me";
const other = "user-other";

test("REACTION_KEYS mirrors the contract's five slugs in order", () => {
  assert.deepEqual([...REACTION_KEYS], ["approve", "disagree", "done", "question", "watch"]);
});

test("hasOwnReaction is true only when the current user is in that key's user_ids", () => {
  const reactions: ConversationMessageReactionVM[] = [{ key: "approve", user_ids: [me, other] }];
  assert.equal(hasOwnReaction(reactions, "approve", me), true);
  assert.equal(hasOwnReaction(reactions, "approve", "nobody"), false);
  assert.equal(hasOwnReaction(reactions, "done", me), false);
  assert.equal(hasOwnReaction(undefined, "approve", me), false);
  assert.equal(hasOwnReaction(reactions, "approve", undefined), false);
});

test("toggleOwnReaction adds my reaction to a brand-new key and reports action=add", () => {
  const result = toggleOwnReaction(undefined, "approve", me);
  assert.equal(result.action, "add");
  assert.deepEqual(result.reactions, [{ key: "approve", user_ids: [me] }]);
});

test("toggleOwnReaction adds me to an existing key without dropping the other reactor", () => {
  const reactions: ConversationMessageReactionVM[] = [{ key: "approve", user_ids: [other] }];
  const result = toggleOwnReaction(reactions, "approve", me);
  assert.equal(result.action, "add");
  assert.deepEqual(result.reactions, [{ key: "approve", user_ids: [other, me] }]);
});

test("toggleOwnReaction removes me and reports action=remove, keeping other reactors", () => {
  const reactions: ConversationMessageReactionVM[] = [{ key: "approve", user_ids: [other, me] }];
  const result = toggleOwnReaction(reactions, "approve", me);
  assert.equal(result.action, "remove");
  assert.deepEqual(result.reactions, [{ key: "approve", user_ids: [other] }]);
});

test("toggleOwnReaction drops a key entirely once its last reactor (me) is removed", () => {
  const reactions: ConversationMessageReactionVM[] = [{ key: "watch", user_ids: [me] }];
  const result = toggleOwnReaction(reactions, "watch", me);
  assert.equal(result.action, "remove");
  assert.deepEqual(result.reactions, []);
});

test("toggleOwnReaction keeps the new key in contract order, not append order", () => {
  const reactions: ConversationMessageReactionVM[] = [{ key: "watch", user_ids: [me] }];
  const result = toggleOwnReaction(reactions, "approve", me);
  assert.deepEqual(
    result.reactions.map((r) => r.key),
    ["approve", "watch"]
  );
});

test("toggleOwnReaction does not mutate the input array", () => {
  const reactions: ConversationMessageReactionVM[] = [{ key: "approve", user_ids: [other] }];
  const snapshot = JSON.stringify(reactions);
  toggleOwnReaction(reactions, "approve", me);
  assert.equal(JSON.stringify(reactions), snapshot);
});
