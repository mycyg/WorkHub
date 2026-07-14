import assert from "node:assert/strict";
import test from "node:test";

import { personAvatarTileHtml } from "./avatar-tile.js";

test("personAvatarTileHtml renders the small tile by default with the fallback initial and hidden img", () => {
  const html = personAvatarTileHtml({ userId: "u-1", label: "张三" });
  assert.match(html, /class="wh-avatar-preview wh-avatar-preview--sm"/u);
  assert.match(html, /data-r14-avatar-tile-user-id="u-1"/u);
  assert.match(html, /class="wh-avatar-fallback" aria-hidden="true">张<\/span>/u);
  assert.match(html, /<img class="wh-avatar-img" alt="" hidden \/>/u);
});

test("personAvatarTileHtml uppercases a latin initial and carries an accessible label", () => {
  const html = personAvatarTileHtml({ userId: "u-2", label: "priya shah" });
  assert.match(html, />P<\/span>/u);
  assert.match(html, /role="img" aria-label="priya shah"/u);
});

test("personAvatarTileHtml falls back to a bare ? and marks the tile decorative when no label is available", () => {
  const html = personAvatarTileHtml({ userId: "u-3", label: "" });
  assert.match(html, />\?<\/span>/u);
  assert.match(html, /aria-hidden="true"/u);
  assert.equal(html.includes('role="img"'), false);
});

test("personAvatarTileHtml trims whitespace-only labels down to the ? fallback", () => {
  const html = personAvatarTileHtml({ userId: "u-4", label: "   " });
  assert.match(html, />\?<\/span>/u);
  assert.equal(html.includes('role="img"'), false);
});

test("personAvatarTileHtml supports the md size for standalone (non-inline) display", () => {
  const html = personAvatarTileHtml({ userId: "u-5", label: "Ada", size: "md" });
  assert.match(html, /class="wh-avatar-preview"/u);
  assert.equal(html.includes("wh-avatar-preview--sm"), false);
});

test("personAvatarTileHtml escapes userId and label against markup injection", () => {
  const html = personAvatarTileHtml({ userId: '"><script>', label: '<b>"x' });
  assert.equal(html.includes("<script>"), false);
  assert.equal(html.includes("<b>"), false);
  assert.match(html, /data-r14-avatar-tile-user-id="&quot;&gt;&lt;script&gt;"/u);
});
