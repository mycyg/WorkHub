import { z } from "zod";

export const workItemStatuses = [
  "intake",
  "ai_clarifying",
  "spec_ready",
  "ai_working",
  "escalated",
  "pm_mode",
  "in_review",
  "merged",
  "done",
  "cancelled"
] as const;
export const workItemStatusSchema = z.enum(workItemStatuses);
export type WorkItemStatus = z.infer<typeof workItemStatusSchema>;

// L#59：优先级是固定枚举（下游按 low/normal/high/urgent 处理），不是任意字符串。
export const workItemPriorities = ["low", "normal", "high", "urgent"] as const;
export const workItemPrioritySchema = z.enum(workItemPriorities);
export type WorkItemPriority = z.infer<typeof workItemPrioritySchema>;

export const allowedWorkItemTransitions = {
  intake: ["ai_clarifying", "cancelled"],
  ai_clarifying: ["spec_ready", "cancelled"],
  spec_ready: ["ai_working", "pm_mode", "cancelled"],
  // B-R9.0-4：ai_working→pm_mode = 人从跑着的军团手里接管（升级卡「转成我来做」）。
  // 军团升级是切片级的（其他子任务可能还在健康跑），工单不整体置 escalated，
  // 所以接管必须能从 ai_working 直达 pm_mode。
  ai_working: ["in_review", "escalated", "pm_mode", "cancelled"],
  escalated: ["ai_working", "pm_mode", "cancelled"],
  pm_mode: ["in_review", "cancelled"],
  in_review: ["merged", "ai_working", "pm_mode", "cancelled"],
  merged: ["done", "intake"],
  done: [],
  cancelled: []
} satisfies Record<WorkItemStatus, readonly WorkItemStatus[]>;

// findings[#19/H4]：session-finalize（POST /api/workitems with session_id）合法的「源」状态白名单。
// 只允许从澄清阶段(intake/ai_clarifying/spec_ready)或同状态幂等改写推进到 spec_ready/ai_working；
// 据此守卫 updateWorkItemFromSession，杜绝把已交付/终态(merged/done/cancelled)或在审/升级
// (in_review/escalated/pm_mode)的事项经此路径复活、覆盖内容并清空验收态。`to` 自纳保证同状态改写通过。
export function sessionFinalizeFromStatuses(to: WorkItemStatus): WorkItemStatus[] {
  const base: WorkItemStatus[] = ["intake", "ai_clarifying", "spec_ready", to];
  return base.filter((status, index) => base.indexOf(status) === index);
}

export const workItemModes = ["worker", "pm"] as const;
export const workItemModeSchema = z.enum(workItemModes);
export type WorkItemMode = z.infer<typeof workItemModeSchema>;

// B-R9.6 §3.1：paused = 人按下「暂停派发」。在跑的子 run 不杀，只停新派发；resume 回 dispatching。
export const taskPlanStatuses = ["draft", "proposed", "approved", "dispatching", "paused", "done", "cancelled"] as const;
export const taskPlanStatusSchema = z.enum(taskPlanStatuses);
export type TaskPlanStatus = z.infer<typeof taskPlanStatusSchema>;

export const taskPlanItemRoles = ["research", "produce", "review", "integrate"] as const;
export const taskPlanItemRoleSchema = z.enum(taskPlanItemRoles);
export type TaskPlanItemRole = z.infer<typeof taskPlanItemRoleSchema>;

export const taskPlanItemStatuses = ["pending", "dispatched", "succeeded", "failed", "skipped"] as const;
export const taskPlanItemStatusSchema = z.enum(taskPlanItemStatuses);
export type TaskPlanItemStatus = z.infer<typeof taskPlanItemStatusSchema>;

export const confidenceGrades = ["low", "medium", "high"] as const;
export const confidenceGradeSchema = z.enum(confidenceGrades);
export type ConfidenceGrade = z.infer<typeof confidenceGradeSchema>;

export const riskLevels = ["low", "medium", "high"] as const;
export const riskLevelSchema = z.enum(riskLevels);
export type RiskLevel = z.infer<typeof riskLevelSchema>;

export const confidenceVerdicts = ["auto_merge", "human_spotcheck", "escalate"] as const;
export const confidenceVerdictSchema = z.enum(confidenceVerdicts);
export type ConfidenceVerdict = z.infer<typeof confidenceVerdictSchema>;

export const escalationTriggers = [
  "unqualified",
  "user_unsatisfied",
  "user_forbidden",
  "doom_loop",
  "budget_exhausted"
] as const;
export const escalationTriggerSchema = z.enum(escalationTriggers);
export type EscalationTrigger = z.infer<typeof escalationTriggerSchema>;

export const actorKinds = ["human", "ai", "system"] as const;
export const actorKindSchema = z.enum(actorKinds);
export type ActorKind = z.infer<typeof actorKindSchema>;

export const branchKinds = ["work", "main"] as const;
export const branchKindSchema = z.enum(branchKinds);
export type BranchKind = z.infer<typeof branchKindSchema>;

export const branchStatuses = ["open", "proposed", "merged", "abandoned", "superseded"] as const;
export const branchStatusSchema = z.enum(branchStatuses);
export type BranchStatus = z.infer<typeof branchStatusSchema>;

export const proposalStatuses = ["opened", "reviewed", "merged", "rejected"] as const;
export const proposalStatusSchema = z.enum(proposalStatuses);
export type ProposalStatus = z.infer<typeof proposalStatusSchema>;

export const reviewDecisions = ["approve", "reject"] as const;
export const reviewDecisionSchema = z.enum(reviewDecisions);
export type ReviewDecision = z.infer<typeof reviewDecisionSchema>;

export const agentRunStatuses = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "escalated",
  "cancelled"
] as const;
export const agentRunStatusSchema = z.enum(agentRunStatuses);
export type AgentRunStatus = z.infer<typeof agentRunStatusSchema>;

export const agentStepPhases = ["think", "tool_call", "tool_result", "final"] as const;
export const agentStepPhaseSchema = z.enum(agentStepPhases);
export type AgentStepPhase = z.infer<typeof agentStepPhaseSchema>;

export const toolControlSignals = ["continue", "stop", "compact", "escalate"] as const;
export const toolControlSignalSchema = z.enum(toolControlSignals);
export type ToolControlSignal = z.infer<typeof toolControlSignalSchema>;

export const permissionScopeKinds = ["org", "workspace", "role", "session"] as const;
export const permissionScopeKindSchema = z.enum(permissionScopeKinds);
export type PermissionScopeKind = z.infer<typeof permissionScopeKindSchema>;

export const permissionEffects = ["allow", "deny", "ask"] as const;
export const permissionEffectSchema = z.enum(permissionEffects);
export type PermissionEffect = z.infer<typeof permissionEffectSchema>;

export const approvalStatuses = ["pending", "approved", "denied", "expired", "delegated"] as const;
export const approvalStatusSchema = z.enum(approvalStatuses);
export type ApprovalStatus = z.infer<typeof approvalStatusSchema>;

export const evidenceSourceTypes = [
  "drive_file",
  "meeting",
  "comment",
  "work_item",
  "spec_doc",
  "agent_step",
  "audit_log",
  "external_url"
] as const;
export const evidenceSourceTypeSchema = z.enum(evidenceSourceTypes);
export type EvidenceSourceType = z.infer<typeof evidenceSourceTypeSchema>;

export const deliverableTargetKinds = [
  "structured_record",
  "text_doc",
  "binary_doc",
  "spreadsheet",
  "slide_deck",
  "image",
  "folder",
  "archive",
  "spec_doc"
] as const;
export const deliverableTargetKindSchema = z.enum(deliverableTargetKinds);
export type DeliverableTargetKind = z.infer<typeof deliverableTargetKindSchema>;

export const eventTypes = {
  agentRunStarted: "agent_run.started",
  agentRunStep: "agent_run.step",
  stepToolResult: "step.tool_result",
  agentRunCompacting: "agent_run.compacting",
  agentRunFailed: "agent_run.failed",
  agentRunEscalated: "agent_run.escalated",
  sessionQuestion: "session.question",
  confidenceScored: "confidence.scored",
  escalationOpened: "escalation.opened",
  permissionAsk: "permission.ask",
  permissionDecided: "permission.decided",
  permissionReassigned: "permission.reassigned",
  permissionExpired: "permission.expired",
  proposalOpened: "proposal.opened",
  proposalReviewed: "proposal.reviewed",
  proposalMerged: "proposal.merged",
  revisionFedback: "revision.fedback",
  stepSnapshot: "step.snapshot",
  knowledgeEvidenceReady: "knowledge.evidence.ready",
  syncProgress: "sync.progress",
  syncConflict: "sync.conflict",
  usageRecorded: "usage.recorded",
  budgetWarning: "budget.warning",
  budgetExhausted: "budget.exhausted",
  notificationCreated: "notification.created",
  conversationMessageCreated: "conversation.message.created",
  conversationMessageDelta: "conversation.message.delta",
  // R14 批 CHAT：编辑/删除/置顶后广播——data=变更后全量消息 VM，客户端按 id 整条替换。
  conversationMessageUpdated: "conversation.message.updated",
  // R14 批 CHAT：reaction 全量聚合幂等替换（不发增量）。
  conversationReactionUpdated: "conversation.reaction.updated",
  // R14 批 CHAT：已读游标推进。
  conversationReadUpdated: "conversation.read.updated",
  // R15 批 cuu-toggle：会话级 Cuu 参与开关翻转后广播（PATCH /cuu），让其它开着这个会话的客户端头部
  // 同步开关状态，不必等下次重挂才看到。
  conversationCuuUpdated: "conversation.cuu.updated",
  conversationToolBegin: "conversation.tool.begin",
  conversationToolOutputDelta: "conversation.tool.output_delta",
  conversationToolEnd: "conversation.tool.end",
  conversationActionCardUpdated: "conversation.action_card.updated",
  conversationItemStarted: "conversation.item.started",
  conversationItemCompleted: "conversation.item.completed",
  conversationPresenceTyping: "conversation.presence.typing",
  // R14 CHAT 批（presence-observer 工包）：观察者 worker 真正调用 LLM 分析某会话消息窗之前发布的
  // 瞬态信号（见 events.ts 的 conversationObserverAnalyzingEventSchema）。
  conversationObserverAnalyzing: "conversation.observer.analyzing"
} as const;

export const eventTypeSchema = z.enum(Object.values(eventTypes) as [string, ...string[]]);
export type EventType = (typeof eventTypes)[keyof typeof eventTypes];
