import { settings as runtimeSettings } from "@workhub/config";
import type { NotificationSeverity } from "@workhub/contracts";
import {
  getSharedDatabaseClient,
  listDdlChaseCandidates,
  type DdlChaseCandidateRow
} from "@workhub/db";

import { getDefaultStructuredLogger, type StructuredLogger } from "../logging.js";
import {
  getDefaultProactiveIntentService,
  isWithinProactiveQuietHours,
  parseProactiveQuietHours,
  type ProactiveIntentInput,
  type ProactiveIntentService,
  type ProactiveQuietHours
} from "./proactive-intents.js";

// R15 批 D（主动性 MVP · 追 DDL 阶梯，见 00-overview 第 2/3 层）：ddl-chase pulse 任务主体。纯规则、
// 零 LLM。扫「未完成 / 有 due_at / 有责任人」的工作项，按到期远近走四段阶梯，每段对每工作项只发一次
// （suppression_key = ddl:{workItemId}:{stage}，由 ProactiveIntent 闸幂等兜底）：
//   T-3d（due-72h ~ due-24h）  → 提醒责任人，常规                                      work_item.due_soon
//   T-1d（due-24h ~ due）      → 提醒责任人，高                                        work_item.due_soon
//   逾期（due ~ due+24h）      → 提醒责任人，高 + 进 0061 的 24h 提醒阶梯（可 snooze 停）  work_item.overdue
//   升级（due+24h 起）         → 通知项目负责人（owner/lead 判定链），最高               work_item.escalated_ddl
// 无责任人的逾期项走 D4「找人」：通知项目负责人认领/指派，一张（suppression_key = ddl_card:{workItemId}）。
//
// 阶梯的「跨 stage 跳变」语义：每 tick 只按 now vs due_at 算出【当前】所属阶梯并发那一段——一上来就
// overdue（新建即逾期）只发 overdue，不补发 t3d/t1d（那两段的窗口 now 从没落进去，intent 也就没产过）。
// due_at 改期后各 stage 以新 due_at 重算，但 suppression_key 不含 due_at → 同 stage 改期后不重发
// （这是 MVP 记录在案的取舍：改期无法「重置」已发过的阶梯；代价可接受——避免反复改期刷屏）。
// 完成/取消的工作项由扫描条件（终态排除）自动退出阶梯。

const HOUR_MS = 60 * 60 * 1000;
const T3D_MS = 72 * HOUR_MS;
const T1D_MS = 24 * HOUR_MS;
const ESCALATE_AFTER_MS = 24 * HOUR_MS;
// overdue 通知进 24h 提醒阶梯：首个 next_remind_at = 投递时刻 + 24h（复用 0061 语义，最多 3 提可 snooze 停）。
const OVERDUE_REMINDER_INTERVAL_MS = 24 * HOUR_MS;

const DEFAULT_MAX_PER_TICK = 200;

export type DdlStage = "t3d" | "t1d" | "overdue" | "escalate";

export type DdlChaseRunResult = {
  scanned: number;
  delivered: number;
  suppressed_duplicate: number;
  suppressed_daily_cap: number;
  suppressed_muted: number;
  // 静默时段内「该产但没投」的 intent 数（下个非静默 tick 再产，见 D2 取舍）。
  skipped_quiet_hours: number;
  // 该发但项目负责人判定链为空（无 owner/lead）→ 无处可发，只计数不投。
  skipped_no_target: number;
  // 无责任人但尚未逾期（还不到找人时机）/ 该 tick 无当前阶梯——不产 intent。
  skipped_no_stage: number;
  started_at: string;
  finished_at: string;
};

export type DdlChaseServiceDeps = {
  listCandidates: (input: { now: Date; horizonMs: number; limit: number }) => Promise<DdlChaseCandidateRow[]>;
  proactive: Pick<ProactiveIntentService, "recordAndDeliver">;
  quietHours: ProactiveQuietHours;
  now?: () => Date;
  maxPerTick?: number;
  logger?: Pick<StructuredLogger, "info" | "warn">;
};

// 责任人判定：认领人 > lead 指派 > 协作者指派。都没有 = 无责任人（走 D4 找人）。
function responsibleUserId(candidate: DdlChaseCandidateRow): string | null {
  return candidate.claimedByUserId ?? candidate.leadUserId ?? candidate.collaboratorUserId;
}

// 项目负责人判定链（升级 / 找人的目标）：项目 owner > 工作项 lead 指派。别用死代码 routeApprover。
function ownerChainUserId(candidate: DdlChaseCandidateRow): string | null {
  return candidate.projectOwnerUserId ?? candidate.leadUserId;
}

function currentResponsibleStage(now: Date, dueAt: Date): "t3d" | "t1d" | "overdue" | "escalate" | null {
  const due = dueAt.getTime();
  const at = now.getTime();
  if (at < due - T3D_MS) {
    return null; // 还没进任何阶梯（扫描 cutoff 已排除，这里再兜底）。
  }
  if (at < due - T1D_MS) {
    return "t3d";
  }
  if (at < due) {
    return "t1d";
  }
  if (at < due + ESCALATE_AFTER_MS) {
    return "overdue";
  }
  return "escalate";
}

function displayTitle(candidate: DdlChaseCandidateRow): string {
  const title = candidate.title?.trim();
  return title && title.length > 0 ? title : candidate.code;
}

function formatDueDate(dueAt: Date): string {
  return `${dueAt.getMonth() + 1}月${dueAt.getDate()}日`;
}

type StageCopy = {
  type: string;
  severity: NotificationSeverity;
  title: string;
  body: string;
};

function stageCopy(stage: DdlStage, candidate: DdlChaseCandidateRow): StageCopy {
  const name = displayTitle(candidate);
  const dueDate = formatDueDate(candidate.dueAt);
  switch (stage) {
    case "t3d":
      return {
        type: "work_item.due_soon",
        severity: "normal",
        title: `${name} 还有 3 天到期`,
        body: `这个工作项 ${dueDate} 到期，还有约 3 天，记得安排一下。`
      };
    case "t1d":
      return {
        type: "work_item.due_soon",
        severity: "high",
        title: `${name} 明天到期`,
        body: `这个工作项明天（${dueDate}）就到期了，抓紧推进。`
      };
    case "overdue":
      return {
        type: "work_item.overdue",
        severity: "high",
        title: `${name} 已逾期`,
        body: `这个工作项 ${dueDate} 到期，已经逾期还没完成，需要尽快处理。`
      };
    case "escalate":
      return {
        type: "work_item.escalated_ddl",
        severity: "urgent",
        title: `${name} 逾期超过一天`,
        body: `这个工作项已逾期超过 24 小时仍未完成，需要你来协调推进。`
      };
  }
}

type IntentPlan =
  | { kind: "skip" }
  | { kind: "no_target" }
  | { kind: "intent"; intent: ProactiveIntentInput };

// 把一条候选工作项映射成本 tick 该发的 intent（或不发）。纯函数——不投递、不碰 DB。
export function planDdlIntent(candidate: DdlChaseCandidateRow, now: Date): IntentPlan {
  const responsible = responsibleUserId(candidate);
  const owner = ownerChainUserId(candidate);

  // 无责任人的处置（逾期项走 D4「找人」）在后续 commit 补——本 commit 只发有责任人的四段阶梯。
  if (!responsible) {
    return { kind: "skip" };
  }

  const stage = currentResponsibleStage(now, candidate.dueAt);
  if (!stage) {
    return { kind: "skip" };
  }
  // 升级发给项目负责人（不是迟到的责任人本人）；其余阶梯发给责任人。
  const targetUserId = stage === "escalate" ? owner : responsible;
  if (!targetUserId) {
    return { kind: "no_target" };
  }

  const suppressionKey = `ddl:${candidate.workItemId}:${stage}`;
  const copy = stageCopy(stage, candidate);
  const notification: ProactiveIntentInput["notification"] = {
    type: copy.type,
    severity: copy.severity,
    title: copy.title,
    body: copy.body,
    // web /workitems/:id 现成；桌面 OS 桥同样拿它当路由（见 notifications.ts 深链约定）。
    targetUrl: `/workitems/${candidate.workItemId}`,
    dedupeKey: suppressionKey,
    // 只有 overdue 进 24h 提醒阶梯（复用 0061 语义）。
    ...(stage === "overdue" ? { nextRemindAt: new Date(now.getTime() + OVERDUE_REMINDER_INTERVAL_MS) } : {})
  };
  return {
    kind: "intent",
    intent: {
      workspaceId: candidate.workspaceId,
      projectId: candidate.projectId,
      workItemId: candidate.workItemId,
      kind: "ddl_chase",
      stage,
      targetUserId,
      suppressionKey,
      payload: {
        stage,
        code: candidate.code,
        due_at: candidate.dueAt.toISOString(),
        severity: copy.severity
      },
      notification
    }
  };
}

export function createDdlChaseService(deps: DdlChaseServiceDeps): { runOnce(): Promise<DdlChaseRunResult> } {
  const now = deps.now ?? (() => new Date());
  const logger = deps.logger ?? getDefaultStructuredLogger();
  const maxPerTick = deps.maxPerTick ?? DEFAULT_MAX_PER_TICK;

  return {
    async runOnce(): Promise<DdlChaseRunResult> {
      const startedAt = now();
      const result = {
        scanned: 0,
        delivered: 0,
        suppressed_duplicate: 0,
        suppressed_daily_cap: 0,
        suppressed_muted: 0,
        skipped_quiet_hours: 0,
        skipped_no_target: 0,
        skipped_no_stage: 0
      };

      const candidates = await deps.listCandidates({ now: startedAt, horizonMs: T3D_MS, limit: maxPerTick });
      result.scanned = candidates.length;

      // 静默时段是「服务器本地时刻」的全局判定，本 tick 要么全静默要么全不静默——但仍逐条算出该产的
      // intent 以精确计「该产但静默」数（D2 取舍：静默期不投递，记日志计数，下个非静默 tick 再产）。
      const quiet = isWithinProactiveQuietHours(deps.quietHours, startedAt);

      for (const candidate of candidates) {
        const plan = planDdlIntent(candidate, startedAt);
        if (plan.kind === "skip") {
          result.skipped_no_stage += 1;
          continue;
        }
        if (plan.kind === "no_target") {
          result.skipped_no_target += 1;
          logger.warn?.("ddl_chase_no_target", { workItemId: candidate.workItemId, projectId: candidate.projectId });
          continue;
        }
        if (quiet) {
          result.skipped_quiet_hours += 1;
          continue;
        }
        try {
          const outcome = await deps.proactive.recordAndDeliver(plan.intent);
          if (outcome.status === "delivered") {
            result.delivered += 1;
          } else if (outcome.reason === "duplicate") {
            result.suppressed_duplicate += 1;
          } else if (outcome.reason === "daily_cap") {
            result.suppressed_daily_cap += 1;
          } else {
            result.suppressed_muted += 1;
          }
        } catch (error) {
          // 单条投递失败不连累整批（错误隔离）——intent 若已落库仍在（审计），下个 tick 幂等重试。
          logger.warn?.("ddl_chase_deliver_failed", { workItemId: candidate.workItemId, error });
        }
      }

      if (result.skipped_quiet_hours > 0) {
        logger.info?.("ddl_chase_quiet_hours_deferred", { deferred: result.skipped_quiet_hours });
      }

      return { ...result, started_at: startedAt.toISOString(), finished_at: now().toISOString() };
    }
  };
}

let defaultDdlChaseService: ReturnType<typeof createDdlChaseService> | undefined;

export function getDefaultDdlChaseService(): ReturnType<typeof createDdlChaseService> {
  if (!defaultDdlChaseService) {
    const db = getSharedDatabaseClient().db;
    defaultDdlChaseService = createDdlChaseService({
      listCandidates: (input) => listDdlChaseCandidates(db, input),
      proactive: getDefaultProactiveIntentService(),
      quietHours: parseProactiveQuietHours(runtimeSettings.proactive.quietHours)
    });
  }
  return defaultDdlChaseService;
}
