import { settings as runtimeSettings } from "@workhub/config";
import type { NotificationSeverity } from "@workhub/contracts";
import {
  countDeliveredProactiveIntentsForUser,
  createActionCardRepository,
  createConversationRepository,
  getSharedDatabaseClient,
  markProactiveIntentStatus,
  recordProactiveIntent,
  type RecordProactiveIntentResult,
  type WorkHubDatabaseClient
} from "@workhub/db";

import { getDefaultPushBus } from "../broker/index.js";
import { getDefaultStructuredLogger, type StructuredLogger } from "../logging.js";
import {
  createNotificationService,
  type NotificationService
} from "./notifications.js";
import { createProactiveCuuDelivery } from "./proactive-cuu-delivery.js";
import { createProactiveFindOwnerCardDelivery } from "./proactive-find-owner-card-delivery.js";

// R15 批 D（主动性 MVP · ProactiveIntent 决策/投递层）：主动打扰的唯一闸门。
//
// ── 闸门约定（未来所有主动打扰都必须走这里，务必读懂）──────────────────────────────────────
// recordAndDeliver 是「先记 intent → 过频控闸 → 投递」的单一路径。追 DDL、找人，以及**未来 Cuu
// 主动开口**（在协同/私聊会话里不请自来地说话，见 00-overview 第 4 层投递「Cuu 主动开口走新 turns
// 入口，必须带 intent id 审计」）——一律先在此拿到一条 proactive_intent 及其 id，把该 id 挂在实际
// 投递物（通知/未来的会话 turn）上做审计溯源。**规则闸判定要不要打扰、LLM 只管措辞**：本闸是纯规则
// （每人每日上限 + 用户级静音），零 LLM 调用。
//
// 投递通道（delivered_via）：
//   * 'notification'          —— 批 D 通道，落一条 notification（用户级按类型静音在此生效）。
//   * 'conversation_message'  —— 批 D2 通道，Cuu 在目标用户【个人空间主区】不请自来说一句话（R13 S3 的
//     1:1 落点）。个人空间不可用（用户没建过）→ 降级回 notification 通道并记日志，绝不硬造个人空间。
// 通道选择在【调用方】（ddl-chase 按阶梯决定 t1d/overdue 走会话、其余走通知）——同一 intent 只投一个
// 通道。两条通道都复用本闸同一份「先记录 + 频控前置（每人每日上限）」，静默时段仍由扫描任务前置拦截。
// 会话内 digest 卡 / SSE / Cuu turns 循环是后续批次的通道，各自 delivered_via 值不同，同样复用本闸。
//
// 静默时段（PROACTIVE_QUIET_HOURS）的取舍：不在这里拦——静默期内「延后投递」在通知可见性层不好做，
// 故改在扫描任务（ddl-chase）里静默期直接不产 intent、把「该产但静默」记日志计数，下个非静默 tick
// 再产（suppression_key 保证只产一次，等于把投递延到静默结束）。本闸只管每人每日上限 + 静音。

// R15 批 D2c：'care' 是关怀接缝的注册位——F 批的关怀扫描会产 kind='care' 的 intent，走本闸同一条
// conversation_message 通道（Cuu 在个人空间主动关怀）。本批不实现关怀扫描，只占位这个 kind（DB kind
// 列无 check 约束，additive 安全）。见文件末的 careConversationText 模板签名。
export type ProactiveIntentKind = "ddl_chase" | "find_owner" | "care";

// R15 批 D2/D4：投递通道。选择在调用方（见文件头）。缺省 'notification'（回到批 D 行为）。
//   * 'conversation_message' —— D2：Cuu 在目标用户个人空间主区说一句话。
//   * 'action_card'          —— D4：在【项目】主区插一张系统 decide 行动卡（找人：claim/reassign/defer）。
// 会话/行动卡通道投不成（个人空间/项目主区不可用、端口未注入、投递抛错）一律降级回 notification。
export type ProactiveDeliveryChannel = "notification" | "conversation_message" | "action_card";

export type ProactiveIntentNotification = {
  type: string;
  severity: NotificationSeverity;
  title: string;
  body: string;
  targetUrl: string;
  // 与 suppression_key 对齐——通知层的幂等 upsert 兜底一次（intent 幂等已在前，这是第二道）。
  dedupeKey: string;
  // 进 24h 提醒阶梯的通知（overdue）带上首个 next_remind_at；其余不带。
  nextRemindAt?: Date;
};

export type ProactiveIntentInput = {
  workspaceId: string;
  projectId: string;
  workItemId: string;
  kind: ProactiveIntentKind;
  stage: string;
  targetUserId: string;
  suppressionKey: string;
  payload: Record<string, unknown>;
  // notification 通道的通知草稿。始终必填——即便走会话通道，个人空间不可用时也要靠它降级投递。
  notification: ProactiveIntentNotification;
  // R15 批 D2：期望的投递通道（缺省 'notification'）。选 'conversation_message' 时须给 conversationText。
  channel?: ProactiveDeliveryChannel;
  // 会话通道的人话文案（Cuu 在个人空间主区说的那句）——零 LLM，由调用方（ddl-chase 模板）给定。
  // 仅在 channel='conversation_message' 时使用；缺省/走通知通道时忽略。
  conversationText?: string;
};

export type ProactiveDeliverResult =
  | { status: "delivered"; intentId: string }
  | { status: "suppressed"; reason: "duplicate" | "daily_cap" | "muted"; intentId?: string };

export type ProactiveIntentRepositoryDeps = {
  recordIntent: (input: Parameters<typeof recordProactiveIntent>[1]) => Promise<RecordProactiveIntentResult>;
  countDeliveredForUserOnDay: (input: { targetUserId: string; from: Date; to: Date }) => Promise<number>;
  markStatus: (input: { id: string; status: "delivered" | "suppressed"; deliveredVia?: string }) => Promise<void>;
};

export type ProactiveIntentServiceDeps = {
  repository: ProactiveIntentRepositoryDeps;
  // 批 D 通道。createNotification 内部已做用户级按类型静音（isMutedForRecipient）——静音时返回
  // null，本闸据此把 intent 记 suppressed（新通知类型自动可静音，无需在此重复判定）。
  notifications: Pick<NotificationService, "createNotification">;
  // R15 批 D2 通道（Cuu 在个人空间主区说话）。可选——不注入时 channel='conversation_message' 也会降级
  // 走 notification 通道（fail-open：宁可用通知补上，不吞掉这条主动性）。
  conversationDelivery?: ProactiveConversationDelivery;
  // R15 批 D4 通道（项目主区插系统「找人」行动卡）。可选——不注入时 channel='action_card' 同样降级回
  // notification（fail-open）。
  actionCardDelivery?: ProactiveActionCardDelivery;
  dailyCapPerUser: number;
  now?: () => Date;
  logger?: Pick<StructuredLogger, "warn">;
};

// R15 批 D2：会话通道投递端口（实现见 proactive-cuu-delivery.ts）。返回 delivered=false 表示目标个人
// 空间不可用 → 本闸降级回 notification 通道。类型独立声明，保持本闸对具体会话仓库/SSE 的零耦合。
export type ProactiveConversationDelivery = {
  deliverCuuMessage: (input: {
    workspaceId: string;
    targetUserId: string;
    text: string;
    proactiveIntentId: string;
  }) => Promise<{ delivered: true; conversationId: string } | { delivered: false; reason: "no_personal_space" }>;
};

// R15 批 D4：action_card 通道投递端口（实现见 proactive-find-owner-card-delivery.ts）。返回
// delivered=false 表示项目主区不可用 → 本闸降级回 notification 通道。类型独立声明，保持本闸对具体
// 行动卡仓库的零耦合。
export type ProactiveActionCardDelivery = {
  deliverFindOwnerCard: (input: {
    workspaceId: string;
    projectId: string;
    workItemId: string;
    targetUserId: string;
    titleMd: string;
    proactiveIntentId: string;
  }) => Promise<{ delivered: true; conversationId: string } | { delivered: false; reason: "no_main_conversation" }>;
};

export type ProactiveIntentService = {
  recordAndDeliver: (intent: ProactiveIntentInput) => Promise<ProactiveDeliverResult>;
};

// 服务器本地日的 [00:00, 次日 00:00)——每人每日上限的统计区间（当日=服务器本地日，见设计 D2）。
function localDayBounds(now: Date): { from: Date; to: Date } {
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const to = new Date(from.getTime());
  to.setDate(to.getDate() + 1);
  return { from, to };
}

export function createProactiveIntentService(deps: ProactiveIntentServiceDeps): ProactiveIntentService {
  const now = deps.now ?? (() => new Date());
  const logger = deps.logger ?? getDefaultStructuredLogger();

  return {
    async recordAndDeliver(intent: ProactiveIntentInput): Promise<ProactiveDeliverResult> {
      const at = now();
      // 1) 先记 intent。撞 suppression_key 唯一约束 → 这件事此前已处理过，幂等跳过（不重投）。
      const recorded = await deps.repository.recordIntent({
        workspaceId: intent.workspaceId,
        projectId: intent.projectId,
        workItemId: intent.workItemId,
        kind: intent.kind,
        stage: intent.stage,
        targetUserId: intent.targetUserId,
        suppressionKey: intent.suppressionKey,
        payload: intent.payload,
        at
      });
      if (!recorded.created || !recorded.id) {
        return { status: "suppressed", reason: "duplicate" };
      }
      const intentId = recorded.id;

      // 2) 每人每日上限：当日该 target 的已投递 intent 数达上限 → 记 suppressed，不投。
      const { from, to } = localDayBounds(at);
      const deliveredToday = await deps.repository.countDeliveredForUserOnDay({
        targetUserId: intent.targetUserId,
        from,
        to
      });
      if (deliveredToday >= deps.dailyCapPerUser) {
        await deps.repository.markStatus({ id: intentId, status: "suppressed" });
        return { status: "suppressed", reason: "daily_cap", intentId };
      }

      // 3) 投递。通道由调用方选（缺省 notification）。非通知通道（会话/行动卡）走得通就用它；目标落点
      //    不可用 / 未注入投递端口 / 投递抛错 → 一律降级回 notification 通道（fail-open：不吞掉这条主动
      //    性）。注意：非通知通道不经通知的按类型静音（个人空间/项目主区没有对应的通知类型可静音）——
      //    静音只在 notification 通道生效。
      const channel = intent.channel ?? "notification";

      // D2：Cuu 在个人空间主区说话。
      if (channel === "conversation_message" && intent.conversationText && deps.conversationDelivery) {
        try {
          const outcome = await deps.conversationDelivery.deliverCuuMessage({
            workspaceId: intent.workspaceId,
            targetUserId: intent.targetUserId,
            text: intent.conversationText,
            proactiveIntentId: intentId
          });
          if (outcome.delivered) {
            await deps.repository.markStatus({ id: intentId, status: "delivered", deliveredVia: "conversation_message" });
            return { status: "delivered", intentId };
          }
          logger.warn?.("proactive_conversation_delivery_degraded", {
            intentId,
            targetUserId: intent.targetUserId,
            reason: outcome.reason
          });
        } catch (error) {
          logger.warn?.("proactive_conversation_delivery_failed", { intentId, error });
        }
        // 落到这里 = 会话通道没投成，继续走下面的 notification 降级路径。
      }

      // D4：项目主区插系统「找人」行动卡。projectId/workItemId 对找人 intent 必非空；缺任一则直接走通知。
      if (channel === "action_card" && deps.actionCardDelivery && intent.projectId && intent.workItemId) {
        try {
          const outcome = await deps.actionCardDelivery.deliverFindOwnerCard({
            workspaceId: intent.workspaceId,
            projectId: intent.projectId,
            workItemId: intent.workItemId,
            targetUserId: intent.targetUserId,
            titleMd: intent.notification.title,
            proactiveIntentId: intentId
          });
          if (outcome.delivered) {
            await deps.repository.markStatus({ id: intentId, status: "delivered", deliveredVia: "action_card" });
            return { status: "delivered", intentId };
          }
          logger.warn?.("proactive_action_card_delivery_degraded", {
            intentId,
            projectId: intent.projectId,
            reason: outcome.reason
          });
        } catch (error) {
          logger.warn?.("proactive_action_card_delivery_failed", { intentId, error });
        }
        // 落到这里 = 行动卡通道没投成，继续走下面的 notification 降级路径。
      }

      // notification 通道（也是会话通道的降级目标）。createNotification 内部按类型静音返回 null → 记 suppressed。
      const notification = await deps.notifications.createNotification({
        userId: intent.targetUserId,
        type: intent.notification.type,
        severity: intent.notification.severity,
        title: intent.notification.title,
        body: intent.notification.body,
        targetUrl: intent.notification.targetUrl,
        projectId: intent.projectId,
        workItemId: intent.workItemId,
        dedupeKey: intent.notification.dedupeKey,
        ...(intent.notification.nextRemindAt ? { nextRemindAt: intent.notification.nextRemindAt } : {})
      });
      if (!notification) {
        await deps.repository.markStatus({ id: intentId, status: "suppressed" });
        return { status: "suppressed", reason: "muted", intentId };
      }

      await deps.repository.markStatus({ id: intentId, status: "delivered", deliveredVia: "notification" });
      return { status: "delivered", intentId };
    }
  };
}

// ── D2 频控闸的静默时段（纯函数，服务器本地时区）─────────────────────────────────────────
//
// PROACTIVE_QUIET_HOURS 形如 "22-08"（22:00–08:00，跨零点）或 "01-06"。空串/格式非法 = 不启用静默
// （fail-open：宁可多提醒一次，不静默吞掉整条主动性）。判定用服务器本地小时（now.getHours()），与
// 每人每日上限的「当日=本地日」同一时区口径。调用方（ddl-chase 扫描）静默期内不产 intent。

export type ProactiveQuietHours = { startHour: number; endHour: number } | null;

export function parseProactiveQuietHours(raw: string | undefined): ProactiveQuietHours {
  if (!raw) {
    return null;
  }
  const match = /^\s*(\d{1,2})\s*-\s*(\d{1,2})\s*$/u.exec(raw);
  if (!match) {
    return null;
  }
  const startHour = Number.parseInt(match[1]!, 10);
  const endHour = Number.parseInt(match[2]!, 10);
  if (startHour < 0 || startHour > 23 || endHour < 0 || endHour > 23 || startHour === endHour) {
    return null;
  }
  return { startHour, endHour };
}

export function isWithinProactiveQuietHours(quietHours: ProactiveQuietHours, now: Date): boolean {
  if (!quietHours) {
    return false;
  }
  const hour = now.getHours();
  const { startHour, endHour } = quietHours;
  if (startHour < endHour) {
    // 同日窗口（如 01-06）。
    return hour >= startHour && hour < endHour;
  }
  // 跨零点（如 22-08）。
  return hour >= startHour || hour < endHour;
}

// ── D2c 关怀接缝（为批次 F 打底，本批只做骨架，不实现关怀扫描本身）──────────────────────────
//
// 批次 F 的「关怀扫描」会侦测需要 Cuu 主动关怀的信号（如连续加班、工单长期积压、临期扎堆），产出
// kind='care' 的 ProactiveIntent，走本闸【同一条 recordAndDeliver 频控/上限闸 + 同一条
// conversation_message 通道】（Cuu 在个人空间主区主动关怀）——与追 DDL 复用完全一样的地基，不另起炉灶。
// 本批仅：① 在 ProactiveIntentKind 注册 'care'（见文件头）；② 占位下面这个文案模板签名。
// 关怀信号的形状、扫描节奏、以及措辞（后续接 LLM）都留给 F 批，此处刻意不实现——被调用即抛，fail-loud，
// 防止 F 批接线时误以为已有实现而投出空消息。
export type CareIntentSeed = {
  workspaceId: string;
  targetUserId: string;
  // F 批扫描产出的关怀信号（形状待 F 批定；此处只占位，不约束）。
  signal: Record<string, unknown>;
};

export function careConversationText(_seed: CareIntentSeed): string {
  throw new Error("care intent templates are implemented in batch F; D2c is a registration seam only");
}

let defaultDbClient: WorkHubDatabaseClient | undefined;
let defaultService: ProactiveIntentService | undefined;

export function getDefaultProactiveIntentService(): ProactiveIntentService {
  if (!defaultService) {
    defaultDbClient ??= getSharedDatabaseClient();
    const db = defaultDbClient.db;
    defaultService = createProactiveIntentService({
      repository: {
        recordIntent: (input) => recordProactiveIntent(db, input),
        countDeliveredForUserOnDay: (input) => countDeliveredProactiveIntentsForUser(db, input),
        markStatus: (input) => markProactiveIntentStatus(db, input)
      },
      notifications: createNotificationService(),
      // R15 批 D2：会话通道端口——复用同一个共享 DB 的会话仓库（个人空间主区定位 + Cuu 消息落库）与
      // 默认 SSE 总线（广播 conversation.message.created），与 turn 循环的 Cuu 说话同一套落库/广播底座。
      conversationDelivery: createProactiveCuuDelivery({
        conversations: createConversationRepository(db),
        bus: getDefaultPushBus(),
        logger: getDefaultStructuredLogger()
      }),
      // R15 批 D4：项目主区「找人」行动卡通道。复用同一共享 DB 的会话仓库（项目主区定位）与行动卡仓库
      // （insertSystemCard，绕开观察者水位线）+ 默认 SSE 总线。
      actionCardDelivery: createProactiveFindOwnerCardDelivery({
        conversations: createConversationRepository(db),
        actionCards: createActionCardRepository(db),
        bus: getDefaultPushBus(),
        logger: getDefaultStructuredLogger()
      }),
      dailyCapPerUser: runtimeSettings.proactive.dailyCapPerUser
    });
  }
  return defaultService;
}
