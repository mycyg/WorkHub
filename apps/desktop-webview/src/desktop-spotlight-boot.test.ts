import assert from "node:assert/strict";
import test from "node:test";

import { renderDesktopSpotlightBootShell } from "./desktop-spotlight-boot.js";

// D-01（R23 精简批）：这条用例原来住在 apps/desktop-webview/src/main.test.ts（main.ts 死 barrel 的自证
// 测试文件），但测的是 desktop-spotlight-boot.ts 的真实行为——该模块没有自己的测试文件，main.ts 删除后
// 随之搬到这里，断言原样保留。

// R9.7: the old boot assertion grepped browser.ts for omitted legacy calls.
// That was wrong because source regexes can pass while boot still renders a stale opaque shell.
test("Spotlight boot starts transparent without a legacy boot card or capture background", () => {
  const html = renderDesktopSpotlightBootShell();

  assert.match(html, /data-spot-host/u);
  assert.match(html, /M\+PLUS\+Rounded\+1c/u);
  assert.match(html, /\.wh-spot/u);
  assert.doesNotMatch(html, /wh-app-root/u);
  assert.doesNotMatch(html, /#0f1117/u);
});
