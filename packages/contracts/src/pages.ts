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
  agentStepPhaseSchema,
  taskPlanItemRoleSchema,
  taskPlanItemStatusSchema,
  taskPlanStatusSchema,
  workItemStatusSchema
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
import { aiFeedbackVerdictSchema, AI_FEEDBACK_NOTE_MAX_CHARS } from "./domain/ai-feedback.js";
import {
  conversationListCursorVmSchema,
  conversationVmSchema,
  executionHintSchema
} from "./domain/conversation.js";
import { userMemoryCategorySchema } from "./domain/user-memory.js";
import { skillEditOpSchema, teamSkillStatusSchema, TEAM_SKILL_MAX_EDIT_OPS } from "./domain/team-skill.js";
import { githubActivityVmSchema } from "./domain/github.js";

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

// ── R14 批 MEM：记忆可见可治理（用户记忆 +团队技能 两个治理管理面 VM/请求契约）───────────────
// 出处三级降级的诚实结构（run join → proposal key 反解 → 诚实缺省）。缺省时整个 provenance 省略，
// 前端渲染「早期记录，出处不明」，绝不 null 或瞎编（见 03-mem-design §2.3）。
export const userMemoryProvenanceSchema = z.object({
  kind: z.enum(["agent_run", "review_correction"]),
  // 服务端拼好的诚实文案（会话/任务/审批意见来源）；前端直接展示。
  label: z.string().min(1).optional(),
  run_id: idSchema.optional(),
  conversation_id: idSchema.optional(),
  // proposal:<id> 反解出的 proposalId（仅文字说明，不承诺可深链）。
  proposal_id: z.string().min(1).optional()
});
export type UserMemoryProvenance = z.infer<typeof userMemoryProvenanceSchema>;

export const userMemoryManagementItemVmSchema = z.object({
  id: idSchema,
  category: userMemoryCategorySchema,
  key: z.string().min(1),
  value_md: z.string().min(1),
  confidence: z.number().min(0).max(1),
  // workspace_id !== null——区分工作区级记忆与遗留全局记忆（诚实反映作用域）。
  workspace_scoped: z.boolean(),
  created_at: isoDateTimeSchema,
  updated_at: isoDateTimeSchema,
  last_used_at: isoDateTimeSchema.optional(),
  // 人工编辑发生时间（edited_by_user_id 非空时）；前端据此叠加「最近由你于 X 修改」一行。
  edited_at: isoDateTimeSchema.optional(),
  provenance: userMemoryProvenanceSchema.optional()
});
export type UserMemoryManagementItemVM = z.infer<typeof userMemoryManagementItemVmSchema>;

export const userMemoryManagementPageVmSchema = z.object({
  generated_at: isoDateTimeSchema,
  memories: z.array(userMemoryManagementItemVmSchema),
  totals: z.object({
    active: z.number().int().nonnegative()
  })
});
export type UserMemoryManagementPageVM = z.infer<typeof userMemoryManagementPageVmSchema>;

// 团队技能管理面在既有消费页 VM 上补：id + content_md 全文 + status（含 deprecated 历史版本）+
// 停用元数据 + source_run_id（历史遗留列，恒 NULL 但诚实反映 schema，不替未来写路径打包票）。
export const teamSkillManagementItemVmSchema = teamSkillVmSchema.extend({
  id: idSchema,
  content_md: z.string().min(1),
  status: teamSkillStatusSchema,
  deprecated_reason: z.string().optional(),
  deprecated_at: isoDateTimeSchema.optional(),
  source_run_id: idSchema.optional()
});
export type TeamSkillManagementItemVM = z.infer<typeof teamSkillManagementItemVmSchema>;

export const teamSkillManagementPageVmSchema = z.object({
  generated_at: isoDateTimeSchema,
  skills: z.array(teamSkillManagementItemVmSchema)
});
export type TeamSkillManagementPageVM = z.infer<typeof teamSkillManagementPageVmSchema>;

// 用户记忆编辑请求：整段替换 + 乐观并发。value_md 上限 2000（宽松但防注入 worker prompt 时膨胀）——
// 服务端另做 looksLikeInjection 拦截 + 空白/超长 → 400（见 03-mem-design §2.1 与批次汇报的偏离说明）。
export const patchUserMemoryRequestSchema = z.object({
  value_md: z.string().min(1).max(2000),
  expected_updated_at: isoDateTimeSchema
});
export type PatchUserMemoryRequest = z.infer<typeof patchUserMemoryRequestSchema>;

// 团队技能编辑请求：K2 段落级受限编辑补丁（复用 skillEditOpSchema，不重定义），base_version 乐观并发。
export const patchTeamSkillRequestSchema = z.object({
  ops: z.array(skillEditOpSchema).min(1).max(TEAM_SKILL_MAX_EDIT_OPS),
  base_version: z.number().int().positive(),
  rationale_md: z.string().optional()
});
export type PatchTeamSkillRequest = z.infer<typeof patchTeamSkillRequestSchema>;

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
  // R13 批 P4（全托管透明度：reviewer_kind 溯源）：这份交付物是被谁复核通过并合并的——'ai'=批 4b
  // 全托管档自动合并（无人工复核），'human'=人工复核通过。缺省=没能推导出（历史数据/异常路径），
  // UI 据此保持沉默而不是瞎猜「已由 AI 自动合并」。
  reviewer_kind: z.enum(["human", "ai"]).optional(),
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
  // R14 FIX（通知深链缺 conversation_id）：additive——镜像 notification.ts 的 Notification.conversation_id。
  // 服务端从 target_href 的 `?conversation_id=` 查询参数解出来同一份 id（见
  // apps/api/src/services/notifications.ts 的 extractConversationIdFromTargetUrl，schedule-notify-pages.ts
  // 的 notificationItem() 复用它），暴露成结构化字段供 web 通知列表标注"这条通知关联一段会话讨论"，
  // 不用再让调用方自己解析 href 查询串。老通知/没有会话上下文的通知类型这个字段就不出现。
  conversation_id: idSchema.optional(),
  // R15 批 A（A2 提醒阶梯）：additive optional——镜像 notification.ts 的 Notification.next_remind_at/
  // reminder_count。桌面 spotlight 通知视图 + web 通知页据 next_remind_at 非空渲「暂停提醒」轻按钮
  // （POST /api/notifications/:id/snooze 置空即抑制 24h 叮嘱）。不进阶梯的通知类型这两个字段不出现。
  next_remind_at: isoDateTimeSchema.optional(),
  reminder_count: z.number().int().nonnegative().optional(),
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
  empty_state: z.enum(["no_open_work"]).optional(),
  // R14 批 GH（07-gh-design.md §5.1）：GitHub 活动展示切片，additive/optional——省略时表示"没绑定
  // repo 或绑定了但暂无活动"，不是渲染空列表/占位区块（诚实缺省，同 army/empty_state 的手法）。
  // 取数失败同样降级为省略，不拖垮整个项目主页（照 army pill 的 try/catch 静默降级）。
  github_activities: z.array(githubActivityVmSchema).optional()
});
export type ProjectHomePageVM = z.infer<typeof projectHomePageVmSchema>;

// R15 批 E1（项目时间线 / 甘特）：里程碑 VM——CRUD 端点与时间线 VM 共用这一形状。due_at 可空
// （里程碑可先建后定期）；status 只有 open/done。
export const projectMilestoneVmSchema = z.object({
  id: idSchema,
  project_id: idSchema,
  title: z.string().min(1),
  due_at: isoDateTimeSchema.nullable(),
  sort: z.number().int().nonnegative(),
  status: z.enum(["open", "done"])
});
export type ProjectMilestoneVM = z.infer<typeof projectMilestoneVmSchema>;

// R15 批 E1c：时间线（甘特）VM——里程碑 + 排期条 + 关键路径。纯读，无写副作用。
export const timelineWorkItemVmSchema = z.object({
  id: idSchema,
  code: z.string().min(1),
  title: z.string().min(1),
  status: workItemStatusSchema,
  start_at: isoDateTimeSchema.optional(),
  due_at: isoDateTimeSchema.optional(),
  // 只在工作项已被认领时带（user_id + 展示名）；未认领项前端标「未指派」。
  assignee: z.object({ user_id: idSchema, label: z.string().min(1) }).optional(),
  milestone_id: idSchema.optional(),
  // 该项依赖的（同项目、可见）工作项 id 列表。
  depends_on: z.array(idSchema),
  // 直接 + 传递阻塞的未完成项数（全图真实计数）；overdue = 逾期未完成。
  blocks_count: z.number().int().nonnegative(),
  overdue: z.boolean(),
  // E1d OKR 挂钩：仅当该工作项挂了目标时出现。
  objective_ids: z.array(idSchema).optional(),
  // G4 #36：与 objective_ids 一一对应的目标标题（服务端 join listObjectiveTitlesByIds 得到；未命中的
  // 目标回落成 id，保证长度与 objective_ids 一致）。additive/optional——旧 fixture 或取名失败时省略，
  // 前端回落到显示裸 id（见 route-components / 桌面 timeline 的 OKR pill）。
  objective_titles: z.array(z.string().min(1)).optional()
});
export type TimelineWorkItemVM = z.infer<typeof timelineWorkItemVmSchema>;

export const timelineBlockingRefVmSchema = z.object({
  work_item_id: idSchema,
  blocks_count: z.number().int().positive()
});
export type TimelineBlockingRefVM = z.infer<typeof timelineBlockingRefVmSchema>;

export const projectTimelinePageVmSchema = z.object({
  generated_at: isoDateTimeSchema,
  project: z.object({
    id: idSchema,
    name: z.string().min(1),
    slug: z.string().min(1)
  }),
  milestones: z.array(projectMilestoneVmSchema),
  items: z.array(timelineWorkItemVmSchema),
  // 关键路径 MVP：blocking = 阻塞≥1 件未完成的项（按阻塞数倒序）；overdue_blocking = 其中逾期的
  //（「这件卡在你这里，后面 N 件在等」的数据源）。
  critical: z.object({
    blocking: z.array(timelineBlockingRefVmSchema),
    overdue_blocking: z.array(timelineBlockingRefVmSchema)
  }),
  // 时间线取数触顶（超大项目）时置真，供前端提示「仅显示前 N 项」。
  capped: z.boolean().optional(),
  empty_state: z.enum(["no_work_items"]).optional()
});
export type ProjectTimelinePageVM = z.infer<typeof projectTimelinePageVmSchema>;

const workbenchMembershipRoleSchema = z.enum(["member", "admin", "owner"]);
const workbenchConversationPageVmSchema = z
  .object({
    conversations: z.array(conversationVmSchema).max(50),
    capped: z.boolean(),
    next_cursor: conversationListCursorVmSchema.nullable()
  })
  .strict()
  .superRefine((page, ctx) => {
    if (page.capped !== (page.next_cursor !== null)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["next_cursor"],
        message: "workbench conversation cursor must be present exactly when the page is capped"
      });
    }
  });

const workbenchMemberVmSchema = z
  .object({
    user_id: idSchema,
    nickname: z.string().min(1),
    membership_role: workbenchMembershipRoleSchema,
    is_project_owner: z.boolean(),
    is_self: z.boolean()
  })
  .strict();

const workbenchRecentProjectFileVmSchema = z
  .object({
    id: idSchema,
    name: z.string().min(1),
    updated_at: isoDateTimeSchema,
    href: z.string().min(1)
  })
  .strict();

export const workbenchPageVmSchema = z
  .object({
    generated_at: isoDateTimeSchema,
    project: z
      .object({
        id: idSchema,
        workspace_id: idSchema,
        name: z.string().min(1),
        slug: z.string().min(1),
        description: z.string().nullable(),
        owner_label: z.string().min(1)
      })
      .strict(),
    viewer: z
      .object({
        user_id: idSchema,
        membership_role: workbenchMembershipRoleSchema,
        is_project_owner: z.boolean()
      })
      .strict(),
    conversations: workbenchConversationPageVmSchema,
    workspace_members: z
      .object({
        scope: z.literal("workspace"),
        total: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
        returned: z.number().int().nonnegative().max(100),
        capped: z.boolean(),
        items: z.array(workbenchMemberVmSchema).max(100)
      })
      .strict(),
    army_summary: z
      .object({
        active_plan_count: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
        empty_state: z.literal("no_active_armies").optional()
      })
      .strict(),
    recent_project_files: z
      .object({
        items: z.array(workbenchRecentProjectFileVmSchema).max(5),
        empty_state: z.literal("no_recent_files").optional()
      })
      .strict()
  })
  .strict()
  .superRefine((page, ctx) => {
    const mainCount = page.conversations.conversations.filter((conversation) => conversation.kind === "main").length;
    if (mainCount !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["conversations", "conversations"],
        message: "workbench must contain exactly one main conversation"
      });
    }
    for (const [index, conversation] of page.conversations.conversations.entries()) {
      if (conversation.project_id !== page.project.id) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["conversations", "conversations", index, "project_id"],
          message: "workbench conversation project must match the page project"
        });
      }
      if (conversation.workspace_id !== page.project.workspace_id) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["conversations", "conversations", index, "workspace_id"],
          message: "workbench conversation workspace must match the page project workspace"
        });
      }
    }

    const members = page.workspace_members;
    if (members.returned !== members.items.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["workspace_members", "returned"],
        message: "returned member count must equal the returned item length"
      });
    }
    if (members.total < members.returned) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["workspace_members", "total"],
        message: "total member count cannot be smaller than returned"
      });
    }
    if (members.capped !== (members.total > members.returned)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["workspace_members", "capped"],
        message: "member capped flag must exactly reflect total greater than returned"
      });
    }
    const selfMembers = members.items.filter((member) => member.is_self);
    if (selfMembers.length !== 1 || members.items[0]?.is_self !== true) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["workspace_members", "items"],
        message: "workbench members must contain exactly one self row ordered first"
      });
    }
    const self = selfMembers[0];
    if (self && (
      self.user_id !== page.viewer.user_id
      || self.membership_role !== page.viewer.membership_role
      || self.is_project_owner !== page.viewer.is_project_owner
    )) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["viewer"],
        message: "workbench viewer must match the returned self member row"
      });
    }
    if (members.items.filter((member) => member.is_project_owner).length > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["workspace_members", "items"],
        message: "workbench members may contain at most one project owner"
      });
    }

    const armyIsEmpty = page.army_summary.active_plan_count === 0;
    if (armyIsEmpty !== (page.army_summary.empty_state === "no_active_armies")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["army_summary", "empty_state"],
        message: "army empty state must be present exactly when there are no active plans"
      });
    }
    const filesAreEmpty = page.recent_project_files.items.length === 0;
    if (filesAreEmpty !== (page.recent_project_files.empty_state === "no_recent_files")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["recent_project_files", "empty_state"],
        message: "recent-file empty state must be present exactly when there are no files"
      });
    }
  });
export type WorkbenchPageVM = z.infer<typeof workbenchPageVmSchema>;

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
// R13 批 P4（观察者工单来源标注）：与 drive_comment/meeting_insight 平级的第三种来源——
// 会话观察者（Cuu）自动创建的工单，来源是项目群聊会话而不是网盘评论/会议纪要。没有 web 端可达的
// 会话深链（桌面优先战略，web 无群聊 UI），故不带 href——只人话标注「由哪场会话创建」。
export const observerWorkItemSourceContextVmSchema = z.object({
  source_type: z.literal("conversation_observer"),
  project_id: idSchema.optional(),
  conversation_id: idSchema,
  created_at: isoDateTimeSchema
});
export const workItemSourceContextVmSchema = z.discriminatedUnion("source_type", [
  driveWorkItemSourceContextVmSchema,
  meetingWorkItemSourceContextVmSchema,
  observerWorkItemSourceContextVmSchema
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
    autonomy_rate_pct: z.number().int().min(0).max(100),
    // R13 批 P4（KPI：AI 自动合并数/占比）——与 cost 页 ai_auto_merge 同源同口径（今日通过评审里
    // reviewer_kind=ai 的计数/占比）。缺省=取数失败或非管理员，不当 0% 端出去。
    ai_auto_merge_count: z.number().int().nonnegative().optional(),
    ai_auto_merge_ratio_pct: z.number().int().min(0).max(100).optional()
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
  })),
  // R14 批 FEEDBACK：本人对这个提议的二值反馈 + 服务端算好的动作 href（客户端只管渲染点击，照
  // review_actions「服务端算好 href/method」的既有风格）。additive optional——存量客户端不认识这个键
  // 读旧响应零回归。mark_useful/mark_not_useful 用固定 request_json 覆盖「无备注」主路径；clear 只在
  // 已有判定时出现（撤销反馈）。my_verdict/my_note 反映当前 actor 的现状（读聚合只读自己，见设计 §3）。
  feedback: z.object({
    my_verdict: aiFeedbackVerdictSchema.nullable(),
    my_note: z.string().max(AI_FEEDBACK_NOTE_MAX_CHARS).nullable(),
    mark_useful: actionSpecSchema,
    mark_not_useful: actionSpecSchema,
    clear: actionSpecSchema.optional()
  }).optional()
});
export type ProposalDetailVM = z.infer<typeof proposalDetailVmSchema>;

// R16-W3（变更编辑器）：一份提议里某个变动文件的「base vs proposed」逐行 tracked-changes 视图。
// 语义映射到 P-COLLAB：base=本次运行起点快照里的该文件（读不到则 base_available=false，编辑器诚实降级
// 成「仅显示提议内容」不冒充全绿新增），proposed=manifest change 的 machine_summary.generated_content_md。
// segments 按顺序摊平（context/del/add），diff 由 contracts 的 trackedTextSegments 唯一产出，前后端共享。
export const proposalChangeDiffSegmentSchema = z.object({
  type: z.enum(["context", "add", "del"]),
  lines: z.array(z.string())
});
export type ProposalChangeDiffSegment = z.infer<typeof proposalChangeDiffSegmentSchema>;

export const proposalChangeDiffVmSchema = z.object({
  proposal_id: idSchema,
  change_id: idSchema,
  path: z.string(),
  filename: z.string().min(1),
  change_type: z.enum(["created", "updated", "deleted", "renamed", "moved", "replaced", "generated"]),
  status: z.enum(["opened", "reviewed", "merged", "rejected"]),
  title: z.string().min(1),
  // false = 改动前版本没能从快照读出来（历史提议/快照已清理/非文本）——编辑器据此渲染「无法比对改动前
  // 版本，仅显示提议内容」而不是把整份 proposed 当成全新增。created 变更 base 天然为空，仍为 true。
  base_available: z.boolean(),
  // proposed 或 base 任一超字符/行数上限被截断——诚实标注，不假装是完整全文比对。
  truncated: z.boolean(),
  segments: z.array(proposalChangeDiffSegmentSchema)
});
export type ProposalChangeDiffVM = z.infer<typeof proposalChangeDiffVmSchema>;

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
  // R13 批 P4（全托管透明度 D：labor-split 按 assignee 记账）：与上面 labor_split（生产/自进化维度）
  // 是两个正交的分账——这条是「这笔钱是哪个执行者干活花的」。user_id 缺省=「系统」桶（无 run 关联的账目，
  // 如夜间技能蒸馏，或历史上未挂 run 的账目）。仅管理员可见（与 by_user/by_team/by_workitem 同门槛——
  // 暴露的是同组织其他成员的花费）。按花费降序，封顶（见 apps/api 组装处的 cap）。
  by_assignee: z.array(z.object({
    user_id: idSchema.optional(),
    label: z.string().min(1),
    cost_cny: z.string(),
    tokens: z.number().int().nonnegative(),
    run_count: z.number().int().nonnegative()
  })).default([]),
  // R13 批 P4（KPI：AI 自动合并数/占比）：今日「通过」类评审里，reviewer_kind=ai 的那部分——
  // 批 4b 全托管档（第 5 模式）AI 复核通过并立刻自己合并的次数。count/ratio_pct 都缺省=当日无任何通过评审
  // （不是「AI 从未自动合并过」，是「今天没有可比对的分母」，UI 应区分空数据与 0%）。仅管理员可见。
  ai_auto_merge: z.object({
    count: z.number().int().nonnegative(),
    ratio_pct: z.number().int().min(0).max(100)
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

// ---------------------------------------------------------------------------
// R12 批 5(军团面板,服务端读侧切片) —— 00-interaction-design.md §4 + 02-construction-plan.md 批 5。
// 只读:会话情境面板(军团/输出/后台任务三区)与跨项目军团总览。派发写路径不在这批范围内。
// ---------------------------------------------------------------------------

export const armyRunRecentStepVmSchema = z
  .object({
    phase: agentStepPhaseSchema,
    tool_name: z.string().max(64).nullable(),
    output_excerpt: z.string().max(240).nullable(),
    step_no: z.number().int().positive()
  })
  .strict();
export type ArmyRunRecentStepVM = z.infer<typeof armyRunRecentStepVmSchema>;

// 与 domain/conversation.ts 里未导出的 nonnegativeCnySchema 同一形状；cost_cny 在 run 还没有任何计费
// 记录时可以是 null（区别于 "0"，避免把「还没花钱」和「已知花了 0 元」混为一谈）。
const armyRunCostCnySchema = z.string().regex(/^\d+(?:\.\d+)?$/u).nullable();

// goal_summary 上限 = 仓库层 GOAL_SUMMARY_MAX_LENGTH(200)+ 1 个省略号字符。
const armyRunCardBaseShape = {
  id: idSchema,
  status: agentRunStatusSchema,
  goal_summary: z.string().min(1).max(201),
  assignee_user_id: idSchema.nullable(),
  cost_cny: armyRunCostCnySchema,
  execution_hint: executionHintSchema,
  work_item_id: idSchema,
  source_conversation_id: idSchema.nullable(),
  source_action_card_item_id: idSchema.nullable(),
  // 猫仔代号(packages/contracts/src/domain/cat-codename.ts 的 catCodename(id))——纯展示，词表最长的
  // 中文猫名是两个字，16 留足未来扩表的余量。
  cat_codename: z.string().min(1).max(16),
  recent_step: armyRunRecentStepVmSchema.nullable(),
  created_at: isoDateTimeSchema,
  updated_at: isoDateTimeSchema
} as const;

function assertArmyRunSourceLineage(
  card: { source_action_card_item_id: string | null; source_conversation_id: string | null },
  ctx: z.RefinementCtx
) {
  if (card.source_action_card_item_id && !card.source_conversation_id) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["source_conversation_id"],
      message: "a run sourced from an action-card item must also carry its source conversation"
    });
  }
}

export const armyRunCardVmSchema = z.object(armyRunCardBaseShape).strict().superRefine(assertArmyRunSourceLineage);
export type ArmyRunCardVM = z.infer<typeof armyRunCardVmSchema>;

// 军团总览额外带 project_id/project_name——00 文档§4「点开是按项目分组的同款卡片流」。
export const armyOverviewRunCardVmSchema = z
  .object({
    ...armyRunCardBaseShape,
    project_id: idSchema,
    project_name: z.string().min(1).max(128)
  })
  .strict()
  .superRefine(assertArmyRunSourceLineage);
export type ArmyOverviewRunCardVM = z.infer<typeof armyOverviewRunCardVmSchema>;

const armyRunCursorTimestampSchema = isoDateTimeSchema.regex(
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/u,
  "army run cursor timestamp must be canonical UTC with six fractional digits"
);

export const armyRunListCursorVmSchema = z
  .object({
    after_created_at: armyRunCursorTimestampSchema,
    after_id: idSchema
  })
  .strict();
export type ArmyRunListCursorVM = z.infer<typeof armyRunListCursorVmSchema>;

// 请求侧查询参数(同一形状复用给会话情境面板与军团总览两个 GET 端点)——沿用 conversationListQuerySchema
// 的 afterCreatedAt/afterId/limit 惯例，cap 收紧到仓库层的 20/50(而不是会话列表的 50/100)。
export const armyRunListQuerySchema = z
  .object({
    afterCreatedAt: armyRunCursorTimestampSchema.optional(),
    afterId: idSchema.optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20)
  })
  .strict()
  .superRefine((value, ctx) => {
    if ((value.afterCreatedAt === undefined) !== (value.afterId === undefined)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: value.afterCreatedAt === undefined ? ["afterCreatedAt"] : ["afterId"],
        message: "army run list cursor requires both afterCreatedAt and afterId"
      });
    }
  });
export type ArmyRunListQuery = z.infer<typeof armyRunListQuerySchema>;

function buildArmyRunListVmSchema<TCard extends z.ZodTypeAny>(cardSchema: TCard) {
  return z
    .object({
      runs: z.array(cardSchema).max(50),
      capped: z.boolean(),
      next_cursor: armyRunListCursorVmSchema.nullable(),
      empty_state: z.literal("no_army_runs").optional()
    })
    .strict()
    .superRefine((page, ctx) => {
      if (page.capped !== (page.next_cursor !== null)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["next_cursor"],
          message: "army run list cursor must be present exactly when the page is capped"
        });
      }
      const isEmpty = (page.runs as unknown[]).length === 0;
      if (isEmpty !== (page.empty_state === "no_army_runs")) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["empty_state"],
          message: "army run list empty state must be present exactly when there are no runs"
        });
      }
    });
}

export const conversationArmyRunListVmSchema = buildArmyRunListVmSchema(armyRunCardVmSchema);
export type ConversationArmyRunListVM = z.infer<typeof conversationArmyRunListVmSchema>;

export const armyOverviewRunListVmSchema = buildArmyRunListVmSchema(armyOverviewRunCardVmSchema);
export type ArmyOverviewRunListVM = z.infer<typeof armyOverviewRunListVmSchema>;

// R13 批 P1.5（右栏变动文件区）：同一份提议 diff_stats_json 的 per-file 明细在 VM 上的形状——
// 历史 proposal（还没跑过 estimateDeliverableDiffStats 持久化）整个 changed_files 字段不出现，
// 前端诚实展示"改动详情不可用"；单条文件缺 adds/dels 同样表示"这条改动没能计入统计"，不是 0
// （见 apps/api/src/services/deliverable-diff-stats.ts 的踩雷注释）。change_type 复用
// deliverableChangeSchema 的既有枚举，不重复定义一份可能漂移的字面量列表。
export const armyChangedFileVmSchema = z
  .object({
    path: z.string().max(512).optional(),
    change_type: deliverableChangeSchema.shape.change_type,
    adds: z.number().int().nonnegative().optional(),
    dels: z.number().int().nonnegative().optional()
  })
  .strict();
export type ArmyChangedFileVM = z.infer<typeof armyChangedFileVmSchema>;

// 输出区 = 该会话下这些 run 产出的提议链接聚合(00 §4「点击回跳」同款思路，复用既有 /proposals/:id 详情页，
// 不新开路由)。
export const armyOutputLinkVmSchema = z
  .object({
    proposal_id: idSchema,
    work_item_id: idSchema,
    run_id: idSchema,
    title: z.string().min(1).max(256),
    status: z.string().min(1).max(32),
    proposal_href: z.string().min(1),
    updated_at: isoDateTimeSchema,
    // R13 批 P1.5：可选——旧 proposal/没有统计过的行整体不带这个字段，见 armyChangedFileVmSchema 注释。
    changed_files: z.array(armyChangedFileVmSchema).max(20).optional()
  })
  .strict();
export type ArmyOutputLinkVM = z.infer<typeof armyOutputLinkVmSchema>;

export const armyOutputsVmSchema = z
  .object({
    items: z.array(armyOutputLinkVmSchema).max(50),
    capped: z.boolean()
  })
  .strict();
export type ArmyOutputsVM = z.infer<typeof armyOutputsVmSchema>;

// 后台任务区:02-construction-plan.md 批 5 节原话——「后台任务只有在本批补齐/确认真实 scheduled-task
// 数据模型与项目归属后才可加入，不得拿 background_jobs、schedule events 或项目最近文件冒充」。这批没有
// 这样一个数据源，所以这个区永远是空数组 + 固定的 not_yet_available，诚实地告诉前端「这块还没接」，
// 而不是拿别的数据伪装。等真数据源接上后再放开 items 的 schema。
export const armyBackgroundTasksVmSchema = z
  .object({
    items: z.array(z.unknown()).max(0),
    empty_state: z.literal("not_yet_available")
  })
  .strict();
export type ArmyBackgroundTasksVM = z.infer<typeof armyBackgroundTasksVmSchema>;

export const conversationArmyPanelVmSchema = z
  .object({
    generated_at: isoDateTimeSchema,
    conversation_id: idSchema,
    project_id: idSchema,
    runs: conversationArmyRunListVmSchema,
    outputs: armyOutputsVmSchema,
    background_tasks: armyBackgroundTasksVmSchema
  })
  .strict()
  .superRefine((page, ctx) => {
    for (const [index, run] of page.runs.runs.entries()) {
      if (run.source_conversation_id && run.source_conversation_id !== page.conversation_id) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["runs", "runs", index, "source_conversation_id"],
          message: "conversation army run must be sourced from the panel's own conversation"
        });
      }
    }
  });
export type ConversationArmyPanelVM = z.infer<typeof conversationArmyPanelVmSchema>;

export const armyOverviewPageVmSchema = z
  .object({
    generated_at: isoDateTimeSchema,
    viewer_user_id: idSchema,
    runs: armyOverviewRunListVmSchema
  })
  .strict();
export type ArmyOverviewPageVM = z.infer<typeof armyOverviewPageVmSchema>;

// R17 G3（#8 军团后台任务区接真 · 拍板 B）：军团面板「后台任务」区此前契约锁死 not_yet_available 永远空
// （见上 armyBackgroundTasksVmSchema 注释——那块仍保留，用于会话情境面板旧字段的向后兼容）。真实的 pulse
// 统一调度器（审批 SLA / 通知提醒 / 审批 digest / 追 DDL / 关怀）与主动性投递（proactive_intents）一直在跑
// 却完全不可见。GET /api/army/background 把两块摆上台面：
//   * scheduler —— pulse 调度器的每任务运行统计（name/间隔/上次 tick/tick 计数/跳过计数/错误计数）。这是
//     进程级心跳，不含任何工作区/用户数据、不含错误文本（last_error_message 有意不进 VM，避免把内部错误
//     细节泄漏给普通成员），任何已登录工作区成员都可看。enabled=false 表示总开关（PULSE_SCHEDULER_ENABLED）
//     未开，tasks 为空。
//   * proactive —— 最近投向【当前用户】的主动性动态（listRecentProactiveIntentsForUser 的 workspace+target_user
//     双重收窄口径，见该仓库函数注释）。delivered/suppressed 都展示，诚实反映「机器动过 / 克制住了」。
// 定时任务区永不为「空态谎言」：enabled=true 但 tasks 空只会发生在还没注册任何任务的极端情况；proactive
// 空数组是诚实的「最近没有主动性投向你」。
export const armyBackgroundSchedulerTaskVmSchema = z
  .object({
    name: z.string().min(1).max(64),
    interval_ms: z.number().int().nonnegative(),
    running: z.boolean(),
    tick_count: z.number().int().nonnegative(),
    skipped_count: z.number().int().nonnegative(),
    error_count: z.number().int().nonnegative(),
    last_tick_at: isoDateTimeSchema.nullable()
  })
  .strict();
export type ArmyBackgroundSchedulerTaskVM = z.infer<typeof armyBackgroundSchedulerTaskVmSchema>;

export const armyBackgroundProactiveItemVmSchema = z
  .object({
    id: idSchema,
    kind: z.string().min(1).max(64),
    stage: z.string().min(1).max(64).nullable(),
    status: z.enum(["delivered", "suppressed"]),
    delivered_via: z.string().min(1).max(64).nullable(),
    created_at: isoDateTimeSchema
  })
  .strict();
export type ArmyBackgroundProactiveItemVM = z.infer<typeof armyBackgroundProactiveItemVmSchema>;

export const armyBackgroundPageVmSchema = z
  .object({
    generated_at: isoDateTimeSchema,
    scheduler: z
      .object({
        enabled: z.boolean(),
        tasks: z.array(armyBackgroundSchedulerTaskVmSchema).max(32)
      })
      .strict(),
    proactive: z
      .object({
        items: z.array(armyBackgroundProactiveItemVmSchema).max(10),
        capped: z.boolean()
      })
      .strict()
  })
  .strict();
export type ArmyBackgroundPageVM = z.infer<typeof armyBackgroundPageVmSchema>;
