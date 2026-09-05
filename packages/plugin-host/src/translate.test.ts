import assert from "node:assert/strict";
import test from "node:test";

import { describePluginTool, pluginToolId, renderToolContent, toJsonSchema, type DshToolDefinition } from "./translate.js";

function definition(overrides: Partial<DshToolDefinition> = {}): DshToolDefinition {
  return {
    name: "echo",
    description: "Echo something back.",
    parameters: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
    output: { schema: { type: "object" }, render: (_args, value) => [{ type: "text", text: String((value as { text: string }).text) }] },
    execute: async () => ({ text: "x" }),
    ...overrides
  };
}

test("工具 id 落在 plugin__ 名字空间，非法字符被压成下划线", () => {
  assert.equal(pluginToolId("dsh-plugin-echo", "echo"), "plugin__dsh-plugin-echo__echo");
  assert.equal(pluginToolId("@scope/pkg.name", "do:it"), "plugin___scope_pkg_name__do_it");
});

test("描述符直通 dsh 的 JSON Schema（不经 Zod）", () => {
  const descriptor = describePluginTool("dsh-plugin-echo", definition());
  assert.equal(descriptor.toolId, "plugin__dsh-plugin-echo__echo");
  assert.equal(descriptor.pluginId, "dsh-plugin-echo");
  assert.equal(descriptor.toolName, "echo");
  assert.deepEqual(descriptor.jsonSchema, {
    type: "object",
    properties: { text: { type: "string" } },
    required: ["text"]
  });
});

test("描述缺失时给一句能定位到插件的兜底，而不是空串", () => {
  const descriptor = describePluginTool("p", definition({ description: "   " }));
  assert.match(descriptor.description, /Tool 'echo' contributed by plugin 'p'/u);
});

test("timeoutMs 只在是正有限数时才带上", () => {
  assert.equal(describePluginTool("p", definition({ timeoutMs: 1500 })).timeoutMs, 1500);
  assert.equal(describePluginTool("p", definition({ timeoutMs: 0 })).timeoutMs, undefined);
  assert.equal(describePluginTool("p", definition({ timeoutMs: Number.NaN })).timeoutMs, undefined);
  assert.equal(describePluginTool("p", definition()).timeoutMs, undefined);
});

test("参数 schema 不认识/缺失时退化成空 object schema，绝不给模型 undefined", () => {
  assert.deepEqual(toJsonSchema(undefined), { type: "object", properties: {} });
  assert.deepEqual(toJsonSchema("nonsense"), { type: "object", properties: {} });
  assert.deepEqual(toJsonSchema({ properties: {} }), { properties: {}, type: "object" });
  assert.equal("$schema" in toJsonSchema({ $schema: "x", type: "object" }), false);
});

test("render 的 text 块拼成模型可见内容", () => {
  const def = definition({
    output: {
      schema: {},
      render: () => [{ type: "text", text: "line 1" }, { type: "text", text: "line 2" }]
    }
  });
  assert.equal(renderToolContent(def, {}, { text: "ignored" }), "line 1\nline 2");
});

test("非 text 块留占位，不静默丢内容", () => {
  const def = definition({ output: { schema: {}, render: () => [{ type: "image", data: "…" }] } });
  assert.equal(renderToolContent(def, {}, {}), "[unsupported content block: image]");
});

test("render 抛错不让一次成功的调用变失败——回落到值本身并注明", () => {
  const def = definition({
    output: {
      schema: {},
      render: () => {
        throw new Error("boom");
      }
    }
  });
  const content = renderToolContent(def, {}, { a: 1 });
  assert.match(content, /\{"a":1\}/u);
  assert.match(content, /plugin render failed: boom/u);
});

test("没有 render、或 render 返回非数组/空文本时回落到值的 JSON", () => {
  assert.equal(renderToolContent(definition({ output: { schema: {} } }), {}, { a: 1 }), '{"a":1}');
  assert.equal(renderToolContent(definition({ output: { schema: {}, render: () => "nope" } }), {}, "text"), "text");
  assert.equal(renderToolContent(definition({ output: { schema: {}, render: () => [] } }), {}, { a: 1 }), '{"a":1}');
});

test("循环引用的返回值不会把翻译器炸掉", () => {
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  const content = renderToolContent(definition({ output: { schema: {} } }), {}, cyclic);
  assert.equal(typeof content, "string");
});
