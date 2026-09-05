/**
 * R26 批 B10 — 两段式压缩里所有模型可见文本的 golden。
 *
 * 被钉住的是三类会原样进入模型上下文的文本（写法照 B6 的 `loop-reminder.golden.test.ts`）：
 *   - `context-pruning.truncate.*.expected.md`：单条工具结果写回上下文时的截断话术
 *     （落盘可用 / 落盘不可用两种），以及末尾的 spill 定位提示；
 *   - `context-pruning.prune.*.expected.md`：第一段剪枝后的完整正文（带定位提示 / 不带）；
 *   - `context-pruning.plan.expected.json`：一段固定历史的剪枝真值表——哪几条被剪、保留窗口
 *     多大、省下多少字符、剪后估算的上下文压力够不够。**档位以外，「谁被剪」同样是模型可见
 *     行为**（模型看到的历史因此不同），所以判定结果和话术一起钉。
 *
 * 夹具全是常量（固定文本模板、固定路径、固定预算），剪枝与截断都是不读时钟、不读环境、
 * 不碰磁盘的纯函数，渲染结果确定。落盘路径由夹具直接给出，不真的写文件。
 */
import test from "node:test";

import {
  applyToolResultPruning,
  DEFAULT_PRUNE_RETAIN_RATIO,
  DEFAULT_PRUNE_TOOL_RESULT_CHARS,
  decidePruningSufficient,
  projectWireContext,
  pruneToolResultText,
  spillLocatorHint,
  truncateForContext,
  type WireMessage
} from "../loop/context-pruning.js";
import { assertGolden, expectedDirFrom, toGoldenJson, toGoldenText } from "./expected.js";

const EXPECTED_DIR = expectedDirFrom(import.meta.url, "..", "..");

// --- 夹具（全常量）---------------------------------------------------------

/** 一段有头有尾的长工具输出：首尾都要能在截断/剪枝后被认出来。 */
const LONG_OUTPUT = [
  "第 1 行：读取 outputs/季度复盘.md",
  "正文正文正文。".repeat(1500),
  "最后一行：共 3 处待确认，见上文第 2 节。"
].join("\n");

const SPILL_PATH = ".spill/0007-read_file.txt";

/** 固定的一段历史：3 条工具结果（两长一短）+ 提示词与工具调用参数。 */
function fixtureMessages(): WireMessage[] {
  return [
    { role: "user", content: "把季度复盘整理成一页纪要。" },
    { role: "assistant", content: [{ type: "tool_use", id: "call-1", name: "read_file", input: { path: "outputs/季度复盘.md" } }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "call-1", content: LONG_OUTPUT, is_error: false }] },
    { role: "assistant", content: [{ type: "tool_use", id: "call-2", name: "list_files", input: { path: "outputs" } }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "call-2", content: "outputs/季度复盘.md", is_error: false }] },
    { role: "assistant", content: [{ type: "tool_use", id: "call-3", name: "read_file", input: { path: "outputs/附录.md" } }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "call-3", content: LONG_OUTPUT, is_error: false }] },
    { role: "assistant", content: [{ type: "tool_use", id: "call-4", name: "read_file", input: { path: "outputs/结论.md" } }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "call-4", content: LONG_OUTPUT, is_error: false }] }
  ];
}

// --- golden ----------------------------------------------------------------

test("golden: 第二段截断话术——落盘不可用时（无 workdir / 写失败）", () => {
  assertGolden({
    dir: EXPECTED_DIR,
    name: "context-pruning.truncate.no-spill.expected.md",
    actual: toGoldenText(truncateForContext(LONG_OUTPUT, 600))
  });
});

test("golden: 第二段截断话术——落盘成功时（末尾带 spill 定位提示）", () => {
  assertGolden({
    dir: EXPECTED_DIR,
    name: "context-pruning.truncate.spilled.expected.md",
    actual: toGoldenText(truncateForContext(LONG_OUTPUT, 600, { spillPath: SPILL_PATH }))
  });
  assertGolden({
    dir: EXPECTED_DIR,
    name: "context-pruning.spill-locator.expected.md",
    actual: toGoldenText(spillLocatorHint(SPILL_PATH))
  });
});

test("golden: 第一段剪枝后的完整正文（不带定位提示 / 带定位提示）", () => {
  assertGolden({
    dir: EXPECTED_DIR,
    name: "context-pruning.prune.plain.expected.md",
    actual: toGoldenText(pruneToolResultText(LONG_OUTPUT, DEFAULT_PRUNE_TOOL_RESULT_CHARS))
  });
  // 先按 2000 字符截断并落盘（末尾带定位提示），再按 1000 字符剪枝：这一份钉住的是
  // 「剪枝标记改口指向文件 + 定位提示被整条保留」这两件事，所以两级预算都写死、不取默认值。
  assertGolden({
    dir: EXPECTED_DIR,
    name: "context-pruning.prune.spilled.expected.md",
    actual: toGoldenText(pruneToolResultText(truncateForContext(LONG_OUTPUT, 2000, { spillPath: SPILL_PATH }), 1000))
  });
});

test("golden: 固定历史的剪枝真值表（谁被剪、保留窗口、省下多少、够不够）", () => {
  const messages = fixtureMessages();
  const before = messages.map((message) =>
    Array.isArray(message.content)
      ? (message.content as { type?: string; content?: string }[])
          .filter((block) => block.type === "tool_result")
          .map((block) => (block.content ?? "").length)
      : []
  );
  const applied = applyToolResultPruning(projectWireContext(messages));
  const after = messages.map((message) =>
    Array.isArray(message.content)
      ? (message.content as { type?: string; content?: string }[])
          .filter((block) => block.type === "tool_result")
          .map((block) => (block.content ?? "").length)
      : []
  );
  assertGolden({
    dir: EXPECTED_DIR,
    name: "context-pruning.plan.expected.json",
    actual: toGoldenJson({
      defaults: {
        pruneToolResultChars: DEFAULT_PRUNE_TOOL_RESULT_CHARS,
        retainRatio: DEFAULT_PRUNE_RETAIN_RATIO
      },
      toolResultCharsBefore: before.flat(),
      toolResultCharsAfter: after.flat(),
      prunedResults: applied.prunedResults,
      prunedChars: applied.prunedChars,
      contextChars: applied.contextChars,
      // 同一份剪枝结果，放在两种上下文窗口下的「够不够」判定。
      decisionWideWindow: decidePruningSufficient({
        prunedChars: applied.prunedChars,
        contextChars: applied.contextChars,
        contextWindowTokens: 20000,
        compactThreshold: 0.8
      }),
      decisionTightWindow: decidePruningSufficient({
        prunedChars: applied.prunedChars,
        contextChars: applied.contextChars,
        contextWindowTokens: 2000,
        compactThreshold: 0.8
      })
    })
  });
});
