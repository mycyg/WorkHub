import assert from "node:assert/strict";
import { test } from "node:test";

import { workbenchCss } from "./css.js";

test("the titlebar is a drag region, but its interactive controls opt out of dragging", () => {
  assert.match(workbenchCss, /\.wh-wb-titlebar\{[^}]*-webkit-app-region:drag/u);
  assert.match(workbenchCss, /\.wh-wb-titlebar-controls\{[^}]*-webkit-app-region:no-drag/u);
});

test("does not rely on CSS backdrop-filter alone for the window chrome (transparent Tauri windows ignore it)", () => {
  // The window shell itself must have an opaque-enough gradient background as the real fallback —
  // native vibrancy (window_controls.rs) is what actually produces the frosted look.
  assert.match(workbenchCss, /\.wh-wb-window\{[^}]*background:linear-gradient\(180deg,rgba\(30,34,46,\.92\)/u);
});

test("dark theme tokens are scoped under .wh-ds.wh-wb, not the shared light .wh-ds root", () => {
  assert.match(workbenchCss, /\.wh-ds\.wh-wb\{--ds-ink:#e8eaf0/u);
  assert.doesNotMatch(workbenchCss, /^\.wh-ds\{--ds-ink:#e8eaf0/mu);
});

test("the side panel collapses to zero width instead of just hiding overflow", () => {
  assert.match(workbenchCss, /\.wh-wb-side\[data-open="false"\]\{width:0/u);
});

test("no rule styles an emoji-bearing selector or content string", () => {
  assert.doesNotMatch(workbenchCss, /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
});
