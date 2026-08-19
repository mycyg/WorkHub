import assert from "node:assert/strict";
import test from "node:test";

import { checkLoopBudget, controlFromAssistant, createInitialUsage, DoomLoopDetector, fingerprintAssistantBlocks, isTruncatedToolBatch } from "./control.js";
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

// ── CORE-05：死循环检测误判修复 ──────────────────────────────────────────────────────────

const unknownBlock = (raw: unknown): AgentAssistantBlock => ({ type: "unknown", raw });
const detectorStep = (blocks: AgentAssistantBlock[]) => ({ assistant: blocks });

test("CORE-05① fingerprint: >500-char strings differing only past char 500 get distinct fingerprints", () => {
  // 同模板大文件场景：两个 600 字文本前 500 字完全相同、只有尾部不同。旧实现只取前 500 字 →
  // 指纹恒同 → DoomLoopDetector 三步即误判死循环。修复后并入长度+尾部哈希，指纹可分。
  const sharedHead = "模板头部 ".repeat(100); // 500 字
  const blocksA = [textBlock(`${sharedHead}产出文件版本 A`)];
  const blocksB = [textBlock(`${sharedHead}产出文件版本 B`)];
  assert.notEqual(fingerprintAssistantBlocks(blocksA), fingerprintAssistantBlocks(blocksB));
  // 完全相同的超长文本指纹仍相同（重复检测不因此失效）。
  assert.equal(fingerprintAssistantBlocks(blocksA), fingerprintAssistantBlocks(blocksA));
  // 回归钉：两个不同的大文件交替三步不再触发死循环升级。
  const detector = new DoomLoopDetector(3);
  assert.equal(detector.push(detectorStep(blocksA)), null);
  assert.equal(detector.push(detectorStep(blocksB)), null);
  assert.equal(detector.push(detectorStep(blocksA)), null);
});

test("CORE-05② fingerprint: unknown blocks with object raw are canonicalized structurally", () => {
  // 旧实现 .join("\n") 把对象 raw String 化成 "[object Object]"——所有对象指纹恒同。
  assert.notEqual(
    fingerprintAssistantBlocks([unknownBlock({ code: "rate_limit", attempt: 1 })]),
    fingerprintAssistantBlocks([unknownBlock({ code: "rate_limit", attempt: 2 })])
  );
  // 同内容（即便键序不同）指纹仍相同：canonical 按键排序。
  assert.equal(
    fingerprintAssistantBlocks([unknownBlock({ a: 1, b: 2 })]),
    fingerprintAssistantBlocks([unknownBlock({ b: 2, a: 1 })])
  );
  // raw 与字符串同形也不串：对象 {text:"x"} 与字符串 "x" 不共享指纹路径。
  assert.notEqual(
    fingerprintAssistantBlocks([unknownBlock("hello")]),
    fingerprintAssistantBlocks([unknownBlock({ text: "hello" })])
  );
});

test("CORE-05③ DoomLoopDetector catches an A-B-A-B alternating cycle on the 4th step", () => {
  // 周期 2 交替（写 A → 跑测试 → 写 A → 跑测试…）旧实现漏检（窗口内恒等检测要求全同）。
  const stepA = [toolUse({ path: "outputs/a.md", content: "A" })];
  const stepB = [toolUse({ path: "outputs/a.md", content: "B" })];
  const detector = new DoomLoopDetector(3);
  assert.equal(detector.push(detectorStep(stepA)), null);
  assert.equal(detector.push(detectorStep(stepB)), null);
  // A-B-A 三步不触发（两步交替尚不构成可确认的循环）。
  assert.equal(detector.push(detectorStep(stepA)), null);
  // A-B-A-B 第四步触发。
  assert.notEqual(detector.push(detectorStep(stepB)), null);
});

test("CORE-05③ DoomLoopDetector still catches exact repeats and ignores non-cyclic sequences", () => {
  const stepA = [toolUse({ path: "outputs/a.md", content: "A" })];
  const stepB = [toolUse({ path: "outputs/a.md", content: "B" })];
  const stepC = [toolUse({ path: "outputs/a.md", content: "C" })];
  // A-A-A 恒等重复：第 3 步即触发（旧行为保持）。
  const repeat = new DoomLoopDetector(3);
  assert.equal(repeat.push(detectorStep(stepA)), null);
  assert.equal(repeat.push(detectorStep(stepA)), null);
  assert.notEqual(repeat.push(detectorStep(stepA)), null);
  // A-B-C-A 无周期模式：不触发。
  const acyclic = new DoomLoopDetector(3);
  assert.equal(acyclic.push(detectorStep(stepA)), null);
  assert.equal(acyclic.push(detectorStep(stepB)), null);
  assert.equal(acyclic.push(detectorStep(stepC)), null);
  assert.equal(acyclic.push(detectorStep(stepA)), null);
});
