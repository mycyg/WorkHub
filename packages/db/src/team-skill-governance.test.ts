import assert from "node:assert/strict";
import test from "node:test";

import { createTeamSkillRepository, type TeamSkillRow } from "./repositories/team-skill.js";
import { teamSkills } from "./schema/index.js";
import { createQueryRecorder, queryParamValues, queryReferences } from "./test-query-recorder.js";

const workspaceId = "85000000-0000-4000-8000-000000000002";
const skillId = "85000000-0000-4000-8000-000000000101";

function row(over: Partial<TeamSkillRow> = {}): TeamSkillRow {
  return {
    id: skillId,
    workspaceId,
    skillKey: "quarterly-report",
    name: "季度报告",
    whenToUse: "写季度报告时",
    contentMd: "---\nname: 季度报告\nwhen_to_use: 写季度报告时\n---\n\n## 套路\n\n先列大纲。",
    status: "active",
    version: 3,
    sourceKind: "distilled",
    createdByKind: "ai",
    confidenceScore: 0.85,
    sampleCount: 6,
    samplesJson: {},
    sourceRunId: null,
    deprecatedReason: null,
    deprecatedAt: null,
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
    updatedAt: new Date("2026-07-02T00:00:00.000Z"),
    ...over
  } as TeamSkillRow;
}

test("getById fences by id + workspaceId and never leaks across tenants", async () => {
  const target = row();
  const { db, queries } = createQueryRecorder([[target]]);
  const repository = createTeamSkillRepository(db);

  const result = await repository.getById(workspaceId, skillId);

  assert.deepEqual(result, target);
  const select = queries[0];
  assert.equal(select?.operation, "select");
  assert.ok(queryReferences(select?.where, teamSkills.id), "must fence by id");
  assert.ok(queryReferences(select?.where, teamSkills.workspaceId), "must fence by workspace (tenant isolation)");
  assert.equal(select?.limit, 1);
  assert.deepEqual(queryParamValues(select?.where).slice(0, 2), [skillId, workspaceId]);
});

test("getById returns undefined when no row matches the (workspace,id) pair", async () => {
  const { db } = createQueryRecorder([[]]);
  const repository = createTeamSkillRepository(db);
  assert.equal(await repository.getById(workspaceId, skillId), undefined);
});
