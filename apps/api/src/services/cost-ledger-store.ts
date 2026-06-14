import { settings } from "@workhub/config";
import {
  getSharedDatabaseClient,
  createDbCostLedgerStore,
  type WorkHubDatabaseClient
} from "@workhub/db";
import type { CostLedgerStore } from "@workhub/cost";

let defaultDbClient: WorkHubDatabaseClient | undefined;
let defaultCostLedgerStore: CostLedgerStore | undefined;

export function getDefaultCostLedgerStore(): CostLedgerStore {
  if (!defaultCostLedgerStore) {
    defaultDbClient = getSharedDatabaseClient();
    defaultCostLedgerStore = createDbCostLedgerStore(defaultDbClient.db, {
      teamId: settings.auth.defaultWorkspaceId,
      evalSuite: "nightly"
    });
  }
  return defaultCostLedgerStore;
}
