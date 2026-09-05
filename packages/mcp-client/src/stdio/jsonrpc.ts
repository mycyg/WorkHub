/**
 * MCP stdio 传输的线协议：换行分隔的 JSON-RPC 2.0（工包 M2）。
 *
 * MCP 的 stdio 面就是「一行一个 JSON-RPC 2.0 消息，UTF-8，`\n` 分隔」——与
 * `packages/plugin-host/src/protocol.ts` 的自研线协议同一种形状，所以这里照那份增量行解析器长，
 * 只把两处按「对面是第三方进程」收紧：
 *
 * 1. **单行有上限。** 插件宿主的对面是我们自己写的进程，一行多长都是自己人的问题；MCP 服务器
 *    是第三方，一行没有换行的 1GB 输出能把 API 进程的内存吃干净。上限 1MB，命中即判**协议错误**
 *    并要求调用方断开——不是丢一行继续，因为半行 JSON 之后的所有内容都不再对得上帧边界。
 *    未成帧的残留缓冲同样要查（等到换行才查，等于承认可以先吃下任意大的一坨）。
 * 2. **认 `jsonrpc: "2.0"`。** 合法 JSON 但不是 JSON-RPC 的行（服务器把 banner 打到了 stdout）
 *    当噪声丢弃并**计数**——计数是为了让「服务器一直在往 stdout 打日志」这件事在诊断里看得见，
 *    而不是变成一个谁也解释不了的静默。
 *
 * 本模块零 IO：只做字符串进、消息出。spawn 与流的接线在 `./session.ts`。
 */

/** JSON-RPC 2.0 版本串。协议规定它必须逐字是这个值。 */
export const JSONRPC_VERSION = "2.0";

/**
 * 单行上限（字节）。超限即协议错误。
 * 取 1MB 的理由：一次 `tools/call` 结果最终会被 `renderMcpContent` 砍到 32KB，1MB 给
 * base64 资源块之类的合法大结果留了 30 倍余量，同时离「能撑爆进程」还差几个数量级。
 */
export const MCP_STDIO_MAX_LINE_BYTES = 1024 * 1024;

export type JsonRpcId = number | string;

export type JsonRpcRequest = { jsonrpc: typeof JSONRPC_VERSION; id: JsonRpcId; method: string; params?: unknown };
export type JsonRpcNotification = { jsonrpc: typeof JSONRPC_VERSION; method: string; params?: unknown };
export type JsonRpcSuccess = { jsonrpc: typeof JSONRPC_VERSION; id: JsonRpcId; result: unknown };
export type JsonRpcErrorBody = { code: number; message: string; data?: unknown };
export type JsonRpcFailure = { jsonrpc: typeof JSONRPC_VERSION; id: JsonRpcId | null; error: JsonRpcErrorBody };

/** 收到的一条消息。`method` 在场就是请求或通知，否则是对我们某个请求的回复。 */
export type JsonRpcInbound = JsonRpcRequest | JsonRpcNotification | JsonRpcSuccess | JsonRpcFailure;

/** 发出去的一条消息。 */
export type JsonRpcOutbound = JsonRpcRequest | JsonRpcNotification | JsonRpcSuccess | JsonRpcFailure;

/** JSON-RPC 2.0 的「方法不存在」。服务器反过来请求我们时统一回这个码。 */
export const JSONRPC_METHOD_NOT_FOUND = -32601;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 一条 JSON-RPC 消息编成一行。内嵌换行由 JSON 转义保证破不了帧。 */
export function encodeJsonRpcLine(message: JsonRpcOutbound): string {
  return `${JSON.stringify(message)}\n`;
}

/** 这条消息带 `method` 吗（请求或通知，而不是回复）。 */
export function isJsonRpcCall(message: JsonRpcInbound): message is JsonRpcRequest | JsonRpcNotification {
  return typeof (message as { method?: unknown }).method === "string";
}

/** 带 `method` 且带 `id` = 服务器在**请求**我们做事（sampling / roots / elicitation…）。 */
export function isJsonRpcRequest(message: JsonRpcInbound): message is JsonRpcRequest {
  return isJsonRpcCall(message) && (message as { id?: unknown }).id !== undefined;
}

/** 回复里带 `error` 就是失败回复。 */
export function isJsonRpcFailure(message: JsonRpcInbound): message is JsonRpcFailure {
  return isPlainObject((message as { error?: unknown }).error);
}

/** 一次 push 的解析结果。 */
export type JsonRpcDecodeResult = {
  /** 这次喂进来的数据里成型的消息，按到达顺序。 */
  messages: JsonRpcInbound[];
  /** 这次丢弃的噪声行数（非 JSON、或不是 JSON-RPC 2.0）。累计值见 `droppedLines()`。 */
  dropped: number;
  /**
   * 命中单行上限。**这是协议错误**：调用方必须断开连接。
   * 命中后解码器进入终止态，后续 push 一律返回空——半行之后的字节流没有可信的帧边界。
   */
  overflow?: { bytes: number };
};

export type JsonRpcLineDecoder = {
  push: (chunk: string) => JsonRpcDecodeResult;
  /** 累计丢弃的噪声行数。正常恒为 0；不为 0 说明服务器在往 stdout 打非协议内容。 */
  droppedLines: () => number;
  /** 尚未成帧的残留长度（UTF-16 码元），用来解释「话说了一半就退出了」。 */
  pendingChars: () => number;
  /** 是否已经因为超长帧终止。 */
  isPoisoned: () => boolean;
};

/**
 * 增量行解析器。喂任意切分的 chunk，吐出解析好的消息。
 *
 * 残留缓冲的上限检查用 UTF-16 码元长度而不是 `Buffer.byteLength`：UTF-8 字节数恒 ≥ 码元数，
 * 所以码元数超限时字节数必然也超限，判定是保守正确的；而每来一个 chunk 就对整个缓冲算一次
 * 字节长度是 O(n²)，正好会在「服务器狂吐一大坨」这个我们要防的场景里最先炸。
 * 真正成型的一行则用精确的字节长度判定。
 */
export function createJsonRpcLineDecoder(
  options: { maxLineBytes?: number } = {}
): JsonRpcLineDecoder {
  const maxLineBytes = options.maxLineBytes ?? MCP_STDIO_MAX_LINE_BYTES;
  let buffer = "";
  let dropped = 0;
  let poisoned = false;

  return {
    push(chunk) {
      if (poisoned) {
        return { messages: [], dropped: 0 };
      }
      buffer += chunk;
      const messages: JsonRpcInbound[] = [];
      let droppedHere = 0;
      let index = buffer.indexOf("\n");
      while (index >= 0) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (line.length > 0) {
          const bytes = Buffer.byteLength(line, "utf8");
          if (bytes > maxLineBytes) {
            poisoned = true;
            buffer = "";
            return { messages, dropped: droppedHere, overflow: { bytes } };
          }
          let parsed: unknown;
          try {
            parsed = JSON.parse(line);
          } catch {
            dropped += 1;
            droppedHere += 1;
            index = buffer.indexOf("\n");
            continue;
          }
          if (!isPlainObject(parsed) || parsed["jsonrpc"] !== JSONRPC_VERSION) {
            dropped += 1;
            droppedHere += 1;
            index = buffer.indexOf("\n");
            continue;
          }
          messages.push(parsed as unknown as JsonRpcInbound);
        }
        index = buffer.indexOf("\n");
      }
      if (buffer.length > maxLineBytes) {
        const bytes = Buffer.byteLength(buffer, "utf8");
        poisoned = true;
        buffer = "";
        return { messages, dropped: droppedHere, overflow: { bytes } };
      }
      return { messages, dropped: droppedHere };
    },
    droppedLines() {
      return dropped;
    },
    pendingChars() {
      return buffer.length;
    },
    isPoisoned() {
      return poisoned;
    }
  };
}
