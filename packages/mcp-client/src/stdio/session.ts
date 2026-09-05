/**
 * 一台 stdio MCP 服务器的一次会话：spawn、握手、列工具、调工具、优雅关闭（工包 M2）。
 *
 * ## 为什么手写而不是用官方 SDK
 *
 * 设计稿写的是「用 `@modelcontextprotocol/sdk`」。这一批**离线施工**，不引入任何新的第三方包，
 * 所以这里按 MCP 的 stdio 线协议（换行分隔的 JSON-RPC 2.0）自建一个最小客户端。
 * 这不是「重造轮子」的一次冒险：仓库里 `packages/plugin-host/src/protocol.ts` 与
 * `apps/api/src/services/plugin-host-client.ts` 已经有一套同形状的子进程 RPC 客户端与监督逻辑，
 * 本文件是照那套长的；我们用到的协议面只有 `initialize` / `notifications/initialized` /
 * `tools/list` / `tools/call` 四条加两条通知，全部在这里逐条实现并逐条测。
 * 代价要写在明处：**协议面是我们自己维护的**，MCP 规范加了新东西不会自动跟上；
 * 换回官方 SDK 的时候，替换点就是这一个文件（`index.ts` 依旧零 IO，与 plugin-host 把 Cordis
 * 关在 `host.ts` 是同一个理由）。
 *
 * ## 这一层不做什么
 *
 * 不做重连、不做连接缓存、不做审计、不读数据库、不认识工作区。会话就是会话：它起来、它说话、
 * 它死掉。上面那些是 `apps/api/src/services/mcp-client.ts` 的事——两层分开才可能各自单测。
 *
 * ## 服务器发过来的请求一律不实现
 *
 * `sampling/createMessage`（服务器反过来花我们的模型预算）、`roots/list`、`elicitation/create`
 * 全部回 JSON-RPC `-32601`。sampling 尤其不能实现：WorkHub 的成本/预算/评审门全挂在一次
 * agent 执行上，服务器自己发起的补全没有可归属的执行，记不了账（设计稿 4.8）。
 * 回 `-32601` 而不是沉默，是因为沉默会让对面一直等到它自己的超时。
 */
import type { McpToolDefinition } from "../to-tool-spec.js";
import {
  createJsonRpcLineDecoder,
  encodeJsonRpcLine,
  isJsonRpcCall,
  isJsonRpcFailure,
  isJsonRpcRequest,
  JSONRPC_METHOD_NOT_FOUND,
  JSONRPC_VERSION,
  MCP_STDIO_MAX_LINE_BYTES,
  type JsonRpcId,
  type JsonRpcInbound
} from "./jsonrpc.js";

/** 我们自报的协议版本。 */
export const MCP_CLIENT_PROTOCOL_VERSION = "2025-06-18";

/**
 * 能接受的服务器协议版本。
 *
 * MCP 的版本协商是「客户端报自己最新的，服务器回它要用的那一版」。服务器回一个**更老**的
 * 版本是常态（它就是老服务器），而我们用到的四条方法在这几版之间形状不变，所以放行；
 * 回一个我们没见过的版本则一律断开——「不认识但先连上试试」意味着我们在对一份没读过的
 * 协议做兼容性猜测，而猜错的表现是调用悄悄送错形状，不是一个响亮的错误。
 *
 * **加一版要过 Agent Note**（与 `env.ts` 的白名单同一条纪律）：加进来等于宣称我们读过那一版的
 * 差异并确认这四条方法没变。
 */
export const MCP_SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"] as const;

/** 握手（spawn + initialize）超时。装不上就别拖着一次执行。 */
export const MCP_HANDSHAKE_TIMEOUT_MS = 10_000;

/** `tools/list` 跟 cursor 翻页的页数上限。 */
export const MCP_TOOLS_LIST_MAX_PAGES = 20;

/** stderr 尾部保留的字符数（UTF-16 码元）。诊断用，不是日志管道。 */
export const MCP_STDERR_TAIL_CHARS = 8 * 1024;

/** 关 stdin 之后等自退的时间；超时发 SIGTERM。 */
export const MCP_SHUTDOWN_GRACE_MS = 2_000;

/** SIGTERM 之后再等的时间；还不退就 SIGKILL。 */
export const MCP_SIGKILL_GRACE_MS = 2_000;

/** 一次会话失败的稳定原因码。英文诊断，人话由展示层按码出（`services/plugins.ts` 的既有纪律）。 */
export type McpSessionFailureReason =
  /** 子进程根本没起来（命令不存在、没有执行权限）。 */
  | "spawn_failed"
  /** 起来了但没在超时内握上手。 */
  | "handshake_timeout"
  /** 服务器回了一个我们不认识的协议版本。 */
  | "protocol_version_unsupported"
  /** 线协议本身坏了：超长帧、翻页不收敛。 */
  | "protocol_error"
  /** 服务器回了一条 JSON-RPC error（它自己说这次请求它办不了）。 */
  | "server_error"
  /** 单次调用超时。 */
  | "call_timeout"
  /** 会话没在运行（还没 start，或者已经关了）。 */
  | "not_running"
  /** 会话运行期间子进程退出了。 */
  | "exited";

export class McpSessionError extends Error {
  readonly reason: McpSessionFailureReason;
  constructor(reason: McpSessionFailureReason, message: string) {
    super(message);
    this.name = "McpSessionError";
    this.reason = reason;
  }
}

/** 子进程 stdout/stderr 的最小形状。真实的 `ChildProcessWithoutNullStreams` 结构上满足它。 */
export type McpChildStream = {
  setEncoding: (encoding: BufferEncoding) => unknown;
  on: (event: "data", listener: (chunk: string) => void) => unknown;
};

export type McpChildStdin = {
  writable: boolean;
  write: (chunk: string, callback?: (error?: Error | null) => void) => boolean;
  end: () => unknown;
};

/**
 * 子进程的最小形状。写成结构类型而不是直接用 `ChildProcessWithoutNullStreams`：
 * 本包不该为了一个类型去 import `node:child_process` 的具体实现，测试也能直接喂一个假子进程。
 */
export type McpChildProcessLike = {
  stdin: McpChildStdin;
  stdout: McpChildStream;
  stderr: McpChildStream;
  on: {
    (event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
    (event: "error", listener: (error: Error) => void): unknown;
  };
  once: (event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void) => unknown;
  kill: (signal?: NodeJS.Signals) => boolean;
};

/** 起子进程。默认实现在 `./spawn.ts`；测试注入假的。 */
export type McpServerSpawn = (input: {
  command: string;
  args: string[];
  env: Record<string, string>;
  cwd: string | undefined;
}) => McpChildProcessLike;

/** 握手结果。`serverInfo` 只进诊断——服务器名永远取本地配置，不取远端自报的。 */
export type McpHandshakeResult = {
  protocolVersion: string;
  serverInfo: { name?: string; version?: string };
  /** 服务器是否声明了 tools 能力。没声明就不发 `tools/list`。 */
  hasTools: boolean;
  /** 服务器是否声明会发 `notifications/tools/list_changed`。 */
  toolsListChanged: boolean;
};

export type McpStdioSessionOptions = {
  /** 本地配置的服务器名。只进日志与错误文本。 */
  serverName: string;
  command: string;
  args?: readonly string[];
  cwd?: string | undefined;
  /** 已经由 `buildMcpChildEnv` 组装好的子进程 env。本层不再组装，避免两处口径。 */
  env: Record<string, string>;
  spawnProcess: McpServerSpawn;
  handshakeTimeoutMs?: number;
  maxLineBytes?: number;
  clientInfo?: { name: string; version: string };
  /** 子进程退出时回调。`expected` 为 true 表示是我们自己关的。 */
  onExit?: (info: { code: number | null; signal: string | null; expected: boolean }) => void;
  /** 收到 `notifications/tools/list_changed` 时回调（清单已被标脏）。 */
  onToolsChanged?: () => void;
  /** 结构化日志出口。英文事件名 + 字段，落到 apps/api 的 logger 上。 */
  onLog?: (event: string, fields: Record<string, unknown>) => void;
};

type Pending = {
  method: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

export type McpStdioSession = {
  /** 起进程并握手。重复调用返回同一个 promise。 */
  start: () => Promise<McpHandshakeResult>;
  /** 拉全整份工具清单（跟 cursor 翻页）。同时把「清单脏了」的标记清掉。 */
  listTools: () => Promise<McpToolDefinition[]>;
  /** 服务器说过它的工具清单变了吗。 */
  toolsDirty: () => boolean;
  /** 调一个工具。返回服务器给的原始结果，翻译交给 `renderMcpContent`。 */
  callTool: (input: { name: string; args: Record<string, unknown>; timeoutMs: number }) => Promise<Record<string, unknown>>;
  /** 子进程还活着吗。 */
  isLive: () => boolean;
  /** stderr 的尾部（诊断用）。 */
  stderrTail: () => string;
  /** 被丢弃的 stdout 噪声行数。 */
  droppedLines: () => number;
  /** 优雅关闭：关 stdin 等自退 → SIGTERM → SIGKILL。 */
  close: () => Promise<void>;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function shortText(value: unknown, maxChars = 200): string {
  const text = typeof value === "string" ? value : JSON.stringify(value) ?? String(value);
  return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;
}

export function createMcpStdioSession(options: McpStdioSessionOptions): McpStdioSession {
  const handshakeTimeoutMs = options.handshakeTimeoutMs ?? MCP_HANDSHAKE_TIMEOUT_MS;
  const maxLineBytes = options.maxLineBytes ?? MCP_STDIO_MAX_LINE_BYTES;
  const log = options.onLog ?? (() => undefined);

  let child: McpChildProcessLike | undefined;
  let starting: Promise<McpHandshakeResult> | undefined;
  let handshake: McpHandshakeResult | undefined;
  /** 我们主动关的（`close()` 或握手失败的收尾），退出不算崩溃。 */
  let closingExpected = false;
  /** 会话已终结。终结之后不许再 `start()`——一个会话对象只对应一个子进程。 */
  let closed = false;
  let exited = false;
  let nextId = 1;
  const pending = new Map<JsonRpcId, Pending>();
  const decoder = createJsonRpcLineDecoder({ maxLineBytes });
  let stderrTail = "";
  let toolsDirty = false;

  function failAllPending(error: McpSessionError) {
    for (const [, entry] of pending) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    pending.clear();
  }

  /**
   * 协议坏到没法继续（超长帧）：断开，并让在飞调用全部失败。
   *
   * 收尾走 `expected: false`——协议崩了是**这台服务器的故障**，必须计进上层的重连预算。
   * 走 `close()` 那条（expected）会让一台每次连上就吐超长帧的服务器无限重连而永远不被熔断。
   */
  function abortProtocol(detail: string) {
    log("mcp_protocol_error", { server_name: options.serverName, detail });
    failAllPending(new McpSessionError("protocol_error", detail));
    void shutdown(false).catch((error: unknown) => {
      log("mcp_shutdown_failed", { server_name: options.serverName, error });
    });
  }

  function writeLine(line: string): boolean {
    const live = child;
    if (!live || !live.stdin.writable) {
      return false;
    }
    live.stdin.write(line, () => undefined);
    return true;
  }

  function notify(method: string, params?: unknown) {
    writeLine(encodeJsonRpcLine({ jsonrpc: JSONRPC_VERSION, method, ...(params === undefined ? {} : { params }) }));
  }

  function request(method: string, params: unknown, timeoutMs: number): Promise<unknown> {
    return new Promise<unknown>((resolve, reject) => {
      const live = child;
      if (!live || !live.stdin.writable) {
        reject(new McpSessionError("not_running", `mcp server '${options.serverName}' is not running`));
        return;
      }
      const id = nextId++;
      const timer = setTimeout(() => {
        pending.delete(id);
        // MCP 规范：放弃一个请求要通知对面，否则服务器会一直算着这次调用还在跑。
        notify("notifications/cancelled", { requestId: id, reason: "timeout" });
        reject(
          new McpSessionError("call_timeout", `mcp request '${method}' timed out after ${timeoutMs}ms`)
        );
      }, timeoutMs);
      timer.unref?.();
      pending.set(id, { method, resolve, reject, timer });
      live.stdin.write(encodeJsonRpcLine({ jsonrpc: JSONRPC_VERSION, id, method, params }), (error) => {
        if (!error) {
          return;
        }
        const entry = pending.get(id);
        if (entry) {
          clearTimeout(entry.timer);
          pending.delete(id);
          entry.reject(new McpSessionError("not_running", error.message));
        }
      });
    });
  }

  function handleInbound(message: JsonRpcInbound) {
    if (isJsonRpcRequest(message)) {
      // 服务器反过来请求我们（sampling / roots / elicitation…）：一律不实现。
      log("mcp_server_request_refused", { server_name: options.serverName, method: message.method });
      writeLine(
        encodeJsonRpcLine({
          jsonrpc: JSONRPC_VERSION,
          id: message.id,
          error: { code: JSONRPC_METHOD_NOT_FOUND, message: `method not implemented: ${message.method}` }
        })
      );
      return;
    }
    if (isJsonRpcCall(message)) {
      if (message.method === "notifications/tools/list_changed") {
        // 阶段 0 不在一次执行**中途**换掉模型已经看过的工具清单（设计稿 4.1 第 3 条），
        // 只标脏：下一次取清单时刷新。
        toolsDirty = true;
        log("mcp_tools_list_changed", { server_name: options.serverName });
        options.onToolsChanged?.();
      }
      return;
    }
    const id = (message as { id?: JsonRpcId }).id;
    if (id === undefined || id === null) {
      return;
    }
    const entry = pending.get(id);
    if (!entry) {
      // 超时之后才回来的回复。丢掉，但计一条日志——它是「服务器很慢」的唯一线索。
      log("mcp_late_response", { server_name: options.serverName, id: String(id) });
      return;
    }
    clearTimeout(entry.timer);
    pending.delete(id);
    if (isJsonRpcFailure(message)) {
      entry.reject(
        new McpSessionError(
          "server_error",
          `mcp server '${options.serverName}' rejected '${entry.method}': ${shortText(message.error.message)} (${message.error.code})`
        )
      );
      return;
    }
    entry.resolve((message as { result?: unknown }).result);
  }

  function wire(proc: McpChildProcessLike) {
    proc.stdout.setEncoding("utf8");
    proc.stdout.on("data", (chunk: string) => {
      const result = decoder.push(chunk);
      for (const message of result.messages) {
        handleInbound(message);
      }
      if (result.dropped > 0) {
        log("mcp_stdout_noise", {
          server_name: options.serverName,
          dropped_lines: decoder.droppedLines(),
          sample: shortText(chunk, 120)
        });
      }
      if (result.overflow) {
        abortProtocol(`stdout line exceeded ${maxLineBytes} bytes (${result.overflow.bytes})`);
      }
    });
    proc.stderr.setEncoding("utf8");
    proc.stderr.on("data", (chunk: string) => {
      stderrTail = `${stderrTail}${chunk}`.slice(-MCP_STDERR_TAIL_CHARS);
    });
    proc.on("error", (error: Error) => {
      log("mcp_spawn_failed", { server_name: options.serverName, error });
      failAllPending(new McpSessionError("spawn_failed", error.message));
    });
    proc.on("exit", (code: number | null, signal: NodeJS.Signals | null) => {
      exited = true;
      child = undefined;
      failAllPending(
        new McpSessionError("exited", `mcp server '${options.serverName}' exited (code ${code ?? "null"})`)
      );
      options.onExit?.({ code, signal, expected: closingExpected });
    });
  }

  async function start(): Promise<McpHandshakeResult> {
    if (handshake) {
      return handshake;
    }
    if (closed) {
      throw new McpSessionError("not_running", `mcp session for '${options.serverName}' is closed`);
    }
    if (starting) {
      return starting;
    }
    starting = (async () => {
      const proc = options.spawnProcess({
        command: options.command,
        args: [...(options.args ?? [])],
        env: options.env,
        cwd: options.cwd
      });
      child = proc;
      exited = false;
      wire(proc);
      let result: unknown;
      try {
        result = await request(
          "initialize",
          {
            protocolVersion: MCP_CLIENT_PROTOCOL_VERSION,
            capabilities: {},
            clientInfo: options.clientInfo ?? { name: "workhub", version: "0.1.0" }
          },
          handshakeTimeoutMs
        );
      } catch (error) {
        if (error instanceof McpSessionError && error.reason === "call_timeout") {
          throw new McpSessionError(
            "handshake_timeout",
            `mcp server '${options.serverName}' did not answer initialize within ${handshakeTimeoutMs}ms`
          );
        }
        throw error;
      }
      const body = isPlainObject(result) ? result : {};
      const version = body["protocolVersion"];
      if (typeof version !== "string" || !(MCP_SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(version)) {
        throw new McpSessionError(
          "protocol_version_unsupported",
          `mcp server '${options.serverName}' answered protocol version ${shortText(version, 40)}, which this client does not support`
        );
      }
      const capabilities = isPlainObject(body["capabilities"]) ? body["capabilities"] : {};
      const toolsCapability = capabilities["tools"];
      const serverInfoRaw = isPlainObject(body["serverInfo"]) ? body["serverInfo"] : {};
      const handshakeResult: McpHandshakeResult = {
        protocolVersion: version,
        serverInfo: {
          ...(typeof serverInfoRaw["name"] === "string" ? { name: serverInfoRaw["name"] } : {}),
          ...(typeof serverInfoRaw["version"] === "string" ? { version: serverInfoRaw["version"] } : {})
        },
        hasTools: toolsCapability !== undefined,
        toolsListChanged: isPlainObject(toolsCapability) && toolsCapability["listChanged"] === true
      };
      // 规范要求握手完成后立刻发这条通知，服务器可以在收到它之前拒绝一切别的请求。
      notify("notifications/initialized");
      handshake = handshakeResult;
      log("mcp_connected", {
        server_name: options.serverName,
        protocol_version: version,
        server_info: shortText(handshakeResult.serverInfo, 120)
      });
      return handshakeResult;
    })().catch(async (error: unknown) => {
      starting = undefined;
      // 握手没成时子进程往往已经起来了（命令存在、只是它不是一台 MCP 服务器）。必须在这里收干净，
      // 否则每一次失败的连接尝试都留下一个孤儿进程，而上层看到的只是一个错误。
      // 走 expected 收尾：失败原因已经由这个抛出的错误交给上层，不该让随后的退出事件再计一次预算。
      await shutdown(true);
      throw error;
    });
    return starting;
  }

  async function listTools(): Promise<McpToolDefinition[]> {
    const info = await start();
    toolsDirty = false;
    if (!info.hasTools) {
      // 只提供 resources/prompts 的服务器：不发一条注定被拒的请求，直接如实回报「零工具」。
      // 上层据此落 `mcp_no_tools`，比一条 -32601 的英文诊断好解释。
      return [];
    }
    const tools: McpToolDefinition[] = [];
    let cursor: string | undefined;
    const seenCursors = new Set<string>();
    for (let page = 0; page < MCP_TOOLS_LIST_MAX_PAGES; page += 1) {
      const raw = await request("tools/list", cursor === undefined ? {} : { cursor }, handshakeTimeoutMs);
      const body = isPlainObject(raw) ? raw : {};
      const list = Array.isArray(body["tools"]) ? body["tools"] : [];
      for (const entry of list) {
        if (isPlainObject(entry)) {
          tools.push(entry as McpToolDefinition);
        }
      }
      const next = body["nextCursor"];
      if (typeof next !== "string" || next.length === 0) {
        return tools;
      }
      if (seenCursors.has(next)) {
        // 同一个 cursor 回第二次 = 服务器把我们放进了一个死循环。这是最常见的翻页 bug 形状，
        // 单靠页数上限要等 20 页才发现，而每一页都在吃内存。
        throw new McpSessionError(
          "protocol_error",
          `mcp server '${options.serverName}' repeated tools/list cursor ${shortText(next, 40)}`
        );
      }
      seenCursors.add(next);
      cursor = next;
    }
    // 翻满上限还没到底：整代拒绝而不是留半套。半套清单意味着模型看到的是工具集的一个
    // 我们说不清边界的子集，而它下一次可能又是另一个子集——比「这台服务器连不上」难查得多。
    throw new McpSessionError(
      "protocol_error",
      `mcp server '${options.serverName}' did not finish tools/list within ${MCP_TOOLS_LIST_MAX_PAGES} pages`
    );
  }

  async function callTool(input: {
    name: string;
    args: Record<string, unknown>;
    timeoutMs: number;
  }): Promise<Record<string, unknown>> {
    await start();
    const raw = await request("tools/call", { name: input.name, arguments: input.args }, input.timeoutMs);
    return isPlainObject(raw) ? raw : {};
  }

  /**
   * 收尾。`expected` 决定退出事件怎么报给上层：我们自己关的不计重连预算，协议故障计。
   * 关的顺序是「关 stdin 让它自退 → SIGTERM → SIGKILL」，每一档都有时限：
   * 第三方进程完全可能装了 SIGTERM 处理器却退不干净，没有 SIGKILL 这一档就会留下僵尸进程。
   */
  async function shutdown(expected: boolean): Promise<void> {
    closingExpected = expected;
    closed = true;
    const live = child;
    starting = undefined;
    handshake = undefined;
    if (live && !exited) {
      await new Promise<void>((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(term);
          clearTimeout(kill);
          resolve();
        };
        const term = setTimeout(() => {
          live.kill("SIGTERM");
        }, MCP_SHUTDOWN_GRACE_MS);
        term.unref?.();
        const kill = setTimeout(() => {
          // SIGTERM 之后还不退：第三方进程可能自己装了 SIGTERM 处理器又没退干净。
          live.kill("SIGKILL");
          finish();
        }, MCP_SHUTDOWN_GRACE_MS + MCP_SIGKILL_GRACE_MS);
        kill.unref?.();
        live.once("exit", finish);
        live.stdin.end();
      });
    }
    child = undefined;
    failAllPending(new McpSessionError("not_running", `mcp server '${options.serverName}' was closed`));
  }

  async function close(): Promise<void> {
    await shutdown(true);
  }

  return {
    start,
    listTools,
    toolsDirty: () => toolsDirty,
    callTool,
    isLive: () => child !== undefined && !exited,
    stderrTail: () => stderrTail,
    droppedLines: () => decoder.droppedLines(),
    close
  };
}
