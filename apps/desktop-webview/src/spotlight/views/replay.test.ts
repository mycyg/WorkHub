import assert from "node:assert/strict";
import { test } from "node:test";

import { runListHtml } from "./replay.js";

test("R9.7 desktop replay empty list avoids dispatch copy", () => {
  const zh = runListHtml([], true);
  const en = runListHtml([], false);

  assert.doesNotMatch(zh, /派活/u);
  assert.doesNotMatch(en, /Dispatch|dispatch/u);
  assert.match(zh, /新建任务后/u);
  assert.match(en, /Create a task/u);
});
