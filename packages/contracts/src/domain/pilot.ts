import { z } from "zod";

import { isoDateTimeSchema } from "./common.js";

export const pilotDay1MetricIdSchema = z.enum([
  "closed_loop_count",
  "proposal_adoption_rate",
  "escalation_count",
  "cost_per_merged_item_cny",
  "conflict_count",
  "notification_density"
]);
export type PilotDay1MetricId = z.infer<typeof pilotDay1MetricIdSchema>;

export const pilotDay1MetricStatusSchema = z.enum(["pass", "watch", "sample_insufficient"]);
export type PilotDay1MetricStatus = z.infer<typeof pilotDay1MetricStatusSchema>;

export const pilotDay1MetricSchema = z.object({
  id: pilotDay1MetricIdSchema,
  label_zh: z.string().min(1),
  label_en: z.string().min(1),
  value: z.string().min(1),
  unit: z.string().optional(),
  numerator: z.number(),
  denominator: z.number().nullable(),
  status: pilotDay1MetricStatusSchema,
  source_tables: z.array(z.string().min(1)).min(1)
});
export type PilotDay1Metric = z.infer<typeof pilotDay1MetricSchema>;

export const pilotDay1MetricsSnapshotSchema = z.object({
  generated_at: isoDateTimeSchema,
  range: z.object({
    from: isoDateTimeSchema,
    to: isoDateTimeSchema
  }),
  metrics: z.array(pilotDay1MetricSchema),
  raw_counts: z.object({
    work_items_created: z.number().int().nonnegative(),
    closed_loop_work_items: z.number().int().nonnegative(),
    proposals_opened: z.number().int().nonnegative(),
    proposals_reviewed: z.number().int().nonnegative(),
    proposals_merged: z.number().int().nonnegative(),
    proposals_rejected: z.number().int().nonnegative(),
    escalation_events: z.number().int().nonnegative(),
    approval_requests: z.number().int().nonnegative(),
    merge_conflict_attempts: z.number().int().nonnegative(),
    merge_conflict_instances: z.number().int().nonnegative(),
    notifications_created: z.number().int().nonnegative(),
    active_user_count: z.number().int().nonnegative(),
    submitter_count: z.number().int().nonnegative()
  }),
  cost: z.object({
    total_cost_cny: z.string(),
    token_in: z.number().int().nonnegative(),
    token_out: z.number().int().nonnegative(),
    unique_usage_records: z.number().int().nonnegative()
  }),
  gates: z.object({
    feedback_log_ready: z.boolean(),
    metrics_ready: z.boolean(),
    second_user_path_observed: z.boolean(),
    cost_nonzero: z.boolean(),
    conflict_counter_ready: z.boolean(),
    notification_density_ready: z.boolean()
  }),
  notes: z.array(z.string().min(1))
});
export type PilotDay1MetricsSnapshot = z.infer<typeof pilotDay1MetricsSnapshotSchema>;
