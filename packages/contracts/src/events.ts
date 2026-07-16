import { z } from "zod";

import { eventTypeSchema } from "./enums.js";
import { idSchema, isoDateTimeSchema } from "./domain/common.js";
import {
  conversationMessageReactionVmSchema,
  conversationMessageVmSchema
} from "./domain/conversation.js";

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

// R12 批4a 集成修订：message.created 是「一切持久消息」的规范事件——批0 只有人类发消息一条
// 写路径,故锁死 human;协同 turn 落库的 Cuu 回复同样需要向其他在看成员广播(delta 是瞬态的,
// 断线/后进场的人只能靠 created+afterSeq 补齐)。放开为 human↔user / ai↔cuu 的严格配对,不松其它。
const conversationAiActorSchema = z
  .object({
    actor_kind: z.literal("ai"),
    label: z.string().optional()
  })
  .strict();

// BUG-04（审批落定回流实时化）：审批落定往来源会话回灌的是一条 system_event 消息（sender_type='system'，
// 内容如 {event:'proposal_settled', …}）。要让开着来源会话的客户端**实时**收到这条「落定行」，
// message.created 事件必须能表达 system 发送者——补一个与 human/ai 并列的 system actor 变体（label 可选、
// 无 user_id）。既有 human↔user、ai↔cuu 的严格配对完全不变；这是 additive 放宽，客户端（同一 @workhub/
// contracts 包，safeParse 过闸后落 system_event 消息，渲染层已有 sysline 分支）自动接收。
const conversationSystemActorSchema = z
  .object({
    actor_kind: z.literal("system"),
    label: z.string().optional()
  })
  .strict();

export const conversationMessageCreatedEventSchema = z
  .object({
    event_id: idSchema,
    type: z.literal("conversation.message.created"),
    topic: z.string().min(1),
    ts: isoDateTimeSchema,
    actor: z.union([conversationHumanActorSchema, conversationAiActorSchema, conversationSystemActorSchema]),
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
    if (event.actor.actor_kind === "human") {
      if (event.data.sender_type !== "user") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["data", "sender_type"],
          message: "message-created events from a human actor must have a user sender"
        });
      }
      if (event.data.sender_user_id !== event.actor.actor_user_id) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["data", "sender_user_id"],
          message: "message-created sender must match the human event actor"
        });
      }
      return;
    }
    if (event.actor.actor_kind === "system") {
      // BUG-04：system actor ⟺ system 发送者（且无 user_id）。审批落定/系统事件回流走这一支。
      if (event.data.sender_type !== "system") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["data", "sender_type"],
          message: "message-created events from a system actor must have a system sender"
        });
      }
      if (event.data.sender_user_id !== null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["data", "sender_user_id"],
          message: "system message-created events must not carry a sender_user_id"
        });
      }
      return;
    }
    if (event.data.sender_type !== "cuu") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["data", "sender_type"],
        message: "message-created events from an ai actor must have a cuu sender"
      });
    }
    if (event.data.sender_user_id !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["data", "sender_user_id"],
        message: "cuu message-created events must not carry a sender_user_id"
      });
    }
  });
export type ConversationMessageCreatedEvent = z.infer<typeof conversationMessageCreatedEventSchema>;

// R12 批4a：conversation.message.delta 从批0的「仅保留名称」升级为真实 payload/校验——同批3对
// conversation.action_card.updated 的做法一致（见 r12-workbench.test.ts 的正例契约测试）。
// 故意保持极简：只有 4 个 data 字段，没有 actor/project_id/preview_text——这是纯瞬态的流式打字
// 事件（一次协同会话 turn 生成过程中的增量文本），不落库、没有 seq、不参与任何 reconcile；
// 真正落库的 Cuu 回复走的是另一条路径（sender_type='cuu' 的 conversation_messages 行），
// 设计取舍与已知缺口见 apps/api/src/services/conversation-turns.ts 顶部注释与
// r12-desktop-workbench/reports/batch-4a-turns.md。
export const conversationMessageDeltaEventSchema = z
  .object({
    event_id: idSchema,
    type: z.literal("conversation.message.delta"),
    topic: z.string().min(1),
    ts: isoDateTimeSchema,
    data: z
      .object({
        conversation_id: idSchema,
        turn_id: idSchema,
        delta_text: z.string().min(1).max(4000),
        ordinal: z.number().int().min(0)
      })
      .strict()
  })
  .strict()
  .superRefine((event, ctx) => {
    if (event.topic !== `conversation:${event.data.conversation_id}`) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["topic"],
        message: "message-delta topic must match data.conversation_id"
      });
    }
  });
export type ConversationMessageDeltaEvent = z.infer<typeof conversationMessageDeltaEventSchema>;

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

// R14 CHAT 批（presence-observer 工包，00-interaction-design §2.2 承诺过、从未落地）：观察者 worker
// 真正调用 LLM 分析某会话消息窗之前发布的瞬态信号——客户端渲染「Cuu 正在整理刚才的讨论…」，同 typing
// 指示行同款样式。完全照 conversationPresenceTypingEventSchema 的瞬态模式（同一个 ts/expires_at
// offset+precision:3 的 datetime 格式），只是：
// - ttl_ms 锁死 30000（30s，比 typing 的 3s 长得多——一次分析的耗时不确定，指示灯允许多续几拍；
//   真正的收尾信号是行动卡事件到达或 TTL 到期，不依赖精确计时）。
// - actor 固定 ai（观察者自己触发，不是任何一个人类用户的信号，参见 conversationAiActorSchema）。
// - data 只有 conversation_id + ttl_ms，没有 typing 那样的 user_id——分析是会话级的动作，不归属
//   于某一个具体的人类用户。
export const conversationObserverAnalyzingEventSchema = z
  .object({
    event_id: idSchema,
    type: z.literal("conversation.observer.analyzing"),
    topic: z.string().min(1),
    ts: typingTimestampSchema,
    actor: conversationAiActorSchema,
    data: z
      .object({
        conversation_id: idSchema,
        ttl_ms: z.literal(30000),
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
        message: "observer-analyzing topic must match data.conversation_id"
      });
    }
    if (Date.parse(event.data.expires_at) - Date.parse(event.ts) !== 30000) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["data", "expires_at"],
        message: "observer-analyzing expires_at must be exactly 30000ms after event ts"
      });
    }
  });
export type ConversationObserverAnalyzingEvent = z.infer<typeof conversationObserverAnalyzingEventSchema>;

// R12 批3：行动卡变更事件。payload 只带最小可渲染摘要（卡片 id/状态、条目 id/kind/confidence/status），
// 不携带 title_md 全文/工作项细节——客户端收到后按需拉 GET 行动卡详情，事件本身只负责"该刷新了"。
// 事件的 actor 是 Cuu（观察者）自己产出卡片时为 ai；被 @ 的负责人做决策/撤销时为 human。
const actionCardUpdatedActorSchema = z
  .object({
    actor_kind: z.enum(["human", "ai"]),
    actor_user_id: idSchema.optional(),
    label: z.string().optional()
  })
  .strict();

const actionCardUpdatedItemSummarySchema = z
  .object({
    id: idSchema,
    kind: z.enum(["execute", "decide", "observe"]),
    confidence: z.enum(["high", "mid", "low"]),
    status: z.enum(["running", "done", "undone", "waiting_decision", "dismissed", "escalated"])
  })
  .strict();

export const conversationActionCardUpdatedEventSchema = z
  .object({
    event_id: idSchema,
    type: z.literal("conversation.action_card.updated"),
    topic: z.string().min(1),
    ts: isoDateTimeSchema,
    actor: actionCardUpdatedActorSchema,
    project_id: idSchema,
    preview_text: z.string().max(200).optional(),
    data: z
      .object({
        conversation_id: idSchema,
        action_card_id: idSchema,
        message_id: idSchema,
        status: z.enum(["active", "superseded"]),
        appended: z.boolean(),
        items: z.array(actionCardUpdatedItemSummarySchema).max(8)
      })
      .strict()
  })
  .strict()
  .superRefine((event, ctx) => {
    if (event.topic !== `conversation:${event.data.conversation_id}`) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["topic"],
        message: "action-card-updated topic must match data.conversation_id"
      });
    }
    if (event.actor.actor_kind === "human" && !event.actor.actor_user_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["actor", "actor_user_id"],
        message: "human actors on action-card-updated events must carry actor_user_id"
      });
    }
  });
export type ConversationActionCardUpdatedEvent = z.infer<typeof conversationActionCardUpdatedEventSchema>;

// R14 批 CHAT：conversation.message.updated——编辑/删除/置顶/取消置顶后发布。envelope 照 message.created
// （actor+data=变更后全量消息 VM），客户端按 data.id 整条替换；本地无此 id → 视 snapshotStale 定点补拉。
// 与 message.created 的关键区别：actor 是「执行这次变更的人」而不是「消息的发送者」——置顶一条 Cuu 消息
// 时 actor 是置顶者（human），data.sender_type 却是 'cuu'。所以这里刻意不做 message.created 那种
// actor↔sender 配对校验，只校验 topic 与 data.conversation_id 一致。编辑/删除/置顶都是人类操作，
// 故 actor 恒为 human。
export const conversationMessageUpdatedEventSchema = z
  .object({
    event_id: idSchema,
    type: z.literal("conversation.message.updated"),
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
        message: "message-updated topic must match data.conversation_id"
      });
    }
  });
export type ConversationMessageUpdatedEvent = z.infer<typeof conversationMessageUpdatedEventSchema>;

// R14 批 CHAT：conversation.reaction.updated——加/减反应后发布该消息的全量聚合（幂等替换，不发增量）。
// 极简 payload（无 actor/project_id）：客户端拿到就整条替换该消息的 reactions，谁加谁减不影响最终态。
export const conversationReactionUpdatedEventSchema = z
  .object({
    event_id: idSchema,
    type: z.literal("conversation.reaction.updated"),
    topic: z.string().min(1),
    ts: isoDateTimeSchema,
    data: z
      .object({
        conversation_id: idSchema,
        message_id: idSchema,
        reactions: z.array(conversationMessageReactionVmSchema).max(5)
      })
      .strict()
  })
  .strict()
  .superRefine((event, ctx) => {
    if (event.topic !== `conversation:${event.data.conversation_id}`) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["topic"],
        message: "reaction-updated topic must match data.conversation_id"
      });
    }
  });
export type ConversationReactionUpdatedEvent = z.infer<typeof conversationReactionUpdatedEventSchema>;

// R14 批 CHAT：conversation.read.updated——某人已读游标推进后发布（聚合式「已读 N/M」+ 未读分割线增量）。
export const conversationReadUpdatedEventSchema = z
  .object({
    event_id: idSchema,
    type: z.literal("conversation.read.updated"),
    topic: z.string().min(1),
    ts: isoDateTimeSchema,
    data: z
      .object({
        conversation_id: idSchema,
        user_id: idSchema,
        last_read_seq: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
      })
      .strict()
  })
  .strict()
  .superRefine((event, ctx) => {
    if (event.topic !== `conversation:${event.data.conversation_id}`) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["topic"],
        message: "read-updated topic must match data.conversation_id"
      });
    }
  });
export type ConversationReadUpdatedEvent = z.infer<typeof conversationReadUpdatedEventSchema>;

// R15 批 cuu-toggle：conversation.cuu.updated——会话级 Cuu 参与开关翻转（PATCH /cuu）后发布，data 只带
// 翻转后的布尔值。同 read.updated 的既有取舍：客户端按 conversation_id 过滤，本地更新头部开关 + 重算
// isCollabConversation（composer 模式 chip / 流式气泡随之显隐），接不上（断线/未挂载这个会话）就等下次
// 重挂时用会话 VM 里的 cuu_enabled 兜底，不强求这条广播必达。
export const conversationCuuUpdatedEventSchema = z
  .object({
    event_id: idSchema,
    type: z.literal("conversation.cuu.updated"),
    topic: z.string().min(1),
    ts: isoDateTimeSchema,
    data: z
      .object({
        conversation_id: idSchema,
        cuu_enabled: z.boolean()
      })
      .strict()
  })
  .strict()
  .superRefine((event, ctx) => {
    if (event.topic !== `conversation:${event.data.conversation_id}`) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["topic"],
        message: "cuu-updated topic must match data.conversation_id"
      });
    }
  });
export type ConversationCuuUpdatedEvent = z.infer<typeof conversationCuuUpdatedEventSchema>;

// R17 批 G1（群成员管理）：conversation.participants.updated——参与者集合变化后广播（加人/退群/移出）。
// data 只带 conversation_id + 变化类型 + 受影响 user_id（不带全量参与者列表，客户端据此按需重拉 GET
// /participants，同 cuu.updated 只带布尔值、不带全量会话 VM 的既有取舍：接不上就等下次重挂时兜底）。
export const conversationParticipantsUpdatedEventSchema = z
  .object({
    event_id: idSchema,
    type: z.literal("conversation.participants.updated"),
    topic: z.string().min(1),
    ts: isoDateTimeSchema,
    data: z
      .object({
        conversation_id: idSchema,
        change: z.enum(["added", "removed"]),
        user_id: idSchema
      })
      .strict()
  })
  .strict()
  .superRefine((event, ctx) => {
    if (event.topic !== `conversation:${event.data.conversation_id}`) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["topic"],
        message: "participants-updated topic must match data.conversation_id"
      });
    }
  });
export type ConversationParticipantsUpdatedEvent = z.infer<typeof conversationParticipantsUpdatedEventSchema>;
