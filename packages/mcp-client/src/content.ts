/**
 * MCP `tools/call` 的结果内容块 → 模型可见文本（设计稿 4.2 末两行、4.4 第 2 条）。
 *
 * 三条纪律，逐条说清为什么：
 *
 * 1. **非 text 块留占位，不静默丢。** 服务器可以回 image / audio / resource 块。阶段 0 只带文本，
 *    但「有东西没带过来」必须让模型知道——静默丢会让模型对着半份结果编一个完整结论。
 *    这条与 `plugin-host/src/translate.ts` 的 `renderToolContent` 同口径。
 *
 * 2. **过围栏中和。** 工具结果本身进的是 tool_result 消息，不在围栏里；但它**常被工人原样抄进
 *    `outputs/` 与自述**，而那两条确实要进评审围栏（`packages/agent/src/loop/loop.ts` 的 `fenced()`
 *    与 `collectOutputExcerpts`）。一台服务器只要在结果里回一行字面的 `</outputs>`，就能在第二段
 *    提前闭合围栏、把后文送到围栏外冒充指令。中和成本 O(len)，堵的是这条二段式逃逸。
 *
 * 3. **上限 32KB 且带截断标记。** 这是继 `read_file` 之后又一条几乎没有预算约束的入口：
 *    服务器返回多少就进多少，能一次撑爆上下文与成本。截断必须留痕，否则模型会把半截当全部。
 *
 * **M1b 合并点**：`neutralizeMcpFenceTags` 与 `sanitizeModelFacingText` 是从既有实现复制来的最小
 * 逻辑（来源见各自注释）。本包不依赖 `@workhub/agent`，正确的归宿是 `packages/tools`——M1b 工包
 * 把 `plugin-host` 的 `sanitizePluginText` 挪过去时，把这两个函数一并收进去，本包与 plugin-host
 * 各改一处 import。在那之前，`content.test.ts` 里有一条**对着 loop.ts 源码核对围栏标签表**的
 * 漂移守卫：那边加了新围栏标签而这边没跟上，测试会红。
 */
import { errorToolResult, okToolResult, type ToolResult } from "@workhub/tools";

/**
 * 围栏标签登记表——复制自 `packages/agent/src/loop/loop.ts` 的 `FENCE_TAG_NAMES`。
 * 那边是权威，这边是副本；`content.test.ts` 的漂移守卫盯着两者一致。
 */
export const MCP_FENCE_TAG_NAMES = [
  "outputs",
  "worker_claim",
  "task",
  "acceptance",
  "changes",
  "work_item_context",
  "user_memory",
  "agent_private_memory",
  "task_plan_objective"
] as const;

const MCP_FENCE_TAG_PATTERN = new RegExp(`<\\/?(?:${MCP_FENCE_TAG_NAMES.join("|")}|candidate_\\d+)\\s*>`, "giu");

/**
 * 把内容里所有「已知评审围栏标签」的尖括号中和成全角书名号（`<` 成 `‹`、`>` 成 `›`），
 * 使其无法发出真正的定界符。普通文本里的 `<` `>` 不受影响，长度也不变。
 * 逻辑与 `loop.ts` 的 `neutralizeFenceTags` 一致。
 */
export function neutralizeMcpFenceTags(text: string): string {
  return text.replace(MCP_FENCE_TAG_PATTERN, (match) => match.replace(/</gu, "‹").replace(/>/gu, "›"));
}

/** 第三方文案进模型可见通道（工具 description）前的长度上限。 */
export const MCP_TEXT_MAX_CHARS = 4000;

/** C0 控制字符（保留换行与制表）加上 DEL。与 `plugin-host` 的 `sanitizePluginText` 同一张表。 */
const CONTROL_CHAR_PATTERN = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/gu;

/**
 * 第三方文案的最低限度中和：去掉 C0 控制字符（保留换行与制表），砍到上限。
 * 逻辑复制自 `plugin-host/src/to-tool-spec.ts` 的 `sanitizePluginText`（M1b 合并点）。
 * 不做语义改写——「装不装、给不给看」由治理层决定，这里只保证一段第三方字符串不会把请求体
 * 搞坏或撑爆提示词预算。
 */
export function sanitizeModelFacingText(value: string, maxChars = MCP_TEXT_MAX_CHARS): string {
  const stripped = value.replace(CONTROL_CHAR_PATTERN, " ");
  return stripped.length > maxChars ? `${stripped.slice(0, maxChars)}…` : stripped;
}

/** 一次调用结果的文本上限。超出即截断并留标记。 */
export const MCP_CONTENT_MAX_CHARS = 32 * 1024;

/** MCP 结果里的一个内容块。字段全部按第三方来源对待（可能缺、可能不是预期类型）。 */
export type McpContentBlock = {
  type?: unknown;
  text?: unknown;
  [key: string]: unknown;
};

/** MCP `tools/call` 的返回值。同样按第三方来源对待。 */
export type McpCallToolResult = {
  content?: unknown;
  structuredContent?: unknown;
  isError?: unknown;
  [key: string]: unknown;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 非 text 块的占位说明。块类型是服务器给的字符串，进模型可见文本前要夹短并去掉控制字符——
 * 一个 40KB 的 `type` 字段不该顶掉真正的结果。
 */
function describeBlockType(type: unknown): string {
  if (typeof type !== "string") {
    return "[unsupported content block]";
  }
  const label = sanitizeModelFacingText(type, 40).replace(/[\r\n\]]/gu, " ").trim();
  return label.length > 0 ? `[unsupported content block: ${label}]` : "[unsupported content block]";
}

function stringifyStructured(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return "";
  }
}

/**
 * 按上限截断，并在末尾留一行标记。
 *
 * 两个细节不是讲究，是必须：
 * - **给标记预留位置**，让「结果文本 ≤ 上限」这句话成立。标记贴在上限之外会让下游的
 *   「≤32KB」断言时对时错。
 * - **不切开代理对**：`slice` 按 UTF-16 码元切，正好切在一个 emoji 中间会留下半个代理对。
 *   孤立代理对在 JSON 序列化时变成替换字符，个别 HTTP 客户端直接报编码错——
 *   把一次本来成功的调用变成失败。
 */
export function truncateMcpContent(text: string, maxChars = MCP_CONTENT_MAX_CHARS): string {
  if (text.length <= maxChars) {
    return text;
  }
  const marker = `[truncated: 共 ${text.length} 字符]`; // ui-i18n-allow：模型可见的截断标记，不是界面文案
  let keep = Math.max(0, maxChars - marker.length - 1);
  const lastCode = keep > 0 ? text.charCodeAt(keep - 1) : 0;
  if (lastCode >= 0xd800 && lastCode <= 0xdbff) {
    keep -= 1;
  }
  return `${text.slice(0, keep)}\n${marker}`;
}

/**
 * MCP 结果 → WorkHub `ToolResult`。
 *
 * `isError: true` 转成错误结果而不是抛出：MCP 规范把**工具自身的错误**放在带内（带内错误让模型
 * 看得见、能改参数重试），传输层失败才是异常。这两件事混起来会让模型对着一次「参数写错了」
 * 的可恢复错误直接放弃。
 *
 * `structuredContent` 原样带进 `ToolResult.data`，不做校验——服务器的 `outputSchema` 是它自己的
 * 责任，我们在这里重实现一份 JSON Schema 校验器既重复又容易和服务器不一致。
 */
export function renderMcpContent(result: McpCallToolResult): ToolResult {
  const blocks = Array.isArray(result.content) ? result.content : [];
  const parts: string[] = [];
  for (const block of blocks) {
    if (!isPlainObject(block)) {
      parts.push("[unsupported content block]");
      continue;
    }
    const candidate = block as McpContentBlock;
    if (candidate.type === "text" && typeof candidate.text === "string") {
      parts.push(candidate.text);
      continue;
    }
    parts.push(describeBlockType(candidate.type));
  }
  let text = parts.join("\n");
  if (text.length === 0) {
    // 一个块都没有时退回结构化结果；两者都空就说清楚是空结果，别丢给模型一段空白让它猜。
    const structured = result.structuredContent === undefined ? "" : stringifyStructured(result.structuredContent);
    text = structured.length > 0 ? structured : "[empty result]";
  }
  // 先中和再截断：中和不改变长度，截断只会往下削——反过来会让截断处附近的标签逃过中和。
  text = truncateMcpContent(neutralizeMcpFenceTags(text));
  const extras = result.structuredContent === undefined ? {} : { data: result.structuredContent };
  return result.isError === true ? errorToolResult(text, extras) : okToolResult(text, extras);
}
