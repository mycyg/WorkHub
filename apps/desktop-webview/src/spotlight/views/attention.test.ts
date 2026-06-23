import assert from "node:assert/strict";
import test from "node:test";

import { classifyAttentionActionHref } from "./attention.js";

test("classifyAttentionActionHref routes proposal/workitem detail hrefs to inline navigation (no dead button)", () => {
  // 对抗审查 HIGH:决策卡「查看变更」是 GET /proposals/:id,之前落到 runAction 末尾死 toast。现走 ctx.open。
  assert.deepEqual(classifyAttentionActionHref("/proposals/abc-123"), {
    kind: "navigate",
    view: "proposals",
    id: "abc-123"
  });
  assert.deepEqual(classifyAttentionActionHref("/workitems/wi-9"), {
    kind: "navigate",
    view: "workitem",
    id: "wi-9"
  });
});

test("classifyAttentionActionHref keeps POST action hrefs as submit (runAction handles them)", () => {
  assert.equal(classifyAttentionActionHref("/api/approvals/x/respond").kind, "submit");
  assert.equal(classifyAttentionActionHref("/api/proposals/abc/review").kind, "submit");
  assert.equal(classifyAttentionActionHref("/api/proposals/abc/merge").kind, "submit");
});

test("classifyAttentionActionHref only treats a clean single-segment detail path as navigation", () => {
  // 带 query、带额外路径段、空 id 的都不算干净详情导航 → 留给 submit/runAction。
  assert.equal(classifyAttentionActionHref("/proposals/abc/extra").kind, "submit");
  assert.equal(classifyAttentionActionHref("/proposals/abc?focus=diff").kind, "submit");
  assert.equal(classifyAttentionActionHref("/proposals/").kind, "submit");
  assert.equal(classifyAttentionActionHref("/something/else").kind, "submit");
});
