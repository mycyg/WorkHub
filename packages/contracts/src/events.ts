import { z } from "zod";

import { eventTypeSchema } from "./enums.js";
import { idSchema, isoDateTimeSchema } from "./domain/common.js";

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
