import { z } from "zod";

import {
  taskPlanItemRoleSchema,
  taskPlanItemStatusSchema,
  taskPlanStatusSchema
} from "./enums.js";
import { idSchema, isoDateTimeSchema } from "./domain/common.js";

const jsonObjectSchema = z.record(z.string(), z.unknown());

export const taskPlanItemVmSchema = z.object({
  id: idSchema,
  plan_id: idSchema,
  parent_item_id: idSchema.nullable().optional(),
  seq: z.number().int().nonnegative(),
  title: z.string().min(1).max(256),
  role: taskPlanItemRoleSchema,
  objective_md: z.string().min(1),
  acceptance_md: z.string().min(1),
  budget_share_pct: z.number().int().min(0).max(100),
  depends_on: z.array(idSchema).default([]),
  status: taskPlanItemStatusSchema,
  created_at: isoDateTimeSchema,
  updated_at: isoDateTimeSchema
});
export type TaskPlanItemVM = z.infer<typeof taskPlanItemVmSchema>;

export const taskPlanVmSchema = z.object({
  id: idSchema,
  work_item_id: idSchema,
  workspace_id: idSchema,
  status: taskPlanStatusSchema,
  objective_id: idSchema.nullable().optional(),
  budget_json: jsonObjectSchema.default({}),
  decomposition_context_json: jsonObjectSchema.default({}),
  created_by: idSchema,
  created_at: isoDateTimeSchema,
  updated_at: isoDateTimeSchema,
  items: z.array(taskPlanItemVmSchema).max(50),
  items_capped: z.boolean().default(false)
});
export type TaskPlanVM = z.infer<typeof taskPlanVmSchema>;
