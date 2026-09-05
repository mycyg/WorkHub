import assert from "node:assert/strict";
import test from "node:test";

import { handleSpotlightCapabilityEscape, renderSpotlightShellHtml, SPOTLIGHT_INTERNAL_BACK_SELECTOR } from "./controller.js";

// D-01（R23 精简批）：这三条用例原来住在 apps/desktop-webview/src/main.test.ts（main.ts 死 barrel 的
// 自证测试文件），但测的是 controller.ts 的真实行为——它没有自己的 controller.test.ts（只有专测拖拽
// 的 controller-drag.test.ts），main.ts 删除后随之搬到这里，断言原样保留。

// R9.7: the old M3 assertion grepped spotlight/controller.ts for selector text.
// That was wrong because source regexes can pass while Escape still skips the view's own back action.
test("M3 Spotlight ESC pops a view's internal detail before leaving the capability", () => {
  const selectors: string[] = [];
  const clicks: string[] = [];
  const topBack: string[] = [];
  const body = {
    querySelector(selector: string) {
      selectors.push(selector);
      return { click: () => { clicks.push("internal_back"); } };
    }
  };

  const result = handleSpotlightCapabilityEscape(body, () => { topBack.push("top_back"); });

  assert.equal(result, "internal_back");
  assert.equal(selectors[0], SPOTLIGHT_INTERNAL_BACK_SELECTOR);
  assert.match(SPOTLIGHT_INTERNAL_BACK_SELECTOR, /data-wi-back/u);
  assert.match(SPOTLIGHT_INTERNAL_BACK_SELECTOR, /data-back-to-projects/u);
  // UX-M15：军团 plan 详情的返回层也参与 Esc 逐级回退。
  assert.match(SPOTLIGHT_INTERNAL_BACK_SELECTOR, /data-back-to-agent-armies/u);
  assert.deepEqual(clicks, ["internal_back"]);
  assert.deepEqual(topBack, []);
});

test("M3 Spotlight ESC falls back to top-level back when the view has no internal detail", () => {
  const topBack: string[] = [];
  const body = {
    querySelector() {
      return null;
    }
  };

  const result = handleSpotlightCapabilityEscape(body, () => { topBack.push("top_back"); });

  assert.equal(result, "top_back");
  assert.deepEqual(topBack, ["top_back"]);
});

// R9.7: the old native-drag assertion grepped spotlight/controller.ts for local variable names.
// That was wrong because source text did not prove the shell HTML exposed the expected controls.
test("Spotlight shell renders native drag affordances without dead resize handles", () => {
  const html = renderSpotlightShellHtml("en-US");

  assert.match(html, /class="wh-spot ds-anim-spring-in"/u);
  assert.match(html, /data-spot-box data-mode="launcher"/u);
  assert.match(html, /wh-liquid-glass/u);
  assert.match(html, /class="wh-spot-drag-sheet" data-spot-drag-sheet/u);
  assert.match(html, /class="wh-spot-field" type="search" data-spot-input role="combobox"/u);
  assert.doesNotMatch(html, /data-tauri-drag-region/u);
  assert.doesNotMatch(html, /data-spot-resize/u);
  assert.doesNotMatch(html, /ds-glass-strong/u);
});
