import { z } from "zod";

import { idSchema } from "./common.js";

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
