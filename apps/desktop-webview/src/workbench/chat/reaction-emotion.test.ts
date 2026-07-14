import assert from "node:assert/strict";
import { test } from "node:test";

import type { ConversationMessageReactionVM } from "@workhub/contracts";

import { newlyAddedReactionKeys, pickCuuReactionEmotion } from "./reaction-emotion.js";

test("newlyAddedReactionKeys reports a brand-new key and a grown key, in contract order", () => {
  const previous: ConversationMessageReactionVM[] = [{ key: "watch", user_ids: ["a"] }];
  const next: ConversationMessageReactionVM[] = [
    { key: "approve", user_ids: ["b"] },
    { key: "watch", user_ids: ["a", "c"] }
  ];
  assert.deepEqual(newlyAddedReactionKeys(previous, next), ["approve", "watch"]);
});

test("newlyAddedReactionKeys reports nothing when a reaction was only removed", () => {
  const previous: ConversationMessageReactionVM[] = [{ key: "approve", user_ids: ["a", "b"] }];
  const next: ConversationMessageReactionVM[] = [{ key: "approve", user_ids: ["a"] }];
  assert.deepEqual(newlyAddedReactionKeys(previous, next), []);
});

test("pickCuuReactionEmotion maps approve/done to celebrating for a Cuu message", () => {
  assert.equal(
    pickCuuReactionEmotion({ senderType: "cuu", previous: [], next: [{ key: "approve", user_ids: ["a"] }] }),
    "celebrating"
  );
  assert.equal(
    pickCuuReactionEmotion({ senderType: "cuu", previous: [], next: [{ key: "done", user_ids: ["a"] }] }),
    "celebrating"
  );
});

test("pickCuuReactionEmotion maps question/disagree to worried and watch to thinking", () => {
  assert.equal(
    pickCuuReactionEmotion({ senderType: "cuu", previous: [], next: [{ key: "question", user_ids: ["a"] }] }),
    "worried"
  );
  assert.equal(
    pickCuuReactionEmotion({ senderType: "cuu", previous: [], next: [{ key: "disagree", user_ids: ["a"] }] }),
    "worried"
  );
  assert.equal(
    pickCuuReactionEmotion({ senderType: "cuu", previous: [], next: [{ key: "watch", user_ids: ["a"] }] }),
    "thinking"
  );
});

test("pickCuuReactionEmotion ignores reactions on non-Cuu messages", () => {
  assert.equal(
    pickCuuReactionEmotion({ senderType: "user", previous: [], next: [{ key: "approve", user_ids: ["a"] }] }),
    undefined
  );
});

test("pickCuuReactionEmotion returns undefined when nothing was newly added (only a removal)", () => {
  assert.equal(
    pickCuuReactionEmotion({
      senderType: "cuu",
      previous: [{ key: "approve", user_ids: ["a", "b"] }],
      next: [{ key: "approve", user_ids: ["a"] }]
    }),
    undefined
  );
});
