/**
 * `pnpm qa:plugin-smoke` —— R24-P 阶段 0 的验收门。
 *
 * 证明的这一条链路：**装一个 DeepSeek Harness 工具型插件 → Cuu 在一次 agent run 里真的调用到它
 * → 结果进这次执行的轨迹 → 调用落 audit_logs**。全程假 provider（不需要任何 LLM key）、
 * 内存仓库（不需要 PG），所以能当常规门跑。
 *
 * 插件用的是 `packages/plugin-host/qa/fixtures/dsh-plugin-echo`——我们自己写的夹具，但它
 * **不是**手写的假工具：形状照真实已发布 bundle（`dsh-plugin-finance-data@0.2.0`）逐项对齐
 * （`dsh.bundle.patch` + `cordis.patch.yml` + schemastery `Config` + `inject` + 具名 `apply`），
 * 并且真的调用 `@deepseek-ai/dsh-tools` 的 `defineTool` 与 `@deepseek-ai/cordis` 的 Context。
 * 走这条而不是把第三方 npm 包焊进构建：门要能离线跑、要可复现，且公开仓不该把某个陌生人的
 * 包变成构建期依赖。真实 npm 插件的加载验证见 Agent Note 的 Consequences 一节。
 *
 * 断言清单（任一条不成立即非零退出）：
 *  1. 插件加载成功，贡献出恰好一个工具，工具 id 在 `plugin__` 名字空间里；
 *  2. 该工具的模型可见 schema 走的是 JSON Schema 旁路（能看到 `text` 参数），不是 Zod 退化出的空 object；
 *  3. 该工具按 `external_effect` 对待——所以进了副作用快照门，也进了 high-risk 分类；
 *  4. 一次 agent run 里模型发出的这次调用真的执行了，回来的内容是插件算出来的；
 *  5. 轨迹里既有这次工具调用，也有它的结果；
 *  6. `audit_logs` 里有一条 `plugin.tool.called`，带插件名/工具名/耗时/结果摘要。
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { AgentLoopClient } from "@workhub/agent/loop";
import { loadSettings } from "@workhub/config";
import type { AuditLogRepository, AuditLogRow, CreateAuditLogInput } from "@workhub/db";

import { createPluginHostClient } from "../services/plugin-host-client.js";
import { createInMemoryAgentRunQueue, type AgentRunTraceStepRecord } from "../workers/agent-runner.js";

const ECHO_PLUGIN_ID = "dsh-plugin-echo";
const ECHO_TOOL_ID = "plugin__dsh-plugin-echo__echo";
const ECHO_PHRASE = "plugin bridge alive";

function repoRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
}

/** 内存审计仓库——门不碰 PG。读侧本门用不到，给最小实现补齐接口。 */
function memoryAuditLogs(): AuditLogRepository & { rows: CreateAuditLogInput[] } {
  const rows: CreateAuditLogInput[] = [];
  return {
    rows,
    async createAuditLog(input: CreateAuditLogInput) {
      rows.push(input);
      return { id: input.id ?? randomUUID(), ...input } as unknown as AuditLogRow;
    },
    async listAuditLogsForEntity() {
      return [];
    },
    async listAuditLogsForWorkItem() {
      return [];
    },
    async markAuditLogUndone() {
      return null;
    }
  };
}

/**
 * 假 provider：第一步让模型「决定」调用插件工具，第二步写交付物，第三步收尾，第四步应付
 * loop 默认追加的一次评审。与 `apps/api/src/agent-runs.test.ts` 的 fake client 同款排队式实现。
 */
function pluginCallingAgentClient(): AgentLoopClient {
  const responses = [
    {
      id: "msg-plugin-1",
      stopReason: "tool_use",
      usage: { inputTokens: 12, outputTokens: 20 },
      content: [
        {
          type: "tool_use",
          id: "tool-plugin-1",
          name: ECHO_TOOL_ID,
          input: { text: ECHO_PHRASE, times: 2, upper: true }
        }
      ]
    },
    {
      id: "msg-plugin-2",
      stopReason: "tool_use",
      usage: { inputTokens: 10, outputTokens: 18 },
      content: [
        {
          type: "tool_use",
          id: "tool-plugin-2",
          name: "write_file",
          input: {
            path: "outputs/plugin-smoke.md",
            content: `# Plugin smoke\n\nThe ${ECHO_PLUGIN_ID} plugin answered during this run.\n`
          }
        }
      ]
    },
    {
      id: "msg-plugin-3",
      stopReason: "end_turn",
      usage: { inputTokens: 6, outputTokens: 6 },
      content: [{ type: "text", text: "已经用插件工具核对过，交付物写好了。" }]
    },
    {
      id: "msg-plugin-review",
      stopReason: "end_turn",
      usage: { inputTokens: 0, outputTokens: 0 },
      content: [{ type: "text", text: '{"grade": 5, "rationale": "可直接采纳"}' }]
    }
  ] satisfies Awaited<ReturnType<AgentLoopClient["messages"]["create"]>>[];

  return {
    model: "deepseek-v4-flash",
    messages: {
      async create() {
        const response = responses.shift();
        if (!response) {
          throw new Error("plugin-smoke: 假 provider 的响应队列空了");
        }
        return response;
      }
    }
  };
}

function line(label: string, value: unknown) {
  console.log(`  ${label.padEnd(34, " ")} ${typeof value === "string" ? value : JSON.stringify(value)}`);
}

async function main() {
  const settings = loadSettings();
  const fixturePath = path.join(repoRoot(), "packages", "plugin-host", "qa", "fixtures", ECHO_PLUGIN_ID);
  const workdir = await mkdtemp(path.join(os.tmpdir(), "workhub-plugin-smoke-"));
  const audit = memoryAuditLogs();
  const snapshotGateCalls: { toolId: string; sideEffect: string }[] = [];
  const highRiskChecks: { toolId: string; riskCategory?: string }[] = [];

  console.log("WorkHub plugin smoke —— DeepSeek Harness 工具型插件端到端");
  console.log("");
  console.log("[1/4] 起插件宿主子进程并拉工具清单");
  const host = createPluginHostClient({
    pluginPaths: [fixturePath],
    auditLogs: audit,
    handshakeTimeoutMs: 30_000
  });

  try {
    const reports = await host.loadReports();
    line("插件路径", fixturePath);
    line("加载报告", reports);
    const echoReport = reports.find((report) => report.pluginId === ECHO_PLUGIN_ID);
    assert.ok(echoReport, "插件宿主没有报告 dsh-plugin-echo 的加载结果");
    assert.equal(echoReport.ok, true, `插件加载失败：${echoReport.error ?? "未知原因"}`);
    assert.equal(echoReport.toolCount, 1, "插件应当贡献恰好一个工具");
    assert.equal(echoReport.promptSectionCount, 1, "插件应当贡献一个系统提示词段（阶段 0 只收集不使用）");

    const specs = await host.toolSpecs({ workspaceId: settings.auth.defaultWorkspaceId });
    assert.equal(specs.length, 1, "插件工具规格数量不对");
    const spec = specs[0]!;
    line("工具 id", spec.id);
    line("副作用分级", spec.sideEffect);
    line("能力键 minScope", spec.minScope ?? "(none)");
    assert.equal(spec.id, ECHO_TOOL_ID);
    assert.equal(spec.sideEffect, "external_effect", "阶段 0 插件工具必须按最高风险对待");
    assert.equal(spec.minScope, `plugin:${ECHO_PLUGIN_ID}:external_effect`);

    // 断言 2：模型看到的是插件自带的 JSON Schema（旁路生效），不是 Zod 退化出的空 object。
    const modelSchema = spec.jsonSchema as { properties?: Record<string, unknown>; required?: string[] } | undefined;
    line("模型可见 schema 参数", Object.keys(modelSchema?.properties ?? {}));
    assert.ok(modelSchema?.properties?.["text"], "JSON Schema 旁路没生效：模型看不到 text 参数");
    assert.deepEqual(modelSchema?.required, ["text"]);

    console.log("");
    console.log("[2/4] 跑一次 agent run（假 provider，无 LLM key、无 PG）");
    const queue = createInMemoryAgentRunQueue({
      settings,
      workdir: () => workdir,
      client: () => pluginCallingAgentClient(),
      // 插件工具由宿主客户端提供；不接 tools 提供者，走的就是产线那条「并入默认注册表」的路。
      pluginTools: () => specs,
      // 副作用快照门：记录它确实为插件工具开了一次还原点。
      snapshot: (input) => {
        snapshotGateCalls.push({ toolId: input.toolId, sideEffect: input.sideEffect });
        return { snapshotId: randomUUID() };
      },
      // 高风险拦截门：如实记录被问到了，本次放行（真实部署里由工作项的人类保留设置决定）。
      humanReserved: async (input) => {
        highRiskChecks.push({
          toolId: input.toolCall?.toolId ?? "(none)",
          ...(input.toolCall?.riskCategory ? { riskCategory: input.toolCall.riskCategory } : {})
        });
        return null;
      },
      auditLogs: audit,
      confidence: false,
      proposals: false,
      notifications: false,
      eventBus: false,
      decisions: false,
      persistence: false
    });

    const queued = await queue.enqueue({
      workItemId: randomUUID(),
      actorId: randomUUID(),
      title: "插件冒烟：让 Cuu 调用一次第三方插件工具"
    });
    const executed = await queue.runNext();
    assert.ok(executed, "没有 run 被执行");
    line("run 状态", executed.status);
    assert.equal(executed.run_id, queued.run_id);
    assert.equal(executed.status, "succeeded", `run 没成功：${JSON.stringify(executed.trace)}`);

    console.log("");
    console.log("[3/4] 核对执行轨迹");
    const trace: AgentRunTraceStepRecord[] = executed.trace;
    const call = trace.find((step) => step.phase === "tool_call" && step.output_excerpt?.startsWith(ECHO_TOOL_ID));
    const expectedEcho = `${ECHO_PHRASE.toUpperCase()} ${ECHO_PHRASE.toUpperCase()}`;
    const result = trace.find((step) => step.phase === "tool_result" && step.output_excerpt === expectedEcho);
    line("轨迹里的工具调用", call?.output_excerpt ?? "(缺)");
    line("轨迹里的工具结果", result?.output_excerpt ?? "(缺)");
    assert.ok(call, "轨迹里没有这次插件工具调用");
    assert.ok(result, `轨迹里没有插件算出来的结果，期望 ${JSON.stringify(expectedEcho)}`);
    assert.ok(call.snapshot_id, "插件工具调用没有带上还原点 id");

    line("快照门被触发", snapshotGateCalls);
    assert.ok(
      snapshotGateCalls.some((entry) => entry.toolId === ECHO_TOOL_ID && entry.sideEffect === "external_effect"),
      "副作用快照门没有为插件工具开还原点"
    );
    line("高风险门被询问", highRiskChecks);
    assert.ok(
      highRiskChecks.some((entry) => entry.toolId === ECHO_TOOL_ID && entry.riskCategory === "external"),
      "插件工具没有进 high-risk 分类"
    );

    console.log("");
    console.log("[4/4] 核对审计");
    const pluginAudits = audit.rows.filter((row) => row.action === "plugin.tool.called");
    line("plugin.tool.called 条数", pluginAudits.length);
    assert.equal(pluginAudits.length, 1, "审计里应当恰好一条插件调用记录");
    const auditRow = pluginAudits[0]!;
    const detail = (auditRow.detailJson ?? {}) as Record<string, unknown>;
    line("审计 entityType/entityId", `${auditRow.entityType} / ${auditRow.entityId}`);
    line("审计 detail", detail);
    assert.equal(auditRow.entityType, "plugin_invocation");
    assert.equal(auditRow.entityId, `${ECHO_PLUGIN_ID}:echo`);
    assert.equal(auditRow.actorKind, "ai");
    assert.equal(detail["plugin_id"], ECHO_PLUGIN_ID);
    assert.equal(detail["tool_name"], "echo");
    assert.equal(detail["tool_id"], ECHO_TOOL_ID);
    assert.equal(detail["ok"], true);
    assert.equal(typeof detail["duration_ms"], "number");
    assert.equal(detail["result_summary"], expectedEcho);
    assert.equal(detail["agent_run_id"], executed.run_id);

    console.log("");
    console.log("plugin smoke 通过：插件工具被 Cuu 调用到，结果进了轨迹，调用落了审计。");
  } finally {
    await host.close();
    await rm(workdir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error("");
  console.error("plugin smoke 失败：");
  console.error(error);
  process.exit(1);
});
