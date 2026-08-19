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
import { taskPlanVmSchema } from "./task-plan.js";
import {
  agentRunStatusSchema,
  taskPlanItemRoleSchema,
  taskPlanItemStatusSchema,
  taskPlanStatusSchema
} from "./enums.js";
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
  requires_reason: z.boolean().optional(),
  request_json: z.record(z.string(), z.unknown()).optional()
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

export const attentionSourceWarningSchema = z.object({
  source: z.enum(["approvals", "proposals", "escalations", "sync_conflicts", "worklog"]),
  message: z.string().min(1)
});
export type AttentionSourceWarning = z.infer<typeof attentionSourceWarningSchema>;

export const attentionHomeVmSchema = z.object({
  primary: attentionItemSchema.optional(),
  queue: z.array(attentionItemSchema),
  source_warnings: z.array(attentionSourceWarningSchema).optional(),
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
  project_id: idSchema.optional(),
  drive_item_id: idSchema.optional(),
  drive_version_id: idSchema.optional(),
  filename: z.string().min(1).optional(),
  mime: z.string().min(1).optional(),
  size_bytes: z.number().int().nonnegative().optional(),
  drive_href: z.string().min(1).optional(),
  download_href: z.string().min(1).optional(),
  preview_href: z.string().min(1).optional(),
  restore_href: z.string().min(1).optional(),
  access_notice: z.string().min(1).optional(),
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
  preview_href: z.string().min(1).optional(),
  download_href: z.string().min(1).optional(),
  children_count: z.number().int().nonnegative(),
  deleted_at: isoDateTimeSchema.optional(),
  // F3：逐项操作端点——回收站项各带自己的 restore_href、可删项各带自己的 delete_href,让每行都能单独恢复/删除,
  // 而不是只有一个指向 deleted[0]/单个 deletable 的全局按钮。仅在请求者有管理权时由服务端填充。
  restore_href: z.string().min(1).optional(),
  // R7（撤销路径）：还原被阻塞时给出人话原因（父级也在回收站/同名冲突/被禁止），不再静默留白。
  restore_blocked_reason: z.string().min(1).optional(),
  delete_href: z.string().min(1).optional(),
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
  requested_item_missing: z.boolean().optional(),
  // R11 Batch 0：按名搜索时回填查询串，让前端能区分「真空盘」与「搜索无命中」（见 empty_state 的 no_search_match）。
  search_query: z.string().optional(),
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
  // no_search_match：搜索过滤后 0 命中（与真空盘 no_drive_items 区分，供前端诚实提示）。
  empty_state: z.enum(["no_project", "no_drive_items", "no_search_match"]).optional()
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
  // R4（规模化）：列表被 200 上限封顶时明说——total_count 是「本次返回数」，不是历史总量。
  capped: z.boolean().optional(),
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
    // R11 Batch 0：标记「今天」那一格，供 UI 高亮（与 summary.today_count 同一 clock 口径）。API 恒回填此字段；
    // 声明 optional 是为了不破坏尚未回填 is_today 的既有 CalendarPageVM 消费方 fixture（UI 半边下一波补齐后可收紧为必填）。
    is_today: z.boolean().optional(),
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

// GitHub 式项目主页(/projects/:id)：项目即产品的「主页」——元信息 + 进行中工作清单 + 入口动作。
export const projectHomeWorkItemVmSchema = z.object({
  id: idSchema,
  code: z.string().min(1),
  title: z.string().min(1),
  status: z.string().min(1),
  priority: z.string().min(1),
  href: z.string().min(1),
  // B-R9.6 §3.4：军团工作项行尾 pill「军团 2/4」。仅当该工作项挂着活跃任务计划时出现；
  // 点击行为不变（进工作项详情），不加新小节。
  army: z.object({
    done: z.number().int().nonnegative(),
    total: z.number().int().positive()
  }).optional()
});
export type ProjectHomeWorkItemVM = z.infer<typeof projectHomeWorkItemVmSchema>;

export const projectHomePageVmSchema = z.object({
  generated_at: isoDateTimeSchema,
  project: z.object({
    id: idSchema,
    name: z.string().min(1),
    slug: z.string().min(1),
    description: z.string().nullable(),
    owner_label: z.string().min(1),
    status: z.enum(["active", "archived"])
  }),
  summary: z.object({
    // open_work_item_count = 当前用户「可见且可处理」的进行中条数(与下方清单一致)。
    open_work_item_count: z.number().int().nonnegative(),
    // M5：项目全量进行中条数(同 /projects 列表卡口径,未按可见性过滤)。让头部能显示「进行中 N · 你可处理 M」,
    // 与列表卡的数字对齐——否则列表卡显 8、主页显 3 会让用户以为数据出错。可选:旧 fixture 不带时回落只显可见数。
    total_open_work_item_count: z.number().int().nonnegative().optional()
  }),
  open_work_items: z.array(projectHomeWorkItemVmSchema),
  // 网盘同步是核心：项目主页直接呈现该项目的「最近文件」(GitHub 仓库主页即文件列表的观感)。
  drive: z.object({
    file_count: z.number().int().nonnegative(),
    recent_files: z.array(z.object({
      id: idSchema,
      name: z.string().min(1),
      updated_at: isoDateTimeSchema,
      href: z.string().min(1)
    }))
  }),
  actions: z.object({
    new_task: actionSpecSchema,
    open_drive: actionSpecSchema
  }),
  empty_state: z.enum(["no_open_work"]).optional()
});
export type ProjectHomePageVM = z.infer<typeof projectHomePageVmSchema>;

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

export const workItemAgentTeamItemStatusSchema = z.enum([
  "pending",
  "dispatched",
  "succeeded",
  "failed",
  "needs_human",
  "skipped"
]);
export type WorkItemAgentTeamItemStatus = z.infer<typeof workItemAgentTeamItemStatusSchema>;

export const workItemAgentTeamActionSchema = z.object({
  kind: z.enum(["view_output", "decide"]),
  label: z.string().min(1).max(48),
  href: z.string().min(1)
});
export type WorkItemAgentTeamActionVM = z.infer<typeof workItemAgentTeamActionSchema>;

export const workItemAgentTeamItemVmSchema = z.object({
  task_plan_item_id: idSchema,
  seq: z.number().int().positive(),
  title: z.string().min(1).max(256),
  role: taskPlanItemRoleSchema,
  plan_status: taskPlanItemStatusSchema,
  status: workItemAgentTeamItemStatusSchema,
  budget_share_pct: z.number().int().min(0).max(100),
  depends_on: z.array(idSchema).default([]),
  waiting_for_seq: z.array(z.number().int().positive()).default([]),
  cost_estimate_cny: z.string().optional(),
  run_id: idSchema.optional(),
  run_workspace_id: idSchema.optional(),
  parent_run_id: idSchema.optional(),
  run_status: agentRunStatusSchema.optional(),
  replay_href: z.string().min(1).optional(),
  decision_href: z.string().min(1).optional(),
  action: workItemAgentTeamActionSchema.optional()
});
export type WorkItemAgentTeamItemVM = z.infer<typeof workItemAgentTeamItemVmSchema>;

export const workItemAgentTeamVmSchema = z.object({
  plan_id: idSchema,
  status: taskPlanStatusSchema,
  completed_count: z.number().int().nonnegative(),
  total_count: z.number().int().nonnegative(),
  cost_used_cny: z.string().default("0.000000"),
  cost_budget_cny: z.string().optional(),
  cost_burn_pct: z.number().int().nonnegative().optional(),
  runs_capped: z.boolean().default(false),
  // B-R9.6 §3.1：头行「暂停派发/恢复派发」次级按钮。只在 dispatching/approved（可暂停）
  // 或 paused（可恢复）时出现；终态军团没有派发可控。
  dispatch_control: z.object({
    kind: z.enum(["pause", "resume"]),
    label: z.string().min(1),
    href: z.string().min(1),
    method: z.literal("POST")
  }).optional(),
  items: z.array(workItemAgentTeamItemVmSchema).max(50)
});
export type WorkItemAgentTeamVM = z.infer<typeof workItemAgentTeamVmSchema>;

export const agentArmyDashboardPlanVmSchema = z.object({
  plan_id: idSchema,
  work_item_id: idSchema,
  work_item_code: z.string().min(1),
  work_item_title: z.string().min(1).max(256),
  work_item_href: z.string().min(1),
  objective_id: idSchema.optional(),
  objective_title: z.string().min(1).max(256).optional(),
  objective_progress_pct: z.number().int().min(0).max(100).optional(),
  budget_href: z.string().min(1).optional(),
  status: taskPlanStatusSchema,
  progress: z.object({
    completed: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
    label: z.string().min(1).max(32)
  }),
  roles: z.array(z.object({
    role: taskPlanItemRoleSchema,
    count: z.number().int().nonnegative()
  })),
  statuses: z.array(z.object({
    status: workItemAgentTeamItemStatusSchema,
    count: z.number().int().nonnegative()
  })),
  cost: z.object({
    used_cny: z.string(),
    budget_cny: z.string().optional(),
    burn_pct: z.number().int().nonnegative().optional()
  }),
  judge: z.object({
    passed: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
    pass_rate_pct: z.number().int().min(0).max(100)
  }),
  // 普通用户审查：分不清军团是刚在动还是卡死三天——卡上带最近活动时间。
  last_activity_at: isoDateTimeSchema.optional(),
  oldest_blocker: z.object({
    kind: z.enum(["needs_human", "budget", "stalled"]),
    label: z.string().min(1).max(128),
    age_seconds: z.number().int().nonnegative(),
    href: z.string().min(1).optional()
  }).optional(),
  updated_at: isoDateTimeSchema
});
export type AgentArmyDashboardPlanVM = z.infer<typeof agentArmyDashboardPlanVmSchema>;

export const agentArmyDashboardVmSchema = z.object({
  generated_at: isoDateTimeSchema,
  kpis: z.object({
    active_team_count: z.number().int().nonnegative(),
    waiting_decision_count: z.number().int().nonnegative(),
    today_cost_cny: z.string(),
    autonomy_rate_pct: z.number().int().min(0).max(100)
  }),
  plans: z.array(agentArmyDashboardPlanVmSchema).max(20),
  recent_escalations: z.array(z.object({
    id: idSchema,
    plan_id: idSchema.optional(),
    work_item_id: idSchema,
    title: z.string().min(1).max(128),
    reason_preview: z.string().min(1).max(200),
    created_at: isoDateTimeSchema,
    href: z.string().min(1)
  })).max(5),
  source_warnings: z.array(attentionSourceWarningSchema).optional(),
  page_info: z.object({
    plan_limit: z.number().int().positive(),
    returned: z.number().int().nonnegative(),
    plans_capped: z.boolean(),
    items_capped: z.boolean(),
    runs_capped: z.boolean(),
    escalation_limit: z.number().int().positive(),
    escalation_returned: z.number().int().nonnegative(),
    escalations_capped: z.boolean()
  }),
  empty_state: z.enum(["no_agent_armies"]).optional()
});
export type AgentArmyDashboardVM = z.infer<typeof agentArmyDashboardVmSchema>;

export const workItemDetailVmSchema = z.object({
  workitem: workItemSchema,
  // GH-2：所属项目名,供详情页头部「← 项目名」面包屑链接到 /projects/:id(工作项的 project_id 在 workitem 里)。
  project_name: z.string().min(1).optional(),
  acceptance: z.array(z.unknown()),
  agent_trace_preview: z.array(agentStepSchema),
  latest_proposal: deliverableChangeManifestSchema.optional(),
  accepted_deliverables: z.array(acceptedDeliverableVmSchema).default([]),
  evidence_refs: z.array(evidenceRefSchema),
  task_plan: taskPlanVmSchema.optional(),
  agent_team: workItemAgentTeamVmSchema.optional(),
  source_context: workItemSourceContextVmSchema.optional(),
  // R6（信任 high）：AI 对最近一次输出的置信评级——后端 confidenceRecords 早已按 run 落库，
  // 此前只透传 opaque 的 latest_confidence_id，最后一公里从未展示给审阅者。
  confidence: z.object({
    score: z.number().min(0).max(1),
    grade: z.string().min(1),
    verdict: z.enum(["auto_merge", "human_spotcheck", "escalate"])
  }).optional(),
  // R8（留痕）：本工作项上已决策的人工审批——「谁在什么时候批了/驳回了这一步」进详情页时间线。
  approval_decisions: z.array(z.object({
    id: idSchema,
    decision: z.string().min(1),
    reason_md: z.string().optional(),
    decided_at: isoDateTimeSchema
  })).default([]),
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
  // R6（信任 high）：跨 agent 复核(judge)的结构化裁决理由——与提议作者自写的 ai_reason 分开渲染。
  ai_review_md: z.string().optional(),
  expected_benefit: z.string().optional(),
  risk_label: z.string().optional(),
  manifest_changes: z.array(deliverableChangeSchema).default([]),
  checks: z.array(deliverableCheckSchema).default([]),
  conflicts: z.array(approvalConflictRowSchema).default([]),
  affected_targets: z.array(z.string()).default([]),
  timeline: z.array(approvalRoutingStepSchema).default([]),
  comments: z.array(approvalCommentVmSchema).default([]),
  comments_page_info: z.object({
    limit: z.number().int().positive(),
    returned: z.number().int().nonnegative(),
    has_more: z.boolean()
  }).optional()
});
export type ApprovalDetailVM = z.infer<typeof approvalDetailVmSchema>;

export const approvalCenterVmSchema = z.object({
  items: z.array(attentionItemSchema),
  requests: z.array(approvalRequestSchema),
  filters: z.record(z.string(), z.unknown()),
  counts: z.record(z.string(), z.number().int().nonnegative()),
  page_info: z.object({
    limit: z.number().int().positive(),
    offset: z.number().int().nonnegative().optional(),
    returned: z.number().int().nonnegative(),
    has_more: z.boolean()
  }).optional(),
  // 逐 item.id 的详情（预取，左栏点选时客户端就地切换；旧调用方默认空对象）。
  items_detail: z.record(z.string(), approvalDetailVmSchema).default({}),
  // R8（留痕）：最近已处理——审批一旦决策此前即从所有可达视图消失，无历史回看。
  decided: z.array(z.object({
    id: idSchema,
    title: z.string().min(1),
    decision: z.string().min(1),
    decided_by_label: z.string().min(1).optional(),
    reason_md: z.string().optional(),
    decided_at: isoDateTimeSchema
  })).default([])
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
    merge: actionSpecSchema.optional(),
    approve_hold: actionSpecSchema.optional()
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
  // R3（协作）：非管理员看不到分组卡且无说明——加 viewer_is_admin 让前端诚实解释。
  viewer_is_admin: z.boolean().optional(),
  by_task_plan: z.array(z.object({
    task_plan_id: idSchema,
    // R6（信任）：成本行可钻取到工作项详情（子任务/回放都在那），成本归因不再断在聚合层。
    work_item_id: idSchema.optional(),
    label: z.string().min(1).optional(),
    cost_cny: z.string(),
    tokens: z.number().int().nonnegative(),
    child_runs: z.number().int().nonnegative(),
    status: z.string().min(1).optional(),
    // B-R9.6 UX-H4：燃烧条数据——预算上限与已烧百分比（可 >100，渲染层截 100 画条、红字提示超限）。
    budget_cny: z.string().optional(),
    burn_pct: z.number().int().nonnegative().optional()
  })).default([]),
  by_objective: z.array(z.object({
    objective_id: idSchema,
    label: z.string().min(1).optional(),
    cost_cny: z.string(),
    tokens: z.number().int().nonnegative()
  })).default([]),
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
  // 普通用户审查（APPROVAL-POLICY-UI）：「以后同类审批自动通过」的常驻策略要能查看；
  // 管理员通过 revoke_href 撤销，服务端负责租户边界、软删除和审计。
  permission_policies: z.array(z.object({
    id: idSchema,
    action_pattern: z.string().min(1),
    effect: z.enum(["allow", "deny", "ask"]),
    learned_from_session: z.boolean(),
    created_at: isoDateTimeSchema,
    revoke_href: z.string().min(1)
  })).optional(),
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
    base_url_configured: z.boolean()
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
