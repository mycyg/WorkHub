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

export function ledgerUsageSnapshots(
  entries: readonly CostLedgerEntry[],
  scopeIds: LedgerScopeIds
): BudgetUsageSnapshot[] {
  return scopesFromIds(scopeIds).map((scope) => {
    const scopeEntries = entries.filter((entry) => sameScope(entry.scope, scope));
    const tokenIn = scopeEntries.reduce((sum, entry) => sum + entry.tokenIn, 0);
    const tokenOut = scopeEntries.reduce((sum, entry) => sum + entry.tokenOut, 0);
    const estimatedCostCny = formatCny(
      scopeEntries.reduce((sum, entry) => sum + parseCny(entry.estimatedCostCny), 0)
    );
    return {
      scope,
      tokenIn,
      tokenOut,
      estimatedCostCny
    };
  });
}

export type CostLedgerStore = {
  records: readonly UsageRecord[];
  entries: readonly CostLedgerEntry[];
  recordUsage: (record: UsageRecord) => Promise<void> | void;
  usageSnapshots: (scopeIds: LedgerScopeIds) => MaybePromise<BudgetUsageSnapshot[]>;
  listEntries?: () => MaybePromise<readonly CostLedgerEntry[]>;
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
    usageSnapshots(scopeIds) {
      return ledgerUsageSnapshots(entries, scopeIds);
    },
    listEntries() {
      return entries;
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
