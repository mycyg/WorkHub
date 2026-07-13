import assert from "node:assert/strict";
import { test } from "node:test";

import { deriveActionCardItemId } from "./item-id.js";

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

test("deriveActionCardItemId returns a well-formed, valid UUID string", () => {
  const id = deriveActionCardItemId("11111111-1111-4111-8111-111111111111", 42, 0);
  assert.match(id, UUID_V4_RE);
});

test("deriveActionCardItemId is deterministic: the same inputs always yield the same id", () => {
  const a = deriveActionCardItemId("conv-1", 10, 2);
  const b = deriveActionCardItemId("conv-1", 10, 2);
  assert.equal(a, b);
});

test("deriveActionCardItemId changes when the conversation id differs", () => {
  const a = deriveActionCardItemId("conv-1", 10, 0);
  const b = deriveActionCardItemId("conv-2", 10, 0);
  assert.notEqual(a, b);
});

test("deriveActionCardItemId changes when analyzedToSeq differs", () => {
  const a = deriveActionCardItemId("conv-1", 10, 0);
  const b = deriveActionCardItemId("conv-1", 11, 0);
  assert.notEqual(a, b);
});

test("deriveActionCardItemId changes when ordinal differs", () => {
  const a = deriveActionCardItemId("conv-1", 10, 0);
  const b = deriveActionCardItemId("conv-1", 10, 1);
  assert.notEqual(a, b);
});

test("deriveActionCardItemId does not collide across a spread of ordinals/seqs for the same conversation", () => {
  const ids = new Set<string>();
  for (let seq = 0; seq < 20; seq += 1) {
    for (let ordinal = 0; ordinal < 8; ordinal += 1) {
      ids.add(deriveActionCardItemId("conv-fixed", seq, ordinal));
    }
  }
  assert.equal(ids.size, 20 * 8);
});
