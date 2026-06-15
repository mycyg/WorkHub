import assert from "node:assert/strict";
import test from "node:test";

import type { AttentionItem } from "@workhub/contracts";

import { renderDecisionDeckHtml, decisionDeckCss } from "./decision-deck.js";

function item(partial: Partial<AttentionItem> = {}): AttentionItem {
  return {
    id: "10000000-0000-4000-8000-000000000001",
    kind: "approval",
    priority: "high",
    source_ref: { entity_type: "approval_request", entity_id: "20000000-0000-4000-8000-000000000001" },
    title: "渠道周报 Q2 初稿",
    summary_text: "AI 写好了周报初稿，等你拍板。",
    actions: [
      { id: "approve", label: "发！", style: "primary", method: "POST", href: "/api/approvals/a1/respond" },
      { id: "deny", label: "打回去改改", style: "danger", method: "POST", href: "/api/approvals/a1/respond", requires_reason: true }
    ],
    created_at: "2026-06-15T00:00:00.000Z",
    ...partial
  };
}

test("decision deck renders the done state when there is nothing to decide", () => {
  const html = renderDecisionDeckHtml({ items: [], locale: "zh-CN" });
  assert.match(html, /data-deck-empty="true"/u);
  assert.match(html, /全部搞定啦/u);
  assert.doesNotMatch(html, /wh-deck-card/u);
});

test("decision deck top card carries tag/title/count and reuses the action pipeline (href + data-action-id)", () => {
  const html = renderDecisionDeckHtml({
    items: [item(), item({ id: "10000000-0000-4000-8000-000000000002" }), item({ id: "10000000-0000-4000-8000-000000000003" })],
    locale: "zh-CN"
  });
  assert.match(html, /data-deck-count="3"/u);
  assert.match(html, /渠道周报 Q2 初稿/u);
  assert.match(html, /待审批/u);
  // 动作按钮带 href + data-action-id → 复用 browser.ts 既有 bindGoldPathNavigation 管线
  assert.match(html, /class="wh-deck-btn wh-deck-btn--primary gl-press" href="\/api\/approvals\/a1\/respond" data-action-id="approve"/u);
  assert.match(html, /data-action-id="deny"[^>]*data-requires-reason="true"/u);
  // 3 张 → 露 2 张 peek;待办计数 = 3
  assert.match(html, /wh-deck-peek1/u);
  assert.match(html, /wh-deck-peek2/u);
  assert.match(html, /待办 <b>3<\/b>/u);
});

test("decision deck maps kinds to glass tones and localizes tags (en)", () => {
  const perm = renderDecisionDeckHtml({ items: [item({ kind: "budget" })], locale: "en-US" });
  assert.match(perm, /wh-deck-tag--permission/u);
  assert.match(perm, /Allow\?/u);
  const handoff = renderDecisionDeckHtml({ items: [item({ kind: "escalation" })], locale: "en-US" });
  assert.match(handoff, /wh-deck-tag--handoff/u);
  assert.match(handoff, /Assign/u);
  assert.ok(decisionDeckCss.includes(".wh-deck-card{"));
});
