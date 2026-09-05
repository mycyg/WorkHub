/**
 * R25 批 B1 — 两套引擎（传统 loop / loop2）真正发给 provider 的请求的 golden。
 *
 * 上一份 golden（agent-run-prompt.golden.test.ts）钉的是「组装函数吐出的字符串」；这一份钉的是
 * 「模型端真正收到的那一份请求」——同一个 AgentLoopInput 分别喂进 `createAgentLoop().run` 与
 * `runAgentLoop2`，用一个确定性脚本客户端把第一次模型调用的 `system` / `tools` 原样截下来落盘。
 *
 * 为什么两套都要落一份而不是只落一份 + 断言相等：
 *   - 断言相等能防「两套之间漂移」，但两套一起被改坏时它一声不吭；
 *   - 逐字节 golden 能防「相对基线漂移」，但不保证两套之间一致。
 * 两条一起上，才既拦住单边回归，也拦住双边同步改坏。
 *
 * 「差异只在既有 shadow-assert 允许的字段内」这条要求，落成三层断言：
 *   1. 两套截下来的 system 逐字节相同、tools 的 name/description/input_schema 逐字节相同
 *      （真正喂进模型的那部分文本零差异——它本就不在允许清单里）；
 *   2. 两套之间**唯一**允许的结构差异，钉死成下面 KNOWN_ENGINE_DELTA 这一条具名清单：
 *      传统 loop 把 `toModelTools()` 的返回值原样塞进请求体（packages/tools/src/registry.ts:98
 *      带出的 `side_effect` 字段也一起上了 wire，见 providers/anthropic-compatible.ts 的
 *      `body.tools = params.tools`），loop2 的 `makePiTool`（loop2/config-builder.ts:407）只投影
 *      name/description/parameters，因此把它丢掉。这是**现状**不是理想态：`side_effect` 是
 *      WorkHub 私有字段，对模型无意义，legacy 路径把它发给 provider 属于多余负载。这里不顺手改
 *      产线（改 wire body 不在这道门的范围内），而是把它记成一条具名差异——将来两套之间**新增**
 *      任何差异、或这条差异消失（比如有人清理了 registry 的投影），这个断言都会红，逼人显式处置。
 *   3. `loopCoreDiffs(legacy, loop2)` 为空（复用 loop2/config-builder.ts 里既有的 loop-core 投影，
 *      与 shadow-assert 生产路径同一把尺子）；允许清单本身（wall clock / timestamps / L3 detail，
 *      见 config-builder.ts 顶部注释与 loop2/equivalence.test.ts）在这里被隔离掉：
 *      requireDeliverable/reviewDeliverable 关掉 L3，而 system / tools 里不含任何时钟或时间戳字段。
 *
 * 全程无真 key：client 是内存脚本桩，第一次调用就返回一条 end_turn 文本。
 */
import assert from "node:assert/strict";
import test from "node:test";

import { assertGolden, expectedDirFrom, toGoldenJson } from "@workhub/agent/golden";
import { createAgentLoop, type AgentLoopInput, type AgentLoopResult } from "@workhub/agent/loop";
import { loopCoreDiffs, runAgentLoop2 } from "@workhub/agent/loop2";
import type { LlmCreateParams, LlmCreateResponse } from "@workhub/agent/providers";
import { createBuiltInFileTools, createSkillTool, createToolRegistry } from "@workhub/tools";

import { defaultInitialUserMessage, defaultWorkerSystemPrompt } from "../workers/agent-run-prompt.js";
import { canUseToolForTaskPlanRole } from "../workers/agent-runner.js";

const EXPECTED_DIR = expectedDirFrom(import.meta.url, "..", "..");

const RUN = { title: "整理 Q3 交付质量复盘", work_item_id: "wi-golden-0001" };

/** 与生产同构的默认工具集（内置文件工具 + load_skill，按任务计划角色过滤）。 */
function defaultRegistry() {
  return createToolRegistry([...createBuiltInFileTools(), createSkillTool()], {
    canUse: (spec) => canUseToolForTaskPlanRole(undefined, spec)
  });
}

const FINAL_RESPONSE: LlmCreateResponse = {
  id: "resp-golden-0001",
  content: [{ type: "text", text: "完成了：Q3 复盘初稿 / 产出文件：outputs/q3-review.md / 未尽：等法务反馈" }],
  usage: { inputTokens: 120, outputTokens: 48 },
  usageRecord: {
    provider: "deepseek",
    model: "deepseek-golden",
    task: "worker",
    inputTokens: 120,
    outputTokens: 48,
    estimatedCostCny: "0.0100",
    source: "agent_step",
    createdAt: "2026-09-05T00:00:00.000Z"
  },
  stopReason: "end_turn"
};

/** 截下每一次 provider 请求的 system / tools，其余（messages/时钟/预算）不入 golden。 */
type CapturedRequest = { system: string | undefined; tools: unknown[] | undefined };

function makeInput(): { input: AgentLoopInput; captured: CapturedRequest[] } {
  const captured: CapturedRequest[] = [];
  const registry = defaultRegistry();
  const input: AgentLoopInput = {
    runId: "run-golden-0001",
    workItemId: "wi-golden-0001",
    actorId: "user-golden-0001",
    workdir: "/workhub/runs/run-golden-0001",
    systemPrompt: defaultWorkerSystemPrompt(registry.promptReference()),
    initialUserMessage: defaultInitialUserMessage(RUN),
    client: {
      model: "deepseek-golden",
      provider: "deepseek",
      messages: {
        create: async (params: LlmCreateParams) => {
          captured.push({ system: params.system, tools: params.tools });
          return FINAL_RESPONSE;
        }
      }
    },
    tools: {
      toModelTools: (ctx) => registry.toModelTools(ctx),
      execute: (toolId, toolInput, ctx) => registry.execute(toolId, toolInput, ctx)
    },
    budget: {
      maxSteps: 15,
      totalTimeoutSeconds: 300,
      maxTokens: 1_000_000,
      maxCostCny: "0",
      contextWindowTokens: 100_000
    },
    maxTokensPerStep: 4096,
    // 隔离 L3（manifest / 评审 / 交付物门）：这份 golden 只关心模型可见的请求，
    // L3 detail 正是 shadow-assert 允许清单里那一档差异。
    requireDeliverable: false,
    reviewDeliverable: false
  };
  return { input, captured };
}

async function runEngine(
  engine: (input: AgentLoopInput) => Promise<AgentLoopResult>
): Promise<{ result: AgentLoopResult; captured: CapturedRequest[] }> {
  const { input, captured } = makeInput();
  const result = await engine(input);
  return { result, captured };
}

/**
 * 两套引擎之间**唯一**被审查过、允许存在的结构差异：每个工具对象上的 `side_effect` 键
 * 只出现在传统 loop 发出的请求里。见文件头注释第 2 条。任何其它差异都视为回归。
 */
const KNOWN_ENGINE_DELTA = { legacyOnlyToolKeys: ["side_effect"], loop2OnlyToolKeys: [] as string[] };

/** 收集某一侧工具对象上出现过的全部键名（并集，排序后好比对）。 */
function toolKeyUnion(tools: unknown[] | undefined): string[] {
  const keys = new Set<string>();
  for (const tool of tools ?? []) {
    for (const key of Object.keys(tool as Record<string, unknown>)) {
      keys.add(key);
    }
  }
  return [...keys].sort();
}

/** 只保留真正喂进模型的三件套，丢掉引擎各自附带的私有字段。 */
function modelFacingTools(tools: unknown[] | undefined): unknown[] {
  return (tools ?? []).map((tool) => {
    const { name, description, input_schema } = tool as Record<string, unknown>;
    return { name, description, input_schema };
  });
}

test("golden：两套引擎发给模型的 system + 工具 schema（各一份，差异只在具名允许清单内）", async () => {
  const legacy = await runEngine((input) => createAgentLoop().run(input));
  const loop2 = await runEngine((input) => runAgentLoop2(input));

  assert.equal(legacy.captured.length, 1, "传统 loop 应只发一次模型请求（脚本客户端一次即 end_turn）");
  assert.equal(loop2.captured.length, 1, "loop2 应只发一次模型请求");

  const legacyRequest = legacy.captured[0]!;
  const loop2Request = loop2.captured[0]!;

  assertGolden({
    dir: EXPECTED_DIR,
    name: "agent-run-request.loop.expected.json",
    actual: toGoldenJson(legacyRequest)
  });
  assertGolden({
    dir: EXPECTED_DIR,
    name: "agent-run-request.loop2.expected.json",
    actual: toGoldenJson(loop2Request)
  });

  // 1) 系统提示词：模型可见文本，不允许有任何引擎差异。
  assert.equal(
    loop2Request.system,
    legacyRequest.system,
    "loop 与 loop2 发给模型的 system 出现差异（系统提示词不允许有引擎差异）"
  );

  // 2) 工具的 name/description/input_schema：同样是模型可见文本，逐字节相同。
  assert.equal(
    toGoldenJson(modelFacingTools(loop2Request.tools)),
    toGoldenJson(modelFacingTools(legacyRequest.tools)),
    "loop 与 loop2 发给模型的工具 name/description/input_schema 出现差异（工具 schema 不允许有引擎差异）"
  );

  // 3) 两套之间剩下的结构差异，必须恰好等于具名允许清单——多一条少一条都红。
  const legacyKeys = toolKeyUnion(legacyRequest.tools);
  const loop2Keys = toolKeyUnion(loop2Request.tools);
  assert.deepEqual(
    {
      legacyOnlyToolKeys: legacyKeys.filter((key) => !loop2Keys.includes(key)),
      loop2OnlyToolKeys: loop2Keys.filter((key) => !legacyKeys.includes(key))
    },
    KNOWN_ENGINE_DELTA,
    "两套引擎的工具对象字段差异不再等于 KNOWN_ENGINE_DELTA。要么是新增了一条未审查的引擎差异，要么是既有差异被改掉了——两种都要在 PR 里显式说明，再更新这份清单。"
  );
});

test("两套引擎的 loop-core 投影无差异（复用生产 shadow-assert 的同一把尺子）", async () => {
  const legacy = await runEngine((input) => createAgentLoop().run(input));
  const loop2 = await runEngine((input) => runAgentLoop2(input));
  assert.deepEqual(
    loopCoreDiffs(legacy.result, loop2.result),
    [],
    "loop-core 投影出现差异——允许清单只含 wall clock / timestamps / L3 detail，这三项都不在投影里"
  );
});
