import assert from "node:assert/strict";
import { test } from "node:test";

import { agentStepPhaseLabel, workItemStatusLabel } from "./labels.js";

test("desktop spotlight work item status labels hide raw machine enums", () => {
  assert.equal(workItemStatusLabel("ai_working", true), "AI 正在处理");
  assert.equal(workItemStatusLabel("ai_working", false), "AI working");
});

test("desktop spotlight work item status labels preserve unknown values", () => {
  assert.equal(workItemStatusLabel("future_state", true), "future_state");
});

test("desktop spotlight agent step phase labels do not expose unknown machine enums", () => {
  assert.equal(agentStepPhaseLabel("future_phase", true), "步骤");
  assert.equal(agentStepPhaseLabel("future_phase", false), "Step");
});
