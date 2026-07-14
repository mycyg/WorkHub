import { z } from "zod";

import { idSchema, isoDateTimeSchema } from "./common.js";

// R14 CHAT 批（presence-observer 工包）：GET /api/presence 响应形状。独立域文件而非塞进
// conversation.ts——presence 是「用户当前是否在线」的横切概念，不属于任何一个会话，跟已经很拥挤的
// 会话/消息/参与者 schema 混在一起会污染领域边界（照 01-chat-design.md §4 的拍板：presence 契约
// 新文件 packages/contracts/src/domain/presence.ts，不与会话域混写）。
export const presenceEntryVmSchema = z
  .object({
    user_id: idSchema,
    is_online: z.boolean(),
    // 从未见过任何在线信号的用户（刚建号、从没开过任何长连接）：last_seen_at 为 null，
    // is_online 恒为 false——不编造一个虚假的「首次出现」时间戳（render.test.ts:80「不许编造在线态」
    // 断言同一原则：没有真数据就不渲染在线态，这里对应服务端不编造 last_seen_at）。
    last_seen_at: isoDateTimeSchema.nullable()
  })
  .strict();
export type PresenceEntryVm = z.infer<typeof presenceEntryVmSchema>;

export const presenceListResponseSchema = z
  .object({
    presence: z.array(presenceEntryVmSchema)
  })
  .strict();
export type PresenceListResponse = z.infer<typeof presenceListResponseSchema>;
