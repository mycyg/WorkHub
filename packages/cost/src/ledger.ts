import { randomUUID } from "node:crypto";

import type { BudgetScope, CostLedgerEntry, UsageRecord } from "./types.js";
import type { BudgetUsageSnapshot } from "./decision.js";

type MaybePromise<T> = T | Promise<T>;

export type LedgerScopeIds = {
  workItemId?: string;
  taskPlanId?: string;
  objectiveId?: string;
  userId?: string;
  teamId?: string;
  evalSuite?: "nightly" | "release";
};

export type ReconcileUsageOptions = LedgerScopeIds & {
  id?: string;
  teamIdForUsage?: (usage: UsageRecord) => string | undefined;
};

export function usageToLedgerEntry(
  usage: UsageRecord,
  scope: BudgetScope,
  options: { id?: string; teamId?: string } = {}
): CostLedgerEntry {
  const entry: CostLedgerEntry = {
    id: options.id ?? randomUUID(),
    usageRecordId: usageRecordId(usage),
    scope,
    periodBucket: usage.createdAt.slice(0, 10),
    tokenIn: usage.inputTokens,
    tokenOut: usage.outputTokens,
    estimatedCostCny: usage.estimatedCostCny,
    currency: "CNY",
    provider: usage.provider,
    model: usage.model,
    source: usage.source,
    createdAt: usage.createdAt
  };
  if (usage.runId) {
    entry.runId = usage.runId;
  }
  if (usage.workItemId) {
    entry.workItemId = usage.workItemId;
  }
  if (usage.taskPlanId) {
    entry.taskPlanId = usage.taskPlanId;
  }
  if (usage.objectiveId) {
    entry.objectiveId = usage.objectiveId;
  }
  if (usage.userId) {
    entry.userId = usage.userId;
  }
  if (options.teamId) {
    entry.teamId = options.teamId;
  }
  return entry;
}

export function usageRecordId(usage: UsageRecord) {
  // L#68 + findings[19]：去重键里既含 token/成本，又含每次调用的单调序号 seq（agent 步号）。
  // 仍对"同一事件被重复记账"幂等（同内容 + 同 seq→同 id），但两次真正不同的调用即便 token/成本/毫秒
  // 完全相同，也因 seq 不同而不再被误并、少记成本。无 seq 的记录（如每 run 一次的 review）回退原行为。
  return [
    usage.runId ?? "no-run",
    usage.workItemId ?? "no-workitem",
    usage.taskPlanId ?? "no-task-plan",
    usage.objectiveId ?? "no-objective",
    usage.userId ?? "no-user",
    usage.workspaceId ?? "no-workspace",
    usage.provider,
    usage.model,
    usage.task,
    usage.source,
    usage.seq ?? "no-seq",
    usage.inputTokens,
    usage.outputTokens,
    usage.estimatedCostCny,
    usage.createdAt
  ].join(":");
}

export function usageToLedgerEntries(usage: UsageRecord, options: ReconcileUsageOptions = {}): CostLedgerEntry[] {
  const scopes = scopesForUsage(usage, options);
  return scopes.map((scope) =>
    usageToLedgerEntry(usage, scope, {
      id: options.id ? `${options.id}:${scopeKey(scope)}` : randomUUID(),
      ...(scope.kind === "team" ? { teamId: scope.teamId } : {})
    })
  );
}

// 周期感知：日/月预算只能统计当天/当月用量，否则会把全部历史都算进去 → 误判超额、用一阵后永久卡死。
// periodBucket 是 entry 的日期 "YYYY-MM-DD"。每个 scope 产出 run/day/month 三个快照（按 period 过滤），
// 由 decideRunBudget 的 matchesUsage 按 (scope, period) 取对应那个。run 周期保留 scope 全量（per-run 上限在运行时另行实时管控）。
const SNAPSHOT_PERIODS: ReadonlyArray<NonNullable<BudgetUsageSnapshot["period"]>> = ["run", "day", "month"];

export function ledgerUsageSnapshots(
  entries: readonly CostLedgerEntry[],
  scopeIds: LedgerScopeIds,
  options: { now?: Date } = {}
): BudgetUsageSnapshot[] {
  const now = options.now ?? new Date();
  const dayBucket = now.toISOString().slice(0, 10);
  const monthPrefix = now.toISOString().slice(0, 7);
  const inPeriod = (entry: CostLedgerEntry, period: NonNullable<BudgetUsageSnapshot["period"]>) => {
    if (period === "day") {
      return entry.periodBucket === dayBucket;
    }
    if (period === "month") {
      return entry.periodBucket.slice(0, 7) === monthPrefix;
    }
    // run：决策只在 run 启动时调用一次，此刻这次 run 尚未花费 → run 快照用量记 0。
    // 否则 run 快照取 scope 全量，per-run 策略的 remainingTokens 会随历史累计跌到 0，
    // 让 constrainRunBudget 把本次 run 上限塌成 1，把高频 workitem 永久卡死。
    // 真正的 per-run 上限由运行时 checkLoopBudget 实时管控（见 constrainRunBudget 设的 maxTokens）。
    return false;
  };
  const snapshots: BudgetUsageSnapshot[] = [];
  for (const scope of scopesFromIds(scopeIds)) {
    const scopeEntries = entries.filter((entry) => sameScope(entry.scope, scope));
    for (const period of SNAPSHOT_PERIODS) {
      const periodEntries = scopeEntries.filter((entry) => inPeriod(entry, period));
      snapshots.push({
        scope,
        period,
        tokenIn: periodEntries.reduce((sum, entry) => sum + entry.tokenIn, 0),
        tokenOut: periodEntries.reduce((sum, entry) => sum + entry.tokenOut, 0),
        estimatedCostCny: formatCny(periodEntries.reduce((sum, entry) => sum + parseCny(entry.estimatedCostCny), 0))
      });
    }
  }
  return snapshots;
}

function entryInScopes(entry: CostLedgerEntry, scopeIds: LedgerScopeIds): boolean {
  if (scopeIds.teamId && entry.scope.kind === "curation" && entry.scope.teamId === scopeIds.teamId) {
    return true;
  }
  return scopesFromIds(scopeIds).some((scope) => sameScope(entry.scope, scope));
}

export type CostLedgerStore = {
  records: readonly UsageRecord[];
  entries: readonly CostLedgerEntry[];
  recordUsage: (record: UsageRecord) => Promise<void> | void;
  usageSnapshots: (scopeIds: LedgerScopeIds, options?: { now?: Date }) => MaybePromise<BudgetUsageSnapshot[]>;
  /**
   * 读全量账目。findings[#74/#80]：管理员看板曾无窗口全表扫描 cost_ledger_entries（每步 agent 写 ~3 行、
   * 无保留/裁剪，越用越慢且 trend 桶无限增长）。传 sinceBucket("YYYY-MM-DD") 即按 period_bucket 索引下推、
   * 只取该日期及以后的账目。不传则全量（pilot-metrics 等累计统计仍需全量）。
   */
  listEntries?: (options?: { sinceBucket?: string }) => MaybePromise<readonly CostLedgerEntry[]>;
  /**
   * 只读请求到的 scope 的账目（走索引），用于非管理员只取自己的用量、避免全表扫描。
   * DF-1：与 listEntries 同样接受 sinceBucket —— 成本看板的窗口必须与管理员侧对称，否则同一个
   * 无标签的 total_cost_cny 对管理员=近 90 天、对普通成员=终身累计（同字段两种含义）。
   */
  listEntriesForScopes?: (scopeIds: LedgerScopeIds, options?: { sinceBucket?: string }) => MaybePromise<readonly CostLedgerEntry[]>;
  /**
   * Read all ledger entries for usage records that belong to a workspace/team.
   * Unlike listEntriesForScopes({ teamId }), this keeps user/workitem sibling
   * entries so admin dashboards can still render breakdowns after tenant scoping.
   */
  listEntriesForWorkspace?: (teamId: string, options?: { sinceBucket?: string }) => MaybePromise<readonly CostLedgerEntry[]>;
  listRecords?: () => MaybePromise<readonly UsageRecord[]>;
  /**
   * R4 #26：按 source + 时间下界聚合 usage 成本（走 created_at 索引的 SQL SUM），用于 curation 当日预算闸门，
   * 避免 listRecords 全表拉回内存再过滤求和（usage_records 越积越大）。返回累计 CNY 字符串。
   * 可选：未实现的实现/假仓库回退到 listRecords。
   */
  sumUsageCostSince?: (input: { source: string; since: Date }) => MaybePromise<string>;
};

export function createMemoryCostLedgerStore(options: {
  teamId?: string;
  evalSuite?: "nightly" | "release";
  teamIdForUsage?: (usage: UsageRecord) => string | undefined;
} = {}): CostLedgerStore {
  const records: UsageRecord[] = [];
  const entries: CostLedgerEntry[] = [];
  const entryKeys = new Set<string>();

  function workspaceUsageRecordIds(teamId: string, options?: { sinceBucket?: string }) {
    const sinceBucket = options?.sinceBucket;
    return new Set(
      entries
        .filter((entry) =>
          (!sinceBucket || entry.periodBucket >= sinceBucket) &&
          ((entry.scope.kind === "team" && entry.scope.teamId === teamId) ||
            (entry.scope.kind === "curation" && entry.scope.teamId === teamId))
        )
        .map((entry) => entry.usageRecordId)
    );
  }

  function entriesForScopes(scopeIds: LedgerScopeIds, options?: { sinceBucket?: string }) {
    const sinceBucket = options?.sinceBucket;
    const workspaceUsageIds = scopeIds.teamId ? workspaceUsageRecordIds(scopeIds.teamId, options) : undefined;
    return entries.filter((entry) =>
      (!sinceBucket || entry.periodBucket >= sinceBucket) &&
      (!workspaceUsageIds || workspaceUsageIds.has(entry.usageRecordId)) &&
      entryInScopes(entry, scopeIds)
    );
  }

  return {
    get records() {
      return records;
    },
    get entries() {
      return entries;
    },
    recordUsage(record) {
      if (!records.some((item) => usageRecordId(item) === usageRecordId(record))) {
        records.push(record);
      }
      for (const entry of usageToLedgerEntries(record, {
        ...(options.teamId ? { teamId: options.teamId } : {}),
        teamIdForUsage: options.teamIdForUsage ?? ((usage) => usage.workspaceId ?? options.teamId),
        ...(options.evalSuite ? { evalSuite: options.evalSuite } : {})
      })) {
        const key = ledgerEntryKey(entry);
        if (entryKeys.has(key)) {
          continue;
        }
        entryKeys.add(key);
        entries.push(entry);
      }
    },
    usageSnapshots(scopeIds, options) {
      return ledgerUsageSnapshots(entriesForScopes(scopeIds), scopeIds, options);
    },
    listEntries(options) {
      if (!options?.sinceBucket) {
        return entries;
      }
      const sinceBucket = options.sinceBucket;
      return entries.filter((entry) => entry.periodBucket >= sinceBucket);
    },
    listEntriesForScopes(scopeIds, options) {
      return entriesForScopes(scopeIds, options);
    },
    listEntriesForWorkspace(teamId, options) {
      const sinceBucket = options?.sinceBucket;
      const workspaceUsageIds = workspaceUsageRecordIds(teamId, options);
      return entries.filter((entry) =>
        workspaceUsageIds.has(entry.usageRecordId) && (!sinceBucket || entry.periodBucket >= sinceBucket)
      );
    },
    listRecords() {
      return records;
    }
  };
}

function scopesForUsage(usage: UsageRecord, options: ReconcileUsageOptions) {
  if (usage.source === "eval") {
    return [{ kind: "eval", suite: options.evalSuite ?? "nightly" } satisfies BudgetScope];
  }
  if (usage.source === "curation") {
    // findings[#164]：蒸馏(自我提升)花费只进独立的 curation scope，绝不进 team/user/workitem——否则会被
    // 团队生产预算(pcost-team-day/month)统计、吃掉生产额度。仍写入 cost_ledger_entries(供 labor_split 按
    // source 分账)，但因 scope.kind="curation" 不在任何预算决策的 scopeIds 里，永远不参与生产预算执行。
    const curationTeamId = options.teamIdForUsage?.(usage) ?? options.teamId;
    return curationTeamId ? [{ kind: "curation", teamId: curationTeamId } satisfies BudgetScope] : [];
  }

  const scopes: BudgetScope[] = [];
  if (usage.workItemId) {
    scopes.push({ kind: "workitem", workitemId: usage.workItemId });
  }
  if (usage.taskPlanId) {
    scopes.push({ kind: "task", taskPlanId: usage.taskPlanId });
  }
  if (usage.objectiveId) {
    scopes.push({ kind: "objective", objectiveId: usage.objectiveId });
  }
  if (usage.userId) {
    scopes.push({ kind: "user", userId: usage.userId });
  }
  const teamId = options.teamIdForUsage?.(usage) ?? options.teamId;
  if (teamId) {
    scopes.push({ kind: "team", teamId });
  }
  return scopes;
}

function scopesFromIds(scopeIds: LedgerScopeIds) {
  const scopes: BudgetScope[] = [];
  if (scopeIds.workItemId) {
    scopes.push({ kind: "workitem", workitemId: scopeIds.workItemId });
  }
  if (scopeIds.taskPlanId) {
    scopes.push({ kind: "task", taskPlanId: scopeIds.taskPlanId });
  }
  if (scopeIds.objectiveId) {
    scopes.push({ kind: "objective", objectiveId: scopeIds.objectiveId });
  }
  if (scopeIds.userId) {
    scopes.push({ kind: "user", userId: scopeIds.userId });
  }
  if (scopeIds.teamId) {
    scopes.push({ kind: "team", teamId: scopeIds.teamId });
  }
  if (scopeIds.evalSuite) {
    scopes.push({ kind: "eval", suite: scopeIds.evalSuite });
  }
  return scopes;
}

function sameScope(left: BudgetScope, right: BudgetScope) {
  if (left.kind !== right.kind) {
    return false;
  }
  switch (left.kind) {
    case "workitem":
      return right.kind === "workitem" && left.workitemId === right.workitemId;
    case "task":
      return right.kind === "task" && left.taskPlanId === right.taskPlanId;
    case "objective":
      return right.kind === "objective" && left.objectiveId === right.objectiveId;
    case "user":
      return right.kind === "user" && left.userId === right.userId;
    case "team":
      return right.kind === "team" && left.teamId === right.teamId;
    case "curation":
      return right.kind === "curation" && left.teamId === right.teamId;
    case "eval":
      return right.kind === "eval" && left.suite === right.suite;
  }
}

function ledgerEntryKey(entry: CostLedgerEntry) {
  return `${entry.usageRecordId}:${scopeKey(entry.scope)}:${entry.periodBucket}`;
}

function scopeKey(scope: BudgetScope) {
  switch (scope.kind) {
    case "workitem":
      return `workitem:${scope.workitemId}`;
    case "task":
      return `task:${scope.taskPlanId}`;
    case "objective":
      return `objective:${scope.objectiveId}`;
    case "user":
      return `user:${scope.userId}`;
    case "team":
      return `team:${scope.teamId}`;
    case "curation":
      return `curation:${scope.teamId}`;
    case "eval":
      return `eval:${scope.suite}`;
  }
}

function parseCny(value: string) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatCny(value: number) {
  return value.toFixed(6).replace(/0+$/u, "").replace(/\.$/u, "") || "0";
}
