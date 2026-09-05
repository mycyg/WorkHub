/**
 * 一台假 MCP 服务器的 `tools/list` 常量夹具。
 *
 * 为什么是常量而不是真起一台服务器：**golden 必须离线且确定**。M6 的
 * `apps/api/src/golden/mcp-tool-schemas.golden.test.ts` 用这份夹具建注册表，钉住 MCP 工具的模型可见
 * 文本（id 形状、中和后的 description、直通的 input_schema、side_effect）。真服务器有版本、有时序，
 * 钉不住逐字节的东西。
 *
 * 与 M5 的真夹具服务器（`qa/fixtures/mcp-echo-server/`，用官方 SDK 起进程）分工不同、不互相替代：
 * 那一台证明「链路真的通」，这一份证明「翻译逐字节稳定」。两个工具名刻意保持一致，
 * 好让两条证据对得上。
 *
 * 本文件零 import、零 IO，任何包都可以引。
 */

/** 夹具服务器在配置里的名字。短名，正好演示名字预算够用的情况。 */
export const MCP_ECHO_SERVER_NAME = "echo";

/**
 * 恰好两个工具，把读写分级的真值表跑成两端各一条：
 * - `echo` 自述只读（`readOnlyHint: true`），管理员断言 `read_only` 时降到 `none`；
 * - `write_note` 什么都不说，任何情况下都是 `external_effect`。
 */
export const mcpEchoServerToolsListResult = {
  tools: [
    {
      name: "echo",
      description: "Echo a phrase back.",
      inputSchema: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
        properties: { text: { type: "string", description: "The phrase to echo." } },
        required: ["text"]
      },
      annotations: { readOnlyHint: true }
    },
    {
      name: "write_note",
      description: "Append a line to the shared note file.",
      inputSchema: {
        type: "object",
        properties: { line: { type: "string" } },
        required: ["line"]
      }
    }
  ]
} as const;

/**
 * 边界夹具：把翻译层每条拒绝规则各占一条，供跨包回归复用。
 * 名字都取得能一眼看出它在考什么。
 */
export const mcpEdgeCaseToolsListResult = {
  tools: [
    // 点号不在模型 API 的工具名字符集里 → 压成 `_` 之后必须挂指纹，否则与 `fs_read_text_file` 坍缩。
    { name: "fs.read_text_file", description: "Read a UTF-8 text file.", inputSchema: { type: "object" } },
    { name: "fs_read_text_file", description: "Same name after sanitizing.", inputSchema: { type: "object" } },
    // 超过公开名 64 字符的预算 → 截断并挂指纹。
    {
      name: "create_pull_request_review_comment_with_a_very_long_suffix_indeed",
      description: "Overlong raw name.",
      inputSchema: { type: "object" }
    },
    // 远程 $ref：我们解析不了，喂给模型只会得到一份无效 schema → 丢弃这个工具。
    {
      name: "remote_ref",
      description: "Schema points at an off-document ref.",
      inputSchema: { type: "object", properties: { a: { $ref: "https://example.invalid/schema.json" } } }
    },
    // 没有名字 → 丢弃。
    { description: "Nameless tool.", inputSchema: { type: "object" } },
    // 自述只读却同时自述有破坏性 → 自相矛盾，取最高风险。
    {
      name: "contradictory",
      description: "Says read-only and destructive at once.",
      inputSchema: { type: "object" },
      annotations: { readOnlyHint: true, destructiveHint: true }
    }
  ]
} as const;

/** 造一份序列化后必定超过入参 schema 上限的 schema（不把几十 KB 字面量塞进仓库）。 */
export function oversizedMcpInputSchema(approximateBytes = 40 * 1024): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const perProperty = 48;
  for (let index = 0; index < Math.ceil(approximateBytes / perProperty); index += 1) {
    properties[`field_${index}`] = { type: "string", description: "padding" };
  }
  return { type: "object", properties };
}
