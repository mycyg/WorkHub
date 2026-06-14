import { z } from "zod";

import {
  permissionEffectSchema,
  permissionScopeKindSchema,
  riskLevelSchema
} from "./enums.js";
import { idSchema } from "./domain/common.js";
import { evidenceRefSchema } from "./experience.js";

export const approvalKinds = ["tool", "proposal", "revision"] as const;
export const approvalKindSchema = z.enum(approvalKinds);
export type ApprovalKind = z.infer<typeof approvalKindSchema>;

export const approvalDecisionSchema = z.enum(["allow", "deny"]);
export type ApprovalDecision = z.infer<typeof approvalDecisionSchema>;

export const approvalRememberSchema = z.enum(["once", "always"]);
export type ApprovalRemember = z.infer<typeof approvalRememberSchema>;

export const approvalPayloadUiSchema = z.object({
  summary_text: z.string().min(1),
  reason_text: z.string().optional(),
  risk: z
    .object({
      level: riskLevelSchema,
      human_label: z.string().min(1).optional()
    })
    .optional(),
  evidence_refs: z.array(evidenceRefSchema).optional(),
  affected_targets: z.array(z.string().min(1)).optional(),
  requires_desktop: z.boolean().optional()
});
export type ApprovalPayloadUI = z.infer<typeof approvalPayloadUiSchema>;

export const approvalPayloadSchema = z.object({
  ui: approvalPayloadUiSchema.optional(),
  raw_args: z.record(z.string(), z.unknown()).default({})
});
export type ApprovalPayload = z.infer<typeof approvalPayloadSchema>;

export const createApprovalRequestSchema = z.object({
  kind: approvalKindSchema.default("tool"),
  work_item_id: idSchema.optional(),
  agent_run_id: idSchema.optional(),
  action_pattern: z.string().min(1).max(128),
  payload_json: approvalPayloadSchema.default({ raw_args: {} }),
  routed_to_user_id: idSchema.optional(),
  sla_due_at: z.string().datetime({ offset: true }).optional()
});
export type CreateApprovalRequest = z.infer<typeof createApprovalRequestSchema>;

export const respondApprovalRequestSchema = z.object({
  decision: approvalDecisionSchema,
  reason_md: z.string().trim().min(1).max(200_000).optional(),
  remember: approvalRememberSchema.default("once")
});
export type RespondApprovalRequest = z.infer<typeof respondApprovalRequestSchema>;

export const delegateApprovalRequestSchema = z.object({
  to_user_id: idSchema
});
export type DelegateApprovalRequest = z.infer<typeof delegateApprovalRequestSchema>;

// W2：审批工作台「相关讨论」发表评论。
export const addApprovalCommentRequestSchema = z.object({
  body: z.string().trim().min(1).max(4000)
});
export type AddApprovalCommentRequest = z.infer<typeof addApprovalCommentRequestSchema>;

export const permissionPolicyWriteSchema = z.object({
  scope_kind: permissionScopeKindSchema,
  scope_id: z.string().min(1).max(64),
  action_pattern: z.string().min(1).max(128),
  effect: permissionEffectSchema,
  priority: z.number().int().default(0),
  learned_from_session: z.boolean().default(false),
  org_id: idSchema.optional(),
  workspace_id: idSchema.optional()
});
export type PermissionPolicyWrite = z.infer<typeof permissionPolicyWriteSchema>;
