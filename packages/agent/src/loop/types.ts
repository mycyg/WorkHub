import type { RunBudget } from "@workhub/cost";
import type { EventType } from "@workhub/contracts";
import type {
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
};

export type AgentLoopUsage = {
  stepsUsed: number;
  secondsUsed: number;
  tokenIn: number;
  tokenOut: number;
  totalTokens: number;
  estimatedCostCny: string;
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
  tools: {
    toModelTools: (ctx: ToolExecutionContext) => Promise<unknown[]> | unknown[];
    execute: (toolId: string, input: unknown, ctx: ToolExecutionContext) => Promise<ToolResult> | ToolResult;
  };
  budget: AgentLoopBudget;
  maxTokensPerStep?: number;
  requireDeliverable?: boolean;
  snapshot?: SnapshotHook;
  recorder?: AgentLoopRecorder;
  emit?: (event: AgentLoopEvent) => Promise<void> | void;
  now?: () => Date;
};

export type AgentLoopResult = {
  status: AgentRunTerminalStatus;
  reason: string;
  control: AgentLoopControlSignal;
  usage: AgentLoopUsage;
  steps: AgentLoopStep[];
  finalText?: string;
  handoff?: StructuredHandoff;
};
