import {
  type TaskPlanArbitrationRepository,
  type TaskPlanItemRow,
  type TaskPlanRow
} from "@workhub/db";
import type { DeliverableChange, DeliverableChangeManifest, RiskLevel } from "@workhub/contracts";

import type {
  CrossAgentArbitrationResult,
  CrossAgentCandidate,
  CrossAgentJudgeInput,
  CrossAgentJudgeService,
  CrossAgentPlanBudgetUsageStore,
  CrossAgentProposalReviewStore
} from "./cross-agent-judge.js";
import type { TaskDispatchArbitrationResult, TaskDispatchArbitrationSink } from "./task-dispatcher.js";

const ARBITRATION_CANDIDATE_LIMIT = 8;

export type TaskDispatchArbitrationCandidate = {
  proposalId: string;
  proposalTitle: string;
  producerRunId: string;
  taskPlanItemId?: string;
  producerClientRef: string;
  producerContextRef: string;
  manifest: DeliverableChangeManifest;
};

export type TaskDispatchArbitrationCandidateStore = {
  listArbitrationCandidates: (input: {
    plan: TaskPlanRow;
    items: TaskPlanItemRow[];
    limit: number;
  }) => Promise<TaskDispatchArbitrationCandidate[]>;
};

export type TaskDispatchArbitrationSinkOptions = {
  candidates: TaskDispatchArbitrationCandidateStore;
  judge: CrossAgentJudgeService;
  proposalReviews: CrossAgentProposalReviewStore;
  planBudgetUsage?: CrossAgentPlanBudgetUsageStore;
  judgeClientRef: string;
  judgeContextRef?: string | ((input: { plan: TaskPlanRow }) => string);
};

function sortedAcceptance(items: TaskPlanItemRow[]) {
  return [...items]
    .sort((left, right) => left.seq - right.seq || left.id.localeCompare(right.id))
    .map((item) => `${item.title}: ${item.acceptanceMd.trim()}`)
    .filter((line) => line.trim().length > 0);
}

function changeSummary(change: DeliverableChange, index: number) {
  const machine = change.machine_summary;
  const details = [
    machine?.generated_content_md,
    machine?.after_excerpt,
    machine?.changed_fields?.length ? `Changed fields: ${machine.changed_fields.join(", ")}` : undefined
  ].filter((value): value is string => Boolean(value?.trim()));
  return [
    `${index + 1}. ${change.human_summary}`,
    ...details.map((detail) => `   ${detail}`)
  ].join("\n");
}

function candidateContent(candidate: TaskDispatchArbitrationCandidate) {
  return [
    `Proposal: ${candidate.proposalTitle}`,
    `Manifest title: ${candidate.manifest.title}`,
    "",
    candidate.manifest.summary_md,
    "",
    "Changes:",
    ...candidate.manifest.changes.map(changeSummary),
    "",
    `Risk: ${candidate.manifest.risk.level} - ${candidate.manifest.risk.human_label}`
  ].join("\n");
}

function judgeCandidate(candidate: TaskDispatchArbitrationCandidate): CrossAgentCandidate {
  return {
    id: candidate.proposalId,
    title: candidate.proposalTitle,
    producerRunId: candidate.producerRunId,
    ...(candidate.taskPlanItemId ? { taskPlanItemId: candidate.taskPlanItemId } : {}),
    producerClientRef: candidate.producerClientRef,
    producerContextRef: candidate.producerContextRef,
    contentMd: candidateContent(candidate)
  };
}

function riskRank(risk: RiskLevel) {
  switch (risk) {
    case "high":
      return 3;
    case "medium":
      return 2;
    case "low":
      return 1;
  }
}

function highestRisk(candidates: readonly TaskDispatchArbitrationCandidate[]) {
  return candidates.reduce<RiskLevel>((highest, candidate) => (
    riskRank(candidate.manifest.risk.level) > riskRank(highest) ? candidate.manifest.risk.level : highest
  ), "low");
}

// B-R9.4-1（branch-review 可绕过）：高风险 2-of-3 的触发依据不能只取被评产出的自报
// （产出方自评 low 即可绕过）。基线=planner 在计划阶段标注、人审可改的 plan_risk
// （落在 decompositionContextJson），候选自报只能抬高不能压低。
function arbitrationRiskLevel(plan: TaskPlanRow, candidates: readonly TaskDispatchArbitrationCandidate[]): RiskLevel {
  const raw = (plan.decompositionContextJson as Record<string, unknown> | null | undefined)?.["plan_risk"];
  const planRisk: RiskLevel = raw === "high" || raw === "medium" || raw === "low" ? raw : "medium";
  const candidateRisk = highestRisk(candidates);
  return riskRank(candidateRisk) > riskRank(planRisk) ? candidateRisk : planRisk;
}

function judgeContextRef(input: TaskDispatchArbitrationSinkOptions, plan: TaskPlanRow) {
  if (typeof input.judgeContextRef === "function") {
    return input.judgeContextRef({ plan });
  }
  return input.judgeContextRef ?? `task-plan-arbitration:${plan.id}`;
}

function reviewTarget(result: CrossAgentArbitrationResult, candidates: readonly TaskDispatchArbitrationCandidate[]) {
  if (result.selectedCandidateId) {
    return candidates.find((candidate) => candidate.proposalId === result.selectedCandidateId) ?? candidates[0];
  }
  return candidates[0];
}

function reviewDecision(result: CrossAgentArbitrationResult) {
  return result.decision === "accept_one" ? result.proposalReview.decision : "request_changes";
}

function blockedReason(result: CrossAgentArbitrationResult): Extract<TaskDispatchArbitrationResult, { completion: "blocked" }>["reason"] {
  if (result.decision === "replan") {
    return "replan";
  }
  if (result.decision === "escalate") {
    return "escalate";
  }
  return "request_changes";
}

function completionResult(result: CrossAgentArbitrationResult): TaskDispatchArbitrationResult {
  const decision = reviewDecision(result);
  if (decision === "approve") {
    return { completion: "proceed" };
  }
  return {
    completion: "blocked",
    reason: blockedReason(result),
    reasonMd: result.proposalReview.reasonMd
  };
}

export function createTaskDispatchArbitrationSink(options: TaskDispatchArbitrationSinkOptions): TaskDispatchArbitrationSink {
  return async (input) => {
    const candidates = await options.candidates.listArbitrationCandidates({
      ...input,
      limit: ARBITRATION_CANDIDATE_LIMIT + 1
    });
    if (candidates.length < 2) {
      return;
    }
    const judgeInput: CrossAgentJudgeInput = {
      actor: {
        id: "r9-cross-agent-judge",
        label: "WorkHub AI review",
        workspaceId: input.plan.workspaceId,
        workItemId: input.plan.workItemId,
        taskPlanId: input.plan.id
      },
      planId: input.plan.id,
      riskLevel: arbitrationRiskLevel(input.plan, candidates),
      judgeClientRef: options.judgeClientRef,
      judgeContextRef: judgeContextRef(options, input.plan),
      acceptance: sortedAcceptance(input.items),
      candidates: candidates.map(judgeCandidate),
      ...(options.planBudgetUsage ? { planBudgetUsage: options.planBudgetUsage } : {})
    };
    const result = await options.judge.arbitrate(judgeInput);
    const target = reviewTarget(result, candidates);
    if (!target) {
      return;
    }
    await options.proposalReviews.review({
      proposalId: target.proposalId,
      actor: {
        actor_kind: "ai",
        label: "WorkHub AI review"
      },
      decision: reviewDecision(result),
      reasonMd: result.proposalReview.reasonMd,
      remember: "once"
    });
    return completionResult(result);
  };
}

function routeValue(input: unknown, key: string) {
  if (!input || typeof input !== "object") {
    return undefined;
  }
  const route = (input as Record<string, unknown>).model_route;
  if (!route || typeof route !== "object") {
    return undefined;
  }
  const value = (route as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function producerClientRef(input: {
  budgetDecisionJson: unknown;
  model: string;
  runId: string;
}) {
  const provider = routeValue(input.budgetDecisionJson, "provider") ?? "unknown-provider";
  const model = routeValue(input.budgetDecisionJson, "model") ?? input.model;
  return `${provider}:${model}:agent-run:${input.runId}`;
}

export function createDbTaskDispatchArbitrationCandidateStore(
  repository: Pick<TaskPlanArbitrationRepository, "listCandidates">
): TaskDispatchArbitrationCandidateStore {
  return {
    async listArbitrationCandidates(input) {
      const rows = await repository.listCandidates({
        planId: input.plan.id,
        workspaceId: input.plan.workspaceId,
        workItemId: input.plan.workItemId,
        limit: input.limit
      });
      return rows.map((row) => ({
        proposalId: row.proposalId,
        proposalTitle: row.proposalTitle,
        producerRunId: row.runId,
        ...(row.taskPlanItemId ? { taskPlanItemId: row.taskPlanItemId } : {}),
        producerClientRef: producerClientRef({
          budgetDecisionJson: row.budgetDecisionJson,
          model: row.runModel,
          runId: row.runId
        }),
        producerContextRef: `agent-run:${row.runId}`,
        manifest: row.manifest
      }));
    }
  };
}
