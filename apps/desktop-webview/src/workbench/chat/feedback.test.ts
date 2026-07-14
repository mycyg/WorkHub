import assert from "node:assert/strict";
import { test } from "node:test";

import { decideFeedbackToggle, normalizeFeedbackNote } from "./feedback.js";

test("decideFeedbackToggle puts a new verdict when there is no current judgement", () => {
  assert.deepEqual(decideFeedbackToggle(undefined, "useful"), { mode: "put", verdict: "useful" });
  assert.deepEqual(decideFeedbackToggle(undefined, "not_useful"), { mode: "put", verdict: "not_useful" });
});

test("decideFeedbackToggle deletes when clicking the already-selected key (undo)", () => {
  assert.deepEqual(decideFeedbackToggle("useful", "useful"), { mode: "delete" });
  assert.deepEqual(decideFeedbackToggle("not_useful", "not_useful"), { mode: "delete" });
});

test("decideFeedbackToggle overwrites (put) when clicking the other key — no delete-then-put needed", () => {
  assert.deepEqual(decideFeedbackToggle("useful", "not_useful"), { mode: "put", verdict: "not_useful" });
  assert.deepEqual(decideFeedbackToggle("not_useful", "useful"), { mode: "put", verdict: "useful" });
});

test("normalizeFeedbackNote trims and collapses blank/whitespace-only input to undefined", () => {
  assert.equal(normalizeFeedbackNote("  这句回复挺准的  "), "这句回复挺准的");
  assert.equal(normalizeFeedbackNote(""), undefined);
  assert.equal(normalizeFeedbackNote("   "), undefined);
  assert.equal(normalizeFeedbackNote(undefined), undefined);
});
