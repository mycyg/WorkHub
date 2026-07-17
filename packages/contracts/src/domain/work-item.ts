import { z } from "zod";

import {
  confidenceGradeSchema,
  workItemModeSchema,
  workItemPrioritySchema,
  workItemStatusSchema
} from "../enums.js";
import { idSchema, isoDateTimeSchema, timestampFieldsSchema } from "./common.js";

export const projectSchema = timestampFieldsSchema.extend({
  id: idSchema,
  workspace_id: idSchema.optional(),
  name: z.string().min(1).max(128),
  slug: z.string().min(1).max(64),
  description: z.string().optional(),
  owner_nickname: z.string().min(1).max(64),
  owner_user_id: idSchema.optional(),
  archived: z.boolean(),
  deleted_at: isoDateTimeSchema.optional(),
  deleted_by_nickname: z.string().max(64).optional(),
  next_seq: z.number().int().nonnegative()
});
export type Project = z.infer<typeof projectSchema>;

export const workItemSchema = timestampFieldsSchema.extend({
  id: idSchema,
  code: z.string().min(1).max(64),
  project_id: idSchema,
  workspace_id: idSchema.optional(),
  submitter_user_id: idSchema,
  claimed_by_user_id: idSchema.optional(),
  claimed_by_nickname: z.string().max(64).optional(),
  title: z.string().max(256).optional(),
  raw_description: z.string().optional(),
  summary_md: z.string().optional(),
  status: workItemStatusSchema,
  priority: workItemPrioritySchema,
  estimate_hours: z.number().optional(),
  estimate_confidence: confidenceGradeSchema.optional(),
  planning_note: z.string().optional(),
  start_at: isoDateTimeSchema.optional(),
  due_at: isoDateTimeSchema.optional(),
  source_meeting_id: idSchema.optional(),
  source_work_item_id: idSchema.optional(),
  claimed_at: isoDateTimeSchema.optional(),
  done_at: isoDateTimeSchema.optional(),
  delivered_at: isoDateTimeSchema.optional(),
  delivery_doc_ready_at: isoDateTimeSchema.optional(),
  accepted_at: isoDateTimeSchema.optional(),
  sync_state: z.enum(["pending", "synced", "failed"]),
  version: z.number().int().nonnegative(),
  mode: workItemModeSchema,
  human_reserved: z.boolean(),
  current_spec_id: idSchema.optional(),
  main_branch_id: idSchema.optional(),
  latest_confidence_id: idSchema.optional(),
  deleted_at: isoDateTimeSchema.optional(),
  deleted_by_user_id: idSchema.optional()
});
export type WorkItem = z.infer<typeof workItemSchema>;

export const cuuLauncherDeliveryKindSchema = z.enum([
  "document_draft",
  "structured_data",
  "code_template",
  "ai_decide"
]);
export type CuuLauncherDeliveryKind = z.infer<typeof cuuLauncherDeliveryKindSchema>;

export const cuuLauncherRiskHintSchema = z.enum(["low", "medium", "high"]);
export type CuuLauncherRiskHint = z.infer<typeof cuuLauncherRiskHintSchema>;

export const cuuLauncherSpecOptionSchema = z.object({
  id: z.string().min(1).max(64),
  label: z.string().min(1).max(128).optional(),
  description: z.string().min(1).max(300).optional(),
  delivery_kind: cuuLauncherDeliveryKindSchema,
  risk_hint: cuuLauncherRiskHintSchema,
  default_acceptance: z.array(z.string().min(1).max(256)).max(8)
});
export type CuuLauncherSpecOption = z.infer<typeof cuuLauncherSpecOptionSchema>;

export const cuuLauncherWorkItemSpecSchema = z.object({
  source: z.literal("cuu_desktop_launcher"),
  selected_options: z.array(cuuLauncherSpecOptionSchema).max(10)
});
export type CuuLauncherWorkItemSpec = z.infer<typeof cuuLauncherWorkItemSpecSchema>;

export const defaultCuuLauncherSpecOptions = {
  "document-draft": {
    id: "document-draft",
    label: "文档/方案草稿",
    description: "适合周报、方案、说明书、PR 式变更说明。",
    delivery_kind: "document_draft",
    risk_hint: "low",
    default_acceptance: [
      "输出可审阅的文档或方案草稿，包含结构、正文和后续修改点。",
      "标明依据、假设和待确认内容，不把未确认内容写成事实。"
    ]
  },
  "structured-data": {
    id: "structured-data",
    label: "结构化数据",
    description: "适合 JSON、YAML、CSV、配置或表格分析。",
    delivery_kind: "structured_data",
    risk_hint: "low",
    default_acceptance: [
      "输出结构化文件或表格，包含字段说明、样例和校验方式。",
      "保留数据来源、转换规则和异常项说明。"
    ]
  },
  "code-template": {
    id: "code-template",
    label: "小型代码/模板",
    description: "适合低风险代码片段、模板或配置改动。",
    delivery_kind: "code_template",
    risk_hint: "medium",
    default_acceptance: [
      "输出可运行的小型代码或模板，包含入口、使用说明和验证命令。",
      "列出改动范围、风险点和回滚方式。"
    ]
  },
  "let-ai-decide": {
    id: "let-ai-decide",
    label: "让 AI 判断",
    description: "按证据和风险选择最稳的交付路径。",
    delivery_kind: "ai_decide",
    risk_hint: "low",
    default_acceptance: [
      "根据上下文选择最稳交付形态，并说明选择理由。",
      "输出可审阅结果和后续验收步骤。"
    ]
  }
} satisfies Record<string, CuuLauncherSpecOption>;

export function cuuLauncherSpecFromSelectedOptionIds(
  optionIds: readonly string[] | undefined
): CuuLauncherWorkItemSpec | undefined {
  const selectedOptions: CuuLauncherSpecOption[] = [];
  const seen = new Set<string>();
  for (const optionId of optionIds ?? []) {
    const spec = defaultCuuLauncherSpecOptions[optionId as keyof typeof defaultCuuLauncherSpecOptions];
    if (!spec || seen.has(spec.id)) {
      continue;
    }
    selectedOptions.push({ ...spec, default_acceptance: [...spec.default_acceptance] });
    seen.add(spec.id);
  }
  return selectedOptions.length
    ? {
        source: "cuu_desktop_launcher",
        selected_options: selectedOptions
      }
    : undefined;
}

export const createWorkItemRequestSchema = z
  .object({
    session_id: idSchema.optional(),
    project_id: idSchema.optional(),
    title: z.string().min(1).max(256).optional(),
    raw_description: z.string().min(1).optional(),
    selected_option_ids: z.array(z.string().min(1)).optional(),
    free_text: z.string().trim().max(1000).optional(),
    cuu_launcher_spec: cuuLauncherWorkItemSpecSchema.optional(),
    kickoff_agent: z.boolean().optional()
  })
  .superRefine((payload, ctx) => {
    if (!payload.session_id && !payload.title && !payload.raw_description) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "create work item requires a session, title, or raw description"
      });
    }
  });
export type CreateWorkItemRequest = z.infer<typeof createWorkItemRequestSchema>;

export const assignmentSchema = timestampFieldsSchema.extend({
  id: idSchema,
  work_item_id: idSchema,
  user_id: idSchema,
  role: z.enum(["lead", "collaborator"]),
  assigned_by_user_id: idSchema
});
export type Assignment = z.infer<typeof assignmentSchema>;

export const acceptanceCriteriaSchema = timestampFieldsSchema.extend({
  id: idSchema,
  work_item_id: idSchema,
  title: z.string().min(1).max(256),
  description: z.string().optional(),
  status: z.enum(["open", "met", "unmet", "waived"]),
  sort_order: z.number().int(),
  source_plan_id: idSchema.optional()
});
export type AcceptanceCriteria = z.infer<typeof acceptanceCriteriaSchema>;

// R20 P2A（R19-18 指派/认领）：把一个工作项显式指派给某工作区成员。role 省略默认 collaborator；
// 角色枚举与 work_item_assignments.role / assignmentSchema 同源（lead/collaborator）。
export const assignWorkItemRequestSchema = z
  .object({
    assignee_user_id: idSchema,
    role: z.enum(["lead", "collaborator"]).optional()
  })
  .strict();
export type AssignWorkItemRequest = z.infer<typeof assignWorkItemRequestSchema>;

export const assignWorkItemResultSchema = z.object({
  assignment: assignmentSchema
});
export type AssignWorkItemResult = z.infer<typeof assignWorkItemResultSchema>;

// R20 P2A：认领端点无请求体（当前登录用户认领这个无主工作项）。响应回落地后的认领人。
export const claimWorkItemResultSchema = z.object({
  work_item_id: idSchema,
  claimed_by_user_id: idSchema
});
export type ClaimWorkItemResult = z.infer<typeof claimWorkItemResultSchema>;

// R20 P2A（R19-22 工作项评论）：通用 comments 表（work_item_id + author_nickname + body）的读写视图。
export const WORK_ITEM_COMMENT_MAX_CHARS = 4000;

export const workItemCommentSchema = timestampFieldsSchema.extend({
  id: idSchema,
  work_item_id: idSchema,
  author_nickname: z.string().min(1).max(64),
  body: z.string().min(1)
});
export type WorkItemComment = z.infer<typeof workItemCommentSchema>;

export const workItemCommentsResultSchema = z.object({
  work_item_id: idSchema,
  comments: z.array(workItemCommentSchema)
});
export type WorkItemCommentsResult = z.infer<typeof workItemCommentsResultSchema>;

export const createWorkItemCommentRequestSchema = z
  .object({
    body: z.string().trim().min(1).max(WORK_ITEM_COMMENT_MAX_CHARS)
  })
  .strict();
export type CreateWorkItemCommentRequest = z.infer<typeof createWorkItemCommentRequestSchema>;
