import { z } from "zod";

import { eventTypeSchema } from "./enums.js";
import { idSchema, isoDateTimeSchema } from "./domain/common.js";
import { conversationMessageVmSchema } from "./domain/conversation.js";

export const topicKindSchema = z.enum([
  "all",
  "user",
  "workitem",
  "run",
  "session",
  "proposal",
  "job",
  "conversation"
]);
export type TopicKind = z.infer<typeof topicKindSchema>;

export const eventTopicSchema = z
  .object({
    kind: topicKindSchema,
    topic: z.string().min(1),
    id: z.string().optional()
  })
  .superRefine((value, ctx) => {
    if (value.kind !== "conversation") {
      return;
    }
    const parsedId = idSchema.safeParse(value.id);
    if (!parsedId.success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["id"],
        message: "conversation topic requires a UUID id"
      });
      return;
    }
    if (parsedId.data !== parsedId.data.toLowerCase()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["id"],
        message: "conversation topic UUID must use canonical lowercase form"
      });
    }
    if (value.topic !== `conversation:${parsedId.data}`) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["topic"],
        message: "conversation topic must match its UUID id"
      });
    }
  });
export type EventTopic = z.infer<typeof eventTopicSchema>;

export const workHubEventEnvelopeSchema = z.object({
  event_id: idSchema,
  type: eventTypeSchema,
  topic: z.string().min(1),
  ts: isoDateTimeSchema,
  preview_text: z.string().max(200).optional()
});
export type WorkHubEventEnvelope = z.infer<typeof workHubEventEnvelopeSchema>;

const conversationHumanActorSchema = z
  .object({
    actor_kind: z.literal("human"),
    actor_user_id: idSchema,
    label: z.string().optional()
  })
  .strict();

export const conversationMessageCreatedEventSchema = z
  .object({
    event_id: idSchema,
    type: z.literal("conversation.message.created"),
    topic: z.string().min(1),
    ts: isoDateTimeSchema,
    actor: conversationHumanActorSchema,
    project_id: idSchema,
    preview_text: z.string().max(200).optional(),
    data: conversationMessageVmSchema
  })
  .strict()
  .superRefine((event, ctx) => {
    if (event.topic !== `conversation:${event.data.conversation_id}`) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["topic"],
        message: "message-created topic must match data.conversation_id"
      });
    }
    if (event.data.sender_type !== "user") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["data", "sender_type"],
        message: "message-created events from the user POST must have a user sender"
      });
    }
    if (event.data.sender_user_id !== event.actor.actor_user_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["data", "sender_user_id"],
        message: "message-created sender must match the human event actor"
      });
    }
  });
export type ConversationMessageCreatedEvent = z.infer<typeof conversationMessageCreatedEventSchema>;

const typingTimestampSchema = z.string().datetime({ offset: true, precision: 3 });

export const conversationPresenceTypingEventSchema = z
  .object({
    event_id: idSchema,
    type: z.literal("conversation.presence.typing"),
    topic: z.string().min(1),
    ts: typingTimestampSchema,
    actor: conversationHumanActorSchema,
    data: z
      .object({
        conversation_id: idSchema,
        user_id: idSchema,
        ttl_ms: z.literal(3000),
        expires_at: typingTimestampSchema
      })
      .strict()
  })
  .strict()
  .superRefine((event, ctx) => {
    if (event.topic !== `conversation:${event.data.conversation_id}`) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["topic"],
        message: "typing topic must match data.conversation_id"
      });
    }
    if (event.actor.actor_user_id !== event.data.user_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["actor", "actor_user_id"],
        message: "typing actor must match data.user_id"
      });
    }
    if (Date.parse(event.data.expires_at) - Date.parse(event.ts) !== 3000) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["data", "expires_at"],
        message: "typing expires_at must be exactly 3000ms after event ts"
      });
    }
  });
export type ConversationPresenceTypingEvent = z.infer<typeof conversationPresenceTypingEventSchema>;
