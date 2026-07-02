import { z } from "zod";

import { idSchema, isoDateTimeSchema } from "./common.js";

export const projectVmSchema = z.object({
  id: idSchema,
  workspace_id: idSchema.nullable().optional(),
  name: z.string().min(1).max(128),
  slug: z.string().min(1).max(64),
  description: z.string().optional(),
  owner_nickname: z.string().min(1).max(64),
  owner_user_id: idSchema.nullable().optional()
});
export type ProjectVM = z.infer<typeof projectVmSchema>;

// 项目清单条目(桌面「项目」页 + 跨项目概览)。在 ProjectVM 基础上带归档态、时间戳与
// 「进行中工作项」计数(状态非 merged/done/cancelled 且未删除)。
export const projectListItemVmSchema = projectVmSchema.extend({
  archived: z.boolean(),
  created_at: isoDateTimeSchema,
  updated_at: isoDateTimeSchema,
  open_work_item_count: z.number().int().nonnegative()
});
export type ProjectListItemVM = z.infer<typeof projectListItemVmSchema>;

export const projectListVmSchema = z.object({
  generated_at: isoDateTimeSchema,
  projects: z.array(projectListItemVmSchema)
});
export type ProjectListVM = z.infer<typeof projectListVmSchema>;

export const bootstrapProjectRequestSchema = z.object({
  name: z.string().trim().min(1).max(128).optional(),
  slug: z.string().trim().min(1).max(64).optional(),
  description: z.string().max(2000).optional()
});
export type BootstrapProjectRequest = z.infer<typeof bootstrapProjectRequestSchema>;

export const bootstrapProjectResultSchema = z.object({
  project: projectVmSchema,
  created: z.boolean(),
  context_ready: z.literal(true)
});
export type BootstrapProjectResult = z.infer<typeof bootstrapProjectResultSchema>;
