import assert from "node:assert/strict";
import test from "node:test";

import { editBudgetForTick, type DistilledTeamSkill } from "@workhub/contracts";
import type { TeamSkillRow } from "@workhub/db";

import {
  createAgentRunSkillCurationScheduler,
  type SkillCurationSchedulerOptions
} from "./workers/agent-skill-curation.js";
import {
  buildCurationPrompt,
  hasCurationSignal,
  hasValidFrontmatter,
  parseDistilledResponse,
  validateDistilledSkill,
  type SkillCurationAnalysis
} from "./services/skill-curation.js";

const GOOD_CONTENT = ["---", "name: 季度报告", "when_to_use: 生成季度业务报告", "---", "", "# 季度报告", "正文"].join("\n");

function skill(over: Partial<DistilledTeamSkill> = {}): DistilledTeamSkill {
  return {
    skill_key: "quarterly-report",
    name: "季度报告",
    when_to_use: "生成季度业务报告",
    content_md: GOOD_CONTENT,
    sample_count: 8,
    confidence_score: 0.85,
    ...over
  };
}

test("hasValidFrontmatter requires name + when_to_use frontmatter", () => {
  assert.equal(hasValidFrontmatter(GOOD_CONTENT), true);
  assert.equal(hasValidFrontmatter("# 没有 frontmatter"), false);
  assert.equal(hasValidFrontmatter("---\nname: x\n---\n正文"), false); // 缺 when_to_use
});

test("validateDistilledSkill gates on samples, confidence, key, dedup, frontmatter", () => {
  assert.equal(validateDistilledSkill(skill(), { existingSkills: [] }).ok, true);

  assert.deepEqual(validateDistilledSkill(skill({ sample_count: 4 }), { existingSkills: [] }), {
    ok: false,
    reason: "insufficient_samples"
  });
  assert.deepEqual(validateDistilledSkill(skill({ confidence_score: 0.69 }), { existingSkills: [] }), {
    ok: false,
    reason: "low_confidence"
  });
  assert.deepEqual(
    validateDistilledSkill(skill(), { existingSkills: ["quarterly-report"] }),
    { ok: false, reason: "duplicate_skill_key" }
  );
  assert.deepEqual(
    validateDistilledSkill(skill({ content_md: "# 无 frontmatter 正文" }), { existingSkills: [] }),
    { ok: false, reason: "invalid_frontmatter" }
  );
});

test("parseDistilledResponse tolerates fenced json and recovers partial-valid items", () => {
  const fenced = "看一下结果：\n```json\n" + JSON.stringify({ distilled_skills: [skill()] }) + "\n```\n";
  assert.equal(parseDistilledResponse(fenced).distilled_skills.length, 1);

  // 一项坏（confidence 超界）不连累另一项合法的。
  const mixed = JSON.stringify({ distilled_skills: [skill(), { ...skill({ skill_key: "bad" }), confidence_score: 9 }] });
  const parsed = parseDistilledResponse(mixed);
  assert.equal(parsed.distilled_skills.length, 1);
  assert.equal(parsed.distilled_skills[0]?.skill_key, "quarterly-report");

  assert.deepEqual(parseDistilledResponse("完全不是 JSON").distilled_skills, []);
  assert.deepEqual(parseDistilledResponse("").distilled_skills, []);
});

test("hasCurationSignal is false on an idle workspace", () => {
  const analysis: SkillCurationAnalysis = {
    workspaceId: "ws-1",
    acceptedDeliverables: [],
    escalations: [],
    existingSkills: ["code-script"],
    discardedSkills: [],
    activeTeamSkillCount: 0,
    totalAccepted: 0
  };
  assert.equal(hasCurationSignal(analysis), false);
  assert.equal(hasCurationSignal({ ...analysis, totalAccepted: 3 }), true);
});

test("buildCurationPrompt surfaces accepted + escalation signals and existing skills", () => {
  const prompt = buildCurationPrompt({
    workspaceId: "ws-1",
    acceptedDeliverables: [{ targetKind: "document", count: 12 }],
    escalations: [{ reasonMd: "缺少 SQL 导出技能", trigger: "low_confidence", count: 2 }],
    existingSkills: ["code-script", "data-analysis"],
    discardedSkills: [],
    activeTeamSkillCount: 2,
    totalAccepted: 12
  });
  assert.equal(prompt.includes("document"), true);
  assert.equal(prompt.includes("缺少 SQL 导出技能"), true);
  assert.equal(prompt.includes("code-script"), true);
});

test("buildCurationPrompt feeds back discarded proposals as a do-not-repeat memory (K1)", () => {
  const prompt = buildCurationPrompt({
    workspaceId: "ws-1",
    acceptedDeliverables: [{ targetKind: "document", count: 12 }],
    escalations: [],
    existingSkills: ["code-script"],
    discardedSkills: [
      { skillKey: "weekly-recap", reason: "low_confidence", count: 3, lastAt: "2026-06-15T00:00:00.000Z" }
    ],
    activeTeamSkillCount: 1,
    totalAccepted: 12
  });
  assert.equal(prompt.includes("勿再原样重提"), true);
  assert.equal(prompt.includes("weekly-recap"), true);
  assert.equal(prompt.includes("被放弃 3 次"), true);
  assert.equal(prompt.includes("low_confidence"), true);
});

test("editBudgetForTick anneals new-skill budget as the active library matures (K3)", () => {
  assert.equal(editBudgetForTick(0), 3); // 空库 → 满预算 = 学习率基准
  assert.equal(editBudgetForTick(25), 2); // 半满 → ceil(3*0.5)
  assert.equal(editBudgetForTick(49), 1); // 接近上限 → 还留 1
  assert.equal(editBudgetForTick(50), 0); // 到硬上限 → 不再新增（只精修/驱逐）
  assert.equal(editBudgetForTick(80), 0); // 超界 clamp
  assert.equal(editBudgetForTick(-5), 3); // 负数 clamp
  assert.equal(editBudgetForTick(10, { base: 0 }), 0); // base=0 → 关闭新增
});

type CapturedAudit = { action: string; entityId: string; detailJson: Record<string, unknown> | undefined };

function buildScheduler(over: Partial<SkillCurationSchedulerOptions> = {}) {
  const audits: CapturedAudit[] = [];
  const promoted: string[] = [];
  const options: SkillCurationSchedulerOptions = {
    repository: {
      async promote(input) {
        promoted.push(input.skillKey);
        return { id: `ts-${input.skillKey}`, version: 1 } as unknown as TeamSkillRow;
      }
    },
    auditLog: {
      async createAuditLog(input) {
        audits.push({ action: input.action, entityId: input.entityId, detailJson: input.detailJson });
        return {} as never;
      }
    },
    listWorkspaces: async () => [{ id: "ws-1" }],
    analyze: async (workspaceId) => ({
      workspaceId,
      acceptedDeliverables: [{ targetKind: "document", count: 9 }],
      escalations: [],
      existingSkills: ["code-script"],
      discardedSkills: [],
      activeTeamSkillCount: 1,
      totalAccepted: 9
    }),
    distill: async () => ({ distilled_skills: [skill()] }),
    now: () => new Date("2026-06-14T00:00:00.000Z"),
    ...over
  };
  return { scheduler: createAgentRunSkillCurationScheduler(options), audits, promoted };
}

test("scheduler promotes a valid distilled skill and audits the promotion", async () => {
  const { scheduler, audits, promoted } = buildScheduler();
  const result = await scheduler.tick();
  assert.equal(result.promoted, 1);
  assert.equal(result.discarded, 0);
  assert.deepEqual(promoted, ["quarterly-report"]);
  assert.equal(audits.length, 1);
  assert.equal(audits[0]?.action, "team_skill.distilled_and_promoted");
});

test("scheduler discards a low-confidence skill and audits the reason (no promote)", async () => {
  const { scheduler, audits, promoted } = buildScheduler({
    distill: async () => ({ distilled_skills: [skill({ confidence_score: 0.5 })] })
  });
  const result = await scheduler.tick();
  assert.equal(result.promoted, 0);
  assert.equal(result.discarded, 1);
  assert.deepEqual(promoted, []);
  assert.equal(audits[0]?.action, "team_skill.distilled_but_discarded");
  assert.equal(audits[0]?.detailJson?.["reason"], "low_confidence");
});

test("scheduler clips promotions to the edit-budget and defers the rest by confidence (K3)", async () => {
  const { scheduler, audits, promoted } = buildScheduler({
    // 活跃库接近上限 → editBudgetForTick(49) = 1：本夜只许晋升 1 个。
    analyze: async (workspaceId) => ({
      workspaceId,
      acceptedDeliverables: [{ targetKind: "document", count: 9 }],
      escalations: [],
      existingSkills: ["code-script"],
      discardedSkills: [],
      activeTeamSkillCount: 49,
      totalAccepted: 9
    }),
    distill: async () => ({
      distilled_skills: [
        skill({ skill_key: "lower-conf", confidence_score: 0.75 }),
        skill({ skill_key: "higher-conf", confidence_score: 0.95 })
      ]
    })
  });
  const result = await scheduler.tick();
  assert.equal(result.promoted, 1);
  assert.equal(result.deferred, 1);
  assert.equal(result.discarded, 0);
  // 预算紧张时优先晋升把握最大的（confidence 降序）。
  assert.deepEqual(promoted, ["higher-conf"]);
  assert.equal(audits.some((a) => a.action === "team_skill.distilled_and_promoted" && a.detailJson?.["skill_key"] === "higher-conf"), true);
  const deferral = audits.find((a) => a.action === "team_skill.deferred_over_budget");
  assert.equal(deferral?.entityId, "lower-conf");
  assert.equal(deferral?.detailJson?.["edit_budget"], 1);
});

test("scheduler skips entirely when the work queue is not idle", async () => {
  const { scheduler, promoted } = buildScheduler({ workQueueIsIdle: async () => false });
  const result = await scheduler.tick();
  assert.equal(result.workspaces, 0);
  assert.equal(result.promoted, 0);
  assert.deepEqual(promoted, []);
});

test("scheduler skips distillation for an idle workspace (no signal → no LLM call)", async () => {
  let distillCalls = 0;
  const { scheduler } = buildScheduler({
    analyze: async (workspaceId) => ({
      workspaceId,
      acceptedDeliverables: [],
      escalations: [],
      existingSkills: [],
      discardedSkills: [],
      activeTeamSkillCount: 0,
      totalAccepted: 0
    }),
    distill: async () => {
      distillCalls += 1;
      return { distilled_skills: [] };
    }
  });
  const result = await scheduler.tick();
  assert.equal(distillCalls, 0);
  assert.equal(result.promoted, 0);
});
