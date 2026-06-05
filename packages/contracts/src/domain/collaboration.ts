import { z } from "zod";

import {
  branchKindSchema,
  branchStatusSchema,
  proposalStatusSchema,
  reviewDecisionSchema
} from "../enums.js";
import { idSchema, isoDateTimeSchema, timestampFieldsSchema } from "./common.js";
import { deliverableChangeManifestSchema } from "../experience.js";

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
