import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import {
  createFrameDecoder,
  encodeFrame,
  PLUGIN_HOST_PROTOCOL_VERSION,
  type ListToolsResult,
  type PluginHostRequest
} from "@workhub/plugin-host";
import type { AuditLogRepository, AuditLogRow, CreateAuditLogInput } from "@workhub/db";

import { createPluginHostClient, type PluginHostSpawn } from "./services/plugin-host-client.js";

const DESCRIPTOR = {
  pluginId: "dsh-plugin-echo",
  toolName: "echo",
  toolId: "plugin__dsh-plugin-echo__echo",
  description: "Echo a phrase back.",
  jsonSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] }
};

const LIST_RESULT: ListToolsResult = {
  protocolVersion: PLUGIN_HOST_PROTOCOL_VERSION,
  tools: [DESCRIPTOR],
  plugins: [{ pluginId: "dsh-plugin-echo", path: "/tmp/p", ok: true, toolCount: 1, promptSectionCount: 1 }]
};

type FakeChild = EventEmitter & {
  stdin: { writable: boolean; write: (chunk: string, cb?: (error?: Error) => void) => boolean; end: () => void };
  stdout: EventEmitter & { setEncoding: (encoding: string) => void };
  stderr: EventEmitter & { setEncoding: (encoding: string) => void };
  kill: (signal?: string) => boolean;
  killed: string[];
  requests: PluginHostRequest[];
  reply: (frame: string) => void;
  exit: (code: number) => void;
};

/** 一个假的宿主子进程：记下收到的请求，按 respond 决定怎么回。 */
function fakeChild(respond: (request: PluginHostRequest, child: FakeChild) => void): FakeChild {
  const child = new EventEmitter() as FakeChild;
  const decoder = createFrameDecoder<PluginHostRequest>();
  child.requests = [];
  child.killed = [];
  const stdout = new EventEmitter() as FakeChild["stdout"];
  stdout.setEncoding = () => undefined;
  const stderr = new EventEmitter() as FakeChild["stderr"];
  stderr.setEncoding = () => undefined;
  child.stdout = stdout;
  child.stderr = stderr;
  child.stdin = {
    writable: true,
    write(chunk: string, cb?: (error?: Error) => void) {
      for (const request of decoder.push(chunk)) {
        child.requests.push(request);
        setImmediate(() => respond(request, child));
      }
      cb?.();
      return true;
    },
    end() {
      child.stdin.writable = false;
      setImmediate(() => child.exit(0));
    }
  };
  child.kill = (signal?: string) => {
    child.killed.push(signal ?? "SIGTERM");
    return true;
  };
  child.reply = (frame: string) => stdout.emit("data", frame);
  child.exit = (code: number) => {
    child.stdin.writable = false;
    child.emit("exit", code, null);
  };
  return child;
}

/**
 * 生产代码里插件调用的超时定时器是 unref 的（插件面绝不该拖住 API 进程退出），
 * 所以在「除了这个定时器什么都没有」的测试里事件循环会先排空。这里给一个 ref 住的
 * 心跳撑到断言做完——被测行为不变，只是不让 runner 提前判定「没事可做」。
 */
async function keepingEventLoopAlive<T>(run: () => Promise<T>): Promise<T> {
  const heartbeat = setInterval(() => undefined, 10);
  try {
    return await run();
  } finally {
    clearInterval(heartbeat);
  }
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

function happyHost(content = "PING") {
  const spawns: { env: Record<string, string>; args: string[]; cwd: string }[] = [];
  const children: FakeChild[] = [];
  const spawnProcess: PluginHostSpawn = (input) => {
    spawns.push({ env: input.env, args: input.args, cwd: input.cwd });
    const child = fakeChild((request, live) => {
      if (request.method === "list_tools") {
        live.reply(encodeFrame({ id: request.id, ok: true, result: LIST_RESULT }));
        return;
      }
      live.reply(
        encodeFrame({ id: request.id, ok: true, result: { ok: true, content, data: { text: content }, durationMs: 3 } })
      );
    });
    children.push(child);
    return child as never;
  };
  return { spawns, children, spawnProcess };
}

test("没配插件路径时既不 spawn 也不报错，工具列表为空", async () => {
  let spawned = 0;
  const host = createPluginHostClient({
    pluginPaths: [],
    auditLogs: false,
    spawnProcess: (() => {
      spawned += 1;
      throw new Error("不该 spawn");
    }) as unknown as PluginHostSpawn
  });
  assert.deepEqual(await host.toolSpecs(), []);
  assert.deepEqual(await host.loadReports(), []);
  assert.equal(host.available(), false);
  assert.equal(spawned, 0);
  await host.close();
});

test("握手后把插件工具翻成 ToolSpec，且子进程 env 不含任何凭据", async () => {
  const { spawns, spawnProcess } = happyHost();
  const host = createPluginHostClient({
    pluginPaths: ["/tmp/p"],
    auditLogs: false,
    spawnProcess
  });
  const specs = await host.toolSpecs();
  assert.equal(specs.length, 1);
  assert.equal(specs[0]?.id, DESCRIPTOR.toolId);
  assert.equal(specs[0]?.sideEffect, "external_effect");
  assert.equal(spawns.length, 1);
  const env = spawns[0]!.env;
  assert.equal(env.WORKHUB_PLUGIN_PATHS, "/tmp/p");
  assert.equal(env.WORKHUB_PLUGIN_HOST_ENTRY, "1");
  assert.equal(env.DATABASE_URL, undefined);
  assert.equal(env.COOKIE_SECRET, undefined);
  assert.equal(Object.keys(env).some((key) => key.includes("API_KEY")), false);
  // 宿主入口带 tsx 起（packages/* 直接吃 TS 源码，没有 JS 产物）。
  assert.equal(spawns[0]!.args[0], "--import");
  assert.match(spawns[0]!.args[2] ?? "", /plugin-host[\\/]src[\\/]host\.ts$/u);
  await host.close();
});

test("只 spawn 一次：第二次要工具列表复用同一个子进程", async () => {
  const { spawns, spawnProcess } = happyHost();
  const host = createPluginHostClient({ pluginPaths: ["/tmp/p"], auditLogs: false, spawnProcess });
  await host.toolSpecs();
  await host.toolSpecs();
  assert.equal(spawns.length, 1);
  await host.close();
});

test("一次成功调用：结果回来，审计落 plugin.tool.called", async () => {
  const audit = memoryAuditLogs();
  const { spawnProcess } = happyHost("PING PING");
  const host = createPluginHostClient({ pluginPaths: ["/tmp/p"], auditLogs: audit, spawnProcess });
  const specs = await host.toolSpecs({ workspaceId: "ws-1" });
  const result = await specs[0]!.execute(
    { text: "ping" },
    { workdir: "/tmp/w", runId: "run-1", workItemId: "wi-1", actorId: "user-1" }
  );
  assert.equal(result.ok, true);
  assert.equal(result.content, "PING PING");
  assert.deepEqual(result.data, { text: "PING PING" });

  assert.equal(audit.rows.length, 1);
  const row = audit.rows[0]!;
  assert.equal(row.action, "plugin.tool.called");
  assert.equal(row.entityType, "plugin_invocation");
  assert.equal(row.entityId, "dsh-plugin-echo:echo");
  assert.equal(row.actorKind, "ai");
  assert.equal(row.actorUserId, "user-1");
  assert.equal(row.workspaceId, "ws-1");
  const detail = row.detailJson as Record<string, unknown>;
  assert.equal(detail.plugin_id, "dsh-plugin-echo");
  assert.equal(detail.tool_name, "echo");
  assert.equal(detail.ok, true);
  assert.equal(detail.duration_ms, 3);
  assert.equal(detail.agent_run_id, "run-1");
  assert.equal(detail.work_item_id, "wi-1");
  assert.equal(detail.result_summary, "PING PING");
  await host.close();
});

test("审计摘要有长度上限——审计表不是日志表", async () => {
  const audit = memoryAuditLogs();
  const { spawnProcess } = happyHost("z".repeat(5000));
  const host = createPluginHostClient({ pluginPaths: ["/tmp/p"], auditLogs: audit, spawnProcess });
  const specs = await host.toolSpecs();
  await specs[0]!.execute({ text: "x" }, { workdir: "/tmp/w", runId: "run-1" });
  const summary = (audit.rows[0]!.detailJson as Record<string, string>).result_summary ?? "";
  assert.equal(summary.length <= 401, true);
  assert.equal(summary.endsWith("…"), true);
  await host.close();
});

test("审计写失败不把成功的工具调用变成失败", async () => {
  const { spawnProcess } = happyHost("OK");
  const host = createPluginHostClient({
    pluginPaths: ["/tmp/p"],
    auditLogs: {
      async createAuditLog() {
        throw new Error("audit table down");
      }
    },
    spawnProcess
  });
  const specs = await host.toolSpecs();
  const result = await specs[0]!.execute({ text: "x" }, { workdir: "/tmp/w", runId: "run-1" });
  assert.equal(result.ok, true);
  await host.close();
});

test("调用超时返回工具错误（不抛），并落一条 ok:false 的审计", async () => {
  const audit = memoryAuditLogs();
  const spawnProcess: PluginHostSpawn = () =>
    fakeChild((request, live) => {
      if (request.method === "list_tools") {
        live.reply(encodeFrame({ id: request.id, ok: true, result: LIST_RESULT }));
      }
      // call_tool 故意不回，让它超时。
    }) as never;
  const host = createPluginHostClient({
    pluginPaths: ["/tmp/p"],
    auditLogs: audit,
    spawnProcess,
    callTimeoutMs: 40
  });
  const specs = await host.toolSpecs();
  const result = await keepingEventLoopAlive(async () =>
    specs[0]!.execute({ text: "x" }, { workdir: "/tmp/w", runId: "run-1" })
  );
  assert.equal(result.isError, true);
  assert.match(result.content, /插件调用超时/u);
  assert.equal((audit.rows[0]!.detailJson as Record<string, unknown>).ok, false);
  await host.close();
});

test("宿主中途崩掉：在飞调用返回工具错误，run 不被带崩；下次调用重启子进程", async () => {
  const audit = memoryAuditLogs();
  let spawnCount = 0;
  const spawnProcess: PluginHostSpawn = () => {
    spawnCount += 1;
    const crashOnCall = spawnCount === 1;
    return fakeChild((request, live) => {
      if (request.method === "list_tools") {
        live.reply(encodeFrame({ id: request.id, ok: true, result: LIST_RESULT }));
        return;
      }
      if (crashOnCall) {
        live.exit(1);
        return;
      }
      live.reply(
        encodeFrame({ id: request.id, ok: true, result: { ok: true, content: "AFTER RESTART", durationMs: 1 } })
      );
    }) as never;
  };
  const host = createPluginHostClient({ pluginPaths: ["/tmp/p"], auditLogs: audit, spawnProcess });
  const specs = await host.toolSpecs();
  const crashed = await specs[0]!.execute({ text: "x" }, { workdir: "/tmp/w", runId: "run-1" });
  assert.equal(crashed.isError, true);
  assert.match(crashed.content, /插件宿主已退出/u);

  const recovered = await specs[0]!.execute({ text: "x" }, { workdir: "/tmp/w", runId: "run-2" });
  assert.equal(recovered.ok, true);
  assert.equal(recovered.content, "AFTER RESTART");
  assert.equal(spawnCount, 2);
  await host.close();
});

test("反复崩溃超上限后整个插件面停用，后续 run 直接没有插件工具", async () => {
  const spawnProcess: PluginHostSpawn = () =>
    fakeChild((request, live) => {
      if (request.method === "list_tools") {
        live.reply(encodeFrame({ id: request.id, ok: true, result: LIST_RESULT }));
        return;
      }
      live.exit(1);
    }) as never;
  const host = createPluginHostClient({ pluginPaths: ["/tmp/p"], auditLogs: false, spawnProcess });
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const specs = await host.toolSpecs();
    if (specs.length === 0) {
      break;
    }
    await specs[0]!.execute({ text: "x" }, { workdir: "/tmp/w", runId: `run-${attempt}` });
  }
  assert.equal(host.available(), false);
  assert.deepEqual(await host.toolSpecs(), []);
  await host.close();
});

test("协议版本对不上就当插件面不可用，而不是继续用不兼容的宿主", async () => {
  const spawnProcess: PluginHostSpawn = () =>
    fakeChild((request, live) => {
      live.reply(
        encodeFrame({ id: request.id, ok: true, result: { ...LIST_RESULT, protocolVersion: 999 } })
      );
    }) as never;
  const host = createPluginHostClient({ pluginPaths: ["/tmp/p"], auditLogs: false, spawnProcess });
  assert.deepEqual(await host.toolSpecs(), []);
  await host.close();
});

test("插件加载失败的报告如实带出来（给设置页和日志用）", async () => {
  const spawnProcess: PluginHostSpawn = () =>
    fakeChild((request, live) => {
      live.reply(
        encodeFrame({
          id: request.id,
          ok: true,
          result: {
            protocolVersion: PLUGIN_HOST_PROTOCOL_VERSION,
            tools: [],
            plugins: [
              { pluginId: "dsh-plugin-broken", path: "/tmp/b", ok: false, toolCount: 0, promptSectionCount: 0, error: "boom" }
            ]
          }
        })
      );
    }) as never;
  const host = createPluginHostClient({ pluginPaths: ["/tmp/b"], auditLogs: false, spawnProcess });
  const reports = await host.loadReports();
  assert.equal(reports.length, 1);
  assert.equal(reports[0]?.ok, false);
  assert.equal(reports[0]?.error, "boom");
  assert.deepEqual(await host.toolSpecs(), []);
  await host.close();
});

test("插件宿主里的工具错误如实变成工具错误结果", async () => {
  const spawnProcess: PluginHostSpawn = () =>
    fakeChild((request, live) => {
      if (request.method === "list_tools") {
        live.reply(encodeFrame({ id: request.id, ok: true, result: LIST_RESULT }));
        return;
      }
      live.reply(
        encodeFrame({
          id: request.id,
          ok: false,
          error: { code: "plugin_tool_failed", message: 'invalid arguments: missing required property "text"' }
        })
      );
    }) as never;
  const host = createPluginHostClient({ pluginPaths: ["/tmp/p"], auditLogs: false, spawnProcess });
  const specs = await host.toolSpecs();
  const result = await specs[0]!.execute({}, { workdir: "/tmp/w", runId: "run-1" });
  assert.equal(result.isError, true);
  assert.match(result.content, /missing required property "text"/u);
  await host.close();
});

test("close() 走优雅路径：关 stdin 让子进程自退，不直接 SIGTERM", async () => {
  const { children, spawnProcess } = happyHost();
  const host = createPluginHostClient({ pluginPaths: ["/tmp/p"], auditLogs: false, spawnProcess });
  await host.toolSpecs();
  await host.close();
  assert.equal(children[0]?.stdin.writable, false);
  assert.deepEqual(children[0]?.killed, []);
});

test("配置写成 npm 包名时降级为「没配插件」，不让 API 起不来", async () => {
  const previous = process.env.WORKHUB_PLUGIN_PATHS;
  process.env.WORKHUB_PLUGIN_PATHS = "dsh-plugin-finance-data";
  try {
    const host = createPluginHostClient({
      auditLogs: false,
      spawnProcess: (() => {
        throw new Error("不该 spawn");
      }) as unknown as PluginHostSpawn
    });
    assert.deepEqual(await host.toolSpecs(), []);
    assert.equal(host.available(), false);
    await host.close();
  } finally {
    if (previous === undefined) {
      delete process.env.WORKHUB_PLUGIN_PATHS;
    } else {
      process.env.WORKHUB_PLUGIN_PATHS = previous;
    }
  }
});
