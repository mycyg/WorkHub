import { z } from "zod";

import { actorKindSchema } from "./enums.js";
import { idSchema, isoDateTimeSchema } from "./domain/common.js";

export const identityContextSchema = z.object({
  actor_kind: actorKindSchema,
  actor_id: z.string().min(1),
  actor_label: z.string().min(1),
  user_id: idSchema.optional(),
  org_id: idSchema,
  workspace_id: idSchema,
  is_admin: z.boolean().default(false)
});
export type IdentityContext = z.infer<typeof identityContextSchema>;

export const streamUserSchema = z.object({
  id: idSchema,
  nickname: z.string().min(1).max(64)
});
export type StreamUser = z.infer<typeof streamUserSchema>;

export const authTenantContextSchema = z.object({
  org_id: idSchema,
  workspace_id: idSchema,
  resolved_at: isoDateTimeSchema
});
export type AuthTenantContext = z.infer<typeof authTenantContextSchema>;
