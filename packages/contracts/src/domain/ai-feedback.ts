import { z } from "zod";

import { isoDateTimeSchema } from "./common.js";

// R14 批 FEEDBACK：AI 产出的轻量二值反馈（有用/没用 + 可选一句话备注）。独立域文件而非塞进
// conversation.ts / pages.ts 任一个——反馈是跨三类主体（会话消息 / 提议 / 行动卡条目）的横切概念，
// 混进任何一个领域 schema 都会污染领域边界（照 domain/presence.ts 的既有先例，见 04-feedback-design.md §3）。

export const aiFeedbackVerdictSchema = z.enum(["useful", "not_useful"]);
export type AiFeedbackVerdict = z.infer<typeof aiFeedbackVerdictSchema>;

export const aiFeedbackSubjectTypeSchema = z.enum([
  "conversation_message",
  "proposal",
  "action_card_item"
]);
export type AiFeedbackSubjectType = z.infer<typeof aiFeedbackSubjectTypeSchema>;

// 可选一句话备注的硬顶（服务层 + 契约层同档次校验，见设计 §1/§2）。
export const AI_FEEDBACK_NOTE_MAX_CHARS = 200;

// 「我自己」对某个主体的判定——不带 user_id（VM 语境下天然是当前 actor：读聚合只读自己、不做全员
// 聚合，见 04-feedback-design.md §0 结论 2）。作为 additive optional 字段挂在消息 VM 上。
export const myAiFeedbackVmSchema = z
  .object({
    verdict: aiFeedbackVerdictSchema,
    note: z.string().max(AI_FEEDBACK_NOTE_MAX_CHARS).optional(),
    updated_at: isoDateTimeSchema
  })
  .strict();
export type MyAiFeedbackVM = z.infer<typeof myAiFeedbackVmSchema>;

// PUT /api/{...}/feedback 的请求体：二值判定 + 可选备注（≤200，超长在这一层就 400）。
export const putAiFeedbackRequestSchema = z
  .object({
    verdict: aiFeedbackVerdictSchema,
    note: z.string().max(AI_FEEDBACK_NOTE_MAX_CHARS).optional()
  })
  .strict();
export type PutAiFeedbackRequest = z.infer<typeof putAiFeedbackRequestSchema>;
