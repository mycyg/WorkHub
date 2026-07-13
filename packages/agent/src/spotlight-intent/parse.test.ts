import assert from "node:assert/strict";
import test from "node:test";

import { parseSpotlightIntentResponse } from "./parse.js";

const ALLOWED = ["approvals", "cost", "workitem"];

test("parses a well-formed open_page response and accepts a page id present in the allow-list", () => {
  const result = parseSpotlightIntentResponse(
    '{"intent":"open_page","confidence":"high","page":"cost"}',
    ALLOWED
  );
  assert.deepEqual(result, { intent: "open_page", confidence: "high", page: "cost" });
});

test("rejects an open_page response whose page id is not in the caller-provided allow-list", () => {
  const result = parseSpotlightIntentResponse(
    '{"intent":"open_page","confidence":"high","page":"made_up_page"}',
    ALLOWED
  );
  assert.equal(result, undefined);
});

test("parses new_project, create_task and answer shapes", () => {
  assert.deepEqual(
    parseSpotlightIntentResponse(
      '{"intent":"new_project","confidence":"low","project_name":"稀土供应链分析"}',
      ALLOWED
    ),
    { intent: "new_project", confidence: "low", project_name: "稀土供应链分析" }
  );
  assert.deepEqual(
    parseSpotlightIntentResponse(
      '{"intent":"create_task","confidence":"high","task_title":"整理上周访谈纪要"}',
      ALLOWED
    ),
    { intent: "create_task", confidence: "high", task_title: "整理上周访谈纪要" }
  );
  assert.deepEqual(
    parseSpotlightIntentResponse(
      '{"intent":"answer","confidence":"high","answer_md":"这是一句简短的回答"}',
      ALLOWED
    ),
    { intent: "answer", confidence: "high", answer_md: "这是一句简短的回答" }
  );
});

test("tolerates a code-fenced response and surrounding prose noise", () => {
  const text = [
    "好的，这是我的判断：",
    "```json",
    '{"intent":"answer","confidence":"low","answer_md":"我不太确定，但大概是这样"}',
    "```",
    "以上。"
  ].join("\n");
  const result = parseSpotlightIntentResponse(text, ALLOWED);
  assert.deepEqual(result, { intent: "answer", confidence: "low", answer_md: "我不太确定，但大概是这样" });
});

test("fails closed (undefined) on unparsable text", () => {
  assert.equal(parseSpotlightIntentResponse("not json at all", ALLOWED), undefined);
  assert.equal(parseSpotlightIntentResponse("", ALLOWED), undefined);
  assert.equal(parseSpotlightIntentResponse("{unterminated", ALLOWED), undefined);
});

test("fails closed on a schema mismatch (missing required field, unknown intent, extra field)", () => {
  assert.equal(parseSpotlightIntentResponse('{"intent":"open_page","confidence":"high"}', ALLOWED), undefined);
  assert.equal(
    parseSpotlightIntentResponse('{"intent":"delete_everything","confidence":"high"}', ALLOWED),
    undefined
  );
  assert.equal(
    parseSpotlightIntentResponse(
      '{"intent":"answer","confidence":"high","answer_md":"hi","extra":"nope"}',
      ALLOWED
    ),
    undefined
  );
});

test("fails closed on an invalid confidence value", () => {
  assert.equal(
    parseSpotlightIntentResponse('{"intent":"answer","confidence":"medium","answer_md":"hi"}', ALLOWED),
    undefined
  );
});
