import {
  ledgerUsageSnapshots,
  usageRecordId,
  usageToLedgerEntries,
  type BudgetScope,
  type CostLedgerEntry,
  type CostLedgerStore,
  type LedgerScopeIds,
  type UsageRecord,
  type UsageSource
} from "@workhub/cost";

import type { WorkHubDb } from "../client.js";
import { costLedgerEntries, usageRecords } from "../schema/index.js";

export type UsageRecordRow = typeof usageRecords.$inferSelect;
export type CostLedgerEntryRow = typeof costLedgerEntries.$inferSelect;

function maybeDate(value: string | Date) {
  return value instanceof Date ? value : new Date(value);
}

function maybeString(value: string | null | undefined) {
  return value ?? undefined;
}

function scopeId(scope: BudgetScope) {
  switch (scope.kind) {
    case "workitem":
      return scope.workitemId;
    case "user":
      return scope.userId;
    case "team":
      return scope.teamId;
    case "eval":
      return scope.suite;
  }
}

function scopeJson(scope: BudgetScope): Record<string, unknown> {
  switch (scope.kind) {
    case "workitem":
      return { kind: "workitem", workitemId: scope.workitemId };
    case "user":
      return { kind: "user", userId: scope.userId };
    case "team":
      return { kind: "team", teamId: scope.teamId };
    case "eval":
      return { kind: "eval", suite: scope.suite };
  }
}

function rowToScope(row: CostLedgerEntryRow): BudgetScope {
  switch (row.scopeKind) {
    case "workitem":
      return { kind: "workitem", workitemId: row.scopeId };
    case "user":
      return { kind: "user", userId: row.scopeId };
    case "team":
      return { kind: "team", teamId: row.scopeId };
    case "eval":
      return { kind: "eval", suite: row.scopeId === "release" ? "release" : "nightly" };
    default:
      return { kind: "eval", suite: "nightly" };
  }
}

function usageInsert(record: UsageRecord): typeof usageRecords.$inferInsert {
  return {
    id: usageRecordId(record),
    ...(record.runId ? { runId: record.runId } : {}),
    ...(record.workItemId ? { workItemId: record.workItemId } : {}),
    ...(record.userId ? { userId: record.userId } : {}),
    ...(record.actorId ? { actorId: record.actorId } : {}),
    provider: record.provider,
    model: record.model,
    task: record.task,
    source: record.source,
    inputTokens: record.inputTokens,
    outputTokens: record.outputTokens,
    estimatedCostCny: record.estimatedCostCny,
    createdAt: maybeDate(record.createdAt)
  };
}

function ledgerInsert(entry: CostLedgerEntry): typeof costLedgerEntries.$inferInsert {
  return {
    id: entry.id,
    usageRecordId: entry.usageRecordId,
    ...(entry.policyId ? { policyId: entry.policyId } : {}),
    ...(entry.runId ? { runId: entry.runId } : {}),
    ...(entry.workItemId ? { workItemId: entry.workItemId } : {}),
    ...(entry.userId ? { userId: entry.userId } : {}),
    ...(entry.teamId ? { teamId: entry.teamId } : {}),
    scopeKind: entry.scope.kind,
    scopeId: scopeId(entry.scope),
    scopeJson: scopeJson(entry.scope),
    periodBucket: entry.periodBucket,
    tokenIn: entry.tokenIn,
    tokenOut: entry.tokenOut,
    estimatedCostCny: entry.estimatedCostCny,
    ...(entry.unitPriceCny ? { unitPriceCny: entry.unitPriceCny } : {}),
    currency: entry.currency,
    ...(entry.provider ? { provider: entry.provider } : {}),
    model: entry.model,
    source: entry.source,
    createdAt: maybeDate(entry.createdAt)
  };
}

function rowToUsageRecord(row: UsageRecordRow): UsageRecord {
  return {
    ...(row.runId ? { runId: row.runId } : {}),
    ...(row.workItemId ? { workItemId: row.workItemId } : {}),
    ...(row.userId ? { userId: row.userId } : {}),
    provider: row.provider,
    model: row.model,
    task: row.task,
    ...(row.actorId ? { actorId: row.actorId } : {}),
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    estimatedCostCny: row.estimatedCostCny,
    source: row.source as UsageSource,
    createdAt: row.createdAt.toISOString()
  };
}

function rowToLedgerEntry(row: CostLedgerEntryRow): CostLedgerEntry {
  const provider = maybeString(row.provider);
  return {
    id: row.id,
    usageRecordId: row.usageRecordId,
    ...(row.policyId ? { policyId: row.policyId } : {}),
    ...(row.runId ? { runId: row.runId } : {}),
    ...(row.workItemId ? { workItemId: row.workItemId } : {}),
    ...(row.userId ? { userId: row.userId } : {}),
    ...(row.teamId ? { teamId: row.teamId } : {}),
    scope: rowToScope(row),
    periodBucket: row.periodBucket,
    tokenIn: row.tokenIn,
    tokenOut: row.tokenOut,
    estimatedCostCny: row.estimatedCostCny,
    ...(row.unitPriceCny ? { unitPriceCny: row.unitPriceCny } : {}),
    currency: "CNY",
    ...(provider ? { provider } : {}),
    model: row.model,
    source: row.source as UsageSource,
    createdAt: row.createdAt.toISOString()
  };
}

export function createDbCostLedgerStore(
  db: WorkHubDb,
  options: {
    teamId?: string;
    evalSuite?: "nightly" | "release";
  } = {}
): CostLedgerStore {
  const recentRecords: UsageRecord[] = [];
  const recentEntries: CostLedgerEntry[] = [];

  async function listEntries() {
    const rows = await db.select().from(costLedgerEntries);
    return rows.map(rowToLedgerEntry);
  }

  async function listRecords() {
    const rows = await db.select().from(usageRecords);
    return rows.map(rowToUsageRecord);
  }

  return {
    get records() {
      return recentRecords;
    },
    get entries() {
      return recentEntries;
    },
    async recordUsage(record) {
      await db.insert(usageRecords).values(usageInsert(record)).onConflictDoNothing();
      const entries = usageToLedgerEntries(record, {
        ...(options.teamId ? { teamId: options.teamId } : {}),
        ...(options.evalSuite ? { evalSuite: options.evalSuite } : {})
      });
      if (entries.length > 0) {
        await db
          .insert(costLedgerEntries)
          .values(entries.map(ledgerInsert))
          .onConflictDoNothing({
            target: [
              costLedgerEntries.usageRecordId,
              costLedgerEntries.scopeKind,
              costLedgerEntries.scopeId,
              costLedgerEntries.periodBucket
            ]
          });
      }
      recentRecords.push(record);
      recentEntries.push(...entries);
    },
    async usageSnapshots(scopeIds: LedgerScopeIds) {
      return ledgerUsageSnapshots(await listEntries(), scopeIds);
    },
    listEntries,
    listRecords
  };
}
