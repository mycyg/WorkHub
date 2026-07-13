import assert from "node:assert/strict";
import { test } from "node:test";

import {
  renderCenterErrorHtml,
  renderCenterLoadingHtml,
  renderEmptyStateHtml,
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

// renderSidePanelPlaceholderHtml (the "coming soon" notice) retired in R13 batch P1 — the army panel
// now renders real three-zone content (army/render.ts, covered by army/render.test.ts) instead of a
// placeholder. shell.ts's own idle fallback (no conversation focused at all) is
// renderArmySidePanelIdleHtml, covered in army/render.test.ts alongside the rest of that module.
