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

/**
 * BUG-02：目标 provider 缺 apiKey 时 get() 抛出的稳定 typed error。让「用户主动 @Cuu / 协同发消息」
 * 这条会真打 LLM 的路径在建 transport / 发请求之前就 fail-fast，而不是拿空 key 去打上游、收 401 再被
 * 泛化成 500。调用侧据 instanceof 映射成明确语义（HTTP 503 + code ai_provider_not_configured + 部署
 * 指引），观察者/判定器/夜间 curation 那些 best-effort 或已有 isConfigured 守卫的调用点则天然把它
 * 当普通失败降级。
 */
export class ProviderNotConfiguredError extends Error {
  constructor(public readonly provider: string) {
    super(`LLM provider '${provider}' is not configured: missing API key`);
    this.name = "ProviderNotConfiguredError";
  }
}

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
    // BUG-02 fail-fast：这里是 provider 的唯一入口。目标 provider 没配 apiKey → 立刻抛 typed error，
    // 在建 transport（更别说发请求）之前就断掉，绝不拿空 key 去打上游。transportFactory 零调用。
    if (route.provider.apiKey.length === 0) {
      throw new ProviderNotConfiguredError(route.provider.name);
    }
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
