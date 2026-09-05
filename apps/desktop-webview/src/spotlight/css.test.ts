import assert from "node:assert/strict";
import { test } from "node:test";

import { spotlightCss } from "./css.js";

const css = Array.isArray(spotlightCss) ? (spotlightCss as string[]).join("") : String(spotlightCss);

test("SM-1: the collapsed-hide rule is scoped to launcher mode (never hides capability content)", () => {
  // The collapsed (idle thin search bar) hide must only apply in launcher mode — a capability
  // opened from an external entry (tray/notification/Cuu card/deep-link) can still carry a stale
  // data-collapsed="true", and an unscoped rule would hide its whole body.
  assert.match(css, /\.wh-spot\[data-mode="launcher"\]\[data-collapsed="true"\] \.wh-spot-body\{display:none\}/u);
  // There must be NO unscoped collapsed-hide that would also catch capability mode.
  assert.doesNotMatch(css, /\.wh-spot\[data-collapsed="true"\] \.wh-spot-body\{display:none\}/u);
});

test("L5: launcher default-highlight (accent ring + active bg) only shows under keyboard nav", () => {
  // The accent ring and the active background must be gated behind box[data-kbd="true"]
  // so a mouse-only open never shows a stuck selection ring on the first card.
  assert.match(css, /\.wh-spot\[data-kbd="true"\] \.wh-spot-cap\[data-active="true"\]\{[^}]*box-shadow:inset 0 0 0 2px var\(--ds-accent\)/u);
  // There must be NO ungated accent ring (the old form put box-shadow directly after the
  // brace: `[data-active="true"]{box-shadow:...}`; the gated rule opens with background:...).
  assert.doesNotMatch(css, /\[data-active="true"\]\{box-shadow:inset 0 0 0 2px var\(--ds-accent\)/u);
});

test("Spotlight focus ring is scoped to interactive controls, not the whole content body", () => {
  assert.match(css, /\.wh-spot :where\(button,a,input,textarea,select,\[role="option"\]\):focus-visible\{outline:2px solid var\(--ds-accent\)/u);
  assert.match(css, /html:focus,body:focus,#root:focus,\.wh-spot-stage:focus,\.wh-spot:focus,\.wh-spot-body:focus\{outline:none!important\}/u);
  assert.match(css, /\.wh-spot,.wh-spot-body,\[data-spot-box\],\[data-spot-body\]\{outline:none!important\}/u);
  assert.match(css, /\.wh-spot \*:focus\{outline:none\}/u);
  assert.match(css, /\.wh-spot \*:focus:not\(:focus-visible\)\{outline:none\}/u);
  assert.doesNotMatch(css, /\[tabindex\]\):focus-visible/u);
  assert.doesNotMatch(css, /\.wh-spot :focus-visible\{/u);
});

test("BX-06: the box is clamped to the window so the growth tween never shows a square-cut bottom", () => {
  // 壳层把窗口高度摊成 ~16ms 的中间帧（client-tauri spotlight_window.rs），DOM 里的盒子却在第一帧
  // 就已经是目标高度。不钳到 100vh 的话，补间途中盒子比透明窗高——圆角底边和边框落在窗口外面，
  // 屏幕上就是一条直角断口在往下爬。
  assert.match(css, /\.wh-spot\{[^}]*max-height:100vh/u);
  // 内容淡入挂在每次重渲都换新节点的网格上（body 是常驻节点，CSS 动画只会在挂载时跑一次）。
  assert.match(css, /\.wh-spot-grid\{[^}]*animation:ds-fade-in var\(--ds-dur-fast\)/u);
});

test("Spotlight visual language uses Apple blue/cyan accents instead of purple gradients", () => {
  assert.match(css, /\.wh-spot-act--primary\{[^}]*linear-gradient\(135deg,#0a84ff,#64d2ff\)/u);
  assert.match(css, /\.wh-spot-card-bar--approval\{background:linear-gradient\(180deg,#0a84ff,#64d2ff\)/u);
  assert.doesNotMatch(css, /#7c83ff|#b57bff/u);
});

test("Spotlight shell keeps a translucent liquid-glass surface", () => {
  assert.match(css, /html,body,#root\{margin:0;background:rgba\(0,0,0,0\)!important\}/u);
  // R14 把白底从 .52/.36 提到 .78/.6（当时反馈“太透”）。R24 用户反馈反转：深色窗口放到盒子后面
  // 完全看不见，盒子读作一块实灰。白底降回 .78/.6 以下，通透感交回给原生材质（main.rs GlassMaterial）。
  // 底色抽成 token，运行期可被 desktop-glass-alpha.ts 覆写（一次构建跑完多个候选值）。
  assert.match(css, /:root\{--wh-spot-glass-top:rgba\(255,255,255,\.5\);--wh-spot-glass-bottom:rgba\(255,255,255,\.39\)\}/u);
  assert.match(css, /\.wh-spot\{[^}]*-webkit-app-region:no-drag;[^}]*background:linear-gradient\(135deg,var\(--wh-spot-glass-top\),var\(--wh-spot-glass-bottom\)\)/u);
  assert.doesNotMatch(css, /\.wh-spot::before\{/u);
  assert.doesNotMatch(css, /background:rgba\(255,255,255,\.0[0-9]+\)/u);
  assert.match(css, /\.wh-spot\{[^}]*backdrop-filter:blur\(40px\) saturate\(185%\)/u);
  assert.match(css, /\.wh-spot\{[^}]*-webkit-backdrop-filter:blur\(40px\) saturate\(185%\)/u);
  assert.match(css, /\.wh-liquid-glass-warp\{[^}]*--wh-liquid-frost:\.6px/u);
  assert.match(css, /\.wh-liquid-glass-refract\{[^}]*filter:none;-webkit-filter:none/u);
  assert.doesNotMatch(css, /\.wh-liquid-glass-warp--spotlight \.wh-liquid-glass-refract\{[^}]*backdrop-filter/u);
  assert.doesNotMatch(css, /\.wh-liquid-glass-warp--spotlight \.wh-liquid-glass-refract\{[^}]*-webkit-backdrop-filter/u);
  // 3-4: the old assertion pinned a hidden SVG edge filter; Spotlight hides the warp/rim, so
  // generating and referencing that filter only burned CPU without contributing pixels.
  assert.doesNotMatch(css, /url\(#workhub-liquid-glass-spotlight-filter/u);
  assert.doesNotMatch(css, /(?:^|[;{])filter:url\(#workhub-liquid-glass/u);
  assert.doesNotMatch(css, /--wh-liquid-frost:(?:1[0-9]|[2-9][0-9])px/u);
  assert.match(css, /\.wh-liquid-glass-warp\{[^}]*background:transparent[^}]*overflow:hidden/u);
  assert.doesNotMatch(css, /\.wh-liquid-glass-warp\{[^}]*backdrop-filter/u);
  assert.doesNotMatch(css, /\.wh-liquid-glass-warp\{[^}]*-webkit-backdrop-filter/u);
  assert.doesNotMatch(css, /--wh-liquid-opacity|opacity:var\(--wh-liquid-opacity/u);
  assert.match(css, /\.wh-liquid-glass-edge--top\{left:0;right:0;top:0;height:var\(--wh-liquid-edge,12px\)/u);
  assert.match(css, /\.wh-liquid-glass-edge--bottom\{left:0;right:0;bottom:0;height:var\(--wh-liquid-edge,12px\)/u);
  assert.doesNotMatch(css, /-webkit-mask-composite:xor|mask-composite:exclude/u);
  // 盒子和 Cuu 气泡同一套玻璃语言：亮玻璃描边 + 顶部内高光。
  assert.match(css, /\.wh-spot\{[^}]*border:1px solid rgba\(255,255,255,\.7\)/u);
  // R14: a rectangular outer box-shadow painted past the native vibrancy's rounded-corner clip,
  // leaving a flat-edge artifact at the bottom of the box on real hardware (same root cause the
  // R13 V2 workbench-window fix diagnosed, see r13-v2-window-craft.md). Depth now comes from the
  // native NSWindow shadow (tauri.conf.json main window `"shadow": true`); only the inset top
  // highlight stays in CSS, since inset shadows are always clipped inside the border-radius.
  assert.match(css, /\.wh-spot\{[^}]*box-shadow:inset 0 1px 0 rgba\(255,255,255,\.75\)/u);
  assert.doesNotMatch(css, /\.wh-spot\{[^}]*box-shadow:0 24px 64px -26px rgba\(31,35,53,\.42\)/u);
  assert.doesNotMatch(css, /wh-liquid-glass-tint|--wh-liquid-tint|mix-blend-mode:screen/u);
  assert.match(css, /\.wh-spot>\.wh-liquid-glass-content\{display:flex;flex-direction:column/u);
  assert.match(css, /\.wh-spot-top\{[^}]*-webkit-app-region:no-drag;cursor:grab/u);
  assert.match(css, /\.wh-spot-top:active\{cursor:grabbing\}/u);
  // 3-1: the old assertion included `.wh-spot-resize`, but that pinned a fake manual-resize affordance
  // whose dragged size could be overwritten by render-driven auto-resize.
  assert.match(css, /\.wh-spot-back,\.wh-spot button,\.wh-spot a,\.wh-spot select,\.wh-spot textarea,\.wh-spot \[contenteditable=true\]\{-webkit-app-region:no-drag\}/u);
  assert.doesNotMatch(css, /\.wh-spot-top>\*\{-webkit-app-region:no-drag\}/u);
  assert.doesNotMatch(css, /\.wh-spot-field\{[^}]*-webkit-app-region/u);
  assert.match(css, /\.wh-spot-drag-sheet\{position:absolute;inset:0;display:none;z-index:3;border:0;background:transparent;cursor:grab/u);
  assert.match(css, /\.wh-spot\[data-mode="launcher"\]\[data-collapsed="true"\] \.wh-spot-drag-sheet\{display:block\}/u);
  assert.match(css, /\.wh-spot-drag-sheet:active\{cursor:grabbing\}/u);
  assert.match(css, /input\.wh-spot-field:focus\{outline:0!important;box-shadow:none!important\}/u);
  assert.doesNotMatch(css, /\.wh-spot-back\{[^}]*background:var\(--ds-glass\)/u);
  assert.doesNotMatch(
    css,
    /\.(?:wh-spot-cap|wh-spot-opt|wh-spot-row|wh-spot-metric|wh-spot-change|wh-spot-bars|wh-spot-check|wh-spot-reason-text)\{[^}]*backdrop-filter/u
  );
  assert.doesNotMatch(
    css,
    /\.(?:wh-spot-cap|wh-spot-opt|wh-spot-row|wh-spot-metric|wh-spot-change|wh-spot-bars|wh-spot-check|wh-spot-reason-text)\{[^}]*-webkit-backdrop-filter/u
  );
  assert.doesNotMatch(css, /\.wh-spot \.wh-conflict-head,[^{]+\{[^}]*backdrop-filter/u);
});

test("Spotlight shell does not expose manual resize hit zones without durable resize state", () => {
  assert.doesNotMatch(css, /\.wh-spot-resize/u);
  assert.doesNotMatch(css, /cursor:(?:ew|ns|nwse)-resize/u);
});

test("Spotlight launcher cards stay glassy instead of white tiles", () => {
  assert.match(css, /\.wh-spot\[data-mode="launcher"\] \.wh-spot-cap\{[^}]*background:transparent/u);
  assert.match(css, /\.wh-spot\[data-mode="launcher"\] \.wh-spot-cap:hover\{[^}]*background:transparent/u);
  assert.doesNotMatch(css, /background:rgba\(255,255,255,\.7[0-9]?\)|rgba\(255,255,255,\.76\)/u);
});

test("Spotlight proposal action notes and skipped checks are visibly distinct", () => {
  assert.match(css, /\.wh-spot-action-note\{[^}]*flex:1 0 100%;[^}]*font:600 12px\/1\.4 var\(--ds-font\)/u);
  assert.match(css, /\.wh-spot-check--skipped\{background:transparent;border-color:rgba\(142,142,147,\.18\);color:var\(--ds-ink-muted\)\}/u);
});

test("Spotlight conflict actions render as glass buttons instead of raw links", () => {
  assert.match(css, /\.wh-spot \.wh-conflict-options,[^{]+\.wh-conflict-workbench-actions\{display:flex;gap:8px;flex-wrap:wrap/u);
  assert.match(css, /\.wh-spot \.wh-btn\{[^}]*border:1px solid var\(--ds-glass-border\);[^}]*border-radius:var\(--ds-radius-md\)/u);
  assert.match(css, /\.wh-spot \.wh-btn-primary\{[^}]*linear-gradient\(135deg,#0a84ff,#64d2ff\)/u);
});

test("Spotlight request-changes composer has editable glass feedback controls", () => {
  assert.match(css, /\.wh-spot-reason-text\{[^}]*min-height:72px;[^}]*resize:vertical;[^}]*background:transparent/u);
  assert.match(css, /\.wh-spot-reason\[data-sel="true"\]\{border-color:var\(--ds-danger\);color:var\(--ds-danger\);background:transparent/u);
  assert.match(css, /\.wh-spot-reason-actions\{display:flex;justify-content:flex-end/u);
});
