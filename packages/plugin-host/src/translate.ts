/**
 * dsh `defineTool` 产物 → 线协议描述符 / 模型可见文本（宿主侧翻译器）。
 *
 * 只按**结构**认 dsh 的 `ToolDefinition`，不 import `@deepseek-ai/dsh-tools` 的类型——
 * 这样翻译器本身零 dsh 依赖、可单测，也扛得住 dsh 0.1.x 的破坏性改版（报告风险 3）。
 *
 * dsh 侧契约（`@deepseek-ai/dsh-tools@0.1.0-rc.8` 实测）：`defineTool` 归一化后暴露
 * `{ name, description, parameters(JSON Schema), output: { schema, render }, timeoutMs?, execute }`，
 * `execute` 自带入参校验（缺必填抛 `INVALID_ARGS`），返回**规范 JSON 值**，
 * 再由 `output.render(args, value)` 转成模型可见 `ContentBlock[]`。
 */
import type { PluginToolDescriptor } from "./protocol.js";

/** dsh 工具渲染出的内容块。阶段 0 只认 text 块，其余（image/resource）丢弃并注明。 */
export type DshContentBlock = { type: string; text?: string; [key: string]: unknown };

/** dsh `defineTool` 归一化产物的结构子集——本包只用到这些字段。 */
export type DshToolDefinition = {
  name: string;
  description?: string;
  parameters?: unknown;
  output?: { schema?: unknown; render?: (args: unknown, value: unknown) => unknown };
  timeoutMs?: number;
  execute: (args: unknown, exec: unknown) => unknown;
};

/** 插件工具的 id 前缀。与内置工具（read_file/write_file/load_skill…）名字空间彻底隔开。 */
export const PLUGIN_TOOL_ID_PREFIX = "plugin__";

/**
 * 模型 API 的 tool name 只收 `[A-Za-z0-9_-]`，而插件包名可能带 `@`/`/`/`.`（scoped 包）。
 * 这里把不合规字符统一压成 `_`，并保留原名在描述符里，出问题时能对回去。
 */
export function sanitizeToolNameSegment(value: string) {
  return value.replace(/[^A-Za-z0-9_-]/gu, "_");
}

/** WorkHub 侧工具 id：`plugin__<插件名>__<工具名>`。 */
export function pluginToolId(pluginId: string, toolName: string) {
  return `${PLUGIN_TOOL_ID_PREFIX}${sanitizeToolNameSegment(pluginId)}__${sanitizeToolNameSegment(toolName)}`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * dsh 的 `parameters` 已经是 JSON Schema。不认识/为空时退化成空 object schema，
 * 而不是把 `undefined` 递给模型 API（那会让整轮请求 400）。
 */
export function toJsonSchema(parameters: unknown): Record<string, unknown> {
  if (!isPlainObject(parameters)) {
    return { type: "object", properties: {} };
  }
  const schema = { ...parameters };
  delete schema["$schema"];
  if (typeof schema["type"] !== "string") {
    schema["type"] = "object";
  }
  return schema;
}

export function describePluginTool(pluginId: string, definition: DshToolDefinition): PluginToolDescriptor {
  const toolName = definition.name;
  return {
    pluginId,
    toolName,
    toolId: pluginToolId(pluginId, toolName),
    description: typeof definition.description === "string" && definition.description.trim().length > 0
      ? definition.description
      : `Tool '${toolName}' contributed by plugin '${pluginId}'.`,
    jsonSchema: toJsonSchema(definition.parameters),
    ...(typeof definition.timeoutMs === "number" && Number.isFinite(definition.timeoutMs) && definition.timeoutMs > 0
      ? { timeoutMs: definition.timeoutMs }
      : {})
  };
}

/**
 * `output.render(args, value)` → 单串模型可见文本。
 * - 只取 text 块；非 text 块（图片/资源）记一行占位，让模型知道有东西没带过来，
 *   而不是静默丢失（阶段 0 不支持多模态内容块）。
 * - render 缺失或抛错时回落到 `JSON.stringify(value)`——插件的展示层出问题不该
 *   让一次成功的调用变成失败。
 */
export function renderToolContent(definition: DshToolDefinition, args: unknown, value: unknown): string {
  const render = definition.output?.render;
  if (typeof render !== "function") {
    return stringifyValue(value);
  }
  let blocks: unknown;
  try {
    blocks = render(args, value);
  } catch (error) {
    return `${stringifyValue(value)}\n[plugin render failed: ${error instanceof Error ? error.message : String(error)}]`;
  }
  if (!Array.isArray(blocks)) {
    return stringifyValue(value);
  }
  const parts: string[] = [];
  for (const block of blocks) {
    if (!isPlainObject(block)) {
      continue;
    }
    const candidate = block as DshContentBlock;
    if (candidate.type === "text" && typeof candidate.text === "string") {
      parts.push(candidate.text);
    } else if (typeof candidate.type === "string") {
      parts.push(`[unsupported content block: ${candidate.type}]`);
    }
  }
  const text = parts.join("\n").trim();
  return text.length > 0 ? text : stringifyValue(value);
}

function stringifyValue(value: unknown) {
  if (typeof value === "string") {
    return value;
  }
  if (value === undefined) {
    return "";
  }
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return String(value);
  }
}
