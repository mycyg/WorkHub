import { createProviderRegistryConfig, settings as defaultSettings } from "@workhub/config";

import type {
  LlmActor,
  ProviderRegistryOptions,
  ProviderRoute,
  TaskClass
} from "./types.js";
import type { UsageSink } from "@workhub/cost";
import { createAnthropicCompatibleTransport } from "./anthropic-compatible.js";
import { MeasuredLlmClient } from "./measured-client.js";

function requireProviderRoute(options: ProviderRegistryOptions, task: TaskClass): ProviderRoute {
  const configuredRoute = options.config.taskRouting[task];
  const providerName = configuredRoute?.provider ?? options.config.defaultProvider;
  const provider = options.config.providers[providerName];
  if (!provider) {
    throw new Error(`Unknown LLM provider: ${providerName}`);
  }
  const modelId = configuredRoute?.modelId ?? provider.defaultModelId;
  const model = provider.models[modelId];
  if (!model) {
    throw new Error(`Unknown model '${modelId}' for provider '${provider.name}'`);
  }
  return { provider, model, task };
}

export class ProviderRegistry {
  private usageSink: UsageSink | undefined;

  constructor(private readonly options: ProviderRegistryOptions) {
    this.usageSink = options.usageSink;
  }

  isConfigured(providerName = this.options.config.defaultProvider) {
    const provider = this.options.config.providers[providerName];
    return Boolean(provider?.apiKey);
  }

  get(actor: LlmActor | undefined, task: TaskClass) {
    const route = requireProviderRoute(this.options, task);
    const transportFactory = this.options.transportFactory ?? createAnthropicCompatibleTransport;
    const transport = transportFactory(route.provider);
    return new MeasuredLlmClient({
      route,
      transport,
      ...(actor ? { actor } : {}),
      ...(this.usageSink ? { usageSink: this.usageSink } : {})
    });
  }

  setUsageSink(sink: UsageSink) {
    this.usageSink = sink;
  }

  routeFor(task: TaskClass) {
    return requireProviderRoute(this.options, task);
  }

  publicMetadata() {
    return Object.values(this.options.config.providers).map((provider) => ({
      name: provider.name,
      defaultModelId: provider.defaultModelId,
      configured: provider.apiKey.length > 0,
      models: provider.models
    }));
  }
}

export function createProviderRegistry(options: ProviderRegistryOptions) {
  return new ProviderRegistry(options);
}

export function createDefaultProviderRegistry(transportFactory?: ProviderRegistryOptions["transportFactory"]) {
  return createProviderRegistry({
    config: createProviderRegistryConfig(defaultSettings),
    ...(transportFactory ? { transportFactory } : {})
  });
}
