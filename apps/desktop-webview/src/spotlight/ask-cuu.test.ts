import assert from "node:assert/strict";
import { test } from "node:test";

import { commandRegistry } from "../command-palette.js";
import {
  ASK_CUU_MIN_QUERY_LENGTH,
  askCuuReducer,
  buildAskCuuCapabilities,
  buildAskCuuRequestPayload,
  decideAskCuuPresentation,
  initialAskCuuState,
  renderAskCuuAnswerHtml,
  type AskCuuResult
} from "./ask-cuu.js";

test("ASK_CUU_MIN_QUERY_LENGTH gates a short residual query out of the ask-Cuu affordance", () => {
  assert.equal(ASK_CUU_MIN_QUERY_LENGTH, 4);
});

test("buildAskCuuCapabilities mirrors the command registry (every id present, no emoji, localized labels)", () => {
  const zh = buildAskCuuCapabilities("zh-CN");
  const en = buildAskCuuCapabilities("en");
  assert.equal(zh.length, commandRegistry.length);
  assert.equal(en.length, commandRegistry.length);
  for (const command of commandRegistry) {
    const zhEntry = zh.find((c) => c.id === command.id);
    const enEntry = en.find((c) => c.id === command.id);
    assert.ok(zhEntry);
    assert.ok(enEntry);
    assert.equal(zhEntry?.label, command.label["zh-CN"]);
    assert.equal(enEntry?.label, command.label.en);
    assert.doesNotMatch(zhEntry?.label ?? "", /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
  }
});

test("buildAskCuuRequestPayload trims the query and carries the localized capability list", () => {
  const payload = buildAskCuuRequestPayload("  看看这个月花了多少钱  ", "zh-CN");
  assert.equal(payload.query, "看看这个月花了多少钱");
  assert.equal(payload.capabilities.length, commandRegistry.length);
});

// ── 低把握先确认矩阵：open_page / new_project 按置信度分叉，create_task 恒定先确认，answer 无确认条 ──

test("open_page: high confidence auto-navigates with an undoable understood-text; low confidence confirms first", () => {
  const high: AskCuuResult = { intent: "open_page", confidence: "high", page: "cost" };
  const low: AskCuuResult = { intent: "open_page", confidence: "low", page: "cost" };

  const autoPresentation = decideAskCuuPresentation(high, "zh-CN");
  assert.deepEqual(autoPresentation, { kind: "auto", commandId: "cost", understoodText: "Cuu 理解为：打开「成本」" });

  const confirmPresentation = decideAskCuuPresentation(low, "zh-CN");
  assert.deepEqual(confirmPresentation, {
    kind: "confirm_open_page",
    commandId: "cost",
    understoodText: "Cuu 理解为：打开「成本」"
  });
});

test("open_page: falls back to the raw page id in the understood text when the id is not a known command", () => {
  const result: AskCuuResult = { intent: "open_page", confidence: "high", page: "made_up_page" };
  const presentation = decideAskCuuPresentation(result, "zh-CN");
  assert.deepEqual(presentation, {
    kind: "auto",
    commandId: "made_up_page",
    understoodText: "Cuu 理解为：打开「made_up_page」"
  });
});

test("new_project: high confidence auto-opens; low confidence confirms first", () => {
  const high: AskCuuResult = { intent: "new_project", confidence: "high", project_name: "稀土供应链分析" };
  const low: AskCuuResult = { intent: "new_project", confidence: "low", project_name: "稀土供应链分析" };

  assert.deepEqual(decideAskCuuPresentation(high, "zh-CN"), {
    kind: "auto_new_project",
    understoodText: "Cuu 理解为：新建项目「稀土供应链分析」"
  });
  assert.deepEqual(decideAskCuuPresentation(low, "zh-CN"), {
    kind: "confirm_new_project",
    understoodText: "Cuu 理解为：新建项目「稀土供应链分析」"
  });
});

test("create_task: always confirms first regardless of confidence", () => {
  const high: AskCuuResult = { intent: "create_task", confidence: "high", task_title: "整理上周访谈纪要" };
  const low: AskCuuResult = { intent: "create_task", confidence: "low", task_title: "整理上周访谈纪要" };

  assert.deepEqual(decideAskCuuPresentation(high, "zh-CN"), {
    kind: "confirm_create_task",
    taskTitle: "整理上周访谈纪要",
    understoodText: "Cuu 理解为：新建任务「整理上周访谈纪要」"
  });
  assert.deepEqual(decideAskCuuPresentation(low, "zh-CN"), {
    kind: "confirm_create_task",
    taskTitle: "整理上周访谈纪要",
    understoodText: "Cuu 理解为：新建任务「整理上周访谈纪要」"
  });
});

test("answer: renders inline with no confirmation bar regardless of confidence", () => {
  const high: AskCuuResult = { intent: "answer", confidence: "high", answer_md: "这是一句回答" };
  const low: AskCuuResult = { intent: "answer", confidence: "low", answer_md: "不太确定，但大概是这样" };
  assert.deepEqual(decideAskCuuPresentation(high, "zh-CN"), { kind: "answer", answerMd: "这是一句回答" });
  assert.deepEqual(decideAskCuuPresentation(low, "zh-CN"), { kind: "answer", answerMd: "不太确定，但大概是这样" });
});

test("decideAskCuuPresentation localizes understood-text to English under an en locale", () => {
  const result: AskCuuResult = { intent: "open_page", confidence: "high", page: "cost" };
  const presentation = decideAskCuuPresentation(result, "en");
  assert.deepEqual(presentation, { kind: "auto", commandId: "cost", understoodText: 'Cuu understood: open "Cost"' });
});

// ── 微状态机 ──────────────────────────────────────────────────────────────────────

test("askCuuReducer transitions idle -> asking -> presenting -> dismiss -> idle", () => {
  let state = initialAskCuuState;
  assert.deepEqual(state, { phase: "idle" });

  state = askCuuReducer(state, { type: "ask", query: "看看这个月花了多少钱" });
  assert.deepEqual(state, { phase: "asking", query: "看看这个月花了多少钱" });

  const presentation = decideAskCuuPresentation({ intent: "answer", confidence: "high", answer_md: "ok" }, "zh-CN");
  state = askCuuReducer(state, { type: "resolved", presentation });
  assert.deepEqual(state, { phase: "presenting", presentation });

  state = askCuuReducer(state, { type: "dismiss" });
  assert.deepEqual(state, { phase: "idle" });
});

test("askCuuReducer transitions asking -> error -> dismiss -> idle", () => {
  let state = askCuuReducer(initialAskCuuState, { type: "ask", query: "abcd" });
  state = askCuuReducer(state, { type: "failed", message: "Cuu 没能理解这句话，请再试一次或换个说法。" });
  assert.deepEqual(state, { phase: "error", message: "Cuu 没能理解这句话，请再试一次或换个说法。" });
  state = askCuuReducer(state, { type: "dismiss" });
  assert.deepEqual(state, { phase: "idle" });
});

// ── markdown-lite 渲染：转义在前，换行在后，不引入任何 markdown 库 ─────────────────────────────

test("renderAskCuuAnswerHtml escapes HTML-significant characters and converts newlines to <br>", () => {
  const html = renderAskCuuAnswerHtml('第一行 <script>alert(1)</script>\n第二行 & "引号"');
  assert.doesNotMatch(html, /<script>/u);
  assert.match(html, /&lt;script&gt;/u);
  assert.match(html, /第一行 .*<br>第二行/u);
  assert.match(html, /&amp;/u);
  assert.match(html, /&quot;引号&quot;/u);
});
