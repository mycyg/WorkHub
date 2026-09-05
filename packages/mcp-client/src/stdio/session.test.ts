import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import {
  createJsonRpcLineDecoder,
  encodeJsonRpcLine,
  JSONRPC_VERSION,
  type JsonRpcInbound
} from "./jsonrpc.js";
import {
  createMcpStdioSession,
  MCP_CLIENT_PROTOCOL_VERSION,
  McpSessionError,
  type McpChildProcessLike,
  type McpServerSpawn
} from "./session.js";

type FakeChild = EventEmitter &
  McpChildProcessLike & {
    /** 客户端发过来的每一条消息。 */
    inbox: JsonRpcInbound[];
    killed: string[];
    say: (line: string) => void;
    sayErr: (chunk: string) => void;
    exit: (code: number) => void;
    stdinEnded: boolean;
  };

/**
 * 一个假的 MCP 服务器子进程：收下客户端写来的行，交给 `respond` 决定怎么回。
 * 套路与 `apps/api/src/plugin-host-client.test.ts` 的 `fakeChild` 一致。
 */
function fakeChild(respond: (message: JsonRpcInbound, child: FakeChild) => void): FakeChild {
  const child = new EventEmitter() as FakeChild;
  const decoder = createJsonRpcLineDecoder();
  child.inbox = [];
  child.killed = [];
  child.stdinEnded = false;
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
      child.stdinEnded = true;
      child.stdin.writable = false;
      setImmediate(() => child.exit(0));
    }
  };
  child.kill = (signal?: NodeJS.Signals) => {
    child.killed.push(signal ?? "SIGTERM");
    return true;
  };
  child.say = (line: string) => (stdout as unknown as EventEmitter).emit("data", line);
  child.sayErr = (chunk: string) => (stderr as unknown as EventEmitter).emit("data", chunk);
  child.exit = (code: number) => {
    child.stdin.writable = false;
    child.emit("exit", code, null);
  };
  return child;
}

/** 超时定时器是 unref 的（MCP 面绝不该拖住 API 进程退出），测试里给一个 ref 住的心跳撑到断言做完。 */
async function keepingEventLoopAlive<T>(run: () => Promise<T>): Promise<T> {
  const heartbeat = setInterval(() => undefined, 5);
  try {
    return await run();
  } finally {
    clearInterval(heartbeat);
  }
}

function idOf(message: JsonRpcInbound): number {
  return (message as { id: number }).id;
}

function methodOf(message: JsonRpcInbound): string {
  return (message as { method?: string }).method ?? "";
}

const ECHO_TOOL = {
  name: "echo",
  description: "Echo a phrase back.",
  inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
  annotations: { readOnlyHint: true }
};

type ServerScript = {
  /** 覆盖 initialize 回的协议版本。 */
  protocolVersion?: string;
  /** 不回 initialize（测握手超时）。 */
  silentInitialize?: boolean;
  /** 声明 tools 能力（缺省 true）。 */
  hasTools?: boolean;
  /** `tools/list` 的分页脚本；缺省一页 echo。 */
  pages?: { tools: unknown[]; nextCursor?: string }[];
  /** `tools/call` 的回法；缺省回一个 text 块。 */
  onCall?: (message: JsonRpcInbound, child: FakeChild) => void;
};

function scriptedServer(script: ServerScript = {}) {
  const children: FakeChild[] = [];
  const spawns: { command: string; args: string[]; env: Record<string, string>; cwd: string | undefined }[] = [];
  let page = 0;
  const spawnProcess: McpServerSpawn = (input) => {
    spawns.push(input);
    const child = fakeChild((message, live) => {
      const method = methodOf(message);
      if (method === "initialize") {
        if (script.silentInitialize) {
          return;
        }
        live.say(
          encodeJsonRpcLine({
            jsonrpc: JSONRPC_VERSION,
            id: idOf(message),
            result: {
              protocolVersion: script.protocolVersion ?? MCP_CLIENT_PROTOCOL_VERSION,
              capabilities: (script.hasTools ?? true) ? { tools: { listChanged: true } } : { resources: {} },
              serverInfo: { name: "fake", version: "0.0.1" }
            }
          })
        );
        return;
      }
      if (method === "tools/list") {
        const pages = script.pages ?? [{ tools: [ECHO_TOOL] }];
        const body = pages[Math.min(page, pages.length - 1)] ?? { tools: [] };
        page += 1;
        live.say(encodeJsonRpcLine({ jsonrpc: JSONRPC_VERSION, id: idOf(message), result: body }));
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
    return child;
  };
  return { children, spawns, spawnProcess };
}

function sessionOn(server: ReturnType<typeof scriptedServer>, overrides: Record<string, unknown> = {}) {
  return createMcpStdioSession({
    serverName: "fake",
    command: "/usr/local/bin/fake-mcp",
    args: ["--stdio"],
    env: { PATH: "/usr/bin" },
    spawnProcess: server.spawnProcess,
    handshakeTimeoutMs: 200,
    ...overrides
  });
}

test("握手：报我们的版本、收下服务器的版本、随后发 initialized", async () => {
  const server = scriptedServer();
  const session = sessionOn(server);
  const handshake = await session.start();
  assert.equal(handshake.protocolVersion, MCP_CLIENT_PROTOCOL_VERSION);
  assert.equal(handshake.hasTools, true);
  assert.equal(handshake.toolsListChanged, true);
  assert.deepEqual(handshake.serverInfo, { name: "fake", version: "0.0.1" });
  const child = server.children[0];
  assert.ok(child);
  assert.equal(methodOf(child.inbox[0]!), "initialize");
  assert.equal(
    ((child.inbox[0] as { params?: { protocolVersion?: string } }).params ?? {}).protocolVersion,
    MCP_CLIENT_PROTOCOL_VERSION
  );
  assert.equal(methodOf(child.inbox[1]!), "notifications/initialized");
  assert.equal((child.inbox[1] as { id?: unknown }).id, undefined, "通知不带 id");
  assert.equal(server.spawns[0]?.args.join(" "), "--stdio");
  await session.close();
});

test("握手：服务器回一个更老但已知的版本，照常接受", async () => {
  const server = scriptedServer({ protocolVersion: "2024-11-05" });
  const session = sessionOn(server);
  const handshake = await session.start();
  assert.equal(handshake.protocolVersion, "2024-11-05");
  await session.close();
});

test("握手：认不出的协议版本直接断开并报 protocol_version_unsupported", async () => {
  const server = scriptedServer({ protocolVersion: "3000-01-01" });
  const session = sessionOn(server);
  await assert.rejects(
    () => session.start(),
    (error: unknown) => {
      assert.ok(error instanceof McpSessionError);
      assert.equal(error.reason, "protocol_version_unsupported");
      assert.match(error.message, /3000-01-01/u);
      return true;
    }
  );
  assert.equal(server.children[0]?.stdinEnded, true, "握手失败要把子进程收干净，不留孤儿");
  assert.equal(session.isLive(), false);
});

test("握手：服务器根本不回话 → handshake_timeout", async () => {
  await keepingEventLoopAlive(async () => {
    const server = scriptedServer({ silentInitialize: true });
    const session = sessionOn(server, { handshakeTimeoutMs: 30 });
    await assert.rejects(
      () => session.start(),
      (error: unknown) => {
        assert.ok(error instanceof McpSessionError);
        assert.equal(error.reason, "handshake_timeout");
        return true;
      }
    );
  });
});

test("关掉之后不许再起：一个会话对象只对应一个子进程", async () => {
  const server = scriptedServer();
  const session = sessionOn(server);
  await session.start();
  await session.close();
  await assert.rejects(() => session.start(), /is closed/u);
  assert.equal(server.spawns.length, 1);
});

test("列工具：跟 cursor 翻页到底", async () => {
  const server = scriptedServer({
    pages: [
      { tools: [{ ...ECHO_TOOL, name: "a" }], nextCursor: "c1" },
      { tools: [{ ...ECHO_TOOL, name: "b" }], nextCursor: "c2" },
      { tools: [{ ...ECHO_TOOL, name: "c" }] }
    ]
  });
  const session = sessionOn(server);
  const tools = await session.listTools();
  assert.deepEqual(tools.map((tool) => tool.name), ["a", "b", "c"]);
  const cursors = (server.children[0]?.inbox ?? [])
    .filter((message) => methodOf(message) === "tools/list")
    .map((message) => (message as { params?: { cursor?: string } }).params?.cursor);
  assert.deepEqual(cursors, [undefined, "c1", "c2"]);
  await session.close();
});

test("列工具：同一个 cursor 回第二次 = 协议错误（不陪它转圈）", async () => {
  const server = scriptedServer({
    pages: [
      { tools: [], nextCursor: "loop" },
      { tools: [], nextCursor: "loop" }
    ]
  });
  const session = sessionOn(server);
  await assert.rejects(
    () => session.listTools(),
    (error: unknown) => {
      assert.ok(error instanceof McpSessionError);
      assert.equal(error.reason, "protocol_error");
      assert.match(error.message, /repeated tools\/list cursor/u);
      return true;
    }
  );
  await session.close();
});

test("列工具：翻满页数上限仍不到底 → 整代拒绝，不留半套", async () => {
  const server = scriptedServer({ pages: [{ tools: [ECHO_TOOL], nextCursor: "p" }] });
  // 每页给一个新 cursor，逼它一直翻。
  let counter = 0;
  const spawnProcess: McpServerSpawn = (input) => {
    const child = fakeChild((message, live) => {
      const method = methodOf(message);
      if (method === "initialize") {
        live.say(
          encodeJsonRpcLine({
            jsonrpc: JSONRPC_VERSION,
            id: idOf(message),
            result: { protocolVersion: MCP_CLIENT_PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: {} }
          })
        );
        return;
      }
      if (method === "tools/list") {
        counter += 1;
        live.say(
          encodeJsonRpcLine({
            jsonrpc: JSONRPC_VERSION,
            id: idOf(message),
            result: { tools: [], nextCursor: `page-${counter}` }
          })
        );
      }
    });
    server.children.push(child);
    server.spawns.push(input);
    return child;
  };
  const session = sessionOn(server, { spawnProcess });
  await assert.rejects(() => session.listTools(), /did not finish tools\/list within 20 pages/u);
  assert.equal(counter, 20);
  await session.close();
});

test("列工具：服务器没声明 tools 能力就不发那条注定被拒的请求", async () => {
  const server = scriptedServer({ hasTools: false });
  const session = sessionOn(server);
  assert.deepEqual(await session.listTools(), []);
  assert.equal(
    (server.children[0]?.inbox ?? []).some((message) => methodOf(message) === "tools/list"),
    false
  );
  await session.close();
});

test("调工具：按名字与参数发 tools/call，原样拿回结果", async () => {
  const server = scriptedServer();
  const session = sessionOn(server);
  const result = await session.callTool({ name: "echo", args: { text: "hi" }, timeoutMs: 200 });
  assert.deepEqual(result, { content: [{ type: "text", text: "pong" }] });
  const call = (server.children[0]?.inbox ?? []).find((message) => methodOf(message) === "tools/call");
  assert.deepEqual((call as { params?: unknown }).params, { name: "echo", arguments: { text: "hi" } });
  await session.close();
});

test("调工具：服务器回 JSON-RPC error → server_error（不是我们的传输坏了）", async () => {
  const server = scriptedServer({
    onCall: (message, live) =>
      live.say(
        encodeJsonRpcLine({
          jsonrpc: JSONRPC_VERSION,
          id: idOf(message),
          error: { code: -32602, message: "unknown tool" }
        })
      )
  });
  const session = sessionOn(server);
  await assert.rejects(
    () => session.callTool({ name: "nope", args: {}, timeoutMs: 200 }),
    (error: unknown) => {
      assert.ok(error instanceof McpSessionError);
      assert.equal(error.reason, "server_error");
      assert.match(error.message, /unknown tool/u);
      return true;
    }
  );
  await session.close();
});

test("调工具：超时按服务器行的上限算，并给对面发 notifications/cancelled", async () => {
  await keepingEventLoopAlive(async () => {
    const server = scriptedServer({ onCall: () => undefined });
    const session = sessionOn(server);
    await assert.rejects(
      () => session.callTool({ name: "echo", args: {}, timeoutMs: 25 }),
      (error: unknown) => {
        assert.ok(error instanceof McpSessionError);
        assert.equal(error.reason, "call_timeout");
        assert.match(error.message, /25ms/u);
        return true;
      }
    );
    const cancelled = (server.children[0]?.inbox ?? []).find(
      (message) => methodOf(message) === "notifications/cancelled"
    );
    assert.ok(cancelled, "放弃一个请求要通知对面，否则服务器一直算着它还在跑");
    await session.close();
  });
});

test("超时之后迟到的回复不会串到下一次调用上", async () => {
  await keepingEventLoopAlive(async () => {
    const late: { message: JsonRpcInbound; child: FakeChild }[] = [];
    const server = scriptedServer({ onCall: (message, live) => late.push({ message, child: live }) });
    const session = sessionOn(server);
    await assert.rejects(() => session.callTool({ name: "echo", args: {}, timeoutMs: 20 }), /timed out/u);
    const first = late[0];
    assert.ok(first);
    first.child.say(
      encodeJsonRpcLine({
        jsonrpc: JSONRPC_VERSION,
        id: idOf(first.message),
        result: { content: [{ type: "text", text: "late" }] }
      })
    );
    // 第二次调用必须拿到它自己的那条回复。
    const second = session.callTool({ name: "echo", args: {}, timeoutMs: 200 });
    await new Promise((resolve) => setTimeout(resolve, 10));
    const pendingCall = late[1];
    assert.ok(pendingCall);
    pendingCall.child.say(
      encodeJsonRpcLine({
        jsonrpc: JSONRPC_VERSION,
        id: idOf(pendingCall.message),
        result: { content: [{ type: "text", text: "mine" }] }
      })
    );
    assert.deepEqual(await second, { content: [{ type: "text", text: "mine" }] });
    await session.close();
  });
});

test("服务器反过来请求我们：一律回 -32601，不实现 sampling/roots/elicitation", async () => {
  const server = scriptedServer();
  const session = sessionOn(server);
  await session.start();
  const child = server.children[0];
  assert.ok(child);
  const before = child.inbox.length;
  child.say(
    encodeJsonRpcLine({
      jsonrpc: JSONRPC_VERSION,
      id: "srv-1",
      method: "sampling/createMessage",
      params: { messages: [] }
    })
  );
  await new Promise((resolve) => setImmediate(resolve));
  const reply = child.inbox[before] as unknown as { id: string; error: { code: number } };
  assert.equal(reply.id, "srv-1");
  assert.equal(reply.error.code, -32601);
  await session.close();
});

test("notifications/tools/list_changed 把清单标脏，取一次清单就干净了", async () => {
  const server = scriptedServer();
  const changed: number[] = [];
  const session = sessionOn(server, { onToolsChanged: () => changed.push(1) });
  await session.listTools();
  assert.equal(session.toolsDirty(), false);
  server.children[0]?.say(encodeJsonRpcLine({ jsonrpc: JSONRPC_VERSION, method: "notifications/tools/list_changed" }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(session.toolsDirty(), true);
  assert.equal(changed.length, 1);
  await session.listTools();
  assert.equal(session.toolsDirty(), false);
  await session.close();
});

test("认不出的通知（进度、日志）安静忽略，不当协议错误", async () => {
  const server = scriptedServer();
  const session = sessionOn(server);
  await session.start();
  server.children[0]?.say(
    encodeJsonRpcLine({ jsonrpc: JSONRPC_VERSION, method: "notifications/message", params: { level: "info" } })
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(session.isLive(), true);
  await session.close();
});

test("超长帧 = 协议错误：断开、在飞调用失败、退出按「非预期」报给上层", async () => {
  await keepingEventLoopAlive(async () => {
    const exits: { expected: boolean }[] = [];
    const server = scriptedServer({ onCall: () => undefined });
    const session = sessionOn(server, {
      maxLineBytes: 512,
      onExit: (info: { expected: boolean }) => exits.push(info)
    });
    await session.start();
    const inflight = session.callTool({ name: "echo", args: {}, timeoutMs: 5_000 });
    await new Promise((resolve) => setImmediate(resolve));
    server.children[0]?.say(`{"jsonrpc":"2.0","id":99,"result":"${"x".repeat(2_000)}"}\n`);
    await assert.rejects(inflight, (error: unknown) => {
      assert.ok(error instanceof McpSessionError);
      assert.equal(error.reason, "protocol_error");
      return true;
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(exits.length, 1);
    assert.equal(exits[0]?.expected, false, "协议崩了要计进重连预算，不能当成我们自己关的");
  });
});

test("stdout 噪声只计数，不影响正常帧", async () => {
  const server = scriptedServer();
  const session = sessionOn(server);
  await session.start();
  server.children[0]?.say("Server listening on stdio\n");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(session.droppedLines(), 1);
  assert.deepEqual((await session.listTools()).map((tool) => tool.name), ["echo"]);
  await session.close();
});

test("stderr 有界捕获尾部，不无限长", async () => {
  const server = scriptedServer();
  const session = sessionOn(server);
  await session.start();
  server.children[0]?.sayErr("A".repeat(9000));
  server.children[0]?.sayErr("TAIL");
  const tail = session.stderrTail();
  assert.equal(tail.length, 8 * 1024);
  assert.equal(tail.endsWith("TAIL"), true);
  await session.close();
});

test("子进程崩掉时在飞调用得到 exited 错误，退出事件报「非预期」", async () => {
  await keepingEventLoopAlive(async () => {
    const exits: { expected: boolean; code: number | null }[] = [];
    const server = scriptedServer({ onCall: () => undefined });
    const session = sessionOn(server, { onExit: (info: { expected: boolean; code: number | null }) => exits.push(info) });
    await session.start();
    const inflight = session.callTool({ name: "echo", args: {}, timeoutMs: 5_000 });
    await new Promise((resolve) => setImmediate(resolve));
    server.children[0]?.exit(9);
    await assert.rejects(inflight, (error: unknown) => {
      assert.ok(error instanceof McpSessionError);
      assert.equal(error.reason, "exited");
      return true;
    });
    assert.deepEqual(exits, [{ expected: false, code: 9, signal: null }]);
    assert.equal(session.isLive(), false);
  });
});

test("优雅关闭：先关 stdin 等自退，正常退出不发信号", async () => {
  const server = scriptedServer();
  const session = sessionOn(server);
  await session.start();
  await session.close();
  const child = server.children[0];
  assert.equal(child?.stdinEnded, true);
  assert.deepEqual(child?.killed, []);
});

test("优雅关闭：赖着不退就 SIGTERM，再不退就 SIGKILL", async () => {
  await keepingEventLoopAlive(async () => {
    const server = scriptedServer();
    const session = sessionOn(server);
    await session.start();
    const child = server.children[0];
    assert.ok(child);
    // 一个装了 SIGTERM 处理器却退不干净的第三方进程。
    child.stdin.end = () => {
      child.stdinEnded = true;
      child.stdin.writable = false;
    };
    const closing = session.close();
    await new Promise((resolve) => setTimeout(resolve, 4_200));
    await closing;
    assert.deepEqual(child.killed, ["SIGTERM", "SIGKILL"]);
  });
});

test("会话没起来就调工具：起进程失败时报 spawn_failed", async () => {
  await keepingEventLoopAlive(async () => {
    const child = fakeChild(() => undefined);
    const session = createMcpStdioSession({
      serverName: "fake",
      command: "/nope",
      env: {},
      handshakeTimeoutMs: 500,
      spawnProcess: () => {
        setImmediate(() => child.emit("error", new Error("spawn /nope ENOENT")));
        return child;
      }
    });
    await assert.rejects(
      () => session.start(),
      (error: unknown) => {
        assert.ok(error instanceof McpSessionError);
        assert.equal(error.reason, "spawn_failed");
        assert.match(error.message, /ENOENT/u);
        return true;
      }
    );
  });
});
