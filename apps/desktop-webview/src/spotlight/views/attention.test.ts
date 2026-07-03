import assert from "node:assert/strict";
import test from "node:test";

import { WorkHubApiError } from "@workhub/api-client/client";
import type { ProposalConflict } from "@workhub/contracts";

import {
  attentionCardDisplayTitle,
  attentionTagLabelForKind,
  attentionConflictHtmlFromError,
  classifyAttentionActionHref,
  reviewAttentionProposalWithoutMerge
} from "./attention.js";

test("classifyAttentionActionHref routes proposal/workitem detail hrefs to inline navigation (no dead button)", () => {
  // 对抗审查 HIGH:决策卡「查看变更」是 GET /proposals/:id,之前落到 runAction 末尾死 toast。现走 ctx.open。
  assert.deepEqual(classifyAttentionActionHref("/proposals/abc-123"), {
    kind: "navigate",
    view: "proposals",
    id: "abc-123"
  });
  assert.deepEqual(classifyAttentionActionHref("/workitems/wi-9"), {
    kind: "navigate",
    view: "workitem",
    id: "wi-9"
  });
});

test("classifyAttentionActionHref keeps POST action hrefs as submit (runAction handles them)", () => {
  assert.equal(classifyAttentionActionHref("/api/approvals/x/respond").kind, "submit");
  assert.equal(classifyAttentionActionHref("/api/proposals/abc/review").kind, "submit");
  assert.equal(classifyAttentionActionHref("/api/proposals/abc/merge").kind, "submit");
});

test("classifyAttentionActionHref only treats a clean single-segment detail path as navigation", () => {
  // 带 query、带额外路径段、空 id 的都不算干净详情导航 → 留给 submit/runAction。
  assert.equal(classifyAttentionActionHref("/proposals/abc/extra").kind, "submit");
  assert.equal(classifyAttentionActionHref("/proposals/abc?focus=diff").kind, "submit");
  assert.equal(classifyAttentionActionHref("/proposals/").kind, "submit");
  assert.equal(classifyAttentionActionHref("/something/else").kind, "submit");
});

test("attention proposal approval reviews only and never merges in the same click", async () => {
  const calls: string[] = [];
  const client = {
    async reviewProposal(id: string, payload: unknown) {
      calls.push(`review:${id}:${JSON.stringify(payload)}`);
      return { attention: { summary_text: "已确认通过" } };
    },
    async mergeProposal(id: string) {
      calls.push(`merge:${id}`);
      return { attention: { summary_text: "已合入" } };
    }
  };

  const result = await reviewAttentionProposalWithoutMerge(client, "proposal-1") as { attention: { summary_text: string } };

  assert.deepEqual(calls, ['review:proposal-1:{"decision":"approve","remember":"once"}']);
  assert.equal(result.attention.summary_text, "已确认通过");
});

test("attention proposal review cards hide model self narration in their title", () => {
  assert.equal(
    attentionCardDisplayTitle({
      kind: "proposal_review",
      title: "The file looks good and complete. Let me now provide the summary."
    }, true),
    "交付物变更申请"
  );
  assert.equal(
    attentionCardDisplayTitle({
      kind: "approval",
      title: "审批预算"
    }, true),
    "审批预算"
  );
});

test("attention escalation cards do not label retry/cancel actions as assignment", () => {
  assert.equal(attentionTagLabelForKind("escalation", true), "需处理");
  assert.equal(attentionTagLabelForKind("escalation", false), "Needs action");
});

test("attention proposal merge conflict renders actionable choices instead of a generic failure", () => {
  const conflict: ProposalConflict = {
    id: "conflict-1",
    work_item_id: "work-1",
    proposal_id: "proposal-1",
    change_id: "change-1",
    target_key: "drive_item:outputs/demo.md",
    target_kind: "text_doc",
    change_type: "generated",
    target_path: "outputs/demo.md",
    headline: "demo.md 已经有正式版本",
    summary_text: "这份变更和正式版撞车，需要先选择处理方案。",
    existing: { proposal_id: "old-proposal", change_id: "old-change", sha256: "a".repeat(64) },
    incoming: { sha256_before: "b".repeat(64), sha256_after: "c".repeat(64) },
    recommended_option_id: "keep_current",
    options: [
      {
        id: "keep_current",
        label: "保留正式版",
        summary_text: "保留已正式采纳的版本。",
        recommended: true,
        action: {
          id: "keep_current",
          label: "保留正式版",
          method: "POST",
          href: "/api/proposals/proposal-1/merge",
          request_json: { conflict_resolution: { accept_incoming_target_keys: [] } }
        }
      },
      {
        id: "accept_incoming",
        label: "查看变更申请",
        summary_text: "先打开总结和改动明细。",
        action: {
          id: "accept_incoming",
          label: "查看变更申请",
          method: "GET",
          href: "/proposals/proposal-1"
        }
      }
    ]
  };

  const html = attentionConflictHtmlFromError(
    new WorkHubApiError(409, "merge_conflict", conflict.summary_text, { conflicts: [conflict] }),
    true
  );

  assert.match(html ?? "", /data-prop-conflict-panel="true"/u);
  assert.match(html ?? "", /这份变更撞车了/u);
  assert.match(html ?? "", /保留正式版/u);
  assert.match(html ?? "", /href="\/proposals\/proposal-1"/u);
  assert.match(html ?? "", /data-method="GET"/u);
});
