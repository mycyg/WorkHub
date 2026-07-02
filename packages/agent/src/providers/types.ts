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
  workspaceId?: string;
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
  // findings[19]：调用序号（agent 步号），透传给用量记账作为去重消歧（同 run 内不同步即便 token 相同也不被误并）。
  seq?: number;
  // 可选：外部中断信号。透传给底层 fetch/流解析；触发即放弃请求并取消读取，绝不 park worker。可选保后向兼容。
  signal?: AbortSignal;
  // 可选：单次 provider 请求超时（毫秒）。无 signal 时由它派生 AbortSignal.timeout；与 signal 同存则二者任一触发即中断。
  // 可选保后向兼容——既有调用方/测试不传则不施加超时。
  timeoutMs?: number;
};

/** AbortSignal.timeout / AbortError 抛出的中断错误统一识别名——让重试层把"挂死连接"当瞬态网络错误处理。 */
export const LLM_REQUEST_TIMEOUT_ERROR = "llm_request_timeout";

export type LlmCreateResponse = {
  id: string;
  content: unknown[];
  usage?: LlmUsage;
  usageRecord?: UsageRecord;
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
