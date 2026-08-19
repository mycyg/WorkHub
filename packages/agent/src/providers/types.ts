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
  "eval",
  // R13 批 C1（会话上下文压缩）：滚动摘要调用的独立任务类——与 "assistant"（协同会话正式回应）分开
  // 归因，方便 provider-registry 的路由/成本记账区分「回复对方」与「整理更早的讨论给自己看」这两类
  // 完全不面向用户的内部调用。taskRouting 是 Record<string, ...>（packages/config/src/providers.ts），
  // 未配置的任务类天然回退到 defaultProvider/defaultModelId，不需要额外的路由配置项才能生效。
  "context_compact"
] as const;
export type TaskClass = (typeof taskClasses)[number];

export type LlmActor = {
  id?: string;
  label?: string;
  userId?: string;
  workspaceId?: string;
  runId?: string;
  workItemId?: string;
  taskPlanId?: string;
  objectiveId?: string;
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
  // 可选：显式关闭 provider 的 thinking（思维链）块。thinking 模型的思维链计入 max_tokens——
  // 短输出 JSON 调用（澄清/评审/压缩这类 maxTokens 较小的）会被 thinking 吃光预算导致正文截断。
  // 只在这类短 JSON 调用点传 true；默认不传保持 provider 行为。
  disableThinking?: boolean;
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
