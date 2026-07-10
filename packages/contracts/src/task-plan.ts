import { z } from "zod";

import {
  taskPlanItemRoleSchema,
  taskPlanItemStatusSchema,
  taskPlanStatusSchema
} from "./enums.js";
import { idSchema, isoDateTimeSchema } from "./domain/common.js";

const jsonObjectSchema = z.record(z.string(), z.unknown());

// R9-BLOCK-7.154：计划提议 manifest 里承载「人审后的子任务清单」的结构化形状。
// 合入时按它整批写回 task_plan_items——没有它，审批工作台的行内编辑只会改
// markdown 文本，真正派发的还是 AI 草稿原样。id 必填（编辑器新增行时生成），
// depends_on 必须引用同批 id（写回前做图校验）。
export const taskPlanReviewedItemSchema = z.object({
  id: idSchema,
  seq: z.number().int().nonnegative(),
  title: z.string().min(1).max(256),
  role: taskPlanItemRoleSchema,
  objective_md: z.string().min(1).max(8_000),
  acceptance_md: z.string().min(1).max(8_000),
  budget_share_pct: z.number().int().min(0).max(100),
  depends_on: z.array(idSchema).max(50).default([])
});
export type TaskPlanReviewedItem = z.infer<typeof taskPlanReviewedItemSchema>;

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
