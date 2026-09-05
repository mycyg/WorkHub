/**
 * `pnpm qa:plugin-smoke` —— 插件面的端到端验收门。
 *
 * 证明的这一条链路：**装一个 DeepSeek Harness 工具型插件 → Cuu 在一次 agent run 里真的调用到它
 * → 结果进这次执行的轨迹 → 调用落 audit_logs**。全程假 provider（不需要任何 LLM key）、
 * 内存仓库（不需要 PG），所以能当常规门跑。
 *
 * 插件用的是 `packages/plugin-host/qa/fixtures/dsh-plugin-echo`——我们自己写的夹具，但它
 * **不是**手写的假工具：形状照真实已发布 bundle（`dsh-plugin-finance-data@0.2.0`）逐项对齐
 * （`dsh.bundle.patch` + `cordis.patch.yml` + schemastery `Config` + `inject` + 具名 `apply`），
 * 并且真的调用 `@deepseek-ai/dsh-tools` 的 `defineTool` 与 `@deepseek-ai/cordis` 的 Context。
 * 它注册两个工具，各占一档风险：`echo` 在 `defineTool` 之后补了 `readOnlyHint`（自述只读），
 * `write_note` 没有。
 *
 * **人工保留门是真的那一份**（`createHumanReservedGuard`，只把它的四个仓储换成内存实现）。
 * 上一版这里注入了一个恒返回 null 的假守卫，于是「插件工具会不会每次都转人」这个问题
 * 恰恰被这道门绕过去了；R25 M-MCP 设计 2.3 把它记成硬事实。现在两条路都真跑：
 *
 * 断言清单（任一条不成立即非零退出）：
 *  1. 插件加载成功，贡献恰好两个工具，工具 id 都在 `plugin__` 名字空间里；
 *  2. 分级真值：管理员断言 read_only 时，自述只读的 `echo` → `none` / `plugin:<id>:read`，
 *     没有自述的 `write_note` 仍是 `external_effect`；把断言收回最高档时 `echo` 也回到最高档
 *     （自述只能降不能抬）；
 *  3. 模型可见 schema 走 JSON Schema 旁路（能看到 `text` 参数），不是 Zod 退化出的空 object；
 *  4. **read_only 档的调用不转人**：run 成功、没有开任何升级事件、也没有为它开还原点；
 *  5. **external_effect 档仍然转人**：同一个插件、同一条断言下调用 `write_note` 开一条
 *     `user_forbidden` 升级并以 409 `human_reserved_tool_call` 中断这次执行；
 *  6. `audit_logs` 里两次调用各一条 `plugin.tool.called`，capability 与当时生效的分级同源。
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { AgentLoopClient } from "@workhub/agent/loop";
import { loadSettings } from "@workhub/config";
import type {
  AiDecisionRepository,
  AuditLogRepository,
  AuditLogRow,
  CreateAuditLogInput,
  CreateEscalationEventInput,
  EscalationEventRow,
  WorkItemHumanReservedRow,
  WorkItemRepository
} from "@workhub/db";
import type { AnyToolSpec } from "@workhub/tools";

import { createHumanReservedGuard } from "../services/human-reserved-guard.js";
import { createPluginHostClient } from "../services/plugin-host-client.js";
import { createInMemoryAgentRunQueue, type AgentRunTraceStepRecord } from "../workers/agent-runner.js";

const ECHO_PLUGIN_ID = "dsh-plugin-echo";
const ECHO_TOOL_ID = "plugin__dsh-plugin-echo__echo";
const NOTE_TOOL_ID = "plugin__dsh-plugin-echo__write_note";
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
 * 只实现守卫真正会调到的那几个方法，其余属性一律抛错。
 *
 * 用 Proxy 而不是「把没实现的方法写成 return null」：守卫哪天多调一个方法，这道门会**当场炸**
 * 并指名道姓说是哪个，而不是安静地拿到一个假的空结果继续跑绿——那正是上一版假守卫的失败模式。
 */
function strictStub<T extends object>(label: string, impl: Partial<T>): T {
  return new Proxy(impl, {
    get(target, property, receiver) {
      if (property in target || typeof property === "symbol") {
        return Reflect.get(target, property, receiver);
      }
      throw new Error(`plugin-smoke: ${label}.${String(property)} 没有内存实现——守卫的依赖面变了，先补上再说`);
    }
  }) as T;
}

type GuardStores = {
  workItems: WorkItemRepository;
  decisions: AiDecisionRepository;
  escalations: EscalationEventRow[];
  pmModeCalls: string[];
};

/** 一个被 AI 处理中的普通工作项：**没有**被标记人工保留——升级只可能来自工具风险分类本身。 */
function guardStores(workItemId: string, workspaceId: string, submitterUserId: string): GuardStores {
  const row: WorkItemHumanReservedRow = {
    id: workItemId,
    code: "WI-PLUGIN-1",
    title: "插件冒烟：让 Cuu 调用一次第三方插件工具",
    status: "ai_working",
    mode: "worker",
    humanReserved: false,
    submitterUserId,
    claimedByUserId: null,
    workspaceId
  };
  const escalations: EscalationEventRow[] = [];
  const pmModeCalls: string[] = [];
  const workItems = strictStub<WorkItemRepository>("workItems", {
    async findWorkItemForHumanReservedGuard(id: string) {
      return id === workItemId ? row : null;
    },
    async markHumanReservedPmMode(input: { workItemId: string; at: Date }) {
      pmModeCalls.push(input.workItemId);
      return row;
    }
  });
  const decisions = strictStub<AiDecisionRepository>("decisions", {
    async listEscalationEventsForWorkItem(id: string) {
      return escalations.filter((event) => event.workItemId === id);
    },
    async createEscalationEvent(input: CreateEscalationEventInput) {
      const event = {
        id: input.id ?? randomUUID(),
        workItemId: input.workItemId,
        agentRunId: input.agentRunId ?? null,
        confidenceId: input.confidenceId ?? null,
        trigger: input.trigger,
        reasonMd: input.reasonMd,
        handoffJson: input.handoffJson ?? {},
        suggestedLeadUserId: input.suggestedLeadUserId ?? null,
        resolvedAt: null,
        createdAt: new Date()
      } as unknown as EscalationEventRow;
      escalations.push(event);
      return event;
    }
  });
  return { workItems, decisions, escalations, pmModeCalls };
}

/**
 * 假 provider：第一步让模型「决定」调用给定的插件工具，第二步写交付物，第三步收尾，
 * 第四步应付 loop 默认追加的一次评审。与 `apps/api/src/agent-runs.test.ts` 的 fake client 同款。
 */
function pluginCallingAgentClient(toolId: string, input: Record<string, unknown>): AgentLoopClient {
  const responses = [
    {
      id: "msg-plugin-1",
      stopReason: "tool_use",
      usage: { inputTokens: 12, outputTokens: 20 },
      content: [{ type: "tool_use", id: "tool-plugin-1", name: toolId, input }]
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

function specById(specs: AnyToolSpec[], id: string): AnyToolSpec {
  const spec = specs.find((entry) => entry.id === id);
  assert.ok(spec, `工具规格里没有 ${id}`);
  return spec;
}

async function main() {
  const settings = loadSettings();
  const workspaceId = settings.auth.defaultWorkspaceId;
  const fixturePath = path.join(repoRoot(), "packages", "plugin-host", "qa", "fixtures", ECHO_PLUGIN_ID);
  const workdir = await mkdtemp(path.join(os.tmpdir(), "workhub-plugin-smoke-"));
  const audit = memoryAuditLogs();

  console.log("WorkHub plugin smoke —— DeepSeek Harness 工具型插件端到端");
  console.log("");
  console.log("[1/5] 起插件宿主子进程并拉工具清单（管理员把这个插件断言为只读）");
  // 清单来源给的是「路径 + 管理员断言」，与产线的 DB 清单来源同一个形状。
  const host = createPluginHostClient({
    pluginPathSource: () => [{ path: fixturePath, trustLevel: "read_only" }],
    auditLogs: audit,
    handshakeTimeoutMs: 30_000
  });
  // 同一个夹具，管理员没表过态的那一档——用来证明「自述只读也抬不动上限」。
  const untrustedHost = createPluginHostClient({
    pluginPaths: [fixturePath],
    auditLogs: false,
    handshakeTimeoutMs: 30_000
  });

  try {
    const reports = await host.loadReports(workspaceId);
    line("插件路径", fixturePath);
    line("加载报告", reports);
    const echoReport = reports.find((report) => report.pluginId === ECHO_PLUGIN_ID);
    assert.ok(echoReport, "插件宿主没有报告 dsh-plugin-echo 的加载结果");
    assert.equal(echoReport.ok, true, `插件加载失败：${echoReport.error ?? "未知原因"}`);
    assert.equal(echoReport.toolCount, 2, "插件应当贡献两个工具（各占一档风险）");
    assert.equal(echoReport.promptSectionCount, 1, "插件应当贡献一个系统提示词段（阶段 0 只收集不使用）");

    const specs = await host.toolSpecs({ workspaceId });
    assert.equal(specs.length, 2, "插件工具规格数量不对");
    const echoSpec = specById(specs, ECHO_TOOL_ID);
    const noteSpec = specById(specs, NOTE_TOOL_ID);

    console.log("");
    console.log("[2/5] 核对分级真值：管理员断言 AND 工具自述");
    line("echo 副作用/能力键", `${echoSpec.sideEffect} / ${echoSpec.minScope ?? "(none)"}`);
    line("write_note 副作用/能力键", `${noteSpec.sideEffect} / ${noteSpec.minScope ?? "(none)"}`);
    assert.equal(echoSpec.sideEffect, "none", "断言只读 + 自述只读的工具应当落到低风险档");
    assert.equal(echoSpec.minScope, `plugin:${ECHO_PLUGIN_ID}:read`);
    assert.equal(noteSpec.sideEffect, "external_effect", "没有只读自述的工具不该跟着降档");
    assert.equal(noteSpec.minScope, `plugin:${ECHO_PLUGIN_ID}:external_effect`);

    const untrustedSpecs = await untrustedHost.toolSpecs();
    const untrustedEcho = specById(untrustedSpecs, ECHO_TOOL_ID);
    line("没有断言时的 echo", `${untrustedEcho.sideEffect} / ${untrustedEcho.minScope ?? "(none)"}`);
    assert.equal(untrustedEcho.sideEffect, "external_effect", "自述只读不能抬过管理员断言的上限");

    // 模型看到的是插件自带的 JSON Schema（旁路生效），不是 Zod 退化出的空 object。
    const modelSchema = echoSpec.jsonSchema as { properties?: Record<string, unknown>; required?: string[] } | undefined;
    line("模型可见 schema 参数", Object.keys(modelSchema?.properties ?? {}));
    assert.ok(modelSchema?.properties?.["text"], "JSON Schema 旁路没生效：模型看不到 text 参数");
    assert.deepEqual(modelSchema?.required, ["text"]);

    console.log("");
    console.log("[3/5] 只读档：跑一次 agent run，人工保留门是真的那一份");
    const readOnlyWorkItemId = randomUUID();
    const readOnlyActorId = randomUUID();
    const readOnlyStores = guardStores(readOnlyWorkItemId, workspaceId, readOnlyActorId);
    const readOnlySnapshots: { toolId: string; sideEffect: string }[] = [];
    const readOnlyQueue = createInMemoryAgentRunQueue({
      settings,
      workdir: () => workdir,
      client: () => pluginCallingAgentClient(ECHO_TOOL_ID, { text: ECHO_PHRASE, times: 2, upper: true }),
      // 插件工具由宿主客户端提供；不接 tools 提供者，走的就是产线那条「并入默认注册表」的路。
      pluginTools: () => specs,
      snapshot: (input) => {
        readOnlySnapshots.push({ toolId: input.toolId, sideEffect: input.sideEffect });
        return { snapshotId: randomUUID() };
      },
      // **真的**人工保留门，只换掉它的四个仓储。
      humanReserved: createHumanReservedGuard({
        settings,
        workItems: readOnlyStores.workItems,
        decisions: readOnlyStores.decisions,
        auditLogs: audit
      }),
      auditLogs: audit,
      confidence: false,
      proposals: false,
      notifications: false,
      eventBus: false,
      decisions: false,
      persistence: false
    });

    const readOnlyQueued = await readOnlyQueue.enqueue({
      workItemId: readOnlyWorkItemId,
      actorId: readOnlyActorId,
      title: "插件冒烟：让 Cuu 调用一次只读插件工具"
    });
    const readOnlyRun = await readOnlyQueue.runNext();
    assert.ok(readOnlyRun, "没有 run 被执行");
    line("run 状态", readOnlyRun.status);
    assert.equal(readOnlyRun.run_id, readOnlyQueued.run_id);
    assert.equal(readOnlyRun.status, "succeeded", `run 没成功：${JSON.stringify(readOnlyRun.trace)}`);

    const trace: AgentRunTraceStepRecord[] = readOnlyRun.trace;
    const call = trace.find((step) => step.phase === "tool_call" && step.output_excerpt?.startsWith(ECHO_TOOL_ID));
    const expectedEcho = `${ECHO_PHRASE.toUpperCase()} ${ECHO_PHRASE.toUpperCase()}`;
    const result = trace.find((step) => step.phase === "tool_result" && step.output_excerpt === expectedEcho);
    line("轨迹里的工具调用", call?.output_excerpt ?? "(缺)");
    line("轨迹里的工具结果", result?.output_excerpt ?? "(缺)");
    assert.ok(call, "轨迹里没有这次插件工具调用");
    assert.ok(result, `轨迹里没有插件算出来的结果，期望 ${JSON.stringify(expectedEcho)}`);

    line("升级事件条数", readOnlyStores.escalations.length);
    line("被翻成 pm 模式的工作项", readOnlyStores.pmModeCalls);
    assert.equal(readOnlyStores.escalations.length, 0, "只读档的插件调用不该开升级事件");
    assert.deepEqual(readOnlyStores.pmModeCalls, [], "只读档的插件调用不该把工作项翻成 pm 模式");
    // 只读工具没有可还原的东西，快照门也就不该为它开还原点（`sideEffect: none` 的既有语义）。
    line("为插件工具开的还原点", readOnlySnapshots);
    assert.equal(
      readOnlySnapshots.some((entry) => entry.toolId === ECHO_TOOL_ID),
      false,
      "只读插件工具不该走副作用快照门"
    );
    assert.equal(call.snapshot_id ?? null, null, "只读插件工具的调用不该带还原点 id");

    console.log("");
    console.log("[4/5] 最高档：同一个插件里没有只读自述的那个工具仍然转人");
    const gatedWorkItemId = randomUUID();
    const gatedActorId = randomUUID();
    const gatedStores = guardStores(gatedWorkItemId, workspaceId, gatedActorId);
    const gatedQueue = createInMemoryAgentRunQueue({
      settings,
      workdir: () => workdir,
      client: () => pluginCallingAgentClient(NOTE_TOOL_ID, { title: "Plugin smoke", body: "gated" }),
      pluginTools: () => specs,
      snapshot: () => ({ snapshotId: randomUUID() }),
      humanReserved: createHumanReservedGuard({
        settings,
        workItems: gatedStores.workItems,
        decisions: gatedStores.decisions,
        auditLogs: audit
      }),
      auditLogs: audit,
      confidence: false,
      proposals: false,
      notifications: false,
      eventBus: false,
      decisions: false,
      persistence: false
    });
    await gatedQueue.enqueue({
      workItemId: gatedWorkItemId,
      actorId: gatedActorId,
      title: "插件冒烟：让 Cuu 调用一次外部影响档的插件工具"
    });
    const gatedRun = await gatedQueue.runNext();
    assert.ok(gatedRun, "没有 run 被执行");
    line("run 状态", gatedRun.status);
    line("收尾原因", gatedRun.trace.at(-1)?.output_excerpt ?? "(缺)");
    assert.equal(gatedRun.status, "failed", "高风险插件调用被拦下时这次执行应当中断");
    assert.equal(
      (gatedRun.trace.at(-1)?.output_excerpt ?? "").includes("高风险工具调用已停止"),
      true,
      "中断原因应当是人工保留门的 409"
    );

    line("升级事件", gatedStores.escalations.map((event) => ({ trigger: event.trigger, handoff: event.handoffJson })));
    assert.equal(gatedStores.escalations.length, 1, "应当恰好开一条升级事件");
    const escalation = gatedStores.escalations[0]!;
    assert.equal(escalation.trigger, "user_forbidden");
    const handoff = escalation.handoffJson as Record<string, unknown>;
    assert.equal(handoff["source"], "tool_call");
    assert.equal(handoff["risk_category"], "external");
    assert.equal(handoff["tool_id"], NOTE_TOOL_ID);
    assert.deepEqual(gatedStores.pmModeCalls, [], "工具风险类升级不重写工作项状态（只有首次人工预留才写）");

    console.log("");
    console.log("[5/5] 核对审计");
    const pluginAudits = audit.rows.filter((row) => row.action === "plugin.tool.called");
    line("plugin.tool.called 条数", pluginAudits.length);
    assert.equal(pluginAudits.length, 1, "只有真的执行到的那次调用才该落插件调用审计");
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
    assert.equal(detail["agent_run_id"], readOnlyRun.run_id);
    // capability 与这次调用真正生效的那一档同源，不是一个写死的字符串。
    assert.equal(detail["trust_level"], "read_only");
    assert.equal(detail["capability"], `plugin:${ECHO_PLUGIN_ID}:read`);
    // 被拦下的那次调用**没有**执行，所以也不该有它的插件调用审计——但升级本身落了一条审计。
    const escalationAudits = audit.rows.filter((row) => row.action === "escalation.opened");
    line("escalation.opened 条数", escalationAudits.length);
    assert.equal(escalationAudits.length, 1, "被拦下的高风险调用应当落一条升级审计");
    assert.equal(
      (escalationAudits[0]!.detailJson as Record<string, unknown>)["source"],
      "human_reserved_tool_call"
    );

    console.log("");
    console.log("plugin smoke 通过：只读档的插件调用直接跑通，外部影响档仍然停下来转人。");
  } finally {
    await host.close();
    await untrustedHost.close();
    await rm(workdir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error("");
  console.error("plugin smoke 失败：");
  console.error(error);
  process.exit(1);
});
