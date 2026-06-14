import { randomUUID } from "node:crypto";

import type { BudgetScope, CostLedgerEntry, UsageRecord } from "./types.js";
import type { BudgetUsageSnapshot } from "./decision.js";

type MaybePromise<T> = T | Promise<T>;

export type LedgerScopeIds = {
  workItemId?: string;
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
  if (usage.userId) {
    entry.userId = usage.userId;
  }
  if (options.teamId) {
    entry.teamId = options.teamId;
  }
  return entry;
}

export function usageRecordId(usage: UsageRecord) {
  return [
    usage.runId ?? "no-run",
    usage.workItemId ?? "no-workitem",
    usage.userId ?? "no-user",
    usage.provider,
    usage.model,
    usage.task,
    usage.source,
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
    return true; // run: scope 全量（per-run 上限运行时实时管控）
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
  return scopesFromIds(scopeIds).some((scope) => sameScope(entry.scope, scope));
}

export type CostLedgerStore = {
  records: readonly UsageRecord[];
  entries: readonly CostLedgerEntry[];
  recordUsage: (record: UsageRecord) => Promise<void> | void;
  usageSnapshots: (scopeIds: LedgerScopeIds, options?: { now?: Date }) => MaybePromise<BudgetUsageSnapshot[]>;
  listEntries?: () => MaybePromise<readonly CostLedgerEntry[]>;
  /** 只读请求到的 scope 的账目（走索引），用于非管理员只取自己的用量、避免全表扫描。 */
  listEntriesForScopes?: (scopeIds: LedgerScopeIds) => MaybePromise<readonly CostLedgerEntry[]>;
  listRecords?: () => MaybePromise<readonly UsageRecord[]>;
};

export function createMemoryCostLedgerStore(options: {
  teamId?: string;
  evalSuite?: "nightly" | "release";
} = {}): CostLedgerStore {
  const records: UsageRecord[] = [];
  const entries: CostLedgerEntry[] = [];
  const entryKeys = new Set<string>();

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
      return ledgerUsageSnapshots(entries, scopeIds, options);
    },
    listEntries() {
      return entries;
    },
    listEntriesForScopes(scopeIds) {
      return entries.filter((entry) => entryInScopes(entry, scopeIds));
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

  const scopes: BudgetScope[] = [];
  if (usage.workItemId) {
    scopes.push({ kind: "workitem", workitemId: usage.workItemId });
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
    case "user":
      return right.kind === "user" && left.userId === right.userId;
    case "team":
      return right.kind === "team" && left.teamId === right.teamId;
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
    case "user":
      return `user:${scope.userId}`;
    case "team":
      return `team:${scope.teamId}`;
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
