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

const proposalConflictActionSchema = actionSpecSchema.extend({
  request_json: z.record(z.string(), z.unknown()).optional()
});

export const mergeProposalBulkActionSchema = z.object({
  action: z.enum(["keep_current", "accept_incoming"]),
  target_keys: z.array(z.string().min(1)).default([]),
  conflict_count: z.number().int().nonnegative().optional()
});
export type MergeProposalBulkAction = z.infer<typeof mergeProposalBulkActionSchema>;

export const mergeProposalRequestSchema = z.object({
  confirm: z.boolean().default(true),
  conflict_resolution: z
    .object({
      accept_incoming_target_keys: z.array(z.string().min(1)).default([]),
      bulk_action: mergeProposalBulkActionSchema.optional()
    })
    .optional()
});
export type MergeProposalRequest = z.input<typeof mergeProposalRequestSchema>;

export const chooseMergeProposalCandidateRequestSchema = z.object({
  option_key: z.string().min(1).max(64)
});
export type ChooseMergeProposalCandidateRequest = z.input<typeof chooseMergeProposalCandidateRequestSchema>;

export const structuredFieldOverrideDecisionSchema = z.enum(["accept_incoming", "keep_current", "custom"]);
export type StructuredFieldOverrideDecision = z.infer<typeof structuredFieldOverrideDecisionSchema>;

export const structuredFieldOverrideSchema = z.object({
  field: z.string().min(1).max(64),
  decision: structuredFieldOverrideDecisionSchema,
  value: z.unknown().optional()
}).superRefine((override, ctx) => {
  if (override.decision === "custom" && !Object.prototype.hasOwnProperty.call(override, "value")) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["value"],
      message: "自定义字段值不能为空。"
    });
  }
});
export type StructuredFieldOverride = z.infer<typeof structuredFieldOverrideSchema>;

export const structuredFieldApplyOverridesSchema = z.object({
  operations: z.array(structuredFieldOverrideSchema).min(1).max(64)
});
export type StructuredFieldApplyOverrides = z.infer<typeof structuredFieldApplyOverridesSchema>;

export const structuredItemOverrideDecisionSchema = z.enum(["accept_incoming", "keep_current"]);
export type StructuredItemOverrideDecision = z.infer<typeof structuredItemOverrideDecisionSchema>;

export const structuredItemOverrideSchema = z.object({
  field: z.enum(["acceptance_items", "task_items"]),
  item_id: idSchema,
  decision: structuredItemOverrideDecisionSchema
});
export type StructuredItemOverride = z.infer<typeof structuredItemOverrideSchema>;

export const structuredItemApplyOverridesSchema = z.object({
  items: z.array(structuredItemOverrideSchema).min(1).max(256)
});
export type StructuredItemApplyOverrides = z.infer<typeof structuredItemApplyOverridesSchema>;

export const taskPlanScopeSelectionSchema = z.object({
  target_plan_id: idSchema
});
export type TaskPlanScopeSelection = z.infer<typeof taskPlanScopeSelectionSchema>;

export const textHunkOverrideDecisionSchema = z.enum(["keep_current", "accept_incoming", "ai_fusion"]);
export type TextHunkOverrideDecision = z.infer<typeof textHunkOverrideDecisionSchema>;

export const textHunkOverrideSchema = z.object({
  hunk_index: z.number().int().nonnegative(),
  start_line: z.number().int().positive(),
  end_line: z.number().int().positive(),
  decision: textHunkOverrideDecisionSchema
}).superRefine((override, ctx) => {
  if (override.end_line < override.start_line) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["end_line"],
      message: "文本段结束行不能早于开始行。"
    });
  }
});
export type TextHunkOverride = z.infer<typeof textHunkOverrideSchema>;

export const textHunkApplyOverridesSchema = z.object({
  hunks: z.array(textHunkOverrideSchema).min(1).max(64)
});
export type TextHunkApplyOverrides = z.infer<typeof textHunkApplyOverridesSchema>;

export const applyMergeProposalCandidateRequestSchema = z.object({
  confirm: z.boolean().default(true),
  structured_field_overrides: structuredFieldApplyOverridesSchema.optional(),
  structured_item_overrides: structuredItemApplyOverridesSchema.optional(),
  text_hunk_overrides: textHunkApplyOverridesSchema.optional(),
  task_plan_scope: taskPlanScopeSelectionSchema.optional()
});
export type ApplyMergeProposalCandidateRequest = z.input<typeof applyMergeProposalCandidateRequestSchema>;

export const structuredFieldPatchValueTypeSchema = z.enum([
  "string",
  "markdown",
  "enum",
  "datetime",
  "number",
  "boolean",
  "json_array",
  "json_object",
  "null"
]);
export type StructuredFieldPatchValueType = z.infer<typeof structuredFieldPatchValueTypeSchema>;

export const structuredFieldPatchSourceSchema = z.enum(["ai_fusion", "incoming", "manual"]);
export type StructuredFieldPatchSource = z.infer<typeof structuredFieldPatchSourceSchema>;

export const structuredFieldPatchTargetEntityTypeSchema = z.enum(["work_item"]);
export type StructuredFieldPatchTargetEntityType = z.infer<typeof structuredFieldPatchTargetEntityTypeSchema>;

const structuredWorkItemFieldTypes = {
  title: ["string"],
  summary_md: ["markdown"],
  priority: ["enum"],
  due_at: ["datetime", "null"],
  acceptance_items: ["json_array"],
  task_items: ["json_array"]
} as const satisfies Record<string, readonly StructuredFieldPatchValueType[]>;

const structuredWorkItemPriorityValues = new Set(["low", "normal", "high", "urgent"]);
const structuredAcceptanceItemStatusSchema = z.enum(["open", "met", "unmet", "waived"]);
export const structuredAcceptanceItemPatchSchema = z.object({
  id: idSchema,
  title: z.string().trim().min(1).max(256),
  description: z.string().max(4000).nullable().optional(),
  status: structuredAcceptanceItemStatusSchema.optional(),
  sort_order: z.number().int().optional(),
  source_plan_id: idSchema.nullable().optional()
});
export type StructuredAcceptanceItemPatch = z.infer<typeof structuredAcceptanceItemPatchSchema>;
const structuredAcceptanceItemPatchListSchema = z.array(structuredAcceptanceItemPatchSchema);
const structuredTaskItemTypeSchema = z.enum(["task", "risk", "acceptance"]);
export const structuredTaskItemPatchSchema = z.object({
  id: idSchema,
  title: z.string().trim().min(1).max(256),
  description: z.string().max(4000).nullable().optional(),
  item_type: structuredTaskItemTypeSchema.optional(),
  suggested_user_id: idSchema.nullable().optional(),
  estimate_hours: z.number().nonnegative().nullable().optional(),
  sort_order: z.number().int().optional()
});
export type StructuredTaskItemPatch = z.infer<typeof structuredTaskItemPatchSchema>;
const structuredTaskItemPatchListSchema = z.array(structuredTaskItemPatchSchema);

function structuredFieldAllowedTypes(input: {
  target_entity_type: string;
  field: string;
}): readonly StructuredFieldPatchValueType[] | undefined {
  if (input.target_entity_type !== "work_item") {
    return undefined;
  }
  return structuredWorkItemFieldTypes[input.field as keyof typeof structuredWorkItemFieldTypes];
}

function inferStructuredFieldPatchValueType(input: {
  target_entity_type: StructuredFieldPatchTargetEntityType;
  field: string;
  value: unknown;
}): StructuredFieldPatchValueType | undefined {
  const allowedTypes = structuredFieldAllowedTypes(input);
  if (!allowedTypes) {
    return undefined;
  }
  if (input.value === null && allowedTypes.includes("null")) {
    return "null";
  }
  const first = allowedTypes.find((type) => type !== "null");
  return first;
}

function structuredFieldPatchValueMatchesType(input: {
  field?: string;
  value_type: StructuredFieldPatchValueType;
  value: unknown;
}) {
  switch (input.value_type) {
    case "string":
    case "markdown":
      return typeof input.value === "string" && input.value.trim().length > 0;
    case "enum":
      return typeof input.value === "string" && structuredWorkItemPriorityValues.has(input.value);
    case "datetime":
      return typeof input.value === "string" && z.string().datetime({ offset: true }).safeParse(input.value).success;
    case "number":
      return typeof input.value === "number" && Number.isFinite(input.value);
    case "boolean":
      return typeof input.value === "boolean";
    case "json_array":
      if (input.field === "acceptance_items") {
        return structuredAcceptanceItemPatchListSchema.safeParse(input.value).success;
      }
      if (input.field === "task_items") {
        return structuredTaskItemPatchListSchema.safeParse(input.value).success;
      }
      return Array.isArray(input.value);
    case "json_object":
      return input.value !== null && typeof input.value === "object" && !Array.isArray(input.value);
    case "null":
      return input.value === null;
  }
}

export const structuredFieldPatchOperationSchema = z.object({
  op: z.literal("set"),
  target_entity_type: structuredFieldPatchTargetEntityTypeSchema,
  target_entity_id: idSchema,
  field: z.string().min(1).max(64),
  value_type: structuredFieldPatchValueTypeSchema,
  value: z.unknown(),
  source: structuredFieldPatchSourceSchema.default("ai_fusion"),
  before_value: z.unknown().optional(),
  current_value: z.unknown().optional()
}).superRefine((operation, ctx) => {
  const allowedTypes = structuredFieldAllowedTypes(operation);
  if (!allowedTypes) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["field"],
      message: `Unsupported structured field: ${operation.target_entity_type}.${operation.field}`
    });
    return;
  }
  if (!allowedTypes.includes(operation.value_type)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["value_type"],
      message: `Invalid value_type for ${operation.target_entity_type}.${operation.field}`
    });
  }
  if (!structuredFieldPatchValueMatchesType(operation)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["value"],
      message: `Invalid value for ${operation.value_type}`
    });
  }
});
export type StructuredFieldPatchOperation = z.infer<typeof structuredFieldPatchOperationSchema>;

export const structuredFieldPatchSchema = z.object({
  type: z.literal("structured_field_patch"),
  target_entity_type: structuredFieldPatchTargetEntityTypeSchema,
  target_entity_id: idSchema,
  operations: z.array(structuredFieldPatchOperationSchema),
  source: structuredFieldPatchSourceSchema.default("ai_fusion")
});
export type StructuredFieldPatch = z.infer<typeof structuredFieldPatchSchema>;

export const structuredFieldPatchDryRunIssueSchema = z.object({
  severity: z.enum(["error", "warning"]),
  code: z.enum([
    "missing_target",
    "unsupported_entity_type",
    "unknown_field",
    "missing_declared_field",
    "invalid_value_type",
    "empty_patch",
    "subrecord_merge_deferred"
  ]),
  field: z.string().min(1).max(64).optional(),
  message: z.string().min(1)
});
export type StructuredFieldPatchDryRunIssue = z.infer<typeof structuredFieldPatchDryRunIssueSchema>;

export const structuredFieldPatchDryRunSchema = z.object({
  type: z.literal("structured_field_patch_dry_run"),
  status: z.enum(["ready", "needs_review", "blocked"]),
  executable: z.boolean(),
  patch: structuredFieldPatchSchema,
  issues: z.array(structuredFieldPatchDryRunIssueSchema),
  audit_payload: z.object({
    target_entity_type: structuredFieldPatchTargetEntityTypeSchema,
    target_entity_id: idSchema,
    field_count: z.number().int().nonnegative(),
    operation_fields: z.array(z.string().min(1)),
    source: structuredFieldPatchSourceSchema
  })
});
export type StructuredFieldPatchDryRun = z.infer<typeof structuredFieldPatchDryRunSchema>;

export function buildStructuredFieldPatchDryRun(input: {
  target_entity_type: string | undefined;
  target_entity_id: string | undefined;
  changed_fields?: string[];
  merged_fields?: Record<string, unknown>;
  base_fields?: Record<string, unknown>;
  source?: StructuredFieldPatchSource;
}): StructuredFieldPatchDryRun {
  const source = input.source ?? "ai_fusion";
  const issues: StructuredFieldPatchDryRunIssue[] = [];
  const operations: StructuredFieldPatchOperation[] = [];
  const targetEntityType = structuredFieldPatchTargetEntityTypeSchema.safeParse(input.target_entity_type);
  const targetEntityId = idSchema.safeParse(input.target_entity_id);

  if (!targetEntityType.success) {
    issues.push({
      severity: "error",
      code: input.target_entity_type ? "unsupported_entity_type" : "missing_target",
      message: "结构化字段补丁缺少受支持的目标对象类型。"
    });
  }
  if (!targetEntityId.success) {
    issues.push({
      severity: "error",
      code: "missing_target",
      message: "结构化字段补丁缺少目标对象 ID。"
    });
  }

  const normalizedTargetEntityType = targetEntityType.success ? targetEntityType.data : "work_item";
  const normalizedTargetEntityId = targetEntityId.success
    ? targetEntityId.data
    : "00000000-0000-4000-8000-000000000000";
  const mergedFields = input.merged_fields ?? {};
  const baseFields = input.base_fields ?? {};
  const mergedFieldNames = Object.keys(mergedFields).filter((field) => field.trim().length > 0);
  const changedFields = (input.changed_fields ?? []).filter((field) => field.trim().length > 0);
  const mergedFieldSet = new Set(mergedFieldNames);

  for (const field of changedFields) {
    if (!mergedFieldSet.has(field)) {
      issues.push({
        severity: "error",
        code: "missing_declared_field",
        field,
        message: `结构化字段补丁缺少声明要修改的字段 ${field}。`
      });
    }
  }

  for (const field of mergedFieldNames) {
    const value = mergedFields[field];
    const valueType = inferStructuredFieldPatchValueType({
      target_entity_type: normalizedTargetEntityType,
      field,
      value
    });
    if (!valueType) {
      issues.push({
        severity: "error",
        code: "unknown_field",
        field,
        message: `结构化字段补丁包含未知字段 ${field}。`
      });
      continue;
    }
    const operationCandidate = {
      op: "set" as const,
      target_entity_type: normalizedTargetEntityType,
      target_entity_id: normalizedTargetEntityId,
      field,
      value_type: valueType,
      value,
      source,
      ...(Object.prototype.hasOwnProperty.call(baseFields, field) ? { before_value: baseFields[field] } : {})
    };
    const operation = structuredFieldPatchOperationSchema.safeParse(operationCandidate);
    if (!operation.success) {
      issues.push({
        severity: "error",
        code: "invalid_value_type",
        field,
        message: `结构化字段 ${field} 的值类型不符合 ${valueType}。`
      });
      continue;
    }
    operations.push(operation.data);
  }

  if (operations.length === 0) {
    issues.push({
      severity: "error",
      code: "empty_patch",
      message: "结构化字段补丁没有可执行字段。"
    });
  }

  const hasErrors = issues.some((issue) => issue.severity === "error");
  const hasWarnings = issues.some((issue) => issue.severity === "warning");
  const status = hasErrors ? "blocked" : hasWarnings ? "needs_review" : "ready";

  return structuredFieldPatchDryRunSchema.parse({
    type: "structured_field_patch_dry_run",
    status,
    executable: status === "ready",
    patch: {
      type: "structured_field_patch",
      target_entity_type: normalizedTargetEntityType,
      target_entity_id: normalizedTargetEntityId,
      operations,
      source
    },
    issues,
    audit_payload: {
      target_entity_type: normalizedTargetEntityType,
      target_entity_id: normalizedTargetEntityId,
      field_count: operations.length,
      operation_fields: operations.map((operation) => operation.field),
      source
    }
  });
}

export const chosenMergeProposalCandidateSchema = z.object({
  option_key: z.string().min(1),
  target_kind: z.string().min(1).optional(),
  rationale_md: z.string().optional(),
  merged_value: z.record(z.string(), z.unknown()).optional(),
  source: z.string().optional(),
  quality_gate: z.record(z.string(), z.unknown()).optional()
});
export type ChosenMergeProposalCandidate = z.infer<typeof chosenMergeProposalCandidateSchema>;

export const mergeProposalCandidateChoiceResultSchema = z.object({
  merge_proposal_id: idSchema,
  conflict_key: z.string().min(1),
  chosen_option_key: z.string().min(1),
  chosen_by_user_id: idSchema.optional(),
  chosen_at: isoDateTimeSchema,
  candidate: chosenMergeProposalCandidateSchema
});
export type MergeProposalCandidateChoiceResult = z.infer<typeof mergeProposalCandidateChoiceResultSchema>;

export const proposalConflictOptionSchema = z.object({
  id: z.enum(["keep_current", "accept_incoming", "ai_fusion"]),
  label: z.string().min(1),
  summary_text: z.string().min(1),
  recommended: z.boolean().optional(),
  quality_gate: z.record(z.string(), z.unknown()).optional(),
  action: proposalConflictActionSchema.optional()
});
export type ProposalConflictOption = z.infer<typeof proposalConflictOptionSchema>;

export const proposalConflictSchema = z.object({
  id: z.string().min(1),
  work_item_id: idSchema,
  proposal_id: idSchema,
  merge_proposal_id: idSchema.optional(),
  change_id: idSchema,
  target_key: z.string().min(1),
  target_kind: z.string().min(1),
  change_type: z.string().min(1),
  target_path: z.string().optional(),
  headline: z.string().min(1),
  summary_text: z.string().min(1),
  existing: z.object({
    proposal_id: idSchema,
    change_id: idSchema,
    ref: z.string().optional(),
    sha256: z.string().length(64).optional()
  }),
  incoming: z.object({
    ref: z.string().optional(),
    sha256_before: z.string().length(64).optional(),
    sha256_after: z.string().length(64).optional()
  }),
  recommended_option_id: z.enum(["keep_current", "accept_incoming", "ai_fusion"]),
  options: z.array(proposalConflictOptionSchema).min(2)
});
export type ProposalConflict = z.infer<typeof proposalConflictSchema>;

export const proposalConflictListResultSchema = z.object({
  conflicts: z.array(proposalConflictSchema),
  empty_state: z.enum(["no_conflicts"]).optional()
});
export type ProposalConflictListResult = z.infer<typeof proposalConflictListResultSchema>;

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
