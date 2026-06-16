import assert from "node:assert/strict";
import test from "node:test";

import { safeHref } from "./html.js";

test("safeHref allows relative, http(s) and mailto hrefs unchanged", () => {
  assert.equal(safeHref("/api/proposals/abc/merge"), "/api/proposals/abc/merge");
  assert.equal(safeHref("/dashboard/cost"), "/dashboard/cost");
  assert.equal(safeHref("https://example.com/x"), "https://example.com/x");
  assert.equal(safeHref("HTTP://Example.com"), "HTTP://Example.com");
  assert.equal(safeHref("mailto:a@b.com"), "mailto:a@b.com");
});

test("safeHref neutralizes javascript: and data: schemes to #", () => {
  assert.equal(safeHref("javascript:alert(document.cookie)"), "#");
  assert.equal(safeHref("  javascript:alert(1)"), "#");
  assert.equal(safeHref("JaVaScRiPt:alert(1)"), "#");
  assert.equal(safeHref("data:text/html,<script>alert(1)</script>"), "#");
  assert.equal(safeHref("vbscript:msgbox(1)"), "#");
});

test("safeHref maps empty/nullish to #", () => {
  assert.equal(safeHref(""), "#");
  assert.equal(safeHref(undefined), "#");
  assert.equal(safeHref(null), "#");
});

test("safeHref is idempotent", () => {
  assert.equal(safeHref(safeHref("javascript:alert(1)")), "#");
  assert.equal(safeHref(safeHref("/api/x")), "/api/x");
});
