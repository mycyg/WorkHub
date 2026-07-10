import { z } from "zod";

import { idSchema, isoDateTimeSchema } from "./domain/common.js";

export const notificationSeveritySchema = z.enum(["normal", "high", "urgent"]);
export type NotificationSeverity = z.infer<typeof notificationSeveritySchema>;

export const notificationSchema = z.object({
  id: idSchema,
  user_id: idSchema,
  type: z.string().min(1).max(64),
  severity: notificationSeveritySchema,
  title: z.string().min(1).max(256),
  body: z.string().optional(),
  target_url: z.string().optional(),
  project_id: idSchema.optional(),
  work_item_id: idSchema.optional(),
  dedupe_key: z.string().max(256).optional(),
  read_at: isoDateTimeSchema.optional(),
  archived_at: isoDateTimeSchema.optional(),
  created_at: isoDateTimeSchema,
  updated_at: isoDateTimeSchema
});
export type Notification = z.infer<typeof notificationSchema>;

export const notificationListSchema = z.object({
  items: z.array(notificationSchema),
  counts: z.object({
    unread: z.number().int().nonnegative(),
    total: z.number().int().nonnegative()
  }),
  // R4（规模化）：列表被 200 上限封顶时为 true。
  capped: z.boolean().optional()
});
export type NotificationList = z.infer<typeof notificationListSchema>;
