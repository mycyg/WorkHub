import { z } from "zod";

import {
  approvalStatusSchema,
  permissionEffectSchema,
  permissionScopeKindSchema
} from "../enums.js";
import { idSchema, isoDateTimeSchema, timestampFieldsSchema } from "./common.js";

export const permissionPolicySchema = timestampFieldsSchema.extend({
  id: idSchema,
  scope_kind: permissionScopeKindSchema,
  scope_id: z.string().min(1).max(64),
  action_pattern: z.string().min(1).max(128),
  effect: permissionEffectSchema,
  priority: z.number().int(),
  learned_from_session: z.boolean(),
  created_by_user_id: idSchema.nullable().optional(),
  org_id: idSchema.nullable().optional(),
  workspace_id: idSchema.nullable().optional(),
  deleted_at: isoDateTimeSchema.nullable().optional()
});
export type PermissionPolicy = z.infer<typeof permissionPolicySchema>;

export const approvalRequestSchema = timestampFieldsSchema.extend({
  id: idSchema,
  work_item_id: idSchema.optional(),
  agent_run_id: idSchema.optional(),
  action_pattern: z.string().min(1).max(128),
  payload_json: z.record(z.string(), z.unknown()).default({}),
  status: approvalStatusSchema,
  routed_to_user_id: idSchema.optional(),
  decided_by_user_id: idSchema.optional(),
  decision_reason_md: z.string().optional(),
  delegated_to_user_id: idSchema.optional(),
  sla_due_at: isoDateTimeSchema.optional()
});
export type ApprovalRequest = z.infer<typeof approvalRequestSchema>;

export const auditLogSchema = z.object({
  id: idSchema,
  org_id: idSchema.optional(),
  workspace_id: idSchema.optional(),
  actor_kind: z.enum(["human", "ai", "system"]),
  actor_user_id: idSchema.optional(),
  actor_nickname: z.string().max(64).optional(),
  entity_type: z.string().min(1).max(64),
  entity_id: z.string().min(1).max(64),
  action: z.string().min(1).max(64),
  detail_json: z.record(z.string(), z.unknown()).default({}),
  snapshot_id: idSchema.optional(),
  undone_at: isoDateTimeSchema.optional(),
  created_at: isoDateTimeSchema
});
export type AuditLog = z.infer<typeof auditLogSchema>;
