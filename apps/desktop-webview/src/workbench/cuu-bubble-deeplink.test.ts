import assert from "node:assert/strict";
import { test } from "node:test";

import { buildDispatchAskBubbleCopy, buildWorkbenchDeepLinkHref, parseWorkbenchDeepLinkHref } from "./cuu-bubble-deeplink.js";

test("buildWorkbenchDeepLinkHref mints a project-only href", () => {
  assert.equal(buildWorkbenchDeepLinkHref({ projectId: "project-1" }), "/workbench/project-1");
});

test("buildWorkbenchDeepLinkHref mints a project+conversation href and percent-encodes segments", () => {
  assert.equal(
    buildWorkbenchDeepLinkHref({ projectId: "project 1", conversationId: "conv/1" }),
    "/workbench/project%201/conv%2F1"
  );
});

test("parseWorkbenchDeepLinkHref round-trips what buildWorkbenchDeepLinkHref produces", () => {
  const target = { projectId: "10000000-0000-4000-8000-000000000001", conversationId: "20000000-0000-4000-8000-000000000002" };
  assert.deepEqual(parseWorkbenchDeepLinkHref(buildWorkbenchDeepLinkHref(target)), target);
  assert.deepEqual(parseWorkbenchDeepLinkHref(buildWorkbenchDeepLinkHref({ projectId: target.projectId })), {
    projectId: target.projectId
  });
});

test("parseWorkbenchDeepLinkHref accepts tauri://localhost and http(s) localhost forms", () => {
  const expected = { projectId: "project-1" };
  assert.deepEqual(parseWorkbenchDeepLinkHref("tauri://localhost/workbench/project-1"), expected);
  assert.deepEqual(parseWorkbenchDeepLinkHref("http://127.0.0.1/workbench/project-1"), expected);
  assert.deepEqual(parseWorkbenchDeepLinkHref("https://workhub.local/workbench/project-1"), expected);
});

test("parseWorkbenchDeepLinkHref rejects non-workbench routes, external hosts, and unsafe input", () => {
  assert.equal(parseWorkbenchDeepLinkHref(undefined), undefined);
  assert.equal(parseWorkbenchDeepLinkHref(null), undefined);
  assert.equal(parseWorkbenchDeepLinkHref(""), undefined);
  assert.equal(parseWorkbenchDeepLinkHref("#fragment-only"), undefined);
  assert.equal(parseWorkbenchDeepLinkHref("javascript:alert(1)"), undefined);
  assert.equal(parseWorkbenchDeepLinkHref("/approvals/approval-1/respond"), undefined);
  assert.equal(parseWorkbenchDeepLinkHref("https://evil.example/workbench/project-1"), undefined);
  assert.equal(parseWorkbenchDeepLinkHref("/workbench/"), undefined);
});

test("buildDispatchAskBubbleCopy writes an honest question (not a false 'already started' claim) in both locales", () => {
  const zh = buildDispatchAskBubbleCopy({ locale: "zh-CN", taskTitle: "把选题报告初稿重写第三节", projectLabel: "星尘短剧" });
  assert.match(zh.title, /派给我/u);
  assert.match(zh.message, /星尘短剧/u);
  assert.match(zh.message, /把选题报告初稿重写第三节/u);
  assert.match(zh.message, /？$/u); // 问句,不是既成事实的陈述句

  const en = buildDispatchAskBubbleCopy({ locale: "en-US", taskTitle: "rewrite section three", projectLabel: "Stardust" });
  assert.match(en.message, /Stardust/u);
  assert.match(en.message, /rewrite section three/u);
  assert.match(en.message, /\?$/u);
});

test("buildDispatchAskBubbleCopy degrades to a project-agnostic phrasing when no project label is available", () => {
  const zh = buildDispatchAskBubbleCopy({ locale: "zh-CN", taskTitle: "整理会议纪要" });
  assert.doesNotMatch(zh.message, /「.*」/u);
  assert.match(zh.message, /整理会议纪要/u);
});

test("buildDispatchAskBubbleCopy falls back to a generic task label when the title is blank", () => {
  const zh = buildDispatchAskBubbleCopy({ locale: "zh-CN", taskTitle: "   " });
  assert.match(zh.message, /一件新工作/u);
});
