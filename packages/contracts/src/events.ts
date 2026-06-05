import { z } from "zod";

import { eventTypeSchema } from "./enums.js";
import { idSchema, isoDateTimeSchema } from "./domain/common.js";

export const topicKindSchema = z.enum(["all", "user", "workitem", "run", "session", "proposal", "job"]);
export type TopicKind = z.infer<typeof topicKindSchema>;

export const eventTopicSchema = z.object({
  kind: topicKindSchema,
  topic: z.string().min(1),
  id: z.string().optional()
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
