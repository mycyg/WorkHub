import type { Settings } from "./env.js";

export type ProviderModelConfig = {
  id: string;
  model: string;
  displayName: string;
  contextWindowTokens: number;
  supportsStreaming: boolean;
  supportsTools: boolean;
  costInputCnyPerMtok: number;
  costOutputCnyPerMtok: number;
};

export type LlmProviderConfig = {
  name: string;
  baseUrl: string;
  apiKey: string;
  defaultModelId: string;
  models: Record<string, ProviderModelConfig>;
};

export type LlmProviderRegistryConfig = {
  defaultProvider: string;
  providers: Record<string, LlmProviderConfig>;
  taskRouting: Record<string, { provider: string; modelId: string }>;
};

export type PublicLlmProviderConfig = Omit<LlmProviderConfig, "apiKey"> & {
  configured: boolean;
};

export function createProviderRegistryConfig(settings: Settings): LlmProviderRegistryConfig {
  const defaultModel: ProviderModelConfig = {
    id: "default",
    model: settings.providers.deepseek.model || settings.llm.model,
    displayName: settings.providers.deepseek.model || settings.llm.model,
    contextWindowTokens: 128000,
    supportsStreaming: true,
    supportsTools: true,
    costInputCnyPerMtok: settings.providers.deepseek.costInputCnyPerMtok,
    costOutputCnyPerMtok: settings.providers.deepseek.costOutputCnyPerMtok
  };

  return {
    defaultProvider: settings.llm.defaultProvider,
    providers: {
      deepseek: {
        name: "deepseek",
        baseUrl: settings.providers.deepseek.baseUrl || settings.llm.baseUrl,
        apiKey: settings.llm.apiKey,
        defaultModelId: defaultModel.id,
        models: {
          [defaultModel.id]: defaultModel
        }
      }
    },
    taskRouting: {}
  };
}

export function toPublicProviderConfig(provider: LlmProviderConfig): PublicLlmProviderConfig {
  return {
    name: provider.name,
    baseUrl: provider.baseUrl,
    defaultModelId: provider.defaultModelId,
    models: provider.models,
    configured: provider.apiKey.length > 0
  };
}
