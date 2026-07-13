import assert from "node:assert/strict";
import test from "node:test";

import { buildSpotlightIntentSystemPrompt, buildSpotlightIntentUserPrompt } from "./prompt.js";

test("system prompt names all four intents and the data-isolation fence for the capability list", () => {
  const prompt = buildSpotlightIntentSystemPrompt();
  assert.match(prompt, /open_page/u);
  assert.match(prompt, /new_project/u);
  assert.match(prompt, /create_task/u);
  assert.match(prompt, /answer/u);
  assert.match(prompt, /数据隔离/u);
  assert.match(prompt, /high\/low/u);
});

test("user prompt lists the provided capabilities and echoes the query verbatim", () => {
  const prompt = buildSpotlightIntentUserPrompt({
    query: "看看这个月花了多少钱",
    capabilities: [
      { id: "cost", label: "成本", hint: "AI 花费、预算与分账" },
      { id: "approvals", label: "审批队列" }
    ]
  });
  assert.match(prompt, /- cost: 成本 — AI 花费、预算与分账/u);
  assert.match(prompt, /- approvals: 审批队列/u);
  assert.match(prompt, /看看这个月花了多少钱/u);
});

test("user prompt handles an empty capability list without crashing", () => {
  const prompt = buildSpotlightIntentUserPrompt({ query: "随便问问", capabilities: [] });
  assert.match(prompt, /（无）/u);
});

test("user prompt truncates an overlong query instead of blowing up the prompt", () => {
  const longQuery = "很长".repeat(400);
  const prompt = buildSpotlightIntentUserPrompt({ query: longQuery, capabilities: [] });
  assert.match(prompt, /已省略后/u);
});
