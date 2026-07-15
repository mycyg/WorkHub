import {
  conversationMessageCreatedEventSchema,
  conversationMessageVmSchema,
  eventTypes
} from "@workhub/contracts";
import type { ConversationRepository } from "@workhub/db";
import { makeWorkHubEvent, topics } from "@workhub/events";

import type { PushBus } from "../broker/index.js";
import type { StructuredLogger } from "../logging.js";
import { parseOutputContract } from "../pages/output-contract.js";

// R15 批 D2（Cuu 主动开口 · conversation_message 投递通道，见 proactive-intents.ts 闸门约定第 2 通道）：
// 把一条已经过频控/上限闸的主动性 intent 变成「Cuu 在目标用户个人空间主区不请自来说的一句话」。
//
// ── 这条通道复用的既有守卫（不绕过任何一道）─────────────────────────────────────────────────
//  1. 目标定位：findPersonalMainConversation 只认 is_personal=true 且 owner=目标用户 的项目主区
//     （R13 S3 的 1:1 语义），查不到（用户没建过个人空间）→ 降级信号回给调用方，绝不硬造个人空间。
//  2. 落库：走 conversations.createCuuMessage —— 与 turn 循环里 Cuu 说话完全同一条落库路径（同一
//     事务、同一 seq 分配、同一 sender_type='cuu'/sender_user_id=null 约束、同一内容形状校验）。
//  3. 广播：与 conversation-turns / conversations 服务里同款的 conversation.message.created SSE 事件
//     （actor=ai/Cuu），经 conversationMessageCreatedEventSchema 校验后 publish，不构造走样事件。
//
// intent id 挂在消息 content_json.proactive_intent_id 上做审计溯源（additive 字段，见 contracts 与
// createCuuMessage 输入类型同名注释）。**零 LLM**：text 由调用方（ddl-chase 模板）给定，本模块只投递。
//
// 关于「不通知自己」：个人空间主区 kind='main' 没有 conversation_participants 行，A5 的消息通知扇出
// （notifyConversationMessage）对它天然短路（listParticipantUserIds 返回空 → 无收件人）。所以这里
// 刻意不调用消息通知扇出——Cuu 在你自己的空间说话不该再给你自己落一条「新消息」OS 通知。

export type ProactiveCuuDeliveryResult =
  | { delivered: true; conversationId: string }
  // 目标用户没有可投递的个人空间主区（从未建过个人空间）——调用方据此降级回 notification 通道。
  | { delivered: false; reason: "no_personal_space" };

export type ProactiveCuuDeliveryInput = {
  workspaceId: string;
  targetUserId: string;
  text: string;
  proactiveIntentId: string;
};

export type ProactiveCuuDelivery = {
  deliverCuuMessage: (input: ProactiveCuuDeliveryInput) => Promise<ProactiveCuuDeliveryResult>;
};

export type ProactiveCuuDeliveryDeps = {
  conversations: Pick<ConversationRepository, "findPersonalMainConversation" | "createCuuMessage">;
  bus: Pick<PushBus, "publish"> | undefined;
  logger: Pick<StructuredLogger, "warn">;
  now?: () => Date;
};

const PREVIEW_MAX = 200;

export function createProactiveCuuDelivery(deps: ProactiveCuuDeliveryDeps): ProactiveCuuDelivery {
  const now = deps.now ?? (() => new Date());
  return {
    async deliverCuuMessage(input: ProactiveCuuDeliveryInput): Promise<ProactiveCuuDeliveryResult> {
      const target = await deps.conversations.findPersonalMainConversation({
        workspaceId: input.workspaceId,
        targetUserId: input.targetUserId
      });
      if (!target) {
        return { delivered: false, reason: "no_personal_space" };
      }

      const created = await deps.conversations.createCuuMessage({
        workspaceId: input.workspaceId,
        conversationId: target.conversationId,
        at: now(),
        kind: "text",
        contentJson: { text: input.text, proactive_intent_id: input.proactiveIntentId }
      });

      // 落库成功即算投递成功（消息已在会话里，客户端下次翻页/实时都拿得到）。广播是锦上添花，失败只记日志
      // 不回滚——与既有 Cuu 消息落库/广播路径（conversation-turns）的错误隔离档次一致。
      const vm = parseOutputContract(
        conversationMessageVmSchema,
        {
          id: created.id,
          conversation_id: created.conversationId,
          seq: created.seq,
          sender_type: created.senderType,
          sender_user_id: created.senderUserId,
          thread_root_id: created.threadRootId ?? null,
          kind: created.kind,
          content: created.contentJson,
          created_at: created.createdAt.toISOString()
        },
        "proactive-cuu-delivery.message"
      );

      try {
        const conversationTopic = topics.conversation(target.conversationId).topic;
        const previewText = vm.kind === "text" ? vm.content.text : vm.kind;
        const event = parseOutputContract(
          conversationMessageCreatedEventSchema,
          makeWorkHubEvent({
            type: eventTypes.conversationMessageCreated,
            topic: conversationTopic,
            ts: now(),
            actor: { actor_kind: "ai", label: "Cuu" },
            project_id: target.projectId,
            preview_text: previewText.slice(0, PREVIEW_MAX),
            data: vm
          }),
          "proactive-cuu-delivery.event.created"
        );
        await deps.bus?.publish(conversationTopic, eventTypes.conversationMessageCreated, event);
      } catch (error) {
        deps.logger.warn("proactive_cuu_delivery_publish_failed", {
          conversationId: target.conversationId,
          proactiveIntentId: input.proactiveIntentId,
          error
        });
      }

      return { delivered: true, conversationId: target.conversationId };
    }
  };
}
