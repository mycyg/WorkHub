import { settings } from "@workhub/config";
import { createMemoryCostLedgerStore, type CostLedgerStore } from "@workhub/cost";

const defaultCostLedgerStore = createMemoryCostLedgerStore({
  teamId: settings.auth.defaultWorkspaceId,
  evalSuite: "nightly"
});

export function getDefaultCostLedgerStore(): CostLedgerStore {
  return defaultCostLedgerStore;
}
