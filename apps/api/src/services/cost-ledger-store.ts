import { settings } from "@workhub/config";
import {
  createDatabaseClient,
  createDbCostLedgerStore,
  type WorkHubDatabaseClient
} from "@workhub/db";
import type { CostLedgerStore } from "@workhub/cost";

let defaultDbClient: WorkHubDatabaseClient | undefined;
let defaultCostLedgerStore: CostLedgerStore | undefined;

export function getDefaultCostLedgerStore(): CostLedgerStore {
  if (!defaultCostLedgerStore) {
    defaultDbClient = createDatabaseClient();
    defaultCostLedgerStore = createDbCostLedgerStore(defaultDbClient.db, {
      teamId: settings.auth.defaultWorkspaceId,
      evalSuite: "nightly"
    });
  }
  return defaultCostLedgerStore;
}
