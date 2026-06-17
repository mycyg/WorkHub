import { z } from "zod";

import {
  agentRunSchema,
  agentStepSchema,
  snapshotSchema,
  structuredHandoffSchema
} from "./domain/agent.js";
import { workHubLocaleSchema } from "./locale.js";
import { auditLogFactSchema, manifestFactsSchema } from "./audit.js";
import { approvalRequestSchema } from "./domain/governance.js";
import { workItemSchema } from "./domain/work-item.js";
import { notificationSeveritySchema } from "./notification.js";
import {
  attentionItemSchema,
  budgetScopeSchema,
  budgetUsageSchema,
  budgetNoticeSchema,
  costSummaryVmSchema,
  cuuStateSchema,
  deliverableChangeManifestSchema,
  deliverableChangeSchema,
  deliverableCheckSchema,
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

export const aiWorklogVmSchema = z.object({
  runs_today: z.number().int().nonnegative(),
  autonomy_rate: z.number().int().min(0).max(100),
  accepted_today: z.number().int().nonnegative(),
  saved_hours_estimate: z.number().nonnegative(),
  // R8：今日「自进化」——AI 给团队技能库新增/精修了多少条（复利劳动力的自我打磨在战绩里显性化）。
  skills_promoted_today: z.number().int().nonnegative().default(0),
  skills_refined_today: z.number().int().nonnegative().default(0),
  // findings[18]：与其它 generated_at 统一用 isoDateTimeSchema，挡住非 ISO 时间戳越过 VM 边界后下游格式化成 Invalid Date。
  generated_at: isoDateTimeSchema,
  range_label: z.string().min(1).optional()
});
export type AiWorklogVM = z.infer<typeof aiWorklogVmSchema>;

// R8：团队技能管理页 VM——展示当前激活的团队技能、版本/出处（含 K2 精修 provenance）与自进化统计。
export const teamSkillVmSchema = z.object({
  skill_key: z.string().min(1),
  name: z.string().min(1),
  when_to_use: z.string().min(1),
  version: z.number().int().positive(),
  source_kind: z.enum(["distilled", "authored"]),
  created_by_kind: z.enum(["ai", "human"]),
  confidence_score: z.number().min(0).max(1).optional(),
  sample_count: z.number().int().nonnegative(),
  updated_at: isoDateTimeSchema,
  // K2 精修出处（仅精修版本有）：从哪个版本来、改了几段、为什么。
  provenance: z.object({
    refined_from_version: z.number().int().positive(),
    op_count: z.number().int().nonnegative(),
    rationale_md: z.string().optional()
  }).optional()
});
export type TeamSkillVM = z.infer<typeof teamSkillVmSchema>;

export const teamSkillsPageVmSchema = z.object({
  generated_at: isoDateTimeSchema,
  skills: z.array(teamSkillVmSchema),
  totals: z.object({
    active: z.number().int().nonnegative(),
    ai_authored: z.number().int().nonnegative(),
    refined: z.number().int().nonnegative()
  }),
  empty_state: z.enum(["no_skills"]).optional()
});
export type TeamSkillsPageVM = z.infer<typeof teamSkillsPageVmSchema>;

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
  cuu_state: cuuStateSchema,
  worklog: aiWorklogVmSchema.optional()
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

export const driveFileVersionVmSchema = z.object({
  id: idSchema,
  item_id: idSchema,
  version_no: z.number().int().positive(),
  filename: z.string().min(1),
  mime: z.string().min(1).optional(),
  size_bytes: z.number().int().nonnegative(),
  sha256: z.string().length(64).optional(),
  created_at: isoDateTimeSchema,
  current: z.boolean(),
  source: z.enum(["accepted_deliverable", "manual_upload", "comment_draft"]).default("manual_upload"),
  accepted_deliverable_id: idSchema.optional(),
  work_item_id: idSchema.optional(),
  proposal_id: idSchema.optional(),
  preview_href: z.string().min(1).optional(),
  download_href: z.string().min(1).optional(),
  restore_href: z.string().min(1).optional()
});
export type DriveFileVersionVM = z.infer<typeof driveFileVersionVmSchema>;

export const driveItemVmSchema = z.object({
  id: idSchema,
  project_id: idSchema,
  parent_id: idSchema.optional(),
  name: z.string().min(1),
  kind: z.enum(["file", "folder"]),
  path: z.string().min(1),
  depth: z.number().int().nonnegative(),
  current_version_id: idSchema.optional(),
  current_version: driveFileVersionVmSchema.optional(),
  accepted_deliverable: acceptedDeliverableVmSchema.optional(),
  children_count: z.number().int().nonnegative(),
  deleted_at: isoDateTimeSchema.optional(),
  updated_at: isoDateTimeSchema
});
export type DriveItemVM = z.infer<typeof driveItemVmSchema>;

export const driveCommentVmSchema = z.object({
  id: idSchema,
  project_id: idSchema,
  folder_id: idSchema.optional(),
  folder_path: z.string().min(1).optional(),
  author_label: z.string().min(1),
  body: z.string().min(1),
  status: z.enum(["pending_llm", "draft_created", "proposal_created", "dismissed"]),
  created_at: isoDateTimeSchema,
  draft_work_item_id: idSchema.optional(),
  draft_href: z.string().min(1).optional(),
  proposal_id: idSchema.optional(),
  proposal_href: z.string().min(1).optional(),
  proposal_status: z.string().min(1).optional(),
  draft_action: actionSpecSchema.optional()
});
export type DriveCommentVM = z.infer<typeof driveCommentVmSchema>;

export const driveOperationVmSchema = z.object({
  id: idSchema,
  project_id: idSchema,
  actor_user_id: idSchema.optional(),
  op_type: z.enum(["upload_file", "delete_item", "restore_item", "restore_version", "rename_item", "comment_to_draft", "draft_to_proposal"]),
  target_item_id: idSchema.optional(),
  target_path: z.string().min(1).optional(),
  summary_text: z.string().min(1),
  created_at: isoDateTimeSchema
});
export type DriveOperationVM = z.infer<typeof driveOperationVmSchema>;

export const drivePageVmSchema = z.object({
  generated_at: isoDateTimeSchema,
  project: z.object({
    id: idSchema,
    name: z.string().min(1),
    slug: z.string().min(1),
    owner_label: z.string().min(1).optional(),
    status: z.enum(["active", "archived"])
  }).optional(),
  summary: z.object({
    item_count: z.number().int().nonnegative(),
    file_count: z.number().int().nonnegative(),
    folder_count: z.number().int().nonnegative(),
    deleted_item_count: z.number().int().nonnegative().default(0),
    version_count: z.number().int().nonnegative(),
    accepted_deliverable_count: z.number().int().nonnegative(),
    pending_comment_count: z.number().int().nonnegative(),
    operation_count: z.number().int().nonnegative().default(0)
  }),
  can_manage: z.boolean().default(false),
  selected_item_id: idSchema.optional(),
  items: z.array(driveItemVmSchema),
  deleted_items: z.array(driveItemVmSchema).default([]),
  versions: z.array(driveFileVersionVmSchema),
  accepted_deliverables: z.array(acceptedDeliverableVmSchema),
  comments: z.array(driveCommentVmSchema).default([]),
  operations: z.array(driveOperationVmSchema).default([]),
  actions: z.object({
    upload_file: actionSpecSchema.optional(),
    delete_item: actionSpecSchema.optional(),
    restore_item: actionSpecSchema.optional(),
    comment_to_draft: actionSpecSchema.optional()
  }).default({}),
  empty_state: z.enum(["no_project", "no_drive_items"]).optional()
});
export type DrivePageVM = z.infer<typeof drivePageVmSchema>;

export const meetingInsightVmSchema = z.object({
  id: idSchema,
  meeting_id: idSchema,
  kind: z.enum(["new_requirement", "requirement_change", "normal_note"]),
  title: z.string().min(1),
  description: z.string().min(1),
  confidence_reason: z.string().min(1),
  status: z.enum(["pending", "confirmed", "dismissed"]),
  target_work_item_id: idSchema.optional(),
  created_work_item_id: idSchema.optional(),
  draft_href: z.string().min(1).optional(),
  proposal_id: idSchema.optional(),
  proposal_href: z.string().min(1).optional(),
  proposal_status: z.string().min(1).optional(),
  confirmed_by_user_id: idSchema.optional(),
  confirmed_at: isoDateTimeSchema.optional(),
  created_at: isoDateTimeSchema,
  evidence_refs: z.array(evidenceRefSchema).default([]),
  actions: z.object({
    create_draft: actionSpecSchema.optional(),
    dismiss: actionSpecSchema.optional()
  }).default({})
});
export type MeetingInsightVM = z.infer<typeof meetingInsightVmSchema>;

export const meetingRecordVmSchema = z.object({
  id: idSchema,
  project_id: idSchema,
  work_item_id: idSchema.optional(),
  uploaded_by_user_id: idSchema,
  uploaded_by_label: z.string().min(1),
  title: z.string().min(1),
  audio_filename: z.string().min(1),
  audio_mime: z.string().min(1).optional(),
  audio_size_bytes: z.number().int().nonnegative(),
  transcript_text: z.string().optional(),
  minutes_md: z.string().optional(),
  status: z.enum(["processing", "ready", "failed"]),
  job_id: idSchema.optional(),
  created_at: isoDateTimeSchema,
  updated_at: isoDateTimeSchema,
  insights: z.array(meetingInsightVmSchema).default([])
});
export type MeetingRecordVM = z.infer<typeof meetingRecordVmSchema>;

export const meetingPageVmSchema = z.object({
  generated_at: isoDateTimeSchema,
  project: z.object({
    id: idSchema,
    name: z.string().min(1),
    slug: z.string().min(1),
    owner_label: z.string().min(1).optional(),
    status: z.enum(["active", "archived"])
  }).optional(),
  summary: z.object({
    meeting_count: z.number().int().nonnegative(),
    ready_count: z.number().int().nonnegative(),
    pending_insight_count: z.number().int().nonnegative(),
    confirmed_insight_count: z.number().int().nonnegative(),
    dismissed_insight_count: z.number().int().nonnegative()
  }),
  can_manage: z.boolean().default(false),
  selected_meeting_id: idSchema.optional(),
  meetings: z.array(meetingRecordVmSchema),
  empty_state: z.enum(["no_project", "no_meetings"]).optional()
});
export type MeetingPageVM = z.infer<typeof meetingPageVmSchema>;

export const notificationSourceContextVmSchema = z.discriminatedUnion("source_type", [
  z.object({
    source_type: z.literal("work_item"),
    work_item_id: idSchema,
    code: z.string().min(1).optional(),
    title: z.string().min(1),
    status: z.string().min(1),
    project_id: idSchema.optional(),
    project_name: z.string().min(1).optional(),
    due_at: isoDateTimeSchema.optional()
  }),
  z.object({
    source_type: z.literal("meeting_insight"),
    meeting_id: idSchema,
    insight_id: idSchema,
    title: z.string().min(1),
    meeting_title: z.string().min(1),
    insight_status: z.enum(["pending", "confirmed", "dismissed"]),
    project_id: idSchema.optional(),
    project_name: z.string().min(1).optional()
  }),
  z.object({
    source_type: z.literal("schedule_event"),
    schedule_event_id: idSchema,
    title: z.string().min(1),
    event_type: z.string().min(1),
    project_id: idSchema.optional(),
    work_item_id: idSchema.optional()
  }),
  z.object({
    source_type: z.literal("system"),
    label: z.string().min(1)
  })
]);
export type NotificationSourceContextVM = z.infer<typeof notificationSourceContextVmSchema>;

export const notificationInboxBucketSchema = z.enum(["needs_decision", "fyi", "done"]);
export type NotificationInboxBucket = z.infer<typeof notificationInboxBucketSchema>;

export const notificationEvidenceRefVmSchema = z.object({
  kind: z.enum(["knowledge_search", "agent_run_replay", "work_item", "meeting", "drive"]),
  label: z.string().min(1),
  href: z.string().min(1)
});
export type NotificationEvidenceRefVM = z.infer<typeof notificationEvidenceRefVmSchema>;

export const notificationGroundingVmSchema = z.object({
  reason_text: z.string().min(1),
  evidence_refs: z.array(notificationEvidenceRefVmSchema).default([])
});
export type NotificationGroundingVM = z.infer<typeof notificationGroundingVmSchema>;

export const notificationItemVmSchema = z.object({
  id: idSchema,
  type: z.string().min(1),
  severity: notificationSeveritySchema,
  status: z.enum(["unread", "read", "done"]),
  inbox_bucket: notificationInboxBucketSchema,
  title: z.string().min(1),
  body: z.string().optional(),
  grounding: notificationGroundingVmSchema.optional(),
  target_href: z.string().min(1).optional(),
  project_id: idSchema.optional(),
  work_item_id: idSchema.optional(),
  dedupe_key: z.string().min(1).optional(),
  source_context: notificationSourceContextVmSchema.optional(),
  read_at: isoDateTimeSchema.optional(),
  archived_at: isoDateTimeSchema.optional(),
  created_at: isoDateTimeSchema,
  updated_at: isoDateTimeSchema,
  actions: z.object({
    open: actionSpecSchema.optional(),
    mark_read: actionSpecSchema.optional(),
    dismiss: actionSpecSchema.optional(),
    complete: actionSpecSchema.optional()
  }).default({})
});
export type NotificationItemVM = z.infer<typeof notificationItemVmSchema>;

export const notificationPageVmSchema = z.object({
  generated_at: isoDateTimeSchema,
  actor_user_id: idSchema,
  summary: z.object({
    total_count: z.number().int().nonnegative(),
    unread_count: z.number().int().nonnegative(),
    needs_decision_count: z.number().int().nonnegative(),
    fyi_count: z.number().int().nonnegative(),
    done_count: z.number().int().nonnegative(),
    urgent_count: z.number().int().nonnegative()
  }),
  buckets: z.object({
    needs_decision: z.array(notificationItemVmSchema),
    fyi: z.array(notificationItemVmSchema),
    done: z.array(notificationItemVmSchema)
  }),
  items: z.array(notificationItemVmSchema),
  actions: z.object({
    mark_all_read: actionSpecSchema.optional()
  }).default({}),
  empty_state: z.enum(["no_notifications"]).optional()
});
export type NotificationPageVM = z.infer<typeof notificationPageVmSchema>;

export const scheduleBlockVmSchema = z.object({
  id: idSchema,
  kind: z.enum(["schedule_event", "work_item_due", "meeting_followup", "review_window"]),
  title: z.string().min(1),
  description: z.string().optional(),
  starts_at: isoDateTimeSchema.optional(),
  ends_at: isoDateTimeSchema,
  all_day: z.boolean().default(false),
  status: z.enum(["upcoming", "today", "overdue", "done"]),
  severity: notificationSeveritySchema,
  target_href: z.string().min(1).optional(),
  project_id: idSchema.optional(),
  work_item_id: idSchema.optional(),
  source_context: notificationSourceContextVmSchema.optional()
});
export type ScheduleBlockVM = z.infer<typeof scheduleBlockVmSchema>;

export const calendarPageVmSchema = z.object({
  generated_at: isoDateTimeSchema,
  actor_user_id: idSchema,
  scope: z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
    view: z.enum(["day", "week"]),
    range_start: isoDateTimeSchema,
    range_end: isoDateTimeSchema
  }),
  summary: z.object({
    block_count: z.number().int().nonnegative(),
    overdue_count: z.number().int().nonnegative(),
    today_count: z.number().int().nonnegative(),
    week_count: z.number().int().nonnegative()
  }),
  days: z.array(z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
    blocks: z.array(scheduleBlockVmSchema)
  })),
  blocks: z.array(scheduleBlockVmSchema),
  empty_state: z.enum(["no_schedule_blocks"]).optional()
});
export type CalendarPageVM = z.infer<typeof calendarPageVmSchema>;

export const projectHealthBandSchema = z.enum(["healthy", "attention", "critical"]);
export type ProjectHealthBand = z.infer<typeof projectHealthBandSchema>;

export const projectHealthSignalKeySchema = z.enum([
  "open_work_items",
  "overdue_work_items",
  "pending_approvals",
  "failed_runs",
  "pending_insights"
]);
export type ProjectHealthSignalKey = z.infer<typeof projectHealthSignalKeySchema>;

// 健康档位映射规则收在 contracts：UI/服务端共用同一阈值，禁止 UI 层自行算档。
const projectHealthSignalThresholds: Record<ProjectHealthSignalKey, { attention: number; critical: number }> = {
  open_work_items: { attention: 6, critical: 16 },
  overdue_work_items: { attention: 1, critical: 3 },
  pending_approvals: { attention: 3, critical: 6 },
  failed_runs: { attention: 1, critical: 2 },
  pending_insights: { attention: 2, critical: 5 }
};

export function projectHealthSignalBand(key: ProjectHealthSignalKey, count: number): ProjectHealthBand {
  const thresholds = projectHealthSignalThresholds[key];
  if (count >= thresholds.critical) {
    return "critical";
  }
  if (count >= thresholds.attention) {
    return "attention";
  }
  return "healthy";
}

export function resolveProjectHealthBand(signals: readonly { band: ProjectHealthBand }[]): ProjectHealthBand {
  if (signals.some((signal) => signal.band === "critical")) {
    return "critical";
  }
  if (signals.some((signal) => signal.band === "attention")) {
    return "attention";
  }
  return "healthy";
}

export const projectHealthSignalVmSchema = z.object({
  key: projectHealthSignalKeySchema,
  count: z.number().int().nonnegative(),
  band: projectHealthBandSchema,
  target_href: z.string().min(1).optional()
});
export type ProjectHealthSignalVM = z.infer<typeof projectHealthSignalVmSchema>;

export const projectHealthCardVmSchema = z.object({
  project_id: idSchema,
  project_name: z.string().min(1),
  band: projectHealthBandSchema,
  signals: z.array(projectHealthSignalVmSchema),
  numbers_visible: z.boolean().default(false),
  target_href: z.string().min(1).optional()
});
export type ProjectHealthCardVM = z.infer<typeof projectHealthCardVmSchema>;

export const projectHealthPageVmSchema = z.object({
  generated_at: isoDateTimeSchema,
  actor_user_id: idSchema,
  viewer_scope: z.enum(["admin", "member"]),
  summary: z.object({
    project_count: z.number().int().nonnegative(),
    healthy_count: z.number().int().nonnegative(),
    attention_count: z.number().int().nonnegative(),
    critical_count: z.number().int().nonnegative()
  }),
  cards: z.array(projectHealthCardVmSchema),
  empty_state: z.enum(["no_projects"]).optional()
});
export type ProjectHealthPageVM = z.infer<typeof projectHealthPageVmSchema>;

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

export const driveWorkItemSourceContextVmSchema = z.object({
  source_type: z.literal("drive_comment"),
  project_id: idSchema,
  comment_id: idSchema,
  folder_id: idSchema.optional(),
  folder_path: z.string().min(1).optional(),
  author_label: z.string().min(1),
  body: z.string().min(1),
  status: z.enum(["pending_llm", "draft_created", "proposal_created", "dismissed"]),
  created_at: isoDateTimeSchema,
  proposal_id: idSchema.optional(),
  proposal_href: z.string().min(1).optional(),
  proposal_status: z.string().min(1).optional()
});
export const meetingWorkItemSourceContextVmSchema = z.object({
  source_type: z.literal("meeting_insight"),
  project_id: idSchema,
  meeting_id: idSchema,
  insight_id: idSchema,
  meeting_title: z.string().min(1),
  insight_kind: z.enum(["new_requirement", "requirement_change", "normal_note"]),
  title: z.string().min(1),
  description: z.string().min(1),
  confidence_reason: z.string().min(1),
  status: z.enum(["pending", "confirmed", "dismissed"]),
  transcript_excerpt: z.string().min(1).optional(),
  minutes_excerpt: z.string().min(1).optional(),
  evidence_refs: z.array(evidenceRefSchema).default([]),
  created_at: isoDateTimeSchema,
  proposal_id: idSchema.optional(),
  proposal_href: z.string().min(1).optional(),
  proposal_status: z.string().min(1).optional()
});
export const workItemSourceContextVmSchema = z.discriminatedUnion("source_type", [
  driveWorkItemSourceContextVmSchema,
  meetingWorkItemSourceContextVmSchema
]);
export type WorkItemSourceContextVM = z.infer<typeof workItemSourceContextVmSchema>;

export const workItemDetailVmSchema = z.object({
  workitem: workItemSchema,
  acceptance: z.array(z.unknown()),
  agent_trace_preview: z.array(agentStepSchema),
  latest_proposal: deliverableChangeManifestSchema.optional(),
  accepted_deliverables: z.array(acceptedDeliverableVmSchema).default([]),
  evidence_refs: z.array(evidenceRefSchema),
  source_context: workItemSourceContextVmSchema.optional(),
  actions: z.object({
    create_proposal_draft: actionSpecSchema.optional()
  }).default({})
});
export type WorkItemDetailVM = z.infer<typeof workItemDetailVmSchema>;

// W2：审批工作台逐项详情。全部加在可选/默认字段上，旧 fixture/VM/smoke 解析不受影响。
export const approvalCommentVmSchema = z.object({
  id: idSchema,
  author_label: z.string().min(1),
  body: z.string().min(1),
  created_at: isoDateTimeSchema
});
export type ApprovalCommentVM = z.infer<typeof approvalCommentVmSchema>;

export const approvalRoutingStepSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["created", "routed", "delegated", "decided", "expired"]),
  label: z.string().min(1),
  actor_label: z.string().optional(),
  status: z.enum(["done", "current", "pending"]),
  at: isoDateTimeSchema.optional(),
  sla_due_at: isoDateTimeSchema.optional()
});
export type ApprovalRoutingStep = z.infer<typeof approvalRoutingStepSchema>;

export const approvalConflictRowSchema = z.object({
  description: z.string().min(1),
  impact: z.string().optional(),
  suggestion: z.string().optional()
});
export type ApprovalConflictRow = z.infer<typeof approvalConflictRowSchema>;

// 中栏按 kind 条件化：deliverable 渲染 before→after 对比表+合规检查；permission/tool 渲染摘要+证据+影响目标。
export const approvalDetailVmSchema = z.object({
  kind: z.enum(["deliverable", "permission", "tool"]),
  proposal_id: idSchema.optional(),
  proposal_href: z.string().optional(),
  ai_reason: z.string().optional(),
  expected_benefit: z.string().optional(),
  risk_label: z.string().optional(),
  manifest_changes: z.array(deliverableChangeSchema).default([]),
  checks: z.array(deliverableCheckSchema).default([]),
  conflicts: z.array(approvalConflictRowSchema).default([]),
  affected_targets: z.array(z.string()).default([]),
  timeline: z.array(approvalRoutingStepSchema).default([]),
  comments: z.array(approvalCommentVmSchema).default([])
});
export type ApprovalDetailVM = z.infer<typeof approvalDetailVmSchema>;

export const approvalCenterVmSchema = z.object({
  items: z.array(attentionItemSchema),
  requests: z.array(approvalRequestSchema),
  filters: z.record(z.string(), z.unknown()),
  counts: z.record(z.string(), z.number().int().nonnegative()),
  // 逐 item.id 的详情（预取，左栏点选时客户端就地切换；旧调用方默认空对象）。
  items_detail: z.record(z.string(), approvalDetailVmSchema).default({})
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
    // findings[18]：日序列桶为 "YYYY-MM-DD"（ledger periodBucket = createdAt.slice(0,10)），与 calendar 同口径严校。
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
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
  // K5（借鉴 SkillOpt 的「生产 vs 自我改进」分账）：把花费拆成「干活」与「自进化（夜间技能蒸馏）」，
  // 让复利劳动力的「自我打磨」开销显性、可审。ratio = 自进化 / 总花费（0–1）。
  labor_split: z.object({
    production_cost_cny: z.string(),
    self_improvement_cost_cny: z.string(),
    self_improvement_ratio: z.number().min(0).max(1)
  }).optional(),
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

export const settingsPageVmSchema = z.object({
  generated_at: isoDateTimeSchema,
  locale: workHubLocaleSchema,
  runtime: z.object({
    app_env: z.enum(["development", "test", "production"]),
    runtime_status: z.enum(["ready", "attention_needed"]),
    worker_count: z.number().int().positive(),
    broker_backend: z.enum(["memory", "redis", "pg_listen"]),
    broker_configured: z.boolean(),
    database_configured: z.boolean(),
    agent_run_lease_ms: z.number().int().positive(),
    agent_run_recovery_interval_ms: z.number().int().nonnegative()
  }),
  llm_runtime: z.object({
    default_provider: z.string().min(1),
    default_model: z.string().min(1),
    provider_count: z.number().int().nonnegative(),
    api_key_configured: z.boolean(),
    base_url_configured: z.boolean(),
    secret_safe: z.literal(true)
  }),
  budgets: z.object({
    run_tokens: z.number().int().positive(),
    user_daily_tokens: z.number().int().positive(),
    team_daily_tokens: z.number().int().positive(),
    team_monthly_tokens: z.number().int().positive(),
    run_cost_cny: z.string(),
    user_daily_cost_cny: z.string(),
    team_daily_cost_cny: z.string(),
    team_monthly_cost_cny: z.string()
  }),
  language: z.object({
    active_locale: workHubLocaleSchema,
    preference_locale: workHubLocaleSchema,
    preference_source: z.enum(["server", "request", "fallback"]),
    preference_synced: z.boolean(),
    supported_locales: z.array(workHubLocaleSchema).min(1),
    storage_key: z.string().min(1),
    update_href: z.string().min(1)
  }),
  device: z.object({
    desktop_client: z.literal("tauri"),
    local_execution_boundary: z.boolean(),
    independent_pet_window: z.boolean(),
    pet_model_settings_in_web: z.literal(false),
    restore_href: z.string().min(1),
    restore_requires_desktop: z.literal(true),
    web_local_actions_enabled: z.literal(false)
  })
});
export type SettingsPageVM = z.infer<typeof settingsPageVmSchema>;

export const goldPathSurfaceVmSchema = z.object({
  fixture_id: z.literal("weekly_report_manifest_doc"),
  routes: z.object({
    home: z.string().min(1),
    intake: z.string().min(1),
    approvals: z.string().min(1),
    workitem: z.string().min(1),
    proposal: z.string().min(1),
    replay: z.string().min(1),
    cost: z.string().min(1),
    knowledge: z.string().min(1)
  }),
  page_vms: z.object({
    attention: attentionHomeVmSchema,
    question: questionCardSchema,
    evidence: evidenceBubbleSchema,
    approvals: approvalCenterVmSchema,
    workitem: workItemDetailVmSchema,
    proposal: proposalDetailVmSchema,
    replay: replayTraceVmSchema,
    cost: costDashboardVmSchema,
    settings: settingsPageVmSchema.optional()
  }),
  events: z.array(workHubEventSchema(z.unknown())),
  cuu_states: z.array(cuuStateSchema)
});
export type GoldPathSurfaceVM = z.infer<typeof goldPathSurfaceVmSchema>;
