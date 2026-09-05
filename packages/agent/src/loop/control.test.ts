import assert from "node:assert/strict";
import test from "node:test";

import { checkLoopBudget, controlFromAssistant, createInitialUsage, DoomLoopDetector, fingerprintAssistantBlocks, isTruncatedToolBatch } from "./control.js";
import {
  buildDoomLoopReminder,
  DEFAULT_DOOM_LOOP_TIERS,
  doomLoopTiersForWindow,
  summarizeDoomLoopAction
} from "./doom-loop-reminder.js";
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

// ── B6：重复动作「先劝再断」的档位 ─────────────────────────────────────────────────

test("B6 DoomLoopDetector: an identical repeat is nudged at 3 and 5, and only escalates at 8", () => {
  // 行为变更（非修 bug）：加档位之前第 3 步即 escalated；现在第 3/5 步各劝一次，第 8 步才升级。
  const stepA = [toolUse({ path: "outputs/a.md", content: "A" })];
  const detector = new DoomLoopDetector();
  const tiers = Array.from({ length: 8 }, () => detector.push(detectorStep(stepA))?.tier ?? null);
  assert.deepEqual(tiers, [null, null, 1, null, 2, null, null, 3]);
});

test("B6 DoomLoopDetector: the signal carries repeats / shape / tool names / argument preview", () => {
  const stepA = [toolUse({ path: "outputs/a.md", content: "A" })];
  const detector = new DoomLoopDetector();
  detector.push(detectorStep(stepA));
  detector.push(detectorStep(stepA));
  const signal = detector.push(detectorStep(stepA));
  assert.equal(signal?.tier, 1);
  assert.equal(signal?.repeats, 3);
  assert.equal(signal?.shape, "identical");
  assert.deepEqual(signal?.actions, [
    { toolNames: ["write_file"], preview: 'write_file({"content":"A","path":"outputs/a.md"})' }
  ]);
  // 指纹仍是加档位之前的那一个（返回值语义没变）。
  assert.equal(signal?.signature, fingerprintAssistantBlocks(stepA));
});

test("B6 DoomLoopDetector: an A-B-A-B cycle walks the same tiers (first tier lands on step 4)", () => {
  const stepA = [toolUse({ path: "outputs/a.md", content: "A" })];
  const stepB = [toolUse({ path: "outputs/b.md", content: "B" })];
  const detector = new DoomLoopDetector();
  const tiers = Array.from(
    { length: 8 },
    (_, index) => detector.push(detectorStep(index % 2 === 0 ? stepA : stepB))?.tier ?? null
  );
  // 交替形态最早在第 4 步才成形，所以第一档落在第 4 步而不是第 3 步。
  assert.deepEqual(tiers, [null, null, null, 1, 2, null, null, 3]);
});

test("B6 DoomLoopDetector: breaking the chain resets the tiers back to the gentle nudge", () => {
  const stepA = [toolUse({ path: "outputs/a.md", content: "A" })];
  const stepB = [toolUse({ path: "outputs/b.md", content: "B" })];
  const stepC = [toolUse({ path: "outputs/c.md", content: "C" })];
  const detector = new DoomLoopDetector();
  assert.equal(detector.push(detectorStep(stepA))?.tier, undefined);
  assert.equal(detector.push(detectorStep(stepA))?.tier, undefined);
  assert.equal(detector.push(detectorStep(stepA))?.tier, 1);
  // 换动作把重复链路打断（A-A-A-B-C 既不全同也不交替）。
  assert.equal(detector.push(detectorStep(stepB)), null);
  assert.equal(detector.push(detectorStep(stepC)), null);
  // 新链路重新从第一档劝起，而不是接着上一条链路直接升级。
  assert.equal(detector.push(detectorStep(stepC))?.tier, undefined);
  assert.equal(detector.push(detectorStep(stepC))?.tier, 1);
});

test("B6 DoomLoopDetector: thresholds are configurable and default to [3, 5, 8]", () => {
  assert.deepEqual(DEFAULT_DOOM_LOOP_TIERS, [3, 5, 8]);
  // 判定窗口调大时三档整体平移，不会出现「窗口还没开始判定、阈值就已越过」的错位。
  assert.deepEqual(doomLoopTiersForWindow(5), [5, 7, 10]);
  const stepA = [toolUse({ path: "outputs/a.md", content: "A" })];
  const detector = new DoomLoopDetector(2, [2, 3, 4]);
  const tiers = Array.from({ length: 4 }, () => detector.push(detectorStep(stepA))?.tier ?? null);
  assert.deepEqual(tiers, [null, 1, 2, 3]);
});

test("B6 buildDoomLoopReminder: the gentle tier says one sentence, the detailed tier reports the call", () => {
  const gentle = buildDoomLoopReminder({
    signature: "sig",
    tier: 1,
    repeats: 3,
    shape: "identical",
    actions: [{ toolNames: ["read_file"], preview: 'read_file({"path":"missing.md"})' }]
  });
  assert.match(gentle, /^\[自动提醒\] 你已经连续 3 步重复同一个动作/);
  assert.doesNotMatch(gentle, /连续步数：/, "第一档不报细节");
  assert.match(gentle, /这条提醒由运行环境自动发出/, "标明不是人发的话");

  const detailed = buildDoomLoopReminder({
    signature: "sig",
    tier: 2,
    repeats: 5,
    shape: "identical",
    actions: [{ toolNames: ["read_file"], preview: 'read_file({"path":"missing.md"})' }]
  });
  assert.match(detailed, /重复的工具：read_file/);
  assert.match(detailed, /连续步数：5/);
  assert.match(detailed, /read_file\(\{"path":"missing\.md"\}\)/);
});

test("B6 summarizeDoomLoopAction: keys are sorted, the preview is capped, the fingerprint is not", () => {
  // 键序不同的同一份参数渲染成同一条预览（与指纹的 canonical 同口径）。
  const sortedA = summarizeDoomLoopAction([toolUse({ path: "a.md", content: "x" })]);
  const sortedB = summarizeDoomLoopAction([toolUse({ content: "x", path: "a.md" })]);
  assert.equal(sortedA.preview, sortedB.preview);
  assert.deepEqual(sortedA.toolNames, ["write_file"]);

  // 预览截到 500 字符并注明省略了多少；指纹仍看全串，因此两份只有尾部不同的大参数可分。
  const longA = toolUse({ content: `${"模板正文".repeat(200)}A` });
  const longB = toolUse({ content: `${"模板正文".repeat(200)}B` });
  const preview = summarizeDoomLoopAction([longA]).preview;
  assert.match(preview, /个字符未显示）$/);
  assert.notEqual(fingerprintAssistantBlocks([longA]), fingerprintAssistantBlocks([longB]));

  // 纯文本步（无工具调用）给空摘要，详细档会据此省掉工具/参数两段。
  assert.deepEqual(summarizeDoomLoopAction([textBlock("只是说明")]), { toolNames: [], preview: "" });
});
