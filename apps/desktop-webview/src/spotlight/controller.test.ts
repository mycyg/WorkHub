import assert from "node:assert/strict";
import test from "node:test";

import { initialAskCuuState } from "./ask-cuu.js";
import {
  handleSpotlightCapabilityEscape,
  renderLauncherGrid,
  renderSpotlightShellHtml,
  SPOTLIGHT_INTERNAL_BACK_SELECTOR
} from "./controller.js";

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

// M-01（R24 S3 走查）：徽章此前写死"⌘K"，但真正注册的全局唤起热键是 Option+Space
// （client-tauri/src-tauri/src/main.rs install_workhub_global_hotkey）——隐藏主窗后按 ⌘K 毫无反应。
test("Spotlight shell badges the real global hotkey (Option+Space), not the stale Cmd+K claim", () => {
  const en = renderSpotlightShellHtml("en-US");
  const zh = renderSpotlightShellHtml("zh-CN");

  assert.match(en, /class="wh-spot-kbd"[^>]*>⌥Space<\/kbd>/u);
  assert.match(zh, /class="wh-spot-kbd"[^>]*>⌥Space<\/kbd>/u);
  assert.doesNotMatch(en, />⌘K</u);
  assert.doesNotMatch(zh, />⌘K</u);
});

// M-05（R24 S3 走查）："没有匹配的能力"/"No matching capability" 是黑话且自相矛盾——判词说没有匹配，
// 紧接着又给两个可执行入口（问问 Cuu / 交给 Cuu 当新任务）。改成人话，同一个空态里不再自相矛盾。
test("Launcher's empty-results copy talks like a person and stops contradicting the fallback actions it offers", () => {
  const en = renderLauncherGrid([], "en-US", {}, false, initialAskCuuState, "totally unmatched query");
  const zh = renderLauncherGrid([], "zh-CN", {}, false, initialAskCuuState, "完全不匹配的查询");

  assert.doesNotMatch(en, /No matching capability/u);
  assert.doesNotMatch(zh, /没有匹配的能力/u);
  assert.match(en, /Nothing matched/u);
  assert.match(zh, /没找到对应的功能/u);
  // The two existing fallback exits must still be there — only the contradictory headline changed.
  assert.match(en, /Hand this to Cuu as a new task/u);
  assert.match(zh, /把这句话当新任务交给 Cuu/u);
});
