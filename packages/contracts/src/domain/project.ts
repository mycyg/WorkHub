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

// R20 P2A（R19-19 项目归档/删除 · 纯后端）：归档=软置 archived=true（从团队列表隐去，可再建同名），
// 删除=软置 deletedAt（墓碑）。两端点均无请求体，管理员/项目所有者门控（canManageProjectDrive）。
// 响应回操作后的项目 VM 与一个操作标志（archived / deleted）——additive，既有客户端不用改。
export const archiveProjectResultSchema = z.object({
  project: projectVmSchema,
  archived: z.literal(true)
});
export type ArchiveProjectResult = z.infer<typeof archiveProjectResultSchema>;

export const deleteProjectResultSchema = z.object({
  project: projectVmSchema,
  deleted: z.literal(true)
});
export type DeleteProjectResult = z.infer<typeof deleteProjectResultSchema>;

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

// R16 批 W4a（项目级自定义指令 · 纯后端）：项目设置里的一段自由文本，注入该项目所有 Cuu 对话回复与
// agent-run 的 worker system prompt（优先级=高于通用默认、低于系统工作纪律——见
// packages/agent/src/turns/prompt.ts 的 buildTurnProjectInstructionsSection 与
// apps/api/src/services/project-instructions-context.ts 的同名 worker 侧实现）。留空（trim 后空串）
// 即不注入。长度上限与 user-profile 的 bio_md 同口径——.trim().max() 链式校验，超限直接抛 ZodError，
// 由 app.ts 的全局兜底转成 422 validation_error，不需要服务层另起一套错误码。
export const PROJECT_INSTRUCTIONS_MAX_CHARS = 4000;

const instructionsMdSchema = z.string().trim().max(PROJECT_INSTRUCTIONS_MAX_CHARS);

export const projectInstructionsVmSchema = z
  .object({
    project_id: idSchema,
    // 空串＝未配置自定义指令（DB 侧存 NULL，读侧折成 ""）——VM 字段本身不做 nullable，前端 textarea
    // 直接绑定即可,不需要额外的 null 判空。
    instructions_md: z.string(),
    updated_at: isoDateTimeSchema
  })
  .strict();
export type ProjectInstructionsVM = z.infer<typeof projectInstructionsVmSchema>;

export const patchProjectInstructionsRequestSchema = z
  .object({
    instructions_md: instructionsMdSchema
  })
  .strict();
export type PatchProjectInstructionsRequest = z.infer<typeof patchProjectInstructionsRequestSchema>;
