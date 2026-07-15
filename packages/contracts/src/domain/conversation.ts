import { z } from "zod";

import { myAiFeedbackVmSchema } from "./ai-feedback.js";
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

// R14 批 CHAT：精选五键反应。存储/契约层全程 ASCII slug——emoji 字形只存在于桌面渲染层的
// slug→字形映射常量（approve=赞、disagree=踩、done=完成、question=疑问、watch=关注），绝不进契约/
// css.ts/icons.ts/文档。扩充键集须回 r14-release-readiness/01-chat-design.md 改表。
export const conversationReactionKeySchema = z.enum([
  "approve",
  "disagree",
  "done",
  "question",
  "watch"
]);
export type ConversationReactionKey = z.infer<typeof conversationReactionKeySchema>;
// reaction 展示层文案上限（user_ids 单键封顶——聚合读取端点已 cap，契约层做同档次的防御性上限）。
export const MAX_CONVERSATION_REACTION_USER_IDS = 500;
// 引用预览文本硬顶（≤80 code units，读时 join 目标消息裁剪得到）。
export const MAX_CONVERSATION_REPLY_PREVIEW_CODE_UNITS = 80;

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

export const DEFAULT_USER_AI_PROFILE = {
  default_mode: 3,
  granular_settings: {},
  dispatch_policy: "auto",
  cuu_proactivity: DEFAULT_CUU_PROACTIVITY,
  model_tier_preference: null
} as const satisfies {
  default_mode: AiMode;
  granular_settings: AiGranularSettings;
  dispatch_policy: DispatchPolicy;
  cuu_proactivity: CuuProactivity;
  model_tier_preference: string | null;
};

// R14 批 RISK（风险预警巡检，2026-07-14 用户拍板范围）：项目级三信号巡检阈值——工单停滞天数/
// deadline 前瞻窗口/成本放量比例与下限。全部字段可选（PATCH 语义：只传要改的键），读侧用
// DEFAULT_RISK_MONITOR_SETTINGS 做完整默认值合并输出（见 projectAiGovernanceVmSchema.risk_monitor）。
// 语义上是「阈值」而非 aiGranularSettingsSchema 那种布尔开关集，不合并进同一列/同一 schema。
export const riskMonitorSettingsSchema = z
  .object({
    enabled: z.boolean().optional(),
    stall_days_threshold: z.number().int().min(1).max(90).optional(),
    deadline_lookahead_days: z.number().int().min(0).max(30).optional(),
    cost_spike_ratio_pct: z.number().int().min(100).max(2000).optional(),
    cost_spike_min_cny: z.number().finite().nonnegative().optional()
  })
  .strict();
export type RiskMonitorSettings = z.infer<typeof riskMonitorSettingsSchema>;

export const DEFAULT_RISK_MONITOR_SETTINGS = {
  enabled: true,
  stall_days_threshold: 5,
  deadline_lookahead_days: 2,
  cost_spike_ratio_pct: 300,
  cost_spike_min_cny: 20
} as const satisfies Required<RiskMonitorSettings>;

export const DEFAULT_PROJECT_AI_GOVERNANCE = {
  observer_enabled: true,
  silence_window_seconds: 60,
  quiet_hours: DEFAULT_AI_QUIET_HOURS,
  granular_settings: {},
  risk_monitor: DEFAULT_RISK_MONITOR_SETTINGS
} as const satisfies {
  observer_enabled: boolean;
  silence_window_seconds: number;
  quiet_hours: AiQuietHours;
  granular_settings: AiGranularSettings;
  risk_monitor: RiskMonitorSettings;
};

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
    granular_settings: aiGranularSettingsSchema.optional(),
    risk_monitor: riskMonitorSettingsSchema.optional()
  })
  .strict()
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: "project AI governance patch must include at least one field"
  });
export type PatchProjectAiGovernanceRequest = z.infer<typeof patchProjectAiGovernanceRequestSchema>;

const nonnegativeCnySchema = z.string().regex(/^\d+(?:\.\d+)?$/u);

export const aiProviderModelVmSchema = z
  .object({
    id: modelTierPreferenceSchema,
    model: z.string().min(1).max(128),
    display_name: z.string().min(1).max(128),
    context_window_tokens: z.number().int().positive(),
    supports_streaming: z.boolean(),
    supports_tools: z.boolean(),
    cost_input_cny_per_mtok: z.number().finite().nonnegative(),
    cost_output_cny_per_mtok: z.number().finite().nonnegative()
  })
  .strict();
export type AiProviderModelVM = z.infer<typeof aiProviderModelVmSchema>;

export const aiProviderVmSchema = z
  .object({
    name: z.string().min(1).max(64),
    configured: z.boolean(),
    default_model_id: modelTierPreferenceSchema,
    models: z.array(aiProviderModelVmSchema).min(1).max(100)
  })
  .strict()
  .superRefine((provider, ctx) => {
    const modelIds = provider.models.map((model) => model.id);
    if (new Set(modelIds).size !== modelIds.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["models"],
        message: "provider model IDs must be unique"
      });
    }
    if (!modelIds.includes(provider.default_model_id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["default_model_id"],
        message: "provider default model ID must be present in models"
      });
    }
  });
export type AiProviderVM = z.infer<typeof aiProviderVmSchema>;

export const aiDailyQuotaVmSchema = z
  .object({
    policy_id: z.string().min(1),
    period: z.literal("day"),
    max_tokens: z.number().int().positive(),
    max_cost_cny: nonnegativeCnySchema,
    enabled: z.boolean()
  })
  .strict();
export type AiDailyQuotaVM = z.infer<typeof aiDailyQuotaVmSchema>;

function aiUsagePeriodVmSchema<TPeriod extends "day" | "month">(period: TPeriod) {
  return z
    .object({
      period: z.literal(period),
      token_in: z.number().int().nonnegative(),
      token_out: z.number().int().nonnegative(),
      total_tokens: z.number().int().nonnegative(),
      estimated_cost_cny: nonnegativeCnySchema
    })
    .strict();
}

export const aiDayUsageVmSchema = aiUsagePeriodVmSchema("day");
export type AiDayUsageVM = z.infer<typeof aiDayUsageVmSchema>;
export const aiMonthUsageVmSchema = aiUsagePeriodVmSchema("month");
export type AiMonthUsageVM = z.infer<typeof aiMonthUsageVmSchema>;

export const aiBudgetSummaryVmSchema = z
  .object({
    daily_quota: aiDailyQuotaVmSchema.nullable(),
    usage: z
      .object({
        day: aiDayUsageVmSchema,
        month: aiMonthUsageVmSchema
      })
      .strict()
  })
  .strict();
export type AiBudgetSummaryVM = z.infer<typeof aiBudgetSummaryVmSchema>;

export const userAiProfileVmSchema = z
  .object({
    workspace_id: idSchema,
    user_id: idSchema,
    default_mode: aiModeSchema,
    granular_settings: aiGranularSettingsSchema,
    dispatch_policy: dispatchPolicySchema,
    cuu_proactivity: cuuProactivitySchema,
    model_tier_preference: modelTierPreferenceSchema.nullable(),
    providers: z.array(aiProviderVmSchema).max(100),
    budget_summary: aiBudgetSummaryVmSchema,
    generated_at: isoDateTimeSchema,
    updated_at: isoDateTimeSchema.nullable()
  })
  .strict();
export type UserAiProfileVM = z.infer<typeof userAiProfileVmSchema>;

export const projectAiGovernanceVmSchema = z
  .object({
    project_id: idSchema,
    observer_enabled: z.boolean(),
    silence_window_seconds: z.number().int().min(0).max(86400),
    quiet_hours: aiQuietHoursSchema,
    granular_settings: aiGranularSettingsSchema,
    // R14 批 RISK：读侧用 DEFAULT_RISK_MONITOR_SETTINGS 做完整默认值合并输出——字段全部有值，
    // 非 partial（设置 UI 要显示当前生效阈值，不是「哪些被覆盖了」），与 granular_settings 的
    // 「只输出用户设过的键」刻意不同口径。
    risk_monitor: riskMonitorSettingsSchema,
    updated_at: isoDateTimeSchema.nullable()
  })
  .strict();
export type ProjectAiGovernanceVM = z.infer<typeof projectAiGovernanceVmSchema>;

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

// R12 批4a：Cuu 协同回应携带的记忆/技能引用清单（回应组装时实际注入过哪些条目）。additive——
// 只在 text 内容上新增一个 optional 字段，人类发的文本消息不受影响（仓库层 createUserMessage 的
// assertMessageContent 仍然只接受唯一 text 键，这个字段只会出现在 createCuuMessage 落库的消息上）。
export const conversationMemoryCitationSchema = z
  .object({
    kind: z.enum(["user_memory", "team_skill"]),
    title: z.string().min(1).max(256)
  })
  .strict();
export type ConversationMemoryCitation = z.infer<typeof conversationMemoryCitationSchema>;

export const MAX_CONVERSATION_MEMORY_CITATIONS = 20;

export const MAX_CONVERSATION_TEXT_CODE_UNITS = 20_000;
export const MAX_CONVERSATION_CLARIFY_OPTIONS = 8;
// R13 批4c（Cuu 对话工具面）：additive 澄清追问标记。设计稿（r13-workbench-refinement/
// 01-new-batches-design.md 一、批4c）原本提议新增一个 DB kind `clarifying_question`，但本批范围围栏
// 明确不许碰 schema/迁移——改为在既有 kind='text' 内容上加三个 optional 字段：不新增 DB kind、不需要
// 迁移，旧的纯文本消息（不带这些字段）完全不受影响。is_clarifying_question 缺省视为 false；
// clarify_options/clarify_placeholder 只在 is_clarifying_question=true 时有意义（服务层/前端按此
// 约定渲染，这里不做跨字段 superRefine——保持 additive 精神，不给既有字段追加新的失败模式）。
export const conversationTextContentSchema = z
  .object({
    text: z.string().min(1).max(MAX_CONVERSATION_TEXT_CODE_UNITS),
    memory_citations: z.array(conversationMemoryCitationSchema).max(MAX_CONVERSATION_MEMORY_CITATIONS).optional(),
    is_clarifying_question: z.boolean().optional(),
    clarify_options: z.array(z.string().min(1).max(200)).max(MAX_CONVERSATION_CLARIFY_OPTIONS).optional(),
    clarify_placeholder: z.string().min(1).max(200).optional()
  })
  .strict();
export type ConversationTextContent = z.infer<typeof conversationTextContentSchema>;

const safeIntegerInputSchema = z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const safeIntegerOutputSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const canonicalConversationCursorTimestampSchema = isoDateTimeSchema.regex(
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/u,
  "conversation cursor timestamp must be canonical UTC with six fractional digits"
);

const conversationMessageListLimitSchema = z.coerce.number().int().min(1).max(100).default(50);

// R12 批8：反向翻页游标。与 afterSeq 互斥——两个 union 分支都是 .strict()，任一分支收到对方的键都会
// 因为“未识别字段”整体校验失败，不需要额外的 superRefine 就能天然表达互斥；先试 beforeSeq 分支再试
// afterSeq 分支，保证 {} 或只给 afterSeq 时行为与批 0 完全一致（afterSeq 分支的 default(0) 兜底）。
const conversationMessageListBeforeQuerySchema = z
  .object({
    beforeSeq: safeIntegerInputSchema,
    limit: conversationMessageListLimitSchema
  })
  .strict();
const conversationMessageListAfterQuerySchema = z
  .object({
    afterSeq: safeIntegerInputSchema.default(0),
    limit: conversationMessageListLimitSchema
  })
  .strict();

export const conversationMessageListQuerySchema = z.union([
  conversationMessageListBeforeQuerySchema,
  conversationMessageListAfterQuerySchema
]);
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
    participant_user_ids: z.array(idSchema).max(99).default([]),
    // R13 批 G1（小群）：会话级「Cuu 是否参与」硬开关——additive optional，default(true) 保持既有
    // 调用方（未传这个字段的存量客户端）行为零回归。false 时 conversation-turns.ts 的 createTurn
    // 会在任何回话判定之前直接 409 conversation_turn_cuu_disabled，见该服务顶部注释。
    cuu_enabled: z.boolean().default(true)
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

// R14FIX 批 workbench（会话重命名，2026-07-15 用户反馈：协同会话需要能改名）——PATCH
// /api/conversations/:id 的请求体，只带新标题。长度与 createConversationRequestSchema.title 对称
// （min 1、max 256）。additive 独立 schema，不改任何既有 schema/调用方；语义红线（仅 collab 会话可
// 改名、仅参与者/owner）在服务层强制（见 apps/api/src/services/conversations.ts renameConversation）。
export const renameConversationRequestSchema = z
  .object({
    title: z.string().min(1).max(256)
  })
  .strict();
export type RenameConversationRequest = z.infer<typeof renameConversationRequestSchema>;
// 重命名成功的响应 VM 定义在 conversationVmSchema 之后（引用它），避免 const 使用前声明——同
// conversationPinsVmSchema 的既有取舍。见本文件下方 renameConversationResultVmSchema。

// R14 批 CHAT：编辑消息请求体——只带新正文（仅 text 消息可编辑，kind 判定在服务/仓库层）。text 的
// 长度约束与创建侧对齐（min 1、上限同 MAX_CONVERSATION_TEXT_CODE_UNITS）。
export const editConversationMessageRequestSchema = z
  .object({
    text: z.string().min(1).max(MAX_CONVERSATION_TEXT_CODE_UNITS)
  })
  .strict();
export type EditConversationMessageRequest = z.infer<typeof editConversationMessageRequestSchema>;

// R14 批 CHAT：已读游标推进请求体——单调夹紧在服务端做，请求只声明「我读到 seq 几了」。
export const advanceReadCursorRequestSchema = z
  .object({
    last_read_seq: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
  })
  .strict();
export type AdvanceReadCursorRequest = z.infer<typeof advanceReadCursorRequestSchema>;

// R14 批 CHAT：读游标读取端点（GET /receipts）的输出——聚合式「已读 N/M」在上层算，这里只回原始游标。
export const conversationReadReceiptVmSchema = z
  .object({
    user_id: idSchema,
    last_read_seq: safeIntegerOutputSchema
  })
  .strict();
export type ConversationReadReceiptVM = z.infer<typeof conversationReadReceiptVmSchema>;

export const conversationReadReceiptsVmSchema = z
  .object({
    receipts: z.array(conversationReadReceiptVmSchema).max(500)
  })
  .strict();
export type ConversationReadReceiptsVM = z.infer<typeof conversationReadReceiptsVmSchema>;

export const conversationReadCursorVmSchema = z
  .object({
    last_read_seq: safeIntegerOutputSchema
  })
  .strict();
export type ConversationReadCursorVM = z.infer<typeof conversationReadCursorVmSchema>;

export const createConversationMessageRequestSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("text"),
      content: conversationTextContentSchema,
      thread_root_id: idSchema.optional(),
      // R14 批 CHAT（引用回复）：仅 text 新消息可带引用；目标须同会话、存在、未删除（服务/仓库层校验，
      // 对已删目标回 400）。additive optional——不带这个字段的存量客户端行为零回归。
      reply_to_message_id: idSchema.optional()
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
    // R13 批 G1（小群）：与请求侧 cuu_enabled 对称——服务端总是产出一个具体值（DB 列 default true，
    // 存量行迁移时全部回填 true），VM 输出侧不是 optional。
    cuu_enabled: z.boolean(),
    // R15 批 B（人对人私聊）：additive optional——由 dm_key 非空推导，只在 DM 会话上输出 true，普通
    // 会话（团队主区/协同/个人空间）这个键完全不出现（不是出现后填 false）。存量客户端读不带这个键
    // 的会话 VM 行为零回归；认识它的客户端据此渲染「私聊」而非「协同会话」形态。
    is_dm: z.boolean().optional(),
    // R15 批 A（A4 未读聚合）：additive optional——当前 viewer 在这条会话里的未读消息数（seq > 读游标、
    // 未删除的墓碑不计、不含自己发的消息）。只在会话列表 VM（workbench 页面的 conversations 段）组装时
    // 由一条聚合 SQL 一次算齐所有可见会话（禁 N+1），单条 create/open/rename 结果 VM 不带这个键
    // （新建/刚开的会话未读恒 0，无需查询）。存量客户端读不带这个键的 VM 行为零回归。
    unread_count: safeIntegerOutputSchema.optional(),
    created_at: isoDateTimeSchema,
    updated_at: isoDateTimeSchema
  })
  .strict();
export type ConversationVM = z.infer<typeof conversationVmSchema>;

// R15 批 B（人对人私聊）：POST /api/dm/open 的请求体——只带私聊对象的 user_id（目标须与调用者同工作区
// 活跃成员、且不是自己；校验在服务/仓库层）。
export const openDmRequestSchema = z
  .object({
    user_id: idSchema
  })
  .strict();
export type OpenDmRequest = z.infer<typeof openDmRequestSchema>;

// 开聊成功的响应——回既有会话列表接口同款的 conversation VM（带 is_dm=true、participant_role=owner），
// 客户端据此直接打开该会话。定义在 conversationVmSchema 之后（引用它），避免 const 使用前声明——同
// renameConversationResultVmSchema/conversationPinsVmSchema 的既有取舍。
export const openDmResultVmSchema = z
  .object({
    conversation: conversationVmSchema
  })
  .strict();
export type OpenDmResultVM = z.infer<typeof openDmResultVmSchema>;

// R15 批 B（人对人私聊）：GET /api/dm/list —— 当前 actor 参与的 DM 会话列表。DM 容器项目对项目树/项目
// 列表/工作台 VM 全线围栏（findWorkbenchAccess/listProjects fail-closed），所以 DM 会话在左栏没有任何
// 常规入口——这个窄口是「私聊」分组唯一的数据源，参与者门控（服务层只回 actor 是 participant 的 DM）。
// 每条 DM 固定 2 名活跃参与者（self + 对方），participants 同时给了「对方昵称」（rail 私聊行渲染）与
// 「本会话真实参与者集合」（桌面 chat 视图据此把已读 N/M 的分母收敛成 1/1，而不是拿全工作区成员当分母）。
const dmListParticipantVmSchema = z
  .object({
    user_id: idSchema,
    nickname: z.string().min(1),
    // 恰好一名参与者 is_self=true（见 dmListItemVmSchema 的 superRefine）——客户端据此挑出「对方」。
    is_self: z.boolean()
  })
  .strict();
export type DmListParticipantVM = z.infer<typeof dmListParticipantVmSchema>;

export const dmListItemVmSchema = z
  .object({
    conversation: conversationVmSchema,
    // 固定 2 人（DM 不可拉人）——两名都是活跃用户；对方账号被删则整条 DM 不出现在列表（服务层过滤）。
    participants: z.array(dmListParticipantVmSchema).length(2)
  })
  .strict()
  .superRefine((item, ctx) => {
    // DM 会话一定带 is_dm=true（由 dm_key 非空推导）——列表接口不该混进普通会话。
    if (item.conversation.is_dm !== true) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["conversation", "is_dm"],
        message: "a dm list item must carry a dm conversation (is_dm=true)"
      });
    }
    const selfCount = item.participants.filter((participant) => participant.is_self).length;
    if (selfCount !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["participants"],
        message: "a dm must contain exactly one self participant"
      });
    }
    const userIds = new Set(item.participants.map((participant) => participant.user_id));
    if (userIds.size !== item.participants.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["participants"],
        message: "dm participants must be distinct users"
      });
    }
  });
export type DmListItemVM = z.infer<typeof dmListItemVmSchema>;

// 列表上限——同 capped 三件套口径（前 N 名），DM 数量对内部团队规模远低于此，纯防御性封顶。
export const DM_LIST_CAP = 200;
export const dmListVmSchema = z
  .object({
    items: z.array(dmListItemVmSchema).max(DM_LIST_CAP)
  })
  .strict();
export type DmListVM = z.infer<typeof dmListVmSchema>;

// R14FIX 批 workbench：重命名成功的响应——回改名后的完整会话 VM（客户端就地更新左栏树叶，见
// rail.ts renameCollabConversationInVm）。定义在 conversationVmSchema 之后（引用它），避免 const
// 使用前声明——同 conversationPinsVmSchema 的既有取舍。
export const renameConversationResultVmSchema = z
  .object({
    conversation: conversationVmSchema
  })
  .strict();
export type RenameConversationResultVM = z.infer<typeof renameConversationResultVmSchema>;

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

// R14 批 CHAT：消息 VM 上的全量 reaction 聚合项——一键一项，user_ids 是该键的全部反应者（去重、
// 幂等替换语义，读时页级 grouped 查询构建，禁 N+1）。
export const conversationMessageReactionVmSchema = z
  .object({
    key: conversationReactionKeySchema,
    user_ids: z.array(idSchema).min(1).max(MAX_CONVERSATION_REACTION_USER_IDS)
  })
  .strict();
export type ConversationMessageReactionVM = z.infer<typeof conversationMessageReactionVmSchema>;

// R14 批 CHAT：引用回复的原消息预览——读时 join 目标构建。preview_text ≤80（墓碑目标为 ''），
// deleted 表示原消息事后被删（引用侧渲染「原消息已删除」占位）。
export const conversationMessageReplyPreviewVmSchema = z
  .object({
    message_id: idSchema,
    sender_type: conversationSenderTypeSchema,
    sender_user_id: idSchema.nullable(),
    preview_text: z.string().max(MAX_CONVERSATION_REPLY_PREVIEW_CODE_UNITS),
    deleted: z.boolean()
  })
  .strict();
export type ConversationMessageReplyPreviewVM = z.infer<typeof conversationMessageReplyPreviewVmSchema>;

// R14 批 CHAT：置顶元数据。by_user_id 可空——置顶者用户被删时列 set null（墓碑外键语义）。
export const conversationMessagePinVmSchema = z
  .object({
    at: isoDateTimeSchema,
    by_user_id: idSchema.nullable()
  })
  .strict();
export type ConversationMessagePinVM = z.infer<typeof conversationMessagePinVmSchema>;

const conversationMessageBaseShape = {
  id: idSchema,
  conversation_id: idSchema,
  seq: safeIntegerOutputSchema,
  sender_type: conversationSenderTypeSchema,
  sender_user_id: idSchema.nullable(),
  thread_root_id: idSchema.nullable(),
  // R14 批 CHAT：以下 5 个 additive optional 字段——openapi 只进 properties 不进 required，存量客户端
  // （不认识这些键）读旧消息（不带这些字段）行为零回归。
  //   edited_at：编辑后置位（读侧渲染「已编辑」灰标）。
  //   deleted_at：墓碑置位（VM 已归一成 kind:'text' content:{text:''}，见下方 superRefine）。
  //   pinned：置顶元数据（未置顶时字段不出现）。
  //   reply_to：引用的原消息预览（读时 join；仅 text 新消息可带 reply）。
  //   reactions：全量 reaction 聚合（页级 grouped 查询，禁 N+1）。
  edited_at: isoDateTimeSchema.optional(),
  deleted_at: isoDateTimeSchema.optional(),
  pinned: conversationMessagePinVmSchema.optional(),
  reply_to: conversationMessageReplyPreviewVmSchema.optional(),
  reactions: z.array(conversationMessageReactionVmSchema).max(conversationReactionKeySchema.options.length).optional(),
  // R14 批 FEEDBACK：本人对这条消息的二值反馈（有用/没用 + 可选备注），additive optional——只对
  // sender_type==='cuu' && kind==='text' 的活消息有意义，但契约层不用 superRefine 强制（同 pinned/
  // reply_to 的既有宽松处理，服务层保证只在合法主体上写入，见 04-feedback-design.md §3）。读聚合只回
  // 当前 actor 自己的判定，不做全员聚合（与 reactions 的社交语义刻意区分）。
  my_feedback: myAiFeedbackVmSchema.optional(),
  created_at: isoDateTimeSchema
} as const;

// R14 批 CHAT：读侧 text 内容 schema——放宽 text 到允许空串，专供墓碑归一（content:{text:''}）。
// 创建侧 conversationTextContentSchema（min 1）完全不变；「空串当且仅当墓碑」的收紧由下方 message VM
// 的 superRefine 兜住，活消息的 text 仍然强制非空。extend 保留 strict 与其它 additive 字段。
const conversationMessageTextContentVmSchema = conversationTextContentSchema.extend({
  text: z.string().max(MAX_CONVERSATION_TEXT_CODE_UNITS)
});

export const conversationMessageVmSchema = z
  .discriminatedUnion("kind", [
    z.object({
      ...conversationMessageBaseShape,
      kind: z.literal("text"),
      content: conversationMessageTextContentVmSchema
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
  ])
  .superRefine((message, ctx) => {
    // 墓碑归一不变量：deleted_at 置位 ⟺ kind='text' 且 content.text=''（服务层 messageToVm 强制）。
    if (message.deleted_at !== undefined) {
      if (message.kind !== "text") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["kind"],
          message: "a deleted message VM must be normalized to a text tombstone"
        });
        return;
      }
      if (message.content.text !== "") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["content", "text"],
          message: "a deleted message tombstone must carry empty text"
        });
      }
      return;
    }
    // 活着的 text 消息仍然强制非空（保住创建侧 min(1) 的读侧对称）。
    if (message.kind === "text" && message.content.text.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["content", "text"],
        message: "a live text message must not carry empty text"
      });
    }
  });
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
    next_after_seq: safeIntegerOutputSchema,
    // R12 批8：仅在响应 beforeSeq（反向翻页）请求时出现——continuing 更早历史的游标。afterSeq
    // 请求的响应形状保持批 0 原样不变（这个键完全不出现，不是出现后填 null），向后兼容零改动。
    next_before_seq: safeIntegerOutputSchema.optional()
  })
  .strict();
export type ConversationMessagePageVM = z.infer<typeof conversationMessagePageVmSchema>;

// R14 批 CHAT：置顶清单端点（GET /pins）的输出——seq 降序、cap 50。定义在 conversationMessageVmSchema
// 之后（引用它），避免 const 使用前声明。
export const conversationPinsVmSchema = z
  .object({
    messages: z.array(conversationMessageVmSchema).max(50)
  })
  .strict();
export type ConversationPinsVM = z.infer<typeof conversationPinsVmSchema>;
