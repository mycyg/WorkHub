import assert from "node:assert/strict";
import { test } from "node:test";

import { spotlightCss } from "./css.js";

const css = Array.isArray(spotlightCss) ? (spotlightCss as string[]).join("") : String(spotlightCss);

test("L5: launcher default-highlight (accent ring + active bg) only shows under keyboard nav", () => {
  // The accent ring and the active background must be gated behind box[data-kbd="true"]
  // so a mouse-only open never shows a stuck selection ring on the first card.
  assert.match(css, /\.wh-spot\[data-kbd="true"\] \.wh-spot-cap\[data-active="true"\]\{[^}]*box-shadow:inset 0 0 0 2px var\(--ds-accent\)/u);
  // There must be NO ungated accent ring (the old form put box-shadow directly after the
  // brace: `[data-active="true"]{box-shadow:...}`; the gated rule opens with background:...).
  assert.doesNotMatch(css, /\[data-active="true"\]\{box-shadow:inset 0 0 0 2px var\(--ds-accent\)/u);
});
