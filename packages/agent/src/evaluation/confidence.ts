import type {
  ConfidenceGrade,
  ConfidenceVerdict,
  EscalationTrigger,
  RiskLevel
} from "@workhub/contracts";

import type { AgentLoopResult, AgentLoopStep, StructuredHandoff } from "../loop/types.js";

export type ConfidenceAssessment = {
  confidenceScore: number;
  riskScore: number;
  grade: ConfidenceGrade;
  riskLevel: RiskLevel;
  verdict: ConfidenceVerdict;
  signalsJson: Record<string, unknown>;
  rationaleMd: string;
  escalation?: {
    trigger: EscalationTrigger;
    reasonMd: string;
    handoffJson: Record<string, unknown>;
  };
};

export type EvaluateAgentRunConfidenceInput = {
  runId: string;
  workItemId: string;
  model: string;
  result: AgentLoopResult;
  policyVersion?: string;
  autoMergeAllowed?: boolean;
};

type RiskDimensions = {
  reversibility: number;
  external: number;
  monetary: number;
  blast_radius: number;
  domain_gate: number;
};

const DEFAULT_POLICY_VERSION = "confidence-v0-file-only";

function clamp01(value: number) {
  return Math.min(Math.max(value, 0), 1);
}

function round3(value: number) {
  return Math.round(clamp01(value) * 1000) / 1000;
}

function hasSnapshot(steps: AgentLoopStep[]) {
  return steps.some((step) => Boolean(step.snapshotId) || step.toolResults.some((result) => Boolean(result.snapshotId)));
}

function gradeFor(score: number): ConfidenceGrade {
  if (score >= 0.85) {
    return "high";
  }
  if (score >= 0.6) {
    return "medium";
  }
  return "low";
}

function riskDimensionsFor(input: EvaluateAgentRunConfidenceInput): RiskDimensions {
  const reversible = hasSnapshot(input.result.steps);
  return {
    reversibility: reversible ? 0.2 : 0.5,
    external: 0,
    monetary: 0,
    blast_radius: input.result.status === "succeeded" ? 0.15 : 0.25,
    domain_gate: 0
  };
}

function riskScoreFor(dimensions: RiskDimensions) {
  const values = Object.values(dimensions);
  const max = Math.max(...values);
  const mean = values.reduce((total, value) => total + value, 0) / values.length;
  return round3(0.6 * max + 0.4 * mean);
}

function riskLevelFor(score: number, dimensions: RiskDimensions): RiskLevel {
  if (dimensions.external >= 1 || dimensions.monetary >= 1 || dimensions.domain_gate >= 1 || score >= 0.6) {
    return "high";
  }
  if (score >= 0.3) {
    return "medium";
  }
  return "low";
}

// findings[#3]：自动采纳带收紧——只有 grade===5（可直接采纳）才落入 auto-merge 资格带。
// grade 4（基本可直接采纳=仍需轻微修改）即便融合分越过 high 门（0.853）也只走人审。
// autoMergeEligible 由调用方据 review.grade 决定；无 review 时延续旧的「高置信+低风险=自动」语义。
function matrixVerdict(grade: ConfidenceGrade, riskLevel: RiskLevel, autoMergeEligible: boolean): ConfidenceVerdict {
  if (grade === "low" || riskLevel === "high") {
    return "escalate";
  }
  if (grade === "high" && riskLevel === "low" && autoMergeEligible) {
    return "auto_merge";
  }
  return "human_spotcheck";
}

// 只有评审给出 grade===5 才允许自动采纳；无评审时回退旧行为（启发式高分仍可自动采纳）。
function autoMergeEligibleFor(result: AgentLoopResult): boolean {
  if (result.review) {
    return result.review.grade === 5;
  }
  return true;
}

function heuristicScoreFor(result: AgentLoopResult) {
  if (result.status === "succeeded") {
    return result.manifest ? 0.88 : 0.72;
  }
  if (result.status === "escalated") {
    return 0.35;
  }
  return 0.2;
}

// findings[#2]：评审被请求但失败/空/不可解析时的 fail-closed 分。绝不向上美化成 0.88——
// 钳到「低置信」档（< gradeFor 的 0.6 medium 门），裁决落到 escalate/人审，而非自动采纳。
// 取 0.4 保持「成功但需人看」的语义，明显低于无评审回退（0.88）也低于 medium 起点。
const FAILED_REVIEW_SCORE = 0.4;

// R0 acceptance 信号：成功且有交付物清单=1；成功但无清单=0.6；未成功=0。
// findings[0]：驱动裁决计分的这个表达式与 signalsJson 解释载荷必须用同一个值，否则
// 「succeeded 但无 manifest」的运行会出现「展示/审计的 acceptance=1」与「实际计分=0.6」相左，破坏审计可信度。
function acceptanceScoreFor(result: AgentLoopResult): number {
  return result.status === "succeeded" ? (result.manifest ? 1 : 0.6) : 0;
}

// R0 v1 权重（confidence-risk-escalation.md §0.1）：review=0.50 / acceptance=0.35 / self=0.15。
// self 暂缺时按在场来源归一化；llm_review 缺席时回退启发式整体分。
function confidenceScoreFor(result: AgentLoopResult) {
  // findings[#2]：评审请求了但失败——fail-closed，向下钳低；优先于任何乐观回退。
  if (result.reviewFailed && !result.review) {
    return Math.min(FAILED_REVIEW_SCORE, heuristicScoreFor(result));
  }
  if (!result.review) {
    return heuristicScoreFor(result);
  }
  const reviewScore = (result.review.grade - 1) / 4;
  const acceptanceScore = acceptanceScoreFor(result);
  const weights = { review: 0.5, acceptance: 0.35 };
  const total = weights.review + weights.acceptance;
  return (reviewScore * weights.review + acceptanceScore * weights.acceptance) / total;
}

function downgradeAutoMerge(verdict: ConfidenceVerdict, autoMergeAllowed: boolean | undefined) {
  return verdict === "auto_merge" && !autoMergeAllowed ? "human_spotcheck" : verdict;
}

function handoffToJson(handoff: StructuredHandoff | undefined): Record<string, unknown> {
  if (!handoff) {
    return {
      done: [],
      remaining: ["需要查看 AgentRun trace 后确认下一步。"],
      next_steps: ["查看执行过程", "决定继续、打回或转人工处理"],
      blockers: [],
      artifacts: [],
      budget_hit: "unknown"
    };
  }
  return {
    done: handoff.done,
    remaining: handoff.remaining,
    next_steps: handoff.nextSteps,
    blockers: handoff.blockers,
    artifacts: handoff.artifacts,
    budget_hit: handoff.budgetHit
  };
}

function triggerFor(result: AgentLoopResult): EscalationTrigger {
  if (result.handoff?.budgetHit === "doom_loop" || result.reason === "doom_loop") {
    return "doom_loop";
  }
  if (result.handoff && ["steps", "timeout", "tokens", "cost"].includes(result.handoff.budgetHit)) {
    return "budget_exhausted";
  }
  return "unqualified";
}

function rationaleFor(input: {
  result: AgentLoopResult;
  verdict: ConfidenceVerdict;
  riskLevel: RiskLevel;
}) {
  // findings[#30]：run 成功并已交付，但评审被请求却失败/空/不可解析（reviewFailed），fail-closed 钳低 → escalate。
  // 此时绝不能落到下方「AI 没有完成可用交付」的回退（它会把已交付的内容当成未交付来描述，写进
  // escalation.reasonMd + 审计——不诚实）。改用如实表述：交付已产出，只是自动评审没完成、无法自动判质。
  if (input.result.status === "succeeded" && input.result.reviewFailed) {
    return "AI 已产出交付物，但自动评审没能完成，无法自动判定质量，建议请人核对后再采纳。";
  }
  if (input.verdict === "human_spotcheck") {
    return input.riskLevel === "low"
      ? "AI 已产出交付物，我比较有把握，建议你快速扫一眼后确认。"
      : "AI 已产出交付物，但影响面不小，建议你先看一眼再确认。";
  }
  if (input.verdict === "auto_merge") {
    return "AI 已产出交付物，风险较低，可以按当前策略自动采纳。";
  }
  if (input.result.handoff?.budgetHit === "doom_loop" || input.result.reason === "doom_loop") {
    return "AI 卡住了，反复尝试同类动作没有进展，建议请人接手。";
  }
  if (input.result.handoff) {
    return "AI 的执行预算已经用尽，已整理交接信息，建议请人接手或调整预算后继续。";
  }
  return `AI 没有完成可用交付：${input.result.reason}。建议请人查看执行过程后决定继续或转人工。`;
}

export function evaluateAgentRunConfidence(input: EvaluateAgentRunConfidenceInput): ConfidenceAssessment {
  const policyVersion = input.policyVersion ?? DEFAULT_POLICY_VERSION;
  const confidenceScore = round3(confidenceScoreFor(input.result));
  const dimensions = riskDimensionsFor(input);
  const riskScore = riskScoreFor(dimensions);
  const grade = gradeFor(confidenceScore);
  const riskLevel = riskLevelFor(riskScore, dimensions);
  const baseVerdict = input.result.status === "succeeded"
    ? matrixVerdict(grade, riskLevel, autoMergeEligibleFor(input.result))
    : "escalate";
  const verdict = downgradeAutoMerge(baseVerdict, input.autoMergeAllowed);
  const rationaleMd = rationaleFor({ result: input.result, verdict, riskLevel });
  const signalsJson = {
    policy_version: policyVersion,
    run_id: input.runId,
    work_item_id: input.workItemId,
    model: input.model,
    result: {
      status: input.result.status,
      control: input.result.control,
      reason: input.result.reason
    },
    sources: {
      review: input.result.review
        ? {
          score: round3((input.result.review.grade - 1) / 4),
          grade: input.result.review.grade,
          source: input.result.review.source,
          model: input.result.review.model,
          reason: input.result.review.rationale
        }
        // findings[#2]：评审请求了但失败/空/不可解析——审计载荷如实标注 fail-closed，不冒充乐观回退。
        : input.result.reviewFailed
          ? {
            score: confidenceScore,
            source: "llm_review_failed",
            reason: "评审被请求但失败/空/不可解析，已 fail-closed 钳低置信、转人审。"
          }
          : {
            score: confidenceScore,
            reason: `启发式回退（无 llm_review）：${input.result.reason.slice(0, 120)}`
          },
      acceptance: {
        // findings[0]：与 confidenceScoreFor 用同一个 acceptanceScoreFor，三态一致（1 / 0.6 / 0）。
        score: round3(acceptanceScoreFor(input.result)),
        reason: input.result.status === "succeeded"
          ? (input.result.manifest ? "交付物已生成" : "执行成功但未产出交付物清单")
          : "交付物未通过执行终态"
      },
      self: {
        score: null,
        reason: "当前 AgentRun 未提供自评"
      },
      history: {
        calibration_factor: 1,
        reason: "冷启动或样本不足时不做历史缩放"
      }
    },
    risk: {
      dimensions,
      has_revert_snapshot: hasSnapshot(input.result.steps)
    },
    usage: input.result.usage
  };

  const assessment: ConfidenceAssessment = {
    confidenceScore,
    riskScore,
    grade,
    riskLevel,
    verdict,
    signalsJson,
    rationaleMd
  };

  if (verdict === "escalate") {
    const trigger = triggerFor(input.result);
    assessment.escalation = {
      trigger,
      reasonMd: rationaleMd,
      handoffJson: handoffToJson(input.result.handoff)
    };
  }

  return assessment;
}
