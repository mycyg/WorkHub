/**
 * `pnpm qa:mcp-smoke` —— MCP（Model Context Protocol，模型上下文协议）面的端到端验收门。
 *
 * 证明的这一条链路：**`mcp_servers` 里躺着一行配置 → 真的起一个子进程握上手 → 工具翻译成
 * ToolSpec 并进这次 agent run 的注册表 → Cuu 真的调用到它 → 结果（已中和围栏标签）进轨迹 →
 * 调用落 `audit_logs`**；再把管理员断言从 `read_only` 收回 `external_effect`，证明**同一次调用
 * 会停下来转人**。全程假 provider（不需要任何 LLM key）、内存仓储（不需要 PG），所以能当常规门跑。
 *
 * 对手是 `packages/mcp-client/qa/fixtures/mcp-echo-server/server.mjs`——一台真的 Node 子进程，
 * 说换行分隔的 JSON-RPC 2.0。**与设计稿 4.6 第 2 条的偏离要写在明处**：那一条要的是「用官方
 * SDK 起服务端」，这一批全程离线装不了 `@modelcontextprotocol/sdk`，所以夹具的线协议和被测客户端
 * 的线协议是同一批人写的——这台夹具**证不了我们对 MCP 规范的理解是对的**，它证的是「我们这一侧
 * 的两半在一个真进程边界上对得上」：真 spawn、真 stdout 分片、真握手时序、真翻页、真退出码。
 * 规范符合性要等换回官方 SDK 或接一台真实第三方服务器时才谈得上。
 *
 * **人工保留门是真的那一份**（`createHumanReservedGuard`，只把它的仓储换成内存实现），
 * 与 `plugin-smoke.ts` 同一条纪律：注入一个恒返回 null 的假守卫，恰好会把「MCP 工具会不会每次
 * 都转人」这个问题绕过去。
 *
 * 断言清单（任一条不成立即非零退出）：
 *  1. **产线接线自检**：`useMcpServerSource(仓储)` + `getDefaultMcpClient()`（M4 在 `server.ts`
 *     接的就是这两个）真的把夹具服务器连起来并翻出两个工具；连接结果按 `connected` 回写仓储；
 *  2. **翻译逐字对齐**：真服务器 `tools/list` 翻出来的描述符，与 M1 常量夹具
 *     （M6 golden 钉的那一份）经同一个翻译器算出来的逐字相同——两条证据链对得上；
 *  3. **分级真值**：管理员断言 `read_only` 时，自述只读的 `echo` → `none` / `mcp:echo:read`，
 *     没有自述的 `write_note` 仍是 `external_effect`；模型看到的是服务器自己的 JSON Schema；
 *  4. **只读档的调用不转人**：run 成功、工具调用与结果都在轨迹里、结果里的 `</outputs>` 已经被
 *     中和成 `‹/outputs›`、没有开任何升级事件、也没有为它开还原点；
 *  5. `audit_logs` 里恰好一条 `mcp.tool.called`，`capability` 与当时生效的那一档同源；
 *  6. **最高档仍然转人**：把那一行的 `trust_level` 改成 `external_effect` 再 `reload()`，
 *     同一个 `echo` 调用开一条 `user_forbidden` 升级并以 409 `human_reserved_tool_call` 中断这次
 *     执行，且**不再落新的调用审计**（它根本没执行）；
 *  7. 收尾之后没有残留的夹具子进程。
 *
 * ## 为什么两个客户端
 *
 * 第 1 步走的是产线单例（`getDefaultMcpClient()`），它没有审计 sink 的注入点——默认走
 * `getDefaultAuditStores()`，也就是共享 PG 连接池。要断言 `mcp.tool.called` 的具体字段就必须
 * 把审计接到内存里，所以第 3-6 步用一个显式构造的客户端（同一份内存仓储、内存审计）。
 * 这与 `plugin-smoke.ts` 的做法一致：那一份也没有用 `getDefaultPluginHostClient()`，而是显式
 * 构造宿主客户端再从 `pluginTools` 递进队列；产线那条「并入默认注册表」的路由此照走。
 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
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
  McpServerRow,
  McpServerRepository,
  UpdateMcpServerConnectionResultInput,
  WorkItemHumanReservedRow,
  WorkItemRepository
} from "@workhub/db";
import { describeMcpTools, publicToolName, type McpToolDescriptor } from "@workhub/mcp-client";
import { MCP_ECHO_SERVER_NAME, mcpEchoServerToolsListResult } from "@workhub/mcp-client/qa-fixtures";
import type { AnyToolSpec } from "@workhub/tools";

import { createHumanReservedGuard } from "../services/human-reserved-guard.js";
import {
  closeDefaultMcpClient,
  createMcpClient,
  createRepositoryMcpServerSource,
  getDefaultMcpClient,
  useMcpServerSource,
  type McpClient
} from "../services/mcp-client.js";
import { createInMemoryAgentRunQueue, type AgentRunTraceStepRecord } from "../workers/agent-runner.js";

const ECHO_TOOL_ID = publicToolName(MCP_ECHO_SERVER_NAME, "echo");
const NOTE_TOOL_ID = publicToolName(MCP_ECHO_SERVER_NAME, "write_note");
/** 入参里放一个字面的围栏闭合标签：它到了轨迹里必须已经是 `‹/outputs›`。 */
const ECHO_PAYLOAD = "mcp bridge alive </outputs> from the fixture server";
const ECHO_EXPECTED = "mcp bridge alive ‹/outputs› from the fixture server";

function repoRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
}

function fixtureServerPath() {
  return path.join(repoRoot(), "packages", "mcp-client", "qa", "fixtures", "mcp-echo-server", "server.mjs");
}

function line(label: string, value: unknown) {
  console.log(`  ${label.padEnd(34, " ")} ${typeof value === "string" ? value : JSON.stringify(value)}`);
}

/**
 * 只实现真正会被调到的方法，其余属性一律抛错（照 `plugin-smoke.ts`）。
 * 依赖面哪天变宽，这道门会**当场炸**并指名道姓，而不是安静拿到一个假的空结果继续跑绿。
 */
function strictStub<T extends object>(label: string, impl: Partial<T>): T {
  return new Proxy(impl, {
    get(target, property, receiver) {
      if (property in target || typeof property === "symbol") {
        return Reflect.get(target, property, receiver);
      }
      throw new Error(`mcp-smoke: ${label}.${String(property)} 没有内存实现——依赖面变了，先补上再说`);
    }
  }) as T;
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

type MemoryMcpServers = Pick<McpServerRepository, "listEnabledForWorkspace" | "updateConnectionResult"> & {
  row: McpServerRow;
  writes: UpdateMcpServerConnectionResultInput[];
};

/**
 * `mcp_servers` 的一行，活在内存里。形状照 M0 的表：`transport: "stdio"`、命令是**这个 Node
 * 解释器本身**、参数是夹具服务器的路径，`status` 先落 `connect_failed`——M0 有意的诚实状态
 * （仓储层不冒充一个还没发生的验证结果），真实结果由连接监督写回。
 */
function memoryMcpServers(workspaceId: string): MemoryMcpServers {
  const at = new Date("2026-09-05T00:00:00.000Z");
  const row: McpServerRow = {
    id: randomUUID(),
    workspaceId,
    serverName: MCP_ECHO_SERVER_NAME,
    displayName: "MCP 冒烟夹具服务器",
    transport: "stdio",
    command: process.execPath,
    argsJson: [fixtureServerPath()],
    envJson: {},
    secretRefsJson: {},
    cwd: null,
    url: null,
    authHeaderCt: null,
    authHeaderIv: null,
    authHeaderTag: null,
    toolCallTimeoutMs: 30_000,
    enabled: true,
    status: "connect_failed",
    trustLevel: "read_only",
    precheckReport: { ok: true, source: "mcp-smoke" },
    lastError: null,
    toolCount: 0,
    toolsJson: null,
    installedBy: null,
    createdAt: at,
    updatedAt: at
  };
  const writes: UpdateMcpServerConnectionResultInput[] = [];
  const repository = strictStub<Pick<McpServerRepository, "listEnabledForWorkspace" | "updateConnectionResult">>(
    "mcpServers",
    {
      async listEnabledForWorkspace(id: string) {
        // 每次给一份拷贝：连接监督用 JSON 比较判「配置变没变」，共享同一个对象会让翻转信任级别
        // 这件事看起来像没发生过。
        return id === workspaceId && row.enabled && row.status !== "disabled" ? [{ ...row }] : [];
      },
      async updateConnectionResult(input: UpdateMcpServerConnectionResultInput) {
        writes.push(input);
        row.status = input.status;
        row.toolCount = input.toolCount;
        row.toolsJson = input.tools ?? null;
        row.lastError = input.lastError ?? null;
        row.updatedAt = input.now ?? new Date();
        return { ...row };
      }
    }
  );
  return Object.assign(repository, { row, writes }) as MemoryMcpServers;
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
    code: "WI-MCP-1",
    title: "MCP 冒烟：让 Cuu 调用一次 MCP 服务器上的工具",
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
 * 假 provider：第一步让模型「决定」调用给定的 MCP 工具，第二步写交付物，第三步收尾，
 * 第四步应付 loop 默认追加的一次评审。与 `plugin-smoke.ts` 的 fake client 同款。
 */
function mcpCallingAgentClient(toolId: string, input: Record<string, unknown>): AgentLoopClient {
  const responses = [
    {
      id: "msg-mcp-1",
      stopReason: "tool_use",
      usage: { inputTokens: 12, outputTokens: 20 },
      content: [{ type: "tool_use", id: "tool-mcp-1", name: toolId, input }]
    },
    {
      id: "msg-mcp-2",
      stopReason: "tool_use",
      usage: { inputTokens: 10, outputTokens: 18 },
      content: [
        {
          type: "tool_use",
          id: "tool-mcp-2",
          name: "write_file",
          input: {
            path: "outputs/mcp-smoke.md",
            content: `# MCP smoke\n\nThe ${MCP_ECHO_SERVER_NAME} server answered during this run.\n`
          }
        }
      ]
    },
    {
      id: "msg-mcp-3",
      stopReason: "end_turn",
      usage: { inputTokens: 6, outputTokens: 6 },
      content: [{ type: "text", text: "已经用 MCP 服务器上的工具核对过，交付物写好了。" }]
    },
    {
      id: "msg-mcp-review",
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
          throw new Error("mcp-smoke: 假 provider 的响应队列空了");
        }
        return response;
      }
    }
  };
}

function specById(specs: AnyToolSpec[], id: string): AnyToolSpec {
  const spec = specs.find((entry) => entry.id === id);
  assert.ok(spec, `工具规格里没有 ${id}`);
  return spec;
}

/** 一个描述符的可比较面（函数不参与比较）。 */
function comparableDescriptor(descriptor: McpToolDescriptor) {
  return {
    toolId: descriptor.toolId,
    rawName: descriptor.rawName,
    serverName: descriptor.serverName,
    description: descriptor.description,
    jsonSchema: descriptor.jsonSchema,
    sideEffect: descriptor.sideEffect,
    minScope: descriptor.minScope,
    annotations: descriptor.annotations
  };
}

function comparableSpec(spec: AnyToolSpec) {
  return {
    id: spec.id,
    description: spec.description,
    jsonSchema: spec.jsonSchema,
    sideEffect: spec.sideEffect,
    minScope: spec.minScope
  };
}

/** 收尾自检：夹具服务器不该有任何残留进程。本机没有 `pgrep` 时如实说跳过，不假装查过。 */
async function leftoverFixtureProcesses(): Promise<string[] | undefined> {
  return new Promise((resolve) => {
    execFile("pgrep", ["-f", "mcp-echo-server/server.mjs"], (error, stdout) => {
      if (error && (error as NodeJS.ErrnoException).code === "ENOENT") {
        resolve(undefined);
        return;
      }
      resolve(
        stdout
          .split("\n")
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0 && entry !== String(process.pid))
      );
    });
  });
}

async function main() {
  const settings = loadSettings();
  const workspaceId = settings.auth.defaultWorkspaceId;
  const servers = memoryMcpServers(workspaceId);
  const audit = memoryAuditLogs();
  const workdir = await mkdtemp(path.join(os.tmpdir(), "workhub-mcp-smoke-"));

  console.log("WorkHub MCP smoke —— 一台真的 stdio MCP 服务器，端到端");
  console.log("");
  console.log("[1/6] 产线接线自检：useMcpServerSource + getDefaultMcpClient 真的把夹具连起来");
  line("夹具服务器", servers.row.argsJson[0]);
  line("命令", servers.row.command ?? "(缺)");
  // M4 在 server.ts 接的就是这一行。传内存仓储时读写都落在它身上（M5 修的接线）。
  useMcpServerSource(servers);
  const wiredSpecs = await getDefaultMcpClient().toolSpecs({ workspaceId });
  line("默认单例翻出来的工具", wiredSpecs.map((spec) => spec.id));
  assert.deepEqual(
    wiredSpecs.map((spec) => spec.id).sort(),
    [ECHO_TOOL_ID, NOTE_TOOL_ID].sort(),
    "产线默认路径没有把夹具服务器的工具翻出来"
  );
  const wiredStatus = getDefaultMcpClient().status(workspaceId);
  line("连接状态快照", wiredStatus.map((entry) => ({ status: entry.status, tools: entry.toolCount, live: entry.live })));
  assert.equal(wiredStatus.length, 1);
  assert.equal(wiredStatus[0]!.status, "connected");
  assert.equal(wiredStatus[0]!.toolCount, 2);
  assert.equal(wiredStatus[0]!.live, true);
  // 状态回写落在传进去的那份仓储上，不是别的库——M0 约定的 `setEnabled → connect_failed`
  // 只有靠这一步才会被真实结果修正。
  line("连接结果回写", servers.writes.map((write) => ({ status: write.status, tools: write.tools })));
  assert.equal(servers.writes.length, 1, "连接成功应当恰好回写一次");
  assert.equal(servers.writes[0]!.status, "connected");
  assert.equal(servers.writes[0]!.toolCount, 2);
  assert.deepEqual(servers.writes[0]!.tools, ["echo", "write_note"]);
  assert.equal(servers.writes[0]!.lastError, null);
  assert.equal(servers.row.status, "connected");
  // 自检做完就把这个单例连同它的子进程收掉：后面几步换成能注入审计 sink 的客户端。
  await closeDefaultMcpClient();
  servers.writes.length = 0;

  const client: McpClient = createMcpClient({
    serverSource: createRepositoryMcpServerSource({ repository: servers }),
    auditLogs: audit,
    connectionResults: servers,
    handshakeTimeoutMs: 30_000,
    // 定时器关掉：这道门自己驱动生命周期，不想让一个后台扫描在断言中间把子进程收走。
    idleSweepIntervalMs: false
  });

  try {
    console.log("");
    console.log("[2/6] 真服务器翻出来的东西，与 M6 golden 钉的常量夹具逐字对齐");
    const specs = await client.toolSpecs({ workspaceId });
    const expected = describeMcpTools({
      serverName: MCP_ECHO_SERVER_NAME,
      trustLevel: "read_only",
      tools: [...mcpEchoServerToolsListResult.tools]
    });
    assert.equal(expected.ok, true, "常量夹具本身翻不动——这不可能，先查 M1");
    assert.ok(expected.ok);
    line("常量夹具翻出的工具", expected.descriptors.map((descriptor) => descriptor.toolId));
    assert.deepEqual(
      specs.map(comparableSpec),
      expected.descriptors.map((descriptor) => {
        const { toolId, description, jsonSchema, sideEffect, minScope } = comparableDescriptor(descriptor);
        return { id: toolId, description, jsonSchema, sideEffect, minScope };
      }),
      "真服务器与常量夹具漂移了：M6 的 golden 钉的就不再是这台服务器实际会说的话"
    );

    console.log("");
    console.log("[3/6] 核对分级真值：管理员断言 AND 服务器自述");
    const echoSpec = specById(specs, ECHO_TOOL_ID);
    const noteSpec = specById(specs, NOTE_TOOL_ID);
    line("echo 副作用/能力键", `${echoSpec.sideEffect} / ${echoSpec.minScope ?? "(none)"}`);
    line("write_note 副作用/能力键", `${noteSpec.sideEffect} / ${noteSpec.minScope ?? "(none)"}`);
    assert.equal(echoSpec.sideEffect, "none", "断言只读 + 自述只读的工具应当落到低风险档");
    assert.equal(echoSpec.minScope, `mcp:${MCP_ECHO_SERVER_NAME}:read`);
    assert.equal(noteSpec.sideEffect, "external_effect", "没有只读自述的工具不该跟着降档");
    assert.equal(noteSpec.minScope, `mcp:${MCP_ECHO_SERVER_NAME}:external_effect`);
    // 模型看到的是服务器自己给的 JSON Schema（旁路生效），不是 Zod 退化出的空 object。
    const modelSchema = echoSpec.jsonSchema as { properties?: Record<string, unknown>; required?: string[] } | undefined;
    line("模型可见 schema 参数", Object.keys(modelSchema?.properties ?? {}));
    assert.ok(modelSchema?.properties?.["text"], "JSON Schema 旁路没生效：模型看不到 text 参数");
    assert.deepEqual(modelSchema?.required, ["text"]);

    console.log("");
    console.log("[4/6] 只读档：跑一次 agent run，人工保留门是真的那一份");
    const readOnlyWorkItemId = randomUUID();
    const readOnlyActorId = randomUUID();
    const readOnlyStores = guardStores(readOnlyWorkItemId, workspaceId, readOnlyActorId);
    const readOnlySnapshots: { toolId: string; sideEffect: string }[] = [];
    const readOnlyQueue = createInMemoryAgentRunQueue({
      settings,
      workdir: () => workdir,
      client: () => mcpCallingAgentClient(ECHO_TOOL_ID, { text: ECHO_PAYLOAD }),
      // MCP 工具由连接监督提供；不接 tools 提供者，走的就是产线那条「并入默认注册表」的路。
      mcpTools: () => specs,
      snapshot: (input) => {
        readOnlySnapshots.push({ toolId: input.toolId, sideEffect: input.sideEffect });
        return { snapshotId: randomUUID() };
      },
      // **真的**人工保留门，只换掉它的仓储。
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
      title: "MCP 冒烟：让 Cuu 调用一次只读档的 MCP 工具"
    });
    const readOnlyRun = await readOnlyQueue.runNext();
    assert.ok(readOnlyRun, "没有 run 被执行");
    line("run 状态", readOnlyRun.status);
    assert.equal(readOnlyRun.run_id, readOnlyQueued.run_id);
    assert.equal(readOnlyRun.status, "succeeded", `run 没成功：${JSON.stringify(readOnlyRun.trace)}`);

    const trace: AgentRunTraceStepRecord[] = readOnlyRun.trace;
    const call = trace.find((step) => step.phase === "tool_call" && step.output_excerpt?.startsWith(ECHO_TOOL_ID));
    const result = trace.find((step) => step.phase === "tool_result" && step.output_excerpt === ECHO_EXPECTED);
    line("轨迹里的工具调用", call?.output_excerpt ?? "(缺)");
    line("轨迹里的工具结果", result?.output_excerpt ?? "(缺)");
    assert.ok(call, "轨迹里没有这次 MCP 工具调用");
    assert.ok(result, `轨迹里没有服务器回的结果，期望 ${JSON.stringify(ECHO_EXPECTED)}`);
    // 服务器原样回的是一个字面的 `</outputs>`；它进轨迹之前必须已经被中和，否则一次工具结果
    // 就能在工人抄进 outputs/ 与自述之后提前闭合评审围栏。
    assert.equal(result.output_excerpt?.includes("</outputs>"), false, "围栏标签没有被中和");

    line("升级事件条数", readOnlyStores.escalations.length);
    line("被翻成 pm 模式的工作项", readOnlyStores.pmModeCalls);
    assert.equal(readOnlyStores.escalations.length, 0, "只读档的 MCP 调用不该开升级事件");
    assert.deepEqual(readOnlyStores.pmModeCalls, [], "只读档的 MCP 调用不该把工作项翻成 pm 模式");
    // 只读工具没有可还原的东西，快照门也就不该为它开还原点（`sideEffect: none` 的既有语义）。
    line("为 MCP 工具开的还原点", readOnlySnapshots.filter((entry) => entry.toolId === ECHO_TOOL_ID));
    assert.equal(
      readOnlySnapshots.some((entry) => entry.toolId === ECHO_TOOL_ID),
      false,
      "只读 MCP 工具不该走副作用快照门"
    );
    assert.equal(call.snapshot_id ?? null, null, "只读 MCP 工具的调用不该带还原点 id");

    console.log("");
    console.log("[5/6] 核对审计");
    const calledAudits = audit.rows.filter((row) => row.action === "mcp.tool.called");
    line("mcp.tool.called 条数", calledAudits.length);
    assert.equal(calledAudits.length, 1, "只有真的执行到的那次调用才该落 MCP 调用审计");
    const auditRow = calledAudits[0]!;
    const detail = (auditRow.detailJson ?? {}) as Record<string, unknown>;
    line("审计 entityType/entityId", `${auditRow.entityType} / ${auditRow.entityId}`);
    line("审计 detail", detail);
    assert.equal(auditRow.entityType, "mcp_tool_invocation");
    assert.equal(auditRow.entityId, `${MCP_ECHO_SERVER_NAME}:echo`);
    assert.equal(auditRow.actorKind, "ai");
    assert.equal(detail["mcp_server_id"], servers.row.id);
    assert.equal(detail["server_name"], MCP_ECHO_SERVER_NAME);
    assert.equal(detail["tool_name"], "echo");
    assert.equal(detail["tool_id"], ECHO_TOOL_ID);
    assert.equal(detail["ok"], true);
    assert.equal(typeof detail["duration_ms"], "number");
    assert.equal(detail["result_summary"], ECHO_EXPECTED);
    assert.equal(detail["agent_run_id"], readOnlyRun.run_id);
    assert.equal(detail["work_item_id"], readOnlyWorkItemId);
    // capability 与这次调用真正生效的那一档同源，不是一个写死的字符串。
    assert.equal(detail["capability"], echoSpec.minScope);
    assert.equal(detail["capability"], `mcp:${MCP_ECHO_SERVER_NAME}:read`);

    console.log("");
    console.log("[6/6] 最高档：管理员把断言收回 external_effect，同一个调用停下来转人");
    servers.row.trustLevel = "external_effect";
    // 治理动作之后必须紧跟一次 reload()：换了信任级别的服务器不是同一台，连接要重建、清单要重翻。
    const reloaded = await client.reload(workspaceId);
    line("reload 后的状态", reloaded.map((entry) => ({ status: entry.status, tools: entry.toolCount })));
    assert.equal(reloaded.length, 1);
    assert.equal(reloaded[0]!.status, "connected");
    const gatedSpecs = await client.toolSpecs({ workspaceId });
    const gatedEcho = specById(gatedSpecs, ECHO_TOOL_ID);
    line("收回断言后的 echo", `${gatedEcho.sideEffect} / ${gatedEcho.minScope ?? "(none)"}`);
    assert.equal(gatedEcho.sideEffect, "external_effect", "自述只读不能抬过管理员断言的上限");
    assert.equal(gatedEcho.minScope, `mcp:${MCP_ECHO_SERVER_NAME}:external_effect`);

    const gatedWorkItemId = randomUUID();
    const gatedActorId = randomUUID();
    const gatedStores = guardStores(gatedWorkItemId, workspaceId, gatedActorId);
    const gatedQueue = createInMemoryAgentRunQueue({
      settings,
      workdir: () => workdir,
      client: () => mcpCallingAgentClient(ECHO_TOOL_ID, { text: ECHO_PAYLOAD }),
      mcpTools: () => gatedSpecs,
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
      title: "MCP 冒烟：让 Cuu 调用一次外部影响档的 MCP 工具"
    });
    const gatedRun = await gatedQueue.runNext();
    assert.ok(gatedRun, "没有 run 被执行");
    line("run 状态", gatedRun.status);
    line("收尾原因", gatedRun.trace.at(-1)?.output_excerpt ?? "(缺)");
    assert.equal(gatedRun.status, "failed", "高风险 MCP 调用被拦下时这次执行应当中断");
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
    assert.equal(handoff["tool_id"], ECHO_TOOL_ID);
    assert.deepEqual(gatedStores.pmModeCalls, [], "工具风险类升级不重写工作项状态（只有首次人工预留才写）");
    // 被拦下的那次调用**没有执行**，所以不该有新的调用审计——但升级本身落了一条。
    line("mcp.tool.called 累计", audit.rows.filter((row) => row.action === "mcp.tool.called").length);
    assert.equal(
      audit.rows.filter((row) => row.action === "mcp.tool.called").length,
      1,
      "被拦下的调用不该落 MCP 调用审计"
    );
    const escalationAudits = audit.rows.filter((row) => row.action === "escalation.opened");
    line("escalation.opened 条数", escalationAudits.length);
    assert.equal(escalationAudits.length, 1, "被拦下的高风险调用应当落一条升级审计");
    assert.equal(
      (escalationAudits[0]!.detailJson as Record<string, unknown>)["source"],
      "human_reserved_tool_call"
    );
  } finally {
    await client.close();
    await closeDefaultMcpClient();
    await rm(workdir, { recursive: true, force: true });
  }

  const leftovers = await leftoverFixtureProcesses();
  console.log("");
  if (leftovers === undefined) {
    line("残留子进程自检", "跳过（本机没有 pgrep）");
  } else {
    line("残留的夹具子进程", leftovers.length === 0 ? "无" : leftovers);
    assert.deepEqual(leftovers, [], "收尾之后还有夹具子进程活着——连接监督漏收了");
  }

  console.log("");
  console.log("MCP smoke 通过：只读档的 MCP 调用直接跑通，收回断言之后同一个调用停下来转人。");
}

main().catch((error) => {
  console.error("");
  console.error("MCP smoke 失败：");
  console.error(error);
  process.exit(1);
});
