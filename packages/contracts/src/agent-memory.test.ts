import assert from "node:assert/strict";
import test from "node:test";

import {
  AGENT_MEMORY_PROMPT_TOP_N,
  agentMemoryRecordSchema,
  agentMemoryUpsertInputSchema,
  agentMemoryVersionRecordSchema
} from "./index.js";

const timestamp = "2026-07-03T00:00:00.000Z";
const memoryId = "83000000-0000-4000-8000-000000000001";
const versionId = "83000000-0000-4000-8000-000000000002";
const workspaceId = "83000000-0000-4000-8000-000000000003";
const taskPlanItemId = "83000000-0000-4000-8000-000000000004";
const runId = "83000000-0000-4000-8000-000000000005";

test("R9.3 agent memory contract keeps L1 scoped to one task-plan item", () => {
  const parsed = agentMemoryRecordSchema.parse({
    id: memoryId,
    workspace_id: workspaceId,
    agent_context_id: taskPlanItemId,
    category: "preference",
    key: "concise_approach",
    value_md: "用户偏好短路径，不要铺垫。",
    confidence: 0.7,
    source_run_id: runId,
    base_version: 0,
    current_version: 1,
    created_at: timestamp,
    updated_at: timestamp
  });

  assert.equal(parsed.agent_context_id, taskPlanItemId);
  assert.equal(parsed.current_version, 1);
  assert.equal(AGENT_MEMORY_PROMPT_TOP_N, 5);
});

test("R9.3 agent memory version contract is append-only and records base version", () => {
  const parsed = agentMemoryVersionRecordSchema.parse({
    id: versionId,
    memory_id: memoryId,
    version: 2,
    base_version: 1,
    value_md: "用户偏好短路径，但保留验收依据。",
    source_run_id: runId,
    created_at: timestamp
  });

  assert.equal(parsed.version, 2);
  assert.equal(parsed.base_version, 1);
});

test("R9.3 agent memory upsert input rejects global writes without a task-plan item scope", () => {
  assert.throws(() => agentMemoryUpsertInputSchema.parse({
    workspace_id: workspaceId,
    category: "preference",
    key: "global_write",
    value_md: "不允许绕过 L1 作用域。",
    confidence: 0.5
  }));
});
