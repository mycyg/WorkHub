import assert from "node:assert/strict";
import test from "node:test";

import { checkLoopBudget, controlFromAssistant, createInitialUsage, isTruncatedToolBatch } from "./control.js";
import type { AgentAssistantBlock, AgentLoopBudget, AgentLoopUsage } from "./types.js";

// 高 steps/tokens/timeout，使只有成本维度可能命中——隔离 R4 #8 的成本语义。
function budget(overrides: Partial<AgentLoopBudget> = {}): AgentLoopBudget {
  return {
    maxSteps: 1_000_000,
    totalTimeoutSeconds: 1_000_000,
    maxTokens: 1_000_000_000,
    maxCostCny: "5",
    ...overrides
  };
}

function usage(overrides: Partial<AgentLoopUsage> = {}): AgentLoopUsage {
  return { ...createInitialUsage(), ...overrides };
}

test("R4 #8 checkLoopBudget: maxCostCny<=0 (or unset) means unlimited, not instant cost-exhaustion", () => {
  // '0' 视为不限：即便已有成本也不应判耗尽（旧行为：cost>=0 恒真 → 每个 run 一开跑就升级、永久卡死）。
  assert.equal(checkLoopBudget(usage({ estimatedCostCny: "1.23" }), budget({ maxCostCny: "0" })), null);
  // 未配置成本上限（undefined）同样视为不限。
  assert.equal(
    checkLoopBudget(usage({ estimatedCostCny: "9.99" }), budget({ maxCostCny: undefined as unknown as string })),
    null
  );
  // 负值也视为不限。
  assert.equal(checkLoopBudget(usage({ estimatedCostCny: "9.99" }), budget({ maxCostCny: "-1" })), null);
});

test("R4 #8 checkLoopBudget: a positive cost cap still escalates when reached", () => {
  const hit = checkLoopBudget(usage({ estimatedCostCny: "5" }), budget({ maxCostCny: "5" }));
  assert.equal(hit?.signal, "escalate");
  assert.equal(hit?.signal === "escalate" ? hit.budgetHit : undefined, "cost");
  // 未达上限则放行。
  assert.equal(checkLoopBudget(usage({ estimatedCostCny: "3" }), budget({ maxCostCny: "5" })), null);
});

const toolUse = (input: unknown): AgentAssistantBlock => ({ type: "tool_use", id: "t1", name: "write_file", input });
const textBlock = (text: string): AgentAssistantBlock => ({ type: "text", text });

test("补丁3 controlFromAssistant: any tool_use continues (including a max_tokens-truncated batch)", () => {
  // 正常带工具：continue。
  assert.equal(controlFromAssistant([toolUse({ path: "outputs/a.md", content: "x" })], "tool_use"), "continue");
  // max_tokens 截断但仍有 tool_use（含退化 string input）：不再 compact，改 continue（由 loop 逐个 fail 重发）。
  assert.equal(controlFromAssistant([toolUse("{\"path\":\"outputs/a.md\",\"content\":\"par")], "max_tokens"), "continue");
  // max_tokens 但 input 仍是合法对象：continue（工具照常执行）。
  assert.equal(controlFromAssistant([toolUse({ path: "outputs/a.md", content: "x" })], "max_tokens"), "continue");
});

test("补丁3 controlFromAssistant: text-only outcomes still stop / compact as before", () => {
  // 无工具、end_turn：stop。
  assert.equal(controlFromAssistant([textBlock("完成")], "end_turn"), "stop");
  assert.equal(controlFromAssistant([textBlock("完成")], undefined), "stop");
  // 无工具、纯文本被 max_tokens 截断：compact。
  assert.equal(controlFromAssistant([textBlock("写到一半就被截")], "max_tokens"), "compact");
});

test("补丁3 isTruncatedToolBatch: true only for max_tokens with a degraded string tool_use input", () => {
  // max_tokens + 退化 string input：命中。
  assert.equal(isTruncatedToolBatch([toolUse("{\"path\":\"outputs/a.md\",\"content\":\"par")], "max_tokens"), true);
  // max_tokens 但 input 是合法对象：不命中（工具可信、照常执行）。
  assert.equal(isTruncatedToolBatch([toolUse({ path: "outputs/a.md", content: "x" })], "max_tokens"), false);
  // 非 max_tokens（即便 input 是 string）：不命中。
  assert.equal(isTruncatedToolBatch([toolUse("{\"path\":\"par")], "tool_use"), false);
  // max_tokens 但没有 tool_use：不命中（纯文本截断由 compact 处理）。
  assert.equal(isTruncatedToolBatch([textBlock("被截断的文本")], "max_tokens"), false);
});
