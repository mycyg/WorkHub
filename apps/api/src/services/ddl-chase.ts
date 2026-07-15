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
// R15 批 D2（Cuu 主动开口）：PROACTIVE_CUU_DELIVERY_ENABLED 开时，t1d/overdue 两档对【有责任人】的工作项
// 改走 conversation_message 通道——Cuu 在责任人的个人空间主区不请自来说一句人话（个人空间不可用则闸内
// 降级回 notification）。t3d 保持通知（温和的不打扰）、escalate/找人保持通知（升级要留痕给项目负责人）。
// 分工要点：overdue 的「每 24h 反复叮嘱」是纯【通知侧】的 reminder 阶梯（nextRemindAt + notification
// reminder pulse）——会话里 Cuu 只说一次，反复催靠通知阶梯（或降级路径），刻意不在会话通道复刻重复
// 叮嘱，避免 Cuu 变复读机。故 nextRemindAt 仍挂在 notification 草稿上（会话投成功则它天然不生效；降级到
// 通知时照旧接 24h 阶梯）。
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

export type DdlStage = "t3d" | "t1d" | "overdue" | "escalate" | "needs_owner";

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
  // R15 批 D2：t1d/overdue 两档是否改走 Cuu 会话通道（PROACTIVE_CUU_DELIVERY_ENABLED，默认 true）。
  // 缺省 false（不注入时回到批 D 的全通知行为）。
  cuuDeliveryEnabled?: boolean;
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

// work_items.title 与 notifications.title 都是 varchar(256)——满长标题拼上「 还有 3 天到期」等后缀会
// 撑破 256 让插入直接抛错。夹到 200，给最长后缀留足余量（后缀均 < 16 字符），超长截断加省略号。
const DISPLAY_TITLE_MAX = 200;

function displayTitle(candidate: DdlChaseCandidateRow): string {
  const title = candidate.title?.trim();
  const base = title && title.length > 0 ? title : candidate.code;
  return base.length > DISPLAY_TITLE_MAX ? `${base.slice(0, DISPLAY_TITLE_MAX - 1)}…` : base;
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
    case "needs_owner":
      return {
        type: "work_item.needs_owner",
        severity: "high",
        title: `${name} 逾期且无人负责`,
        body: `这个工作项 ${dueDate} 已逾期，但还没有人认领，需要你指派或亲自接手。`
      };
  }
}

// R15 批 D2（Cuu 主动开口）：t1d/overdue 两档走会话通道时，Cuu 在个人空间主区说的那句人话（零 LLM
// 模板，措辞后续可接 LLM）。只有这两档有会话文案——其余阶梯（t3d/escalate/找人）留在通知侧。
function stageConversationText(stage: "t1d" | "overdue", candidate: DdlChaseCandidateRow): string {
  const name = displayTitle(candidate);
  if (stage === "t1d") {
    return `提醒一下：「${name}」明天就到期了，需要我帮你看看进度吗？`;
  }
  return `提醒一下：「${name}」已经逾期了，要不要我帮你梳理下接下来怎么推进？`;
}

type IntentPlan =
  | { kind: "skip" }
  | { kind: "no_target" }
  | { kind: "intent"; intent: ProactiveIntentInput };

// R15 批 D2：会话通道开关（默认关——纯函数不感知 env）。调用方（createDdlChaseService）把解析好的
// PROACTIVE_CUU_DELIVERY_ENABLED（默认 true）显式传进来；关闭时 t1d/overdue 也走通知（回到批 D 行为）。
export type PlanDdlIntentOptions = { cuuDeliveryEnabled?: boolean };

// 把一条候选工作项映射成本 tick 该发的 intent（或不发）。纯函数——不投递、不碰 DB。
export function planDdlIntent(
  candidate: DdlChaseCandidateRow,
  now: Date,
  options: PlanDdlIntentOptions = {}
): IntentPlan {
  const responsible = responsibleUserId(candidate);
  const owner = ownerChainUserId(candidate);
  const overdue = now.getTime() >= candidate.dueAt.getTime();

  let stage: DdlStage;
  let targetUserId: string | null;
  let suppressionKey: string;

  if (responsible) {
    const responsibleStage = currentResponsibleStage(now, candidate.dueAt);
    if (!responsibleStage) {
      return { kind: "skip" };
    }
    stage = responsibleStage;
    // 升级发给项目负责人（不是迟到的责任人本人）；其余阶梯发给责任人。
    targetUserId = stage === "escalate" ? owner : responsible;
    suppressionKey = `ddl:${candidate.workItemId}:${stage}`;
  } else {
    // D4 找人：无责任人的工作项，只有逾期后才「找人」，每工作项一张（suppression_key=ddl_card:{id}）。
    // 未逾期则本 tick 无事可做。投递物走本批唯一通道 notifications（发给项目负责人认领/指派）——
    // 交互式 decide 行动卡(claim/reassign/defer)是后续增强，缺口原因见交付报告。
    if (!overdue) {
      return { kind: "skip" };
    }
    stage = "needs_owner";
    targetUserId = owner;
    suppressionKey = `ddl_card:${candidate.workItemId}`;
  }

  if (!targetUserId) {
    return { kind: "no_target" };
  }

  const copy = stageCopy(stage, candidate);
  const notification: ProactiveIntentInput["notification"] = {
    type: copy.type,
    severity: copy.severity,
    title: copy.title,
    body: copy.body,
    // web /workitems/:id 现成；桌面 OS 桥同样拿它当路由（见 notifications.ts 深链约定）。
    targetUrl: `/workitems/${candidate.workItemId}`,
    dedupeKey: suppressionKey,
    // 只有 overdue 进 24h 提醒阶梯（复用 0061 语义）。这个字段只被 notification 通道消费——会话通道投成功
    // 时它天然不生效；降级到通知时照旧接 24h 阶梯（见文件头「反复叮嘱靠通知侧」分工）。
    ...(stage === "overdue" ? { nextRemindAt: new Date(now.getTime() + OVERDUE_REMINDER_INTERVAL_MS) } : {})
  };
  // 会话通道：仅 t1d/overdue（此时必在 responsible 分支，target=责任人）且开关开启时走 Cuu 会话。
  // `stage === "t1d" || stage === "overdue"` 同时把类型收窄给 stageConversationText。
  const conversationText =
    options.cuuDeliveryEnabled && (stage === "t1d" || stage === "overdue")
      ? stageConversationText(stage, candidate)
      : undefined;
  return {
    kind: "intent",
    intent: {
      workspaceId: candidate.workspaceId,
      projectId: candidate.projectId,
      workItemId: candidate.workItemId,
      kind: stage === "needs_owner" ? "find_owner" : "ddl_chase",
      stage,
      targetUserId,
      suppressionKey,
      payload: {
        stage,
        code: candidate.code,
        due_at: candidate.dueAt.toISOString(),
        severity: copy.severity
      },
      notification,
      ...(conversationText ? { channel: "conversation_message" as const, conversationText } : {})
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
        const plan = planDdlIntent(candidate, startedAt, { cuuDeliveryEnabled: deps.cuuDeliveryEnabled ?? false });
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
      quietHours: parseProactiveQuietHours(runtimeSettings.proactive.quietHours),
      cuuDeliveryEnabled: runtimeSettings.proactive.cuuDeliveryEnabled
    });
  }
  return defaultDdlChaseService;
}
