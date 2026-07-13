import { z } from "zod";

import { idSchema, isoDateTimeSchema } from "./common.js";

export const projectVmSchema = z.object({
  id: idSchema,
  workspace_id: idSchema.nullable().optional(),
  name: z.string().min(1).max(128),
  slug: z.string().min(1).max(64),
  description: z.string().optional(),
  owner_nickname: z.string().min(1).max(64),
  owner_user_id: idSchema.nullable().optional(),
  // R13 批 S3（个人空间）：additive——省略/false=普通团队项目（既有客户端不用改），true=owner 名下的
  // 个人空间。团队项目列表（GET /api/projects）与个人空间列表（GET /api/projects/personal）是两个
  // 互斥的数据源，桌面 rail 按调用的是哪个端点分组，不靠这个字段本身做二次前端过滤。
  is_personal: z.boolean().optional()
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

// R13 批 S3（个人空间）：创建请求只填名字（可省略——服务端按「我的空间」/「我的空间 2」…自动命名）。
// 不需要 workspace_id/slug/成员邀请这些团队项目才有的字段——个人空间跳过治理/邀请这一整套步骤。
export const createPersonalProjectRequestSchema = z.object({
  name: z.string().trim().min(1).max(128).optional()
});
export type CreatePersonalProjectRequest = z.infer<typeof createPersonalProjectRequestSchema>;

// 响应形状与团队项目 bootstrap 复用同一个 BootstrapProjectResult——个人空间创建也是「建好即可用」
// （主区会话已就绪），语义上和团队项目 bootstrap 的 context_ready 完全一致，不另开一份契约。
export const createPersonalProjectResultSchema = bootstrapProjectResultSchema;
export type CreatePersonalProjectResult = BootstrapProjectResult;
