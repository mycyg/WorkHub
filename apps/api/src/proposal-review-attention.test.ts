import assert from "node:assert/strict";
import test from "node:test";

import { attentionItemSchema } from "@workhub/contracts";

import { buildProposalReviewAttentionItem } from "./pages/proposals.js";

const base = {
  id: "80000000-0000-4000-8000-000000000001",
  work_item_id: "81000000-0000-4000-8000-000000000001",
  title: "渠道周报 Q2 初稿",
  created_at: "2026-06-16T00:00:00.000Z"
} as const;

test("opened proposal → proposal_review item with approve/request_changes/view actions on the proposal endpoints", () => {
  const item = buildProposalReviewAttentionItem({ ...base, status: "opened" }, "zh-CN");
  // schema-valid + correct kind/source_ref
  attentionItemSchema.parse(item);
  assert.equal(item.kind, "proposal_review");
  assert.equal(item.source_ref.entity_type, "proposal");
  assert.equal(item.source_ref.entity_id, base.id);
  assert.equal(item.work_item_id, base.work_item_id);
  assert.equal(item.title, base.title);

  const approve = item.actions.find((a) => a.id === "approve");
  assert.ok(approve);
  assert.equal(approve?.method, "POST");
  assert.equal(approve?.href, `/api/proposals/${base.id}/review`);
  assert.equal(approve?.style, "primary");
  assert.equal(approve?.label, "确认通过");
  assert.notEqual(approve?.requires_reason, true);

  const requestChanges = item.actions.find((a) => a.id === "request_changes");
  assert.ok(requestChanges);
  assert.equal(requestChanges?.href, `/api/proposals/${base.id}/review`);
  assert.equal(requestChanges?.style, "danger");
  assert.equal(requestChanges?.requires_reason, true);

  const view = item.actions.find((a) => a.id === "open_proposal");
  assert.equal(view?.method, "GET");
  assert.equal(view?.href, `/proposals/${base.id}`);

  // opened 不应有 merge 动作
  assert.equal(item.actions.find((a) => a.id === "merge"), undefined);
});

test("reviewed proposal → proposal_review item exposes merge + view (no approve)", () => {
  const item = buildProposalReviewAttentionItem({ ...base, status: "reviewed" }, "zh-CN");
  attentionItemSchema.parse(item);
  const merge = item.actions.find((a) => a.id === "merge");
  assert.ok(merge);
  assert.equal(merge?.method, "POST");
  assert.equal(merge?.href, `/api/proposals/${base.id}/merge`);
  assert.equal(merge?.style, "primary");
  assert.equal(merge?.label, "合入交付物");
  assert.ok(item.actions.find((a) => a.id === "open_proposal"));
  assert.equal(item.actions.find((a) => a.id === "approve"), undefined);
});

test("proposal_review item localizes labels (en)", () => {
  const item = buildProposalReviewAttentionItem({ ...base, status: "opened" }, "en-US");
  attentionItemSchema.parse(item);
  assert.equal(item.actions.find((a) => a.id === "approve")?.label, "Mark approved");
  assert.match(item.summary_text, /review it/u);
});

test("task-plan proposals render as plan_review attention with plan-specific copy", () => {
  const item = buildProposalReviewAttentionItem({
    ...base,
    title: "《短剧选题调研》的分工计划等你过目",
    status: "opened",
    review_kind: "plan_review"
  }, "zh-CN");

  attentionItemSchema.parse(item);
  assert.equal(item.kind, "plan_review");
  // R9.7: the old expected copy exposed internal "派发" workflow wording to the decision inbox.
  assert.equal(item.summary_text, "任务已拆成分工计划，等你确认后再开始执行。");
  assert.equal(item.actions.find((a) => a.id === "approve")?.label, "确认计划");
  assert.equal(item.actions.find((a) => a.id === "request_changes")?.label, "打回重拆");
  assert.equal(item.actions.find((a) => a.id === "open_proposal")?.label, "查看计划提议");
});
