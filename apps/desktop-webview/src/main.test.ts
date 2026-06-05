import assert from "node:assert/strict";
import test from "node:test";

import type { WorkHubApiClient } from "@workhub/api-client";
import type { GoldPathSurfaceVM } from "@workhub/contracts";

import { desktopWebviewSurface, loadDesktopGoldPathSurface, renderDesktopGoldPathSurface } from "./main.js";

function fakeClient(surface: GoldPathSurfaceVM): WorkHubApiClient {
  return {
    async health() {
      throw new Error("not needed");
    },
    async openapi() {
      throw new Error("not needed");
    },
    async identify() {
      throw new Error("not needed");
    },
    async me() {
      throw new Error("not needed");
    },
    async notifications() {
      throw new Error("not needed");
    },
    async respondApproval() {
      throw new Error("not needed");
    },
    async reviewProposal() {
      throw new Error("not needed");
    },
    async mergeProposal() {
      throw new Error("not needed");
    },
    async nextQuestion() {
      throw new Error("not needed");
    },
    async searchKnowledge() {
      throw new Error("not needed");
    },
    async replayAgentRun() {
      throw new Error("not needed");
    },
    pages: {
      async attention() {
        throw new Error("not needed");
      },
      async approvals() {
        throw new Error("not needed");
      },
      async cost() {
        throw new Error("not needed");
      },
      async goldPath() {
        return surface;
      },
      async workItem() {
        throw new Error("not needed");
      },
      async proposal() {
        throw new Error("not needed");
      }
    },
    streamUrl: (path) => path,
    async request() {
      throw new Error("not needed");
    }
  };
}

test("desktop webview surface advertises and loads the shared P0.5 gold path page VM", async () => {
  const surface = {
    fixture_id: "weekly_report_manifest_doc",
    routes: {
      home: "/",
      intake: "/intake/session",
      approvals: "/approvals",
      workitem: "/workitems/work",
      proposal: "/proposals/proposal",
      replay: "/agent-runs/run/replay",
      cost: "/dashboard/cost"
    },
    page_vms: {
      attention: {
        cuu_state: "carrying_document",
        primary: {
          title: "确认周报变更申请",
          summary_text: "Cuu 已整理好一份 file-only 交付物。",
          reason_text: "只需要点选批准或要求修改。",
          actions: [{ id: "review", label: "查看申请", href: "/proposals/proposal" }],
          evidence_refs: []
        },
        background_runs: [{ preview_text: "正在等待你的确认。" }]
      },
      question: {
        title: "这次周报偏向哪种口吻？",
        body: "选一个方向即可。",
        options: [{ id: "brief", label: "简洁版", description: "更适合快速同步。" }],
        recommended_option_ids: ["brief"],
        progress: [{ id: "tone", label: "口吻", state: "done" }],
        free_text: { collapsed_by_default: true, placeholder: "需要时再补一句。" },
        evidence_refs: [],
        submit: { id: "continue", label: "继续", href: "/intake/session/continue" }
      },
      evidence: { query: "weekly report", results: [] },
      approvals: {
        items: [
          {
            id: "approval",
            kind: "approval",
            priority: "high",
            source_ref: { entity_type: "approval_request", entity_id: "approval" },
            title: "Cuu 等你审批周报草稿",
            summary_text: "点同意后才进入正式交付。",
            reason_text: "打回必须写原因，Cuu 会继续改。",
            actions: [
              { id: "approve", label: "同意", style: "primary", method: "POST", href: "/api/approvals/approval/respond" },
              {
                id: "deny",
                label: "打回",
                style: "danger",
                method: "POST",
                href: "/api/approvals/approval/respond",
                requires_reason: true
              }
            ],
            cuu_state: "asking_approval",
            created_at: "2026-06-05T01:00:00.000Z"
          }
        ],
        requests: [
          {
            id: "approval",
            action_pattern: "proposal.review.weekly_report",
            payload_json: {},
            status: "pending",
            routed_to_user_id: "user",
            created_at: "2026-06-05T01:00:00.000Z",
            updated_at: "2026-06-05T01:00:00.000Z"
          }
        ],
        filters: { pending: true },
        counts: { pending: 1, all: 1 }
      },
      workitem: {
        workitem: {
          id: "work",
          code: "WH-001",
          title: "生成周报草稿",
          status: "needs_review",
          summary_md: "准备一份周报草稿。"
        },
        latest_proposal: { title: "周报草稿变更申请" },
        agent_trace_preview: [{ step_no: 1, phase: "plan", output_excerpt: "确认 file-only 范围。" }],
        evidence_refs: []
      },
      proposal: {
        title: "周报草稿变更申请",
        manifest: {
          summary_md: "新增一份周报草稿。",
          risk: { human_label: "低风险" },
          rollback: { description: "删除生成草稿即可回滚。" },
          evidence_refs: [],
          changes: [
            {
              human_summary: "新增 weekly-report.md",
              target_kind: "file",
              target_ref: { path: "docs/weekly-report.md" }
            }
          ],
          checks: [{ label: "范围检查", status: "pass", detail: "仅文件改动。" }]
        },
        review_actions: {
          approve: { id: "approve", label: "批准", href: "/approvals/approve" },
          request_changes: {
            id: "changes",
            label: "要求修改",
            href: "/approvals/changes",
            requires_reason: true
          }
        },
        evidence_refs: []
      },
      replay: {
        run: { handoff_md: "Cuu 完成了草稿生成。" },
        steps: [
          { step_no: 1, phase: "plan", output_excerpt: "列出章节。" },
          { step_no: 2, phase: "draft", output_excerpt: "生成草稿。" }
        ],
        cost: {
          me: { total_tokens: 1200, estimated_cost_cny: "0.08", warning_ratio: 0.12 },
          active_notices: []
        },
        snapshots: [],
        evidence_refs: []
      },
      cost: {
        total_cost: { me: { total_tokens: 1200, estimated_cost_cny: "0.08", warning_ratio: 0.12 } },
        notices: []
      }
    },
    events: [],
    cuu_states: ["carrying_document"]
  } as unknown as GoldPathSurfaceVM;

  assert.equal(desktopWebviewSurface.pages.includes("/api/pages/gold-path"), true);
  assert.equal((await loadDesktopGoldPathSurface(fakeClient(surface))).fixture_id, "weekly_report_manifest_doc");
  assert.equal((await renderDesktopGoldPathSurface(fakeClient(surface))).surface, "desktop");
});
