import assert from "node:assert/strict";
import test from "node:test";

import type { DeliverableChangeManifest, RiskLevel } from "@workhub/contracts";
import type { TaskPlanItemRow, TaskPlanRow } from "@workhub/db";

import type {
  CrossAgentArbitrationResult,
  CrossAgentJudgeInput,
  CrossAgentJudgeService,
  CrossAgentProposalReviewStore
} from "./services/cross-agent-judge.js";
import {
  createTaskDispatchArbitrationSink,
  type TaskDispatchArbitrationCandidateStore
} from "./services/task-dispatcher-arbitration.js";

const now = new Date("2026-07-03T09:50:00.000Z");
const planId = "97000000-0000-4000-8000-000000000101";
const workItemId = "97000000-0000-4000-8000-000000000102";
const workspaceId = "97000000-0000-4000-8000-000000000103";
const actorId = "97000000-0000-4000-8000-000000000104";
const researchItemId = "97000000-0000-4000-8000-000000000201";
const produceItemId = "97000000-0000-4000-8000-000000000202";
const proposalAId = "97000000-0000-4000-8000-000000000301";
const proposalBId = "97000000-0000-4000-8000-000000000302";
const runAId = "97000000-0000-4000-8000-000000000401";
const runBId = "97000000-0000-4000-8000-000000000402";

function plan(): TaskPlanRow {
  return {
    id: planId,
    workItemId,
    workspaceId,
    status: "dispatching",
    objectiveId: null,
    budgetJson: { total_share_pct: 100 },
    decompositionContextJson: { source: "test" },
    createdByUserId: actorId,
    createdAt: now,
    updatedAt: now
  } as TaskPlanRow;
}

function item(input: {
  id: string;
  seq: number;
  title: string;
  acceptanceMd: string;
}): TaskPlanItemRow {
  return {
    id: input.id,
    planId,
    parentItemId: null,
    seq: input.seq,
    title: input.title,
    role: "produce",
    objectiveMd: `${input.title} objective.`,
    acceptanceMd: input.acceptanceMd,
    budgetSharePct: 50,
    dispatchEpoch: 0,
    dependsOn: [],
    status: "succeeded",
    createdAt: now,
    updatedAt: now
  } as TaskPlanItemRow;
}

function manifest(input: {
  proposalId: string;
  title: string;
  summaryMd: string;
  riskLevel?: RiskLevel;
}): DeliverableChangeManifest {
  return {
    version: 0,
    proposal_id: input.proposalId,
    work_item_id: workItemId,
    branch_id: "97000000-0000-4000-8000-000000000501",
    title: input.title,
    summary_md: input.summaryMd,
    author: {
      actor_kind: "ai",
      label: "WorkHub AI"
    },
    base: {
      created_at: now.toISOString()
    },
    changes: [{
      id: "97000000-0000-4000-8000-000000000601",
      target_kind: "structured_record",
      target_ref: {
        entity_type: "work_item",
        entity_id: workItemId
      },
      change_type: "updated",
      human_summary: input.summaryMd,
      machine_summary: {
        generated_content_md: input.summaryMd
      }
    }],
    checks: [],
    evidence_refs: [],
    risk: {
      level: input.riskLevel ?? "medium",
      human_label: "Medium",
      reversible: true
    },
    rollback: {
      available: true,
      description: "Restore previous proposal state."
    },
    review: {
      suggested_decision: "needs_human",
      reason_required_on_reject: true
    }
  };
}

test("R9.4 task dispatch arbitration sink judges child proposal outputs and reviews the selected proposal", async () => {
  const judgeCalls: CrossAgentJudgeInput[] = [];
  const reviewCalls: Array<Parameters<CrossAgentProposalReviewStore["review"]>[0]> = [];
  const storeCalls: Array<{ planId: string; workspaceId: string; workItemId: string }> = [];
  const candidates: TaskDispatchArbitrationCandidateStore = {
    async listArbitrationCandidates(input) {
      storeCalls.push({
        planId: input.plan.id,
        workspaceId: input.plan.workspaceId,
        workItemId: input.plan.workItemId
      });
      return [
        {
          proposalId: proposalAId,
          proposalTitle: "Draft A",
          producerRunId: runAId,
          taskPlanItemId: researchItemId,
          producerClientRef: "deepseek:worker:run-a",
          producerContextRef: `agent-run:${runAId}`,
          manifest: manifest({
            proposalId: proposalAId,
            title: "Draft A",
            summaryMd: "Uses stale competitor prices."
          })
        },
        {
          proposalId: proposalBId,
          proposalTitle: "Draft B",
          producerRunId: runBId,
          taskPlanItemId: produceItemId,
          producerClientRef: "deepseek:worker:run-b",
          producerContextRef: `agent-run:${runBId}`,
          manifest: manifest({
            proposalId: proposalBId,
            title: "Draft B",
            summaryMd: "Uses the latest competitor prices and cites the source."
          })
        }
      ];
    }
  };
  const judge: CrossAgentJudgeService = {
    async arbitrate(input) {
      judgeCalls.push(input);
      return {
        decision: "accept_one",
        confidence: "high",
        reasons: ["Draft B satisfies the source freshness acceptance item."],
        summaryMd: "Draft B wins the cross-agent comparison.",
        selectedCandidateId: proposalBId,
        proposalReview: {
          decision: "approve",
          reasonMd: "AI 复核选择 Draft B。"
        }
      } satisfies CrossAgentArbitrationResult;
    }
  };
  const proposalReviews: CrossAgentProposalReviewStore = {
    async review(input) {
      reviewCalls.push(input);
    }
  };
  const sink = createTaskDispatchArbitrationSink({
    candidates,
    judge,
    proposalReviews,
    judgeClientRef: "deepseek:review:judge-client",
    judgeContextRef: "judge-context:plan-970"
  });

  await sink({
    plan: plan(),
    items: [
      item({
        id: researchItemId,
        seq: 0,
        title: "Research",
        acceptanceMd: "Use current competitor prices."
      }),
      item({
        id: produceItemId,
        seq: 1,
        title: "Produce",
        acceptanceMd: "Cite the source for each price."
      })
    ],
    at: now
  });

  assert.deepEqual(storeCalls, [{ planId, workspaceId, workItemId }]);
  assert.equal(judgeCalls.length, 1);
  assert.equal(judgeCalls[0]?.planId, planId);
  assert.equal(judgeCalls[0]?.actor.workItemId, workItemId);
  assert.equal(judgeCalls[0]?.actor.taskPlanId, planId);
  assert.equal(judgeCalls[0]?.judgeClientRef, "deepseek:review:judge-client");
  assert.equal(judgeCalls[0]?.judgeContextRef, "judge-context:plan-970");
  assert.deepEqual(judgeCalls[0]?.acceptance, [
    "Research: Use current competitor prices.",
    "Produce: Cite the source for each price."
  ]);
  assert.deepEqual(judgeCalls[0]?.candidates.map((candidate) => candidate.id), [proposalAId, proposalBId]);
  assert.match(judgeCalls[0]?.candidates[1]?.contentMd ?? "", /latest competitor prices/u);
  assert.equal(judgeCalls[0]?.candidates[1]?.producerRunId, runBId);
  assert.equal(judgeCalls[0]?.candidates[1]?.producerClientRef, "deepseek:worker:run-b");
  assert.deepEqual(reviewCalls, [{
    proposalId: proposalBId,
    actor: {
      actor_kind: "ai",
      // R9.7: the old expected label exposed `cross-agent judge`; proposal review actor labels are user-visible.
      label: "WorkHub AI review"
    },
    decision: "approve",
    // R9.7: the old expected reason exposed `cross-agent judge`; persisted review copy must be product-facing.
    reasonMd: "AI 复核选择 Draft B。",
    remember: "once"
  }]);
});

test("R9.7 task dispatch arbitration sink blocks completion when judge requests human changes", async () => {
  const reviewCalls: Array<Parameters<CrossAgentProposalReviewStore["review"]>[0]> = [];
  const candidates: TaskDispatchArbitrationCandidateStore = {
    async listArbitrationCandidates() {
      return [
        {
          proposalId: proposalAId,
          proposalTitle: "Draft A",
          producerRunId: runAId,
          taskPlanItemId: researchItemId,
          producerClientRef: "deepseek:worker:run-a",
          producerContextRef: `agent-run:${runAId}`,
          manifest: manifest({
            proposalId: proposalAId,
            title: "Draft A",
            summaryMd: "Claims the source is current without a citation."
          })
        },
        {
          proposalId: proposalBId,
          proposalTitle: "Draft B",
          producerRunId: runBId,
          taskPlanItemId: produceItemId,
          producerClientRef: "deepseek:worker:run-b",
          producerContextRef: `agent-run:${runBId}`,
          manifest: manifest({
            proposalId: proposalBId,
            title: "Draft B",
            summaryMd: "Cites a contradictory source."
          })
        }
      ];
    }
  };
  const judge: CrossAgentJudgeService = {
    async arbitrate() {
      return {
        decision: "escalate",
        confidence: "medium",
        reasons: ["The two outputs cite incompatible source-of-truth tables."],
        summaryMd: "需要人工判断哪条链路才是正式口径。",
        escalationReason: "judge_escalated",
        proposalReview: {
          decision: "request_changes",
          reasonMd: "AI 复核建议人工确认。"
        }
      } satisfies CrossAgentArbitrationResult;
    }
  };
  const proposalReviews: CrossAgentProposalReviewStore = {
    async review(input) {
      reviewCalls.push(input);
    }
  };
  const sink = createTaskDispatchArbitrationSink({
    candidates,
    judge,
    proposalReviews,
    judgeClientRef: "deepseek:review:judge-client"
  });

  const result = await sink({
    plan: plan(),
    items: [
      item({
        id: researchItemId,
        seq: 0,
        title: "Research",
        acceptanceMd: "Use current competitor prices."
      }),
      item({
        id: produceItemId,
        seq: 1,
        title: "Produce",
        acceptanceMd: "Cite the source for each price."
      })
    ],
    at: now
  });

  assert.deepEqual(reviewCalls.map((call) => call.decision), ["request_changes"]);
  assert.deepEqual(result, {
    completion: "blocked",
    reason: "escalate",
    reasonMd: "AI 复核建议人工确认。"
  });
});
