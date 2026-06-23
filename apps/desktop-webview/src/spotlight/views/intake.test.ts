import assert from "node:assert/strict";
import { test } from "node:test";

import { startHtml } from "./intake.js";

test("S4b desktop intake start shows the bound project when a label is supplied", () => {
  const html = startHtml(true, "客户复盘项目");
  assert.ok(html.includes('data-intake-project="客户复盘项目"'), "carries the project marker");
  assert.ok(html.includes("项目：客户复盘项目"), "shows the project name pill");
  // the intent textarea + start button are still present
  assert.ok(html.includes("data-intent"), "intent input present");
  assert.ok(html.includes("data-start"), "start button present");
});

test("S4b desktop intake start stays generic (no project pill) when no label is supplied", () => {
  const html = startHtml(false);
  assert.ok(!html.includes("data-intake-project"), "no project marker when unbound");
  assert.ok(!html.includes("Project:"), "no project pill when unbound");
  assert.ok(html.includes("data-intent") && html.includes("data-start"), "generic start intact");
});
