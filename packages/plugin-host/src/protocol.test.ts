import assert from "node:assert/strict";
import test from "node:test";

import { createFrameDecoder, encodeFrame, PLUGIN_HOST_PROTOCOL_VERSION } from "./protocol.js";
import type { PluginHostRequest } from "./protocol.js";

test("encodeFrame 每帧一行，内嵌换行被 JSON 转义不会破帧", () => {
  const frame = encodeFrame({ id: 1, method: "call_tool", params: { toolId: "t", input: { text: "a\nb" } } });
  assert.equal(frame.endsWith("\n"), true);
  assert.equal(frame.trimEnd().includes("\n"), false);
});

test("解码器能吃任意切分的 chunk", () => {
  const decoder = createFrameDecoder<PluginHostRequest>();
  const frame = encodeFrame({ id: 7, method: "list_tools" });
  const cut = Math.floor(frame.length / 2);
  assert.deepEqual(decoder.push(frame.slice(0, cut)), []);
  const frames = decoder.push(frame.slice(cut));
  assert.equal(frames.length, 1);
  assert.equal(frames[0]?.id, 7);
  assert.equal(frames[0]?.method, "list_tools");
});

test("一条 chunk 里的多帧全部吐出", () => {
  const decoder = createFrameDecoder<PluginHostRequest>();
  const frames = decoder.push(
    encodeFrame({ id: 1, method: "list_tools" }) + encodeFrame({ id: 2, method: "list_tools" })
  );
  assert.deepEqual(frames.map((frame) => frame.id), [1, 2]);
});

test("坏行被丢弃并计数，不让后续帧受影响", () => {
  const decoder = createFrameDecoder<PluginHostRequest>();
  const frames = decoder.push(`plugin noise not json\n${encodeFrame({ id: 3, method: "list_tools" })}`);
  assert.equal(frames.length, 1);
  assert.equal(frames[0]?.id, 3);
  assert.equal(decoder.droppedLines(), 1);
});

test("未成帧的残留留在 pending 里，进程半途死掉时能解释", () => {
  const decoder = createFrameDecoder<PluginHostRequest>();
  decoder.push('{"id":4,"method":"list_');
  assert.equal(decoder.pending(), '{"id":4,"method":"list_');
});

test("协议版本是显式常量（改版必须同时改两端）", () => {
  // 2：R26 X 给 PluginToolDescriptor 加了必填的 selfReportedReadOnly。
  assert.equal(PLUGIN_HOST_PROTOCOL_VERSION, 2);
});
