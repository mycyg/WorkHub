import assert from "node:assert/strict";
import test from "node:test";

import { createToolRegistry, okToolResult, type ToolExecutionContext } from "@workhub/tools";

import type { PluginToolDescriptor } from "./protocol.js";
import { sanitizePluginText, toPluginToolSpec, toPluginToolSpecs, PLUGIN_TEXT_MAX_CHARS } from "./to-tool-spec.js";

const descriptor: PluginToolDescriptor = {
  pluginId: "dsh-plugin-echo",
  toolName: "echo",
  toolId: "plugin__dsh-plugin-echo__echo",
  description: "Echo a phrase back.",
  jsonSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] }
};

const ctx: ToolExecutionContext = { workdir: "/tmp/workhub-plugin-test" };

test("插件工具一律按 external_effect（最高风险）对待", () => {
  const spec = toPluginToolSpec(descriptor, async () => okToolResult("ok"));
  assert.equal(spec.sideEffect, "external_effect");
  assert.equal(spec.minScope, "plugin:dsh-plugin-echo:external_effect");
  assert.equal(spec.id, descriptor.toolId);
});

test("阶段 0 不把插件文案送进系统提示词通道", () => {
  const spec = toPluginToolSpec(descriptor, async () => okToolResult("ok"));
  assert.equal(spec.promptSnippet, undefined);
  assert.equal(spec.promptGuidelines, undefined);
});

test("模型看到的是插件自带的 JSON Schema，不是 Zod 退化出的空 object", async () => {
  const spec = toPluginToolSpec(descriptor, async () => okToolResult("ok"));
  const registry = createToolRegistry([spec]);
  const [modelTool] = (await registry.toModelTools(ctx)) as { name: string; input_schema: Record<string, unknown> }[];
  assert.equal(modelTool?.name, descriptor.toolId);
  assert.deepEqual(modelTool?.input_schema, descriptor.jsonSchema);
});

test("执行时把入参与上下文原样交给 invoker", async () => {
  const seen: unknown[] = [];
  const spec = toPluginToolSpec(descriptor, async (input) => {
    seen.push(input);
    return okToolResult("echoed");
  });
  const result = await spec.execute({ text: "hi" }, { ...ctx, runId: "run-1" });
  assert.equal(result.content, "echoed");
  assert.deepEqual(seen, [{ descriptor, args: { text: "hi" }, ctx: { ...ctx, runId: "run-1" } }]);
});

test("模型漏给入参时归一成空对象，而不是把 undefined 递进插件", async () => {
  let received: unknown;
  const spec = toPluginToolSpec(descriptor, async (input) => {
    received = input.args;
    return okToolResult("ok");
  });
  await spec.execute(undefined, ctx);
  assert.deepEqual(received, {});
});

test("非对象入参被 schema 挡在执行之前", async () => {
  let called = false;
  const spec = toPluginToolSpec(descriptor, async () => {
    called = true;
    return okToolResult("ok");
  });
  const registry = createToolRegistry([spec]);
  const result = await registry.execute(descriptor.toolId, "not an object", {
    ...ctx,
    snapshot: () => ({ snapshotId: "snap-1" })
  });
  assert.equal(result.isError, true);
  assert.equal(called, false);
});

test("副作用工具没有快照门就拒绝执行（继承自注册表，不需要插件层自己写）", async () => {
  const spec = toPluginToolSpec(descriptor, async () => okToolResult("ok"));
  const registry = createToolRegistry([spec]);
  const result = await registry.execute(descriptor.toolId, { text: "hi" }, ctx);
  assert.equal(result.isError, true);
  assert.match(result.content, /requires a snapshot gate/u);
});

test("toPluginToolSpecs 一一对应", () => {
  const specs = toPluginToolSpecs([descriptor, { ...descriptor, toolId: "plugin__p__b", toolName: "b" }], async () =>
    okToolResult("ok")
  );
  assert.deepEqual(specs.map((spec) => spec.id), ["plugin__dsh-plugin-echo__echo", "plugin__p__b"]);
});

test("插件文案被砍到上限并去掉控制字符", () => {
  assert.equal(sanitizePluginText("a\u0000b\u0007c"), "a b c");
  assert.equal(sanitizePluginText("keeps\nnewlines\tand tabs"), "keeps\nnewlines\tand tabs");
  const long = "x".repeat(PLUGIN_TEXT_MAX_CHARS + 50);
  assert.equal(sanitizePluginText(long).length, PLUGIN_TEXT_MAX_CHARS + 1);
  assert.equal(sanitizePluginText(long).endsWith("…"), true);
});

test("超长描述在进 ToolSpec 时就已经被砍过", () => {
  const spec = toPluginToolSpec(
    { ...descriptor, description: "y".repeat(PLUGIN_TEXT_MAX_CHARS + 500) },
    async () => okToolResult("ok")
  );
  assert.equal(spec.description.length, PLUGIN_TEXT_MAX_CHARS + 1);
});
