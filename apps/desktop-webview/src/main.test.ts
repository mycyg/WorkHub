import assert from "node:assert/strict";
import test from "node:test";

import type { WorkHubApiClient } from "@workhub/api-client";
import { eventTypes, type GoldPathSurfaceVM, type WorkHubEvent } from "@workhub/contracts";

import {
  desktopCuuCardFromEvent,
  desktopWebviewSurface,
  loadDesktopProposalCuuCard,
  loadDesktopGoldPathSurface,
  renderDesktopGoldPathSurface,
  renderDesktopProposalDetail
} from "./main.js";

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
    async createProposalFromManifest() {
      throw new Error("not needed");
    },
    async listWorkItemProposals() {
      throw new Error("not needed");
    },
    async getProposal() {
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
    async costUsage() {
      throw new Error("not needed");
    },
    async costPolicies() {
      throw new Error("not needed");
    },
    async updateCostPolicy() {
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
        return surface.page_vms.proposal;
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
        proposal_id: "proposal",
        work_item_id: "work",
        title: "周报草稿变更申请",
        status: "opened",
        manifest: {
          version: 0,
          work_item_id: "work",
          title: "周报草稿变更申请",
          summary_md: "新增一份周报草稿。",
          author: { actor_kind: "ai", label: "Cuu" },
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
      },
      replay: {
        run: { handoff_md: "Cuu 完成了草稿生成。" },
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
      },
      cost: {
        generated_at: "2026-06-05T01:00:00.000Z",
        currency: "CNY",
        total_cost_cny: "0.08",
        token_in: 900,
        token_out: 300,
        trend: [],
        by_user: [],
        by_team: [],
        by_workitem: [],
        model_breakdown: [],
        budget: [],
        notices: [],
        top_exhaustion_risks: []
      }
    },
    events: [],
    cuu_states: ["carrying_document"]
  } as unknown as GoldPathSurfaceVM;

  assert.equal(desktopWebviewSurface.pages.includes("/api/pages/gold-path"), true);
  assert.equal(desktopWebviewSurface.cuuCardAdapter, "@workhub/cuu");
  assert.equal(desktopWebviewSurface.rustEventBridge, "push-event -> shell-events -> @workhub/cuu");
  assert.equal((await loadDesktopGoldPathSurface(fakeClient(surface))).fixture_id, "weekly_report_manifest_doc");
  assert.equal((await renderDesktopGoldPathSurface(fakeClient(surface))).surface, "desktop");
  assert.equal((await renderDesktopProposalDetail(fakeClient(surface), "proposal")).surface, "desktop");
  assert.equal((await renderDesktopProposalDetail(fakeClient(surface), "proposal")).html.includes("这次改了什么"), true);
  assert.equal((await loadDesktopProposalCuuCard(fakeClient(surface), "proposal")).state, "carrying_document");
});

test("desktop webview exposes the shared Cuu event adapter for the Rust shell", () => {
  const event: WorkHubEvent<unknown> = {
    event_id: "event-permission",
    type: eventTypes.permissionAsk,
    topic: "user:user",
    ts: "2026-06-05T01:00:00.000Z",
    preview_text: "Cuu 需要你批准这次变更。",
    data: {}
  };

  const card = desktopCuuCardFromEvent(event);

  assert.equal(card.kind, "approval");
  assert.equal(card.state, "asking_approval");
  assert.equal(card.motion.sprite_state, "asking_approval_bounce");
});
