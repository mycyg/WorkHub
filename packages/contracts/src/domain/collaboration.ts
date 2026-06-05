import { z } from "zod";

import {
  branchKindSchema,
  branchStatusSchema,
  proposalStatusSchema,
  reviewDecisionSchema
} from "../enums.js";
import { idSchema, isoDateTimeSchema, timestampFieldsSchema } from "./common.js";
import { auditLogFactSchema } from "../audit.js";
import {
  attentionItemSchema,
  deliverableChangeManifestSchema,
  workHubEventSchema
} from "../experience.js";
import { actionSpecSchema } from "../pages.js";

export const branchSchema = timestampFieldsSchema.extend({
  id: idSchema,
  work_item_id: idSchema,
  actor_kind: z.enum(["human", "ai", "system"]),
  actor_user_id: idSchema.optional(),
  agent_run_id: idSchema.optional(),
  kind: branchKindSchema,
  base_snapshot_id: idSchema.optional(),
  head_ref: z.string().max(128).optional(),
  status: branchStatusSchema,
  version: z.number().int().nonnegative()
});
export type Branch = z.infer<typeof branchSchema>;

export const proposalSchema = timestampFieldsSchema.extend({
  id: idSchema,
  work_item_id: idSchema,
  branch_id: idSchema,
  round: z.number().int().positive(),
  title: z.string().min(1).max(256),
  status: proposalStatusSchema,
  diff_manifest: deliverableChangeManifestSchema,
  confidence_id: idSchema.optional(),
  merge_snapshot_id: idSchema.optional(),
  opened_by_kind: z.enum(["human", "ai", "system"]),
  opened_by_user_id: idSchema.optional(),
  reviewed_at: isoDateTimeSchema.optional(),
  merged_at: isoDateTimeSchema.optional()
});
export type Proposal = z.infer<typeof proposalSchema>;

export const reviewSchema = timestampFieldsSchema.extend({
  id: idSchema,
  proposal_id: idSchema,
  reviewer_kind: z.enum(["human", "ai", "system"]),
  reviewer_user_id: idSchema.optional(),
  decision: reviewDecisionSchema,
  reason_md: z.string().optional(),
  reason_fed_back_at: isoDateTimeSchema.optional()
});
export type Review = z.infer<typeof reviewSchema>;

export const specDocSchema = timestampFieldsSchema.extend({
  id: idSchema,
  scope_kind: z.enum(["work_item", "project"]),
  work_item_id: idSchema.optional(),
  project_id: idSchema.optional(),
  title: z.string().min(1).max(256),
  content_md: z.string(),
  content_sha256: z.string().length(64).optional(),
  version: z.number().int().nonnegative(),
  deleted_at: isoDateTimeSchema.optional()
});
export type SpecDoc = z.infer<typeof specDocSchema>;

export const reviewProposalRequestSchema = z.object({
  decision: z.enum(["approve", "request_changes"]),
  reason_md: z.string().trim().min(1).max(200_000).optional(),
  remember: z.enum(["once", "always"]).default("once")
}).superRefine((value, ctx) => {
  if (value.decision === "request_changes" && !value.reason_md) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["reason_md"],
      message: "打回必须说明原因。"
    });
  }
});
export type ReviewProposalRequest = z.input<typeof reviewProposalRequestSchema>;

export const createProposalFromManifestRequestSchema = z.object({
  title: z.string().min(1).max(256).optional(),
  branch_id: idSchema.optional(),
  manifest: deliverableChangeManifestSchema
});
export type CreateProposalFromManifestRequest = z.input<typeof createProposalFromManifestRequestSchema>;

export const proposalReviewResultSchema = z.object({
  proposal_id: idSchema,
  work_item_id: idSchema,
  status: z.enum(["reviewed", "revision_requested"]),
  decision: z.enum(["approve", "request_changes"]),
  reason_md: z.string().optional(),
  next_action: actionSpecSchema.optional(),
  next_agent_context: z
    .object({
      work_item_id: idSchema,
      run_id: idSchema.optional(),
      correction: z.string().min(1),
      reason_fed_back: z.literal(true)
    })
    .optional(),
  attention: attentionItemSchema,
  event: workHubEventSchema(z.unknown()),
  feedback_event: workHubEventSchema(z.unknown()).optional(),
  audit_logs: z.array(auditLogFactSchema).optional()
});
export type ProposalReviewResult = z.infer<typeof proposalReviewResultSchema>;

export const mergeProposalRequestSchema = z.object({
  confirm: z.boolean().default(true)
});
export type MergeProposalRequest = z.input<typeof mergeProposalRequestSchema>;

export const proposalMergeResultSchema = z.object({
  proposal_id: idSchema,
  work_item_id: idSchema,
  status: z.literal("merged"),
  merge_snapshot_id: idSchema,
  rollback_available: z.boolean(),
  rollback: deliverableChangeManifestSchema.shape.rollback,
  attention: attentionItemSchema,
  events: z.array(workHubEventSchema(z.unknown())).min(1),
  audit_logs: z.array(auditLogFactSchema).min(1)
});
export type ProposalMergeResult = z.infer<typeof proposalMergeResultSchema>;
