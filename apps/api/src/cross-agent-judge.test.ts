import assert from "node:assert/strict";
import test from "node:test";

import type { LlmActor, LlmCreateParams, TaskClass } from "@workhub/agent/providers";
import type { ProviderRegistry } from "@workhub/agent/providers";

import {
  createCrossAgentJudge,
  type CrossAgentJudgeInput
} from "./services/cross-agent-judge.js";

type RecordedCall = {
  actor: LlmActor | undefined;
  task: TaskClass;
  params: LlmCreateParams;
};

class RecordingRegistry {
  public readonly calls: RecordedCall[] = [];

  constructor(private readonly responses: unknown[]) {}

  isConfigured() {
    return true;
  }

  get(actor: LlmActor | undefined, task: TaskClass) {
    return {
      messages: {
        create: async (params: LlmCreateParams) => {
          this.calls.push({ actor, task, params });
          const response = this.responses.shift();
          if (!response) {
            throw new Error("unexpected LLM call");
          }
          return {
            id: `judge-${this.calls.length}`,
            content: [{ type: "text", text: JSON.stringify(response) }],
            usage: { inputTokens: 12, outputTokens: 8 }
          };
        }
      }
    };
  }
}

function baseInput(): Omit<CrossAgentJudgeInput, "proposalReviews"> {
  return {
    actor: {
      id: "judge-user",
      userId: "judge-user",
      workspaceId: "workspace-r9",
      workItemId: "work-item-r9",
      label: "R9 judge"
    },
    planId: "plan-r9",
    taskPlanItemId: "item-r9",
    proposalId: "proposal-r9",
    judgeClientRef: "deepseek:review:context-judge",
    acceptance: [
      "The answer must pick the route that keeps approved proposal state.",
      "Contradictory conclusions need a reasoned arbitration."
    ],
    candidates: [
      {
        id: "candidate-a",
        title: "Retry A",
        producerRunId: "run-a",
        producerClientRef: "deepseek:worker:context-a",
        contentMd: "Use the first proposal row. It says the change is still opened.",
        confidence: { grade: "medium", verdict: "human_spotcheck", rationaleMd: "Partial table scan." }
      },
      {
        id: "candidate-b",
        title: "Retry B",
        producerRunId: "run-b",
        producerClientRef: "deepseek:worker:context-b",
        contentMd: "Use the latest review row. It proves the proposal is reviewed and ready to merge.",
        confidence: { grade: "high", verdict: "auto_merge", rationaleMd: "Checks reviews and proposal status." }
      }
    ]
  };
}

function assertReviewCopyIsUserSafe(reasonMd: string) {
  assert.doesNotMatch(reasonMd, /\b(R9|judge|cross-agent|confidence|low_confidence|judge_not_independent)\b/iu);
  assert.doesNotMatch(reasonMd, /agent_step|selected_candidate_id|producerClientRef/u);
}

test("R9.4 cross-agent judge arbitrates contradictory outputs into a user-safe proposal review", async () => {
  const registry = new RecordingRegistry([
    {
      decision: "accept_one",
      selected_candidate_id: "candidate-b",
      confidence: "high",
      reasons: [
        "Candidate B checks the latest review row and proposal status.",
        "Candidate A contradicts the accepted review state."
      ],
      summary_md: "采纳 candidate-b：它按验收标准核对了最新 review 状态。"
    }
  ]);
  const reviewCalls: Array<Parameters<NonNullable<CrossAgentJudgeInput["proposalReviews"]>["review"]>[0]> = [];
  const judge = createCrossAgentJudge({ providerRegistry: registry as unknown as ProviderRegistry });

  const result = await judge.arbitrate({
    ...baseInput(),
    proposalReviews: {
      review: async (input) => {
        reviewCalls.push(input);
      }
    }
  });

  assert.equal(registry.calls.length, 1);
  assert.equal(registry.calls[0]?.task, "review");
  assert.equal(registry.calls[0]?.actor?.workItemId, "work-item-r9");
  assert.equal(registry.calls[0]?.params.source, "agent_step");
  assert.match(String(registry.calls[0]?.params.system), /strict JSON/i);
  const prompt = String(registry.calls[0]?.params.messages[0]?.content);
  assert.match(prompt, /candidate-a/);
  assert.match(prompt, /candidate-b/);
  assert.match(prompt, /Contradictory conclusions/);

  assert.equal(result.decision, "accept_one");
  assert.equal(result.selectedCandidateId, "candidate-b");
  assert.equal(result.confidence, "high");
  assert.match(result.summaryMd, /candidate-b/);
  assert.equal(result.proposalReview.decision, "approve");
  assertReviewCopyIsUserSafe(result.proposalReview.reasonMd);
  assert.match(result.proposalReview.reasonMd, /多份草稿比对/u);
  assert.equal(reviewCalls.length, 1);
  assert.equal(reviewCalls[0]?.proposalId, "proposal-r9");
  assert.equal(reviewCalls[0]?.decision, "approve");
  assert.equal(reviewCalls[0]?.actor.actor_kind, "ai");
  assertReviewCopyIsUserSafe(reviewCalls[0]?.reasonMd ?? "");
  assert.match(reviewCalls[0]?.reasonMd ?? "", /Candidate B checks/);
});

test("R9.4 cross-agent judge sends low-confidence arbitration to human review without leaking internal wording", async () => {
  const registry = new RecordingRegistry([
    {
      decision: "accept_one",
      selected_candidate_id: "candidate-a",
      confidence: "low",
      reasons: ["Both candidates omit one acceptance criterion."],
      summary_md: "The reviewer cannot pick safely."
    }
  ]);
  const reviewCalls: Array<Parameters<NonNullable<CrossAgentJudgeInput["proposalReviews"]>["review"]>[0]> = [];
  const judge = createCrossAgentJudge({ providerRegistry: registry as unknown as ProviderRegistry });

  const result = await judge.arbitrate({
    ...baseInput(),
    proposalReviews: {
      review: async (input) => {
        reviewCalls.push(input);
      }
    }
  });

  assert.equal(registry.calls.length, 1);
  assert.equal(result.decision, "escalate");
  assert.equal(result.confidence, "low");
  assert.equal(result.escalationReason, "low_confidence");
  assert.equal(result.proposalReview.decision, "request_changes");
  assertReviewCopyIsUserSafe(result.proposalReview.reasonMd);
  assert.match(result.proposalReview.reasonMd, /把握不足|人工/u);
  assert.equal(reviewCalls[0]?.decision, "request_changes");
  assertReviewCopyIsUserSafe(reviewCalls[0]?.reasonMd ?? "");
});

test("R9.4 cross-agent judge fails closed when the review context matches a worker", async () => {
  const registry = new RecordingRegistry([
    {
      decision: "accept_one",
      selected_candidate_id: "candidate-b",
      confidence: "high",
      reasons: ["should not be called"],
      summary_md: "should not be called"
    }
  ]);
  const reviewCalls: Array<Parameters<NonNullable<CrossAgentJudgeInput["proposalReviews"]>["review"]>[0]> = [];
  const judge = createCrossAgentJudge({ providerRegistry: registry as unknown as ProviderRegistry });

  const result = await judge.arbitrate({
    ...baseInput(),
    judgeClientRef: "deepseek:worker:context-a",
    proposalReviews: {
      review: async (input) => {
        reviewCalls.push(input);
      }
    }
  });

  assert.equal(registry.calls.length, 0);
  assert.equal(result.decision, "escalate");
  assert.equal(result.confidence, "low");
  assert.equal(result.escalationReason, "judge_not_independent");
  assert.equal(result.proposalReview.decision, "request_changes");
  assertReviewCopyIsUserSafe(result.proposalReview.reasonMd);
  assert.match(result.proposalReview.reasonMd, /独立/u);
  assert.equal(reviewCalls[0]?.decision, "request_changes");
  assertReviewCopyIsUserSafe(reviewCalls[0]?.reasonMd ?? "");
});

test("R9.4 cross-agent judge fails closed instead of silently dropping extra child outputs", async () => {
  const registry = new RecordingRegistry([
    {
      decision: "accept_one",
      selected_candidate_id: "candidate-b",
      confidence: "high",
      reasons: ["should not be called"],
      summary_md: "should not be called"
    }
  ]);
  const judge = createCrossAgentJudge({ providerRegistry: registry as unknown as ProviderRegistry });
  const input = baseInput();

  const result = await judge.arbitrate({
    ...input,
    candidates: [
      ...input.candidates,
      ...Array.from({ length: 7 }, (_, index) => ({
        id: `candidate-extra-${index + 1}`,
        title: `Extra ${index + 1}`,
        producerRunId: `run-extra-${index + 1}`,
        producerClientRef: `deepseek:worker:context-extra-${index + 1}`,
        contentMd: "Additional output that must not be hidden from arbitration."
      }))
    ]
  });

  assert.equal(registry.calls.length, 0);
  assert.equal(result.decision, "escalate");
  assert.equal(result.escalationReason, "invalid_input");
  assert.match(result.summaryMd, /extra child outputs/);
  assertReviewCopyIsUserSafe(result.proposalReview.reasonMd);
});
