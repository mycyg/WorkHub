import assert from "node:assert/strict";
import { test } from "node:test";

import { WorkHubApiError } from "@workhub/api-client/client";
import type { ProposalConflict, ProposalDetailVM } from "@workhub/contracts";

import {
  classifyProposalConflictActionHref,
  detailHtml,
  proposalListDisplayTitle,
  proposalMergeConflictHtml,
  proposalDetailRefreshTargetAfterReview,
  proposalRequestChangesReason,
  reasonComposerHtml,
  reviewProposalWithoutMerge
} from "./proposals.js";

function proposalVm(overrides: Partial<ProposalDetailVM> = {}): ProposalDetailVM {
  return {
    proposal_id: "proposal-1",
    work_item_id: "work-1",
    title: "完成了。让我做一个人话总结。",
    status: "opened",
    manifest: {
      version: 0,
      work_item_id: "work-1",
      title: "完成了。让我做一个人话总结。",
      summary_md: "## 变更摘要\n本次从 outputs/ 生成 1 个交付物变更草案。\n## 审查提示\n等待人工确认。",
      author: { actor_kind: "ai", label: "Cuu" },
      base: {},
      risk: { level: "low", human_label: "低风险", reversible: true },
      rollback: { available: true, description: "可回滚。" },
      evidence_refs: [],
      review: { reason_required_on_reject: true },
      changes: [
        {
          id: "change-1",
          human_summary: "文本稿已生成",
          target_kind: "text_doc",
          change_type: "generated",
          target_ref: { entity_type: "drive_item", path: "/outputs/demo.md" }
        }
      ],
      checks: [{ id: "exists", label: "交付物存在", status: "passed", detail: "已生成。" }]
    },
    review_actions: {
      approve: { id: "approve", label: "通过", method: "POST", href: "/api/proposals/proposal-1/review" },
      request_changes: {
        id: "request_changes",
        label: "打回",
        method: "POST",
        href: "/api/proposals/proposal-1/review",
        requires_reason: true
      }
    },
    evidence_refs: [],
    comments: [],
    ...overrides
  } as unknown as ProposalDetailVM;
}

test("desktop proposal detail hides model self narration and shows a plain summary first", () => {
  const html = detailHtml(proposalVm(), true);

  assert.equal(html.includes("完成了。让我做一个人话总结。"), false);
  assert.equal(html.includes("## 变更摘要"), false);
  assert.equal(html.includes(">变更摘要 "), false);
  assert.equal(html.includes(">审查提示 "), false);
  assert.match(html, /交付物变更申请/u);
  assert.match(html, /data-prop-summary="true"/u);
  assert.match(html, />总结</u);
  assert.match(html, /本次从 outputs\/ 生成 1 个交付物变更草案/u);
});

test("R9.7 desktop proposal detail hides task-plan internals from persisted summaries", () => {
  const html = detailHtml(proposalVm({
    manifest: {
      ...proposalVm().manifest,
      summary_md: "先生成任务计划，等待人工审阅后再派发。WorkHub Meta-Planner judge confidence high."
    }
  }), true);

  assert.doesNotMatch(html, /派发|dispatch|Meta-Planner|judge|confidence/iu);
});

test("desktop proposal list title hides model self narration", () => {
  assert.equal(proposalListDisplayTitle("The file looks good and complete. Let me now provide the summary.", true), "交付物变更申请");
  assert.equal(proposalListDisplayTitle("完成了。让我做一个人话总结。", false), "Deliverable change request");
});

test("desktop proposal detail makes navigation, merge consequence, and skipped checks explicit", () => {
  const html = detailHtml(proposalVm({
    manifest: {
      ...proposalVm().manifest,
      checks: [
        { id: "exists", label: "交付物存在", status: "passed", detail: "已生成。" },
        { id: "evidence", label: "证据引用", status: "skipped", detail: "未传入证据引用，等待人工确认。" }
      ]
    }
  }), true);

  assert.match(html, /返回待审改动/u);
  assert.match(html, /确认通过后再合入交付物，可用快照回滚/u);
  assert.match(html, /确认通过/u);
  assert.doesNotMatch(html, /采纳并合并/u);
  assert.match(html, /打回修改/u);
  assert.match(html, /wh-spot-check--skipped/u);
  assert.match(html, /证据引用：未传入证据引用，等待人工确认/u);
});

test("desktop reviewed proposal detail exposes merge as a second explicit step", () => {
  const html = detailHtml(proposalVm({
    status: "reviewed",
    review_actions: {
      ...proposalVm().review_actions,
      merge: { id: "merge", label: "合并", method: "POST", href: "/api/proposals/proposal-1/merge" }
    }
  }), true);

  assert.match(html, /已确认通过，只差合入交付物/u);
  assert.match(html, /合入交付物/u);
  assert.doesNotMatch(html, /打回修改/u);
  assert.doesNotMatch(html, /确认通过后再合入交付物/u);
});

test("desktop proposal detail renders merge conflicts as choices instead of a generic failure", () => {
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
        label: "采纳这次版本",
        summary_text: "用这次版本覆盖正式版。",
        action: {
          id: "accept_incoming",
          label: "采纳这次版本",
          method: "POST",
          href: "/api/proposals/proposal-1/merge",
          request_json: { conflict_resolution: { accept_incoming_target_keys: ["drive_item:outputs/demo.md"] } }
        }
      }
    ]
  };

  const html = proposalMergeConflictHtml(
    new WorkHubApiError(409, "merge_conflict", conflict.summary_text, { conflicts: [conflict] }),
    true
  );

  assert.match(html ?? "", /data-prop-conflict-panel="true"/u);
  assert.match(html ?? "", /这份变更和别人的改动冲突了/u);
  assert.match(html ?? "", /保留正式版/u);
  assert.match(html ?? "", /采纳这次版本/u);
  assert.doesNotMatch(html ?? "", /合并失败/u);
});

test("desktop proposal conflict panel routes view links to detail instead of treating them as conflict actions", () => {
  assert.deepEqual(classifyProposalConflictActionHref("/proposals/proposal-1"), {
    kind: "detail",
    proposalId: "proposal-1"
  });
  assert.deepEqual(classifyProposalConflictActionHref("https://workhub.local/proposals/proposal%202"), {
    kind: "detail",
    proposalId: "proposal 2"
  });
  assert.deepEqual(classifyProposalConflictActionHref("/api/merge-proposals/merge-1/apply"), {
    kind: "apply",
    applyId: "merge-1"
  });
  assert.deepEqual(classifyProposalConflictActionHref("/api/proposals/proposal-1/merge"), {
    kind: "merge",
    proposalId: "proposal-1"
  });
  assert.deepEqual(classifyProposalConflictActionHref("/api/proposals/proposal-1/review"), {
    kind: "unsupported"
  });
});

test("desktop proposal confirmation reviews only and never merges in the same click", async () => {
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

  const result = await reviewProposalWithoutMerge(client, "proposal-1") as { attention: { summary_text: string } };

  assert.deepEqual(calls, ['review:proposal-1:{"decision":"approve","remember":"once"}']);
  assert.equal(result.attention.summary_text, "已确认通过");
});

test("desktop proposal approval refreshes only the proposal that started the review", () => {
  assert.equal(proposalDetailRefreshTargetAfterReview("proposal-1", "proposal-1"), "proposal-1");
  assert.equal(proposalDetailRefreshTargetAfterReview("proposal-1", "proposal-2"), undefined);
  assert.equal(proposalDetailRefreshTargetAfterReview("proposal-1", undefined), undefined);
});

test("desktop proposal request-changes composer accepts custom feedback instead of only presets", () => {
  const html = reasonComposerHtml(true);

  assert.match(html, /data-prop-reasons/u);
  assert.match(html, /data-prop-reason-text/u);
  assert.match(html, /placeholder="具体写哪里需要改/u);
  assert.match(html, /data-prop-submit-deny/u);
  assert.match(html, /发送打回说明/u);
  assert.match(html, /方向不对/u);
});

test("desktop proposal request-changes reason combines preset and custom detail", () => {
  assert.equal(proposalRequestChangesReason("缺少依据", "请补 workhub-app-upload.txt 的原文引用。"), "缺少依据\n\n请补 workhub-app-upload.txt 的原文引用。");
  assert.equal(proposalRequestChangesReason("缺少依据", ""), "缺少依据");
  assert.equal(proposalRequestChangesReason("", "请改成验收同学能直接执行的口径。"), "请改成验收同学能直接执行的口径。");
  assert.equal(proposalRequestChangesReason("", "   "), undefined);
});
