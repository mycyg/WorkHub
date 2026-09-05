/**
 * MCP 服务器自报的工具定义 → WorkHub `ToolSpec`（设计稿 4.2 的逐字段映射表）。
 *
 * 这是「MCP 只提供能力实现、不提供授权」的落点：翻出来的 ToolSpec 走的是**既有**注册表通道，
 * 于是自动继承 `canUse` 双检、副作用工具的快照门、human-reserved 拦截与审批链——
 * 第三方服务器在别的进程里，授权判断全在这一侧。
 *
 * ## 读写分级的真值表（指挥者拍板，阶段 0 与阶段 1 合并交付）
 *
 * 最终 `sideEffect` = **管理员断言** AND **服务器自述**：
 *
 * | 管理员 `trust_level` | `readOnlyHint` | `destructiveHint` | 结果               |
 * |---------------------|----------------|-------------------|--------------------|
 * | `read_only`         | `true`         | 非 `true`         | `none`             |
 * | `read_only`         | `true`         | `true`            | `external_effect`  |
 * | `read_only`         | 非 `true`      | 任意              | `external_effect`  |
 * | `external_effect`   | 任意           | 任意              | `external_effect`  |
 * | 缺省 / 认不出       | 任意           | 任意              | `external_effect`  |
 *
 * 两条道理必须一起说才成立：
 * - **为什么要分级**：`external_effect` 会被 `sideEffectRiskCategory()` 归到 external 风险类，
 *   而人工保留门对**有风险类的调用一律开升级**（不管工单是否被标人工保留）。把 MCP 工具全钉在
 *   `external_effect`，等于每调用一次就停下来转人一次——而 MCP 生态里占大头的恰恰是只读检索。
 * - **为什么敢分级**：MCP 规范自己写明 annotations 是**不可信提示**，客户端不得据以做安全判断。
 *   所以服务器的自述**只能在管理员划定的上限内降风险，永远不能自己抬权限**；两边都说只读才算只读，
 *   任何缺省、任何认不出的值，都取最高风险那一档。
 *
 * ## 阶段 0 仍然保守的地方
 *
 * 不设 `promptSnippet` / `promptGuidelines`：那两条通道的文案会进系统提示词，属于提示词注入面，
 * 要排在提示词 golden 之后。模型仍能通过 `toModelTools`（tool description 通道）看到并调用它，
 * 与插件阶段 0 同口径。
 */
import type { AnyToolSpec, ToolExecutionContext, ToolResult, ToolSideEffect } from "@workhub/tools";
import { z } from "zod";

import { MCP_TEXT_MAX_CHARS, sanitizeModelFacingText } from "./content.js";
import { publicToolName, sanitizeMcpNameSegment } from "./names.js";

/** 管理员对一台服务器的断言。分级的上限由它划定，服务器只能在这条线以内降风险。 */
export type McpServerTrustLevel = "read_only" | "external_effect";

/** 我们看得懂的两个 annotation 提示。其余（idempotentHint/openWorldHint/title）阶段 0 不消费。 */
export type McpToolAnnotations = {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
};

/** MCP `tools/list` 里的一条工具定义。字段全部按第三方来源对待。 */
export type McpToolDefinition = {
  name?: unknown;
  description?: unknown;
  inputSchema?: unknown;
  annotations?: unknown;
  [key: string]: unknown;
};

/** 翻译后的工具描述符——本包内的记录类型，不进 `packages/contracts`。 */
export type McpToolDescriptor = {
  /** 本地配置的服务器名，绝不取远端自报的 `serverInfo.name`。 */
  serverName: string;
  /** 协议上的原始工具名。**只**用于 `tools/call`，公开名从不反解回它。 */
  rawName: string;
  /** 模型看到的公开名。 */
  toolId: string;
  description: string;
  jsonSchema: Record<string, unknown>;
  sideEffect: ToolSideEffect;
  minScope: string;
  /** 归一化后的服务器自述（只留看得懂的布尔值），留着让治理页面解释分级结论。 */
  annotations: McpToolAnnotations;
};

/** 某一个工具翻不动的原因。整份清单仍可用，只是少这一个。 */
export type McpToolRejectionReason =
  | "invalid_name"
  | "input_schema_unserializable"
  | "input_schema_too_large"
  | "input_schema_remote_ref";

export type McpToolRejection = {
  rawName: string;
  reason: McpToolRejectionReason;
  /** 英文诊断，人话由展示层出。 */
  detail: string;
};

export type McpToolTranslation =
  | { ok: true; descriptor: McpToolDescriptor }
  | ({ ok: false } & McpToolRejection);

/**
 * 入参 JSON Schema 的序列化上限。
 * 超限**丢弃该工具**而不是截断：截断一份 JSON Schema 只会产出无效 schema，
 * 模型 API 会拿整轮请求报 400——为了一个工具搭上整次执行，不划算。
 */
export const MCP_INPUT_SCHEMA_MAX_BYTES = 32 * 1024;

/** 一次调用的入参序列化上限。 */
export const MCP_TOOL_INPUT_MAX_BYTES = 256 * 1024;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 入参只要求「是个对象（或没给）」，外加一个序列化上限。
 *
 * 真正的结构校验交给服务器——它自己声明了 `inputSchema`，在主进程里重实现一份 JSON Schema
 * 校验器既重复又容易和服务器不一致。模型看到的形状由 `jsonSchema` 旁路给。
 * 上限则是我们自己的责任：模型可以生成任意大的入参，一次 10MB 的调用能把子进程的 stdin 打满。
 */
const mcpToolInputSchema = z.custom<Record<string, unknown>>(
  (value) => {
    if (value === undefined || value === null) {
      return true;
    }
    if (!isPlainObject(value)) {
      return false;
    }
    let json: string;
    try {
      json = JSON.stringify(value) ?? "";
    } catch {
      return false;
    }
    return Buffer.byteLength(json, "utf8") <= MCP_TOOL_INPUT_MAX_BYTES;
  },
  { message: "mcp tool input must be an object within the size limit" }
);

/** 只认得懂的两个布尔提示；写成别的类型（字符串 "true"、数字 1）一律当没说。 */
export function normalizeMcpAnnotations(value: unknown): McpToolAnnotations {
  if (!isPlainObject(value)) {
    return {};
  }
  const annotations: McpToolAnnotations = {};
  if (typeof value["readOnlyHint"] === "boolean") {
    annotations.readOnlyHint = value["readOnlyHint"];
  }
  if (typeof value["destructiveHint"] === "boolean") {
    annotations.destructiveHint = value["destructiveHint"];
  }
  return annotations;
}

/** 真值表的唯一实现处。任何缺省都取最高风险。 */
export function resolveMcpSideEffect(input: {
  trustLevel: McpServerTrustLevel | undefined;
  annotations: McpToolAnnotations | undefined;
}): ToolSideEffect {
  const adminSaysReadOnly = input.trustLevel === "read_only";
  const serverSaysReadOnly = input.annotations?.readOnlyHint === true && input.annotations?.destructiveHint !== true;
  return adminSaysReadOnly && serverSaysReadOnly ? "none" : "external_effect";
}

/**
 * capability 键：`mcp:<服务器名>:<read | external_effect>`。
 * 拼法对齐 `plugin-host` 的 `plugin:<id>:<cap>`，喂 `packages/permissions` 的 glob，
 * 于是 `mcp:github:*` 与全局 `mcp:*` 都是现成的一键封禁写法。
 *
 * 服务器名在这里**必须**过一遍压缩：一个含 `*` 或 `:` 的名字能伪造出 `mcp:*:read` 这样的 scope
 * 字面量，把封禁规则的语义整个绕过去。治理层已经按 `^[A-Za-z0-9_-]{1,32}$` 拦过一道，
 * 这里是第二道——scope 字符串是安全判断的输入，不该依赖上游拦干净。
 *
 * 如实说明：`minScope` 至今零运行时消费者，它是登记不是门。
 */
export function mcpToolMinScope(serverName: string, sideEffect: ToolSideEffect): string {
  return `mcp:${sanitizeMcpNameSegment(serverName)}:${sideEffect === "none" ? "read" : "external_effect"}`;
}

/**
 * 入参 schema 直通：删 `$schema`，`type` 缺省补 `"object"`。
 * 认不出（不是对象）时退化成空 object schema，而不是把 `undefined` 递给模型 API（那会让整轮请求 400）。
 * 与 `plugin-host/src/translate.ts` 的 `toJsonSchema` 同口径。
 */
export function toMcpJsonSchema(inputSchema: unknown): Record<string, unknown> {
  if (!isPlainObject(inputSchema)) {
    return { type: "object", properties: {} };
  }
  const schema = { ...inputSchema };
  delete schema["$schema"];
  if (typeof schema["type"] !== "string") {
    schema["type"] = "object";
  }
  return schema;
}

/**
 * 找出第一个**取不到**的 `$ref`。
 *
 * 同文档片段引用（`#/$defs/X`）是 JSON Schema 的常规写法，放行。除此以外一律拒：
 * - `http://` / `https://`：让模型 API 或任何下游解析器去拉一个第三方 URL，是一条我们没打算开的出网口子。
 * - `file://` 与相对路径：指向宿主机文件，且我们根本不解析它——留着只会得到一份对模型无效的 schema。
 *
 * 设计稿点名的是 `http:`/`file:` 两种；这里收得更紧（凡不是 `#` 开头的 `$ref` 都拒），
 * 理由是「拒绝一份我们解析不了的 schema」比「逐个 scheme 追着堵」稳。
 *
 * 用显式栈遍历而不是递归：入参已经过了 32KB 上限，但一份 32KB 的深嵌套文档仍能把递归栈压爆。
 */
export function findUnresolvableRef(schema: unknown): string | undefined {
  const stack: unknown[] = [schema];
  while (stack.length > 0) {
    const node = stack.pop();
    if (Array.isArray(node)) {
      stack.push(...node);
      continue;
    }
    if (!isPlainObject(node)) {
      continue;
    }
    const ref = node["$ref"];
    if (ref !== undefined) {
      if (typeof ref !== "string" || !ref.startsWith("#")) {
        return typeof ref === "string" ? ref : JSON.stringify(ref);
      }
    }
    for (const value of Object.values(node)) {
      stack.push(value);
    }
  }
  return undefined;
}

export type DescribeMcpToolInput = {
  serverName: string;
  /** 管理员对这台服务器的断言。没有断言就是最高风险。 */
  trustLevel: McpServerTrustLevel | undefined;
  tool: McpToolDefinition;
};

/** 一条工具定义 → 描述符。翻不动就返回原因，不抛错。 */
export function describeMcpTool(input: DescribeMcpToolInput): McpToolTranslation {
  const rawName = typeof input.tool.name === "string" ? input.tool.name : "";
  if (rawName.length === 0) {
    return { ok: false, rawName: "", reason: "invalid_name", detail: "tool has no name" };
  }
  const jsonSchema = toMcpJsonSchema(input.tool.inputSchema);
  let serialized: string;
  try {
    serialized = JSON.stringify(jsonSchema) ?? "";
  } catch (error) {
    return {
      ok: false,
      rawName,
      reason: "input_schema_unserializable",
      detail: error instanceof Error ? error.message.slice(0, 200) : "inputSchema is not serializable"
    };
  }
  const bytes = Buffer.byteLength(serialized, "utf8");
  if (bytes > MCP_INPUT_SCHEMA_MAX_BYTES) {
    return {
      ok: false,
      rawName,
      reason: "input_schema_too_large",
      detail: `inputSchema serializes to ${bytes} bytes, over the ${MCP_INPUT_SCHEMA_MAX_BYTES} byte limit`
    };
  }
  const badRef = findUnresolvableRef(jsonSchema);
  if (badRef !== undefined) {
    return {
      ok: false,
      rawName,
      reason: "input_schema_remote_ref",
      detail: `inputSchema references ${badRef.slice(0, 200)}, which is not a same-document fragment`
    };
  }
  const annotations = normalizeMcpAnnotations(input.tool.annotations);
  const sideEffect = resolveMcpSideEffect({ trustLevel: input.trustLevel, annotations });
  const rawDescription = typeof input.tool.description === "string" ? input.tool.description.trim() : "";
  return {
    ok: true,
    descriptor: {
      serverName: input.serverName,
      rawName,
      toolId: publicToolName(input.serverName, rawName),
      description:
        rawDescription.length > 0
          ? sanitizeModelFacingText(rawDescription, MCP_TEXT_MAX_CHARS)
          : `Tool '${sanitizeModelFacingText(rawName, 120)}' from MCP server '${sanitizeModelFacingText(input.serverName, 40)}'.`,
      jsonSchema,
      sideEffect,
      minScope: mcpToolMinScope(input.serverName, sideEffect),
      annotations
    }
  };
}

/** 整份清单不可用的原因（不是某一个工具的问题）。 */
export type McpToolListError = { reason: "duplicate_raw_name" | "public_name_collision"; detail: string };

export type McpToolListTranslation =
  | { ok: true; descriptors: McpToolDescriptor[]; rejected: McpToolRejection[] }
  | ({ ok: false } & McpToolListError);

/**
 * 整份 `tools/list` → 描述符清单。
 *
 * 逐工具的问题（没名字、schema 太大、远程 `$ref`）进 `rejected`，剩下的照常上线；
 * 整份清单级别的问题（raw 名重复、公开名坍缩）让整次翻译失败，由调用方整代丢弃并把服务器标成
 * 连不上——「留半套」比「一个都不给」更难查，也更容易让模型调到不是它以为的那个工具。
 */
export function describeMcpTools(input: {
  serverName: string;
  trustLevel: McpServerTrustLevel | undefined;
  tools: readonly McpToolDefinition[];
}): McpToolListTranslation {
  const descriptors: McpToolDescriptor[] = [];
  const rejected: McpToolRejection[] = [];
  const seenRaw = new Set<string>();
  const seenPublic = new Map<string, string>();
  for (const tool of input.tools) {
    const translation = describeMcpTool({ serverName: input.serverName, trustLevel: input.trustLevel, tool });
    if (!translation.ok) {
      rejected.push({ rawName: translation.rawName, reason: translation.reason, detail: translation.detail });
      continue;
    }
    const descriptor = translation.descriptor;
    if (seenRaw.has(descriptor.rawName)) {
      return { ok: false, reason: "duplicate_raw_name", detail: `tool name listed twice: ${descriptor.rawName}` };
    }
    seenRaw.add(descriptor.rawName);
    const previous = seenPublic.get(descriptor.toolId);
    if (previous !== undefined) {
      return {
        ok: false,
        reason: "public_name_collision",
        detail: `${previous} and ${descriptor.rawName} both map to ${descriptor.toolId}`
      };
    }
    seenPublic.set(descriptor.toolId, descriptor.rawName);
    descriptors.push(descriptor);
  }
  return { ok: true, descriptors, rejected };
}

/** 一次 MCP 工具调用的执行口——由 apps/api 侧注入（负责连接、超时、重连预算、审计）。 */
export type McpToolInvoker = (input: {
  descriptor: McpToolDescriptor;
  args: Record<string, unknown>;
  ctx: ToolExecutionContext;
}) => Promise<ToolResult>;

export function toMcpToolSpec(descriptor: McpToolDescriptor, invoke: McpToolInvoker): AnyToolSpec {
  return {
    id: descriptor.toolId,
    description: descriptor.description,
    schema: mcpToolInputSchema,
    jsonSchema: descriptor.jsonSchema,
    sideEffect: descriptor.sideEffect,
    minScope: descriptor.minScope,
    execute: (input, ctx) =>
      invoke({
        descriptor,
        args: (input ?? {}) as Record<string, unknown>,
        ctx
      })
  };
}

export function toMcpToolSpecs(descriptors: readonly McpToolDescriptor[], invoke: McpToolInvoker): AnyToolSpec[] {
  return descriptors.map((descriptor) => toMcpToolSpec(descriptor, invoke));
}
