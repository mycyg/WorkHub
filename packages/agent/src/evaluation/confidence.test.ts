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
