/**
 * R26 批 B10 —— 两段式压缩第一段（剪枝）与第二段（落盘/截断）的纯函数真值表。
 *
 * 这里只测不碰磁盘的部分：谁被剪、谁被保留、标记长什么样、配对结构有没有被动过、
 * 压力怎么重算。落盘的文件系统行为与两套引擎的接线分别由 loop.test.ts / equivalence.test.ts 覆盖，
 * 模型可见文本本身由 golden/context-pruning.golden.test.ts 逐字节钉住。
 */
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { okToolResult } from "@workhub/tools";

import {
  applyToolResultPruning,
  createSpillWriter,
  decidePruningSufficient,
  DEFAULT_PRUNE_RETAIN_RATIO,
  DEFAULT_PRUNE_TOOL_RESULT_CHARS,
  estimateTokensFromChars,
  planToolResultPruning,
  projectWireContext,
  pruneToolResultText,
  spillLocatorHint,
  splitSpillHint,
  truncateForContext,
  type WireMessage
} from "./context-pruning.js";

const BIG = "内容".repeat(3000); // 6000 字符，稳稳超过 2000 的剪枝预算
const SMALL = "短结果";

// --- 剪枝真值表 -------------------------------------------------------------

test("剪枝只动保留窗口之外、且超过单条预算的条目", () => {
  const contents = [BIG, SMALL, BIG, BIG, BIG, BIG];
  const plan = planToolResultPruning(contents);
  // 6 条 × 0.16 = 0.96 → 向上取整 1 条保留窗口。
  assert.equal(plan.retainCount, 1);
  // 下标 0..4 是候选，其中 1 号太短不值得剪；5 号在保留窗口里不动。
  assert.deepEqual(plan.pruned.map((item) => item.index), [0, 2, 3, 4]);
  assert.ok(plan.prunedChars > 4 * 3000, `实际省下 ${plan.prunedChars} 字符`);
});

test("保留窗口至少 1 条：只有一条工具结果时一个字都不剪", () => {
  const plan = planToolResultPruning([BIG]);
  assert.equal(plan.retainCount, 1);
  assert.deepEqual(plan.pruned, []);
  assert.equal(plan.prunedChars, 0);
});

test("保留窗口按比例随历史增长", () => {
  assert.equal(planToolResultPruning(Array.from({ length: 20 }, () => SMALL)).retainCount, Math.ceil(20 * DEFAULT_PRUNE_RETAIN_RATIO));
  assert.equal(planToolResultPruning([], {}).retainCount, 0);
  // 自定义比例：一半历史都保留。
  assert.equal(planToolResultPruning(Array.from({ length: 10 }, () => BIG), { retainRatio: 0.5 }).retainCount, 5);
});

test("全部在预算内时不产生任何剪枝（压力线以下的会话一个字不动由调用方保证，这里是第二道闸）", () => {
  const plan = planToolResultPruning(Array.from({ length: 10 }, () => SMALL));
  assert.deepEqual(plan.pruned, []);
  assert.equal(plan.prunedChars, 0);
});

test("剪枝幂等：剪过一遍的文本再剪不会二次加标记", () => {
  const once = pruneToolResultText(BIG, DEFAULT_PRUNE_TOOL_RESULT_CHARS);
  const twice = pruneToolResultText(once, DEFAULT_PRUNE_TOOL_RESULT_CHARS);
  assert.equal(twice, once);
  assert.equal(once.split("中段已剪枝").length - 1, 1);
});

test("剪枝标记中英各一句，都说清「被剪了、不是原始输出缺失、原文在哪」", () => {
  const pruned = pruneToolResultText(BIG, 1000);
  assert.match(pruned, /…\[中段已剪枝：为节省上下文省略 \d+ 个字符；这是运行环境删的，不是原始输出缺失。需要完整内容请重新执行产生它的那一步。\]/u);
  assert.match(pruned, /…\[middle pruned: \d+ characters were removed here to save context, not missing from the original output\. Re-run the step that produced it to get the full text\.\]/u);
  // 头 75% + 尾 15%：首尾原文都还在。
  assert.ok(pruned.startsWith(BIG.slice(0, 100)));
  assert.ok(pruned.endsWith(BIG.slice(BIG.length - 100)));
});

test("带 spill 定位提示的结果：提示整条保留，剪枝标记改口指向那个文件", () => {
  const withHint = truncateForContext(BIG, 500, { spillPath: ".spill/0007-run_command.txt" });
  const pruned = pruneToolResultText(withHint, 200);
  assert.match(pruned, /…\[中段已剪枝：.*完整内容在本条末尾给出的文件里。\]/u);
  assert.match(pruned, /The full text is in the file named at the end of this result\./u);
  assert.ok(pruned.endsWith(spillLocatorHint(".spill/0007-run_command.txt")));
});

test("splitSpillHint 只认完整的两行定位提示，不误伤正常正文", () => {
  assert.deepEqual(splitSpillHint("普通结果"), { body: "普通结果", hint: "" });
  assert.deepEqual(splitSpillHint("[完整内容已保存到 x，需要时用 read_file 读取它]"), {
    body: "[完整内容已保存到 x，需要时用 read_file 读取它]",
    hint: ""
  });
  const real = `正文\n${spillLocatorHint(".spill/0001-read_file.txt")}`;
  assert.deepEqual(splitSpillHint(real), { body: "正文", hint: spillLocatorHint(".spill/0001-read_file.txt") });
});

// --- 配对守卫 ---------------------------------------------------------------

test("剪枝只改内容不动消息：条数、角色、tool_use_id、配对全部原样", () => {
  const messages: WireMessage[] = [
    { role: "user", content: "任务" },
    { role: "assistant", content: [{ type: "tool_use", id: "call-1", name: "read_file", input: { path: "a.md" } }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "call-1", content: BIG, is_error: false }] },
    { role: "assistant", content: [{ type: "tool_use", id: "call-2", name: "read_file", input: { path: "b.md" } }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "call-2", content: BIG, is_error: false }] },
    { role: "assistant", content: [{ type: "tool_use", id: "call-3", name: "read_file", input: { path: "c.md" } }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "call-3", content: BIG, is_error: true }] }
  ];
  const before = messages.map((message) => message.role).join(",");
  const result = applyToolResultPruning(projectWireContext(messages));

  assert.equal(messages.length, 7, "消息一条都没增删");
  assert.equal(messages.map((message) => message.role).join(","), before, "角色序列不变");
  const toolUseIds = messages.flatMap((message) =>
    Array.isArray(message.content)
      ? (message.content as { type?: string; id?: string }[]).filter((block) => block.type === "tool_use").map((block) => block.id)
      : []
  );
  const resultIds = messages.flatMap((message) =>
    Array.isArray(message.content)
      ? (message.content as { type?: string; tool_use_id?: string }[])
          .filter((block) => block.type === "tool_result")
          .map((block) => block.tool_use_id)
      : []
  );
  assert.deepEqual(resultIds, toolUseIds, "每个 tool_use 仍恰好配一个同 id 的 tool_result");
  // 3 条工具结果 → 保留窗口 1 条 → 只剪前两条。
  assert.equal(result.prunedResults, 2);
  const contents = messages
    .flatMap((message) => (Array.isArray(message.content) ? (message.content as { type?: string; content?: string }[]) : []))
    .filter((block) => block.type === "tool_result")
    .map((block) => block.content ?? "");
  assert.ok(contents[0]!.length < BIG.length);
  assert.ok(contents[1]!.length < BIG.length);
  assert.equal(contents[2], BIG, "最近一条工具结果原样保留");
  // is_error 之类的旁路字段不能在改写中丢掉。
  const lastBlock = (messages[6]!.content as { is_error?: boolean }[])[0]!;
  assert.equal(lastBlock.is_error, true);
});

// --- 压力重算 ---------------------------------------------------------------

test("contextChars 用剪后的文本算，otherChars 计入提示词与工具参数", () => {
  const messages: WireMessage[] = [
    { role: "user", content: "12345" },
    { role: "assistant", content: [{ type: "text", text: "abc" }, { type: "tool_use", id: "c1", name: "ls", input: {} }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "c1", content: "0123456789", is_error: false }] }
  ];
  const projection = projectWireContext(messages);
  // 5（user）+ 3（text）+ 2（工具名 ls）+ 2（参数 "{}"）= 12
  assert.equal(projection.otherChars, 12);
  const result = applyToolResultPruning(projection);
  assert.equal(result.prunedChars, 0, "都在预算内，没得剪");
  assert.equal(result.contextChars, 12 + 10);
});

test("剪枝够不够：必须同时满足「真剪到了」与「剪后估算回到压缩线以下」", () => {
  const window = { contextWindowTokens: 1000, compactThreshold: 0.8 }; // 线 = 800 token = 1600 字符
  assert.equal(decidePruningSufficient({ prunedChars: 5000, contextChars: 1000, ...window }).sufficient, true);
  // 一个字都没剪 → 行为必须与加这一段之前逐字一致：照常发摘要。
  assert.equal(decidePruningSufficient({ prunedChars: 0, contextChars: 10, ...window }).sufficient, false);
  // 剪了但还是太挤 → 继续走摘要。
  assert.equal(decidePruningSufficient({ prunedChars: 5000, contextChars: 100000, ...window }).sufficient, false);
  // 没配上下文窗口 → 线为 0，永远判不够（保持既有行为）。
  assert.equal(decidePruningSufficient({ prunedChars: 5000, contextChars: 10 }).sufficient, false);
  assert.equal(estimateTokensFromChars(1001), 501);
});

// --- 落盘 -------------------------------------------------------------------

test("落盘：文件名带步号与工具名，同一步重名依次加序号，返回相对路径", async () => {
  const workdir = await mkdtemp(path.join(os.tmpdir(), "workhub-spill-"));
  const spill = createSpillWriter({ workdir });
  assert.equal(await spill({ stepNo: 3, toolName: "read_file", content: "一" }), ".spill/0003-read_file.txt");
  assert.equal(await spill({ stepNo: 3, toolName: "read_file", content: "二" }), ".spill/0003-read_file-2.txt");
  assert.equal(await spill({ stepNo: 12, toolName: "run/命令", content: "三" }), ".spill/0012-run___.txt");
  assert.deepEqual((await readdir(path.join(workdir, ".spill"))).sort(), [
    "0003-read_file-2.txt",
    "0003-read_file.txt",
    "0012-run___.txt"
  ]);
  assert.equal(await readFile(path.join(workdir, ".spill", "0003-read_file.txt"), "utf8"), "一");
});

test("落盘：没有 workdir 时恒不落盘，截断话术退回不提 .spill 的那一版", async () => {
  const spill = createSpillWriter({});
  assert.equal(await spill({ stepNo: 1, toolName: "read_file", content: BIG }), undefined);
  const text = truncateForContext(BIG, 500);
  assert.match(text, /…\[已截断 \d+ 字符，中段省略；需要完整内容请重读该文件或用 run_command 抽取\]/u);
  assert.equal(text.includes(".spill"), false);
});

test("落盘：总字节上限用尽后停止落盘，运行不受影响", async () => {
  const workdir = await mkdtemp(path.join(os.tmpdir(), "workhub-spill-cap-"));
  const spill = createSpillWriter({ workdir, maxTotalBytes: 10 });
  assert.equal(await spill({ stepNo: 1, toolName: "t", content: "12345" }), ".spill/0001-t.txt");
  assert.equal(await spill({ stepNo: 2, toolName: "t", content: "123456" }), undefined, "第二条超出上限，不落盘");
  assert.deepEqual(await readdir(path.join(workdir, ".spill")), ["0001-t.txt"]);
});

test("截断：预算内的内容原样返回，不加任何标记", () => {
  assert.equal(truncateForContext("刚刚好", 100), "刚刚好");
  assert.equal(truncateForContext("刚刚好", 100, { spillPath: ".spill/x.txt" }), "刚刚好");
});

// --- 计费可观测：剪枝够了就不发摘要请求 --------------------------------------

type CompactionProbe = { requests: number };

function scriptedRun(params: {
  toolSteps: number;
  tokensPerStep: number;
  toolResultChars: number;
  contextWindowTokens: number;
}) {
  const probe: CompactionProbe = { requests: 0 };
  const events: { type: string; data: Record<string, unknown> }[] = [];
  let calls = 0;
  const run = async (workdir: string) => {
    const { createAgentLoop } = await import("./index.js");
    return createAgentLoop().run({
      runId: "40000000-0000-4000-8000-0000000000c1",
      workItemId: "50000000-0000-4000-8000-0000000000c1",
      workdir,
      systemPrompt: "work",
      initialUserMessage: "开始",
      client: {
        model: "fake-model",
        messages: {
          async create() {
            calls += 1;
            if (calls <= params.toolSteps) {
              return {
                id: `m${calls}`,
                stopReason: "tool_use",
                content: [{ type: "tool_use", id: `t${calls}`, name: "probe", input: { round: calls } }],
                usage: { inputTokens: params.tokensPerStep, outputTokens: 0 }
              };
            }
            return {
              id: `m${calls}`,
              stopReason: "end_turn",
              content: [{ type: "text", text: "收工" }],
              usage: { inputTokens: params.tokensPerStep, outputTokens: 0 }
            };
          }
        }
      },
      compactionClient: {
        model: "fake-compaction",
        messages: {
          async create() {
            probe.requests += 1;
            return { id: "c1", stopReason: "end_turn", content: [{ type: "text", text: "## 目标（Goal）\n继续" }] };
          }
        }
      },
      tools: {
        toModelTools: async () => [{ name: "probe", description: "probe", input_schema: { type: "object" } }],
        execute: async () => okToolResult("料".repeat(params.toolResultChars))
      },
      budget: {
        maxSteps: 12,
        totalTimeoutSeconds: 300,
        maxTokens: 1_000_000,
        maxCostCny: "0",
        contextWindowTokens: params.contextWindowTokens,
        compactThreshold: 0.8
      },
      requireDeliverable: false,
      emit: async (event) => {
        events.push({ type: event.type, data: (event.data ?? {}) as Record<string, unknown> });
      }
    });
  };
  return { probe, events, run };
}

test("剪枝足够 → 一次摘要请求都不发（没有 context_compact 计费）", async () => {
  const workdir = await mkdtemp(path.join(os.tmpdir(), "workhub-prune-enough-"));
  // 4 步各产 5000 字符结果；压缩线 = 20000 × 0.8 = 16000 token，累计 token 第 4 步后越线。
  // 剪后历史约 1.1 万字符 ≈ 5500 token，稳稳在线下 → 不发摘要。
  const scenario = scriptedRun({ toolSteps: 4, tokensPerStep: 5000, toolResultChars: 5000, contextWindowTokens: 20000 });
  const result = await scenario.run(workdir);

  assert.equal(result.status, "succeeded");
  assert.equal(scenario.probe.requests, 0, "剪枝够用时不该有任何摘要请求");
  assert.equal(result.usage.compactions ?? 0, 0, "剪枝不占压缩配额");
  const compacting = scenario.events.filter((event) => event.type === "agent_run.compacting");
  assert.equal(compacting.length, 1);
  assert.equal(compacting[0]?.data.summary_kind, "pruned");
  assert.equal(compacting[0]?.data.pruned_results, 3, "4 条结果保留最近 1 条，剪掉最老的 3 条");
  assert.ok(Number(compacting[0]?.data.pruned_chars) > 0);
});

test("剪枝不够 → 恰好发一次摘要请求", async () => {
  const workdir = await mkdtemp(path.join(os.tmpdir(), "workhub-prune-short-"));
  // 压缩线 = 6000 × 0.8 = 4800 token = 9600 字符；3 条 8000 字符的结果剪完仍有 1.2 万字符 → 不够。
  const scenario = scriptedRun({ toolSteps: 3, tokensPerStep: 2000, toolResultChars: 8000, contextWindowTokens: 6000 });
  const result = await scenario.run(workdir);

  assert.equal(result.status, "succeeded");
  assert.equal(scenario.probe.requests, 1, "剪枝不够时恰好一次摘要请求");
  assert.equal(result.usage.compactions, 1);
  const compacting = scenario.events.filter((event) => event.type === "agent_run.compacting");
  assert.equal(compacting.length, 1);
  assert.equal(compacting[0]?.data.summary_kind, "structured");
});
