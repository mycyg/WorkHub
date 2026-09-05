import assert from "node:assert/strict";
import test from "node:test";

import { renderAiReadinessBannerHtml, renderIntakeAiReadinessNoteHtml } from "./ai-readiness-banner.js";

// R23 P2（SA-08）：纯渲染层单测——取数/水合逻辑（GET /api/health、注入进 [data-wh-ai-banner]）
// 在 browser.ts 里（顶层引用 document，这个 workspace 的测试运行器没有 DOM，见 onboarding-locale-sync.ts
// 同款先例），这里只覆盖字符串输出本身。

test("renderAiReadinessBannerHtml links to Settings and never claims sending is blocked", () => {
  const zhHtml = renderAiReadinessBannerHtml("zh-CN");
  assert.match(zhHtml, /href="\/settings"/u);
  assert.match(zhHtml, /去设置查看/u);
  assert.match(zhHtml, /密钥未配置/u);
  // README 口径：这条提示是「提示性的」——不能说成「无法使用」/「被拦下」这类会吓退用户继续用其它
  // 功能的措辞；断言不出现这种黑话/恐吓词。
  assert.doesNotMatch(zhHtml, /无法使用|被拦下|禁止/u);

  const enHtml = renderAiReadinessBannerHtml("en-US");
  assert.match(enHtml, /href="\/settings"/u);
  assert.match(enHtml, /View in Settings/u);
  assert.match(enHtml, /still work/u);
});

test("renderAiReadinessBannerHtml escapes locale-driven copy (defense in depth)", () => {
  const html = renderAiReadinessBannerHtml("zh-CN");
  assert.doesNotMatch(html, /<script/iu);
});

test("renderIntakeAiReadinessNoteHtml carries a stable marker so browser.ts can dedupe injection", () => {
  const zhHtml = renderIntakeAiReadinessNoteHtml("zh-CN");
  assert.match(zhHtml, /data-r23-intake-ai-note="true"/u);
  assert.match(zhHtml, /提交会收到明确的失败提示/u);

  const enHtml = renderIntakeAiReadinessNoteHtml("en-US");
  assert.match(enHtml, /data-r23-intake-ai-note="true"/u);
  assert.match(enHtml, /returns a clear failure message/u);
});
