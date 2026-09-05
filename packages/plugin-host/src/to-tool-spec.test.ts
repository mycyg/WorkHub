import assert from "node:assert/strict";
import test from "node:test";

import { createToolRegistry, okToolResult, type ToolExecutionContext } from "@workhub/tools";

import type { PluginToolDescriptor } from "./protocol.js";
import {
  pluginToolMinScope,
  resolvePluginToolSideEffect,
  sanitizePluginText,
  toPluginToolSpec,
  toPluginToolSpecs,
  PLUGIN_TEXT_MAX_CHARS
} from "./to-tool-spec.js";

const descriptor: PluginToolDescriptor = {
  pluginId: "dsh-plugin-echo",
  toolName: "echo",
  toolId: "plugin__dsh-plugin-echo__echo",
  description: "Echo a phrase back.",
  jsonSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
  selfReportedReadOnly: false
};

/** 同一个工具，但它自述只读。 */
const readOnlyDescriptor: PluginToolDescriptor = { ...descriptor, selfReportedReadOnly: true };

const ctx: ToolExecutionContext = { workdir: "/tmp/workhub-plugin-test" };

test("不给信任级别时按最高风险对待（调用方没接线的安全缺省）", () => {
  const spec = toPluginToolSpec(descriptor, async () => okToolResult("ok"));
  assert.equal(spec.sideEffect, "external_effect");
  assert.equal(spec.minScope, "plugin:dsh-plugin-echo:external_effect");
  assert.equal(spec.id, descriptor.toolId);
});

/**
 * 分级真值表——四行就是全部。写成表驱动而不是四个 test，是因为这四行必须被当成**一张表**读：
 * 少一行就是漏了一种组合，改一格就是改了一次授权口径。
 */
test("分级真值表：管理员断言 AND 工具自述，自述只能降不能抬", () => {
  const table = [
    { trustLevel: "external_effect", selfReportedReadOnly: true, sideEffect: "external_effect", scope: "external_effect" },
    { trustLevel: "external_effect", selfReportedReadOnly: false, sideEffect: "external_effect", scope: "external_effect" },
    { trustLevel: "read_only", selfReportedReadOnly: true, sideEffect: "none", scope: "read" },
    { trustLevel: "read_only", selfReportedReadOnly: false, sideEffect: "external_effect", scope: "external_effect" }
  ] as const;
  for (const row of table) {
    const resolved = resolvePluginToolSideEffect(row);
    assert.equal(
      resolved,
      row.sideEffect,
      `trust=${row.trustLevel} selfReported=${row.selfReportedReadOnly} 应当映成 ${row.sideEffect}`
    );
    assert.equal(pluginToolMinScope("dsh-plugin-echo", resolved), `plugin:dsh-plugin-echo:${row.scope}`);
    const spec = toPluginToolSpec(
      { ...descriptor, selfReportedReadOnly: row.selfReportedReadOnly },
      async () => okToolResult("ok"),
      row.trustLevel
    );
    assert.equal(spec.sideEffect, row.sideEffect);
    assert.equal(spec.minScope, `plugin:dsh-plugin-echo:${row.scope}`);
  }
});

test("落到 none 档的插件工具不再需要快照门（只读工具没有可还原的东西）", async () => {
  const spec = toPluginToolSpec(readOnlyDescriptor, async () => okToolResult("read ok"), "read_only");
  assert.equal(spec.sideEffect, "none");
  const registry = createToolRegistry([spec]);
  // 同一个注册表、同一次调用，不给 snapshot 也能跑通——external_effect 那一档会在这里被拒。
  const result = await registry.execute(descriptor.toolId, { text: "hi" }, ctx);
  assert.equal(result.isError, false);
  assert.equal(result.content, "read ok");
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

test("toPluginToolSpecs 按插件逐个查信任级别——同一批里可以有两档", () => {
  const other: PluginToolDescriptor = {
    ...readOnlyDescriptor,
    pluginId: "dsh-plugin-writer",
    toolId: "plugin__dsh-plugin-writer__write",
    toolName: "write",
    selfReportedReadOnly: false
  };
  const specs = toPluginToolSpecs([readOnlyDescriptor, other], async () => okToolResult("ok"), (item) =>
    item.pluginId === "dsh-plugin-echo" ? "read_only" : "external_effect"
  );
  assert.deepEqual(specs.map((spec) => spec.sideEffect), ["none", "external_effect"]);
  assert.deepEqual(specs.map((spec) => spec.minScope), [
    "plugin:dsh-plugin-echo:read",
    "plugin:dsh-plugin-writer:external_effect"
  ]);
});

test("查不到信任级别时退回最高风险（fail-closed）", () => {
  const specs = toPluginToolSpecs([readOnlyDescriptor], async () => okToolResult("ok"), () => undefined as never);
  assert.equal(specs[0]?.sideEffect, "external_effect");
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
