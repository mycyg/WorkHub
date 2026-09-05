import assert from "node:assert/strict";
import test from "node:test";

import { WorkHubApiError, type WorkHubApiClient } from "@workhub/api-client";
import { createP05GoldPathFixture, validateP05GoldPathFixture } from "@workhub/agent/fixtures";
import { productNavGroups } from "@workhub/ui/gold-path";
import type {
  AgentArmyDashboardVM,
  ApprovalCenterVM,
  AttentionHomeVM,
  CalendarPageVM,
  ConversationMessagePageVM,
  ConversationMessageVM,
  CostDashboardVM,
  DrivePageVM,
  EvidenceBubble,
  GoldPathSurfaceVM,
  MeetingPageVM,
  NotificationPageVM,
  ProjectHomePageVM,
  ProjectListVM,
  ProjectTimelinePageVM,
  ProposalConflict,
  ReplayTraceVM,
  SessionVM,
  SettingsPageVM,
  TeamSkillsPageVM,
  TeamSkillManagementPageVM,
  UserMemoryManagementPageVM
} from "@workhub/contracts";

import {
  createUnknownWebRouteMatch,
  loadWebRoute,
  resolveWebRoute,
  webReactRouteTree,
  webRouteHref,
  webRouteRegistry
} from "./routes.js";

type RouteClientOverrides = {
  attention?: AttentionHomeVM;
  approvals?: ApprovalCenterVM;
  cost?: CostDashboardVM;
  agents?: AgentArmyDashboardVM;
  skills?: TeamSkillsPageVM;
  drive?: DrivePageVM;
  projects?: ProjectListVM;
  projectHome?: ProjectHomePageVM;
  projectTimeline?: ProjectTimelinePageVM;
  meetings?: MeetingPageVM;
  notifications?: NotificationPageVM;
  calendar?: CalendarPageVM;
  replay?: ReplayTraceVM;
  session?: SessionVM;
  knowledge?: EvidenceBubble;
  settings?: SettingsPageVM;
  userMemories?: UserMemoryManagementPageVM;
  teamSkillsManage?: TeamSkillManagementPageVM;
  conflicts?: ProposalConflict[];
  conversationMessages?: ConversationMessagePageVM;
  // R20 P1-08 收尾：会话镜像的发送者昵称解析改走工作区花名册（GET /api/workspace/roster），不再是全局
  // /api/users——起名 roster 而非 users，避免和已删的 listUsers fake 同名误导。
  roster?: Array<{ user_id: string; nickname: string; is_admin: boolean }>;
  attentionError?: Error;
  approvalsError?: Error;
  costError?: Error;
  knowledgeError?: Error;
  conversationMessagesError?: Error;
  rosterError?: Error;
  projectsError?: Error;
};

type ApprovalRouteRequestOptions = {
  locale?: string;
  offset?: number;
  limit?: number;
};

function meetingVm(): MeetingPageVM {
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

function notificationVm(): NotificationPageVM {
  return {
    generated_at: "2026-06-11T10:00:00.000Z",
    actor_user_id: "98000000-0000-4000-8000-000000000001",
    summary: {
      total_count: 1,
      unread_count: 1,
      needs_decision_count: 1,
      fyi_count: 0,
      done_count: 0,
      urgent_count: 1
    },
    buckets: {
      needs_decision: [
        {
          id: "98000000-0000-4000-8000-000000000002",
          type: "meeting.insight.pending",
          severity: "high",
          status: "unread",
          inbox_bucket: "needs_decision",
          title: "Meeting insight needs review",
          target_href: "/meetings?project_id=95000000-0000-4000-8000-000000000001",
          created_at: "2026-06-11T10:00:00.000Z",
          updated_at: "2026-06-11T10:00:00.000Z",
          source_context: {
            source_type: "meeting_insight",
            meeting_id: "95000000-0000-4000-8000-000000000002",
            insight_id: "95000000-0000-4000-8000-000000000004",
            title: "Update proposal pricing model",
            meeting_title: "Q2 Client Proposal Review",
            insight_status: "pending"
          },
          actions: {
            mark_read: {
              id: "notification_mark_read",
              label: "Mark as read",
              method: "POST",
              href: "/api/notifications/98000000-0000-4000-8000-000000000002/read"
            }
          }
        }
      ],
      fyi: [],
      done: []
    },
    items: [],
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

function calendarVm(): CalendarPageVM {
  const block: CalendarPageVM["blocks"][number] = {
    id: "99000000-0000-4000-8000-000000000001",
    kind: "work_item_due",
    title: "Review proposal pricing",
    ends_at: "2026-06-11T14:00:00.000Z",
    all_day: true,
    status: "today",
    severity: "urgent",
    target_href: "/workitems/99000000-0000-4000-8000-000000000002"
  };
  return {
    generated_at: "2026-06-11T10:00:00.000Z",
    actor_user_id: "99000000-0000-4000-8000-000000000003",
    scope: {
      date: "2026-06-11",
      view: "week",
      range_start: "2026-06-08T00:00:00.000Z",
      range_end: "2026-06-15T00:00:00.000Z"
    },
    summary: {
      block_count: 1,
      overdue_count: 0,
      today_count: 1,
      week_count: 1
    },
    days: [{ date: "2026-06-11", blocks: [block] }],
    blocks: [block]
  };
}

function projectListVm(): ProjectListVM {
  // 网盘项目切换器 fixture:首条与 driveVm().project 同 id(高亮当前),第二条提供切换目标。
  return {
    generated_at: "2026-06-11T09:00:00.000Z",
    projects: [
      {
        id: "93000000-0000-4000-8000-000000000001",
        name: "R5 Workspace",
        slug: "r5-workspace",
        owner_nickname: "owner",
        archived: false,
        created_at: "2026-06-11T08:00:00.000Z",
        updated_at: "2026-06-11T09:00:00.000Z",
        open_work_item_count: 1
      },
      {
        id: "93000000-0000-4000-8000-000000000099",
        name: "R5 Secondary",
        slug: "r5-secondary",
        owner_nickname: "owner",
        archived: false,
        created_at: "2026-06-10T08:00:00.000Z",
        updated_at: "2026-06-10T09:00:00.000Z",
        open_work_item_count: 0
      }
    ]
  };
}

function projectTimelineVm(id: string): ProjectTimelinePageVM {
  return {
    generated_at: "2026-07-15T00:00:00.000Z",
    project: { id, name: "R5 Workspace", slug: "r5-workspace" },
    milestones: [
      { id: "m1", project_id: id, title: "M1 里程碑", due_at: "2026-07-20T00:00:00.000Z", sort: 0, status: "open" }
    ],
    items: [
      {
        id: "wi-a",
        code: "WH-1",
        title: "打通登录",
        status: "ai_working",
        due_at: "2026-07-13T00:00:00.000Z",
        depends_on: [],
        blocks_count: 2,
        overdue: false,
        milestone_id: "m1"
      },
      {
        id: "wi-b",
        code: "WH-2",
        title: "会话续期",
        status: "in_review",
        due_at: "2026-07-10T00:00:00.000Z",
        depends_on: ["wi-a"],
        blocks_count: 3,
        overdue: true,
        objective_ids: ["obj-1"]
      }
    ],
    critical: {
      blocking: [{ work_item_id: "wi-b", blocks_count: 3 }],
      overdue_blocking: [{ work_item_id: "wi-b", blocks_count: 3 }]
    }
  };
}

function projectHomeVm(id: string): ProjectHomePageVM {
  return {
    generated_at: "2026-06-11T09:00:00.000Z",
    project: {
      id,
      name: "R5 Workspace",
      slug: "r5-workspace",
      description: "Pilot delivery workspace",
      owner_label: "owner",
      status: "active"
    },
    summary: { open_work_item_count: 1 },
    drive: {
      file_count: 1,
      recent_files: [
        { id: "20000000-0000-4000-8000-000000000777", name: "客户复盘.md", updated_at: "2026-06-10T09:00:00.000Z", href: `/drive?project_id=${id}` }
      ]
    },
    open_work_items: [
      {
        id: "10000000-0000-4000-8000-000000000932",
        code: "WH-001",
        title: "Weekly report",
        status: "in_progress",
        priority: "urgent",
        href: "/workitems/10000000-0000-4000-8000-000000000932"
      }
    ],
    actions: {
      new_task: { id: "new_task", label: "New task", method: "GET", href: `/intake?project_id=${id}` },
      open_drive: { id: "open_drive", label: "Open drive", method: "GET", href: `/drive?project_id=${id}` }
    }
  };
}

function driveVm(): DrivePageVM {
  return {
    generated_at: "2026-06-11T09:00:00.000Z",
    project: {
      id: "93000000-0000-4000-8000-000000000001",
      name: "R5 Workspace",
      slug: "r5-workspace",
      owner_label: "owner",
      status: "active"
    },
    summary: {
      item_count: 1,
      file_count: 1,
      folder_count: 0,
      deleted_item_count: 0,
      version_count: 1,
      accepted_deliverable_count: 1,
      pending_comment_count: 0,
      operation_count: 0
    },
    can_manage: false,
    selected_item_id: "93000000-0000-4000-8000-000000000002",
    items: [
      {
        id: "93000000-0000-4000-8000-000000000002",
        project_id: "93000000-0000-4000-8000-000000000001",
        name: "客户复盘.md",
        kind: "file",
        path: "/复盘包/客户复盘.md",
        depth: 1,
        current_version_id: "93000000-0000-4000-8000-000000000003",
        current_version: {
          id: "93000000-0000-4000-8000-000000000003",
          item_id: "93000000-0000-4000-8000-000000000002",
          version_no: 2,
          filename: "客户复盘.md",
          mime: "text/markdown",
          size_bytes: 2048,
          sha256: "a".repeat(64),
          created_at: "2026-06-11T09:00:00.000Z",
          current: true,
          source: "accepted_deliverable",
          accepted_deliverable_id: "93000000-0000-4000-8000-000000000004",
          work_item_id: "93000000-0000-4000-8000-000000000005",
          proposal_id: "93000000-0000-4000-8000-000000000006",
          preview_href: "/api/workitems/93000000-0000-4000-8000-000000000005/deliverables/93000000-0000-4000-8000-000000000004/preview",
          download_href: "/api/workitems/93000000-0000-4000-8000-000000000005/deliverables/93000000-0000-4000-8000-000000000004/download",
          restore_href: "/api/workitems/93000000-0000-4000-8000-000000000005/deliverables/93000000-0000-4000-8000-000000000004/restore"
        },
        children_count: 0,
        accepted_deliverable: {
          id: "93000000-0000-4000-8000-000000000004",
          work_item_id: "93000000-0000-4000-8000-000000000005",
          proposal_id: "93000000-0000-4000-8000-000000000006",
          change_id: "93000000-0000-4000-8000-000000000007",
          target_kind: "text_doc",
          target_key: "drive:/复盘包/客户复盘.md",
          change_type: "updated",
          accepted_version: 2,
          target_path: "/复盘包/客户复盘.md",
          drive_item_id: "93000000-0000-4000-8000-000000000002",
          drive_version_id: "93000000-0000-4000-8000-000000000003",
          filename: "客户复盘.md",
          mime: "text/markdown",
          size_bytes: 2048,
          preview_href: "/api/workitems/93000000-0000-4000-8000-000000000005/deliverables/93000000-0000-4000-8000-000000000004/preview",
          download_href: "/api/workitems/93000000-0000-4000-8000-000000000005/deliverables/93000000-0000-4000-8000-000000000004/download",
          restore_href: "/api/workitems/93000000-0000-4000-8000-000000000005/deliverables/93000000-0000-4000-8000-000000000004/restore",
          accepted_at: "2026-06-11T09:00:00.000Z"
        },
        updated_at: "2026-06-11T09:00:00.000Z"
      }
    ],
    deleted_items: [],
    versions: [
      {
        id: "93000000-0000-4000-8000-000000000003",
        item_id: "93000000-0000-4000-8000-000000000002",
        version_no: 2,
        filename: "客户复盘.md",
        mime: "text/markdown",
        size_bytes: 2048,
        sha256: "a".repeat(64),
        created_at: "2026-06-11T09:00:00.000Z",
        current: true,
        source: "accepted_deliverable",
        accepted_deliverable_id: "93000000-0000-4000-8000-000000000004",
        work_item_id: "93000000-0000-4000-8000-000000000005",
        proposal_id: "93000000-0000-4000-8000-000000000006",
        preview_href: "/api/workitems/93000000-0000-4000-8000-000000000005/deliverables/93000000-0000-4000-8000-000000000004/preview",
        download_href: "/api/workitems/93000000-0000-4000-8000-000000000005/deliverables/93000000-0000-4000-8000-000000000004/download",
        restore_href: "/api/workitems/93000000-0000-4000-8000-000000000005/deliverables/93000000-0000-4000-8000-000000000004/restore"
      }
    ],
    accepted_deliverables: [
      {
        id: "93000000-0000-4000-8000-000000000004",
        work_item_id: "93000000-0000-4000-8000-000000000005",
        proposal_id: "93000000-0000-4000-8000-000000000006",
        change_id: "93000000-0000-4000-8000-000000000007",
        target_kind: "text_doc",
        target_key: "drive:/复盘包/客户复盘.md",
        change_type: "updated",
        accepted_version: 2,
        target_path: "/复盘包/客户复盘.md",
        drive_item_id: "93000000-0000-4000-8000-000000000002",
        drive_version_id: "93000000-0000-4000-8000-000000000003",
        filename: "客户复盘.md",
        mime: "text/markdown",
        size_bytes: 2048,
        preview_href: "/api/workitems/93000000-0000-4000-8000-000000000005/deliverables/93000000-0000-4000-8000-000000000004/preview",
        download_href: "/api/workitems/93000000-0000-4000-8000-000000000005/deliverables/93000000-0000-4000-8000-000000000004/download",
        restore_href: "/api/workitems/93000000-0000-4000-8000-000000000005/deliverables/93000000-0000-4000-8000-000000000004/restore",
        accepted_at: "2026-06-11T09:00:00.000Z"
      }
    ],
    comments: [],
    operations: [],
    actions: {}
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

function routeSession(): SessionVM {
  return {
    session_id: "10000000-0000-4000-8000-000000000931",
    work_item_id: "10000000-0000-4000-8000-000000000932",
    topic: "整理区域周报",
    stream_href: "/api/push/stream/session/10000000-0000-4000-8000-000000000931",
    next_question_href: "/api/sessions/10000000-0000-4000-8000-000000000931/next-question",
    question: {
      id: "10000000-0000-4000-8000-000000000933",
      title: "这次先按哪个方向澄清？",
      body: "先选一个方向，避免空提交。",
      input_mode: "single_choice",
      options: [
        { id: "risk-first", label: "先看风险", description: "聚焦阻塞和异常。" },
        { id: "metric-first", label: "先看指标", description: "聚焦达成率。" }
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
      submit: { method: "POST", href: "/api/sessions/10000000-0000-4000-8000-000000000931/next-question" }
    }
  };
}

function routeEvidenceBubble(): EvidenceBubble {
  return {
    id: "10000000-0000-4000-8000-000000000941",
    query_text: "regional",
    summary_text: "Found cited regional evidence.",
    missing_evidence_note: "CRM source is missing; no synthetic evidence was generated.",
    evidence_refs: [
      {
        id: "10000000-0000-4000-8000-000000000942",
        source_type: "meeting",
        source_id: "weekly-sync",
        title: "Regional weekly sync",
        excerpt: "Supply delay was called out as the main risk.",
        href: "/knowledge/sources/weekly-sync"
      }
    ],
    actions: [
      {
        id: "use_for_current_task",
        label: "Use in current task",
        method: "POST",
        href: "/api/workitems/10000000-0000-4000-8000-000000000932/evidence-bindings"
      }
    ]
  };
}

function goldPathSurfaceVm(): GoldPathSurfaceVM {
  const fixture = validateP05GoldPathFixture(createP05GoldPathFixture());
  return {
    fixture_id: fixture.id,
    routes: {
      home: "/",
      intake: "/intake/r4-route-registry-session",
      approvals: "/approvals",
      workitem: "/workitems/r4-route-registry-workitem",
      proposal: "/proposals/r4-route-registry-proposal",
      replay: "/agent-runs/r4-route-registry-run/replay",
      cost: "/dashboard/cost",
      knowledge: "/knowledge/search"
    },
    page_vms: {
      attention: fixture.attentionHome,
      question: fixture.question,
      evidence: fixture.evidenceBubble,
      approvals: fixture.approvalCenter,
      workitem: fixture.workItemDetail,
      proposal: fixture.proposalDetail,
      replay: fixture.replay,
      cost: fixture.costDashboard
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
      today_cost_cny: "1.25",
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
      cost: { used_cny: "1.25", budget_cny: "3", burn_pct: 42 },
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

function fakeRouteClient(surface: GoldPathSurfaceVM, overrides: RouteClientOverrides = {}) {
  const calls: string[] = [];
  const localeCall = (name: string, options?: { locale?: string; projectId?: string; offset?: number; limit?: number }) => {
    const paging = [
      options?.offset === undefined ? "" : `offset=${options.offset}`,
      options?.limit === undefined ? "" : `limit=${options.limit}`
    ].filter(Boolean).join(":");
    calls.push(`${name}:${options?.locale ?? "none"}${paging ? `:${paging}` : ""}`);
  };
  const client = {
    pages: {
      async attention(options?: { locale?: string }) {
        localeCall("attention", options);
        if (overrides.attentionError) {
          throw overrides.attentionError;
        }
        return overrides.attention ?? surface.page_vms.attention;
      },
      async approvals(options?: ApprovalRouteRequestOptions) {
        localeCall("approvals", options);
        if (overrides.approvalsError) {
          throw overrides.approvalsError;
        }
        return overrides.approvals ?? surface.page_vms.approvals;
      },
      async cost(options?: { locale?: string }) {
        localeCall("cost", options);
        if (overrides.costError) {
          throw overrides.costError;
        }
        return overrides.cost ?? surface.page_vms.cost;
      },
      async agents(options?: { locale?: string }) {
        localeCall("agents", options);
        return overrides.agents ?? agentArmyDashboardVm();
      },
      async skills(options?: { locale?: string }) {
        localeCall("skills", options);
        return overrides.skills ?? { generated_at: "2026-06-16T00:00:00.000Z", skills: [], totals: { active: 0, ai_authored: 0, refined: 0 }, empty_state: "no_skills" as const };
      },
      async settings(options?: { locale?: string }) {
        localeCall("settings", options);
        return overrides.settings ?? settingsVm(options?.locale === "en-US" ? "en-US" : "zh-CN");
      },
      async goldPath(options?: { locale?: string }) {
        localeCall("goldPath", options);
        return surface;
      },
      async drive(options?: { locale?: string; projectId?: string; itemId?: string; item_id?: string }) {
        const itemId = options?.itemId ?? options?.item_id;
        calls.push(itemId
          ? `drive:${options?.locale ?? "none"}:${options?.projectId ?? "none"}:${itemId}`
          : `drive:${options?.locale ?? "none"}:${options?.projectId ?? "none"}`);
        return overrides.drive ?? driveVm();
      },
      async meetings(options?: { locale?: string; projectId?: string; meetingId?: string }) {
        calls.push(`meetings:${options?.locale ?? "none"}:${options?.projectId ?? "none"}:${options?.meetingId ?? "none"}`);
        return overrides.meetings ?? meetingVm();
      },
      async notifications(options?: { locale?: string }) {
        localeCall("notifications", options);
        return overrides.notifications ?? notificationVm();
      },
      async calendar(options?: { locale?: string; date?: string; view?: "day" | "week" }) {
        calls.push(`calendar:${options?.locale ?? "none"}:${options?.date ?? "none"}:${options?.view ?? "none"}`);
        return overrides.calendar ?? calendarVm();
      },
      async workItem(id: string, options?: { locale?: string }) {
        localeCall(`workItem:${id}`, options);
        return surface.page_vms.workitem;
      },
      async proposal(id: string, options?: { locale?: string }) {
        localeCall(`proposal:${id}`, options);
        return surface.page_vms.proposal;
      },
      async project(id: string, options?: { locale?: string }) {
        localeCall(`project:${id}`, options);
        return overrides.projectHome ?? projectHomeVm(id);
      },
      async projectTimeline(id: string, options?: { locale?: string }) {
        localeCall(`projectTimeline:${id}`, options);
        return overrides.projectTimeline ?? projectTimelineVm(id);
      }
    },
    async listProjects() {
      if (overrides.projectsError) {
        throw overrides.projectsError;
      }
      return overrides.projects ?? projectListVm();
    },
    // R20 P1-08 收尾：fetchWorkspaceRosterMembers 只依赖一个泛型 request(path) 方法（见
    // workspace-roster.ts），这里喂假实现服务 GET /api/workspace/roster，取代已删的 listUsers 假端点。
    // 单页返回全部（total===members.length），与真实分页契约一致但测试数据量小用不到翻页。
    async request(path: string) {
      if (path.startsWith("/api/workspace/roster")) {
        calls.push("workspaceRoster");
        if (overrides.rosterError) {
          throw overrides.rosterError;
        }
        const members = overrides.roster ?? [];
        return { members, total: members.length, limit: 100, offset: 0 };
      }
      throw new Error(`fakeRouteClient: unhandled request path ${path}`);
    },
    async listConversationMessages(conversationId: string, options?: { beforeSeq?: number; afterSeq?: number; limit?: number }) {
      const cursor = options?.beforeSeq !== undefined
        ? `before=${options.beforeSeq}`
        : options?.afterSeq !== undefined
          ? `after=${options.afterSeq}`
          : "none";
      calls.push(`conversationMessages:${conversationId}:${cursor}:limit=${options?.limit ?? "none"}`);
      if (overrides.conversationMessagesError) {
        throw overrides.conversationMessagesError;
      }
      return overrides.conversationMessages ?? { messages: [], has_more: false, next_after_seq: 0 };
    },
    async listWorkItemConflicts(workItemId: string) {
      localeCall(`conflicts:${workItemId}`);
      const conflicts = (overrides.conflicts ?? []).filter((conflict) => conflict.work_item_id === workItemId);
      return conflicts.length > 0 ? { conflicts } : { conflicts, empty_state: "no_conflicts" as const };
    },
    async getSession(sessionId: string, options?: { locale?: string }) {
      localeCall(`session:${sessionId}`, options);
      return overrides.session ?? routeSession();
    },
    async searchKnowledge(payload: unknown, options?: { locale?: string }) {
      localeCall(`knowledge:${JSON.stringify(payload)}`, options);
      if (overrides.knowledgeError) {
        throw overrides.knowledgeError;
      }
      return overrides.knowledge ?? routeEvidenceBubble();
    },
    async replayAgentRun(id: string, options?: { locale?: string }) {
      localeCall(`replayAgentRun:${id}`, options);
      return overrides.replay ?? surface.page_vms.replay;
    },
    async listUserMemories() {
      calls.push("listUserMemories");
      return overrides.userMemories ?? { generated_at: "2026-07-14T00:00:00.000Z", memories: [], totals: { active: 0 } };
    },
    async listTeamSkillsManage() {
      calls.push("listTeamSkillsManage");
      return overrides.teamSkillsManage ?? { generated_at: "2026-07-14T00:00:00.000Z", skills: [] };
    }
  } as unknown as WorkHubApiClient;
  return { client, calls };
}

function routeAdvancedProposalConflict(surface: GoldPathSurfaceVM): ProposalConflict {
  const proposal = surface.page_vms.proposal;
  return {
    id: "r4-13-route-conflict",
    work_item_id: proposal.work_item_id,
    proposal_id: proposal.proposal_id,
    merge_proposal_id: "10000000-0000-4000-8000-000000000913",
    change_id: proposal.manifest.changes[0]?.id ?? "change-1",
    target_key: "drive_item:docs/r4-13-route.md",
    target_kind: "text_doc",
    change_type: "updated",
    target_path: "docs/r4-13-route.md",
    headline: "docs/r4-13-route.md needs review",
    summary_text: "Current and incoming edits overlap; the route must surface advanced choices.",
    existing: {
      proposal_id: "10000000-0000-4000-8000-000000000914",
      change_id: "10000000-0000-4000-8000-000000000915",
      sha256: "a".repeat(64)
    },
    incoming: {
      sha256_before: "b".repeat(64),
      sha256_after: "c".repeat(64)
    },
    recommended_option_id: "ai_fusion",
    options: [
      {
        id: "keep_current",
        label: "Keep current",
        summary_text: "Do not overwrite the accepted version.",
        action: {
          id: "keep_current",
          label: "Keep current",
          method: "POST",
          href: `/api/proposals/${proposal.proposal_id}/merge`,
          request_json: { confirm: true, conflict_resolution: { accept_incoming_target_keys: [] } }
        }
      },
      {
        id: "ai_fusion",
        label: "Use AI fusion draft",
        summary_text: "Apply a reviewed line-level merge.",
        recommended: true,
        quality_gate: {
          text_patch_preview: {
            type: "unified_text_patch_preview",
            base_available: true,
            stats: {
              changed: true,
              added_lines: 1,
              removed_lines: 1,
              overlap_risk: "requires_review"
            },
            hunks: [{ header: "@@ -2 +2 @@", lines: ["-Current sentence", "+Merged sentence"] }]
          },
          text_diff3: {
            type: "line_text_diff3",
            auto_merge: false,
            current_hunks: 1,
            incoming_hunks: 1,
            conflict_hunks: 1,
            conflict_ranges: [{ start_line: 2, end_line: 2 }]
          }
        },
        action: {
          id: "apply_ai_fusion",
          label: "Use AI fusion draft",
          method: "POST",
          href: "/api/merge-proposals/10000000-0000-4000-8000-000000000913/apply",
          request_json: { confirm: true }
        }
      }
    ]
  };
}

function routeStructuredProposalConflict(surface: GoldPathSurfaceVM): ProposalConflict {
  const proposal = surface.page_vms.proposal;
  return {
    id: "r4-22-structured-route-conflict",
    work_item_id: proposal.work_item_id,
    proposal_id: proposal.proposal_id,
    merge_proposal_id: "10000000-0000-4000-8000-000000000923",
    change_id: proposal.manifest.changes[0]?.id ?? "change-1",
    target_key: `work_item:${proposal.work_item_id}`,
    target_kind: "structured_record",
    change_type: "updated",
    headline: "Work item fields need review",
    summary_text: "AI updated a scalar field that can be migrated first.",
    existing: { proposal_id: "previous", change_id: "previous-change", ref: "main" },
    incoming: { ref: "proposal" },
    recommended_option_id: "ai_fusion",
    options: [
      {
        id: "ai_fusion",
        label: "Use AI fusion draft",
        summary_text: "Apply a reviewed field-level merge.",
        recommended: true,
        quality_gate: {
          structured_record_patch: {
            type: "structured_record_field_patch",
            changed_fields: ["title", "priority"],
            merged_value_fields: ["title", "priority"],
            missing_fields: [],
            unknown_fields: [],
            field_count: 2,
            has_structured_result: true,
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
                    before_value: "Old title",
                    current_value: "Old title",
                    value: "New title",
                    source: "ai_fusion"
                  },
                  {
                    op: "set",
                    target_entity_type: "work_item",
                    target_entity_id: proposal.work_item_id,
                    field: "priority",
                    value_type: "string",
                    before_value: "medium",
                    current_value: "medium",
                    value: "high",
                    source: "ai_fusion"
                  }
                ]
              },
              issues: [],
              audit_payload: {
                target_entity_type: "work_item",
                target_entity_id: proposal.work_item_id,
                field_count: 2,
                operation_fields: ["title", "priority"],
                source: "ai_fusion"
              }
            }
          }
        },
        action: {
          id: "apply_ai_fusion",
          label: "Use AI fusion draft",
          method: "POST",
          href: "/api/merge-proposals/10000000-0000-4000-8000-000000000923/apply",
          request_json: { confirm: true }
        }
      }
    ]
  };
}

test("R4 web route registry resolves product URL routes", () => {
  // R9.6 adds the live-only Agent Army dashboard to the product route set; the old fixed list was pre-dashboard.
  // R14 批 MEM 追加 "memory"（/settings/memory，见 routes.ts 的 routeMatchers 末尾新增项）。
  assert.deepEqual(webRouteRegistry.map((route) => route.key), [
    "home",
    "projects",
    "project-home",
    "project-timeline",
    "intake",
    "approvals",
    "workitem",
    "proposal",
    "conversation",
    "drive",
    "meetings",
    "notifications",
    "calendar",
    "health",
    "replay",
    "cost",
    "agents",
    "knowledge",
    "search",
    "skills",
    "settings",
    "memory"
  ]);
  assert.equal(resolveWebRoute("/")?.key, "home");
  assert.equal(resolveWebRoute("/projects")?.key, "projects");
  assert.equal(resolveWebRoute("/projects/93000000-0000-4000-8000-000000000001")?.key, "project-home");
  assert.equal(resolveWebRoute("/projects/93000000-0000-4000-8000-000000000001")?.params["id"], "93000000-0000-4000-8000-000000000001");
  // R15 批 E2c：时间线只读页 /projects/:id/timeline 独立解析，不与 project-home 相撞。
  assert.equal(resolveWebRoute("/projects/93000000-0000-4000-8000-000000000001/timeline")?.key, "project-timeline");
  assert.equal(resolveWebRoute("/projects/93000000-0000-4000-8000-000000000001/timeline")?.params["id"], "93000000-0000-4000-8000-000000000001");
  assert.equal(resolveWebRoute("/dashboard/health")?.key, "health");
  assert.equal(resolveWebRoute("/approvals?filter=pending")?.key, "approvals");
  assert.equal(resolveWebRoute("/dashboard/cost")?.key, "cost");
  assert.equal(resolveWebRoute("/dashboard/agents")?.key, "agents");
  assert.equal(resolveWebRoute("/drive")?.key, "drive");
  assert.equal(resolveWebRoute("/meetings?project_id=95000000-0000-4000-8000-000000000001")?.key, "meetings");
  assert.equal(resolveWebRoute("/notifications")?.key, "notifications");
  assert.equal(resolveWebRoute("/calendar?date=2026-06-11&view=week")?.key, "calendar");
  assert.equal(resolveWebRoute("/calendar?date=2026-06-11&view=week")?.search, "?date=2026-06-11&view=week");
  assert.equal(resolveWebRoute("/knowledge/search?q=weekly")?.key, "knowledge");
  assert.equal(resolveWebRoute("/knowledge/search?q=weekly")?.search, "?q=weekly");
  assert.equal(resolveWebRoute("/dashboard/search?q=budget")?.key, "search");
  assert.equal(resolveWebRoute("/dashboard/search?q=budget")?.search, "?q=budget");
  assert.equal(resolveWebRoute("/dashboard/skills")?.key, "skills");
  assert.equal(resolveWebRoute("/workitems/WH-001")?.params["id"], "WH-001");
  assert.equal(resolveWebRoute("/conversations/30000000-0000-4000-8000-000000000003")?.key, "conversation");
  assert.equal(resolveWebRoute("/conversations/30000000-0000-4000-8000-000000000003")?.params["id"], "30000000-0000-4000-8000-000000000003");
  assert.equal(resolveWebRoute("/conversations/c-1?seq=9")?.key, "conversation");
  assert.equal(resolveWebRoute("/conversations/c-1?seq=9")?.search, "?seq=9");
  assert.equal(resolveWebRoute("/agent-runs/run-1/replay")?.params["id"], "run-1");
  assert.equal(resolveWebRoute("/#/approvals")?.key, "home");
  assert.equal(resolveWebRoute("/unknown"), undefined);
  assert.equal(webRouteHref("https://workhub.local/proposals/p-1?tab=diff#top"), "/proposals/p-1?tab=diff");
  assert.equal(webRouteHref("https://workhub.local/#/agent-runs/run-1/replay?from=old"), "/agent-runs/run-1/replay?from=old");
});

// G-web 止血批：productNavGroups（packages/ui/src/gold-path/product-shell.ts）是路由的第 4 个
// 同步点——webRouteRegistry/webReactRouteTree/routeTreePageVmByKey 都已经有门禁校验着，唯独
// 导航分组从没被校验过，新路由加了却忘记分组会悄悄变成一个只能深链、导航里找不到的孤儿页。
// intake 是唯一的例外：Nav-v2 把它从列表项升级成置顶主 CTA（见 product-shell.ts 的
// renderProductNav），故意不出现在任何 group.keys 里。
test("R14 FIX (nav sync gap) productNavGroups covers every webRouteRegistry key", () => {
  const navKeys = new Set(productNavGroups.flatMap((group) => Array.from(group.keys)));
  const intakeCtaException = new Set(["intake"]);
  const orphanRouteKeys = webRouteRegistry
    .map((route) => route.key)
    .filter((key) => !navKeys.has(key) && !intakeCtaException.has(key));

  assert.deepEqual(orphanRouteKeys, []);
});

// G-web 止血批：home/projects/drive/meetings/知识落地页/intake 起点六处路由分支各自独立调
// client.listProjects()。若两次导航前后脚打进来（比如上一次还没落地，用户又点了别的导航项），
// 之前会并发发出多个一模一样的 GET /api/projects——这里验证 in-flight 期间第二次调用直接复用
// 第一次的 promise，不发起新请求；不是 TTL 缓存，请求一落地这个位子就清空。
test("G-web FIX (listProjects dedup) concurrent route loads share one in-flight listProjects call", async () => {
  const surface = goldPathSurfaceVm();
  const { client } = fakeRouteClient(surface);
  let listProjectsCallCount = 0;
  let resolveListProjects: (value: ProjectListVM) => void = () => {};
  client.listProjects = () => new Promise<ProjectListVM>((resolve) => {
    listProjectsCallCount += 1;
    resolveListProjects = resolve;
  });

  const homeMatch = resolveWebRoute("/");
  const projectsMatch = resolveWebRoute("/projects");
  assert.ok(homeMatch);
  assert.ok(projectsMatch);

  // 不 await——两次导航"前后脚"并发打进来，模拟真实的快速切换场景。
  const homePromise = loadWebRoute(client, homeMatch, "en-US");
  const projectsPromise = loadWebRoute(client, projectsMatch, "en-US");

  // 两次导航都已经打到 listProjects 这一步（还没落地），但只应该有一次真实调用。
  assert.equal(listProjectsCallCount, 1);
  resolveListProjects(projectListVm());

  const [homeResult, projectsResult] = await Promise.all([homePromise, projectsPromise]);
  assert.equal(homeResult.status, "ready");
  assert.equal(projectsResult.status, "ready");
  assert.equal(listProjectsCallCount, 1);

  // in-flight 请求落地后位子清空——不是 TTL 缓存，下一次导航仍应发出全新请求（拿到最新数据）。
  // 第一次调用已经落地过（上面 resolveListProjects 那次），换回一个立即 resolve 的实现来验证
  // 第二次确实是全新请求，而不是复用了已经清空的旧 promise。
  client.listProjects = async () => {
    listProjectsCallCount += 1;
    return projectListVm();
  };
  const secondMatch = resolveWebRoute("/projects");
  assert.ok(secondMatch);
  const secondResult = await loadWebRoute(client, secondMatch, "en-US");
  assert.equal(secondResult.status, "ready");
  assert.equal(listProjectsCallCount, 2);
});

test("R9.7 web resolves emitted /attention links to the decision inbox", async () => {
  const { client, calls } = fakeRouteClient(goldPathSurfaceVm());
  const match = resolveWebRoute("/attention");
  assert.ok(match);

  const result = await loadWebRoute(client, match, "zh-CN");

  assert.equal(match.key, "home");
  assert.equal(result.status, "ready");
  assert.deepEqual(calls, ["attention:zh-CN"]);
  assert.equal(result.html.includes('data-r4-route-component="home"'), true);
  assert.equal(result.html.includes('data-r4-product-masthead="true"'), false);
});

test("R9.6 web route loads agent dashboard through the typed Page VM endpoint", async () => {
  const { client, calls } = fakeRouteClient(goldPathSurfaceVm());
  const match = resolveWebRoute("/dashboard/agents");
  assert.ok(match);

  const result = await loadWebRoute(client, match, "zh-CN");

  assert.equal(result.status, "ready");
  assert.deepEqual(calls, ["agents:zh-CN"]);
  assert.equal(result.html.includes('data-r4-web-route-status="ready"'), true);
  assert.equal(result.html.includes('data-r4-route-component="agents"'), true);
  assert.equal(result.html.includes('data-r9-agent-dashboard="true"'), true);
  assert.equal(result.html.includes('data-r9-agent-dashboard-plan-count="1"'), true);
  assert.equal(result.html.includes('data-r9-agent-dashboard-recent-count="1"'), true);
  assert.equal(result.html.includes('data-r9-agent-kpi="waiting_decision"'), true);
  assert.equal(result.html.includes('href="/"'), true);
  assert.equal(result.html.includes('href="/workitems/96000000-0000-4000-8000-000000000002"'), true);
  // R9.7 UX spec uses the web-facing concept name "军团"; the old "智能代理军团"
  // assertion was implementation copy, not the product glossary.
  assert.equal(result.html.includes("军团"), true);
  assert.equal(result.html.includes("智能代理军团"), false);
  assert.equal(result.html.includes("竞品资料梳理"), true);
  assert.equal(result.html.includes("卡在: 竞品复核"), true);
  assert.equal(result.html.includes("追加预算继续"), false);
});

test("R9.7 web Agent dashboard shell uses product-facing Agent team copy", async () => {
  const { client } = fakeRouteClient(goldPathSurfaceVm());
  const match = resolveWebRoute("/dashboard/agents");
  assert.ok(match);

  const result = await loadWebRoute(client, match, "en-US");

  assert.equal(result.status, "ready");
  assert.equal(result.html.includes("Agent teams"), true);
  assert.equal(result.html.includes("Agent Army"), false);
});

test("R9.6 web Agent Army dashboard renders an honest empty state without fake plan cards", async () => {
  const emptyAgents = agentArmyDashboardVm({
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
  });
  const { client } = fakeRouteClient(goldPathSurfaceVm(), { agents: emptyAgents });
  const match = resolveWebRoute("/dashboard/agents");
  assert.ok(match);

  const result = await loadWebRoute(client, match, "zh-CN");

  assert.equal(result.status, "ready");
  assert.equal(result.html.includes('data-r9-agent-dashboard-empty="no_agent_armies"'), true);
  assert.equal(result.html.includes("还没有军团在跑"), true);
  assert.equal(result.html.includes('href="/intake"'), true);
  assert.equal(result.html.includes('data-r9-agent-plan-card='), false);
});

test("R4.24 web route helpers canonicalize legacy hash routes without treating hash as route truth", () => {
  const legacyMatch = resolveWebRoute("https://workhub.local/#/proposals/p-1?tab=diff");
  assert.equal(legacyMatch?.key, "home");
  assert.equal(legacyMatch?.pathname, "/");
  assert.equal(webRouteHref("https://workhub.local/#/proposals/p-1?tab=diff"), "/proposals/p-1?tab=diff");
  assert.equal(webRouteHref("https://workhub.local/settings#desktop"), "/settings");
});

test("R4.16 web route tree declares hydration fallback boundaries for every product route", () => {
  assert.deepEqual(webReactRouteTree.map((route) => route.key), webRouteRegistry.map((route) => route.key));
  assert.deepEqual(
    webReactRouteTree.map((route) => [route.key, route.hydration.pageVm]),
    [
      ["home", "attention"],
      ["projects", "projects"],
      ["project-home", "project-home"],
      ["project-timeline", "project-timeline"],
      ["intake", "session"],
      ["approvals", "approvals"],
      ["workitem", "workitem"],
      ["proposal", "proposal"],
      // R15 批 web-mirror：新路由 "conversation"（/conversations/:id 只读镜像），pageVm 同名。
      ["conversation", "conversation"],
      ["drive", "drive"],
      ["meetings", "meetings"],
      ["notifications", "notifications"],
      ["calendar", "calendar"],
      ["health", "health"],
      ["replay", "replay"],
      ["cost", "cost"],
      // R9.6 adds the live-only Agent Army dashboard; the old route tree inventory was pre-dashboard.
      ["agents", "agents"],
      ["knowledge", "evidence"],
      ["search", "search"],
      ["skills", "skills"],
      ["settings", "settings"],
      // R14 批 MEM：新路由 "memory"（/settings/memory），pageVm 同名。
      ["memory", "memory"]
    ]
  );
  assert.equal(webReactRouteTree.every((route) => route.hydration.enabled), true);
  assert.equal(webReactRouteTree.every((route) => route.hydration.mode === "html-fallback"), true);
  assert.equal(webReactRouteTree.every((route) => route.hydration.adapter === "route-component-v1"), true);
  assert.equal(webReactRouteTree.every((route) => route.hydration.activeOnly), true);
});

test("R4.19 web route tree marks expanded React-compatible route components", () => {
  const migrated = webReactRouteTree
    .filter((route) => route.hydration.reactComponent)
    .map((route) => [route.key, route.hydration.reactComponent?.componentName, route.hydration.reactComponent?.propsSource]);

  assert.deepEqual(migrated, [
    ["home", "HomeRouteComponent", "typed-page-vm"],
    ["proposal", "ProposalRouteComponent", "typed-page-vm"],
    ["replay", "ReplayRouteComponent", "typed-page-vm"],
    ["cost", "CostRouteComponent", "typed-page-vm"],
    ["settings", "SettingsRouteComponent", "typed-page-vm"]
  ]);
  assert.equal(webReactRouteTree.every((route) => route.hydration.reactComponent?.mode === "html-fallback" || !route.hydration.reactComponent), true);
  assert.equal(webReactRouteTree.every((route) => route.hydration.reactComponent?.htmlFallback === true || !route.hydration.reactComponent), true);
  assert.equal(webReactRouteTree.every((route) => route.hydration.reactComponent?.adapter === "react-compatible-route-component-v1" || !route.hydration.reactComponent), true);
});

test("R4.19-pre route tree declares the Home true React mount spike boundary", () => {
  const runtimeMounted = webReactRouteTree
    .filter((route) => route.hydration.runtimeMount)
    .map((route) => route.key);
  const home = webReactRouteTree.find((route) => route.key === "home");
  const proposal = webReactRouteTree.find((route) => route.key === "proposal");

  assert.deepEqual(runtimeMounted, ["home", "proposal"]);
  assert.equal(home?.hydration.runtimeMount?.strategy, "react-18-createRoot-probe");
  assert.equal(home?.hydration.runtimeMount?.componentName, "HomeRouteComponent");
  assert.equal(home?.hydration.runtimeMount?.fallbackPreserved, true);
  assert.equal(home?.hydration.runtimeMount?.propsUpdate, "sse-react-render");
  assert.equal(home?.hydration.runtimeMount?.dispatcher, "delegated-click-bubble");
  assert.equal(proposal?.hydration.runtimeMount?.strategy, "react-18-visible-mutation-editor");
  assert.equal(proposal?.hydration.runtimeMount?.componentName, "ProposalMutationEditor");
  assert.equal(proposal?.hydration.runtimeMount?.fallbackPreserved, true);
  assert.equal(proposal?.hydration.runtimeMount?.propsUpdate, "dirty-guard-preserves-controlled-state");
  assert.equal(proposal?.hydration.runtimeMount?.dispatcher, "delegated-click-bubble");
  assert.equal(proposal?.hydration.runtimeMount?.mutationEditor, "structured-field-scalar");
  assert.equal(proposal?.hydration.runtimeMount?.lineEditor, "text-hunk");
});

test("R4.14 intake route loader carries Session VM data into an option-first route component", async () => {
  const surface = goldPathSurfaceVm();
  const session = routeSession();
  const { client, calls } = fakeRouteClient(surface, { session });
  const match = resolveWebRoute("/intake/r4-route-registry-session");
  assert.ok(match);

  const result = await loadWebRoute(client, match, "en-US");

  assert.equal(result.status, "ready");
  assert.deepEqual(calls, ["session:r4-route-registry-session:en-US"]);
  assert.equal(result.html.includes('data-r4-route-component="intake"'), true);
  assert.equal(result.html.includes('data-r4-route-component-source="session-vm"'), true);
  assert.equal(result.html.includes('data-r4-intake-option-count="2"'), true);
  assert.equal(result.html.includes('data-r4-intake-free-text-collapsed="true"'), true);
  assert.equal(result.html.includes('data-r4-intake-option-first="true"'), true);
  assert.equal(result.html.includes('data-intake-submit="next-question"'), true);
  assert.equal(result.html.includes('data-intake-free-text-input="true"'), true);
  assert.equal(result.html.includes("message-list"), false);
});

test("S1 Day0 /intake renders a project bootstrap start surface instead of empty state", async () => {
  const { client, calls } = fakeRouteClient(goldPathSurfaceVm());
  const match = resolveWebRoute("/intake");
  assert.ok(match);

  const result = await loadWebRoute(client, match, "en-US");

  assert.equal(result.status, "ready");
  assert.deepEqual(calls, []);
  assert.equal(result.html.includes('data-r4-route-component="intake"'), true);
  assert.equal(result.html.includes('data-r4-route-component-source="project-bootstrap"'), true);
  assert.equal(result.html.includes('data-s1-day0-intake-start="true"'), true);
  assert.equal(result.html.includes('data-s1-day1-intent-input="true"'), true);
  assert.equal(result.html.includes('data-action-id="start_intake"'), true);
  assert.equal(result.html.includes('href="/api/projects/bootstrap"'), true);
  assert.equal(result.html.includes("&quot;name&quot;:&quot;Pilot Project&quot;"), true);
  assert.equal(result.html.includes("&quot;slug&quot;:&quot;pilot-project&quot;"), true);
  assert.equal(result.html.includes("Day 0 Pilot Project"), false);
  assert.equal(result.html.includes('data-route-state="empty"'), false);
  assert.equal(result.html.includes("/intake/r4-live-session"), false);
});

test("M17 empty replay renders a tailored empty state linking back to the work item", async () => {
  const surface = goldPathSurfaceVm();
  const run = { ...surface.page_vms.replay.run };
  delete run.handoff_md;
  delete run.outcome_reason;
  const emptyReplay: ReplayTraceVM = { ...surface.page_vms.replay, steps: [], run };
  const { client } = fakeRouteClient(surface, { replay: emptyReplay });
  const match = resolveWebRoute("/agent-runs/r4-route-registry-run/replay");
  assert.ok(match);

  const result = await loadWebRoute(client, match, "en-US");

  assert.equal(result.html.includes('data-route-state="empty"'), true);
  // tailored copy — not the generic "nothing needs action" wrong-frame card
  assert.equal(result.html.includes("No replayable steps yet"), true);
  assert.equal(result.html.includes("Nothing needs action"), false);
  // back link goes to the parent work item, not the global overview
  assert.equal(result.html.includes("/workitems/00000000-0000-4000-8000-000000000104"), true);
  assert.equal(result.html.includes("Back to the work item"), true);
});

test("R4.14 knowledge route loader carries search payload into a cited fallback route component", async () => {
  const surface = goldPathSurfaceVm();
  const knowledge = routeEvidenceBubble();
  const { client, calls } = fakeRouteClient(surface, { knowledge });
  const match = resolveWebRoute("/knowledge/search?q=regional&workItemId=10000000-0000-4000-8000-000000000932");
  assert.ok(match);

  const result = await loadWebRoute(client, match, "en-US");

  assert.equal(result.status, "ready");
  assert.deepEqual(calls, ['knowledge:{"q":"regional","work_item_id":"10000000-0000-4000-8000-000000000932","limit":6}:en-US']);
  assert.equal(result.html.includes('data-r4-route-component="knowledge"'), true);
  assert.equal(result.html.includes('data-r4-route-component-source="evidence-bubble"'), true);
  assert.equal(result.html.includes('data-r4-knowledge-query="regional"'), true);
  assert.equal(result.html.includes('data-r4-knowledge-evidence-count="1"'), true);
  assert.equal(result.html.includes('data-r4-knowledge-action-count="1"'), true);
  assert.equal(result.html.includes('data-action-id="use_for_current_task"'), true);
});

test("F15 knowledge route renders an in-shell scope landing (not a bare 403) when global search is forbidden", async () => {
  const surface = goldPathSurfaceVm();
  // 顶部导航「知识」→ /knowledge/search 无锚点:后端对非管理员 403。
  const { client } = fakeRouteClient(surface, {
    knowledgeError: new WorkHubApiError(403, "forbidden", "请在具体事项或项目内检索。")
  });
  const match = resolveWebRoute("/knowledge/search");
  assert.ok(match);

  const result = await loadWebRoute(client, match, "zh-CN");

  // 关键:不塌成无外壳的裸 403 死胡同,而是在外壳内渲染知识库落地页(保留导航 + 搜索框 + 指引)。
  assert.equal(result.status, "ready");
  assert.equal(result.html.includes('data-r4-product-shell="true"'), true);
  assert.equal(result.html.includes('data-r4-route-component="knowledge"'), true);
  assert.equal(result.html.includes('data-r4-web-route-status="forbidden"'), false);
  assert.equal(result.html.includes("wh-web-route-state-screen"), false);
  assert.equal(result.html.includes("锚定具体项目或工作项"), true);
  // L34：非管理员落地页不再摆会再次 403 撞回本页的全局搜索框（死循环），改为与指引文案一致的出路——去项目列表。
  assert.equal(result.html.includes('data-r4-knowledge-search-form="true"'), false);
  assert.equal(result.html.includes('data-r4-knowledge-scope-cta="true"'), true);
});

test("F15 knowledge route keeps a scoped 403 as a genuine forbidden state (anchored = real denial)", async () => {
  const surface = goldPathSurfaceVm();
  const { client } = fakeRouteClient(surface, {
    knowledgeError: new WorkHubApiError(403, "forbidden", "你没有权限检索这个项目的资料。")
  });
  // 带项目锚点的 403 = 真实越权,照常冒泡为 forbidden 裸态(不被落地页吞掉)。
  const match = resolveWebRoute("/knowledge/search?project_id=10000000-0000-4000-8000-000000000932");
  assert.ok(match);

  const result = await loadWebRoute(client, match, "zh-CN");

  assert.equal(result.status, "forbidden");
  assert.equal(result.html.includes('data-r4-web-route-status="forbidden"'), true);
  // xreview E1：forbidden 的 CTA 不能再回退到刚 403 的同一个 URL(死循环);要导向用户能访问的地方。
  assert.equal(result.html.includes('href="/knowledge/search'), false);
  assert.equal(result.html.includes('class="wh-route-state-action" href="/"'), true);
  assert.equal(result.html.includes("去我能访问的地方"), true);
});

test("M19 knowledge route: a source_ref-only 403 (notification evidence link) lands in-shell, not a bare 403", async () => {
  const surface = goldPathSurfaceVm();
  const { client } = fakeRouteClient(surface, {
    knowledgeError: new WorkHubApiError(403, "forbidden", "请在具体事项或项目内检索。")
  });
  // 通知里的「查相关证据」只带 source_ref(无 project/work_item)→ 后端 403。source_ref 不是真实锚点,
  // 不应被当作越权裸态,而是落到外壳内的知识库落地页(保留导航 + 指引)。
  const match = resolveWebRoute("/knowledge/search?q=drive%20draft&source_ref=notification:10000000-0000-4000-8000-000000000abc");
  assert.ok(match);

  const result = await loadWebRoute(client, match, "zh-CN");

  assert.equal(result.status, "ready");
  assert.equal(result.html.includes('data-r4-route-component="knowledge"'), true);
  assert.equal(result.html.includes('data-r4-web-route-status="forbidden"'), false);
  assert.equal(result.html.includes("锚定具体项目或工作项"), true);
});

test("R14 batch SEARCH: search route resolves /dashboard/search with zero server calls (client-fetch page)", async () => {
  const surface = goldPathSurfaceVm();
  const { client, calls } = fakeRouteClient(surface);
  const match = resolveWebRoute("/dashboard/search?q=%E9%A2%84%E7%AE%97");
  assert.ok(match);

  const result = await loadWebRoute(client, match, "zh-CN");

  assert.equal(result.status, "ready");
  // 服务端只透传 ?q=，结果由客户端 fetch GET /api/search 注入——不该在 loadWebRoute 里打任何 API。
  assert.deepEqual(calls, []);
  assert.equal(result.html.includes('data-r4-route-component="search"'), true);
  assert.equal(result.html.includes('data-r14-search-route="true"'), true);
  assert.equal(result.html.includes('data-r14-search-query="预算"'), true);
  assert.equal(result.html.includes('data-r14-search-status="loading"'), true);
  assert.equal(result.html.includes('data-r14-search-results="true"'), true);
  assert.equal(result.html.includes('data-r14-search-group="conversations"'), true);
  assert.equal(result.html.includes('data-r14-search-group="drive"'), true);
  assert.equal(result.html.includes('data-r14-search-group="work_items"'), true);
  assert.equal(result.html.includes('data-r14-search-group="meetings"'), true);
  assert.equal(result.html.includes("会话"), true);
  assert.equal(result.html.includes("网盘"), true);
  assert.equal(result.html.includes("会议"), true);
  // 文案永不出现「Cuu」字样——组标题用「会话」不是「Cuu 会话」。
  assert.equal(/\bCuu\b/u.test(result.html), false);
  assert.equal(result.html.toLowerCase().includes("kanban"), false);
});

test("R14 batch SEARCH: search route gives an honest short-query prompt instead of guessing at results", async () => {
  const surface = goldPathSurfaceVm();
  const { client: emptyClient, calls: emptyCalls } = fakeRouteClient(surface);
  const emptyMatch = resolveWebRoute("/dashboard/search");
  assert.ok(emptyMatch);
  const emptyResult = await loadWebRoute(emptyClient, emptyMatch, "en-US");
  assert.equal(emptyResult.status, "ready");
  assert.deepEqual(emptyCalls, []);
  assert.equal(emptyResult.html.includes('data-r14-search-status="prompt"'), true);
  assert.equal(emptyResult.html.includes("Type at least 2 characters"), true);
  assert.equal(emptyResult.html.includes('data-r14-search-results="true" hidden'), true);

  const { client: shortClient, calls: shortCalls } = fakeRouteClient(surface);
  const shortMatch = resolveWebRoute("/dashboard/search?q=a");
  assert.ok(shortMatch);
  const shortResult = await loadWebRoute(shortClient, shortMatch, "en-US");
  assert.equal(shortResult.status, "ready");
  assert.deepEqual(shortCalls, []);
  assert.equal(shortResult.html.includes('data-r14-search-status="prompt"'), true);
  assert.equal(shortResult.html.includes("at least 2 characters"), true);
  assert.equal(shortResult.html.includes('data-r14-search-results="true" hidden'), true);
});

test("R14 batch SEARCH: search route surfaces the current query as a masthead metric, not a fake result count", async () => {
  const surface = goldPathSurfaceVm();
  const { client } = fakeRouteClient(surface);
  const match = resolveWebRoute("/dashboard/search?q=budget");
  assert.ok(match);

  const result = await loadWebRoute(client, match, "en-US");

  assert.equal(result.status, "ready");
  assert.equal(result.html.includes('data-r4-product-metric="query"'), true);
  assert.equal(result.html.includes(">budget<"), true);
  assert.equal(result.html.includes('data-r4-product-metric="runtime"'), true);
});

test("R4.13 proposal route loader carries conflict API data into advanced route UX", async () => {
  const surface = goldPathSurfaceVm();
  const conflict = routeAdvancedProposalConflict(surface);
  const { client, calls } = fakeRouteClient(surface, { conflicts: [conflict] });
  const match = resolveWebRoute("/proposals/proposal-42");
  assert.ok(match);

  const result = await loadWebRoute(client, match, "en-US");

  assert.equal(result.status, "ready");
  assert.deepEqual(calls, [
    "proposal:proposal-42:en-US",
    `conflicts:${surface.page_vms.proposal.work_item_id}:none`
  ]);
  assert.equal(result.html.includes('data-r4-route-component="proposal"'), true);
  assert.equal(result.html.includes('data-r4-proposal-conflict-count="1"'), true);
  assert.equal(result.html.includes('data-r4-proposal-advanced-review="true"'), true);
  assert.equal(result.html.includes('data-r4-proposal-conflicts="1"'), true);
  assert.equal(result.html.includes('data-r4-proposal-line-editor="true"'), true);
  assert.equal(result.html.includes('data-r4-proposal-react-line-editor-host="text-hunk"'), true);
  assert.equal(result.html.includes('data-r4-proposal-react-line-editor-mounted="false"'), true);
  assert.equal(result.html.includes('data-r4-route-tree-runtime-line-editor="text-hunk"'), true);
  assert.equal(result.html.includes('data-proposal-conflicts="1"'), true);
  assert.equal(result.html.includes('data-route-line-editor="true"'), true);
  assert.equal(result.html.includes('data-line-editor-apply="true"'), true);
  assert.equal(result.html.includes("text_hunk_overrides"), true);
  assert.equal(result.html.includes("Use AI fusion draft"), true);
});

// R14 批 FEEDBACK（web-feedback-ui）：提议详情页反馈块要经过完整的 loadWebRoute 管线（不只是
// renderWebRouteComponent 的直接单测）——additive 字段从 client.pages.proposal() 一路带到最终 HTML。
test("R14 batch FEEDBACK: proposal route loader renders the feedback block end-to-end when the VM carries it", async () => {
  const surface = goldPathSurfaceVm();
  surface.page_vms.proposal = {
    ...surface.page_vms.proposal,
    feedback: {
      my_verdict: "useful",
      my_note: "这次交付很清楚",
      mark_useful: { id: "mark_useful", label: "有用", method: "PUT", href: "/api/proposals/proposal-42/feedback", request_json: { verdict: "useful" } },
      mark_not_useful: { id: "mark_not_useful", label: "没用", method: "PUT", href: "/api/proposals/proposal-42/feedback", request_json: { verdict: "not_useful" } },
      clear: { id: "clear_feedback", label: "撤销反馈", method: "DELETE", href: "/api/proposals/proposal-42/feedback" }
    }
  };
  const { client } = fakeRouteClient(surface);
  const match = resolveWebRoute("/proposals/proposal-42");
  assert.ok(match);

  const result = await loadWebRoute(client, match, "zh-CN");

  assert.equal(result.status, "ready");
  assert.equal(result.html.includes('data-r14-proposal-feedback="true"'), true);
  assert.equal(result.html.includes('data-r14-proposal-feedback-verdict="useful"'), true);
  assert.equal(result.html.includes('data-request-json="{&quot;verdict&quot;:&quot;useful&quot;}"'), true);
  assert.equal(result.html.includes(">这次交付很清楚</textarea>"), true);
  assert.equal(/\bCuu\b/u.test(/<section class="wh-card wh-r4-route-card wh-r14-proposal-feedback"[\s\S]*?<\/section>/u.exec(result.html)?.[0] ?? ""), false);
});

test("R4.22 proposal route loader exposes a React mutation editor host without removing HTML fallback", async () => {
  const surface = goldPathSurfaceVm();
  const conflict = routeStructuredProposalConflict(surface);
  const { client } = fakeRouteClient(surface, { conflicts: [conflict] });
  const match = resolveWebRoute("/proposals/proposal-42");
  assert.ok(match);

  const result = await loadWebRoute(client, match, "en-US");

  assert.equal(result.status, "ready");
  assert.equal(result.html.includes('data-r4-proposal-react-mutation-editor-host="structured-field-scalar"'), true);
  assert.equal(result.html.includes('data-r4-proposal-react-mutation-editor-mounted="false"'), true);
  assert.equal(result.html.includes('data-r4-route-tree-runtime-strategy="react-18-visible-mutation-editor"'), true);
  assert.equal(result.html.includes('data-r4-route-tree-runtime-mutation-editor="structured-field-scalar"'), true);
  assert.equal(result.html.includes('data-r4-proposal-field-editor="true"'), true);
  assert.equal(result.html.includes('data-proposal-structured-field-editor="true"'), true);
  assert.equal(result.html.includes('data-proposal-structured-field-editor-row="title"'), true);
  assert.equal(result.html.includes('data-field-editor-action="custom"'), true);
  assert.equal(result.html.includes("structured_field_overrides"), true);
  assert.equal(result.html.includes("__WORKHUB_CUSTOM_FIELD_VALUE__"), true);
  assert.equal(result.html.includes("/api/merge-proposals/10000000-0000-4000-8000-000000000923/apply"), true);
});

test("R4 web loader uses typed Page VM endpoints before rendering ready routes", async () => {
  const surface = goldPathSurfaceVm();

  for (const [path, endpointCall] of [
    ["/", "attention:en-US"],
    ["/approvals", "approvals:en-US"],
    ["/drive", "drive:en-US:none"],
    ["/meetings", "meetings:en-US:none:none"],
    ["/notifications", "notifications:en-US"],
    ["/calendar?date=2026-06-11&view=week", "calendar:en-US:2026-06-11:week"],
    ["/dashboard/cost", "cost:en-US"],
    ["/dashboard/skills", "skills:en-US"],
    ["/settings", "settings:en-US"]
  ] as const) {
    const { client, calls } = fakeRouteClient(surface);
    const match = resolveWebRoute(path);
    assert.ok(match);
    const result = await loadWebRoute(client, match, "en-US");
    assert.equal(result.status, "ready");
    assert.deepEqual(calls, [endpointCall]);
    assert.equal(result.html.includes('data-r4-web-route-status="ready"'), true);
    assert.equal(result.html.includes('data-r4-product-shell="true"'), true);
    // R6 W1: home (决策收件箱) owns its own full layout — the shell masthead is suppressed there.
    assert.equal(result.html.includes('data-r4-product-masthead="true"'), path !== "/");
    assert.equal(result.html.match(/data-wh-panel=/gu)?.length, 1);
    assert.equal(result.html.includes('href="#/approvals"'), false);
    assert.equal(result.html.includes('href="/approvals"'), true);
    assert.equal(result.html.toLowerCase().includes("kanban"), false);
  }
});

test("S1 pilot shell omits R4 smoke seed detail links on stable routes", async () => {
  const { client } = fakeRouteClient(goldPathSurfaceVm());
  const match = resolveWebRoute("/dashboard/cost");
  assert.ok(match);

  const result = await loadWebRoute(client, match, "en-US");

  assert.equal(result.status, "ready");
  assert.equal(result.html.includes('href="/approvals"'), true);
  assert.equal(result.html.includes('href="/dashboard/cost"'), true);
  assert.equal(result.html.includes('href="/settings"'), true);
  assert.equal(result.html.includes("/intake/r4-live-session"), false);
  assert.equal(result.html.includes("/workitems/r4-live-workitem"), false);
  assert.equal(result.html.includes("/proposals/r4-live-proposal"), false);
  assert.equal(result.html.includes("/agent-runs/r4-live-run/replay"), false);
});

test("R4 web loader uses detail Page VM endpoints before rendering ready routes", async () => {
  const surface = goldPathSurfaceVm();

  for (const [path, endpointCalls] of [
    ["/workitems/work-42", ["workItem:work-42:en-US"]],
    ["/proposals/proposal-42", [
      "proposal:proposal-42:en-US",
      `conflicts:${surface.page_vms.proposal.work_item_id}:none`
    ]],
    ["/drive", ["drive:en-US:none"]],
    ["/meetings", ["meetings:en-US:none:none"]],
    ["/notifications", ["notifications:en-US"]],
    ["/calendar?date=2026-06-11&view=week", ["calendar:en-US:2026-06-11:week"]],
    ["/agent-runs/run-42/replay", ["replayAgentRun:run-42:en-US"]]
  ] as const) {
    const { client, calls } = fakeRouteClient(surface);
    const match = resolveWebRoute(path);
    assert.ok(match);
    const result = await loadWebRoute(client, match, "en-US");
    assert.equal(result.status, "ready");
    assert.deepEqual(calls.slice(0, endpointCalls.length), endpointCalls);
    assert.equal(result.html.includes('data-r4-web-route-status="ready"'), true);
    assert.equal(result.html.includes('data-r4-product-shell="true"'), true);
    assert.equal(result.html.match(/data-wh-panel=/gu)?.length, 1);
    assert.equal(result.html.includes(`href="${path}"`) || result.html.includes('href="/approvals"'), true);
    assert.equal(result.html.toLowerCase().includes("kanban"), false);
  }
});

test("R6 home never collapses to the generic empty card — empty attention still renders the project workspace + intake CTA + nav entry", async () => {
  const surface = goldPathSurfaceVm();
  const emptyAttention = {
    ...surface.page_vms.attention,
    primary: undefined,
    queue: [],
    background_runs: [],
    worklog: {
      runs_today: 6,
      autonomy_rate: 0,
      accepted_today: 0,
      saved_hours_estimate: 0,
      skills_promoted_today: 0,
      skills_refined_today: 0,
      generated_at: "2026-06-15T00:00:00.000Z",
      range_label: "今天"
    }
  };
  const { client } = fakeRouteClient(surface, { attention: emptyAttention });
  const match = resolveWebRoute("/");
  assert.ok(match);
  const result = await loadWebRoute(client, match, "zh-CN");
  // ① 不再塌成通用空卡：状态 ready、渲染首页项目工作台组件本身。
  assert.equal(result.status, "ready");
  assert.equal(result.html.includes('data-r4-route-component="home"'), true);
  assert.equal(result.html.includes('data-r8-home-project-desk="true"'), true);
  assert.equal(result.html.includes('data-r8-home-project-count="2"'), true);
  assert.equal(result.html.includes("R5 Workspace"), true);
  assert.equal(result.html.includes('href="/drive?project_id=93000000-0000-4000-8000-000000000001"'), true);
  // ② 新建任务 CTA 仍在；不出现"回到总览"死胡同。
  assert.equal(result.html.includes('data-r4-home-intake-cta="true"'), true);
  assert.equal(result.html.includes("回到总览"), false);
  // M1：零活跃用户(accepted_today:0)不显示自夸「0 件/0%/0 小时」战绩横幅。
  assert.equal(result.html.includes('data-r4-home-worklog="true"'), false);
  // ③ 导航常驻"提需求"入口（intake 不再 detail-only）。
  assert.equal(result.html.includes('data-wh-page-key="intake"'), true);
  // ④ 收件箱全空时不再渲染「当前入口 / 支撑证据」两区——它们只会显示描述不存在当前项的占位文案
  //   （"专注处理它" / "没有找到证据"），对一无所知用户是误导。空态决策卡 + CTA 已自足。
  assert.equal(result.html.includes('data-r4-home-queue="true"'), false);
  assert.equal(result.html.includes('data-r4-home-evidence-list="true"'), false);
});

test("home with decisions still renders the 当前入口/支撑证据 sections (gate is empty-only)", async () => {
  const surface = goldPathSurfaceVm();
  const { client } = fakeRouteClient(surface);
  const match = resolveWebRoute("/");
  assert.ok(match);
  const result = await loadWebRoute(client, match, "zh-CN");
  assert.equal(result.status, "ready");
  // 非空收件箱(默认 fixture 有 primary/queue)→ 两区照常出现,确认 decideCount>0 门没把它们一并藏掉。
  assert.equal(result.html.includes('data-r4-home-queue="true"'), true);
  assert.equal(result.html.includes('data-r4-home-evidence-list="true"'), true);
});

test("home keeps the attention queue usable when the project list is temporarily unavailable", async () => {
  const surface = goldPathSurfaceVm();
  const { client } = fakeRouteClient(surface);
  client.listProjects = async () => {
    throw new WorkHubApiError(503, "project_list_unavailable", "projects down");
  };
  const match = resolveWebRoute("/");
  assert.ok(match);

  const result = await loadWebRoute(client, match, "en-US");

  assert.equal(result.status, "ready");
  assert.equal(result.html.includes('data-r8-home-project-desk="true"'), true);
  assert.equal(result.html.includes('data-r8-home-projects-loaded="false"'), true);
  // P1-07：诚实文案——「未加载」而非此前像还在加载的「稍后同步」，且显式警示条露出失败 + 重试。
  assert.equal(result.html.includes("Project list unavailable"), true);
  assert.equal(result.html.includes('data-r20-home-projects-failed="true"'), true);
  assert.equal(result.html.includes('data-r4-home-decision="true"'), true);
});

test("home loader rethrows not_identified from listProjects (re-auth, not a stale project workspace)", async () => {
  const surface = goldPathSurfaceVm();
  const { client } = fakeRouteClient(surface);
  client.listProjects = async () => {
    throw new WorkHubApiError(401, "not_identified", "identify first");
  };
  const match = resolveWebRoute("/");
  assert.ok(match);
  await assert.rejects(() => loadWebRoute(client, match, "en-US"), /identify first/u);
});

test("P1-07: home renders honestly when the project list fails (warning + retry, not a silent 0)", async () => {
  const surface = goldPathSurfaceVm();
  // 非认证类失败（5xx）——项目清单拉不到，但 attention 照常。
  const { client } = fakeRouteClient(surface, { projectsError: new WorkHubApiError(500, "server_error", "boom") });
  const match = resolveWebRoute("/");
  assert.ok(match);
  const result = await loadWebRoute(client, match, "en-US");
  // 首页仍可用（决策/运行区照常），不整页塌。
  assert.equal(result.status, "ready");
  assert.equal(result.html.includes('data-r4-home-decision="true"'), true);
  // 项目桌标注「未加载」（loaded=false），而不是谎报成「0 个项目」的空态。
  assert.equal(result.html.includes('data-r8-home-projects-loaded="false"'), true);
  assert.equal(result.html.includes('data-r8-home-projects-empty="true"'), false, "failure must not masquerade as the empty state");
  assert.equal(result.html.includes("Project list unavailable"), true);
  // 显式警示条 + 重试按钮，而非静默降级成看不出是失败的软空态。
  assert.equal(result.html.includes('data-r20-home-projects-failed="true"'), true);
  assert.equal(result.html.includes('data-r20-home-projects-retry="true"'), true);
});

test("P1-07: home with an empty (but loaded) project list is the empty state, NOT the failure warning", async () => {
  const surface = goldPathSurfaceVm();
  const { client } = fakeRouteClient(surface, { projects: { generated_at: new Date().toISOString(), projects: [] } });
  const match = resolveWebRoute("/");
  assert.ok(match);
  const result = await loadWebRoute(client, match, "en-US");
  assert.equal(result.status, "ready");
  // 空态：0 个项目是真实事实（loaded=true），渲真空态，且绝不渲失败警示条。
  assert.equal(result.html.includes('data-r8-home-projects-loaded="true"'), true);
  assert.equal(result.html.includes('data-r8-home-projects-empty="true"'), true);
  assert.equal(result.html.includes('data-r20-home-projects-failed="true"'), false);
});

test("P1-07: meetings loader rethrows not_identified from listProjects (re-auth, not a swallowed empty switcher)", async () => {
  const surface = goldPathSurfaceVm();
  const { client } = fakeRouteClient(surface, {
    projectsError: new WorkHubApiError(401, "not_identified", "identify first")
  });
  const match = resolveWebRoute("/meetings");
  assert.ok(match);
  // 修复前：会议页把 listProjects 的 not_identified 一并吞掉 → 掉线用户看到空项目切换器而非重新登录。
  await assert.rejects(() => loadWebRoute(client, match, "en-US"), /identify first/u);
});

test("R4.11 web loader marks ready routes as route components", async () => {
  const surface = goldPathSurfaceVm();

  for (const [path, endpointCalls, routeComponent] of [
    ["/", ["attention:en-US"], "home"],
    ["/projects/93000000-0000-4000-8000-000000000001", ["project:93000000-0000-4000-8000-000000000001:en-US"], "project-home"],
    ["/approvals", ["approvals:en-US"], "approvals"],
    ["/workitems/work-42", ["workItem:work-42:en-US"], "workitem"],
    ["/proposals/proposal-42", [
      "proposal:proposal-42:en-US",
      `conflicts:${surface.page_vms.proposal.work_item_id}:none`
    ], "proposal"],
    ["/drive", ["drive:en-US:none"], "drive"],
    ["/meetings", ["meetings:en-US:none:none"], "meetings"],
    ["/notifications", ["notifications:en-US"], "notifications"],
    ["/calendar?date=2026-06-11&view=week", ["calendar:en-US:2026-06-11:week"], "calendar"],
    ["/agent-runs/run-42/replay", ["replayAgentRun:run-42:en-US"], "replay"],
    ["/dashboard/cost", ["cost:en-US"], "cost"],
    ["/settings", ["settings:en-US"], "settings"]
  ] as const) {
    const { client, calls } = fakeRouteClient(surface);
    const match = resolveWebRoute(path);
    assert.ok(match);
    const result = await loadWebRoute(client, match, "en-US");
    assert.equal(result.status, "ready");
    assert.deepEqual(calls.slice(0, endpointCalls.length), endpointCalls);
    assert.equal(result.html.includes(`data-r4-route-component="${routeComponent}"`), true);
    assert.equal(result.html.includes('data-r4-route-component-source="page-vm"'), true);
    assert.equal(result.html.includes('data-r4-route-component-locale="en-US"'), true);
    assert.equal(result.html.includes('data-r4-react-route-tree="true"'), true);
    assert.equal(result.html.includes(`data-r4-route-tree-key="${routeComponent}"`), true);
    assert.equal(result.html.includes('data-r4-route-tree-mode="html-fallback"'), true);
    assert.equal(result.html.includes('data-r4-route-tree-active-only="true"'), true);
    assert.equal(result.html.includes(`data-r4-route-tree-route-count="${webReactRouteTree.length}"`), true);
    assert.equal(result.html.includes(`data-r4-hydration-route="${routeComponent}"`), true);
    assert.equal(result.html.match(/data-r4-hydration-boundary="true"/gu)?.length, 1);
    const expectedReactComponent = ({
      home: "HomeRouteComponent",
      proposal: "ProposalRouteComponent",
      replay: "ReplayRouteComponent",
      cost: "CostRouteComponent",
      settings: "SettingsRouteComponent"
    } as Partial<Record<string, string>>)[routeComponent] ?? "";
    assert.equal(result.html.includes(`data-r4-route-tree-react-component="${expectedReactComponent}"`), true);
    if (expectedReactComponent) {
      assert.equal(result.html.includes(`data-r4-react-component="${expectedReactComponent}"`), true);
      assert.equal(result.html.includes('data-r4-react-component-html-fallback="true"'), true);
      assert.equal(result.html.includes('data-r4-hydration-react-component-fallback="true"'), true);
    }
    assert.equal(result.html.includes("weekly_report_manifest_doc"), false);
    assert.equal(result.html.includes('href="#/'), false);
    assert.equal(result.html.includes("data-cuu"), false);
    assert.equal(result.html.toLowerCase().includes("kanban"), false);
    assert.equal(result.html.match(/data-wh-panel=/gu)?.length, 1);
  }
});

test("R8 S2b project-home route renders project meta, open-work links, CTAs, back link, and a truthful hidden-work hint", async () => {
  const surface = goldPathSurfaceVm();
  const projectId = "93000000-0000-4000-8000-000000000001";
  const projectHome = {
    ...projectHomeVm(projectId),
    summary: { open_work_item_count: 73 } // 真实总数 73，清单只 1 条 → 应出现「还有 72 条」提示
  };
  const { client } = fakeRouteClient(surface, { projectHome });
  const match = resolveWebRoute(`/projects/${projectId}`);
  assert.ok(match);
  const result = await loadWebRoute(client, match, "en-US");

  assert.equal(result.status, "ready");
  assert.equal(result.html.includes('data-r4-route-component="project-home"'), true);
  assert.equal(result.html.includes(`data-r8-project-home="${projectId}"`), true);
  assert.equal(result.html.includes("R5 Workspace"), true);
  // open work item row links to /workitems/:id
  assert.equal(result.html.includes('data-r8-project-home-item="10000000-0000-4000-8000-000000000932"'), true);
  assert.equal(result.html.includes('href="/workitems/10000000-0000-4000-8000-000000000932"'), true);
  // both CTAs from the server VM (localized labels), open-drive still reachable from the hub
  assert.equal(result.html.includes('data-r8-project-home-new-task="true"'), true);
  assert.equal(result.html.includes('data-r8-project-home-open-drive="true"'), true);
  assert.equal(result.html.includes(`href="/drive?project_id=${projectId}"`), true);
  // back link to the projects list (no dead-end)
  assert.equal(result.html.includes('data-r8-project-home-back="true"'), true);
  assert.equal(result.html.includes('href="/projects"'), true);
  // +N more hint when true count exceeds the shown list (73 - 1 = 72)
  assert.equal(result.html.includes('data-r8-project-home-more="72"'), true);
  // 旧断言接受 "open the project to review all"，但当前已经在项目主页且没有单独的隐藏工作项页面。
  assert.equal(result.html.includes("Project home shows 1 of 73 open items you can handle"), true);
  assert.equal(result.html.includes("open the project to review all"), false);
  // recent files card (drive sync is core) — file count + a recent file linking into the drive
  assert.equal(result.html.includes('data-r8-project-home-files="1"'), true);
  assert.equal(result.html.includes('data-r8-project-home-file="20000000-0000-4000-8000-000000000777"'), true);
  assert.equal(result.html.includes("客户复盘.md"), true);
});

test("R15 E2c: /projects/:id/timeline renders the read-only, milestone-grouped timeline", async () => {
  const surface = goldPathSurfaceVm();
  const projectId = "93000000-0000-4000-8000-000000000001";
  const { client } = fakeRouteClient(surface);
  const match = resolveWebRoute(`/projects/${projectId}/timeline`);
  assert.ok(match);
  const result = await loadWebRoute(client, match, "zh-CN");

  assert.equal(result.status, "ready");
  assert.equal(result.html.includes('data-r4-route-component="project-timeline"'), true);
  assert.equal(result.html.includes(`data-r15-timeline="${projectId}"`), true);
  // milestone group header + its work item.
  assert.equal(result.html.includes("M1 里程碑"), true);
  assert.equal(result.html.includes('data-r15-timeline-item="wi-a"'), true);
  // overdue + blocks + dependency annotation resolved to the depended-on code (read-only, no gantt bars).
  assert.equal(result.html.includes("逾期"), true);
  assert.equal(result.html.includes("阻塞 3 项"), true);
  assert.equal(result.html.includes("依赖 WH-1"), true);
  // critical (overdue-blocking) area is surfaced.
  assert.equal(result.html.includes('data-r15-timeline-critical="1"'), true);
  // OKR annotation appears (id only — no name endpoint).
  assert.equal(result.html.includes('data-r15-timeline-okr="1"'), true);
  // back link to the project home (not a dead-end to the list).
  assert.equal(result.html.includes(`href="/projects/${projectId}"`), true);
  // the read endpoint was actually called.
  assert.equal(result.status === "ready", true);
});

test("M5 project-home: 进行中 stat chip uses the全量 total (matches header headline, no 1-vs-16 contradiction)", async () => {
  const surface = goldPathSurfaceVm();
  const projectId = "93000000-0000-4000-8000-000000000001";
  // total(8) > 可见(3)：因可见性隐藏了 5 件他人私有态事项。
  const projectHome = {
    ...projectHomeVm(projectId),
    summary: { open_work_item_count: 3, total_open_work_item_count: 8 }
  };
  const { client } = fakeRouteClient(surface, { projectHome });
  const match = resolveWebRoute(`/projects/${projectId}`);
  assert.ok(match);
  const result = await loadWebRoute(client, match, "en-US");
  assert.equal(result.status, "ready");
  // 顶部 stat chip 的「进行中」用全量 8（与页头头条数同口径），而非可见数 3。
  assert.equal(result.html.includes('data-r4-product-metric="openwork"><strong>8</strong>'), true);
  assert.equal(result.html.includes('data-r4-product-metric="openwork"><strong>3</strong>'), false);
  // 页头 pill 仍诚实标出「你可处理」可见数。
  assert.equal(result.html.includes("you can handle 3"), true);
  // xreview E3：隐藏量提示按全量算(8 - 1 显示行 = 7)，且拆分说明权限过滤与主页摘要折叠。
  assert.equal(result.html.includes('data-r8-project-home-more="7"'), true);
  assert.equal(result.html.includes('data-r8-project-home-filtered="5"'), true);
  assert.equal(result.html.includes('data-r8-project-home-collapsed="2"'), true);
  // 旧断言要求不提权限原因，但 VM 已区分 total 与可处理数；继续中性处理会掩盖权限过滤真相。
  assert.equal(result.html.includes("Project home shows 1 of 3 open items you can handle"), true);
  assert.equal(result.html.includes("5 more are outside your permissions or assignment scope"), true);
  assert.equal(result.html.includes("open the project to review all"), false);

  // 回退：VM 没有 total 字段时，chip 退回可见数（旧契约不破）。
  const legacy = { ...projectHomeVm(projectId), summary: { open_work_item_count: 5 } };
  const { client: legacyClient } = fakeRouteClient(surface, { projectHome: legacy });
  const legacyResult = await loadWebRoute(legacyClient, resolveWebRoute(`/projects/${projectId}`)!, "en-US");
  assert.equal(legacyResult.html.includes('data-r4-product-metric="openwork"><strong>5</strong>'), true);
});

test("xreview batch C: stat chips carry surface-specific labels (no recycled home labels)", async () => {
  const surface = goldPathSurfaceVm();

  // Skills page must NOT recycle the home inbox labels Focus/Queue/Background for skill totals.
  const { client: skillsClient } = fakeRouteClient(surface, {
    skills: { generated_at: "2026-06-16T00:00:00.000Z", skills: [], totals: { active: 5, refined: 2, ai_authored: 3 } }
  });
  const skills = await loadWebRoute(skillsClient, resolveWebRoute("/dashboard/skills")!, "en-US");
  assert.equal(skills.status, "ready");
  assert.equal(skills.html.includes("<strong>5</strong><span>Active skills</span>"), true);
  assert.equal(skills.html.includes("<strong>2</strong><span>Refined</span>"), true);
  assert.equal(skills.html.includes("<strong>3</strong><span>AI-authored</span>"), true);
  assert.equal(skills.html.includes("<span>Focus</span>"), false);
  assert.equal(skills.html.includes("<span>Background</span>"), false);

  // Notifications "needs your decision" chip must not be labeled with the shared "Pending" id.
  const notifications = await loadWebRoute(fakeRouteClient(surface).client, resolveWebRoute("/notifications")!, "en-US");
  assert.equal(notifications.status, "ready");
  assert.equal(notifications.html.includes('data-r4-product-metric="needsDecision"><strong>'), true);
  assert.equal(notifications.html.includes("<span>Needs your decision</span>"), true);

  // Workitem deliverables chip is the ACCEPTED count, labeled distinctly from the proposed-changes card.
  const workitem = await loadWebRoute(fakeRouteClient(surface).client, resolveWebRoute("/workitems/93000000-0000-4000-8000-000000000001")!, "en-US");
  assert.equal(workitem.status, "ready");
  assert.equal(workitem.html.includes('data-r4-product-metric="acceptedDeliverables">'), true);
  assert.equal(workitem.html.includes("Proposed changes"), true);
});

test("R14 批 MEM: memory route resolves /settings/memory and defaults to the profile tab", () => {
  const match = resolveWebRoute("/settings/memory");
  assert.equal(match?.key, "memory");
  assert.equal(match?.pathname, "/settings/memory");
  assert.equal(webRouteRegistry.some((route) => route.key === "memory" && route.pattern === "/settings/memory"), true);
});

test("R14 批 MEM: memory route fetches both governance endpoints and renders the profile tab by default", async () => {
  const surface = goldPathSurfaceVm();
  const { client, calls } = fakeRouteClient(surface, {
    userMemories: {
      generated_at: "2026-07-14T00:00:00.000Z",
      memories: [{
        id: "99000000-0000-4000-8000-000000000001",
        category: "preference",
        key: "reply-tone",
        value_md: "喜欢简洁的回复",
        confidence: 0.8,
        workspace_scoped: true,
        created_at: "2026-07-10T00:00:00.000Z",
        updated_at: "2026-07-10T00:00:00.000Z",
        provenance: { kind: "agent_run", label: "来自会话《周报》的一次 AI 执行" }
      }],
      totals: { active: 1 }
    }
  });
  const match = resolveWebRoute("/settings/memory");
  assert.ok(match);
  const result = await loadWebRoute(client, match, "zh-CN");
  assert.equal(result.status, "ready");
  assert.equal(calls.includes("listUserMemories"), true);
  assert.equal(calls.includes("listTeamSkillsManage"), true);
  assert.equal(result.html.includes('data-r14-mem-active-tab="profile"'), true);
  assert.equal(result.html.includes('data-r14-mem-item="99000000-0000-4000-8000-000000000001"'), true);
  assert.equal(result.html.includes("喜欢简洁的回复"), true);
  assert.equal(result.html.includes("来自会话《周报》的一次 AI 执行"), true);
  // 未登录/非管理员时 shellUser 缺省 —— 团队技能 tab 不应该渲出编辑/停用按钮。
  // 按 ="true" 完整属性值匹配（不用裸子串——CSS 里的 armed 态选择器本身就含
  // "[data-r14-skill-deactivate-btn]" 这段文字，裸子串检测会被 <style> 假阳性命中）。
  assert.equal(result.html.includes('data-r14-skill-edit-btn="true"'), false);
  assert.equal(result.html.includes('data-r14-skill-deactivate-btn="true"'), false);
});

test("R14 批 MEM: memory route honors ?tab=skills and diverges from the profile default", async () => {
  const surface = goldPathSurfaceVm();
  const { client } = fakeRouteClient(surface, {
    teamSkillsManage: {
      generated_at: "2026-07-14T00:00:00.000Z",
      skills: [{
        id: "99000000-0000-4000-8000-000000000002",
        skill_key: "quarterly-report",
        name: "季度报告",
        when_to_use: "生成季度业务报告",
        version: 2,
        source_kind: "distilled",
        created_by_kind: "ai",
        sample_count: 3,
        updated_at: "2026-07-10T00:00:00.000Z",
        content_md: "## 总则\n写清楚数据来源",
        status: "active"
      }]
    }
  });
  const match = resolveWebRoute("/settings/memory?tab=skills");
  assert.ok(match);
  const result = await loadWebRoute(client, match, "zh-CN");
  assert.equal(result.status, "ready");
  assert.equal(result.html.includes('data-r14-mem-active-tab="skills"'), true);
  assert.equal(result.html.includes('data-r14-skill-item="99000000-0000-4000-8000-000000000002"'), true);
  assert.equal(result.html.includes("data-r14-mem-admin-note"), true);
});

test("R14 批 MEM: team skill edit/deactivate controls render only when the signed-in shell user is an admin", async () => {
  const surface = goldPathSurfaceVm();
  const teamSkillsManage = {
    generated_at: "2026-07-14T00:00:00.000Z",
    skills: [{
      id: "99000000-0000-4000-8000-000000000003",
      skill_key: "quarterly-report",
      name: "季度报告",
      when_to_use: "生成季度业务报告",
      version: 2,
      source_kind: "distilled" as const,
      created_by_kind: "ai" as const,
      sample_count: 3,
      updated_at: "2026-07-10T00:00:00.000Z",
      content_md: "## 总则\n写清楚数据来源",
      status: "active" as const
    }]
  };
  const match = resolveWebRoute("/settings/memory?tab=skills");
  assert.ok(match);

  const { client: memberClient } = fakeRouteClient(surface, { teamSkillsManage });
  const memberResult = await loadWebRoute(memberClient, match, "zh-CN", { nickname: "member", isAdmin: false });
  assert.equal(memberResult.html.includes('data-r14-skill-edit-btn="true"'), false);
  assert.equal(memberResult.html.includes('data-r14-skill-deactivate-btn="true"'), false);
  assert.equal(memberResult.html.includes("data-r14-mem-admin-note"), true);

  const { client: adminClient } = fakeRouteClient(surface, { teamSkillsManage });
  const adminResult = await loadWebRoute(adminClient, match, "zh-CN", { nickname: "admin", isAdmin: true });
  assert.equal(adminResult.html.includes('data-r14-skill-edit-btn="true" data-r14-skill-id="99000000-0000-4000-8000-000000000003"'), true);
  assert.equal(adminResult.html.includes('data-r14-skill-deactivate-btn="true" data-r14-skill-id="99000000-0000-4000-8000-000000000003"'), true);
  assert.equal(adminResult.html.includes("data-r14-mem-admin-note"), false);
});

test("R14 批 MEM: empty user memories render the honest empty state, not a blank list", async () => {
  const surface = goldPathSurfaceVm();
  const { client } = fakeRouteClient(surface);
  const match = resolveWebRoute("/settings/memory");
  assert.ok(match);
  const result = await loadWebRoute(client, match, "en-US");
  assert.equal(result.html.includes('data-r14-mem-profile-empty="true"'), true);
  // escapeHtml 把撇号编成 &#39;，断言按转义后的实际输出核对（不是原始撇号字符串）。
  assert.equal(result.html.includes("The AI assistant hasn&#39;t learned any preferences about you yet."), true);
});

test("R14 批 MEM: nav shell surfaces the memory route in the team group, not admin-only", async () => {
  const surface = goldPathSurfaceVm();
  const { client } = fakeRouteClient(surface);
  const match = resolveWebRoute("/settings/memory");
  assert.ok(match);
  // Non-admin shellUser still sees "memory" in the nav (team group, not adminOnly) — same login used
  // for the admin gating test above confirms it isn't leaking into the admin-only nav group either.
  const result = await loadWebRoute(client, match, "en-US", { nickname: "member", isAdmin: false });
  assert.equal(result.status, "ready");
  assert.equal(result.html.includes('data-wh-page-key="memory"'), true);
});

test("R20 P1-06: a normal member sees the settings nav entry (personal settings, not admin-only)", async () => {
  const surface = goldPathSurfaceVm();
  const { client } = fakeRouteClient(surface);
  const match = resolveWebRoute("/settings");
  assert.ok(match);
  // 普通成员（isAdmin=false）也必须能在导航里点到 /settings——头像/资料/语言/AI 模式是个人设置。
  const result = await loadWebRoute(client, match, "en-US", { nickname: "member", isAdmin: false });
  assert.equal(result.status, "ready");
  assert.equal(result.html.includes('data-wh-page-key="settings"'), true);
  // settings 不再落在 adminOnly 的 admin 组——productNavGroups 里它归 team。
  const settingsGroup = productNavGroups.find((group) => group.keys.has("settings"));
  assert.ok(settingsGroup, "settings is assigned to a nav group");
  assert.equal(settingsGroup?.adminOnly ?? false, false, "settings' group is not admin-only");
});

test("R8 S4b intake start binds to an existing project when ?project_id is present", async () => {
  const surface = goldPathSurfaceVm();
  const projectId = "93000000-0000-4000-8000-000000000001";
  const { client, calls } = fakeRouteClient(surface);
  const match = resolveWebRoute(`/intake?project_id=${projectId}`);
  assert.ok(match);
  assert.equal(match.key, "intake");
  const result = await loadWebRoute(client, match, "en-US");
  assert.equal(result.status, "ready");
  // loader fetched the project (name + access fence) via pages.project
  assert.ok(calls.some((c) => c.startsWith(`project:${projectId}`)), "intake loader resolves the project");
  // the start screen shows the REAL project name (not the hardcoded Pilot project) and binds the action to it
  assert.equal(result.html.includes("R5 Workspace"), true);
  assert.equal(result.html.includes(`data-s4b-intake-project="${projectId}"`), true);
  assert.equal(result.html.includes(`data-s4b-project-id="${projectId}"`), true);
  // existing-project start does NOT carry a bootstrap payload (it won't create a "Pilot Project")
  assert.equal(result.html.includes("data-request-json"), false);
  // S4b-fix: the contradictory copy + shell metric are project-aware — no stale Pilot kicker/heading/body/metric vs the bound name
  assert.equal(result.html.includes("Start work in R5 Workspace"), true, "title names the bound project");
  assert.equal(result.html.includes("Pilot work entry"), false, "kicker no longer says Pilot");
  assert.equal(result.html.includes("Pilot project context"), false, "card heading no longer says Pilot project context");
  assert.equal(result.html.includes("prepares the pilot project"), false, "body no longer promises the skipped bootstrap");
});

test("R8 S4b intake start without a project keeps the generic bootstrap path (backward compatible)", async () => {
  const surface = goldPathSurfaceVm();
  const { client } = fakeRouteClient(surface);
  const match = resolveWebRoute("/intake");
  assert.ok(match);
  const result = await loadWebRoute(client, match, "en-US");
  assert.equal(result.status, "ready");
  assert.equal(result.html.includes("Pilot project"), true);
  assert.equal(result.html.includes("data-request-json"), true, "generic start still bootstraps a pilot project");
  assert.equal(result.html.includes("data-s4b-project-id"), false);
});

test("R8 S4b-fix intake with an unavailable project_id shows a notice, not a silent generic bootstrap", async () => {
  const surface = goldPathSurfaceVm();
  const projectId = "93000000-0000-4000-8000-0000000000ff";
  const { client } = fakeRouteClient(surface);
  // the requested project is gone / no access → pages.project 404s
  client.pages.project = async () => {
    throw new WorkHubApiError(404, "project_not_found", "没有找到这个项目。");
  };
  const match = resolveWebRoute(`/intake?project_id=${projectId}`);
  assert.ok(match);
  const result = await loadWebRoute(client, match, "en-US");
  assert.equal(result.status, "ready");
  // user is told the project was dropped (not silent), and falls back to a generic start they can still use
  assert.equal(result.html.includes('data-s4b-project-unavailable="true"'), true);
  assert.equal(result.html.includes("data-request-json"), true, "falls back to a usable generic start");
  assert.equal(result.html.includes("data-s4b-project-id"), false, "no stale project binding");
});

test("R8 S2b project-home 404 sends the user back to the projects list, not a home dead-end", async () => {
  const surface = goldPathSurfaceVm();
  const projectId = "93000000-0000-4000-8000-0000000000ff";
  const { client } = fakeRouteClient(surface);
  // override pages.project to throw a 404 WorkHubApiError (stale link / deleted project)
  client.pages.project = async () => {
    throw new WorkHubApiError(404, "project_not_found", "没有找到这个项目。");
  };
  const match = resolveWebRoute(`/projects/${projectId}`);
  assert.ok(match);
  const result = await loadWebRoute(client, match, "en-US");
  // M6/M25: a 404 detail route is "not found" (not the misleading generic "empty/nothing needs action").
  assert.equal(result.status, "notFound");
  assert.equal(result.html.includes('data-route-state="notFound"'), true);
  // the escape hatch still points back to /projects (the list they came from), not "/"
  assert.equal(result.html.includes('href="/projects"'), true);
});

test("R5.1 drive route loader renders accepted deliverables and version actions from the Drive Page VM", async () => {
  const surface = goldPathSurfaceVm();
  const drive = driveVm();
  const { client, calls } = fakeRouteClient(surface, { drive });
  const match = resolveWebRoute("/drive");
  assert.ok(match);

  const result = await loadWebRoute(client, match, "zh-CN");

  assert.equal(result.status, "ready");
  assert.deepEqual(calls, ["drive:zh-CN:none"]);
  assert.equal(result.html.includes('data-r4-route-component="drive"'), true);
  assert.equal(result.html.includes('data-r4-drive-project-id="93000000-0000-4000-8000-000000000001"'), true);
  assert.equal(result.html.includes('data-r4-drive-item-count="1"'), true);
  assert.equal(result.html.includes('data-r4-drive-version-count="1"'), true);
  assert.equal(result.html.includes('data-r4-drive-accepted-count="1"'), true);
  assert.equal(result.html.includes("客户复盘.md"), true);
  assert.equal(result.html.includes('data-action-id="drive_preview"'), true);
  assert.equal(result.html.includes('data-action-id="drive_download"'), true);
  assert.equal(result.html.includes('data-action-id="drive_restore" data-method="POST"'), true);
  assert.equal(result.html.includes('data-r4-product-metric="files"'), true);
  assert.equal(result.html.includes('data-r4-product-metric="versions"'), true);
  assert.equal(result.html.includes('href="/drive"'), true);
});

test("R9 drive route loader shows a missing item notice without highlighting another file", async () => {
  const surface = goldPathSurfaceVm();
  const missingItemId = "93000000-0000-4000-8000-0000000000bb";
  const drive = { ...driveVm(), selected_item_id: undefined, requested_item_missing: true };
  const { client, calls } = fakeRouteClient(surface, { drive });
  const match = resolveWebRoute(`/drive?project_id=93000000-0000-4000-8000-000000000001&item_id=${missingItemId}`);
  assert.ok(match);

  const result = await loadWebRoute(client, match, "zh-CN");

  assert.equal(result.status, "ready");
  assert.deepEqual(calls, [`drive:zh-CN:93000000-0000-4000-8000-000000000001:${missingItemId}`]);
  assert.equal(result.html.includes('data-r9-drive-requested-missing="true"'), true);
  assert.equal(result.html.includes("找不到该文件，已回到默认视图。"), true);
  assert.equal(/data-r4-drive-item="[^"]+"[^>]*data-r4-drive-item-selected="true"/.test(result.html), false);
  assert.equal(/data-r5-drive-recycle-item="[^"]+"[^>]*data-r5-drive-recycle-selected="true"/.test(result.html), false);
});

test("R9 drive route loader tells the truth when the recycle bin is truncated", async () => {
  const surface = goldPathSurfaceVm();
  const base = driveVm();
  const baseItem = base.items[0]!;
  const deletedItems = Array.from({ length: 5 }, (_, index) => {
    const suffix = String(index + 10).padStart(12, "0");
    return {
      ...baseItem,
      id: `93000000-0000-4000-8000-${suffix}`,
      name: `已删除文件 ${index + 1}.md`,
      path: `/回收站/已删除文件 ${index + 1}.md`,
      deleted_at: `2026-06-1${index}T09:00:00.000Z`,
      restore_href: `/api/drive/projects/93000000-0000-4000-8000-000000000001/items/93000000-0000-4000-8000-${suffix}/restore`,
      preview_href: undefined,
      download_href: undefined,
      accepted_deliverable: undefined
    };
  });
  const drive = {
    ...base,
    summary: { ...base.summary, deleted_item_count: 8 },
    deleted_items: deletedItems
  };
  const { client } = fakeRouteClient(surface, { drive });
  const match = resolveWebRoute("/drive?project_id=93000000-0000-4000-8000-000000000001");
  assert.ok(match);

  const result = await loadWebRoute(client, match, "zh-CN");

  assert.equal(result.status, "ready");
  assert.equal(result.html.match(/data-r5-drive-recycle-item=/g)?.length, 5);
  assert.equal(result.html.match(/data-r5-drive-recycle-restore=/g)?.length, 5);
  assert.equal(result.html.includes('data-r9-drive-recycle-hidden-count="3"'), true);
  assert.equal(result.html.includes("本页先显示 5 项；还有 3 项未加载。"), true);
  assert.equal(result.html.includes("回收站是空的。"), false);
});

test("R8 cycle-review #2 drive with no project sends the user to /projects, not a home dead-end", async () => {
  const surface = goldPathSurfaceVm();
  // empty workspace → drive returns no_project; loader collapses to an empty state.
  const drive = { ...driveVm(), empty_state: "no_project" as const };
  const { client } = fakeRouteClient(surface, { drive });
  const match = resolveWebRoute("/drive");
  assert.ok(match);
  const result = await loadWebRoute(client, match, "en-US");
  assert.equal(result.status, "empty");
  // the escape hatch points at /projects (go pick/create a project), not "/" (overview)
  assert.equal(result.html.includes('href="/projects"'), true);
  // and the button label matches the destination (Go to projects), not the default "Back to overview"
  assert.equal(result.html.includes("Go to projects"), true);
  assert.equal(result.html.includes("Back to overview"), false);
});

test("R5.2 drive route loader forwards project id query to the Page VM client", async () => {
  const surface = goldPathSurfaceVm();
  const { client, calls } = fakeRouteClient(surface, { drive: driveVm() });
  const match = resolveWebRoute("/drive?project_id=93000000-0000-4000-8000-000000000001");
  assert.ok(match);

  const result = await loadWebRoute(client, match, "en-US");

  assert.equal(result.status, "ready");
  assert.deepEqual(calls, ["drive:en-US:93000000-0000-4000-8000-000000000001"]);
});

test("R8 drive project switcher renders CSP-safe (no inline handler) with the current project selected and SPA-href options", async () => {
  const surface = goldPathSurfaceVm();
  const { client } = fakeRouteClient(surface, { drive: driveVm(), projects: projectListVm() });
  const match = resolveWebRoute("/drive");
  assert.ok(match);

  const result = await loadWebRoute(client, match, "zh-CN");

  assert.equal(result.status, "ready");
  // 两个项目 → 切换器出现，挂当前项目 id 与项目数。
  assert.equal(result.html.includes('data-r8-drive-project-switcher="true"'), true);
  assert.equal(result.html.includes('data-r8-drive-project-count="2"'), true);
  assert.equal(result.html.includes('data-r8-drive-current-project="93000000-0000-4000-8000-000000000001"'), true);
  // rank5：绝不能有内联事件处理器（CSP script-src 'self' 会禁掉），导航靠 browser.ts 的委托 change 监听。
  assert.equal(result.html.includes("onchange="), false);
  // 当前项目高亮（selected），切换目标项是完整 SPA href。
  assert.equal(result.html.includes('value="/drive?project_id=93000000-0000-4000-8000-000000000001" selected'), true);
  assert.equal(result.html.includes('value="/drive?project_id=93000000-0000-4000-8000-000000000099"'), true);
});

test("R5.6 notifications and calendar routes load typed Page VMs with actionable markers", async () => {
  const surface = goldPathSurfaceVm();
  const { client, calls } = fakeRouteClient(surface, {
    notifications: notificationVm(),
    calendar: calendarVm()
  });
  const notificationsMatch = resolveWebRoute("/notifications");
  const calendarMatch = resolveWebRoute("/calendar?date=2026-06-11&view=week");
  assert.ok(notificationsMatch);
  assert.ok(calendarMatch);

  const notifications = await loadWebRoute(client, notificationsMatch, "zh-CN");
  const calendar = await loadWebRoute(client, calendarMatch, "zh-CN");

  assert.deepEqual(calls, ["notifications:zh-CN", "calendar:zh-CN:2026-06-11:week"]);
  assert.equal(notifications.status, "ready");
  assert.equal(calendar.status, "ready");
  assert.equal(notifications.html.includes('data-r4-route-component="notifications"'), true);
  assert.equal(notifications.html.includes('data-r5-notifications-route="true"'), true);
  assert.equal(notifications.html.includes('data-r5-notification-needs-decision-count="1"'), true);
  assert.equal(notifications.html.includes("/api/notifications/98000000-0000-4000-8000-000000000002/read"), true);
  assert.equal(calendar.html.includes('data-r4-route-component="calendar"'), true);
  assert.equal(calendar.html.includes('data-r5-calendar-route="true"'), true);
  assert.equal(calendar.html.includes('data-r5-calendar-date="2026-06-11"'), true);
  assert.equal(calendar.html.includes('data-r5-calendar-block-count="1"'), true);
  assert.equal(calendar.html.includes("/workitems/99000000-0000-4000-8000-000000000002"), true);
});

test("R5.5 meetings route loader forwards project and meeting ids to the Page VM client", async () => {
  const surface = goldPathSurfaceVm();
  const meetings = meetingVm();
  const { client, calls } = fakeRouteClient(surface, { meetings });
  const match = resolveWebRoute("/meetings?project_id=95000000-0000-4000-8000-000000000001&m=95000000-0000-4000-8000-000000000002");
  assert.ok(match);

  const result = await loadWebRoute(client, match, "en-US");

  assert.equal(result.status, "ready");
  assert.deepEqual(calls, ["meetings:en-US:95000000-0000-4000-8000-000000000001:95000000-0000-4000-8000-000000000002"]);
  assert.equal(result.html.includes('data-r4-route-component="meetings"'), true);
  assert.equal(result.html.includes('data-r5-meetings-route="true"'), true);
  assert.equal(result.html.includes('data-r5-meeting-count="1"'), true);
  assert.equal(result.html.includes('data-r5-meeting-pending-insights="1"'), true);
  assert.equal(result.html.includes('data-action-id="meeting_insight_to_draft"'), true);
  assert.equal(result.html.includes('data-r4-product-metric="meetings"'), true);
});

test("R4.15 settings route keeps locale preference and device boundary markers auditable", async () => {
  const surface = goldPathSurfaceVm();
  const settings = settingsVm("en-US");
  const { client } = fakeRouteClient(surface, { settings });
  const match = resolveWebRoute("/settings");
  assert.ok(match);

  const result = await loadWebRoute(client, match, "en-US");

  assert.equal(result.status, "ready");
  assert.equal(result.html.includes('data-r4-settings-active-locale="en-US"'), true);
  assert.equal(result.html.includes('data-r4-settings-preference-locale="en-US"'), true);
  assert.equal(result.html.includes('data-r4-settings-preference-synced="true"'), true);
  assert.equal(result.html.includes('data-r4-settings-restore-requires-desktop="true"'), true);
  assert.equal(result.html.includes('data-r4-settings-web-local-actions="false"'), true);
  // M23：设置页不再把内部端点 /api/auth/preferences、本地存储键、租约 ms 等运维管道暴露给普通用户。
  assert.equal(result.html.includes("/api/auth/preferences"), false);
  assert.equal(result.html.includes("workhub.locale"), false);
  assert.equal(/sk-[0-9A-Za-z]{20,}/u.test(result.html), false);
});

// R13 批 P3（功能审查 B4）：/settings 渲染「AI 助手」区块——两个可改表单（水合前锁定）+ 其余 AI 项的
// 「需要桌面客户端」诚实提示；web-only 用户从此能自行脱离只观察档（409 自救入口）。
test("R13-P3 settings route ships the AI assistant self-rescue block", async () => {
  const surface = goldPathSurfaceVm();
  const settings = settingsVm("en-US");
  const { client } = fakeRouteClient(surface, { settings });
  const match = resolveWebRoute("/settings");
  assert.ok(match);

  const result = await loadWebRoute(client, match, "en-US");

  assert.equal(result.status, "ready");
  assert.equal(result.html.includes('data-r13-settings-ai-panel="true"'), true);
  // Selects arrive disabled — browser.ts hydrates the real current values before unlocking them.
  assert.equal(/data-r13-settings-ai-mode-select[^>]*disabled/u.test(result.html), true);
  assert.equal(/data-r13-settings-ai-dispatch-select[^>]*disabled/u.test(result.html), true);
  assert.equal(result.html.includes("data-r13-settings-ai-retry"), true);
  assert.equal(result.html.includes('data-action-id="open_desktop_ai_settings"'), true);
});

test("F11/簇A: empty approvals stays a full page in the shell (no collapse to a bare card)", async () => {
  const surface = goldPathSurfaceVm();
  const emptyApprovals: ApprovalCenterVM = {
    ...surface.page_vms.approvals,
    items: [],
    requests: [],
    counts: { pending: 0, all: 0 }
  };
  const { client, calls } = fakeRouteClient(surface, { approvals: emptyApprovals });
  const match = resolveWebRoute("/approvals");
  assert.ok(match);

  const result = await loadWebRoute(client, match, "zh-CN");

  // 无待办时不再塌成通用空卡——渲染审批组件(自带空态兜底)于产品外壳内,保留左导航,不把用户困住。
  assert.equal(result.status, "ready");
  assert.deepEqual(calls, ["approvals:zh-CN"]);
  assert.equal(result.html.includes('data-r4-route-component="approvals"'), true);
  assert.equal(result.html.includes('data-r4-product-shell="true"'), true, "product shell + nav preserved");
  assert.equal(result.html.includes('data-route-state="empty"'), false, "no bare generic empty-state card");
  // 空态渲安心空态卡,不再渲三栏 master-detail 脚手架(详情「左边选一条」+ 右栏选择态卡 + 「未路由」),
  // 否则对一无所知用户像在描述并不存在的选择。
  assert.equal(result.html.includes('data-r4-approval-empty="true"'), true, "renders the tailored empty card");
  assert.equal(result.html.includes('data-r4-approval-detail="true"'), false, "no select-a-row detail scaffolding when there are no approvals");
  assert.equal(result.html.includes('data-r4-approval-action-panel="true"'), false, "no selection action panel when empty");
});

test("R9 approvals route renders the real total and a working next-page entry for truncated queues", async () => {
  const surface = goldPathSurfaceVm();
  const approvals: ApprovalCenterVM = {
    ...surface.page_vms.approvals,
    counts: {
      ...surface.page_vms.approvals.counts,
      pending: 100,
      pending_total: 237
    },
    page_info: { limit: 100, offset: 100, returned: 100, has_more: true }
  };
  const { client, calls } = fakeRouteClient(surface, { approvals });
  const match = resolveWebRoute("/approvals?offset=100");
  assert.ok(match);

  const result = await loadWebRoute(client, match, "zh-CN");

  assert.equal(result.status, "ready");
  assert.deepEqual(calls, ["approvals:zh-CN:offset=100"]);
  assert.equal(result.html.includes('data-r4-approval-pending="237"'), true);
  assert.equal(result.html.includes('<span class="wh-r4-route-count">237</span>'), true);
  assert.equal(result.html.includes('data-r4-approval-page-offset="100"'), true);
  assert.equal(result.html.includes('data-r4-approval-next-page-href="/approvals?offset=200"'), true);
  assert.equal(result.html.includes('href="/approvals?offset=200"'), true);
  assert.equal(result.html.includes("查看更多审批"), true);
});

test("R4 web loader maps forbidden and not-found API failures to route states", async () => {
  const surface = goldPathSurfaceVm();
  const forbidden = fakeRouteClient(surface, {
    costError: new WorkHubApiError(403, "forbidden", "需要管理员授权")
  });
  const costMatch = resolveWebRoute("/dashboard/cost");
  assert.ok(costMatch);
  const forbiddenResult = await loadWebRoute(forbidden.client, costMatch, "zh-CN");
  assert.equal(forbiddenResult.status, "forbidden");
  assert.equal(forbiddenResult.html.includes('data-route-state="forbidden"'), true);
  assert.equal(forbiddenResult.html.includes("需要管理员授权"), true);

  const missing = fakeRouteClient(surface, {
    approvalsError: new WorkHubApiError(404, "not_found", "not found")
  });
  const approvalsMatch = resolveWebRoute("/approvals");
  assert.ok(approvalsMatch);
  const missingResult = await loadWebRoute(missing.client, approvalsMatch, "en-US");
  // M6/M25: a 404 is now a distinct not-found state, not the misleading generic empty.
  assert.equal(missingResult.status, "notFound");
  assert.equal(missingResult.html.includes("find this page"), true);
});

test("R4 web loader keeps auth bootstrap outside route-state swallowing", async () => {
  const surface = goldPathSurfaceVm();
  const { client } = fakeRouteClient(surface, {
    attentionError: new WorkHubApiError(401, "not_identified", "identify first")
  });
  const match = resolveWebRoute("/");
  assert.ok(match);
  await assert.rejects(() => loadWebRoute(client, match, "en-US"), /identify first/u);
});

test("intake project-context loader rethrows not_identified (re-auth, not a degraded project_unavailable page)", async () => {
  const surface = goldPathSurfaceVm();
  const { client } = fakeRouteClient(surface);
  client.pages.project = async () => {
    throw new WorkHubApiError(401, "not_identified", "identify first");
  };
  const match = resolveWebRoute("/intake?project_id=93000000-0000-4000-8000-000000000001");
  assert.ok(match);
  await assert.rejects(() => loadWebRoute(client, match, "en-US"), /identify first/u);
});

test("drive loader rethrows not_identified from listProjects (re-auth, not a silent no-switcher page)", async () => {
  const surface = goldPathSurfaceVm();
  const { client } = fakeRouteClient(surface);
  client.listProjects = async () => {
    throw new WorkHubApiError(401, "not_identified", "identify first");
  };
  const match = resolveWebRoute("/drive");
  assert.ok(match);
  await assert.rejects(() => loadWebRoute(client, match, "en-US"), /identify first/u);
});

test("R4 web loader renders unknown routes as recoverable not-found states", async () => {
  const surface = goldPathSurfaceVm();
  const { client, calls } = fakeRouteClient(surface);
  const result = await loadWebRoute(client, createUnknownWebRouteMatch("/missing"), "en-US");

  // M27: a typo'd / dead URL is "not found" (calm, recoverable to home), not a server "error"
  // whose only action re-hits the same dead URL.
  assert.equal(result.status, "notFound");
  assert.equal(calls.length, 0);
  assert.equal(result.html.includes('data-route-state="notFound"'), true);
  assert.equal(result.html.includes("find this page"), true);
  // recoverable: a home escape hatch is always present (no nav-less dead-end loop).
  assert.equal(result.html.includes('data-r4-web-route-home="true"'), true);
});

// ── R15 批 web-mirror（web 只读会话镜像）───────────────────────────────────────────────
const MIRROR_CONVERSATION_ID = "30000000-0000-4000-8000-000000000003";
const MIRROR_OWNER_ID = "60000000-0000-4000-8000-000000000006";
const MIRROR_IVY_ID = "60000000-0000-4000-8000-000000000007";

function conversationMessagePageVm(overrides: Partial<ConversationMessagePageVM> = {}): ConversationMessagePageVM {
  const messages: ConversationMessageVM[] = [
    {
      id: "40000000-0000-4000-8000-000000000101",
      conversation_id: MIRROR_CONVERSATION_ID,
      seq: 5,
      sender_type: "user",
      sender_user_id: MIRROR_OWNER_ID,
      thread_root_id: null,
      edited_at: "2026-07-12T01:00:05.000000Z",
      pinned: { at: "2026-07-12T01:01:00.000000Z", by_user_id: MIRROR_OWNER_ID },
      reactions: [{ key: "approve", user_ids: [MIRROR_IVY_ID] }],
      kind: "text",
      content: { text: "先看风险\n再看指标" },
      created_at: "2026-07-12T01:00:00.000000Z"
    },
    {
      id: "40000000-0000-4000-8000-000000000102",
      conversation_id: MIRROR_CONVERSATION_ID,
      seq: 6,
      sender_type: "cuu",
      sender_user_id: null,
      thread_root_id: null,
      reply_to: {
        message_id: "40000000-0000-4000-8000-000000000101",
        sender_type: "user",
        sender_user_id: MIRROR_OWNER_ID,
        preview_text: "先看风险",
        deleted: false
      },
      kind: "text",
      content: { text: "好的，我先梳理风险。" },
      created_at: "2026-07-12T01:00:02.000000Z"
    },
    {
      id: "40000000-0000-4000-8000-000000000103",
      conversation_id: MIRROR_CONVERSATION_ID,
      seq: 7,
      sender_type: "user",
      sender_user_id: MIRROR_IVY_ID,
      thread_root_id: null,
      kind: "file_card",
      content: { drive_item_id: "93000000-0000-4000-8000-000000000002", snapshot_name: "风险清单.md" },
      created_at: "2026-07-12T01:00:04.000000Z"
    },
    {
      id: "40000000-0000-4000-8000-000000000104",
      conversation_id: MIRROR_CONVERSATION_ID,
      seq: 8,
      sender_type: "system",
      sender_user_id: null,
      thread_root_id: null,
      kind: "system_event",
      content: { event: "risk_digest", summary: "3 项工单停滞", stalled_count: 3 },
      created_at: "2026-07-12T01:00:06.000000Z"
    },
    {
      id: "40000000-0000-4000-8000-000000000105",
      conversation_id: MIRROR_CONVERSATION_ID,
      seq: 9,
      sender_type: "user",
      sender_user_id: MIRROR_IVY_ID,
      thread_root_id: null,
      deleted_at: "2026-07-12T01:00:08.000000Z",
      kind: "text",
      content: { text: "" },
      created_at: "2026-07-12T01:00:07.000000Z"
    }
  ];
  return { messages, has_more: false, next_after_seq: 9, next_before_seq: 5, ...overrides };
}

function conversationRosterMembers() {
  return [
    { user_id: MIRROR_OWNER_ID, nickname: "R15 owner", is_admin: true },
    { user_id: MIRROR_IVY_ID, nickname: "Ivy", is_admin: false }
  ];
}

test("R15 web-mirror conversation route renders a read-only message mirror (latest page)", async () => {
  const { client, calls } = fakeRouteClient(goldPathSurfaceVm(), {
    conversationMessages: conversationMessagePageVm(),
    roster: conversationRosterMembers()
  });
  const match = resolveWebRoute(`/conversations/${MIRROR_CONVERSATION_ID}`);
  assert.ok(match);

  const result = await loadWebRoute(client, match, "zh-CN");

  assert.equal(result.status, "ready");
  // 首屏 = 最新一页：beforeSeq=MAX（O(1)，同桌面首屏策略）。
  assert.ok(calls.some((call) => call.startsWith(`conversationMessages:${MIRROR_CONVERSATION_ID}:before=${Number.MAX_SAFE_INTEGER}:`)));
  // 成员目录用于昵称解析。
  // R20 P1-08 收尾：昵称解析走工作区花名册端点，不再是全局 /api/users。
  assert.ok(calls.includes("workspaceRoster"));
  // 只读边界：绝不 POST——没有任何写端点被触及（发消息/反应/已读游标/turns 全无）。
  assert.equal(calls.filter((call) => /receipt|turn|reaction|:read|typing/u.test(call)).length, 0);

  assert.equal(result.html.includes('data-r4-route-component="conversation"'), true);
  assert.equal(result.html.includes('data-r15-conversation-readonly="true"'), true);
  // 只读镜像页头横幅（双语其一）。
  assert.equal(result.html.includes("只读镜像 · 完整协作请在桌面工作台"), true);
  // 发送者昵称解析（成员目录）+ Cuu + 系统。
  assert.equal(result.html.includes("R15 owner"), true);
  assert.equal(result.html.includes("Cuu"), true);
  // 反应聚合：emoji + 计数（reaction 破例 emoji）。
  assert.equal(result.html.includes("👍"), true);
  // 编辑墓碑 + 置顶标记。
  assert.equal(result.html.includes("已编辑"), true);
  assert.equal(result.html.includes("已置顶"), true);
  // file_card 快照名。
  assert.equal(result.html.includes("风险清单.md"), true);
  // system_event digest 朴素渲染。
  assert.equal(result.html.includes("今日风险巡检"), true);
  // 删除墓碑。
  assert.equal(result.html.includes("此消息已删除"), true);
  // 引用回复预览。
  assert.equal(result.html.includes("先看风险"), true);
  // 只读：无 composer/textarea，无发送按钮。
  assert.equal(result.html.includes("<textarea"), false);
  assert.equal(/data-action-id="[^"]*(send|react|pin|edit|delete)/u.test(result.html), false);
  // 最新页无「更新」/「回到最新」链接。
  assert.equal(result.html.includes('data-r15-mirror-newer="true"'), false);
  assert.equal(result.html.includes('data-r15-mirror-latest="true"'), false);
});

test("R15 web-mirror ?seq= locates the target message and never advances the read cursor", async () => {
  const { client, calls } = fakeRouteClient(goldPathSurfaceVm(), {
    conversationMessages: conversationMessagePageVm(),
    roster: conversationRosterMembers()
  });
  const match = resolveWebRoute(`/conversations/${MIRROR_CONVERSATION_ID}?seq=5`);
  assert.ok(match);

  const result = await loadWebRoute(client, match, "en-US");

  assert.equal(result.status, "ready");
  // ?seq=5 → 定位到含该 seq 的一页：beforeSeq=seq+1=6。
  assert.ok(calls.some((call) => call.startsWith(`conversationMessages:${MIRROR_CONVERSATION_ID}:before=6:`)));
  // 目标高亮（不改动任何读游标：没有 receipt 写调用）。
  assert.equal(result.html.includes('data-r15-conversation-target-seq="5"'), true);
  assert.equal(result.html.includes('data-r15-mirror-target="true"'), true);
  assert.equal(result.html.includes("wh-mirror-msg--target"), true);
  assert.equal(calls.filter((call) => /receipt|:read/u.test(call)).length, 0);
  // 英文横幅。
  assert.equal(result.html.includes("Read-only mirror · Collaborate in the desktop workbench"), true);
});

test("R15 web-mirror pagination cursors follow the before/after read-endpoint semantics", async () => {
  // 最新页 + 还有更早：只出「更早」链接（before=next_before_seq），无更新/回最新。
  const latest = fakeRouteClient(goldPathSurfaceVm(), {
    conversationMessages: conversationMessagePageVm({ has_more: true, next_before_seq: 3, next_after_seq: 9 }),
    roster: conversationRosterMembers()
  });
  const latestMatch = resolveWebRoute(`/conversations/${MIRROR_CONVERSATION_ID}`);
  assert.ok(latestMatch);
  const latestResult = await loadWebRoute(latest.client, latestMatch, "zh-CN");
  assert.equal(latestResult.status, "ready");
  assert.equal(latestResult.html.includes('data-r15-mirror-older="true"'), true);
  assert.equal(latestResult.html.includes("before=3"), true);
  assert.equal(latestResult.html.includes('data-r15-mirror-newer="true"'), false);
  assert.equal(latestResult.html.includes('data-r15-mirror-latest="true"'), false);

  // 更早页（?before=）：更早（before=next_before_seq）+ 更新（after=页内最新 seq）+ 回到最新 三个都在。
  const before = fakeRouteClient(goldPathSurfaceVm(), {
    conversationMessages: conversationMessagePageVm({ has_more: true, next_before_seq: 3, next_after_seq: 9 }),
    roster: conversationRosterMembers()
  });
  const beforeMatch = resolveWebRoute(`/conversations/${MIRROR_CONVERSATION_ID}?before=100`);
  assert.ok(beforeMatch);
  const beforeResult = await loadWebRoute(before.client, beforeMatch, "zh-CN");
  assert.ok(before.calls.some((call) => call.startsWith(`conversationMessages:${MIRROR_CONVERSATION_ID}:before=100:`)));
  assert.equal(beforeResult.html.includes('data-r15-mirror-older="true"'), true);
  assert.equal(beforeResult.html.includes('data-r15-mirror-newer="true"'), true);
  assert.equal(beforeResult.html.includes("after=9"), true);
  assert.equal(beforeResult.html.includes('data-r15-mirror-latest="true"'), true);

  // 正向页（?after=）：afterSeq 请求；has_more → 更新（after=next_after_seq），更早回溯页内最旧 seq。
  const after = fakeRouteClient(goldPathSurfaceVm(), {
    conversationMessages: conversationMessagePageVm({ has_more: true, next_after_seq: 42 }),
    roster: conversationRosterMembers()
  });
  const afterMatch = resolveWebRoute(`/conversations/${MIRROR_CONVERSATION_ID}?after=4`);
  assert.ok(afterMatch);
  const afterResult = await loadWebRoute(after.client, afterMatch, "zh-CN");
  assert.ok(after.calls.some((call) => call.startsWith(`conversationMessages:${MIRROR_CONVERSATION_ID}:after=4:`)));
  assert.equal(afterResult.html.includes('data-r15-mirror-newer="true"'), true);
  assert.equal(afterResult.html.includes("after=42"), true);
  assert.equal(afterResult.html.includes('data-r15-mirror-older="true"'), true);
  assert.equal(afterResult.html.includes("before=5"), true);
});

test("R15 web-mirror non-participant / missing conversation falls to the recoverable not-found state", async () => {
  const { client } = fakeRouteClient(goldPathSurfaceVm(), {
    conversationMessagesError: new WorkHubApiError(404, "conversation_not_found", "没有找到这个会话。"),
    roster: conversationRosterMembers()
  });
  const match = resolveWebRoute(`/conversations/${MIRROR_CONVERSATION_ID}`);
  assert.ok(match);

  const result = await loadWebRoute(client, match, "zh-CN");

  assert.equal(result.status, "notFound");
  assert.equal(result.html.includes('data-route-state="notFound"'), true);
});

test("R15 web-mirror member-directory failure degrades softly to unknown-member labels", async () => {
  const { client } = fakeRouteClient(goldPathSurfaceVm(), {
    conversationMessages: conversationMessagePageVm(),
    rosterError: new Error("directory unavailable")
  });
  const match = resolveWebRoute(`/conversations/${MIRROR_CONVERSATION_ID}`);
  assert.ok(match);

  const result = await loadWebRoute(client, match, "zh-CN");

  // 成员目录失败不连累消息渲染（消息才是主数据）——昵称退化为「未知成员」。
  assert.equal(result.status, "ready");
  assert.equal(result.html.includes("未知成员"), true);
  assert.equal(result.html.includes("Cuu"), true);
});

test("R15 web-mirror session expiry during a conversation load bubbles for re-auth", async () => {
  const { client } = fakeRouteClient(goldPathSurfaceVm(), {
    conversationMessagesError: new WorkHubApiError(401, "not_identified", "请重新登录。")
  });
  const match = resolveWebRoute(`/conversations/${MIRROR_CONVERSATION_ID}`);
  assert.ok(match);

  await assert.rejects(
    loadWebRoute(client, match, "zh-CN"),
    (error: unknown) => error instanceof WorkHubApiError && error.code === "not_identified"
  );
});
