import assert from "node:assert/strict";
import test from "node:test";

import {
  createJsonRpcLineDecoder,
  encodeJsonRpcLine,
  isJsonRpcCall,
  isJsonRpcFailure,
  isJsonRpcRequest,
  JSONRPC_VERSION,
  MCP_STDIO_MAX_LINE_BYTES
} from "./jsonrpc.js";

test("编码一行一帧，内嵌换行不破帧", () => {
  const line = encodeJsonRpcLine({ jsonrpc: JSONRPC_VERSION, id: 1, method: "tools/call", params: { text: "a\nb" } });
  assert.equal(line.endsWith("\n"), true);
  assert.equal(line.split("\n").filter((part) => part.length > 0).length, 1);
  const decoder = createJsonRpcLineDecoder();
  const result = decoder.push(line);
  assert.equal(result.messages.length, 1);
  assert.deepEqual((result.messages[0] as { params?: unknown }).params, { text: "a\nb" });
});

test("任意切分的 chunk 也能拼回帧", () => {
  const decoder = createJsonRpcLineDecoder();
  const line = encodeJsonRpcLine({ jsonrpc: JSONRPC_VERSION, id: 7, result: { ok: true } });
  let messages = 0;
  for (const char of line) {
    messages += decoder.push(char).messages.length;
  }
  assert.equal(messages, 1);
  assert.equal(decoder.pendingChars(), 0);
});

test("一次 push 里的多帧按到达顺序吐出", () => {
  const decoder = createJsonRpcLineDecoder();
  const chunk =
    encodeJsonRpcLine({ jsonrpc: JSONRPC_VERSION, id: 1, result: {} }) +
    encodeJsonRpcLine({ jsonrpc: JSONRPC_VERSION, method: "notifications/tools/list_changed" }) +
    encodeJsonRpcLine({ jsonrpc: JSONRPC_VERSION, id: 2, result: {} });
  const result = decoder.push(chunk);
  assert.deepEqual(
    result.messages.map((message) => (message as { id?: unknown; method?: unknown }).id ?? (message as { method?: string }).method),
    [1, "notifications/tools/list_changed", 2]
  );
});

test("非 JSON 的噪声行丢弃并计数，不带崩整条流", () => {
  const decoder = createJsonRpcLineDecoder();
  const result = decoder.push(`starting server...\n{oops\n${encodeJsonRpcLine({ jsonrpc: JSONRPC_VERSION, id: 1, result: 1 })}`);
  assert.equal(result.messages.length, 1);
  assert.equal(result.dropped, 2);
  assert.equal(decoder.droppedLines(), 2);
});

test("合法 JSON 但不是 JSON-RPC 2.0 的行同样算噪声", () => {
  const decoder = createJsonRpcLineDecoder();
  const result = decoder.push('{"hello":"world"}\n[1,2,3]\n{"jsonrpc":"1.0","id":1,"result":1}\n');
  assert.equal(result.messages.length, 0);
  assert.equal(decoder.droppedLines(), 3);
});

test("空行不算噪声也不成帧", () => {
  const decoder = createJsonRpcLineDecoder();
  const result = decoder.push("\n   \n\n");
  assert.equal(result.messages.length, 0);
  assert.equal(result.dropped, 0);
});

test("超长成型行 = 协议错误，解码器随后进终止态", () => {
  const decoder = createJsonRpcLineDecoder({ maxLineBytes: 64 });
  const good = encodeJsonRpcLine({ jsonrpc: JSONRPC_VERSION, id: 1, result: 1 });
  const huge = `{"jsonrpc":"2.0","id":2,"result":"${"x".repeat(200)}"}\n`;
  const result = decoder.push(`${good}${huge}${good}`);
  assert.equal(result.messages.length, 1, "超限之前的帧照常吐出");
  assert.ok(result.overflow);
  assert.equal(result.overflow.bytes > 64, true);
  assert.equal(decoder.isPoisoned(), true);
  assert.deepEqual(decoder.push(good), { messages: [], dropped: 0 }, "终止之后一律不再产出");
});

test("没有换行的一大坨在成帧之前就判超限（不等它先吃满内存）", () => {
  const decoder = createJsonRpcLineDecoder({ maxLineBytes: 64 });
  const result = decoder.push("x".repeat(65));
  assert.ok(result.overflow);
  assert.equal(decoder.isPoisoned(), true);
});

test("上限按 UTF-8 字节算，多字节字符不会被当成便宜的", () => {
  const decoder = createJsonRpcLineDecoder({ maxLineBytes: 40 });
  // 20 个汉字 = 60 字节 > 40，但只有 20 个 UTF-16 码元。
  const result = decoder.push(`${"汉".repeat(20)}\n`);
  assert.ok(result.overflow);
  assert.equal(result.overflow.bytes, 60);
});

test("默认上限是 1MB", () => {
  assert.equal(MCP_STDIO_MAX_LINE_BYTES, 1024 * 1024);
  const decoder = createJsonRpcLineDecoder();
  const line = `{"jsonrpc":"2.0","id":1,"result":"${"x".repeat(1024)}"}\n`;
  assert.equal(decoder.push(line).messages.length, 1);
  assert.equal(decoder.isPoisoned(), false);
});

test("残留缓冲长度看得见（用来解释「话说了一半就退出了」）", () => {
  const decoder = createJsonRpcLineDecoder();
  decoder.push('{"jsonrpc":"2.0","id":1');
  assert.equal(decoder.pendingChars(), 23);
});

test("消息分类：请求带 id、通知不带、回复没有 method", () => {
  const request = { jsonrpc: JSONRPC_VERSION, id: 1, method: "sampling/createMessage" } as const;
  const notification = { jsonrpc: JSONRPC_VERSION, method: "notifications/tools/list_changed" } as const;
  const success = { jsonrpc: JSONRPC_VERSION, id: 1, result: {} } as const;
  const failure = { jsonrpc: JSONRPC_VERSION, id: 1, error: { code: -32601, message: "nope" } } as const;
  assert.equal(isJsonRpcRequest(request), true);
  assert.equal(isJsonRpcRequest(notification), false);
  assert.equal(isJsonRpcCall(notification), true);
  assert.equal(isJsonRpcCall(success), false);
  assert.equal(isJsonRpcFailure(failure), true);
  assert.equal(isJsonRpcFailure(success), false);
});

test("id 为 0 的请求仍然算请求（不是假值陷阱）", () => {
  assert.equal(isJsonRpcRequest({ jsonrpc: JSONRPC_VERSION, id: 0, method: "roots/list" }), true);
});
