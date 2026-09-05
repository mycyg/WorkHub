import assert from "node:assert/strict";
import test from "node:test";

import { createP05GoldPathFixture, validateP05GoldPathFixture } from "@workhub/agent/fixtures";
import type { AgentArmyDashboardVM, AttentionItem, AuditLogFact, CalendarPageVM, ConversationMessageVM, DrivePageVM, ProjectHealthPageVM, EvidenceBubble, GoldPathSurfaceVM, MeetingPageVM, NotificationPageVM, ProjectListVM, ProposalConflict, ProposalDetailVM, SessionVM, SettingsPageVM, WorkItemComment, WorkItemDetailVM } from "@workhub/contracts";

import { renderAgentRunReplay } from "../replay/index.js";
import { formatLocalDate, formatLocalTimestamp } from "../i18n.js";
import {
  renderWebRouteComponent,
  renderWebRouteComponents,
  renderWorkItemAuditTimelineRows,
  // R23 P4（R20 P2A 端点上界面）：评论流与工作区审计流的纯行渲染。
  renderWorkItemCommentRows,
  renderWorkspaceAuditRows
} from "./route-components.js";
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
    ai_analysis_configured: true,
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
        ],
        actions: {
          reanalyze: {
            id: "meeting_reanalyze",
            label: "Regenerate minutes",
            method: "POST",
            href: "/api/meetings/95000000-0000-4000-8000-000000000002/analyze"
          }
        }
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
      base_url_configured: true
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
      objective_progress_pct: 40,
      budget_href: "/dashboard/cost",
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

// 普通用户审查（IA 翻转）：R8 曾钉「项目桌在前」，但每天来拍板的人不该先滚过两张常青说明卡——
// 决策区（含紧急升级卡）永远第一屏，项目桌其后。
test("Home route leads with the decision queue before the project desk", () => {
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
  assert.ok(en.html.indexOf('data-r4-home-decision="true"') < en.html.indexOf('data-r8-home-project-desk="true"'));
  // homeProjectListVm() 的项目没带 owner_user_id（只有 owner_nickname）——负责人头像 tile 只在
  // owner_user_id 存在时才铺，这里没有就该没有，不编一个假 id。
  assert.equal(en.html.includes("data-r14-avatar-tile-user-id"), false);
  assertNoMainWindowBoundaryLeak(en.html);
});

// R14 批 CHAT（web-avatars）：project.owner_nickname + owner_user_id 一直配对出现在 ProjectListVM
// 里，此前"负责人 · {昵称}"药丸从没带过头像——首页项目桌与 /projects 列表两个渲染点都要铺。
test("R14 CHAT Home and Projects route components show an owner avatar tile when owner_user_id is present", () => {
  const vm = surfaceVm();
  const projectsWithOwner: ProjectListVM = {
    generated_at: "2026-06-11T09:00:00.000Z",
    projects: [{
      id: "93000000-0000-4000-8000-000000000001",
      name: "R14 Workspace",
      slug: "r14-workspace",
      owner_nickname: "王五",
      owner_user_id: "93000000-0000-4000-8000-000000000555",
      archived: false,
      created_at: "2026-06-11T08:00:00.000Z",
      updated_at: "2026-06-11T09:00:00.000Z",
      open_work_item_count: 1
    }]
  };
  const home = renderWebRouteComponent({
    key: "home",
    attention: vm.page_vms.attention,
    projects: projectsWithOwner
  }, { locale: "zh-CN" });
  assert.equal(home.html.includes('data-r14-avatar-tile-user-id="93000000-0000-4000-8000-000000000555"'), true);
  assertNoMainWindowBoundaryLeak(home.html);

  const projects = renderWebRouteComponent({ key: "projects", projects: projectsWithOwner }, { locale: "zh-CN" });
  assert.equal(projects.html.includes('data-r14-avatar-tile-user-id="93000000-0000-4000-8000-000000000555"'), true);
  assertNoMainWindowBoundaryLeak(projects.html);
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

// B-R9.6 §3.7：sync_conflict 主卡渲「合并成一条（可编辑）」的可编辑草稿框（预填
// merge 动作 request_json.value_md），并露出全部四动作 + B 出处链接。
test("B-R9.6 Home route renders the editable merge draft on sync_conflict cards", () => {
  const base = surfaceVm();
  const conflict: AttentionItem = {
    id: "94000000-0000-4000-8000-000000000121",
    kind: "sync_conflict",
    priority: "high",
    source_ref: {
      entity_type: "agent_run",
      entity_id: "94000000-0000-4000-8000-000000000122"
    },
    title: "Cuu 学到了两条打架的偏好",
    summary_text: "偏好「reply_style」出现两种说法，需要确认后再晋升。",
    reason_text: "A：回复要长。\nB：回复只给结论。",
    actions: [
      { id: "keep_current", label: "要 A", style: "secondary", method: "POST", href: "/api/memory-conflicts/94000000-0000-4000-8000-000000000121/resolve/keep_current?expected_updated_at=2026-07-02T16%3A00%3A00.000Z" },
      { id: "accept_incoming", label: "要 B", style: "primary", method: "POST", href: "/api/memory-conflicts/94000000-0000-4000-8000-000000000121/resolve/accept_incoming?expected_updated_at=2026-07-02T16%3A00%3A00.000Z" },
      { id: "discard_both", label: "都不要", style: "danger", method: "POST", href: "/api/memory-conflicts/94000000-0000-4000-8000-000000000121/resolve/discard_both?expected_updated_at=2026-07-02T16%3A00%3A00.000Z" },
      { id: "merge_both", label: "合并成一条（可编辑）", style: "secondary", method: "POST", href: "/api/memory-conflicts/94000000-0000-4000-8000-000000000121/resolve/merge_both?expected_updated_at=2026-07-02T16%3A00%3A00.000Z", request_json: { value_md: "回复要长。\n回复只给结论。" } },
      { id: "open_incoming_source", label: "看 B 的出处", style: "quiet", method: "GET", href: "/agent-runs/94000000-0000-4000-8000-000000000122/replay" }
    ],
    cuu_state: "worried",
    created_at: "2026-07-02T16:00:00.000Z"
  };
  const home = renderWebRouteComponent({
    key: "home",
    attention: {
      ...base.page_vms.attention,
      primary: conflict,
      queue: [conflict]
    }
  }, { locale: "zh-CN" });

  assert.equal(home.html.includes('data-r9-sync-merge-value="true"'), true);
  assert.equal(home.html.includes("回复要长。"), true);
  assert.equal(home.html.includes("都不要"), true);
  assert.equal(home.html.includes("合并成一条（可编辑）"), true);
  assert.equal(home.html.includes("看 B 的出处"), true);
  assertNoMainWindowBoundaryLeak(home.html);
});

test("R9.0 Home route renders escalation cards localized for English readers", () => {
  // ux-flow-spec §3.3 双语文案：en-US 下标题与三动作都要真实渲染英文（API 按 locale 产出，
  // web 层不许中文裸奔）。
  const base = surfaceVm();
  const escalation: AttentionItem = {
    id: "94000000-0000-4000-8000-000000000111",
    kind: "escalation",
    priority: "urgent",
    work_item_id: "94000000-0000-4000-8000-000000000112",
    project_id: "94000000-0000-4000-8000-000000000113",
    source_ref: {
      entity_type: "escalation_event",
      entity_id: "94000000-0000-4000-8000-000000000111"
    },
    title: "\"Competitor pricing research\" needs a decision",
    summary_text: "The AI is unsure about its data sources.",
    reason_text: "The AI is unsure about its data sources.",
    actions: [
      { id: "escalation_retry", label: "Let it retry", style: "primary", method: "POST", href: "/api/escalations/94000000-0000-4000-8000-000000000111/resolve" },
      { id: "escalation_pm_mode", label: "I'll take over", style: "secondary", method: "POST", href: "/api/escalations/94000000-0000-4000-8000-000000000111/resolve" },
      { id: "escalation_cancel", label: "Cancel this subtask", style: "danger", method: "POST", href: "/api/escalations/94000000-0000-4000-8000-000000000111/resolve" }
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
  }, { locale: "en-US" });

  assert.equal(home.html.includes("&quot;Competitor pricing research&quot; needs a decision"), true);
  assert.equal(home.html.includes("Let it retry"), true);
  assert.equal(home.html.includes("I&#39;ll take over") || home.html.includes("I'll take over"), true);
  assert.equal(home.html.includes("Cancel this subtask"), true);
  // 周边 chrome（kind/priority 药丸等）也不许残留中文动作词。
  assert.equal(home.html.includes("让它重试"), false);
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
    summary_text: "计划已确认，可以批准为待开始计划。",
    actions: [
      {
        id: "approve_and_dispatch",
        label: "批准并开始执行",
        style: "primary",
        method: "POST",
        href: "/api/proposals/94000000-0000-4000-8000-000000000111/merge",
        request_json: { dispatch: true }
      },
      {
        id: "approve_hold",
        label: "批准但先不跑",
        style: "secondary",
        method: "POST",
        href: "/api/proposals/94000000-0000-4000-8000-000000000111/merge",
        request_json: { dispatch: false }
      },
      {
        id: "open_proposal",
        label: "查看计划提议",
        style: "secondary",
        method: "GET",
        href: "/proposals/94000000-0000-4000-8000-000000000111"
      }
    ]
  };

  const approvals = renderWebRouteComponents(vm, { locale: "zh-CN" }).approvals;

  assert.ok(approvals);
  assert.equal(approvals.html.includes("计划审阅"), true);
  assert.equal(approvals.html.includes("data-action-id=\"approve_hold\""), true);
  assert.equal(approvals.html.includes("&quot;dispatch&quot;:false"), true);
  assert.equal(approvals.html.includes("plan_review"), false);
  assert.equal(approvals.html.includes("Plan Review"), false);
  // 规格 §3.3/§3.7：plan_review 卡标题必须带工作项名真实渲出，禁止通用文案覆盖。
  assert.equal(approvals.html.includes("《短剧选题调研》的分工计划等你过目"), true);
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
  assert.equal(workitem.html.includes("AI work replay"), true);
  assert.equal(workitem.html.includes("Acceptance checklist"), true);
  assert.equal(workitem.html.includes("data-method=\"GET\""), true);
  assert.equal(workitem.html.includes('data-s1-day2-post-run-next-action="proposal"'), true);
  assert.equal(workitem.html.includes('data-s1-day2-post-run-next-action="replay"'), true);
  assert.deepEqual(workitem.primaryHrefs.includes(`/proposals/${vm.page_vms.proposal.proposal_id}`), true);
  assertNoMainWindowBoundaryLeak(workitem.html);
});

// R20 R19-27（根因）：后端早有跨 run 审计时间线端点（GET /api/workitems/:id/audit，packages/db
// audit-repository 有测试），但 web 工作项详情页此前完全不渲染它——这个断言此前必然失败（页面里压根
// 没有这段标记）。时间线本体是客户端异步水合（apps/web/src/browser.ts），这里只锁定 route-components
// 出的占位卡：正确的 data-* 挂载点（供 browser.ts 找到并水合）+ 本地化的加载中文案，两种语言都要有。
test("R20 R19-27 WorkItem route component renders a hydration slot for the cross-run audit timeline", () => {
  const vm = surfaceVm();
  const zh = renderWebRouteComponents(vm, { locale: "zh-CN" }).workitem;
  const en = renderWebRouteComponents(vm, { locale: "en-US" }).workitem;
  assert.ok(zh);
  assert.ok(en);

  assert.equal(zh.html.includes('data-r20-workitem-audit-timeline="true"'), true);
  assert.equal(zh.html.includes(`data-r20-workitem-audit-timeline-workitem="${vm.page_vms.workitem.workitem.id}"`), true);
  assert.equal(zh.html.includes('data-r20-workitem-audit-timeline-body="true"'), true);
  assert.equal(zh.html.includes('data-r20-workitem-audit-timeline-loading="true"'), true);
  assert.equal(zh.html.includes("正在加载审计记录"), true);
  assert.equal(en.html.includes("Loading audit history"), true);
  assertNoMainWindowBoundaryLeak(zh.html);
  assertNoMainWindowBoundaryLeak(en.html);
});

// R20 R19-27：审计时间线的行渲染是纯函数（renderWorkItemAuditTimelineRows），供 browser.ts 拉到数据后
// 复用；这里直接单测它——本地化动作/操作者标签、时间戳、撤销标记、以及 evidenceRows 同款的截断诚实
// 提示（"还有 N 条…（共 M 条）"），不能让审阅者以为已经看全。
test("R20 R19-27 renderWorkItemAuditTimelineRows localizes action/actor labels, marks undone entries, and truncates honestly", () => {
  const baseEntry: AuditLogFact = {
    id: "audit-1",
    actor: { actor_kind: "human", actor_nickname: "小拓" },
    entity: { entity_type: "work_item", entity_id: "work-1" },
    action: "work_item.created",
    detail_json: {},
    created_at: "2026-07-10T09:00:00.000Z"
  };

  const empty = renderWorkItemAuditTimelineRows([], "en-US");
  assert.equal(empty.includes("No audit history yet"), true);

  const zhRows = renderWorkItemAuditTimelineRows([baseEntry], "zh-CN");
  assert.equal(zhRows.includes('data-r20-workitem-audit-entry="audit-1"'), true);
  assert.equal(zhRows.includes('data-r20-workitem-audit-entry-action="work_item.created"'), true);
  assert.equal(zhRows.includes("创建任务"), true);
  assert.equal(zhRows.includes("小拓"), true);
  // UI-02：时间戳按本地时区渲染——日期部分由格式化助手算出（时区无关）。
  assert.equal(zhRows.includes(formatLocalDate("2026-07-10T09:00:00.000Z")), true);

  const aiEntry: AuditLogFact = {
    ...baseEntry,
    id: "audit-2",
    actor: { actor_kind: "ai" },
    action: "snapshot.reverted",
    undone_at: "2026-07-10T09:05:00.000Z"
  };
  const enRows = renderWorkItemAuditTimelineRows([aiEntry], "en-US");
  assert.equal(enRows.includes("File snapshot reverted"), true);
  assert.equal(enRows.includes("AI (undone)"), true);

  // Unknown/future action strings must not leak the raw machine token — they fall back to a
  // humanized (dot/underscore stripped, title-cased) rendering instead.
  const unknownAction: AuditLogFact = { ...baseEntry, id: "audit-3", action: "some_future.action_kind" };
  const unknownRows = renderWorkItemAuditTimelineRows([unknownAction], "en-US");
  assert.equal(unknownRows.includes("Some Future Action Kind"), true);

  const many: AuditLogFact[] = Array.from({ length: 11 }, (_, index) => ({
    ...baseEntry,
    id: `audit-many-${index}`
  }));
  const truncated = renderWorkItemAuditTimelineRows(many, "zh-CN");
  assert.equal(truncated.includes('data-r20-workitem-audit-timeline-overflow="3"'), true);
  assert.equal(truncated.includes("还有 3 条审计记录未展开（共 11 条）"), true);
  assert.equal(truncated.includes("audit-many-7"), true, "the 8th visible entry must still be rendered");
  assert.equal(truncated.includes("audit-many-8"), false, "the 9th entry must be truncated, not silently rendered");
});

// R14 批 CHAT（web-avatars）：claimed_by_user_id/claimed_by_nickname 一直在契约里，web 端此前从没
// 渲过——工单详情页从没说过"这活现在是谁在认领"。新增文字 + 头像 tile 一起铺，未认领时两者都不出现。
test("R14 CHAT WorkItem route component shows an assignee avatar tile once the item is claimed", () => {
  const base = surfaceVm().page_vms.workitem;
  assert.equal(base.workitem.claimed_by_user_id, undefined);
  const unclaimed = renderWebRouteComponent({ key: "workitem", workitem: base }, { locale: "en-US" });
  assert.equal(unclaimed.html.includes('data-r14-workitem-claimed-by="true"'), false);
  assert.equal(unclaimed.html.includes("data-r14-avatar-tile-user-id"), false);

  const claimedVm: WorkItemDetailVM = {
    ...base,
    workitem: {
      ...base.workitem,
      claimed_by_user_id: "93000000-0000-4000-8000-000000000777",
      claimed_by_nickname: "李雷"
    }
  };
  const claimed = renderWebRouteComponent({ key: "workitem", workitem: claimedVm }, { locale: "zh-CN" });
  assert.equal(claimed.html.includes('data-r14-workitem-claimed-by="true"'), true);
  assert.equal(claimed.html.includes('data-r14-avatar-tile-user-id="93000000-0000-4000-8000-000000000777"'), true);
  assert.equal(claimed.html.includes("负责人 · 李雷"), true);
  assertNoMainWindowBoundaryLeak(claimed.html);
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
  // UI-02：时间戳按本地时区渲染——期望值由同一格式化助手算出（时区无关），同时断言不再 UTC 直出。
  assert.equal(workitem.html.includes(`<span class="wh-pill">${formatLocalTimestamp("2026-07-03T10:24:00.000Z")}</span>`), true);
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

  assert.equal(workitem.html.includes('data-action-id="create_task_plan" role="button" data-method="POST"'), true);
  assert.equal(workitem.html.includes(`/api/workitems/${cleanSpecReady.workitem.id}/task-plan`), true);
  assert.equal(workitem.html.includes('data-action-id="start_agent_run"'), false);
});

// R13 批 P4（全托管透明度：reviewer_kind 溯源）：ai 复核合并的交付物要显示过去时提示，
// 且把握度 pill 上补过去时的「已自动采纳」（未发生时只显示把握度三句话，不预告资格）。
test("R13 P4 WorkItem route component marks AI-auto-merged deliverables with a past-tense notice", () => {
  const base = surfaceVm().page_vms.workitem;
  const aiMergedVm: WorkItemDetailVM = {
    ...base,
    confidence: { score: 0.9, grade: "high", verdict: "auto_merge" },
    accepted_deliverables: [{
      id: "93000000-0000-4000-8000-000000000601",
      work_item_id: base.workitem.id,
      proposal_id: "93000000-0000-4000-8000-000000000602",
      change_id: "93000000-0000-4000-8000-000000000603",
      target_kind: "text_doc",
      target_key: "delivery:/outputs/report.md",
      change_type: "updated",
      accepted_version: 1,
      target_path: "/outputs/report.md",
      reviewer_kind: "ai",
      accepted_at: "2026-07-13T00:00:00.000Z"
    }]
  };
  const workitem = renderWebRouteComponent({ key: "workitem", workitem: aiMergedVm }, { locale: "zh-CN" });

  assert.equal(workitem.html.includes('data-r13-workitem-accepted-reviewer-kind="ai"'), true);
  assert.equal(workitem.html.includes("已由 AI 自动合并，无人工复核。"), true);
  assert.equal(workitem.html.includes('data-r13-workitem-confidence-auto-merged="true"'), true);
  assert.equal(workitem.html.includes("已自动采纳"), true);
  assert.equal(workitem.html.includes("可自动采纳"), false);
});

test("R13 P4 WorkItem route component shows only the confidence wording when auto_merge has not actually merged anything yet", () => {
  const base = surfaceVm().page_vms.workitem;
  const notYetMergedVm: WorkItemDetailVM = {
    ...base,
    confidence: { score: 0.9, grade: "high", verdict: "auto_merge" },
    accepted_deliverables: []
  };
  const workitem = renderWebRouteComponent({ key: "workitem", workitem: notYetMergedVm }, { locale: "zh-CN" });

  assert.equal(workitem.html.includes('data-r13-workitem-confidence-auto-merged="false"'), true);
  assert.equal(workitem.html.includes("我比较有把握"), true);
  assert.equal(workitem.html.includes("已自动采纳"), false);
  assert.equal(workitem.html.includes("已由 AI 自动合并，无人工复核。"), false);
});

test("R13 P4 WorkItem route component leaves human-reviewed deliverables without the AI auto-merge notice", () => {
  const base = surfaceVm().page_vms.workitem;
  const humanReviewedVm: WorkItemDetailVM = {
    ...base,
    accepted_deliverables: [{
      id: "93000000-0000-4000-8000-000000000604",
      work_item_id: base.workitem.id,
      proposal_id: "93000000-0000-4000-8000-000000000605",
      change_id: "93000000-0000-4000-8000-000000000606",
      target_kind: "text_doc",
      target_key: "delivery:/outputs/report-2.md",
      change_type: "updated",
      accepted_version: 1,
      target_path: "/outputs/report-2.md",
      reviewer_kind: "human",
      accepted_at: "2026-07-13T00:00:00.000Z"
    }]
  };
  const workitem = renderWebRouteComponent({ key: "workitem", workitem: humanReviewedVm }, { locale: "zh-CN" });

  assert.equal(workitem.html.includes('data-r13-workitem-accepted-reviewer-kind="human"'), true);
  assert.equal(workitem.html.includes("已由 AI 自动合并，无人工复核。"), false);
});

// R13 批 P4（观察者工单来源标注）：与 drive_comment/meeting_insight 平级——没有正文可显示，只标注来源会话。
test("R13 P4 WorkItem route component renders the conversation-observer source context", () => {
  const base = surfaceVm().page_vms.workitem;
  const observerVm: WorkItemDetailVM = {
    ...base,
    source_context: {
      source_type: "conversation_observer",
      project_id: "93000000-0000-4000-8000-000000000701",
      conversation_id: "93000000-0000-4000-8000-000000000702",
      created_at: "2026-07-05T00:00:00.000Z"
    }
  };
  const workitem = renderWebRouteComponent({ key: "workitem", workitem: observerVm }, { locale: "zh-CN" });

  assert.equal(workitem.html.includes('data-r5-workitem-source-context="conversation_observer"'), true);
  assert.equal(workitem.html.includes('data-r13-workitem-source-conversation-id="93000000-0000-4000-8000-000000000702"'), true);
  assert.equal(workitem.html.includes("由项目群聊的 Cuu 观察者创建。"), true);
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
  assert.equal(workitem.html.includes("军团进行中 1/2"), true);
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

// B-R9.6 UX 审计（H1 卡位）：同一卡位按数据形态切换——军团活跃/终态只渲军团面板，
// 草稿/待审/已取消只渲计划快照面板（含审批黄条），绝不双渲。
test("B-R9.6 workitem plan slot switches between plan snapshot and army panel by status", () => {
  const base = surfaceVm().page_vms.workitem;
  const planId = "93000000-0000-4000-8000-000000000901";
  const teamBase = {
    plan_id: planId,
    completed_count: 1,
    total_count: 3,
    cost_used_cny: "1.250000",
    runs_capped: false,
    items: []
  };
  const planBase = {
    id: planId,
    work_item_id: "93000000-0000-4000-8000-000000000902",
    workspace_id: "93000000-0000-4000-8000-000000000903",
    status: "proposed" as const,
    budget_json: {},
    decomposition_context_json: {},
    created_by: "93000000-0000-4000-8000-000000000904",
    created_at: "2026-07-02T16:00:00.000Z",
    updated_at: "2026-07-02T16:00:00.000Z",
    items: [],
    items_capped: false
  };
  const proposedVm: WorkItemDetailVM = {
    ...base,
    task_plan: planBase,
    agent_team: { ...teamBase, status: "proposed" }
  };
  const proposed = renderWebRouteComponent({ key: "workitem", workitem: proposedVm }, { locale: "zh-CN" });
  assert.equal(proposed.html.includes('data-r9-task-plan-panel="true"'), true);
  assert.equal(proposed.html.includes('data-r9-agent-team-panel="true"'), false);
  assert.equal(proposed.html.includes("军团进行中"), false);

  const dispatchingVm: WorkItemDetailVM = {
    ...base,
    task_plan: { ...planBase, status: "dispatching" },
    agent_team: { ...teamBase, status: "dispatching" }
  };
  const dispatching = renderWebRouteComponent({ key: "workitem", workitem: dispatchingVm }, { locale: "zh-CN" });
  assert.equal(dispatching.html.includes('data-r9-agent-team-panel="true"'), true);
  assert.equal(dispatching.html.includes('data-r9-task-plan-panel="true"'), false);

  // UX-M13：等人拍板黄条 + UX-M2 终态复盘尾行 + 顶部徽章细化。
  const bannerVm: WorkItemDetailVM = {
    ...base,
    agent_team: {
      ...teamBase,
      status: "dispatching",
      items: [
        {
          task_plan_item_id: "93000000-0000-4000-8000-000000000905",
          seq: 1,
          title: "复核风险",
          role: "review",
          plan_status: "failed",
          status: "needs_human",
          budget_share_pct: 30,
          depends_on: [],
          waiting_for_seq: [],
          replay_href: "/agent-runs/93000000-0000-4000-8000-000000000906/replay"
        }
      ]
    }
  };
  const banner = renderWebRouteComponent({ key: "workitem", workitem: bannerVm }, { locale: "zh-CN" });
  assert.equal(banner.html.includes('data-r9-agent-team-banner="needs_human"'), true);
  assert.equal(banner.html.includes("1 个子任务需要你拍板"), true);
  assert.equal(banner.html.includes("军团进行中 1/3"), true, "顶部徽章细化为军团标题");

  const retroVm: WorkItemDetailVM = {
    ...base,
    agent_team: {
      ...teamBase,
      status: "done",
      completed_count: 2,
      total_count: 3,
      items: [
        {
          task_plan_item_id: "93000000-0000-4000-8000-000000000907",
          seq: 1,
          title: "查资料",
          role: "research",
          plan_status: "succeeded",
          status: "succeeded",
          budget_share_pct: 30,
          depends_on: [],
          waiting_for_seq: [],
          replay_href: "/agent-runs/93000000-0000-4000-8000-000000000908/replay"
        }
      ]
    }
  };
  const retro = renderWebRouteComponent({ key: "workitem", workitem: retroVm }, { locale: "zh-CN" });
  assert.equal(retro.html.includes('data-r9-agent-team-retro="true"'), true);
  assert.equal(retro.html.includes("复盘：成功 1 · 失败 0 · 跳过 0"), true);
  // 有 replay 而无专门动作的行给「看轨迹」。
  assert.equal(retro.html.includes('data-r9-agent-team-trace="93000000-0000-4000-8000-000000000907"'), true);

  // 部分完成不许喊「已完成」。
  const partialVm: WorkItemDetailVM = {
    ...base,
    agent_team: { ...teamBase, status: "done" }
  };
  const partial = renderWebRouteComponent({ key: "workitem", workitem: partialVm }, { locale: "zh-CN" });
  assert.equal(partial.html.includes("军团部分完成 1/3"), true);
});

// B-R9.6 §3.1：VM 带 dispatch_control 才渲「暂停派发/恢复派发」按钮；paused 头行
// 要说「军团已暂停」而不是继续喊推进中。
test("B-R9.6 WorkItem agent team panel renders the dispatch control from the VM", () => {
  const base = surfaceVm().page_vms.workitem;
  const planId = "93000000-0000-4000-8000-000000000901";
  const teamBase = {
    plan_id: planId,
    completed_count: 1,
    total_count: 2,
    cost_used_cny: "1.250000",
    runs_capped: false,
    items: []
  };
  const dispatchingVm: WorkItemDetailVM = {
    ...base,
    agent_team: {
      ...teamBase,
      status: "dispatching",
      dispatch_control: {
        kind: "pause",
        label: "暂停派发",
        href: `/api/task-plans/${planId}/pause`,
        method: "POST"
      }
    }
  };
  const dispatching = renderWebRouteComponent({ key: "workitem", workitem: dispatchingVm }, { locale: "zh-CN" });
  assert.equal(dispatching.html.includes('data-r9-agent-team-dispatch-control="pause"'), true);
  assert.equal(dispatching.html.includes("暂停派发"), true);
  assert.equal(dispatching.html.includes(`href="/api/task-plans/${planId}/pause"`), true);
  assert.equal(dispatching.html.includes('data-method="POST"'), true);

  const pausedVm: WorkItemDetailVM = {
    ...base,
    agent_team: {
      ...teamBase,
      status: "paused",
      dispatch_control: {
        kind: "resume",
        label: "恢复派发",
        href: `/api/task-plans/${planId}/resume`,
        method: "POST"
      }
    }
  };
  const paused = renderWebRouteComponent({ key: "workitem", workitem: pausedVm }, { locale: "zh-CN" });
  assert.equal(paused.html.includes("军团已暂停 1/2"), true);
  assert.equal(paused.html.includes('data-r9-agent-team-dispatch-control="resume"'), true);
  assert.equal(paused.html.includes("恢复派发"), true);
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
  assert.equal(workitem.html.includes('data-action-id="drive_draft_to_proposal" role="button" data-method="POST"'), true);
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
  assert.equal(workitem.html.includes('data-action-id="meeting_draft_to_proposal" role="button" data-method="POST"'), true);
  assert.equal(workitem.primaryHrefs.includes("/api/meetings/workitems/10000000-0000-4000-8000-000000000202/proposal-draft"), true);
});

test("R9.1 proposal workbench renders the reviewed task plan item rows", () => {
  // workbench-read 验收：计划提议在工作台可读——行级视图带序号/角色徽章/验收/预算份额/依赖，
  // 数据源是 manifest machine_summary.task_plan_items（7.154），不是 markdown。
  const vm = surfaceVm();
  const planId = "95000000-0000-4000-8000-000000000701";
  const researchId = "95000000-0000-4000-8000-000000000711";
  const produceId = "95000000-0000-4000-8000-000000000712";
  const proposalVm = {
    ...vm.page_vms.proposal,
    title: "计划提议",
    manifest: {
      ...vm.page_vms.proposal.manifest,
      title: "计划提议",
      changes: [{
        ...vm.page_vms.proposal.manifest.changes[0]!,
        target_kind: "structured_record" as const,
        target_ref: { entity_type: "task_plan" as const, entity_id: planId },
        change_type: "generated" as const,
        human_summary: "新增可审的任务计划草稿。",
        machine_summary: {
          changed_fields: ["task_plan_items"],
          task_plan_items: [
            { id: researchId, seq: 0, title: "调研短剧选题证据", role: "research" as const, objective_md: "收集证据。", acceptance_md: "至少 3 条可核验来源。", budget_share_pct: 40, depends_on: [] },
            { id: produceId, seq: 1, title: "产出选题短报告", role: "produce" as const, objective_md: "写报告。", acceptance_md: "有结论与证据段。", budget_share_pct: 60, depends_on: [researchId] }
          ]
        }
      }]
    }
  };

  const zh = renderWebRouteComponent({ key: "proposal", proposal: proposalVm }, { locale: "zh-CN" });
  assert.equal(zh.html.includes('data-r9-plan-items="true"'), true);
  assert.equal(zh.html.includes('data-r9-plan-item-count="2"'), true);
  assert.equal(zh.html.includes("#1 调研短剧选题证据"), true);
  assert.equal(zh.html.includes("#2 产出选题短报告"), true);
  assert.equal(zh.html.includes("验收：至少 3 条可核验来源。"), true);
  assert.equal(zh.html.includes(">调研</span>"), true);
  assert.equal(zh.html.includes(">产出</span>"), true);
  assert.equal(zh.html.includes("预算 40%"), true);
  assert.equal(zh.html.includes("依赖 #1"), true);
  assert.equal(zh.html.includes("预算份额合计 100%"), true);
  // 角色不许裸枚举。
  assert.equal(zh.html.includes(">research<"), false);

  const en = renderWebRouteComponent({ key: "proposal", proposal: proposalVm }, { locale: "en-US" });
  assert.equal(en.html.includes(">Research</span>"), true);
  assert.equal(en.html.includes("Budget 40%"), true);
  assert.equal(en.html.includes("Depends on #1"), true);
});

test("R9.1 proposal workbench flags budget shares that do not sum to 100", () => {
  // §3.2 防呆（读侧红字）：份额和 92% → 红字「还差 8%」，data 探针供 smoke/交互层复用。
  const vm = surfaceVm();
  const planId = "95000000-0000-4000-8000-000000000702";
  const soloId = "95000000-0000-4000-8000-000000000721";
  const proposalVm = {
    ...vm.page_vms.proposal,
    manifest: {
      ...vm.page_vms.proposal.manifest,
      changes: [{
        ...vm.page_vms.proposal.manifest.changes[0]!,
        target_kind: "structured_record" as const,
        target_ref: { entity_type: "task_plan" as const, entity_id: planId },
        change_type: "generated" as const,
        machine_summary: {
          task_plan_items: [
            { id: soloId, seq: 0, title: "调研", role: "research" as const, objective_md: "收集。", acceptance_md: "3 条来源。", budget_share_pct: 92, depends_on: [] }
          ]
        }
      }]
    }
  };

  const zh = renderWebRouteComponent({ key: "proposal", proposal: proposalVm }, { locale: "zh-CN" });
  assert.equal(zh.html.includes('data-r9-plan-share-invalid="true"'), true);
  assert.equal(zh.html.includes("预算份额加起来是 92%"), true);
  assert.equal(zh.html.includes("还差 8%"), true);
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
  assert.equal(proposal.html.includes("Rollback snapshot kept (manual restore)"), true);
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
  assert.equal(proposal.html.includes(">Adopted</span>"), true);
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
  assert.equal(intake.html.includes("Type your answer"), true);
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

test("R10-0c intake start renders an explicit project picker instead of silently defaulting to the pilot project", () => {
  const withProjects = renderWebRouteComponent({
    key: "intake",
    start: true,
    projects: {
      generated_at: "2026-07-10T09:00:00.000Z",
      projects: [
        { id: "93000000-0000-4000-8000-000000000001", name: "区域发布资料库", slug: "regional", status: "active", open_workitem_count: 2, owner_label: "owner", last_activity_at: "2026-07-09T09:00:00.000Z" },
        { id: "93000000-0000-4000-8000-000000000002", name: "新一代客服平台", slug: "support", status: "active", open_workitem_count: 1, owner_label: "owner", last_activity_at: "2026-07-08T09:00:00.000Z" }
      ]
    } as never
  }, { locale: "zh-CN" });
  assert.equal(withProjects.html.includes('data-s4c-intake-project-select="true"'), true);
  // 首项默认选中（真活跃排序第一位），且保留「新建试点项目」兜底出路。
  assert.equal(withProjects.html.includes('value="93000000-0000-4000-8000-000000000001" selected'), true);
  assert.equal(withProjects.html.includes("＋ 新建试点项目"), true);

  // 无项目清单（拉取失败/零项目）退化为原试点起点，不渲空选择器。
  const withoutProjects = renderWebRouteComponent({ key: "intake", start: true }, { locale: "zh-CN" });
  assert.equal(withoutProjects.html.includes("data-s4c-intake-project-select"), false);
  assert.equal(withoutProjects.html.includes("试点项目"), true);

  // 绑定项目（从项目主页进入）优先于选择器——不重复渲选择器。
  const bound = renderWebRouteComponent({
    key: "intake",
    start: true,
    project: { id: "93000000-0000-4000-8000-000000000001", name: "区域发布资料库" }
  }, { locale: "zh-CN" });
  assert.equal(bound.html.includes("data-s4c-intake-project-select"), false);
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

// B-R9.6 §3.4：项目主页「进行中的工作」行尾军团 pill——带 army 的行渲「军团 done/total」，
// 不带的行不渲；不加新小节。
test("B-R9.6 project home rows show the army progress pill only for armied work items", () => {
  const vm = {
    generated_at: "2026-06-11T09:00:00.000Z",
    project: {
      id: "93000000-0000-4000-8000-000000000001",
      name: "R5 Workspace",
      slug: "r5-workspace",
      description: null,
      owner_label: "owner",
      status: "active" as const
    },
    summary: { open_work_item_count: 2, total_open_work_item_count: 2 },
    open_work_items: [
      {
        id: "94000000-0000-4000-8000-000000000001",
        code: "ALP-1",
        title: "上市材料准备",
        status: "ai_working",
        priority: "normal",
        href: "/workitems/94000000-0000-4000-8000-000000000001",
        army: { done: 2, total: 4 }
      },
      {
        id: "94000000-0000-4000-8000-000000000002",
        code: "ALP-2",
        title: "普通小活",
        status: "ai_working",
        priority: "normal",
        href: "/workitems/94000000-0000-4000-8000-000000000002"
      }
    ],
    drive: { file_count: 0, recent_files: [] },
    actions: {
      new_task: { id: "new_task", label: "新任务", method: "GET" as const, href: "/intake" },
      open_drive: { id: "open_drive", label: "打开网盘", method: "GET" as const, href: "/drive?project_id=93000000-0000-4000-8000-000000000001" }
    }
  };
  const projectHome = renderWebRouteComponent({ key: "project-home", project: vm }, { locale: "zh-CN" });
  assert.equal(projectHome.html.includes('data-r9-project-army-pill="94000000-0000-4000-8000-000000000001"'), true);
  // NAMING pass：pill 文案带「子任务」限定词，新人不再猜 2/4 是什么。
  assert.equal(projectHome.html.includes("军团子任务 2/4"), true);
  assert.equal(projectHome.html.includes('data-r9-project-army-pill="94000000-0000-4000-8000-000000000002"'), false);
  // R18-H1：项目主页「成员」摘要小块——SSR 骨架 + hydration 锚点（真计数/主区会话链接由 browser.ts 注入）。
  assert.equal(projectHome.html.includes('data-r18-project-home-members="true"'), true);
  assert.equal(projectHome.html.includes('data-r18-project-home-members-project="93000000-0000-4000-8000-000000000001"'), true);
  assert.equal(projectHome.html.includes('data-r18-project-home-members-body="true"'), true);
  assert.equal(projectHome.html.includes("正在加载成员摘要"), true);
  assertNoMainWindowBoundaryLeak(projectHome.html);
});

// R20 wave4（R19-1 OKR 前端接线）→ R23 F-01（OKR 列表/详情持久化）：/api/objectives（创建）与
// /api/objectives/:id/link（挂链）此前端点在但前端完全不可达；列表随后一度只是会话内内存态。
// 项目主页 OKR 卡——创建目标表单常渲（不依赖任何 GET，纯 POST 表单），列表容器只出 SSR 加载骨架
// （同 plansSection/membersSection 先例，真实列表由 browser.ts 客户端水合 GET
// /api/projects/:id/objectives 后填充，不在 SSR 内嵌）。
test("R20 wave4 (R19-1) / R23 F-01: project home renders an OKR card with a create-objective form and a loading skeleton for the persisted list", () => {
  const vm = {
    generated_at: "2026-06-11T09:00:00.000Z",
    project: {
      id: "93000000-0000-4000-8000-000000000001",
      name: "R5 Workspace",
      slug: "r5-workspace",
      description: null,
      owner_label: "owner",
      status: "active" as const
    },
    summary: { open_work_item_count: 0, total_open_work_item_count: 0 },
    open_work_items: [],
    drive: { file_count: 0, recent_files: [] },
    actions: {
      new_task: { id: "new_task", label: "新任务", method: "GET" as const, href: "/intake" },
      open_drive: { id: "open_drive", label: "打开网盘", method: "GET" as const, href: "/drive?project_id=93000000-0000-4000-8000-000000000001" }
    }
  };
  const projectHome = renderWebRouteComponent({ key: "project-home", project: vm }, { locale: "zh-CN" });
  assert.equal(projectHome.html.includes('data-r20-project-home-objectives="true"'), true);
  assert.equal(projectHome.html.includes('data-r20-project-home-objectives-project="93000000-0000-4000-8000-000000000001"'), true);
  assert.equal(projectHome.html.includes('data-r20-okr-create-form="true"'), true);
  assert.equal(projectHome.html.includes('data-r20-okr-title-input'), true);
  assert.equal(projectHome.html.includes('data-r20-okr-kr-input'), true);
  assert.equal(projectHome.html.includes('data-r20-okr-create-submit="true"'), true);
  assert.equal(projectHome.html.includes('data-r20-okr-list-loading="true"'), true);
  // R23 F-01：列表不再谎称「服务端没有列表端点」——GET /api/projects/:id/objectives 已就位。
  assert.doesNotMatch(projectHome.html, /服务端(暂不提供|没有)列出?全部/u);
  // 诚实缺省：文案不应暗示目标是「这个项目的」，因为 objectives 表没有 project_id（工作区级实体）。
  assert.doesNotMatch(projectHome.html, /项目目标/u);
  assertNoMainWindowBoundaryLeak(projectHome.html);
});

// R14 批 GH（07-gh-design.md §5.1）：项目主页 github_activities 区块——web 端消费。
test("R14 GH: project home renders recent GitHub activity with kind/state/author badges and a real external link", () => {
  const baseVm = {
    generated_at: "2026-07-14T09:00:00.000Z",
    project: {
      id: "93000000-0000-4000-8000-000000000001",
      name: "R5 Workspace",
      slug: "r5-workspace",
      description: null,
      owner_label: "owner",
      status: "active" as const
    },
    summary: { open_work_item_count: 0, total_open_work_item_count: 0 },
    open_work_items: [],
    drive: { file_count: 0, recent_files: [] },
    actions: {
      new_task: { id: "new_task", label: "新任务", method: "GET" as const, href: "/intake" },
      open_drive: { id: "open_drive", label: "打开网盘", method: "GET" as const, href: "/drive?project_id=93000000-0000-4000-8000-000000000001" }
    }
  };
  const withActivity = renderWebRouteComponent({
    key: "project-home",
    project: {
      ...baseVm,
      github_activities: [
        { kind: "commit" as const, title: "Fix flaky retry test", html_url: "https://github.com/octocat/Hello-World/commit/abc123", occurred_at: "2026-07-14T09:30:00.000Z", author_login: "octocat" },
        { kind: "pull_request" as const, title: "Add GitHub sync worker", html_url: "https://github.com/octocat/Hello-World/pull/42", occurred_at: "2026-07-13T08:00:00.000Z", author_login: "hubot", state: "merged" },
        { kind: "issue" as const, title: "Polling misses PR updates", html_url: "https://github.com/octocat/Hello-World/issues/7", occurred_at: "2026-07-12T07:00:00.000Z", state: "open" }
      ]
    }
  }, { locale: "zh-CN" });
  assert.equal(withActivity.html.includes("最近 GitHub 动态"), true);
  assert.equal(withActivity.html.includes("Fix flaky retry test"), true);
  assert.equal(withActivity.html.includes('href="https://github.com/octocat/Hello-World/commit/abc123"'), true);
  assert.equal(withActivity.html.includes('target="_blank"'), true);
  assert.equal(withActivity.html.includes('rel="noreferrer"'), true);
  assert.equal(withActivity.html.includes(">提交<"), true);
  assert.equal(withActivity.html.includes(">PR<"), true);
  assert.equal(withActivity.html.includes(">议题<"), true);
  assert.equal(withActivity.html.includes("merged"), true);
  assert.equal(withActivity.html.includes("octocat"), true);
  assert.equal(withActivity.html.includes("hubot"), true);
  assertNoMainWindowBoundaryLeak(withActivity.html);

  // G-web 止血批：无绑定/无活动时区块改为常渲——给出「去桌面客户端绑定」的空态引导，
  // 而不是悄悄消失（此前用户看不到这块能力存在过）。
  const withoutActivity = renderWebRouteComponent({ key: "project-home", project: baseVm }, { locale: "zh-CN" });
  assert.equal(withoutActivity.html.includes("最近 GitHub 动态"), true);
  assert.equal(withoutActivity.html.includes('data-r14-project-home-github="0"'), true);
  assert.equal(withoutActivity.html.includes('data-r14-project-home-github-empty="true"'), true);
  assert.equal(withoutActivity.html.includes("在桌面客户端项目设置中绑定 GitHub 后可见"), true);

  const en = renderWebRouteComponent({
    key: "project-home",
    project: {
      ...baseVm,
      github_activities: [
        { kind: "commit" as const, title: "Fix flaky retry test", html_url: "https://github.com/octocat/Hello-World/commit/abc123", occurred_at: "2026-07-14T09:30:00.000Z" }
      ]
    }
  }, { locale: "en-US" });
  assert.equal(en.html.includes("Recent GitHub activity"), true);
  assert.equal(en.html.includes(">Commit<"), true);
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
  assert.equal(intake.html.includes("创建任务"), true);
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

test("R14 batch SEARCH: search route component renders an honest empty-prompt shell when there is no query yet", () => {
  const en = renderWebRouteComponent({ key: "search" }, { locale: "en-US" });
  const zh = renderWebRouteComponent({ key: "search" }, { locale: "zh-CN" });

  assert.equal(en.key, "search");
  assert.equal(en.html.includes('data-r4-route-component="search"'), true);
  assert.equal(en.html.includes('data-r14-search-route="true"'), true);
  assert.equal(en.html.includes('data-r14-search-query=""'), true);
  assert.equal(en.html.includes('data-r14-search-status="prompt"'), true);
  assert.equal(en.html.includes("Type at least 2 characters to start searching."), true);
  assert.equal(en.html.includes('data-r14-search-results="true" hidden'), true);
  assert.equal(en.primaryHrefs.length, 0);
  assert.equal(zh.html.includes("输入至少 2 个字符开始搜索。"), true);
  assertNoMainWindowBoundaryLeak(en.html);
  assertNoMainWindowBoundaryLeak(zh.html);
});

test("R14 batch SEARCH: search route component gives a short-query prompt (not fake results) below 2 characters", () => {
  const en = renderWebRouteComponent({ key: "search", q: "a" }, { locale: "en-US" });

  assert.equal(en.html.includes('data-r14-search-query="a"'), true);
  assert.equal(en.html.includes('data-r14-search-status="prompt"'), true);
  assert.equal(en.html.includes("Your search needs at least 2 characters."), true);
  assert.equal(en.html.includes('data-r14-search-results="true" hidden'), true);
});

test("R14 batch SEARCH: search route component echoes a valid query into the form and reveals the (still empty) result groups for client hydration", () => {
  const zh = renderWebRouteComponent({ key: "search", q: "预算" }, { locale: "zh-CN" });

  assert.equal(zh.html.includes('data-r14-search-query="预算"'), true);
  assert.equal(zh.html.includes('value="预算"'), true);
  assert.equal(zh.html.includes('data-r14-search-status="loading"'), true);
  assert.equal(zh.html.includes("正在搜索…"), true);
  // 结果容器不再隐藏,但四个分组卡自身仍隐藏（无数据）,等客户端拉取后逐个揭示。
  assert.equal(/data-r14-search-results="true"\s*>/u.test(zh.html), true);
  assert.equal(zh.html.includes('data-r14-search-group="conversations" hidden'), true);
  assert.equal(zh.html.includes('data-r14-search-group="drive" hidden'), true);
  assert.equal(zh.html.includes('data-r14-search-group="work_items" hidden'), true);
  assert.equal(zh.html.includes('data-r14-search-group="meetings" hidden'), true);
  // 中文组标题：会话/网盘/任务/会议（用「任务」与本页其余导航措辞对齐，不是「工单」）。
  assert.equal(zh.html.includes("<h3 role=\"heading\" aria-level=\"2\">会话</h3>"), true);
  assert.equal(zh.html.includes("<h3 role=\"heading\" aria-level=\"2\">网盘</h3>"), true);
  assert.equal(zh.html.includes("<h3 role=\"heading\" aria-level=\"2\">任务</h3>"), true);
  assert.equal(zh.html.includes("<h3 role=\"heading\" aria-level=\"2\">会议</h3>"), true);
  // R15 批 web-mirror：web 现在有只读会话镜像可跳——SSR 骨架里的说明改为「在线镜像只读」语义
  // （真链接由客户端 bindSearchRoutePanel 用 deep_link 注入，见 apps/web/src/browser.ts）。
  assert.equal(zh.html.includes("在线镜像只读"), true);
  assertNoMainWindowBoundaryLeak(zh.html);
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

// R14 批 CHAT（web-avatars）：按人花费的每一行早就带 user_id + label 配对，只是此前只渲文字——
// 头像 tile 铺在名字前面。
test("R14 CHAT Cost route component shows an avatar tile for each spend-by-person row", () => {
  const vm = surfaceVm();
  const byUser = vm.page_vms.cost.by_user[0];
  assert.ok(byUser);
  const cost = renderWebRouteComponent({ key: "cost", cost: vm.page_vms.cost }, { locale: "zh-CN" });
  assert.equal(cost.html.includes(`data-r14-avatar-tile-user-id="${byUser.user_id}"`), true);
  assertNoMainWindowBoundaryLeak(cost.html);
});

test("R9.6 Agent dashboard route component renders observable dashboard cards without decision actions", () => {
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
  // R9.7 UX spec uses the web-facing concept name "军团"; the old "智能代理军团"
  // assertion was implementation copy, not the product glossary.
  assert.equal(agents.html.includes("军团"), true);
  assert.equal(agents.html.includes("智能代理军团"), false);
  assert.equal(agents.html.includes("竞品资料梳理"), true);
  assert.equal(agents.html.includes('data-r9-agent-plan-objective="96000000-0000-4000-8000-000000000003"'), true);
  assert.equal(agents.html.includes("目标 · 季度上市策略 · 40%"), true);
  assert.equal(agents.html.includes('data-r9-agent-plan-budget-link="96000000-0000-4000-8000-000000000001"'), true);
  assert.equal(agents.html.includes('href="/dashboard/cost"'), true);
  assert.equal(agents.html.includes("卡在: 竞品复核"), true);
  assert.equal(agents.html.includes("¥0.01"), true);
  assert.equal(agents.html.includes("¥3"), true);
  assert.equal(agents.html.includes("¥0.006"), false);
  assert.equal(agents.html.includes("¥3.000000"), false);
  assert.equal(agents.html.includes("判官"), false);
  assert.equal(agents.html.includes("追加预算继续"), false);
  assertNoMainWindowBoundaryLeak(agents.html);
});

test("R9.7 Agent dashboard renders cap warnings as visible product copy", () => {
  const agents = renderWebRouteComponent({
    key: "agents",
    agents: agentArmyDashboardVm({
      page_info: {
        plan_limit: 20,
        returned: 20,
        plans_capped: true,
        items_capped: true,
        runs_capped: true,
        escalation_limit: 5,
        escalation_returned: 5,
        escalations_capped: true
      }
    })
  }, { locale: "en-US" });

  assert.ok(agents);
  assert.equal(agents.html.includes('data-r9-agent-dashboard-cap-warning="true"'), true);
  assert.equal(agents.html.includes("Showing the first 20 agent teams"), true);
  assert.equal(agents.html.includes("Some task, run, or escalation rows are capped"), true);
  assertNoMainWindowBoundaryLeak(agents.html);
});

test("R9.7 web agent dashboard uses product-facing Agent team copy", () => {
  const agents = renderWebRouteComponent({ key: "agents", agents: agentArmyDashboardVm() }, { locale: "en-US" });
  const emptyAgents = renderWebRouteComponent({
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
  }, { locale: "en-US" });

  assert.ok(agents);
  assert.ok(emptyAgents);
  assert.match(agents.html, /Agent teams/u);
  assert.match(emptyAgents.html, /No agent teams are running yet/u);
  assert.doesNotMatch(`${agents.html}\n${emptyAgents.html}`, /Agent Army|agent armies/u);
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

// R13 批 P4（KPI：AI 自动合并数/占比）：与 cost 页同源同口径；缺省时整张卡不渲染，不冒充 0 次。
test("R13 P4 Agent Army route component renders the ai-auto-merge KPI card when present", () => {
  const agents = renderWebRouteComponent({
    key: "agents",
    agents: agentArmyDashboardVm({
      kpis: {
        active_team_count: 1,
        waiting_decision_count: 2,
        today_cost_cny: "0.006",
        autonomy_rate_pct: 67,
        ai_auto_merge_count: 6,
        ai_auto_merge_ratio_pct: 75
      }
    })
  }, { locale: "zh-CN" });

  assert.ok(agents);
  assert.equal(agents.html.includes('data-r9-agent-kpi="ai_auto_merge"'), true);
  assert.equal(agents.html.includes("AI 自动合并"), true);
  assert.equal(agents.html.includes("6 次"), true);
  assert.equal(agents.html.includes("占今日通过评审的 75%"), true);
});

test("R13 P4 Agent Army route component omits the ai-auto-merge KPI card when absent", () => {
  const agents = renderWebRouteComponent({ key: "agents", agents: agentArmyDashboardVm() }, { locale: "zh-CN" });

  assert.ok(agents);
  assert.equal(agents.html.includes('data-r9-agent-kpi="ai_auto_merge"'), false);
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

// R13 批 P4（labor-split 按 assignee 记账）：与 by_user 并排的独立分组维度——降序、「我」/系统标签、含运行次数。
test("R13 P4 Cost route component renders spend by assignee with current-user and system labels", () => {
  const base = surfaceVm();
  const vm = {
    ...base,
    page_vms: {
      ...base.page_vms,
      cost: {
        ...base.page_vms.cost,
        by_assignee: [
          { user_id: "97000000-0000-4000-8000-000000000004", label: "当前用户", cost_cny: "3", tokens: 900, run_count: 4 },
          { label: "系统（无执行者）", cost_cny: "1.2", tokens: 300, run_count: 0 }
        ]
      }
    }
  };
  const cost = renderWebRouteComponents(vm, { locale: "en-US" }).cost;
  assert.ok(cost);
  assert.equal(cost.html.includes('data-r13-cost-by-assignee="true"'), true);
  assert.equal(cost.html.includes('data-r13-cost-assignee="97000000-0000-4000-8000-000000000004"'), true);
  assert.equal(cost.html.includes('data-r13-cost-assignee="system"'), true);
  assert.equal(cost.html.includes("当前用户"), true);
  assert.equal(cost.html.includes("系统（无执行者）"), true);
  // R14 批 CHAT（web-avatars）：真人有头像 tile（data 钩子带上真实 user_id），系统桶没有真人可挂
  // 头像——不给它编一个假的。
  assert.equal(cost.html.includes('data-r14-avatar-tile-user-id="97000000-0000-4000-8000-000000000004"'), true);
  assert.equal(cost.html.includes('data-r14-avatar-tile-user-id="system"'), false);
  assertNoMainWindowBoundaryLeak(cost.html);
});

test("R13 P4 Cost route component omits the by-assignee card when by_assignee is empty", () => {
  const cost = renderWebRouteComponents(surfaceVm(), { locale: "en-US" }).cost;
  assert.ok(cost);
  assert.equal(cost.html.includes('data-r13-cost-by-assignee="true"'), false);
});

// R13 批 P4（KPI：AI 自动合并数/占比）：与 labor_split 同级——把全托管档 AI 自己合并了多少次显性化。
test("R13 P4 Cost route component renders the ai-auto-merge KPI card", () => {
  const base = surfaceVm();
  const vm = {
    ...base,
    page_vms: {
      ...base.page_vms,
      cost: {
        ...base.page_vms.cost,
        ai_auto_merge: { count: 4, ratio_pct: 80 }
      }
    }
  };
  const cost = renderWebRouteComponents(vm, { locale: "en-US" }).cost;
  assert.ok(cost);
  assert.equal(cost.html.includes('data-r13-cost-ai-auto-merge="true"'), true);
  assert.equal(cost.html.includes('data-r13-cost-ai-auto-merge-count="4"'), true);
  assert.equal(cost.html.includes('data-r13-cost-ai-auto-merge-ratio="80"'), true);
  assert.equal(cost.html.includes("80%"), true);
  assertNoMainWindowBoundaryLeak(cost.html);
});

test("R13 P4 Cost route component omits the ai-auto-merge card when ai_auto_merge is absent", () => {
  const cost = renderWebRouteComponents(surfaceVm(), { locale: "en-US" }).cost;
  assert.ok(cost);
  assert.equal(cost.html.includes('data-r13-cost-ai-auto-merge="true"'), false);
});

// B-R9.6 §3.5：军团花费卡——by_task_plan 非空（管理员口径）时按任务计划分组渲出，
// 带子 run 数与指挥台入口；非管理员 VM 置空则整卡不渲。
test("B-R9.6 Cost route component renders agent army spend grouped by task plan", () => {
  const base = surfaceVm();
  const vm = {
    ...base,
    page_vms: {
      ...base.page_vms,
      cost: {
        ...base.page_vms.cost,
        by_task_plan: [
          { task_plan_id: "0f8b1c2d-1111-4222-8333-444455556666", cost_cny: "1.25", tokens: 5000, child_runs: 3, status: "dispatching", budget_cny: "1.000000", burn_pct: 125 },
          { task_plan_id: "1a2b3c4d-2222-4333-8444-555566667777", label: "上市材料军团", cost_cny: "0.4", tokens: 900, child_runs: 1, status: "done", budget_cny: "3.000000", burn_pct: 13 }
        ]
      }
    }
  };
  const cost = renderWebRouteComponents(vm, { locale: "zh-CN" }).cost;
  assert.ok(cost);
  assert.equal(cost.html.includes('data-r9-cost-army="true"'), true);
  assert.equal(cost.html.includes('data-r9-cost-army-count="2"'), true);
  assert.equal(cost.html.includes('data-r9-cost-army-plan="0f8b1c2d-1111-4222-8333-444455556666"'), true);
  // UX-H4：行结构 = 名称 + 燃烧条（tone 分级）+ 子运行数 + 状态；超限行红字 +「去处理」锚到预算卡。
  assert.equal(cost.html.includes("3 个子运行"), true);
  assert.equal(cost.html.includes("上市材料军团"), true);
  assert.equal(cost.html.includes('data-r9-cost-army-burn="danger"'), true);
  assert.equal(cost.html.includes('data-r9-cost-army-burn="ok"'), true);
  assert.equal(cost.html.includes('data-r9-cost-army-over="0f8b1c2d-1111-4222-8333-444455556666"'), true);
  assert.equal(cost.html.includes('href="#wh-cost-budget"'), true);
  assert.equal(cost.html.includes('id="wh-cost-budget"'), true);
  assert.equal(cost.html.includes("进行中"), true);
  assert.equal(cost.html.includes('href="/dashboard/agents"'), true);
  assertNoMainWindowBoundaryLeak(cost.html);
});

test("B-R9.6 Cost route component omits the army card when by_task_plan is empty", () => {
  const cost = renderWebRouteComponents(surfaceVm(), { locale: "zh-CN" }).cost;
  assert.ok(cost);
  assert.equal(cost.html.includes('data-r9-cost-army="true"'), false);
});

// R19-6（R20 波4）：后端早就给 trend / by_workitem / by_team 填好了数据（cost.ts 三个维度都在 VM 里），
// 桌面端（apps/desktop-webview 的 costView）也已经渲了 14 天趋势条形图 + by_workitem 前 5 行，还明确把
// 用户指向"网页版成本页细看"——但 web 端 renderCostRouteComponent 此前完全没消费这三个字段（trend 只在
// 顶部指标区露过一个"统计天数: N"计数徽章，by_workitem/by_team 从未被引用过），跨端指路断了链。
// 这条固定测试用非空的 fixture（gold-path.ts 的 costDashboard 本身就带 1 条 trend + 1 条 by_workitem +
// 1 条 by_team）断言三个维度真的渲成了可读内容，而不只是计数。
test("R19-6 Cost route component renders trend, by-workitem, and by-team dimensions (desktop already links here)", () => {
  const vm = surfaceVm();
  const costVm = vm.page_vms.cost;
  const trendPoint = costVm.trend[0];
  const workitem = costVm.by_workitem[0];
  const team = costVm.by_team[0];
  assert.ok(trendPoint);
  assert.ok(workitem);
  assert.ok(team);

  const cost = renderWebRouteComponents(vm, { locale: "zh-CN" }).cost;
  assert.ok(cost);

  // 趋势：按天渲出（日期 + 花费），不再只是一个计数徽章。
  assert.equal(cost.html.includes('data-r20-cost-trend="true"'), true);
  assert.equal(cost.html.includes(`data-r20-cost-trend-day="${trendPoint.date}"`), true);
  assert.equal(cost.html.includes(trendPoint.date), true);

  // 按工作项分账：渲出行 + 可点进工作项详情。
  assert.equal(cost.html.includes('data-r20-cost-by-workitem="true"'), true);
  assert.equal(cost.html.includes(`data-r20-cost-workitem="${workitem.workitem_id}"`), true);
  assert.equal(cost.html.includes(workitem.code), true);
  assert.equal(cost.html.includes(`href="/workitems/${workitem.workitem_id}"`), true);

  // 按团队分账。
  assert.equal(cost.html.includes('data-r20-cost-by-team="true"'), true);
  assert.equal(cost.html.includes(`data-r20-cost-team="${team.team_id}"`), true);
  assert.equal(cost.html.includes(team.label), true);

  assertNoMainWindowBoundaryLeak(cost.html);
});

// trend 不按 isAdmin 收窄（后端 aggregateTrend 吃的是已经按用户身份筛过的 entries，普通用户看到的
// 就是自己范围内的每日花费，本身是安全的）——但 by_workitem / by_team 与 by_user/by_task_plan/by_objective
// 同门槛，仅管理员非空。普通用户看到的 VM 里这两个数组会是空数组，此时必须整卡不渲（不能伪装成"0 条记录"）。
test("R19-6 Cost route component omits by-workitem/by-team cards when those admin-only dimensions are empty, but keeps trend", () => {
  const base = surfaceVm();
  const vm = {
    ...base,
    page_vms: {
      ...base.page_vms,
      cost: {
        ...base.page_vms.cost,
        viewer_is_admin: false,
        by_workitem: [],
        by_team: []
      }
    }
  };
  const cost = renderWebRouteComponents(vm, { locale: "en-US" }).cost;
  assert.ok(cost);
  assert.equal(cost.html.includes('data-r20-cost-by-workitem="true"'), false);
  assert.equal(cost.html.includes('data-r20-cost-by-team="true"'), false);
  // 非管理员说明文案要点名这两个维度，而不是让它们悄悄消失。
  assert.match(cost.html, /work item/u);
  // trend 是用户自己范围内的数据，非管理员照样能看。
  assert.equal(cost.html.includes('data-r20-cost-trend="true"'), true);
  assertNoMainWindowBoundaryLeak(cost.html);
});

test("R19-6 Cost route component caps by-workitem/by-team rows and trend days with an honest overflow note", () => {
  const base = surfaceVm();
  const manyWorkitems = Array.from({ length: 10 }, (_, i) => ({
    workitem_id: `0f8b1c2d-1111-4222-8333-44445555${String(1000 + i).padStart(4, "0")}`,
    code: `WI-${i}`,
    cost_cny: String(10 - i),
    turns: i + 1
  }));
  const manyTeams = Array.from({ length: 9 }, (_, i) => ({
    team_id: `1a2b3c4d-2222-4333-8444-55556666${String(1000 + i).padStart(4, "0")}`,
    label: "团队预算",
    cost_cny: String(9 - i),
    tokens: 100 * (i + 1)
  }));
  const manyTrendDays = Array.from({ length: 20 }, (_, i) => ({
    date: `2026-06-${String(i + 1).padStart(2, "0")}`,
    cost_cny: String(i + 1),
    tokens: 100
  }));
  const vm = {
    ...base,
    page_vms: {
      ...base.page_vms,
      cost: {
        ...base.page_vms.cost,
        by_workitem: manyWorkitems,
        by_team: manyTeams,
        trend: manyTrendDays
      }
    }
  };
  const cost = renderWebRouteComponents(vm, { locale: "zh-CN" }).cost;
  assert.ok(cost);
  assert.equal(cost.html.includes("按花费只显示前 8 个工作项（共 10 个）"), true);
  assert.equal(cost.html.includes("按花费只显示前 8 个团队（共 9 个）"), true);
  assert.equal(cost.html.includes("只显示最近 14 天（共 20 天记录）"), true);
  assertNoMainWindowBoundaryLeak(cost.html);
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

test("R18-H1 settings members section is admin-gated: SSR skeleton only when isAdmin", () => {
  const vm = surfaceVm();
  const settingsVm = vm.page_vms.settings;
  assert.ok(settingsVm);

  const asMember = renderWebRouteComponent({ key: "settings", settings: settingsVm, isAdmin: false }, { locale: "zh-CN" });
  assert.equal(asMember.html.includes('data-r18-settings-members="true"'), false);
  assert.equal(asMember.html.includes('data-r18-settings-invites="true"'), false);

  const asAdmin = renderWebRouteComponent({ key: "settings", settings: settingsVm, isAdmin: true }, { locale: "zh-CN" });
  // SSR 只出加载态骨架 + hydration 锚点（真 roster / 邀请由 browser.ts 拉端点后注入）。
  assert.equal(asAdmin.html.includes('data-r18-settings-members="true"'), true);
  assert.equal(asAdmin.html.includes('data-r18-settings-members-body="true"'), true);
  assert.equal(asAdmin.html.includes('data-r18-settings-invites="true"'), true);
  assert.equal(asAdmin.html.includes('data-r18-settings-invites-body="true"'), true);
  assert.equal(asAdmin.html.includes("正在加载成员"), true);

  const asAdminEn = renderWebRouteComponent({ key: "settings", settings: settingsVm, isAdmin: true }, { locale: "en-US" });
  assert.equal(asAdminEn.html.includes("Loading members"), true);
  assert.equal(asAdminEn.html.includes("Invite members"), true);

  // R20 P1-05（令牌存活根因）：一次性令牌展示区必须是 SSR 骨架里的持久节点，且是
  // [data-r18-settings-invites-body] 的**兄弟**（不在 body 内）——body 才是 browser.ts hydrate()
  // 每次重拉未过期清单时 innerHTML 重建的域。令牌盒在 body 之外，故「创建成功→重刷清单」不会销毁它，
  // 令牌持续可见可复制。修复前令牌盒由 browser.ts render 注入进 body、随重建被销毁——此断言即那道防线。
  const tokenIdx = asAdmin.html.indexOf('data-r18-settings-invite-token="true"');
  const bodyIdx = asAdmin.html.indexOf('data-r18-settings-invites-body="true"');
  assert.notEqual(tokenIdx, -1, "SSR skeleton carries a persistent token display node");
  assert.equal(tokenIdx > bodyIdx, true, "token node is a sibling rendered after the invites body, not nested inside a rebuilt body");
  // body 的加载态骨架里不含令牌节点（证明它确在 body 之外，不会被 body 重建牵连）。
  const bodyOpen = asAdmin.html.indexOf(">", bodyIdx);
  const bodyClose = asAdmin.html.indexOf("</div>", bodyOpen);
  assert.equal(asAdmin.html.slice(bodyOpen, bodyClose).includes("data-r18-settings-invite-token"), false);
});

// R20 wave4（R19-2 AI 预算策略前端接线）：GET/PUT /api/cost/policies(/:scope/:id) 服务端早已有且
// admin-only（非管理员连 GET 都是 403）——SSR 阶段就该整体省略这张卡，不是渲了又假装可编辑。
test("R20 wave4 (R19-2): settings budget policy section is admin-gated: SSR skeleton only when isAdmin", () => {
  const vm = surfaceVm();
  const settingsVm = vm.page_vms.settings;
  assert.ok(settingsVm);

  const asMember = renderWebRouteComponent({ key: "settings", settings: settingsVm, isAdmin: false }, { locale: "zh-CN" });
  assert.equal(asMember.html.includes('data-r20-settings-budget-policies="true"'), false);

  const asAdmin = renderWebRouteComponent({ key: "settings", settings: settingsVm, isAdmin: true }, { locale: "zh-CN" });
  // SSR 只出加载态骨架 + hydration 锚点（真策略列表由 browser.ts bindSettingsBudgetPolicyPanel 拉取后注入）。
  assert.equal(asAdmin.html.includes('data-r20-settings-budget-policies="true"'), true);
  assert.equal(asAdmin.html.includes('data-r20-settings-budget-policies-body="true"'), true);
  assert.equal(asAdmin.html.includes("正在加载预算策略"), true);

  const asAdminEn = renderWebRouteComponent({ key: "settings", settings: settingsVm, isAdmin: true }, { locale: "en-US" });
  assert.equal(asAdminEn.html.includes("Loading budget policies"), true);
  assertNoMainWindowBoundaryLeak(asAdmin.html);
});

// R13 批 P3（功能审查 B4）：web /settings 的「AI 助手」区块——default_mode 与 dispatch_policy 两个
// 真表单（当前值由 apps/web/src/browser.ts 水合后解禁，SSR 必须是 disabled——R10-P1-7 的竞态收口纪律），
// 其余 AI 项走既有 data-requires-desktop 提示模式，不再静默留白。
test("R13-P3 settings route renders the AI assistant block: locked selects for hydration plus desktop notices", () => {
  const vm = surfaceVm();
  const settings = renderWebRouteComponents(vm, { locale: "zh-CN" }).settings;

  assert.ok(settings);
  assert.equal(settings.html.includes('data-r13-settings-ai-panel="true"'), true);
  // Both selects render disabled until the client hydrates the real current values.
  assert.match(settings.html, /data-r13-settings-ai-mode-select[^>]*disabled/u);
  assert.match(settings.html, /data-r13-settings-ai-dispatch-select[^>]*disabled/u);
  // R23 P3b（SA-07）：助手主动性三档在 web 也放出来了（同一套水合竞态纪律：SSR 先 disabled）。
  assert.match(settings.html, /data-r13-settings-ai-proactivity-select[^>]*disabled/u);
  for (const level of ["quiet", "balanced", "proactive"]) {
    assert.ok(settings.html.includes(`value="${level}"`), `proactivity option ${level} must be rendered`);
  }
  // 这一项不该再把用户往桌面端赶。
  assert.ok(!/助手主动性[^<]*<\/strong><span class="wh-pill">需要桌面客户端/u.test(settings.html));
  // All five modes and all three dispatch policies are real options.
  for (const value of ["1", "2", "3", "4", "5"]) {
    assert.equal(settings.html.includes(`<option value="${value}">`), true);
  }
  for (const value of ["auto", "ask", "manual"]) {
    assert.equal(settings.html.includes(`<option value="${value}">`), true);
  }
  assert.match(settings.html, /只观察/u);
  assert.match(settings.html, /自动接单/u);
  // Hydration status line and retry control exist for the locked-on-failure path.
  assert.equal(settings.html.includes("data-r13-settings-ai-status"), true);
  assert.equal(settings.html.includes("data-r13-settings-ai-retry"), true);
  // The remaining AI items are honestly labeled as desktop-only, via the established pattern.
  assert.match(settings.html, /data-action-id="open_desktop_ai_settings"[^>]*data-requires-desktop="true"/u);
  assert.match(settings.html, /需要桌面客户端/u);
});

// R13 批 A2（派人推荐 v2）：web /settings 的「我的资料」区块——GET/PATCH /me/profile 此前完全没有
// 任何 UI 入口。同一套水合竞态收口纪律：三个输入服务端渲染为 disabled，由 browser.ts 水合后解禁。
test("R13-A2 settings route renders the my-profile block: locked inputs for hydration plus retry affordance", () => {
  const vm = surfaceVm();
  const settings = renderWebRouteComponents(vm, { locale: "zh-CN" }).settings;

  assert.ok(settings);
  assert.equal(settings.html.includes('data-r13-settings-profile-panel="true"'), true);
  // All three inputs render disabled until the client hydrates the real current values.
  assert.match(settings.html, /data-r13-settings-profile-title-input[^>]*disabled/u);
  assert.match(settings.html, /data-r13-settings-profile-bio-input[^>]*disabled/u);
  assert.match(settings.html, /data-r13-settings-profile-skills-input[^>]*disabled/u);
  assert.match(settings.html, /我的资料/u);
  assert.match(settings.html, /AI 助手派活时会参考这些信息/u);
  // Hydration status line and retry control exist for the locked-on-failure path.
  assert.equal(settings.html.includes("data-r13-settings-profile-status"), true);
  assert.equal(settings.html.includes("data-r13-settings-profile-retry"), true);
});

// R14 批 ONBOARD（资料引导提示）：AttentionHomeVM 不带 viewer 资料态，没法在决策队列首页做条件式
// 提示卡（见 renderSettingsMyProfileCard 顶部注释），退化成资料卡顶部一句常驻引导语——中英文都要有，
// 且绝不出现"Cuu"字样（web 文案铁律，04 §4 铁律 12 的延伸：web 一律说"AI 助手"）。
test("R14 ONBOARD settings my-profile card has a persistent guidance hint pointing at why the fields matter", () => {
  const vm = surfaceVm();
  const zhSettings = renderWebRouteComponents(vm, { locale: "zh-CN" }).settings;
  assert.ok(zhSettings);
  assert.equal(zhSettings.html.includes('data-r14-settings-profile-guidance-hint="true"'), true);
  assert.match(zhSettings.html, /填好这些，AI 助手派活会更准/u);
  assert.doesNotMatch(zhSettings.html, /Cuu/u);

  const enSettings = renderWebRouteComponents(vm, { locale: "en-US" }).settings;
  assert.ok(enSettings);
  assert.equal(enSettings.html.includes('data-r14-settings-profile-guidance-hint="true"'), true);
  assert.match(enSettings.html, /Fill these in/u);
  assert.doesNotMatch(enSettings.html, /Cuu/u);
});

// R14 批 AVATAR（头像与资料入口，2026-07-14 用户点名新增）：设置页「我的资料」卡加头像位——
// 圆形预览（回退首字母 tile）+ 隐藏 file input（label 触发,disabled 直到 browser.ts 水合出真实
// user_id）+ 移除按钮。裁剪层本身是浏览器端交互产物，不在 SSR 字符串里，这里只钉 SSR 骨架的形状。
test("R14 AVATAR settings route renders the avatar block: fallback tile + disabled file input + hidden remove button", () => {
  const vm = surfaceVm();
  const settings = renderWebRouteComponents(vm, { locale: "zh-CN" }).settings;

  assert.ok(settings);
  assert.equal(settings.html.includes('data-r14-settings-avatar-row="true"'), true);
  assert.equal(settings.html.includes('data-r14-avatar-preview="true"'), true);
  assert.equal(settings.html.includes('data-r14-avatar-fallback="true"'), true);
  // The <img> starts hidden — browser.ts reveals it only after a successful load, falling back
  // to the initial-letter tile via onerror (no head/tone-deaf attempt to guess avatar existence at SSR time).
  assert.match(settings.html, /data-r14-avatar-img="true"[^>]*hidden/u);
  // The file input is disabled until browser.ts hydrates the real user_id from GET /me/profile —
  // uploading before we know who "me" is would be a race, same discipline as the text fields above.
  assert.match(settings.html, /data-r14-avatar-file-input="true"[^>]*disabled/u);
  assert.match(settings.html, /accept="image\/png,image\/jpeg,image\/webp"/u);
  // The remove button starts hidden+disabled — browser.ts reveals it only once it confirms an avatar exists.
  assert.match(settings.html, /data-r14-avatar-remove-btn="true"[^>]*hidden[^>]*disabled/u);
  assert.match(settings.html, /更换头像/u);
  assert.match(settings.html, /移除头像/u);
});

test("R14 AVATAR settings route avatar copy has no emoji and no git jargon", () => {
  const vm = surfaceVm();
  const settings = renderWebRouteComponents(vm, { locale: "zh-CN" }).settings;

  assert.ok(settings);
  const avatarRowStart = settings.html.indexOf('data-r14-settings-avatar-row="true"');
  const avatarRowHtml = settings.html.slice(avatarRowStart, avatarRowStart + 900);
  assert.doesNotMatch(avatarRowHtml, /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u, "no emoji in avatar copy");
  assert.doesNotMatch(avatarRowHtml, /\bCuu\b/u, "web copy must never say Cuu");
});

// R20 P2-05（设备管理 API 完整但零 UI）：/api/client-devices 四端点早就齐了，但 web /settings 从没接过
// 任何 UI（本测试之前，SSR 输出里完全没有 data-r20-settings-devices 这个骨架——red-before 就是"根本不
// 存在"）。这个区块不是 admin 分区（设备是个人账号维度），且 apps/web/src/browser.ts 的
// bindSettingsDevicesPanel 拉真实数据水合，这里只钉 SSR 骨架的形状与文案。
test("R20-P2-05 settings route renders the signed-in devices block: SSR skeleton, not admin-gated", () => {
  const vm = surfaceVm();

  const asMember = renderWebRouteComponent({ key: "settings", settings: vm.page_vms.settings!, isAdmin: false }, { locale: "zh-CN" });
  assert.equal(asMember.html.includes('data-r20-settings-devices="true"'), true, "devices block must render for non-admins too");
  assert.equal(asMember.html.includes('data-r20-settings-devices-body="true"'), true);
  assert.match(asMember.html, /已登录设备/u);
  assert.match(asMember.html, /正在加载设备/u);

  const asAdmin = renderWebRouteComponent({ key: "settings", settings: vm.page_vms.settings!, isAdmin: true }, { locale: "zh-CN" });
  assert.equal(asAdmin.html.includes('data-r20-settings-devices="true"'), true);

  const en = renderWebRouteComponents(vm, { locale: "en-US" }).settings;
  assert.ok(en);
  assert.match(en.html, /Signed-in devices/u);
  assert.match(en.html, /Loading devices/u);
  assert.doesNotMatch(en.html, /Cuu/u, "web copy must never say Cuu");
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

// R14 批 CHAT（web-avatars）：routed_to_user_id 一直都在 ApprovalRequest 契约里，此前只拿去算一个
// "已路由/未路由"布尔药丸——从没显示过路由给了"谁"。这里加头像 tile（没有配对昵称，纯照片/回退问号，
// 不编一个假名字）。delegated_to_user_id 此前完全没有展示点，新增一枚同款药丸，只在存在时出现。
test("R14 CHAT Approvals route component shows a routed-to avatar tile and a delegated chip when present", () => {
  const base = surfaceVm();
  const request = base.page_vms.approvals.requests[0];
  assert.ok(request);
  assert.ok(request.routed_to_user_id);

  const routedOnly = renderWebRouteComponent({ key: "approvals", approvals: base.page_vms.approvals }, { locale: "en-US" });
  assert.equal(routedOnly.html.includes(`data-r14-avatar-tile-user-id="${request.routed_to_user_id}"`), true);
  assert.equal(routedOnly.html.includes('data-r14-approval-delegated="true"'), false);

  const delegatedVm = {
    ...base.page_vms.approvals,
    requests: base.page_vms.approvals.requests.map((item) =>
      item.id === request.id ? { ...item, delegated_to_user_id: "10000000-0000-4000-8000-000000000899" } : item)
  };
  const delegated = renderWebRouteComponent({ key: "approvals", approvals: delegatedVm }, { locale: "zh-CN" });
  assert.equal(delegated.html.includes('data-r14-approval-delegated="true"'), true);
  assert.equal(delegated.html.includes("已委派"), true);
  assert.equal(delegated.html.includes('data-r14-avatar-tile-user-id="10000000-0000-4000-8000-000000000899"'), true);
  assertNoMainWindowBoundaryLeak(delegated.html);
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
  // R14 批 CHAT（web-avatars）：routed_to_user_id 现在合法地出现一次——不是当作可读文本泄漏，而是
  // 头像 tile 的 data-r14-avatar-tile-user-id 钩子（供 apps/web/src/browser.ts 水合
  // /api/users/:id/avatar，与本文件 data-r9-cost-user/data-r13-cost-assignee 同一套已有先例）。
  // 原断言"这个 UUID 不该出现在页面里"的本意是"不该被当人类可读内容裸露"——这里改成更精确的版本：
  // 只允许出现在这一个 data 钩子属性里，除此之外（任何 pill/文本/其它属性）仍然一次都不能出现。
  assert.equal(approvals.html.includes('data-r14-avatar-tile-user-id="96000000-0000-4000-8000-000000000011"'), true);
  assert.equal(
    approvals.html
      .replaceAll('data-r14-avatar-tile-user-id="96000000-0000-4000-8000-000000000011"', "")
      .includes("96000000-0000-4000-8000-000000000011"),
    false
  );
  assert.equal(approvals.html.includes("2026-07-05T00:00:00.000Z"), false);
  assert.equal(approvals.html.includes("<strong>Tool approval</strong>"), true);
  // UI-02：本地时区渲染，期望值由格式化助手算出（时区无关）。
  assert.equal(approvals.html.includes(`Pending · due ${formatLocalTimestamp("2026-07-05T00:00:00.000Z")}`), true);
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

// R14（网盘回滚两端对齐，取代 R13 批 P4 的纯提示）：version.restore_href 是服务端为两端共出的同一份
// 字段，且只在服务端认定“现在真能找回”时才会给（见 apps/api/src/services/drive-pages.ts 的
// versionToVm/acceptedDeliverableVersionMarker）——凡是这个字段真出现了，web 现在必须接一个真按钮，
// 而不再是此前那句笼统的“需要桌面客户端”提示（那句话对这一行来说是不准确的：它明明能在网页上做）。
test("R14 Drive route renders a real, confirm-gated recovery action for a version the server marked restorable", () => {
  const vm = drivePageVm();
  vm.selected_item_id = "94000000-0000-4000-8000-000000000009";
  const currentVersion = vm.versions.find((version) => version.id === "94000000-0000-4000-8000-000000000010")!;
  vm.versions.push({
    ...currentVersion,
    id: "94000000-0000-4000-8000-000000000012",
    version_no: 0,
    current: false,
    restore_href: "/api/workitems/x/deliverables/y/restore"
  });

  const drive = renderWebRouteComponent({ key: "drive", drive: vm }, { locale: "en-US" });

  // Exactly one recovery control renders (the base fixture's other, already-current-and-restorable
  // version — "...003" — belongs to a different file and is filtered out once ...009 is selected).
  // The action must sit behind a <details> disclosure (collapsed by default, per the shared
  // ".wh-r4-route details" CSS rule) so a single accidental click can't fire an overwriting action —
  // the explanation and the actual submit control only appear once expanded.
  assert.equal((drive.html.match(/wh-r4-drive-version-restore/gu) ?? []).length, 1);
  assert.equal(drive.html.includes('<details class="wh-r4-drive-version-restore" data-r14-drive-version-restore="true">'), true);
  assert.equal(drive.html.includes('<summary class="wh-btn">Recover this version</summary>'), true);
  assert.equal(drive.html.includes('href="/api/workitems/x/deliverables/y/restore"'), true);
  assert.equal(drive.html.includes('data-action-id="drive_restore" data-method="POST">Confirm recovery</a>'), true);
  assert.equal(drive.html.includes("is not deleted, it stays in the history"), true);
  // The recovery markup for this version must be attached to ITS row, not float in globally —
  // it should appear after this version's own data attribute and before the next row/section.
  const rowStart = drive.html.indexOf('data-r4-drive-version="94000000-0000-4000-8000-000000000012"');
  const restoreIndex = drive.html.indexOf("wh-r4-drive-version-restore", rowStart);
  assert.ok(rowStart >= 0, "expected to find the restorable version's row");
  assert.ok(restoreIndex > rowStart, "expected the recovery control to render inside that version's row");
  // No git jargon, and the stale "requires desktop" framing must not linger for a version that
  // actually has a working web path now.
  assert.doesNotMatch(drive.html, /\brevert\b/iu);
  assert.doesNotMatch(drive.html, /\brollback\b/iu);
  assert.equal(drive.html.includes('data-r13-drive-versions-desktop-notice="true"'), false);
});

// The remaining, genuine gap: a non-current version the server did NOT mark restorable (e.g. a
// manual upload with no backing accepted deliverable) still has no working web-side recovery path.
// That row must stay honest — no button pretending to work — while the page-level notice keeps
// pointing affected users at the desktop client for *that* version specifically.
test("R14 Drive route still shows the desktop notice, without a button, for a version the server did not mark restorable", () => {
  const vm = drivePageVm();
  vm.selected_item_id = "94000000-0000-4000-8000-000000000009";
  const currentVersion = vm.versions.find((version) => version.id === "94000000-0000-4000-8000-000000000010")!;
  vm.versions.push({
    ...currentVersion,
    id: "94000000-0000-4000-8000-000000000013",
    version_no: 0,
    current: false,
    restore_href: undefined
  });

  const drive = renderWebRouteComponent({ key: "drive", drive: vm }, { locale: "en-US" });

  assert.equal(drive.html.includes('data-r13-drive-versions-desktop-notice="true"'), true);
  assert.equal(drive.html.includes("Recovering these older versions requires the desktop client."), true);
  assert.equal(drive.html.includes('data-r4-drive-version="94000000-0000-4000-8000-000000000013"'), true, "expected to find the non-restorable version's row");
  assert.equal((drive.html.match(/wh-r4-drive-version-restore/gu) ?? []).length, 0, "must not render a restore control with no restore_href to point at");
});

test("R14 Drive route version history omits the desktop notice when every loaded version is current or already restorable", () => {
  const vm = drivePageVm();
  vm.selected_item_id = "94000000-0000-4000-8000-000000000009";

  const drive = renderWebRouteComponent({ key: "drive", drive: vm }, { locale: "en-US" });

  assert.equal(drive.html.includes('data-r13-drive-versions-desktop-notice="true"'), false);
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
  // R14: in real server output, a version's restore_href is derived from this same (link-filtered)
  // accepted-deliverable record (see versionToVm in apps/api/src/services/drive-pages.ts) — when the
  // deliverable is restricted, its version row loses restore_href too. This fixture keeps versions[]
  // and accepted_deliverables[] as independent literals, so it must clear both by hand to stay a
  // realistic combination (otherwise the version row would render a recovery action a restricted
  // deliverable is never actually allowed to expose).
  vm.versions[0] = { ...vm.versions[0]!, restore_href: undefined };

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

// R14 批 CHAT（web-avatars）：会议行早就在渲 uploaded_by_label 这个"人物出现点"，且
// uploaded_by_user_id 是必填字段——头像 tile 铺在上传者名字前面。
test("R14 CHAT Meeting route component shows an uploader avatar tile on each meeting row", () => {
  const vm = meetingPageVm();
  const uploader = vm.meetings[0];
  assert.ok(uploader);
  const meetings = renderWebRouteComponent({ key: "meetings", meetings: vm }, { locale: "en-US" });
  assert.equal(meetings.html.includes(`data-r14-avatar-tile-user-id="${uploader.uploaded_by_user_id}"`), true);
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

test("WEB-08: meetings empty screen carries the empty copy exactly once (merged guided empty state)", () => {
  const vm = structuredClone(meetingPageVm());
  vm.meetings = [];
  vm.summary = { meeting_count: 0, ready_count: 0, pending_insight_count: 0, confirmed_insight_count: 0, dismissed_insight_count: 0 };
  vm.empty_state = "no_meetings";
  const zh = renderWebRouteComponent({ key: "meetings", meetings: vm }, { locale: "zh-CN" });
  // 空态文案只在引导卡出现一次——头部副标题与列表卡不再重复同一句。
  assert.equal(zh.html.split("这个项目还没有会议洞察。").length - 1, 1);
  assert.equal(zh.html.includes("会议转写、纪要和洞察都会归到这里。"), true);
  const en = renderWebRouteComponent({ key: "meetings", meetings: vm }, { locale: "en-US" });
  assert.equal(en.html.split("This project does not have meeting insights yet.").length - 1, 1);
  assert.equal(en.html.includes("Meeting transcripts, minutes and insights land here."), true);
});

test("SA-02: meetings route offers a real regenerate-minutes action and carries it in primaryHrefs", () => {
  const vm = meetingPageVm();
  const rendered = renderWebRouteComponent({ key: "meetings", meetings: vm }, { locale: "zh-CN" });
  assert.equal(rendered.html.includes('data-r23-meeting-reanalyze="95000000-0000-4000-8000-000000000002"'), true);
  assert.equal(rendered.html.includes('data-action-id="meeting_reanalyze" data-method="POST"'), true);
  assert.equal(
    rendered.primaryHrefs.includes("/api/meetings/95000000-0000-4000-8000-000000000002/analyze"),
    true
  );
  // AI 已配置时不出提示条。
  assert.equal(rendered.html.includes("data-r23-meeting-ai-unconfigured"), false);
  assertNoMainWindowBoundaryLeak(rendered.html);
});

test("SA-02: meetings route says AI is not configured instead of a bare 'no minutes yet'", () => {
  const vm = structuredClone(meetingPageVm());
  vm.ai_analysis_configured = false;
  const meeting = vm.meetings[0]!;
  meeting.status = "transcribed";
  delete meeting.minutes_md;
  delete meeting.actions.reanalyze;
  const zh = renderWebRouteComponent({ key: "meetings", meetings: vm }, { locale: "zh-CN" });
  assert.equal(zh.html.includes('data-r23-meeting-ai-unconfigured="true"'), true);
  assert.equal(zh.html.includes("AI 还没有配置，这场会议只保存了转写。"), true);
  // 未配置时不能再说「这次会议还没有纪要内容」——那句话暗示等一等就会有。
  assert.equal(zh.html.includes("这次会议还没有纪要内容。"), false);
  // 状态标签也要如实说「转写已导入」，而不是折叠成「处理中」。
  assert.equal(zh.html.includes("转写已导入"), true);
  const en = renderWebRouteComponent({ key: "meetings", meetings: vm }, { locale: "en-US" });
  assert.equal(en.html.includes("AI is not configured, so this meeting only has its transcript."), true);
  assertNoMainWindowBoundaryLeak(zh.html);
});

test("SA-02: a transcribed meeting with AI configured says the minutes are still being generated", () => {
  const vm = structuredClone(meetingPageVm());
  const meeting = vm.meetings[0]!;
  meeting.status = "transcribed";
  delete meeting.minutes_md;
  const zh = renderWebRouteComponent({ key: "meetings", meetings: vm }, { locale: "zh-CN" });
  assert.equal(zh.html.includes("纪要还在生成，稍后回来查看。"), true);
  assert.equal(zh.html.includes("data-r23-meeting-ai-unconfigured"), false);
});

test("WEB-09: cost route formats large token counts with thousands separators (both locales)", () => {
  const vm = surfaceVm();
  vm.page_vms.cost.token_in = 2_000_000;
  vm.page_vms.cost.token_out = 1_500_000;
  vm.page_vms.cost.budget = [{
    scope: { kind: "user", user_id: "97000000-0000-4000-8000-000000000004" },
    scope_label: "My AI budget today",
    policy_id: "pcost-user-day-v0:big",
    period: "day",
    period_start: "2026-06-11T00:00:00.000Z",
    period_end: "2026-06-12T00:00:00.000Z",
    token_in: 1_000_000,
    token_out: 500_000,
    total_tokens: 1_500_000,
    max_tokens: 5_000_000,
    remaining_tokens: 3_500_000,
    estimated_cost_cny: "12.5",
    max_cost_cny: "40",
    remaining_cost_cny: "27.5",
    warning_ratio: 0.3,
    enabled: true,
    status: "ok"
  }];

  const zh = renderWebRouteComponents(vm, { locale: "zh-CN" }).cost;
  assert.ok(zh);
  assert.equal(zh.html.includes("1,500,000/5,000,000 tokens"), true);
  assert.equal(zh.html.includes("3,500,000 个 token"), true);
  const en = renderWebRouteComponents(vm, { locale: "en-US" }).cost;
  assert.ok(en);
  assert.equal(en.html.includes("1,500,000/5,000,000 tokens"), true);
  assert.equal(en.html.includes("3,500,000 tokens"), true);
});

test("INT-01: primary API actions expose button semantics via role=button", () => {
  const confirmVm = {
    ...surfaceVm(),
    intake_session: routeSession("confirm")
  };
  const confirmIntake = renderWebRouteComponents(confirmVm, { locale: "zh-CN" }).intake;
  assert.ok(confirmIntake);
  // 确认屏「创建任务」。
  assert.match(confirmIntake.html, /<a class="wh-btn wh-btn-primary" href="\/api\/workitems" role="button" data-action-id="create_workitem"/u);

  // 无项目上下文的起点「开始新任务」。
  const startIntake = renderWebRouteComponent({ key: "intake", start: true }, { locale: "zh-CN" });
  assert.match(startIntake.html, /<a class="wh-btn wh-btn-primary" href="\/api\/projects\/bootstrap" role="button" data-action-id="start_intake"/u);
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
  // R14 FIX（通知深链缺 conversation_id）：这条 fixture 的通知没有 conversation_id——不该硬造
  // "关联一段讨论"的标注。
  assert.equal(notifications.html.includes('data-r14-notification-conversation-note="true"'), false);
  assertNoMainWindowBoundaryLeak(notifications.html);
});

// R14 FIX（通知深链缺 conversation_id）：page VM 新增的可选 conversation_id 字段（服务端从
// target_href 查询参数解出，见 apps/api/src/services/schedule-notify-pages.ts 的 notificationItem）
// R15 批 web-mirror：web 现在有只读会话镜像了——会话类通知除了保留既有 target_href（工作项页）+ 关联
// 提示外，补一条真链接到 /conversations/:id（「查看只读镜像」）。此前 R14 时 web 没有聊天页，只能给提示。
test("R14 notifications route annotates items that carry a conversation_id and links to the read-only mirror", () => {
  const vm = notificationPageVm();
  const withConversation: NotificationPageVM["items"][number] = {
    ...vm.items[0]!,
    id: "96000000-0000-4000-8000-000000000009",
    type: "workitem.escalated",
    target_href: "/workitems/95000000-0000-4000-8000-000000000009?conversation_id=95000000-0000-4000-8000-00000000c009",
    conversation_id: "95000000-0000-4000-8000-00000000c009",
    actions: {
      ...vm.items[0]!.actions,
      open: {
        id: "open",
        label: "Open",
        method: "GET",
        href: "/workitems/95000000-0000-4000-8000-000000000009?conversation_id=95000000-0000-4000-8000-00000000c009"
      }
    }
  };
  const withConversationVm: NotificationPageVM = {
    ...vm,
    items: [withConversation],
    buckets: { ...vm.buckets, needs_decision: [withConversation] }
  };

  const en = renderWebRouteComponent({ key: "notifications", notifications: withConversationVm }, { locale: "en-US" });
  const zh = renderWebRouteComponent({ key: "notifications", notifications: withConversationVm }, { locale: "zh-CN" });

  assert.equal(en.html.includes('data-r14-notification-conversation-id="95000000-0000-4000-8000-00000000c009"'), true);
  assert.equal(en.html.includes('data-r14-notification-conversation-note="true"'), true);
  assert.equal(en.html.includes("tied to a discussion"), true);
  assert.equal(zh.html.includes("这条通知关联一段讨论"), true);
  // 既有的工作项页跳转目标（带 ?conversation_id= 查询串）保留不动。
  assert.equal(en.html.includes('href="/workitems/95000000-0000-4000-8000-000000000009?conversation_id=95000000-0000-4000-8000-00000000c009"'), true);
  // R15 批 web-mirror：补一条真链接到只读会话镜像 + 「查看只读镜像」文案。
  assert.equal(en.html.includes('href="/conversations/95000000-0000-4000-8000-00000000c009"'), true);
  assert.equal(en.html.includes('data-r15-notification-conversation-open="true"'), true);
  assert.equal(en.html.includes("View read-only mirror"), true);
  assert.equal(zh.html.includes("查看只读镜像"), true);
  // smoke 门：web 端不出现 "Cuu" 字样。
  assert.equal(/cuu/iu.test(en.html), false);
  assert.equal(/cuu/iu.test(zh.html), false);
  assertNoMainWindowBoundaryLeak(en.html);
});

// R15 批 A（A2 提醒阶梯）：next_remind_at 非空的通知渲「暂停提醒」链接（POST /snooze，走既有动作管道），
// 为空/不带的通知不渲。
test("R15 notifications route renders a snooze link only for items still on the reminder ladder", () => {
  const vm = notificationPageVm();
  const onLadder: NotificationPageVM["items"][number] = {
    ...vm.items[0]!,
    id: "96000000-0000-4000-8000-0000000000a2",
    next_remind_at: "2026-06-12T09:30:00.000Z",
    reminder_count: 1
  };
  const onLadderVm: NotificationPageVM = {
    ...vm,
    items: [onLadder],
    buckets: { ...vm.buckets, needs_decision: [onLadder], done: [] }
  };
  const zh = renderWebRouteComponent({ key: "notifications", notifications: onLadderVm }, { locale: "zh-CN" });
  const en = renderWebRouteComponent({ key: "notifications", notifications: onLadderVm }, { locale: "en-US" });
  // 暂停提醒链接：POST 到 /snooze，走既有 data-method 动作管道。
  assert.equal(zh.html.includes('href="/api/notifications/96000000-0000-4000-8000-0000000000a2/snooze"'), true);
  assert.equal(zh.html.includes('data-r15-notification-snooze="true"'), true);
  assert.equal(zh.html.includes('data-method="POST"'), true);
  assert.equal(zh.html.includes("暂停提醒"), true);
  assert.equal(en.html.includes(">Snooze<"), true);

  // 默认 VM 的两条都不带 next_remind_at → 不渲暂停链接。
  const plain = renderWebRouteComponent({ key: "notifications", notifications: notificationPageVm() }, { locale: "zh-CN" });
  assert.equal(plain.html.includes("/snooze"), false);
  assert.equal(plain.html.includes("data-r15-notification-snooze"), false);
});

// G-web 止血批：notificationTypeLabel 的 exact 映射表没有 "project" 命名空间前缀兜底——
// project.risk_digest（risk-monitor.ts 每日风险巡检摘要）此前直接掉进 humanizeToken，
// 中文界面渲出裸英文 "Project Risk Digest"。
test("G-web FIX notification type label localizes project.risk_digest instead of falling through to a raw English token", () => {
  const vm = notificationPageVm();
  const riskDigestItem: NotificationPageVM["items"][number] = {
    ...vm.items[0]!,
    id: "96000000-0000-4000-8000-000000000010",
    type: "project.risk_digest"
  };
  const riskDigestVm: NotificationPageVM = {
    ...vm,
    items: [riskDigestItem],
    buckets: { ...vm.buckets, needs_decision: [riskDigestItem] }
  };

  const zh = renderWebRouteComponent({ key: "notifications", notifications: riskDigestVm }, { locale: "zh-CN" });
  const en = renderWebRouteComponent({ key: "notifications", notifications: riskDigestVm }, { locale: "en-US" });

  assert.equal(zh.html.includes("风险巡检摘要"), true);
  assert.equal(zh.html.includes("Project Risk"), false);
  assert.equal(en.html.includes("Risk digest"), true);
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
    totals: { active: 1, ai_authored: 1, refined: 1 },
    curation: { enabled: true, running: false, last_run_at: "2026-06-16T02:00:00.000Z" }
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
    curation: { enabled: true, running: false, last_run_at: null },
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
    totals: { active: 1, ai_authored: 1, refined: 0 },
    curation: { enabled: true, running: false, last_run_at: null }
  };

  const en = renderWebRouteComponent({ key: "skills", skills: skillsVm }, { locale: "en-US" });
  const zh = renderWebRouteComponent({ key: "skills", skills: skillsVm }, { locale: "zh-CN" });

  assert.doesNotMatch(en.html, /confidence/iu);
  assert.doesNotMatch(zh.html, /置信/u);
});

// R23 SA-06：技能页此前从不回答「这台部署到底有没有人在攒技能」——夜间自学 worker 长期默认关着，
// 页面却一句话都不说。三档状态必须各说各的实话，且「立即自学一轮」只对管理员出现。
const r23SkillsVm = (curation: { enabled: boolean; running: boolean; last_run_at: string | null }) => ({
  generated_at: "2026-09-05T00:00:00.000Z",
  skills: [],
  totals: { active: 0, ai_authored: 0, refined: 0 },
  curation,
  empty_state: "no_skills" as const
});

test("R23 SA-06 team skills route tells the truth about self-learning in all three states", () => {
  const disabled = renderWebRouteComponent(
    { key: "skills", skills: r23SkillsVm({ enabled: false, running: false, last_run_at: null }), isAdmin: true },
    { locale: "zh-CN" }
  );
  assert.match(disabled.html, /data-r23-skills-curation="disabled"/u);
  assert.ok(disabled.html.includes("没有开启 AI 自学"));
  // 未启用时不渲按钮——服务端必然 409，渲出来就是假入口。
  assert.doesNotMatch(disabled.html, /data-r23-skills-curate-now/u);

  const running = renderWebRouteComponent(
    { key: "skills", skills: r23SkillsVm({ enabled: true, running: true, last_run_at: null }), isAdmin: true },
    { locale: "zh-CN" }
  );
  assert.match(running.html, /data-r23-skills-curation="running"/u);
  // 正在跑时同样不渲按钮（防抖在服务端也有一道 409，这里只是不送注定失败的点击）。
  assert.doesNotMatch(running.html, /data-r23-skills-curate-now/u);

  const idle = renderWebRouteComponent(
    { key: "skills", skills: r23SkillsVm({ enabled: true, running: false, last_run_at: "2026-09-04T18:30:00.000Z" }), isAdmin: true },
    { locale: "zh-CN" }
  );
  assert.match(idle.html, /data-r23-skills-curation="idle"/u);
  assert.match(idle.html, /data-r23-skills-curation-last-run="2026-09-04T18:30:00\.000Z"/u);
  assert.match(idle.html, /data-r23-skills-curate-now/u);

  // last_run_at 为空时照实说「这次启动后还没自学过」，不显示空白也不假装从没开过。
  const neverRan = renderWebRouteComponent(
    { key: "skills", skills: r23SkillsVm({ enabled: true, running: false, last_run_at: null }), isAdmin: true },
    { locale: "zh-CN" }
  );
  assert.match(neverRan.html, /data-r23-skills-curation-never="true"/u);
  assert.doesNotMatch(neverRan.html, /data-r23-skills-curation-last-run/u);
});

test("R23 SA-06 the manual self-learning button is admin-only and never leaks internal jargon", () => {
  const vm = r23SkillsVm({ enabled: true, running: false, last_run_at: null });
  const member = renderWebRouteComponent({ key: "skills", skills: vm }, { locale: "zh-CN" });
  assert.doesNotMatch(member.html, /data-r23-skills-curate-now/u);
  // 非管理员仍然看得到「AI 自学开着」这件事——只是没有触发按钮。
  assert.match(member.html, /data-r23-skills-curation="idle"/u);

  const admin = renderWebRouteComponent({ key: "skills", skills: vm, isAdmin: true }, { locale: "en-US" });
  assert.match(admin.html, /data-r23-skills-curate-now/u);
  assert.ok(admin.html.includes("Learn a round now"));
  // 禁词只对**可见文案**成立——data-r23-skills-curation 是标记属性（测试钩子），不是给用户读的。
  for (const html of [member.html, admin.html]) {
    const visibleText = html.replace(/<[^>]*>/gu, " ");
    assert.doesNotMatch(visibleText, /蒸馏|curation|curate|distill/iu);
  }
});

test("R14 批 MEM: memory route renders the profile tab with category badge, provenance, and edited-by line", () => {
  const userMemories = {
    generated_at: "2026-07-14T00:00:00.000Z",
    memories: [
      {
        id: "99000000-0000-4000-8000-000000000010",
        category: "preference" as const,
        key: "reply-tone",
        value_md: "喜欢简洁的回复",
        confidence: 0.8,
        workspace_scoped: true,
        created_at: "2026-07-01T00:00:00.000Z",
        updated_at: "2026-07-10T00:00:00.000Z",
        edited_at: "2026-07-12T00:00:00.000Z",
        provenance: { kind: "agent_run" as const, label: "来自会话《周报》的一次 AI 执行" }
      },
      {
        id: "99000000-0000-4000-8000-000000000011",
        category: "correction" as const,
        key: "proposal:90000000-0000-4000-8000-000000000099",
        value_md: "不要用黑话",
        confidence: 1,
        workspace_scoped: false,
        created_at: "2026-06-01T00:00:00.000Z",
        updated_at: "2026-06-01T00:00:00.000Z"
      }
    ],
    totals: { active: 2 }
  };
  const teamSkills = { generated_at: "2026-07-14T00:00:00.000Z", skills: [] };

  const zh = renderWebRouteComponent({ key: "memory", memory: { userMemories, teamSkills, tab: "profile", isAdmin: false } }, { locale: "zh-CN" });
  const en = renderWebRouteComponent({ key: "memory", memory: { userMemories, teamSkills, tab: "profile", isAdmin: false } }, { locale: "en-US" });

  assert.equal(zh.key, "memory");
  assert.equal(zh.html.includes('data-r4-route-component="memory"'), true);
  assert.equal(zh.html.includes('data-r14-mem-active-tab="profile"'), true);
  assert.equal(zh.html.includes('data-r14-mem-item="99000000-0000-4000-8000-000000000010"'), true);
  assert.equal(zh.html.includes("喜欢简洁的回复"), true);
  // 出处：有 provenance.label 就用它；否则三级降级到「早期记录，出处不明」。
  assert.equal(zh.html.includes("来自会话《周报》的一次 AI 执行"), true);
  assert.equal(zh.html.includes("早期记录，出处不明"), true);
  // edited_at 是独立叠加行，不是取代出处。UI-02：本地时区渲染，期望值由格式化助手算出（时区无关）。
  assert.equal(zh.html.includes(`最近由你于 ${formatLocalDate("2026-07-12T00:00:00.000Z")} 修改`), true);
  assert.equal(en.html.includes(`Last edited by you on ${formatLocalDate("2026-07-12T00:00:00.000Z")}`), true);
  // 「团队技能」tab 面板仍在（hidden），空态文案存在。
  assert.equal(zh.html.includes('data-r14-mem-skills-panel="true" hidden'), true);
  assert.equal(zh.html.includes('data-r14-mem-skills-empty="true"'), true);
  assertNoMainWindowBoundaryLeak(zh.html);
});

test("R14 批 MEM: memory route shows the honest empty state for a user with no memories yet", () => {
  const userMemories = { generated_at: "2026-07-14T00:00:00.000Z", memories: [], totals: { active: 0 } };
  const teamSkills = { generated_at: "2026-07-14T00:00:00.000Z", skills: [] };
  const en = renderWebRouteComponent({ key: "memory", memory: { userMemories, teamSkills, tab: "profile", isAdmin: false } }, { locale: "en-US" });
  assert.equal(en.html.includes('data-r14-mem-profile-empty="true"'), true);
});

test("R14 批 MEM: memory route gates team-skill edit/deactivate to admins and active versions only", () => {
  const userMemories = { generated_at: "2026-07-14T00:00:00.000Z", memories: [], totals: { active: 0 } };
  const teamSkills = {
    generated_at: "2026-07-14T00:00:00.000Z",
    skills: [
      {
        id: "99000000-0000-4000-8000-000000000020",
        skill_key: "quarterly-report",
        name: "季度报告",
        when_to_use: "生成季度业务报告",
        version: 3,
        source_kind: "distilled" as const,
        created_by_kind: "ai" as const,
        sample_count: 4,
        updated_at: "2026-07-10T00:00:00.000Z",
        content_md: "## 总则\n写清楚数据来源",
        status: "active" as const
      },
      {
        id: "99000000-0000-4000-8000-000000000021",
        skill_key: "quarterly-report",
        name: "季度报告",
        when_to_use: "生成季度业务报告",
        version: 2,
        source_kind: "distilled" as const,
        created_by_kind: "human" as const,
        sample_count: 4,
        updated_at: "2026-06-10T00:00:00.000Z",
        content_md: "## 总则\n旧版本",
        status: "deprecated" as const,
        deprecated_reason: "由 admin 手动停用"
      }
    ]
  };

  // 非管理员：全员可读列表（含 deprecated 历史版本），但没有编辑/停用按钮。
  const member = renderWebRouteComponent({ key: "memory", memory: { userMemories, teamSkills, tab: "skills", isAdmin: false } }, { locale: "zh-CN" });
  assert.equal(member.html.includes('data-r14-skill-item="99000000-0000-4000-8000-000000000020"'), true);
  assert.equal(member.html.includes('data-r14-skill-item="99000000-0000-4000-8000-000000000021"'), true);
  assert.equal(member.html.includes('data-r14-skill-edit-btn="true"'), false);
  assert.equal(member.html.includes('data-r14-skill-deactivate-btn="true"'), false);
  assert.equal(member.html.includes("data-r14-mem-admin-note"), true);
  assert.equal(member.html.includes("由 admin 手动停用"), true);
  assert.equal(member.html.includes("管理员手改"), true);

  // 管理员：仅当前激活版本(v3)有编辑/停用；已 deprecated 的历史版本(v2)只读，不因为 isAdmin 也长出按钮。
  const admin = renderWebRouteComponent({ key: "memory", memory: { userMemories, teamSkills, tab: "skills", isAdmin: true } }, { locale: "zh-CN" });
  assert.equal(admin.html.includes('data-r14-skill-edit-btn="true" data-r14-skill-id="99000000-0000-4000-8000-000000000020"'), true);
  assert.equal(admin.html.includes('data-r14-skill-deactivate-btn="true" data-r14-skill-id="99000000-0000-4000-8000-000000000020"'), true);
  assert.equal(admin.html.includes('data-r14-skill-edit-btn="true" data-r14-skill-id="99000000-0000-4000-8000-000000000021"'), false);
  assert.equal(admin.html.includes("data-r14-mem-admin-note"), false);
  assertNoMainWindowBoundaryLeak(admin.html);
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

// R14 批 FEEDBACK（web-feedback-ui）：提议详情页「有用/没用」反馈块——additive optional 字段，
// 存量响应/旧客户端零回归；有值时渲染字符 tile（✓/✗）+ 可选备注面板，服务端算好的 href/method/
// request_json 照 review_actions 既有风格直接渲染点击。
function proposalWithFeedback(feedback: ProposalDetailVM["feedback"]): ProposalDetailVM {
  return { ...surfaceVm().page_vms.proposal, feedback };
}

test("R14 batch FEEDBACK: proposal route component renders nothing when the VM carries no feedback field (additive zero-regression)", () => {
  const proposal = surfaceVm().page_vms.proposal;
  assert.equal(proposal.feedback, undefined);
  const rendered = renderWebRouteComponent({ key: "proposal", proposal }, { locale: "zh-CN" });

  assert.equal(rendered.html.includes("data-r14-proposal-feedback"), false);
});

test("R14 batch FEEDBACK: proposal route component renders unmarked feedback tiles with the clear link hidden and note disabled", () => {
  const proposal = proposalWithFeedback({
    my_verdict: null,
    my_note: null,
    mark_useful: { id: "mark_useful", label: "有用", method: "PUT", href: "/api/proposals/r4-route-component-proposal/feedback", request_json: { verdict: "useful" } },
    mark_not_useful: { id: "mark_not_useful", label: "没用", method: "PUT", href: "/api/proposals/r4-route-component-proposal/feedback", request_json: { verdict: "not_useful" } }
  });
  const rendered = renderWebRouteComponent({ key: "proposal", proposal }, { locale: "zh-CN" });
  const html = rendered.html;

  assert.equal(html.includes('data-r14-proposal-feedback="true"'), true);
  assert.equal(html.includes('data-r14-proposal-feedback-verdict=""'), true);
  // 两个 tile 都渲染、都未选中——字符 tile 是排版符号 ✓/✗，不是 emoji。
  assert.equal(html.includes('data-r14-proposal-feedback-tile="useful"'), true);
  assert.equal(html.includes('data-r14-proposal-feedback-tile="not_useful"'), true);
  assert.equal(html.includes("wh-r14-proposal-feedback-tile--on"), false);
  assert.equal(html.includes('data-r4-proposal-feedback-tile="useful" aria-pressed="true"'), false);
  assert.match(html, /data-r14-proposal-feedback-tile="useful"[^>]*aria-pressed="false"/u);
  assert.match(html, /data-r14-proposal-feedback-tile="not_useful"[^>]*aria-pressed="false"/u);
  assert.equal(html.includes(">✓<"), true);
  assert.equal(html.includes(">✗<"), true);
  // 未判定时撤销链接必须存在于 DOM（供客户端乐观切换后直接翻 hidden）但带 hidden 属性。
  assert.match(html, /data-r14-proposal-feedback-clear="true"[^>]* hidden>/u);
  // request_json 服务端算好，客户端原样渲染（照 review_actions 既有风格）。
  assert.equal(html.includes('data-request-json="{&quot;verdict&quot;:&quot;useful&quot;}"'), true);
  assert.equal(html.includes('data-request-json="{&quot;verdict&quot;:&quot;not_useful&quot;}"'), true);
  // 无判定时备注保存按钮禁用、备注框为空。
  assert.match(html, /data-r14-proposal-feedback-note-save disabled>/u);
  assert.equal(html.includes("这条提议对你有帮助吗"), true);
  // 文案永不出现「Cuu」——用「AI 助手」这类通用措辞（同 avatar-crop-modal.test.ts 既有口径）。
  // 注意：只扫反馈块自身——评论区固定 fixture 的 author_label 是测试数据里硬编码的 "Cuu"（生产路径走
  // pageT(locale,"proposal.author.ai") 永不写死该字面量），与本批新增文案无关，不在此断言范围内。
  const feedbackSection = /<section class="wh-card wh-r4-route-card wh-r14-proposal-feedback"[\s\S]*?<\/section>/u.exec(html);
  assert.ok(feedbackSection, "feedback section markup must be present");
  assert.doesNotMatch(feedbackSection[0], /\bCuu\b/u, "web copy must never say Cuu");
});

test("R14 batch FEEDBACK: proposal route component highlights the useful tile, reveals undo, and carries the saved note", () => {
  const proposal = proposalWithFeedback({
    my_verdict: "useful",
    my_note: "回滚说明写得很清楚",
    mark_useful: { id: "mark_useful", label: "有用", method: "PUT", href: "/api/proposals/r4-route-component-proposal/feedback", request_json: { verdict: "useful" } },
    mark_not_useful: { id: "mark_not_useful", label: "没用", method: "PUT", href: "/api/proposals/r4-route-component-proposal/feedback", request_json: { verdict: "not_useful" } },
    clear: { id: "clear_feedback", label: "撤销反馈", method: "DELETE", href: "/api/proposals/r4-route-component-proposal/feedback" }
  });
  const rendered = renderWebRouteComponent({ key: "proposal", proposal }, { locale: "zh-CN" });
  const html = rendered.html;

  assert.equal(html.includes('data-r14-proposal-feedback-verdict="useful"'), true);
  assert.match(html, /class="wh-r14-proposal-feedback-tile wh-r14-proposal-feedback-tile--on"[^>]*data-r14-proposal-feedback-tile="useful"/u);
  assert.match(html, /data-r14-proposal-feedback-tile="useful"[^>]*aria-pressed="true"/u);
  assert.match(html, /data-r14-proposal-feedback-tile="not_useful"[^>]*aria-pressed="false"/u);
  // 已判定——撤销链接可见（不带 hidden），备注保存按钮可点（不带 disabled）。
  assert.doesNotMatch(html, /data-r14-proposal-feedback-clear="true"[^>]* hidden>/u);
  assert.equal(html.includes("撤销反馈"), true);
  assert.doesNotMatch(html, /data-r14-proposal-feedback-note-save disabled>/u);
  assert.equal(html.includes(">回滚说明写得很清楚</textarea>"), true);
});

test("R14 batch FEEDBACK: proposal route component localizes the feedback block into English", () => {
  const proposal = proposalWithFeedback({
    my_verdict: "not_useful",
    my_note: null,
    mark_useful: { id: "mark_useful", label: "Useful", method: "PUT", href: "/api/proposals/r4-route-component-proposal/feedback", request_json: { verdict: "useful" } },
    mark_not_useful: { id: "mark_not_useful", label: "Not useful", method: "PUT", href: "/api/proposals/r4-route-component-proposal/feedback", request_json: { verdict: "not_useful" } },
    clear: { id: "clear_feedback", label: "Clear feedback", method: "DELETE", href: "/api/proposals/r4-route-component-proposal/feedback" }
  });
  const rendered = renderWebRouteComponent({ key: "proposal", proposal }, { locale: "en-US" });
  const html = rendered.html;

  assert.equal(html.includes("Was this proposal helpful?"), true);
  assert.equal(html.includes("Note (optional, up to 200 characters)"), true);
  assert.equal(html.includes("Save note"), true);
  assert.equal(html.includes("Clear feedback"), true);
  assert.match(html, /class="wh-r14-proposal-feedback-tile wh-r14-proposal-feedback-tile--on"[^>]*data-r14-proposal-feedback-tile="not_useful"/u);
  assert.equal(html.includes("这条提议对你有帮助吗"), false);
});

// ── R15 批 web-mirror（web 只读会话镜像）渲染层 ────────────────────────────────────────
function conversationMirrorMessages(): ConversationMessageVM[] {
  const cid = "30000000-0000-4000-8000-000000000003";
  const owner = "60000000-0000-4000-8000-000000000006";
  const ivy = "60000000-0000-4000-8000-000000000007";
  return [
    {
      id: "40000000-0000-4000-8000-000000000101",
      conversation_id: cid,
      seq: 5,
      sender_type: "user",
      sender_user_id: owner,
      thread_root_id: null,
      edited_at: "2026-07-12T01:00:05.000000Z",
      pinned: { at: "2026-07-12T01:01:00.000000Z", by_user_id: owner },
      reactions: [
        { key: "approve", user_ids: [ivy] },
        { key: "watch", user_ids: [ivy, owner] }
      ],
      kind: "text",
      content: { text: "先看风险\n<script>alert(1)</script>" },
      created_at: "2026-07-12T01:00:00.000000Z"
    },
    {
      id: "40000000-0000-4000-8000-000000000102",
      conversation_id: cid,
      seq: 6,
      sender_type: "cuu",
      sender_user_id: null,
      thread_root_id: null,
      reply_to: {
        message_id: "40000000-0000-4000-8000-000000000199",
        sender_type: "user",
        sender_user_id: ivy,
        preview_text: "",
        deleted: true
      },
      kind: "text",
      content: { text: "这是我的看法？", is_clarifying_question: true, clarify_options: ["先看风险", "先看指标"] },
      created_at: "2026-07-12T01:00:02.000000Z"
    },
    {
      id: "40000000-0000-4000-8000-000000000103",
      conversation_id: cid,
      seq: 7,
      sender_type: "user",
      sender_user_id: ivy,
      thread_root_id: null,
      kind: "file_card",
      content: { drive_item_id: "93000000-0000-4000-8000-000000000002", snapshot_name: "风险清单.md" },
      created_at: "2026-07-12T01:00:04.000000Z"
    },
    {
      id: "40000000-0000-4000-8000-000000000104",
      conversation_id: cid,
      seq: 8,
      sender_type: "system",
      sender_user_id: null,
      thread_root_id: null,
      kind: "system_event",
      content: { event: "proposal_settled", title: "周报变更", outcome: "merged", proposal_id: "50000000-0000-4000-8000-000000000001" },
      created_at: "2026-07-12T01:00:06.000000Z"
    },
    {
      id: "40000000-0000-4000-8000-000000000105",
      conversation_id: cid,
      seq: 9,
      sender_type: "user",
      sender_user_id: ivy,
      thread_root_id: null,
      deleted_at: "2026-07-12T01:00:08.000000Z",
      kind: "text",
      content: { text: "" },
      created_at: "2026-07-12T01:00:07.000000Z"
    }
  ];
}

test("R15 web-mirror conversation component renders a read-only bilingual message mirror", () => {
  const conversation = {
    conversationId: "30000000-0000-4000-8000-000000000003",
    messages: conversationMirrorMessages(),
    members: [
      { id: "60000000-0000-4000-8000-000000000006", nickname: "R15 owner" },
      { id: "60000000-0000-4000-8000-000000000007", nickname: "Ivy" }
    ],
    isLatest: true,
    refreshHref: "/conversations/30000000-0000-4000-8000-000000000003"
  };
  const zh = renderWebRouteComponent({ key: "conversation", conversation }, { locale: "zh-CN" });
  const html = zh.html;

  // 只读边界：横幅 + 无 composer/textarea + 无写按钮。
  assert.equal(html.includes("只读镜像 · 完整协作请在桌面工作台"), true);
  assert.equal(html.includes('data-r15-conversation-readonly="true"'), true);
  assert.equal(html.includes("<textarea"), false);
  assert.equal(html.includes("<button"), false);
  assert.equal(/data-action-id=/u.test(html), false);
  // 昵称解析（成员目录）。
  assert.equal(html.includes("R15 owner"), true);
  assert.equal(html.includes("Ivy"), true);
  assert.equal(html.includes("Cuu"), true);
  // 用户内容转义（防注入）：脚本被转义，绝不原样出现。
  assert.equal(html.includes("<script>alert(1)</script>"), false);
  assert.equal(html.includes("&lt;script&gt;"), true);
  // 换行 → <br>。
  assert.equal(html.includes("先看风险<br>"), true);
  // 反应聚合：emoji + 计数（reaction 破例 emoji）。
  assert.equal(html.includes("👍"), true);
  assert.equal(html.includes("👀"), true);
  assert.match(html, /wh-mirror-reaction-emoji" aria-hidden="true">👀<\/span><span>2<\/span>/u);
  // 编辑 + 置顶标记。
  assert.equal(html.includes("已编辑"), true);
  assert.equal(html.includes("已置顶"), true);
  // 引用回复：原消息已删 → 占位。
  assert.equal(html.includes("原消息已删除"), true);
  // 澄清追问徽标 + 选项。
  assert.equal(html.includes("Cuu 在问"), true);
  assert.equal(html.includes("先看指标"), true);
  // file_card 快照名（只读 chip）。
  assert.equal(html.includes("风险清单.md"), true);
  // system_event 落定行朴素渲染：标题 + 结算词。
  assert.equal(html.includes("周报变更 · 已采纳"), true);
  // 删除墓碑。
  assert.equal(html.includes("此消息已删除"), true);

  // 英文横幅 + 结算词本地化。
  const en = renderWebRouteComponent({ key: "conversation", conversation }, { locale: "en-US" });
  assert.equal(en.html.includes("Read-only mirror · Collaborate in the desktop workbench"), true);
  assert.equal(en.html.includes("周报变更 · Adopted"), true);
  assert.equal(en.html.includes("Original message deleted"), true);
  assert.equal(en.html.includes("Cuu is asking"), true);
});

test("R15 web-mirror conversation component shows an honest empty state and pagination controls", () => {
  const empty = renderWebRouteComponent({
    key: "conversation",
    conversation: {
      conversationId: "c-1",
      messages: [],
      members: [],
      isLatest: true,
      refreshHref: "/conversations/c-1"
    }
  }, { locale: "zh-CN" });
  assert.equal(empty.html.includes("这个会话还没有可显示的消息"), true);
  // 刷新按钮常驻。
  assert.equal(empty.html.includes('data-r15-mirror-refresh="true"'), true);

  const paged = renderWebRouteComponent({
    key: "conversation",
    conversation: {
      conversationId: "c-1",
      messages: [],
      members: [],
      targetSeq: 12,
      olderBeforeSeq: 3,
      newerAfterSeq: 20,
      isLatest: false,
      refreshHref: "/conversations/c-1?seq=12"
    }
  }, { locale: "en-US" });
  assert.equal(paged.html.includes('href="/conversations/c-1?before=3"'), true);
  assert.equal(paged.html.includes('href="/conversations/c-1?after=20"'), true);
  assert.equal(paged.html.includes('data-r15-mirror-latest="true"'), true);
  assert.equal(paged.html.includes('data-r15-conversation-target-seq="12"'), true);
});

test("R18 web-mirror conversation component renders a participants side-region skeleton for hydration", () => {
  const zh = renderWebRouteComponent({
    key: "conversation",
    conversation: {
      conversationId: "c-9",
      messages: [],
      members: [],
      isLatest: true,
      refreshHref: "/conversations/c-9"
    }
  }, { locale: "zh-CN" });
  // SSR 只出加载态骨架 + hydration 锚点（真参与者与群管理动作由 browser.ts 拉 GET /participants 后注入）。
  assert.equal(zh.html.includes('data-r18-conversation-participants="true"'), true);
  assert.equal(zh.html.includes('data-r18-conversation-id="c-9"'), true);
  assert.equal(zh.html.includes('data-r18-conversation-participants-body="true"'), true);
  assert.equal(zh.html.includes("正在加载参与者"), true);

  const en = renderWebRouteComponent({
    key: "conversation",
    conversation: {
      conversationId: "c-9",
      messages: [],
      members: [],
      isLatest: true,
      refreshHref: "/conversations/c-9"
    }
  }, { locale: "en-US" });
  assert.equal(en.html.includes("Loading participants"), true);
});

test("R15 web-mirror conversation component renders system_event risk digest and tool_note plainly", () => {
  const messages: ConversationMessageVM[] = [
    {
      id: "40000000-0000-4000-8000-000000000201",
      conversation_id: "c-1",
      seq: 1,
      sender_type: "system",
      sender_user_id: null,
      thread_root_id: null,
      kind: "system_event",
      content: { event: "risk_digest", summary: "3 项工单停滞、1 项临期", stalled_count: 3 },
      created_at: "2026-07-12T02:00:00.000000Z"
    },
    {
      id: "40000000-0000-4000-8000-000000000202",
      conversation_id: "c-1",
      seq: 2,
      sender_type: "cuu",
      sender_user_id: null,
      thread_root_id: null,
      kind: "tool_note",
      content: { summary: "查询了三个工单的状态" },
      created_at: "2026-07-12T02:00:02.000000Z"
    },
    {
      id: "40000000-0000-4000-8000-000000000203",
      conversation_id: "c-1",
      seq: 3,
      sender_type: "cuu",
      sender_user_id: null,
      thread_root_id: null,
      kind: "action_card",
      content: { items: [{ title_md: "**跟进** 供应延期", status: "waiting_decision" }, { title_md: "复核预算", status: "running" }] },
      created_at: "2026-07-12T02:00:04.000000Z"
    }
  ];
  const html = renderWebRouteComponent({
    key: "conversation",
    conversation: { conversationId: "c-1", messages, members: [], isLatest: true, refreshHref: "/conversations/c-1" }
  }, { locale: "zh-CN" }).html;

  assert.equal(html.includes("今日风险巡检：3 项工单停滞、1 项临期"), true);
  assert.equal(html.includes("查询了三个工单的状态"), true);
  // action_card 朴素渲染：header 计数 + 去 markdown 的条目标题（无交互按钮）。
  assert.equal(html.includes("Cuu 从讨论里拎出 2 件事"), true);
  assert.equal(html.includes("跟进 供应延期"), true);
  assert.equal(html.includes("**跟进**"), false);
  assert.equal(html.includes("<button"), false);
});

// R23 P4（R20 P2A 端点上界面）：POST /api/workitems/:id/{claim,assign} 后端早已齐备，两端却一个入口
// 都没有。工作项详情页新增「负责人与协作」卡——两个动作的按钮各自由服务端下发的资格（can_claim /
// can_assign）决定渲不渲，绝不渲一个点下去必定 403 的假入口。
test("R23 P4: work item route component gates claim/assign controls on the server-issued permissions", () => {
  const base = surfaceVm().page_vms.workitem;

  const both = renderWebRouteComponent({
    key: "workitem",
    workitem: { ...base, can_claim: true, can_assign: true }
  }, { locale: "zh-CN" });
  assert.equal(both.html.includes('data-r23-workitem-assignment="true"'), true);
  assert.equal(both.html.includes(`data-r23-workitem-assignment-workitem="${base.workitem.id}"`), true);
  assert.equal(both.html.includes('data-r23-workitem-claim="true"'), true);
  assert.equal(both.html.includes('data-r23-workitem-assign="true"'), true);
  assert.equal(both.html.includes('data-r23-workitem-assign-select="true"'), true);
  assert.equal(both.html.includes('data-r23-workitem-assign-role="true"'), true);
  assert.equal(both.html.includes('data-r23-workitem-assign-submit="true"'), true);
  assert.equal(both.html.includes('data-r23-workitem-assignment-readonly="true"'), false);

  const claimOnly = renderWebRouteComponent({
    key: "workitem",
    workitem: { ...base, can_claim: true, can_assign: false }
  }, { locale: "zh-CN" });
  assert.equal(claimOnly.html.includes('data-r23-workitem-claim="true"'), true);
  assert.equal(claimOnly.html.includes('data-r23-workitem-assign="true"'), false);

  // 两项资格都没有（或 VM 根本没带这两个字段——旧夹具）：一个按钮都不渲，只留一句说清谁能改。
  const readOnly = renderWebRouteComponent({ key: "workitem", workitem: base }, { locale: "zh-CN" });
  assert.equal(readOnly.html.includes('data-r23-workitem-claim="true"'), false);
  assert.equal(readOnly.html.includes('data-r23-workitem-assign="true"'), false);
  assert.equal(readOnly.html.includes('data-r23-workitem-assignment-readonly="true"'), true);

  // 已认领时详情页要说清现在谁在跟；没人认领时给诚实空态而不是留白。
  const claimed = renderWebRouteComponent({
    key: "workitem",
    workitem: {
      ...base,
      workitem: {
        ...base.workitem,
        claimed_by_user_id: "95000000-0000-4000-8000-000000000031",
        claimed_by_nickname: "小拓"
      }
    }
  }, { locale: "zh-CN" });
  assert.equal(claimed.html.includes('data-r23-workitem-assignment-current="95000000-0000-4000-8000-000000000031"'), true);
  assert.equal(claimed.html.includes("小拓"), true);
  assert.equal(readOnly.html.includes('data-r23-workitem-assignment-unclaimed="true"'), true);

  const en = renderWebRouteComponent({
    key: "workitem",
    workitem: { ...base, can_claim: true, can_assign: true }
  }, { locale: "en-US" });
  assert.equal(en.html.includes("Claim it"), true);
  assert.equal(en.html.includes("Assign to"), true);
  assertNoMainWindowBoundaryLeak(both.html);
  assertNoMainWindowBoundaryLeak(en.html);
});

// R23 P4：assign 写的是 work_item_assignments，不是 claimed_by——详情页若只渲「现在谁在跟」，指派完
// 页面毫无变化，那就是个看不出结果的假动作。名单要渲出来，角色要说人话，名字缺席也不能吐裸 user id。
test("R23 P4: work item route component lists assignees with their role in plain words", () => {
  const base = surfaceVm().page_vms.workitem;
  const lead = "95000000-0000-4000-8000-000000000041";
  const helper = "95000000-0000-4000-8000-000000000042";
  const ghost = "95000000-0000-4000-8000-000000000043";

  // 没有任何指派时不渲空名单区块（诚实缺省，不给读者一个空壳）。
  const none = renderWebRouteComponent({ key: "workitem", workitem: base }, { locale: "zh-CN" });
  assert.equal(none.html.includes('data-r23-workitem-assignees="true"'), false);

  const withAssignees = renderWebRouteComponent({
    key: "workitem",
    workitem: {
      ...base,
      assignees: [
        { user_id: lead, nickname: "小拓", role: "lead" as const },
        { user_id: helper, nickname: "阿岚", role: "collaborator" as const }
      ]
    }
  }, { locale: "zh-CN" });
  assert.equal(withAssignees.html.includes('data-r23-workitem-assignees="true"'), true);
  assert.equal(withAssignees.html.includes(`data-r23-workitem-assignee="${lead}"`), true);
  assert.equal(withAssignees.html.includes(`data-r23-workitem-assignee-role="lead"`), true);
  assert.equal(withAssignees.html.includes(`data-r23-workitem-assignee="${helper}"`), true);
  assert.equal(withAssignees.html.includes("小拓"), true);
  assert.equal(withAssignees.html.includes("阿岚"), true);
  // 角色不能裸吐机器枚举给读者看。
  assert.equal(withAssignees.html.includes("主责"), true);
  assert.equal(withAssignees.html.includes("协作"), true);

  // 账号被硬删（nickname 缺席）：这一行仍要在（不能因为名字没了就把人吞掉），但绝不渲裸 uuid 当名字。
  const ghosted = renderWebRouteComponent({
    key: "workitem",
    workitem: { ...base, assignees: [{ user_id: ghost, role: "collaborator" as const }] }
  }, { locale: "zh-CN" });
  assert.equal(ghosted.html.includes(`data-r23-workitem-assignee="${ghost}"`), true);
  assert.equal(ghosted.html.includes("已停用的成员"), true);
  assert.equal(ghosted.html.includes(`<strong>${ghost}</strong>`), false);

  const en = renderWebRouteComponent({
    key: "workitem",
    workitem: { ...base, assignees: [{ user_id: lead, nickname: "Tuo", role: "lead" as const }] }
  }, { locale: "en-US" });
  assert.equal(en.html.includes("Assigned to:"), true);
  assert.equal(en.html.includes("Lead"), true);
  assertNoMainWindowBoundaryLeak(withAssignees.html);
});

// R23 P4：GET/POST /api/workitems/:id/comments 此前两端零界面。详情页 VM 不带评论，所以讨论区是
// 客户端按需水合——这里只锁 SSR 骨架（挂载点 + 加载中文案 + 发布表单），列表本身由 browser.ts 注入。
test("R23 P4: work item route component renders a discussion slot with a post-comment form", () => {
  const base = surfaceVm().page_vms.workitem;
  const zh = renderWebRouteComponent({ key: "workitem", workitem: base }, { locale: "zh-CN" });
  const en = renderWebRouteComponent({ key: "workitem", workitem: base }, { locale: "en-US" });

  assert.equal(zh.html.includes('data-r23-workitem-comments="true"'), true);
  assert.equal(zh.html.includes(`data-r23-workitem-comments-workitem="${base.workitem.id}"`), true);
  assert.equal(zh.html.includes('data-r23-workitem-comments-body="true"'), true);
  assert.equal(zh.html.includes('data-r23-workitem-comments-loading="true"'), true);
  assert.equal(zh.html.includes('data-r23-workitem-comment-form="true"'), true);
  assert.equal(zh.html.includes('data-r23-workitem-comment-input="true"'), true);
  assert.equal(zh.html.includes('data-r23-workitem-comment-submit="true"'), true);
  assert.equal(zh.html.includes("正在加载讨论"), true);
  assert.equal(en.html.includes("Loading discussion"), true);
  assert.equal(en.html.includes("Post comment"), true);
});

// ── R23 F-04（升级转交端到端）─────────────────────────────────────────────────────
// 此前 web 通用卡直接把 /delegate 动作剥掉（rank1 的临时办法：没有选人 UI，渲出来就是个死按钮），
// 于是服务端即便发了这个动作，web 也永远看不见。现在改成：动作行不渲它，动作行下面挂一份选人器。
test("R23 F-04 Home decision card swaps a delegate action for the teammate picker, keeping the rest of the actions", () => {
  const vm = surfaceVm();
  const primary = vm.page_vms.attention.primary;
  assert.ok(primary);
  const escalationId = "94000000-0000-4000-8000-000000000f04";
  const withDelegate = {
    ...vm.page_vms.attention,
    primary: {
      ...primary,
      actions: [
        { id: "escalation_pm_mode", label: "我来定方向", style: "primary" as const, method: "POST" as const, href: `/api/escalations/${escalationId}/resolve` },
        { id: "escalation_delegate", label: "转交他人", style: "secondary" as const, method: "POST" as const, href: `/api/escalations/${escalationId}/delegate` }
      ]
    }
  };

  const zh = renderWebRouteComponent({ key: "home", attention: withDelegate }, { locale: "zh-CN" });

  // 转交不再是动作行里的一个按钮——点它没有「转交给谁」可填。
  assert.equal(zh.html.includes('data-action-id="escalation_delegate"'), false);
  // 取而代之：一份带目标 href 的选人器，href 就是服务端发的那条真端点。
  assert.equal(zh.html.includes('data-wh-delegate="true"'), true);
  assert.equal(zh.html.includes(`data-wh-delegate-href="/api/escalations/${escalationId}/delegate"`), true);
  assert.equal(zh.html.includes("data-wh-delegate-select"), true);
  assert.equal(zh.html.includes("data-wh-delegate-submit"), true);
  assert.equal(zh.html.includes("转交给同事"), true);
  // 同卡的其他动作一个都没少。
  assert.equal(zh.html.includes('data-action-id="escalation_pm_mode"'), true);

  const en = renderWebRouteComponent({ key: "home", attention: withDelegate }, { locale: "en-US" });
  assert.equal(en.html.includes("Hand off to a teammate"), true);
  assert.equal(en.html.includes("转交给同事"), false);
  assertNoMainWindowBoundaryLeak(zh.html);
  assertNoMainWindowBoundaryLeak(en.html);
});

// R23 P4：评论行渲染是纯函数（renderWorkItemCommentRows），供 browser.ts 拉到数据后复用。服务端按
// 对话顺序回最多 200 条，详情页默认只展开最近 8 条——更早的必须有一颗明说条数的展开按钮，不许静默截断。
test("R23 P4: renderWorkItemCommentRows shows the latest comments and offers an honest expand control", () => {
  const comment = (n: number): WorkItemComment => ({
    id: `comment-${n}`,
    work_item_id: "94000000-0000-4000-8000-000000000005",
    author_nickname: `作者${n}`,
    body: `第 ${n} 条留言`,
    created_at: "2026-07-10T09:00:00.000Z",
    updated_at: "2026-07-10T09:00:00.000Z"
  });

  const empty = renderWorkItemCommentRows([], "en-US");
  assert.equal(empty.includes("No comments on this item yet"), true);
  assert.equal(renderWorkItemCommentRows([], "zh-CN").includes("还没有人在这个事项下留言"), true);

  const few = renderWorkItemCommentRows([comment(1), comment(2)], "zh-CN");
  assert.equal(few.includes('data-r23-workitem-comment="comment-1"'), true);
  assert.equal(few.includes("第 2 条留言"), true);
  assert.equal(few.includes("作者1"), true);
  assert.equal(few.includes("data-r23-workitem-comments-more"), false);

  const many = Array.from({ length: 11 }, (_, index) => comment(index + 1));
  const collapsed = renderWorkItemCommentRows(many, "zh-CN");
  // 只展开最近 8 条：最早的 3 条不在里面，且展开按钮把 3 这个数字说出来。
  assert.equal(collapsed.includes('data-r23-workitem-comments-more="3"'), true);
  assert.equal(collapsed.includes("展开更早的 3 条"), true);
  assert.equal(collapsed.includes('data-r23-workitem-comment="comment-1"'), false);
  assert.equal(collapsed.includes('data-r23-workitem-comment="comment-11"'), true);

  const expanded = renderWorkItemCommentRows(many, "zh-CN", { expanded: true });
  assert.equal(expanded.includes('data-r23-workitem-comment="comment-1"'), true);
  assert.equal(expanded.includes("data-r23-workitem-comments-more"), false);
});

// R23 P4（R20 P2A 端点上界面）：POST /api/projects/:id/{archive,delete} 后端早已齐备，web 端此前只有
// 一枚「已归档」徽标、没有任何动作入口。项目主页新增「项目生命周期」分区——整块由服务端下发的
// can_manage_lifecycle 决定渲不渲（管理员/项目负责人之外的人连区块都看不到）。
test("R23 P4: project home renders archive/delete controls only when the server says the viewer may manage lifecycle", () => {
  const baseVm = {
    generated_at: "2026-06-11T09:00:00.000Z",
    project: {
      id: "93000000-0000-4000-8000-000000000001",
      name: "R5 Workspace",
      slug: "r5-workspace",
      description: null,
      owner_label: "owner",
      status: "active" as const
    },
    summary: { open_work_item_count: 0, total_open_work_item_count: 0 },
    open_work_items: [],
    drive: { file_count: 0, recent_files: [] },
    actions: {
      new_task: { id: "new_task", label: "新任务", method: "GET" as const, href: "/intake" },
      open_drive: { id: "open_drive", label: "打开网盘", method: "GET" as const, href: "/drive?project_id=93000000-0000-4000-8000-000000000001" }
    }
  };

  const asMember = renderWebRouteComponent({ key: "project-home", project: baseVm }, { locale: "zh-CN" });
  assert.equal(asMember.html.includes('data-r23-project-lifecycle="true"'), false);
  assert.equal(asMember.html.includes('data-r23-project-archive="true"'), false);
  assert.equal(asMember.html.includes('data-r23-project-delete="true"'), false);

  const asOwner = renderWebRouteComponent({
    key: "project-home",
    project: { ...baseVm, can_manage_lifecycle: true }
  }, { locale: "zh-CN" });
  assert.equal(asOwner.html.includes('data-r23-project-lifecycle="true"'), true);
  assert.equal(asOwner.html.includes('data-r23-project-lifecycle-project="93000000-0000-4000-8000-000000000001"'), true);
  assert.equal(asOwner.html.includes('data-r23-project-archive="true"'), true);
  assert.equal(asOwner.html.includes('data-r23-project-delete="true"'), true);
  assert.equal(asOwner.html.includes("归档项目"), true);

  const asOwnerEn = renderWebRouteComponent({
    key: "project-home",
    project: { ...baseVm, can_manage_lifecycle: true }
  }, { locale: "en-US" });
  assert.equal(asOwnerEn.html.includes("Archive project"), true);
  assert.equal(asOwnerEn.html.includes("Delete project"), true);
  assertNoMainWindowBoundaryLeak(asOwner.html);
  assertNoMainWindowBoundaryLeak(asOwnerEn.html);
});

// R23 P4（R20 P2A 端点上界面）：GET /api/workspace/audit（仅管理员）此前两端零界面——管理员在界面上
// 根本查不到「谁在什么时候改了什么」。/settings 新增「工作区审计」分区，非管理员整块不渲（他们连 GET
// 都是 403）；SSR 只出骨架 + 「加载更多」按钮，真实分页由 browser.ts 拉取。
test("R23 P4: settings workspace audit section is admin-gated and ships a paging skeleton", () => {
  const settingsVm = surfaceVm().page_vms.settings;
  assert.ok(settingsVm);

  const asMember = renderWebRouteComponent({ key: "settings", settings: settingsVm, isAdmin: false }, { locale: "zh-CN" });
  assert.equal(asMember.html.includes('data-r23-settings-workspace-audit="true"'), false);

  const asAdmin = renderWebRouteComponent({ key: "settings", settings: settingsVm, isAdmin: true }, { locale: "zh-CN" });
  assert.equal(asAdmin.html.includes('data-r23-settings-workspace-audit="true"'), true);
  assert.equal(asAdmin.html.includes('data-r23-settings-workspace-audit-body="true"'), true);
  assert.equal(asAdmin.html.includes('data-r23-settings-workspace-audit-loading="true"'), true);
  assert.equal(asAdmin.html.includes('data-r23-settings-workspace-audit-more="true"'), true);
  assert.equal(asAdmin.html.includes("正在加载审计记录"), true);

  const asAdminEn = renderWebRouteComponent({ key: "settings", settings: settingsVm, isAdmin: true }, { locale: "en-US" });
  assert.equal(asAdminEn.html.includes("Workspace audit"), true);
  assert.equal(asAdminEn.html.includes("Load more"), true);
});

// R23 P4：工作区审计行渲染是纯函数（renderWorkspaceAuditRows）。与单事项时间线不同，这里**不**做本地
// 截断——「还有更多」由服务端分页与「加载更多」按钮表达，本地再截一刀会和分页口径打架。对象列要把
// entity_type 这种机器串翻成人话。
test("R23 P4: renderWorkspaceAuditRows localizes action/actor/object columns and never truncates locally", () => {
  const entry = (id: string, action: string): AuditLogFact => ({
    id,
    actor: { actor_kind: "human", actor_nickname: "小拓" },
    entity: { entity_type: "project", entity_id: "93000000-0000-4000-8000-000000000001" },
    action,
    detail_json: {},
    created_at: "2026-07-10T09:00:00.000Z"
  });

  assert.equal(renderWorkspaceAuditRows([], "zh-CN").includes("这个工作区还没有审计记录"), true);
  assert.equal(renderWorkspaceAuditRows([], "en-US").includes("No audit entries in this workspace yet"), true);

  const rows = renderWorkspaceAuditRows([entry("a1", "project.archived"), entry("a2", "work_item.assigned")], "zh-CN");
  assert.equal(rows.includes('data-r23-workspace-audit-entry="a1"'), true);
  assert.equal(rows.includes('data-r23-workspace-audit-entry-action="project.archived"'), true);
  assert.equal(rows.includes('data-r23-workspace-audit-entry-entity="93000000-0000-4000-8000-000000000001"'), true);
  // R20 P2A 的四个写动作此前没有任何界面读它们，标签一并补齐，不能裸吐 "project.archived"。
  assert.equal(rows.includes("归档项目"), true);
  assert.equal(rows.includes("指派事项"), true);
  assert.equal(rows.includes("项目 93000000"), true);
  assert.equal(rows.includes("小拓"), true);
  assert.equal(rows.includes(formatLocalDate("2026-07-10T09:00:00.000Z")), true);

  const many = Array.from({ length: 25 }, (_, index) => entry(`a${index}`, "project.archived"));
  const all = renderWorkspaceAuditRows(many, "zh-CN");
  assert.equal(all.split("data-r23-workspace-audit-entry=").length - 1, 25);

  const en = renderWorkspaceAuditRows([entry("a3", "work_item.claimed")], "en-US");
  assert.equal(en.includes("Item claimed"), true);
  assert.equal(en.includes("Project 93000000"), true);
});

test("R23 F-04 Approvals workbench keeps its shared picker with no href (browser derives it from the selected row)", () => {
  const vm = surfaceVm();

  const zh = renderWebRouteComponent({ key: "approvals", approvals: vm.page_vms.approvals }, { locale: "zh-CN" });

  // 审批工作台的动作面板是整页共享的一份选人器——不绑死某条审批的 href。
  assert.equal(zh.html.includes('data-wh-delegate="true"'), true);
  assert.equal(zh.html.includes("data-wh-delegate-href"), false);
  assert.equal(zh.html.includes("data-wh-delegate-submit"), true);
  assertNoMainWindowBoundaryLeak(zh.html);
});

test("R23 F-04 A card with only a delegate action still renders the picker, not an empty shell", () => {
  const vm = surfaceVm();
  const primary = vm.page_vms.attention.primary;
  assert.ok(primary);
  const approvalId = "94000000-0000-4000-8000-000000000f05";
  const delegateOnly = {
    ...vm.page_vms.attention,
    primary: {
      ...primary,
      actions: [
        { id: "approval_delegate", label: "转交他人", style: "secondary" as const, method: "POST" as const, href: `/api/approvals/${approvalId}/delegate` }
      ]
    }
  };

  const zh = renderWebRouteComponent({ key: "home", attention: delegateOnly }, { locale: "zh-CN" });

  assert.equal(zh.html.includes(`data-wh-delegate-href="/api/approvals/${approvalId}/delegate"`), true);
  assert.equal(zh.html.includes('data-action-id="approval_delegate"'), false);
});
