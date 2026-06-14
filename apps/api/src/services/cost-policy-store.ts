import {
  createAuditLogRepository,
  getSharedDatabaseClient,
  createDbBudgetPolicyStore,
  type AuditLogRepository,
  type WorkHubDatabaseClient
} from "@workhub/db";
import type { BudgetPolicyStore } from "@workhub/cost";

let defaultDbClient: WorkHubDatabaseClient | undefined;
let defaultBudgetPolicyStore: BudgetPolicyStore | undefined;
let defaultBudgetPolicyAuditLogs: AuditLogRepository | undefined;

function getDefaultDbClient() {
  defaultDbClient ??= getSharedDatabaseClient();
  return defaultDbClient;
}

export function getDefaultBudgetPolicyStore(): BudgetPolicyStore {
  defaultBudgetPolicyStore ??= createDbBudgetPolicyStore(getDefaultDbClient().db);
  return defaultBudgetPolicyStore;
}

export function getDefaultBudgetPolicyAuditLogRepository(): AuditLogRepository {
  defaultBudgetPolicyAuditLogs ??= createAuditLogRepository(getDefaultDbClient().db);
  return defaultBudgetPolicyAuditLogs;
}
