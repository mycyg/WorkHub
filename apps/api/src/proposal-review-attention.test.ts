import assert from "node:assert/strict";
import test from "node:test";

import { attentionItemSchema } from "@workhub/contracts";

import { buildProposalDetailPage, buildProposalReviewAttentionItem } from "./pages/proposals.js";
import type { StoredProposal } from "./services/proposals.js";

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
  assert.equal(merge?.label, "采纳进正式版");
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
  assert.equal(item.summary_text, "任务已拆成任务计划，等你确认后再开始执行。");
  assert.equal(item.actions.find((a) => a.id === "approve")?.label, "确认计划");
  assert.equal(item.actions.find((a) => a.id === "request_replan")?.label, "打回重拆");
  assert.equal(item.actions.find((a) => a.id === "open_proposal")?.label, "查看计划提议");
  // ux-flow-spec §1.1 步3 第三动作：先不拆，单个 AI 跑（≤3 动作 + 查看详情）。
  const skipAction = item.actions.find((a) => a.id === "skip_plan_single_run");
  assert.equal(skipAction?.label, "先不拆，单个 AI 跑");
  assert.equal(skipAction?.method, "POST");
  assert.equal(skipAction?.href, `/api/proposals/${base.id}/skip-plan`);
  // 规格 §3.3：plan_review 卡标题必须带工作项名，不许通用文案。
  assert.equal(item.title, "《短剧选题调研》的分工计划等你过目");
  assert.equal(item.title.includes("《短剧选题调研》"), true);
});

test("reviewed task-plan proposals expose explicit start-or-hold decisions", () => {
  const item = buildProposalReviewAttentionItem({
    ...base,
    title: "《短剧选题调研》的分工计划等你过目",
    status: "reviewed",
    review_kind: "plan_review"
  }, "zh-CN");

  attentionItemSchema.parse(item);
  assert.deepEqual(item.actions.map((action) => action.id), [
    "approve_and_dispatch",
    "approve_hold",
    "open_proposal"
  ]);
  assert.equal(item.actions.find((a) => a.id === "approve_and_dispatch")?.label, "批准并开始执行");
  assert.equal(item.actions.find((a) => a.id === "approve_hold")?.label, "批准但先不跑");
  assert.deepEqual(item.actions.find((a) => a.id === "approve_hold")?.request_json, { dispatch: false });
});

test("reviewed task-plan proposal pages expose approve-and-start plus hold actions", () => {
  const planId = "82000000-0000-4000-8000-000000000001";
  const proposal: StoredProposal = {
    id: base.id,
    work_item_id: base.work_item_id,
    branch_id: "83000000-0000-4000-8000-000000000001",
    round: 1,
    title: "《短剧选题调研》的分工计划等你过目",
    status: "reviewed",
    diff_manifest: {
      version: 0,
      work_item_id: base.work_item_id,
      title: "计划提议",
      summary_md: "任务已拆成分工计划，等你确认。",
      author: { actor_kind: "ai", label: "WorkHub Meta-Planner" },
      base: { created_at: base.created_at },
      changes: [{
        id: planId,
        target_kind: "structured_record",
        target_ref: {
          entity_type: "task_plan",
          entity_id: planId,
          path: `/workspaces/84000000-0000-4000-8000-000000000001/task-plans/${planId}`
        },
        change_type: "generated",
        human_summary: "生成分工计划。",
        machine_summary: { changed_fields: ["task_plan_items"] }
      }],
      checks: [],
      evidence_refs: [],
      risk: { level: "low", human_label: "低风险", reversible: true },
      rollback: { available: false, description: "计划提议不需要回滚文件。" },
      review: { suggested_decision: "needs_human", reason_required_on_reject: true }
    },
    confidence_id: undefined,
    merge_snapshot_id: "85000000-0000-4000-8000-000000000001",
    opened_by_kind: "ai",
    opened_by_user_id: undefined,
    reviewed_at: base.created_at,
    merged_at: undefined,
    created_at: base.created_at,
    updated_at: base.created_at,
    reviews: []
  };

  const page = buildProposalDetailPage(proposal, "zh-CN");

  assert.equal(page.review_actions.merge?.id, "approve_and_dispatch");
  assert.equal(page.review_actions.merge?.label, "批准并开始执行");
  assert.equal(page.review_actions.approve_hold?.label, "批准但先不跑");
  assert.deepEqual(page.review_actions.approve_hold?.request_json, { dispatch: false });
});
