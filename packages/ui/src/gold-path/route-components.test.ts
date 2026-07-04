import assert from "node:assert/strict";
import test from "node:test";

import { createP05GoldPathFixture, validateP05GoldPathFixture } from "@workhub/agent/fixtures";
import type { AgentArmyDashboardVM, AttentionItem, CalendarPageVM, DrivePageVM, ProjectHealthPageVM, EvidenceBubble, GoldPathSurfaceVM, MeetingPageVM, NotificationPageVM, ProjectListVM, ProposalConflict, SessionVM, SettingsPageVM, WorkItemDetailVM } from "@workhub/contracts";

import { renderAgentRunReplay } from "../replay/index.js";
import { renderWebRouteComponent, renderWebRouteComponents } from "./route-components.js";
import { renderOnboardingScreen } from "../onboarding.js";
import { renderWebProductShell } from "./product-shell.js";
import { renderGoldPathSurface } from "./render.js";
import {
  createCostReactRouteComponent,
  createHomeReactRouteComponent,
  createProposalReactRouteComponent,
  createReplayReactRouteComponent,
  createSettingsReactRouteComponent
} from "./route-react-components.js";

function drivePageVm(): DrivePageVM {
  return {
    generated_at: "2026-06-11T09:00:00.000Z",
    project: {
      id: "94000000-0000-4000-8000-000000000001",
      name: "R5 Workspace",
      slug: "r5-workspace",
      owner_label: "owner",
      status: "active"
    },
    summary: {
      item_count: 2,
      file_count: 2,
      folder_count: 0,
      deleted_item_count: 1,
      version_count: 2,
      accepted_deliverable_count: 1,
      pending_comment_count: 1,
      operation_count: 1
    },
    can_manage: true,
    selected_item_id: "94000000-0000-4000-8000-000000000002",
    items: [
      {
        id: "94000000-0000-4000-8000-000000000002",
        project_id: "94000000-0000-4000-8000-000000000001",
        name: "client-review.md",
        kind: "file",
        path: "/deliverables/client-review.md",
        depth: 1,
        current_version_id: "94000000-0000-4000-8000-000000000003",
        children_count: 0,
        updated_at: "2026-06-11T09:00:00.000Z"
      },
      {
        id: "94000000-0000-4000-8000-000000000009",
        project_id: "94000000-0000-4000-8000-000000000001",
        name: "manual-note.md",
        kind: "file",
        path: "/manual-note.md",
        depth: 0,
        current_version_id: "94000000-0000-4000-8000-000000000010",
        preview_href: "/api/drive/projects/94000000-0000-4000-8000-000000000001/items/94000000-0000-4000-8000-000000000009/preview",
        download_href: "/api/drive/projects/94000000-0000-4000-8000-000000000001/items/94000000-0000-4000-8000-000000000009/download",
        delete_href: "/api/drive/projects/94000000-0000-4000-8000-000000000001/items/94000000-0000-4000-8000-000000000009/delete",
        children_count: 0,
        updated_at: "2026-06-11T09:00:00.000Z"
      }
    ],
    versions: [
      {
        id: "94000000-0000-4000-8000-000000000003",
        item_id: "94000000-0000-4000-8000-000000000002",
        version_no: 2,
        filename: "client-review.md",
        mime: "text/markdown",
        size_bytes: 2048,
        sha256: "a".repeat(64),
        created_at: "2026-06-11T09:00:00.000Z",
        current: true,
        source: "accepted_deliverable",
        accepted_deliverable_id: "94000000-0000-4000-8000-000000000004",
        work_item_id: "94000000-0000-4000-8000-000000000005",
        proposal_id: "94000000-0000-4000-8000-000000000006",
        preview_href: "/api/workitems/94000000-0000-4000-8000-000000000005/deliverables/94000000-0000-4000-8000-000000000004/preview",
        download_href: "/api/workitems/94000000-0000-4000-8000-000000000005/deliverables/94000000-0000-4000-8000-000000000004/download",
        restore_href: "/api/workitems/94000000-0000-4000-8000-000000000005/deliverables/94000000-0000-4000-8000-000000000004/restore"
      },
      {
        id: "94000000-0000-4000-8000-000000000010",
        item_id: "94000000-0000-4000-8000-000000000009",
        version_no: 1,
        filename: "manual-note.md",
        mime: "text/markdown",
        size_bytes: 128,
        created_at: "2026-06-11T09:00:00.000Z",
        current: true,
        source: "manual_upload"
      }
    ],
    accepted_deliverables: [
      {
        id: "94000000-0000-4000-8000-000000000004",
        work_item_id: "94000000-0000-4000-8000-000000000005",
        proposal_id: "94000000-0000-4000-8000-000000000006",
        change_id: "94000000-0000-4000-8000-000000000007",
        target_kind: "text_doc",
        target_key: "drive:/deliverables/client-review.md",
        change_type: "updated",
        accepted_version: 2,
        target_path: "/deliverables/client-review.md",
        drive_item_id: "94000000-0000-4000-8000-000000000002",
        drive_version_id: "94000000-0000-4000-8000-000000000003",
        filename: "client-review.md",
        mime: "text/markdown",
        size_bytes: 2048,
        preview_href: "/api/workitems/94000000-0000-4000-8000-000000000005/deliverables/94000000-0000-4000-8000-000000000004/preview",
        download_href: "/api/workitems/94000000-0000-4000-8000-000000000005/deliverables/94000000-0000-4000-8000-000000000004/download",
        restore_href: "/api/workitems/94000000-0000-4000-8000-000000000005/deliverables/94000000-0000-4000-8000-000000000004/restore",
        accepted_at: "2026-06-11T09:00:00.000Z"
      }
    ],
    deleted_items: [
      {
        id: "94000000-0000-4000-8000-000000000011",
        project_id: "94000000-0000-4000-8000-000000000001",
        name: "old-note.md",
        kind: "file",
        path: "/old-note.md",
        depth: 0,
        children_count: 0,
        deleted_at: "2026-06-11T08:00:00.000Z",
        restore_href: "/api/drive/projects/94000000-0000-4000-8000-000000000001/items/94000000-0000-4000-8000-000000000011/restore",
        updated_at: "2026-06-11T08:00:00.000Z"
      }
    ],
    comments: [
      {
        id: "94000000-0000-4000-8000-000000000008",
        project_id: "94000000-0000-4000-8000-000000000001",
        author_label: "PM",
        body: "Turn this into a follow-up draft.",
        status: "proposal_created",
        created_at: "2026-06-11T09:00:00.000Z",
        draft_work_item_id: "94000000-0000-4000-8000-000000000005",
        draft_href: "/workitems/94000000-0000-4000-8000-000000000005",
        proposal_id: "94000000-0000-4000-8000-000000000006",
        proposal_href: "/proposals/94000000-0000-4000-8000-000000000006",
        proposal_status: "opened"
      },
      {
        id: "94000000-0000-4000-8000-000000000014",
        project_id: "94000000-0000-4000-8000-000000000001",
        author_label: "PM",
        body: "Create a safe follow-up draft from this change note.",
        status: "pending_llm",
        created_at: "2026-06-11T09:01:00.000Z",
        draft_action: {
          id: "drive_comment_to_draft",
          label: "Create draft",
          method: "POST",
          href: "/api/drive/projects/94000000-0000-4000-8000-000000000001/comments/94000000-0000-4000-8000-000000000014/draft"
        }
      }
    ],
    operations: [
      {
        id: "94000000-0000-4000-8000-000000000012",
        project_id: "94000000-0000-4000-8000-000000000001",
        actor_user_id: "94000000-0000-4000-8000-000000000013",
        op_type: "upload_file",
        target_item_id: "94000000-0000-4000-8000-000000000009",
        target_path: "/manual-note.md",
        summary_text: "Uploaded /manual-note.md",
        created_at: "2026-06-11T09:00:00.000Z"
      }
    ],
    actions: {
      upload_file: {
        id: "drive_upload_file",
        label: "Upload file",
        method: "POST",
        href: "/api/drive/projects/94000000-0000-4000-8000-000000000001/files"
      },
      delete_item: {
        id: "drive_delete_item",
        label: "Move to recycle",
        method: "POST",
        href: "/api/drive/projects/94000000-0000-4000-8000-000000000001/items/94000000-0000-4000-8000-000000000009/delete"
      },
      restore_item: {
        id: "drive_restore_item",
        label: "Restore item",
        method: "POST",
        href: "/api/drive/projects/94000000-0000-4000-8000-000000000001/items/94000000-0000-4000-8000-000000000011/restore"
      }
    }
  };
}

function homeProjectListVm(): ProjectListVM {
  return {
    generated_at: "2026-06-11T09:00:00.000Z",
    projects: [
      {
        id: "93000000-0000-4000-8000-000000000001",
        name: "R5 Workspace",
        slug: "r5-workspace",
        description: "Pilot delivery workspace",
        owner_nickname: "owner",
        archived: false,
        created_at: "2026-06-11T08:00:00.000Z",
        updated_at: "2026-06-11T09:00:00.000Z",
        open_work_item_count: 3
      }
    ]
  };
}

function meetingPageVm(): MeetingPageVM {
  return {
    generated_at: "2026-06-11T09:30:00.000Z",
    project: {
      id: "95000000-0000-4000-8000-000000000001",
      name: "R5 Meeting Workspace",
      slug: "r5-meeting-workspace",
      owner_label: "owner",
      status: "active"
    },
    summary: {
      meeting_count: 1,
      ready_count: 1,
      pending_insight_count: 1,
      confirmed_insight_count: 0,
      dismissed_insight_count: 0
    },
    can_manage: true,
    selected_meeting_id: "95000000-0000-4000-8000-000000000002",
    meetings: [
      {
        id: "95000000-0000-4000-8000-000000000002",
        project_id: "95000000-0000-4000-8000-000000000001",
        uploaded_by_user_id: "95000000-0000-4000-8000-000000000003",
        uploaded_by_label: "PM",
        title: "Q2 Client Proposal Review",
        audio_filename: "q2-review.txt",
        audio_mime: "text/plain",
        audio_size_bytes: 2048,
        transcript_text: "Priya Shah: Update proposal pricing model with tiered usage.",
        minutes_md: "## Summary\n\nPricing and timeline changes need review.",
        status: "ready",
        created_at: "2026-06-11T09:00:00.000Z",
        updated_at: "2026-06-11T09:10:00.000Z",
        insights: [
          {
            id: "95000000-0000-4000-8000-000000000004",
            meeting_id: "95000000-0000-4000-8000-000000000002",
            kind: "requirement_change",
            title: "Update proposal pricing model",
            description: "Create a draft update to the pricing section with tiered usage.",
            confidence_reason: "The meeting explicitly asks Finance to update the model before review.",
            status: "pending",
            created_at: "2026-06-11T09:10:00.000Z",
            evidence_refs: [
              {
                id: "95000000-0000-4000-8000-000000000005",
                source_type: "meeting",
                source_id: "95000000-0000-4000-8000-000000000002",
                title: "Q2 Client Proposal Review",
                excerpt: "Update proposal pricing model with tiered usage.",
                href: "/meetings?project_id=95000000-0000-4000-8000-000000000001&m=95000000-0000-4000-8000-000000000002"
              }
            ],
            actions: {
              create_draft: {
                id: "meeting_insight_to_draft",
                label: "Create draft",
                method: "POST",
                href: "/api/meetings/projects/95000000-0000-4000-8000-000000000001/insights/95000000-0000-4000-8000-000000000004/draft"
              },
              dismiss: {
                id: "meeting_insight_dismiss",
                label: "Dismiss",
                method: "POST",
                href: "/api/meetings/projects/95000000-0000-4000-8000-000000000001/insights/95000000-0000-4000-8000-000000000004/dismiss"
              }
            }
          }
        ]
      }
    ]
  };
}

function notificationPageVm(): NotificationPageVM {
  const needsDecisionItem: NotificationPageVM["items"][number] = {
    id: "96000000-0000-4000-8000-000000000002",
    type: "meeting.insight.pending",
    severity: "high",
    status: "unread",
    inbox_bucket: "needs_decision",
    title: "Meeting insight needs review",
    body: "Q2 review mentions a pricing update.",
    target_href: "/meetings?project_id=95000000-0000-4000-8000-000000000001&m=95000000-0000-4000-8000-000000000002&insight_id=95000000-0000-4000-8000-000000000004",
    project_id: "95000000-0000-4000-8000-000000000001",
    dedupe_key: "meeting_insight:95000000-0000-4000-8000-000000000004",
    source_context: {
      source_type: "meeting_insight",
      meeting_id: "95000000-0000-4000-8000-000000000002",
      insight_id: "95000000-0000-4000-8000-000000000004",
      title: "Update proposal pricing model",
      meeting_title: "Q2 Client Proposal Review",
      insight_status: "pending",
      project_id: "95000000-0000-4000-8000-000000000001",
      project_name: "R5 Meeting Workspace"
    },
    created_at: "2026-06-11T09:30:00.000Z",
    updated_at: "2026-06-11T09:30:00.000Z",
    actions: {
      open: {
        id: "open",
        label: "Open",
        method: "GET",
        href: "/meetings?project_id=95000000-0000-4000-8000-000000000001&m=95000000-0000-4000-8000-000000000002&insight_id=95000000-0000-4000-8000-000000000004"
      },
      mark_read: {
        id: "notification_mark_read",
        label: "Mark as read",
        method: "POST",
        href: "/api/notifications/96000000-0000-4000-8000-000000000002/read"
      },
      dismiss: {
        id: "notification_dismiss",
        label: "Dismiss",
        method: "POST",
        href: "/api/notifications/96000000-0000-4000-8000-000000000002/dismiss"
      },
      complete: {
        id: "notification_complete",
        label: "Complete",
        method: "POST",
        href: "/api/notifications/96000000-0000-4000-8000-000000000002/complete"
      }
    }
  };
  const doneItem: NotificationPageVM["items"][number] = {
    id: "96000000-0000-4000-8000-000000000003",
    type: "workitem.merged",
    severity: "normal",
    status: "done",
    inbox_bucket: "done",
    title: "Proposal merged",
    target_href: "/workitems/96000000-0000-4000-8000-000000000004",
    work_item_id: "96000000-0000-4000-8000-000000000004",
    source_context: {
      source_type: "work_item",
      work_item_id: "96000000-0000-4000-8000-000000000004",
      code: "WH-4",
      title: "Proposal merged",
      status: "merged"
    },
    archived_at: "2026-06-11T09:40:00.000Z",
    created_at: "2026-06-11T09:00:00.000Z",
    updated_at: "2026-06-11T09:40:00.000Z",
    actions: {}
  };

  return {
    generated_at: "2026-06-11T10:00:00.000Z",
    actor_user_id: "96000000-0000-4000-8000-000000000001",
    summary: {
      total_count: 2,
      unread_count: 1,
      needs_decision_count: 1,
      fyi_count: 0,
      done_count: 1,
      urgent_count: 1
    },
    buckets: {
      needs_decision: [needsDecisionItem],
      fyi: [],
      done: [doneItem]
    },
    items: [needsDecisionItem, doneItem],
    actions: {
      mark_all_read: {
        id: "notification_mark_all_read",
        label: "Mark all as read",
        method: "POST",
        href: "/api/notifications/read-all"
      }
    }
  };
}

function calendarPageVm(): CalendarPageVM {
  const dueBlock: CalendarPageVM["blocks"][number] = {
    id: "97000000-0000-4000-8000-000000000001",
    kind: "work_item_due",
    title: "Review proposal pricing",
    description: "Due today for proposal review.",
    ends_at: "2026-06-11T14:00:00.000Z",
    all_day: true,
    status: "today",
    severity: "urgent",
    target_href: "/workitems/97000000-0000-4000-8000-000000000002",
    work_item_id: "97000000-0000-4000-8000-000000000002",
    source_context: {
      source_type: "work_item",
      work_item_id: "97000000-0000-4000-8000-000000000002",
      code: "WH-7",
      title: "Review proposal pricing",
      status: "in_review",
      due_at: "2026-06-11T14:00:00.000Z"
    }
  };
  const meetingBlock: CalendarPageVM["blocks"][number] = {
    id: "97000000-0000-4000-8000-000000000003",
    kind: "meeting_followup",
    title: "Update proposal pricing model",
    description: "Q2 Client Proposal Review",
    ends_at: "2026-06-12T09:00:00.000Z",
    all_day: true,
    status: "upcoming",
    severity: "high",
    target_href: "/meetings?project_id=95000000-0000-4000-8000-000000000001&m=95000000-0000-4000-8000-000000000002",
    project_id: "95000000-0000-4000-8000-000000000001",
    source_context: {
      source_type: "meeting_insight",
      meeting_id: "95000000-0000-4000-8000-000000000002",
      insight_id: "95000000-0000-4000-8000-000000000004",
      title: "Update proposal pricing model",
      meeting_title: "Q2 Client Proposal Review",
      insight_status: "pending"
    }
  };
  return {
    generated_at: "2026-06-11T10:00:00.000Z",
    actor_user_id: "97000000-0000-4000-8000-000000000004",
    scope: {
      date: "2026-06-11",
      view: "week",
      range_start: "2026-06-08T00:00:00.000Z",
      range_end: "2026-06-15T00:00:00.000Z"
    },
    summary: {
      block_count: 2,
      overdue_count: 0,
      today_count: 1,
      week_count: 2
    },
    days: [
      { date: "2026-06-11", blocks: [dueBlock] },
      { date: "2026-06-12", blocks: [meetingBlock] }
    ],
    blocks: [dueBlock, meetingBlock]
  };
}

function settingsVm(locale: "zh-CN" | "en-US" = "zh-CN"): SettingsPageVM {
  return {
    generated_at: "2026-06-11T09:00:00.000Z",
    locale,
    runtime: {
      app_env: "test",
      runtime_status: "ready",
      worker_count: 2,
      broker_backend: "memory",
      broker_configured: true,
      database_configured: true,
      agent_run_lease_ms: 300000,
      agent_run_recovery_interval_ms: 30000
    },
    llm_runtime: {
      default_provider: "deepseek",
      default_model: "deepseek-v4-flash",
      provider_count: 1,
      api_key_configured: true,
      base_url_configured: true,
      secret_safe: true
    },
    budgets: {
      run_tokens: 120000,
      user_daily_tokens: 500000,
      team_daily_tokens: 5000000,
      team_monthly_tokens: 50000000,
      run_cost_cny: "5",
      user_daily_cost_cny: "20",
      team_daily_cost_cny: "200",
      team_monthly_cost_cny: "2000"
    },
    language: {
      active_locale: locale,
      preference_locale: locale,
      preference_source: "server",
      preference_synced: true,
      supported_locales: ["zh-CN", "en-US"],
      storage_key: "workhub.locale",
      update_href: "/api/auth/preferences"
    },
    device: {
      desktop_client: "tauri",
      local_execution_boundary: true,
      independent_pet_window: true,
      pet_model_settings_in_web: false,
      restore_href: "/settings?panel=desktop",
      restore_requires_desktop: true,
      web_local_actions_enabled: false
    }
  };
}

function surfaceVm(): GoldPathSurfaceVM {
  const fixture = validateP05GoldPathFixture(createP05GoldPathFixture());
  return {
    fixture_id: fixture.id,
    routes: {
      home: "/",
      intake: "/intake/r4-route-component-session",
      approvals: "/approvals",
      workitem: "/workitems/r4-route-component-workitem",
      proposal: "/proposals/r4-route-component-proposal",
      replay: "/agent-runs/r4-route-component-run/replay",
      cost: "/dashboard/cost",
      knowledge: "/knowledge/search"
    },
    page_vms: {
      attention: {
        ...fixture.attentionHome,
        primary: fixture.attentionHome.primary
          ? {
            ...fixture.attentionHome.primary,
            title: "R4.10 sentinel decision",
            summary_text: "R4.10 home Page VM summary",
            reason_text: "R4.10 home Page VM reason"
          }
          : undefined,
        background_runs: fixture.attentionHome.background_runs.map((run, index) =>
          index === 0 ? { ...run, title: "R4.10 background run", preview_text: "R4.10 background Page VM preview" } : run
        )
      },
      question: fixture.question,
      evidence: fixture.evidenceBubble,
      approvals: {
        ...fixture.approvalCenter,
        items: fixture.approvalCenter.items.map((item, index) =>
          index === 0 ? { ...item, title: "R4.10 approval sentinel", reason_text: "R4.10 approval Page VM reason" } : item
        )
      },
      workitem: fixture.workItemDetail,
      proposal: fixture.proposalDetail,
      replay: fixture.replay,
      cost: fixture.costDashboard,
      settings: settingsVm()
    },
    events: fixture.events,
    cuu_states: []
  };
}

function agentArmyDashboardVm(overrides: Partial<AgentArmyDashboardVM> = {}): AgentArmyDashboardVM {
  return {
    generated_at: "2026-07-03T00:00:00.000Z",
    kpis: {
      active_team_count: 1,
      waiting_decision_count: 2,
      today_cost_cny: "0.006",
      autonomy_rate_pct: 67
    },
    plans: [{
      plan_id: "96000000-0000-4000-8000-000000000001",
      work_item_id: "96000000-0000-4000-8000-000000000002",
      work_item_code: "DEMO-960",
      work_item_title: "竞品资料梳理",
      work_item_href: "/workitems/96000000-0000-4000-8000-000000000002",
      objective_id: "96000000-0000-4000-8000-000000000003",
      objective_title: "季度上市策略",
      status: "dispatching",
      progress: { completed: 1, total: 2, label: "1/2" },
      roles: [
        { role: "research", count: 1 },
        { role: "review", count: 1 }
      ],
      statuses: [
        { status: "succeeded", count: 1 },
        { status: "needs_human", count: 1 }
      ],
      cost: { used_cny: "0.006", budget_cny: "3.000000", burn_pct: 42 },
      judge: { passed: 1, total: 1, pass_rate_pct: 100 },
      oldest_blocker: {
        kind: "needs_human",
        label: "卡在: 竞品复核 · 2h",
        age_seconds: 7200,
        href: "/attention"
      },
      updated_at: "2026-07-03T00:00:00.000Z"
    }],
    recent_escalations: [{
      id: "96000000-0000-4000-8000-000000000008",
      plan_id: "96000000-0000-4000-8000-000000000001",
      work_item_id: "96000000-0000-4000-8000-000000000002",
      title: "竞品复核需要人判断",
      reason_preview: "证据互相冲突，需要人判断。",
      created_at: "2026-07-02T22:00:00.000Z",
      href: "/attention"
    }],
    page_info: {
      plan_limit: 20,
      returned: 1,
      plans_capped: false,
      items_capped: false,
      runs_capped: false,
      escalation_limit: 5,
      escalation_returned: 1,
      escalations_capped: false
    },
    ...overrides
  };
}

function assertNoMainWindowBoundaryLeak(html: string) {
  assert.equal(html.includes("data-cuu"), false);
  assert.equal(html.includes("./assets/cuu/"), false);
  assert.equal(html.toLowerCase().includes("kanban"), false);
  assert.equal(html.includes('href="#/'), false);
  assert.equal(html.includes("weekly_report_manifest_doc"), false);
}

function structuredProposalConflict(vm: GoldPathSurfaceVM): ProposalConflict {
  const proposal = vm.page_vms.proposal;
  const applyHref = "/api/merge-proposals/10000000-0000-4000-8000-000000000813/apply";
  return {
    id: "r4-13-structured-conflict",
    work_item_id: proposal.work_item_id,
    proposal_id: proposal.proposal_id,
    merge_proposal_id: "10000000-0000-4000-8000-000000000813",
    change_id: proposal.manifest.changes[0]?.id ?? "change-1",
    target_key: `work_item:${proposal.work_item_id}`,
    target_kind: "structured_record",
    change_type: "updated",
    headline: "事项字段需要确认",
    summary_text: "AI 更新了标题和任务项，可以展开高级字段编辑。",
    existing: {
      proposal_id: "10000000-0000-4000-8000-000000000814",
      change_id: "10000000-0000-4000-8000-000000000815",
      ref: "main"
    },
    incoming: { ref: "proposal" },
    recommended_option_id: "ai_fusion",
    options: [
      {
        id: "ai_fusion",
        label: "采用 AI 融合稿",
        summary_text: "AI 已生成字段级补丁。",
        recommended: true,
        quality_gate: {
          structured_record_patch: {
            type: "structured_record_field_patch",
            changed_fields: ["title", "task_items"],
            merged_value_fields: ["title", "task_items"],
            missing_fields: [],
            unknown_fields: [],
            field_count: 2,
            has_structured_result: true,
            task_plan_scope: {
              selected_plan_id: "10000000-0000-4000-8000-000000000818",
              options: [
                {
                  id: "10000000-0000-4000-8000-000000000818",
                  label: "方案拆解计划",
                  stage: "dispatch",
                  status: "draft",
                  item_count: 1,
                  recommended: true
                }
              ]
            },
            structured_field_patch_dry_run: {
              type: "structured_field_patch_dry_run",
              status: "ready",
              executable: true,
              patch: {
                type: "structured_field_patch",
                target_entity_type: "work_item",
                target_entity_id: proposal.work_item_id,
                source: "ai_fusion",
                operations: [
                  {
                    op: "set",
                    target_entity_type: "work_item",
                    target_entity_id: proposal.work_item_id,
                    field: "title",
                    value_type: "string",
                    before_value: "旧标题",
                    current_value: "旧标题",
                    value: "新标题",
                    source: "ai_fusion"
                  },
                  {
                    op: "set",
                    target_entity_type: "work_item",
                    target_entity_id: proposal.work_item_id,
                    field: "task_items",
                    value_type: "json_array",
                    before_value: [
                      { id: "10000000-0000-4000-8000-000000000816", title: "原始任务项", item_type: "task", sort_order: 0 }
                    ],
                    current_value: [
                      { id: "10000000-0000-4000-8000-000000000816", title: "原始任务项", item_type: "task", sort_order: 0 }
                    ],
                    value: [
                      { id: "10000000-0000-4000-8000-000000000816", title: "原始任务项", item_type: "task", sort_order: 0 },
                      { id: "10000000-0000-4000-8000-000000000817", title: "新增风险项", item_type: "risk", sort_order: 1 }
                    ],
                    source: "ai_fusion"
                  }
                ]
              },
              issues: [],
              audit_payload: {
                target_entity_type: "work_item",
                target_entity_id: proposal.work_item_id,
                field_count: 2,
                operation_fields: ["title", "task_items"],
                source: "ai_fusion"
              }
            }
          }
        },
        action: {
          id: "apply_ai_fusion",
          label: "采用 AI 融合稿",
          method: "POST",
          href: applyHref,
          request_json: { confirm: true }
        }
      }
    ]
  };
}

function routeSession(inputMode: SessionVM["question"]["input_mode"] = "single_choice"): SessionVM {
  return {
    session_id: "10000000-0000-4000-8000-000000000901",
    work_item_id: "10000000-0000-4000-8000-000000000902",
    topic: "整理区域周报",
    stream_href: "/api/push/stream/session/10000000-0000-4000-8000-000000000901",
    next_question_href: "/api/sessions/10000000-0000-4000-8000-000000000901/next-question",
    question: {
      id: "10000000-0000-4000-8000-000000000903",
      title: "这次周报先按哪个方向推进？",
      body: "先选一个方向，必要时再补充一句。",
      input_mode: inputMode,
      options: [
        { id: "risk-first", label: "先看风险", description: "聚焦异常区域和阻塞项。" },
        { id: "metric-first", label: "先看指标", description: "聚焦达成率与趋势。" }
      ],
      recommended_option_ids: ["risk-first"],
      free_text: {
        enabled: true,
        collapsed_by_default: true,
        placeholder: "只有选项不够时再补充。",
        max_length: 120
      },
      progress: [
        { key: "goal", label: "目标", state: "done" },
        { key: "scope", label: "范围", state: "active" }
      ],
      evidence_refs: [],
      submit: { method: "POST", href: "/api/sessions/10000000-0000-4000-8000-000000000901/next-question" }
    }
  };
}

function routeEvidenceBubble(): EvidenceBubble {
  return {
    id: "10000000-0000-4000-8000-000000000911",
    query_text: "区域周报",
    summary_text: "找到两条可引用证据，优先使用会议纪要与 Drive 文档。",
    missing_evidence_note: "未找到 CRM 原始明细，不会补造。",
    evidence_refs: [
      {
        id: "10000000-0000-4000-8000-000000000912",
        source_type: "meeting",
        source_id: "weekly-sync",
        title: "区域周会纪要",
        excerpt: "华东区本周主要风险来自供应延迟。",
        href: "/knowledge/sources/weekly-sync"
      },
      {
        id: "10000000-0000-4000-8000-000000000913",
        source_type: "drive_file",
        source_id: "drive:regional-report",
        title: "区域周报草稿",
        excerpt: "指标页包含达成率与重点客户变动。",
        href: "/knowledge/sources/regional-report"
      }
    ],
    actions: [
      {
        id: "use_for_current_task",
        label: "Use in current task",
        method: "POST",
        href: "/api/workitems/10000000-0000-4000-8000-000000000902/evidence-bindings"
      },
      { id: "open_full_search", label: "Open full search", method: "GET", href: "/knowledge/search?q=regional" }
    ]
  };
}

test("R4.10 Home route component renders directly from Attention Page VM with bilingual fixed copy", () => {
  const zh = renderWebRouteComponents(surfaceVm(), { locale: "zh-CN" }).home;
  const en = renderWebRouteComponents(surfaceVm(), { locale: "en-US" }).home;

  assert.ok(zh);
  assert.ok(en);
  assert.equal(zh.html.includes('data-r4-route-component="home"'), true);
  assert.equal(zh.html.includes('data-r4-route-component-source="page-vm"'), true);
  assert.equal(zh.html.includes("R4.10 sentinel decision"), true);
  assert.equal(zh.html.includes("R4.10 background Page VM preview"), true);
  assert.equal(zh.html.includes("需要你决定"), true);
  assert.equal(en.html.includes("Needs your decision"), true);
  assert.equal(en.html.includes('data-r4-route-component-locale="en-US"'), true);
  assertNoMainWindowBoundaryLeak(zh.html);
  assertNoMainWindowBoundaryLeak(en.html);
});

test("Home route leads with a project and drive workspace before the decision queue", () => {
  const vm = surfaceVm();
  const en = renderWebRouteComponent({
    key: "home",
    attention: vm.page_vms.attention,
    projects: homeProjectListVm()
  }, { locale: "en-US" });

  assert.equal(en.html.includes('data-r8-home-project-desk="true"'), true);
  assert.equal(en.html.includes('data-r8-home-project-count="1"'), true);
  assert.equal(en.html.includes('data-r8-home-project="93000000-0000-4000-8000-000000000001"'), true);
  assert.equal(en.html.includes('href="/projects/93000000-0000-4000-8000-000000000001"'), true);
  assert.equal(en.html.includes('href="/drive?project_id=93000000-0000-4000-8000-000000000001"'), true);
  assert.equal(en.html.includes('href="/intake?project_id=93000000-0000-4000-8000-000000000001"'), true);
  assert.ok(en.html.indexOf('data-r8-home-project-desk="true"') < en.html.indexOf('data-r4-home-decision="true"'));
  assertNoMainWindowBoundaryLeak(en.html);
});

test("R9.0 Home route renders escalation cards with human action labels", () => {
  const base = surfaceVm();
  const escalation: AttentionItem = {
    id: "94000000-0000-4000-8000-000000000101",
    kind: "escalation",
    priority: "urgent",
    work_item_id: "94000000-0000-4000-8000-000000000102",
    project_id: "94000000-0000-4000-8000-000000000103",
    source_ref: {
      entity_type: "escalation_event",
      entity_id: "94000000-0000-4000-8000-000000000101"
    },
    title: "《竞品价格调研》卡住了",
    summary_text: "AI 对数据来源不确定。",
    reason_text: "AI 对数据来源不确定。",
    actions: [
      { id: "escalation_retry", label: "让它重试", style: "primary", method: "POST", href: "/api/escalations/94000000-0000-4000-8000-000000000101/resolve" },
      { id: "escalation_pm_mode", label: "转成我来做", style: "secondary", method: "POST", href: "/api/escalations/94000000-0000-4000-8000-000000000101/resolve" },
      { id: "escalation_cancel", label: "取消这个子任务", style: "danger", method: "POST", href: "/api/escalations/94000000-0000-4000-8000-000000000101/resolve" }
    ],
    cuu_state: "worried",
    created_at: "2026-07-02T16:00:00.000Z"
  };
  const home = renderWebRouteComponent({
    key: "home",
    attention: {
      ...base.page_vms.attention,
      primary: escalation,
      queue: [escalation]
    }
  }, { locale: "zh-CN" });

  assert.equal(home.html.includes("《竞品价格调研》卡住了"), true);
  assert.equal(home.html.includes("让它重试"), true);
  assert.equal(home.html.includes("转成我来做"), true);
  assert.equal(home.html.includes("取消这个子任务"), true);
  assert.equal(home.html.includes(">pm_mode<"), false);
  assertNoMainWindowBoundaryLeak(home.html);
});

test("R9.7 approval workbench localizes plan_review attention kind", () => {
  const vm = surfaceVm();
  const first = vm.page_vms.approvals.items[0];
  assert.ok(first);
  vm.page_vms.approvals.items[0] = {
    ...first,
    kind: "plan_review",
    source_ref: { entity_type: "proposal", entity_id: "94000000-0000-4000-8000-000000000111" },
    title: "《短剧选题调研》的分工计划等你过目",
    summary_text: "拆成 4 个子任务，等你确认。"
  };

  const approvals = renderWebRouteComponents(vm, { locale: "zh-CN" }).approvals;

  assert.ok(approvals);
  assert.equal(approvals.html.includes("计划审阅"), true);
  assert.equal(approvals.html.includes("plan_review"), false);
  assert.equal(approvals.html.includes("Plan Review"), false);
  assertNoMainWindowBoundaryLeak(approvals.html);
});

test("Home route surfaces partial source warnings instead of silently showing an empty queue", () => {
  const base = surfaceVm();
  const withWarning = {
    ...base,
    page_vms: {
      ...base.page_vms,
      attention: {
        ...base.page_vms.attention,
        primary: undefined,
        queue: [],
        source_warnings: [{
          source: "approvals" as const,
          message: "审批待办暂时加载失败。请打开审批页或稍后重试。"
        }]
      }
    }
  };

  const zh = renderWebRouteComponents(withWarning, { locale: "zh-CN" }).home;
  assert.ok(zh);
  assert.equal(zh.html.includes('data-r4-home-source-warning="true"'), true);
  assert.equal(zh.html.includes('data-r4-home-source-warning-count="1"'), true);
  assert.equal(zh.html.includes('data-r4-home-source-warning-source="approvals"'), true);
  assert.equal(zh.html.includes("审批待办暂时加载失败"), true);
  assertNoMainWindowBoundaryLeak(zh.html);
});

test("R8 Home worklog banner surfaces today's self-evolution only when skills changed", () => {
  const base = surfaceVm();
  const withEvolution = {
    ...base,
    page_vms: {
      ...base.page_vms,
      attention: {
        ...base.page_vms.attention,
        worklog: {
          runs_today: 3,
          autonomy_rate: 80,
          accepted_today: 2,
          saved_hours_estimate: 1,
          skills_promoted_today: 1,
          skills_refined_today: 2,
          generated_at: "2026-06-16T00:00:00.000Z",
          range_label: "今天"
        }
      }
    }
  };
  const zh = renderWebRouteComponents(withEvolution, { locale: "zh-CN" }).home;
  assert.ok(zh);
  assert.equal(zh.html.includes('data-r4-home-self-evolve="true"'), true);
  assert.equal(zh.html.includes('data-r4-home-skills-promoted="1"'), true);
  assert.equal(zh.html.includes('data-r4-home-skills-refined="2"'), true);
  assert.equal(zh.html.includes("自我精进"), true);
  assertNoMainWindowBoundaryLeak(zh.html);

  // 零自进化 → 不显示该行（不刷存在感）。
  const noEvolution = {
    ...base,
    page_vms: {
      ...base.page_vms,
      attention: {
        ...base.page_vms.attention,
        worklog: {
          runs_today: 3,
          autonomy_rate: 80,
          accepted_today: 2,
          saved_hours_estimate: 1,
          skills_promoted_today: 0,
          skills_refined_today: 0,
          generated_at: "2026-06-16T00:00:00.000Z",
          range_label: "今天"
        }
      }
    }
  };
  const zeroHome = renderWebRouteComponents(noEvolution, { locale: "zh-CN" }).home;
  assert.equal(zeroHome?.html.includes('data-r4-home-self-evolve="true"'), false);
});

test("R4.11 WorkItem route component keeps task context, trace, acceptance, and evidence from Page VM", () => {
  const vm = surfaceVm();
  const workitem = renderWebRouteComponents(vm, { locale: "en-US" }).workitem;

  assert.ok(workitem);
  assert.equal(workitem.html.includes('data-r4-route-component="workitem"'), true);
  assert.equal(workitem.html.includes('data-r4-route-component-source="page-vm"'), true);
  assert.equal(workitem.html.includes(`data-r4-workitem-id="${vm.page_vms.workitem.workitem.id}"`), true);
  assert.equal(workitem.html.includes(`data-r4-workitem-trace-count="${vm.page_vms.workitem.agent_trace_preview.length}"`), true);
  assert.equal(workitem.html.includes(`data-r4-workitem-acceptance-count="${vm.page_vms.workitem.acceptance.length}"`), true);
  assert.equal(workitem.html.includes("AI execution trace"), true);
  assert.equal(workitem.html.includes("Acceptance checklist"), true);
  assert.equal(workitem.html.includes("data-method=\"GET\""), true);
  assert.equal(workitem.html.includes('data-s1-day2-post-run-next-action="proposal"'), true);
  assert.equal(workitem.html.includes('data-s1-day2-post-run-next-action="replay"'), true);
  assert.deepEqual(workitem.primaryHrefs.includes(`/proposals/${vm.page_vms.proposal.proposal_id}`), true);
  assertNoMainWindowBoundaryLeak(workitem.html);
});

test("R9.7 WorkItem trace route component does not render machine tool names as visible pills", () => {
  const vm = surfaceVm();
  const firstStep = vm.page_vms.workitem.agent_trace_preview[0];
  assert.ok(firstStep);
  const workitem = renderWebRouteComponents({
    ...vm,
    page_vms: {
      ...vm.page_vms,
      workitem: {
        ...vm.page_vms.workitem,
        agent_trace_preview: [{
          ...firstStep,
          phase: "think",
          tool_name: "read_project_file",
          output_excerpt: "Reviewed the project context.",
          created_at: "2026-07-03T10:24:00.000Z"
        }]
      }
    }
  }, { locale: "en-US" }).workitem;

  assert.ok(workitem);
  assert.equal(workitem.html.includes("<span class=\"wh-pill\">read_project_file</span>"), false);
  assert.equal(workitem.html.includes("<span class=\"wh-pill\">2026-07-03 10:24</span>"), true);
});

test("R9.1 WorkItem route component renders the approved task plan snapshot", () => {
  const base = surfaceVm().page_vms.workitem;
  const planVm: WorkItemDetailVM = {
    ...base,
    task_plan: {
      id: "93000000-0000-4000-8000-000000000901",
      work_item_id: base.workitem.id,
      workspace_id: "93000000-0000-4000-8000-000000000001",
      status: "approved",
      objective_id: null,
      budget_json: { total_share_pct: 100 },
      decomposition_context_json: { source: "meta_planner" },
      created_by: "93000000-0000-4000-8000-000000000301",
      created_at: "2026-07-03T00:00:00.000Z",
      updated_at: "2026-07-03T00:01:00.000Z",
      items_capped: false,
      items: [
        {
          id: "93000000-0000-4000-8000-000000000902",
          plan_id: "93000000-0000-4000-8000-000000000901",
          parent_item_id: null,
          seq: 0,
          title: "整理竞品证据",
          role: "research",
          objective_md: "查清三类竞品的最新打法。",
          acceptance_md: "列出至少 3 条可核验来源。",
          budget_share_pct: 35,
          depends_on: [],
          status: "pending",
          created_at: "2026-07-03T00:00:00.000Z",
          updated_at: "2026-07-03T00:00:00.000Z"
        },
        {
          id: "93000000-0000-4000-8000-000000000903",
          plan_id: "93000000-0000-4000-8000-000000000901",
          parent_item_id: null,
          seq: 1,
          title: "产出短报告",
          role: "produce",
          objective_md: "把证据整理成短报告。",
          acceptance_md: "报告包含结论、证据和下一步建议。",
          budget_share_pct: 65,
          depends_on: ["93000000-0000-4000-8000-000000000902"],
          status: "pending",
          created_at: "2026-07-03T00:00:00.000Z",
          updated_at: "2026-07-03T00:00:00.000Z"
        }
      ]
    }
  };
  const workitem = renderWebRouteComponent({ key: "workitem", workitem: planVm }, { locale: "zh-CN" });

  assert.equal(workitem.html.includes('data-r9-task-plan-panel="true"'), true);
  assert.equal(workitem.html.includes('data-r9-task-plan-status="approved"'), true);
  assert.equal(workitem.html.includes('data-r9-task-plan-item="93000000-0000-4000-8000-000000000902"'), true);
  assert.equal(workitem.html.includes('data-r9-task-plan-role="research"'), true);
  assert.equal(workitem.html.includes('data-r9-task-plan-budget="65"'), true);
  assert.equal(workitem.html.includes('data-r9-task-plan-depends="#1"'), true);
  assert.equal(workitem.html.includes("任务计划"), true);
  assert.equal(workitem.html.includes("1. 整理竞品证据"), true);
  assert.equal(workitem.html.includes("0. 整理竞品证据"), false);
  assert.equal(workitem.html.includes("整理竞品证据"), true);
  assert.equal(workitem.html.includes("调研"), true);
  assert.equal(workitem.html.includes("列出至少 3 条可核验来源。"), true);
});

test("R9.1 WorkItem route component drafts a task plan before any agent run", () => {
  const base = surfaceVm().page_vms.workitem;
  const cleanSpecReady: WorkItemDetailVM = {
    ...base,
    workitem: { ...base.workitem, status: "spec_ready" },
    latest_proposal: undefined,
    agent_trace_preview: [],
    task_plan: undefined,
    agent_team: undefined
  };
  const workitem = renderWebRouteComponent({ key: "workitem", workitem: cleanSpecReady }, { locale: "en-US" });

  assert.equal(workitem.html.includes('data-action-id="create_task_plan" data-method="POST"'), true);
  assert.equal(workitem.html.includes(`/api/workitems/${cleanSpecReady.workitem.id}/task-plan`), true);
  assert.equal(workitem.html.includes('data-action-id="start_agent_run"'), false);
});

test("R9.2 WorkItem route component renders the task-plan run tree without inline decisions", () => {
  const base = surfaceVm().page_vms.workitem;
  const planId = "93000000-0000-4000-8000-000000000901";
  const researchId = "93000000-0000-4000-8000-000000000902";
  const reviewId = "93000000-0000-4000-8000-000000000903";
  const runTreeVm: WorkItemDetailVM = {
    ...base,
    agent_team: {
      plan_id: planId,
      status: "dispatching",
      completed_count: 1,
      total_count: 2,
      cost_used_cny: "1.250000",
      cost_budget_cny: "3.000000",
      cost_burn_pct: 42,
      runs_capped: false,
      items: [
        {
          task_plan_item_id: researchId,
          seq: 1,
          title: "整理竞品证据",
          role: "research",
          plan_status: "succeeded",
          status: "succeeded",
          budget_share_pct: 35,
          depends_on: [],
          waiting_for_seq: [],
          cost_estimate_cny: "0.450000",
          run_id: "93000000-0000-4000-8000-000000000911",
          run_status: "succeeded",
          replay_href: "/agent-runs/93000000-0000-4000-8000-000000000911/replay",
          action: {
            kind: "view_output",
            label: "看产出",
            href: "/agent-runs/93000000-0000-4000-8000-000000000911/replay"
          }
        },
        {
          task_plan_item_id: reviewId,
          seq: 2,
          title: "复核风险",
          role: "review",
          plan_status: "failed",
          status: "needs_human",
          budget_share_pct: 25,
          depends_on: [researchId],
          waiting_for_seq: [],
          cost_estimate_cny: "0.800000",
          run_id: "93000000-0000-4000-8000-000000000912",
          run_status: "escalated",
          replay_href: "/agent-runs/93000000-0000-4000-8000-000000000912/replay",
          decision_href: "/attention",
          action: {
            kind: "decide",
            label: "去决策",
            href: "/attention"
          }
        }
      ]
    }
  };
  const workitem = renderWebRouteComponent({ key: "workitem", workitem: runTreeVm }, { locale: "zh-CN" });

  assert.equal(workitem.html.includes('data-r9-agent-team-panel="true"'), true);
  assert.equal(workitem.html.includes(`data-r9-agent-team-plan-id="${planId}"`), true);
  assert.equal(workitem.html.includes("军团推进中 1/2"), true);
  assert.equal(workitem.html.includes('data-r9-agent-team-item="93000000-0000-4000-8000-000000000902"'), true);
  assert.equal(workitem.html.includes('data-r9-agent-team-status="needs_human"'), true);
  assert.equal(workitem.html.includes("看产出"), true);
  assert.equal(workitem.html.includes("去决策"), true);
  assert.equal(workitem.html.includes('href="/attention"'), true);
  assert.equal(workitem.html.includes("data-r9-agent-team-inline-decision"), false);
  assert.equal(workitem.html.includes("¥1.25"), true);
  assert.equal(workitem.html.includes("¥0.45"), true);
  assert.equal(workitem.html.includes("¥1.250000"), false);
  assert.equal(workitem.html.includes("¥0.450000"), false);
});

test("R9.7 WorkItem route component avoids dispatch internals and unavailable pause controls", () => {
  const base = surfaceVm().page_vms.workitem;
  const planId = "93000000-0000-4000-8000-000000000901";
  const dispatchedId = "93000000-0000-4000-8000-000000000904";
  const runTreeVm: WorkItemDetailVM = {
    ...base,
    agent_team: {
      plan_id: planId,
      status: "dispatching",
      completed_count: 1,
      total_count: 3,
      cost_used_cny: "1.250000",
      cost_budget_cny: "3.000000",
      cost_burn_pct: 42,
      runs_capped: false,
      items: [
        {
          task_plan_item_id: dispatchedId,
          seq: 1,
          title: "整理竞品证据",
          role: "research",
          plan_status: "dispatched",
          status: "dispatched",
          budget_share_pct: 35,
          depends_on: [],
          waiting_for_seq: [],
          cost_estimate_cny: "0.450000",
          run_id: "93000000-0000-4000-8000-000000000914",
          run_status: "running",
          replay_href: "/agent-runs/93000000-0000-4000-8000-000000000914/replay"
        }
      ]
    }
  };

  const zh = renderWebRouteComponent({ key: "workitem", workitem: runTreeVm }, { locale: "zh-CN" });
  const en = renderWebRouteComponent({ key: "workitem", workitem: runTreeVm }, { locale: "en-US" });

  assert.equal(zh.html.includes("派发"), false);
  assert.equal(en.html.includes("Dispatch"), false);
  assert.equal(zh.html.includes('data-r9-agent-team-pause="true"'), false);
  assert.equal(en.html.includes('data-r9-agent-team-pause="true"'), false);
});

test("R5.4 WorkItem route component exposes Drive source context and proposal draft action", () => {
  const vm = surfaceVm();
  const draftVm: WorkItemDetailVM = {
    ...vm.page_vms.workitem,
    source_context: {
      source_type: "drive_comment",
      project_id: "94000000-0000-4000-8000-000000000001",
      comment_id: "94000000-0000-4000-8000-000000000008",
      folder_path: "/deliverables",
      author_label: "PM",
      body: "Turn this Drive note into a proposal draft.",
      status: "draft_created",
      created_at: "2026-06-11T09:00:00.000Z"
    },
    actions: {
      create_proposal_draft: {
        id: "drive_draft_to_proposal",
        label: "Create proposal draft",
        method: "POST",
        href: "/api/drive/workitems/10000000-0000-4000-8000-000000000202/proposal-draft"
      }
    }
  };
  const workitem = renderWebRouteComponent({ key: "workitem", workitem: draftVm }, { locale: "en-US" });

  assert.equal(workitem.html.includes('data-r5-workitem-source-context="drive_comment"'), true);
  assert.equal(workitem.html.includes('data-r5-workitem-source-comment-id="94000000-0000-4000-8000-000000000008"'), true);
  assert.equal(workitem.html.includes('data-r5-workitem-create-proposal-action="true"'), true);
  assert.equal(workitem.html.includes('data-action-id="drive_draft_to_proposal" data-method="POST"'), true);
  assert.equal(workitem.primaryHrefs.includes("/api/drive/workitems/10000000-0000-4000-8000-000000000202/proposal-draft"), true);
});

test("GH-2: WorkItem header shows a breadcrumb back to its parent project", () => {
  const base = surfaceVm().page_vms.workitem;
  const withProject: WorkItemDetailVM = { ...base, project_name: "区域发布资料库" };
  const projectId = withProject.workitem.project_id;
  const workitem = renderWebRouteComponent({ key: "workitem", workitem: withProject }, { locale: "zh-CN" });
  assert.equal(workitem.html.includes(`data-r4-workitem-project-link="${projectId}"`), true);
  assert.equal(workitem.html.includes(`href="/projects/${projectId}"`), true);
  assert.equal(workitem.html.includes("区域发布资料库"), true);

  // Without project_name the breadcrumb degrades to the plain kicker (no broken link).
  const noProject = renderWebRouteComponent({ key: "workitem", workitem: base }, { locale: "zh-CN" });
  assert.equal(noProject.html.includes("data-r4-workitem-project-link"), false);
});

test("S1 Day2 WorkItem route component hides duplicate start-run once proposal or replay is available", () => {
  const vm = surfaceVm();
  const workitem = renderWebRouteComponents(vm, { locale: "en-US" }).workitem;

  assert.ok(workitem);
  assert.equal(workitem.html.includes('data-action-id="open_proposal"'), true);
  assert.equal(workitem.html.includes('data-action-id="open_replay"'), true);
  assert.equal(workitem.html.includes('data-action-id="start_agent_run"'), false);
});

test("R5.5 WorkItem route component exposes Meeting source context and proposal draft action", () => {
  const vm = surfaceVm();
  const draftVm: WorkItemDetailVM = {
    ...vm.page_vms.workitem,
    source_context: {
      source_type: "meeting_insight",
      project_id: "95000000-0000-4000-8000-000000000001",
      meeting_id: "95000000-0000-4000-8000-000000000002",
      insight_id: "95000000-0000-4000-8000-000000000004",
      meeting_title: "Q2 Client Proposal Review",
      insight_kind: "requirement_change",
      title: "Update proposal pricing model",
      description: "Create a draft update to the pricing section with tiered usage.",
      confidence_reason: "The meeting explicitly asks Finance to update the model before review.",
      status: "confirmed",
      transcript_excerpt: "Update proposal pricing model with tiered usage.",
      evidence_refs: [
        {
          id: "95000000-0000-4000-8000-000000000005",
          source_type: "meeting",
          source_id: "95000000-0000-4000-8000-000000000002",
          title: "Q2 Client Proposal Review"
        }
      ],
      created_at: "2026-06-11T09:10:00.000Z"
    },
    actions: {
      create_proposal_draft: {
        id: "meeting_draft_to_proposal",
        label: "Create proposal draft",
        method: "POST",
        href: "/api/meetings/workitems/10000000-0000-4000-8000-000000000202/proposal-draft"
      }
    }
  };
  const workitem = renderWebRouteComponent({ key: "workitem", workitem: draftVm }, { locale: "en-US" });

  assert.equal(workitem.html.includes('data-r5-workitem-source-context="meeting_insight"'), true);
  assert.equal(workitem.html.includes('data-r5-workitem-source-meeting-id="95000000-0000-4000-8000-000000000002"'), true);
  assert.equal(workitem.html.includes('data-r5-workitem-source-insight-id="95000000-0000-4000-8000-000000000004"'), true);
  assert.equal(workitem.html.includes("Meeting insight source"), true);
  assert.equal(workitem.html.includes('data-r5-workitem-create-proposal-action="true"'), true);
  assert.equal(workitem.html.includes('data-action-id="meeting_draft_to_proposal" data-method="POST"'), true);
  assert.equal(workitem.primaryHrefs.includes("/api/meetings/workitems/10000000-0000-4000-8000-000000000202/proposal-draft"), true);
});

test("R4.11 Proposal route component preserves review actions, rollback, changes, checks, evidence, and comments", () => {
  const vm = surfaceVm();
  const proposal = renderWebRouteComponents(vm, { locale: "en-US" }).proposal;

  assert.ok(proposal);
  assert.equal(proposal.html.includes('data-r4-route-component="proposal"'), true);
  assert.equal(proposal.html.includes(`data-r4-proposal-id="${vm.page_vms.proposal.proposal_id}"`), true);
  assert.equal(proposal.html.includes(`data-r4-proposal-change-count="${vm.page_vms.proposal.manifest.changes.length}"`), true);
  assert.equal(proposal.html.includes(`data-r4-proposal-check-count="${vm.page_vms.proposal.manifest.checks.length}"`), true);
  assert.equal(proposal.html.includes("Deliverable change request"), true);
  assert.equal(proposal.html.includes("Rollback available"), true);
  assert.equal(proposal.html.includes('data-action-id="request_changes"'), true);
  assert.equal(proposal.html.includes('data-method="POST"'), true);
  assert.equal(proposal.html.includes('data-requires-reason="true"'), true);
  assert.deepEqual(proposal.primaryHrefs, [
    vm.page_vms.proposal.review_actions.approve.href,
    vm.page_vms.proposal.review_actions.request_changes.href
  ].filter(Boolean));
  assertNoMainWindowBoundaryLeak(proposal.html);
});

test("R4.11 reviewed Proposal route component exposes only merge as the next write action", () => {
  const vm = structuredClone(surfaceVm());
  vm.page_vms.proposal.status = "reviewed";
  vm.page_vms.proposal.review_actions.merge = {
    id: "merge",
    label: "Merge deliverable",
    method: "POST",
    href: `/api/proposals/${vm.page_vms.proposal.proposal_id}/merge`
  };
  const proposal = renderWebRouteComponents(vm, { locale: "en-US" }).proposal;

  assert.ok(proposal);
  assert.equal(proposal.html.includes('data-action-id="approve"'), false);
  assert.equal(proposal.html.includes('data-action-id="request_changes"'), false);
  assert.equal(proposal.html.includes('data-action-id="merge"'), true);
  assert.deepEqual(proposal.primaryHrefs, [vm.page_vms.proposal.review_actions.merge.href]);
  assert.equal(proposal.reactComponent?.routeKey, "proposal");
  if (proposal.reactComponent?.routeKey !== "proposal") {
    throw new Error("proposal route component missing");
  }
  assert.equal(proposal.reactComponent.props.reviewActionCount, 1);
  assert.equal(proposal.reactComponent.props.mergeActionAvailable, true);
});

test("S1 Day0 Proposal route component hides write actions after merge", () => {
  const vm = structuredClone(surfaceVm());
  vm.page_vms.proposal.status = "merged";
  const proposal = renderWebRouteComponents(vm, { locale: "en-US" }).proposal;

  assert.ok(proposal);
  // 状态徽章人话化(不再裸渲枚举 "merged"),原始枚举保留在 data 属性供选择器/测试用。
  assert.equal(proposal.html.includes('data-r4-proposal-status="merged"'), true);
  assert.equal(proposal.html.includes(">Merged</span>"), true);
  assert.equal(proposal.html.includes('class="wh-r4-route-count" data-r4-proposal-status="merged">merged<'), false);
  assert.equal(proposal.html.includes('data-r4-proposal-action-count="0"'), true);
  assert.equal(proposal.html.includes('data-action-id="approve"'), false);
  assert.equal(proposal.html.includes('data-action-id="request_changes"'), false);
  assert.equal(proposal.html.includes('data-action-id="merge"'), false);
  assert.deepEqual(proposal.primaryHrefs, []);
  assert.equal(proposal.reactComponent?.routeKey, "proposal");
  if (proposal.reactComponent?.routeKey !== "proposal") {
    throw new Error("proposal route component missing");
  }
  assert.equal(proposal.reactComponent.props.reviewActionCount, 0);
  assert.equal(proposal.reactComponent.props.mergeActionAvailable, false);
});

test("R4.13 Proposal route component exposes advanced structured conflict editors from route surface", () => {
  const vm = {
    ...surfaceVm(),
    proposal_conflicts: [] as ProposalConflict[]
  };
  vm.proposal_conflicts = [structuredProposalConflict(vm)];
  const proposal = renderWebRouteComponents(vm, { locale: "en-US" }).proposal;

  assert.ok(proposal);
  assert.equal(proposal.html.includes('data-r4-route-component="proposal"'), true);
  assert.equal(proposal.html.includes('data-r4-proposal-conflict-count="1"'), true);
  assert.equal(proposal.html.includes('data-r4-proposal-advanced-review="true"'), true);
  assert.equal(proposal.html.includes('data-r4-proposal-conflicts="1"'), true);
  assert.equal(proposal.html.includes('data-r4-proposal-field-editor="true"'), true);
  assert.equal(proposal.html.includes('data-r4-proposal-subrecord-editor="true"'), true);
  assert.equal(proposal.html.includes('data-r4-proposal-react-mutation-editor-host="structured-field-scalar"'), true);
  assert.equal(proposal.html.includes('data-r4-proposal-react-mutation-editor-mounted="false"'), true);
  assert.equal(proposal.html.includes('data-proposal-conflicts="1"'), true);
  assert.equal(proposal.html.includes('data-structured-record-patch="true"'), true);
  assert.equal(proposal.html.includes('data-proposal-structured-field-editor="true"'), true);
  assert.equal(proposal.html.includes('data-proposal-subrecord-item-diff="true"'), true);
  assert.equal(proposal.html.includes('data-task-plan-scope="required"'), true);
  assert.equal(proposal.html.includes('data-field-editor-action="custom"'), true);
  assert.equal(proposal.html.includes('data-action-href="/api/merge-proposals/10000000-0000-4000-8000-000000000813/apply"'), true);
  assert.equal(proposal.html.includes("Advanced field editor"), true);
  assert.equal(proposal.html.includes("Advanced item editor"), true);
  assert.equal(proposal.primaryHrefs.includes("/api/merge-proposals/10000000-0000-4000-8000-000000000813/apply"), true);
  assertNoMainWindowBoundaryLeak(proposal.html);
});

test("findings[28] editor-host probe is not forged by conflict text containing a bare marker", () => {
  const vm = {
    ...surfaceVm(),
    proposal_conflicts: [] as ProposalConflict[]
  };
  const conflict = structuredProposalConflict(vm);
  // 这个 structured 冲突本不产生 line editor。把裸标记字样塞进会经 escapeHtml 渲染的冲突文本里，
  // 验证收紧后的探针（带开引号）不会被它伪造成"有 line editor"。
  conflict.headline = "marker data-route-line-editor= here";
  conflict.summary_text = "see data-route-line-editor= in the text";
  vm.proposal_conflicts = [conflict];
  const proposal = renderWebRouteComponents(vm, { locale: "en-US" }).proposal;

  assert.ok(proposal);
  // 裸标记不算数：line editor 仍判为 false，且不挂 react line-editor 宿主。
  assert.equal(proposal.html.includes('data-r4-proposal-line-editor="false"'), true);
  assert.equal(proposal.html.includes("data-r4-proposal-react-line-editor-host="), false);
  // 真实的 field editor（带引号标记）仍正常检测，证明收紧没误伤真实路径。
  assert.equal(proposal.html.includes('data-r4-proposal-field-editor="true"'), true);
});

test("R4.19 Proposal split adapter keeps readonly props separate from advanced editor fallback", () => {
  const vm = {
    ...surfaceVm(),
    proposal_conflicts: [] as ProposalConflict[]
  };
  vm.proposal_conflicts = [structuredProposalConflict(vm)];
  const proposal = renderWebRouteComponents(vm, { locale: "en-US" }).proposal;

  assert.ok(proposal);
  assert.equal(proposal.reactComponent?.routeKey, "proposal");
  if (proposal.reactComponent?.routeKey !== "proposal") {
    throw new Error("R4.19 Proposal split adapter is missing");
  }
  const expected = createProposalReactRouteComponent(vm.page_vms.proposal, vm.proposal_conflicts, "en-US", {
    actionHrefs: ["/api/merge-proposals/10000000-0000-4000-8000-000000000813/apply"],
    lineEditor: false,
    fieldEditor: true,
    subrecordEditor: true
  });

  assert.equal(proposal.reactComponent.componentName, "ProposalRouteComponent");
  assert.equal(proposal.reactComponent.adapter, "react-compatible-route-component-v1");
  assert.equal(proposal.reactComponent.mode, "html-fallback");
  assert.equal(proposal.reactComponent.htmlFallback, true);
  assert.equal(proposal.reactComponent.propsSource, "typed-page-vm");
  assert.equal(proposal.reactComponent.propsFingerprint, expected.propsFingerprint);
  assert.deepEqual(proposal.reactComponent.primaryHrefs, proposal.primaryHrefs);
  assert.equal(proposal.reactComponent.props.proposalId, vm.page_vms.proposal.proposal_id);
  assert.equal(proposal.reactComponent.props.workItemId, vm.page_vms.proposal.work_item_id);
  assert.equal(proposal.reactComponent.props.changeCount, vm.page_vms.proposal.manifest.changes.length);
  assert.equal(proposal.reactComponent.props.checkCount, vm.page_vms.proposal.manifest.checks.length);
  assert.equal(proposal.reactComponent.props.evidenceRefCount, vm.page_vms.proposal.evidence_refs.length);
  assert.equal(proposal.reactComponent.props.commentCount, vm.page_vms.proposal.comments.length);
  assert.equal(proposal.reactComponent.props.conflictCount, 1);
  assert.equal(proposal.reactComponent.props.reviewActionCount, 2);
  assert.equal(proposal.reactComponent.props.advancedFallbackPreserved, true);
  assert.equal(proposal.reactComponent.props.advancedFallbackSource, "proposal-advanced-editors-html-fallback");
  assert.equal(proposal.reactComponent.props.advancedFallbackActionCount, 1);
  assert.equal(proposal.reactComponent.props.fieldEditorFallback, true);
  assert.equal(proposal.reactComponent.props.subrecordEditorFallback, true);
  assert.equal(proposal.html.includes('data-r4-react-component="ProposalRouteComponent"'), true);
  assert.equal(proposal.html.includes('data-r4-hydration-react-component="ProposalRouteComponent"'), true);
  assert.equal(proposal.html.includes('data-r4-proposal-split-adapter="true"'), true);
  assert.equal(proposal.html.includes('data-r4-proposal-advanced-fallback-preserved="true"'), true);
  assert.equal(proposal.html.includes('data-r4-proposal-advanced-fallback="true"'), true);
  assert.equal(proposal.html.includes('data-r4-proposal-react-mutation-editor-host="structured-field-scalar"'), true);
  assert.equal(proposal.html.includes('data-proposal-structured-field-editor="true"'), true);
  assert.equal(proposal.html.includes('data-proposal-subrecord-item-diff="true"'), true);
  assertNoMainWindowBoundaryLeak(proposal.html);
});

test("R4.14 Intake route component renders a typed option-first session without chat-wall fallback", () => {
  const vm = {
    ...surfaceVm(),
    intake_session: routeSession()
  };
  const intake = renderWebRouteComponents(vm, { locale: "en-US" }).intake;

  assert.ok(intake);
  assert.equal(intake.html.includes('data-r4-route-component="intake"'), true);
  assert.equal(intake.html.includes('data-r4-route-component-source="session-vm"'), true);
  assert.equal(intake.html.includes('data-r4-intake-option-count="2"'), true);
  assert.equal(intake.html.includes('data-r4-intake-progress-count="2"'), true);
  assert.equal(intake.html.includes('data-r4-intake-free-text-collapsed="true"'), true);
  assert.equal(intake.html.includes('data-r4-intake-option-first="true"'), true);
  assert.equal(intake.html.includes('data-intake-submit="next-question"'), true);
  assert.equal(intake.html.includes('data-action-id="intake_continue"'), true);
  assert.equal(intake.html.includes('data-request-json="{&quot;selected_option_ids&quot;:[]}"'), true);
  assert.equal(intake.html.includes('data-intake-free-text-input="true"'), true);
  assert.equal(intake.html.includes('maxlength="120"'), true);
  assert.equal(intake.html.includes("Or type your own answer (optional)"), true);
  assert.equal(intake.html.includes("message-list"), false);
  assert.deepEqual(intake.primaryHrefs, ["/api/sessions/10000000-0000-4000-8000-000000000901/next-question"]);
  assertNoMainWindowBoundaryLeak(intake.html);
});

test("R8 intake start head shows a meaningful localized badge (not the 'D0' placeholder)", () => {
  const zh = renderWebRouteComponent({ key: "intake", start: true }, { locale: "zh-CN" });
  const en = renderWebRouteComponent({ key: "intake", start: true }, { locale: "en-US" });
  // 回归守卫:此前硬编码了 <span class="wh-r4-route-count">D0</span>(「Day 0」遗留占位)漏到了用户界面。
  assert.equal(zh.html.includes(">D0<"), false, "no hardcoded D0 placeholder leaks to the UI");
  assert.equal(zh.html.includes('data-r8-intake-badge="true">新任务<'), true);
  assert.equal(en.html.includes('data-r8-intake-badge="true">New<'), true);
});

test("R9.7 web task entry and project empty states avoid dispatch wording", () => {
  const intake = renderWebRouteComponent({ key: "intake", start: true }, { locale: "zh-CN" });
  const projectIntake = renderWebRouteComponent({
    key: "intake",
    start: true,
    project: { id: "93000000-0000-4000-8000-000000000001", name: "R5 Workspace" }
  }, { locale: "zh-CN" });
  const projects = renderWebRouteComponent({
    key: "projects",
    projects: { generated_at: "2026-06-11T09:00:00.000Z", projects: [] }
  }, { locale: "zh-CN" });
  const projectHome = renderWebRouteComponent({
    key: "project-home",
    project: {
      generated_at: "2026-06-11T09:00:00.000Z",
      project: {
        id: "93000000-0000-4000-8000-000000000001",
        name: "R5 Workspace",
        slug: "r5-workspace",
        description: null,
        owner_label: "owner",
        status: "active"
      },
      summary: { open_work_item_count: 0, total_open_work_item_count: 0 },
      open_work_items: [],
      drive: { file_count: 0, recent_files: [] },
      actions: {
        new_task: { id: "new_task", label: "新任务", method: "GET", href: "/intake?project_id=93000000-0000-4000-8000-000000000001" },
        open_drive: { id: "open_drive", label: "打开网盘", method: "GET", href: "/drive?project_id=93000000-0000-4000-8000-000000000001" }
      },
      empty_state: "no_open_work"
    }
  }, { locale: "zh-CN" });

  const html = [intake.html, projectIntake.html, projects.html, projectHome.html].join("\n");
  assert.match(html, /新任务/u);
  assert.doesNotMatch(html, /派活|派发/u);
});

test("R4.14 Intake confirm component exposes create work item action with selected option payload", () => {
  const vm = {
    ...surfaceVm(),
    intake_session: routeSession("confirm")
  };
  const intake = renderWebRouteComponents(vm, { locale: "zh-CN" }).intake;

  assert.ok(intake);
  assert.equal(intake.html.includes('data-r4-intake-input-mode="confirm"'), true);
  assert.equal(intake.html.includes('data-intake-create-workitem="true"'), true);
  assert.equal(intake.html.includes('data-action-id="create_workitem"'), true);
  assert.equal(intake.html.includes("创建工作项"), true);
  assert.equal(intake.primaryHrefs.includes("/api/workitems"), true);
  assertNoMainWindowBoundaryLeak(intake.html);
});

test("R4.14 Knowledge route component renders cited fallback evidence and binding payloads", () => {
  const vm = {
    ...surfaceVm(),
    knowledge_evidence: routeEvidenceBubble()
  };
  const knowledge = renderWebRouteComponents(vm, { locale: "en-US" }).knowledge;

  assert.ok(knowledge);
  assert.equal(knowledge.html.includes('data-r4-route-component="knowledge"'), true);
  assert.equal(knowledge.html.includes('data-r4-route-component-source="evidence-bubble"'), true);
  assert.equal(knowledge.html.includes('data-r4-knowledge-query="区域周报"'), true);
  assert.equal(knowledge.html.includes('data-r4-knowledge-evidence-count="2"'), true);
  assert.equal(knowledge.html.includes('data-r4-knowledge-action-count="2"'), true);
  assert.equal(knowledge.html.includes('data-r4-knowledge-missing="false"'), true);
  assert.equal(knowledge.html.includes('data-r4-knowledge-evidence-ref="10000000-0000-4000-8000-000000000912"'), true);
  assert.equal(knowledge.html.includes('data-r4-knowledge-source-type="meeting"'), true);
  assert.equal(knowledge.html.includes('data-action-id="use_for_current_task"'), true);
  assert.equal(knowledge.html.includes("&quot;evidence_bubble_id&quot;:&quot;10000000-0000-4000-8000-000000000911&quot;"), true);
  assert.equal(knowledge.html.includes("&quot;evidence_refs&quot;"), true);
  assert.equal(knowledge.primaryHrefs.includes("/api/workitems/10000000-0000-4000-8000-000000000902/evidence-bindings"), true);
  assertNoMainWindowBoundaryLeak(knowledge.html);
});

test("R4.11 Cost route component renders dashboard values directly from Cost Page VM", () => {
  const vm = surfaceVm();
  const cost = renderWebRouteComponents(vm, { locale: "en-US" }).cost;
  const costVm = vm.page_vms.cost;

  assert.ok(cost);
  assert.equal(cost.html.includes('data-r4-route-component="cost"'), true);
  assert.equal(cost.html.includes(`data-r4-cost-total-tokens="${costVm.token_in + costVm.token_out}"`), true);
  assert.equal(cost.html.includes(`data-r4-cost-total-cny="${costVm.total_cost_cny}"`), true);
  assert.equal(cost.html.includes(`data-r4-cost-budget-count="${costVm.budget.length}"`), true);
  assert.equal(cost.html.includes(`data-r4-cost-model-count="${costVm.model_breakdown.length}"`), true);
  assert.equal(cost.html.includes("Budget and cost"), true);
  assert.equal(cost.html.includes("Budget scopes"), true);
  assertNoMainWindowBoundaryLeak(cost.html);
});

test("R9.6 Agent Army route component renders observable dashboard cards without decision actions", () => {
  const agents = renderWebRouteComponent({ key: "agents", agents: agentArmyDashboardVm() }, { locale: "zh-CN" });

  assert.ok(agents);
  assert.equal(agents.key, "agents");
  assert.equal(agents.html.includes('data-r4-route-component="agents"'), true);
  assert.equal(agents.html.includes('data-r9-agent-dashboard="true"'), true);
  assert.equal(agents.html.includes('data-r9-agent-dashboard-mobile="single-column"'), true);
  assert.equal(agents.html.includes('data-r9-agent-dashboard-plan-count="1"'), true);
  assert.equal(agents.html.includes('data-r9-agent-kpi="active_team_count"'), true);
  assert.equal(agents.html.includes('data-r9-agent-kpi="waiting_decision"'), true);
  assert.equal(agents.html.includes('href="/"'), true);
  assert.equal(agents.html.includes('data-r9-agent-plan-card="96000000-0000-4000-8000-000000000001"'), true);
  assert.equal(agents.html.includes('href="/workitems/96000000-0000-4000-8000-000000000002"'), true);
  assert.equal(agents.html.includes('data-r9-agent-recent-activity="accordion"'), true);
  assert.equal(agents.html.includes("智能代理军团"), true);
  assert.equal(agents.html.includes("竞品资料梳理"), true);
  assert.equal(agents.html.includes("卡在: 竞品复核"), true);
  assert.equal(agents.html.includes("¥0.01"), true);
  assert.equal(agents.html.includes("¥3"), true);
  assert.equal(agents.html.includes("¥0.006"), false);
  assert.equal(agents.html.includes("¥3.000000"), false);
  assert.equal(agents.html.includes("判官"), false);
  assert.equal(agents.html.includes("追加预算继续"), false);
  assertNoMainWindowBoundaryLeak(agents.html);
});

test("R9.6 Agent Army route component renders empty state without fake plan cards", () => {
  const agents = renderWebRouteComponent({
    key: "agents",
    agents: agentArmyDashboardVm({
      kpis: {
        active_team_count: 0,
        waiting_decision_count: 0,
        today_cost_cny: "0",
        autonomy_rate_pct: 0
      },
      plans: [],
      recent_escalations: [],
      page_info: {
        plan_limit: 20,
        returned: 0,
        plans_capped: false,
        items_capped: false,
        runs_capped: false,
        escalation_limit: 5,
        escalation_returned: 0,
        escalations_capped: false
      },
      empty_state: "no_agent_armies"
    })
  }, { locale: "zh-CN" });

  assert.ok(agents);
  assert.equal(agents.html.includes('data-r9-agent-dashboard-empty="no_agent_armies"'), true);
  assert.equal(agents.html.includes("还没有军团在跑"), true);
  assert.equal(agents.html.includes('href="/intake"'), true);
  assert.equal(agents.html.includes('data-r9-agent-plan-card='), false);
  assertNoMainWindowBoundaryLeak(agents.html);
});

test("R9.7 Agent Army route component shows attention source warnings beside the KPI", () => {
  const agents = renderWebRouteComponent({
    key: "agents",
    agents: agentArmyDashboardVm({
      source_warnings: [{
        source: "sync_conflicts",
        message: "记忆冲突暂时加载失败。请打开设置或稍后重试。"
      }]
    })
  }, { locale: "zh-CN" });

  assert.ok(agents);
  assert.equal(agents.html.includes('data-r9-agent-source-warnings="1"'), true);
  assert.equal(agents.html.includes('data-r9-agent-source-warning="sync_conflicts"'), true);
  assert.equal(agents.html.includes("记忆冲突暂时加载失败"), true);
  assertNoMainWindowBoundaryLeak(agents.html);
});

test("Cost route component renders disabled budget policies as not enabled instead of zero quotas", () => {
  const vm = surfaceVm();
  vm.page_vms.cost.budget = [{
    scope: { kind: "user", user_id: "97000000-0000-4000-8000-000000000004" },
    scope_label: "My AI budget today",
    policy_id: "pcost-user-day-v0:disabled",
    period: "day",
    period_start: "2026-06-11T00:00:00.000Z",
    period_end: "2026-06-12T00:00:00.000Z",
    token_in: 0,
    token_out: 0,
    total_tokens: 0,
    max_tokens: 0,
    remaining_tokens: 0,
    estimated_cost_cny: "0",
    max_cost_cny: "0",
    remaining_cost_cny: "0",
    warning_ratio: 0,
    enabled: false,
    status: "ok"
  }];

  const cost = renderWebRouteComponents(vm, { locale: "en-US" }).cost;

  assert.ok(cost);
  assert.equal(cost.html.includes('data-r4-cost-budget-enabled="false"'), true);
  assert.equal(cost.html.includes("pcost-user-day-v0:disabled"), false);
  assert.equal(cost.html.includes("Budget not enabled"), true);
  assert.equal(cost.html.includes("0/0 tokens · ¥0/¥0"), false);
});

test("K5 Cost route component renders the work-vs-self-improvement labor split when present", () => {
  const base = surfaceVm();
  const vm = {
    ...base,
    page_vms: {
      ...base.page_vms,
      cost: {
        ...base.page_vms.cost,
        labor_split: {
          production_cost_cny: "0.8",
          self_improvement_cost_cny: "0.2",
          self_improvement_ratio: 0.2
        }
      }
    }
  };
  const cost = renderWebRouteComponents(vm, { locale: "en-US" }).cost;
  assert.ok(cost);
  assert.equal(cost.html.includes('data-r4-cost-labor-split="true"'), true);
  assert.equal(cost.html.includes('data-r4-cost-self-improvement-ratio="0.2"'), true);
  assert.equal(cost.html.includes("Work vs self-improvement"), true);
  assert.equal(cost.html.includes("Self-improvement share: 20%"), true);
  assertNoMainWindowBoundaryLeak(cost.html);
});

test("K5 Cost route component omits the labor split card when labor_split is absent", () => {
  const cost = renderWebRouteComponents(surfaceVm(), { locale: "en-US" }).cost;
  assert.ok(cost);
  // 默认 fixture 的 cost VM 没有 labor_split → 不渲染该卡。
  assert.equal(cost.html.includes('data-r4-cost-labor-split="true"'), false);
});

test("R4.11 Settings route component uses a typed Settings Page VM without leaking secrets or pet settings", () => {
  const vm = surfaceVm();
  const settings = renderWebRouteComponents(vm, { locale: "en-US" }).settings;

  assert.ok(settings);
  assert.equal(settings.html.includes('data-r4-route-component="settings"'), true);
  assert.equal(settings.html.includes('data-r4-route-component-source="page-vm"'), true);
  assert.equal(settings.html.includes('data-r4-settings-runtime-status="ready"'), true);
  assert.equal(settings.html.includes('data-r4-settings-active-locale="zh-CN"'), true);
  assert.equal(settings.html.includes('data-r4-settings-preference-locale="zh-CN"'), true);
  assert.equal(settings.html.includes('data-r4-settings-preference-source="server"'), true);
  assert.equal(settings.html.includes('data-r4-settings-preference-synced="true"'), true);
  assert.equal(settings.html.includes('data-r4-settings-secret-safe="true"'), true);
  assert.equal(settings.html.includes('data-r4-settings-pet-model-in-web="false"'), true);
  assert.equal(settings.html.includes('data-r4-settings-restore-requires-desktop="true"'), true);
  assert.equal(settings.html.includes('data-r4-settings-web-local-actions="false"'), true);
  assert.equal(settings.html.includes("deepseek-v4-flash"), true);
  // M23：本地存储键与内部端点是运维管道，普通用户看不懂、也无控制项——不再渲染到成员可见的设置页。
  assert.equal(settings.html.includes("workhub.locale"), false);
  assert.equal(settings.html.includes("/api/auth/preferences"), false);
  assert.equal(settings.html.includes("Server preference"), true);
  assert.equal(settings.html.includes("Synced"), true);
  assert.equal(settings.html.includes("Pet look is not configured in the Web main window"), true);
  assert.equal(settings.html.includes('data-action-id="open_desktop_settings"'), true);
  assert.equal(settings.html.includes('data-requires-desktop="true"'), true);
  const blockedBaseUrl = "https://api." + "deepseek.com";
  assert.equal(settings.html.includes(blockedBaseUrl), false);
  assert.equal(settings.html.includes("sk-"), false);
  assert.equal(settings.html.includes("data-cuu-settings-model-pack"), false);
  assert.equal(settings.html.includes("legacy-cuu-pack"), false);
  assert.deepEqual(settings.primaryHrefs, [vm.page_vms.settings?.device.restore_href]);
  assertNoMainWindowBoundaryLeak(settings.html);
});

test("R4.16 route components expose hydration boundary metadata without weakening markers", () => {
  const vm = {
    ...surfaceVm(),
    intake_session: routeSession(),
    knowledge_evidence: routeEvidenceBubble()
  };
  const components = renderWebRouteComponents(vm, { locale: "en-US" });
  const expected = {
    home: { source: "page-vm", pageVm: "attention" },
    intake: { source: "session-vm", pageVm: "session" },
    approvals: { source: "page-vm", pageVm: "approvals" },
    workitem: { source: "page-vm", pageVm: "workitem" },
    proposal: { source: "page-vm", pageVm: "proposal" },
    replay: { source: "page-vm", pageVm: "replay" },
    cost: { source: "page-vm", pageVm: "cost" },
    knowledge: { source: "evidence-bubble", pageVm: "evidence" },
    settings: { source: "page-vm", pageVm: "settings" }
  } as const;

  for (const [key, expectation] of Object.entries(expected)) {
    const component = components[key as keyof typeof expected];
    assert.ok(component, `${key} component should exist`);
    assert.equal(component.hydration.routeKey, key);
    assert.equal(component.hydration.mode, "html-fallback");
    assert.equal(component.hydration.adapter, "route-component-v1");
    assert.equal(component.hydration.locale, "en-US");
    assert.equal(component.hydration.source, expectation.source);
    assert.equal(component.hydration.pageVm, expectation.pageVm);
    assert.equal(component.hydration.actionHrefCount, component.primaryHrefs.length);
    assert.equal(component.html.includes('data-r4-hydration-boundary="true"'), true);
    assert.equal(component.html.includes(`data-r4-hydration-route="${key}"`), true);
    assert.equal(component.html.includes(`data-r4-hydration-page-vm="${expectation.pageVm}"`), true);
    assert.equal(component.html.includes(`data-r4-hydration-action-count="${component.primaryHrefs.length}"`), true);
    assert.equal(component.html.includes(`data-r4-route-component="${key}"`), true);
    assertNoMainWindowBoundaryLeak(component.html);
  }
});

test("R4.17 Home and Settings route components expose React-compatible props with HTML fallback parity", () => {
  const vm = surfaceVm();
  const components = renderWebRouteComponents(vm, { locale: "en-US" });
  const expectedHome = createHomeReactRouteComponent(vm.page_vms.attention, "en-US");
  const expectedSettings = createSettingsReactRouteComponent(vm.page_vms.settings!, "en-US");
  const home = components.home;
  const settings = components.settings;

  assert.ok(home);
  assert.ok(settings);
  assert.equal(home.reactComponent?.routeKey, "home");
  assert.equal(settings.reactComponent?.routeKey, "settings");
  if (home.reactComponent?.routeKey !== "home" || settings.reactComponent?.routeKey !== "settings") {
    throw new Error("R4.17 migrated route components are missing typed adapters");
  }

  assert.equal(home.reactComponent.componentName, "HomeRouteComponent");
  assert.equal(home.reactComponent.adapter, "react-compatible-route-component-v1");
  assert.equal(home.reactComponent.mode, "html-fallback");
  assert.equal(home.reactComponent.htmlFallback, true);
  assert.equal(home.reactComponent.propsSource, "typed-page-vm");
  assert.equal(home.reactComponent.propsFingerprint, expectedHome.propsFingerprint);
  assert.deepEqual(home.reactComponent.primaryHrefs, home.primaryHrefs);
  assert.equal(home.reactComponent.props.primaryActions.length, home.primaryHrefs.length);
  assert.equal(home.reactComponent.props.queueCount, vm.page_vms.attention.queue.length);
  assert.equal(home.html.includes('data-r4-react-component="HomeRouteComponent"'), true);
  assert.equal(home.html.includes('data-r4-react-component-html-fallback="true"'), true);
  assert.equal(home.html.includes(`data-r4-react-component-action-count="${home.primaryHrefs.length}"`), true);
  assert.equal(home.html.includes('data-r4-hydration-react-component="HomeRouteComponent"'), true);
  assert.equal(home.html.includes('data-r4-hydration-react-component-fallback="true"'), true);

  assert.equal(settings.reactComponent.componentName, "SettingsRouteComponent");
  assert.equal(settings.reactComponent.adapter, "react-compatible-route-component-v1");
  assert.equal(settings.reactComponent.mode, "html-fallback");
  assert.equal(settings.reactComponent.htmlFallback, true);
  assert.equal(settings.reactComponent.propsSource, "typed-page-vm");
  assert.equal(settings.reactComponent.propsFingerprint, expectedSettings.propsFingerprint);
  assert.deepEqual(settings.reactComponent.primaryHrefs, settings.primaryHrefs);
  assert.equal(settings.reactComponent.props.secretSafe, true);
  assert.equal(settings.reactComponent.props.petModelSettingsInWeb, false);
  assert.equal(settings.reactComponent.props.restoreRequiresDesktop, true);
  assert.equal(settings.reactComponent.props.webLocalActionsEnabled, false);
  assert.equal(settings.html.includes('data-r4-react-component="SettingsRouteComponent"'), true);
  assert.equal(settings.html.includes('data-r4-react-component-html-fallback="true"'), true);
  assert.equal(settings.html.includes(`data-r4-react-component-action-count="${settings.primaryHrefs.length}"`), true);
  assert.equal(settings.html.includes('data-r4-hydration-react-component="SettingsRouteComponent"'), true);
  assert.equal(settings.html.includes('data-r4-hydration-react-component-props-source="typed-page-vm"'), true);
  assert.equal(/api\.deepseek\.com|sk-[0-9A-Za-z]{20,}/u.test(settings.html), false);
  assertNoMainWindowBoundaryLeak(home.html);
  assertNoMainWindowBoundaryLeak(settings.html);
});

test("R4.18 Cost and Replay route components expose React-compatible props without changing fallback renderers", () => {
  const vm = surfaceVm();
  const components = renderWebRouteComponents(vm, { locale: "en-US" });
  const expectedCost = createCostReactRouteComponent(vm.page_vms.cost, "en-US");
  const expectedReplay = createReplayReactRouteComponent(renderAgentRunReplay(vm.page_vms.replay, "web", { locale: "en-US" }), "en-US");
  const cost = components.cost;
  const replay = components.replay;

  assert.ok(cost);
  assert.ok(replay);
  assert.equal(cost.reactComponent?.routeKey, "cost");
  assert.equal(replay.reactComponent?.routeKey, "replay");
  if (cost.reactComponent?.routeKey !== "cost" || replay.reactComponent?.routeKey !== "replay") {
    throw new Error("R4.18 migrated route components are missing typed adapters");
  }

  assert.equal(cost.reactComponent.componentName, "CostRouteComponent");
  assert.equal(cost.reactComponent.adapter, "react-compatible-route-component-v1");
  assert.equal(cost.reactComponent.mode, "html-fallback");
  assert.equal(cost.reactComponent.htmlFallback, true);
  assert.equal(cost.reactComponent.propsSource, "typed-page-vm");
  assert.equal(cost.reactComponent.propsFingerprint, expectedCost.propsFingerprint);
  assert.deepEqual(cost.reactComponent.primaryHrefs, cost.primaryHrefs);
  assert.deepEqual(cost.reactComponent.props.primaryActionHrefs, cost.primaryHrefs);
  assert.equal(cost.reactComponent.props.totalTokens, vm.page_vms.cost.token_in + vm.page_vms.cost.token_out);
  assert.equal(cost.reactComponent.props.totalCostCny, vm.page_vms.cost.total_cost_cny);
  assert.equal(cost.reactComponent.props.budgetCount, vm.page_vms.cost.budget.length);
  assert.equal(cost.reactComponent.props.riskCount, vm.page_vms.cost.top_exhaustion_risks.length);
  assert.equal(cost.reactComponent.props.modelCount, vm.page_vms.cost.model_breakdown.length);
  assert.equal(cost.reactComponent.props.trendCount, vm.page_vms.cost.trend.length);
  assert.equal(cost.html.includes('data-r4-react-component="CostRouteComponent"'), true);
  assert.equal(cost.html.includes('data-r4-hydration-react-component="CostRouteComponent"'), true);
  assert.equal(cost.html.includes(`data-r4-react-component-action-count="${cost.primaryHrefs.length}"`), true);
  assert.equal(cost.html.includes(`data-r4-cost-total-tokens="${vm.page_vms.cost.token_in + vm.page_vms.cost.token_out}"`), true);

  assert.equal(replay.reactComponent.componentName, "ReplayRouteComponent");
  assert.equal(replay.reactComponent.adapter, "react-compatible-route-component-v1");
  assert.equal(replay.reactComponent.mode, "html-fallback");
  assert.equal(replay.reactComponent.htmlFallback, true);
  assert.equal(replay.reactComponent.propsSource, "typed-page-vm");
  assert.equal(replay.reactComponent.propsFingerprint, expectedReplay.propsFingerprint);
  assert.deepEqual(replay.reactComponent.primaryHrefs, replay.primaryHrefs);
  assert.deepEqual(replay.reactComponent.props.primaryActionHrefs, replay.primaryHrefs);
  assert.equal(replay.reactComponent.props.runId, vm.page_vms.replay.run.id);
  assert.equal(replay.reactComponent.props.stepCount, vm.page_vms.replay.steps.length);
  assert.equal(replay.reactComponent.props.acceptedDeliverableCount, vm.page_vms.replay.accepted_deliverables?.length ?? 0);
  assert.equal(replay.html.includes("Accepted deliverables"), true);
  assert.equal(replay.html.includes('data-r4-react-component="ReplayRouteComponent"'), true);
  assert.equal(replay.html.includes('data-r4-hydration-react-component="ReplayRouteComponent"'), true);
  assert.equal(replay.html.includes(`data-r4-react-component-action-count="${replay.primaryHrefs.length}"`), true);
  assertNoMainWindowBoundaryLeak(cost.html);
  assertNoMainWindowBoundaryLeak(replay.html);
  assert.equal(/api\.deepseek\.com|sk-[0-9A-Za-z]{20,}/u.test(`${cost.html}${replay.html}`), false);
});

test("R4.10 Approvals route component keeps action reasons and Page VM counts visible", () => {
  const vm = surfaceVm();
  const approvals = renderWebRouteComponents(vm, { locale: "en-US" }).approvals;

  assert.ok(approvals);
  assert.equal(approvals.html.includes('data-r4-route-component="approvals"'), true);
  assert.equal(approvals.html.includes("R4.10 approval sentinel"), true);
  assert.equal(approvals.html.includes("Rejected work must include a reason so AI can revise it."), true);
  assert.equal(approvals.html.includes(`data-r4-approval-pending="${vm.page_vms.approvals.counts.pending ?? vm.page_vms.approvals.items.length}"`), true);
  assert.equal(approvals.html.includes('data-r4-approval-routed="true"'), true);
  assert.equal(approvals.html.includes(">Routed</span>"), true);
  assert.equal(approvals.html.includes('data-requires-reason="true"'), true);
  assert.deepEqual(approvals.primaryHrefs, vm.page_vms.approvals.items[0]?.actions.map((action) => action.href) ?? []);
  assertNoMainWindowBoundaryLeak(approvals.html);
});

test("Approvals route component does not leak raw approval facts", () => {
  const vm = surfaceVm();
  const request = vm.page_vms.approvals.requests[0];
  assert.ok(request);
  request.action_pattern = "tool.write_file";
  request.status = "pending";
  request.routed_to_user_id = "96000000-0000-4000-8000-000000000011";
  request.sla_due_at = "2026-07-05T00:00:00.000Z";

  const approvals = renderWebRouteComponents(vm, { locale: "en-US" }).approvals;

  assert.ok(approvals);
  assert.equal(approvals.html.includes("tool.write_file"), false);
  assert.equal(approvals.html.includes("96000000-0000-4000-8000-000000000011"), false);
  assert.equal(approvals.html.includes("2026-07-05T00:00:00.000Z"), false);
  assert.equal(approvals.html.includes("<strong>Tool approval</strong>"), true);
  assert.equal(approvals.html.includes("Pending · SLA 2026-07-05 00:00"), true);
  assert.equal(approvals.html.includes(">Routed</span>"), true);
  assertNoMainWindowBoundaryLeak(approvals.html);
});

test("Approvals route component surfaces page_info when the queue is truncated", () => {
  const vm = surfaceVm();
  vm.page_vms.approvals.page_info = { limit: 100, returned: 100, has_more: true };
  vm.page_vms.approvals.counts.pending = 100;
  vm.page_vms.approvals.counts.pending_total = 137;
  const approvals = renderWebRouteComponents(vm, { locale: "en-US" }).approvals;

  assert.ok(approvals);
  assert.equal(approvals.html.includes('data-r4-approval-page-has-more="true"'), true);
  assert.equal(approvals.html.includes("Showing 100 of 137 approvals. More approvals are available."), true);
});

test("R5.1 Drive route component exposes files, versions, deliverable actions, and comment draft links", () => {
  const drive = renderWebRouteComponent({ key: "drive", drive: drivePageVm() }, { locale: "en-US" });

  assert.equal(drive.key, "drive");
  assert.equal(drive.html.includes('data-r4-route-component="drive"'), true);
  assert.equal(drive.html.includes('data-r4-route-component-source="page-vm"'), true);
  assert.equal(drive.html.includes('data-r4-drive-item-count="2"'), true);
  assert.equal(drive.html.includes('data-r4-drive-version-count="2"'), true);
  assert.equal(drive.html.includes('data-r4-drive-accepted-count="1"'), true);
  assert.equal(drive.html.includes('data-r5-drive-deleted-count="1"'), true);
  assert.equal(drive.html.includes('data-r5-drive-operation-count="1"'), true);
  assert.equal(drive.html.includes("client-review.md"), true);
  assert.equal(drive.html.includes('data-r5-drive-item-link="true"'), true);
  assert.equal(drive.html.includes('href="/drive?project_id=94000000-0000-4000-8000-000000000001&amp;item_id=94000000-0000-4000-8000-000000000002"'), true);
  assert.equal(drive.html.includes('data-r5-drive-item-link-id="94000000-0000-4000-8000-000000000009"'), true);
  assert.equal(drive.html.includes('data-r4-drive-version-current="true"'), true);
  assert.equal(drive.html.includes('type="file"'), true);
  assert.equal(drive.html.includes('data-drive-upload-picker="true"'), true);
  assert.equal(drive.html.includes('data-action-href="/api/drive/projects/94000000-0000-4000-8000-000000000001/files"'), true);
  assert.equal(drive.html.includes("Insert sample file"), false);
  assert.equal(drive.html.includes("r5-upload-sample.md"), false);
  assert.equal(drive.html.includes('data-action-id="drive_delete_item" data-method="POST"'), true);
  assert.equal(drive.html.includes('data-r5-drive-delete-target="94000000-0000-4000-8000-000000000009"'), true);
  // M8: the destructive delete button must name its (server-chosen) target so a bare
  // "移到回收站" never recycles an unnamed file; the name also feeds the recovery notice.
  assert.equal(drive.html.includes('data-r5-drive-delete-name="manual-note.md"'), true);
  assert.equal(drive.html.includes('data-r5-drive-row-delete="94000000-0000-4000-8000-000000000009"'), true);
  assert.equal(drive.primaryHrefs.includes("/api/drive/projects/94000000-0000-4000-8000-000000000001/items/94000000-0000-4000-8000-000000000009/delete"), true);
  assert.equal(drive.html.includes("manual-note.md"), true);
  assert.equal(drive.html.includes("expected_current_version_id"), true);
  assert.equal(drive.html.includes("94000000-0000-4000-8000-000000000010"), true);
  assert.equal((drive.html.match(/data-action-id="drive_restore_item"/gu) ?? []).length, 1);
  assert.equal(drive.html.includes('data-r5-drive-recycle-restore="94000000-0000-4000-8000-000000000011"'), true);
  assert.equal(drive.html.includes('data-r5-drive-recycle="true"'), true);
  assert.equal(drive.html.includes('data-r5-drive-operations="true"'), true);
  assert.equal(drive.html.includes('data-action-id="drive_preview"'), true);
  assert.equal(drive.html.includes('data-action-id="drive_download"'), true);
  assert.equal(drive.html.includes('/api/drive/projects/94000000-0000-4000-8000-000000000001/items/94000000-0000-4000-8000-000000000009/preview'), true);
  assert.equal(drive.html.includes('/api/drive/projects/94000000-0000-4000-8000-000000000001/items/94000000-0000-4000-8000-000000000009/download'), true);
  const previewLink = drive.html.match(/<a class="wh-btn" href="[^"]+\/preview"[^>]+data-action-id="drive_preview"[^>]*>/u)?.[0] ?? "";
  assert.notEqual(previewLink, "");
  assert.match(previewLink, /data-drive-preview-link="true"/u);
  assert.doesNotMatch(previewLink, /data-native-resource-link="true"/u);
  assert.doesNotMatch(previewLink, /target="_blank"/u);
  assert.match(drive.html, /data-action-id="drive_download"[^>]+data-native-resource-link="true"[^>]+target="_blank"/u);
  assert.equal(drive.html.includes('data-action-id="drive_restore" data-method="POST"'), true);
  assert.equal(drive.html.includes("/workitems/94000000-0000-4000-8000-000000000005"), true);
  assert.equal(drive.html.includes('data-action-id="comment_to_draft" data-method="POST"'), true);
  assert.equal(drive.html.includes("/api/drive/projects/94000000-0000-4000-8000-000000000001/comments/94000000-0000-4000-8000-000000000014/draft"), true);
  assert.equal(drive.html.includes("Proposal created"), true);
  assert.equal(drive.html.includes("Pending draft"), true);
  assert.equal(drive.html.includes('data-r5-drive-proposal-link="true"'), true);
  assert.equal(drive.html.includes("/proposals/94000000-0000-4000-8000-000000000006"), true);
  assert.equal(drive.hydration.pageVm, "drive");
  assert.equal(drive.primaryHrefs.length, 11);
  assertNoMainWindowBoundaryLeak(drive.html);
});

test("Drive route upload picker exposes project folders as parent targets", () => {
  const vm = drivePageVm();
  vm.summary.item_count = 3;
  vm.summary.folder_count = 1;
  vm.items.unshift({
    id: "94000000-0000-4000-8000-000000000020",
    project_id: "94000000-0000-4000-8000-000000000001",
    name: "Research",
    kind: "folder",
    path: "/Research",
    depth: 0,
    children_count: 1,
    updated_at: "2026-06-11T09:00:00.000Z"
  });
  vm.selected_item_id = "94000000-0000-4000-8000-000000000020";

  const drive = renderWebRouteComponent({ key: "drive", drive: vm }, { locale: "en-US" });

  assert.equal(drive.html.includes('data-drive-upload-control="true"'), true);
  assert.equal(drive.html.includes('data-drive-upload-parent-select="true"'), true);
  assert.equal(drive.html.includes('<option value="">Drive root</option>'), true);
  assert.equal(drive.html.includes('value="94000000-0000-4000-8000-000000000020" selected>Research</option>'), true);
});

test("Drive route version history follows the selected file instead of showing unrelated project versions", () => {
  const vm = drivePageVm();
  vm.selected_item_id = "94000000-0000-4000-8000-000000000009";

  const drive = renderWebRouteComponent({ key: "drive", drive: vm }, { locale: "en-US" });

  assert.equal(drive.html.includes("Version history · manual-note.md"), true);
  assert.equal((drive.html.match(/data-r4-drive-version="/gu) ?? []).length, 1);
  assert.equal(drive.html.includes('data-r4-drive-version="94000000-0000-4000-8000-000000000010"'), true);
  assert.equal(drive.html.includes('data-r4-drive-version="94000000-0000-4000-8000-000000000003"'), false);
});

test("Drive route recycle bin renders every loaded deleted item", () => {
  const vm = drivePageVm();
  const baseDeleted = vm.deleted_items[0]!;
  vm.deleted_items = Array.from({ length: 7 }, (_, index) => ({
    ...baseDeleted,
    id: `94000000-0000-4000-8000-0000000000${20 + index}`,
    name: `deleted-${index + 1}.md`,
    path: `/deleted-${index + 1}.md`,
    restore_href: `/api/drive/projects/94000000-0000-4000-8000-000000000001/items/94000000-0000-4000-8000-0000000000${20 + index}/restore`
  }));

  const drive = renderWebRouteComponent({ key: "drive", drive: vm }, { locale: "zh-CN" });

  // 旧断言把回收站固定截断为 5 行，导致第 6+ 个已加载项目永远没有还原入口；这里应渲染完整已加载清单。
  assert.equal((drive.html.match(/data-action-id="drive_restore_item"/gu) ?? []).length, 7);
  assert.equal(drive.html.includes("deleted-6.md"), true);
  assert.equal(drive.html.includes("deleted-7.md"), true);
  assert.equal(drive.html.includes("继续进入网盘查看完整回收站"), false);
});

test("Drive route explains restricted accepted deliverables without action links", () => {
  const vm = drivePageVm();
  vm.accepted_deliverables[0] = {
    ...vm.accepted_deliverables[0]!,
    access_notice: "Restricted: you need access to the backing work item to preview or download this deliverable.",
    preview_href: undefined,
    download_href: undefined,
    restore_href: undefined
  };

  const drive = renderWebRouteComponent({ key: "drive", drive: vm }, { locale: "en-US" });

  assert.equal(drive.html.includes('data-r4-drive-accepted-deliverable="94000000-0000-4000-8000-000000000004"'), true);
  assert.equal(drive.html.includes('data-r5-drive-accepted-access-note="true"'), true);
  assert.equal(drive.html.includes("Restricted: you need access to the backing work item to preview or download this deliverable."), true);
  assert.equal((drive.html.match(/data-action-id="drive_restore"/gu) ?? []).length, 0);
});

test("Drive route marks a recycle-bin deep link without selecting an active file row", () => {
  const vm = drivePageVm();
  vm.selected_item_id = "94000000-0000-4000-8000-000000000011";

  const drive = renderWebRouteComponent({ key: "drive", drive: vm }, { locale: "en-US" });

  assert.equal(drive.html.includes('data-r4-drive-item-selected="true"'), false);
  assert.equal(drive.html.includes('data-r5-drive-recycle-item="94000000-0000-4000-8000-000000000011" data-r5-drive-recycle-selected="true"'), true);
});

test("Drive route renders every loaded file row instead of silently truncating after twelve", () => {
  const base = drivePageVm();
  const items = Array.from({ length: 20 }, (_, index) => {
    const n = index + 1;
    return {
      ...base.items[0],
      id: `94000000-0000-4000-8000-${String(900 + n).padStart(12, "0")}`,
      name: `loaded-file-${String(n).padStart(2, "0")}.md`,
      path: `/loaded-file-${String(n).padStart(2, "0")}.md`,
      current_version_id: `94000000-0000-4000-8000-${String(950 + n).padStart(12, "0")}`
    };
  }) as DrivePageVM["items"];
  const drive = renderWebRouteComponent({
    key: "drive",
    drive: {
      ...base,
      summary: { ...base.summary, item_count: 20, file_count: 20 },
      selected_item_id: items[0]?.id,
      items
    }
  }, { locale: "en-US" });

  assert.equal((drive.html.match(/data-r4-drive-item="/gu) ?? []).length, 20);
  assert.equal(drive.html.includes("loaded-file-20.md"), true);
  assert.equal(drive.html.includes("Showing the first 20 of 20 files."), false);
});

test("R5.5 Meeting route component exposes meetings, insights, actions, and approval-safe copy", () => {
  const meetings = renderWebRouteComponent({ key: "meetings", meetings: meetingPageVm() }, { locale: "en-US" });

  assert.equal(meetings.key, "meetings");
  assert.equal(meetings.html.includes('data-r4-route-component="meetings"'), true);
  assert.equal(meetings.html.includes('data-r5-meetings-route="true"'), true);
  assert.equal(meetings.html.includes('data-r5-meeting-count="1"'), true);
  assert.equal(meetings.html.includes('data-r5-meeting-pending-insights="1"'), true);
  assert.equal(meetings.html.includes('data-r5-meeting-id="95000000-0000-4000-8000-000000000002"'), true);
  assert.equal(meetings.html.includes('data-r5-meeting-insight="95000000-0000-4000-8000-000000000004"'), true);
  assert.equal(meetings.html.includes('data-action-id="meeting_insight_to_draft" data-method="POST"'), true);
  assert.equal(meetings.html.includes('data-action-id="meeting_insight_dismiss" data-method="POST"'), true);
  assert.equal(meetings.html.includes("Approval-safe"), true);
  assert.equal(meetings.html.includes("Update proposal pricing model"), true);
  assert.equal(meetings.hydration.pageVm, "meetings");
  assert.equal(meetings.primaryHrefs.includes("/api/meetings/projects/95000000-0000-4000-8000-000000000001/insights/95000000-0000-4000-8000-000000000004/draft"), true);
  assertNoMainWindowBoundaryLeak(meetings.html);
});

test("xreview batch D: meetings empty state renders a tailored card, not phantom transcript/minutes", () => {
  const vm = structuredClone(meetingPageVm());
  vm.meetings = [];
  vm.summary = { meeting_count: 0, ready_count: 0, pending_insight_count: 0, confirmed_insight_count: 0, dismissed_insight_count: 0 };
  vm.empty_state = "no_meetings";
  const meetings = renderWebRouteComponent({ key: "meetings", meetings: vm }, { locale: "en-US" });
  // No phantom "this meeting has no transcript/minutes" panels for a meeting that does not exist.
  assert.equal(meetings.html.includes('data-r5-meeting-transcript'), false);
  assert.equal(meetings.html.includes('data-r5-meeting-minutes'), false);
  assert.equal(meetings.html.includes('data-r5-meeting-insight-panel'), false);
  // A single tailored empty card instead.
  assert.equal(meetings.html.includes('data-r5-meeting-empty="true"'), true);
  // The meeting list shell still renders (with its own empty message).
  assert.equal(meetings.html.includes('data-r5-meeting-list="true"'), true);
});

test("R5.6 Notifications route component groups inbox buckets and exposes audited actions", () => {
  const notifications = renderWebRouteComponent({ key: "notifications", notifications: notificationPageVm() }, { locale: "en-US" });
  const zh = renderWebRouteComponent({ key: "notifications", notifications: notificationPageVm() }, { locale: "zh-CN" });

  assert.equal(notifications.key, "notifications");
  assert.equal(notifications.html.includes('data-r4-route-component="notifications"'), true);
  assert.equal(notifications.html.includes('data-r5-notifications-route="true"'), true);
  assert.equal(notifications.html.includes('data-r5-notification-needs-decision-count="1"'), true);
  assert.equal(notifications.html.includes('data-r5-notification-bucket="needs_decision"'), true);
  assert.equal(notifications.html.includes('data-r5-notification-item="96000000-0000-4000-8000-000000000002"'), true);
  assert.equal(notifications.html.includes('data-r5-notification-source-type="meeting_insight"'), true);
  assert.equal(notifications.html.includes('data-r5-notification-mark-read="true"'), true);
  assert.equal(notifications.html.includes('data-r5-notification-dismiss="true"'), true);
  assert.equal(notifications.html.includes('data-r5-notification-complete="true"'), true);
  assert.equal(notifications.primaryHrefs.includes("/api/notifications/read-all"), true);
  assert.equal(notifications.primaryHrefs.includes("/api/notifications/96000000-0000-4000-8000-000000000002/dismiss"), true);
  assert.equal(zh.html.includes("需要你决定"), true);
  assertNoMainWindowBoundaryLeak(notifications.html);
});

test("R5.6 Calendar route component renders deterministic day blocks and target links", () => {
  const calendar = renderWebRouteComponent({ key: "calendar", calendar: calendarPageVm() }, { locale: "en-US" });
  const zh = renderWebRouteComponent({ key: "calendar", calendar: calendarPageVm() }, { locale: "zh-CN" });

  assert.equal(calendar.key, "calendar");
  assert.equal(calendar.html.includes('data-r4-route-component="calendar"'), true);
  assert.equal(calendar.html.includes('data-r5-calendar-route="true"'), true);
  assert.equal(calendar.html.includes('data-r5-calendar-date="2026-06-11"'), true);
  assert.equal(calendar.html.includes('data-r5-calendar-block-count="2"'), true);
  assert.equal(calendar.html.includes('data-r5-calendar-block-kind="work_item_due"'), true);
  assert.equal(calendar.html.includes('data-r5-calendar-block-kind="meeting_followup"'), true);
  assert.equal(calendar.html.includes('data-r5-calendar-day="2026-06-12"'), true);
  assert.equal(calendar.html.includes('data-r5-calendar-open-target="true"'), true);
  assert.equal(calendar.primaryHrefs.includes("/workitems/97000000-0000-4000-8000-000000000002"), true);
  assert.equal(zh.html.includes("任务截止"), true);
  assertNoMainWindowBoundaryLeak(calendar.html);
});

test("R8 Team skills route component renders active skills, K2 provenance, and totals", () => {
  const skillsVm = {
    generated_at: "2026-06-16T00:00:00.000Z",
    skills: [
      {
        skill_key: "quarterly-report",
        name: "季度报告",
        when_to_use: "生成季度业务报告",
        version: 3,
        source_kind: "distilled" as const,
        created_by_kind: "ai" as const,
        confidence_score: 0.86,
        sample_count: 0,
        updated_at: "2026-06-16T00:00:00.000Z",
        provenance: { refined_from_version: 2, op_count: 1, rationale_md: "补边界情况" }
      }
    ],
    totals: { active: 1, ai_authored: 1, refined: 1 }
  };
  const en = renderWebRouteComponent({ key: "skills", skills: skillsVm }, { locale: "en-US" });
  const zh = renderWebRouteComponent({ key: "skills", skills: skillsVm }, { locale: "zh-CN" });

  assert.equal(en.key, "skills");
  assert.equal(en.html.includes('data-r4-route-component="skills"'), true);
  assert.equal(en.html.includes('data-r8-skills-active="1"'), true);
  assert.equal(en.html.includes('data-r8-skills-refined="1"'), true);
  assert.equal(en.html.includes('data-r8-skill="quarterly-report"'), true);
  assert.equal(en.html.includes('data-r8-skill-version="3"'), true);
  // K2 provenance 徽章。
  assert.equal(en.html.includes('data-r8-skill-refined="true"'), true);
  assert.equal(en.html.includes("refined from v2 · 1 edit"), true);
  assert.equal(en.html.includes('data-r8-skill-refined-ops="1"'), true);
  assert.equal(en.html.includes("补边界情况"), true);
  assert.equal(en.html.includes("Team skills"), true);
  assert.equal(zh.html.includes("团队技能"), true);
  assertNoMainWindowBoundaryLeak(en.html);
});

test("R8 Team skills route component shows an empty state when there are no skills", () => {
  const emptyVm = {
    generated_at: "2026-06-16T00:00:00.000Z",
    skills: [],
    totals: { active: 0, ai_authored: 0, refined: 0 },
    empty_state: "no_skills" as const
  };
  const en = renderWebRouteComponent({ key: "skills", skills: emptyVm }, { locale: "en-US" });
  assert.equal(en.html.includes('data-r8-skills-empty="true"'), true);
  assert.equal(en.html.includes('data-r8-skills-active="0"'), true);
});

test("R9.7 Team skills route hides confidence jargon in skill score badges", () => {
  const skillsVm = {
    generated_at: "2026-06-16T00:00:00.000Z",
    skills: [
      {
        skill_key: "quarterly-report",
        name: "季度报告",
        when_to_use: "生成季度业务报告",
        version: 3,
        source_kind: "distilled" as const,
        created_by_kind: "ai" as const,
        confidence_score: 0.86,
        sample_count: 0,
        updated_at: "2026-06-16T00:00:00.000Z"
      }
    ],
    totals: { active: 1, ai_authored: 1, refined: 0 }
  };

  const en = renderWebRouteComponent({ key: "skills", skills: skillsVm }, { locale: "en-US" });
  const zh = renderWebRouteComponent({ key: "skills", skills: skillsVm }, { locale: "zh-CN" });

  assert.doesNotMatch(en.html, /confidence/iu);
  assert.doesNotMatch(zh.html, /置信/u);
});

test("R4.10 Replay route component uses replay renderer while preserving route component markers", () => {
  const vm = surfaceVm();
  const replay = renderWebRouteComponents(vm, { locale: "en-US" }).replay;

  assert.ok(replay);
  assert.equal(replay.html.includes('data-r4-route-component="replay"'), true);
  assert.equal(replay.html.includes(`data-r4-replay-step-count="${vm.page_vms.replay.steps.length}"`), true);
  assert.equal(replay.html.includes("See how AI did it"), true);
  assert.equal(replay.html.includes("Accepted deliverables"), true);
  assert.equal(replay.html.includes("Decision record"), true);
  assert.equal(replay.primaryHrefs.length, (vm.page_vms.replay.accepted_deliverables ?? []).flatMap((item) => [item.preview_href, item.download_href, item.restore_href]).filter(Boolean).length);
  assertNoMainWindowBoundaryLeak(replay.html);
  assert.match(replay.css, /@media \(max-width:860px\)/u);
});

function projectHealthPageVm(viewerScope: "admin" | "member" = "member"): ProjectHealthPageVM {
  return {
    generated_at: "2026-06-11T10:00:00.000Z",
    actor_user_id: "98000000-0000-4000-8000-000000000001",
    viewer_scope: viewerScope,
    summary: { project_count: 1, healthy_count: 0, attention_count: 1, critical_count: 0 },
    cards: [{
      project_id: "98000000-0000-4000-8000-000000000002",
      project_name: "Southwest launch",
      band: "attention",
      numbers_visible: viewerScope === "admin",
      target_href: "/drive?project_id=98000000-0000-4000-8000-000000000002",
      signals: [
        { key: "open_work_items", count: 7, band: "attention", target_href: "/" },
        { key: "overdue_work_items", count: 1, band: "attention", target_href: "/calendar" },
        { key: "pending_approvals", count: 0, band: "healthy", target_href: "/approvals" }
      ]
    }]
  };
}

test("R5.7 health route component renders banded project cards with product-route targets", () => {
  const member = renderWebRouteComponent({ key: "health", health: projectHealthPageVm() }, { locale: "en-US" });
  const admin = renderWebRouteComponent({ key: "health", health: projectHealthPageVm("admin") }, { locale: "zh-CN" });

  assert.equal(member.key, "health");
  assert.equal(member.html.includes('data-r5-7-health-route="true"'), true);
  assert.equal(member.html.includes('data-r5-7-health-viewer-scope="member"'), true);
  assert.equal(member.html.includes('data-r5-7-health-bands-only="true"'), true);
  assert.equal(member.html.includes("Open items: Needs attention"), true);
  assert.equal(member.html.includes("Open items: 7"), false);
  assert.equal(member.primaryHrefs.includes("/drive?project_id=98000000-0000-4000-8000-000000000002"), true);
  assert.equal(member.primaryHrefs.some((href) => href.startsWith("/api/")), false);

  assert.equal(admin.html.includes('data-r5-7-health-viewer-scope="admin"'), true);
  assert.equal(admin.html.includes("进行中事项: 7"), true);
  assert.equal(admin.html.includes('data-r5-7-health-bands-only="true"'), false);
  assert.equal(admin.html.includes("项目健康"), true);
  assertNoMainWindowBoundaryLeak(member.html);
});

test("R5.7 notification grounding renders reason and evidence refs into the inbox rows", () => {
  const vm = notificationPageVm();
  const first = vm.buckets.needs_decision[0]!;
  first.grounding = {
    reason_text: "This item is waiting for your decision.",
    evidence_refs: [
      { kind: "knowledge_search", label: "Find related evidence", href: `/knowledge/search?q=pricing&source_ref=notification:${first.id}` },
      { kind: "agent_run_replay", label: "Open execution replay", href: "/agent-runs/98000000-0000-4000-8000-000000000009/replay" }
    ]
  };
  const rendered = renderWebRouteComponent({ key: "notifications", notifications: vm }, { locale: "en-US" });

  assert.equal(rendered.html.includes('data-r5-7-notification-grounding="true"'), true);
  assert.equal(rendered.html.includes('data-r5-7-notification-evidence-ref="knowledge_search"'), true);
  assert.equal(rendered.html.includes('data-r5-7-notification-evidence-ref="agent_run_replay"'), true);
  assert.equal(rendered.html.includes("Why am I seeing this"), true);
  assert.equal(rendered.html.includes("source_ref=notification:"), true);
  assertNoMainWindowBoundaryLeak(rendered.html);
});

test("R5.7 knowledge route component shows the notification search context strip", () => {
  const vm = surfaceVm();
  const withRef = renderWebRouteComponent({
    key: "knowledge",
    evidence: vm.page_vms.evidence,
    sourceRef: "notification:98000000-0000-4000-8000-000000000010"
  }, { locale: "zh-CN" });
  const withoutRef = renderWebRouteComponent({ key: "knowledge", evidence: vm.page_vms.evidence }, { locale: "zh-CN" });

  assert.equal(withRef.html.includes('data-r5-7-knowledge-source-ref="notification:98000000-0000-4000-8000-000000000010"'), true);
  assert.equal(withRef.html.includes("来自通知的相关资料"), true);
  assert.equal(withoutRef.html.includes("data-r5-7-knowledge-source-ref"), false);
});

test("R5.9 onboarding screen renders bilingual registration card with deep link promise", () => {
  const zh = renderOnboardingScreen({ locale: "zh-CN", targetRoute: "/approvals" });
  const en = renderOnboardingScreen({ locale: "en-US", errorText: "该昵称是管理员账号，需要管理员口令才能在新设备登录" });

  assert.equal(zh.html.includes('data-r4-web-route-status="onboarding"'), true);
  assert.equal(zh.html.includes('data-r5-9-onboarding="true"'), true);
  assert.equal(zh.html.includes('data-r5-9-onboarding-locale="zh-CN"'), true);
  assert.equal(zh.html.includes("报到后开始干活"), true);
  assert.equal(zh.html.includes('data-r5-9-onboarding-nickname="true"'), true);
  assert.equal(zh.html.includes('data-r5-9-onboarding-admin-secret="true"'), true);
  assert.equal(zh.html.includes('data-r5-9-onboarding-target="/approvals"'), true);
  assert.equal(zh.html.includes("data-r5-9-onboarding-error"), false);

  assert.equal(en.html.includes("Sign in to get to work"), true);
  assert.equal(en.html.includes('data-r5-9-onboarding-error="true"'), true);
  assert.equal(en.html.includes("管理员口令才能在新设备登录"), true);
  assert.equal(en.html.includes("data-r5-9-onboarding-target"), false);
});

test("R5.9 product shell shows the current user chip with logout and admin tag", () => {
  const vm = surfaceVm();
  const rendered = renderGoldPathSurface(vm, "web", { locale: "zh-CN" });
  const withUser = renderWebProductShell(rendered, {
    appName: "WorkHub",
    surfaceLabel: "Web R4",
    currentRoute: "/",
    locale: "zh-CN",
    linkMode: "path",
    renderActivePanelOnly: true,
    currentUser: { nickname: "小拓", isAdmin: true }
  });
  const withoutUser = renderWebProductShell(rendered, {
    appName: "WorkHub",
    surfaceLabel: "Web R4",
    currentRoute: "/",
    locale: "en-US",
    linkMode: "path",
    renderActivePanelOnly: true
  });

  assert.equal(withUser.html.includes('data-wh-current-user="小拓"'), true);
  assert.equal(withUser.html.includes('data-wh-current-user-admin="true"'), true);
  assert.equal(withUser.html.includes('data-wh-logout="true"'), true);
  assert.equal(withUser.html.includes("退出"), true);
  assert.equal(withUser.html.includes("管理员"), true);
  assert.equal(withoutUser.html.includes("data-wh-current-user"), false);
  assert.equal(withoutUser.html.includes("data-wh-logout"), false);
});

test("W2 approval workbench renders diff/checks/timeline/discussion markers + reason/remember controls", () => {
  const vm = surfaceVm();
  const firstApprovalId = vm.page_vms.approvals.items[0]?.id;
  assert.ok(firstApprovalId);
  const firstDetail = vm.page_vms.approvals.items_detail[firstApprovalId];
  assert.ok(firstDetail);
  vm.page_vms.approvals.items_detail[firstApprovalId] = {
    ...firstDetail,
    comments_page_info: { limit: 20, returned: 20, has_more: true }
  };
  const approvals = renderWebRouteComponents(vm, { locale: "zh-CN" }).approvals;
  assert.ok(approvals);
  const html = approvals.html;
  // 中栏每事项详情面板 + 选中项 deliverable diff 工作台。
  assert.equal(html.includes("data-r4-approval-detail-for="), true);
  assert.equal(html.includes('data-r4-approval-detail-kind="deliverable"'), true);
  assert.equal(html.includes('data-r4-approval-diff="true"'), true);
  assert.equal(html.includes('data-r4-approval-checks="true"'), true);
  assert.equal(html.includes('data-r4-approval-ai="true"'), true);
  // 审批流程时间线。
  assert.equal(html.includes('data-r4-approval-timeline="true"'), true);
  assert.equal(html.includes("data-r4-approval-timeline-step="), true);
  // 相关讨论：评论行 + 发表表单。
  assert.equal(html.includes('data-r4-approval-discussion="true"'), true);
  assert.equal(html.includes("data-r4-approval-comment="), true);
  assert.equal(html.includes('data-r4-approval-comments-overflow="true"'), true);
  assert.equal(html.includes("仅显示最新的讨论"), true);
  assert.equal(html.includes("data-r4-approval-comment-form="), true);
  // 右栏决策面板：理由框 + 记住勾选（默认未勾）。
  assert.equal(html.includes("data-r4-approval-reason"), true);
  assert.equal(html.includes("data-r4-approval-remember"), true);
  assert.equal(html.includes("checked"), false);
  // 既有标记仍在（不破 smoke）。
  assert.equal(html.includes('data-r4-approval-routed="true"'), true);
  assert.equal(html.includes("data-requires-reason=\"true\""), true);
});
