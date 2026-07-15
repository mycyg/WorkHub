import {
  conversationActionCardUpdatedEventSchema,
  eventTypes
} from "@workhub/contracts";
import type { ActionCardRepository, ConversationRepository } from "@workhub/db";
import { makeWorkHubEvent, topics } from "@workhub/events";

import type { PushBus } from "../broker/index.js";
import type { StructuredLogger } from "../logging.js";
import { InternalContractError, parseOutputContract } from "../pages/output-contract.js";

// R15 批 D4b（找人升级为交互卡 · action_card 投递通道，见 proactive-intents.ts 闸门约定第 3 通道）：
// 把一条已过频控/上限闸的「找人」intent 变成【项目主区里的一张系统 decide 行动卡】（标题=「XX 已逾期
// 且无人认领」，三动作 claim/reassign/defer）。走 action-cards 仓库的 insertSystemCard——它绝不碰观察者
// 水位线/activeCardId（见该方法注释），与观察者卡在同一主区共存。
//
// 卡的形状与观察者产的 decide 卡完全一致（同一 conversation_message.kind='action_card' + action_card_items），
// 桌面工作台按同一 VM 渲染、按同一 POST /api/action-card-items/:id/decide 决策——前端无需感知 origin。
// 卡上单条 decide 条目：assignee=项目负责人（被 @ 来定夺的人），work_item=那件逾期无主事项本体。
//
// 广播尽力而为：与观察者 emitActionCardUpdated 同款——契约校验失败/broker 发布失败只记警告，卡已落库，
// 客户端下次翻页/实时都拿得到。intent id 由 insertSystemCard 落进消息 content_json.proactive_intent_id 审计。

export type ProactiveFindOwnerCardResult =
  | { delivered: true; conversationId: string }
  // 项目主区不可用（项目主 main 会话缺失/非真项目）——调用方据此降级回 notification 通道。
  | { delivered: false; reason: "no_main_conversation" };

export type ProactiveFindOwnerCardInput = {
  workspaceId: string;
  projectId: string;
  workItemId: string;
  // 项目负责人（owner/lead 判定链结果）：卡上 decide 条目的 assignee，被请来定夺的人。
  targetUserId: string;
  // 卡上 decide 条目标题（复用 intent 的通知标题「XX 已逾期且无人认领」，零 LLM）。
  titleMd: string;
  proactiveIntentId: string;
};

export type ProactiveFindOwnerCardDelivery = {
  deliverFindOwnerCard: (input: ProactiveFindOwnerCardInput) => Promise<ProactiveFindOwnerCardResult>;
};

export type ProactiveFindOwnerCardDeliveryDeps = {
  conversations: Pick<ConversationRepository, "findProjectMainConversation">;
  actionCards: Pick<ActionCardRepository, "insertSystemCard">;
  bus: Pick<PushBus, "publish"> | undefined;
  logger: Pick<StructuredLogger, "warn">;
  now?: () => Date;
};

const PREVIEW_MAX = 200;

export function createProactiveFindOwnerCardDelivery(
  deps: ProactiveFindOwnerCardDeliveryDeps
): ProactiveFindOwnerCardDelivery {
  const now = deps.now ?? (() => new Date());
  return {
    async deliverFindOwnerCard(input: ProactiveFindOwnerCardInput): Promise<ProactiveFindOwnerCardResult> {
      const target = await deps.conversations.findProjectMainConversation({
        projectId: input.projectId,
        workspaceId: input.workspaceId
      });
      if (!target) {
        return { delivered: false, reason: "no_main_conversation" };
      }

      const at = now();
      const result = await deps.actionCards.insertSystemCard({
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        conversationId: target.conversationId,
        at,
        items: [
          {
            kind: "decide",
            titleMd: input.titleMd,
            // 规则确定性事实（逾期 + 无主），高置信。
            confidence: "high",
            status: "waiting_decision",
            workItemId: input.workItemId,
            assigneeUserId: input.targetUserId
          }
        ],
        messageContentExtra: { proactive_intent_id: input.proactiveIntentId }
      });

      // 广播「行动卡有更新」——桌面客户端据此把新卡渲进主区（appended:false=新建卡）。尽力而为。
      try {
        const topic = topics.conversation(target.conversationId).topic;
        const event = parseOutputContract(
          conversationActionCardUpdatedEventSchema,
          makeWorkHubEvent({
            type: eventTypes.conversationActionCardUpdated,
            topic,
            ts: at,
            actor: { actor_kind: "ai", label: "Cuu" },
            project_id: input.projectId,
            preview_text: input.titleMd.slice(0, PREVIEW_MAX),
            data: {
              conversation_id: target.conversationId,
              action_card_id: result.card.id,
              message_id: result.message.id,
              status: "active",
              appended: false,
              items: result.items.map((item) => ({
                id: item.id,
                kind: item.kind,
                confidence: item.confidence,
                status: item.status
              }))
            }
          }),
          "proactive-find-owner-card.event"
        );
        await deps.bus?.publish(topic, eventTypes.conversationActionCardUpdated, event);
      } catch (error) {
        if (!(error instanceof InternalContractError)) {
          deps.logger.warn("proactive_find_owner_card_publish_failed", {
            conversationId: target.conversationId,
            proactiveIntentId: input.proactiveIntentId,
            error
          });
        } else {
          deps.logger.warn("proactive_find_owner_card_event_contract_violation", {
            conversationId: target.conversationId,
            proactiveIntentId: input.proactiveIntentId,
            error
          });
        }
      }

      return { delivered: true, conversationId: target.conversationId };
    }
  };
}
