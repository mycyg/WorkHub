import { randomUUID } from "node:crypto";

import type { BudgetScope, CostLedgerEntry, UsageRecord } from "./types.js";

export function usageToLedgerEntry(
  usage: UsageRecord,
  scope: BudgetScope,
  options: { id?: string; teamId?: string } = {}
): CostLedgerEntry {
  const entry: CostLedgerEntry = {
    id: options.id ?? randomUUID(),
    usageRecordId: `${usage.provider}:${usage.model}:${usage.createdAt}`,
    scope,
    periodBucket: usage.createdAt.slice(0, 10),
    tokenIn: usage.inputTokens,
    tokenOut: usage.outputTokens,
    estimatedCostCny: usage.estimatedCostCny,
    currency: "CNY",
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
