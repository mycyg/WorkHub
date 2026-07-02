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

import { and, eq, gte, inArray, or, sql, type SQL } from "drizzle-orm";

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
    case "curation":
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
    case "curation":
      return { kind: "curation", teamId: scope.teamId };
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
    case "curation":
      return { kind: "curation", teamId: row.scopeId };
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
  const RECENT_CAP = 1000; // recentRecords/recentEntries 是进程内缓存，封顶防无界增长（H6）。

  async function listEntries(options?: { sinceBucket?: string }) {
    // findings[#74/#80]：管理员看板别再全表扫描——给了 sinceBucket 就按 period_bucket_idx 下推时间窗口，
    // 只取窗口内账目（period_bucket 是 "YYYY-MM-DD"，与游标按字典序比较即时间序）。不传则全量（累计统计用）。
    const rows = options?.sinceBucket
      ? await db.select().from(costLedgerEntries).where(gte(costLedgerEntries.periodBucket, options.sinceBucket))
      : await db.select().from(costLedgerEntries);
    return rows.map(rowToLedgerEntry);
  }

  // 只查请求到的 scope（按 scope_kind+scope_id 走索引），避免每次预算/快照都全表扫描所有用户/项目（H6）。
  // DF-1：可选 sinceBucket —— 成本看板的非管理员路径要和管理员侧同样按 period_bucket 限窗，否则总额
  // 一边是终身累计、一边是近 90 天。预算快照(usageSnapshots)不传它,仍取全量累计。
  // db-repos-2/contracts-pkgs-1 修复：不再把整个工作区的 usage_record_id 物化进应用内存再 inArray()（超
  // 65535 个绑定参数会直接抛错，且随账本增长线性变慢）。改为返回一个 SQL 子查询 SELECT，交给调用方直接
  // inArray(col, subquery) —— drizzle 会生成 `col IN (SELECT ...)` 半连接，整段在 PG 内部执行，永远只有
  // 常数个绑定参数，扫描量与工作区大小无关（走 scope_kind+scope_id 索引）。
  function workspaceUsageRecordIdsQuery(teamId: string, options?: { sinceBucket?: string }) {
    const workspacePredicate = or(
      and(eq(costLedgerEntries.scopeKind, "team"), eq(costLedgerEntries.scopeId, teamId)),
      and(eq(costLedgerEntries.scopeKind, "curation"), eq(costLedgerEntries.scopeId, teamId))
    ) as SQL;
    const scopedWhere = options?.sinceBucket
      ? (and(workspacePredicate, gte(costLedgerEntries.periodBucket, options.sinceBucket)) as SQL)
      : workspacePredicate;
    return db.select({ usageRecordId: costLedgerEntries.usageRecordId }).from(costLedgerEntries).where(scopedWhere);
  }

  async function listEntriesForScopes(scopeIds: LedgerScopeIds, options?: { sinceBucket?: string }) {
    const conds: SQL[] = [];
    if (scopeIds.workItemId) {
      conds.push(and(eq(costLedgerEntries.scopeKind, "workitem"), eq(costLedgerEntries.scopeId, scopeIds.workItemId)) as SQL);
    }
    if (scopeIds.userId) {
      conds.push(and(eq(costLedgerEntries.scopeKind, "user"), eq(costLedgerEntries.scopeId, scopeIds.userId)) as SQL);
    }
    if (scopeIds.teamId) {
      conds.push(and(eq(costLedgerEntries.scopeKind, "team"), eq(costLedgerEntries.scopeId, scopeIds.teamId)) as SQL);
      conds.push(and(eq(costLedgerEntries.scopeKind, "curation"), eq(costLedgerEntries.scopeId, scopeIds.teamId)) as SQL);
    }
    if (scopeIds.evalSuite) {
      conds.push(and(eq(costLedgerEntries.scopeKind, "eval"), eq(costLedgerEntries.scopeId, scopeIds.evalSuite)) as SQL);
    }
    if (conds.length === 0) {
      return [];
    }
    let where = or(...conds) as SQL;
    if (scopeIds.teamId) {
      // 子查询半连接：不先把 id 列表拉回应用层，PG 直接在同一条语句里做 IN (SELECT ...)。
      where = and(where, inArray(costLedgerEntries.usageRecordId, workspaceUsageRecordIdsQuery(scopeIds.teamId, options))) as SQL;
    }
    if (options?.sinceBucket) {
      where = and(where, gte(costLedgerEntries.periodBucket, options.sinceBucket)) as SQL;
    }
    const rows = await db.select().from(costLedgerEntries).where(where);
    return rows.map(rowToLedgerEntry);
  }

  async function listEntriesForWorkspace(teamId: string, options?: { sinceBucket?: string }) {
    const membershipWhere = inArray(costLedgerEntries.usageRecordId, workspaceUsageRecordIdsQuery(teamId, options)) as SQL;
    const where = options?.sinceBucket
      ? (and(membershipWhere, gte(costLedgerEntries.periodBucket, options.sinceBucket)) as SQL)
      : membershipWhere;
    const rows = await db.select().from(costLedgerEntries).where(where);
    return rows.map(rowToLedgerEntry);
  }

  async function listRecords() {
    const rows = await db.select().from(usageRecords);
    return rows.map(rowToUsageRecord);
  }

  // R4 #26：按 source + 时间下界做 SQL SUM 聚合（走 usage_records_created_at_idx），只回一个累计值，
  // 不再把整张 usage_records 拉回内存过滤求和。estimated_cost_cny 是 numeric(12,6)，SUM 仍是 numeric → 字符串。
  async function sumUsageCostSince(input: { source: string; since: Date }) {
    const rows = await db
      .select({ total: sql<string>`COALESCE(SUM(${usageRecords.estimatedCostCny}), 0)::text` })
      .from(usageRecords)
      .where(and(eq(usageRecords.source, input.source), gte(usageRecords.createdAt, input.since)));
    return rows[0]?.total ?? "0";
  }

  return {
    get records() {
      return recentRecords;
    },
    get entries() {
      return recentEntries;
    },
    async recordUsage(record) {
      const entries = usageToLedgerEntries(record, {
        ...(options.teamId ? { teamId: options.teamId } : {}),
        teamIdForUsage: (usage) => usage.workspaceId ?? options.teamId,
        ...(options.evalSuite ? { evalSuite: options.evalSuite } : {})
      });
      // R4 #36：usage_records 与 cost_ledger_entries 此前是两条独立 insert——进程在二者之间崩溃会留下
      // 「usage 落库、ledger 未落」的撕裂写入，成本被永久少记且不会被重试补回。裹进一个事务，要么都落要么都不落。
      await db.transaction(async (tx) => {
        await tx.insert(usageRecords).values(usageInsert(record)).onConflictDoNothing();
        if (entries.length > 0) {
          await tx
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
      });
      // 内存近期缓存只在事务提交后更新（回滚则不污染缓存）。
      recentRecords.push(record);
      if (recentRecords.length > RECENT_CAP) {
        recentRecords.splice(0, recentRecords.length - RECENT_CAP);
      }
      recentEntries.push(...entries);
      if (recentEntries.length > RECENT_CAP) {
        recentEntries.splice(0, recentEntries.length - RECENT_CAP);
      }
    },
    async usageSnapshots(scopeIds: LedgerScopeIds, options?: { now?: Date }) {
      return ledgerUsageSnapshots(await listEntriesForScopes(scopeIds), scopeIds, options);
    },
    listEntries,
    listEntriesForScopes,
    listEntriesForWorkspace,
    listRecords,
    sumUsageCostSince
  };
}
