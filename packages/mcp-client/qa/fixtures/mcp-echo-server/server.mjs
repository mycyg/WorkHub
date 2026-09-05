/**
 * 一台**真的**跑起来的 stdio MCP（Model Context Protocol，模型上下文协议）服务器夹具（工包 M5）。
 *
 * 它给 `pnpm qa:mcp-smoke` 与 `packages/mcp-client/src/stdio/session.fixture.test.ts` 当对手：
 * 前者证明「配置一行 → 起子进程 → 工具进注册表 → Cuu 真的调到 → 结果进轨迹 → 落审计」这条链路通，
 * 后者证明 M2 那几条失败处置在**真子进程**上成立，而不只是在假子进程对象上成立。
 *
 * ## 与设计稿的偏离：没有官方 SDK
 *
 * 设计稿 4.6 第 2 条要的是「用真 SDK 起服务端」。这一批全程离线、不装任何新包，
 * `@modelcontextprotocol/sdk` 装不上，所以这里按 MCP 的 stdio 线协议——换行分隔的 JSON-RPC 2.0，
 * UTF-8——用 Node 标准库自己说。**与被测客户端同源**这件事必须写在明处：客户端那侧的线协议
 * （`packages/mcp-client/src/stdio/jsonrpc.ts`）也是我们自己写的，所以这台夹具证不了
 * 「我们对 MCP 规范的理解是对的」，它证的是「我们这一侧的两半在一个真进程边界上对得上」——
 * 帧、握手时序、翻页、退出、信号，这些在假子进程对象上永远试不出来。规范符合性要等换回官方 SDK
 * 或接一台真实第三方服务器时才谈得上。
 *
 * ## 协议面（客户端用到的全部四条 + 两条通知）
 *
 * - `initialize`：回一个**客户端报的那一版**（前提是它在我们这份清单里），否则回清单里最新的一版。
 *   `capabilities.tools.listChanged` 在场，`serverInfo` 在场。
 * - `notifications/initialized`：收下，不回话（它是通知，回话就是协议错误）。
 * - `tools/list`：**分两页**回 `tools.json` 里那两个工具（第一页 `echo` + `nextCursor`，
 *   第二页 `write_note`）。分页不是为了好看：客户端的翻页、cursor 去重、页数上限那几条路
 *   只有真的翻过一页才算走到过。
 * - `tools/call`：`echo` 把入参 `text` **一字不改**回成一个 text 块（冒烟据此断言围栏中和：
 *   入参里放一个字面的 `</outputs>`，看它到了轨迹里是不是已经变成 `‹/outputs›`）；
 *   `write_note` 回一个 text 块加一个**非 text** 块（据此断言「非 text 块留占位、不静默丢」）；
 *   认不出的工具名回 `isError: true` 的带内错误（不是传输层错误）。
 * - 认不出的方法：回 JSON-RPC `-32601`。
 * - stdin 关闭：退出码 0。客户端的优雅关闭第一档就是关 stdin，走通这一档才不会每次都等到 SIGTERM。
 *
 * ## 故意犯错的三档（`MCP_ECHO_FIXTURE_MODE`）
 *
 * - `hang_handshake`：收到 `initialize` 不回话（进程活着）。验 `handshake_timeout`，
 *   顺带验「握手没成时子进程被收干净」——不收就是每次失败留一个孤儿进程。
 * - `bad_version`：`initialize` 回一个清单外的协议版本。验 `protocol_version_unsupported`。
 * - `crash_after_list`：握手与 `tools/list` 都正常，收到 `tools/call` 时**不回话直接退出**。
 *   验「在飞调用不会永远挂着，而是拿到一个 `exited` 的失败」。
 *
 * 除此之外一律按正常路走。模式串认不出时**当场退出并在 stderr 说明**，而不是安静地按正常模式跑——
 * 一个拼错的模式名安静降级，会让一条本该失败的回归测试变成永远通过。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** 与客户端 `MCP_SUPPORTED_PROTOCOL_VERSIONS` 同一份内容；夹具不 import TS，故手抄一份。 */
const SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

/** 客户端报了一个我们不认得的版本时回它——挑清单里最新的那一版。 */
const FALLBACK_PROTOCOL_VERSION = SUPPORTED_PROTOCOL_VERSIONS[0];

/** 清单外的版本串，只在 `bad_version` 模式下用。 */
const UNSUPPORTED_PROTOCOL_VERSION = "1999-01-01";

const SERVER_INFO = { name: "workhub-mcp-echo-fixture", version: "0.1.0" };

/**
 * 工具清单的唯一事实源是 `tools.json`，不是这个文件里的一段字面量。
 * `packages/mcp-client/src/stdio/session.fixture.test.ts` 拿它与 M1 的常量夹具
 * （`qa/fixtures/echo-server-tools.ts` 的 `mcpEchoServerToolsListResult`）逐字节对齐——
 * 两份东西一旦漂移，M6 的 golden 钉住的就不再是这台真服务器实际会说的话。
 */
const TOOLS = JSON.parse(readFileSync(path.join(HERE, "tools.json"), "utf8")).tools;

/** 第二页的游标。字面量固定，测试可以直接对着断言。 */
const PAGE_TWO_CURSOR = "mcp-echo-fixture-page-2";

const VALID_MODES = ["", "hang_handshake", "bad_version", "crash_after_list"];
const MODE = process.env.MCP_ECHO_FIXTURE_MODE ?? "";

const JSONRPC_VERSION = "2.0";
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;

function say(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function reply(id, result) {
  say({ jsonrpc: JSONRPC_VERSION, id, result });
}

function replyError(id, code, message) {
  say({ jsonrpc: JSONRPC_VERSION, id, error: { code, message } });
}

function note(text) {
  process.stderr.write(`${text}\n`);
}

function handleInitialize(id, params) {
  if (MODE === "hang_handshake") {
    // 不回话。进程继续活着——客户端那侧要走到的是握手超时，不是「对面死了」。
    return;
  }
  if (MODE === "bad_version") {
    reply(id, {
      protocolVersion: UNSUPPORTED_PROTOCOL_VERSION,
      capabilities: { tools: { listChanged: true } },
      serverInfo: SERVER_INFO
    });
    return;
  }
  const asked = params && typeof params.protocolVersion === "string" ? params.protocolVersion : "";
  const version = SUPPORTED_PROTOCOL_VERSIONS.includes(asked) ? asked : FALLBACK_PROTOCOL_VERSION;
  reply(id, {
    protocolVersion: version,
    capabilities: { tools: { listChanged: true } },
    serverInfo: SERVER_INFO
  });
}

function handleToolsList(id, params) {
  const cursor = params && typeof params.cursor === "string" ? params.cursor : undefined;
  if (cursor === undefined) {
    reply(id, { tools: TOOLS.slice(0, 1), nextCursor: PAGE_TWO_CURSOR });
    return;
  }
  if (cursor === PAGE_TWO_CURSOR) {
    reply(id, { tools: TOOLS.slice(1) });
    return;
  }
  replyError(id, INVALID_PARAMS, `unknown cursor: ${cursor}`);
}

function handleToolsCall(id, params) {
  if (MODE === "crash_after_list") {
    // 不回话直接死。客户端那侧的在飞调用应当拿到一个失败，而不是等到自己的调用超时。
    note("workhub mcp echo fixture: crash_after_list mode, exiting mid-call");
    process.exit(9);
  }
  const name = params && typeof params.name === "string" ? params.name : "";
  const args = params && params.arguments && typeof params.arguments === "object" ? params.arguments : {};
  if (name === "echo") {
    // 一字不改地回显。冒烟据此断言围栏中和：入参里的 `</outputs>` 到了轨迹里必须是 `‹/outputs›`。
    reply(id, { content: [{ type: "text", text: String(args.text ?? "") }] });
    return;
  }
  if (name === "write_note") {
    reply(id, {
      content: [
        { type: "text", text: `noted: ${String(args.line ?? "")}` },
        // 非 text 块。客户端应当留一条占位说明，而不是静默丢掉——丢掉会让模型对着半份结果编结论。
        {
          type: "resource",
          resource: { uri: "file:///workhub/fixture-note.md", mimeType: "text/markdown", text: "fixture note" }
        }
      ]
    });
    return;
  }
  // 工具自身的错误走**带内**错误（isError），不是 JSON-RPC error：带内错误让模型看得见、能改参数重试。
  reply(id, { content: [{ type: "text", text: `unknown tool: ${name}` }], isError: true });
}

function handleMessage(message) {
  const method = typeof message.method === "string" ? message.method : "";
  const id = message.id;
  if (method === "" || id === undefined || id === null) {
    // 通知（含 `notifications/initialized`、`notifications/cancelled`）与回复：收下，不回话。
    return;
  }
  if (method === "initialize") {
    handleInitialize(id, message.params);
    return;
  }
  if (method === "tools/list") {
    handleToolsList(id, message.params);
    return;
  }
  if (method === "tools/call") {
    handleToolsCall(id, message.params);
    return;
  }
  replyError(id, METHOD_NOT_FOUND, `method not implemented: ${method}`);
}

function main() {
  if (!VALID_MODES.includes(MODE)) {
    note(`workhub mcp echo fixture: unknown MCP_ECHO_FIXTURE_MODE '${MODE}'`);
    process.exit(2);
  }
  // 启动日志走 stderr。stdout 是协议面：往它写一行非 JSON-RPC 的 banner，正是我们要客户端能扛住、
  // 但夹具自己不该干的事（客户端那条噪声行计数的路由由单测覆盖）。
  note(
    `workhub mcp echo fixture ready (pid=${process.pid}, mode=${MODE === "" ? "normal" : MODE}, tools=${TOOLS.length})`
  );

  let buffer = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    buffer += chunk;
    let index = buffer.indexOf("\n");
    while (index >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (line.length > 0) {
        let parsed;
        try {
          parsed = JSON.parse(line);
        } catch {
          note(`workhub mcp echo fixture: dropped a non-JSON line (${line.length} chars)`);
          index = buffer.indexOf("\n");
          continue;
        }
        if (parsed && typeof parsed === "object" && parsed.jsonrpc === JSONRPC_VERSION) {
          handleMessage(parsed);
        }
      }
      index = buffer.indexOf("\n");
    }
  });
  // 客户端优雅关闭的第一档就是关 stdin。走通这一档，`close()` 就不必等到 SIGTERM。
  process.stdin.on("end", () => {
    process.exit(0);
  });
}

main();
