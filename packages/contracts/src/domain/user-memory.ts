import { z } from "zod";

import { idSchema, isoDateTimeSchema } from "./common.js";

// 用户级 memory 分类：
// - preference：AI 学到的用户风格（如"周报只要 markdown"）
// - correction：用户审批纠正的口径（如"交付物要 PDF 不要 DOCX"）
// - recurring_context：常出现的上下文片段（留作扩展）
export const userMemoryCategorySchema = z.enum(["preference", "correction", "recurring_context"]);
export type UserMemoryCategory = z.infer<typeof userMemoryCategorySchema>;

export const userMemoryRecordSchema = z.object({
  id: idSchema,
  user_id: idSchema,
  workspace_id: idSchema.optional(),
  category: userMemoryCategorySchema,
  key: z.string().min(1).max(256),
  value_md: z.string().min(1),
  confidence: z.number().min(0).max(1),
  source_run_id: idSchema.optional(),
  last_used_at: isoDateTimeSchema.optional(),
  created_at: isoDateTimeSchema,
  updated_at: isoDateTimeSchema
});
export type UserMemoryRecord = z.infer<typeof userMemoryRecordSchema>;

export const userMemoryUpsertInputSchema = z.object({
  user_id: idSchema,
  workspace_id: idSchema.optional(),
  category: userMemoryCategorySchema,
  key: z.string().min(1).max(256),
  value_md: z.string().min(1),
  confidence: z.number().min(0).max(1).optional(),
  source_run_id: idSchema.optional()
});
export type UserMemoryUpsertInput = z.infer<typeof userMemoryUpsertInputSchema>;

// 每用户活跃记忆硬上限（防爆，超限按 confidence × recency 驱逐）。
export const USER_MEMORY_MAX_ACTIVE_PER_USER = 50;
// 每次注入 worker prompt 的记忆条数。
export const USER_MEMORY_PROMPT_TOP_N = 5;
