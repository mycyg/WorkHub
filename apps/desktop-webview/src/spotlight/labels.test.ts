import assert from "node:assert/strict";
import { test } from "node:test";

import { workItemStatusLabel } from "./labels.js";

test("desktop spotlight work item status labels hide raw machine enums", () => {
  assert.equal(workItemStatusLabel("ai_working", true), "AI 正在处理");
  assert.equal(workItemStatusLabel("ai_working", false), "AI working");
});

test("desktop spotlight work item status labels preserve unknown values", () => {
  assert.equal(workItemStatusLabel("future_state", true), "future_state");
});
