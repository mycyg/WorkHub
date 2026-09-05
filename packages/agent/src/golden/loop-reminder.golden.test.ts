/**
 * R26 批 B6 — 重复动作「先劝再断」三档话术的 golden。
 *
 * 这三档文本会原样进入模型上下文（`loop/loop.ts` 与 `loop2/config-builder.ts` 各自往对话里
 * 追加一条 user 消息），因此和系统提示词、工具 schema 同属 AGENTS.md 纪律条里的模型可见文本：
 * 改一个标点都要有可见的评审证据。
 *
 * 话术不是这里唯一被钉住的东西——**档位的触发时机**同样是模型可见行为（第几步开始劝、第几步
 * 才升级），所以先用真的 `DoomLoopDetector` 跑一遍固定步序列，再把它吐出来的信号渲染成文本：
 *   - `doom-loop-reminder.tiers.expected.json`：默认阈值 + 两种重复形态逐步的档位表；
 *   - `doom-loop-reminder.<形态>.<档位>.expected.md`：该档位的完整正文；
 *   - `doom-loop-reminder.truncated.tier2.expected.md`：参数预览超过 500 字符时的截断尾注；
 *   - `doom-loop-reminder.tier3-escalation.expected.md`：第三档不劝、直接升级时写进
 *     StructuredHandoff 的那句话（两套引擎共用同一个常量）。
 *
 * 夹具全是常量（固定工具名、固定路径、固定重复模板），检测器不读时钟也不读环境，渲染结果确定。
 */
import assert from "node:assert/strict";
import test from "node:test";

import { DoomLoopDetector } from "../loop/control.js";
import {
  buildDoomLoopReminder,
  DEFAULT_DOOM_LOOP_TIERS,
  DOOM_LOOP_ARGUMENTS_PREVIEW_CHARS,
  DOOM_LOOP_ESCALATION_REASON,
  type DoomLoopSignal
} from "../loop/doom-loop-reminder.js";
import type { AgentAssistantBlock } from "../loop/types.js";
import { assertGolden, expectedDirFrom, toGoldenJson, toGoldenText } from "./expected.js";

const EXPECTED_DIR = expectedDirFrom(import.meta.url, "..", "..");

// --- 夹具（全常量）---------------------------------------------------------

function toolStep(name: string, input: unknown): AgentAssistantBlock[] {
  return [{ type: "tool_use", id: "tool-fixed", name, input }];
}

/** 反复读同一个不存在的文件——最常见的一种重复。 */
const READ_MISSING = toolStep("read_file", { path: "docs/未命名/需求说明.md" });
/** 写文件与读文件来回切换——周期 2 交替的典型形态。 */
const WRITE_DRAFT = toolStep("write_file", { path: "outputs/草稿.md", content: "先写一版" });
/** 参数超过 500 字符：把预览的截断尾注钉住（指纹仍走全串，见 control.ts）。 */
const LONG_ARGUMENT = toolStep("write_file", {
  path: "outputs/长文.md",
  content: "第一段正文。".repeat(120)
});

/** 用真的检测器跑一遍固定步序列，收集每一步吐出的信号（没命中记 null）。 */
function drive(steps: AgentAssistantBlock[][]): (DoomLoopSignal | null)[] {
  const detector = new DoomLoopDetector();
  return steps.map((assistant) => detector.push({ assistant }));
}

const IDENTICAL_RUN = drive(Array.from({ length: 8 }, () => READ_MISSING));
const ALTERNATING_RUN = drive(
  Array.from({ length: 8 }, (_, index) => (index % 2 === 0 ? READ_MISSING : WRITE_DRAFT))
);
const TRUNCATED_RUN = drive(Array.from({ length: 5 }, () => LONG_ARGUMENT));

function signalAtTier(run: (DoomLoopSignal | null)[], tier: 1 | 2 | 3): DoomLoopSignal {
  const found = run.find((signal) => signal?.tier === tier);
  assert.ok(found, `夹具应当在某一步命中第 ${tier} 档`);
  return found;
}

// --- golden ----------------------------------------------------------------

test("golden: 三档阈值与两种重复形态的逐步档位表", () => {
  assertGolden({
    dir: EXPECTED_DIR,
    name: "doom-loop-reminder.tiers.expected.json",
    actual: toGoldenJson({
      defaultTiers: DEFAULT_DOOM_LOOP_TIERS,
      argumentsPreviewChars: DOOM_LOOP_ARGUMENTS_PREVIEW_CHARS,
      // 每一步：命中的档位（null=不劝也不升级）+ 检测到的连续重复步数。
      identical: IDENTICAL_RUN.map((signal, index) => ({
        step: index + 1,
        tier: signal?.tier ?? null,
        repeats: signal?.repeats ?? null,
        shape: signal?.shape ?? null
      })),
      alternating: ALTERNATING_RUN.map((signal, index) => ({
        step: index + 1,
        tier: signal?.tier ?? null,
        repeats: signal?.repeats ?? null,
        shape: signal?.shape ?? null
      }))
    })
  });
});

test("golden: 全同重复的第一档 / 第二档提醒正文", () => {
  assertGolden({
    dir: EXPECTED_DIR,
    name: "doom-loop-reminder.identical.tier1.expected.md",
    actual: toGoldenText(buildDoomLoopReminder(signalAtTier(IDENTICAL_RUN, 1)))
  });
  assertGolden({
    dir: EXPECTED_DIR,
    name: "doom-loop-reminder.identical.tier2.expected.md",
    actual: toGoldenText(buildDoomLoopReminder(signalAtTier(IDENTICAL_RUN, 2)))
  });
});

test("golden: 周期 2 交替的第一档 / 第二档提醒正文", () => {
  assertGolden({
    dir: EXPECTED_DIR,
    name: "doom-loop-reminder.alternating.tier1.expected.md",
    actual: toGoldenText(buildDoomLoopReminder(signalAtTier(ALTERNATING_RUN, 1)))
  });
  assertGolden({
    dir: EXPECTED_DIR,
    name: "doom-loop-reminder.alternating.tier2.expected.md",
    actual: toGoldenText(buildDoomLoopReminder(signalAtTier(ALTERNATING_RUN, 2)))
  });
});

test("golden: 参数预览超长时的截断尾注", () => {
  assertGolden({
    dir: EXPECTED_DIR,
    name: "doom-loop-reminder.truncated.tier2.expected.md",
    actual: toGoldenText(buildDoomLoopReminder(signalAtTier(TRUNCATED_RUN, 2)))
  });
});

test("golden: 第三档不劝，直接升级时写进 handoff 的那句话", () => {
  // 第三档不产生提醒正文——模型看到的最后一件事是运行被中止；这里钉住的是交给人的那句话。
  assert.equal(signalAtTier(IDENTICAL_RUN, 3).repeats, DEFAULT_DOOM_LOOP_TIERS[2]);
  assertGolden({
    dir: EXPECTED_DIR,
    name: "doom-loop-reminder.tier3-escalation.expected.md",
    actual: toGoldenText(DOOM_LOOP_ESCALATION_REASON)
  });
});
