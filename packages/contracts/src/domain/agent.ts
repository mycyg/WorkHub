import { z } from "zod";

import {
  agentRunStatusSchema,
  agentStepPhaseSchema,
  confidenceGradeSchema,
  confidenceVerdictSchema,
  escalationTriggerSchema,
  riskLevelSchema,
  taskPlanItemRoleSchema,
  toolControlSignalSchema,
  workItemModeSchema
} from "../enums.js";
import { budgetNoticeSchema } from "../experience.js";
import { idSchema, isoDateTimeSchema, timestampFieldsSchema } from "./common.js";

export const agentRunSchema = timestampFieldsSchema.extend({
  id: idSchema,
  parent_run_id: idSchema.optional(),
  work_item_id: idSchema,
  branch_id: idSchema.optional(),
  task_plan_id: idSchema.optional(),
  task_plan_item_id: idSchema.optional(),
  objective_id: idSchema.optional(),
  agent_role: taskPlanItemRoleSchema.optional(),
  objective_md: z.string().min(1).optional(),
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

// R26 批 B6 观测面：一次「重复动作提醒」的结构化事实。同一份形状被两处引用：
//  - SSE 事件 agent_run.reminded 的 data（events.ts 的 agentRunRemindedDataSchema 在此之上加 run_id）；
//  - 运行 VM 的 reminders 行（下方 agentRunReminderVmSchema），让回放/实时时间线能补上这一行。
// 这里只有事实，没有句子：档位、连续重复步数、重复形态、工具名。中英文句子由两端按 locale 组装。
//
// tool_ids 只在「一次重复涉及不止一个工具」（交替形态 A-B-A-B 且两边工具不同）时出现；单工具的常见
// 情形只留 tool_id，同一事实不存两份。两者都可能缺席（重复的那一步没有工具调用），渲染层要能退回
// 不提工具名的说法。
export const doomLoopShapes = ["identical", "alternating"] as const;
export const doomLoopShapeSchema = z.enum(doomLoopShapes);
export type DoomLoopShapeKind = z.infer<typeof doomLoopShapeSchema>;

export const agentRunReminderFactsSchema = z.object({
  /** 触发提醒的那一步（1 起）。 */
  step_no: z.number().int().positive(),
  /** 1=温和提醒，2=详细提醒。第三档不走这条，升级发 agent_run.escalated。 */
  tier: z.union([z.literal(1), z.literal(2)]),
  /** 连续重复的步数：全同形态=同一动作连续步数；交替形态=构成 A-B-A-B 的连续步数。 */
  repeats: z.number().int().positive(),
  shape: doomLoopShapeSchema,
  /** 参与重复的第一个工具名（原始工具 id，人话化交给前端）。重复步没有工具调用时缺席。 */
  tool_id: z.string().min(1).optional(),
  /** 涉及多个工具时的完整列表（去重、按出现顺序）；单工具时缺席。 */
  tool_ids: z.array(z.string().min(1)).min(2).optional()
});
export type AgentRunReminderFacts = z.infer<typeof agentRunReminderFactsSchema>;

/** 运行 VM 里的一行提醒。形状与事件 data 的公共部分逐字段相同，故渲染层一份代码通吃两个来源。 */
export const agentRunReminderVmSchema = agentRunReminderFactsSchema.strict();
export type AgentRunReminderVM = z.infer<typeof agentRunReminderVmSchema>;

/**
 * 宽容读取：从任意来源（SSE envelope 的 data、VM 里的一行）解析出可渲染的提醒事实，多余字段
 * （run_id/work_item_id 等）自动剥掉。解析不出来返回 undefined——渲染层据此整行不渲，
 * 绝不把半截数据编成一句话。两端共用同一份，免得中英文两套 UI 各写一遍容错分支后行为分叉。
 */
export function readAgentRunReminderFacts(value: unknown): AgentRunReminderFacts | undefined {
  const parsed = agentRunReminderFactsSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

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
  notice: budgetNoticeSchema.optional()
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
  // R26 批 B6 观测面：这次运行里「重复动作被劝过几次、劝的是什么」。additive optional——存量客户端
  // 不认识这个键读旧响应零回归，缺席与空数组同义（时间线不渲提醒行）。每一行对应一条 agent_run.reminded
  // 事件，渲染层按 step_no 插进步骤时间线。
  reminders: z.array(agentRunReminderVmSchema).optional(),
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
