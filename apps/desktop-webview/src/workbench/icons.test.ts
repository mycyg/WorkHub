import assert from "node:assert/strict";
import { test } from "node:test";

import { workbenchIcons } from "./icons.js";

test("every workbench icon is an inline SVG snippet, never an emoji glyph", () => {
  for (const [key, markup] of Object.entries(workbenchIcons)) {
    assert.match(markup, /^<svg /u, `${key} should render an inline <svg>`);
    assert.match(markup, /aria-hidden="true"/u, `${key} should be aria-hidden (decorative)`);
    // 粗略反检：常见 emoji 码点范围不应出现在图标标记里。
    assert.doesNotMatch(markup, /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u, `${key} must not contain an emoji glyph`);
  }
});
