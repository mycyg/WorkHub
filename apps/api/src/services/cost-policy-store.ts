import { createMemoryBudgetPolicyStore, type BudgetPolicyStore } from "@workhub/cost";

const defaultBudgetPolicyStore = createMemoryBudgetPolicyStore();

export function getDefaultBudgetPolicyStore(): BudgetPolicyStore {
  return defaultBudgetPolicyStore;
}
