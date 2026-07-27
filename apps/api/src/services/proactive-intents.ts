import { settings as runtimeSettings } from "@workhub/config";
import type { NotificationSeverity } from "@workhub/contracts";
import {
  claimProactiveIntentForDelivery,
  countDeliveredProactiveIntentsForUser,
  createActionCardRepository,
  createConversationRepository,
  getSharedDatabaseClient,
  incrementProactiveIntentAttempt,
  listRecoverableProactiveIntents,
  markProactiveIntentStatus,
  recordProactiveIntent,
  type CareSignalType,
  type RecordProactiveIntentResult,
  type RecoverableProactiveIntentRow,
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

// 'care' = 关怀扫描（care-scan.ts，批 F）产出的 kind——走本闸同一条 conversation_message 通道
// （Cuu 在个人空间主动关怀）。DB kind 列无 check 约束，additive 安全。文案见文件末 careConversationText。
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
  // R15 批 F（关怀）：可空——关怀 intent 不挂具体项目/工作项（只关切「人」，不关切某件事）。DDL 追人
  // 恒有工作项，关怀恒为 null，proactive_intents 两列本就是可空 FK。
  projectId: string | null;
  workItemId: string | null;
  kind: ProactiveIntentKind;
  stage: string;
  targetUserId: string;
  suppressionKey: string;
  payload: Record<string, unknown>;
  // notification 通道的通知草稿。始终必填——即便走会话通道，个人空间不可用时也要靠它降级投递
  // （关怀 degradeToNotification=false 时永不消费它，但类型仍必填，草稿为惰性占位）。
  notification: ProactiveIntentNotification;
  // R15 批 D2：期望的投递通道（缺省 'notification'）。选 'conversation_message' 时须给 conversationText。
  channel?: ProactiveDeliveryChannel;
  // 会话通道的人话文案（Cuu 在个人空间主区说的那句）——零 LLM，由调用方（ddl-chase / care-scan 模板）给定。
  // 仅在 channel='conversation_message' 时使用；缺省/走通知通道时忽略。
  conversationText?: string;
  // R15 批 F（关怀）：会话通道投不成时是否降级回 notification。缺省 true（DDL 行为：宁可用系统通知补上，
  // 不吞掉这条主动性）。关怀设 false——个人空间不可用/投递失败时【直接 suppressed，绝不降级到系统通知】，
  // 因为关怀走系统通知反而尴尬（"Cuu 想关心你，但只能给你发条冷冰冰的系统通知"）。这是与 DDL 的关键差异。
  degradeToNotification?: boolean;
};

export type ProactiveDeliverResult =
  | { status: "delivered"; intentId: string }
  // no_personal_space：关怀专用——会话通道投不成且 degradeToNotification=false，不降级、直接抑制。
  | { status: "suppressed"; reason: "duplicate" | "daily_cap" | "muted" | "no_personal_space"; intentId?: string };

export type ProactiveIntentRepositoryDeps = {
  recordIntent: (input: Parameters<typeof recordProactiveIntent>[1]) => Promise<RecordProactiveIntentResult>;
  countDeliveredForUserOnDay: (input: { targetUserId: string; from: Date; to: Date }) => Promise<number>;
  markStatus: (input: { id: string; status: "delivered" | "suppressed"; deliveredVia?: string }) => Promise<void>;
  // R21 加固（并发投递幂等）：投递前的原子领取（created → delivering，UPDATE ... WHERE status 前置条件）。
  // 缺省（不传 stalledBefore）只允许从 created 领取；恢复扫描传 stalledBefore（= now - 停滞阈值）额外
  // 允许领取「停滞的 delivering」。领取失败（false）= 有并发方在投/已投——绝不执行投递副作用。
  claimForDelivery: (input: { id: string; stalledBefore?: Date }) => Promise<boolean>;
  // R20 REL-2（#P1-11 崩溃恢复兜底扫描）：列出停在 created/delivering 的陈旧行 + 每次重投自增 attempt_count。
  listRecoverable: (input: {
    now: Date;
    olderThanMs: number;
    maxAttempts: number;
    limit: number;
  }) => Promise<RecoverableProactiveIntentRow[]>;
  incrementAttempt: (input: { id: string }) => Promise<void>;
};

// R20 REL-2（#P1-11）：record 时落库、恢复扫描重投时据以重建 intent 的投递上下文。存进 delivery_payload
// 列（jsonb）。日期以 ISO 串存（jsonb 无 Date 概念），重建时再 new Date()。
export type ProactiveDeliveryPayload = {
  channel: ProactiveDeliveryChannel;
  conversationText?: string;
  degradeToNotification?: boolean;
  notification: {
    type: string;
    severity: NotificationSeverity;
    title: string;
    body: string;
    targetUrl: string;
    dedupeKey: string;
    nextRemindAt?: string;
  };
};

// R20 REL-2：恢复扫描一 tick 的结算。
export type ProactiveIntentRecoveryRunResult = {
  // 扫到的陈旧 created 行数。
  scanned: number;
  // 重投成功（顶到 delivered）。
  recovered: number;
  // 重投走到 suppressed 终态（频控/静音/无个人空间）——正常终态，不是坏事。
  suppressed: number;
  // 达重投上限仍投不成（或无法重建）→ 封顶判死（delivered_via='stalled'）。
  stalled: number;
  // 本次重投又抛、但未达上限 → 仍留 created，等下个 tick 再来。
  retryable: number;
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
  // R20 REL-2（#P1-11）：兜底恢复扫描一 tick——扫回崩溃后停在 created 的陈旧行重投。pulse 任务
  // proactive-intent-recovery 驱动。
  recoverStalled: (input: {
    now: Date;
    olderThanMs: number;
    maxAttempts: number;
    limit: number;
  }) => Promise<ProactiveIntentRecoveryRunResult>;
};

// 服务器本地日的 [00:00, 次日 00:00)——每人每日上限的统计区间（当日=服务器本地日，见设计 D2）。
function localDayBounds(now: Date): { from: Date; to: Date } {
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const to = new Date(from.getTime());
  to.setDate(to.getDate() + 1);
  return { from, to };
}

// R20 REL-2（#P1-11）：把 record 时该落库的投递上下文攒成 delivery_payload——恢复扫描手里只有 DB 行、
// 拿不到原 intent 对象，故一并落库以便重投时重建。exactOptionalPropertyTypes 下可空字段惰性置入。
function buildDeliveryPayload(intent: ProactiveIntentInput): ProactiveDeliveryPayload {
  return {
    channel: intent.channel ?? "notification",
    ...(intent.conversationText !== undefined ? { conversationText: intent.conversationText } : {}),
    ...(intent.degradeToNotification !== undefined ? { degradeToNotification: intent.degradeToNotification } : {}),
    notification: {
      type: intent.notification.type,
      severity: intent.notification.severity,
      title: intent.notification.title,
      body: intent.notification.body,
      targetUrl: intent.notification.targetUrl,
      dedupeKey: intent.notification.dedupeKey,
      ...(intent.notification.nextRemindAt ? { nextRemindAt: intent.notification.nextRemindAt.toISOString() } : {})
    }
  };
}

export function createProactiveIntentService(deps: ProactiveIntentServiceDeps): ProactiveIntentService {
  const now = deps.now ?? (() => new Date());
  const logger = deps.logger ?? getDefaultStructuredLogger();

  // R20 REL-2（#P1-11）：投递腿（从 delivering 顶到终态）。直投路径与崩溃恢复扫描共用同一份——三通道逻辑
  // 只此一处，不复制粘贴。入口是 intentId + 完整 intent（恢复路径从 delivery_payload 重建后再进来），
  // R21 加固：调用方必须先经 claimForDelivery 原子领取（created → delivering）才进这里——并发调用只有
  // 一个能领到，投递副作用因此恰好执行一次。走完必把行推到 delivered/suppressed 某个终态（除非中途抛错，
  // 那正是崩溃窗口，行停在 delivering，等恢复扫描按停滞阈值领回重投）。
  async function deliver(intentId: string, intent: ProactiveIntentInput, at: Date): Promise<ProactiveDeliverResult> {
    // 每人每日上限：当日该 target 的已投递 intent 数达上限 → 记 suppressed，不投。
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

    // 投递。通道由调用方选（缺省 notification）：conversation_message（D2，Cuu 在个人空间主区说话）
    // / action_card（D4，项目主区插系统「找人」卡）。非通知通道投不成时的兜底由 degradeToNotification
    // 决定（缺省 true）：
    //   * true（DDL 追人/找人）：降级回 notification 通道（fail-open：宁可用系统通知补上，不吞主动性）；
    //   * false（关怀）：直接 suppressed，绝不降级到系统通知（关怀走系统通知反而尴尬，见类型定义处注释）。
    // 注意：非通知通道不经通知的按类型静音（个人空间/项目主区没有对应的通知类型可静音）——静音只在
    // notification 通道生效。
    const channel = intent.channel ?? "notification";
    const degradeToNotification = intent.degradeToNotification ?? true;
    if (channel === "conversation_message") {
      if (intent.conversationText && deps.conversationDelivery) {
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
      }
      // 到这里 = 会话通道没投成（个人空间缺失 / 未注入端口 / 缺文案 / 抛错）。
      if (!degradeToNotification) {
        // 关怀：不降级到系统通知——直接 suppressed。
        await deps.repository.markStatus({ id: intentId, status: "suppressed" });
        return { status: "suppressed", reason: "no_personal_space", intentId };
      }
      // 否则继续走下面的 notification 降级路径（DDL 行为）。
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
      // 落到这里 = 行动卡通道没投成，继续走下面的 notification 降级路径（找人 degradeToNotification 恒缺省 true）。
    }

    // notification 通道（也是非通知通道的降级目标）。关怀（degradeToNotification=false）在上面已
    // suppressed 返回，不会落到这。createNotification 内部按类型静音返回 null → 记 suppressed。
    const notification = await deps.notifications.createNotification({
      userId: intent.targetUserId,
      type: intent.notification.type,
      severity: intent.notification.severity,
      title: intent.notification.title,
      body: intent.notification.body,
      targetUrl: intent.notification.targetUrl,
      ...(intent.projectId ? { projectId: intent.projectId } : {}),
      ...(intent.workItemId ? { workItemId: intent.workItemId } : {}),
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

  return {
    async recordAndDeliver(intent: ProactiveIntentInput): Promise<ProactiveDeliverResult> {
      const at = now();
      // 1) 先记 intent（连投递上下文一并落库，供崩溃后恢复扫描重建）。
      const recorded = await deps.repository.recordIntent({
        workspaceId: intent.workspaceId,
        projectId: intent.projectId,
        workItemId: intent.workItemId,
        kind: intent.kind,
        stage: intent.stage,
        targetUserId: intent.targetUserId,
        suppressionKey: intent.suppressionKey,
        payload: intent.payload,
        deliveryPayload: buildDeliveryPayload(intent),
        at
      });
      if (!recorded.created) {
        // 撞 suppression_key 唯一约束。R20 REL-2（#P1-11）：区分「真 duplicate」与「投递前崩溃、行停在
        // created」——后者是可恢复态，同 key 重试即恢复投递（手里的 intent 就是完整投递上下文，直接复用
        // deliver 腿，不必等兜底扫描）。既有行已 delivering（有并发方在投）/delivered/suppressed 都是真
        // duplicate，幂等跳过。R21 加固：恢复投递前必须先原子领取（created → delivering），两个并发的
        // 同 key 重试只有一个领得到——领不到的按 duplicate 收口，绝不重复执行投递副作用。
        if (recorded.id && recorded.status === "created") {
          const claimed = await deps.repository.claimForDelivery({ id: recorded.id });
          if (!claimed) {
            return { status: "suppressed", reason: "duplicate" };
          }
          return deliver(recorded.id, intent, at);
        }
        return { status: "suppressed", reason: "duplicate" };
      }
      if (!recorded.id) {
        // 理论到不了（created=true 必带 id）——防御性兜底，不投。
        return { status: "suppressed", reason: "duplicate" };
      }

      // 2) 原子领取（created → delivering）后投递（每人每日上限 + 三通道 + 顶终态）。刚插入的行正常必能
      // 领到；领不到 = 极端竞态下另一条路径（同 key 重试/恢复扫描）已抢先在投——按 duplicate 收口。
      const claimed = await deps.repository.claimForDelivery({ id: recorded.id });
      if (!claimed) {
        return { status: "suppressed", reason: "duplicate" };
      }
      return deliver(recorded.id, intent, at);
    },

    async recoverStalled(input): Promise<ProactiveIntentRecoveryRunResult> {
      const rows = await deps.repository.listRecoverable({
        now: input.now,
        olderThanMs: input.olderThanMs,
        maxAttempts: input.maxAttempts,
        limit: input.limit
      });
      const result: ProactiveIntentRecoveryRunResult = {
        scanned: rows.length,
        recovered: 0,
        suppressed: 0,
        stalled: 0,
        retryable: 0
      };
      // R21 加固：恢复重投同样必须先原子领取——允许领取「停滞的 delivering」（created_at 早于停滞阈值：
      // 投递中途崩溃的行停在 delivering，靠这里救回），领不到 = 另一个并发调用（直投重试/另一个恢复 tick）
      // 正拿着这行在投，跳过不碰。
      const stalledBefore = new Date(input.now.getTime() - input.olderThanMs);
      for (const row of rows) {
        const claimed = await deps.repository.claimForDelivery({ id: row.id, stalledBefore });
        if (!claimed) {
          continue;
        }
        // 每次尝试先自增 attempt_count（即便本次又崩，attempt_count 已 +1，达上限后不会被反复重扫）。
        await deps.repository.incrementAttempt({ id: row.id });
        const attempt = row.attemptCount + 1;
        const reconstructed = reconstructIntent(row);
        if (!reconstructed) {
          // 缺 target_user 或 delivery_payload（多为迁移前的历史 created 行）——重建不出、无从重投，直接
          // 封顶判死，别让它永远滞留 created。
          await deps.repository.markStatus({ id: row.id, status: "suppressed", deliveredVia: "stalled" });
          result.stalled += 1;
          continue;
        }
        try {
          const outcome = await deliver(row.id, reconstructed, input.now);
          if (outcome.status === "delivered") {
            result.recovered += 1;
          } else {
            // deliver 已把行推到 suppressed 终态（频控/静音/无个人空间）——正常终态。
            result.suppressed += 1;
          }
        } catch (error) {
          // 本次重投又抛（行停在 delivering，attempt_count 已 +1，过停滞阈值后下个 tick 再领回来）。
          logger.warn?.("proactive_intent_recovery_delivery_failed", { intentId: row.id, attempt, error });
          if (attempt >= input.maxAttempts) {
            // 已达重投上限仍投不成 → 封顶判死（delivered_via='stalled'）。
            await deps.repository.markStatus({ id: row.id, status: "suppressed", deliveredVia: "stalled" });
            result.stalled += 1;
          } else {
            result.retryable += 1;
          }
        }
      }
      return result;
    }
  };
}

// R20 REL-2（#P1-11）：从恢复扫描行重建投递用的 intent。缺 target_user 或 delivery_payload → 返回 null
// （不可重建，由调用方判 stalled）。
function reconstructIntent(row: RecoverableProactiveIntentRow): ProactiveIntentInput | null {
  if (!row.targetUserId || !row.deliveryPayload) {
    return null;
  }
  const dp = row.deliveryPayload as ProactiveDeliveryPayload;
  const n = dp.notification;
  if (!n) {
    return null;
  }
  return {
    workspaceId: row.workspaceId,
    projectId: row.projectId,
    workItemId: row.workItemId,
    kind: row.kind as ProactiveIntentKind,
    stage: row.stage ?? "",
    targetUserId: row.targetUserId,
    suppressionKey: row.suppressionKey,
    payload: row.payload,
    notification: {
      type: n.type,
      severity: n.severity,
      title: n.title,
      body: n.body,
      targetUrl: n.targetUrl,
      dedupeKey: n.dedupeKey,
      ...(n.nextRemindAt ? { nextRemindAt: new Date(n.nextRemindAt) } : {})
    },
    ...(dp.channel ? { channel: dp.channel } : {}),
    ...(dp.conversationText !== undefined ? { conversationText: dp.conversationText } : {}),
    ...(dp.degradeToNotification !== undefined ? { degradeToNotification: dp.degradeToNotification } : {})
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

// ── 批 F（F3）关怀文案模板 ──────────────────────────────────────────────────────────────
//
// 关怀扫描（care-scan.ts）产出 kind='care' 的 ProactiveIntent，走本闸【同一条 recordAndDeliver 上限/
// 抑制闸 + 同一条 conversation_message 通道】（Cuu 在个人空间主区主动关怀）——与追 DDL 复用完全一样的
// 地基。措辞是【纯模板、零 LLM】（措辞后续可接 LLM，接缝已解耦）：每类信号 2–3 个模板，按 rotationKey
// 的确定性哈希轮换（不用随机数，保证同一 intent 稳定选同一句）。
//
// 文案红线（负责人逐条审）：不评价工作表现、不施压、不卖惨、无 emoji、绝不引用任何具体信号细节
// （如"你昨晚 2 点还在提交"）——只给模糊、克制的关切，避免让人觉得被监视。中文为主（与既有 Cuu 文案
// 语言纪律一致）。
export type CareIntentSeed = {
  signalType: CareSignalType;
  // 稳定轮换种子（不含任何敏感细节）——同人同类型同周稳定选同一模板。调用方传 suppression_key。
  rotationKey: string;
};

const CARE_TEMPLATES: Record<CareSignalType, readonly string[]> = {
  high_load: [
    "最近你手上的活儿有点多，记得给自己留点喘口气的空间。有什么我能搭把手的，尽管说。",
    "感觉你这阵子挺忙的。别硬扛，需要我帮忙梳理或分担一下的话，随时喊我。",
    "手头的事情不少，注意别把自己绷太紧。要不要我帮你理一理接下来的顺序？"
  ],
  late_night: [
    "这几天都挺晚的，记得早点休息，身体是长期的本钱。有些事白天再弄也来得及。",
    "这阵子别太拼，好好睡一觉，很多事明天再看会更清楚。",
    "夜深了也别忘了照顾好自己。需要我先帮你把明天要处理的整理好吗？"
  ],
  frustration: [
    "最近有些事推进得不太顺，挺正常的，别往心里去。需要一起复盘或者换个思路的话，我在。",
    "反复打磨挺磨人的，你已经很用心了。要不要我帮你看看还能从哪儿调整？",
    "遇到点坎儿很正常，慢慢来。有什么我能帮上忙的，随时找我。"
  ]
};

// 确定性字符串哈希（FNV 风格 · 无依赖 · 非随机）：同一 rotationKey 永远映射到同一模板下标。
function stableTemplateIndex(seed: string, modulo: number): number {
  if (modulo <= 0) {
    return 0;
  }
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return hash % modulo;
}

export function careConversationText(seed: CareIntentSeed): string {
  const templates = CARE_TEMPLATES[seed.signalType];
  return templates[stableTemplateIndex(seed.rotationKey, templates.length)]!;
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
        markStatus: (input) => markProactiveIntentStatus(db, input),
        // R21 加固：投递前的原子领取（created → delivering），并发投递恰好一个能领到。
        claimForDelivery: (input) => claimProactiveIntentForDelivery(db, input),
        // R20 REL-2（#P1-11）：崩溃恢复兜底扫描的两条原语。
        listRecoverable: (input) => listRecoverableProactiveIntents(db, input),
        incrementAttempt: (input) => incrementProactiveIntentAttempt(db, input)
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
