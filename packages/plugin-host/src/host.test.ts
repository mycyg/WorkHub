import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createPluginHostRuntime, normalizePluginModule, resolvePluginEntry, serveStdio } from "./host.js";
import { createFrameDecoder, encodeFrame, PLUGIN_HOST_PROTOCOL_VERSION } from "./protocol.js";
import type { PluginHostResponse } from "./protocol.js";

const ECHO_FIXTURE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../qa/fixtures/dsh-plugin-echo"
);

async function tempPlugin(files: Record<string, string>) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "workhub-plugin-host-test-"));
  for (const [relative, content] of Object.entries(files)) {
    const file = path.join(dir, relative);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, content, "utf8");
  }
  return dir;
}

test("装真实形状的 dsh 工具型插件：Cordis Context + ctx.tools + ctx.systemPrompt 全跑通", async () => {
  const runtime = await createPluginHostRuntime([ECHO_FIXTURE]);
  const listed = runtime.listTools();
  assert.equal(listed.protocolVersion, PLUGIN_HOST_PROTOCOL_VERSION);
  assert.equal(listed.plugins.length, 1);
  assert.deepEqual(
    { ...listed.plugins[0], path: "<fixture>" },
    { pluginId: "dsh-plugin-echo", path: "<fixture>", ok: true, toolCount: 1, promptSectionCount: 1 }
  );
  assert.equal(listed.tools.length, 1);
  const tool = listed.tools[0]!;
  assert.equal(tool.toolId, "plugin__dsh-plugin-echo__echo");
  // defineTool 归一化后的 JSON Schema 原样直通。
  assert.deepEqual((tool.jsonSchema as { required?: string[] }).required, ["text"]);

  const result = await runtime.callTool(tool.toolId, { text: "ping", times: 2, upper: true });
  assert.equal(result.ok, true);
  assert.equal(result.content, "PING PING");
  assert.deepEqual(result.data, { text: "PING PING", length: 9 });
  assert.equal(typeof result.durationMs, "number");
});

test("插件自己的入参校验（dsh INVALID_ARGS）如实冒到调用方", async () => {
  const runtime = await createPluginHostRuntime([ECHO_FIXTURE]);
  const toolId = runtime.listTools().tools[0]!.toolId;
  await assert.rejects(() => runtime.callTool(toolId, { times: 2 }), /missing required property "text"/u);
});

test("调用未知工具直接报错，不静默返回空结果", async () => {
  const runtime = await createPluginHostRuntime([]);
  await assert.rejects(() => runtime.callTool("plugin__nope__nope", {}), /unknown plugin tool/u);
});

test("一个插件装挂了不影响另一个——失败原因如实进报告", async () => {
  const broken = await tempPlugin({
    "package.json": JSON.stringify({ name: "dsh-plugin-broken", type: "module", main: "index.js" }),
    "index.js": "throw new Error('plugin blew up at import time');"
  });
  try {
    const runtime = await createPluginHostRuntime([broken, ECHO_FIXTURE]);
    const listed = runtime.listTools();
    const brokenReport = listed.plugins.find((report) => report.pluginId === "dsh-plugin-broken");
    const okReport = listed.plugins.find((report) => report.pluginId === "dsh-plugin-echo");
    assert.equal(brokenReport?.ok, false);
    assert.match(brokenReport?.error ?? "", /plugin blew up at import time/u);
    assert.equal(okReport?.ok, true);
    assert.equal(listed.tools.length, 1, "好插件的工具照常上线");
  } finally {
    await rm(broken, { recursive: true, force: true });
  }
});

test("apply 里抛错的插件被隔离，宿主照常返回其它插件的工具", async () => {
  const throwing = await tempPlugin({
    "package.json": JSON.stringify({ name: "dsh-plugin-throwing", type: "module", main: "index.js" }),
    "index.js": "export const inject = ['tools'];\nexport function apply() { throw new Error('apply failed'); }\n"
  });
  try {
    const runtime = await createPluginHostRuntime([throwing, ECHO_FIXTURE]);
    const listed = runtime.listTools();
    assert.equal(listed.plugins.find((report) => report.pluginId === "dsh-plugin-throwing")?.ok, false);
    assert.equal(listed.tools.length, 1);
  } finally {
    await rm(throwing, { recursive: true, force: true });
  }
});

test("路径不存在时报告失败而不是让整个宿主起不来", async () => {
  const runtime = await createPluginHostRuntime(["/nonexistent/workhub/plugin"]);
  const listed = runtime.listTools();
  assert.equal(listed.plugins[0]?.ok, false);
  assert.equal(listed.tools.length, 0);
});

test("入口解析认 exports 条件、字符串 exports 与 main，缺省回落 index.js", async () => {
  const withExports = await tempPlugin({
    "package.json": JSON.stringify({ name: "p1", exports: { ".": { import: "./lib/a.js" } } }),
    "lib/a.js": "export function apply() {}"
  });
  const withStringExports = await tempPlugin({
    "package.json": JSON.stringify({ name: "p2", exports: "./b.js" }),
    "b.js": "export function apply() {}"
  });
  const withMain = await tempPlugin({ "package.json": JSON.stringify({ name: "p3", main: "c.js" }), "c.js": "" });
  const bare = await tempPlugin({ "package.json": JSON.stringify({ name: "p4" }) });
  try {
    assert.equal(path.basename((await resolvePluginEntry(withExports)).entryPath), "a.js");
    assert.equal(path.basename((await resolvePluginEntry(withStringExports)).entryPath), "b.js");
    assert.equal(path.basename((await resolvePluginEntry(withMain)).entryPath), "c.js");
    assert.equal(path.basename((await resolvePluginEntry(bare)).entryPath), "index.js");
    assert.equal((await resolvePluginEntry(bare)).pluginId, "p4");
  } finally {
    for (const dir of [withExports, withStringExports, withMain, bare]) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

test("模块形态归一化：函数 / 默认导出对象 / 具名 apply 都认，别的直接报错", () => {
  const fn = () => {};
  assert.equal(normalizePluginModule({ default: fn }), fn);
  const objectPlugin = { apply() {} };
  assert.equal(normalizePluginModule({ default: objectPlugin }), objectPlugin);
  const named = normalizePluginModule({ name: "n", inject: ["tools"], apply() {} }) as Record<string, unknown>;
  assert.equal(named.name, "n");
  assert.deepEqual(named.inject, ["tools"]);
  assert.equal(typeof named.apply, "function");
  assert.throws(() => normalizePluginModule({ nothing: 1 }), /exports neither a function/u);
});

test("stdio 服务端：list_tools / call_tool / 未知方法 / 工具报错各有其响应", async () => {
  const runtime = await createPluginHostRuntime([ECHO_FIXTURE]);
  const input = new EventEmitter() as EventEmitter & NodeJS.ReadableStream;
  const decoder = createFrameDecoder<PluginHostResponse>();
  const responses: PluginHostResponse[] = [];
  const stop = serveStdio(runtime, input, (chunk) => {
    responses.push(...decoder.push(chunk));
  });

  const toolId = runtime.listTools().tools[0]!.toolId;
  input.emit("data", encodeFrame({ id: 1, method: "list_tools" }));
  input.emit("data", encodeFrame({ id: 2, method: "call_tool", params: { toolId, input: { text: "a" } } }));
  input.emit("data", encodeFrame({ id: 3, method: "call_tool", params: { toolId: "plugin__x__y", input: {} } }));
  input.emit("data", encodeFrame({ id: 4, method: "nope" } as never));
  await new Promise((resolve) => setTimeout(resolve, 50));
  stop();

  const byId = new Map(responses.map((response) => [response.id, response]));
  assert.equal(byId.get(1)?.ok, true);
  assert.equal(byId.get(2)?.ok, true);
  assert.equal((byId.get(2) as { result: { content: string } }).result.content, "a");
  assert.equal(byId.get(3)?.ok, false);
  assert.match((byId.get(3) as { error: { message: string } }).error.message, /unknown plugin tool/u);
  assert.equal(byId.get(4)?.ok, false);
  assert.equal((byId.get(4) as { error: { code: string } }).error.code, "unknown_method");
});

test("跨 chunk 切分的请求照样应答（服务端复用同一个增量解析器）", async () => {
  const runtime = await createPluginHostRuntime([]);
  const input = new EventEmitter() as EventEmitter & NodeJS.ReadableStream;
  const decoder = createFrameDecoder<PluginHostResponse>();
  const responses: PluginHostResponse[] = [];
  const stop = serveStdio(runtime, input, (chunk) => {
    responses.push(...decoder.push(chunk));
  });
  const frame = encodeFrame({ id: 9, method: "list_tools" });
  input.emit("data", Buffer.from(frame.slice(0, 5)));
  input.emit("data", Buffer.from(frame.slice(5)));
  await new Promise((resolve) => setTimeout(resolve, 20));
  stop();
  assert.equal(responses.length, 1);
  assert.equal(responses[0]?.id, 9);
});
