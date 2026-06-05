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
  model: z.string().min(1).max(64),
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
  kind: z.enum(["pre_step", "merge", "manual"]),
  ref: z.string().min(1).max(128),
  content_sha256: z.string().length(64).optional(),
  created_by_kind: z.enum(["ai", "human", "system"]),
  reverted_at: isoDateTimeSchema.optional(),
  created_at: isoDateTimeSchema
});
export type Snapshot = z.infer<typeof snapshotSchema>;
