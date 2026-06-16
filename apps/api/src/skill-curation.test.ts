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
  validateSkillEditPatch,
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
  // #20 体积守卫：超大正文被拒。
  const huge = GOOD_CONTENT + "\n" + "啰嗦".repeat(5000);
  assert.deepEqual(
    validateDistilledSkill(skill({ content_md: huge }), { existingSkills: [] }),
    { ok: false, reason: "exceeds_size_budget" }
  );
});

test("validateSkillEditPatch hardening: rejects no-op and oversized refinements (K2 guards)", () => {
  const current = ["---", "name: q", "when_to_use: 用于季度报告", "---", "", "# Q", "", "## 套路", "", "拉数据"].join("\n");
  // no-op：modify 成与现役逐字相同的正文 → 拒（别空转 bump 版本）。
  const noop = validateSkillEditPatch(
    {
      skill_key: "q",
      base_version: 2,
      ops: [{ op: "modify_section", section: "套路", content_md: "拉数据" }],
      rationale_md: "其实没改",
      confidence_score: 0.9
    },
    { activeVersion: 2, currentContentMd: current }
  );
  assert.deepEqual(noop, { ok: false, reason: "no_effective_change" });

  // 体积：modify 塞入超大正文 → 拒。
  const oversize = validateSkillEditPatch(
    {
      skill_key: "q",
      base_version: 2,
      ops: [{ op: "modify_section", section: "套路", content_md: "x".repeat(9000) }],
      rationale_md: "撑爆",
      confidence_score: 0.9
    },
    { activeVersion: 2, currentContentMd: current }
  );
  assert.deepEqual(oversize, { ok: false, reason: "exceeds_size_budget" });

  // 正常小补丁仍通过。
  const ok = validateSkillEditPatch(
    {
      skill_key: "q",
      base_version: 2,
      ops: [{ op: "add_section", section: "边界情况", content_md: "数据缺口标注假设" }],
      rationale_md: "补边界",
      confidence_score: 0.9
    },
    { activeVersion: 2, currentContentMd: current }
  );
  assert.equal(ok.ok, true);
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
    activeSkills: [],
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
    activeSkills: [],
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
    activeSkills: [],
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
      activeSkills: [],
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
      activeSkills: [],
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

const ACTIVE_SKILL_CONTENT = [
  "---",
  "name: 季度报告",
  "when_to_use: 生成季度业务报告",
  "---",
  "",
  "# 季度报告",
  "",
  "## 套路",
  "",
  "1. 拉数据"
].join("\n");

function refineAnalyze(over: { version?: number } = {}) {
  return async (workspaceId: string) => ({
    workspaceId,
    acceptedDeliverables: [{ targetKind: "document", count: 9 }],
    escalations: [{ reasonMd: "季度报告缺少边界情况说明", trigger: "low_confidence", count: 2 }],
    existingSkills: ["code-script", "quarterly-report"],
    discardedSkills: [],
    activeTeamSkillCount: 1,
    activeSkills: [
      {
        skillKey: "quarterly-report",
        name: "季度报告",
        whenToUse: "生成季度业务报告",
        version: over.version ?? 2,
        contentMd: ACTIVE_SKILL_CONTENT
      }
    ],
    totalAccepted: 9
  });
}

test("scheduler refines an active skill via a bounded edit patch and audits the new version (K2)", async () => {
  const promotedInputs: Array<{ skillKey: string; contentMd: string; samplesJson?: Record<string, unknown> | undefined }> = [];
  const { scheduler, audits } = buildScheduler({
    repository: {
      async promote(input) {
        promotedInputs.push({ skillKey: input.skillKey, contentMd: input.contentMd, samplesJson: input.samplesJson });
        return { id: `ts-${input.skillKey}`, version: 3 } as unknown as TeamSkillRow;
      }
    },
    analyze: refineAnalyze(),
    distill: async () => ({ distilled_skills: [] }), // 本测试只看精修
    refine: async () => ({
      patches: [
        {
          skill_key: "quarterly-report",
          base_version: 2,
          ops: [{ op: "add_section", section: "边界情况", content_md: "数据缺口时标注假设并说明影响。" }],
          rationale_md: "补上反复卡壳的边界情况段。",
          confidence_score: 0.86
        }
      ]
    })
  });
  const result = await scheduler.tick();
  assert.equal(result.refined, 1);
  assert.equal(result.promoted, 0);
  assert.equal(promotedInputs.length, 1);
  assert.equal(promotedInputs[0]?.skillKey, "quarterly-report");
  // 受限补丁真的把新段落写进了正文。
  assert.match(promotedInputs[0]?.contentMd ?? "", /## 边界情况\n\n数据缺口时标注假设并说明影响。/u);
  // 旧段落保留（不是整篇重写）。
  assert.match(promotedInputs[0]?.contentMd ?? "", /## 套路/u);
  // provenance：记录从哪个版本精修来 + 应用了哪些 op。
  assert.equal(promotedInputs[0]?.samplesJson?.["refined_from_version"], 2);
  const refineAudit = audits.find((a) => a.action === "team_skill.refined_via_patch");
  assert.equal(refineAudit?.detailJson?.["skill_key"], "quarterly-report");
  assert.equal(refineAudit?.detailJson?.["to_version"], 3);
});

test("scheduler refines each skill at most once per tick even if the model returns two patches for it (K2 guard)", async () => {
  let promoteCalls = 0;
  const { scheduler } = buildScheduler({
    repository: {
      async promote(input) {
        promoteCalls += 1;
        return { id: `ts-${input.skillKey}`, version: 3 } as unknown as TeamSkillRow;
      }
    },
    analyze: refineAnalyze({ version: 2 }),
    distill: async () => ({ distilled_skills: [] }),
    refine: async () => ({
      patches: [
        {
          skill_key: "quarterly-report",
          base_version: 2,
          ops: [{ op: "add_section", section: "边界情况", content_md: "第一处补丁" }],
          rationale_md: "补丁一",
          confidence_score: 0.9
        },
        {
          skill_key: "quarterly-report",
          base_version: 2,
          ops: [{ op: "add_section", section: "输出格式", content_md: "第二处补丁" }],
          rationale_md: "补丁二",
          confidence_score: 0.9
        }
      ]
    })
  });
  const result = await scheduler.tick();
  // 同一技能一夜只精修一次 → 只 promote 一次，避免对旧底稿双重 churn。
  assert.equal(result.refined, 1);
  assert.equal(promoteCalls, 1);
});

test("scheduler discards a refine patch whose base_version is stale (K2 optimistic concurrency)", async () => {
  const promotedInputs: string[] = [];
  const { scheduler, audits } = buildScheduler({
    repository: {
      async promote(input) {
        promotedInputs.push(input.skillKey);
        return { id: `ts-${input.skillKey}`, version: 3 } as unknown as TeamSkillRow;
      }
    },
    analyze: refineAnalyze({ version: 2 }),
    distill: async () => ({ distilled_skills: [] }),
    refine: async () => ({
      patches: [
        {
          skill_key: "quarterly-report",
          base_version: 1, // 与当前激活 v2 不符 → 作废
          ops: [{ op: "add_section", section: "边界情况", content_md: "x" }],
          rationale_md: "对旧底稿的改动",
          confidence_score: 0.9
        }
      ]
    })
  });
  const result = await scheduler.tick();
  assert.equal(result.refined, 0);
  assert.deepEqual(promotedInputs, []);
  const discard = audits.find((a) => a.action === "team_skill.refine_discarded");
  assert.equal(discard?.detailJson?.["reason"], "stale_base_version");
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
      activeSkills: [],
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
