import {
  getSharedDatabaseClient,
  createPilotMetricsRepository,
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
  getTodayMetrics: (input?: { now?: Date }) => Promise<AiWorklogVM>;
};

function startOfToday(now: Date): Date {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
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
  return ts >= from.getTime() && ts <= to.getTime();
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export function buildAiWorklog(input: {
  rows: PilotDay1MetricsRows;
  from: Date;
  to: Date;
  now?: Date;
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

  return {
    runs_today: runsToday.length,
    autonomy_rate: autonomyRate,
    accepted_today: acceptedToday,
    saved_hours_estimate: savedHours,
    generated_at: now.toISOString(),
    range_label: "今天"
  };
}

export function createAiWorklogMetricsService(
  repository: PilotMetricsRepository,
  options: { now?: () => Date } = {}
): AiWorklogMetricsService {
  const now = options.now ?? (() => new Date());
  return {
    async getTodayMetrics(input) {
      const reference = input?.now ?? now();
      const from = startOfToday(reference);
      // 只读今天的 agentRuns/proposals（M5：不再为 4 个数字全表扫 9 张表）。
      // buildAiWorklog 只用到 rows.agentRuns / rows.proposals，其余字段补空即可。
      const slice = await repository.readAiWorklogRows(from);
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
        now: reference
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
