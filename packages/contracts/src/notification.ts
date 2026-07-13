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
  // R13 批 P2（拍板链路收尾）：dispatch_ask 通知深链到发起它的会话，好让气泡/追赶提醒能直接把用户
  // 带回那个会话（而不是只到工作项页）。additive——notifications 表本身没有 conversation_id 列，
  // 这批不碰迁移，服务端把它编码进 target_url 的查询参数里再解出来填这个字段（见
  // apps/api/src/services/notifications.ts 的 extractConversationIdFromTargetUrl）；旧数据/其它
  // 通知类型没有这个参数时，这个字段就不出现，老调用方不受影响。
  conversation_id: idSchema.optional(),
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
