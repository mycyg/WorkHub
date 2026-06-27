import assert from "node:assert/strict";
import { test } from "node:test";

import { defaultSelectedOptionIds, startHtml } from "./intake.js";

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

test("desktop intake defaults the recommended single-choice option", () => {
  const selected = defaultSelectedOptionIds({
    id: "scope",
    title: "这件事先按哪种交付方式处理？",
    input_mode: "single_choice",
    options: [
      { id: "document-draft", label: "文档/方案草稿" },
      { id: "structured-data", label: "结构化数据" }
    ],
    recommended_option_ids: ["document-draft"],
    free_text: { enabled: true, collapsed_by_default: true },
    progress: [],
    evidence_refs: [],
    submit: { method: "POST", href: "/next" }
  });
  assert.deepEqual([...selected], ["document-draft"]);
});

test("desktop intake does not auto-answer multi-choice questions", () => {
  const selected = defaultSelectedOptionIds({
    id: "checks",
    title: "要检查哪些部分？",
    input_mode: "multi_choice",
    options: [
      { id: "ui", label: "UI" },
      { id: "api", label: "API" }
    ],
    recommended_option_ids: ["ui"],
    free_text: { enabled: true, collapsed_by_default: true },
    progress: [],
    evidence_refs: [],
    submit: { method: "POST", href: "/next" }
  });
  assert.equal(selected.size, 0);
});

test("desktop intake defaults the recommended confirm action", () => {
  const selected = defaultSelectedOptionIds({
    id: "confirm",
    title: "是否按这个方向创建事项？",
    input_mode: "confirm",
    options: [
      { id: "create", label: "创建事项" },
      { id: "evidence", label: "先找证据" }
    ],
    recommended_option_ids: ["create"],
    free_text: { enabled: true, collapsed_by_default: true },
    progress: [],
    evidence_refs: [],
    submit: { method: "POST", href: "/create" }
  });
  assert.deepEqual([...selected], ["create"]);
});
