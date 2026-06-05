import {
  createProviderRegistry,
  type ProviderRegistry,
  type ProviderRegistryOptions
} from "@workhub/agent/providers";
import {
  createProviderRegistryConfig,
  settings as defaultSettings,
  type Settings
} from "@workhub/config";
import type { CostLedgerStore } from "@workhub/cost";

import { getDefaultCostLedgerStore } from "./cost-ledger-store.js";

export type ApiProviderRegistryOptions = {
  settings?: Settings;
  ledgerStore?: CostLedgerStore;
  transportFactory?: ProviderRegistryOptions["transportFactory"];
};

export function createApiProviderRegistry(options: ApiProviderRegistryOptions = {}): ProviderRegistry {
  const runtimeSettings = options.settings ?? defaultSettings;
  return createProviderRegistry({
    config: createProviderRegistryConfig(runtimeSettings),
    usageSink: options.ledgerStore ?? getDefaultCostLedgerStore(),
    ...(options.transportFactory ? { transportFactory: options.transportFactory } : {})
  });
}

let defaultProviderRegistry: ProviderRegistry | undefined;

export function getDefaultProviderRegistry() {
  defaultProviderRegistry ??= createApiProviderRegistry();
  return defaultProviderRegistry;
}
