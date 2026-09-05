import assert from "node:assert/strict";
import test from "node:test";

import { initialAskCuuState } from "./ask-cuu.js";
import {
  handleSpotlightCapabilityEscape,
  renderFirstRunCardHtml,
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

// R24 S6（E-11）：聚焦盒顶部的「AI 未配置」横幅挂钩——初始隐藏，mountSpotlight 据 health 探测结果决定
// 是否揭开（不在这里测那部分 DOM 接线，同本文件既有取舍：mountSpotlight 本身没有任何直接单测，见文件顶注）。
test("Spotlight shell reserves a hidden-by-default AI-provider banner slot", () => {
  const html = renderSpotlightShellHtml("zh-CN");
  assert.match(html, /data-spot-ai-banner hidden/u);
});

// R25-Q：连接状态"单一真相"细条——同上取舍，只测静态壳挂了这个槽位（初始隐藏），不在这里测
// mountSpotlight 据 workhub-connection-changed 揭开它的那部分 DOM 接线。
test("Spotlight shell reserves a hidden-by-default connection-status banner slot", () => {
  const html = renderSpotlightShellHtml("zh-CN");
  assert.match(html, /data-spot-connection-banner hidden/u);
});

// R24 S6（E-10）：首启引导卡——不落空网格，落「建你的第一个项目」+ 一个输入框。
test("renderFirstRunCardHtml renders a project-name input and create button in the idle state", () => {
  const html = renderFirstRunCardHtml("zh-CN", { kind: "idle" });
  assert.match(html, /建你的第一个项目/u);
  assert.match(html, /data-spot-first-run-name/u);
  assert.match(html, /data-spot-first-run-create/u);
  assert.doesNotMatch(html, /disabled/u);
  assert.match(html, /data-spot-first-run-error hidden/u);

  const en = renderFirstRunCardHtml("en-US", { kind: "idle" });
  assert.match(en, /Create your first project/u);
});

test("renderFirstRunCardHtml disables the input/button and shows a busy label while creating", () => {
  const html = renderFirstRunCardHtml("en-US", { kind: "creating" });
  assert.match(html, /data-spot-first-run-name[^>]+disabled/u);
  assert.match(html, /data-spot-first-run-create[^>]+disabled/u);
  assert.match(html, /Creating…/u);
});

test("renderFirstRunCardHtml surfaces a visible, non-disabled retry state on error", () => {
  const html = renderFirstRunCardHtml("zh-CN", { kind: "error", message: "创建失败，请重试。" });
  assert.match(html, /data-spot-first-run-error[^>]*role="alert">创建失败，请重试。/u);
  assert.doesNotMatch(html, /data-spot-first-run-error hidden/u);
  assert.doesNotMatch(html, /data-spot-first-run-create[^>]+disabled/u);
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
