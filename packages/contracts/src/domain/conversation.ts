import { z } from "zod";

import { idSchema } from "./common.js";

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

export const conversationMessageListQuerySchema = z
  .object({
    after_seq: safeIntegerInputSchema.default(0),
    limit: z.coerce.number().int().min(1).max(100).default(50)
  })
  .strict();
export type ConversationMessageListQuery = z.infer<typeof conversationMessageListQuerySchema>;

export const createConversationRequestSchema = z
  .object({
    // Main conversations are created atomically with projects, never through the public conversation endpoint.
    kind: z.literal("collab"),
    title: z.string().min(1).max(256),
    visibility: conversationVisibilitySchema,
    parent_conversation_id: idSchema.optional(),
    source_message_id: idSchema.optional()
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
