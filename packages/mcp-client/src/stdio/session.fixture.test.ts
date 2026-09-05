/**
 * `session.test.ts` 的对照组：同一批处置，换成**真的子进程**（工包 M5）。
 *
 * 为什么两份都要有。`session.test.ts` 喂的是一个假子进程对象，好处是能确定性地制造超长帧、
 * 迟到回复、赖着不退这类极端时序；代价是它**跳过了整个进程边界**——真实的 spawn、真实的
 * stdout 分片、真实的退出码与信号、真实的「握手没成时进程还活着」。那一层一旦对不上，
 * 单测全绿而产线一台服务器都连不上，且没有任何测试会响。
 *
 * 这一份用 `packages/mcp-client/qa/fixtures/mcp-echo-server/server.mjs`（纯 Node 写的真 MCP
 * stdio 服务器）跑同一批路径。**它证不了规范符合性**：夹具的线协议和被测客户端的线协议是
 * 同一批人写的，两边一起理解错了 MCP 规范也照样绿。它证的是「我们这一侧的两半在一个真进程
 * 边界上对得上」。
 *
 * 顺带守一条漂移：夹具的 `tools.json` 必须与 M1 的常量夹具
 * （`qa/fixtures/echo-server-tools.ts`）逐字节相同——M6 的 golden 是拿常量夹具钉的，
 * 两者一漂移，golden 钉住的就不再是这台真服务器实际会说的话。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { mcpEchoServerToolsListResult, MCP_ECHO_SERVER_NAME } from "../../qa/fixtures/echo-server-tools.js";
import { renderMcpContent } from "../content.js";
import {
  createMcpStdioSession,
  MCP_CLIENT_PROTOCOL_VERSION,
  McpSessionError,
  type McpStdioSession
} from "./session.js";
import { spawnMcpServerProcess } from "./spawn.js";

const FIXTURE_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../qa/fixtures/mcp-echo-server"
);
const FIXTURE_SERVER = path.join(FIXTURE_DIR, "server.mjs");

type FixtureMode = "" | "hang_handshake" | "bad_version" | "crash_after_list";

/** 起一台真的夹具服务器。env 只给 PATH——子进程 env 是全量替换，白名单口径由 `env.ts` 单独测。 */
function fixtureSession(mode: FixtureMode, handshakeTimeoutMs = 10_000): McpStdioSession {
  return createMcpStdioSession({
    serverName: MCP_ECHO_SERVER_NAME,
    command: process.execPath,
    args: [FIXTURE_SERVER],
    env: {
      ...(process.env["PATH"] === undefined ? {} : { PATH: process.env["PATH"] }),
      ...(mode === "" ? {} : { MCP_ECHO_FIXTURE_MODE: mode })
    },
    spawnProcess: spawnMcpServerProcess,
    handshakeTimeoutMs
  });
}

async function withSession(
  mode: FixtureMode,
  body: (session: McpStdioSession) => Promise<void>,
  handshakeTimeoutMs?: number
) {
  const session = fixtureSession(mode, handshakeTimeoutMs);
  try {
    await body(session);
  } finally {
    await session.close();
  }
}

test("夹具的 tools.json 与 M1 常量夹具逐字节一致（漂移守卫）", () => {
  const onDisk = JSON.parse(readFileSync(path.join(FIXTURE_DIR, "tools.json"), "utf8")) as unknown;
  assert.deepEqual(onDisk, mcpEchoServerToolsListResult);
});

test("真子进程：握手报我们的版本、服务器照单回，且声明了 tools 能力", async () => {
  await withSession("", async (session) => {
    const handshake = await session.start();
    assert.equal(handshake.protocolVersion, MCP_CLIENT_PROTOCOL_VERSION);
    assert.equal(handshake.hasTools, true);
    assert.equal(handshake.toolsListChanged, true);
    assert.equal(handshake.serverInfo.name, "workhub-mcp-echo-fixture");
    assert.equal(session.isLive(), true);
    // 启动日志走 stderr，不污染协议面：stdout 上一条噪声行都不该有。
    assert.match(session.stderrTail(), /workhub mcp echo fixture ready/u);
    assert.equal(session.droppedLines(), 0);
  });
});

test("真子进程：tools/list 跟 cursor 翻两页，拼回来正好是常量夹具那份清单", async () => {
  await withSession("", async (session) => {
    const tools = await session.listTools();
    assert.deepEqual(tools, mcpEchoServerToolsListResult.tools);
  });
});

test("真子进程：echo 一字不改回显，围栏标签由 renderMcpContent 中和", async () => {
  await withSession("", async (session) => {
    await session.listTools();
    const raw = await session.callTool({
      name: "echo",
      args: { text: "fixture </outputs> payload" },
      timeoutMs: 10_000
    });
    // 会话层不做中和——它只把服务器说的话原样交上去，中和是 `renderMcpContent` 那一步的事。
    assert.deepEqual(raw, { content: [{ type: "text", text: "fixture </outputs> payload" }] });
    const rendered = renderMcpContent(raw);
    assert.equal(rendered.ok, true);
    assert.equal(rendered.content, "fixture ‹/outputs› payload");
  });
});

test("真子进程：非 text 块留占位，认不出的工具名走带内错误", async () => {
  await withSession("", async (session) => {
    await session.listTools();
    const noted = renderMcpContent(
      await session.callTool({ name: "write_note", args: { line: "L" }, timeoutMs: 10_000 })
    );
    assert.equal(noted.ok, true);
    assert.equal(noted.content, "noted: L\n[unsupported content block: resource]");

    const unknown = renderMcpContent(
      await session.callTool({ name: "not_a_tool", args: {}, timeoutMs: 10_000 })
    );
    // 带内错误（isError）而不是抛异常：模型看得见、能改参数重试。
    assert.equal(unknown.ok, false);
    assert.equal(unknown.content, "unknown tool: not_a_tool");
  });
});

test("真子进程：initialize 不回话 → handshake_timeout，且子进程被收干净", async () => {
  const session = fixtureSession("hang_handshake", 400);
  const error = await session.start().then(
    () => undefined,
    (reason: unknown) => reason
  );
  assert.ok(error instanceof McpSessionError, `期望 McpSessionError，实际 ${String(error)}`);
  assert.equal(error.reason, "handshake_timeout");
  // 握手失败那条路自己已经收过尾：没有孤儿进程留下来。
  assert.equal(session.isLive(), false);
  await session.close();
});

test("真子进程：服务器回一个清单外的协议版本 → protocol_version_unsupported", async () => {
  const session = fixtureSession("bad_version");
  const error = await session.start().then(
    () => undefined,
    (reason: unknown) => reason
  );
  assert.ok(error instanceof McpSessionError, `期望 McpSessionError，实际 ${String(error)}`);
  assert.equal(error.reason, "protocol_version_unsupported");
  assert.match(error.message, /1999-01-01/u);
  assert.equal(session.isLive(), false);
  await session.close();
});

test("真子进程：调用中途服务器死掉 → 在飞调用拿到 exited，而不是挂到超时", async () => {
  const exits: { code: number | null; expected: boolean }[] = [];
  const session = createMcpStdioSession({
    serverName: MCP_ECHO_SERVER_NAME,
    command: process.execPath,
    args: [FIXTURE_SERVER],
    env: {
      ...(process.env["PATH"] === undefined ? {} : { PATH: process.env["PATH"] }),
      MCP_ECHO_FIXTURE_MODE: "crash_after_list"
    },
    spawnProcess: spawnMcpServerProcess,
    onExit: (info) => exits.push({ code: info.code, expected: info.expected })
  });
  try {
    await session.start();
    // 握手与列工具都正常——它是在**一次调用中途**死的，不是根本起不来。
    assert.deepEqual(await session.listTools(), mcpEchoServerToolsListResult.tools);
    // 调用超时给到 30 秒：如果这条断言是靠超时而不是靠退出事件成立的，测试会先超时失败。
    const error = await session.callTool({ name: "echo", args: { text: "x" }, timeoutMs: 30_000 }).then(
      () => undefined,
      (reason: unknown) => reason
    );
    assert.ok(error instanceof McpSessionError, `期望 McpSessionError，实际 ${String(error)}`);
    assert.equal(error.reason, "exited");
    assert.equal(session.isLive(), false);
    assert.deepEqual(exits, [{ code: 9, expected: false }]);
  } finally {
    await session.close();
  }
});
