import crypto from "node:crypto";

import type {
  AgentAssistantBlock,
  AgentLoopBudget,
  AgentLoopControlSignal,
  AgentLoopStep,
  AgentLoopUsage
} from "./types.js";

export type BudgetCheckResult =
  | { signal: "escalate"; budgetHit: "steps" | "timeout" | "tokens" | "cost"; reason: string }
  | { signal: "compact"; reason: string }
  | null;

function numericCny(value: string | undefined) {
  return Number.parseFloat(value ?? "0");
}

export function createInitialUsage(): AgentLoopUsage {
  return {
    stepsUsed: 0,
    secondsUsed: 0,
    tokenIn: 0,
    tokenOut: 0,
    totalTokens: 0,
    estimatedCostCny: "0"
  };
}

export function checkLoopBudget(usage: AgentLoopUsage, budget: AgentLoopBudget): BudgetCheckResult {
  if (usage.secondsUsed >= budget.totalTimeoutSeconds) {
    return { signal: "escalate", budgetHit: "timeout", reason: "总耗时预算已耗尽" };
  }
  if (usage.stepsUsed >= budget.maxSteps) {
    return { signal: "escalate", budgetHit: "steps", reason: "步数预算已耗尽" };
  }
  if (usage.totalTokens >= budget.maxTokens) {
    return { signal: "escalate", budgetHit: "tokens", reason: "token 预算已耗尽" };
  }
  // R4 #8：成本上限 <=0（或未配置 → numericCny 回 0）视为「该维度不限」，与 cost 包 decideRunBudget
  // 同口径（packages/cost/src/decision.ts:153）。否则 `cost >= 0` 恒真 → maxCostCny='0' 会把每个 run
  // 一开跑就判成本耗尽、立即升级、永久卡死。仅当配了正的成本上限才做耗尽判定。
  const maxCostCny = numericCny(budget.maxCostCny);
  if (maxCostCny > 0 && numericCny(usage.estimatedCostCny) >= maxCostCny) {
    return { signal: "escalate", budgetHit: "cost", reason: "成本预算已耗尽" };
  }
  if (
    budget.contextWindowTokens &&
    usage.totalTokens > budget.contextWindowTokens * (budget.compactThreshold ?? 0.8)
  ) {
    return { signal: "compact", reason: "上下文接近窗口上限" };
  }
  return null;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  }
  if (typeof value === "string") {
    return JSON.stringify(value.length > 500 ? value.slice(0, 500) : value.trim());
  }
  return JSON.stringify(value);
}

export function fingerprintAssistantBlocks(blocks: AgentAssistantBlock[]) {
  const toolCalls = blocks.filter((block): block is Extract<AgentAssistantBlock, { type: "tool_use" }> => block.type === "tool_use");
  const source = toolCalls.length > 0
    ? toolCalls.map((tool) => ({ name: tool.name, input: tool.input }))
    : blocks.map((block) => {
        if (block.type === "text" || block.type === "thinking") {
          return block.text;
        }
        if (block.type === "unknown") {
          return block.raw;
        }
        return { name: block.name, input: block.input };
      }).join("\n");
  return crypto.createHash("sha256").update(canonical(source)).digest("hex");
}

export class DoomLoopDetector {
  private readonly signatures: string[] = [];

  constructor(private readonly windowSize = 3) {}

  push(step: Pick<AgentLoopStep, "assistant">) {
    const signature = fingerprintAssistantBlocks(step.assistant);
    this.signatures.push(signature);
    if (this.signatures.length > this.windowSize) {
      this.signatures.shift();
    }
    return this.isLooping() ? signature : null;
  }

  private isLooping() {
    if (this.signatures.length < this.windowSize) {
      return false;
    }
    const first = this.signatures[0];
    return this.signatures.every((signature) => signature === first);
  }
}

export function controlFromAssistant(blocks: AgentAssistantBlock[], stopReason: string | undefined): AgentLoopControlSignal {
  const toolUses = blocks.filter((block): block is Extract<AgentAssistantBlock, { type: "tool_use" }> => block.type === "tool_use");
  // L#65：max_tokens 截断时 tool_use 的 input 可能是没解析完的 partial_json（退化成 string）。
  // 直接执行会把残缺输入喂给工具。这种情况下走 compact 重来，而不是 continue 后执行垃圾输入。
  if (stopReason === "max_tokens" && toolUses.some((block) => typeof block.input === "string")) {
    return "compact";
  }
  if (toolUses.length > 0) {
    return "continue";
  }
  if (!stopReason || stopReason === "end_turn") {
    return "stop";
  }
  if (stopReason === "max_tokens") {
    return "compact";
  }
  return "stop";
}
