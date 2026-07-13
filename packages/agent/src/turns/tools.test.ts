import assert from "node:assert/strict";
import test from "node:test";

import {
  ASK_CLARIFYING_QUESTION_TOOL,
  CREATE_WORK_ITEM_TOOL,
  DRIVE_SEARCH_TOOL,
  MAX_TURN_MODEL_ROUNDS,
  MAX_TURN_TOOL_CALLS,
  SEND_FILE_CARD_TOOL,
  buildTurnToolDefinitions,
  parseTurnToolCall
} from "./tools.js";

function toolNames(tools: unknown[]): string[] {
  return tools.map((tool) => (tool as { name: string }).name);
}

test("buildTurnToolDefinitions always exposes the three base tools and hides create_work_item by default", () => {
  const tools = buildTurnToolDefinitions({ allowCreateWorkItem: false });
  assert.deepEqual(toolNames(tools), [DRIVE_SEARCH_TOOL, SEND_FILE_CARD_TOOL, ASK_CLARIFYING_QUESTION_TOOL]);
});

test("buildTurnToolDefinitions exposes create_work_item only when a pending clarification was answered", () => {
  const tools = buildTurnToolDefinitions({ allowCreateWorkItem: true });
  assert.ok(toolNames(tools).includes(CREATE_WORK_ITEM_TOOL));
});

test("buildTurnToolDefinitions emits concrete JSON schema input shapes for provider tool calling", () => {
  const tools = buildTurnToolDefinitions({ allowCreateWorkItem: true }) as Array<{
    name: string;
    input_schema?: { properties?: Record<string, unknown>; required?: string[] };
  }>;
  const driveSearch = tools.find((tool) => tool.name === DRIVE_SEARCH_TOOL);
  assert.ok(driveSearch?.input_schema?.properties?.["query"]);
  assert.deepEqual(driveSearch?.input_schema?.required, ["query"]);

  const createWorkItem = tools.find((tool) => tool.name === CREATE_WORK_ITEM_TOOL);
  assert.ok(createWorkItem?.input_schema?.properties?.["title"]);
  assert.ok(createWorkItem?.input_schema?.properties?.["summary"]);
  assert.deepEqual(createWorkItem?.input_schema?.required?.sort(), ["summary", "title"]);
});

test("parseTurnToolCall accepts a well-formed drive_search call", () => {
  const result = parseTurnToolCall(DRIVE_SEARCH_TOOL, { query: "合同" });
  assert.deepEqual(result, { ok: true, name: DRIVE_SEARCH_TOOL, input: { query: "合同" } });
});

test("parseTurnToolCall rejects an empty query without throwing", () => {
  const result = parseTurnToolCall(DRIVE_SEARCH_TOOL, { query: "" });
  assert.equal(result.ok, false);
});

// findings-同构：anthropic-compatible.ts 的 finalizeBlock 在 tool_use 的 partial_json 因 max_tokens
// 截断而解析失败时，会把 input 原样存成一个字符串——这里断言这种「半截工具调用」不会抛异常，只是被
// 温和地判定为参数不对，调用方据此生成一条错误 tool_result，而不是让整个 turn 崩掉。
test("parseTurnToolCall degrades gracefully when input is a truncated raw string instead of an object", () => {
  const result = parseTurnToolCall(SEND_FILE_CARD_TOOL, "{\"drive_item_id\": \"abc");
  assert.equal(result.ok, false);
});

test("parseTurnToolCall accepts a well-formed create_work_item call with an optional clarification answer", () => {
  const result = parseTurnToolCall(CREATE_WORK_ITEM_TOOL, {
    title: "整理季度报告",
    summary: "按上季度数据整理一份季度报告",
    clarification_answer: "只要销售数据那部分"
  });
  assert.equal(result.ok, true);
});

test("parseTurnToolCall accepts a well-formed ask_clarifying_question call with options", () => {
  const result = parseTurnToolCall(ASK_CLARIFYING_QUESTION_TOOL, {
    question: "你是想要 PPT 还是 Word 文档？",
    options: ["PPT", "Word"]
  });
  assert.equal(result.ok, true);
});

test("parseTurnToolCall reports an unknown tool name instead of throwing", () => {
  const result = parseTurnToolCall("delete_everything", {});
  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.error, /未知工具/u);
});

test("the tool-call hard cap and total round cap agree: cap + 1 forced closing round", () => {
  assert.equal(MAX_TURN_TOOL_CALLS, 3);
  assert.equal(MAX_TURN_MODEL_ROUNDS, MAX_TURN_TOOL_CALLS + 1);
});
