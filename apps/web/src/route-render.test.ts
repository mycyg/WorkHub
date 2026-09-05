import assert from "node:assert/strict";
import test from "node:test";

import type { WorkHubApiClient } from "@workhub/api-client";
import type { ProposalConflict } from "@workhub/contracts";

import { loadWebAgentRunReplay, renderWebAgentRunReplay, renderWebProposalDetail } from "./route-render.js";

// D-01（R23 精简批）：这两条用例原来是 apps/web/src/main.test.ts 里「web surface advertises and loads the
// shared P0.5 gold path page VM」这条巨型测试的一部分，随 main.ts 死 barrel 一起搬过来的（其余在同一条
// 测试里的 gold-path/workitem/intake/agent-run-live 断言测的是零生产调用的包装函数，已随 barrel 删除，
// 不迁移）。fakeClient 只补桩 renderWebProposalDetail/renderWebAgentRunReplay 实际会调用的三个方法。

const proposalVm = {
  proposal_id: "proposal",
  work_item_id: "work",
  title: "周报草稿变更申请",
  status: "opened",
  manifest: {
    version: 0,
    work_item_id: "work",
    title: "周报草稿变更申请",
    summary_md: "新增一份周报草稿。",
    author: { actor_kind: "ai", label: "AI" },
    base: {},
    risk: { level: "low", human_label: "低风险", reversible: true },
    rollback: { available: true, description: "删除生成草稿即可回滚。" },
    evidence_refs: [],
    review: { reason_required_on_reject: true },
    changes: [
      {
        id: "change",
        human_summary: "新增 weekly-report.md",
        target_kind: "text_doc",
        change_type: "generated",
        target_ref: { entity_type: "drive_item", path: "docs/weekly-report.md" }
      }
    ],
    checks: [{ id: "scope", label: "范围检查", status: "passed", detail: "仅文件改动。" }]
  },
  review_actions: {
    approve: { id: "approve", label: "批准", method: "POST", href: "/approvals/approve" },
    request_changes: {
      id: "changes",
      label: "要求修改",
      method: "POST",
      href: "/approvals/changes",
      requires_reason: true
    }
  },
  evidence_refs: [],
  comments: []
};

const replayVm = {
  run: { handoff_md: "AI 完成了草稿生成。" },
  steps: [
    { step_no: 1, phase: "plan", output_excerpt: "列出章节。" },
    { step_no: 2, phase: "draft", output_excerpt: "生成草稿。" }
  ],
  cost: {
    me: {
      scope: { kind: "user", user_id: "10000000-0000-4000-8000-000000000001" },
      scope_label: "我的今日 AI 预算",
      policy_id: "pcost-user-day-v0",
      period: "day",
      period_start: "2026-06-05T00:00:00.000Z",
      period_end: "2026-06-06T00:00:00.000Z",
      token_in: 900,
      token_out: 300,
      total_tokens: 1200,
      max_tokens: 500000,
      remaining_tokens: 498800,
      estimated_cost_cny: "0.08",
      max_cost_cny: "20",
      remaining_cost_cny: "19.92",
      warning_ratio: 0.12,
      status: "ok"
    },
    scopes: [],
    active_notices: [],
    generated_at: "2026-06-05T01:00:00.000Z"
  },
  snapshots: [],
  evidence_refs: []
};

function proposalConflict(workItemId: string, proposalId: string): ProposalConflict {
  return {
    id: "conflict-weekly-report",
    work_item_id: workItemId,
    proposal_id: proposalId,
    change_id: "10000000-0000-4000-8000-000000000402",
    target_key: "drive_item:docs/weekly-report.md",
    target_kind: "text_doc",
    change_type: "updated",
    target_path: "docs/weekly-report.md",
    headline: "weekly-report.md 已经被另一份变更更新",
    summary_text: "正式版和这次版本都改了同一个文档，先选保留正式版还是采纳这次版本。",
    existing: {
      proposal_id: "10000000-0000-4000-8000-000000000411",
      change_id: "10000000-0000-4000-8000-000000000412",
      sha256: "a".repeat(64)
    },
    incoming: {
      sha256_before: "b".repeat(64),
      sha256_after: "c".repeat(64)
    },
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
          href: `/api/proposals/${proposalId}/merge`,
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
          href: `/api/proposals/${proposalId}/merge`,
          request_json: {
            conflict_resolution: { accept_incoming_target_keys: ["drive_item:docs/weekly-report.md"] }
          }
        }
      }
    ]
  };
}

function fakeClient(conflicts: ProposalConflict[] = []): WorkHubApiClient {
  return {
    pages: {
      async proposal() {
        return proposalVm;
      }
    },
    async listWorkItemConflicts(workItemId: string) {
      const filtered = conflicts.filter((conflict) => conflict.work_item_id === workItemId);
      return filtered.length > 0 ? { conflicts: filtered } : { conflicts: filtered, empty_state: "no_conflicts" as const };
    },
    async replayAgentRun() {
      return replayVm;
    }
  } as unknown as WorkHubApiClient;
}

test("web route-render renders proposal detail through the typed client", async () => {
  assert.equal((await renderWebProposalDetail(fakeClient(), "proposal")).surface, "web");
  assert.equal((await renderWebProposalDetail(fakeClient(), "proposal")).html.includes("这次改了什么"), true);
  assert.equal((await renderWebProposalDetail(fakeClient(), "proposal", "en-US")).html.includes("What changed"), true);

  const renderedConflict = await renderWebProposalDetail(fakeClient([proposalConflict("work", "proposal")]), "proposal");
  assert.equal(renderedConflict.conflictCount, 1);
  assert.equal(renderedConflict.html.includes("data-proposal-conflicts=\"1\""), true);
  assert.equal(renderedConflict.html.includes("data-conflict-option-id=\"accept_incoming\""), true);
});

test("web route-render renders agent run replay through the typed client", async () => {
  assert.equal((await loadWebAgentRunReplay(fakeClient(), "run")).run.handoff_md, "AI 完成了草稿生成。");
  assert.equal((await renderWebAgentRunReplay(fakeClient(), "run")).html.includes("查看 AI 怎么做的"), true);
  assert.equal((await renderWebAgentRunReplay(fakeClient(), "run", "en-US")).html.includes("See how AI did it"), true);
});
