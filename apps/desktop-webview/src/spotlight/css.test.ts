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

test("Spotlight visual language uses Apple blue/cyan accents instead of purple gradients", () => {
  assert.match(css, /\.wh-spot-act--primary\{[^}]*linear-gradient\(135deg,#0a84ff,#64d2ff\)/u);
  assert.match(css, /\.wh-spot-card-bar--approval\{background:linear-gradient\(180deg,#0a84ff,#64d2ff\)/u);
  assert.doesNotMatch(css, /#7c83ff|#b57bff/u);
});

test("Spotlight proposal action notes and skipped checks are visibly distinct", () => {
  assert.match(css, /\.wh-spot-action-note\{[^}]*flex:1 0 100%;[^}]*font:600 12px\/1\.4 var\(--ds-font\)/u);
  assert.match(css, /\.wh-spot-check--skipped\{background:rgba\(142,142,147,\.14\);color:var\(--ds-ink-muted\)\}/u);
});

test("Spotlight conflict actions render as glass buttons instead of raw links", () => {
  assert.match(css, /\.wh-spot \.wh-conflict-options,[^{]+\.wh-conflict-workbench-actions\{display:flex;gap:8px;flex-wrap:wrap/u);
  assert.match(css, /\.wh-spot \.wh-btn\{[^}]*border:1px solid var\(--ds-glass-border\);[^}]*border-radius:var\(--ds-radius-md\)/u);
  assert.match(css, /\.wh-spot \.wh-btn-primary\{[^}]*linear-gradient\(135deg,#0a84ff,#64d2ff\)/u);
});

test("Spotlight request-changes composer has editable glass feedback controls", () => {
  assert.match(css, /\.wh-spot-reason-text\{[^}]*min-height:72px;[^}]*resize:vertical;[^}]*background:rgba\(255,255,255,\.58\)/u);
  assert.match(css, /\.wh-spot-reason\[data-sel="true"\]\{border-color:var\(--ds-danger\);color:var\(--ds-danger\);background:var\(--ds-danger-soft\)\}/u);
  assert.match(css, /\.wh-spot-reason-actions\{display:flex;justify-content:flex-end/u);
});
