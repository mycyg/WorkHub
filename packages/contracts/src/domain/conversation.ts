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

export const CUU_PROACTIVITY_VALUES = ["quiet", "balanced", "proactive"] as const;
export const DEFAULT_CUU_PROACTIVITY = "balanced" as const;
export const cuuProactivitySchema = z.enum(CUU_PROACTIVITY_VALUES);
export type CuuProactivity = z.infer<typeof cuuProactivitySchema>;

export const aiGranularSettingsSchema = z
  .object({
    create_work_item: z.boolean().optional(),
    dispatch_run: z.boolean().optional(),
    mutate_drive: z.boolean().optional(),
    send_notification: z.boolean().optional()
  })
  .strict();
export type AiGranularSettings = z.infer<typeof aiGranularSettingsSchema>;

const disabledAiQuietHoursSchema = z
  .object({
    enabled: z.literal(false)
  })
  .strict();

function isRuntimeSupportedTimeZone(value: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch (error) {
    if (error instanceof RangeError) {
      return false;
    }
    throw error;
  }
}

const enabledAiQuietHoursSchema = z
  .object({
    enabled: z.literal(true),
    timezone: z.string().min(1).max(64).refine(isRuntimeSupportedTimeZone, {
      message: "quiet-hours timezone must be supported by this runtime"
    }),
    start_minute: z.number().int().min(0).max(1439),
    end_minute: z.number().int().min(0).max(1439),
    weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7)
  })
  .strict();

export const aiQuietHoursSchema = z
  .discriminatedUnion("enabled", [disabledAiQuietHoursSchema, enabledAiQuietHoursSchema])
  .superRefine((value, ctx) => {
    if (value.enabled && value.start_minute === value.end_minute) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["end_minute"],
        message: "quiet-hours start and end minutes must differ"
      });
    }
    if (value.enabled && new Set(value.weekdays).size !== value.weekdays.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["weekdays"],
        message: "quiet-hours weekdays must be unique"
      });
    }
  });
export type AiQuietHours = z.infer<typeof aiQuietHoursSchema>;

export const DEFAULT_AI_QUIET_HOURS = { enabled: false } as const satisfies AiQuietHours;

const modelTierPreferenceSchema = z
  .string()
  .min(1)
  .max(32)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/u, "model tier preference must be a safe identifier");

export const patchUserAiProfileRequestSchema = z
  .object({
    default_mode: aiModeSchema.optional(),
    granular_settings: aiGranularSettingsSchema.optional(),
    dispatch_policy: dispatchPolicySchema.optional(),
    cuu_proactivity: cuuProactivitySchema.optional(),
    model_tier_preference: modelTierPreferenceSchema.nullable().optional()
  })
  .strict()
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: "user AI profile patch must include at least one field"
  });
export type PatchUserAiProfileRequest = z.infer<typeof patchUserAiProfileRequestSchema>;

export const patchProjectAiGovernanceRequestSchema = z
  .object({
    observer_enabled: z.boolean().optional(),
    silence_window_seconds: z.number().int().min(0).max(86400).optional(),
    quiet_hours: aiQuietHoursSchema.optional(),
    granular_settings: aiGranularSettingsSchema.optional()
  })
  .strict()
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: "project AI governance patch must include at least one field"
  });
export type PatchProjectAiGovernanceRequest = z.infer<typeof patchProjectAiGovernanceRequestSchema>;

export const executionHintSchema = z.enum(["server", "local", "any"]);
export type ExecutionHint = z.infer<typeof executionHintSchema>;

export const conversationFileCardContentSchema = z
  .object({
    drive_item_id: idSchema,
    snapshot_name: z.string().min(1).max(256)
  })
  .strict();
export type ConversationFileCardContent = z.infer<typeof conversationFileCardContentSchema>;

export const conversationFileCardRequestContentSchema = z
  .object({
    drive_item_id: idSchema
  })
  .strict();
export type ConversationFileCardRequestContent = z.infer<typeof conversationFileCardRequestContentSchema>;

export const MAX_CONVERSATION_TEXT_CODE_UNITS = 20_000;
export const conversationTextContentSchema = z
  .object({
    text: z.string().min(1).max(MAX_CONVERSATION_TEXT_CODE_UNITS)
  })
  .strict();
export type ConversationTextContent = z.infer<typeof conversationTextContentSchema>;

const safeIntegerInputSchema = z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const safeIntegerOutputSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
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
      content: conversationFileCardRequestContentSchema,
      thread_root_id: idSchema.optional()
    })
    .strict()
]);
export type CreateConversationMessageRequest = z.infer<typeof createConversationMessageRequestSchema>;

const conversationParticipantRoleSchema = z.enum(["owner", "member"]);

export const conversationVmSchema = z
  .object({
    id: idSchema,
    workspace_id: idSchema,
    project_id: idSchema,
    kind: conversationKindSchema,
    title: z.string().min(1).max(256),
    parent_conversation_id: idSchema.nullable(),
    source_message_id: idSchema.nullable(),
    visibility: conversationVisibilitySchema,
    next_seq: safeIntegerOutputSchema,
    created_by: idSchema.nullable(),
    participant_role: conversationParticipantRoleSchema.nullable(),
    created_at: isoDateTimeSchema,
    updated_at: isoDateTimeSchema
  })
  .strict();
export type ConversationVM = z.infer<typeof conversationVmSchema>;

export const conversationParticipantVmSchema = z
  .object({
    id: idSchema,
    conversation_id: idSchema,
    user_id: idSchema,
    role: conversationParticipantRoleSchema,
    created_at: isoDateTimeSchema,
    updated_at: isoDateTimeSchema
  })
  .strict();
export type ConversationParticipantVM = z.infer<typeof conversationParticipantVmSchema>;

export const createConversationResultVmSchema = z
  .object({
    conversation: conversationVmSchema,
    participants: z.array(conversationParticipantVmSchema).min(1).max(100)
  })
  .strict();
export type CreateConversationResultVM = z.infer<typeof createConversationResultVmSchema>;

const MAX_GENERIC_CONVERSATION_CONTENT_KEYS = 64;
const MAX_GENERIC_CONVERSATION_CONTENT_CODE_UNITS = 65_536;
const boundedConversationObjectContentSchema = z
  .record(z.string().min(1).max(128), z.unknown())
  .superRefine((content, ctx) => {
    if (Object.keys(content).length > MAX_GENERIC_CONVERSATION_CONTENT_KEYS) {
      ctx.addIssue({
        code: z.ZodIssueCode.too_big,
        origin: "object",
        maximum: MAX_GENERIC_CONVERSATION_CONTENT_KEYS,
        inclusive: true,
        message: "conversation content has too many fields"
      });
    }
    let serialized: string | undefined;
    try {
      serialized = JSON.stringify(content);
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "conversation content must be JSON serializable"
      });
      return;
    }
    if (serialized === undefined || serialized.length > MAX_GENERIC_CONVERSATION_CONTENT_CODE_UNITS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "conversation content exceeds the bounded JSON size"
      });
    }
  });

const conversationMessageBaseShape = {
  id: idSchema,
  conversation_id: idSchema,
  seq: safeIntegerOutputSchema,
  sender_type: conversationSenderTypeSchema,
  sender_user_id: idSchema.nullable(),
  thread_root_id: idSchema.nullable(),
  created_at: isoDateTimeSchema
} as const;

export const conversationMessageVmSchema = z.discriminatedUnion("kind", [
  z.object({
    ...conversationMessageBaseShape,
    kind: z.literal("text"),
    content: conversationTextContentSchema
  }).strict(),
  z.object({
    ...conversationMessageBaseShape,
    kind: z.literal("file_card"),
    content: conversationFileCardContentSchema
  }).strict(),
  z.object({
    ...conversationMessageBaseShape,
    kind: z.literal("action_card"),
    content: boundedConversationObjectContentSchema
  }).strict(),
  z.object({
    ...conversationMessageBaseShape,
    kind: z.literal("system_event"),
    content: boundedConversationObjectContentSchema
  }).strict(),
  z.object({
    ...conversationMessageBaseShape,
    kind: z.literal("tool_note"),
    content: boundedConversationObjectContentSchema
  }).strict()
]);
export type ConversationMessageVM = z.infer<typeof conversationMessageVmSchema>;

export const conversationListCursorVmSchema = z
  .object({
    afterCreatedAt: canonicalConversationCursorTimestampSchema,
    afterId: idSchema
  })
  .strict();
export type ConversationListCursorVM = z.infer<typeof conversationListCursorVmSchema>;

export const conversationListPageVmSchema = z
  .object({
    conversations: z.array(conversationVmSchema).max(100),
    capped: z.boolean(),
    next_cursor: conversationListCursorVmSchema.nullable()
  })
  .strict()
  .superRefine((page, ctx) => {
    if (page.capped !== (page.next_cursor !== null)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["next_cursor"],
        message: "conversation next cursor must be present exactly when the page is capped"
      });
    }
  });
export type ConversationListPageVM = z.infer<typeof conversationListPageVmSchema>;

export const conversationMessagePageVmSchema = z
  .object({
    messages: z.array(conversationMessageVmSchema).max(100),
    has_more: z.boolean(),
    next_after_seq: safeIntegerOutputSchema
  })
  .strict();
export type ConversationMessagePageVM = z.infer<typeof conversationMessagePageVmSchema>;
