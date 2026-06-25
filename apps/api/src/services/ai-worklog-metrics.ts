import { settings as runtimeSettings } from "@workhub/config";
import {
  getSharedDatabaseClient,
  createPilotMetricsRepository,
  type AiWorklogScope,
  type PilotDay1MetricsRows,
  type PilotMetricsRepository,
  type WorkHubDatabaseClient
} from "@workhub/db";
import type { AiWorklogVM } from "@workhub/contracts";

// 估算口径（保守常量，UI 标注"约省"）：每件被采纳的 AI 直出，约替人省下的工时。
const SAVED_HOURS_PER_ACCEPTED = 0.5;

// AgentRun 终态：自主率 = succeeded / 全部终态。escalated/failed/budget_exhausted/cancelled 视为"没能自主跑完"。
const TERMINAL_RUN_STATUSES = new Set([
  "succeeded",
  "failed",
  "escalated",
  "budget_exhausted",
  "cancelled"
]);

export type AiWorklogMetricsService = {
  getTodayMetrics: (input?: { now?: Date; workspaceId?: string }) => Promise<AiWorklogVM>;
};

function startOfToday(now: Date): Date {
  // L7：用 UTC 日界，与系统其余处（cost ledger periodBounds 等）一致；否则非 UTC 服务器时区下
  // 「今天」的窗口与别处错位。CI/生产服务器为 UTC，行为不变。
  const start = new Date(now);
  start.setUTCHours(0, 0, 0, 0);
  return start;
}

function dateInRange(value: Date | string | null | undefined, from: Date, to: Date): boolean {
  if (!value) {
    return false;
  }
  const ts = typeof value === "string" ? Date.parse(value) : value.getTime();
  if (Number.isNaN(ts)) {
    return false;
  }
  // L#50：统一用 [from, to) 半开区间（与 pilot-day1-metrics 一致），避免两个面板在同一数据上差一行。
  return ts >= from.getTime() && ts < to.getTime();
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export function buildAiWorklog(input: {
  rows: PilotDay1MetricsRows;
  from: Date;
  to: Date;
  now?: Date;
  // R8：今日技能自进化事件（审计动作）。无则视为 0（向后兼容旧调用方）。
  skillCurationEvents?: readonly { action: string }[];
}): AiWorklogVM {
  const { rows, from, to } = input;
  const now = input.now ?? new Date();

  const runsToday = rows.agentRuns.filter(
    (run) =>
      TERMINAL_RUN_STATUSES.has(run.status) &&
      (dateInRange(run.finishedAt, from, to) || dateInRange(run.createdAt, from, to))
  );
  const succeeded = runsToday.filter((run) => run.status === "succeeded").length;
  const autonomyRate = runsToday.length > 0 ? Math.round((succeeded / runsToday.length) * 100) : 0;

  const acceptedToday = rows.proposals.filter((row) => dateInRange(row.mergedAt, from, to)).length;
  const savedHours = round1(acceptedToday * SAVED_HOURS_PER_ACCEPTED);

  const skillEvents = input.skillCurationEvents ?? [];
  const skillsPromotedToday = skillEvents.filter((row) => row.action === "team_skill.distilled_and_promoted").length;
  const skillsRefinedToday = skillEvents.filter((row) => row.action === "team_skill.refined_via_patch").length;

  return {
    runs_today: runsToday.length,
    autonomy_rate: autonomyRate,
    accepted_today: acceptedToday,
    saved_hours_estimate: savedHours,
    skills_promoted_today: skillsPromotedToday,
    skills_refined_today: skillsRefinedToday,
    generated_at: now.toISOString(),
    range_label: "今天"
  };
}

export function createAiWorklogMetricsService(
  repository: PilotMetricsRepository,
  options: { now?: () => Date; defaultWorkspaceId?: string } = {}
): AiWorklogMetricsService {
  const now = options.now ?? (() => new Date());
  // AUTHZ-2：判定「未打标历史行(workspace_id NULL)归谁」的基准——默认工作区。注入可测,缺省取运行时配置。
  const defaultWorkspaceId = options.defaultWorkspaceId ?? runtimeSettings.auth.defaultWorkspaceId;
  return {
    async getTodayMetrics(input) {
      const reference = input?.now ?? now();
      const from = startOfToday(reference);
      // AUTHZ-2：传了 workspaceId 才收口。默认工作区把 NULL 历史行算进来(includeUntagged),非默认工作区只认显式打标行。
      const scope: AiWorklogScope | undefined = input?.workspaceId
        ? { workspaceId: input.workspaceId, includeUntagged: input.workspaceId === defaultWorkspaceId }
        : undefined;
      // 只读今天的 agentRuns/proposals/技能自进化事件（M5：不再为几个数字全表扫 9 张表）。
      // buildAiWorklog 只用到 rows.agentRuns / rows.proposals，其余字段补空即可。
      const slice = await repository.readAiWorklogRows(from, scope);
      return buildAiWorklog({
        rows: {
          workItems: [],
          proposals: slice.proposals,
          reviews: [],
          agentRuns: slice.agentRuns,
          escalationEvents: [],
          approvalRequests: [],
          mergeAttempts: [],
          notifications: [],
          costLedgerEntries: []
        },
        from,
        to: reference,
        now: reference,
        skillCurationEvents: slice.skillCurationEvents
      });
    }
  };
}

let defaultDbClient: WorkHubDatabaseClient | undefined;
let defaultAiWorklogMetricsService: AiWorklogMetricsService | undefined;

export function getDefaultAiWorklogMetricsService(): AiWorklogMetricsService {
  if (!defaultAiWorklogMetricsService) {
    defaultDbClient = defaultDbClient ?? getSharedDatabaseClient();
    defaultAiWorklogMetricsService = createAiWorklogMetricsService(
      createPilotMetricsRepository(defaultDbClient.db)
    );
  }
  return defaultAiWorklogMetricsService;
}
