import { z } from "zod";

import { actorKindSchema } from "./enums.js";
import { idSchema, isoDateTimeSchema } from "./domain/common.js";
import { snapshotSchema } from "./domain/agent.js";

export const auditActorSchema = z.object({
  actor_kind: actorKindSchema,
  actor_user_id: idSchema.optional(),
  actor_nickname: z.string().min(1).max(64).optional()
});
export type AuditActor = z.infer<typeof auditActorSchema>;

export const auditEntityRefSchema = z.object({
  entity_type: z.string().min(1).max(64),
  entity_id: z.string().min(1).max(64)
});
export type AuditEntityRef = z.infer<typeof auditEntityRefSchema>;

export const auditLogFactSchema = z.object({
  id: idSchema,
  org_id: idSchema.optional(),
  workspace_id: idSchema.optional(),
  actor: auditActorSchema,
  entity: auditEntityRefSchema,
  action: z.string().min(1).max(64),
  detail_json: z.record(z.string(), z.unknown()).default({}),
  snapshot_id: idSchema.optional(),
  undone_at: isoDateTimeSchema.optional(),
  created_at: isoDateTimeSchema
});
export type AuditLogFact = z.infer<typeof auditLogFactSchema>;

export const manifestFactsSchema = z.object({
  checks: z.object({
    snapshot_exists: z.enum(["passed", "failed"]),
    revert_available: z.enum(["passed", "failed", "warning"]),
    ask_gate_required: z.enum(["passed", "warning"]).optional()
  }),
  rollback: z.object({
    available: z.boolean(),
    snapshot_id: idSchema.optional(),
    description: z.string().min(1)
  }),
  risk: z.object({
    reversible: z.boolean(),
    irreversible_reasons: z.array(z.string())
  }),
  evidence_refs: z.array(z.object({
    source_type: z.enum(["agent_step", "audit_log"]),
    source_id: z.string().min(1),
    title: z.string().min(1)
  }))
});
export type ManifestFacts = z.infer<typeof manifestFactsSchema>;

export const sideEffectPolicySchema = z.object({
  side_effect: z.enum(["none", "sandbox_file", "business_write", "external_effect"]),
  action: z.string().optional()
});
export type SideEffectPolicy = z.infer<typeof sideEffectPolicySchema>;

export const createAuditLogRequestSchema = z.object({
  entity: auditEntityRefSchema,
  action: z.string().min(1).max(64),
  detail_json: z.record(z.string(), z.unknown()).default({}),
  snapshot_id: idSchema.optional()
});
export type CreateAuditLogRequest = z.infer<typeof createAuditLogRequestSchema>;

export const revertAgentRunRequestSchema = z.object({
  snapshot_id: idSchema,
  reason_md: z.string().max(2000).optional()
});
export type RevertAgentRunRequest = z.infer<typeof revertAgentRunRequestSchema>;

export const auditTimelineVmSchema = z.object({
  work_item_id: idSchema,
  snapshots: z.array(snapshotSchema),
  audit_logs: z.array(auditLogFactSchema),
  manifest_facts: manifestFactsSchema
});
export type AuditTimelineVM = z.infer<typeof auditTimelineVmSchema>;
