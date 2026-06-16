import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import type { WorkHubApiClient } from "@workhub/api-client";
import { eventTypes, type AgentRunLiveVM, type GoldPathSurfaceVM, type ProposalConflict, type SessionVM, type WorkHubEvent } from "@workhub/contracts";

import {
  loadDesktopAgentRunCuuCard,
  loadDesktopAgentRunReplay,
  loadDesktopAgentRunTrace,
  createDesktopWorkItem,
  createDesktopWorkItemCuuCard,
  desktopCuuCardFromEvent,
  desktopWebviewSurface,
  renderDesktopAgentRunReplay,
  renderDesktopAgentRunLive,
  loadDesktopIntakeCuuCard,
  loadDesktopProposalConflictCuuCards,
  loadDesktopProposalCuuCard,
  loadDesktopGoldPathSurface,
  loadDesktopWorkItemCuuCard,
  renderDesktopIntakeSession,
  renderDesktopGoldPathSurface,
  renderDesktopProposalDetail,
  renderDesktopWorkItemDetail,
  startDesktopAgentRun,
  startDesktopAgentRunCuuCard,
  startDesktopIntakeSession
} from "./main.js";

const intakeSession: SessionVM = {
  session_id: "10000000-0000-4000-8000-000000000201",
  work_item_id: "10000000-0000-4000-8000-000000000202",
  topic: "生成客户周报模板",
  stream_href: "/api/push/stream/session/10000000-0000-4000-8000-000000000201",
  next_question_href: "/api/sessions/10000000-0000-4000-8000-000000000201/next-question",
  question: {
    id: "10000000-0000-4000-8000-000000000203",
    title: "这次周报偏向哪种口吻？",
    body: "选一个方向即可。",
    input_mode: "single_choice",
    options: [
      { id: "brief", label: "简洁版", description: "适合快速同步。" },
      { id: "detailed", label: "详细版", description: "会展开更多证据。" }
    ],
    recommended_option_ids: ["brief"],
    free_text: {
      enabled: true,
      collapsed_by_default: true,
      placeholder: "确实需要时再补一句。",
      max_length: 120
    },
    progress: [
      { key: "goal", label: "目标", state: "done" },
      { key: "tone", label: "口吻", state: "active" }
    ],
    evidence_refs: [],
    submit: { method: "POST", href: "/api/sessions/10000000-0000-4000-8000-000000000201/next-question" }
  }
};

const liveRun = {
  run: {
    id: "40000000-0000-4000-8000-000000000025",
    work_item_id: "50000000-0000-4000-8000-000000000021",
    mode: "worker",
    actor: "human",
    status: "running",
    model: "deepseek-v4-flash",
    turns_used: 1,
    max_turns: 15,
    token_in: 10,
    token_out: 20,
    created_at: "2026-06-05T01:00:00.000Z",
    updated_at: "2026-06-05T01:00:01.000Z"
  },
  run_id: "40000000-0000-4000-8000-000000000025",
  work_item_id: "50000000-0000-4000-8000-000000000021",
  title: "生成客户周报模板",
  status: "running",
  budget: { max_steps: 15, total_timeout_s: 300, max_tokens: 120000, max_cost_cny: "5" },
  budget_decision: {
    decision_id: "decision-run",
    allowed: true,
    model_route: { provider: "deepseek", model: "deepseek-v4-flash", reason: "default" }
  },
  usage: { steps_used: 1, token_in: 10, token_out: 20, estimated_cost_cny: "0.003" },
  trace: [
    {
      id: "60000000-0000-4000-8000-000000000001",
      agent_run_id: "40000000-0000-4000-8000-000000000025",
      step_no: 1,
      phase: "think",
      input_json: {},
      output_excerpt: "Cuu 正在读取项目文档。",
      created_at: "2026-06-05T01:00:01.000Z"
    }
  ],
  stream_href: "/api/push/stream/run/40000000-0000-4000-8000-000000000025",
  replay_href: "/api/agent-runs/40000000-0000-4000-8000-000000000025/replay"
} satisfies AgentRunLiveVM;

function fakeClient(surface: GoldPathSurfaceVM, session: SessionVM = intakeSession): WorkHubApiClient {
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
    async logout() {
      return { ok: true };
    },
    async me() {
      throw new Error("not needed");
    },
    async updatePreferences() {
      throw new Error("not needed");
    },
    async notifications() {
      throw new Error("not needed");
    },
    async markNotificationRead() {
      throw new Error("not needed");
    },
    async markAllNotificationsRead() {
      throw new Error("not needed");
    },
    async dismissNotification() {
      throw new Error("not needed");
    },
    async completeNotification() {
      throw new Error("not needed");
    },
    async bootstrapProject() {
      return {
        project: {
          id: "50000000-0000-4000-8000-000000000030",
          workspace_id: "50000000-0000-4000-8000-000000000031",
          name: "Day 0 Pilot Project",
          slug: "day0-pilot",
          owner_nickname: "tester",
          owner_user_id: "50000000-0000-4000-8000-000000000032"
        },
        created: true,
        context_ready: true
      };
    },
    async createSession() {
      return session;
    },
    async getSession() {
      return session;
    },
    async createWorkItem() {
      return surface.page_vms.workitem;
    },
    async startAgentRun() {
      return liveRun;
    },
    async getAgentRun() {
      return liveRun;
    },
    async getAgentRunTrace() {
      return liveRun.trace;
    },
    async abortAgentRun() {
      return { ...liveRun, status: "cancelled", run: { ...liveRun.run, status: "cancelled" } };
    },
    async getAgentRunHandoff() {
      return null;
    },
    async respondApproval() {
      throw new Error("not needed");
    },
    async delegateApproval() {
      throw new Error("not needed");
    },
    async listApprovalComments() {
      throw new Error("not needed");
    },
    async postApprovalComment() {
      throw new Error("not needed");
    },
    async createProposalFromManifest() {
      throw new Error("not needed");
    },
    async listWorkItemProposals() {
      throw new Error("not needed");
    },
    async listWorkItemConflicts(workItemId: string) {
      const conflicts = ((surface as unknown as { conflicts?: ProposalConflict[] }).conflicts ?? []).filter(
        (conflict) => conflict.work_item_id === workItemId
      );
      return conflicts.length > 0 ? { conflicts } : { conflicts, empty_state: "no_conflicts" as const };
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
    async rebaseProposal() {
      throw new Error("not needed");
    },
    async chooseMergeProposalCandidate() {
      throw new Error("not needed");
    },
    async applyMergeProposalCandidate() {
      throw new Error("not needed");
    },
    async restoreAcceptedDeliverable() {
      throw new Error("not needed");
    },
    async uploadDriveFile() {
      throw new Error("not needed");
    },
    async deleteDriveItem() {
      throw new Error("not needed");
    },
    async restoreDriveItem() {
      throw new Error("not needed");
    },
    async createDriveCommentDraft() {
      throw new Error("not needed");
    },
    async createDriveDraftProposal() {
      throw new Error("not needed");
    },
    async createMeetingInsightDraft() {
      throw new Error("not needed");
    },
    async dismissMeetingInsight() {
      throw new Error("not needed");
    },
    async createMeetingDraftProposal() {
      throw new Error("not needed");
    },
    async nextQuestion() {
      throw new Error("not needed");
    },
    async searchKnowledge() {
      throw new Error("not needed");
    },
    async useEvidenceForWorkItem() {
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
    async pilotDay1Metrics() {
      throw new Error("not needed");
    },
    async listProjects() {
      throw new Error("not needed");
    },
    async replayAgentRun() {
      return surface.page_vms.replay;
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
      async skills() {
        throw new Error("not needed");
      },
      async settings() {
        throw new Error("not needed");
      },
      async goldPath() {
        return surface;
      },
      async drive() {
        throw new Error("not needed");
      },
      async meetings() {
        throw new Error("not needed");
      },
      async projectHealth() {
        throw new Error("not needed");
      },
      async notifications() {
        throw new Error("not needed");
      },
      async calendar() {
        throw new Error("not needed");
      },
      async workItem() {
        return surface.page_vms.workitem;
      },
      async proposal() {
        return surface.page_vms.proposal;
      }
    },
    streams: {
      all: () => "/api/push/stream",
      me: () => "/api/push/stream/me",
      workItem: (id) => `/api/push/stream/workitem/${id}`,
      run: (id) => `/api/push/stream/run/${id}`,
      session: (id) => `/api/push/stream/session/${id}`,
      proposal: (id) => `/api/push/stream/proposal/${id}`
    },
    streamUrl: (path) => path,
    async request() {
      throw new Error("not needed");
    }
  };
}

function proposalConflict(workItemId: string, proposalId: string): ProposalConflict {
  return {
    id: "conflict-weekly-report",
    work_item_id: workItemId,
    proposal_id: proposalId,
    change_id: "10000000-0000-4000-8000-000000000502",
    target_key: "drive_item:docs/weekly-report.md",
    target_kind: "text_doc",
    change_type: "updated",
    target_path: "docs/weekly-report.md",
    headline: "weekly-report.md 已经被另一份变更更新",
    summary_text: "正式版和这次版本都改了同一个文档，先选保留正式版还是采纳这次版本。",
    existing: {
      proposal_id: "10000000-0000-4000-8000-000000000511",
      change_id: "10000000-0000-4000-8000-000000000512",
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
      cost: "/dashboard/cost",
      knowledge: "/knowledge/search"
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
        acceptance: [{ title: "确认 file-only 范围", status: "met" }],
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
  assert.equal(desktopWebviewSurface.pages.includes("/api/pages/drive"), true);
  assert.equal(desktopWebviewSurface.pages.includes("/api/drive/workitems/:workItemId/proposal-draft"), true);
  assert.equal(desktopWebviewSurface.pages.includes("/settings"), true);
  assert.equal(desktopWebviewSurface.cuuCardAdapter, "@workhub/cuu");
  assert.equal(desktopWebviewSurface.rustEventBridge, "push-event -> shell-events -> @workhub/cuu");
  assert.equal((await loadDesktopGoldPathSurface(fakeClient(surface))).fixture_id, "weekly_report_manifest_doc");
  assert.equal((await renderDesktopGoldPathSurface(fakeClient(surface))).surface, "desktop");
  assert.equal((await renderDesktopGoldPathSurface(fakeClient(surface), "en-US")).pages[0]?.html.includes("Needs your decision"), true);
  assert.equal((await renderDesktopWorkItemDetail(fakeClient(surface), "work")).surface, "desktop");
  assert.equal((await renderDesktopWorkItemDetail(fakeClient(surface), "work")).html.includes("wh-desktop"), true);
  assert.equal((await renderDesktopWorkItemDetail(fakeClient(surface), "work", "en-US")).html.includes("Live AI work"), true);
  assert.equal((await renderDesktopProposalDetail(fakeClient(surface), "proposal")).surface, "desktop");
  assert.equal((await renderDesktopProposalDetail(fakeClient(surface), "proposal")).html.includes("这次改了什么"), true);
  assert.equal((await renderDesktopProposalDetail(fakeClient(surface), "proposal", "en-US")).html.includes("What changed"), true);
  assert.equal((await loadDesktopAgentRunReplay(fakeClient(surface), "run")).run.handoff_md, "Cuu 完成了草稿生成。");
  assert.equal((await renderDesktopAgentRunReplay(fakeClient(surface), "run")).html.includes("查看 AI 怎么做的"), true);
  assert.equal((await renderDesktopAgentRunReplay(fakeClient(surface), "run", "en-US")).html.includes("See how AI did it"), true);
  assert.equal((await loadDesktopWorkItemCuuCard(fakeClient(surface), "work")).state, "carrying_document");
  assert.equal((await loadDesktopProposalCuuCard(fakeClient(surface), "proposal")).state, "carrying_document");

  const conflictSurface = {
    ...(surface as unknown as object),
    conflicts: [proposalConflict("work", "proposal")]
  } as GoldPathSurfaceVM & { conflicts: ProposalConflict[] };
  const renderedConflict = await renderDesktopProposalDetail(fakeClient(conflictSurface), "proposal");
  const conflictCards = await loadDesktopProposalConflictCuuCards(fakeClient(conflictSurface), "proposal");
  assert.equal(desktopWebviewSurface.pages.includes("/api/workitems/:id/conflicts"), true);
  assert.equal(renderedConflict.conflictCount, 1);
  assert.equal(renderedConflict.html.includes("data-conflict-option-id=\"accept_incoming\""), true);
  assert.equal(conflictCards[0]?.payload_ref?.entity_type, "proposal_conflict");
  assert.equal(conflictCards[0]?.actions.find((action) => action.id === "accept_incoming")?.payload !== undefined, true);
});

test("desktop webview catalog exposes settings APIs while Rust owns local capabilities", () => {
  assert.equal(desktopWebviewSurface.pages.includes("/api/auth/me"), true);
  assert.equal(desktopWebviewSurface.pages.includes("/api/auth/preferences"), true);
  assert.equal(desktopWebviewSurface.pages.includes("/api/pages/settings"), true);
  assert.equal(desktopWebviewSurface.pages.includes("/settings"), true);
  assert.deepEqual(desktopWebviewSurface.rustOwns, ["device_token", "tray", "deep_link", "local_sync", "system_notification"]);
  const catalog = desktopWebviewSurface.pages.join("\n");
  assert.equal(/device_token|tray|deep_link|local_sync|system_notification/u.test(catalog), false);
});

test("desktop webview starts option-first intake sessions through the typed client", async () => {
  const surface = { page_vms: { proposal: {} } } as unknown as GoldPathSurfaceVM;
  const client = fakeClient(surface);
  const session = await startDesktopIntakeSession(client, { intent_text: "帮我整理客户周报" });
  const rendered = await renderDesktopIntakeSession(client, { intent_text: "帮我整理客户周报" });
  const card = await loadDesktopIntakeCuuCard(client, { intent_text: "帮我整理客户周报" });

  assert.equal(desktopWebviewSurface.pages.includes("/api/sessions"), true);
  assert.equal(desktopWebviewSurface.pages.includes("/api/sessions/:id"), true);
  assert.equal(desktopWebviewSurface.pages.includes("/intake/:sessionId"), true);
  assert.equal(desktopWebviewSurface.pages.includes("/api/knowledge/search"), true);
  assert.equal(desktopWebviewSurface.pages.includes("/knowledge/search"), true);
  assert.equal(session.session_id, intakeSession.session_id);
  assert.equal(rendered.surface, "desktop");
  assert.equal(rendered.route, `/intake/${intakeSession.session_id}`);
  assert.equal(rendered.html.includes("wh-desktop"), true);
  assert.equal(rendered.html.includes("简洁版"), true);
  assert.equal((await renderDesktopIntakeSession(client, { intent_text: "帮我整理客户周报" }, "en-US")).html.includes("AI recommended"), true);
  assert.equal(card.kind, "question");
  assert.equal(card.payload_ref?.entity_type, "session");
  assert.equal(card.input?.free_text_collapsed_by_default, true);
});

test("desktop webview creates work items through the typed client and maps the result to Cuu", async () => {
  const surface = {
    page_vms: {
      workitem: {
        workitem: {
          id: "work",
          code: "WH-001",
          title: "生成周报草稿",
          status: "ai_working",
          summary_md: "Cuu 已开始处理。"
        },
        acceptance: [{ title: "绑定证据", status: "open" }],
        agent_trace_preview: [{ agent_run_id: "run", step_no: 1, phase: "think", output_excerpt: "准备读取证据。" }],
        evidence_refs: []
      },
      proposal: {}
    }
  } as unknown as GoldPathSurfaceVM;
  const client = fakeClient(surface);
  const created = await createDesktopWorkItem(client, { session_id: "10000000-0000-4000-8000-000000000201" });
  const card = await createDesktopWorkItemCuuCard(client, { session_id: "10000000-0000-4000-8000-000000000201" });

  assert.equal(desktopWebviewSurface.pages.includes("/api/workitems"), true);
  assert.equal(created.workitem.status, "ai_working");
  assert.equal(card.kind, "trace");
  assert.equal(card.state, "thinking");
});

test("desktop webview starts agent runs and renders the live trace with Cuu state", async () => {
  const surface = { page_vms: { workitem: {}, proposal: {} } } as unknown as GoldPathSurfaceVM;
  const client = fakeClient(surface);
  const started = await startDesktopAgentRun(client, liveRun.work_item_id, { title: "生成客户周报模板" });
  const rendered = await renderDesktopAgentRunLive(client, liveRun.run_id);
  const english = await renderDesktopAgentRunLive(client, liveRun.run_id, "en-US");
  const trace = await loadDesktopAgentRunTrace(client, liveRun.run_id, 0);
  const startedCard = await startDesktopAgentRunCuuCard(client, liveRun.work_item_id, { title: "生成客户周报模板" });
  const loadedCard = await loadDesktopAgentRunCuuCard(client, liveRun.run_id);

  assert.equal(desktopWebviewSurface.pages.includes("/api/workitems/:id/agent-runs"), true);
  assert.equal(desktopWebviewSurface.pages.includes("/api/agent-runs/:id/trace"), true);
  assert.equal(started.run_id, liveRun.run_id);
  assert.equal(rendered.cuuState, "thinking");
  assert.equal(rendered.html.includes("wh-desktop"), true);
  assert.equal(english.html.includes("Live AI work"), true);
  assert.equal(english.html.includes("Cancel run"), true);
  assert.equal(trace[0]?.phase, "think");
  assert.equal(startedCard.kind, "trace");
  assert.equal(loadedCard.state, "thinking");
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

test("R4.21 desktop browser uses the shared web runtime helpers", () => {
  const source = readFileSync(new URL("./browser.ts", import.meta.url), "utf8");

  assert.match(source, /@workhub\/web-runtime/u);
  assert.match(source, /bindRouteLineEditor\(root\)/u);
  assert.match(source, /actionElementMergePayload/u);
  assert.match(source, /showRouteNotice\(shellRoot, reasonRequiredNotice/u);
  assert.doesNotMatch(source, /function proposalActionFromHref/u);
  assert.doesNotMatch(source, /function conflictsFromMergeError/u);
  assert.doesNotMatch(source, /function updateLineEditorPanelPayload/u);
});
