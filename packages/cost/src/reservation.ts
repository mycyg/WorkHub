import type { BudgetScope } from "./types.js";

// R2 epic(原子预算)：预留的纯计算层（无 DB）。仓库层把 budget_reservations 行读出后，用这里的
// 函数算"在飞未结算"持有量 + 判定一次起跑是否会越上限。判据：
//   committed(ledger 已结算) + reserved_outstanding(active 行 Σ(est-actual)) + 本 run 估算 <= cap
// tokens 与 cost 两维都要满足；任一受限 scope 任一维超 → deny（与 decideRunBudget 的 budget_exhausted 同义）。

export type ReservationStatus = "active" | "settled" | "expired";

// CORE-03：period="total"（军团 task 计划生命周期预算）预留用的固定 periodBucket。total 无自然时间桶，
// 用固定常量让同一 (scope,task) 的所有并发子 run 落在同一预留键上、被同一把 advisory 锁串行化。
export const TOTAL_RESERVATION_PERIOD_BUCKET = "total";

// 一条预留行的数值投影（仓库读出的形状里本模块只关心这些字段）。
export type ReservationRow = {
  scopeKind: BudgetScope["kind"];
  scopeId: string;
  periodBucket: string;
  estTokens: number;
  estCostCny: string;
  actualTokens: number;
  actualCostCny: string;
  status: ReservationStatus;
};

export type OutstandingTotals = { tokens: number; costCny: string };

/**
 * 某 (scopeKind, scopeId, periodBucket) 上所有 active 预留的"在飞未结算"剩余持有量 = Σ max(0, est - actual)。
 * 已结算/已过期行不计入。est<actual（实际超估）时该行贡献 0，不会变成负的额度返还。
 */
export function outstandingForBucket(
  rows: readonly ReservationRow[],
  key: { scopeKind: BudgetScope["kind"]; scopeId: string; periodBucket: string }
): OutstandingTotals {
  let tokens = 0;
  let costMicro = 0;
  for (const row of rows) {
    if (row.status !== "active") {
      continue;
    }
    if (row.scopeKind !== key.scopeKind || row.scopeId !== key.scopeId || row.periodBucket !== key.periodBucket) {
      continue;
    }
    tokens += Math.max(0, row.estTokens - row.actualTokens);
    costMicro += Math.max(0, microCny(row.estCostCny) - microCny(row.actualCostCny));
  }
  return { tokens, costCny: formatMicroCny(costMicro) };
}

// 一个受限 scope 的预留判据输入（cap<=0 视为该维不设限，跳过）。
export type ReservationScopeCheck = {
  scope: BudgetScope;
  capTokens: number;
  capCostCny: string;
  committedTokens: number;
  committedCostCny: string;
  outstandingTokens: number;
  outstandingCostCny: string;
  estTokens: number;
  estCostCny: string;
};

export type ReservationDecision =
  | { allowed: true }
  | { allowed: false; limitingScope: BudgetScope; limit: "tokens" | "cost" };

/**
 * committed + outstanding + estimate <= cap（tokens 与 cost 都要满足）；任一 scope 任一维越界即 deny，
 * 返回限制性 scope + 维度。cost 用整数 micro-CNY（×1e6 取整）比较，避免浮点边界误判。
 */
export function decideReservation(checks: readonly ReservationScopeCheck[]): ReservationDecision {
  for (const check of checks) {
    if (check.capTokens > 0) {
      const projectedTokens = check.committedTokens + check.outstandingTokens + check.estTokens;
      if (projectedTokens > check.capTokens) {
        return { allowed: false, limitingScope: check.scope, limit: "tokens" };
      }
    }
    const capCostMicro = microCny(check.capCostCny);
    if (capCostMicro > 0) {
      const projectedCostMicro =
        microCny(check.committedCostCny) + microCny(check.outstandingCostCny) + microCny(check.estCostCny);
      if (projectedCostMicro > capCostMicro) {
        return { allowed: false, limitingScope: check.scope, limit: "cost" };
      }
    }
  }
  return { allowed: true };
}

function parseCny(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

// CNY 字符串 → 整数 micro-CNY（×1e6 四舍五入），与 DB numeric(12,6) 精度一致，避免浮点 > 误判。
function microCny(value: string): number {
  return Math.round(parseCny(value) * 1_000_000);
}

function formatMicroCny(micro: number): string {
  return formatCny(micro / 1_000_000);
}

function formatCny(value: number): string {
  return value.toFixed(6).replace(/0+$/u, "").replace(/\.$/u, "") || "0";
}
