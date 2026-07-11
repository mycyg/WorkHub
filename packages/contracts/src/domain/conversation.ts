import { z } from "zod";

import { idSchema, isoDateTimeSchema } from "./common.js";

export const conversationKindSchema = z.enum(["main", "collab"]);
export type ConversationKind = z.infer<typeof conversationKindSchema>;

export const conversationVisibilitySchema = z.enum(["project", "private"]);
export type ConversationVisibility = z.infer<typeof conversationVisibilitySchema>;

export const conversationSenderTypeSchema = z.enum(["user", "cuu", "system"]);
export type ConversationSenderType = z.infer<typeof conversationSenderTypeSchema>;

export const conversationMessageKindSchema = z.enum([
  "text",
  "file_card",
  "action_card",
  "system_event",
  "tool_note"
]);
export type ConversationMessageKind = z.infer<typeof conversationMessageKindSchema>;

export const aiModeSchema = z.number().int().min(1).max(5);
export type AiMode = z.infer<typeof aiModeSchema>;

export const dispatchPolicySchema = z.enum(["auto", "ask", "manual"]);
export type DispatchPolicy = z.infer<typeof dispatchPolicySchema>;

export const executionHintSchema = z.enum(["server", "local", "any"]);
export type ExecutionHint = z.infer<typeof executionHintSchema>;

export const conversationFileCardContentSchema = z
  .object({
    drive_item_id: idSchema,
    snapshot_name: z.string().min(1).max(256)
  })
  .strict();
export type ConversationFileCardContent = z.infer<typeof conversationFileCardContentSchema>;

const conversationTextContentSchema = z
  .object({
    text: z.string().min(1)
  })
  .strict();

const safeIntegerInputSchema = z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const canonicalConversationCursorTimestampSchema = isoDateTimeSchema.regex(
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/u,
  "conversation cursor timestamp must be canonical UTC with six fractional digits"
);

export const conversationMessageListQuerySchema = z
  .object({
    afterSeq: safeIntegerInputSchema.default(0),
    limit: z.coerce.number().int().min(1).max(100).default(50)
  })
  .strict();
export type ConversationMessageListQuery = z.infer<typeof conversationMessageListQuerySchema>;

export const conversationListQuerySchema = z
  .object({
    afterCreatedAt: canonicalConversationCursorTimestampSchema.optional(),
    afterId: idSchema.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50)
  })
  .strict()
  .superRefine((value, ctx) => {
    if ((value.afterCreatedAt === undefined) !== (value.afterId === undefined)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: value.afterCreatedAt === undefined ? ["afterCreatedAt"] : ["afterId"],
        message: "conversation cursor requires both afterCreatedAt and afterId"
      });
    }
  });
export type ConversationListQuery = z.infer<typeof conversationListQuerySchema>;

export const createConversationRequestSchema = z
  .object({
    // Main conversations are created atomically with projects, never through the public conversation endpoint.
    kind: z.literal("collab"),
    title: z.string().min(1).max(256),
    visibility: conversationVisibilitySchema,
    parent_conversation_id: idSchema.optional(),
    source_message_id: idSchema.optional(),
    participant_user_ids: z.array(idSchema).max(99).default([])
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.source_message_id && !value.parent_conversation_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["parent_conversation_id"],
        message: "source message requires a parent conversation"
      });
    }
    if (
      new Set(value.participant_user_ids.map((userId) => userId.toLowerCase())).size !==
      value.participant_user_ids.length
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["participant_user_ids"],
        message: "participant user IDs must be unique"
      });
    }
  });
export type CreateConversationRequest = z.infer<typeof createConversationRequestSchema>;

export const createConversationMessageRequestSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("text"),
      content: conversationTextContentSchema,
      thread_root_id: idSchema.optional()
    })
    .strict(),
  z
    .object({
      kind: z.literal("file_card"),
      content: conversationFileCardContentSchema,
      thread_root_id: idSchema.optional()
    })
    .strict()
]);
export type CreateConversationMessageRequest = z.infer<typeof createConversationMessageRequestSchema>;
