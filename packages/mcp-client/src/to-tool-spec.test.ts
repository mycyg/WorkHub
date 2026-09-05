import assert from "node:assert/strict";
import test from "node:test";

import { createToolRegistry, okToolResult, type ToolExecutionContext } from "@workhub/tools";

import { MCP_TEXT_MAX_CHARS } from "./content.js";
import {
  MCP_INPUT_SCHEMA_MAX_BYTES,
  MCP_TOOL_INPUT_MAX_BYTES,
  describeMcpTool,
  describeMcpTools,
  findUnresolvableRef,
  mcpToolMinScope,
  normalizeMcpAnnotations,
  resolveMcpSideEffect,
  toMcpJsonSchema,
  toMcpToolSpec,
  toMcpToolSpecs,
  type McpServerTrustLevel,
  type McpToolDescriptor
} from "./to-tool-spec.js";
import {
  MCP_ECHO_SERVER_NAME,
  mcpEchoServerToolsListResult,
  mcpEdgeCaseToolsListResult,
  oversizedMcpInputSchema
} from "../qa/fixtures/echo-server-tools.js";

const ctx: ToolExecutionContext = { workdir: "/tmp/workhub-mcp-test" };

function descriptorFor(tool: Record<string, unknown>, trustLevel?: McpServerTrustLevel): McpToolDescriptor {
  const translation = describeMcpTool({ serverName: "echo", trustLevel, tool });
  assert.equal(translation.ok, true, translation.ok ? "" : translation.detail);
  if (!translation.ok) {
    throw new Error("unreachable");
  }
  return translation.descriptor;
}

// ---------------------------------------------------------------------------
// 读写分级的真值表：管理员断言 AND 服务器自述
// ---------------------------------------------------------------------------

const truthTable: {
  trustLevel: McpServerTrustLevel | undefined;
  readOnlyHint: boolean | undefined;
  destructiveHint: boolean | undefined;
  expected: "none" | "external_effect";
}[] = [
  { trustLevel: "read_only", readOnlyHint: true, destructiveHint: undefined, expected: "none" },
  { trustLevel: "read_only", readOnlyHint: true, destructiveHint: false, expected: "none" },
  { trustLevel: "read_only", readOnlyHint: true, destructiveHint: true, expected: "external_effect" },
  { trustLevel: "read_only", readOnlyHint: false, destructiveHint: false, expected: "external_effect" },
  { trustLevel: "read_only", readOnlyHint: undefined, destructiveHint: undefined, expected: "external_effect" },
  { trustLevel: "external_effect", readOnlyHint: true, destructiveHint: false, expected: "external_effect" },
  { trustLevel: "external_effect", readOnlyHint: true, destructiveHint: undefined, expected: "external_effect" },
  { trustLevel: "external_effect", readOnlyHint: undefined, destructiveHint: undefined, expected: "external_effect" },
  { trustLevel: undefined, readOnlyHint: true, destructiveHint: false, expected: "external_effect" },
  { trustLevel: undefined, readOnlyHint: undefined, destructiveHint: undefined, expected: "external_effect" }
];

for (const row of truthTable) {
  test(`分级真值表：管理员=${row.trustLevel ?? "缺省"} 只读自述=${row.readOnlyHint ?? "缺省"} 破坏性自述=${row.destructiveHint ?? "缺省"} → ${row.expected}`, () => {
    const annotations = {
      ...(row.readOnlyHint === undefined ? {} : { readOnlyHint: row.readOnlyHint }),
      ...(row.destructiveHint === undefined ? {} : { destructiveHint: row.destructiveHint })
    };
    assert.equal(resolveMcpSideEffect({ trustLevel: row.trustLevel, annotations }), row.expected);
  });
}

test("annotations 缺席或写成别的类型一律当没说，取最高风险", () => {
  assert.equal(resolveMcpSideEffect({ trustLevel: "read_only", annotations: undefined }), "external_effect");
  assert.deepEqual(normalizeMcpAnnotations({ readOnlyHint: "true" }), {});
  assert.deepEqual(normalizeMcpAnnotations({ readOnlyHint: 1, destructiveHint: null }), {});
  assert.deepEqual(normalizeMcpAnnotations(null), {});
  assert.deepEqual(normalizeMcpAnnotations({ readOnlyHint: true, destructiveHint: false, title: "x" }), {
    readOnlyHint: true,
    destructiveHint: false
  });
  assert.equal(
    resolveMcpSideEffect({ trustLevel: "read_only", annotations: normalizeMcpAnnotations({ readOnlyHint: "true" }) }),
    "external_effect"
  );
});

test("minScope 两档，拼法与插件那侧一致", () => {
  assert.equal(mcpToolMinScope("gh", "none"), "mcp:gh:read");
  assert.equal(mcpToolMinScope("gh", "external_effect"), "mcp:gh:external_effect");
});

test("服务器名在 scope 里必须被压过——否则能伪造出 mcp:*:read 这样的封禁绕过", () => {
  assert.equal(mcpToolMinScope("a:*", "none"), "mcp:a__:read");
  assert.equal(mcpToolMinScope("a:*", "none").split(":").length, 3);
});

// ---------------------------------------------------------------------------
// 逐字段映射
// ---------------------------------------------------------------------------

test("id 走 mcp__ 名字空间，rawName 原样留在描述符里给 tools/call 用", () => {
  const descriptor = descriptorFor({ name: "read.text", description: "d", inputSchema: { type: "object" } });
  assert.equal(descriptor.toolId.startsWith("mcp__echo__read_text_"), true);
  assert.equal(descriptor.rawName, "read.text");
  assert.equal(descriptor.serverName, "echo");
});

test("description 缺省时回落成一句说得清来源的话", () => {
  assert.equal(
    descriptorFor({ name: "echo", inputSchema: { type: "object" } }).description,
    "Tool 'echo' from MCP server 'echo'."
  );
  assert.equal(
    descriptorFor({ name: "echo", description: "   ", inputSchema: {} }).description,
    "Tool 'echo' from MCP server 'echo'."
  );
});

test("description 去掉控制字符并砍到上限", () => {
  assert.equal(descriptorFor({ name: "t", description: "a\x00b" }).description, "a b");
  const long = descriptorFor({ name: "t", description: "x".repeat(MCP_TEXT_MAX_CHARS + 500) });
  assert.equal(long.description.length, MCP_TEXT_MAX_CHARS + 1);
});

test("inputSchema 直通：删 $schema、type 缺省补 object、其余原样", () => {
  assert.deepEqual(toMcpJsonSchema({ $schema: "https://json-schema.org/draft/2020-12/schema", properties: { a: {} } }), {
    type: "object",
    properties: { a: {} }
  });
  assert.deepEqual(toMcpJsonSchema({ type: "string" }), { type: "string" });
  assert.deepEqual(toMcpJsonSchema(undefined), { type: "object", properties: {} });
  assert.deepEqual(toMcpJsonSchema("nope"), { type: "object", properties: {} });
});

test("入参 schema 超过 32KB 的工具被丢弃并给出原因（截断只会产出无效 schema）", () => {
  const properties: Record<string, unknown> = {};
  for (let index = 0; index < 1200; index += 1) {
    properties[`field_${index}`] = { type: "string", description: "padding padding padding" };
  }
  const translation = describeMcpTool({
    serverName: "echo",
    trustLevel: undefined,
    tool: { name: "huge", inputSchema: { type: "object", properties } }
  });
  assert.equal(translation.ok, false);
  assert.equal(translation.ok === false ? translation.reason : "", "input_schema_too_large");
  assert.match(translation.ok === false ? translation.detail : "", new RegExp(`${MCP_INPUT_SCHEMA_MAX_BYTES}`, "u"));
});

test("远程 $ref 的工具被丢弃；同文档片段引用放行", () => {
  for (const ref of ["https://example.invalid/s.json", "file:///etc/passwd", "./local.json", "//host/x"]) {
    const translation = describeMcpTool({
      serverName: "echo",
      trustLevel: undefined,
      tool: { name: "t", inputSchema: { type: "object", properties: { a: { $ref: ref } } } }
    });
    assert.equal(translation.ok, false, ref);
    assert.equal(translation.ok === false ? translation.reason : "", "input_schema_remote_ref");
  }
  const local = describeMcpTool({
    serverName: "echo",
    trustLevel: undefined,
    tool: { name: "t", inputSchema: { type: "object", properties: { a: { $ref: "#/$defs/A" } }, $defs: { A: {} } } }
  });
  assert.equal(local.ok, true);
});

test("$ref 藏在数组或深层嵌套里也找得出来", () => {
  assert.equal(findUnresolvableRef({ anyOf: [{ properties: { a: { $ref: "http://x/y" } } }] }), "http://x/y");
  assert.equal(findUnresolvableRef({ a: { b: { c: [[{ $ref: "#/ok" }]] } } }), undefined);
  assert.equal(findUnresolvableRef({ $ref: 42 }), "42");
});

test("没有名字的工具被丢弃", () => {
  const translation = describeMcpTool({ serverName: "echo", trustLevel: undefined, tool: { description: "x" } });
  assert.equal(translation.ok, false);
  assert.equal(translation.ok === false ? translation.reason : "", "invalid_name");
});

// ---------------------------------------------------------------------------
// 整份清单
// ---------------------------------------------------------------------------

test("整份清单：能翻的照常上线，翻不动的进 rejected", () => {
  const result = describeMcpTools({
    serverName: "echo",
    trustLevel: "read_only",
    tools: [
      { name: "echo", description: "e", inputSchema: { type: "object" }, annotations: { readOnlyHint: true } },
      { name: "write_note", description: "w", inputSchema: { type: "object" } },
      { description: "nameless" }
    ]
  });
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.deepEqual(result.descriptors.map((descriptor) => descriptor.toolId), [
    "mcp__echo__echo",
    "mcp__echo__write_note"
  ]);
  assert.deepEqual(result.descriptors.map((descriptor) => descriptor.sideEffect), ["none", "external_effect"]);
  assert.deepEqual(result.descriptors.map((descriptor) => descriptor.minScope), [
    "mcp:echo:read",
    "mcp:echo:external_effect"
  ]);
  assert.equal(result.rejected.length, 1);
  assert.equal(result.rejected[0]?.reason, "invalid_name");
});

test("整份清单：raw 名重复让整次翻译失败，不留半套", () => {
  const result = describeMcpTools({
    serverName: "echo",
    trustLevel: undefined,
    tools: [{ name: "search" }, { name: "search" }]
  });
  assert.equal(result.ok, false);
  assert.equal(result.ok === false ? result.reason : "", "duplicate_raw_name");
});

test("整份清单：压缩后同形的两个工具靠指纹各自留名，不算坍缩", () => {
  const result = describeMcpTools({
    serverName: "fs",
    trustLevel: undefined,
    tools: [{ name: "read.text" }, { name: "read_text" }]
  });
  assert.equal(result.ok, true);
  assert.equal(result.ok ? new Set(result.descriptors.map((d) => d.toolId)).size : 0, 2);
});

// ---------------------------------------------------------------------------
// ToolSpec 形状与注册表集成
// ---------------------------------------------------------------------------

test("模型看到的是服务器给的 JSON Schema，不是 Zod 退化出的空 object", async () => {
  const descriptor = descriptorFor({
    name: "echo",
    description: "Echo a phrase back.",
    inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] }
  });
  const registry = createToolRegistry([toMcpToolSpec(descriptor, async () => okToolResult("ok"))]);
  const [modelTool] = (await registry.toModelTools(ctx)) as { name: string; input_schema: Record<string, unknown> }[];
  assert.equal(modelTool?.name, "mcp__echo__echo");
  assert.deepEqual(modelTool?.input_schema, {
    type: "object",
    properties: { text: { type: "string" } },
    required: ["text"]
  });
});

test("阶段 0 不把服务器文案送进系统提示词通道", () => {
  const spec = toMcpToolSpec(descriptorFor({ name: "echo" }), async () => okToolResult("ok"));
  assert.equal(spec.promptSnippet, undefined);
  assert.equal(spec.promptGuidelines, undefined);
});

test("执行时把入参与上下文原样交给调用口；模型漏给入参时归一成空对象", async () => {
  const seen: unknown[] = [];
  const descriptor = descriptorFor({ name: "echo" });
  const spec = toMcpToolSpec(descriptor, async (input) => {
    seen.push(input);
    return okToolResult("echoed");
  });
  const result = await spec.execute({ text: "hi" }, { ...ctx, runId: "run-1" });
  assert.equal(result.content, "echoed");
  assert.deepEqual(seen, [{ descriptor, args: { text: "hi" }, ctx: { ...ctx, runId: "run-1" } }]);
  await spec.execute(undefined, ctx);
  assert.deepEqual((seen[1] as { args: unknown }).args, {});
});

test("非对象入参被 schema 挡在执行之前", async () => {
  let called = false;
  const descriptor = descriptorFor({ name: "echo" });
  const registry = createToolRegistry([
    toMcpToolSpec(descriptor, async () => {
      called = true;
      return okToolResult("ok");
    })
  ]);
  const result = await registry.execute(descriptor.toolId, "not an object", {
    ...ctx,
    snapshot: () => ({ snapshotId: "snap-1" })
  });
  assert.equal(result.isError, true);
  assert.equal(called, false);
});

test("超过入参上限的调用被挡下来，不去打满子进程的 stdin", async () => {
  const descriptor = descriptorFor({ name: "echo" });
  let called = false;
  const registry = createToolRegistry([
    toMcpToolSpec(descriptor, async () => {
      called = true;
      return okToolResult("ok");
    })
  ]);
  const oversized = { text: "x".repeat(MCP_TOOL_INPUT_MAX_BYTES + 10) };
  const result = await registry.execute(descriptor.toolId, oversized, {
    ...ctx,
    snapshot: () => ({ snapshotId: "snap-1" })
  });
  assert.equal(result.isError, true);
  assert.equal(called, false);
});

test("写类工具继承注册表的快照门（没有还原点就不许执行）", async () => {
  const descriptor = descriptorFor({ name: "write_note" }, "read_only");
  assert.equal(descriptor.sideEffect, "external_effect");
  const registry = createToolRegistry([toMcpToolSpec(descriptor, async () => okToolResult("ok"))]);
  const result = await registry.execute(descriptor.toolId, { line: "x" }, ctx);
  assert.equal(result.isError, true);
  assert.match(result.content, /requires a snapshot gate/u);
});

test("降到只读的工具不再需要快照门——这正是分级要解开的那道门", async () => {
  const descriptor = descriptorFor({ name: "echo", annotations: { readOnlyHint: true } }, "read_only");
  assert.equal(descriptor.sideEffect, "none");
  const registry = createToolRegistry([toMcpToolSpec(descriptor, async () => okToolResult("echoed"))]);
  const result = await registry.execute(descriptor.toolId, { text: "hi" }, ctx);
  assert.equal(result.isError, false);
  assert.equal(result.content, "echoed");
});

test("toMcpToolSpecs 一一对应", () => {
  const specs = toMcpToolSpecs([descriptorFor({ name: "a" }), descriptorFor({ name: "b" })], async () =>
    okToolResult("ok")
  );
  assert.deepEqual(specs.map((spec) => spec.id), ["mcp__echo__a", "mcp__echo__b"]);
});

// ---------------------------------------------------------------------------
// 常量夹具：M5（真服务器）与 M6（golden）都要引它，这里先证明它是活的
// ---------------------------------------------------------------------------

test("夹具：两个工具正好把分级真值表跑成两端各一条", () => {
  const result = describeMcpTools({
    serverName: MCP_ECHO_SERVER_NAME,
    trustLevel: "read_only",
    tools: [...mcpEchoServerToolsListResult.tools]
  });
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.equal(result.rejected.length, 0);
  assert.deepEqual(
    result.descriptors.map((descriptor) => [descriptor.toolId, descriptor.sideEffect, descriptor.minScope]),
    [
      ["mcp__echo__echo", "none", "mcp:echo:read"],
      ["mcp__echo__write_note", "external_effect", "mcp:echo:external_effect"]
    ]
  );
  // `$schema` 被删掉了，其余原样直通。
  assert.deepEqual(result.descriptors[0]?.jsonSchema, {
    type: "object",
    properties: { text: { type: "string", description: "The phrase to echo." } },
    required: ["text"]
  });
});

test("夹具：同一台服务器换成 external_effect 断言，只读工具也跟着回到最高风险", () => {
  const result = describeMcpTools({
    serverName: MCP_ECHO_SERVER_NAME,
    trustLevel: "external_effect",
    tools: [...mcpEchoServerToolsListResult.tools]
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.ok ? result.descriptors.map((descriptor) => descriptor.sideEffect) : [], [
    "external_effect",
    "external_effect"
  ]);
});

test("边界夹具：每条拒绝规则各命中一次，压缩同形的两个工具仍各自留名", () => {
  const result = describeMcpTools({
    serverName: "fs",
    trustLevel: "read_only",
    tools: [...mcpEdgeCaseToolsListResult.tools]
  });
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.deepEqual(result.rejected.map((entry) => entry.reason).sort(), ["input_schema_remote_ref", "invalid_name"]);
  const ids = result.descriptors.map((descriptor) => descriptor.toolId);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(ids.every((id) => id.length <= 64), true);
  // 自相矛盾的自述（只读 + 有破坏性）在管理员断言只读时仍取最高风险。
  const contradictory = result.descriptors.find((descriptor) => descriptor.rawName === "contradictory");
  assert.equal(contradictory?.sideEffect, "external_effect");
});

test("边界夹具：超大 schema 的工具被丢弃", () => {
  const translation = describeMcpTool({
    serverName: "fs",
    trustLevel: undefined,
    tool: { name: "huge", inputSchema: oversizedMcpInputSchema() }
  });
  assert.equal(translation.ok, false);
  assert.equal(translation.ok === false ? translation.reason : "", "input_schema_too_large");
});
