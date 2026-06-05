import type { LlmProviderConfig, LlmProviderRegistryConfig, ProviderModelConfig } from "@workhub/config";
import type { UsageRecord, UsageSink, UsageSource } from "@workhub/cost";

export const taskClasses = [
  "clarify",
  "worker",
  "review",
  "meeting",
  "drive_comment",
  "delivery_doc",
  "decompose",
  "assistant",
  "eval"
] as const;
export type TaskClass = (typeof taskClasses)[number];

export type LlmActor = {
  id?: string;
  label?: string;
  userId?: string;
  runId?: string;
  workItemId?: string;
};

export type LlmUsage = {
  inputTokens: number;
  outputTokens: number;
};

export type LlmMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: unknown;
};

export type LlmCreateParams = {
  model?: string;
  maxTokens: number;
  system?: string;
  messages: LlmMessage[];
  tools?: unknown[];
  source?: UsageSource;
};

export type LlmCreateResponse = {
  id: string;
  content: unknown[];
  usage?: LlmUsage;
  stopReason?: "tool_use" | "end_turn" | "max_tokens" | string;
};

export type LlmStreamEvent = {
  type: string;
  data?: unknown;
};

export type LlmStream = AsyncIterable<LlmStreamEvent> & {
  getFinalMessage: () => Promise<LlmCreateResponse>;
};

export type LlmTransport = {
  create: (params: LlmCreateParams & { model: string }) => Promise<LlmCreateResponse>;
  stream: (params: LlmCreateParams & { model: string }) => Promise<LlmStream>;
};

export type TransportFactory = (provider: LlmProviderConfig) => LlmTransport;

export type ProviderRegistryOptions = {
  config: LlmProviderRegistryConfig;
  transportFactory?: TransportFactory;
  usageSink?: UsageSink;
};

export type ProviderRoute = {
  provider: LlmProviderConfig;
  model: ProviderModelConfig;
  task: TaskClass;
};

export type MeasuredCallContext = {
  actor?: LlmActor;
  task: TaskClass;
  provider: string;
  model: ProviderModelConfig;
};

export type MeasuredCallResult = {
  response: LlmCreateResponse;
  usageRecord?: UsageRecord;
};
