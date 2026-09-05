import crypto from "node:crypto";

import {
  doomLoopTiersForWindow,
  resolveDoomLoopTier,
  summarizeDoomLoopAction,
  type DoomLoopAction,
  type DoomLoopShape,
  type DoomLoopSignal,
  type DoomLoopTierThresholds
} from "./doom-loop-reminder.js";
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
    const trimmed = value.trim();
    // CORE-05①：>500 字不再只取前 500 字——同模板大文件（只有尾部不同）指纹恒同，会被死循环检测误杀。
    // 头部保留可调试前缀，并入长度 + 尾部哈希区分「前 500 字相同、后面不同」的串。
    if (trimmed.length > 500) {
      const tailHash = crypto.createHash("sha256").update(trimmed.slice(500)).digest("hex").slice(0, 16);
      return JSON.stringify(`${trimmed.slice(0, 500)}#len=${trimmed.length}#tail=${tailHash}`);
    }
    return JSON.stringify(trimmed);
  }
  return JSON.stringify(value);
}

export function fingerprintAssistantBlocks(blocks: AgentAssistantBlock[]) {
  const toolCalls = blocks.filter((block): block is Extract<AgentAssistantBlock, { type: "tool_use" }> => block.type === "tool_use");
  const source = toolCalls.length > 0
    ? toolCalls.map((tool) => ({ name: tool.name, input: tool.input }))
    // CORE-05②：unknown 块的 raw 原样走 canonical（保持结构化、键排序）。旧实现先 .join("\n") 拼成字符串，
    // raw 是对象时被 String 化成 "[object Object]"——所有 unknown 对象指纹恒同，必然误判/漏判死循环。
    : blocks.map((block) => {
        if (block.type === "text" || block.type === "thinking") {
          return block.text;
        }
        if (block.type === "unknown") {
          return block.raw;
        }
        return { name: block.name, input: block.input };
      });
  return crypto.createHash("sha256").update(canonical(source)).digest("hex");
}

type DoomLoopEntry = DoomLoopAction & { signature: string };

/**
 * 死循环检测器。R26 批 B6 起**不再一命中就升级**：同一重复链路按连续步数分三档
 * （默认 3 / 5 / 8，见 doom-loop-reminder.ts），前两档交给循环注入一条提醒后继续跑，
 * 第三档才升级交人。判定口径（SHA-256 指纹、全同窗口、周期 2 交替）一字未改。
 *
 * 档位只在**跨过**阈值那一步发一次：连续步数是逐步 +1 的，所以 3 发第一档、5 发第二档、
 * 8 发第三档；4、6、7 这些「还在同一档里」的步不重复打扰模型。重复链路一旦断掉
 * （不再构成任何重复形态），已发档位清零，下一条链路重新从第一档开始。
 */
export class DoomLoopDetector {
  private readonly entries: DoomLoopEntry[] = [];
  private readonly tiers: DoomLoopTierThresholds;
  /** 当前这条重复链路上已经发过的最高档位；链路断掉即清零。 */
  private reportedTier = 0;

  constructor(
    private readonly windowSize = 3,
    tiers?: DoomLoopTierThresholds
  ) {
    this.tiers = tiers ?? doomLoopTiersForWindow(windowSize);
  }

  push(step: Pick<AgentLoopStep, "assistant">): DoomLoopSignal | null {
    const signature = fingerprintAssistantBlocks(step.assistant);
    this.entries.push({ signature, ...summarizeDoomLoopAction(step.assistant) });
    // CORE-05③：周期 2（A-B-A-B）交替检测需要至少 4 个签名，保留窗口下限提到 4。
    // B6：升级档要数到第三档阈值（默认 8），保留窗口再抬到该阈值，否则数不满永远升不了级。
    const keep = Math.max(this.windowSize, 4, this.tiers[2]);
    while (this.entries.length > keep) {
      this.entries.shift();
    }
    return this.detect(signature);
  }

  private detect(signature: string): DoomLoopSignal | null {
    const identical = this.trailingIdenticalRun();
    // 全同优先：末两步相同时 trailingAlternatingRun 自会返回 0（A≠B 是交替的前提）。
    const alternating = this.trailingAlternatingRun();
    let repeats = 0;
    let shape: DoomLoopShape = "identical";
    let actions: DoomLoopAction[] = [];
    if (identical >= this.windowSize) {
      repeats = identical;
      shape = "identical";
      actions = this.entries.slice(-1).map(toAction);
    } else if (alternating >= 4) {
      repeats = alternating;
      shape = "alternating";
      // 一个周期内的两个动作，按先后顺序（倒数第二步是 A，最后一步是 B）。
      actions = this.entries.slice(-2).map(toAction);
    }
    const tier = repeats > 0 ? resolveDoomLoopTier(repeats, this.tiers) : null;
    if (!tier) {
      // 重复链路断了：下一条链路重新从第一档劝起。
      this.reportedTier = 0;
      return null;
    }
    if (tier <= this.reportedTier) {
      // 还在同一档里（比如全同的第 4 步、第 6/7 步），不重复打扰。
      return null;
    }
    this.reportedTier = tier;
    return { signature, tier, repeats, shape, actions };
  }

  /** 结尾处与最后一步指纹相同的连续步数。 */
  private trailingIdenticalRun(): number {
    const last = this.entries[this.entries.length - 1];
    if (!last) {
      return 0;
    }
    let run = 0;
    for (let i = this.entries.length - 1; i >= 0; i -= 1) {
      if (this.entries[i]?.signature !== last.signature) {
        break;
      }
      run += 1;
    }
    return run;
  }

  /** 结尾处构成 A-B-A-B…（A≠B）的连续步数；不构成交替时为 0。 */
  private trailingAlternatingRun(): number {
    const n = this.entries.length;
    if (n < 4) {
      return 0;
    }
    const a = this.entries[n - 2]?.signature;
    const b = this.entries[n - 1]?.signature;
    if (!a || !b || a === b) {
      return 0;
    }
    let run = 2;
    for (let i = n - 3; i >= 0; i -= 1) {
      const expected = (n - 1 - i) % 2 === 0 ? b : a;
      if (this.entries[i]?.signature !== expected) {
        break;
      }
      run += 1;
    }
    return run;
  }
}

function toAction(entry: DoomLoopEntry): DoomLoopAction {
  return { toolNames: entry.toolNames, preview: entry.preview };
}

/**
 * 判定一批 assistant 块是否来自被 max_tokens 截断、参数不可信的消息：stopReason=max_tokens 且至少一个
 * tool_use 的 input 退化成残缺 partial_json 字符串（provider 无法把流式增量解析成对象时的降级表现）。
 * 命中时整条消息的 tool_use 都不可信、都不该执行——由 loop 逐个回 error tool_result 让模型重发完整参数
 * （仿 pi failToolCallsFromTruncatedMessage）。检测放在这里与 controlFromAssistant 同源，便于测试。
 */
export function isTruncatedToolBatch(blocks: AgentAssistantBlock[], stopReason: string | undefined): boolean {
  if (stopReason !== "max_tokens") {
    return false;
  }
  const toolUses = blocks.filter((block): block is Extract<AgentAssistantBlock, { type: "tool_use" }> => block.type === "tool_use");
  return toolUses.length > 0 && toolUses.some((block) => typeof block.input === "string");
}

export function controlFromAssistant(blocks: AgentAssistantBlock[], stopReason: string | undefined): AgentLoopControlSignal {
  const toolUses = blocks.filter((block): block is Extract<AgentAssistantBlock, { type: "tool_use" }> => block.type === "tool_use");
  // 有 tool_use 就 continue——包括被 max_tokens 截断的批次。截断批次不再走 compact 烧压缩配额，而是由 loop
  // 侧（isTruncatedToolBatch）给每个 tool_use 回一条「因截断未执行、请重发完整参数」的 error tool_result，
  // 保住「每个 tool_use 必配 tool_result」的不变量并 continue，让模型重发完整调用。
  if (toolUses.length > 0) {
    return "continue";
  }
  if (!stopReason || stopReason === "end_turn") {
    return "stop";
  }
  // 纯文本回复被 max_tokens 截断（无 tool_use）：仍走 compact 重来。
  if (stopReason === "max_tokens") {
    return "compact";
  }
  return "stop";
}
