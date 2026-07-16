import type { ConversationRepository } from "@workhub/db";

import type { PresenceStore } from "../broker/types.js";
import type { StructuredLogger } from "../logging.js";
import type { NotificationService } from "./notifications.js";

// R15 批 A（A5 消息通知，见 r15-proactive-upgrade/01-batch-a-pipeline.md §A5）：会话消息落库后，给每个
// 「其他参与者」按需落一条 conversation.message 通知。人类消息与 Cuu 消息都走这里（system_event/tool_note
// 不算——调用方只在 text/file_card 落库后调用，这里再守一道）。人对人私聊（DM，参与者=2）天然生效，
// 不需特判。
//
// ── 在线抑制的取舍（务必读懂再改）────────────────────────────────────────────────────────
// 想要的信号是「收件人此刻是否正打开着这条会话」。服务端能查到的：
//   1. presence.getPresence(userId).is_online —— 粗粒度：用户是否持有【任意】一条实时 SSE 流。
//   2. 会话级订阅注册表 —— broker（memory/redis）不暴露「谁订阅了哪个 topic」的可查注册表。
// 关键事实：桌面 OS 通知桥（client-tauri sse.rs）只订 /api/push/stream/me（收 notification.created →
// 弹 OS 通知）；conversation.message.created 发到 topics.conversation(id)，只有客户端【打开了该会话流】
// 才收得到。所以：
//   * 用粗粒度 is_online 抑制是【错的】——后台/锁屏但流还开着的用户 is_online=true，一抑制就永远收不到
//     OS 通知，正好扼杀「锁屏/后台收私聊」这个 A5 的主用例；在别的会话里的在线用户也会漏掉这条 DM。
//   * 精确信号 = presence.isViewingConversation(user, conv)，由 SSE 流在 /stream/conversation/:id 打开/
//     心跳/断开时维护的会话级「正在看」引用计数（见 broker/presence.ts）。正在看的人已经能从
//     conversation.message.created 实时看到消息（红点/追加），无需再落一条 OS 通知 → 抑制；其余（离线、
//     在别处、后台锁屏）一律落通知，交给 OS 桥/通知列表。
// 已知边界：Redis 实现里「正在看」键有 120s TTL，靠 SSE 心跳续期；若某会话长时间无新消息、TTL 到期而人
// 还盯着看，下一条消息会误落一条通知——但它被 dedupe_key 聚合成同会话一条、且用户马上会读到，代价可控。
// fail-open 铁律：presence 查询抖动/抛错一律【不抑制】（宁可多发一条已 dedupe 的通知，不丢通知）。

export type ConversationMessageNotifyDeps = {
  repository: Pick<ConversationRepository, "listParticipantUserIds" | "unreadCountsForRecipients">;
  presence: Pick<PresenceStore, "isViewingConversation">;
  notifications: Pick<NotificationService, "createConversationMessageNotification">;
  logger: Pick<StructuredLogger, "warn">;
};

export type ConversationMessageNotifyInput = {
  conversationId: string;
  projectId: string;
  conversationTitle: string;
  // 发送者 user id（小写归一）；Cuu/system 发的消息为 null（此时全部参与者都是「其他人」）。
  senderUserId: string | null;
  senderLabel: string;
  // 只有 text/file_card 生成通知；其它（tool_note/system_event）直接短路。
  messageKind: string;
  previewText: string;
};

const NOTIFYING_MESSAGE_KINDS = new Set(["text", "file_card"]);

export async function notifyConversationMessage(
  deps: ConversationMessageNotifyDeps,
  input: ConversationMessageNotifyInput
): Promise<void> {
  if (!NOTIFYING_MESSAGE_KINDS.has(input.messageKind)) {
    return;
  }
  try {
    const participants = await deps.repository.listParticipantUserIds({ conversationId: input.conversationId });
    const sender = input.senderUserId?.trim().toLowerCase();
    // 「其他参与者」——发送者自己不收（Cuu 消息 sender=null → 全部参与者都是收件人）。
    const recipients = participants.filter((userId) => userId !== sender);
    if (recipients.length === 0) {
      return;
    }
    // 一次聚合算齐各收件人的未读数（禁 N+1）；失败降级成空 Map（未读走 `?? 1` 兜底一条）。
    let unread = new Map<string, number>();
    try {
      unread = await deps.repository.unreadCountsForRecipients({
        conversationId: input.conversationId,
        recipientUserIds: recipients
      });
    } catch (error) {
      deps.logger.warn("conversation_message_notify_unread_failed", {
        conversationId: input.conversationId,
        error
      });
    }
    for (const recipient of recipients) {
      // 在线抑制：只有「此刻正打开着这条会话」才跳过（fail-open：查询抖动一律不抑制，见文件头取舍）。
      let viewing = false;
      try {
        viewing = await deps.presence.isViewingConversation(recipient, input.conversationId);
      } catch (error) {
        deps.logger.warn("conversation_message_notify_presence_failed", {
          conversationId: input.conversationId,
          recipient,
          error
        });
      }
      if (viewing) {
        continue;
      }
      try {
        await deps.notifications.createConversationMessageNotification({
          userId: recipient,
          conversationId: input.conversationId,
          projectId: input.projectId,
          conversationTitle: input.conversationTitle,
          senderLabel: input.senderLabel,
          previewText: input.previewText,
          unreadCount: unread.get(recipient) ?? 1
        });
      } catch (error) {
        // 单个收件人落通知失败不连累其它人（best-effort，与 message.created 广播同档）。
        deps.logger.warn("conversation_message_notify_create_failed", {
          conversationId: input.conversationId,
          recipient,
          error
        });
      }
    }
  } catch (error) {
    // 整个通知扇出是「锦上添花」：绝不让它把消息创建/turn 的主路径带崩（调用方也已 fire-and-forget）。
    deps.logger.warn("conversation_message_notify_failed", { conversationId: input.conversationId, error });
  }
}
