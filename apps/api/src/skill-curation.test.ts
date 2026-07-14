import assert from "node:assert/strict";
import test from "node:test";

import { editBudgetForTick, type DistilledTeamSkill } from "@workhub/contracts";
import type { AiFeedbackRow, FeedbackSubjectExcerptReader, TeamSkillRow } from "@workhub/db";

import {
  createAgentRunSkillCurationScheduler,
  createSkillCurationProviderAdapters,
  negativeFeedbackWithExcerpts,
  type SkillCurationSchedulerOptions
} from "./workers/agent-skill-curation.js";
import {
  buildCurationPrompt,
  hasCurationSignal,
  hasValidFrontmatter,
  parseDistilledResponse,
  parseSkillEditPatchResponse,
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

// findings[#22]：冲突标记检测从朴素 includes('=======') 改成锚定检测——
// Markdown setext H1 下划线 / 水平分隔线（一行恰为 =======）不再被误判成 git 冲突而过度拒绝；
// 真正的 <<<<<<< / >>>>>>> 冲突块仍被 fail-closed 拒绝。
test("validateSkillEditPatch does NOT reject a Markdown setext underline (=======) as a conflict marker", () => {
  const current = ["---", "name: q", "when_to_use: 用于季度报告", "---", "", "# Q", "", "## 套路", "", "拉数据"].join("\n");
  // 新增段落正文里含一行恰为 ======= 的 setext H1 下划线（合法 Markdown，不是冲突块）。
  const patched = validateSkillEditPatch(
    {
      skill_key: "q",
      base_version: 2,
      ops: [{ op: "add_section", section: "口径", content_md: ["口径说明", "标题", "=======", "正文继续"].join("\n") }],
      rationale_md: "补口径",
      confidence_score: 0.9
    },
    { activeVersion: 2, currentContentMd: current }
  );
  assert.equal(patched.ok, true);
});

test("validateSkillEditPatch still rejects a real git conflict block as conflict_markers", () => {
  const current = ["---", "name: q", "when_to_use: 用于季度报告", "---", "", "# Q", "", "## 套路", "", "拉数据"].join("\n");
  const conflict = ["<<<<<<< HEAD", "我方版本", "=======", "对方版本", ">>>>>>> theirs"].join("\n");
  const patched = validateSkillEditPatch(
    {
      skill_key: "q",
      base_version: 2,
      ops: [{ op: "add_section", section: "口径", content_md: conflict }],
      rationale_md: "误带冲突块",
      confidence_score: 0.9
    },
    { activeVersion: 2, currentContentMd: current }
  );
  assert.deepEqual(patched, { ok: false, reason: "conflict_markers" });
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

test("parseDistilledResponse keeps valid skill markdown code fences inside fenced JSON", () => {
  const contentWithFence = [
    "---",
    "name: 季度报告",
    "when_to_use: 生成季度业务报告",
    "---",
    "",
    "# 季度报告",
    "",
    "示例命令：",
    "```bash",
    "pnpm test",
    "```",
    "",
    "按结果写结论。"
  ].join("\n");
  const fenced = "```json\n" + JSON.stringify({
    distilled_skills: [skill({ content_md: contentWithFence })]
  }) + "\n```";

  const parsed = parseDistilledResponse(fenced);

  assert.equal(parsed.distilled_skills.length, 1);
  assert.match(parsed.distilled_skills[0]?.content_md ?? "", /```bash\npnpm test\n```/u);
});

test("parseSkillEditPatchResponse keeps valid patch markdown code fences inside fenced JSON", () => {
  const fenced = "```json\n" + JSON.stringify({
    patches: [{
      skill_key: "quarterly-report",
      base_version: 2,
      ops: [{
        op: "add_section",
        section: "验证命令",
        content_md: ["运行下面命令：", "```bash", "pnpm test", "```", "再记录结果。"].join("\n")
      }],
      rationale_md: "补充验证命令。",
      confidence_score: 0.9
    }]
  }) + "\n```";

  const parsed = parseSkillEditPatchResponse(fenced);

  assert.equal(parsed.patches.length, 1);
  assert.match(parsed.patches[0]?.ops[0]?.content_md ?? "", /```bash\npnpm test\n```/u);
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
    totalAccepted: 0,
    negativeFeedback: [],
    positiveFeedback: []
  };
  assert.equal(hasCurationSignal(analysis), false);
  assert.equal(hasCurationSignal({ ...analysis, totalAccepted: 3 }), true);
});

test("R14 FEEDBACK hasCurationSignal fires on a feedback-only workspace (negative or positive)", () => {
  const idle: SkillCurationAnalysis = {
    workspaceId: "ws-1",
    acceptedDeliverables: [],
    escalations: [],
    existingSkills: ["code-script"],
    discardedSkills: [],
    activeTeamSkillCount: 0,
    activeSkills: [],
    totalAccepted: 0,
    negativeFeedback: [],
    positiveFeedback: []
  };
  assert.equal(hasCurationSignal(idle), false);
  // 只有差评 → 有信号（否则反馈数据永不触发当晚 curation）。
  assert.equal(
    hasCurationSignal({
      ...idle,
      negativeFeedback: [{ subjectType: "conversation_message", excerpt: "跑偏了", note: null }]
    }),
    true
  );
  // 只有好评 → 也算有信号。
  assert.equal(
    hasCurationSignal({ ...idle, positiveFeedback: [{ subjectType: "proposal", count: 2 }] }),
    true
  );
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
    totalAccepted: 12,
    negativeFeedback: [],
    positiveFeedback: []
  });
  assert.equal(prompt.includes("document"), true);
  assert.equal(prompt.includes("缺少 SQL 导出技能"), true);
  assert.equal(prompt.includes("code-script"), true);
  // 无反馈 → 不出现反例/好评空节（反馈是稀疏信号，无数据时整节不拼）。
  assert.equal(prompt.includes("反例"), false);
  assert.equal(prompt.includes("获好评"), false);
});

test("R14 FEEDBACK buildCurationPrompt injects the negative counter-example section (excerpt + note) and positive counts", () => {
  const prompt = buildCurationPrompt({
    workspaceId: "ws-1",
    acceptedDeliverables: [{ targetKind: "document", count: 12 }],
    escalations: [],
    existingSkills: ["code-script"],
    discardedSkills: [],
    activeTeamSkillCount: 1,
    activeSkills: [],
    totalAccepted: 12,
    negativeFeedback: [
      { subjectType: "conversation_message", excerpt: "这段汇总完全答非所问", note: "跑题了" },
      { subjectType: "proposal", excerpt: "把生产库直接删表", note: null }
    ],
    positiveFeedback: [
      { subjectType: "conversation_message", count: 6 },
      { subjectType: "proposal", count: 2 }
    ]
  });
  // 反例节存在，逐条摘要 + 人话中文主体标签。
  assert.equal(prompt.includes("反例"), true);
  assert.equal(prompt.includes("Cuu 回复"), true);
  assert.equal(prompt.includes("这段汇总完全答非所问"), true);
  assert.equal(prompt.includes("把生产库直接删表"), true);
  // 有备注的条目带「用户备注：」，note 为 null 的条目不带——全 prompt 恰好一处备注。
  assert.equal(prompt.includes("（用户备注：跑题了）"), true);
  assert.equal(prompt.split("用户备注：").length - 1, 1);
  // 好评强化节：只聚合计数，不取全文。
  assert.equal(prompt.includes("获好评 6 次"), true);
  assert.equal(prompt.includes("获好评 2 次"), true);
  // 反例排在好评之前（先给约束、再给素材）。
  assert.equal(prompt.indexOf("反例") < prompt.indexOf("获好评"), true);
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
    totalAccepted: 12,
    negativeFeedback: [],
    positiveFeedback: []
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
      totalAccepted: 9,
      negativeFeedback: [],
      positiveFeedback: []
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

test("scheduler keeps committed skill promotion when post-promote audit fails", async () => {
  const promoted: string[] = [];
  const { scheduler } = buildScheduler({
    repository: {
      async promote(input) {
        promoted.push(input.skillKey);
        return { id: `ts-${input.skillKey}`, version: 1 } as unknown as TeamSkillRow;
      }
    },
    auditLog: {
      async createAuditLog() {
        throw new Error("audit sink unavailable");
      }
    }
  });

  const result = await scheduler.tick();

  assert.equal(result.promoted, 1);
  assert.deepEqual(promoted, ["quarterly-report"]);
});

test("M13 scheduler skips the whole tick (no distill spend) when the curation budget is exhausted", async () => {
  let distillCalls = 0;
  const { scheduler, promoted } = buildScheduler({
    curationBudgetOk: async () => false,
    distill: async () => {
      distillCalls += 1;
      return { distilled_skills: [skill()] };
    }
  });
  const result = await scheduler.tick();
  // 预算耗尽：根本不调用 distill（不烧 token），不晋升任何技能。
  assert.equal(distillCalls, 0);
  assert.equal(result.promoted, 0);
  assert.equal(result.workspaces, 0);
  assert.deepEqual(promoted, []);
});

test("M13 scheduler runs distill when the curation budget is available", async () => {
  let distillCalls = 0;
  const { scheduler } = buildScheduler({
    curationBudgetOk: async () => true,
    distill: async () => {
      distillCalls += 1;
      return { distilled_skills: [skill()] };
    }
  });
  const result = await scheduler.tick();
  assert.equal(distillCalls, 1);
  assert.equal(result.promoted, 1);
});

test("curation provider adapters attach the analysis workspace to usage metering actors", async () => {
  const captured: Array<{ actor: unknown; task: string; source: unknown }> = [];
  const adapters = createSkillCurationProviderAdapters({
    get(actor, task) {
      return {
        messages: {
          create: async (params: { source?: unknown }) => {
            const text = captured.length === 0
              ? JSON.stringify({ distilled_skills: [] })
              : JSON.stringify({ patches: [] });
            captured.push({ actor, task, source: params.source });
            return {
              id: `msg-${task}`,
              content: [
                {
                  type: "text",
                  text
                }
              ]
            };
          }
        }
      } as never;
    }
  });
  const analysis: SkillCurationAnalysis = {
    workspaceId: "ws-tenant-cuu",
    acceptedDeliverables: [{ targetKind: "document", count: 9 }],
    escalations: [],
    existingSkills: ["code-script"],
    discardedSkills: [],
    activeTeamSkillCount: 1,
    activeSkills: [],
    totalAccepted: 9,
    negativeFeedback: [],
    positiveFeedback: []
  };

  await adapters.distill(analysis);
  await adapters.refine(analysis);

  assert.deepEqual(captured.map((call) => call.actor), [
    { id: "skill-curator", label: "skill-curator", workspaceId: "ws-tenant-cuu" },
    { id: "skill-curator", label: "skill-curator", workspaceId: "ws-tenant-cuu" }
  ]);
  assert.deepEqual(captured.map((call) => call.source), ["curation", "curation"]);
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
      totalAccepted: 9,
      negativeFeedback: [],
      positiveFeedback: []
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
    totalAccepted: 9,
    negativeFeedback: [],
    positiveFeedback: []
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

test("scheduler keeps committed skill refinement when post-promote audit fails", async () => {
  const promotedInputs: string[] = [];
  const { scheduler } = buildScheduler({
    repository: {
      async promote(input) {
        promotedInputs.push(input.skillKey);
        return { id: `ts-${input.skillKey}`, version: 3 } as unknown as TeamSkillRow;
      }
    },
    auditLog: {
      async createAuditLog() {
        throw new Error("audit sink unavailable");
      }
    },
    analyze: refineAnalyze(),
    distill: async () => ({ distilled_skills: [] }),
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
  assert.deepEqual(promotedInputs, ["quarterly-report"]);
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
      totalAccepted: 0,
      negativeFeedback: [],
      positiveFeedback: []
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

// ── R14 批 FEEDBACK · W-B：差评样本 → 逐条摘要拼装（negativeFeedbackWithExcerpts）────────────────

function negRow(over: Partial<AiFeedbackRow> = {}): AiFeedbackRow {
  return {
    id: "fb-1",
    subjectType: "conversation_message",
    subjectId: "m1",
    userId: "u1",
    verdict: "not_useful",
    note: null,
    createdAt: new Date("2026-07-10T00:00:00.000Z"),
    updatedAt: new Date("2026-07-10T00:00:00.000Z"),
    ...over
  };
}

function emptyExcerpts(): FeedbackSubjectExcerptReader {
  return {
    conversationMessageTexts: async () => new Map(),
    proposalTitles: async () => new Map(),
    actionCardItemTitles: async () => new Map()
  };
}

test("R14 FEEDBACK negativeFeedbackWithExcerpts批量取正文 (O(3) IN, 禁 N+1), truncates, and marks a tombstone unavailable", async () => {
  const longText = "很".repeat(250);
  const feedback = {
    negativeSamplesSince: async () => [
      negRow({ subjectType: "conversation_message", subjectId: "m1", note: "跑偏" }),
      negRow({ subjectType: "conversation_message", subjectId: "m2-deleted", note: null }),
      negRow({ subjectType: "proposal", subjectId: "p1", note: null }),
      negRow({ subjectType: "action_card_item", subjectId: "a1", note: "没做完" })
    ]
  };
  let msgIds: string[] = [];
  let propIds: string[] = [];
  let itemIds: string[] = [];
  const excerpts: FeedbackSubjectExcerptReader = {
    conversationMessageTexts: async (ids) => {
      msgIds = ids;
      // m2-deleted → null（墓碑/无 text）。
      return new Map([["m1", longText], ["m2-deleted", null]]);
    },
    proposalTitles: async (ids) => {
      propIds = ids;
      return new Map([["p1", "季度报告初稿"]]);
    },
    actionCardItemTitles: async (ids) => {
      itemIds = ids;
      return new Map([["a1", "导出 CSV"]]);
    }
  };
  const result = await negativeFeedbackWithExcerpts({ feedback, excerpts }, "ws-1", new Date());
  // 三组主体各一条 IN（按 subjectType 分桶），禁 N+1。
  assert.deepEqual(msgIds, ["m1", "m2-deleted"]);
  assert.deepEqual(propIds, ["p1"]);
  assert.deepEqual(itemIds, ["a1"]);
  // 顺序与 negativeSamplesSince 返回一致（updated_at desc）。
  assert.equal(result.length, 4);
  // 超长正文按 ≤200 字符截断 + 省略号。
  assert.equal(result[0]?.excerpt.length, 201); // 200 chars + '…'
  assert.equal(result[0]?.excerpt.endsWith("…"), true);
  assert.equal(result[0]?.note, "跑偏");
  // 墓碑/不可用 → 占位而非空串或抛错。
  assert.equal(result[1]?.excerpt, "（内容不可用）");
  assert.equal(result[1]?.note, null);
  assert.equal(result[2]?.excerpt, "季度报告初稿");
  assert.equal(result[3]?.excerpt, "导出 CSV");
  assert.equal(result[3]?.note, "没做完");
});

test("R14 FEEDBACK negativeFeedbackWithExcerpts short-circuits with no samples (no excerpt queries)", async () => {
  let excerptCalls = 0;
  const excerpts: FeedbackSubjectExcerptReader = {
    conversationMessageTexts: async () => {
      excerptCalls += 1;
      return new Map();
    },
    proposalTitles: async () => {
      excerptCalls += 1;
      return new Map();
    },
    actionCardItemTitles: async () => {
      excerptCalls += 1;
      return new Map();
    }
  };
  const result = await negativeFeedbackWithExcerpts(
    { feedback: { negativeSamplesSince: async () => [] }, excerpts },
    "ws-1",
    new Date()
  );
  assert.deepEqual(result, []);
  assert.equal(excerptCalls, 0);
});

test("R14 FEEDBACK negativeFeedbackWithExcerpts forwards the updated_at freshness window + bounded sample cap (re-judged feedback re-counts)", async () => {
  const since = new Date("2026-07-07T00:00:00.000Z");
  let capturedSince: Date | undefined;
  let capturedLimit: number | undefined;
  await negativeFeedbackWithExcerpts(
    {
      feedback: {
        negativeSamplesSince: async (_ws, s, limit) => {
          capturedSince = s;
          capturedLimit = limit;
          return [];
        }
      },
      excerpts: emptyExcerpts()
    },
    "ws-1",
    since
  );
  // 窗口按 updated_at ≥ since 转发——一条被改判、updated_at 落进本窗口的差评会被 negativeSamplesSince
  // 重新选中并流进反例池（「改判重新计入」语义，底层 not_useful/updated_at 过滤见 ai-feedback 仓库测试）。
  assert.equal(capturedSince?.toISOString(), since.toISOString());
  // 取样上限有界（防 prompt 膨胀），默认 20。
  assert.equal(capturedLimit, 20);
});
