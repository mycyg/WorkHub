import { settings as runtimeSettings } from "@workhub/config";
import {
  countDeliveredCareIntentsForUser,
  createUserRepository,
  detectFrustrationSignals,
  detectHighLoadSignals,
  detectLateNightSignals,
  getSharedDatabaseClient,
  listActiveCareSignals,
  upsertCareSignal,
  type ActiveCareSignal,
  type CareSignalType,
  type FrustrationSignalRow,
  type HighLoadSignalRow,
  type LateNightSignalRow
} from "@workhub/db";

import { getDefaultStructuredLogger, type StructuredLogger } from "../logging.js";
import { CARE_MESSAGE_MUTE_TYPE } from "./notifications.js";
import {
  careConversationText,
  getDefaultProactiveIntentService,
  isWithinProactiveQuietHours,
  parseProactiveQuietHours,
  type ProactiveIntentInput,
  type ProactiveIntentService,
  type ProactiveQuietHours
} from "./proactive-intents.js";

// R15 批 F（主动关怀 · care-scan pulse 任务，见 proactive-intents.ts 的闸门约定）：Cuu 基于规则信号
// 对成员的「闲聊/问候式关怀」。做砸了最伤好感，故设计纪律极严——
//   * 【要不要说】纯规则决定，零 LLM 判定；【怎么说】纯模板（careConversationText，措辞后续可接 LLM）。
//   * 投递只走 conversation_message 通道（Cuu 在个人空间主区说话）；个人空间不可用 → 直接 suppressed，
//     绝不降级到系统通知（degradeToNotification=false）——关怀走系统通知反而尴尬。
//   * 频控层层叠加（从宽到窄）：静默时段 → opt-out → 每人每周关怀总闸 → 每类每周抑制键 → 每人每日上限
//     → 个人空间可用性。前三层在本扫描前置，后三层复用 proactive-intents 闸（recordAndDeliver）。
//
// 一 tick 两步：① F1 侦测三类信号并 upsert 进 user_memories（记忆写入源拓宽，可衰减）；② F2 读活跃信号
// → 产 care intent 投递。静默期只跳过第②步（第①步纯 DB bookkeeping 不打扰用户）。

// 关怀 opt-out 存储：复用既有「通知按类型静音」列 + 保留伪类型 CARE_MESSAGE_MUTE_TYPE（定义在
// notifications.ts，作单一真相；见那里的注释）。默认（清单里没有它）= 开启关怀。

const CARE_SIGNAL_WINDOW_DAYS = 7;
const DEFAULT_MAX_PER_TICK = 500;

export type CareScanRunResult = {
  // F1：本 tick upsert 的信号数（三类合计）。
  signals_detected: number;
  // F2：本 tick 纳入 intent 判定的活跃信号数。
  scanned: number;
  delivered: number;
  suppressed_duplicate: number;
  suppressed_daily_cap: number;
  // 每人每周关怀总闸挡下。
  suppressed_weekly_cap: number;
  // 个人空间不可用（关怀不降级到通知）。
  suppressed_no_personal_space: number;
  // 用户关掉了关怀。
  skipped_opted_out: number;
  // 静默时段（本 tick 不产 intent，下个非静默 tick 再产；周抑制键保证一周一次）。
  skipped_quiet_hours: number;
  started_at: string;
  finished_at: string;
};

export type CareScanServiceDeps = {
  detectHighLoad: (input: { now: Date; threshold: number; limit: number }) => Promise<HighLoadSignalRow[]>;
  detectLateNight: (input: { now: Date; windowDays: number; minNights: number; limit: number }) => Promise<LateNightSignalRow[]>;
  detectFrustration: (input: { now: Date; windowDays: number; threshold: number }) => Promise<FrustrationSignalRow[]>;
  upsertSignal: (input: {
    userId: string;
    workspaceId: string;
    signalType: CareSignalType;
    valueMd: string;
    confidence: number;
    now: Date;
  }) => Promise<void>;
  listActiveSignals: (input: { now: Date; limit: number }) => Promise<ActiveCareSignal[]>;
  countWeeklyCareForUser: (input: { targetUserId: string; from: Date; to: Date }) => Promise<number>;
  // 关怀 opt-out 判定（true=用户关掉了关怀，跳过）。默认永远 false（不注入=不启用 opt-out）。
  isCareOptedOut: (userId: string) => Promise<boolean>;
  proactive: Pick<ProactiveIntentService, "recordAndDeliver">;
  quietHours: ProactiveQuietHours;
  weeklyCap: number;
  highLoadThreshold: number;
  lateNightMinNights: number;
  frustrationThreshold: number;
  maxPerTick?: number;
  now?: () => Date;
  logger?: Pick<StructuredLogger, "info" | "warn">;
};

// 服务器本地周边界：本周一 00:00 → 下周一 00:00（本地时区），并给一个稳定的周键（周一日期 YYYYMMDD）。
// 周频总闸的计数窗与 suppression_key 的「周序号」共用同一边界，保证口径一致。
export function localWeekBounds(now: Date): { from: Date; to: Date; key: string } {
  const daysSinceMonday = (now.getDay() + 6) % 7; // getDay: 0=Sun..6=Sat → Mon=0
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysSinceMonday, 0, 0, 0, 0);
  const to = new Date(from.getTime());
  to.setDate(to.getDate() + 7);
  const key = `${from.getFullYear()}${String(from.getMonth() + 1).padStart(2, "0")}${String(from.getDate()).padStart(2, "0")}`;
  return { from, to, key };
}

// 信号强度 → confidence（内部，非用户可见）：基线 0.6，随超阈程度小幅抬高，封顶 0.9。
function highLoadConfidence(row: HighLoadSignalRow): number {
  return Math.min(0.9, 0.6 + 0.05 * row.overdueCount);
}
function lateNightConfidence(row: LateNightSignalRow, minNights: number): number {
  return Math.min(0.9, 0.5 + 0.1 * Math.max(0, row.nightCount - minNights + 1));
}
function frustrationConfidence(row: FrustrationSignalRow, threshold: number): number {
  return Math.min(0.9, 0.6 + 0.1 * Math.max(0, row.rejectionCount - threshold + 1));
}

// 信号的内部审计正文（绝不作为发给用户的关怀文案；仅供审计/未来 LLM 措辞参考）。
function highLoadValue(row: HighLoadSignalRow): string {
  return `负责的未完成工作项 ${row.openCount} 件，其中 ${row.overdueCount} 件已逾期。`;
}
function lateNightValue(row: LateNightSignalRow): string {
  return `近 ${CARE_SIGNAL_WINDOW_DAYS} 天有 ${row.nightCount} 个深夜时段有活动。`;
}
function frustrationValue(row: FrustrationSignalRow): string {
  return `近 ${CARE_SIGNAL_WINDOW_DAYS} 天提案被打回 ${row.rejectionCount} 次。`;
}

function buildCareIntent(signal: ActiveCareSignal, suppressionKey: string, weekKey: string): ProactiveIntentInput {
  const text = careConversationText({ signalType: signal.signalType, rotationKey: suppressionKey });
  return {
    workspaceId: signal.workspaceId,
    // 关怀只关切「人」，不挂具体项目/工作项。
    projectId: null,
    workItemId: null,
    kind: "care",
    stage: signal.signalType,
    targetUserId: signal.userId,
    suppressionKey,
    payload: { signal_type: signal.signalType, confidence: signal.confidence, week: weekKey },
    channel: "conversation_message",
    conversationText: text,
    // 关怀绝不降级到系统通知——个人空间不可用则直接 suppressed。
    degradeToNotification: false,
    // 惰性占位草稿：degradeToNotification=false 时闸永不消费它（关怀不产通知）。
    notification: {
      type: CARE_MESSAGE_MUTE_TYPE,
      severity: "normal",
      title: "Cuu 的关怀",
      body: text,
      targetUrl: "/",
      dedupeKey: suppressionKey
    }
  };
}

export function createCareScanService(deps: CareScanServiceDeps): { runOnce(): Promise<CareScanRunResult> } {
  const now = deps.now ?? (() => new Date());
  const logger = deps.logger ?? getDefaultStructuredLogger();
  const maxPerTick = deps.maxPerTick ?? DEFAULT_MAX_PER_TICK;

  return {
    async runOnce(): Promise<CareScanRunResult> {
      const startedAt = now();
      const result: Omit<CareScanRunResult, "started_at" | "finished_at"> = {
        signals_detected: 0,
        scanned: 0,
        delivered: 0,
        suppressed_duplicate: 0,
        suppressed_daily_cap: 0,
        suppressed_weekly_cap: 0,
        suppressed_no_personal_space: 0,
        skipped_opted_out: 0,
        skipped_quiet_hours: 0
      };

      // ── F1：侦测三类信号并 upsert（可衰减记忆；静默期照常刷新——纯 DB bookkeeping，不打扰用户）──
      const [highLoad, lateNight, frustration] = await Promise.all([
        deps.detectHighLoad({ now: startedAt, threshold: deps.highLoadThreshold, limit: maxPerTick }),
        deps.detectLateNight({ now: startedAt, windowDays: CARE_SIGNAL_WINDOW_DAYS, minNights: deps.lateNightMinNights, limit: maxPerTick }),
        deps.detectFrustration({ now: startedAt, windowDays: CARE_SIGNAL_WINDOW_DAYS, threshold: deps.frustrationThreshold })
      ]);
      for (const row of highLoad) {
        await deps.upsertSignal({ userId: row.userId, workspaceId: row.workspaceId, signalType: "high_load", valueMd: highLoadValue(row), confidence: highLoadConfidence(row), now: startedAt });
        result.signals_detected += 1;
      }
      for (const row of lateNight) {
        await deps.upsertSignal({ userId: row.userId, workspaceId: row.workspaceId, signalType: "late_night", valueMd: lateNightValue(row), confidence: lateNightConfidence(row, deps.lateNightMinNights), now: startedAt });
        result.signals_detected += 1;
      }
      for (const row of frustration) {
        await deps.upsertSignal({ userId: row.userId, workspaceId: row.workspaceId, signalType: "frustration", valueMd: frustrationValue(row), confidence: frustrationConfidence(row, deps.frustrationThreshold), now: startedAt });
        result.signals_detected += 1;
      }

      // ── F2：读活跃信号 → 产 care intent（静默期跳过，下个非静默 tick 再产；周抑制键保证一周一次）──
      const quiet = isWithinProactiveQuietHours(deps.quietHours, startedAt);
      const week = localWeekBounds(startedAt);
      const active = await deps.listActiveSignals({ now: startedAt, limit: maxPerTick });
      result.scanned = active.length;

      // 每用户本周已投递关怀数（懒查一次、投成功后本地自增）+ opt-out 缓存（同一 tick 同一用户只查一次）。
      const weeklyTally = new Map<string, number>();
      const optOutCache = new Map<string, boolean>();

      for (const signal of active) {
        if (quiet) {
          result.skipped_quiet_hours += 1;
          continue;
        }
        let optedOut = optOutCache.get(signal.userId);
        if (optedOut === undefined) {
          optedOut = await deps.isCareOptedOut(signal.userId);
          optOutCache.set(signal.userId, optedOut);
        }
        if (optedOut) {
          result.skipped_opted_out += 1;
          continue;
        }
        let delivered = weeklyTally.get(signal.userId);
        if (delivered === undefined) {
          delivered = await deps.countWeeklyCareForUser({ targetUserId: signal.userId, from: week.from, to: week.to });
          weeklyTally.set(signal.userId, delivered);
        }
        if (delivered >= deps.weeklyCap) {
          result.suppressed_weekly_cap += 1;
          continue;
        }
        const suppressionKey = `care:${signal.userId}:${signal.signalType}:${week.key}`;
        try {
          const outcome = await deps.proactive.recordAndDeliver(buildCareIntent(signal, suppressionKey, week.key));
          if (outcome.status === "delivered") {
            result.delivered += 1;
            weeklyTally.set(signal.userId, delivered + 1);
          } else if (outcome.reason === "duplicate") {
            result.suppressed_duplicate += 1;
          } else if (outcome.reason === "daily_cap") {
            result.suppressed_daily_cap += 1;
          } else if (outcome.reason === "no_personal_space") {
            result.suppressed_no_personal_space += 1;
          }
          // 'muted' 对关怀不适用（关怀不走通知通道），落到这里不计入任何桶。
        } catch (error) {
          // 单条投递失败不连累整批（错误隔离）——intent 若已落库仍在（审计），下 tick 幂等重试。
          logger.warn?.("care_scan_deliver_failed", { userId: signal.userId, signalType: signal.signalType, error });
        }
      }

      if (result.skipped_quiet_hours > 0) {
        logger.info?.("care_scan_quiet_hours_deferred", { deferred: result.skipped_quiet_hours });
      }

      return { ...result, started_at: startedAt.toISOString(), finished_at: now().toISOString() };
    }
  };
}

let defaultCareScanService: ReturnType<typeof createCareScanService> | undefined;

export function getDefaultCareScanService(): ReturnType<typeof createCareScanService> {
  if (!defaultCareScanService) {
    const db = getSharedDatabaseClient().db;
    const users = createUserRepository(db);
    defaultCareScanService = createCareScanService({
      detectHighLoad: (input) => detectHighLoadSignals(db, input),
      detectLateNight: (input) => detectLateNightSignals(db, input),
      detectFrustration: (input) => detectFrustrationSignals(db, input),
      upsertSignal: (input) => upsertCareSignal(db, input),
      listActiveSignals: (input) => listActiveCareSignals(db, input),
      countWeeklyCareForUser: (input) => countDeliveredCareIntentsForUser(db, input),
      // opt-out：读该用户被静音的类型清单，含关怀伪类型即视为关掉关怀。查询不可用/抛错 → 不 opt-out
      // （fail-open，与通知静音的 DEFAULT-OFF 同调）。
      isCareOptedOut: async (userId) => {
        if (!users.getMutedNotificationTypes) {
          return false;
        }
        try {
          const muted = await users.getMutedNotificationTypes(userId);
          return Array.isArray(muted) && muted.includes(CARE_MESSAGE_MUTE_TYPE);
        } catch {
          return false;
        }
      },
      proactive: getDefaultProactiveIntentService(),
      quietHours: parseProactiveQuietHours(runtimeSettings.proactive.quietHours),
      weeklyCap: runtimeSettings.proactive.careWeeklyCap,
      highLoadThreshold: runtimeSettings.proactive.careHighLoadThreshold,
      lateNightMinNights: runtimeSettings.proactive.careLateNightMinNights,
      frustrationThreshold: runtimeSettings.proactive.careFrustrationThreshold
    });
  }
  return defaultCareScanService;
}
