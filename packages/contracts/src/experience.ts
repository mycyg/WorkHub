import { z } from "zod";

import {
  actorKindSchema,
  deliverableTargetKindSchema,
  evidenceSourceTypeSchema,
  riskLevelSchema
} from "./enums.js";
import { actorSchema, idSchema, isoDateTimeSchema } from "./domain/common.js";
import { cuuLauncherDeliveryKindSchema } from "./domain/work-item.js";

export const cuuStates = [
  "idle",
  "thinking",
  "asking_approval",
  "carrying_document",
  "searching_evidence",
  "syncing_files",
  "worried",
  "revision_requested",
  "celebrating",
  "offline"
] as const;
export const cuuStateSchema = z.enum(cuuStates);
export type CuuState = z.infer<typeof cuuStateSchema>;

export const evidenceRefSchema = z.object({
  id: idSchema,
  source_type: evidenceSourceTypeSchema,
  source_id: z.string().min(1),
  title: z.string().min(1),
  excerpt: z.string().max(300).optional(),
  locator: z
    .object({
      page: z.number().int().positive().optional(),
      slide: z.number().int().positive().optional(),
      sheet: z.string().optional(),
      cell_range: z.string().optional(),
      timestamp_s: z.number().nonnegative().optional(),
      path: z.string().optional(),
      line_start: z.number().int().positive().optional()
    })
    .optional(),
  confidence_hint: z.enum(["found", "weak", "missing"]).optional(),
  href: z.string().optional()
});
export type EvidenceRef = z.infer<typeof evidenceRefSchema>;

export const attentionActionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  style: z.enum(["primary", "secondary", "danger", "quiet"]),
  method: z.enum(["GET", "POST"]),
  href: z.string().min(1),
  requires_desktop: z.boolean().optional(),
  requires_reason: z.boolean().optional()
});
export type AttentionAction = z.infer<typeof attentionActionSchema>;

export const attentionItemSchema = z.object({
  id: idSchema,
  kind: z.enum([
    "clarification",
    "approval",
    "proposal_review",
    "escalation",
    "sync_conflict",
    "knowledge_result",
    "budget",
    "delivery_ready",
    "system_health"
  ]),
  priority: z.enum(["low", "normal", "high", "urgent"]),
  work_item_id: idSchema.optional(),
  project_id: idSchema.optional(),
  source_ref: z.object({
    entity_type: z.enum([
      "approval_request",
      "proposal",
      "agent_run",
      "notification",
      "escalation_event",
      "knowledge_run",
      "budget_notice"
    ]),
    entity_id: idSchema
  }),
  title: z.string().min(1),
  summary_text: z.string().min(1),
  reason_text: z.string().optional(),
  evidence_refs: z.array(evidenceRefSchema).optional(),
  actions: z.array(attentionActionSchema),
  cuu_state: cuuStateSchema.optional(),
  created_at: isoDateTimeSchema,
  expires_at: isoDateTimeSchema.optional()
});
export type AttentionItem = z.infer<typeof attentionItemSchema>;

export const questionOptionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string().optional(),
  impact: z.string().optional(),
  risk_hint: riskLevelSchema.optional(),
  delivery_kind: cuuLauncherDeliveryKindSchema.optional(),
  default_acceptance: z.array(z.string().min(1).max(256)).max(8).optional(),
  icon: z.string().optional()
});
export type QuestionOption = z.infer<typeof questionOptionSchema>;

export const questionCardSchema = z.object({
  id: idSchema,
  session_id: idSchema.optional(),
  work_item_id: idSchema.optional(),
  title: z.string().min(1),
  body: z.string().optional(),
  input_mode: z.enum(["single_choice", "multi_choice", "rank", "confirm", "short_text", "long_text"]),
  options: z.array(questionOptionSchema),
  recommended_option_ids: z.array(z.string()).optional(),
  free_text: z.object({
    enabled: z.boolean(),
    collapsed_by_default: z.boolean(),
    placeholder: z.string().optional(),
    max_length: z.number().int().positive().optional()
  }),
  progress: z.array(z.object({
    key: z.string().min(1),
    label: z.string().min(1),
    state: z.enum(["done", "active", "pending"])
  })),
  evidence_refs: z.array(evidenceRefSchema).optional(),
  submit: z.object({
    method: z.literal("POST"),
    href: z.string().min(1)
  })
});
export type QuestionCard = z.infer<typeof questionCardSchema>;

export const createSessionRequestSchema = z.object({
  title: z.string().min(1).optional(),
  intent_text: z.string().min(1).optional(),
  project_id: idSchema.optional(),
  work_item_id: idSchema.optional()
});
export type CreateSessionRequest = z.infer<typeof createSessionRequestSchema>;

export const nextQuestionRequestSchema = z.object({
  selected_option_ids: z.array(z.string().min(1)).max(10).optional(),
  free_text: z.string().trim().max(1000).optional()
});
export type NextQuestionRequest = z.infer<typeof nextQuestionRequestSchema>;

export const sessionVmSchema = z.object({
  session_id: idSchema,
  work_item_id: idSchema.optional(),
  topic: z.string().min(1),
  stream_href: z.string().min(1),
  next_question_href: z.string().min(1),
  question: questionCardSchema
});
export type SessionVM = z.infer<typeof sessionVmSchema>;

export const evidenceBubbleSchema = z.object({
  id: idSchema,
  query_text: z.string().optional(),
  summary_text: z.string().min(1),
  evidence_refs: z.array(evidenceRefSchema),
  missing_evidence_note: z.string().optional(),
  actions: z.array(z.object({
    id: z.enum(["use_for_current_task", "open_full_search", "copy_summary", "ask_followup"]),
    label: z.string().min(1),
    method: z.enum(["GET", "POST"]).optional(),
    href: z.string().optional()
  }))
});
export type EvidenceBubble = z.infer<typeof evidenceBubbleSchema>;

export const useEvidenceForTaskRequestSchema = z.object({
  evidence_bubble_id: idSchema.optional(),
  evidence_refs: z.array(evidenceRefSchema).min(1),
  note: z.string().max(500).optional()
});
export type UseEvidenceForTaskRequest = z.infer<typeof useEvidenceForTaskRequestSchema>;

export const deliverableChangeSchema = z.object({
  id: idSchema,
  target_kind: deliverableTargetKindSchema,
  target_ref: z.object({
    entity_type: z.enum(["work_item", "drive_item", "delivery", "spec_doc", "folder", "external"]),
    entity_id: idSchema.optional(),
    path: z.string().optional(),
    version_before: z.string().optional(),
    version_after: z.string().optional(),
    sha256_before: z.string().length(64).optional(),
    sha256_after: z.string().length(64).optional()
  }),
  change_type: z.enum(["created", "updated", "deleted", "renamed", "moved", "replaced", "generated"]),
  human_summary: z.string().min(1),
  machine_summary: z
    .object({
      before_excerpt: z.string().optional(),
      after_excerpt: z.string().optional(),
      changed_fields: z.array(z.string()).optional(),
      field_values_before: z.record(z.string(), z.unknown()).optional(),
      row_count_delta: z.number().int().optional(),
      slide_count_delta: z.number().int().optional(),
      image_size_before: z.string().optional(),
      image_size_after: z.string().optional()
    })
    .optional(),
  preview_ref: z
    .object({
      kind: z.enum(["text", "image", "pdf", "office_preview", "download"]),
      href: z.string().min(1)
    })
    .optional(),
  evidence_refs: z.array(evidenceRefSchema).optional()
});
export type DeliverableChange = z.infer<typeof deliverableChangeSchema>;

export const deliverableCheckSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  status: z.enum(["passed", "failed", "warning", "skipped"]),
  detail: z.string().optional(),
  evidence_refs: z.array(evidenceRefSchema).optional()
});
export type DeliverableCheck = z.infer<typeof deliverableCheckSchema>;

export const deliverableChangeManifestSchema = z.object({
  version: z.literal(0),
  proposal_id: idSchema.optional(),
  work_item_id: idSchema,
  branch_id: idSchema.optional(),
  title: z.string().min(1),
  summary_md: z.string().min(1),
  author: z.object({
    actor_kind: actorKindSchema,
    actor_user_id: idSchema.optional(),
    label: z.string().min(1)
  }),
  base: z.object({
    snapshot_id: idSchema.optional(),
    branch_head_ref: z.string().optional(),
    created_at: isoDateTimeSchema.optional()
  }),
  changes: z.array(deliverableChangeSchema).min(1),
  checks: z.array(deliverableCheckSchema),
  evidence_refs: z.array(evidenceRefSchema),
  risk: z.object({
    level: riskLevelSchema,
    human_label: z.string().min(1),
    reversible: z.boolean(),
    irreversible_reasons: z.array(z.string()).optional()
  }),
  rollback: z.object({
    available: z.boolean(),
    snapshot_id: idSchema.optional(),
    description: z.string().min(1)
  }),
  review: z.object({
    suggested_decision: z.enum(["approve", "reject", "needs_human"]).optional(),
    reason_required_on_reject: z.literal(true)
  })
});
export type DeliverableChangeManifest = z.infer<typeof deliverableChangeManifestSchema>;

export const budgetScopeSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("workitem"),
    workitem_id: idSchema
  }),
  z.object({
    kind: z.literal("user"),
    user_id: idSchema
  }),
  z.object({
    kind: z.literal("team"),
    team_id: idSchema
  }),
  z.object({
    // findings[#164]：技能蒸馏(自我提升)用量自成 scope，与团队生产预算隔离（不进 team/user/workitem）。
    kind: z.literal("curation"),
    team_id: idSchema
  }),
  z.object({
    kind: z.literal("eval"),
    suite: z.enum(["nightly", "release"])
  })
]);
export type BudgetScope = z.infer<typeof budgetScopeSchema>;

export const budgetUsageSchema = z.object({
  scope: budgetScopeSchema,
  scope_label: z.string().min(1),
  policy_id: z.string().min(1),
  period: z.enum(["run", "day", "month"]),
  period_start: isoDateTimeSchema,
  period_end: isoDateTimeSchema,
  token_in: z.number().int().nonnegative(),
  token_out: z.number().int().nonnegative(),
  total_tokens: z.number().int().nonnegative(),
  max_tokens: z.number().int().nonnegative(),
  remaining_tokens: z.number().int().nonnegative(),
  estimated_cost_cny: z.string(),
  max_cost_cny: z.string(),
  remaining_cost_cny: z.string(),
  warning_ratio: z.number().min(0),
  status: z.enum(["ok", "warning", "critical", "exhausted"])
});
export type BudgetUsage = z.infer<typeof budgetUsageSchema>;

export const budgetPolicySchema = z
  .object({
    id: z.string().min(1),
    scope_kind: z.enum(["workitem", "user", "team", "eval"]),
    period: z.enum(["run", "day", "month"]),
    max_tokens: z.number().int().positive(),
    max_cost_cny: z.string().regex(/^\d+(\.\d+)?$/),
    warning_ratio: z.number().min(0).max(1),
    critical_ratio: z.number().min(0).max(1),
    on_warning: z.enum(["notify", "downgrade_model"]),
    on_exhausted: z.enum(["block_new_run", "handoff_current_run"]),
    model_route_hint: z.enum(["cheapest_safe", "balanced", "premium"]).optional(),
    enabled: z.boolean(),
    version: z.number().int().positive()
  })
  .superRefine((policy, ctx) => {
    if (policy.warning_ratio >= policy.critical_ratio) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["warning_ratio"],
        message: "warning_ratio must be lower than critical_ratio"
      });
    }
  });
export type BudgetPolicy = z.infer<typeof budgetPolicySchema>;

export const budgetPolicyUpdateSchema = z
  .object({
    max_tokens: z.number().int().positive().optional(),
    max_cost_cny: z.string().regex(/^\d+(\.\d+)?$/).optional(),
    warning_ratio: z.number().min(0).max(1).optional(),
    critical_ratio: z.number().min(0).max(1).optional(),
    on_warning: z.enum(["notify", "downgrade_model"]).optional(),
    on_exhausted: z.enum(["block_new_run", "handoff_current_run"]).optional(),
    model_route_hint: z.enum(["cheapest_safe", "balanced", "premium"]).optional(),
    enabled: z.boolean().optional()
  })
  .refine((payload) => Object.keys(payload).length > 0, {
    message: "budget policy update must include at least one field"
  });
export type BudgetPolicyUpdate = z.infer<typeof budgetPolicyUpdateSchema>;

export const runBudgetSchema = z.object({
  max_steps: z.number().int().positive(),
  total_timeout_s: z.number().int().positive(),
  max_tokens: z.number().int().positive(),
  max_cost_cny: z.string().regex(/^\d+(\.\d+)?$/)
});
export type RunBudget = z.infer<typeof runBudgetSchema>;

export const budgetNoticeSchema = z.object({
  code: z.enum(["budget_warning", "budget_exhausted"]),
  severity: z.enum(["info", "warning", "critical"]),
  message: z.string().min(1),
  scope: budgetScopeSchema,
  usage_ratio: z.number().min(0),
  recommended_action: z.enum(["continue", "downgrade_model", "pause", "ask_admin"]),
  options: z
    .array(z.object({
      id: z.string().min(1),
      label: z.string().min(1),
      action_href: z.string().min(1)
    }))
    .optional(),
  action_href: z.string().optional()
});
export type BudgetNotice = z.infer<typeof budgetNoticeSchema>;

export const budgetDecisionSchema = z.object({
  decision_id: z.string().min(1),
  allowed: z.boolean(),
  reason: z.enum(["ok", "warning", "critical", "budget_exhausted"]).optional(),
  run_budget: runBudgetSchema,
  limiting_scope: budgetScopeSchema.optional(),
  model_route: z.object({
    provider: z.string().min(1),
    model: z.string().min(1),
    reason: z.enum(["default", "low_risk_cheaper", "near_budget_downgrade"])
  }),
  notice: budgetNoticeSchema.optional()
});
export type BudgetDecision = z.infer<typeof budgetDecisionSchema>;

export const costSummaryVmSchema = z.object({
  me: budgetUsageSchema,
  team: budgetUsageSchema.optional(),
  scopes: z.array(budgetUsageSchema),
  active_notices: z.array(budgetNoticeSchema),
  generated_at: isoDateTimeSchema
});
export type CostSummaryVM = z.infer<typeof costSummaryVmSchema>;

export const workHubEventSchema = <T extends z.ZodType>(dataSchema: T) =>
  z.object({
    event_id: idSchema,
    type: z.string().min(1),
    topic: z.string().min(1),
    ts: isoDateTimeSchema,
    actor: actorSchema.optional(),
    work_item_id: idSchema.optional(),
    project_id: idSchema.optional(),
    session_id: idSchema.optional(),
    run_id: idSchema.optional(),
    proposal_id: idSchema.optional(),
    preview_text: z.string().max(200).optional(),
    cuu_state: cuuStateSchema.optional(),
    attention: attentionItemSchema.optional(),
    data: dataSchema
  });

export type WorkHubEvent<T> = {
  event_id: string;
  type: string;
  topic: string;
  ts: string;
  actor?: z.infer<typeof actorSchema>;
  work_item_id?: string;
  project_id?: string;
  session_id?: string;
  run_id?: string;
  proposal_id?: string;
  preview_text?: string;
  cuu_state?: CuuState;
  attention?: AttentionItem;
  data: T;
};
