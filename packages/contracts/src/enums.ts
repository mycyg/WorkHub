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

// R23 F-01（OKR 列表/详情持久化）：镜像 packages/db/src/schema/core.ts 里 objectives/key_results 表的本地
// ObjectiveStatus/KeyResultStatus 字面量联合——db 层为避免循环依赖没有直接导入本文件，这里独立声明一份
// 供 GET /api/projects/:id/objectives 与 GET /api/objectives/:id 的响应契约使用；两侧改动值时要同步。
export const objectiveStatuses = ["active", "paused", "done", "archived"] as const;
export const objectiveStatusSchema = z.enum(objectiveStatuses);
export type ObjectiveStatus = z.infer<typeof objectiveStatusSchema>;

export const keyResultStatuses = ["active", "done", "at_risk", "cancelled"] as const;
export const keyResultStatusSchema = z.enum(keyResultStatuses);
export type KeyResultStatus = z.infer<typeof keyResultStatusSchema>;

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

// CORE-11：删掉死枚举值 "delegated"——实现从不写该状态（委派保持 status=pending，只写
// delegated_to_user_id，见 approvals 服务/approval_requests 表），留着只会让契约与实现发散。
export const approvalStatuses = ["pending", "approved", "denied", "expired"] as const;
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

// R17 #25（零生产者事件类型核查）：下列标 @deprecated 的成员在生产路径从未被 publish（仅测试夹具/
// schema/UI 消费分支引用）。**枚举值一律保留**——eventTypeSchema 由 Object.values 生成，删值会破坏
// contracts 兼容面（旧事件反序列化、跨版本客户端）。仅打注释示警，别新写生产者时误用；确要恢复某类，
// 补上真实 publish 点后移除本注释即可。核查依据见 06-gap-fix-plan.md G2 行。
export const eventTypes = {
  agentRunStarted: "agent_run.started",
  agentRunStep: "agent_run.step",
  stepToolResult: "step.tool_result",
  agentRunCompacting: "agent_run.compacting",
  // R26 批 B6 观测面：重复动作「先劝再断」的前两档（默认连续 3 步、5 步）发这条——运行环境
  // 往对话里追加了一条提醒、让模型自己换做法，运行仍在继续。第三档才升级，走 agent_run.escalated，
  // 因此这两类事件互斥、不会为同一次判定各发一条。payload 见 events.ts 的
  // agentRunRemindedDataSchema（档位/连续步数/重复形态/工具名），文案一律由前端按 payload 组装。
  agentRunReminded: "agent_run.reminded",
  agentRunFailed: "agent_run.failed",
  agentRunEscalated: "agent_run.escalated",
  sessionQuestion: "session.question",
  /** @deprecated 无生产者：`confidence.scored` 只作审计动作名与 toCuuState 映射存在，从不作为 SSE 事件 publish。 */
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
  /** @deprecated 无生产者：喂 knowledge_result AttentionItem 死分支，仅 toAttentionItem/toCuuState/夹具引用，无 publish。 */
  knowledgeEvidenceReady: "knowledge.evidence.ready",
  /** @deprecated 无生产者：仅 toCuuState 映射引用（兄弟 sync.conflict 有真实生产者，本类无）。 */
  syncProgress: "sync.progress",
  syncConflict: "sync.conflict",
  /** @deprecated 无生产者也无消费者：仅 gold-path 夹具引用，整类惰性。 */
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
  // R17 批 G1（群成员管理）：会话参与者集合变化后广播——加人（POST /participants）、退群/移出（DELETE
  // /participants/:userId）。让其它开着这个会话的客户端就地重拉参与者（成员条 / 已读 N/M 分母）；同
  // cuu.updated 的既有取舍——只带 conversation_id + 变化类型 + 受影响 user_id，客户端据此按需重拉
  // GET /participants，接不上就等下次重挂时兜底，不强求必达。
  conversationParticipantsUpdated: "conversation.participants.updated",
  // R20 P2-04（会话 rename 跨端同步）：协同会话改名后广播——data 只带 conversation_id + 新 title。让别的开着
  // 这个会话的客户端就地改左栏树叶 / web 镜像页标题，不必等下次全量轮询才看到新名字。同 cuu.updated 的既有
  // 取舍：只投到会话私有流（conversation:<id>，仅参与者可订，不广播全工作区），接不上就等下次重挂时用会话 VM
  // 里的 title 兜底，不强求这条广播必达。
  conversationTitleUpdated: "conversation.title.updated",
  /** @deprecated 无生产者也无消费者：仅 r12-workbench 契约测试快照枚举，工具流实际走 conversation.tool.* 之外的既有事件。 */
  conversationToolBegin: "conversation.tool.begin",
  /** @deprecated 无生产者也无消费者：同上，仅契约测试引用。 */
  conversationToolOutputDelta: "conversation.tool.output_delta",
  /** @deprecated 无生产者也无消费者：同上，仅契约测试引用。 */
  conversationToolEnd: "conversation.tool.end",
  conversationActionCardUpdated: "conversation.action_card.updated",
  /** @deprecated 无生产者也无消费者：仅契约测试引用。 */
  conversationItemStarted: "conversation.item.started",
  /** @deprecated 无生产者也无消费者：仅契约测试引用。 */
  conversationItemCompleted: "conversation.item.completed",
  conversationPresenceTyping: "conversation.presence.typing",
  // R14 CHAT 批（presence-observer 工包）：观察者 worker 真正调用 LLM 分析某会话消息窗之前发布的
  // 瞬态信号（见 events.ts 的 conversationObserverAnalyzingEventSchema）。
  conversationObserverAnalyzing: "conversation.observer.analyzing"
} as const;

export const eventTypeSchema = z.enum(Object.values(eventTypes) as [string, ...string[]]);
export type EventType = (typeof eventTypes)[keyof typeof eventTypes];
