import assert from "node:assert/strict";
import test from "node:test";

import type { AgentLoopResult } from "../loop/types.js";
import { evaluateAgentRunConfidence } from "./confidence.js";

const usage = {
  stepsUsed: 1,
  secondsUsed: 1,
  tokenIn: 10,
  tokenOut: 20,
  totalTokens: 30,
  estimatedCostCny: "0.001"
};

type ResultPartial = Partial<Omit<AgentLoopResult, "manifest">> & {
  manifest?: AgentLoopResult["manifest"];
  omitManifest?: boolean;
};

function result(partial: ResultPartial): AgentLoopResult {
  const { omitManifest, manifest, ...rest } = partial;
  const value: AgentLoopResult = {
    status: "succeeded",
    reason: "交付完成",
    control: "stop",
    usage,
    steps: [
      {
        index: 1,
        assistant: [{ type: "text", text: "done" }],
        toolCalls: [],
        toolResults: [],
        control: "stop",
        snapshotId: "60000000-0000-4000-8000-000000000001",
        startedAt: "2026-06-05T00:00:00.000Z",
        endedAt: "2026-06-05T00:00:01.000Z"
      }
    ],
    manifest: {
      version: 0,
      work_item_id: "50000000-0000-4000-8000-000000000001",
      title: "交付物",
      summary_md: "生成了可审阅的交付物。",
      author: { actor_kind: "ai", label: "AI 工人" },
      base: {
        snapshot_id: "60000000-0000-4000-8000-000000000001",
        branch_head_ref: "head"
      },
      changes: [
        {
          id: "71000000-0000-4000-8000-000000000001",
          target_kind: "text_doc",
          target_ref: { entity_type: "external", path: "/outputs/result.md" },
          change_type: "created",
          human_summary: "新增结果文档"
        }
      ],
      checks: [],
      evidence_refs: [],
      risk: { level: "low", human_label: "可回滚", reversible: true },
      rollback: {
        available: true,
        snapshot_id: "60000000-0000-4000-8000-000000000001",
        description: "可还原到执行前"
      },
      review: {
        reason_required_on_reject: true
      }
    }
  };
  Object.assign(value, rest);
  if (manifest) {
    value.manifest = manifest;
  }
  if (omitManifest) {
    delete value.manifest;
  }
  return value;
}

test("successful file-only runs become human spotcheck unless auto-merge is explicitly allowed", () => {
  const assessment = evaluateAgentRunConfidence({
    runId: "40000000-0000-4000-8000-000000000001",
    workItemId: "50000000-0000-4000-8000-000000000001",
    model: "deepseek-v4-flash",
    result: result({})
  });

  assert.equal(assessment.grade, "high");
  assert.equal(assessment.riskLevel, "low");
  assert.equal(assessment.verdict, "human_spotcheck");
  assert.equal(assessment.escalation, undefined);
  assert.equal((assessment.signalsJson.risk as { has_revert_snapshot: boolean }).has_revert_snapshot, true);
});

test("failed runs become unqualified escalations with a human-readable reason", () => {
  const assessment = evaluateAgentRunConfidence({
    runId: "40000000-0000-4000-8000-000000000002",
    workItemId: "50000000-0000-4000-8000-000000000002",
    model: "deepseek-v4-flash",
    result: result({
      status: "failed",
      reason: "AI 没产出交付物",
      omitManifest: true
    })
  });

  assert.equal(assessment.grade, "low");
  assert.equal(assessment.verdict, "escalate");
  assert.equal(assessment.escalation?.trigger, "unqualified");
  assert.match(assessment.rationaleMd, /AI 没有完成可用交付/u);
});

test("budget and doom-loop handoffs map to their escalation triggers", () => {
  const budget = evaluateAgentRunConfidence({
    runId: "40000000-0000-4000-8000-000000000003",
    workItemId: "50000000-0000-4000-8000-000000000003",
    model: "deepseek-v4-flash",
    result: result({
      status: "escalated",
      reason: "步数预算已耗尽",
      omitManifest: true,
      handoff: {
        done: ["尝试生成草稿"],
        remaining: ["继续补全"],
        nextSteps: ["请人接手"],
        blockers: ["步数预算已耗尽"],
        artifacts: [],
        budgetHit: "steps"
      }
    })
  });
  const doomLoop = evaluateAgentRunConfidence({
    runId: "40000000-0000-4000-8000-000000000004",
    workItemId: "50000000-0000-4000-8000-000000000004",
    model: "deepseek-v4-flash",
    result: result({
      status: "escalated",
      reason: "doom_loop",
      omitManifest: true,
      handoff: {
        done: [],
        remaining: ["需要重新判断策略"],
        nextSteps: ["查看 trace"],
        blockers: ["重复动作"],
        artifacts: [],
        budgetHit: "doom_loop"
      }
    })
  });

  assert.equal(budget.escalation?.trigger, "budget_exhausted");
  assert.equal(doomLoop.escalation?.trigger, "doom_loop");
});

test("confidence fuses llm_review grade with acceptance under R0 weights", () => {
  const base = {
    runId: "40000000-0000-4000-8000-000000000010",
    workItemId: "50000000-0000-4000-8000-000000000010",
    model: "deepseek-v4-flash"
  };
  const succeeded = {
    status: "succeeded" as const,
    reason: "done",
    control: "stop" as const,
    usage: { stepsUsed: 2, secondsUsed: 5, tokenIn: 10, tokenOut: 10, totalTokens: 20, estimatedCostCny: "0.01" },
    steps: [],
    manifest: { work_item_id: base.workItemId } as never
  };

  const highReview = evaluateAgentRunConfidence({
    ...base,
    result: { ...succeeded, review: { source: "llm_review", grade: 5, rationale: "可直接采纳", model: "deepseek-v4-flash" } }
  });
  const lowReview = evaluateAgentRunConfidence({
    ...base,
    result: { ...succeeded, review: { source: "llm_review", grade: 1, rationale: "完全不可用", model: "deepseek-v4-flash" } }
  });
  const noReview = evaluateAgentRunConfidence({ ...base, result: succeeded });

  // grade 5 + manifest: (1*0.5 + 1*0.35)/0.85 = 1
  assert.equal(highReview.confidenceScore, 1);
  // grade 1 + manifest: (0*0.5 + 1*0.35)/0.85 ≈ 0.412 → 低置信，必须升级人审
  assert.equal(lowReview.confidenceScore < 0.6, true);
  assert.equal(lowReview.grade, "low");
  // 无 review 回退启发式
  assert.equal(noReview.confidenceScore, 0.88);
  const sources = (highReview.signalsJson as { sources: { review: { grade?: number; source?: string } } }).sources;
  assert.equal(sources.review.grade, 5);
  assert.equal(sources.review.source, "llm_review");
});

// findings[#3]：收紧自动采纳带——只有 grade===5 才进 auto-merge 资格带；grade 4（=仍需轻微修改）即便融合分越过
// high 门（0.853）也只走人审。即使显式 autoMergeAllowed=true 也不自动采纳。
test("findings[#3] grade 4 review does NOT auto-merge even when auto-merge is allowed; only grade 5 does", () => {
  const base = {
    runId: "40000000-0000-4000-8000-000000000012",
    workItemId: "50000000-0000-4000-8000-000000000012",
    model: "deepseek-v4-flash"
  };
  const succeeded = {
    status: "succeeded" as const,
    reason: "done",
    control: "stop" as const,
    usage: { stepsUsed: 2, secondsUsed: 5, tokenIn: 10, tokenOut: 10, totalTokens: 20, estimatedCostCny: "0.01" },
    steps: [
      {
        index: 1,
        assistant: [{ type: "text" as const, text: "done" }],
        toolCalls: [],
        toolResults: [],
        control: "stop" as const,
        snapshotId: "60000000-0000-4000-8000-000000000012",
        startedAt: "2026-06-05T00:00:00.000Z",
        endedAt: "2026-06-05T00:00:01.000Z"
      }
    ],
    manifest: { work_item_id: base.workItemId } as never
  };

  const grade4 = evaluateAgentRunConfidence({
    ...base,
    autoMergeAllowed: true,
    result: { ...succeeded, review: { source: "llm_review", grade: 4, rationale: "基本可直接采纳", model: "deepseek-v4-flash" } }
  });
  const grade5 = evaluateAgentRunConfidence({
    ...base,
    autoMergeAllowed: true,
    result: { ...succeeded, review: { source: "llm_review", grade: 5, rationale: "可直接采纳", model: "deepseek-v4-flash" } }
  });

  // grade 4 融合分仍是 high 档（0.853 ≥ 0.85）、低风险，但不再越过自动采纳带——降到人审。
  assert.equal(grade4.grade, "high");
  assert.equal(grade4.confidenceScore >= 0.85, true);
  assert.equal(grade4.verdict, "human_spotcheck");
  // grade 5 才是唯一进自动采纳资格带的档（且本例显式允许）。
  assert.equal(grade5.verdict, "auto_merge");
});

// findings[#2]：评审被请求但失败（reviewFailed 置位、无 review）→ fail-closed：向下钳到低置信、必升级人审，
// 绝不回退乐观启发式 0.88。
test("findings[#2] a failed review fails closed to low confidence and escalates, not the optimistic 0.88 heuristic", () => {
  const base = {
    runId: "40000000-0000-4000-8000-000000000013",
    workItemId: "50000000-0000-4000-8000-000000000013",
    model: "deepseek-v4-flash"
  };
  const succeededReviewFailed = {
    status: "succeeded" as const,
    reason: "done",
    control: "stop" as const,
    usage: { stepsUsed: 2, secondsUsed: 5, tokenIn: 10, tokenOut: 10, totalTokens: 20, estimatedCostCny: "0.01" },
    steps: [],
    manifest: { work_item_id: base.workItemId } as never,
    reviewFailed: true
  };
  const assessment = evaluateAgentRunConfidence({ ...base, autoMergeAllowed: true, result: succeededReviewFailed });

  // 绝不是旧的 0.88；钳到 ≤ 0.4 的低置信。
  assert.equal(assessment.confidenceScore <= 0.4, true);
  assert.notEqual(assessment.confidenceScore, 0.88);
  assert.equal(assessment.grade, "low");
  assert.equal(assessment.verdict, "escalate");
  assert.equal(assessment.escalation?.trigger, "unqualified");
  // 审计载荷如实标注 fail-closed（而非冒充「无 llm_review 的启发式回退」）。
  const sources = (assessment.signalsJson as { sources: { review: { source?: string; reason?: string } } }).sources;
  assert.equal(sources.review.source, "llm_review_failed");
});

test("findings[0] signalsJson acceptance.score matches the score driving the verdict (succeeded without manifest = 0.6)", () => {
  const base = {
    runId: "40000000-0000-4000-8000-000000000011",
    workItemId: "50000000-0000-4000-8000-000000000011",
    model: "deepseek-v4-flash"
  };
  const succeededNoManifest = {
    status: "succeeded" as const,
    reason: "done",
    control: "stop" as const,
    usage: { stepsUsed: 2, secondsUsed: 5, tokenIn: 10, tokenOut: 10, totalTokens: 20, estimatedCostCny: "0.01" },
    steps: [],
    review: { source: "llm_review" as const, grade: 5, rationale: "ok", model: "deepseek-v4-flash" }
    // 故意不带 manifest
  };
  const assessment = evaluateAgentRunConfidence({ ...base, result: succeededNoManifest as never });
  const sources = (assessment.signalsJson as { sources: { acceptance: { score: number } } }).sources;
  // 成功但无 manifest：acceptance 应为 0.6（与 confidenceScoreFor 同口径），而非旧的硬编码 1。
  assert.equal(sources.acceptance.score, 0.6);
  // 裁决分确实用了 0.6：(1*0.5 + 0.6*0.35)/0.85 = 0.835（证明 signals 与计分一致）。
  assert.equal(assessment.confidenceScore, 0.835);
});
