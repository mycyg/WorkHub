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
