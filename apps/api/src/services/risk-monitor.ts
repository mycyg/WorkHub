import {
  DEFAULT_RISK_MONITOR_SETTINGS,
  riskMonitorSettingsSchema
} from "@workhub/contracts";
import {
  createActionCardRepository,
  createNotificationRepository,
  getSharedDatabaseClient,
  listDailyCostByProjects,
  listOpenWorkItemAges,
  listProjectsPendingDigest,
  EARLY_STAGE_WORK_ITEM_STATUSES,
  type NotificationRepository,
  type RiskMonitorDailyCostRow,
  type RiskMonitorOpenWorkItemRow,
  type RiskMonitorProjectCandidateRow
} from "@workhub/db";

import { getDefaultStructuredLogger, type StructuredLogger } from "../logging.js";

// R14 批 RISK（风险预警巡检，见 r14-release-readiness/05-risk-design.md §3-§4）：薄 worker + 厚 service
// 二层结构（照 conversation-reply-judge.ts 范式）——这个文件是厚的那层：signal 判定（三条纯函数，
// 不碰 DB） + digest 组装（模板拼接，非 LLM，§1.6 的拍板：三个信号全是确定性数字比较，不该拿不确定性
// 换确定性能算出来的东西） + 发送（notifications 仓库 + 会话系统消息，全部依赖注入、可单测）。
// 调度节奏（tick/start/stop/stats）在 apps/api/src/workers/risk-monitor.ts，那层只是个薄壳。
//
// 与 conversation-observer/conversation-reply-judge 的关键区别：**不受 isConfigured 门控**——三个信号
// 全是规则判定，不调 LLM，任何自托管实例开箱可用（00-plan §4「不新增自托管拦路虎」的落地）。

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MAX_PROJECTS_PER_TICK = 50;
const DEFAULT_WORK_ITEM_CAP_PER_BATCH = 500;
// 每个信号桶展示条目数上限——超出显示「及其余 N 项」而非无限枚举（§3.3）。
const DISPLAY_CAP = 5;

export type RiskMonitorRunResult = {
  scanned: number; // 候选项目数（已排除"今天已经发过且内容不变"的，仓库层反连接过滤）
  sent: number; // 新建通知（+ 播报，若有主区会话）的项目数
  refreshed: number; // 内容变化、更新了通知但未重发播报的项目数
  no_signal: number; // 扫了但三个信号都没命中
  skipped_no_owner: number; // 结构上恒为 0——仓库层 SQL 已经 owner_user_id IS NOT NULL 过滤，这里是防御性兜底计数
  skipped_no_conversation: number; // 通知已发但没有主区会话可播报（legacy 防御分支）
  failed: number;
  started_at: string;
  finished_at: string;
};

export type RiskDigestSignal =
  | { kind: "stalled"; items: Array<{ code: string; title: string; daysIdle: number }>; totalCount: number }
  | { kind: "deadline"; items: Array<{ code: string; title: string; daysUntilDue: number }>; totalCount: number }
  | { kind: "cost_spike"; todayCostCny: string; baselineAvgCny: string | null; ratioPct: number | null };

export type RiskDigest = {
  notificationTitle: string;
  notificationBody: string;
  chatSummary: string;
  chatCounts: { stalled: number; deadline: number; costSpike: boolean };
};

function formatCny(value: number): string {
  return String(Math.round(value * 100) / 100);
}

function formatMultiplier(ratioPct: number): string {
  const value = ratioPct / 100;
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

// §3.5：digest 组装——模板拼接（结构化模板 + 中文数字/名词插值），非 LLM 生成（§1.6 拍板）。
// signals 为空时调用方不该调这个函数（无信号的项目不产出 digest，§3.5 末段）。
export function buildRiskDigest(input: {
  projectId: string;
  projectName: string;
  signals: RiskDigestSignal[];
}): RiskDigest {
  const stalled = input.signals.find(
    (signal): signal is Extract<RiskDigestSignal, { kind: "stalled" }> => signal.kind === "stalled"
  );
  const deadline = input.signals.find(
    (signal): signal is Extract<RiskDigestSignal, { kind: "deadline" }> => signal.kind === "deadline"
  );
  const costSpike = input.signals.find(
    (signal): signal is Extract<RiskDigestSignal, { kind: "cost_spike" }> => signal.kind === "cost_spike"
  );

  const bodyParagraphs: string[] = [];
  const summaryParts: string[] = [];
  let totalSignalCount = 0;

  if (stalled) {
    // DISPLAY_CAP 在这里再钉一次（调用方 computeStalledAndDeadlineSignals 已经截过）——「最多 5 条 +
    // 及其余 N 项」是文案层自己的不变式，不依赖调用方守约。
    const shownItems = stalled.items.slice(0, DISPLAY_CAP);
    const shown = shownItems.map((item) => `${item.code}（${item.title}）已停滞 ${item.daysIdle} 天`);
    const remainder = stalled.totalCount - shownItems.length;
    bodyParagraphs.push(
      `工单停滞（${stalled.totalCount} 项）：${shown.join("；")}${remainder > 0 ? `；及其余 ${remainder} 项` : ""}`
    );
    summaryParts.push(`${stalled.totalCount} 项工单停滞`);
    totalSignalCount += stalled.totalCount;
  }

  if (deadline) {
    const shownItems = deadline.items.slice(0, DISPLAY_CAP);
    const shown = shownItems.map((item) =>
      item.daysUntilDue <= 0
        ? `${item.code}（${item.title}）已过期 ${Math.abs(item.daysUntilDue)} 天仍未动工`
        : `${item.code}（${item.title}）将于 ${item.daysUntilDue} 天后到期仍未动工`
    );
    const remainder = deadline.totalCount - shownItems.length;
    bodyParagraphs.push(
      `临期未动工（${deadline.totalCount} 项）：${shown.join("；")}${remainder > 0 ? `；及其余 ${remainder} 项` : ""}`
    );
    summaryParts.push(`${deadline.totalCount} 项临期未动工`);
    totalSignalCount += deadline.totalCount;
  }

  if (costSpike) {
    if (costSpike.baselineAvgCny !== null && costSpike.ratioPct !== null) {
      bodyParagraphs.push(
        `项目成本：今日 ¥${costSpike.todayCostCny}，是近 7 日日均（¥${costSpike.baselineAvgCny}）的 ${formatMultiplier(costSpike.ratioPct)} 倍。`
      );
    } else {
      bodyParagraphs.push(`项目成本：近期无支出记录，今日新增 ¥${costSpike.todayCostCny}。`);
    }
    summaryParts.push("成本异常放量");
    totalSignalCount += 1;
  }

  return {
    notificationTitle: `${input.projectName} · 今日风险巡检`,
    notificationBody: bodyParagraphs.join("\n"),
    chatSummary: `今天巡检发现 ${totalSignalCount} 项风险信号——${summaryParts.join("、")}`,
    chatCounts: {
      stalled: stalled?.totalCount ?? 0,
      deadline: deadline?.totalCount ?? 0,
      costSpike: Boolean(costSpike)
    }
  };
}

// `Required<RiskMonitorSettings>` 不能直接用做「解析完一定有值」的类型标注——riskMonitorSettingsSchema
// 的每个字段都是 z.optional()，zod 推导出的属性值类型本身就带 `| undefined`（不只是 `?:` 修饰符），
// `Required<T>` 的 `-?` 只去掉可选修饰符，不去掉值类型里显式的 `| undefined`。这里单独声明一个「解析后
// 一定有具体值」的本地类型，避免下游每次读字段都要多余的 undefined 判空。
type ResolvedRiskMonitorSettings = {
  enabled: boolean;
  stall_days_threshold: number;
  deadline_lookahead_days: number;
  cost_spike_ratio_pct: number;
  cost_spike_min_cny: number;
};

// riskMonitorJson 是自由 jsonb（读侧防御性 parse，legacy/手改脏数据不该让整个 tick 崩掉——safeParse
// 失败就退化成「没设置」，全部字段落 DEFAULT_RISK_MONITOR_SETTINGS）。逐字段 ?? 合并而不是对象
// spread：zod optional 字段的属性值类型本身带 `| undefined`，spread 合并会把这个 undefined 联合
// 渗进结果类型，逐字段合并才能让返回值真正落在 ResolvedRiskMonitorSettings 的非 undefined 字段上。
function resolveRiskMonitorSettings(json: Record<string, unknown> | null): ResolvedRiskMonitorSettings {
  const parsed = riskMonitorSettingsSchema.safeParse(json ?? {});
  const value = parsed.success ? parsed.data : {};
  return {
    enabled: value.enabled ?? DEFAULT_RISK_MONITOR_SETTINGS.enabled,
    stall_days_threshold: value.stall_days_threshold ?? DEFAULT_RISK_MONITOR_SETTINGS.stall_days_threshold,
    deadline_lookahead_days: value.deadline_lookahead_days ?? DEFAULT_RISK_MONITOR_SETTINGS.deadline_lookahead_days,
    cost_spike_ratio_pct: value.cost_spike_ratio_pct ?? DEFAULT_RISK_MONITOR_SETTINGS.cost_spike_ratio_pct,
    cost_spike_min_cny: value.cost_spike_min_cny ?? DEFAULT_RISK_MONITOR_SETTINGS.cost_spike_min_cny
  };
}

// §3.2 应用层判定：停滞（无 active run 已经在仓库 SQL 里过滤掉）+ deadline 临近未动工。一个工单可能
// 同时触发两个信号（停滞 5 天且 3 天后到期）——分两个桶分别列，不去重合并，如实呈现两种不同的风险维度。
function computeStalledAndDeadlineSignals(
  items: RiskMonitorOpenWorkItemRow[],
  settings: ResolvedRiskMonitorSettings,
  now: Date
): { stalled?: RiskDigestSignal; deadline?: RiskDigestSignal } {
  const stalledItems: Array<{ code: string; title: string; daysIdle: number }> = [];
  const deadlineItems: Array<{ code: string; title: string; daysUntilDue: number }> = [];

  for (const item of items) {
    const title = item.title ?? "(未命名工单)";
    const idleDays = (now.getTime() - item.updatedAt.getTime()) / ONE_DAY_MS;
    if (idleDays >= settings.stall_days_threshold) {
      stalledItems.push({ code: item.code, title, daysIdle: Math.floor(idleDays) });
    }
    if (
      item.dueAt
      && (EARLY_STAGE_WORK_ITEM_STATUSES as readonly string[]).includes(item.status)
      && item.dueAt.getTime() <= now.getTime() + settings.deadline_lookahead_days * ONE_DAY_MS
    ) {
      const daysUntilDue = Math.ceil((item.dueAt.getTime() - now.getTime()) / ONE_DAY_MS);
      deadlineItems.push({ code: item.code, title, daysUntilDue });
    }
  }

  // 停滞按天数降序（最久的排前面）；临期按到期天数升序（最急的排前面）——各自截 DISPLAY_CAP 展示。
  stalledItems.sort((a, b) => b.daysIdle - a.daysIdle);
  deadlineItems.sort((a, b) => a.daysUntilDue - b.daysUntilDue);

  return {
    ...(stalledItems.length > 0
      ? { stalled: { kind: "stalled" as const, items: stalledItems.slice(0, DISPLAY_CAP), totalCount: stalledItems.length } }
      : {}),
    ...(deadlineItems.length > 0
      ? { deadline: { kind: "deadline" as const, items: deadlineItems.slice(0, DISPLAY_CAP), totalCount: deadlineItems.length } }
      : {})
  };
}

// §3.4 应用层判定：todayCost/baselineAvg 拆分 + 双闸门（比例 + 绝对值下限）+ 冷启动分支（近 7 日无
// 支出记录时改用 2 倍 min_cny 的更高门槛，避免项目刚起步第一次跑 agent 就被判定"异常"）。
function computeCostSpikeSignal(
  rows: RiskMonitorDailyCostRow[],
  utcDate: string,
  settings: ResolvedRiskMonitorSettings
): RiskDigestSignal | undefined {
  const todayRow = rows.find((row) => row.periodBucket === utcDate);
  const todayCost = todayRow ? Number(todayRow.costCny) : 0;
  const baselineRows = rows.filter((row) => row.periodBucket !== utcDate);
  const baselineSum = baselineRows.reduce((sum, row) => sum + Number(row.costCny), 0);
  const baselineAvg = baselineRows.length > 0 ? baselineSum / baselineRows.length : 0;

  if (baselineAvg > 0) {
    const ratio = todayCost / baselineAvg;
    const ratioThreshold = settings.cost_spike_ratio_pct / 100;
    if (ratio >= ratioThreshold && todayCost >= settings.cost_spike_min_cny) {
      return {
        kind: "cost_spike",
        todayCostCny: formatCny(todayCost),
        baselineAvgCny: formatCny(baselineAvg),
        ratioPct: Math.round(ratio * 100)
      };
    }
    return undefined;
  }

  // 冷启动：近 7 日无成本活动，今天冒出新支出——比常规 floor 高一档（2x），不单独算比例。
  if (todayCost >= settings.cost_spike_min_cny * 2) {
    return { kind: "cost_spike", todayCostCny: formatCny(todayCost), baselineAvgCny: null, ratioPct: null };
  }
  return undefined;
}

function groupByProjectId<T extends { projectId: string }>(rows: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const bucket = map.get(row.projectId);
    if (bucket) {
      bucket.push(row);
    } else {
      map.set(row.projectId, [row]);
    }
  }
  return map;
}

export type RiskMonitorRepositoryDeps = {
  listProjectsPendingDigest: (input: { utcDate: string; limit: number }) => Promise<RiskMonitorProjectCandidateRow[]>;
  listOpenWorkItemAges: (input: { projectIds: string[]; capPerBatch: number }) => Promise<RiskMonitorOpenWorkItemRow[]>;
  listDailyCostByProjects: (input: { projectIds: string[]; sinceBucket: string }) => Promise<RiskMonitorDailyCostRow[]>;
};

export type RiskMonitorPostSystemMessageInput = {
  workspaceId: string;
  conversationId: string;
  senderType: "cuu";
  content: Record<string, unknown>;
  at?: Date;
};

export type RiskMonitorServiceDeps = {
  repository: RiskMonitorRepositoryDeps;
  notifications: Pick<NotificationRepository, "createOrUpdateNotification">;
  postSystemMessage: (input: RiskMonitorPostSystemMessageInput) => Promise<unknown>;
  now?: () => Date;
  logger?: Pick<StructuredLogger, "warn">;
  maxProjectsPerTick?: number;
  workItemCapPerBatch?: number;
};

export type RiskMonitorService = {
  runOnce(): Promise<RiskMonitorRunResult>;
};

export function createRiskMonitorService(deps: RiskMonitorServiceDeps): RiskMonitorService {
  const now = deps.now ?? (() => new Date());
  const logger = deps.logger ?? getDefaultStructuredLogger();
  const maxProjectsPerTick = deps.maxProjectsPerTick ?? DEFAULT_MAX_PROJECTS_PER_TICK;
  const workItemCapPerBatch = deps.workItemCapPerBatch ?? DEFAULT_WORK_ITEM_CAP_PER_BATCH;

  return {
    async runOnce() {
      const startedAt = now();
      const utcDate = startedAt.toISOString().slice(0, 10);
      const result = {
        scanned: 0,
        sent: 0,
        refreshed: 0,
        no_signal: 0,
        skipped_no_owner: 0,
        skipped_no_conversation: 0,
        failed: 0
      };

      const candidates = await deps.repository.listProjectsPendingDigest({
        utcDate,
        limit: maxProjectsPerTick
      });
      result.scanned = candidates.length;
      if (candidates.length === 0) {
        return { ...result, started_at: startedAt.toISOString(), finished_at: now().toISOString() };
      }

      const projectIds = candidates.map((candidate) => candidate.projectId);
      const sinceBucket = new Date(startedAt.getTime() - 7 * ONE_DAY_MS).toISOString().slice(0, 10);
      const [workItemRows, costRows] = await Promise.all([
        deps.repository.listOpenWorkItemAges({ projectIds, capPerBatch: workItemCapPerBatch }),
        deps.repository.listDailyCostByProjects({ projectIds, sinceBucket })
      ]);
      const workItemsByProject = groupByProjectId(workItemRows);
      const costByProject = groupByProjectId(costRows);

      for (const candidate of candidates) {
        try {
          // 结构上不可达（仓库 SQL 已经 owner_user_id IS NOT NULL 过滤）——防御性兜底，不信任上游。
          if (!candidate.ownerUserId) {
            result.skipped_no_owner += 1;
            continue;
          }

          const settings = resolveRiskMonitorSettings(candidate.riskMonitorJson);
          const { stalled, deadline } = computeStalledAndDeadlineSignals(
            workItemsByProject.get(candidate.projectId) ?? [],
            settings,
            startedAt
          );
          const costSpike = computeCostSpikeSignal(
            costByProject.get(candidate.projectId) ?? [],
            utcDate,
            settings
          );
          const signals = [stalled, deadline, costSpike].filter(
            (signal): signal is RiskDigestSignal => signal !== undefined
          );

          if (signals.length === 0) {
            result.no_signal += 1;
            continue;
          }

          const digest = buildRiskDigest({
            projectId: candidate.projectId,
            projectName: candidate.projectName,
            signals
          });
          const dedupeKey = `risk-digest:${candidate.projectId}:${utcDate}`;
          const writeResult = await deps.notifications.createOrUpdateNotification(
            {
              userId: candidate.ownerUserId,
              type: "project.risk_digest",
              severity: "normal",
              title: digest.notificationTitle,
              body: digest.notificationBody,
              targetUrl: `/projects/${candidate.projectId}`,
              projectId: candidate.projectId,
              dedupeKey
            },
            startedAt
          );

          if (!writeResult.created) {
            // 内容变化、更新了通知但未重发播报——「一天一次 digest」的第二道门：只在今天第一次真正
            // 建出这条通知时才顺带发会话消息，不重复打扰聊天区。
            result.refreshed += 1;
            continue;
          }
          result.sent += 1;

          if (!candidate.mainConversationId) {
            // legacy 防御分支：只发通知，不报错。
            result.skipped_no_conversation += 1;
            continue;
          }
          try {
            await deps.postSystemMessage({
              workspaceId: candidate.workspaceId,
              conversationId: candidate.mainConversationId,
              senderType: "cuu",
              content: {
                event: "risk_digest",
                project_id: candidate.projectId,
                summary: digest.chatSummary,
                stalled_count: digest.chatCounts.stalled,
                deadline_count: digest.chatCounts.deadline,
                cost_spike: digest.chatCounts.costSpike,
                target_url: `/projects/${candidate.projectId}`
              },
              at: startedAt
            });
          } catch (error) {
            // 会话播报是锦上添花——通知已经落库成功，播报失败只告警，不回滚通知、不重试
            // （同 run-conversation-report.ts 的既有取舍）。
            logger.warn?.("risk_digest_conversation_post_failed", { projectId: candidate.projectId, error });
          }
        } catch (error) {
          result.failed += 1;
          logger.warn?.("risk_monitor_candidate_failed", { projectId: candidate.projectId, error });
        }
      }

      return { ...result, started_at: startedAt.toISOString(), finished_at: now().toISOString() };
    }
  };
}

let defaultRiskMonitorService: RiskMonitorService | undefined;

export function getDefaultRiskMonitorService(): RiskMonitorService {
  if (!defaultRiskMonitorService) {
    const dbClient = getSharedDatabaseClient();
    const db = dbClient.db;
    const notifications = createNotificationRepository(db);
    const actionCards = createActionCardRepository(db);
    defaultRiskMonitorService = createRiskMonitorService({
      repository: {
        listProjectsPendingDigest: (input) => listProjectsPendingDigest(db, input),
        listOpenWorkItemAges: (input) => listOpenWorkItemAges(db, input),
        listDailyCostByProjects: (input) => listDailyCostByProjects(db, input)
      },
      notifications,
      postSystemMessage: (input) => actionCards.postSystemMessage(input)
    });
  }
  return defaultRiskMonitorService;
}
