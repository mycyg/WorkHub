import assert from "node:assert/strict";
import { test } from "node:test";

import { WorkHubApiError } from "@workhub/api-client/client";
import type { ProposalDetailVM } from "@workhub/contracts";

import {
  classifyProposalActionError,
  proposalStatusLabel,
  renderProposalSidePanelHtml,
  type ProposalSidePanelState
} from "./render.js";
import { proposalActionSpec as actionSpec, proposalVm } from "./test-fixtures.js";

function detailState(over: Partial<ProposalDetailVM> = {}, ui: Extract<ProposalSidePanelState, { mode: "detail" }>["ui"] = {}): ProposalSidePanelState {
  return { mode: "detail", vm: proposalVm(over), ui };
}

test("loading state renders a spinner line, error state renders the message with back and reload actions", () => {
  const loading = renderProposalSidePanelHtml({ mode: "loading" }, "zh-CN");
  assert.match(loading, /wh-wb-spinner/u);
  assert.match(loading, /正在加载变更申请详情/u);
  const errored = renderProposalSidePanelHtml({ mode: "error", message: "网络断了", proposalId: "prop-1" }, "zh-CN");
  assert.match(errored, /网络断了/u);
  assert.match(errored, /data-wb-prop-back/u);
  assert.match(errored, /data-wb-prop-reload/u);
});

test("an opened proposal renders approve and request-changes buttons plus summary, checks, and inline diff excerpts", () => {
  const html = renderProposalSidePanelHtml(detailState(), "zh-CN");
  assert.match(html, /data-wb-prop-approve/u);
  assert.match(html, /data-wb-prop-deny/u);
  assert.match(html, /确认通过/u);
  assert.match(html, /打回修改/u);
  assert.match(html, /选题报告 · 第三节\(草稿\)/u);
  assert.match(html, /补齐了第三节的论证链/u);
  assert.match(html, /中风险 · 可回滚/u);
  // 检查项：failed/warning 带 detail、passed 只有 label。
  assert.match(html, /结构完整/u);
  assert.match(html, /引用可溯：两处引用待人工核对/u);
  // 内联 diff 摘要：before 红删 / after 绿增。
  assert.match(html, /wh-wb-prop-diff-line--del">旧的第三节开头/u);
  assert.match(html, /wh-wb-prop-diff-line--add">新的第三节开头/u);
  // 返回键。
  assert.match(html, /data-wb-prop-back/u);
});

// R27（真机走查）：右栏提议摘要把「预计 24-48 小时」渲成了「预计 24 48 小时」——摘要压平层
// （packages/ui 的 stripMarkdownMarkers）此前无差别吃掉连字符。这里从右栏 HTML 这一端钉住。
test("右栏摘要保留数字区间里的连字符", () => {
  const html = renderProposalSidePanelHtml(
    detailState({
      manifest: { ...proposalVm().manifest, summary_md: "补齐了第三节，预计 24-48 小时内交付。" }
    }),
    "zh-CN"
  );
  assert.match(html, /预计 24-48 小时内交付。/u);
});

test("a reviewed proposal with a merge action renders the merge button instead of approve/deny", () => {
  const html = renderProposalSidePanelHtml(
    detailState({
      status: "reviewed",
      review_actions: {
        approve: actionSpec({ id: "approve", label: "确认通过" }),
        request_changes: actionSpec({ id: "request_changes", label: "打回修改", requires_reason: true }),
        merge: actionSpec({ id: "merge", label: "合入交付物" })
      }
    }),
    "zh-CN"
  );
  assert.match(html, /data-wb-prop-merge/u);
  assert.match(html, /合入交付物/u);
  assert.doesNotMatch(html, /data-wb-prop-approve/u);
  assert.doesNotMatch(html, /data-wb-prop-deny/u);
});

test("merged and rejected proposals are read-only: a status chip, no action buttons at all", () => {
  for (const [status, label] of [["merged", "已合并"], ["rejected", "已打回"]] as const) {
    const html = renderProposalSidePanelHtml(detailState({ status }), "zh-CN");
    assert.match(html, new RegExp(`wh-wb-prop-status--${status}`, "u"));
    assert.match(html, new RegExp(label, "u"));
    assert.doesNotMatch(html, /data-wb-prop-approve|data-wb-prop-deny|data-wb-prop-merge/u);
  }
});

test("the reason composer replaces the two review buttons when reasonOpen is set on an opened proposal", () => {
  const html = renderProposalSidePanelHtml(detailState({}, { reasonOpen: true }), "zh-CN");
  assert.match(html, /data-wb-prop-reasons/u);
  assert.match(html, /data-wb-prop-reason-text/u);
  assert.match(html, /data-wb-prop-submit-deny/u);
  assert.match(html, /方向不对/u);
  assert.doesNotMatch(html, /data-wb-prop-approve/u);
});

test("busy states disable the buttons and swap in progress labels", () => {
  const approving = renderProposalSidePanelHtml(detailState({}, { busy: "approve" }), "zh-CN");
  assert.match(approving, /data-wb-prop-approve disabled/u);
  assert.match(approving, /确认中…/u);
  const merging = renderProposalSidePanelHtml(
    detailState(
      {
        status: "reviewed",
        review_actions: {
          approve: actionSpec({ id: "approve", label: "确认通过" }),
          request_changes: actionSpec({ id: "request_changes", label: "打回修改", requires_reason: true }),
          merge: actionSpec({ id: "merge", label: "合入交付物" })
        }
      },
      { busy: "merge" }
    ),
    "zh-CN"
  );
  assert.match(merging, /data-wb-prop-merge disabled/u);
  assert.match(merging, /合入中…/u);
});

test("an inline notice renders with its tone class, and only the network tone offers a retry button", () => {
  const conflict = renderProposalSidePanelHtml(
    detailState({}, { notice: { tone: "conflict", text: "这份变更和别人的改动冲突了，得先在审批工作台里逐个处理冲突再合入。" } }),
    "zh-CN"
  );
  assert.match(conflict, /wh-wb-prop-notice--conflict/u);
  assert.match(conflict, /审批工作台/u);
  assert.doesNotMatch(conflict, /data-wb-prop-retry/u);
  const network = renderProposalSidePanelHtml(
    detailState({}, { notice: { tone: "network", text: "没提交成功，稍后重试。", retry: "approve" } }),
    "zh-CN"
  );
  assert.match(network, /wh-wb-prop-notice--network/u);
  assert.match(network, /data-wb-prop-retry="approve"/u);
});

test("the panel html only uses wh-wb-* classes — no wh-spot-* leakage from the spotlight view", () => {
  const states: ProposalSidePanelState[] = [
    { mode: "loading" },
    { mode: "error", message: "x", proposalId: "prop-1" },
    detailState(),
    detailState({}, { reasonOpen: true, notice: { tone: "network", text: "没提交成功，稍后重试。", retry: "deny" } })
  ];
  for (const state of states) {
    const html = renderProposalSidePanelHtml(state, "zh-CN");
    assert.doesNotMatch(html, /wh-spot-/u);
  }
});

test("status labels are bilingual", () => {
  assert.equal(proposalStatusLabel("opened", true), "待审阅");
  assert.equal(proposalStatusLabel("opened", false), "Open");
  assert.equal(proposalStatusLabel("merged", true), "已合并");
  assert.equal(proposalStatusLabel("rejected", false), "Rejected");
  // 未知枚举照实回显，不假装认识。
  assert.equal(proposalStatusLabel("weird", true), "weird");
});

test("classifyProposalActionError maps 403 to the gentle permission copy without a retry", () => {
  const notice = classifyProposalActionError(new WorkHubApiError(403, "forbidden", "forbidden"), "approve", "zh-CN");
  assert.equal(notice.tone, "permission");
  assert.match(notice.text, /不归你审/u);
  assert.equal(notice.retry, undefined);
});

test("classifyProposalActionError maps a merge_conflict 409 to the approvals-workspace downgrade copy", () => {
  const conflictError = new WorkHubApiError(409, "merge_conflict", "conflict", {
    conflicts: [
      {
        target_key: "drive_item:item-1",
        target_kind: "doc",
        change_type: "updated",
        human_summary: "同一文件被别人改过",
        options: []
      }
    ]
  });
  const notice = classifyProposalActionError(conflictError, "merge", "zh-CN");
  assert.equal(notice.tone, "conflict");
  assert.match(notice.text, /审批工作台/u);
  assert.equal(notice.retry, undefined);
});

test("classifyProposalActionError maps a plain 409 (already handled elsewhere) to a reload-flavored conflict note", () => {
  const notice = classifyProposalActionError(new WorkHubApiError(409, "proposal_already_merged", "dup"), "approve", "zh-CN");
  assert.equal(notice.tone, "conflict");
  assert.match(notice.text, /状态已经变了/u);
});

test("classifyProposalActionError falls back to a retryable network notice for unknown failures", () => {
  const notice = classifyProposalActionError(new Error("socket hang up"), "deny", "zh-CN");
  assert.equal(notice.tone, "network");
  assert.equal(notice.retry, "deny");
  assert.match(notice.text, /稍后重试/u);
});
