import { randomUUID } from "node:crypto";

import {
  decideReservation,
  outstandingForBucket,
  type BudgetScope,
  type OutstandingTotals,
  type ReservationRow,
  type ReservationScopeCheck
} from "@workhub/cost";
import { and, eq, lt, ne, sql, type SQL } from "drizzle-orm";

import type { WorkHubDb } from "../client.js";
import { budgetReservations } from "../schema/index.js";

// R2 epic(原子预算)：预留仓库。reserve 在一个事务内对每个受限 scope 上 advisory 锁，读 outstanding
// （在飞未结算持有量，排除本 run 自身行以幂等），结合调用方传入的 committed 快照 + cap + 估算判定是否越限。
// committed 由调用方（enqueue 处 decideRunBudget 已读）传入——并发"起跑"的真正 TOCTOU 在 outstanding，
// 由 advisory 锁 + 锁内读 outstanding + 插入串行化掉。

export type BudgetReservationScopeInput = {
  scope: BudgetScope;
  scopeKind: BudgetScope["kind"];
  scopeId: string;
  period: "day" | "month";
  periodBucket: string;
  capTokens: number;
  capCostCny: string;
  committedTokens: number;
  committedCostCny: string;
  estTokens: number;
  estCostCny: string;
};

export type ReserveRunBudgetInput = {
  workspaceId: string;
  runId: string;
  leaseExpiresAt: Date;
  scopes: BudgetReservationScopeInput[];
};

export type ReserveRunBudgetResult =
  | { ok: true }
  | { ok: false; limitingScope: BudgetScope; limit: "tokens" | "cost" };

export type ScopeBucketKey = {
  workspaceId: string;
  scopeKind: BudgetScope["kind"];
  scopeId: string;
  periodBucket: string;
};

export type BudgetReservationRepository = {
  /** 原子预留：全允则插入 active 行返回 ok；任一受限 scope 越限则整体回滚返回 limitingScope。重试幂等。 */
  reserve: (input: ReserveRunBudgetInput) => Promise<ReserveRunBudgetResult>;
  /** 终态对账：把该 run 的 active 预留行翻 settled 并写实际用量（实际已在 ledger 计费，这里只释放持有量）。 */
  reconcile: (runId: string, actualTokens: number, actualCostCny: string, at?: Date) => Promise<number>;
  /** 租约过期清扫：active 且 lease<now 的行翻 expired，释放被崩溃 run 占住的额度。返回释放条数。 */
  releaseExpired: (now: Date) => Promise<number>;
  /** 刷新某 run 所有 active 预留行的租约（与 run 心跳同步）。 */
  refreshLease: (runId: string, leaseExpiresAt: Date) => Promise<number>;
  /** 成本看板用：按 (scope,bucket) 读在飞 outstanding（Σ active 行 est-actual）。 */
  outstandingForScopes: (keys: ScopeBucketKey[]) => Promise<Map<string, OutstandingTotals>>;
};

function lockKey(key: ScopeBucketKey): string {
  return `budget-reserve:${key.workspaceId}:${key.scopeKind}:${key.scopeId}:${key.periodBucket}`;
}

function bucketMapKey(key: ScopeBucketKey): string {
  return `${key.workspaceId}:${key.scopeKind}:${key.scopeId}:${key.periodBucket}`;
}

function scopeBucketKey(workspaceId: string, scope: BudgetReservationScopeInput): ScopeBucketKey {
  return {
    workspaceId,
    scopeKind: scope.scopeKind,
    scopeId: scope.scopeId,
    periodBucket: scope.periodBucket
  };
}

function toReservationRow(row: typeof budgetReservations.$inferSelect): ReservationRow {
  return {
    scopeKind: row.scopeKind as BudgetScope["kind"],
    scopeId: row.scopeId,
    periodBucket: row.periodBucket,
    estTokens: row.estTokens,
    estCostCny: row.estCostCny,
    actualTokens: row.actualTokens,
    actualCostCny: row.actualCostCny,
    status: row.status as ReservationRow["status"]
  };
}

export function createBudgetReservationRepository(db: WorkHubDb): BudgetReservationRepository {
  return {
    async reserve(input) {
      if (input.scopes.length === 0) {
        return { ok: true };
      }
      // 稳定顺序加锁，避免并发 reserver 交叉加锁互锁。
      const ordered = [...input.scopes].sort((left, right) =>
        lockKey(scopeBucketKey(input.workspaceId, left)).localeCompare(lockKey(scopeBucketKey(input.workspaceId, right)))
      );
      return db.transaction(async (tx) => {
        for (const scope of ordered) {
          await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${lockKey(scopeBucketKey(input.workspaceId, scope))})::bigint)`);
        }
        const checks: ReservationScopeCheck[] = [];
        for (const scope of ordered) {
          // 排除本 run 自身的 active 行：重试时不把自己算进 outstanding（配合 onConflictDoNothing 幂等）。
          const activeRows = await tx
            .select()
            .from(budgetReservations)
            .where(
              and(
                eq(budgetReservations.scopeKind, scope.scopeKind),
                eq(budgetReservations.scopeId, scope.scopeId),
                eq(budgetReservations.workspaceId, input.workspaceId),
                eq(budgetReservations.periodBucket, scope.periodBucket),
                eq(budgetReservations.status, "active"),
                ne(budgetReservations.runId, input.runId)
              ) as SQL
            );
          const outstanding = outstandingForBucket(activeRows.map(toReservationRow), scope);
          checks.push({
            scope: scope.scope,
            capTokens: scope.capTokens,
            capCostCny: scope.capCostCny,
            committedTokens: scope.committedTokens,
            committedCostCny: scope.committedCostCny,
            outstandingTokens: outstanding.tokens,
            outstandingCostCny: outstanding.costCny,
            estTokens: scope.estTokens,
            estCostCny: scope.estCostCny
          });
        }
        const decision = decideReservation(checks);
        if (!decision.allowed) {
          // 不插入任何行；空事务提交（advisory 锁随提交释放）。
          return { ok: false, limitingScope: decision.limitingScope, limit: decision.limit };
        }
        await tx
          .insert(budgetReservations)
          .values(
            ordered.map((scope) => ({
              id: randomUUID(),
              runId: input.runId,
              workspaceId: input.workspaceId,
              scopeKind: scope.scopeKind,
              scopeId: scope.scopeId,
              period: scope.period,
              periodBucket: scope.periodBucket,
              estTokens: scope.estTokens,
              estCostCny: scope.estCostCny,
              status: "active" as const,
              leaseExpiresAt: input.leaseExpiresAt
            }))
          )
          .onConflictDoNothing();
        return { ok: true };
      });
    },

    async reconcile(runId, actualTokens, actualCostCny, at) {
      const rows = await db
        .update(budgetReservations)
        .set({ status: "settled", actualTokens, actualCostCny, updatedAt: at ?? new Date() })
        .where(and(eq(budgetReservations.runId, runId), eq(budgetReservations.status, "active")))
        .returning({ id: budgetReservations.id });
      return rows.length;
    },

    async releaseExpired(now) {
      const rows = await db
        .update(budgetReservations)
        .set({ status: "expired", updatedAt: now })
        .where(and(eq(budgetReservations.status, "active"), lt(budgetReservations.leaseExpiresAt, now)))
        .returning({ id: budgetReservations.id });
      return rows.length;
    },

    async refreshLease(runId, leaseExpiresAt) {
      const rows = await db
        .update(budgetReservations)
        .set({ leaseExpiresAt, updatedAt: new Date() })
        .where(and(eq(budgetReservations.runId, runId), eq(budgetReservations.status, "active")))
        .returning({ id: budgetReservations.id });
      return rows.length;
    },

    async outstandingForScopes(keys) {
      const result = new Map<string, OutstandingTotals>();
      if (keys.length === 0) {
        return result;
      }
      // 一次拉相关 scope 的 active 行，再用纯逻辑按 (scope,bucket) 聚合。
      const conditions = keys.map(
        (key) =>
          and(
            eq(budgetReservations.scopeKind, key.scopeKind),
            eq(budgetReservations.scopeId, key.scopeId),
            eq(budgetReservations.workspaceId, key.workspaceId),
            eq(budgetReservations.periodBucket, key.periodBucket)
          ) as SQL
      );
      const where = conditions.reduce((acc, cond) => (acc ? sql`${acc} OR ${cond}` : cond), undefined as SQL | undefined);
      const rows = await db
        .select()
        .from(budgetReservations)
        .where(and(eq(budgetReservations.status, "active"), where ? sql`(${where})` : undefined));
      for (const key of keys) {
        // The pure cost helper keys by scope/bucket only. Keep the tenant
        // dimension at the repository boundary so multi-workspace batches with
        // the same logical scope id cannot cross-count active reservations.
        const scopedRows = rows
          .filter((row) => row.workspaceId === key.workspaceId)
          .map(toReservationRow);
        result.set(bucketMapKey(key), outstandingForBucket(scopedRows, key));
      }
      return result;
    }
  };
}
