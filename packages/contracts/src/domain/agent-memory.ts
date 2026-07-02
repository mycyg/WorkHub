import { z } from "zod";

import { idSchema, isoDateTimeSchema } from "./common.js";
import { userMemoryCategorySchema } from "./user-memory.js";

export const agentMemoryRecordSchema = z.object({
  id: idSchema,
  workspace_id: idSchema,
  agent_context_id: idSchema,
  category: userMemoryCategorySchema,
  key: z.string().min(1).max(256),
  value_md: z.string().min(1),
  confidence: z.number().min(0).max(1),
  source_run_id: idSchema.optional(),
  base_version: z.number().int().min(0),
  current_version: z.number().int().positive(),
  created_at: isoDateTimeSchema,
  updated_at: isoDateTimeSchema
});
export type AgentMemoryRecord = z.infer<typeof agentMemoryRecordSchema>;

export const agentMemoryVersionRecordSchema = z.object({
  id: idSchema,
  memory_id: idSchema,
  version: z.number().int().positive(),
  base_version: z.number().int().min(0),
  value_md: z.string().min(1),
  source_run_id: idSchema.optional(),
  created_at: isoDateTimeSchema
});
export type AgentMemoryVersionRecord = z.infer<typeof agentMemoryVersionRecordSchema>;

export const agentMemoryUpsertInputSchema = z.object({
  workspace_id: idSchema,
  agent_context_id: idSchema,
  category: userMemoryCategorySchema,
  key: z.string().min(1).max(256),
  value_md: z.string().min(1),
  confidence: z.number().min(0).max(1).optional(),
  source_run_id: idSchema.optional(),
  base_version: z.number().int().min(0).optional()
});
export type AgentMemoryUpsertInput = z.infer<typeof agentMemoryUpsertInputSchema>;

export const AGENT_MEMORY_PROMPT_TOP_N = 5;
