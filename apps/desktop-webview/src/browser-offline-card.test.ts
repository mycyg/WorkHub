import assert from "node:assert/strict";
import test from "node:test";

import { renderDesktopOfflineCardHtml } from "./desktop-offline-card.js";

test("desktop offline card stays transparent glass and avoids developer-console instructions", () => {
  const html = renderDesktopOfflineCardHtml({
    apiBase: "http://127.0.0.1:8787",
    detail: "Failed to fetch",
    locale: "zh-CN"
  });

  assert.match(html, /background:rgba\(0,0,0,0\)!important/u);
  assert.match(html, /background:transparent/u);
  assert.doesNotMatch(html, /background:rgba\(255,255,255,\.(?:[1-9]\d?|9[0-9])\)/u);
  assert.doesNotMatch(html, /开发者控制台|console/u);
  assert.match(html, /打开设置/u);
  assert.match(html, /id="wh-offline-settings" class="wh-desktop-offline-settings" hidden/u);
  assert.match(html, /id="wh-api-base"[^>]+value="http:\/\/127\.0\.0\.1:8787"/u);
  assert.match(html, /保存并重试/u);
  assert.match(html, /使用默认/u);
  assert.match(html, /重试/u);
});
