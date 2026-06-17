import assert from "node:assert/strict";
import test from "node:test";

import type { TeamSkillRow } from "@workhub/db";

import { buildTeamSkillsPage } from "./pages/team-skills.js";

function row(over: Partial<TeamSkillRow> & Pick<TeamSkillRow, "skillKey">): TeamSkillRow {
  return {
    id: `ts-${over.skillKey}`,
    workspaceId: "00000000-0000-4000-8000-000000000001",
    name: over.name ?? over.skillKey,
    whenToUse: "用于该类任务",
    contentMd: "---\nname: x\nwhen_to_use: y\n---\n\n# x\n正文",
    status: "active",
    version: 1,
    sourceKind: "distilled",
    createdByKind: "ai",
    confidenceScore: 0.85,
    sampleCount: 6,
    samplesJson: {},
    sourceRunId: null,
    deprecatedReason: null,
    deprecatedAt: null,
    createdAt: new Date("2026-06-15T00:00:00.000Z"),
    updatedAt: new Date("2026-06-16T00:00:00.000Z"),
    ...over
  } as TeamSkillRow;
}

test("buildTeamSkillsPage maps active skills, sorts by key, and totals correctly", () => {
  const page = buildTeamSkillsPage({
    skills: [
      row({ skillKey: "quarterly-report", version: 3 }),
      row({ skillKey: "code-script", createdByKind: "human", sourceKind: "authored" })
    ],
    generatedAt: new Date("2026-06-16T02:00:00.000Z")
  });
  assert.equal(page.skills.length, 2);
  // 按 skill_key 排序。
  assert.equal(page.skills[0]?.skill_key, "code-script");
  assert.equal(page.skills[1]?.skill_key, "quarterly-report");
  assert.equal(page.skills[1]?.version, 3);
  assert.equal(page.totals.active, 2);
  assert.equal(page.totals.ai_authored, 1); // quarterly-report=ai, code-script=human
  assert.equal(page.totals.refined, 0); // 没有 provenance
  assert.equal(page.empty_state, undefined);
});

test("findings: out-of-range / non-finite confidence is clamped/skipped, not 500ing the page", () => {
  // 越界值夹紧到 [0,1]，不抛 InternalContractError。
  const over = buildTeamSkillsPage({ skills: [row({ skillKey: "over", confidenceScore: 1.7 })] });
  assert.equal(over.skills[0]?.confidence_score, 1);

  const under = buildTeamSkillsPage({ skills: [row({ skillKey: "under", confidenceScore: -0.4 })] });
  assert.equal(under.skills[0]?.confidence_score, 0);

  // NaN / 非有限值：跳过该字段而不是毒化整页。
  const nan = buildTeamSkillsPage({ skills: [row({ skillKey: "nan", confidenceScore: Number.NaN })] });
  assert.equal(nan.skills[0]?.confidence_score, undefined);
});

test("buildTeamSkillsPage surfaces K2 refinement provenance from samplesJson", () => {
  const page = buildTeamSkillsPage({
    skills: [
      row({
        skillKey: "quarterly-report",
        version: 3,
        samplesJson: {
          refined_from_version: 2,
          ops: [{ op: "add_section", section: "边界情况" }],
          rationale_md: "补边界情况"
        }
      })
    ]
  });
  const skill = page.skills[0];
  assert.equal(skill?.provenance?.refined_from_version, 2);
  assert.equal(skill?.provenance?.op_count, 1);
  assert.equal(skill?.provenance?.rationale_md, "补边界情况");
  assert.equal(page.totals.refined, 1);
});

test("buildTeamSkillsPage ignores non-refinement samplesJson (new-skill distill provenance)", () => {
  const page = buildTeamSkillsPage({
    skills: [row({ skillKey: "data-analysis", samplesJson: { accepted: 9, escalations: 2 } })]
  });
  assert.equal(page.skills[0]?.provenance, undefined);
  assert.equal(page.totals.refined, 0);
});

test("buildTeamSkillsPage emits no_skills empty state when there are no active skills", () => {
  const page = buildTeamSkillsPage({ skills: [] });
  assert.equal(page.skills.length, 0);
  assert.equal(page.totals.active, 0);
  assert.equal(page.empty_state, "no_skills");
});

test("buildTeamSkillsPage omits confidence_score when null", () => {
  const page = buildTeamSkillsPage({ skills: [row({ skillKey: "x", confidenceScore: null })] });
  assert.equal(page.skills[0]?.confidence_score, undefined);
});
