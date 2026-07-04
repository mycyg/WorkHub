import type { Settings } from "@workhub/config";
import { budgetPolicyStorageId } from "@workhub/db";

export function selectTenantScopedBudgetPolicyRows<T extends { id: string }>(
  settings: Settings,
  logicalPolicyId: string,
  rows: readonly T[]
): T[] {
  const storageId = budgetPolicyStorageId(settings, logicalPolicyId);
  return rows.filter((row) => row.id === storageId);
}
