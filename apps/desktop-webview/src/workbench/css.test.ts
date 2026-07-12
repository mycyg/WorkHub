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

test("the chat center view manages its own scroll/layout instead of inheriting the default padded scroll box", () => {
  assert.match(workbenchCss, /\.wh-wb-center\.wh-wb-center--chat\{padding:0;display:flex;flex-direction:column;overflow:hidden\}/u);
});

test("the # and / composer tags are visually distinct (not-yet-available) from the live @ tag", () => {
  assert.match(workbenchCss, /\.wh-wb-chat-ctag--soon\{[^}]*cursor:default/u);
  assert.doesNotMatch(workbenchCss, /\.wh-wb-chat-ctag\{[^}]*cursor:default/u);
});

test("reduced-motion users get the chat typing dots and composer tag transitions shortened too", () => {
  assert.match(workbenchCss, /prefers-reduced-motion:reduce\)\{[^}]*\.wh-wb-chat-typing-dots i\{transition-duration:\.01ms!important;animation-duration:\.01ms!important\}/u);
});
