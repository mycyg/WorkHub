import { z } from "zod";

import { idSchema } from "./common.js";

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

export const bootstrapProjectRequestSchema = z.object({
  name: z.string().min(1).max(128).optional(),
  slug: z.string().min(1).max(64).optional(),
  description: z.string().max(2000).optional()
});
export type BootstrapProjectRequest = z.infer<typeof bootstrapProjectRequestSchema>;

export const bootstrapProjectResultSchema = z.object({
  project: projectVmSchema,
  created: z.boolean(),
  context_ready: z.literal(true)
});
export type BootstrapProjectResult = z.infer<typeof bootstrapProjectResultSchema>;
