import assert from "node:assert/strict";
import { test } from "node:test";

import { applyComposerChipInsertion, detectComposerTrigger } from "./trigger-parser.js";

test("@ at the very start of the input is a valid trigger with an empty query", () => {
  const match = detectComposerTrigger("@", 1);
  assert.deepEqual(match, { kind: "mention", trigger: "@", start: 0, end: 1, query: "" });
});

test("@ immediately after whitespace is a valid trigger, query grows as you type", () => {
  const match = detectComposerTrigger("hello @zh", 9);
  assert.deepEqual(match, { kind: "mention", trigger: "@", start: 6, end: 9, query: "zh" });
});

test("@ glued to a preceding word (no whitespace boundary) is not a trigger — e.g. an email-like token", () => {
  assert.equal(detectComposerTrigger("hello@zh", 8), null);
});

test("once a space follows the trigger, the picker is no longer active (selection already finished)", () => {
  assert.equal(detectComposerTrigger("@zh anything", 12), null);
});

test("# behaves like @ — valid at line start or after whitespace", () => {
  assert.deepEqual(detectComposerTrigger("#topic", 6), {
    kind: "conversation_ref",
    trigger: "#",
    start: 0,
    end: 6,
    query: "topic"
  });
  assert.deepEqual(detectComposerTrigger("see #topic", 10), {
    kind: "conversation_ref",
    trigger: "#",
    start: 4,
    end: 10,
    query: "topic"
  });
  assert.equal(detectComposerTrigger("see#topic", 9), null);
});

test("/ only triggers at the very start of the message (slash-command semantics, not anywhere)", () => {
  assert.deepEqual(detectComposerTrigger("/skill", 6), {
    kind: "skill_ref",
    trigger: "/",
    start: 0,
    end: 6,
    query: "skill"
  });
  // Not at position 0 — even though it's preceded by whitespace, "/" mid-message is not a command.
  assert.equal(detectComposerTrigger("go to /skill", 12), null);
});

test("no trigger character in the current word returns null", () => {
  assert.equal(detectComposerTrigger("just typing text", 17), null);
});

test("cursor in the middle of the text only considers what precedes it, not the whole string", () => {
  // "@zh" is typed, then the user moved the cursor back in front of a trailing " done".
  const text = "@zh done";
  const match = detectComposerTrigger(text, 3);
  assert.deepEqual(match, { kind: "mention", trigger: "@", start: 0, end: 3, query: "zh" });
});

test("a trigger character that itself isn't at a valid boundary blocks detection, even if an earlier trigger exists further back", () => {
  // "#bar" is glued to "foo" (no whitespace before '#'), so there is no active trigger for the
  // cursor sitting right after "bar" — even though "@foo" earlier in the same run is a red herring.
  assert.equal(detectComposerTrigger("@foo#bar", 8), null);
});

test("cursor clamps into range instead of throwing on out-of-bounds input", () => {
  assert.deepEqual(detectComposerTrigger("@x", 999), { kind: "mention", trigger: "@", start: 0, end: 2, query: "x" });
  assert.equal(detectComposerTrigger("@x", -5), null);
});

test("applyComposerChipInsertion replaces exactly the trigger+query span and places the cursor after the insertion", () => {
  const match = detectComposerTrigger("hi @zh", 6)!;
  const result = applyComposerChipInsertion("hi @zh", match, "@张三 ");
  assert.equal(result.text, "hi @张三 ");
  assert.equal(result.cursor, "hi @张三 ".length);
});

test("applyComposerChipInsertion preserves text after the cursor (mid-string insertion)", () => {
  const text = "@zh please review";
  const match = detectComposerTrigger(text, 3)!; // cursor right after "zh"
  const result = applyComposerChipInsertion(text, match, "@张三");
  assert.equal(result.text, "@张三 please review");
  assert.equal(result.cursor, "@张三".length);
});
