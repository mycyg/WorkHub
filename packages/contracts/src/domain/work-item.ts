import { z } from "zod";

import {
  confidenceGradeSchema,
  workItemModeSchema,
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
  priority: z.string().max(16),
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

export const createWorkItemRequestSchema = z
  .object({
    session_id: idSchema.optional(),
    project_id: idSchema.optional(),
    title: z.string().min(1).max(256).optional(),
    raw_description: z.string().min(1).optional(),
    selected_option_ids: z.array(z.string().min(1)).optional(),
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
