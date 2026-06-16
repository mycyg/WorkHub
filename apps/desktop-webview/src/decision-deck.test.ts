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

test("decision deck shows a background-runs footer for running/queued AI, even in the done state", () => {
  const runs = [
    { run_id: "r1", work_item_id: "w1", title: "渠道周报", state: "running", preview_text: "写初稿中" },
    { run_id: "r2", title: "数据透视", state: "queued", preview_text: "排队中" },
    { run_id: "r3", title: "已完事", state: "failed", preview_text: "失败" }
  ];
  // done-state(无待办)也展示在跑 AI
  const done = renderDecisionDeckHtml({ items: [], locale: "zh-CN", backgroundRuns: runs });
  assert.match(done, /data-deck-empty="true"/u);
  assert.match(done, /Cuu 正在干 2 件活/u); // running + queued,failed 不计
  assert.match(done, /渠道周报/u);
  assert.match(done, /数据透视/u);
  // 有待办时 footer 也在
  const withItems = renderDecisionDeckHtml({ items: [item()], locale: "zh-CN", backgroundRuns: runs });
  assert.match(withItems, /wh-deck-runs/u);
  assert.match(withItems, /Cuu 正在干 2 件活/u);
});

test("decision deck omits the footer when nothing is actively running (en pluralization)", () => {
  const none = renderDecisionDeckHtml({ items: [item()], locale: "zh-CN", backgroundRuns: [{ run_id: "r", title: "t", state: "waiting_for_user", preview_text: "p" }] });
  assert.doesNotMatch(none, /wh-deck-runs/u);
  const one = renderDecisionDeckHtml({ items: [], locale: "en-US", backgroundRuns: [{ run_id: "r", title: "Report", state: "running", preview_text: "p" }] });
  assert.match(one, /Cuu is on 1 task</u);
});

test("decision deck shows today's worklog strip with R8 self-evolution counts when present", () => {
  const worklog = {
    runs_today: 5,
    autonomy_rate: 80,
    accepted_today: 3,
    saved_hours_estimate: 1.5,
    skills_promoted_today: 1,
    skills_refined_today: 2,
    generated_at: "2026-06-16T00:00:00.000Z",
    range_label: "今天"
  };
  const withItems = renderDecisionDeckHtml({ items: [item()], locale: "zh-CN", worklog });
  assert.match(withItems, /data-deck-worklog="true"/u);
  assert.match(withItems, /扛了 <b>3<\/b>/u);
  assert.match(withItems, /data-deck-self-evolve="true"/u);
  assert.match(withItems, /data-deck-skills-promoted="1"/u);
  assert.match(withItems, /data-deck-skills-refined="2"/u);
  assert.match(withItems, /自我精进 技能 \+1 · 精修 2/u);

  // 战绩条在「全部搞定」空态也显示。
  const done = renderDecisionDeckHtml({ items: [], locale: "zh-CN", worklog });
  assert.match(done, /data-deck-empty="true"/u);
  assert.match(done, /data-deck-worklog="true"/u);
});

test("decision deck omits the self-evolution clause when no skills changed today", () => {
  const worklog = {
    runs_today: 2,
    autonomy_rate: 50,
    accepted_today: 1,
    saved_hours_estimate: 0.5,
    skills_promoted_today: 0,
    skills_refined_today: 0,
    generated_at: "2026-06-16T00:00:00.000Z"
  };
  const html = renderDecisionDeckHtml({ items: [item()], locale: "zh-CN", worklog });
  assert.match(html, /data-deck-worklog="true"/u); // 战绩条仍在
  assert.doesNotMatch(html, /data-deck-self-evolve="true"/u); // 但无自进化子句
});

test("decision deck omits the worklog strip entirely when no worklog data", () => {
  const html = renderDecisionDeckHtml({ items: [item()], locale: "zh-CN" });
  assert.doesNotMatch(html, /data-deck-worklog="true"/u);
});

test("decisionDeckCss styles the worklog strip", () => {
  assert.match(decisionDeckCss, /wh-deck-worklog/u);
});
