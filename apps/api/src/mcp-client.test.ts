import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import {
  createJsonRpcLineDecoder,
  encodeJsonRpcLine,
  JSONRPC_VERSION,
  MCP_CLIENT_PROTOCOL_VERSION,
  type JsonRpcInbound,
  type McpChildProcessLike,
  type McpServerSpawn
} from "@workhub/mcp-client/stdio";
import type { AuditLogRepository, AuditLogRow, CreateAuditLogInput, McpServerRow } from "@workhub/db";
import type { ToolExecutionContext } from "@workhub/tools";

import {
  createMcpClient,
  toMcpServerConfig,
  type McpClientOptions,
  type McpServerConfig
} from "./services/mcp-client.js";

const WORKSPACE = "ws-1";

const CTX = { workdir: "/tmp", runId: "run-1", actorId: "user-1", workItemId: "wi-1" } as ToolExecutionContext;

type SpawnInput = { command: string; args: string[]; env: Record<string, string>; cwd: string | undefined };

type FakeChild = EventEmitter &
  McpChildProcessLike & {
    inbox: JsonRpcInbound[];
    killed: string[];
    say: (line: string) => void;
    exit: (code: number) => void;
  };

/** 假 MCP 服务器子进程，套路照 `plugin-host-client.test.ts` 的 fakeChild。 */
function fakeChild(respond: (message: JsonRpcInbound, child: FakeChild) => void): FakeChild {
  const child = new EventEmitter() as FakeChild;
  const decoder = createJsonRpcLineDecoder();
  child.inbox = [];
  child.killed = [];
  const stdout = new EventEmitter() as unknown as FakeChild["stdout"];
  stdout.setEncoding = () => undefined;
  const stderr = new EventEmitter() as unknown as FakeChild["stderr"];
  stderr.setEncoding = () => undefined;
  child.stdout = stdout;
  child.stderr = stderr;
  child.stdin = {
    writable: true,
    write(chunk: string, callback?: (error?: Error | null) => void) {
      for (const message of decoder.push(chunk).messages) {
        child.inbox.push(message);
        setImmediate(() => respond(message, child));
      }
      callback?.(null);
      return true;
    },
    end() {
      child.stdin.writable = false;
      setImmediate(() => child.exit(0));
    }
  };
  child.kill = (signal?: NodeJS.Signals) => {
    child.killed.push(signal ?? "SIGTERM");
    return true;
  };
  child.say = (line: string) => (stdout as unknown as EventEmitter).emit("data", line);
  child.exit = (code: number) => {
    child.stdin.writable = false;
    child.emit("exit", code, null);
  };
  return child;
}

function methodOf(message: JsonRpcInbound): string {
  return (message as { method?: string }).method ?? "";
}

function idOf(message: JsonRpcInbound): number {
  return (message as { id: number }).id;
}

const ECHO_TOOL = {
  name: "echo",
  description: "Echo a phrase back.",
  inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
  annotations: { readOnlyHint: true }
};

const WRITE_TOOL = {
  name: "write_note",
  description: "Write a note.",
  inputSchema: { type: "object", properties: { text: { type: "string" } } }
};

type Script = {
  /** `tools/list` 每次回的清单（按调用次序取，用完取最后一个）。 */
  toolPages?: unknown[][];
  /** `tools/call` 的回法；缺省回一个 text 块 "pong"。 */
  onCall?: (message: JsonRpcInbound, child: FakeChild) => void;
  /** 起进程就报错（命令不存在）。 */
  spawnError?: string;
};

/** 一台假服务器：记录每次 spawn 的输入，按脚本回话。 */
function fakeServer(script: Script = {}) {
  const spawns: SpawnInput[] = [];
  const children: FakeChild[] = [];
  let listCalls = 0;
  const spawnProcess: McpServerSpawn = (input) => {
    spawns.push(input);
    const child = fakeChild((message, live) => {
      const method = methodOf(message);
      if (method === "initialize") {
        live.say(
          encodeJsonRpcLine({
            jsonrpc: JSONRPC_VERSION,
            id: idOf(message),
            result: {
              protocolVersion: MCP_CLIENT_PROTOCOL_VERSION,
              capabilities: { tools: { listChanged: true } },
              serverInfo: { name: "fake", version: "0.0.1" }
            }
          })
        );
        return;
      }
      if (method === "tools/list") {
        const pages = script.toolPages ?? [[ECHO_TOOL, WRITE_TOOL]];
        const tools = pages[Math.min(listCalls, pages.length - 1)] ?? [];
        listCalls += 1;
        live.say(encodeJsonRpcLine({ jsonrpc: JSONRPC_VERSION, id: idOf(message), result: { tools } }));
        return;
      }
      if (method === "tools/call") {
        if (script.onCall) {
          script.onCall(message, live);
          return;
        }
        live.say(
          encodeJsonRpcLine({
            jsonrpc: JSONRPC_VERSION,
            id: idOf(message),
            result: { content: [{ type: "text", text: "pong" }] }
          })
        );
      }
    });
    children.push(child);
    if (script.spawnError) {
      setImmediate(() => child.emit("error", new Error(script.spawnError)));
    }
    return child;
  };
  return { spawns, children, spawnProcess };
}

function memoryAuditLogs(): AuditLogRepository & { rows: CreateAuditLogInput[] } {
  const rows: CreateAuditLogInput[] = [];
  return {
    rows,
    async createAuditLog(input) {
      rows.push(input);
      return { id: "audit-1", ...input } as unknown as AuditLogRow;
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

type ConnectionWrite = { id: string; status: string; toolCount: number; tools: string[] | null; lastError: string | null };

function memoryConnectionResults() {
  const writes: ConnectionWrite[] = [];
  return {
    writes,
    async updateConnectionResult(input: {
      id: string;
      status: string;
      toolCount: number;
      tools?: string[] | null;
      lastError?: string | null;
    }) {
      writes.push({
        id: input.id,
        status: input.status,
        toolCount: input.toolCount,
        tools: input.tools ?? null,
        lastError: input.lastError ?? null
      });
      return null;
    }
  } as unknown as { writes: ConnectionWrite[] } & NonNullable<McpClientOptions["connectionResults"]>;
}

function serverConfig(overrides: Partial<McpServerConfig> = {}): McpServerConfig {
  return {
    id: "srv-1",
    workspaceId: WORKSPACE,
    serverName: "fs",
    command: "/usr/local/bin/fake-mcp",
    args: ["--stdio"],
    env: {},
    secretRefs: {},
    toolCallTimeoutMs: 5_000,
    trustLevel: "read_only",
    ...overrides
  };
}

/** 单调时钟：测试推进它来驱动空闲回收与重连窗口，不依赖真实时间。 */
function fakeClock(start = 1_000_000) {
  let value = start;
  return {
    now: () => value,
    advance(ms: number) {
      value += ms;
    }
  };
}

function clientFor(configs: McpServerConfig[], options: Partial<McpClientOptions> = {}) {
  return createMcpClient({
    serverSource: () => configs,
    auditLogs: false,
    connectionResults: false,
    idleSweepIntervalMs: false,
    handshakeTimeoutMs: 500,
    envSource: {},
    ...options
  });
}

async function keepingEventLoopAlive<T>(run: () => Promise<T>): Promise<T> {
  const heartbeat = setInterval(() => undefined, 5);
  try {
    return await run();
  } finally {
    clearInterval(heartbeat);
  }
}

test("没接清单来源时既不 spawn 也不报错，工具列表为空", async () => {
  let spawned = 0;
  const client = createMcpClient({
    spawnProcess: () => {
      spawned += 1;
      throw new Error("should not spawn");
    },
    auditLogs: false,
    connectionResults: false,
    idleSweepIntervalMs: false
  });
  assert.deepEqual(await client.toolSpecs({ workspaceId: WORKSPACE }), []);
  assert.equal(spawned, 0);
  await client.close();
});

test("装配：一次握手拿到工具，公开名在 mcp__ 名字空间，读写分级按真值表", async () => {
  const server = fakeServer();
  const client = clientFor([serverConfig()], { spawnProcess: server.spawnProcess });
  const specs = await client.toolSpecs({ workspaceId: WORKSPACE });
  assert.deepEqual(specs.map((spec) => spec.id), ["mcp__fs__echo", "mcp__fs__write_note"]);
  // 管理员断言 read_only AND 服务器自述 readOnlyHint:true → none；没有自述的那个仍是最高风险。
  assert.equal(specs[0]?.sideEffect, "none");
  assert.equal(specs[0]?.minScope, "mcp:fs:read");
  assert.equal(specs[1]?.sideEffect, "external_effect");
  assert.equal(specs[1]?.minScope, "mcp:fs:external_effect");
  // 模型看到的是服务器给的 schema，不是退化的空 object。
  assert.deepEqual(specs[0]?.jsonSchema, {
    type: "object",
    properties: { text: { type: "string" } },
    required: ["text"]
  });
  assert.equal(server.spawns.length, 1);
  await client.close();
});

test("装配是懒的也是缓存的：第二次不再 spawn", async () => {
  const server = fakeServer();
  const client = clientFor([serverConfig()], { spawnProcess: server.spawnProcess });
  await client.toolSpecs({ workspaceId: WORKSPACE });
  await client.toolSpecs({ workspaceId: WORKSPACE });
  assert.equal(server.spawns.length, 1);
  await client.close();
});

test("子进程 env 只有白名单基座与解析后的引用式密钥", async () => {
  const server = fakeServer();
  const client = clientFor([serverConfig({ env: { GH_HOST: "github.com" }, secretRefs: { GITHUB_TOKEN: "WORKHUB_MCP_SECRET_GITHUB" } })], {
    spawnProcess: server.spawnProcess,
    envSource: {
      PATH: "/usr/bin",
      HOME: "/home/wh",
      WORKHUB_MCP_SECRET_GITHUB: "ghp_real",
      // 既不像凭据、也不在白名单里——照样拿不到（白名单不是黑名单）。
      MY_COMPANY_PAT: "leak-me",
      COOKIE_SECRET: "nope"
    }
  });
  await client.toolSpecs({ workspaceId: WORKSPACE });
  assert.deepEqual(server.spawns[0]?.env, {
    PATH: "/usr/bin",
    HOME: "/home/wh",
    GH_HOST: "github.com",
    GITHUB_TOKEN: "ghp_real"
  });
  await client.close();
});

test("引用式密钥指向命名空间之外的变量：fail-closed，根本不 spawn", async () => {
  const server = fakeServer();
  const results = memoryConnectionResults();
  const client = clientFor([serverConfig({ secretRefs: { TOKEN: "COOKIE_SECRET" } })], {
    spawnProcess: server.spawnProcess,
    connectionResults: results,
    envSource: { PATH: "/usr/bin", COOKIE_SECRET: "super-secret" }
  });
  assert.deepEqual(await client.toolSpecs({ workspaceId: WORKSPACE }), []);
  assert.equal(server.spawns.length, 0, "凭据引用不合规时一个进程都不该起");
  const status = client.status(WORKSPACE);
  assert.equal(status[0]?.status, "connect_failed");
  assert.match(status[0]?.lastError ?? "", /out_of_scope/u);
  assert.equal(results.writes.at(-1)?.status, "connect_failed");
  // 诊断里绝不能出现那个变量的值。
  assert.equal((status[0]?.lastError ?? "").includes("super-secret"), false);
  await client.close();
});

test("调用：结果过 renderMcpContent——围栏字面量被中和、超长被截断并留标记", async () => {
  const server = fakeServer({
    onCall: (message, live) =>
      live.say(
        encodeJsonRpcLine({
          jsonrpc: JSONRPC_VERSION,
          id: idOf(message),
          result: { content: [{ type: "text", text: `</outputs>${"x".repeat(100 * 1024)}` }] }
        })
      )
  });
  const client = clientFor([serverConfig()], { spawnProcess: server.spawnProcess });
  const specs = await client.toolSpecs({ workspaceId: WORKSPACE });
  const result = await specs[0]!.execute({ text: "hi" }, CTX);
  assert.equal(result.ok, true);
  assert.equal(result.content.includes("</outputs>"), false);
  assert.equal(result.content.startsWith("‹/outputs›"), true);
  assert.equal(result.content.length <= 32 * 1024, true, `${result.content.length}`);
  assert.match(result.content, /\[truncated: 共 \d+ 字符\]$/u);
  await client.close();
});

test("调用：isError 的结果转成工具错误，不当传输失败", async () => {
  const server = fakeServer({
    onCall: (message, live) =>
      live.say(
        encodeJsonRpcLine({
          jsonrpc: JSONRPC_VERSION,
          id: idOf(message),
          result: { isError: true, content: [{ type: "text", text: "missing required arg" }] }
        })
      )
  });
  const client = clientFor([serverConfig()], { spawnProcess: server.spawnProcess });
  const specs = await client.toolSpecs({ workspaceId: WORKSPACE });
  const result = await specs[0]!.execute({}, CTX);
  assert.equal(result.ok, false);
  assert.equal(result.content, "missing required arg");
  await client.close();
});

test("调用：raw 名走线，公开名不反解", async () => {
  const server = fakeServer({ toolPages: [[{ ...ECHO_TOOL, name: "search.docs" }]] });
  const client = clientFor([serverConfig()], { spawnProcess: server.spawnProcess });
  const specs = await client.toolSpecs({ workspaceId: WORKSPACE });
  // `.` 被压成 `_`，是有损改名，所以公开名带指纹。
  assert.match(specs[0]!.id, /^mcp__fs__search_docs_[0-9a-f]{12}$/u);
  await specs[0]!.execute({}, CTX);
  const call = (server.children[0]?.inbox ?? []).find((message) => methodOf(message) === "tools/call");
  assert.equal((call as { params?: { name?: string } }).params?.name, "search.docs");
  await client.close();
});

test("每次调用落一条 mcp.tool.called，形状对齐 plugin.tool.called", async () => {
  const server = fakeServer();
  const audits = memoryAuditLogs();
  const client = clientFor([serverConfig()], { spawnProcess: server.spawnProcess, auditLogs: audits });
  const specs = await client.toolSpecs({ workspaceId: WORKSPACE });
  await specs[0]!.execute({ text: "hi" }, CTX);
  assert.equal(audits.rows.length, 1);
  const row = audits.rows[0]!;
  assert.equal(row.action, "mcp.tool.called");
  assert.equal(row.actorKind, "ai");
  assert.equal(row.actorUserId, "user-1");
  assert.equal(row.workspaceId, WORKSPACE);
  assert.equal(row.actorNickname, "mcp-client");
  assert.equal(row.entityType, "mcp_tool_invocation");
  assert.equal(row.entityId, "fs:echo");
  const detail = row.detailJson ?? {};
  assert.equal(detail["server_name"], "fs");
  assert.equal(detail["tool_name"], "echo");
  assert.equal(detail["tool_id"], "mcp__fs__echo");
  assert.equal(detail["ok"], true);
  assert.equal(detail["capability"], "mcp:fs:read");
  assert.equal(detail["agent_run_id"], "run-1");
  assert.equal(detail["work_item_id"], "wi-1");
  assert.equal(typeof detail["duration_ms"], "number");
  assert.equal(detail["args_summary"], '{"text":"hi"}');
  assert.equal(detail["result_summary"], "pong");
  await client.close();
});

test("没有执行上下文时审计归 system（管理员手工试跑）", async () => {
  const server = fakeServer();
  const audits = memoryAuditLogs();
  const client = clientFor([serverConfig()], { spawnProcess: server.spawnProcess, auditLogs: audits });
  const specs = await client.toolSpecs({ workspaceId: WORKSPACE });
  await specs[0]!.execute({}, { workdir: "/tmp" } as ToolExecutionContext);
  assert.equal(audits.rows[0]?.actorKind, "system");
  await client.close();
});

test("审计写失败不把一次成功的调用变成失败", async () => {
  const server = fakeServer();
  const client = clientFor([serverConfig()], {
    spawnProcess: server.spawnProcess,
    auditLogs: {
      async createAuditLog() {
        throw new Error("pg is down");
      }
    }
  });
  const specs = await client.toolSpecs({ workspaceId: WORKSPACE });
  const result = await specs[0]!.execute({}, CTX);
  assert.equal(result.ok, true);
  assert.equal(result.content, "pong");
  await client.close();
});

test("崩溃隔离：在飞调用拿到工具错误结果而不是抛异常，并计一次失败", async () => {
  await keepingEventLoopAlive(async () => {
    const server = fakeServer({ onCall: (_message, live) => live.exit(1) });
    const audits = memoryAuditLogs();
    const client = clientFor([serverConfig()], { spawnProcess: server.spawnProcess, auditLogs: audits });
    const specs = await client.toolSpecs({ workspaceId: WORKSPACE });
    const result = await specs[0]!.execute({}, CTX);
    assert.equal(result.ok, false);
    assert.match(result.content, /^MCP 工具 mcp__fs__echo 没能完成：/u);
    assert.match(result.content, /exited/u);
    // 失败的调用同样要留审计——「没有审计」和「没有调用」必须分得清。
    assert.equal(audits.rows[0]?.detailJson?.["ok"], false);
    assert.equal(client.status(WORKSPACE)[0]?.status, "connect_failed");
    await client.close();
  });
});

test("崩溃后下一次装配会重连（预算之内）", async () => {
  await keepingEventLoopAlive(async () => {
    const server = fakeServer();
    const client = clientFor([serverConfig()], { spawnProcess: server.spawnProcess });
    await client.toolSpecs({ workspaceId: WORKSPACE });
    server.children[0]?.exit(1);
    await new Promise((resolve) => setImmediate(resolve));
    const specs = await client.toolSpecs({ workspaceId: WORKSPACE });
    assert.equal(server.spawns.length, 2);
    assert.equal(specs.length, 2);
    assert.equal(client.status(WORKSPACE)[0]?.status, "connected");
    await client.close();
  });
});

test("重连预算耗尽：熔断、状态回写 connect_failed、不再 spawn；reload 解除", async () => {
  await keepingEventLoopAlive(async () => {
    const server = fakeServer({ spawnError: "spawn /usr/local/bin/fake-mcp ENOENT" });
    const results = memoryConnectionResults();
    const client = clientFor([serverConfig()], {
      spawnProcess: server.spawnProcess,
      connectionResults: results,
      handshakeTimeoutMs: 30
    });
    for (let attempt = 0; attempt < 6; attempt += 1) {
      assert.deepEqual(await client.toolSpecs({ workspaceId: WORKSPACE }), []);
    }
    // 窗口内最多 3 次失败，第 4 次熔断——之后一次 spawn 都不该再发生。
    assert.equal(server.spawns.length, 4, `实际 spawn ${server.spawns.length} 次`);
    const blocked = client.status(WORKSPACE)[0];
    assert.equal(blocked?.status, "connect_failed");
    assert.match(blocked?.blockedReason ?? "", /failed 4 times within 10 minutes/u);
    assert.equal(results.writes.at(-1)?.status, "connect_failed");
    assert.equal(results.writes.at(-1)?.toolCount, 0);

    // 管理员改好之后 reload：熔断解除，重新给一次机会。
    const snapshots = await client.reload(WORKSPACE);
    assert.equal(snapshots[0]?.blockedReason, undefined, "reload 之后不该还带着熔断原因");
    assert.equal(server.spawns.length, 5, "reload 之后要真的重试一次");
    await client.close();
  });
});

test("熔断之后仍能调用到的工具返回错误结果，不抛异常", async () => {
  await keepingEventLoopAlive(async () => {
    let failing = false;
    const server = fakeServer();
    const client = clientFor([serverConfig()], {
      spawnProcess: (input) => {
        const child = server.spawnProcess(input);
        if (failing) {
          setImmediate(() => (child as FakeChild).emit("error", new Error("boom")));
        }
        return child;
      },
      handshakeTimeoutMs: 30
    });
    const specs = await client.toolSpecs({ workspaceId: WORKSPACE });
    failing = true;
    server.children[0]?.exit(1);
    await new Promise((resolve) => setImmediate(resolve));
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const result = await specs[0]!.execute({}, CTX);
      assert.equal(result.ok, false);
    }
    assert.match(client.status(WORKSPACE)[0]?.blockedReason ?? "", /failed \d+ times/u);
    await client.close();
  });
});

test("空闲 10 分钟回收子进程；状态不变、下次用到重新握手", async () => {
  const clock = fakeClock();
  const server = fakeServer();
  const client = clientFor([serverConfig()], { spawnProcess: server.spawnProcess, monotonicNow: clock.now });
  await client.toolSpecs({ workspaceId: WORKSPACE });
  assert.equal(client.status(WORKSPACE)[0]?.live, true);

  clock.advance(9 * 60_000);
  await client.reapIdle();
  assert.equal(client.status(WORKSPACE)[0]?.live, true, "还没到 10 分钟不该收");

  clock.advance(2 * 60_000);
  await client.reapIdle();
  const idle = client.status(WORKSPACE)[0];
  assert.equal(idle?.live, false);
  assert.equal(idle?.status, "connected", "空闲回收不是失败，状态该保持诚实");
  assert.equal(idle?.toolCount, 2);

  await client.toolSpecs({ workspaceId: WORKSPACE });
  assert.equal(server.spawns.length, 2);
  assert.equal(client.status(WORKSPACE)[0]?.live, true);
  await client.close();
});

test("活连接上限：超了关最久未用的那个（LRU）", async () => {
  const clock = fakeClock();
  const server = fakeServer();
  const configs = Array.from({ length: 4 }, (_unused, index) =>
    serverConfig({ id: `srv-${index}`, serverName: `s${index}` })
  );
  const client = clientFor(configs, {
    spawnProcess: server.spawnProcess,
    maxLiveSessions: 2,
    monotonicNow: () => {
      clock.advance(1);
      return clock.now();
    }
  });
  await client.toolSpecs({ workspaceId: WORKSPACE });
  const live = client.status(WORKSPACE).filter((row) => row.live);
  assert.equal(live.length, 2, "活着的子进程不该超过上限");
  assert.deepEqual(live.map((row) => row.serverName), ["s2", "s3"], "被关掉的是最久未用的两台");
  // 关掉不等于失败：四台都仍然是 connected，工具清单也还在。
  assert.deepEqual(client.status(WORKSPACE).map((row) => row.status), Array(4).fill("connected"));
  await client.close();
});

test("一台连不上不影响其余：其它服务器的工具照常上线", async () => {
  await keepingEventLoopAlive(async () => {
    const good = fakeServer();
    const bad = fakeServer({ spawnError: "spawn ENOENT" });
    const client = clientFor(
      [
        serverConfig({ id: "srv-bad", serverName: "bad", cwd: "/bad" }),
        serverConfig({ id: "srv-good", serverName: "good" })
      ],
      {
        spawnProcess: (input) => (input.cwd === "/bad" ? bad.spawnProcess(input) : good.spawnProcess(input)),
        handshakeTimeoutMs: 30
      }
    );
    const specs = await client.toolSpecs({ workspaceId: WORKSPACE });
    assert.deepEqual(specs.map((spec) => spec.id), ["mcp__good__echo", "mcp__good__write_note"]);
    const rows = client.status(WORKSPACE);
    assert.equal(rows.find((row) => row.serverName === "bad")?.status, "connect_failed");
    assert.equal(rows.find((row) => row.serverName === "good")?.status, "connected");
    await client.close();
  });
});

test("整份清单不可用（两个工具压成同一个公开名）时整代拒绝，不留半套", async () => {
  const server = fakeServer({ toolPages: [[{ ...ECHO_TOOL, name: "a" }, { ...ECHO_TOOL, name: "a" }]] });
  const results = memoryConnectionResults();
  const client = clientFor([serverConfig()], { spawnProcess: server.spawnProcess, connectionResults: results });
  assert.deepEqual(await client.toolSpecs({ workspaceId: WORKSPACE }), []);
  assert.equal(client.status(WORKSPACE)[0]?.status, "connect_failed");
  assert.match(client.status(WORKSPACE)[0]?.lastError ?? "", /duplicate_raw_name/u);
  assert.equal(results.writes.at(-1)?.status, "connect_failed");
  await client.close();
});

test("翻不动的单个工具只丢它自己，其余照常上线", async () => {
  const server = fakeServer({
    toolPages: [[ECHO_TOOL, { name: "remote", inputSchema: { type: "object", $ref: "https://evil.example/schema" } }]]
  });
  const client = clientFor([serverConfig()], { spawnProcess: server.spawnProcess });
  const specs = await client.toolSpecs({ workspaceId: WORKSPACE });
  assert.deepEqual(specs.map((spec) => spec.id), ["mcp__fs__echo"]);
  await client.close();
});

test("list_changed 之后下一次装配刷新清单（不在一次执行中途换）", async () => {
  const server = fakeServer({ toolPages: [[ECHO_TOOL], [ECHO_TOOL, WRITE_TOOL]] });
  const client = clientFor([serverConfig()], { spawnProcess: server.spawnProcess });
  const first = await client.toolSpecs({ workspaceId: WORKSPACE });
  assert.deepEqual(first.map((spec) => spec.id), ["mcp__fs__echo"]);
  server.children[0]?.say(encodeJsonRpcLine({ jsonrpc: JSONRPC_VERSION, method: "notifications/tools/list_changed" }));
  await new Promise((resolve) => setImmediate(resolve));
  const second = await client.toolSpecs({ workspaceId: WORKSPACE });
  assert.deepEqual(second.map((spec) => spec.id), ["mcp__fs__echo", "mcp__fs__write_note"]);
  assert.equal(server.spawns.length, 1, "刷新清单不该换进程");
  await client.close();
});

test("清单刷新失败不把一次能成的调用变成错误：留着上一份清单继续用", async () => {
  await keepingEventLoopAlive(async () => {
    let listCalls = 0;
    const spawns: SpawnInput[] = [];
    const children: FakeChild[] = [];
    const spawnProcess: McpServerSpawn = (input) => {
      spawns.push(input);
      const child = fakeChild((message, live) => {
        const method = methodOf(message);
        if (method === "initialize") {
          live.say(
            encodeJsonRpcLine({
              jsonrpc: JSONRPC_VERSION,
              id: idOf(message),
              result: {
                protocolVersion: MCP_CLIENT_PROTOCOL_VERSION,
                capabilities: { tools: { listChanged: true } },
                serverInfo: {}
              }
            })
          );
          return;
        }
        if (method === "tools/list") {
          listCalls += 1;
          if (listCalls > 1) {
            live.say(
              encodeJsonRpcLine({
                jsonrpc: JSONRPC_VERSION,
                id: idOf(message),
                error: { code: -32000, message: "list is unavailable right now" }
              })
            );
            return;
          }
          live.say(encodeJsonRpcLine({ jsonrpc: JSONRPC_VERSION, id: idOf(message), result: { tools: [ECHO_TOOL] } }));
          return;
        }
        if (method === "tools/call") {
          live.say(
            encodeJsonRpcLine({
              jsonrpc: JSONRPC_VERSION,
              id: idOf(message),
              result: { content: [{ type: "text", text: "pong" }] }
            })
          );
        }
      });
      children.push(child);
      return child;
    };
    const client = clientFor([serverConfig()], { spawnProcess });
    const specs = await client.toolSpecs({ workspaceId: WORKSPACE });
    children[0]?.say(encodeJsonRpcLine({ jsonrpc: JSONRPC_VERSION, method: "notifications/tools/list_changed" }));
    await new Promise((resolve) => setImmediate(resolve));
    const result = await specs[0]!.execute({}, CTX);
    assert.equal(result.ok, true, result.content);
    assert.equal(result.content, "pong");
    assert.equal(client.status(WORKSPACE)[0]?.toolCount, 1, "刷新失败时留着上一份清单");
    assert.equal(spawns.length, 1, "刷新失败不该换进程");
    await client.close();
  });
});

test("清单里配置变了就换一个新进程（旧的收干净）", async () => {
  const server = fakeServer();
  let configs = [serverConfig()];
  const client = createMcpClient({
    serverSource: () => configs,
    spawnProcess: server.spawnProcess,
    auditLogs: false,
    connectionResults: false,
    idleSweepIntervalMs: false,
    envSource: {}
  });
  await client.toolSpecs({ workspaceId: WORKSPACE });
  configs = [serverConfig({ args: ["--stdio", "--verbose"] })];
  await client.toolSpecs({ workspaceId: WORKSPACE });
  assert.equal(server.spawns.length, 2);
  assert.deepEqual(server.spawns[1]?.args, ["--stdio", "--verbose"]);
  await client.close();
});

test("从清单里移除之后，已经拿到的工具 spec 调用返回错误结果而不是抛异常", async () => {
  const server = fakeServer();
  let configs = [serverConfig()];
  const client = createMcpClient({
    serverSource: () => configs,
    spawnProcess: server.spawnProcess,
    auditLogs: false,
    connectionResults: false,
    idleSweepIntervalMs: false,
    envSource: {}
  });
  const specs = await client.toolSpecs({ workspaceId: WORKSPACE });
  configs = [];
  await client.toolSpecs({ workspaceId: WORKSPACE });
  const result = await specs[0]!.execute({}, CTX);
  assert.equal(result.ok, false);
  assert.match(result.content, /不在当前清单里/u);
  await client.close();
});

test("清单来源抛错（PG 抖动）：这次执行没有 MCP 工具，但不炸", async () => {
  const client = createMcpClient({
    serverSource: () => {
      throw new Error("pg is down");
    },
    auditLogs: false,
    connectionResults: false,
    idleSweepIntervalMs: false
  });
  assert.deepEqual(await client.toolSpecs({ workspaceId: WORKSPACE }), []);
  await client.close();
});

test("调用超时按服务器行的上限算，返回工具错误结果", async () => {
  await keepingEventLoopAlive(async () => {
    const server = fakeServer({ onCall: () => undefined });
    const client = clientFor([serverConfig({ toolCallTimeoutMs: 1_000 })], { spawnProcess: server.spawnProcess });
    const specs = await client.toolSpecs({ workspaceId: WORKSPACE });
    const result = await specs[0]!.execute({}, CTX);
    assert.equal(result.ok, false);
    assert.match(result.content, /timed out after 1000ms/u);
    // 超时不是这台服务器死了，不该计进重连预算。
    assert.equal(client.status(WORKSPACE)[0]?.blockedReason, undefined);
    assert.equal(client.status(WORKSPACE)[0]?.status, "connected");
    await client.close();
  });
});

test("close 之后子进程都被收掉", async () => {
  const server = fakeServer();
  const client = clientFor([serverConfig()], { spawnProcess: server.spawnProcess });
  await client.toolSpecs({ workspaceId: WORKSPACE });
  await client.close();
  assert.equal(server.children[0]?.stdin.writable, false);
  assert.deepEqual(await client.toolSpecs({ workspaceId: WORKSPACE }), []);
});

test("连接成功把真实结果写回仓储（M0 的 setEnabled 之后必须跟一次这个）", async () => {
  const server = fakeServer();
  const results = memoryConnectionResults();
  const client = clientFor([serverConfig()], { spawnProcess: server.spawnProcess, connectionResults: results });
  await client.toolSpecs({ workspaceId: WORKSPACE });
  assert.deepEqual(results.writes, [
    { id: "srv-1", status: "connected", toolCount: 2, tools: ["echo", "write_note"], lastError: null }
  ]);
  await client.close();
});

test("状态回写失败不影响连接可用", async () => {
  const server = fakeServer();
  const client = clientFor([serverConfig()], {
    spawnProcess: server.spawnProcess,
    connectionResults: {
      async updateConnectionResult() {
        throw new Error("pg is down");
      }
    } as unknown as NonNullable<McpClientOptions["connectionResults"]>
  });
  const specs = await client.toolSpecs({ workspaceId: WORKSPACE });
  assert.equal(specs.length, 2);
  await client.close();
});

test("DB 行 → 连接配置：超时夹进区间、非 stdio 与空命令的行被跳过", () => {
  const base = {
    id: "srv-1",
    workspaceId: WORKSPACE,
    serverName: "fs",
    transport: "stdio",
    command: "/bin/fake",
    argsJson: ["--stdio", 42],
    envJson: { A: "1" },
    secretRefsJson: { T: "WORKHUB_MCP_SECRET_T" },
    cwd: null,
    toolCallTimeoutMs: 900_000,
    trustLevel: "read_only"
  } as unknown as McpServerRow;
  const config = toMcpServerConfig(base);
  assert.equal(config?.toolCallTimeoutMs, 300_000, "超时夹到 CHECK 的上界");
  assert.deepEqual(config?.args, ["--stdio"], "非字符串参数被丢掉");
  assert.equal(config?.cwd, undefined);
  assert.equal(toMcpServerConfig({ ...base, command: "  " } as McpServerRow), undefined);
  assert.equal(toMcpServerConfig({ ...base, transport: "http" } as unknown as McpServerRow), undefined);
});
