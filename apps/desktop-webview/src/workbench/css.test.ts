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
  assert.match(workbenchCss, /\.wh-wb-window\{[^}]*background:linear-gradient\(180deg,rgba\(250,251,253,\.88\)/u);
});

// R13 batch V2: a rectangular CSS box-shadow painted past the native vibrancy's rounded corners,
// leaving a stray corner artifact in real-device screenshots (00-plan.md V2 root-cause diagnosis).
// The window's depth now comes from the native NSWindow shadow (Rust side calls .shadow(true)); the
// CSS radius here only clips content, it must never draw a shadow of its own again.
test("the window shell has no CSS box-shadow of its own — depth comes from the native window shadow", () => {
  assert.doesNotMatch(workbenchCss, /\.wh-wb-window\{[^}]*box-shadow/u);
});

// R13 batch V2: on macOS the workbench window switches to native traffic lights (titleBarStyle
// Overlay); the custom titlebar must yield left-side space so the breadcrumb text doesn't sit under
// the native close/minimize/zoom buttons.
test("the native-chrome titlebar variant reserves left space for the macOS traffic lights", () => {
  assert.match(workbenchCss, /\.wh-wb-titlebar--native\{padding-left:78px\}/u);
});

// R13 batch V1: the workbench flipped from a bespoke dark palette to a fixed light glass theme that
// shares design-system.ts's tokens (same visual language as the Spotlight box) — it must not redefine
// --ds-ink/--ds-glass/etc. under .wh-ds.wh-wb anymore, only the Cuu brand orange stays scoped there.
test("only the Cuu brand color is scoped under .wh-ds.wh-wb — ds-* tokens cascade from the shared light .wh-ds root", () => {
  assert.match(workbenchCss, /\.wh-ds\.wh-wb\{--wb-cuu:#ffab5e/u);
  assert.doesNotMatch(workbenchCss, /\.wh-ds\.wh-wb\{[^}]*--ds-ink:/u);
  assert.doesNotMatch(workbenchCss, /--ds-ink:#e8eaf0/u);
  assert.doesNotMatch(workbenchCss, /--wb-bg0|--wb-bg1/u);
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

// R23 F-07：# 会话引用 / / 技能唤起真的接线之后，三个 composer 入口（@ / # / /）是同一档真控件，
// 不再有「看得见但点不动」的灰态样式——那套 --soon 规则连同占位 picker 一起删了。
test("the composer tags are all live controls — no not-yet-available grey variant remains", () => {
  assert.doesNotMatch(workbenchCss, /wh-wb-chat-ctag--soon/u);
  assert.doesNotMatch(workbenchCss, /wh-wb-chat-picker--soon/u);
  assert.doesNotMatch(workbenchCss, /\.wh-wb-chat-ctag\{[^}]*cursor:default/u);
  assert.match(workbenchCss, /\.wh-wb-chat-ctag\{[^}]*cursor:pointer/u);
});

test("reduced-motion users get the chat typing dots and composer tag transitions shortened too", () => {
  assert.match(workbenchCss, /prefers-reduced-motion:reduce\)\{[^}]*\.wh-wb-chat-typing-dots i\{transition-duration:\.01ms!important;animation-duration:\.01ms!important\}/u);
});

// R14FIX 批 workbench（建群弹窗排版修复 · 2026-07-15 用户实拍）：建群模态的成员多选行 <label> 曾在
// css.ts 完全无样式，默认 inline 让 checkbox/头像/名字换行错乱。这条锁死每行是一条对齐的 flex 行。
test("the new-collab member row is a single aligned flex row (not an unstyled inline label)", () => {
  assert.match(workbenchCss, /\.wh-wb-new-collab-member-row\{[^}]*display:flex[^}]*align-items:center/u);
  // Cuu 参与开关同样是 flex 行（此前也无样式）。
  assert.match(workbenchCss, /\.wh-wb-new-collab-cuu-toggle\{[^}]*display:flex[^}]*align-items:center/u);
});

// R14FIX 批 workbench：每条协同会话叶子的悬停重命名铅笔——默认隐藏，行悬停/键盘聚焦才现身。
test("the collab-leaf rename pencil is hover/focus-revealed, not always visible", () => {
  assert.match(workbenchCss, /\.wh-wb-collab-rename\{[^}]*opacity:0/u);
  assert.match(workbenchCss, /\.wh-wb-collab-leaf:hover \.wh-wb-collab-rename,\.wh-wb-collab-rename:focus-visible\{opacity:1\}/u);
});

// —— R12（模式五档弹层，仅协同会话 composer）—— //

test("the mode popover has an opaque-enough gradient fallback background, not transparent-only", () => {
  assert.match(workbenchCss, /\.wh-wb-mode-pop\{[^}]*background:linear-gradient\(180deg,rgba\(255,255,255,\.97\)/u);
});

test("the mode chip and the fifth (fully-managed) level reuse the shared warn design tokens, not a hardcoded color", () => {
  assert.match(workbenchCss, /\.wh-wb-mode-chip--warn\{color:var\(--ds-warn\)/u);
  assert.match(workbenchCss, /\.wh-wb-mode-lvl--warn\.wh-wb-mode-lvl--on\{background:var\(--ds-warn-soft\)/u);
});

test("the granular-breakdown note is not styled as clickable (it isn't wired to anything real yet)", () => {
  assert.doesNotMatch(workbenchCss, /\.wh-wb-mode-gran\{[^}]*cursor:pointer/u);
});

test("a failed mode PATCH uses the shared danger token for its inline hint, not a literal red", () => {
  assert.match(workbenchCss, /\.wh-wb-mode-hint--error\{color:var\(--ds-danger\)\}/u);
});

test("reduced-motion users get the mode chip and level-row transitions shortened too", () => {
  assert.match(
    workbenchCss,
    /prefers-reduced-motion:reduce\)\{\.wh-wb-mode-chip,\.wh-wb-mode-lvl\{transition-duration:\.01ms!important;animation-duration:\.01ms!important\}\}/u
  );
});

// —— R24-D（工作台聊天头部视觉打磨：tab 条 / 成员条 / 空态） —— //

test("an open-conversation tab shows exactly one active affordance: the 2px accent underline, no filled pill or outline", () => {
  // 改版前是「玻璃底色 + inset 下划线 + 两个没复位的默认按钮外观」三件套同时上身，读起来像三个组件
  // 拼在一起（用户截图实锤）。激活态只保留下划线这一件。
  assert.match(workbenchCss, /\.wh-wb-sess-tab\.is-active::after\{[^}]*height:2px[^}]*background:var\(--ds-accent\)\}/u);
  assert.doesNotMatch(workbenchCss, /\.wh-wb-sess-tab\.is-active\{[^}]*background/u);
  assert.doesNotMatch(workbenchCss, /\.wh-wb-sess-tab\.is-active\{[^}]*box-shadow/u);
});

test("both tab buttons reset the browser's default button chrome — the tab container is the only layer with a background", () => {
  assert.match(workbenchCss, /\.wh-wb-sess-open\{[^}]*border:0;background:transparent/u);
  assert.match(workbenchCss, /\.wh-wb-sess-close\{[^}]*border:0;background:transparent/u);
});

test("the tab close button lives inside the tab and only appears on hover / active / keyboard focus", () => {
  assert.match(workbenchCss, /\.wh-wb-sess-close\{[^}]*opacity:0;pointer-events:none/u);
  assert.match(
    workbenchCss,
    /\.wh-wb-sess-tab:hover \.wh-wb-sess-close,\.wh-wb-sess-tab\.is-active \.wh-wb-sess-close,\.wh-wb-sess-close:focus-visible\{opacity:1;pointer-events:auto\}/u
  );
  // 键盘可达：两个按钮都要有可见的聚焦环。
  assert.match(workbenchCss, /\.wh-wb-sess-open:focus-visible,\.wh-wb-sess-close:focus-visible\{outline:2px solid var\(--ds-accent\)/u);
});

test("the tab strip's own left inset lines the first tab's icon up with the member row and the chat body (20px)", () => {
  // 条 12px + tab 8px = 20px，与 .wh-wb-chat-head / .wh-wb-chat-scroll 的 20px 左内边距对齐成一条竖线。
  assert.match(workbenchCss, /\.wh-wb-sess-strip\{[^}]*padding:6px 12px 0/u);
  assert.match(workbenchCss, /\.wh-wb-sess-open\{[^}]*padding:0 2px 0 8px/u);
  assert.match(workbenchCss, /\.wh-wb-chat-head\{[^}]*padding:10px 20px/u);
});

test("the chat head hairline spans the whole chat column, and disappears entirely when the head is empty", () => {
  // 线画在外壳上（.wh-wb-chat-head 只有内容那么宽，线会在成员条中途断掉）；退群后 head 为空则不留孤线。
  assert.match(workbenchCss, /\[data-wb-chat-head\]:not\(:empty\)\{border-bottom:1px solid var\(--ds-glass-border\)\}/u);
  assert.doesNotMatch(workbenchCss, /\.wh-wb-chat-head\{[^}]*border-bottom/u);
});

test("the chat empty state is a compact group centred in the chat area, not measured against the whole window", () => {
  assert.doesNotMatch(workbenchCss, /\.wh-wb-chat-empty\{[^}]*vh/u);
  assert.match(workbenchCss, /\.wh-wb-chat-empty\{[^}]*min-height:100%[^}]*justify-content:center/u);
  assert.match(workbenchCss, /\.wh-wb-chat-empty-title\{[^}]*font:700 20px/u);
  assert.match(workbenchCss, /\.wh-wb-chat-empty-body\{[^}]*max-width:56ch[^}]*font:500 14px/u);
});
