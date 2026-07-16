import assert from "node:assert/strict";
import test from "node:test";

import type { ProposalChangeDiffVM } from "@workhub/contracts";

import { renderEditorHtml, type EditorViewState } from "./render.js";

function diff(overrides: Partial<ProposalChangeDiffVM> = {}): ProposalChangeDiffVM {
  return {
    proposal_id: "p1",
    change_id: "c1",
    path: "/outputs/privacy-section.md",
    filename: "privacy-section.md",
    change_type: "updated",
    status: "opened",
    title: "隐私区文案",
    base_available: true,
    truncated: false,
    segments: [
      { type: "context", lines: ["intro"] },
      { type: "del", lines: ["old middle"] },
      { type: "add", lines: ["new middle"] },
      { type: "context", lines: ["tail"] }
    ],
    ...overrides
  };
}

function ready(overrides: Partial<Extract<EditorViewState, { mode: "ready" }>> = {}): EditorViewState {
  return {
    mode: "ready",
    diff: diff(),
    actions: { status: "opened" },
    ui: { expanded: new Set<number>() },
    ...overrides
  };
}

test("renderEditorHtml paints del lines red-with-strikethrough and add lines green (tracked changes)", () => {
  const html = renderEditorHtml(ready(), "zh-CN");
  assert.match(html, /wh-wb-ed-line--del/u);
  assert.match(html, /wh-wb-ed-line--add/u);
  assert.match(html, /old middle/u);
  assert.match(html, /new middle/u);
});

test("renderEditorHtml shows approve + request-changes for an open proposal", () => {
  const html = renderEditorHtml(ready(), "zh-CN");
  assert.match(html, /data-wb-ed-approve/u);
  assert.match(html, /data-wb-ed-deny/u);
  assert.doesNotMatch(html, /data-wb-ed-merge/u);
});

test("renderEditorHtml shows merge only when reviewed and a merge action is available", () => {
  const reviewed = renderEditorHtml(
    ready({ diff: diff({ status: "reviewed" }), actions: { status: "reviewed", mergeLabel: "合入交付物" } }),
    "zh-CN"
  );
  assert.match(reviewed, /data-wb-ed-merge/u);
  assert.doesNotMatch(reviewed, /data-wb-ed-approve/u);

  const reviewedNoMerge = renderEditorHtml(
    ready({ diff: diff({ status: "reviewed" }), actions: { status: "reviewed" } }),
    "zh-CN"
  );
  assert.doesNotMatch(reviewedNoMerge, /data-wb-ed-merge/u);
  assert.match(reviewedNoMerge, /wh-wb-ed-status/u);
});

test("renderEditorHtml collapses a long unchanged run behind an expand toggle, and expands it when asked", () => {
  const longContext = Array.from({ length: 20 }, (_, i) => `line ${i}`);
  const collapsed = renderEditorHtml(
    ready({ diff: diff({ segments: [{ type: "context", lines: longContext }] }) }),
    "zh-CN"
  );
  assert.match(collapsed, /data-wb-ed-expand="0"/u);
  assert.match(collapsed, /展开未变更的 16 行/u);

  const expanded = renderEditorHtml(
    ready({ diff: diff({ segments: [{ type: "context", lines: longContext }] }), ui: { expanded: new Set([0]) } }),
    "zh-CN"
  );
  assert.match(expanded, /data-wb-ed-collapse="0"/u);
  assert.match(expanded, /line 10/u);
});

test("renderEditorHtml surfaces an honest banner when the base version is unavailable", () => {
  const html = renderEditorHtml(ready({ diff: diff({ base_available: false, segments: [{ type: "context", lines: ["only proposed"] }] }) }), "zh-CN");
  assert.match(html, /无法比对改动前的版本/u);
  assert.doesNotMatch(html, /wh-wb-ed-line--add/u);
});

test("renderEditorHtml renders the 415 unsupported state without action buttons", () => {
  const html = renderEditorHtml({ mode: "unsupported", filename: "chart.xlsx" }, "zh-CN");
  assert.match(html, /没有可逐行对照/u);
  assert.doesNotMatch(html, /data-wb-ed-approve/u);
});
