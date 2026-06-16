import { z } from "zod";

import {
  agentRunStatusSchema,
  agentStepPhaseSchema,
  confidenceGradeSchema,
  confidenceVerdictSchema,
  escalationTriggerSchema,
  riskLevelSchema,
  toolControlSignalSchema,
  workItemModeSchema
} from "../enums.js";
import { idSchema, isoDateTimeSchema, timestampFieldsSchema } from "./common.js";

export const agentRunSchema = timestampFieldsSchema.extend({
  id: idSchema,
  work_item_id: idSchema,
  branch_id: idSchema.optional(),
  mode: workItemModeSchema,
  actor: z.string().min(1).max(32),
  status: agentRunStatusSchema,
  // L#61：与 usage/cost ledger 的 model 列(128)对齐，避免长模型名截断/校验不一致。
  model: z.string().min(1).max(128),
  turns_used: z.number().int().nonnegative(),
  max_turns: z.number().int().positive(),
  seconds: z.number().nonnegative().optional(),
  token_in: z.number().int().nonnegative(),
  token_out: z.number().int().nonnegative(),
  cost_estimate: z.string().optional(),
  outcome_reason: z.string().max(256).optional(),
  handoff_md: z.string().optional(),
  started_at: isoDateTimeSchema.optional(),
  finished_at: isoDateTimeSchema.optional()
});
export type AgentRun = z.infer<typeof agentRunSchema>;

export const startAgentRunRequestSchema = z.object({
  mode: workItemModeSchema.optional(),
  title: z.string().min(1).max(256).optional()
});
export type StartAgentRunRequest = z.infer<typeof startAgentRunRequestSchema>;

export const agentStepSchema = z.object({
  id: idSchema,
  agent_run_id: idSchema,
  step_no: z.number().int().positive(),
  phase: agentStepPhaseSchema,
  tool_name: z.string().max(64).optional(),
  input_json: z.record(z.string(), z.unknown()).default({}),
  output_excerpt: z.string().optional(),
  control_signal: toolControlSignalSchema.optional(),
  snapshot_id: idSchema.optional(),
  created_at: isoDateTimeSchema
});
export type AgentStep = z.infer<typeof agentStepSchema>;

export const agentToolCallSchema = z.object({
  id: z.string().min(1),
  tool_id: z.string().min(1),
  input: z.unknown(),
  visible: z.boolean()
});
export type AgentToolCall = z.infer<typeof agentToolCallSchema>;

export const agentToolResultSchema = z.object({
  tool_use_id: z.string().min(1).optional(),
  ok: z.boolean(),
  content: z.string(),
  is_error: z.boolean(),
  snapshot_id: idSchema.optional()
});
export type AgentToolResult = z.infer<typeof agentToolResultSchema>;

export const structuredHandoffSchema = z.object({
  done: z.array(z.string()),
  remaining: z.array(z.string()),
  next_steps: z.array(z.string()),
  blockers: z.array(z.string()),
  artifacts: z.array(z.string()),
  budget_hit: z.enum(["steps", "timeout", "tokens", "cost", "doom_loop", "snapshot_gate", "unknown"])
});
export type StructuredHandoff = z.infer<typeof structuredHandoffSchema>;

export const agentRunLiveBudgetSchema = z.object({
  max_steps: z.number().int().positive(),
  total_timeout_s: z.number().int().positive(),
  // L18：与 runBudgetSchema/budgetPolicySchema 一致——0 上限的预算永远花不出去，不是合法 budget。
  max_tokens: z.number().int().positive(),
  max_cost_cny: z.string()
});
export type AgentRunLiveBudget = z.infer<typeof agentRunLiveBudgetSchema>;

export const agentRunLiveUsageSchema = z.object({
  steps_used: z.number().int().nonnegative(),
  token_in: z.number().int().nonnegative(),
  token_out: z.number().int().nonnegative(),
  estimated_cost_cny: z.string()
});
export type AgentRunLiveUsage = z.infer<typeof agentRunLiveUsageSchema>;

export const agentRunBudgetDecisionVmSchema = z.object({
  decision_id: z.string().min(1),
  allowed: z.boolean(),
  reason: z.string().optional(),
  model_route: z.object({
    provider: z.string().min(1),
    model: z.string().min(1),
    reason: z.string().min(1)
  }),
  notice: z.unknown().optional()
});
export type AgentRunBudgetDecisionVM = z.infer<typeof agentRunBudgetDecisionVmSchema>;

export const agentRunLiveVmSchema = z.object({
  run: agentRunSchema,
  run_id: idSchema,
  work_item_id: idSchema,
  title: z.string().min(1),
  status: agentRunStatusSchema,
  budget: agentRunLiveBudgetSchema,
  budget_decision: agentRunBudgetDecisionVmSchema,
  usage: agentRunLiveUsageSchema,
  trace: z.array(agentStepSchema),
  handoff: structuredHandoffSchema.optional(),
  stream_href: z.string().min(1),
  replay_href: z.string().min(1)
});
export type AgentRunLiveVM = z.infer<typeof agentRunLiveVmSchema>;

export const confidenceRecordSchema = z.object({
  id: idSchema,
  work_item_id: idSchema,
  proposal_id: idSchema.optional(),
  agent_run_id: idSchema.optional(),
  confidence_score: z.number().min(0).max(1),
  risk_score: z.number().min(0).max(1),
  grade: confidenceGradeSchema,
  risk_level: riskLevelSchema,
  verdict: confidenceVerdictSchema,
  signals_json: z.record(z.string(), z.unknown()).default({}),
  rationale_md: z.string().optional(),
  created_at: isoDateTimeSchema
});
export type ConfidenceRecord = z.infer<typeof confidenceRecordSchema>;

export const escalationEventSchema = z.object({
  id: idSchema,
  work_item_id: idSchema,
  agent_run_id: idSchema.optional(),
  confidence_id: idSchema.optional(),
  trigger: escalationTriggerSchema,
  reason_md: z.string(),
  handoff_json: z.record(z.string(), z.unknown()).default({}),
  suggested_lead_user_id: idSchema.optional(),
  resolved_at: isoDateTimeSchema.optional(),
  created_at: isoDateTimeSchema
});
export type EscalationEvent = z.infer<typeof escalationEventSchema>;

export const snapshotSchema = z.object({
  id: idSchema,
  work_item_id: idSchema,
  branch_id: idSchema.optional(),
  // "base" = P-COLLAB M2 物化的只读祖先态快照(diff3 合并底稿);与 packages/audit SnapshotRef 对齐。
  kind: z.enum(["pre_step", "merge", "manual", "base"]),
  ref: z.string().min(1).max(128),
  content_sha256: z.string().length(64).optional(),
  created_by_kind: z.enum(["ai", "human", "system"]),
  reverted_at: isoDateTimeSchema.optional(),
  created_at: isoDateTimeSchema
});
export type Snapshot = z.infer<typeof snapshotSchema>;
