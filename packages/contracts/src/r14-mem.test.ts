import assert from "node:assert/strict";
import test from "node:test";

import {
  patchTeamSkillRequestSchema,
  patchUserMemoryRequestSchema,
  teamSkillManagementItemVmSchema,
  TEAM_SKILL_MAX_EDIT_OPS,
  userMemoryManagementItemVmSchema,
  userMemoryManagementPageVmSchema
} from "./index.js";

const ts = "2026-07-14T08:31:00.123Z";
const id = "30000000-0000-4000-8000-000000000003";

test("userMemoryManagementItemVmSchema accepts honest provenance and omits it cleanly", () => {
  const withRun = userMemoryManagementItemVmSchema.parse({
    id,
    category: "preference",
    key: "style",
    value_md: "回复要简洁。",
    confidence: 0.8,
    workspace_scoped: true,
    created_at: ts,
    updated_at: ts,
    edited_at: ts,
    provenance: { kind: "agent_run", label: "来自会话《周会》的一次 AI 执行", run_id: id, conversation_id: id }
  });
  assert.equal(withRun.provenance?.kind, "agent_run");
  assert.equal(withRun.edited_at, ts);

  const bare = userMemoryManagementItemVmSchema.parse({
    id,
    category: "correction",
    key: "proposal:abc",
    value_md: "交付物要 PDF。",
    confidence: 0.9,
    workspace_scoped: false,
    created_at: ts,
    updated_at: ts
  });
  assert.equal(bare.provenance, undefined);
  assert.equal("edited_at" in bare, false);
});

test("userMemoryManagementItemVmSchema rejects out-of-range confidence and unknown provenance kinds", () => {
  assert.equal(
    userMemoryManagementItemVmSchema.safeParse({
      id, category: "preference", key: "k", value_md: "v", confidence: 1.5, workspace_scoped: true, created_at: ts, updated_at: ts
    }).success,
    false
  );
  assert.equal(
    userMemoryManagementItemVmSchema.safeParse({
      id, category: "preference", key: "k", value_md: "v", confidence: 0.5, workspace_scoped: true, created_at: ts, updated_at: ts,
      provenance: { kind: "guessed" }
    }).success,
    false
  );
});

test("userMemoryManagementPageVmSchema carries the active total", () => {
  const page = userMemoryManagementPageVmSchema.parse({ generated_at: ts, memories: [], totals: { active: 0 } });
  assert.equal(page.totals.active, 0);
});

test("teamSkillManagementItemVmSchema extends the consumer VM with content_md/status/deprecation", () => {
  const vm = teamSkillManagementItemVmSchema.parse({
    skill_key: "quarterly-report",
    name: "季度报告",
    when_to_use: "写季度报告时",
    version: 4,
    source_kind: "distilled",
    created_by_kind: "human",
    sample_count: 0,
    updated_at: ts,
    id,
    content_md: "---\nname: x\nwhen_to_use: y\n---\n\n## 套路\n\n先列大纲。",
    status: "deprecated",
    deprecated_reason: "superseded by v5",
    deprecated_at: ts,
    source_run_id: id
  });
  assert.equal(vm.status, "deprecated");
  assert.equal(vm.content_md.startsWith("---"), true);
});

test("patchUserMemoryRequestSchema enforces the 2000-char ceiling and a non-empty value", () => {
  assert.equal(patchUserMemoryRequestSchema.safeParse({ value_md: "ok", expected_updated_at: ts }).success, true);
  assert.equal(patchUserMemoryRequestSchema.safeParse({ value_md: "", expected_updated_at: ts }).success, false);
  assert.equal(patchUserMemoryRequestSchema.safeParse({ value_md: "x".repeat(2001), expected_updated_at: ts }).success, false);
  assert.equal(patchUserMemoryRequestSchema.safeParse({ value_md: "ok", expected_updated_at: "not-a-date" }).success, false);
});

test("patchTeamSkillRequestSchema reuses skillEditOpSchema and caps ops at TEAM_SKILL_MAX_EDIT_OPS", () => {
  const op = { op: "modify_section", section: "套路", content_md: "改一下" };
  assert.equal(patchTeamSkillRequestSchema.safeParse({ ops: [op], base_version: 3 }).success, true);
  assert.equal(patchTeamSkillRequestSchema.safeParse({ ops: [], base_version: 3 }).success, false);
  assert.equal(
    patchTeamSkillRequestSchema.safeParse({ ops: Array.from({ length: TEAM_SKILL_MAX_EDIT_OPS + 1 }, () => op), base_version: 3 }).success,
    false
  );
  assert.equal(patchTeamSkillRequestSchema.safeParse({ ops: [op], base_version: 0 }).success, false);
});
