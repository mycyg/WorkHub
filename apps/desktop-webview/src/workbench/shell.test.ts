import assert from "node:assert/strict";
import { test } from "node:test";

import {
  renderCenterErrorHtml,
  renderCenterLoadingHtml,
  renderEmptyStateHtml,
  renderWorkbenchLoggedOutHtml,
  renderWorkbenchShellHtml
} from "./shell.js";

test("renderWorkbenchShellHtml wires drag region, window controls, and all three column mount points", () => {
  const html = renderWorkbenchShellHtml("zh-CN");
  assert.match(html, /data-wb-titlebar/u);
  assert.match(html, /data-wb-minimize/u);
  assert.match(html, /data-wb-close/u);
  assert.match(html, /data-wb-rail/u);
  assert.match(html, /data-wb-center/u);
  assert.match(html, /data-wb-side/u);
  assert.match(html, /data-wb-toggle-side/u);
  assert.match(html, /data-open="true"/u);
});

// R13 批 V2:macOS 原生红绿灯接管标题栏控制——自绘的 min/close 按钮此时整个不渲染（不是 CSS 藏起来）。
test("renderWorkbenchShellHtml omits the self-drawn minimize/close buttons when nativeWindowChrome is set (macOS native traffic lights take over)", () => {
  const html = renderWorkbenchShellHtml("zh-CN", { nativeWindowChrome: true });
  assert.doesNotMatch(html, /data-wb-minimize/u);
  assert.doesNotMatch(html, /data-wb-close/u);
  assert.match(html, /wh-wb-titlebar--native/u);
  // The rest of the shell (rail/center/side mount points, drag region) is unaffected.
  assert.match(html, /data-wb-titlebar/u);
  assert.match(html, /data-wb-rail/u);
  assert.match(html, /data-wb-center/u);
  assert.match(html, /data-wb-side/u);
});

test("renderWorkbenchShellHtml defaults to the self-drawn window controls when nativeWindowChrome is omitted", () => {
  const html = renderWorkbenchShellHtml("en-US", {});
  assert.match(html, /data-wb-minimize/u);
  assert.match(html, /data-wb-close/u);
  assert.doesNotMatch(html, /wh-wb-titlebar--native/u);
});

// G-desktop 止血批 5：顶栏「打开聚焦盒」入口不是窗口帧控件（不像 min/close 那样在原生红绿灯接管时该
// 消失）——两种 chrome 下都必须渲染。
test("renderWorkbenchShellHtml always renders the 'open Spotlight' entry, both with and without native window chrome", () => {
  const selfDrawn = renderWorkbenchShellHtml("zh-CN", { nativeWindowChrome: false });
  assert.match(selfDrawn, /data-wb-open-spotlight/u);
  assert.match(selfDrawn, /打开聚焦盒/u);

  const native = renderWorkbenchShellHtml("en-US", { nativeWindowChrome: true });
  assert.match(native, /data-wb-open-spotlight/u);
  assert.match(native, /Open Spotlight/u);
});

test("renderEmptyStateHtml offers a real 'new project' CTA only when there are no projects yet", () => {
  const noProjects = renderEmptyStateHtml("zh-CN", false);
  assert.match(noProjects, /data-wb-new-project/u);
  assert.match(noProjects, /先建一个项目/u);

  const hasProjects = renderEmptyStateHtml("zh-CN", true);
  assert.doesNotMatch(hasProjects, /data-wb-new-project/u);
  assert.match(hasProjects, /选一个项目开始/u);
});

test("renderEmptyStateHtml uses plain, non-jargon guidance copy", () => {
  const html = renderEmptyStateHtml("zh-CN", false);
  assert.doesNotMatch(html, /branch|merge|commit|repository/iu);
});

test("renderCenterLoadingHtml and renderCenterErrorHtml render distinct, honest states", () => {
  assert.match(renderCenterLoadingHtml("zh-CN"), /正在打开工作台/u);
  const errored = renderCenterErrorHtml("zh-CN");
  assert.match(errored, /没打开这个项目的工作台/u);
  assert.match(errored, /data-wb-retry-vm/u);
});

// G-desktop 止血批 3（跨窗口登出广播）：整窗「已登出」态——不是三栏壳的一个子区块错误，诚实地说明
// 现状，不摆一个会转发到别处的假可点控件（工作台不拥有重新登录 UI，那是主窗的地盘）。
test("renderWorkbenchLoggedOutHtml renders an honest, actionless signed-out screen in both locales", () => {
  const zh = renderWorkbenchLoggedOutHtml("zh-CN");
  assert.match(zh, /data-wb-loggedout/u);
  assert.match(zh, /已登出/u);
  assert.match(zh, /重新登录/u);
  assert.doesNotMatch(zh, /<button/u);

  const en = renderWorkbenchLoggedOutHtml("en-US");
  assert.match(en, /Signed out/u);
  assert.match(en, /sign back in/iu);
  assert.doesNotMatch(en, /<button/u);
});

// R24 S4：昵称模式的首启（这台设备从没连接过）复用同一张整窗替换态——只换标题/说明，
// 不写「已登出」（这台设备从来没登过，说"已登出"是撒谎）；默认值/显式 "logged-out" 都不变。
test("renderWorkbenchLoggedOutHtml defaults to the signed-out copy and swaps to first-run welcome copy on request", () => {
  const loggedOut = renderWorkbenchLoggedOutHtml("en-US");
  assert.match(loggedOut, /Signed out/u);

  const loggedOutExplicit = renderWorkbenchLoggedOutHtml("en-US", "logged-out");
  assert.match(loggedOutExplicit, /Signed out/u);

  const firstRun = renderWorkbenchLoggedOutHtml("en-US", "first-run");
  assert.match(firstRun, /data-wb-loggedout/u);
  assert.match(firstRun, /Welcome to WorkHub/u);
  assert.doesNotMatch(firstRun, /Signed out/u);
  assert.doesNotMatch(firstRun, /<button/u);

  const firstRunZh = renderWorkbenchLoggedOutHtml("zh-CN", "first-run");
  assert.match(firstRunZh, /欢迎使用 WorkHub/u);
  assert.doesNotMatch(firstRunZh, /已登出/u);
});

// renderSidePanelPlaceholderHtml (the "coming soon" notice) retired in R13 batch P1 — the army panel
// now renders real three-zone content (army/render.ts, covered by army/render.test.ts) instead of a
// placeholder. shell.ts's own idle fallback (no conversation focused at all) is
// renderArmySidePanelIdleHtml, covered in army/render.test.ts alongside the rest of that module.
