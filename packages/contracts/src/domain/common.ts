import { z } from "zod";

export const idSchema = z.string().uuid();
export const isoDateTimeSchema = z.string().datetime({ offset: true });

export const timestampFieldsSchema = z.object({
  created_at: isoDateTimeSchema,
  updated_at: isoDateTimeSchema
});

export const actorSchema = z.object({
  actor_kind: z.enum(["human", "ai", "system"]),
  actor_user_id: idSchema.optional(),
  label: z.string().optional()
});
export type Actor = z.infer<typeof actorSchema>;
