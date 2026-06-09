import { z } from "zod";

import {
  agentRunSchema,
  agentStepSchema,
  snapshotSchema,
  structuredHandoffSchema
} from "./domain/agent.js";
import { auditLogFactSchema, manifestFactsSchema } from "./audit.js";
import { approvalRequestSchema } from "./domain/governance.js";
import { workItemSchema } from "./domain/work-item.js";
import {
  attentionItemSchema,
  budgetScopeSchema,
  budgetUsageSchema,
  budgetNoticeSchema,
  costSummaryVmSchema,
  cuuStateSchema,
  deliverableChangeManifestSchema,
  evidenceBubbleSchema,
  evidenceRefSchema,
  questionCardSchema,
  workHubEventSchema
} from "./experience.js";
import { idSchema, isoDateTimeSchema } from "./domain/common.js";

export const actionSpecSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  method: z.enum(["GET", "POST", "PUT", "DELETE"]),
  href: z.string().min(1),
  requires_desktop: z.boolean().optional(),
  requires_reason: z.boolean().optional()
});
export type ActionSpec = z.infer<typeof actionSpecSchema>;

export const attentionHomeVmSchema = z.object({
  primary: attentionItemSchema.optional(),
  queue: z.array(attentionItemSchema),
  background_runs: z.array(z.object({
    run_id: idSchema,
    work_item_id: idSchema.optional(),
    title: z.string().min(1),
    state: z.enum(["queued", "running", "waiting_for_user", "failed"]),
    preview_text: z.string().min(1)
  })),
  cuu_state: cuuStateSchema
});
export type AttentionHomeVM = z.infer<typeof attentionHomeVmSchema>;

export const acceptedDeliverableVmSchema = z.object({
  id: idSchema,
  work_item_id: idSchema,
  proposal_id: idSchema,
  change_id: idSchema,
  target_kind: z.string().min(1),
  target_key: z.string().min(1),
  change_type: z.string().min(1),
  accepted_version: z.number().int().positive(),
  target_path: z.string().optional(),
  sha256: z.string().length(64).optional(),
  drive_item_id: idSchema.optional(),
  drive_version_id: idSchema.optional(),
  filename: z.string().min(1).optional(),
  mime: z.string().min(1).optional(),
  size_bytes: z.number().int().nonnegative().optional(),
  download_href: z.string().min(1).optional(),
  preview_href: z.string().min(1).optional(),
  restore_href: z.string().min(1).optional(),
  accepted_at: isoDateTimeSchema
});
export type AcceptedDeliverableVM = z.infer<typeof acceptedDeliverableVmSchema>;

export const acceptedDeliverableRestoreResultSchema = z.object({
  accepted_deliverable: acceptedDeliverableVmSchema
});
export type AcceptedDeliverableRestoreResult = z.infer<typeof acceptedDeliverableRestoreResultSchema>;

export const replayMergeCandidateVmSchema = z.object({
  option_key: z.string().min(1),
  target_kind: z.string().min(1).optional(),
  rationale_md: z.string().optional(),
  merged_value: z.record(z.string(), z.unknown()).optional(),
  source: z.string().optional(),
  quality_gate: z.record(z.string(), z.unknown()).optional(),
  recommended: z.boolean().default(false),
  chosen: z.boolean().default(false)
});
export type ReplayMergeCandidateVM = z.infer<typeof replayMergeCandidateVmSchema>;

export const replayMergeDecisionVmSchema = z.object({
  id: idSchema,
  conflict_key: z.string().min(1),
  recommended_option_key: z.string().min(1).optional(),
  chosen_option_key: z.string().min(1).optional(),
  chosen_by_user_id: idSchema.optional(),
  chosen_at: isoDateTimeSchema.optional(),
  candidates: z.array(replayMergeCandidateVmSchema).default([])
});
export type ReplayMergeDecisionVM = z.infer<typeof replayMergeDecisionVmSchema>;

export const replayTextHunkDecisionVmSchema = z.object({
  hunk_index: z.number().int().nonnegative(),
  start_line: z.number().int().positive(),
  end_line: z.number().int().positive(),
  decision: z.enum(["keep_current", "accept_incoming", "ai_fusion"])
});
export type ReplayTextHunkDecisionVM = z.infer<typeof replayTextHunkDecisionVmSchema>;

export const replayBulkActionVmSchema = z.object({
  action: z.enum(["keep_current", "accept_incoming"]),
  target_keys: z.array(z.string().min(1)).default([]),
  conflict_count: z.number().int().nonnegative().optional(),
  result: z.string().min(1).optional(),
  accepted_incoming_target_keys: z.array(z.string().min(1)).default([]),
  resolved_conflict_target_keys: z.array(z.string().min(1)).default([]),
  blocked_target_keys: z.array(z.string().min(1)).default([]),
  audit_id: idSchema.optional()
});
export type ReplayBulkActionVM = z.infer<typeof replayBulkActionVmSchema>;

export const replayMergeAttemptVmSchema = z.object({
  id: idSchema,
  proposal_id: idSchema,
  work_item_id: idSchema,
  branch_id: idSchema.optional(),
  actor_kind: z.string().min(1),
  actor_user_id: idSchema.optional(),
  result: z.string().min(1),
  merge_snapshot_id: idSchema.optional(),
  conflict_count: z.number().int().nonnegative(),
  target_keys: z.array(z.string().min(1)).default([]),
  accepted_target_keys: z.array(z.string().min(1)).default([]),
  conflicts: z.array(z.unknown()).default([]),
  decisions: z.array(replayMergeDecisionVmSchema).default([]),
  text_hunk_decisions: z.array(replayTextHunkDecisionVmSchema).default([]),
  text_hunk_count: z.number().int().nonnegative().optional(),
  text_hunk_output_sha256: z.string().length(64).optional(),
  bulk_action: replayBulkActionVmSchema.optional(),
  created_at: isoDateTimeSchema
});
export type ReplayMergeAttemptVM = z.infer<typeof replayMergeAttemptVmSchema>;

export const workItemDetailVmSchema = z.object({
  workitem: workItemSchema,
  acceptance: z.array(z.unknown()),
  agent_trace_preview: z.array(agentStepSchema),
  latest_proposal: deliverableChangeManifestSchema.optional(),
  accepted_deliverables: z.array(acceptedDeliverableVmSchema).default([]),
  evidence_refs: z.array(evidenceRefSchema)
});
export type WorkItemDetailVM = z.infer<typeof workItemDetailVmSchema>;

export const approvalCenterVmSchema = z.object({
  items: z.array(attentionItemSchema),
  requests: z.array(approvalRequestSchema),
  filters: z.record(z.string(), z.unknown()),
  counts: z.record(z.string(), z.number().int().nonnegative())
});
export type ApprovalCenterVM = z.infer<typeof approvalCenterVmSchema>;

export const proposalDetailVmSchema = z.object({
  proposal_id: idSchema,
  work_item_id: idSchema,
  title: z.string().min(1),
  status: z.enum(["opened", "reviewed", "merged", "rejected"]),
  manifest: deliverableChangeManifestSchema,
  evidence_refs: z.array(evidenceRefSchema),
  review_actions: z.object({
    approve: actionSpecSchema,
    request_changes: actionSpecSchema,
    merge: actionSpecSchema.optional()
  }),
  comments: z.array(z.object({
    id: idSchema,
    author_label: z.string().min(1),
    body: z.string().min(1),
    created_at: isoDateTimeSchema
  }))
});
export type ProposalDetailVM = z.infer<typeof proposalDetailVmSchema>;

export const replayTraceVmSchema = z.object({
  run: agentRunSchema,
  steps: z.array(agentStepSchema),
  evidence_refs: z.array(evidenceRefSchema),
  snapshots: z.array(snapshotSchema),
  audit_logs: z.array(auditLogFactSchema).optional(),
  accepted_deliverables: z.array(acceptedDeliverableVmSchema).default([]),
  merge_timeline: z.array(replayMergeAttemptVmSchema).default([]),
  manifest_facts: manifestFactsSchema.optional(),
  cost: costSummaryVmSchema.optional()
});
export type ReplayTraceVM = z.infer<typeof replayTraceVmSchema>;

export const agentRunTraceVmSchema = z.object({
  run: agentRunSchema,
  steps: z.array(agentStepSchema),
  current_step: agentStepSchema.optional(),
  budget: z.record(z.string(), z.unknown()),
  snapshot_refs: z.array(snapshotSchema),
  handoff: structuredHandoffSchema.optional(),
  replay_href: z.string().optional()
});
export type AgentRunTraceVM = z.infer<typeof agentRunTraceVmSchema>;

export const costDashboardVmSchema = z.object({
  generated_at: isoDateTimeSchema,
  currency: z.literal("CNY"),
  total_cost_cny: z.string(),
  token_in: z.number().int().nonnegative(),
  token_out: z.number().int().nonnegative(),
  unit_cost_cny: z.string().optional(),
  trend: z.array(z.object({
    date: z.string(),
    cost_cny: z.string(),
    tokens: z.number().int().nonnegative()
  })),
  by_user: z.array(z.object({
    user_id: idSchema,
    label: z.string().min(1),
    cost_cny: z.string(),
    tokens: z.number().int().nonnegative()
  })),
  by_team: z.array(z.object({
    team_id: idSchema,
    label: z.string().min(1),
    cost_cny: z.string(),
    tokens: z.number().int().nonnegative()
  })),
  by_workitem: z.array(z.object({
    workitem_id: idSchema,
    code: z.string().min(1),
    cost_cny: z.string(),
    turns: z.number().int().nonnegative()
  })),
  model_breakdown: z.array(z.object({
    provider: z.string(),
    model: z.string(),
    count: z.number().int().nonnegative(),
    cost_cny: z.string()
  })),
  budget: z.array(budgetUsageSchema),
  notices: z.array(budgetNoticeSchema),
  top_exhaustion_risks: z.array(z.object({
    scope: budgetScopeSchema,
    label: z.string().min(1),
    remaining_cost_cny: z.string(),
    status: budgetUsageSchema.shape.status
  })),
  empty_state: z.enum(["no_agent_runs", "usage_not_connected"]).optional()
});
export type CostDashboardVM = z.infer<typeof costDashboardVmSchema>;

export const goldPathSurfaceVmSchema = z.object({
  fixture_id: z.literal("weekly_report_manifest_doc"),
  routes: z.object({
    home: z.string().min(1),
    intake: z.string().min(1),
    approvals: z.string().min(1),
    workitem: z.string().min(1),
    proposal: z.string().min(1),
    replay: z.string().min(1),
    cost: z.string().min(1)
  }),
  page_vms: z.object({
    attention: attentionHomeVmSchema,
    question: questionCardSchema,
    evidence: evidenceBubbleSchema,
    approvals: approvalCenterVmSchema,
    workitem: workItemDetailVmSchema,
    proposal: proposalDetailVmSchema,
    replay: replayTraceVmSchema,
    cost: costDashboardVmSchema
  }),
  events: z.array(workHubEventSchema(z.unknown())),
  cuu_states: z.array(cuuStateSchema)
});
export type GoldPathSurfaceVM = z.infer<typeof goldPathSurfaceVmSchema>;
