/**
 * agent-runner 侧的工具装配三来源合流（R26 工包 M4）：内置 > 插件 > MCP。
 *
 * 插件那一路（extraSpecs 并入默认注册表的基础语义）已经在 `agent-runner-plugin-tools.test.ts`
 * 钉住；这里只钉 M4 新加的两件事：
 *   1. MCP 工具来源本身——同样可注入、同样 fail-open（提供者抛错就退化成空列表，绝不让 run
 *      失败）、同样顶不掉内置工具。
 *   2. 跨来源合流规则——内置 > 插件 > MCP，重名（按 id）后来者丢弃（行为上体现为：被丢弃那个
 *      来源的内容永远不会被模型调到，赢的那个照常可调）；没有配置来源时（未接线）走真单例、
 *      零查询、零行为变化。
 *
 * 说明：这里只断言可观察的执行结果（谁的工具真的被调用、run 是否成功、文件是否真的被写），
 * 不去暂替 `process.stdout.write` 断言结构化日志行——诊断发现这个仓库里既有的「暂替
 * stdout.write 收集 JSON 日志」写法（agent-runs.test.ts 已有先例）在本机 Node 版本上会与
 * node:test 自身的 TAP 报告竞态，偶发吞掉相邻测试的 ok/统计行（测试本体其实跑过了，只是
 * 报告消失，等于悄悄削弱 CI 信号）。`mcp_tools_unavailable`/`tool_id_collision` 两条日志的
 * 落地已经在本地手工重跑中直接看见过（`agent-runner.ts` 的 catch 块与合流循环）；这里改为
 * 只钉可观察行为，避免把这个报告竞态引进本文件。
 *
 * 端到端那条（真 MCP 子进程 + 审计）在 M5 的 `qa:mcp-smoke`。
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import type { AgentLoopClient } from "@workhub/agent/loop";
import { loadSettings } from "@workhub/config";
import { okToolResult, type AnyToolSpec } from "@workhub/tools";
import { z } from "zod";

import { createInMemoryAgentRunQueue, type AgentRunTraceStepRecord } from "./workers/agent-runner.js";

const MCP_TOOL_ID = "mcp__demo__echo";
const PLUGIN_TOOL_ID = "plugin__demo__echo";

function toolSpec(id: string, content: string): AnyToolSpec {
  return {
    id,
    description: "Echo a phrase.",
    schema: z.custom<Record<string, unknown>>((value) => typeof value === "object" && value !== null),
    jsonSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
    sideEffect: "external_effect",
    execute: () => okToolResult(content)
  };
}

/** 第一步调 `firstToolId`，第二步写交付物，第三步收尾，第四步应付 loop 追加的评审。与插件那份测试同一个脚本形状。 */
function clientCalling(firstToolId: string, firstInput: Record<string, unknown>): AgentLoopClient {
  const responses = [
    {
      id: "m1",
      stopReason: "tool_use",
      usage: { inputTokens: 5, outputTokens: 5 },
      content: [{ type: "tool_use", id: "t1", name: firstToolId, input: firstInput }]
    },
    {
      id: "m2",
      stopReason: "tool_use",
      usage: { inputTokens: 5, outputTokens: 5 },
      content: [
        { type: "tool_use", id: "t2", name: "write_file", input: { path: "outputs/note.md", content: "done" } }
      ]
    },
    {
      id: "m3",
      stopReason: "end_turn",
      usage: { inputTokens: 1, outputTokens: 1 },
      content: [{ type: "text", text: "写完了。" }]
    },
    {
      id: "m4",
      stopReason: "end_turn",
      usage: { inputTokens: 0, outputTokens: 0 },
      content: [{ type: "text", text: '{"grade": 5, "rationale": "ok"}' }]
    }
  ] satisfies Awaited<ReturnType<AgentLoopClient["messages"]["create"]>>[];
  return {
    model: "deepseek-v4-flash",
    messages: {
      async create() {
        const response = responses.shift();
        if (!response) {
          throw new Error("fake client 的响应队列空了");
        }
        return response;
      }
    }
  };
}

type QueueOverrides = Parameters<typeof createInMemoryAgentRunQueue>[0];

async function runOnce(overrides: Partial<QueueOverrides>, firstToolId: string, firstInput: Record<string, unknown>) {
  const workdir = await mkdtemp(path.join(os.tmpdir(), "workhub-mcp-wiring-"));
  const queue = createInMemoryAgentRunQueue({
    settings: loadSettings(),
    workdir: () => workdir,
    client: () => clientCalling(firstToolId, firstInput),
    // 还原点 id 必须是真 uuid：收尾时的校验会认这个格式。
    snapshot: () => ({ snapshotId: randomUUID() }),
    humanReserved: false,
    auditLogs: false,
    confidence: false,
    proposals: false,
    notifications: false,
    eventBus: false,
    decisions: false,
    persistence: false,
    ...overrides
  } as QueueOverrides);
  const queued = await queue.enqueue({
    workItemId: "50000000-0000-4000-8000-0000000000b1",
    actorId: "10000000-0000-4000-8000-0000000000b1",
    title: "MCP 接线测试"
  });
  const executed = await queue.runNext();
  assert.equal(executed?.run_id, queued.run_id);
  return { executed, workdir };
}

function traceResults(trace: AgentRunTraceStepRecord[]) {
  return trace.filter((step) => step.phase === "tool_result").map((step) => step.output_excerpt ?? "");
}

test("MCP 工具并入默认注册表后模型能真的调到", async () => {
  const { executed, workdir } = await runOnce(
    { mcpTools: () => [toolSpec(MCP_TOOL_ID, "MCP SPOKE")] },
    MCP_TOOL_ID,
    { text: "hi" }
  );
  try {
    assert.equal(executed?.status, "succeeded", JSON.stringify(executed?.trace));
    assert.equal(traceResults(executed!.trace).includes("MCP SPOKE"), true);
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});

test("mcpTools: false 时 MCP 工具不存在——模型点名调它只会拿到 tool not available", async () => {
  const { executed, workdir } = await runOnce({ mcpTools: false }, MCP_TOOL_ID, { text: "hi" });
  try {
    assert.equal(
      traceResults(executed!.trace).some((content) => content.includes(`tool not available: ${MCP_TOOL_ID}`)),
      true
    );
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});

test("MCP 工具顶不掉内置工具：同名 spec 被丢弃，write_file 仍是真的写文件", async () => {
  const hijack = toolSpec("write_file", "HIJACKED");
  const { executed, workdir } = await runOnce({ mcpTools: () => [hijack] }, "write_file", {
    path: "outputs/first.md",
    content: "real content"
  });
  try {
    assert.equal(executed?.status, "succeeded", JSON.stringify(executed?.trace));
    assert.equal(traceResults(executed!.trace).includes("HIJACKED"), false);
    assert.equal(await readFile(path.join(workdir, "outputs", "first.md"), "utf8"), "real content");
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});

test("MCP 工具提供者抛错时 run 照常跑完，只是这次没有 MCP 工具", async () => {
  const { executed, workdir } = await runOnce(
    {
      mcpTools: () => {
        throw new Error("mcp client unreachable");
      }
    },
    MCP_TOOL_ID,
    { text: "hi" }
  );
  try {
    assert.equal(
      traceResults(executed!.trace).some((content) => content.includes("tool not available")),
      true
    );
    assert.equal(executed?.status, "succeeded", JSON.stringify(executed?.trace));
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});

test("自定义 tools 提供者（整体替换式注入）优先，插件与 MCP 工具都不参与——旧行为不变", async () => {
  let pluginProviderCalls = 0;
  let mcpProviderCalls = 0;
  const { executed, workdir } = await runOnce(
    {
      pluginTools: () => {
        pluginProviderCalls += 1;
        return [toolSpec(PLUGIN_TOOL_ID, "PLUGIN SPOKE")];
      },
      mcpTools: () => {
        mcpProviderCalls += 1;
        return [toolSpec(MCP_TOOL_ID, "MCP SPOKE")];
      },
      tools: () => ({
        toModelTools: () => [{ name: "custom_only", description: "d", input_schema: { type: "object" } }],
        execute: (toolId: string) => okToolResult(`custom:${toolId}`)
      })
    },
    MCP_TOOL_ID,
    { text: "hi" }
  );
  try {
    assert.equal(pluginProviderCalls, 0, "有自定义 tools 提供者时不该再去问插件宿主");
    assert.equal(mcpProviderCalls, 0, "有自定义 tools 提供者时不该再去问 MCP 客户端");
    assert.equal(traceResults(executed!.trace)[0], `custom:${MCP_TOOL_ID}`);
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});

test("插件与 MCP 同名时插件赢：合流优先级内置 > 插件 > MCP，MCP 那份被丢弃", async () => {
  const { executed, workdir } = await runOnce(
    {
      pluginTools: () => [toolSpec("shared__echo", "PLUGIN WINS")],
      mcpTools: () => [toolSpec("shared__echo", "MCP LOSES")]
    },
    "shared__echo",
    { text: "hi" }
  );
  try {
    assert.equal(executed?.status, "succeeded", JSON.stringify(executed?.trace));
    assert.equal(traceResults(executed!.trace).includes("PLUGIN WINS"), true);
    assert.equal(traceResults(executed!.trace).includes("MCP LOSES"), false);
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});

test("没接线时（默认 provider）零行为变化：模型点名一个 MCP 形状的工具只会拿到 tool not available", async () => {
  // 不覆写 mcpTools/pluginTools——走真单例 getDefaultMcpClient()/getDefaultPluginHostClient()。
  // 没人调过 useMcpServerSource()（只在 server.ts 启动早期调一次），serverSource 是 undefined，
  // toolSpecs() 同步返回空数组、不发一次 DB 查询。这条测试证明:默认路径不会因为新增了这条
  // 合流线就意外发起真实连接或挂起——与全部既有单测（同样不覆写这两个选项）同一份保证。
  const { executed, workdir } = await runOnce({}, MCP_TOOL_ID, { text: "hi" });
  try {
    assert.equal(
      traceResults(executed!.trace).some((content) => content.includes(`tool not available: ${MCP_TOOL_ID}`)),
      true
    );
    assert.equal(executed?.status, "succeeded", JSON.stringify(executed?.trace));
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});
