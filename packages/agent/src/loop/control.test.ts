import assert from "node:assert/strict";
import test from "node:test";

import { checkLoopBudget, createInitialUsage } from "./control.js";
import type { AgentLoopBudget, AgentLoopUsage } from "./types.js";

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
