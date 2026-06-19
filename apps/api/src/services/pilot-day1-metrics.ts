import { getSharedDatabaseClient, createPilotMetricsRepository, type PilotDay1MetricsRows, type PilotMetricsRepository, type WorkHubDatabaseClient } from "@workhub/db";
import { pilotDay1MetricsSnapshotSchema, type PilotDay1Metric, type PilotDay1MetricsSnapshot } from "@workhub/contracts";
import type { CostLedgerEntry } from "@workhub/cost";

import type { AuthActor } from "../middleware/auth.js";

export class PilotDay1MetricsServiceError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
  }
}

export type PilotDay1MetricsService = {
  snapshot: (input: {
    actor: AuthActor;
    from?: Date;
    to?: Date;
  }) => Promise<PilotDay1MetricsSnapshot>;
};

export type PilotDay1MetricsServiceOptions = {
  now?: () => Date;
};

type MetricDefinition = Pick<PilotDay1Metric, "label_zh" | "label_en" | "source_tables">;

const metricDefinitions: Record<PilotDay1Metric["id"], MetricDefinition> = {
  closed_loop_count: {
    label_zh: "闭环完成件数",
    label_en: "Closed loops",
    source_tables: ["proposals", "work_items"]
  },
  proposal_adoption_rate: {
    label_zh: "AI 直出采纳率",
    label_en: "Proposal adoption",
    source_tables: ["proposals", "reviews"]
  },
  escalation_count: {
    label_zh: "升级次数",
    label_en: "Escalations",
    source_tables: ["escalation_events", "approval_requests"]
  },
  cost_per_merged_item_cny: {
    label_zh: "每件成本",
    label_en: "Cost per merged item",
    source_tables: ["cost_ledger_entries", "usage_records", "proposals"]
  },
  conflict_count: {
    label_zh: "冲突数",
    label_en: "Conflicts",
    source_tables: ["merge_attempts"]
  },
  notification_density: {
    label_zh: "打扰密度",
    label_en: "Notification density",
    source_tables: ["notifications", "users"]
  }
};

let defaultDbClient: WorkHubDatabaseClient | undefined;
let defaultPilotDay1MetricsService: PilotDay1MetricsService | undefined;

function startOfLast24Hours(now: Date) {
  return new Date(now.getTime() - 24 * 60 * 60 * 1000);
}

export function defaultPilotDay1MetricsRange(now = new Date()) {
  return {
    from: startOfLast24Hours(now),
    to: now
  };
}

function dateInRange(value: Date | string | null | undefined, from: Date, to: Date) {
  if (!value) {
    return false;
  }
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(time) && time >= from.getTime() && time < to.getTime();
}

function parseCny(value: string | number | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatCny(value: number) {
  if (!Number.isFinite(value)) {
    return "0";
  }
  return value.toFixed(6).replace(/\.?0+$/u, "") || "0";
}

function formatRate(numerator: number, denominator: number) {
  if (denominator <= 0) {
    return "sample insufficient";
  }
  return `${Math.round((numerator / denominator) * 100)}%`;
}

function metric(input: {
  id: PilotDay1Metric["id"];
  value: string;
  numerator: number;
  denominator: number | null;
  unit?: string;
  status?: PilotDay1Metric["status"];
}): PilotDay1Metric {
  const definition = metricDefinitions[input.id];
  return {
    id: input.id,
    label_zh: definition.label_zh,
    label_en: definition.label_en,
    value: input.value,
    ...(input.unit ? { unit: input.unit } : {}),
    numerator: input.numerator,
    denominator: input.denominator,
    status: input.status ?? (input.denominator === 0 ? "sample_insufficient" : "pass"),
    source_tables: definition.source_tables
  };
}

function uniqueUsageEntries(rows: PilotDay1MetricsRows["costLedgerEntries"], from: Date, to: Date) {
  const seen = new Set<string>();
  const unique: CostLedgerEntry[] = [];
  for (const entry of rows) {
    if (!dateInRange(entry.createdAt, from, to) || seen.has(entry.usageRecordId)) {
      continue;
    }
    seen.add(entry.usageRecordId);
    unique.push(entry);
  }
  return unique;
}

function addUser(users: Set<string>, userId: string | null | undefined) {
  if (userId) {
    users.add(userId);
  }
}

export function buildPilotDay1MetricsSnapshot(input: {
  rows: PilotDay1MetricsRows;
  from: Date;
  to: Date;
  generatedAt?: Date;
}): PilotDay1MetricsSnapshot {
  const generatedAt = input.generatedAt ?? new Date();
  const { rows, from, to } = input;
  const workItemsCreated = rows.workItems.filter((row) => dateInRange(row.createdAt, from, to));
  const proposalsOpened = rows.proposals.filter((row) => dateInRange(row.createdAt, from, to));
  const proposalsReviewed = rows.proposals.filter((row) => dateInRange(row.reviewedAt, from, to));
  const proposalsMerged = rows.proposals.filter((row) => dateInRange(row.mergedAt, from, to));
  const proposalsRejected = proposalsReviewed.filter((row) => row.status === "rejected");
  const closedLoopWorkItemIds = new Set(proposalsMerged.map((row) => row.workItemId));
  const escalationEvents = rows.escalationEvents.filter((row) => dateInRange(row.createdAt, from, to));
  const approvalRequests = rows.approvalRequests.filter((row) => dateInRange(row.createdAt, from, to));
  const conflictAttempts = rows.mergeAttempts.filter((row) => row.result === "conflict" && dateInRange(row.createdAt, from, to));
  const conflictInstances = conflictAttempts.reduce((sum, row) => sum + Math.max(row.conflictCount, 1), 0);
  const notificationsCreated = rows.notifications.filter((row) => dateInRange(row.createdAt, from, to));
  const agentRunsInRange = rows.agentRuns.filter((run) => dateInRange(run.createdAt, from, to) || dateInRange(run.finishedAt, from, to));
  const costEntries = uniqueUsageEntries(rows.costLedgerEntries, from, to);
  const totalCost = costEntries.reduce((sum, row) => sum + parseCny(row.estimatedCostCny), 0);
  const tokenIn = costEntries.reduce((sum, row) => sum + row.tokenIn, 0);
  const tokenOut = costEntries.reduce((sum, row) => sum + row.tokenOut, 0);

  const activeUsers = new Set<string>();
  const submitters = new Set<string>();
  for (const row of workItemsCreated) {
    addUser(activeUsers, row.submitterUserId);
    addUser(submitters, row.submitterUserId);
  }
  for (const row of proposalsOpened) {
    addUser(activeUsers, row.openedByUserId);
  }
  for (const row of rows.reviews.filter((review) => dateInRange(review.createdAt, from, to))) {
    addUser(activeUsers, row.reviewerUserId);
  }
  for (const row of agentRunsInRange) {
    addUser(activeUsers, row.actorUserId);
  }
  for (const row of approvalRequests) {
    addUser(activeUsers, row.routedToUserId);
    addUser(activeUsers, row.decidedByUserId);
  }
  for (const row of notificationsCreated) {
    addUser(activeUsers, row.userId);
  }

  const adoptionDenominator = proposalsReviewed.length;
  const adoptionNumerator = proposalsReviewed.filter((row) => row.status === "merged").length;
  const closedLoopCount = closedLoopWorkItemIds.size;
  const costPerMerged = closedLoopCount > 0 ? totalCost / closedLoopCount : 0;
  const activeUserCount = activeUsers.size;
  const notificationDensity = activeUserCount > 0 ? notificationsCreated.length / activeUserCount : 0;

  const snapshot = {
    generated_at: generatedAt.toISOString(),
    range: {
      from: from.toISOString(),
      to: to.toISOString()
    },
    metrics: [
      metric({
        id: "closed_loop_count",
        value: String(closedLoopCount),
        numerator: closedLoopCount,
        denominator: null,
        unit: "work_items"
      }),
      metric({
        id: "proposal_adoption_rate",
        value: formatRate(adoptionNumerator, adoptionDenominator),
        numerator: adoptionNumerator,
        denominator: adoptionDenominator,
        unit: "percent",
        status: adoptionDenominator > 0 ? "pass" : "sample_insufficient"
      }),
      metric({
        id: "escalation_count",
        value: String(escalationEvents.length + approvalRequests.length),
        numerator: escalationEvents.length + approvalRequests.length,
        denominator: null,
        unit: "events"
      }),
      metric({
        id: "cost_per_merged_item_cny",
        value: formatCny(costPerMerged),
        // L#50：用原始 totalCost，不再经 formatCny 字符串往返丢精度。
        numerator: totalCost,
        denominator: closedLoopCount,
        unit: "CNY",
        status: closedLoopCount > 0 ? "pass" : "sample_insufficient"
      }),
      metric({
        id: "conflict_count",
        value: String(conflictInstances),
        numerator: conflictInstances,
        denominator: null,
        unit: "conflicts"
      }),
      metric({
        id: "notification_density",
        value: activeUserCount > 0 ? notificationDensity.toFixed(2).replace(/\.?0+$/u, "") : "sample insufficient",
        numerator: notificationsCreated.length,
        denominator: activeUserCount,
        unit: "notifications/user",
        status: activeUserCount > 0 ? "pass" : "sample_insufficient"
      })
    ],
    raw_counts: {
      work_items_created: workItemsCreated.length,
      closed_loop_work_items: closedLoopCount,
      proposals_opened: proposalsOpened.length,
      proposals_reviewed: proposalsReviewed.length,
      proposals_merged: proposalsMerged.length,
      proposals_rejected: proposalsRejected.length,
      escalation_events: escalationEvents.length,
      approval_requests: approvalRequests.length,
      merge_conflict_attempts: conflictAttempts.length,
      merge_conflict_instances: conflictInstances,
      notifications_created: notificationsCreated.length,
      active_user_count: activeUserCount,
      submitter_count: submitters.size
    },
    cost: {
      total_cost_cny: formatCny(totalCost),
      token_in: tokenIn,
      token_out: tokenOut,
      unique_usage_records: costEntries.length
    },
    gates: {
      feedback_log_ready: true,
      metrics_ready: proposalsOpened.length + agentRunsInRange.length + costEntries.length > 0,
      second_user_path_observed: activeUserCount >= 2 || submitters.size >= 2,
      cost_nonzero: totalCost > 0,
      conflict_counter_ready: true,
      notification_density_ready: activeUserCount > 0
    },
    notes: [
      "Proposal direct review/merge is counted through proposals.reviewed_at and proposals.merged_at; approval_requests is only the approval-center component.",
      "Cost uses the Cost page ledger rule: one CostLedgerEntry per unique usage_record_id is counted.",
      ...(adoptionDenominator === 0 ? ["Proposal adoption is sample_insufficient until at least one proposal is reviewed in the selected range."] : []),
      ...(closedLoopCount === 0 ? ["Cost per merged item is sample_insufficient until at least one WorkItem reaches merged Proposal in the selected range."] : []),
      ...(activeUserCount < 2 ? ["Second-user path is not observed in this range yet."] : [])
    ]
  };

  return pilotDay1MetricsSnapshotSchema.parse(snapshot);
}

export function createPilotDay1MetricsService(
  repository: PilotMetricsRepository,
  options: PilotDay1MetricsServiceOptions = {}
): PilotDay1MetricsService {
  const now = options.now ?? (() => new Date());

  return {
    async snapshot(input) {
      if (!input.actor.isAdmin) {
        throw new PilotDay1MetricsServiceError(403, "admin_required", "Day 1 pilot metrics are admin-only.");
      }
      // R4 #21：一次快照只取一个 now()，避免 fallbackRange 与 generatedAt 取到不同时刻
      // （默认区间的 to 与 generatedAt 本应一致，多次 now() 会让快照自相矛盾、边界处偶发漂移）。
      const at = now();
      const fallbackRange = defaultPilotDay1MetricsRange(at);
      const from = input.from ?? fallbackRange.from;
      const to = input.to ?? fallbackRange.to;
      if (from.getTime() >= to.getTime()) {
        throw new PilotDay1MetricsServiceError(422, "invalid_range", "Metrics range must have from before to.");
      }
      return buildPilotDay1MetricsSnapshot({
        rows: await repository.readDay1MetricsRows(),
        from,
        to,
        generatedAt: at
      });
    }
  };
}

export function getDefaultPilotDay1MetricsService() {
  if (!defaultPilotDay1MetricsService) {
    defaultDbClient = getSharedDatabaseClient();
    defaultPilotDay1MetricsService = createPilotDay1MetricsService(
      createPilotMetricsRepository(defaultDbClient.db)
    );
  }
  return defaultPilotDay1MetricsService;
}
