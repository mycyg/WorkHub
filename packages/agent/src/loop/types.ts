import type { RunBudget } from "@workhub/cost";
import type { DeliverableChangeManifest, EventType, EvidenceRef } from "@workhub/contracts";
import type {
  CommandRunner,
  SandboxBudget,
  SnapshotHook,
  ToolExecutionContext,
  ToolResult
} from "@workhub/tools";

import type { LlmCreateParams, LlmCreateResponse, LlmStream } from "../providers/types.js";

export type AgentRunTerminalStatus = "succeeded" | "failed" | "escalated" | "cancelled";
export type AgentLoopControlSignal = "continue" | "stop" | "compact" | "escalate";

export type AgentLoopBudget = RunBudget & Partial<SandboxBudget> & {
  perStepTimeoutSeconds?: number;
  contextWindowTokens?: number;
  compactThreshold?: number;
  doomLoopWindow?: number;
  /** 每 run 允许的上下文压缩次数（默认 2），超限才升级。 */
  maxCompactions?: number;
  /** 写回对话上下文的单条 tool_result 字符上限（默认 8000）；trace 不受影响。 */
  toolResultContextChars?: number;
  /** provider 瞬态错误重试的退避基数（毫秒，默认 500）。 */
  providerRetryBaseDelayMs?: number;
  /** 单次重试延迟上限（毫秒，默认 60000）。findings[#49]：钳住上游 Retry-After，防恶意/异常上游 park worker 数小时。 */
  providerRetryMaxDelayMs?: number;
  /**
   * 单次 provider HTTP/流请求超时（毫秒，默认 120000）。挂死的连接（fetch 永不完成 / 流 reader 永不结束）
   * 不再无限 park worker——超时即中断并抛 llm_request_timeout，由重试层当瞬态网络错误重试。
   */
  providerRequestTimeoutMs?: number;
};

export type AgentLoopUsage = {
  stepsUsed: number;
  secondsUsed: number;
  tokenIn: number;
  tokenOut: number;
  totalTokens: number;
  estimatedCostCny: string;
  compactions?: number;
};

export type AgentAssistantBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "unknown"; raw: unknown };

export type AgentLoopStep = {
  index: number;
  assistant: AgentAssistantBlock[];
  toolCalls: Extract<AgentAssistantBlock, { type: "tool_use" }>[];
  toolResults: ToolResult[];
  control: AgentLoopControlSignal;
  stopReason?: string;
  snapshotId?: string;
  startedAt: string;
  endedAt: string;
};

export type StructuredHandoff = {
  done: string[];
  remaining: string[];
  nextSteps: string[];
  blockers: string[];
  artifacts: string[];
  budgetHit: "steps" | "timeout" | "tokens" | "cost" | "doom_loop" | "snapshot_gate" | "unknown";
};

export type AgentLoopClient = {
  provider?: string;
  model: string;
  messages: {
    create: (params: LlmCreateParams) => Promise<LlmCreateResponse>;
    stream?: (params: LlmCreateParams) => Promise<LlmStream>;
  };
};

export type AgentLoopRecorder = {
  recordStep: (step: AgentLoopStep) => Promise<void> | void;
  /** 每步累计用量回调：让宿主在 loop 中途抛错时仍持有已消耗的 token/成本，避免失败 run 记账为 0。 */
  recordUsage?: (usage: AgentLoopUsage) => void;
};

export type AgentLoopManifestOptions = {
  title?: string;
  proposalId?: string;
  branchId?: string;
  snapshotId?: string;
  branchHeadRef?: string;
  author?: DeliverableChangeManifest["author"];
  evidenceRefs?: EvidenceRef[];
  createdAt?: Date | string;
  downloadHrefForPath?: (relativePath: string) => string;
  previewHrefForPath?: (relativePath: string) => string | undefined;
};

export type AgentLoopEvent = {
  type: EventType;
  previewText?: string;
  data: Record<string, unknown>;
};

export type AgentLoopInput = {
  runId: string;
  workItemId: string;
  actorId?: string;
  workdir: string;
  systemPrompt: string;
  initialUserMessage: string;
  client: AgentLoopClient;
  /**
   * findings[#4]：独立评审客户端。llm_review 不应复用工人同一模型/路由（自评偏置）——部署可经
   * 'review' 任务类路由到独立模型。不传则回退 client（行为与配置前一致，保持后向兼容）。
   */
  reviewClient?: AgentLoopClient;
  /** findings[#7]：评审用的已解析任务标题（如 run.title）。不传则回退 initialUserMessage 首行（旧行为）。 */
  reviewTaskTitle?: string;
  /** findings[#5]：评审用的验收标准清单，作为评分依据传给评审员。不传则不附加。 */
  reviewAcceptance?: string[];
  tools: {
    toModelTools: (ctx: ToolExecutionContext) => Promise<unknown[]> | unknown[];
    execute: (toolId: string, input: unknown, ctx: ToolExecutionContext) => Promise<ToolResult> | ToolResult;
  };
  budget: AgentLoopBudget;
  maxTokensPerStep?: number;
  requireDeliverable?: boolean;
  /** run 成功后追加一次 llm_review 评审调用（OQ-2 来源②）；默认开启。findings[#2]：失败/空/不可解析时 fail-closed（向下钳低置信），不再静默向上美化。 */
  reviewDeliverable?: boolean;
  snapshot?: SnapshotHook;
  // 注入受控命令执行器；不传则 run_command fail-closed（默认不执行宿主命令）。由部署/worker 按配置决定。
  commandRunner?: CommandRunner;
  manifest?: AgentLoopManifestOptions;
  recorder?: AgentLoopRecorder;
  emit?: (event: AgentLoopEvent) => Promise<void> | void;
  now?: () => Date;
  /**
   * R4 #31：可选的运行级取消信号。透传给每次 provider 请求（与 per-request 超时合并）并让重试退避 sleep
   * 提前中止——被取消的 run 不再空转完整退避延迟。不传则与既有行为一致（无外部取消）。
   */
  signal?: AbortSignal;
};

export type AgentRunReview = {
  source: "llm_review";
  grade: 1 | 2 | 3 | 4 | 5;
  rationale: string;
  model: string;
};

export type AgentLoopResult = {
  status: AgentRunTerminalStatus;
  reason: string;
  control: AgentLoopControlSignal;
  usage: AgentLoopUsage;
  steps: AgentLoopStep[];
  finalText?: string;
  handoff?: StructuredHandoff;
  manifest?: DeliverableChangeManifest;
  review?: AgentRunReview;
  /**
   * findings[#2]：评审被请求但失败/空/不可解析（≠「未请求评审」）。置位时置信度计分 fail-closed：
   * 向下钳到低置信/需人审，绝不奖励一次失败的评审。未请求评审时此字段缺省（保持旧的启发式回退）。
   */
  reviewFailed?: boolean;
};
