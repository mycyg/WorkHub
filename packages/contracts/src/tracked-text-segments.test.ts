import assert from "node:assert/strict";
import test from "node:test";

import { trackedTextSegments } from "./domain/text-diff3.js";

test("trackedTextSegments treats an empty base as an all-add (new file)", () => {
  const segments = trackedTextSegments("", "line one\nline two");
  assert.deepEqual(segments, [{ type: "add", lines: ["line one", "line two"] }]);
});

test("trackedTextSegments treats an empty proposed as an all-del", () => {
  const segments = trackedTextSegments("gone one\ngone two", "");
  assert.deepEqual(segments, [{ type: "del", lines: ["gone one", "gone two"] }]);
});

test("trackedTextSegments returns a single context run when nothing changed", () => {
  const segments = trackedTextSegments("same\ntext", "same\ntext");
  assert.deepEqual(segments, [{ type: "context", lines: ["same", "text"] }]);
});

test("trackedTextSegments interleaves context / del / add around a middle edit", () => {
  const base = "intro\nold middle\ntail";
  const proposed = "intro\nnew middle\ntail";
  const segments = trackedTextSegments(base, proposed);
  assert.deepEqual(segments, [
    { type: "context", lines: ["intro"] },
    { type: "del", lines: ["old middle"] },
    { type: "add", lines: ["new middle"] },
    { type: "context", lines: ["tail"] }
  ]);
});

test("trackedTextSegments handles a pure insertion with no deleted lines", () => {
  const base = "a\nb";
  const proposed = "a\ninserted\nb";
  const segments = trackedTextSegments(base, proposed);
  assert.deepEqual(segments, [
    { type: "context", lines: ["a"] },
    { type: "add", lines: ["inserted"] },
    { type: "context", lines: ["b"] }
  ]);
});

test("trackedTextSegments bails (undefined) when either side exceeds the line cap", () => {
  const huge = Array.from({ length: 5001 }, (_, i) => `line ${i}`).join("\n");
  assert.equal(trackedTextSegments(huge, "small"), undefined);
  assert.equal(trackedTextSegments("small", huge), undefined);
});
