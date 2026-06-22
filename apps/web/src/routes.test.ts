import assert from "node:assert/strict";
import test from "node:test";

import { WorkHubApiError, type WorkHubApiClient } from "@workhub/api-client";
import { createP05GoldPathFixture, validateP05GoldPathFixture } from "@workhub/agent/fixtures";
import type {
  ApprovalCenterVM,
  AttentionHomeVM,
  CalendarPageVM,
  CostDashboardVM,
  DrivePageVM,
  EvidenceBubble,
  GoldPathSurfaceVM,
  MeetingPageVM,
  NotificationPageVM,
  ProposalConflict,
  ReplayTraceVM,
  SessionVM,
  SettingsPageVM,
  TeamSkillsPageVM
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
  skills?: TeamSkillsPageVM;
  drive?: DrivePageVM;
  meetings?: MeetingPageVM;
  notifications?: NotificationPageVM;
  calendar?: CalendarPageVM;
  replay?: ReplayTraceVM;
  session?: SessionVM;
  knowledge?: EvidenceBubble;
  settings?: SettingsPageVM;
  conflicts?: ProposalConflict[];
  attentionError?: Error;
  approvalsError?: Error;
  costError?: Error;
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

function fakeRouteClient(surface: GoldPathSurfaceVM, overrides: RouteClientOverrides = {}) {
  const calls: string[] = [];
  const localeCall = (name: string, options?: { locale?: string; projectId?: string }) => {
    calls.push(`${name}:${options?.locale ?? "none"}`);
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
      async approvals(options?: { locale?: string }) {
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
      async drive(options?: { locale?: string; projectId?: string }) {
        calls.push(`drive:${options?.locale ?? "none"}:${options?.projectId ?? "none"}`);
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
      }
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
      return overrides.knowledge ?? routeEvidenceBubble();
    },
    async replayAgentRun(id: string, options?: { locale?: string }) {
      localeCall(`replayAgentRun:${id}`, options);
      return overrides.replay ?? surface.page_vms.replay;
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
  assert.deepEqual(webRouteRegistry.map((route) => route.key), [
    "home",
    "projects",
    "intake",
    "approvals",
    "workitem",
    "proposal",
    "drive",
    "meetings",
    "notifications",
    "calendar",
    "health",
    "replay",
    "cost",
    "knowledge",
    "skills",
    "settings"
  ]);
  assert.equal(resolveWebRoute("/")?.key, "home");
  assert.equal(resolveWebRoute("/projects")?.key, "projects");
  assert.equal(resolveWebRoute("/dashboard/health")?.key, "health");
  assert.equal(resolveWebRoute("/approvals?filter=pending")?.key, "approvals");
  assert.equal(resolveWebRoute("/dashboard/cost")?.key, "cost");
  assert.equal(resolveWebRoute("/drive")?.key, "drive");
  assert.equal(resolveWebRoute("/meetings?project_id=95000000-0000-4000-8000-000000000001")?.key, "meetings");
  assert.equal(resolveWebRoute("/notifications")?.key, "notifications");
  assert.equal(resolveWebRoute("/calendar?date=2026-06-11&view=week")?.key, "calendar");
  assert.equal(resolveWebRoute("/calendar?date=2026-06-11&view=week")?.search, "?date=2026-06-11&view=week");
  assert.equal(resolveWebRoute("/knowledge/search?q=weekly")?.key, "knowledge");
  assert.equal(resolveWebRoute("/knowledge/search?q=weekly")?.search, "?q=weekly");
  assert.equal(resolveWebRoute("/dashboard/skills")?.key, "skills");
  assert.equal(resolveWebRoute("/workitems/WH-001")?.params["id"], "WH-001");
  assert.equal(resolveWebRoute("/agent-runs/run-1/replay")?.params["id"], "run-1");
  assert.equal(resolveWebRoute("/#/approvals")?.key, "home");
  assert.equal(resolveWebRoute("/unknown"), undefined);
  assert.equal(webRouteHref("https://workhub.local/proposals/p-1?tab=diff#top"), "/proposals/p-1?tab=diff");
  assert.equal(webRouteHref("https://workhub.local/#/agent-runs/run-1/replay?from=old"), "/agent-runs/run-1/replay?from=old");
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
      ["intake", "session"],
      ["approvals", "approvals"],
      ["workitem", "workitem"],
      ["proposal", "proposal"],
      ["drive", "drive"],
      ["meetings", "meetings"],
      ["notifications", "notifications"],
      ["calendar", "calendar"],
      ["health", "health"],
      ["replay", "replay"],
      ["cost", "cost"],
      ["knowledge", "evidence"],
      ["skills", "skills"],
      ["settings", "settings"]
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

test("R6 home never collapses to the generic empty card — empty attention still renders the decision inbox + intake CTA + nav entry", async () => {
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
  // ① 不再塌成通用空卡：状态 ready、渲染首页决策收件箱组件本身。
  assert.equal(result.status, "ready");
  assert.equal(result.html.includes('data-r4-route-component="home"'), true);
  // ② 战绩横幅 + 提需求 CTA 仍在；不出现"回到总览"死胡同。
  assert.equal(result.html.includes('data-r4-home-worklog="true"'), true);
  assert.equal(result.html.includes('data-r4-home-intake-cta="true"'), true);
  assert.equal(result.html.includes("回到总览"), false);
  // ③ 导航常驻"提需求"入口（intake 不再 detail-only）。
  assert.equal(result.html.includes('data-wh-page-key="intake"'), true);
});

test("R4.11 web loader marks ready routes as route components", async () => {
  const surface = goldPathSurfaceVm();

  for (const [path, endpointCalls, routeComponent] of [
    ["/", ["attention:en-US"], "home"],
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

test("R5.2 drive route loader forwards project id query to the Page VM client", async () => {
  const surface = goldPathSurfaceVm();
  const { client, calls } = fakeRouteClient(surface, { drive: driveVm() });
  const match = resolveWebRoute("/drive?project_id=93000000-0000-4000-8000-000000000001");
  assert.ok(match);

  const result = await loadWebRoute(client, match, "en-US");

  assert.equal(result.status, "ready");
  assert.deepEqual(calls, ["drive:en-US:93000000-0000-4000-8000-000000000001"]);
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
  assert.equal(result.html.includes('data-r4-settings-secret-safe="true"'), true);
  assert.equal(result.html.includes('data-r4-settings-restore-requires-desktop="true"'), true);
  assert.equal(result.html.includes('data-r4-settings-web-local-actions="false"'), true);
  assert.equal(result.html.includes("/api/auth/preferences"), true);
  assert.equal(/sk-[0-9A-Za-z]{20,}/u.test(result.html), false);
});

test("R4 web loader renders route-state empty without fake ready content", async () => {
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

  assert.equal(result.status, "empty");
  assert.deepEqual(calls, ["approvals:zh-CN"]);
  assert.equal(result.html.includes('data-route-state="empty"'), true);
  assert.equal(result.html.includes("现在没有需要处理的事项"), true);
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
  assert.equal(missingResult.status, "empty");
  assert.equal(missingResult.html.includes("Nothing needs action right now"), true);
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

test("R4 web loader renders unknown routes as explicit error states", async () => {
  const surface = goldPathSurfaceVm();
  const { client, calls } = fakeRouteClient(surface);
  const result = await loadWebRoute(client, createUnknownWebRouteMatch("/missing"), "en-US");

  assert.equal(result.status, "error");
  assert.equal(calls.length, 0);
  assert.equal(result.html.includes('data-route-state="error"'), true);
  assert.equal(result.html.includes("route=/missing"), true);
});
