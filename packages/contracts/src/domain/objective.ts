import { z } from "zod";

import { keyResultStatusSchema, objectiveStatusSchema, taskPlanStatusSchema, workItemStatusSchema } from "../enums.js";
import { idSchema, isoDateTimeSchema } from "./common.js";

// R20 wave4（R19-1 OKR 前端接线）：镜像 apps/api/src/routes/objectives.ts 的请求/响应形状，
// 供 api-client 与 web 前端类型安全地调用「创建目标」「挂链工作项」两个既有端点。
export const createObjectiveKeyResultRequestSchema = z.object({
  title: z.string().trim().min(1).max(256),
  target_value: z.string().trim().max(64).optional(),
  current_value: z.string().trim().max(64).optional(),
  unit: z.string().trim().max(16).optional()
});
export type CreateObjectiveKeyResultRequest = z.infer<typeof createObjectiveKeyResultRequestSchema>;

export const createObjectiveRequestSchema = z.object({
  title: z.string().trim().min(1).max(256),
  description_md: z.string().trim().max(4_000).optional(),
  key_results: z.array(createObjectiveKeyResultRequestSchema).max(8).optional()
});
export type CreateObjectiveRequest = z.infer<typeof createObjectiveRequestSchema>;

export const createObjectiveResponseSchema = z.object({
  objective_id: idSchema,
  title: z.string().min(1),
  status: z.string().min(1),
  progress_percent: z.number().int()
});
export type CreateObjectiveResponse = z.infer<typeof createObjectiveResponseSchema>;

export const linkObjectiveRequestSchema = z.object({
  work_item_id: idSchema
});
export type LinkObjectiveRequest = z.infer<typeof linkObjectiveRequestSchema>;

export const linkObjectiveResponseSchema = z.object({
  objective_id: idSchema,
  work_item_id: idSchema
});
export type LinkObjectiveResponse = z.infer<typeof linkObjectiveResponseSchema>;

// R23 F-01（OKR 列表/详情持久化）：此前服务端只有「创建/挂链」两个写端点，项目主页 OKR 面板的列表
// 只是会话内内存态，刷新即失（见 apps/web/src/browser.ts 的 bindProjectHomeObjectivesPanel 旧注释）。
// 这里补列表（GET /api/projects/:id/objectives）与详情（GET /api/objectives/:id）两个读端点的响应契约。
// 目标是工作区级实体（objectives 表没有 project_id 列）——列表按 project_id 路由只是给项目主页一个
// 顺手的入口 URL，实际返回该项目所在工作区的全部目标，不做项目级过滤（与既有产品文案一致）。
export const objectiveListItemVmSchema = z.object({
  objective_id: idSchema,
  title: z.string().min(1),
  description_md: z.string().nullable(),
  status: objectiveStatusSchema,
  progress_percent: z.number().int(),
  owner_user_id: idSchema.nullable(),
  updated_at: isoDateTimeSchema
});
export type ObjectiveListItemVM = z.infer<typeof objectiveListItemVmSchema>;

export const listObjectivesResponseSchema = z.object({
  objectives: z.array(objectiveListItemVmSchema),
  capped: z.boolean()
});
export type ListObjectivesResponse = z.infer<typeof listObjectivesResponseSchema>;

export const objectiveKeyResultVmSchema = z.object({
  id: idSchema,
  seq: z.number().int(),
  title: z.string().min(1),
  target_value: z.string().nullable(),
  current_value: z.string().nullable(),
  unit: z.string().nullable(),
  status: keyResultStatusSchema,
  progress_percent: z.number().int()
});
export type ObjectiveKeyResultVM = z.infer<typeof objectiveKeyResultVmSchema>;

export const objectiveLinkedWorkItemVmSchema = z.object({
  id: idSchema,
  code: z.string().min(1),
  title: z.string().nullable(),
  status: workItemStatusSchema
});
export type ObjectiveLinkedWorkItemVM = z.infer<typeof objectiveLinkedWorkItemVmSchema>;

// taskPlans.objective_id 这条既有列此前从没有任何查询读过——详情页顺手把「挂了这个目标的执行计划」
// 也亮出来，否则这列数据在产品里永远不可见。
export const objectiveLinkedTaskPlanVmSchema = z.object({
  id: idSchema,
  work_item_id: idSchema,
  status: taskPlanStatusSchema,
  created_at: isoDateTimeSchema
});
export type ObjectiveLinkedTaskPlanVM = z.infer<typeof objectiveLinkedTaskPlanVmSchema>;

export const objectiveDetailResponseSchema = z.object({
  objective_id: idSchema,
  title: z.string().min(1),
  description_md: z.string().nullable(),
  status: objectiveStatusSchema,
  progress_percent: z.number().int(),
  owner_user_id: idSchema.nullable(),
  created_at: isoDateTimeSchema,
  updated_at: isoDateTimeSchema,
  key_results: z.array(objectiveKeyResultVmSchema),
  key_results_capped: z.boolean(),
  linked_work_items: z.array(objectiveLinkedWorkItemVmSchema),
  linked_work_items_capped: z.boolean(),
  linked_task_plans: z.array(objectiveLinkedTaskPlanVmSchema),
  linked_task_plans_capped: z.boolean()
});
export type ObjectiveDetailResponse = z.infer<typeof objectiveDetailResponseSchema>;
