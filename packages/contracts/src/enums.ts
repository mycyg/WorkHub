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

export const allowedWorkItemTransitions = {
  intake: ["ai_clarifying", "cancelled"],
  ai_clarifying: ["spec_ready", "cancelled"],
  spec_ready: ["ai_working", "pm_mode", "cancelled"],
  ai_working: ["in_review", "escalated", "cancelled"],
  escalated: ["pm_mode", "cancelled"],
  pm_mode: ["in_review", "cancelled"],
  in_review: ["merged", "ai_working", "pm_mode", "cancelled"],
  merged: ["done", "intake"],
  done: [],
  cancelled: []
} satisfies Record<WorkItemStatus, readonly WorkItemStatus[]>;

export const workItemModes = ["worker", "pm"] as const;
export const workItemModeSchema = z.enum(workItemModes);
export type WorkItemMode = z.infer<typeof workItemModeSchema>;

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

export const branchStatuses = ["open", "merged", "abandoned"] as const;
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
  "budget_exhausted",
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
  permissionAsk: "permission.ask",
  permissionDecided: "permission.decided",
  proposalOpened: "proposal.opened",
  proposalReviewed: "proposal.reviewed",
  proposalMerged: "proposal.merged",
  stepSnapshot: "step.snapshot",
  knowledgeEvidenceReady: "knowledge.evidence.ready",
  syncProgress: "sync.progress",
  syncConflict: "sync.conflict",
  usageRecorded: "usage.recorded",
  budgetWarning: "budget.warning",
  budgetExhausted: "budget.exhausted",
  notificationCreated: "notification.created"
} as const;

export const eventTypeSchema = z.enum(Object.values(eventTypes) as [string, ...string[]]);
export type EventType = (typeof eventTypes)[keyof typeof eventTypes];
