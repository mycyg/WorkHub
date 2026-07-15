import { settings as runtimeSettings } from "@workhub/config";
import type { NotificationSeverity } from "@workhub/contracts";
import {
  countDeliveredProactiveIntentsForUser,
  getSharedDatabaseClient,
  markProactiveIntentStatus,
  recordProactiveIntent,
  type RecordProactiveIntentResult,
  type WorkHubDatabaseClient
} from "@workhub/db";

import { getDefaultStructuredLogger, type StructuredLogger } from "../logging.js";
import {
  createNotificationService,
  type NotificationService
} from "./notifications.js";

// R15 批 D（主动性 MVP · ProactiveIntent 决策/投递层）：主动打扰的唯一闸门。
//
// ── 闸门约定（未来所有主动打扰都必须走这里，务必读懂）──────────────────────────────────────
// recordAndDeliver 是「先记 intent → 过频控闸 → 投递」的单一路径。追 DDL、找人，以及**未来 Cuu
// 主动开口**（在协同/私聊会话里不请自来地说话，见 00-overview 第 4 层投递「Cuu 主动开口走新 turns
// 入口，必须带 intent id 审计」）——一律先在此拿到一条 proactive_intent 及其 id，把该 id 挂在实际
// 投递物（通知/未来的会话 turn）上做审计溯源。**规则闸判定要不要打扰、LLM 只管措辞**：本闸是纯规则
// （每人每日上限 + 用户级静音），零 LLM 调用。
//
// 本批唯一投递通道 = notifications（delivered_via='notification'）。会话内 digest 卡 / SSE / Cuu turns
// 是后续批次的通道，各自 delivered_via 值不同，但都复用本闸的记录 + 频控前置。
//
// 静默时段（PROACTIVE_QUIET_HOURS）的取舍：不在这里拦——静默期内「延后投递」在通知可见性层不好做，
// 故改在扫描任务（ddl-chase）里静默期直接不产 intent、把「该产但静默」记日志计数，下个非静默 tick
// 再产（suppression_key 保证只产一次，等于把投递延到静默结束）。本闸只管每人每日上限 + 静音。

export type ProactiveIntentKind = "ddl_chase" | "find_owner";

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
  notification: ProactiveIntentNotification;
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
  // 本批唯一投递通道。createNotification 内部已做用户级按类型静音（isMutedForRecipient）——静音时返回
  // null，本闸据此把 intent 记 suppressed（新通知类型自动可静音，无需在此重复判定）。
  notifications: Pick<NotificationService, "createNotification">;
  dailyCapPerUser: number;
  now?: () => Date;
  logger?: Pick<StructuredLogger, "warn">;
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

      // 3) 投递（本批唯一通道=notifications）。createNotification 内部按类型静音返回 null → 记 suppressed。
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
      dailyCapPerUser: runtimeSettings.proactive.dailyCapPerUser
    });
  }
  return defaultService;
}
