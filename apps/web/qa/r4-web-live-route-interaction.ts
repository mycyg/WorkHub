import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { AddressInfo } from "node:net";
import { fileURLToPath, pathToFileURL } from "node:url";

import { createServer as createViteServer, type ViteDevServer } from "vite";
import { createP05GoldPathFixture, validateP05GoldPathFixture } from "@workhub/agent/fixtures";
import type { AgentArmyDashboardVM, CalendarPageVM, DrivePageVM, EvidenceBubble, GoldPathSurfaceVM, MeetingPageVM, NotificationPageVM,
  ProjectHealthPageVM, ProjectHomePageVM, ProjectListVM, ProposalConflict, SessionVM, SettingsPageVM, TeamSkillsPageVM, WorkHubLocale, WorkItemDetailVM } from "@workhub/contracts";
import { isExpectedActionNotice, noticeSequence, shouldRetryTransportActionNotice } from "../src/browser-action-notice.js";
import { launchChrome, type CdpClient } from "../src/chrome-launch.js";
import { contactSheetFreshness } from "../src/r4-smoke-contact-sheet.js";

type Viewport = {
  width: number;
  height: number;
};

type ApiRequestRecord = {
  method: string;
  pathname: string;
  search: string;
  locale: string | null;
  referer: string | null;
  body: string | null;
};

type BrowserAudit = {
  pathname: string;
  search: string;
  locationHash: string;
  lang: string;
  storedLocale: string | null;
  status: string;
  routeKey: string;
  productShell: boolean;
  linkModePath: boolean;
  masthead: boolean;
  routeComponent: string | null;
  routeComponentSource: string | null;
  routeComponentPanel: string | null;
  routeComponentActive: boolean;
  hydrationBoundary: boolean;
  hydrationRoute: string | null;
  hydrationSource: string | null;
  hydrationMode: string | null;
  hydrationPageVm: string | null;
  hydrationActionCount: string | null;
  hydrationAdapter: string | null;
  hydrationReactComponent: string | null;
  hydrationReactComponentRoute: string | null;
  hydrationReactComponentMode: string | null;
  hydrationReactComponentPropsSource: string | null;
  hydrationReactComponentFallback: boolean;
  hydrationReactComponentAdapter: string | null;
  hydrationPanel: boolean;
  hydrationPanelRoute: string | null;
  hydrationPanelMode: string | null;
  hydrationPanelPageVm: string | null;
  hydrationPanelActionCount: string | null;
  hydrationPanelCount: number;
  reactRouteTree: boolean;
  routeTreeKey: string | null;
  routeTreePageVm: string | null;
  routeTreeMode: string | null;
  routeTreeAdapter: string | null;
  routeTreeActiveOnly: boolean;
  routeTreeRouteCount: string | null;
  routeTreeReactComponent: string | null;
  routeTreeReactComponentAdapter: string | null;
  routeTreeReactComponentFallback: boolean;
  routeTreeRuntimeMount: boolean;
  routeTreeRuntimeStrategy: string | null;
  routeTreeRuntimePropsUpdate: string | null;
  routeTreeRuntimeDispatcher: string | null;
  routeTreeRuntimeMutationEditor: string | null;
  routeTreeRuntimeLineEditor: string | null;
  reactComponentName: string | null;
  reactComponentRoute: string | null;
  reactComponentMode: string | null;
  reactComponentPropsSource: string | null;
  reactComponentPageVm: string | null;
  reactComponentLocale: string | null;
  reactComponentHtmlFallback: boolean;
  reactComponentAdapter: string | null;
  reactComponentActionCount: string | null;
  reactComponentFingerprint: string | null;
  reactRuntimeMounted: boolean;
  reactRuntimeRoute: string | null;
  reactRuntimeComponent: string | null;
  reactRuntimeName: string | null;
  reactRuntimePropsSource: string | null;
  reactRuntimeFingerprint: string | null;
  reactRuntimeLastUpdateReason: string | null;
  reactRuntimeMountCount: string | null;
  reactRuntimePropsUpdateCount: string | null;
  reactRuntimePrimaryActionCount: string | null;
  reactRuntimeQueueCount: string | null;
  reactRuntimeVisibleMutationEditor: string | null;
  reactRuntimeMutationEditorKind: string | null;
  reactRuntimeControlledField: string | null;
  reactRuntimeControlledValue: string | null;
  reactRuntimeHtmlFallbackPreserved: string | null;
  reactRuntimeHtmlFallbackHidden: string | null;
  reactRuntimeVisibleLineEditor: string | null;
  reactRuntimeLineEditorKind: string | null;
  reactRuntimeLineEditorSelectedDecision: string | null;
  reactRuntimeLineEditorSearchValue: string | null;
  reactRuntimeLineEditorHtmlFallbackPreserved: string | null;
  reactRuntimeLineEditorHtmlFallbackHidden: string | null;
  reactRuntimeDispatcherProbe: boolean;
  reactRuntimeDispatcherProbeActionId: string | null;
  routeSpecificMarker: boolean;
  routeData: {
    homeProjectDesk: string | null;
    homeProjectCount: string | null;
    homeDriveCta: string | null;
    workitemTraceCount: string | null;
    workitemEvidenceCount: string | null;
    workitemAcceptanceCount: string | null;
    workitemSourceContext: string | null;
    workitemSourceCommentId: string | null;
    workitemSourceMeetingId: string | null;
    workitemSourceInsightId: string | null;
    workitemSourceProposalId: string | null;
    workitemCreateProposalAction: string | null;
    proposalChangeCount: string | null;
    proposalActionCount: string | null;
    proposalEvidenceCount: string | null;
    proposalConflictCount: string | null;
    proposalSplitAdapter: string | null;
    proposalReadonlyReviewActionCount: string | null;
    proposalAdvancedFallbackPreserved: string | null;
    proposalAdvancedFallbackActionCount: string | null;
    proposalLineEditorFallback: string | null;
    proposalFieldEditorFallback: string | null;
    proposalSubrecordEditorFallback: string | null;
    proposalLineEditorFileCount: string | null;
    proposalLineEditorHunkCount: string | null;
    proposalStructuredFieldEditorCount: string | null;
    proposalSubrecordItemCount: string | null;
    proposalAdvancedConflicts: string | null;
    proposalAdvancedFallback: string | null;
    proposalAdvancedFallbackSource: string | null;
    proposalAdvancedFallbackBoundaryActionCount: string | null;
    proposalAdvancedLineEditor: string | null;
    proposalAdvancedFieldEditor: string | null;
    proposalAdvancedSubrecordEditor: string | null;
    proposalLineEditorSelectedDecision: string | null;
    proposalLineEditorSearchValue: string | null;
    proposalCustomFieldValue: string | null;
    routeDirty: string | null;
    routeDirtyReason: string | null;
    intakeOptionCount: string | null;
    intakeProgressCount: string | null;
    intakeFreeTextCollapsed: string | null;
    intakeInputMode: string | null;
    intakeOptionFirst: string | null;
    intakeSelectedCount: string | null;
    knowledgeEvidenceCount: string | null;
    knowledgeMissing: string | null;
    knowledgeActionCount: string | null;
    replayRunId: string | null;
    replayStepCount: string | null;
    replayAcceptedDeliverableCount: string | null;
    replayMergeAttemptCount: string | null;
    replayStructuredAuditCount: string | null;
    projectsCount: string | null;
    projectHomeId: string | null;
    projectHomeSlug: string | null;
    projectHomeOpenCount: string | null;
    projectHomeItemCount: string | null;
    projectHomeFileCount: string | null;
    projectHomeMoreCount: string | null;
    projectHomeFilesMoreCount: string | null;
    driveProjectId: string | null;
    driveSelectedItemId: string | null;
    driveItemCount: string | null;
    driveVersionCount: string | null;
    driveAcceptedCount: string | null;
    driveCommentCount: string | null;
    driveDeletedCount: string | null;
    driveOperationCount: string | null;
    driveCanManage: string | null;
    driveProposalLink: string | null;
    driveProposalHref: string | null;
    driveProposalStatus: string | null;
    meetingProjectId: string | null;
    meetingSelectedId: string | null;
    meetingCount: string | null;
    meetingPendingInsights: string | null;
    meetingConfirmedInsights: string | null;
    meetingDismissedInsights: string | null;
    meetingCanManage: string | null;
    meetingInsightId: string | null;
    meetingInsightStatus: string | null;
    meetingDraftLink: string | null;
    meetingDraftHref: string | null;
    meetingProposalLink: string | null;
    meetingProposalHref: string | null;
    meetingProposalStatus: string | null;
    notificationTotalCount: string | null;
    notificationUnreadCount: string | null;
    notificationNeedsDecisionCount: string | null;
    notificationFyiCount: string | null;
    notificationDoneCount: string | null;
    notificationUrgentCount: string | null;
    notificationNeedsBucketCount: string | null;
    notificationFyiBucketCount: string | null;
    notificationDoneBucketCount: string | null;
    notificationMeetingItemStatus: string | null;
    notificationMeetingSourceType: string | null;
    notificationDriveItemStatus: string | null;
    notificationMeetingOpenHref: string | null;
    notificationDriveOpenHref: string | null;
    notificationMarkReadAction: string | null;
    notificationMarkAllReadAction: string | null;
    notificationDismissAction: string | null;
    notificationCompleteAction: string | null;
    calendarDate: string | null;
    calendarView: string | null;
    calendarBlockCount: string | null;
    calendarTodayCount: string | null;
    calendarOverdueCount: string | null;
    calendarWorkItemBlock: string | null;
    calendarMeetingBlock: string | null;
    calendarDayCount: string | null;
    calendarOpenTarget: string | null;
    costTotalTokens: string | null;
    costTotalCny: string | null;
    costBudgetCount: string | null;
    costModelCount: string | null;
    costNoticeCount: string | null;
    settingsRuntimeStatus: string | null;
    settingsPetModelInWeb: string | null;
    settingsWorkerCount: string | null;
    settingsActiveLocale: string | null;
    settingsPreferenceLocale: string | null;
    settingsPreferenceSource: string | null;
    settingsPreferenceSynced: string | null;
    settingsSecretSafe: string | null;
    settingsRestoreRequiresDesktop: string | null;
    settingsWebLocalActions: string | null;
    settingsLocalBoundary: string | null;
    healthViewerScope: string | null;
    healthProjectCount: string | null;
    healthAttentionCount: string | null;
    healthCardBand: string | null;
    healthBandsOnly: string | null;
    healthOpenProject: string | null;
    healthSignalCount: string | null;
    skillActiveCount: string | null;
    skillAiAuthoredCount: string | null;
    skillRefinedCount: string | null;
    skillCardCount: string | null;
    skillRefinedBadge: string | null;
    skillEmpty: string | null;
    agentPlanCount: string | null;
    agentRecentCount: string | null;
    agentActiveTeams: string | null;
    agentWaitingDecision: string | null;
    agentKpiCount: string | null;
    agentPlanCardCount: string | null;
    agentRecentAccordion: string | null;
    agentMobileMode: string | null;
    agentEmpty: string | null;
    notificationGrounding: string | null;
    notificationEvidenceSearchRef: string | null;
    knowledgeSourceRef: string | null;
    onboardingScreen: string | null;
    onboardingLocale: string | null;
    onboardingNicknameInput: string | null;
    onboardingAdminToggle: string | null;
    onboardingTarget: string | null;
    currentUserChip: string | null;
    currentUserAdmin: string | null;
    logoutAction: string | null;
  };
  notice: {
    visible: boolean;
    seq: string | null;
    kind: string | null;
    tone: string | null;
    source: string | null;
    locale: string | null;
    actionId: string | null;
    eventType: string | null;
    stream: string | null;
    title: string;
    body: string;
    reasonButtonCount: number;
  };
  live: {
    runtime: string | null;
    streamCount: string | null;
    activeSourceCount: string | null;
    openCount: string | null;
    closeCount: string | null;
    reuseCount: string | null;
    connectedCount: string | null;
    eventCount: string | null;
    refreshCount: string | null;
    lastEvent: string | null;
    lastStream: string | null;
    lastEventId: string | null;
    lastEventIdSource: string | null;
    cursorStrategy: string | null;
    lastOpenHadCursor: string | null;
    refreshMode: string | null;
    reactPropsEvent: string | null;
    reactPropsStream: string | null;
    reactPropsUpdateCount: string | null;
    routeDirty: string | null;
    dirtyRoute: string | null;
    dirtyReason: string | null;
    dirtyGuardCount: string | null;
    dirtyPendingEvent: string | null;
    dirtyPendingStream: string | null;
  };
  routeState: {
    kind: string | null;
    actionText: string | null;
  };
  panelCount: number;
  visiblePanelCount: number;
  activeLocale: string | null;
  pathNavigation: boolean;
  hashNavigationLeak: boolean;
  oldShellLeak: boolean;
  weeklyFixtureLeak: boolean;
  cuuLeak: boolean;
  kanbanLeak: boolean;
  secretLeak: boolean;
  clientWidth: number;
  scrollWidth: number;
  horizontalOverflow: boolean;
  navHorizontalOverflow: boolean;
  textOverflowCount: number;
  textOverflowSamples: string[];
  topbarNavOverlap: boolean;
  zhChrome: boolean;
  enChrome: boolean;
};

type StepReport = {
  id: string;
  url: string;
  viewport: Viewport;
  expectedStatus: string;
  screenshot: string;
  audit: BrowserAudit;
};

type RouteStatusProbe = {
  status: string;
  body: string;
  rootHtml: string;
};

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../../..");
const webRoot = path.join(repoRoot, "apps", "web");
const defaultOutputDir = path.join(
  repoRoot,
  "docs",
  "workhub",
  "05-clients",
  "assets",
  "audit",
  "2026-06-11-r4-web-live-route-interaction"
);
const r4ReactComponentByRoute: Record<string, string> = {
  home: "HomeRouteComponent",
  proposal: "ProposalRouteComponent",
  replay: "ReplayRouteComponent",
  cost: "CostRouteComponent",
  settings: "SettingsRouteComponent"
};
const outputDir = process.env["WORKHUB_R4_WEB_ROUTE_SMOKE_OUTPUT_DIR"]
  ? path.resolve(repoRoot, process.env["WORKHUB_R4_WEB_ROUTE_SMOKE_OUTPUT_DIR"])
  : defaultOutputDir;
const smokeTitle = process.env["WORKHUB_R4_WEB_ROUTE_SMOKE_TITLE"] ?? "R4.5 Web Live Route Interaction Smoke";
const reportFilename = process.env["WORKHUB_R4_WEB_ROUTE_SMOKE_REPORT_NAME"] ?? "live-route-interaction-report.json";
// R9.6：Agent Army dashboard 加入 typed Page VM route，desktop/mobile 各一条 live route 步骤。
const expectedLiveRouteSmokeSteps = 82;
const qaProjectId = "10000000-0000-4000-8000-000000001600";
const qaCreatedProjectId = "10000000-0000-4000-8000-000000001691";
const qaCreatedProjectName = "R4 Live Launch Notes";
const qaDriveFolderId = "10000000-0000-4000-8000-000000001619";
const qaDriveItemId = "10000000-0000-4000-8000-000000001620";
const qaManualDriveItemId = "10000000-0000-4000-8000-000000001624";
const qaDriveUploadFilename = "regional-launch-brief.md";

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;");
}

function replacement(value: string) {
  return value
    .replace(/\bCuu\b/gu, "AI assistant")
    .replace(/客户周报/gu, "区域发布复盘包")
    .replace(/周报/gu, "复盘包")
    .replace(/weekly report/giu, "regional launch review")
    .replace(/weekly/giu, "regional");
}

function deepReplace<T>(value: T): T {
  if (typeof value === "string") {
    return replacement(value) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => deepReplace(item)) as T;
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, deepReplace(item)])) as T;
  }
  return value;
}

function settingsPage(locale: WorkHubLocale): SettingsPageVM {
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
      default_model: "deepseek-v4-flash-r4-11-browser-smoke",
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

function r4AdvancedProposalConflicts(surface: GoldPathSurfaceVM): ProposalConflict[] {
  const proposal = surface.page_vms.proposal;
  const mergeHref = `/api/proposals/${proposal.proposal_id}/merge`;
  const textApplyHref = "/api/merge-proposals/10000000-0000-4000-8000-000000000913/apply";
  const structuredApplyHref = "/api/merge-proposals/10000000-0000-4000-8000-000000000914/apply";
  const keepCurrentAction = (targetKey: string) => ({
    id: "keep_current",
    label: "保留正式版",
    method: "POST" as const,
    href: mergeHref,
    request_json: { confirm: true, conflict_resolution: { accept_incoming_target_keys: [] } }
  });
  const acceptIncomingAction = (targetKey: string) => ({
    id: "accept_incoming",
    label: "采纳这次版本",
    method: "POST" as const,
    href: mergeHref,
    request_json: { confirm: true, conflict_resolution: { accept_incoming_target_keys: [targetKey] } }
  });

  const textTargetKey = "drive_item:docs/regional-launch-review.md";
  const structuredTargetKey = `work_item:${proposal.work_item_id}:task_items`;
  return [
    {
      id: "r4-13-text-conflict",
      work_item_id: proposal.work_item_id,
      proposal_id: proposal.proposal_id,
      merge_proposal_id: "10000000-0000-4000-8000-000000000913",
      change_id: proposal.manifest.changes[0]?.id ?? "change-1",
      target_key: textTargetKey,
      target_kind: "text_doc",
      change_type: "updated",
      target_path: "docs/regional-launch-review.md",
      headline: "发布复盘正文需要逐行确认",
      summary_text: "正式版和这次版本都改到了同一段，默认先展示一件最重要的冲突。",
      existing: {
        proposal_id: "10000000-0000-4000-8000-000000000920",
        change_id: "10000000-0000-4000-8000-000000000921",
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
          label: "保留正式版",
          summary_text: "不覆盖当前正式内容。",
          action: keepCurrentAction(textTargetKey)
        },
        {
          id: "accept_incoming",
          label: "采纳这次版本",
          summary_text: "使用这次版本覆盖正式内容。",
          action: acceptIncomingAction(textTargetKey)
        },
        {
          id: "ai_fusion",
          label: "采用 AI 融合稿",
          summary_text: "AI 已生成融合稿，仍需要确认重叠行。",
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
              hunks: [{ header: "@@ -2 +2 @@", lines: ["-正式版结论偏保守。", "+融合稿保留结论并补充新证据。"] }]
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
            label: "采用 AI 融合稿",
            method: "POST",
            href: textApplyHref,
            request_json: { confirm: true }
          }
        }
      ]
    },
    {
      id: "r4-13-structured-conflict",
      work_item_id: proposal.work_item_id,
      proposal_id: proposal.proposal_id,
      merge_proposal_id: "10000000-0000-4000-8000-000000000914",
      change_id: proposal.manifest.changes[0]?.id ?? "change-2",
      target_key: structuredTargetKey,
      target_kind: "structured_record",
      change_type: "updated",
      target_path: "task_items",
      headline: "任务字段需要确认",
      summary_text: "AI 更新了标题和任务项，可以展开高级字段与子记录编辑。",
      existing: {
        proposal_id: "10000000-0000-4000-8000-000000000922",
        change_id: "10000000-0000-4000-8000-000000000923",
        ref: "main"
      },
      incoming: { ref: "proposal" },
      recommended_option_id: "ai_fusion",
      options: [
        {
          id: "keep_current",
          label: "保留正式版",
          summary_text: "不覆盖当前任务字段。",
          action: keepCurrentAction(structuredTargetKey)
        },
        {
          id: "accept_incoming",
          label: "采纳这次版本",
          summary_text: "使用这次任务字段覆盖正式版。",
          action: acceptIncomingAction(structuredTargetKey)
        },
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
                selected_plan_id: "10000000-0000-4000-8000-000000000928",
                options: [
                  {
                    id: "10000000-0000-4000-8000-000000000928",
                    label: "方案拆解计划",
                    stage: "dispatch",
                    status: "draft",
                    item_count: 1,
                    recommended: true
                  },
                  {
                    id: "10000000-0000-4000-8000-000000000929",
                    label: "执行计划",
                    stage: "worker",
                    status: "draft",
                    item_count: 2
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
                      before_value: "旧复盘任务",
                      current_value: "旧复盘任务",
                      value: "区域发布复盘包",
                      source: "ai_fusion"
                    },
                    {
                      op: "set",
                      target_entity_type: "work_item",
                      target_entity_id: proposal.work_item_id,
                      field: "task_items",
                      value_type: "json_array",
                      before_value: [
                        { id: "10000000-0000-4000-8000-000000000924", title: "原始任务项", item_type: "task", sort_order: 0 }
                      ],
                      current_value: [
                        { id: "10000000-0000-4000-8000-000000000924", title: "原始任务项", item_type: "task", sort_order: 0 }
                      ],
                      value: [
                        { id: "10000000-0000-4000-8000-000000000924", title: "原始任务项", item_type: "task", sort_order: 0 },
                        { id: "10000000-0000-4000-8000-000000000925", title: "新增风险项", item_type: "risk", sort_order: 1 }
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
            href: structuredApplyHref,
            request_json: { confirm: true }
          }
        }
      ]
    }
  ];
}

function productSurface(): GoldPathSurfaceVM {
  const fixture = validateP05GoldPathFixture(createP05GoldPathFixture());
  const surface = {
    fixture_id: fixture.id,
    routes: {
      home: "/",
      intake: "/intake/r4-live-session",
      approvals: "/approvals",
      workitem: "/workitems/r4-live-workitem",
      proposal: "/proposals/r4-live-proposal",
      replay: "/agent-runs/r4-live-run/replay",
      cost: "/dashboard/cost",
      knowledge: "/knowledge/search"
    },
    page_vms: {
      attention: fixture.attentionHome,
      question: fixture.question,
      evidence: fixture.evidenceBubble,
      approvals: {
        ...fixture.approvalCenter,
        items: fixture.approvalCenter.items.map((item) => ({ ...item, work_item_id: "r4-live-workitem" }))
      },
      workitem: fixture.workItemDetail,
      proposal: fixture.proposalDetail,
      replay: {
        ...fixture.replay,
        accepted_deliverables: [
          {
            id: "10000000-0000-4000-8000-000000001518",
            work_item_id: fixture.replay.run.work_item_id ?? fixture.proposalDetail.work_item_id,
            proposal_id: fixture.proposalDetail.proposal_id,
            change_id: fixture.proposalDetail.manifest.changes[0]?.id ?? "10000000-0000-4000-8000-000000001519",
            target_kind: "drive_file",
            target_key: "drive:regional-launch-review",
            change_type: "updated",
            accepted_version: 2,
            target_path: "docs/regional-launch-review.md",
            filename: "regional-launch-review.md",
            mime: "text/markdown",
            size_bytes: 4200,
            preview_href: "/deliverables/10000000-0000-4000-8000-000000001518/preview",
            download_href: "/deliverables/10000000-0000-4000-8000-000000001518/download",
            restore_href: `/api/workitems/${fixture.replay.run.work_item_id ?? fixture.proposalDetail.work_item_id}/deliverables/10000000-0000-4000-8000-000000001518/restore`,
            accepted_at: "2026-06-11T09:20:00.000Z"
          }
        ]
      },
      cost: fixture.costDashboard,
      settings: settingsPage("zh-CN")
    },
    events: fixture.events,
    cuu_states: []
  } satisfies GoldPathSurfaceVM;
  return deepReplace({
    ...surface,
    proposal_conflicts: r4AdvancedProposalConflicts(surface)
  });
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

const driveDraftProposalId = "10000000-0000-4000-8000-000000001631";
const meetingProjectId = "10000000-0000-4000-8000-000000001600";
const meetingId = "10000000-0000-4000-8000-000000001700";
const meetingInsightId = "10000000-0000-4000-8000-000000001701";
const meetingWorkItemId = "10000000-0000-4000-8000-000000001730";
const meetingDraftProposalId = "10000000-0000-4000-8000-000000001731";

function qaWorkItemDetail(
  surface: GoldPathSurfaceVM,
  driveCommentDraftCreated = false,
  driveDraftProposalCreated = false
): WorkItemDetailVM {
  const latestProposal = driveDraftProposalCreated
    ? {
      ...surface.page_vms.proposal.manifest,
      proposal_id: driveDraftProposalId,
      work_item_id: "r4-live-workitem",
      branch_id: "10000000-0000-4000-8000-000000001632",
      title: "Drive draft proposal",
      summary_md: "Reviewable proposal generated from the Drive comment draft."
    }
    : undefined;
  const sourceContext = driveCommentDraftCreated
    ? {
      source_type: "drive_comment" as const,
      project_id: "10000000-0000-4000-8000-000000001600",
      comment_id: "10000000-0000-4000-8000-000000001623",
      folder_id: "10000000-0000-4000-8000-000000001619",
      folder_path: "/docs",
      author_label: "PM",
      body: "把这个版本差异整理成下一轮复盘行动。",
      status: driveDraftProposalCreated ? "proposal_created" as const : "draft_created" as const,
      created_at: "2026-06-11T09:22:00.000Z",
      ...(driveDraftProposalCreated ? {
        proposal_id: driveDraftProposalId,
        proposal_href: `/proposals/${driveDraftProposalId}`,
        proposal_status: "opened"
      } : {})
    }
    : undefined;
  return {
    ...surface.page_vms.workitem,
    workitem: {
      ...surface.page_vms.workitem.workitem,
      id: "r4-live-workitem",
      code: "WH-R4-14",
      title: "区域发布复盘包"
    },
    ...(latestProposal ? { latest_proposal: latestProposal } : {}),
    ...(sourceContext ? { source_context: sourceContext } : {}),
    actions: {
      ...(driveCommentDraftCreated && !driveDraftProposalCreated ? {
        create_proposal_draft: {
          id: "drive_draft_to_proposal",
          label: "Create proposal draft",
          method: "POST" as const,
          href: "/api/drive/workitems/r4-live-workitem/proposal-draft"
        }
      } : {})
    }
  };
}

function qaMeetingWorkItemDetail(
  surface: GoldPathSurfaceVM,
  meetingDraftProposalCreated = false
): WorkItemDetailVM {
  const latestProposal = meetingDraftProposalCreated
    ? {
      ...surface.page_vms.proposal.manifest,
      proposal_id: meetingDraftProposalId,
      work_item_id: meetingWorkItemId,
      branch_id: "10000000-0000-4000-8000-000000001732",
      title: "Meeting insight proposal",
      summary_md: "Reviewable proposal generated from the confirmed meeting insight."
    }
    : undefined;
  return {
    ...surface.page_vms.workitem,
    workitem: {
      ...surface.page_vms.workitem.workitem,
      id: meetingWorkItemId,
      code: "WH-R5-5",
      title: "Update proposal pricing model",
      raw_description: "Create a draft update to the pricing section with tiered usage.",
      summary_md: "Create a draft update to the pricing section with tiered usage."
    },
    ...(latestProposal ? { latest_proposal: latestProposal } : {}),
    source_context: {
      source_type: "meeting_insight",
      project_id: meetingProjectId,
      meeting_id: meetingId,
      insight_id: meetingInsightId,
      meeting_title: "Q2 Client Proposal Review",
      insight_kind: "requirement_change",
      title: "Update proposal pricing model",
      description: "Create a draft update to the pricing section with tiered usage.",
      confidence_reason: "The meeting explicitly asks Finance to update the model before review.",
      status: "confirmed",
      transcript_excerpt: "Priya Shah: Update proposal pricing model with tiered usage before review.",
      minutes_excerpt: "Pricing and timeline changes need review before Finance sign-off.",
      evidence_refs: [
        {
          id: "10000000-0000-4000-8000-000000001702",
          source_type: "meeting",
          source_id: meetingId,
          title: "Q2 Client Proposal Review",
          excerpt: "Update proposal pricing model with tiered usage.",
          href: `/meetings?project_id=${meetingProjectId}&m=${meetingId}`
        }
      ],
      created_at: "2026-06-11T09:34:00.000Z",
      ...(meetingDraftProposalCreated ? {
        proposal_id: meetingDraftProposalId,
        proposal_href: `/proposals/${meetingDraftProposalId}`,
        proposal_status: "opened"
      } : {})
    },
    actions: {
      ...(!meetingDraftProposalCreated ? {
        create_proposal_draft: {
          id: "meeting_draft_to_proposal",
          label: "Create proposal draft",
          method: "POST" as const,
          href: `/api/meetings/workitems/${meetingWorkItemId}/proposal-draft`
        }
      } : {})
    }
  };
}

function meetingPage(
  draftCreated = false,
  proposalCreated = false,
  dismissed = false
): MeetingPageVM {
  const status = dismissed ? "dismissed" as const : draftCreated ? "confirmed" as const : "pending" as const;
  return {
    generated_at: "2026-06-11T09:33:00.000Z",
    project: {
      id: meetingProjectId,
      name: "区域发布资料库",
      slug: "regional-launch",
      owner_label: "owner",
      status: "active"
    },
    summary: {
      meeting_count: 1,
      ready_count: 1,
      pending_insight_count: status === "pending" ? 1 : 0,
      confirmed_insight_count: status === "confirmed" ? 1 : 0,
      dismissed_insight_count: status === "dismissed" ? 1 : 0
    },
    can_manage: true,
    selected_meeting_id: meetingId,
    meetings: [
      {
        id: meetingId,
        project_id: meetingProjectId,
        uploaded_by_user_id: "10000000-0000-4000-8000-000000001703",
        uploaded_by_label: "PM",
        title: "Q2 Client Proposal Review",
        audio_filename: "q2-client-proposal-review.txt",
        audio_mime: "text/plain",
        audio_size_bytes: 4096,
        transcript_text: "Priya Shah: Update proposal pricing model with tiered usage before review. Finance needs a draft by Friday.",
        minutes_md: "## Summary\n\nPricing and timeline changes need review before Finance sign-off.\n\n## Action\n\nCreate a pricing model update draft and keep source context attached.",
        status: "ready",
        created_at: "2026-06-11T09:20:00.000Z",
        updated_at: "2026-06-11T09:32:00.000Z",
        insights: [
          {
            id: meetingInsightId,
            meeting_id: meetingId,
            kind: "requirement_change",
            title: "Update proposal pricing model",
            description: "Create a draft update to the pricing section with tiered usage.",
            confidence_reason: "The meeting explicitly asks Finance to update the model before review.",
            status,
            created_at: "2026-06-11T09:32:00.000Z",
            evidence_refs: [
              {
                id: "10000000-0000-4000-8000-000000001702",
                source_type: "meeting",
                source_id: meetingId,
                title: "Q2 Client Proposal Review",
                excerpt: "Update proposal pricing model with tiered usage.",
                href: `/meetings?project_id=${meetingProjectId}&m=${meetingId}`
              }
            ],
            ...(draftCreated && !dismissed ? {
              target_work_item_id: meetingWorkItemId,
              created_work_item_id: meetingWorkItemId,
              draft_href: `/workitems/${meetingWorkItemId}`,
              confirmed_by_user_id: "10000000-0000-4000-8000-000000001703",
              confirmed_at: "2026-06-11T09:34:00.000Z",
              ...(proposalCreated ? {
                proposal_id: meetingDraftProposalId,
                proposal_href: `/proposals/${meetingDraftProposalId}`,
                proposal_status: "opened"
              } : {})
            } : {}),
            ...(!draftCreated && !dismissed ? {
              actions: {
                create_draft: {
                  id: "meeting_insight_to_draft",
                  label: "Create draft",
                  method: "POST" as const,
                  href: `/api/meetings/projects/${meetingProjectId}/insights/${meetingInsightId}/draft`
                },
                dismiss: {
                  id: "meeting_insight_dismiss",
                  label: "Dismiss",
                  method: "POST" as const,
                  href: `/api/meetings/projects/${meetingProjectId}/insights/${meetingInsightId}/dismiss`
                }
              }
            } : {})
          }
        ]
      }
    ]
  };
}

const notificationMeetingId = "10000000-0000-4000-8000-000000001801";
const notificationDriveId = "10000000-0000-4000-8000-000000001802";

function notificationLabels(locale: WorkHubLocale) {
  const english = locale === "en-US";
  return {
    open: english ? "Open" : "打开",
    markRead: english ? "Mark as read" : "标为已读",
    markAllRead: english ? "Mark all as read" : "全部已读",
    dismiss: english ? "Dismiss" : "忽略",
    complete: english ? "Complete" : "完成"
  };
}

function notificationActionResponse(id: string, state: { read: boolean; done: boolean }) {
  return {
    id,
    user_id: "r4-live-user",
    type: id === notificationMeetingId ? "meeting.insight.confirmed" : "drive.comment.draft",
    severity: id === notificationMeetingId ? "high" : "normal",
    title: id === notificationMeetingId ? "Meeting insight draft created" : "Drive draft awaits proposal",
    body: id === notificationMeetingId ? "Q2 Client Proposal Review is now in the draft/review flow." : "A Drive comment has been converted into a work draft.",
    target_url: id === notificationMeetingId
      ? `/meetings?project_id=${meetingProjectId}&m=${meetingId}&insight_id=${meetingInsightId}`
      : "/drive?project_id=10000000-0000-4000-8000-000000001600",
    project_id: meetingProjectId,
    work_item_id: id === notificationMeetingId ? meetingWorkItemId : "r4-live-workitem",
    dedupe_key: id === notificationMeetingId ? `meeting_insight:${meetingInsightId}` : "drive_comment:10000000-0000-4000-8000-000000001623",
    ...(state.read || state.done ? { read_at: "2026-06-11T09:45:00.000Z" } : {}),
    ...(state.done ? { archived_at: "2026-06-11T09:46:00.000Z" } : {}),
    created_at: "2026-06-11T09:36:00.000Z",
    updated_at: "2026-06-11T09:46:00.000Z"
  };
}

function notificationPage(
  locale: WorkHubLocale,
  state: { meetingRead: boolean; driveRead: boolean; meetingDone: boolean; driveDone: boolean }
): NotificationPageVM {
  const labels = notificationLabels(locale);
  const meetingStatus = state.meetingDone ? "done" as const : state.meetingRead ? "read" as const : "unread" as const;
  const driveStatus = state.driveDone ? "done" as const : state.driveRead ? "read" as const : "unread" as const;
  const meetingItem: NotificationPageVM["items"][number] = {
    id: notificationMeetingId,
    type: "meeting.insight.confirmed",
    severity: "high",
    status: meetingStatus,
    inbox_bucket: state.meetingDone ? "done" : "needs_decision",
    title: "Meeting insight draft created",
    body: "Q2 Client Proposal Review is now in the draft/review flow.",
    target_href: `/meetings?project_id=${meetingProjectId}&m=${meetingId}&insight_id=${meetingInsightId}`,
    project_id: meetingProjectId,
    work_item_id: meetingWorkItemId,
    dedupe_key: `meeting_insight:${meetingInsightId}`,
    source_context: {
      source_type: "meeting_insight",
      meeting_id: meetingId,
      insight_id: meetingInsightId,
      title: "Update proposal pricing model",
      meeting_title: "Q2 Client Proposal Review",
      insight_status: "confirmed",
      project_id: meetingProjectId,
      project_name: "区域发布资料库"
    },
    grounding: {
      reason_text: locale === "zh-CN" ? "这件事在等你拍板，处理前可以先看相关证据。" : "This item is waiting for your decision. Check the evidence first if needed.",
      evidence_refs: [
        { kind: "knowledge_search", label: locale === "zh-CN" ? "查相关证据" : "Find related evidence", href: `/knowledge/search?q=regional%20launch&work_item_id=${meetingWorkItemId}&source_ref=notification:${notificationMeetingId}` },
        { kind: "agent_run_replay", label: locale === "zh-CN" ? "看执行回放" : "Open execution replay", href: "/agent-runs/r4-live-run/replay" }
      ]
    },
    ...(meetingStatus !== "unread" ? { read_at: "2026-06-11T09:45:00.000Z" } : {}),
    ...(state.meetingDone ? { archived_at: "2026-06-11T09:46:00.000Z" } : {}),
    created_at: "2026-06-11T09:36:00.000Z",
    updated_at: "2026-06-11T09:46:00.000Z",
    actions: {
      open: { id: "open", label: labels.open, method: "GET", href: `/meetings?project_id=${meetingProjectId}&m=${meetingId}&insight_id=${meetingInsightId}` },
      ...(!state.meetingRead && !state.meetingDone ? {
        mark_read: { id: "notification_mark_read", label: labels.markRead, method: "POST" as const, href: `/api/notifications/${notificationMeetingId}/read` }
      } : {}),
      ...(!state.meetingDone ? {
        dismiss: { id: "notification_dismiss", label: labels.dismiss, method: "POST" as const, href: `/api/notifications/${notificationMeetingId}/dismiss` },
        complete: { id: "notification_complete", label: labels.complete, method: "POST" as const, href: `/api/notifications/${notificationMeetingId}/complete` }
      } : {})
    }
  };
  const driveItem: NotificationPageVM["items"][number] = {
    id: notificationDriveId,
    type: "drive.comment.draft",
    severity: "normal",
    status: driveStatus,
    inbox_bucket: state.driveDone ? "done" : "fyi",
    title: "Drive draft awaits proposal",
    body: "A Drive comment has been converted into a work draft.",
    target_href: "/drive?project_id=10000000-0000-4000-8000-000000001600",
    project_id: "10000000-0000-4000-8000-000000001600",
    work_item_id: "r4-live-workitem",
    dedupe_key: "drive_comment:10000000-0000-4000-8000-000000001623",
    source_context: {
      source_type: "work_item",
      work_item_id: "r4-live-workitem",
      code: "WH-R4-14",
      title: "区域发布复盘包",
      status: "in_review",
      project_id: "10000000-0000-4000-8000-000000001600",
      project_name: "区域发布资料库",
      due_at: "2026-06-11T15:00:00.000Z"
    },
    grounding: {
      reason_text: locale === "zh-CN" ? "这是给你的进展同步，不需要立即操作。" : "This is a progress update. No action needed right now.",
      evidence_refs: [
        { kind: "knowledge_search", label: locale === "zh-CN" ? "查相关证据" : "Find related evidence", href: `/knowledge/search?q=drive%20draft&source_ref=notification:${notificationDriveId}` }
      ]
    },
    ...(driveStatus !== "unread" ? { read_at: "2026-06-11T09:45:00.000Z" } : {}),
    ...(state.driveDone ? { archived_at: "2026-06-11T09:47:00.000Z" } : {}),
    created_at: "2026-06-11T09:37:00.000Z",
    updated_at: "2026-06-11T09:47:00.000Z",
    actions: {
      open: { id: "open", label: labels.open, method: "GET", href: "/drive?project_id=10000000-0000-4000-8000-000000001600" },
      ...(!state.driveRead && !state.driveDone ? {
        mark_read: { id: "notification_mark_read", label: labels.markRead, method: "POST" as const, href: `/api/notifications/${notificationDriveId}/read` }
      } : {}),
      ...(!state.driveDone ? {
        dismiss: { id: "notification_dismiss", label: labels.dismiss, method: "POST" as const, href: `/api/notifications/${notificationDriveId}/dismiss` },
        complete: { id: "notification_complete", label: labels.complete, method: "POST" as const, href: `/api/notifications/${notificationDriveId}/complete` }
      } : {})
    }
  };
  const items = [meetingItem, driveItem];
  const buckets = {
    needs_decision: items.filter((item) => item.inbox_bucket === "needs_decision"),
    fyi: items.filter((item) => item.inbox_bucket === "fyi"),
    done: items.filter((item) => item.inbox_bucket === "done")
  };
  return {
    generated_at: "2026-06-11T09:48:00.000Z",
    actor_user_id: "r4-live-user",
    summary: {
      total_count: items.length,
      unread_count: items.filter((item) => item.status === "unread").length,
      needs_decision_count: buckets.needs_decision.length,
      fyi_count: buckets.fyi.length,
      done_count: buckets.done.length,
      urgent_count: items.filter((item) => item.severity === "urgent" || item.severity === "high").length
    },
    buckets,
    items,
    actions: {
      mark_all_read: {
        id: "notification_mark_all_read",
        label: labels.markAllRead,
        method: "POST",
        href: "/api/notifications/read-all"
      }
    }
  };
}

function projectHealthPage(locale: WorkHubLocale): ProjectHealthPageVM {
  void locale;
  return {
    generated_at: "2026-06-11T09:48:00.000Z",
    actor_user_id: "r4-live-user",
    viewer_scope: "member",
    summary: { project_count: 1, healthy_count: 0, attention_count: 1, critical_count: 0 },
    cards: [{
      project_id: meetingProjectId,
      project_name: "区域发布资料库",
      band: "attention",
      numbers_visible: false,
      target_href: `/projects/${meetingProjectId}`,
      signals: [
        { key: "open_work_items", count: 3, band: "healthy", target_href: `/projects/${meetingProjectId}` },
        { key: "overdue_work_items", count: 1, band: "attention", target_href: `/projects/${meetingProjectId}` },
        { key: "pending_approvals", count: 1, band: "healthy", target_href: "/approvals" },
        { key: "failed_runs", count: 0, band: "healthy", target_href: `/projects/${meetingProjectId}` },
        { key: "pending_insights", count: 1, band: "healthy", target_href: `/meetings?project_id=${meetingProjectId}` }
      ]
    }]
  };
}

function projectListPage(namedProjectCreated = false): ProjectListVM {
  const projects: ProjectListVM["projects"] = [
    {
      id: qaProjectId,
      name: "区域发布资料库",
      slug: "regional-launch",
      description: "Launch review tasks, synced files, and meeting follow-ups in one GitHub-like project hub.",
      owner_nickname: "owner",
      archived: false,
      created_at: "2026-06-11T08:00:00.000Z",
      updated_at: "2026-06-11T09:00:00.000Z",
      open_work_item_count: 2
    },
    {
      id: "10000000-0000-4000-8000-000000001690",
      name: "新一代客服平台",
      slug: "next-support-platform",
      description: "Cross-team support automation backlog.",
      owner_nickname: "owner",
      archived: false,
      created_at: "2026-06-10T08:00:00.000Z",
      updated_at: "2026-06-10T09:00:00.000Z",
      open_work_item_count: 1
    }
  ];
  if (namedProjectCreated) {
    projects.unshift({
      id: qaCreatedProjectId,
      name: qaCreatedProjectName,
      slug: "r4-live-launch-notes",
      description: "Fresh project created through the project index smoke.",
      owner_nickname: "owner",
      archived: false,
      created_at: "2026-06-11T09:05:00.000Z",
      updated_at: "2026-06-11T09:05:00.000Z",
      open_work_item_count: 0
    });
  }
  return {
    generated_at: "2026-06-11T09:00:00.000Z",
    projects
  };
}

function projectHomePage(projectId = qaProjectId, projectName = "区域发布资料库"): ProjectHomePageVM {
  const isCreatedProject = projectId === qaCreatedProjectId;
  return {
    generated_at: "2026-06-11T09:24:00.000Z",
    project: {
      id: projectId,
      name: projectName,
      slug: "regional-launch",
      description: "Launch review tasks, synced files, and meeting follow-ups in one GitHub-like project hub.",
      owner_label: "owner",
      status: "active"
    },
    summary: {
      open_work_item_count: isCreatedProject ? 0 : 2,
      total_open_work_item_count: isCreatedProject ? 0 : 3
    },
    open_work_items: isCreatedProject ? [] : [
      {
        id: "r4-live-workitem",
        code: "RL-24",
        title: "Regional launch review",
        status: "in_progress",
        priority: "high",
        href: "/workitems/r4-live-workitem"
      },
      {
        id: meetingWorkItemId,
        code: "RL-25",
        title: "Meeting insight follow-up",
        status: "drafting",
        priority: "medium",
        href: `/workitems/${meetingWorkItemId}`
      }
    ],
    drive: {
      file_count: isCreatedProject ? 0 : 3,
      recent_files: isCreatedProject ? [] : [
        {
          id: qaDriveItemId,
          name: "regional-launch-review.md",
          updated_at: "2026-06-11T09:20:00.000Z",
          href: `/drive?project_id=${projectId}&item_id=${qaDriveItemId}`
        },
        {
          id: qaManualDriveItemId,
          name: qaDriveUploadFilename,
          updated_at: "2026-06-11T09:26:00.000Z",
          href: `/drive?project_id=${projectId}&item_id=${qaManualDriveItemId}`
        }
      ]
    },
    actions: {
      new_task: {
        id: "new_task",
        label: "New task",
        method: "GET",
        href: `/intake?project_id=${projectId}`
      },
      open_drive: {
        id: "open_drive",
        label: "Open drive",
        method: "GET",
        href: `/drive?project_id=${projectId}`
      }
    }
  };
}

function teamSkillsPage(): TeamSkillsPageVM {
  return {
    generated_at: "2026-06-16T02:00:00.000Z",
    skills: [
      {
        skill_key: "drive-comment-triage",
        name: "Drive comment triage",
        when_to_use: "Use when Drive comments need to become scoped work drafts with source context.",
        version: 1,
        source_kind: "authored",
        created_by_kind: "human",
        sample_count: 4,
        updated_at: "2026-06-15T12:00:00.000Z"
      },
      {
        skill_key: "proposal-review-synthesis",
        name: "Proposal review synthesis",
        when_to_use: "Use when a proposal needs evidence-backed review, conflict resolution, and approval notes.",
        version: 3,
        source_kind: "distilled",
        created_by_kind: "ai",
        confidence_score: 0.91,
        sample_count: 8,
        updated_at: "2026-06-16T02:00:00.000Z",
        provenance: {
          refined_from_version: 2,
          op_count: 2,
          rationale_md: "Refined from accepted pricing and timeline review runs."
        }
      }
    ],
    totals: {
      active: 2,
      ai_authored: 1,
      refined: 1
    }
  };
}

function calendarPage(locale: WorkHubLocale, view: "day" | "week" = "week", date = "2026-06-11"): CalendarPageVM {
  const rangeStart = view === "week" ? "2026-06-08T00:00:00.000Z" : `${date}T00:00:00.000Z`;
  const rangeEnd = view === "week" ? "2026-06-15T00:00:00.000Z" : "2026-06-12T00:00:00.000Z";
  const workBlock: CalendarPageVM["blocks"][number] = {
    id: "10000000-0000-4000-8000-000000001811",
    kind: "work_item_due",
    title: "Update proposal pricing model",
    description: "Create a draft update to the pricing section with tiered usage.",
    ends_at: "2026-06-11T15:00:00.000Z",
    all_day: true,
    status: "today",
    severity: "urgent",
    target_href: `/workitems/${meetingWorkItemId}`,
    project_id: meetingProjectId,
    work_item_id: meetingWorkItemId,
    source_context: {
      source_type: "work_item",
      work_item_id: meetingWorkItemId,
      code: "WH-R5-5",
      title: "Update proposal pricing model",
      status: "in_review",
      project_id: meetingProjectId,
      project_name: "区域发布资料库",
      due_at: "2026-06-11T15:00:00.000Z"
    }
  };
  const meetingBlock: CalendarPageVM["blocks"][number] = {
    id: "10000000-0000-4000-8000-000000001812",
    kind: "meeting_followup",
    title: "Review meeting insight draft",
    description: "Q2 Client Proposal Review",
    ends_at: "2026-06-12T09:00:00.000Z",
    all_day: true,
    status: "upcoming",
    severity: "high",
    target_href: `/meetings?project_id=${meetingProjectId}&m=${meetingId}&insight_id=${meetingInsightId}`,
    project_id: meetingProjectId,
    work_item_id: meetingWorkItemId,
    source_context: {
      source_type: "meeting_insight",
      meeting_id: meetingId,
      insight_id: meetingInsightId,
      title: "Update proposal pricing model",
      meeting_title: "Q2 Client Proposal Review",
      insight_status: "confirmed",
      project_id: meetingProjectId,
      project_name: "区域发布资料库"
    }
  };
  const blocks = [workBlock, meetingBlock];
  const days = (view === "week"
    ? ["2026-06-08", "2026-06-09", "2026-06-10", "2026-06-11", "2026-06-12", "2026-06-13", "2026-06-14"]
    : [date]
  ).map((day) => ({
    date: day,
    blocks: blocks.filter((block) => block.ends_at.startsWith(day))
  }));
  return {
    generated_at: "2026-06-11T09:49:00.000Z",
    actor_user_id: "r4-live-user",
    scope: { date, view, range_start: rangeStart, range_end: rangeEnd },
    summary: {
      block_count: blocks.length,
      overdue_count: 0,
      today_count: 1,
      week_count: blocks.length
    },
    days,
    blocks
  };
}

type DriveQaState = "initial" | "uploaded" | "deleted" | "restored";

function drivePage(
  surface: GoldPathSurfaceVM,
  state: DriveQaState = "initial",
  commentDraftCreated = false,
  driveDraftProposalCreated = false
): DrivePageVM {
  const accepted = surface.page_vms.replay.accepted_deliverables[0];
  const acceptedId = accepted?.id ?? "10000000-0000-4000-8000-000000001518";
  const workItemId = accepted?.work_item_id ?? "10000000-0000-4000-8000-000000001500";
  const proposalId = accepted?.proposal_id ?? surface.page_vms.proposal.proposal_id;
  const projectId = qaProjectId;
  const folderId = qaDriveFolderId;
  const itemId = qaDriveItemId;
  const versionId = "10000000-0000-4000-8000-000000001621";
  const manualItemId = qaManualDriveItemId;
  const manualVersionId = "10000000-0000-4000-8000-000000001625";
  const hasManualActive = state === "uploaded" || state === "restored";
  const hasManualDeleted = state === "deleted";
  const deliverable = {
    id: acceptedId,
    work_item_id: workItemId,
    proposal_id: proposalId,
    change_id: accepted?.change_id ?? "10000000-0000-4000-8000-000000001519",
    target_kind: accepted?.target_kind ?? "text_doc",
    target_key: accepted?.target_key ?? "drive:regional-launch-review",
    change_type: accepted?.change_type ?? "updated",
    accepted_version: accepted?.accepted_version ?? 2,
    target_path: accepted?.target_path ?? "docs/regional-launch-review.md",
    drive_item_id: itemId,
    drive_version_id: versionId,
    filename: accepted?.filename ?? "regional-launch-review.md",
    mime: accepted?.mime ?? "text/markdown",
    size_bytes: accepted?.size_bytes ?? 4200,
    sha256: accepted?.sha256 ?? "a".repeat(64),
    preview_href: accepted?.preview_href ?? `/api/workitems/${workItemId}/deliverables/${acceptedId}/preview`,
    download_href: accepted?.download_href ?? `/api/workitems/${workItemId}/deliverables/${acceptedId}/download`,
    restore_href: accepted?.restore_href ?? `/api/workitems/${workItemId}/deliverables/${acceptedId}/restore`,
    accepted_at: accepted?.accepted_at ?? "2026-06-11T09:20:00.000Z"
  };
  const manualVersion = {
    id: manualVersionId,
    item_id: manualItemId,
    version_no: 1,
    filename: qaDriveUploadFilename,
    mime: "text/markdown",
    size_bytes: 82,
    sha256: "c".repeat(64),
    created_at: "2026-06-11T09:26:00.000Z",
    current: true,
    source: "manual_upload" as const,
    preview_href: `/api/drive/projects/${projectId}/items/${manualItemId}/preview`,
    download_href: `/api/drive/projects/${projectId}/items/${manualItemId}/download`
  };
  const manualItem = {
    id: manualItemId,
    project_id: projectId,
    parent_id: folderId,
    name: qaDriveUploadFilename,
    kind: "file" as const,
    path: `/docs/${qaDriveUploadFilename}`,
    depth: 1,
    current_version_id: manualVersionId,
    current_version: manualVersion,
    children_count: 0,
    updated_at: state === "restored" ? "2026-06-11T09:28:00.000Z" : "2026-06-11T09:26:00.000Z"
  };
  const deletedManualItem = {
    ...manualItem,
    deleted_at: "2026-06-11T09:27:00.000Z",
    updated_at: "2026-06-11T09:27:00.000Z",
    // 对齐真实 drive VM（xreview-r2 F3 逐行还原）：回收站行自带 restore_href，
    // 渲染层只对带 href 的行渲「还原」按钮（data-action-id="drive_restore_item"）。
    restore_href: `/api/drive/projects/${projectId}/items/${manualItemId}/restore`
  };
  const operations = [
    {
      id: "10000000-0000-4000-8000-000000001626",
      project_id: projectId,
      op_type: "upload_file" as const,
      target_item_id: itemId,
      target_path: "/docs/regional-launch-review.md",
      summary_text: "Accepted deliverable linked into Drive",
      created_at: "2026-06-11T09:20:00.000Z"
    },
    ...(state === "initial" ? [] : [{
      id: "10000000-0000-4000-8000-000000001627",
      project_id: projectId,
      op_type: "upload_file" as const,
      target_item_id: manualItemId,
      target_path: `/docs/${qaDriveUploadFilename}`,
      summary_text: `Uploaded ${qaDriveUploadFilename}`,
      created_at: "2026-06-11T09:26:00.000Z"
    }]),
    ...(["deleted", "restored"].includes(state) ? [{
      id: "10000000-0000-4000-8000-000000001628",
      project_id: projectId,
      op_type: "delete_item" as const,
      target_item_id: manualItemId,
      target_path: `/docs/${qaDriveUploadFilename}`,
      summary_text: `Moved ${qaDriveUploadFilename} to recycle bin`,
      created_at: "2026-06-11T09:27:00.000Z"
    }] : []),
    ...(state === "restored" ? [{
      id: "10000000-0000-4000-8000-000000001629",
      project_id: projectId,
      op_type: "restore_item" as const,
      target_item_id: manualItemId,
      target_path: `/docs/${qaDriveUploadFilename}`,
      summary_text: `Restored ${qaDriveUploadFilename} from recycle bin`,
      created_at: "2026-06-11T09:28:00.000Z"
    }] : []),
    ...(commentDraftCreated ? [{
      id: "10000000-0000-4000-8000-000000001630",
      project_id: projectId,
      op_type: "comment_to_draft" as const,
      summary_text: "Created draft r4-live-workitem from Drive comment",
      created_at: "2026-06-11T09:29:00.000Z"
    }] : []),
    ...(driveDraftProposalCreated ? [{
      id: "10000000-0000-4000-8000-000000001633",
      project_id: projectId,
      op_type: "draft_to_proposal" as const,
      summary_text: `Created proposal ${driveDraftProposalId} from Drive draft`,
      created_at: "2026-06-11T09:30:00.000Z"
    }] : [])
  ];
  const items = [
    {
      id: folderId,
      project_id: projectId,
      name: "docs",
      kind: "folder" as const,
      path: "/docs",
      depth: 0,
      children_count: hasManualActive ? 2 : 1,
      updated_at: "2026-06-11T09:20:00.000Z"
    },
    {
      id: itemId,
      project_id: projectId,
      parent_id: folderId,
      name: "regional-launch-review.md",
      kind: "file" as const,
      path: "/docs/regional-launch-review.md",
      depth: 1,
      current_version_id: versionId,
      current_version: {
        id: versionId,
        item_id: itemId,
        version_no: 2,
        filename: "regional-launch-review.md",
        mime: "text/markdown",
        size_bytes: 4200,
        sha256: "a".repeat(64),
        created_at: "2026-06-11T09:20:00.000Z",
        current: true,
        source: "accepted_deliverable" as const,
        accepted_deliverable_id: acceptedId,
        work_item_id: workItemId,
        proposal_id: proposalId,
        preview_href: deliverable.preview_href,
        download_href: deliverable.download_href,
        restore_href: deliverable.restore_href
      },
      accepted_deliverable: deliverable,
      children_count: 0,
      updated_at: "2026-06-11T09:20:00.000Z"
    },
    ...(hasManualActive ? [manualItem] : [])
  ];
  const deletedItems = hasManualDeleted ? [deletedManualItem] : [];
  const versions = [
    {
      id: versionId,
      item_id: itemId,
      version_no: 2,
      filename: "regional-launch-review.md",
      mime: "text/markdown",
      size_bytes: 4200,
      sha256: "a".repeat(64),
      created_at: "2026-06-11T09:20:00.000Z",
      current: true,
      source: "accepted_deliverable" as const,
      accepted_deliverable_id: acceptedId,
      work_item_id: workItemId,
      proposal_id: proposalId,
      preview_href: deliverable.preview_href,
      download_href: deliverable.download_href,
      restore_href: deliverable.restore_href
    },
    {
      id: "10000000-0000-4000-8000-000000001622",
      item_id: itemId,
      version_no: 1,
      filename: "regional-launch-review.md",
      mime: "text/markdown",
      size_bytes: 3180,
      sha256: "b".repeat(64),
      created_at: "2026-06-11T08:30:00.000Z",
      current: false,
      source: "manual_upload" as const
    },
    ...(state === "initial" ? [] : [manualVersion])
  ];
  return {
    generated_at: "2026-06-11T09:24:00.000Z",
    project: {
      id: projectId,
      name: "区域发布资料库",
      slug: "regional-launch",
      owner_label: "owner",
      status: "active"
    },
    summary: {
      item_count: items.length,
      file_count: items.filter((item) => item.kind === "file").length,
      folder_count: 1,
      deleted_item_count: deletedItems.length,
      version_count: versions.length,
      accepted_deliverable_count: 1,
      pending_comment_count: commentDraftCreated ? 0 : 1,
      operation_count: operations.length
    },
    can_manage: true,
    selected_item_id: hasManualActive ? manualItemId : itemId,
    items,
    deleted_items: deletedItems,
    versions,
    accepted_deliverables: [deliverable],
    comments: [
      {
        id: "10000000-0000-4000-8000-000000001623",
        project_id: "10000000-0000-4000-8000-000000001600",
        folder_id: "10000000-0000-4000-8000-000000001619",
        folder_path: "/docs",
        author_label: "PM",
        body: "把这个版本差异整理成下一轮复盘行动。",
        status: driveDraftProposalCreated ? "proposal_created" : commentDraftCreated ? "draft_created" : "pending_llm",
        created_at: "2026-06-11T09:22:00.000Z",
        ...(commentDraftCreated ? {
          draft_work_item_id: "r4-live-workitem",
          draft_href: "/workitems/r4-live-workitem",
          ...(driveDraftProposalCreated ? {
            proposal_id: driveDraftProposalId,
            proposal_href: `/proposals/${driveDraftProposalId}`,
            proposal_status: "opened"
          } : {})
        } : {
          draft_action: {
            id: "drive_comment_to_draft",
            label: "Create draft",
            method: "POST" as const,
            href: `/api/drive/projects/${projectId}/comments/10000000-0000-4000-8000-000000001623/draft`
          }
        })
      }
    ],
    operations,
    actions: {
      upload_file: {
        id: "upload_file",
        label: "Upload file",
        method: "POST",
        href: `/api/drive/projects/${projectId}/files`
      },
      ...(hasManualActive ? {
        delete_item: {
          id: "delete_item",
          label: "Delete file",
          method: "POST" as const,
          href: `/api/drive/projects/${projectId}/items/${manualItemId}/delete`
        }
      } : {}),
      ...(hasManualDeleted ? {
        restore_item: {
          id: "restore_item",
          label: "Restore file",
          method: "POST" as const,
          href: `/api/drive/projects/${projectId}/items/${manualItemId}/restore`
        }
      } : {}),
      ...(!commentDraftCreated ? {
        comment_to_draft: {
          id: "drive_comment_to_draft",
          label: "Create draft",
          method: "POST" as const,
          href: `/api/drive/projects/${projectId}/comments/10000000-0000-4000-8000-000000001623/draft`
        }
      } : {})
    }
  };
}

function r4LiveSession(stage: "scope" | "confirm", surface: GoldPathSurfaceVM, locale: WorkHubLocale): SessionVM {
  const sessionId = "10000000-0000-4000-8000-000000001414";
  const workItemId = "r4-live-workitem";
  const english = locale === "en-US";
  return {
    session_id: sessionId,
    work_item_id: workItemId,
    topic: english
      ? stage === "confirm" ? "Confirm regional launch review" : "Scope regional launch review"
      : stage === "confirm" ? "确认区域发布复盘包" : "整理区域发布复盘包",
    stream_href: `/api/push/stream/session/${sessionId}`,
    next_question_href: `/api/sessions/${sessionId}/next-question`,
    question: {
      id: stage === "confirm" ? "10000000-0000-4000-8000-000000001416" : "10000000-0000-4000-8000-000000001415",
      session_id: sessionId,
      work_item_id: workItemId,
      title: english
        ? stage === "confirm" ? "Create this work item?" : "Which direction should this review take first?"
        : stage === "confirm" ? "确认创建这个工作项？" : "这次复盘先按哪个方向推进？",
      body: english
        ? stage === "confirm" ? "Confirming creates a structured work item." : "Choose one direction first; add text only if needed."
        : stage === "confirm" ? "确认后会创建结构化工作项。" : "先选一个方向，必要时再补充一句。",
      input_mode: stage === "confirm" ? "confirm" : "single_choice",
      options: stage === "confirm"
        ? [
          {
            id: "create-worker",
            label: english ? "Create and prepare AI run" : "创建并进入 AI 执行",
            description: english ? "Create the work item and prepare the next execution." : "生成工作项并准备后续执行。"
          },
          {
            id: "keep-scoping",
            label: english ? "Keep clarifying" : "继续澄清",
            description: english ? "Collect one more constraint." : "再收集一个约束。"
          }
        ]
        : [
          {
            id: "risk-first",
            label: english ? "Risk first" : "先看风险",
            description: english ? "Focus on blockers, delays, and abnormal regions." : "聚焦阻塞、延期和异常区域。"
          },
          {
            id: "metric-first",
            label: english ? "Metrics first" : "先看指标",
            description: english ? "Focus on attainment and trend." : "聚焦达成率与趋势。"
          }
        ],
      recommended_option_ids: stage === "confirm" ? ["create-worker"] : ["risk-first"],
      free_text: {
        enabled: true,
        collapsed_by_default: true,
        placeholder: english ? "Add one sentence only when options are not enough." : "选项不够时再补充一句。",
        max_length: 120
      },
      progress: [
        { key: "intent", label: english ? "Intent" : "意图", state: "done" },
        { key: "scope", label: english ? "Scope" : "范围", state: stage === "confirm" ? "done" : "active" },
        { key: "confirm", label: english ? "Confirm" : "确认", state: stage === "confirm" ? "active" : "pending" }
      ],
      evidence_refs: surface.page_vms.workitem.evidence_refs.slice(0, 1),
      submit: { method: "POST", href: `/api/sessions/${sessionId}/next-question` }
    }
  };
}

function r4LiveEvidence(locale: WorkHubLocale): EvidenceBubble {
  const english = locale === "en-US";
  return {
    id: "10000000-0000-4000-8000-000000001424",
    query_text: "regional",
    summary_text: english
      ? "Cited regional launch review evidence is available; missing CRM detail is marked explicitly."
      : "找到可引用的区域发布复盘证据，未命中的 CRM 明细会明确标注为缺失。",
    missing_evidence_note: english ? "CRM source detail is missing; no conclusion is invented." : "CRM 原始明细暂缺，不会编造结论。",
    evidence_refs: [
      {
        id: "10000000-0000-4000-8000-000000001425",
        source_type: "meeting",
        source_id: "regional-sync",
        title: english ? "Regional launch sync" : "区域发布同步会",
        excerpt: english ? "Supply delay is the blocker that needs the closest follow-up." : "供应延迟是本周最需要跟进的阻塞。",
        href: "/knowledge/sources/regional-sync"
      },
      {
        id: "10000000-0000-4000-8000-000000001426",
        source_type: "drive_file",
        source_id: "drive:regional-launch-review",
        title: english ? "Regional launch review draft" : "区域发布复盘草稿",
        excerpt: english ? "The draft records metrics, risks, and next actions." : "草稿记录了指标、风险与下一步行动。",
        href: "/knowledge/sources/regional-launch-review"
      }
    ],
    actions: [
      {
        id: "use_for_current_task",
        label: english ? "Use for current task" : "用于当前任务",
        method: "POST",
        href: "/api/workitems/r4-live-workitem/evidence-bindings"
      },
      { id: "open_full_search", label: english ? "Open full search" : "打开完整检索", method: "GET", href: "/knowledge/search?q=regional" }
    ]
  };
}

function proposalConflictsFromSurface(surface: GoldPathSurfaceVM) {
  return ((surface as GoldPathSurfaceVM & { proposal_conflicts?: ProposalConflict[] }).proposal_conflicts ?? []);
}

function identity(locale: WorkHubLocale, nickname = "R4 Live Reviewer") {
  return {
    id: "r4-live-user",
    nickname,
    display_name: nickname,
    created: false,
    locale,
    preferences: { locale },
    is_admin: nickname === "R4 Live Reviewer",
    availability_status: "available"
  };
}

// 簇A 后:approvals/cost/notifications 等内容页空态不再塌成通用空卡(改在外壳内渲染各自空态)。
// 仍合法塌成 "empty" 通用态的是「缺上下文」类:网盘无项目(no_project)、详情 404。用网盘 no_project 作 "empty" 态的代表探针。
function isEmptyDriveProbe(request: IncomingMessage) {
  const referer = request.headers.referer;
  return typeof referer === "string" && referer.includes("empty=drive");
}

async function requestBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function sendJson(response: ServerResponse, status: number, payload: unknown) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(JSON.stringify(payload));
}

function sendApiError(response: ServerResponse, status: number, code: string, message: string) {
  sendJson(response, status, {
    ok: false,
    error: { code, message }
  });
}

function createMockApiServer(surface: GoldPathSurfaceVM, requestLog: ApiRequestRecord[]) {
  let currentLocale: WorkHubLocale = "zh-CN";
  let identifiedNickname: string | null = null;
  let sessionStage: "scope" | "confirm" = "scope";
  let driveQaState: DriveQaState = "initial";
  let driveCommentDraftCreated = false;
  let driveDraftProposalCreated = false;
  let namedProjectCreated = false;
  let meetingInsightDraftCreated = false;
  let meetingDraftProposalCreated = false;
  let meetingInsightDismissed = false;
  let notificationMeetingRead = false;
  let notificationDriveRead = false;
  let notificationMeetingDone = false;
  let notificationDriveDone = false;
  let failNextPreferencePatch = false;
  let sseEventSeq = 0;
  const sseClients = new Map<ServerResponse, string>();
  const sseStreamKey = (pathname: string) => {
    if (pathname === "/api/push/stream") {
      return "all";
    }
    if (pathname === "/api/push/stream/me") {
      return "me";
    }
    const match = /^\/api\/push\/stream\/([^/]+)/u.exec(pathname);
    return match?.[1] ?? "unknown";
  };
  const writeSseEvent = (response: ServerResponse, event: string, payload: Record<string, unknown>, id?: string) => {
    if (id) {
      response.write(`id: ${id}\n`);
    }
    response.write(`event: ${event}\n`);
    response.write(`data: ${JSON.stringify(payload)}\n\n`);
  };
  const server = createHttpServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const requestRecord: ApiRequestRecord = {
      method: request.method ?? "GET",
      pathname: url.pathname,
      search: url.search,
      locale: url.searchParams.get("locale"),
      referer: typeof request.headers.referer === "string" ? request.headers.referer : null,
      body: null
    };
    requestLog.push(requestRecord);

    if (request.method === "GET" && (url.pathname === "/api/push/stream" || url.pathname.startsWith("/api/push/stream/"))) {
      const streamKey = sseStreamKey(url.pathname);
      response.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-store, no-transform",
        connection: "keep-alive"
      });
      writeSseEvent(response, "connected", {
        stream: streamKey,
        last_event_id: url.searchParams.get("last_event_id") ?? undefined,
        resume_mode: url.searchParams.has("last_event_id") ? "reconcile" : "fresh"
      });
      sseClients.set(response, streamKey);
      request.on("close", () => {
        sseClients.delete(response);
      });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/__qa/emit") {
      const event = url.searchParams.get("event") ?? "proposal.merged";
      const stream = url.searchParams.get("stream") ?? "proposal";
      let emitted = 0;
      for (const [client, streamKey] of Array.from(sseClients.entries())) {
        if (streamKey !== stream) {
          continue;
        }
        sseEventSeq += 1;
        const eventId = `evt_r4_20_${sseEventSeq}`;
        writeSseEvent(client, event, { stream, event_type: event, source: "r4-smoke", event_id: eventId }, eventId);
        emitted += 1;
      }
      sendJson(response, 200, { ok: true, event, stream, emitted });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/__qa/fail-next-preference-patch") {
      failNextPreferencePatch = true;
      sendJson(response, 200, { ok: true });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/auth/me") {
      if (!identifiedNickname) {
        sendJson(response, 200, null);
        return;
      }
      sendJson(response, 200, identity(currentLocale, identifiedNickname));
      return;
    }
    if (request.method === "PATCH" && url.pathname === "/api/auth/preferences") {
      requestRecord.body = await requestBody(request);
      if (failNextPreferencePatch) {
        failNextPreferencePatch = false;
        sendApiError(response, 503, "preference_unavailable", "Locale preference is temporarily unavailable.");
        return;
      }
      const body = JSON.parse(requestRecord.body || "{}") as { locale?: WorkHubLocale };
      currentLocale = body.locale === "en-US" ? "en-US" : "zh-CN";
      sendJson(response, 200, identity(currentLocale));
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/auth/identify") {
      requestRecord.body = await requestBody(request);
      const body = JSON.parse(requestRecord.body || "{}") as { nickname?: string };
      identifiedNickname = body.nickname?.trim() || "R4 Live Reviewer";
      sendJson(response, 200, { ...identity(currentLocale, identifiedNickname), created: true });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/auth/logout") {
      identifiedNickname = null;
      sendJson(response, 200, { ok: true });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/pages/attention") {
      sendJson(response, 200, surface.page_vms.attention);
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/pages/approvals") {
      sendJson(response, 200, surface.page_vms.approvals);
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/pages/cost") {
      sendJson(response, 200, surface.page_vms.cost);
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/pages/agents") {
      sendJson(response, 200, agentArmyDashboardVm());
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/pages/skills") {
      sendJson(response, 200, teamSkillsPage());
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/pages/settings") {
      sendJson(response, 200, settingsPage(currentLocale));
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/pages/drive") {
      if (isEmptyDriveProbe(request)) {
        // 网盘无项目上下文 → 服务端返回 empty_state=no_project,加载器收口成通用 "empty" 态(引导去 /projects)。
        sendJson(response, 200, { ...drivePage(surface, driveQaState, driveCommentDraftCreated, driveDraftProposalCreated), empty_state: "no_project" });
        return;
      }
      sendJson(response, 200, drivePage(surface, driveQaState, driveCommentDraftCreated, driveDraftProposalCreated));
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/projects") {
      // 网盘是 GitHub 式核心:面板内项目切换器需要全量项目清单。首条与 drivePage().project 同 id(当前高亮),次条提供切换目标。
      sendJson(response, 200, projectListPage(namedProjectCreated));
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/projects/bootstrap") {
      requestRecord.body = await requestBody(request);
      const body = JSON.parse(requestRecord.body || "{}") as { name?: string; description?: string };
      namedProjectCreated = true;
      sendJson(response, 200, {
        project: {
          id: qaCreatedProjectId,
          name: body.name?.trim() || qaCreatedProjectName,
          slug: "r4-live-launch-notes",
          description: body.description ?? "Fresh project created through the project index smoke.",
          owner_nickname: "owner"
        },
        created: true,
        context_ready: true
      });
      return;
    }
    const projectHomeMatch = /^\/api\/pages\/project\/([^/]+)$/u.exec(url.pathname);
    if (request.method === "GET" && projectHomeMatch?.[1]) {
      if (projectHomeMatch[1] !== qaProjectId && projectHomeMatch[1] !== meetingProjectId && projectHomeMatch[1] !== qaCreatedProjectId) {
        sendApiError(response, 404, "project_not_found", "Project not found.");
        return;
      }
      sendJson(response, 200, projectHomePage(
        projectHomeMatch[1],
        projectHomeMatch[1] === qaCreatedProjectId ? qaCreatedProjectName : "区域发布资料库"
      ));
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/pages/meetings") {
      sendJson(response, 200, meetingPage(meetingInsightDraftCreated, meetingDraftProposalCreated, meetingInsightDismissed));
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/pages/notifications") {
      sendJson(response, 200, notificationPage(currentLocale, {
        meetingRead: notificationMeetingRead,
        driveRead: notificationDriveRead,
        meetingDone: notificationMeetingDone,
        driveDone: notificationDriveDone
      }));
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/pages/health") {
      sendJson(response, 200, projectHealthPage(currentLocale));
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/pages/calendar") {
      const view = url.searchParams.get("view") === "day" ? "day" : "week";
      const date = url.searchParams.get("date") ?? "2026-06-11";
      sendJson(response, 200, calendarPage(currentLocale, view, date));
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/notifications/read-all") {
      notificationMeetingRead = true;
      notificationDriveRead = true;
      sendJson(response, 200, { ok: true, data: { updated: 2 }, meta: { locale: currentLocale } });
      return;
    }
    const notificationReadMatch = /^\/api\/notifications\/([^/]+)\/read$/u.exec(url.pathname);
    if (request.method === "POST" && notificationReadMatch?.[1]) {
      const id = notificationReadMatch[1];
      if (id === notificationMeetingId) {
        notificationMeetingRead = true;
        sendJson(response, 200, { ok: true, data: notificationActionResponse(id, { read: notificationMeetingRead, done: notificationMeetingDone }), meta: { locale: currentLocale } });
        return;
      }
      if (id === notificationDriveId) {
        notificationDriveRead = true;
        sendJson(response, 200, { ok: true, data: notificationActionResponse(id, { read: notificationDriveRead, done: notificationDriveDone }), meta: { locale: currentLocale } });
        return;
      }
    }
    const notificationDismissMatch = /^\/api\/notifications\/([^/]+)\/dismiss$/u.exec(url.pathname);
    if (request.method === "POST" && notificationDismissMatch?.[1]) {
      const id = notificationDismissMatch[1];
      if (id === notificationMeetingId) {
        notificationMeetingRead = true;
        notificationMeetingDone = true;
        sendJson(response, 200, { ok: true, data: notificationActionResponse(id, { read: notificationMeetingRead, done: notificationMeetingDone }), meta: { locale: currentLocale } });
        return;
      }
      if (id === notificationDriveId) {
        notificationDriveRead = true;
        notificationDriveDone = true;
        sendJson(response, 200, { ok: true, data: notificationActionResponse(id, { read: notificationDriveRead, done: notificationDriveDone }), meta: { locale: currentLocale } });
        return;
      }
    }
    const notificationCompleteMatch = /^\/api\/notifications\/([^/]+)\/complete$/u.exec(url.pathname);
    if (request.method === "POST" && notificationCompleteMatch?.[1]) {
      const id = notificationCompleteMatch[1];
      if (id === notificationMeetingId) {
        notificationMeetingRead = true;
        notificationMeetingDone = true;
        sendJson(response, 200, { ok: true, data: notificationActionResponse(id, { read: notificationMeetingRead, done: notificationMeetingDone }), meta: { locale: currentLocale } });
        return;
      }
      if (id === notificationDriveId) {
        notificationDriveRead = true;
        notificationDriveDone = true;
        sendJson(response, 200, { ok: true, data: notificationActionResponse(id, { read: notificationDriveRead, done: notificationDriveDone }), meta: { locale: currentLocale } });
        return;
      }
    }
    const driveUploadMatch = /^\/api\/drive\/projects\/([^/]+)\/files$/u.exec(url.pathname);
    if (request.method === "POST" && driveUploadMatch?.[1]) {
      requestRecord.body = await requestBody(request);
      driveQaState = "uploaded";
      sendJson(response, 200, { ok: true, data: drivePage(surface, driveQaState, driveCommentDraftCreated, driveDraftProposalCreated), meta: { locale: currentLocale } });
      return;
    }
    const driveCommentDraftMatch = /^\/api\/drive\/projects\/([^/]+)\/comments\/([^/]+)\/draft$/u.exec(url.pathname);
    if (request.method === "POST" && driveCommentDraftMatch?.[1] && driveCommentDraftMatch?.[2]) {
      requestRecord.body = await requestBody(request);
      driveCommentDraftCreated = true;
      sendJson(response, 200, { ok: true, data: drivePage(surface, driveQaState, driveCommentDraftCreated, driveDraftProposalCreated), meta: { locale: currentLocale } });
      return;
    }
    const driveDraftProposalMatch = /^\/api\/drive\/workitems\/([^/]+)\/proposal-draft$/u.exec(url.pathname);
    if (request.method === "POST" && driveDraftProposalMatch?.[1]) {
      requestRecord.body = await requestBody(request);
      driveCommentDraftCreated = true;
      driveDraftProposalCreated = true;
      sendJson(response, 200, { ok: true, data: qaWorkItemDetail(surface, driveCommentDraftCreated, driveDraftProposalCreated), meta: { locale: currentLocale } });
      return;
    }
    const driveDeleteMatch = /^\/api\/drive\/projects\/([^/]+)\/items\/([^/]+)\/delete$/u.exec(url.pathname);
    if (request.method === "POST" && driveDeleteMatch?.[1] && driveDeleteMatch?.[2]) {
      requestRecord.body = await requestBody(request);
      if (!requestRecord.body.includes("10000000-0000-4000-8000-000000001625")) {
        sendApiError(response, 409, "drive_current_version_changed", "Drive item version changed.");
        return;
      }
      driveQaState = "deleted";
      sendJson(response, 200, { ok: true, data: drivePage(surface, driveQaState, driveCommentDraftCreated, driveDraftProposalCreated), meta: { locale: currentLocale } });
      return;
    }
    const driveRestoreMatch = /^\/api\/drive\/projects\/([^/]+)\/items\/([^/]+)\/restore$/u.exec(url.pathname);
    if (request.method === "POST" && driveRestoreMatch?.[1] && driveRestoreMatch?.[2]) {
      requestRecord.body = await requestBody(request);
      driveQaState = "restored";
      sendJson(response, 200, { ok: true, data: drivePage(surface, driveQaState, driveCommentDraftCreated, driveDraftProposalCreated), meta: { locale: currentLocale } });
      return;
    }
    const meetingInsightDraftMatch = /^\/api\/meetings\/projects\/([^/]+)\/insights\/([^/]+)\/draft$/u.exec(url.pathname);
    if (request.method === "POST" && meetingInsightDraftMatch?.[1] && meetingInsightDraftMatch?.[2]) {
      requestRecord.body = await requestBody(request);
      meetingInsightDismissed = false;
      meetingInsightDraftCreated = true;
      sendJson(response, 200, { ok: true, data: meetingPage(meetingInsightDraftCreated, meetingDraftProposalCreated, meetingInsightDismissed), meta: { locale: currentLocale } });
      return;
    }
    const meetingInsightDismissMatch = /^\/api\/meetings\/projects\/([^/]+)\/insights\/([^/]+)\/dismiss$/u.exec(url.pathname);
    if (request.method === "POST" && meetingInsightDismissMatch?.[1] && meetingInsightDismissMatch?.[2]) {
      requestRecord.body = await requestBody(request);
      meetingInsightDismissed = true;
      meetingInsightDraftCreated = false;
      meetingDraftProposalCreated = false;
      sendJson(response, 200, { ok: true, data: meetingPage(meetingInsightDraftCreated, meetingDraftProposalCreated, meetingInsightDismissed), meta: { locale: currentLocale } });
      return;
    }
    const meetingDraftProposalMatch = /^\/api\/meetings\/workitems\/([^/]+)\/proposal-draft$/u.exec(url.pathname);
    if (request.method === "POST" && meetingDraftProposalMatch?.[1]) {
      requestRecord.body = await requestBody(request);
      meetingInsightDismissed = false;
      meetingInsightDraftCreated = true;
      meetingDraftProposalCreated = true;
      sendJson(response, 200, { ok: true, data: qaMeetingWorkItemDetail(surface, meetingDraftProposalCreated), meta: { locale: currentLocale } });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/pages/gold-path") {
      sendJson(response, 200, surface);
      return;
    }
    const sessionMatch = /^\/api\/sessions\/([^/]+)$/u.exec(url.pathname);
    if (request.method === "GET" && sessionMatch?.[1]) {
      sendJson(response, 200, r4LiveSession(sessionStage, surface, currentLocale));
      return;
    }
    const nextQuestionMatch = /^\/api\/sessions\/([^/]+)\/next-question$/u.exec(url.pathname);
    if (request.method === "POST" && nextQuestionMatch?.[1]) {
      requestRecord.body = await requestBody(request);
      sessionStage = "confirm";
      sendJson(response, 200, r4LiveSession(sessionStage, surface, currentLocale));
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/workitems") {
      requestRecord.body = await requestBody(request);
      sendJson(response, 200, qaWorkItemDetail(surface, driveCommentDraftCreated, driveDraftProposalCreated));
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/knowledge/search") {
      requestRecord.body = await requestBody(request);
      sendJson(response, 200, r4LiveEvidence(currentLocale));
      return;
    }
    const approvalRespondMatch = /^\/api\/approvals\/([^/]+)\/respond$/u.exec(url.pathname);
    if (request.method === "POST" && approvalRespondMatch?.[1]) {
      requestRecord.body = await requestBody(request);
      const body = JSON.parse(requestRecord.body || "{}") as { decision?: string };
      sendJson(response, 200, {
        approval: { id: approvalRespondMatch[1], status: body.decision === "deny" ? "denied" : "allowed" },
        attention: {
          summary_text: currentLocale === "en-US"
            ? body.decision === "deny"
              ? "Approval sent back to AI with your reason."
              : "Approval recorded. AI can continue."
            : body.decision === "deny"
              ? "已带着原因打回审批。"
              : "已记录审批，AI 可以继续。"
        }
      });
      return;
    }
    const workItemMatch = /^\/api\/pages\/workitems\/([^/]+)$/u.exec(url.pathname);
    if (request.method === "GET" && workItemMatch?.[1]) {
      if (workItemMatch[1] === "r4-live-forbidden") {
        sendApiError(response, 403, "forbidden", "Needs owner approval");
        return;
      }
      if (workItemMatch[1] === meetingWorkItemId) {
        sendJson(response, 200, qaMeetingWorkItemDetail(surface, meetingDraftProposalCreated));
        return;
      }
      sendJson(response, 200, qaWorkItemDetail(surface, driveCommentDraftCreated, driveDraftProposalCreated));
      return;
    }
    const evidenceBindingMatch = /^\/api\/workitems\/([^/]+)\/evidence-bindings$/u.exec(url.pathname);
    if (request.method === "POST" && evidenceBindingMatch?.[1]) {
      requestRecord.body = await requestBody(request);
      sendJson(response, 200, qaWorkItemDetail(surface, driveCommentDraftCreated, driveDraftProposalCreated));
      return;
    }
    const acceptedDeliverableRestoreMatch = /^\/api\/workitems\/([^/]+)\/deliverables\/([^/]+)\/restore$/u.exec(url.pathname);
    if (request.method === "POST" && acceptedDeliverableRestoreMatch?.[1] && acceptedDeliverableRestoreMatch[2]) {
      requestRecord.body = await requestBody(request);
      const acceptedDeliverable = surface.page_vms.replay.accepted_deliverables.find((item) => item.id === acceptedDeliverableRestoreMatch[2])
        ?? surface.page_vms.replay.accepted_deliverables[0];
      sendJson(response, 200, {
        accepted_deliverable: acceptedDeliverable
      });
      return;
    }
    const conflictsMatch = /^\/api\/workitems\/([^/]+)\/conflicts$/u.exec(url.pathname);
    if (request.method === "GET" && conflictsMatch?.[1]) {
      const conflicts = proposalConflictsFromSurface(surface).filter((conflict) => conflict.work_item_id === conflictsMatch[1]);
      sendJson(response, 200, {
        conflicts,
        ...(conflicts.length === 0 ? { empty_state: "no_conflicts" } : {})
      });
      return;
    }
    const proposalMatch = /^\/api\/pages\/proposals\/([^/]+)$/u.exec(url.pathname);
    if (request.method === "GET" && proposalMatch?.[1]) {
      if (proposalMatch[1] === "r4-live-missing") {
        sendApiError(response, 404, "not_found", "Proposal not found");
        return;
      }
      sendJson(response, 200, surface.page_vms.proposal);
      return;
    }
    const proposalReviewMatch = /^\/api\/proposals\/([^/]+)\/review$/u.exec(url.pathname);
    if (request.method === "POST" && proposalReviewMatch?.[1]) {
      requestRecord.body = await requestBody(request);
      // 对齐真实 API（routes/proposals.ts）：approve 的响应携带 next_action=merge，
      // web 端 M11/L17 两段流靠它把动作行原地换成「采纳到正式版」——merge 按钮只在确认后出现。
      const reviewDecision = (() => {
        try {
          return (JSON.parse(requestRecord.body ?? "{}") as { decision?: string }).decision;
        } catch {
          return undefined;
        }
      })();
      if (reviewDecision === "approve") {
        sendJson(response, 200, {
          attention: {
            summary_text: currentLocale === "en-US"
              ? "Confirmed. You can now accept it into the official version."
              : "已确认。接下来可以采纳到正式版本。"
          },
          next_action: {
            id: "merge",
            label: currentLocale === "en-US" ? "Accept into official version" : "采纳到正式版",
            method: "POST",
            href: `/api/proposals/${proposalReviewMatch[1]}/merge`
          }
        });
        return;
      }
      sendJson(response, 200, {
        attention: {
          summary_text: currentLocale === "en-US"
            ? "Change request sent back to AI with your reason."
            : "已带着原因打回给 AI。"
        }
      });
      return;
    }
    const proposalMergeMatch = /^\/api\/proposals\/([^/]+)\/merge$/u.exec(url.pathname);
    if (request.method === "POST" && proposalMergeMatch?.[1]) {
      requestRecord.body = await requestBody(request);
      sendJson(response, 200, {
        attention: {
          summary_text: currentLocale === "en-US"
            ? "Accepted into the official version."
            : "已合入正式版本。"
        }
      });
      return;
    }
    const mergeApplyMatch = /^\/api\/merge-proposals\/([^/]+)\/apply$/u.exec(url.pathname);
    if (request.method === "POST" && mergeApplyMatch?.[1]) {
      requestRecord.body = await requestBody(request);
      sendJson(response, 200, {
        merge_proposal_id: mergeApplyMatch[1],
        attention: {
          summary_text: currentLocale === "en-US"
            ? "Advanced AI fusion choices applied."
            : "已应用高级 AI 融合选择。"
        }
      });
      return;
    }
    const replayMatch = /^\/api\/agent-runs\/([^/]+)\/replay$/u.exec(url.pathname);
    if (request.method === "GET" && replayMatch?.[1]) {
      sendJson(response, 200, surface.page_vms.replay);
      return;
    }
    sendApiError(response, 404, "not_found", `Unhandled R4 live mock endpoint: ${url.pathname}`);
  });
  return server;
}

async function listen(server: ReturnType<typeof createHttpServer>) {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Server did not expose a TCP port.");
  }
  return (address as AddressInfo).port;
}

async function closeServer(server: ReturnType<typeof createHttpServer>) {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

async function removeBestEffort(target: string) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await rm(target, { recursive: true, force: true });
      return;
    } catch (error) {
      if (attempt === 4) {
        console.warn(`warning: could not remove ${target}: ${error instanceof Error ? error.message : String(error)}`);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 180));
    }
  }
}

async function stopChrome(child: ChildProcessWithoutNullStreams | undefined) {
  if (!child || child.exitCode !== null) {
    return;
  }
  child.kill();
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 1200);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function freePort() {
  const server = createHttpServer();
  const port = await listen(server);
  await closeServer(server);
  return port;
}

function chromeCandidates() {
  return [
    process.env["CHROME_PATH"],
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser"
  ].filter((candidate): candidate is string => Boolean(candidate));
}

function findChrome() {
  return chromeCandidates().find((candidate) => existsSync(candidate));
}

async function setViewport(cdp: CdpClient, viewport: Viewport) {
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: 1,
    mobile: viewport.width <= 520
  });
}

async function waitFor<T>(
  cdp: CdpClient,
  label: string,
  expression: string,
  predicate: (value: T) => boolean,
  timeoutMs = 15_000
) {
  const deadline = Date.now() + timeoutMs;
  let lastValue: T | undefined;
  while (Date.now() < deadline) {
    lastValue = await cdp.evaluate<T>(expression);
    if (predicate(lastValue)) {
      return lastValue;
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  const diagnostic = await cdp.evaluate<string>(`(() => JSON.stringify({
    href: location.href,
    readyState: document.readyState,
    title: document.title,
    body: document.body?.innerText?.slice(0, 500) ?? "",
    rootHtml: document.getElementById("root")?.innerHTML.slice(0, 800) ?? ""
  }))()`).catch((error: unknown) => `diagnostic_failed:${error instanceof Error ? error.message : String(error)}`);
  throw new Error(`Timed out waiting for ${label}; last value=${JSON.stringify(lastValue)}; diagnostic=${diagnostic}`);
}

function routeStatusProbeExpression() {
  return `(() => ({
    status: document.querySelector('[data-r4-web-route-status]')?.getAttribute('data-r4-web-route-status') || '',
    body: document.body?.innerText?.slice(0, 500) ?? '',
    rootHtml: document.getElementById("root")?.innerHTML.slice(0, 800) ?? ''
  }))()`;
}

function isTransientRouteTransportFailure(value: RouteStatusProbe) {
  return value.status === "error" && value.body.includes("Failed to fetch");
}

async function navigate(cdp: CdpClient, url: string, expectedStatus: string) {
  let lastProbe: RouteStatusProbe | undefined;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await cdp.send("Page.navigate", { url });
    const probe = await waitFor<RouteStatusProbe>(
      cdp,
      `${url} -> ${expectedStatus}`,
      routeStatusProbeExpression(),
      (value) => value.status === expectedStatus || isTransientRouteTransportFailure(value),
      30_000
    );
    if (probe.status === expectedStatus) {
      return;
    }
    lastProbe = probe;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`Timed out waiting for ${url} -> ${expectedStatus}; last value=${JSON.stringify(lastProbe)}`);
}

async function clickAndWait(cdp: CdpClient, selector: string, pathname: string, expectedStatus = "ready") {
  const clicked = await cdp.evaluate<boolean>(`(() => {
    const target = document.querySelector(${JSON.stringify(selector)});
    if (!target) return false;
    target.click();
    return true;
  })()`);
  if (!clicked) {
    throw new Error(`Could not click selector: ${selector}`);
  }
  await waitFor<{ pathname: string; status: string }>(
    cdp,
    `${selector} -> ${pathname}`,
    "(() => ({ pathname: location.pathname, status: document.querySelector('[data-r4-web-route-status]')?.getAttribute('data-r4-web-route-status') || '' }))()",
    (value) => value.pathname === pathname && value.status === expectedStatus
  );
}

async function clickSelector(cdp: CdpClient, selector: string) {
  const clicked = await cdp.evaluate<boolean>(`(() => {
    const target = document.querySelector(${JSON.stringify(selector)});
    if (!target) return false;
    target.click();
    return true;
  })()`);
  if (!clicked) {
    throw new Error(`Could not click selector: ${selector}`);
  }
  await new Promise((resolve) => setTimeout(resolve, 160));
}

async function fillTextInput(cdp: CdpClient, selector: string, value: string) {
  const filled = await cdp.evaluate<boolean>(`(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    if (!(input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement)) return false;
    input.value = ${JSON.stringify(value)};
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
  if (!filled) {
    throw new Error(`Could not fill text input: ${selector}`);
  }
}

async function clickAndWaitForNotice(cdp: CdpClient, selector: string, kind: string, actionId?: string) {
  let previousNoticeSeq = await cdp.evaluate<number>(`(() => {
    const notice = document.querySelector("[data-wh-app-notice]");
    const raw = notice?.getAttribute("data-r4-notice-seq") || "0";
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  })()`);
  const maxTransportAttempts = 2;
  let lastAudit: BrowserAudit | undefined;
  for (let attempt = 1; attempt <= maxTransportAttempts; attempt += 1) {
    const clicked = await cdp.evaluate<boolean>(`(() => {
      // Several proposal advanced-edit actions share apply_ai_fusion. The old wait accepted an
      // already-visible same-action notice as the next action's completion, so CI could click ahead
      // while the previous request was still in flight.
      const staleNotice = document.querySelector("[data-wh-app-notice]");
      if (staleNotice instanceof HTMLElement) {
        staleNotice.hidden = true;
        delete staleNotice.dataset.r4NoticeKind;
        delete staleNotice.dataset.r4NoticeActionId;
      }
      const target = document.querySelector(${JSON.stringify(selector)});
      if (!target) return false;
      target.click();
      return true;
    })()`);
    if (!clicked) {
      throw new Error(`Could not click selector: ${selector}`);
    }
    const audit = await waitFor<BrowserAudit>(
      cdp,
      `${selector} -> notice ${kind}`,
      auditExpression(),
      (value) =>
        isExpectedActionNotice({ notice: value.notice, previousSeq: previousNoticeSeq, kind, actionId }) ||
        shouldRetryTransportActionNotice({ notice: value.notice, previousSeq: previousNoticeSeq, actionId })
    );
    if (isExpectedActionNotice({ notice: audit.notice, previousSeq: previousNoticeSeq, kind, actionId })) {
      return;
    }
    lastAudit = audit;
    if (
      attempt < maxTransportAttempts &&
      shouldRetryTransportActionNotice({ notice: audit.notice, previousSeq: previousNoticeSeq, actionId })
    ) {
      previousNoticeSeq = noticeSequence(audit.notice.seq);
      await new Promise((resolve) => setTimeout(resolve, 300));
      continue;
    }
    break;
  }
  throw new Error(`Unexpected notice for ${selector} -> notice ${kind}; last value=${JSON.stringify(lastAudit)}`);
}

async function uploadDriveFileViaInput(cdp: CdpClient, filename: string, content: string) {
  const changed = await cdp.evaluate<boolean>(`(() => {
    const input = document.querySelector("[data-drive-upload-picker='true']");
    if (!(input instanceof HTMLInputElement)) return false;
    const file = new File([${JSON.stringify(content)}], ${JSON.stringify(filename)}, { type: "text/markdown" });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
  if (!changed) {
    throw new Error("Could not upload Drive file through the file picker.");
  }
  await waitFor<BrowserAudit>(
    cdp,
    `Drive file picker -> uploaded ${filename}`,
    auditExpression(),
    (audit) =>
      audit.notice.visible &&
      audit.notice.kind === "action_success" &&
      audit.notice.actionId === "drive_upload_file"
  );
}

async function openProposalAdvancedDetails(cdp: CdpClient) {
  await cdp.evaluate(`(() => {
    document.querySelectorAll("details[data-proposal-conflict-workbench],details[data-proposal-structured-field-editor],details[data-proposal-subrecord-item-diff]").forEach((details) => {
      details.open = true;
    });
    return true;
  })()`);
  await new Promise((resolve) => setTimeout(resolve, 180));
}

async function fillStructuredFieldCustomValue(cdp: CdpClient, field: string, value: string) {
  const filled = await cdp.evaluate<boolean>(`(() => {
    const input = document.querySelector(${JSON.stringify(`[data-structured-field-custom-input="${field}"]`)});
    if (!input) return false;
    input.value = ${JSON.stringify(value)};
    input.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  })()`);
  if (!filled) {
    throw new Error(`Could not fill structured custom field: ${field}`);
  }
}

async function fillLineEditorSearchValue(cdp: CdpClient, value: string) {
  const focused = await cdp.evaluate<boolean>(`(() => {
    const input = document.querySelector("[data-line-editor-search]");
    if (!(input instanceof HTMLInputElement)) return false;
    input.focus();
    input.value = "";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  })()`);
  if (!focused) {
    throw new Error("Could not focus line editor search");
  }
  if (value) {
    await cdp.send("Input.insertText", { text: value });
  }
}

async function emitQaSseEvent(cdp: CdpClient, event: string, stream = "proposal") {
  const ok = await cdp.evaluate<boolean>(`fetch(${JSON.stringify(`/api/__qa/emit?event=${encodeURIComponent(event)}&stream=${encodeURIComponent(stream)}`)}).then((response) => response.ok)`);
  if (!ok) {
    throw new Error(`QA SSE emit failed for ${stream}:${event}`);
  }
}

async function historyAndWait(cdp: CdpClient, direction: "back" | "forward", pathname: string) {
  await cdp.evaluate(`history.${direction}(); true`);
  await waitFor<{ pathname: string; status: string }>(
    cdp,
    `history.${direction} -> ${pathname}`,
    "(() => ({ pathname: location.pathname, status: document.querySelector('[data-r4-web-route-status]')?.getAttribute('data-r4-web-route-status') || '' }))()",
    (value) => value.pathname === pathname && value.status === "ready"
  );
}

function auditExpression() {
  return `(() => {
    const clone = document.body.cloneNode(true);
    clone.querySelectorAll("script,style").forEach((node) => node.remove());
    const text = clone.textContent || "";
    const nav = document.querySelector(".wh-product-nav");
    const navClientWidth = nav ? Math.round(nav.clientWidth) : 0;
    const navScrollWidth = nav ? Math.round(nav.scrollWidth) : 0;
    const textContainerSelector = [
      ".wh-product-topbar",
      ".wh-product-brand",
      ".wh-product-top-actions",
      ".wh-product-nav",
      ".wh-product-nav a",
      ".wh-product-masthead",
      ".wh-product-metric",
      ".wh-route-panel",
      ".wh-panel",
      ".wh-card",
      ".wh-section",
      ".wh-product-rail-block",
      ".wh-app-notice",
      ".wh-app-action-row",
      ".wh-web-route-state-wrap",
      ".route-state-card",
      "button",
      "a"
    ].join(",");
    const textOverflowSamples = Array.from(document.querySelectorAll("a,button,span,p,h1,h2,h3,h4,strong,small,li,dd,dt,label,time"))
      .flatMap((element) => {
        const htmlElement = element;
        const style = window.getComputedStyle(htmlElement);
        const rect = htmlElement.getBoundingClientRect();
        const visible = style.display !== "none" && style.visibility !== "hidden" && rect.width > 1 && rect.height > 1;
        const value = (htmlElement.textContent || "").replace(/\\s+/g, " ").trim();
        if (!visible || !value) return [];
        const explicitTextClip =
          style.textOverflow === "ellipsis" &&
          (style.whiteSpace === "nowrap" || (style.webkitLineClamp && style.webkitLineClamp !== "none"));
        const scrollArea = ["auto", "scroll"].includes(style.overflowX) || ["auto", "scroll"].includes(style.overflowY);
        const horizontalLeak =
          Math.ceil(htmlElement.scrollWidth) > Math.ceil(htmlElement.clientWidth) + 2 &&
          !explicitTextClip &&
          !scrollArea;
        const verticalLeak =
          Math.ceil(htmlElement.scrollHeight) > Math.ceil(htmlElement.clientHeight) + 2 &&
          !explicitTextClip &&
          !scrollArea;
        const container = htmlElement.parentElement ? htmlElement.parentElement.closest(textContainerSelector) : null;
        const containerRect = container ? container.getBoundingClientRect() : null;
        const containmentLeak = Boolean(
          containerRect &&
            (rect.left < containerRect.left - 2 ||
              rect.right > containerRect.right + 2 ||
              rect.top < containerRect.top - 2 ||
              rect.bottom > containerRect.bottom + 2)
        );
        if (!horizontalLeak && !verticalLeak && !containmentLeak) return [];
        const className = typeof htmlElement.className === "string" && htmlElement.className ? "." + htmlElement.className.split(/\\s+/).slice(0, 2).join(".") : "";
        return [
          htmlElement.tagName.toLowerCase() + className + " " + JSON.stringify(value.slice(0, 96)) +
            " leak=" + [horizontalLeak ? "horizontal" : "", verticalLeak ? "vertical" : "", containmentLeak ? "container" : ""].filter(Boolean).join("+") +
            " sw/cw=" + Math.ceil(htmlElement.scrollWidth) + "/" + Math.ceil(htmlElement.clientWidth) +
            " sh/ch=" + Math.ceil(htmlElement.scrollHeight) + "/" + Math.ceil(htmlElement.clientHeight)
        ];
      });
    const topbar = document.querySelector(".wh-product-topbar");
    const topbarRect = topbar ? topbar.getBoundingClientRect() : null;
    const navRect = nav ? nav.getBoundingClientRect() : null;
    const navVisible = Boolean(navRect && navRect.bottom > 0 && navRect.top < window.innerHeight);
    const topbarNavOverlap = Boolean(
      topbarRect &&
        navRect &&
        navVisible &&
        navRect.top < topbarRect.bottom - 2 &&
        navRect.bottom > topbarRect.top + 2
    );
    const statusRoot = document.querySelector("[data-r4-web-route-status]");
    const routeRoot = document.querySelector("[data-r4-product-shell]");
    const routeComponent = document.querySelector("[data-r4-route-component]");
    const proposalAdvanced = document.querySelector("[data-r4-proposal-advanced-review]");
    const proposalLineSelected = document.querySelector("[data-line-editor-decision-selected='true']");
    const proposalLineSearch = document.querySelector("[data-line-editor-search]");
    const proposalCustomField = document.querySelector("[data-structured-field-custom-input]");
    const routeComponentPanel = document.querySelector("[data-r4-route-component-panel]");
    const hydrationBoundary = document.querySelector("[data-r4-hydration-boundary]");
    const hydrationPanel = document.querySelector("[data-r4-hydration-panel]");
    const hydrationPanels = Array.from(document.querySelectorAll("[data-r4-hydration-panel]"));
    const routeTreeRoot = document.querySelector("[data-r4-react-route-tree]");
    const reactComponent = document.querySelector("[data-r4-react-component]");
    const reactRuntime = document.querySelector("[data-r4-react-mounted-component]");
    const reactRuntimeProbe = document.querySelector("[data-r4-react-dispatcher-probe]");
    const reactMutationEditor = document.querySelector("[data-r4-proposal-react-mutation-editor]");
    const reactMutationInput = document.querySelector("[data-r4-react-controlled-input]");
    const reactLineEditor = document.querySelector("[data-r4-proposal-react-line-editor]");
    const workitemSourceContext = document.querySelector("[data-r5-workitem-source-context]");
    const meetingInsight = document.querySelector("[data-r5-meeting-insight]");
    const meetingDraftLink = document.querySelector("[data-r5-meeting-draft-link]");
    const meetingProposalLink = document.querySelector("[data-r5-meeting-proposal-link]");
    const notificationNeedsBucket = document.querySelector("[data-r5-notification-bucket='needs_decision']");
    const notificationFyiBucket = document.querySelector("[data-r5-notification-bucket='fyi']");
    const notificationDoneBucket = document.querySelector("[data-r5-notification-bucket='done']");
    const notificationMeetingItem = document.querySelector("[data-r5-notification-item='${notificationMeetingId}']");
    const notificationDriveItem = document.querySelector("[data-r5-notification-item='${notificationDriveId}']");
    const calendarWorkItemBlock = document.querySelector("[data-r5-calendar-block-kind='work_item_due']");
    const calendarMeetingBlock = document.querySelector("[data-r5-calendar-block-kind='meeting_followup']");
    const calendarDay = document.querySelector("[data-r5-calendar-day='2026-06-11']");
    const panels = Array.from(document.querySelectorAll("[data-wh-panel]"));
    const visiblePanels = panels.filter((panel) => !panel.hasAttribute("hidden"));
    const routeComponentKey = routeComponent ? routeComponent.getAttribute("data-r4-route-component") : null;
    const routeData = {
      homeProjectDesk: document.querySelector("[data-r8-home-project-desk]") ? "true" : "false",
      homeProjectCount: document.querySelector("[data-r8-home-project-desk]")?.getAttribute("data-r8-home-project-count") || null,
      homeDriveCta: document.querySelector("[data-r8-home-drive-cta]")?.getAttribute("href") || null,
      workitemTraceCount: routeComponent?.getAttribute("data-r4-workitem-trace-count") || null,
      workitemEvidenceCount: routeComponent?.getAttribute("data-r4-workitem-evidence-count") || null,
      workitemAcceptanceCount: routeComponent?.getAttribute("data-r4-workitem-acceptance-count") || null,
      workitemSourceContext: workitemSourceContext?.getAttribute("data-r5-workitem-source-context") || null,
      workitemSourceCommentId: workitemSourceContext?.getAttribute("data-r5-workitem-source-comment-id") || null,
      workitemSourceMeetingId: workitemSourceContext?.getAttribute("data-r5-workitem-source-meeting-id") || null,
      workitemSourceInsightId: workitemSourceContext?.getAttribute("data-r5-workitem-source-insight-id") || null,
      workitemSourceProposalId: workitemSourceContext?.getAttribute("data-r5-workitem-source-proposal-id") || null,
      workitemCreateProposalAction: workitemSourceContext?.getAttribute("data-r5-workitem-create-proposal-action") || null,
      proposalChangeCount: routeComponent?.getAttribute("data-r4-proposal-change-count") || null,
      proposalActionCount: routeComponent?.getAttribute("data-r4-proposal-action-count") || null,
      proposalEvidenceCount: routeComponent?.getAttribute("data-r4-proposal-evidence-count") || null,
      proposalConflictCount: routeComponent?.getAttribute("data-r4-proposal-conflict-count") || null,
      proposalSplitAdapter: routeComponent?.getAttribute("data-r4-proposal-split-adapter") || null,
      proposalReadonlyReviewActionCount: routeComponent?.getAttribute("data-r4-proposal-readonly-review-action-count") || null,
      proposalAdvancedFallbackPreserved: routeComponent?.getAttribute("data-r4-proposal-advanced-fallback-preserved") || null,
      proposalAdvancedFallbackActionCount: routeComponent?.getAttribute("data-r4-proposal-advanced-fallback-action-count") || null,
      proposalLineEditorFallback: routeComponent?.getAttribute("data-r4-proposal-line-editor-fallback") || null,
      proposalFieldEditorFallback: routeComponent?.getAttribute("data-r4-proposal-field-editor-fallback") || null,
      proposalSubrecordEditorFallback: routeComponent?.getAttribute("data-r4-proposal-subrecord-editor-fallback") || null,
      proposalLineEditorFileCount: document.querySelector("[data-route-line-editor]")?.getAttribute("data-route-line-editor-file-count") || null,
      proposalLineEditorHunkCount: document.querySelector("[data-route-line-editor]")?.getAttribute("data-route-line-editor-hunk-count") || null,
      proposalStructuredFieldEditorCount: document.querySelector("[data-proposal-structured-field-editor]")?.getAttribute("data-proposal-structured-field-editor-count") || null,
      proposalSubrecordItemCount: document.querySelector("[data-subrecord-item-count]")?.getAttribute("data-subrecord-item-count") || null,
      proposalAdvancedConflicts: proposalAdvanced?.getAttribute("data-r4-proposal-conflicts") || null,
      proposalAdvancedFallback: proposalAdvanced?.getAttribute("data-r4-proposal-advanced-fallback") || null,
      proposalAdvancedFallbackSource: proposalAdvanced?.getAttribute("data-r4-proposal-advanced-fallback-source") || null,
      proposalAdvancedFallbackBoundaryActionCount: proposalAdvanced?.getAttribute("data-r4-proposal-advanced-fallback-action-count") || null,
      proposalAdvancedLineEditor: proposalAdvanced?.getAttribute("data-r4-proposal-line-editor") || null,
      proposalAdvancedFieldEditor: proposalAdvanced?.getAttribute("data-r4-proposal-field-editor") || null,
      proposalAdvancedSubrecordEditor: proposalAdvanced?.getAttribute("data-r4-proposal-subrecord-editor") || null,
      proposalLineEditorSelectedDecision: proposalLineSelected?.getAttribute("data-line-editor-decision") || null,
      proposalLineEditorSearchValue: proposalLineSearch instanceof HTMLInputElement ? proposalLineSearch.value : null,
      proposalCustomFieldValue: proposalCustomField instanceof HTMLTextAreaElement ? proposalCustomField.value : null,
      routeDirty: routeComponent?.getAttribute("data-r4-route-dirty") || null,
      routeDirtyReason: routeComponent?.getAttribute("data-r4-route-dirty-reason") || null,
      intakeOptionCount: routeComponent?.getAttribute("data-r4-intake-option-count") || null,
      intakeProgressCount: routeComponent?.getAttribute("data-r4-intake-progress-count") || null,
      intakeFreeTextCollapsed: routeComponent?.getAttribute("data-r4-intake-free-text-collapsed") || null,
      intakeInputMode: routeComponent?.getAttribute("data-r4-intake-input-mode") || null,
      intakeOptionFirst: routeComponent?.getAttribute("data-r4-intake-option-first") || null,
      intakeSelectedCount: String(document.querySelectorAll("[data-intake-option-selected='true']").length),
      knowledgeEvidenceCount: routeComponent?.getAttribute("data-r4-knowledge-evidence-count") || null,
      knowledgeMissing: routeComponent?.getAttribute("data-r4-knowledge-missing") || null,
      knowledgeActionCount: routeComponent?.getAttribute("data-r4-knowledge-action-count") || null,
      replayRunId: routeComponent?.getAttribute("data-r4-replay-run-id") || null,
      replayStepCount: routeComponent?.getAttribute("data-r4-replay-step-count") || null,
      replayAcceptedDeliverableCount: routeComponent?.getAttribute("data-r4-replay-accepted-deliverable-count") || null,
      replayMergeAttemptCount: routeComponent?.getAttribute("data-r4-replay-merge-attempt-count") || null,
      replayStructuredAuditCount: routeComponent?.getAttribute("data-r4-replay-structured-audit-count") || null,
      projectsCount: routeComponent?.getAttribute("data-r8-projects-count") || null,
      projectHomeId: routeComponent?.getAttribute("data-r8-project-home") || null,
      projectHomeSlug: routeComponent?.getAttribute("data-r8-project-home-slug") || null,
      projectHomeOpenCount: routeComponent?.getAttribute("data-r8-project-home-open-count") || null,
      projectHomeItemCount: String(document.querySelectorAll("[data-r8-project-home-item]").length),
      projectHomeFileCount: document.querySelector("[data-r8-project-home-files]")?.getAttribute("data-r8-project-home-files") || null,
      projectHomeMoreCount: document.querySelector("[data-r8-project-home-more]")?.getAttribute("data-r8-project-home-more") || null,
      projectHomeFilesMoreCount: document.querySelector("[data-r8-project-home-files-more]")?.getAttribute("data-r8-project-home-files-more") || null,
      driveProjectId: routeComponent?.getAttribute("data-r4-drive-project-id") || null,
      driveSelectedItemId: document.querySelector("[data-r4-drive-item-selected='true']")?.getAttribute("data-r4-drive-item") || null,
      driveItemCount: routeComponent?.getAttribute("data-r4-drive-item-count") || null,
      driveVersionCount: routeComponent?.getAttribute("data-r4-drive-version-count") || null,
      driveAcceptedCount: routeComponent?.getAttribute("data-r4-drive-accepted-count") || null,
      driveCommentCount: routeComponent?.getAttribute("data-r4-drive-comment-count") || null,
      driveDeletedCount: routeComponent?.getAttribute("data-r5-drive-deleted-count") || null,
      driveOperationCount: routeComponent?.getAttribute("data-r5-drive-operation-count") || null,
      driveCanManage: routeComponent?.getAttribute("data-r5-drive-can-manage") || null,
      driveProposalLink: document.querySelector("[data-r5-drive-proposal-link]") ? "true" : "false",
      driveProposalHref: document.querySelector("[data-r5-drive-proposal-link]")?.getAttribute("href") || null,
      driveProposalStatus: document.querySelector("[data-r5-drive-proposal-link]")?.getAttribute("data-r5-drive-proposal-status") || null,
      meetingProjectId: routeComponent?.getAttribute("data-r5-meetings-project-id") || null,
      meetingSelectedId: routeComponent?.getAttribute("data-r5-meeting-selected-id") || null,
      meetingCount: routeComponent?.getAttribute("data-r5-meeting-count") || null,
      meetingPendingInsights: routeComponent?.getAttribute("data-r5-meeting-pending-insights") || null,
      meetingConfirmedInsights: routeComponent?.getAttribute("data-r5-meeting-confirmed-insights") || null,
      meetingDismissedInsights: routeComponent?.getAttribute("data-r5-meeting-dismissed-insights") || null,
      meetingCanManage: routeComponent?.getAttribute("data-r5-meeting-can-manage") || null,
      meetingInsightId: meetingInsight?.getAttribute("data-r5-meeting-insight") || null,
      meetingInsightStatus: meetingInsight?.getAttribute("data-r5-meeting-insight-status") || null,
      meetingDraftLink: meetingDraftLink ? "true" : "false",
      meetingDraftHref: meetingDraftLink?.getAttribute("href") || null,
      meetingProposalLink: meetingProposalLink ? "true" : "false",
      meetingProposalHref: meetingProposalLink?.getAttribute("href") || null,
      meetingProposalStatus: meetingProposalLink?.getAttribute("data-r5-meeting-proposal-status") || null,
      notificationTotalCount: routeComponent?.getAttribute("data-r5-notification-total-count") || null,
      notificationUnreadCount: routeComponent?.getAttribute("data-r5-notification-unread-count") || null,
      notificationNeedsDecisionCount: routeComponent?.getAttribute("data-r5-notification-needs-decision-count") || null,
      notificationFyiCount: routeComponent?.getAttribute("data-r5-notification-fyi-count") || null,
      notificationDoneCount: routeComponent?.getAttribute("data-r5-notification-done-count") || null,
      notificationUrgentCount: routeComponent?.getAttribute("data-r5-notification-urgent-count") || null,
      notificationNeedsBucketCount: notificationNeedsBucket?.getAttribute("data-r5-notification-bucket-count") || null,
      notificationFyiBucketCount: notificationFyiBucket?.getAttribute("data-r5-notification-bucket-count") || null,
      notificationDoneBucketCount: notificationDoneBucket?.getAttribute("data-r5-notification-bucket-count") || null,
      notificationMeetingItemStatus: notificationMeetingItem?.getAttribute("data-r5-notification-status") || null,
      notificationMeetingSourceType: notificationMeetingItem?.getAttribute("data-r5-notification-source-type") || null,
      notificationDriveItemStatus: notificationDriveItem?.getAttribute("data-r5-notification-status") || null,
      notificationMeetingOpenHref: notificationMeetingItem?.querySelector("[data-action-id='open']")?.getAttribute("href") || null,
      notificationDriveOpenHref: notificationDriveItem?.querySelector("[data-action-id='open']")?.getAttribute("href") || null,
      notificationMarkReadAction: document.querySelector("[data-r5-notification-mark-read]") ? "true" : "false",
      notificationMarkAllReadAction: document.querySelector("[data-r5-notification-mark-all-read]") ? "true" : "false",
      notificationDismissAction: document.querySelector("[data-r5-notification-dismiss]") ? "true" : "false",
      notificationCompleteAction: document.querySelector("[data-r5-notification-complete]") ? "true" : "false",
      calendarDate: routeComponent?.getAttribute("data-r5-calendar-date") || null,
      calendarView: routeComponent?.getAttribute("data-r5-calendar-view") || null,
      calendarBlockCount: routeComponent?.getAttribute("data-r5-calendar-block-count") || null,
      calendarTodayCount: routeComponent?.getAttribute("data-r5-calendar-today-count") || null,
      calendarOverdueCount: routeComponent?.getAttribute("data-r5-calendar-overdue-count") || null,
      calendarWorkItemBlock: calendarWorkItemBlock?.getAttribute("data-r5-calendar-block") || null,
      calendarMeetingBlock: calendarMeetingBlock?.getAttribute("data-r5-calendar-block") || null,
      calendarDayCount: calendarDay?.getAttribute("data-r5-calendar-day-count") || null,
      calendarOpenTarget: document.querySelector("[data-r5-calendar-open-target]") ? "true" : "false",
      costTotalTokens: routeComponent?.getAttribute("data-r4-cost-total-tokens") || null,
      costTotalCny: routeComponent?.getAttribute("data-r4-cost-total-cny") || null,
      costBudgetCount: routeComponent?.getAttribute("data-r4-cost-budget-count") || null,
      costModelCount: routeComponent?.getAttribute("data-r4-cost-model-count") || null,
      costNoticeCount: routeComponent?.getAttribute("data-r4-cost-notice-count") || null,
      settingsRuntimeStatus: routeComponent?.getAttribute("data-r4-settings-runtime-status") || null,
      settingsPetModelInWeb: routeComponent?.getAttribute("data-r4-settings-pet-model-in-web") || null,
      settingsWorkerCount: routeComponent?.getAttribute("data-r4-settings-worker-count") || null,
      settingsActiveLocale: routeComponent?.getAttribute("data-r4-settings-active-locale") || null,
      settingsPreferenceLocale: routeComponent?.getAttribute("data-r4-settings-preference-locale") || null,
      settingsPreferenceSource: routeComponent?.getAttribute("data-r4-settings-preference-source") || null,
      settingsPreferenceSynced: routeComponent?.getAttribute("data-r4-settings-preference-synced") || null,
      settingsSecretSafe: routeComponent?.getAttribute("data-r4-settings-secret-safe") || null,
      settingsRestoreRequiresDesktop: routeComponent?.getAttribute("data-r4-settings-restore-requires-desktop") || null,
      settingsWebLocalActions: routeComponent?.getAttribute("data-r4-settings-web-local-actions") || null,
      settingsLocalBoundary: routeComponent?.getAttribute("data-r4-settings-local-boundary") || null,
      healthViewerScope: routeComponent?.getAttribute("data-r5-7-health-viewer-scope") || null,
      healthProjectCount: routeComponent?.getAttribute("data-r5-7-health-project-count") || null,
      healthAttentionCount: routeComponent?.getAttribute("data-r5-7-health-attention-count") || null,
      healthCardBand: document.querySelector("[data-r5-7-health-card]")?.getAttribute("data-r5-7-health-card-band") || null,
      healthBandsOnly: document.querySelector("[data-r5-7-health-bands-only]") ? "true" : "false",
      healthOpenProject: document.querySelector("[data-r5-7-health-open-project]") ? "true" : "false",
      healthSignalCount: String(document.querySelectorAll("[data-r5-7-health-signal]").length),
      skillActiveCount: routeComponent?.getAttribute("data-r8-skills-active") || null,
      skillAiAuthoredCount: routeComponent?.getAttribute("data-r8-skills-ai-authored") || null,
      skillRefinedCount: routeComponent?.getAttribute("data-r8-skills-refined") || null,
      skillCardCount: String(document.querySelectorAll("[data-r8-skill]").length),
      skillRefinedBadge: document.querySelector("[data-r8-skill-refined]") ? "true" : "false",
      skillEmpty: document.querySelector("[data-r8-skills-empty]") ? "true" : "false",
      agentPlanCount: routeComponent?.getAttribute("data-r9-agent-dashboard-plan-count") || null,
      agentRecentCount: routeComponent?.getAttribute("data-r9-agent-dashboard-recent-count") || null,
      agentActiveTeams: document.querySelector("[data-r9-agent-kpi='active_team_count'] strong")?.textContent?.trim() || null,
      agentWaitingDecision: document.querySelector("[data-r9-agent-kpi='waiting_decision'] strong")?.textContent?.trim() || null,
      agentKpiCount: String(document.querySelectorAll("[data-r9-agent-kpi]").length),
      agentPlanCardCount: String(document.querySelectorAll("[data-r9-agent-plan-card]").length),
      agentRecentAccordion: document.querySelector("[data-r9-agent-recent-activity='accordion']") ? "true" : "false",
      agentMobileMode: routeComponent?.getAttribute("data-r9-agent-dashboard-mobile") || null,
      agentEmpty: document.querySelector("[data-r9-agent-dashboard-empty]") ? "true" : "false",
      notificationGrounding: document.querySelector("[data-r5-7-notification-grounding]") ? "true" : "false",
      notificationEvidenceSearchRef: document.querySelector("[data-r5-7-notification-evidence-ref='knowledge_search']")?.getAttribute("href") || null,
      knowledgeSourceRef: document.querySelector("[data-r5-7-knowledge-source-ref]")?.getAttribute("data-r5-7-knowledge-source-ref") || null,
      onboardingScreen: document.querySelector("[data-r5-9-onboarding]") ? "true" : "false",
      onboardingLocale: document.querySelector("[data-r5-9-onboarding]")?.getAttribute("data-r5-9-onboarding-locale") || null,
      onboardingNicknameInput: document.querySelector("[data-r5-9-onboarding-nickname]") ? "true" : "false",
      onboardingAdminToggle: document.querySelector("[data-r5-9-onboarding-admin]") ? "true" : "false",
      onboardingTarget: document.querySelector("[data-r5-9-onboarding-target]")?.getAttribute("data-r5-9-onboarding-target") || null,
      currentUserChip: document.querySelector("[data-wh-current-user]")?.getAttribute("data-wh-current-user") || null,
      currentUserAdmin: document.querySelector("[data-wh-current-user]")?.getAttribute("data-wh-current-user-admin") || null,
      logoutAction: document.querySelector("[data-wh-logout]") ? "true" : "false"
    };
    const noticeElement = document.querySelector("[data-wh-app-notice]");
    const noticeVisible = Boolean(noticeElement && !noticeElement.hasAttribute("hidden"));
    const notice = {
      visible: noticeVisible,
      seq: noticeElement?.getAttribute("data-r4-notice-seq") || null,
      kind: noticeElement?.getAttribute("data-r4-notice-kind") || null,
      tone: noticeElement?.getAttribute("data-r4-notice-tone") || null,
      source: noticeElement?.getAttribute("data-r4-notice-source") || null,
      locale: noticeElement?.getAttribute("data-r4-notice-locale") || null,
      actionId: noticeElement?.getAttribute("data-r4-notice-action-id") || null,
      eventType: noticeElement?.getAttribute("data-r4-notice-event-type") || null,
      stream: noticeElement?.getAttribute("data-r4-notice-stream") || null,
      title: noticeElement?.querySelector(".wh-app-notice-title")?.textContent?.trim() || "",
      body: noticeElement?.querySelector(".wh-app-notice-body")?.textContent?.trim() || "",
      reasonButtonCount: noticeVisible ? document.querySelectorAll("[data-review-reason]").length : 0
    };
    const live = {
      sharedRuntime: document.documentElement.dataset.r4SharedWebRuntime || null,
      sharedLiveRuntime: document.documentElement.dataset.r4SharedLiveRuntime || null,
      sharedActionRuntime: document.documentElement.dataset.r4SharedActionRuntime || null,
      runtime: document.documentElement.dataset.r4LiveRuntime || null,
      streamCount: document.documentElement.dataset.r4LiveStreamCount || null,
      activeSourceCount: document.documentElement.dataset.r4LiveActiveSourceCount || null,
      openCount: document.documentElement.dataset.r4LiveSseOpenCount || null,
      closeCount: document.documentElement.dataset.r4LiveSseCloseCount || null,
      reuseCount: document.documentElement.dataset.r4LiveSseReuseCount || null,
      connectedCount: document.documentElement.dataset.r4LiveConnectedCount || null,
      eventCount: document.documentElement.dataset.r4LiveEventCount || null,
      refreshCount: document.documentElement.dataset.r4LiveRefreshCount || null,
      lastEvent: document.documentElement.dataset.r4LiveLastEvent || null,
      lastStream: document.documentElement.dataset.r4LiveLastStream || null,
      lastEventId: document.documentElement.dataset.r4LiveLastEventId || null,
      lastEventIdSource: document.documentElement.dataset.r4LiveLastEventIdSource || null,
      cursorStrategy: document.documentElement.dataset.r4LiveCursorStrategy || null,
      lastOpenHadCursor: document.documentElement.dataset.r4LiveLastOpenHadCursor || null,
      refreshMode: document.documentElement.dataset.r4LiveRefreshMode || null,
      reactPropsEvent: document.documentElement.dataset.r4LiveReactPropsEvent || null,
      reactPropsStream: document.documentElement.dataset.r4LiveReactPropsStream || null,
      reactPropsUpdateCount: document.documentElement.dataset.r4LiveReactPropsUpdateCount || null,
      routeDirty: document.documentElement.dataset.r4LiveRouteDirty || null,
      dirtyRoute: document.documentElement.dataset.r4LiveDirtyRoute || null,
      dirtyReason: document.documentElement.dataset.r4LiveDirtyReason || null,
      dirtyGuardCount: document.documentElement.dataset.r4LiveDirtyGuardCount || null,
      dirtyPendingEvent: document.documentElement.dataset.r4LiveDirtyPendingEvent || null,
      dirtyPendingStream: document.documentElement.dataset.r4LiveDirtyPendingStream || null
    };
    const routeStateCard = document.querySelector("[data-route-state]");
    const routeState = {
      kind: routeStateCard?.getAttribute("data-route-state") || null,
      actionText: routeStateCard?.querySelector("a")?.textContent?.trim() || null
    };
    const routeSpecificMarker =
      routeComponentKey === "home"
        ? Boolean(document.querySelector("[data-r8-home-project-desk]") && document.querySelector("[data-r8-home-drive-cta]") && document.querySelector("[data-r4-home-decision]"))
        : routeComponentKey === "workitem"
        ? Boolean(document.querySelector("[data-r4-workitem-context]") && document.querySelector("[data-r4-workitem-trace]") && document.querySelector("[data-r4-workitem-evidence]"))
        : routeComponentKey === "proposal"
          ? Boolean(document.querySelector("[data-r4-proposal-summary]") && document.querySelector("[data-r4-proposal-changes]") && (document.querySelector("[data-action-id='request_changes'][data-method='POST'][data-requires-reason='true']") || document.querySelector("[data-action-id='merge'][data-method='POST']") || document.querySelector("[data-action-id='open_workitem']")))
          : routeComponentKey === "cost"
            ? Boolean(document.querySelector("[data-r4-cost-metrics]") && document.querySelector("[data-r4-cost-budget]") && document.querySelector("[data-r4-cost-models]"))
            : routeComponentKey === "intake"
              ? Boolean(
                (
                  document.querySelector("[data-r4-intake-options]") &&
                  document.querySelector("[data-r4-intake-progress]") &&
                  document.querySelector("[data-intake-submit='next-question']")
                ) ||
                (
                  document.querySelector("[data-s1-day0-intake-start]") &&
                  document.querySelector("[data-s1-day1-intent-input]") &&
                  document.querySelector("[data-r4-route-component-source='project-bootstrap']")
                )
              )
              : routeComponentKey === "knowledge"
                ? Boolean(document.querySelector("[data-r4-knowledge-fallback]") && document.querySelector("[data-r4-knowledge-evidence-ref]") && document.querySelector("[data-action-id='use_for_current_task']"))
                : routeComponentKey === "drive"
                  ? Boolean(document.querySelector("[data-r4-drive-files]") && document.querySelector("[data-r4-drive-versions]") && document.querySelector("[data-r4-drive-accepted]") && document.querySelector("[data-r5-drive-recycle]") && document.querySelector("[data-r5-drive-operations]") && document.querySelector("[data-action-id='drive_preview']") && document.querySelector("[data-action-id='drive_download']") && document.querySelector("[data-action-id='drive_restore'][data-method='POST']"))
                  : routeComponentKey === "meetings"
                    ? Boolean(
                      document.querySelector("[data-r5-meetings-route]") &&
                        document.querySelector("[data-r5-meeting-list]") &&
                        document.querySelector("[data-r5-meeting-insight-panel]") &&
                        document.querySelector("[data-r5-meeting-transcript]") &&
                        document.querySelector("[data-r5-meeting-minutes]") &&
                        (
                          document.querySelector("[data-action-id='meeting_insight_to_draft']") ||
                          document.querySelector("[data-r5-meeting-draft-link]") ||
                          document.querySelector("[data-r5-meeting-proposal-link]")
                        )
                    )
                    : routeComponentKey === "notifications"
                      ? Boolean(
                        document.querySelector("[data-r5-notifications-route]") &&
                          document.querySelector("[data-r5-notification-bucket='needs_decision']") &&
                          document.querySelector("[data-r5-notification-bucket='fyi']") &&
                          document.querySelector("[data-r5-notification-bucket='done']") &&
                          document.querySelector("[data-r5-notification-item]") &&
                          document.querySelector("[data-r5-notification-mark-all-read]")
                      )
                      : routeComponentKey === "calendar"
                        ? Boolean(
                          document.querySelector("[data-r5-calendar-route]") &&
                            document.querySelector("[data-r5-calendar-upcoming]") &&
                            document.querySelector("[data-r5-calendar-days]") &&
                            document.querySelector("[data-r5-calendar-block-kind='work_item_due']") &&
                            document.querySelector("[data-r5-calendar-block-kind='meeting_followup']") &&
                          document.querySelector("[data-r5-calendar-open-target]")
                        )
                        : routeComponentKey === "skills"
                          ? Boolean(
                            document.querySelector("[data-r8-skill]") &&
                              document.querySelector("[data-r8-skill-refined]") &&
                              !document.querySelector("[data-r8-skills-empty]")
                          )
                        : routeComponentKey === "agents"
                          ? Boolean(
                            document.querySelector("[data-r9-agent-dashboard='true']") &&
                              document.querySelector("[data-r9-agent-kpi='active_team_count']") &&
                              document.querySelector("[data-r9-agent-kpi='waiting_decision']") &&
                              document.querySelector("[data-r9-agent-plan-card]") &&
                              document.querySelector("[data-r9-agent-recent-activity='accordion']") &&
                              !document.querySelector("[data-r9-agent-dashboard-empty]")
                          )
                    : routeComponentKey === "projects"
                      ? Boolean(document.querySelector("[data-r8-projects-list]") && document.querySelector("[data-r8-project-open]") && document.querySelector("[data-r8-project-create]"))
                      : routeComponentKey === "project-home"
                        ? Boolean(document.querySelector("[data-r8-project-home-list]") && document.querySelector("[data-r8-project-home-open-drive]") && document.querySelector("[data-r8-project-home-files]"))
                    : routeComponentKey === "settings"
                      ? Boolean(document.querySelector("[data-r4-settings-runtime]") && document.querySelector("[data-r4-settings-llm]") && document.querySelector("[data-r4-settings-device]"))
                      : Boolean(routeComponentKey);
    return {
      pathname: location.pathname,
      search: location.search,
      locationHash: location.hash,
      lang: document.documentElement.lang,
      storedLocale: localStorage.getItem("workhub.locale"),
      status: statusRoot ? statusRoot.getAttribute("data-r4-web-route-status") || "" : "",
      routeKey: statusRoot ? statusRoot.getAttribute("data-r4-web-route-key") || routeRoot?.getAttribute("data-r4-product-route-key") || "" : "",
      productShell: Boolean(routeRoot),
      linkModePath: routeRoot ? routeRoot.getAttribute("data-r4-product-link-mode") === "path" : false,
      masthead: Boolean(document.querySelector("[data-r4-product-masthead]")),
      routeComponent: routeComponentKey,
      routeComponentSource: routeComponent ? routeComponent.getAttribute("data-r4-route-component-source") : null,
      routeComponentPanel: routeComponentPanel ? routeComponentPanel.getAttribute("data-r4-route-component-panel") : null,
      routeComponentActive: routeComponentPanel ? routeComponentPanel.getAttribute("data-r4-route-component-active") === "true" : false,
      hydrationBoundary: Boolean(hydrationBoundary),
      hydrationRoute: hydrationBoundary ? hydrationBoundary.getAttribute("data-r4-hydration-route") : null,
      hydrationSource: hydrationBoundary ? hydrationBoundary.getAttribute("data-r4-hydration-source") : null,
      hydrationMode: hydrationBoundary ? hydrationBoundary.getAttribute("data-r4-hydration-mode") : null,
      hydrationPageVm: hydrationBoundary ? hydrationBoundary.getAttribute("data-r4-hydration-page-vm") : null,
      hydrationActionCount: hydrationBoundary ? hydrationBoundary.getAttribute("data-r4-hydration-action-count") : null,
      hydrationAdapter: hydrationBoundary ? hydrationBoundary.getAttribute("data-r4-hydration-adapter") : null,
      hydrationReactComponent: hydrationBoundary ? hydrationBoundary.getAttribute("data-r4-hydration-react-component") : null,
      hydrationReactComponentRoute: hydrationBoundary ? hydrationBoundary.getAttribute("data-r4-hydration-react-component-route") : null,
      hydrationReactComponentMode: hydrationBoundary ? hydrationBoundary.getAttribute("data-r4-hydration-react-component-mode") : null,
      hydrationReactComponentPropsSource: hydrationBoundary ? hydrationBoundary.getAttribute("data-r4-hydration-react-component-props-source") : null,
      hydrationReactComponentFallback: hydrationBoundary ? hydrationBoundary.getAttribute("data-r4-hydration-react-component-fallback") === "true" : false,
      hydrationReactComponentAdapter: hydrationBoundary ? hydrationBoundary.getAttribute("data-r4-hydration-react-component-adapter") : null,
      hydrationPanel: Boolean(hydrationPanel),
      hydrationPanelRoute: hydrationPanel ? hydrationPanel.getAttribute("data-r4-hydration-route") : null,
      hydrationPanelMode: hydrationPanel ? hydrationPanel.getAttribute("data-r4-hydration-mode") : null,
      hydrationPanelPageVm: hydrationPanel ? hydrationPanel.getAttribute("data-r4-hydration-page-vm") : null,
      hydrationPanelActionCount: hydrationPanel ? hydrationPanel.getAttribute("data-r4-hydration-action-count") : null,
      hydrationPanelCount: hydrationPanels.length,
      reactRouteTree: Boolean(routeTreeRoot),
      routeTreeKey: routeTreeRoot ? routeTreeRoot.getAttribute("data-r4-route-tree-key") : null,
      routeTreePageVm: routeTreeRoot ? routeTreeRoot.getAttribute("data-r4-route-tree-page-vm") : null,
      routeTreeMode: routeTreeRoot ? routeTreeRoot.getAttribute("data-r4-route-tree-mode") : null,
      routeTreeAdapter: routeTreeRoot ? routeTreeRoot.getAttribute("data-r4-route-tree-adapter") : null,
      routeTreeActiveOnly: routeTreeRoot ? routeTreeRoot.getAttribute("data-r4-route-tree-active-only") === "true" : false,
      routeTreeRouteCount: routeTreeRoot ? routeTreeRoot.getAttribute("data-r4-route-tree-route-count") : null,
      routeTreeReactComponent: routeTreeRoot ? routeTreeRoot.getAttribute("data-r4-route-tree-react-component") : null,
      routeTreeReactComponentAdapter: routeTreeRoot ? routeTreeRoot.getAttribute("data-r4-route-tree-react-component-adapter") : null,
      routeTreeReactComponentFallback: routeTreeRoot ? routeTreeRoot.getAttribute("data-r4-route-tree-react-component-fallback") === "true" : false,
      routeTreeRuntimeMount: routeTreeRoot ? routeTreeRoot.getAttribute("data-r4-route-tree-runtime-mount") === "true" : false,
      routeTreeRuntimeStrategy: routeTreeRoot ? routeTreeRoot.getAttribute("data-r4-route-tree-runtime-strategy") : null,
      routeTreeRuntimePropsUpdate: routeTreeRoot ? routeTreeRoot.getAttribute("data-r4-route-tree-runtime-props-update") : null,
      routeTreeRuntimeDispatcher: routeTreeRoot ? routeTreeRoot.getAttribute("data-r4-route-tree-runtime-dispatcher") : null,
      routeTreeRuntimeMutationEditor: routeTreeRoot ? routeTreeRoot.getAttribute("data-r4-route-tree-runtime-mutation-editor") : null,
      routeTreeRuntimeLineEditor: routeTreeRoot ? routeTreeRoot.getAttribute("data-r4-route-tree-runtime-line-editor") : null,
      reactComponentName: reactComponent ? reactComponent.getAttribute("data-r4-react-component") : null,
      reactComponentRoute: reactComponent ? reactComponent.getAttribute("data-r4-react-component-route") : null,
      reactComponentMode: reactComponent ? reactComponent.getAttribute("data-r4-react-component-mode") : null,
      reactComponentPropsSource: reactComponent ? reactComponent.getAttribute("data-r4-react-component-props-source") : null,
      reactComponentPageVm: reactComponent ? reactComponent.getAttribute("data-r4-react-component-page-vm") : null,
      reactComponentLocale: reactComponent ? reactComponent.getAttribute("data-r4-react-component-locale") : null,
      reactComponentHtmlFallback: reactComponent ? reactComponent.getAttribute("data-r4-react-component-html-fallback") === "true" : false,
      reactComponentAdapter: reactComponent ? reactComponent.getAttribute("data-r4-react-component-adapter") : null,
      reactComponentActionCount: reactComponent ? reactComponent.getAttribute("data-r4-react-component-action-count") : null,
      reactComponentFingerprint: reactComponent ? reactComponent.getAttribute("data-r4-react-component-props-fingerprint") : null,
      reactRuntimeMounted: Boolean(reactRuntime),
      reactRuntimeRoute: reactRuntime ? reactRuntime.getAttribute("data-r4-react-mounted-route") : null,
      reactRuntimeComponent: reactRuntime ? reactRuntime.getAttribute("data-r4-react-mounted-component") : null,
      reactRuntimeName: reactRuntime ? reactRuntime.getAttribute("data-r4-react-runtime") : null,
      reactRuntimePropsSource: reactRuntime ? reactRuntime.getAttribute("data-r4-react-props-source") : null,
      reactRuntimeFingerprint: reactRuntime ? reactRuntime.getAttribute("data-r4-react-props-fingerprint") : null,
      reactRuntimeLastUpdateReason: reactRuntime ? reactRuntime.getAttribute("data-r4-react-last-update-reason") : null,
      reactRuntimeMountCount: reactRuntime ? reactRuntime.getAttribute("data-r4-react-mount-count") : null,
      reactRuntimePropsUpdateCount: reactRuntime ? reactRuntime.getAttribute("data-r4-react-props-update-count") : null,
      reactRuntimePrimaryActionCount: reactRuntime ? reactRuntime.getAttribute("data-r4-react-primary-action-count") : null,
      reactRuntimeQueueCount: reactRuntime ? reactRuntime.getAttribute("data-r4-react-queue-count") : null,
      reactRuntimeVisibleMutationEditor: document.documentElement.dataset.r4ReactVisibleMutationEditor || reactRuntime?.getAttribute("data-r4-react-visible-mutation-editor") || null,
      reactRuntimeMutationEditorKind: document.documentElement.dataset.r4ReactMutationEditorKind || reactRuntime?.getAttribute("data-r4-react-mutation-editor-kind") || null,
      reactRuntimeControlledField: document.documentElement.dataset.r4ReactControlledField || reactRuntime?.getAttribute("data-r4-react-controlled-field") || null,
      reactRuntimeControlledValue: reactMutationInput instanceof HTMLTextAreaElement
        ? reactMutationInput.value
        : reactMutationEditor?.getAttribute("data-r4-proposal-react-controlled-value") || null,
      reactRuntimeHtmlFallbackPreserved: document.documentElement.dataset.r4ReactHtmlFallbackPreserved || reactRuntime?.getAttribute("data-r4-react-html-fallback-preserved") || null,
      reactRuntimeHtmlFallbackHidden: document.documentElement.dataset.r4ReactHtmlFallbackHidden || reactRuntime?.getAttribute("data-r4-react-html-fallback-hidden") || null,
      reactRuntimeVisibleLineEditor: document.documentElement.dataset.r4ReactVisibleLineEditor || reactLineEditor?.getAttribute("data-r4-react-visible-line-editor") || null,
      reactRuntimeLineEditorKind: document.documentElement.dataset.r4ReactLineEditorKind || reactLineEditor?.getAttribute("data-r4-react-line-editor-kind") || null,
      reactRuntimeLineEditorSelectedDecision: reactLineEditor?.getAttribute("data-r4-proposal-react-line-editor-selected-decision") || document.documentElement.dataset.r4ReactLineEditorSelectedDecision || null,
      reactRuntimeLineEditorSearchValue: reactLineEditor?.getAttribute("data-r4-proposal-react-line-editor-search-value") || document.documentElement.dataset.r4ReactLineEditorSearchValue || null,
      reactRuntimeLineEditorHtmlFallbackPreserved: document.documentElement.dataset.r4ReactLineEditorHtmlFallbackPreserved || reactLineEditor?.getAttribute("data-r4-react-line-editor-html-fallback-preserved") || null,
      reactRuntimeLineEditorHtmlFallbackHidden: document.documentElement.dataset.r4ReactLineEditorHtmlFallbackHidden || reactLineEditor?.getAttribute("data-r4-react-line-editor-html-fallback-hidden") || null,
      reactRuntimeDispatcherProbe: Boolean(reactRuntimeProbe),
      reactRuntimeDispatcherProbeActionId: reactRuntimeProbe ? reactRuntimeProbe.getAttribute("data-action-id") : null,
      routeSpecificMarker,
      routeData,
      notice,
      live,
      routeState,
      panelCount: panels.length,
      visiblePanelCount: visiblePanels.length,
      activeLocale: document.querySelector("[data-wh-locale][aria-pressed='true']")?.getAttribute("data-wh-locale") || null,
      pathNavigation: Array.from(document.querySelectorAll("a[href]")).some((anchor) => (anchor.getAttribute("href") || "").startsWith("/")),
      hashNavigationLeak: Array.from(document.querySelectorAll("a[href]")).some((anchor) => (anchor.getAttribute("href") || "").startsWith("#/")),
      oldShellLeak: Boolean(document.querySelector(".wh-app-root")),
      weeklyFixtureLeak: /客户周报|weekly report/i.test(text),
      cuuLeak: /\\bCuu\\b/i.test(text) || Boolean(document.querySelector("[data-cuu]")),
      kanbanLeak: /\\bkanban\\b/i.test(text),
      secretLeak: /api\\.deepseek\\.com|sk-[0-9A-Za-z]{20,}/u.test(text),
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
      horizontalOverflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) > document.documentElement.clientWidth + 2,
      navHorizontalOverflow: nav ? navScrollWidth > navClientWidth + 2 : false,
      textOverflowCount: textOverflowSamples.length,
      textOverflowSamples: textOverflowSamples.slice(0, 8),
      topbarNavOverlap,
      zhChrome: text.includes("工作入口"),
      enChrome: text.includes("Work entry")
    };
  })()`;
}

async function captureStep(
  cdp: CdpClient,
  input: { id: string; url: string; viewport: Viewport; expectedStatus: string; expectedRouteComponent?: string }
): Promise<StepReport> {
  const audit = await cdp.evaluate<BrowserAudit>(auditExpression());
  if (audit.status !== input.expectedStatus) {
    throw new Error(`${input.id} expected status ${input.expectedStatus}, got ${audit.status}`);
  }
  if (input.expectedRouteComponent && audit.routeComponent !== input.expectedRouteComponent) {
    throw new Error(`${input.id} expected route component ${input.expectedRouteComponent}, got ${audit.routeComponent ?? "missing"}`);
  }
  if (input.expectedRouteComponent && !audit.routeSpecificMarker) {
    throw new Error(`${input.id} is missing route-specific R4.11 markers`);
  }
  if (input.expectedRouteComponent) {
    if (!audit.reactRouteTree || audit.routeTreeKey !== input.expectedRouteComponent || audit.routeTreeMode !== "html-fallback") {
      throw new Error(`${input.id} is missing R4.16 route tree markers`);
    }
    if (!audit.hydrationBoundary || audit.hydrationRoute !== input.expectedRouteComponent || audit.hydrationMode !== "html-fallback") {
      throw new Error(`${input.id} is missing R4.16 hydration boundary markers`);
    }
    if (!audit.hydrationPanel || audit.hydrationPanelRoute !== input.expectedRouteComponent || audit.hydrationPanelMode !== "html-fallback") {
      throw new Error(`${input.id} is missing R4.16 active hydration panel markers`);
    }
    if (audit.hydrationPanelCount !== 1) {
      throw new Error(`${input.id} expected one hydration panel, got ${audit.hydrationPanelCount}`);
    }
    const expectedReactComponent = r4ReactComponentByRoute[input.expectedRouteComponent];
    if (expectedReactComponent) {
      if (audit.reactComponentName !== expectedReactComponent || audit.reactComponentRoute !== input.expectedRouteComponent) {
        throw new Error(`${input.id} is missing R4 React-compatible component markers`);
      }
      if (audit.reactComponentMode !== "html-fallback" || !audit.reactComponentHtmlFallback || audit.reactComponentPropsSource !== "typed-page-vm") {
        throw new Error(`${input.id} has invalid R4 React-compatible fallback props markers`);
      }
      if (audit.hydrationReactComponent !== expectedReactComponent || audit.hydrationReactComponentRoute !== input.expectedRouteComponent) {
        throw new Error(`${input.id} is missing R4 hydration component markers`);
      }
      if (audit.routeTreeReactComponent !== expectedReactComponent || !audit.routeTreeReactComponentFallback) {
        throw new Error(`${input.id} is missing R4 route tree component markers`);
      }
      if (audit.reactComponentActionCount !== audit.hydrationActionCount) {
        throw new Error(`${input.id} expected React-compatible action count to match hydration action count`);
      }
    }
    if (input.expectedRouteComponent === "home") {
      if (!audit.routeTreeRuntimeMount || audit.routeTreeRuntimeStrategy !== "react-18-createRoot-probe") {
        throw new Error(`${input.id} is missing R4.19-pre route tree runtime mount markers`);
      }
      if (!audit.reactRuntimeMounted || audit.reactRuntimeComponent !== "HomeRouteComponent" || audit.reactRuntimeName !== "react-18-createRoot") {
        throw new Error(`${input.id} is missing true React createRoot runtime probe`);
      }
      if (!audit.reactRuntimeDispatcherProbe || audit.reactRuntimeDispatcherProbeActionId !== "r4_react_mount_probe") {
        throw new Error(`${input.id} is missing React dispatcher bubble probe`);
      }
    }
    if (input.expectedRouteComponent === "proposal") {
      if (audit.reactComponentName !== "ProposalRouteComponent" || audit.routeTreeReactComponent !== "ProposalRouteComponent") {
        throw new Error(`${input.id} is missing R4.19 Proposal split adapter markers`);
      }
      if (audit.routeData.proposalSplitAdapter !== "true" || audit.routeData.proposalAdvancedFallbackPreserved !== "true") {
        throw new Error(`${input.id} is missing R4.19 Proposal split/fallback boundary markers`);
      }
    }
  }
  if (audit.productShell && audit.status === "ready" && (audit.panelCount !== 1 || audit.visiblePanelCount !== 1)) {
    throw new Error(`${input.id} expected one active product panel, got ${audit.visiblePanelCount}/${audit.panelCount}`);
  }
  if (audit.cuuLeak) {
    throw new Error(`${input.id} leaked Cuu main-window markers`);
  }
  if (audit.kanbanLeak) {
    throw new Error(`${input.id} leaked Kanban wording`);
  }
  if (audit.secretLeak) {
    throw new Error(`${input.id} leaked secret-like settings text`);
  }
  if (audit.hashNavigationLeak) {
    throw new Error(`${input.id} leaked hash navigation`);
  }
  if (audit.oldShellLeak) {
    throw new Error(`${input.id} leaked old preview shell`);
  }
  if (audit.weeklyFixtureLeak) {
    throw new Error(`${input.id} leaked weekly fixture copy`);
  }
  if (audit.horizontalOverflow || audit.navHorizontalOverflow) {
    throw new Error(`${input.id} has horizontal overflow`);
  }
  if (audit.textOverflowCount > 0) {
    throw new Error(`${input.id} has text overflow: ${audit.textOverflowSamples.join("; ")}`);
  }
  if (audit.topbarNavOverlap) {
    throw new Error(`${input.id} has topbar/nav overlap`);
  }
  const screenshot = `${input.id}.png`;
  const captured = await cdp.send<{ data: string }>("Page.captureScreenshot", { format: "png", fromSurface: true });
  await writeFile(path.join(outputDir, screenshot), Buffer.from(captured.data, "base64"));
  await assertPng(path.join(outputDir, screenshot));
  return {
    id: input.id,
    url: input.url,
    viewport: input.viewport,
    expectedStatus: input.expectedStatus,
    screenshot,
    audit
  };
}

async function assertPng(pathname: string) {
  const buffer = await readFile(pathname);
  const size = await stat(pathname);
  if (buffer.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") {
    throw new Error(`Not a PNG: ${pathname}`);
  }
  if (size.size < 8_000) {
    throw new Error(`Screenshot looks too small: ${pathname}`);
  }
}

function contactSheetDocument(steps: StepReport[]) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(smokeTitle)} Contact Sheet</title>
  <style>
    body{margin:0;background:#eef4fb;color:#172033;font-family:Aptos,Segoe UI,sans-serif}
    main{padding:18px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}
    figure{margin:0;border:1px solid #dce4f1;border-radius:8px;background:#fff;padding:10px;box-shadow:0 14px 36px rgba(37,51,79,.08);min-width:0}
    figcaption{font-size:12px;font-weight:850;color:#66728c;margin:0 0 8px;overflow-wrap:anywhere}
    img{display:block;width:100%;height:auto;border-radius:6px;border:1px solid #e5ecf5}
  </style>
</head>
<body><main>${steps
    .map(
      (step) =>
        `<figure><figcaption>${escapeHtml(step.id)} · ${escapeHtml(step.audit.pathname + step.audit.search)} · ${escapeHtml(step.audit.status)}</figcaption><img src="${escapeHtml(step.screenshot)}" alt="${escapeHtml(step.id)}" /></figure>`
    )
    .join("")}</main></body>
</html>`;
}

async function navigateFileAndCaptureContactSheet(cdp: CdpClient, steps: StepReport[]) {
  const htmlPath = path.join(outputDir, "contact-sheet.html");
  const screenshotPath = path.join(outputDir, "contact-sheet.png");
  await writeFile(htmlPath, contactSheetDocument(steps), "utf8");
  await setViewport(cdp, { width: 1280, height: 1800 });
  await cdp.send("Page.navigate", { url: pathToFileURL(htmlPath).href });
  await waitFor<string>(cdp, "contact sheet images", "document.readyState", (value) => value === "complete");
  const captured = await cdp.send<{ data: string }>("Page.captureScreenshot", { format: "png", fromSurface: true });
  await writeFile(screenshotPath, Buffer.from(captured.data, "base64"));
  await assertPng(screenshotPath);
}

async function runScenario(cdp: CdpClient, baseUrl: string) {
  const desktop = { width: 1365, height: 1120 };
  const mobile = { width: 390, height: 1180 };
  const steps: StepReport[] = [];

  await setViewport(cdp, desktop);
  await navigate(cdp, `${baseUrl}/`, "onboarding");
  await clickSelector(cdp, "[data-r5-9-onboarding-locale-option=\"zh-CN\"]");
  await waitFor<string>(
    cdp,
    "onboarding zh locale",
    "document.querySelector('[data-r5-9-onboarding]')?.getAttribute('data-r5-9-onboarding-locale') || ''",
    (value) => value === "zh-CN"
  );
  steps.push(await captureStep(cdp, { id: "00-onboarding-zh-desktop", url: `${baseUrl}/`, viewport: desktop, expectedStatus: "onboarding" }));

  await setViewport(cdp, mobile);
  steps.push(await captureStep(cdp, { id: "00a-onboarding-zh-mobile-no-overflow", url: `${baseUrl}/`, viewport: mobile, expectedStatus: "onboarding" }));
  await setViewport(cdp, desktop);

  await submitOnboardingForm(cdp, "R4 Live Reviewer");
  steps.push(await captureStep(cdp, { id: "01-home-zh-desktop", url: `${baseUrl}/`, viewport: desktop, expectedStatus: "ready", expectedRouteComponent: "home" }));

  await waitFor<BrowserAudit>(
    cdp,
    "home SSE stream connected",
    auditExpression(),
    (audit) => Number(audit.live.connectedCount ?? "0") > 0 && audit.live.streamCount === "1"
  );
  await clickAndWaitForNotice(cdp, "[data-r4-react-dispatcher-probe]", "action_pending", "r4_react_mount_probe");
  steps.push(await captureStep(cdp, { id: "01r-home-react-dispatcher-probe-zh-desktop", url: `${baseUrl}/`, viewport: desktop, expectedStatus: "ready", expectedRouteComponent: "home" }));

  await emitQaSseEvent(cdp, "budget.warning", "me");
  // findings[#118]：home 的 SSE 刷新现在走与其它路由一致的整页 VM 重渲染（page-vm-render），把可见的决策收件箱
  // 真正刷新；不再是只更新隐藏 React 探针的 react-props 短路。等待可见提示出现 + refreshMode=page-vm-render。
  await waitFor<BrowserAudit>(
    cdp,
    "home SSE full page-vm refresh",
    auditExpression(),
    (audit) =>
      audit.notice.visible &&
      audit.notice.kind === "budget_warning" &&
      audit.live.refreshMode === "page-vm-render" &&
      audit.reactRuntimeComponent === "HomeRouteComponent"
  );
  steps.push(await captureStep(cdp, { id: "01s-home-react-sse-props-update-zh-desktop", url: `${baseUrl}/`, viewport: desktop, expectedStatus: "ready", expectedRouteComponent: "home" }));

  await navigate(cdp, `${baseUrl}/intake/r4-live-session`, "ready");
  steps.push(await captureStep(cdp, { id: "01a-intake-zh-desktop-route-component", url: `${baseUrl}/intake/r4-live-session`, viewport: desktop, expectedStatus: "ready", expectedRouteComponent: "intake" }));

  await clickAndWaitForNotice(cdp, '[data-action-id="intake_continue"]', "intake_option_required", "intake_continue");
  steps.push(await captureStep(cdp, { id: "01b-intake-empty-fail-closed-zh-desktop", url: `${baseUrl}/intake/r4-live-session`, viewport: desktop, expectedStatus: "ready", expectedRouteComponent: "intake" }));

  await clickSelector(cdp, '[data-intake-option-id="risk-first"]');
  await clickAndWaitForNotice(cdp, '[data-action-id="intake_continue"]', "action_success", "intake_continue");
  steps.push(await captureStep(cdp, { id: "01c-intake-next-question-success-zh-desktop", url: `${baseUrl}/intake/r4-live-session`, viewport: desktop, expectedStatus: "ready", expectedRouteComponent: "intake" }));

  await clickSelector(cdp, '[data-intake-option-id="create-worker"]');
  await clickAndWait(cdp, '[data-action-id="create_workitem"]', "/workitems/r4-live-workitem");
  await waitFor<BrowserAudit>(
    cdp,
    "create work item notice",
    auditExpression(),
    (audit) => audit.notice.visible && audit.notice.kind === "action_success" && audit.notice.actionId === "create_workitem"
  );
  steps.push(await captureStep(cdp, { id: "01d-intake-create-workitem-success-zh-desktop", url: `${baseUrl}/workitems/r4-live-workitem`, viewport: desktop, expectedStatus: "ready", expectedRouteComponent: "workitem" }));

  await clickAndWait(cdp, 'a[href="/approvals"]', "/approvals");
  steps.push(await captureStep(cdp, { id: "02-approvals-click-zh-desktop", url: `${baseUrl}/approvals`, viewport: desktop, expectedStatus: "ready", expectedRouteComponent: "approvals" }));

  await clickAndWaitForNotice(cdp, '[data-action-id="deny"]', "reason_required", "deny");
  steps.push(await captureStep(cdp, { id: "02a-approval-deny-reason-gate-zh-desktop", url: `${baseUrl}/approvals`, viewport: desktop, expectedStatus: "ready", expectedRouteComponent: "approvals" }));

  await clickAndWaitForNotice(cdp, "[data-review-reason]", "action_success", "deny");
  steps.push(await captureStep(cdp, { id: "02b-approval-deny-success-zh-desktop", url: `${baseUrl}/approvals`, viewport: desktop, expectedStatus: "ready", expectedRouteComponent: "approvals" }));

  await clickAndWaitForNotice(cdp, '[data-action-id="approve"]', "action_success", "approve");
  steps.push(await captureStep(cdp, { id: "02c-approval-approve-success-zh-desktop", url: `${baseUrl}/approvals`, viewport: desktop, expectedStatus: "ready", expectedRouteComponent: "approvals" }));

  await clickAndWait(cdp, 'a[href="/workitems/r4-live-workitem"]', "/workitems/r4-live-workitem");
  steps.push(await captureStep(cdp, { id: "03-workitem-click-zh-desktop-route-component", url: `${baseUrl}/workitems/r4-live-workitem`, viewport: desktop, expectedStatus: "ready", expectedRouteComponent: "workitem" }));

  await historyAndWait(cdp, "back", "/approvals");
  steps.push(await captureStep(cdp, { id: "04-history-back-approvals", url: `${baseUrl}/approvals`, viewport: desktop, expectedStatus: "ready" }));

  await historyAndWait(cdp, "forward", "/workitems/r4-live-workitem");
  steps.push(await captureStep(cdp, { id: "05-history-forward-workitem", url: `${baseUrl}/workitems/r4-live-workitem`, viewport: desktop, expectedStatus: "ready", expectedRouteComponent: "workitem" }));

  await clickAndWait(cdp, '[data-wh-locale="en-US"]', "/workitems/r4-live-workitem");
  await waitFor<BrowserAudit>(
    cdp,
    "en-US reload",
    auditExpression(),
    (audit) => audit.lang === "en-US" && audit.enChrome && audit.storedLocale === "en-US" && audit.activeLocale === "en-US"
  );
  steps.push(await captureStep(cdp, { id: "06-locale-toggle-en-workitem-route-component", url: `${baseUrl}/workitems/r4-live-workitem`, viewport: desktop, expectedStatus: "ready", expectedRouteComponent: "workitem" }));

  await navigate(cdp, `${baseUrl}/proposals/r4-live-proposal`, "ready");
  await waitFor<BrowserAudit>(
    cdp,
    "proposal SSE stream connected",
    auditExpression(),
    (audit) => Number(audit.live.connectedCount ?? "0") > 0 && Number(audit.live.streamCount ?? "0") >= 3
  );
  await openProposalAdvancedDetails(cdp);
  steps.push(await captureStep(cdp, { id: "06a-proposal-advanced-review-en-desktop", url: `${baseUrl}/proposals/r4-live-proposal`, viewport: desktop, expectedStatus: "ready", expectedRouteComponent: "proposal" }));

  await clickSelector(cdp, "[data-line-editor-decision]:not([data-line-editor-decision-selected='true'])");
  await fillLineEditorSearchValue(cdp, "scope");
  await fillStructuredFieldCustomValue(cdp, "title", "R4.19 guarded custom title");
  await emitQaSseEvent(cdp, "proposal.merged", "proposal");
  await waitFor<BrowserAudit>(
    cdp,
    "proposal dirty edit SSE guard",
    auditExpression(),
    (audit) =>
      audit.notice.visible &&
      audit.notice.kind === "sse_dirty_guard" &&
      audit.notice.eventType === "proposal.merged" &&
      audit.notice.stream === "proposal" &&
      audit.live.refreshMode === "dirty-deferred" &&
      audit.live.dirtyPendingEvent === "proposal.merged" &&
      audit.live.dirtyPendingStream === "proposal" &&
      audit.routeData.routeDirty === "true" &&
      audit.routeData.proposalLineEditorSelectedDecision !== null &&
      audit.routeData.proposalLineEditorSearchValue === "scope" &&
      audit.routeData.proposalCustomFieldValue === "R4.19 guarded custom title"
  );
  await cdp.evaluate("window.scrollTo(0, 0); true");
  await new Promise((resolve) => setTimeout(resolve, 80));
  steps.push(await captureStep(cdp, { id: "06aa-proposal-dirty-edit-sse-guard-en-desktop", url: `${baseUrl}/proposals/r4-live-proposal`, viewport: desktop, expectedStatus: "ready", expectedRouteComponent: "proposal" }));
  await cdp.evaluate(`(() => {
    const custom = document.querySelector('[data-structured-field-custom-input="title"]');
    if (custom instanceof HTMLTextAreaElement) {
      custom.value = "";
      custom.dispatchEvent(new Event("input", { bubbles: true }));
    }
    return true;
  })()`);

  await clickAndWaitForNotice(cdp, "[data-line-editor-apply]", "action_success", "apply_ai_fusion");
  steps.push(await captureStep(cdp, { id: "06b-proposal-line-editor-apply-success-en-desktop", url: `${baseUrl}/proposals/r4-live-proposal`, viewport: desktop, expectedStatus: "ready", expectedRouteComponent: "proposal" }));

  await clickAndWaitForNotice(cdp, '[data-task-plan-choice][data-task-plan-id="10000000-0000-4000-8000-000000000929"]', "action_success", "apply_ai_fusion");
  steps.push(await captureStep(cdp, { id: "06c-proposal-task-plan-apply-success-en-desktop", url: `${baseUrl}/proposals/r4-live-proposal`, viewport: desktop, expectedStatus: "ready", expectedRouteComponent: "proposal" }));

  await clickAndWaitForNotice(cdp, '[data-subrecord-item-choice][data-subrecord-decision="accept_incoming"]', "action_success", "apply_ai_fusion");
  steps.push(await captureStep(cdp, { id: "06d-proposal-subrecord-apply-success-en-desktop", url: `${baseUrl}/proposals/r4-live-proposal`, viewport: desktop, expectedStatus: "ready", expectedRouteComponent: "proposal" }));

  await clickAndWaitForNotice(cdp, '[data-field-editor-action="custom"][data-structured-field="title"]', "field_value_required", "apply_ai_fusion");
  steps.push(await captureStep(cdp, { id: "06e-proposal-custom-field-empty-fail-closed-en-desktop", url: `${baseUrl}/proposals/r4-live-proposal`, viewport: desktop, expectedStatus: "ready", expectedRouteComponent: "proposal" }));

  await fillStructuredFieldCustomValue(cdp, "title", "R4.13 custom reviewed title");
  await clickAndWaitForNotice(cdp, '[data-field-editor-action="custom"][data-structured-field="title"]', "action_success", "apply_ai_fusion");
  steps.push(await captureStep(cdp, { id: "06f-proposal-custom-field-apply-success-en-desktop", url: `${baseUrl}/proposals/r4-live-proposal`, viewport: desktop, expectedStatus: "ready", expectedRouteComponent: "proposal" }));

  const tallDesktop = { width: 1365, height: 3000 };
  await setViewport(cdp, tallDesktop);
  await cdp.evaluate("window.scrollTo(0, 0); true");
  await new Promise((resolve) => setTimeout(resolve, 250));
  steps.push(await captureStep(cdp, { id: "06g-proposal-structured-field-editor-visual-en-desktop", url: `${baseUrl}/proposals/r4-live-proposal`, viewport: tallDesktop, expectedStatus: "ready", expectedRouteComponent: "proposal" }));
  await setViewport(cdp, desktop);

  await clickAndWaitForNotice(cdp, '[data-action-id="request_changes"]', "reason_required", "request_changes");
  steps.push(await captureStep(cdp, { id: "07-proposal-reason-gate-en-desktop", url: `${baseUrl}/proposals/r4-live-proposal`, viewport: desktop, expectedStatus: "ready", expectedRouteComponent: "proposal" }));

  await clickAndWaitForNotice(cdp, "[data-review-reason]", "action_success", "request_changes");
  steps.push(await captureStep(cdp, { id: "08-proposal-request-changes-success-en-desktop", url: `${baseUrl}/proposals/r4-live-proposal`, viewport: desktop, expectedStatus: "ready", expectedRouteComponent: "proposal" }));

  // GitHub 式两段流（M11/L17）：merge 按钮不再在 opened 态直出，必须先 approve，
  // 由响应里的 next_action 原地换出「采纳到正式版」再点。
  await clickAndWaitForNotice(cdp, '[data-action-id="approve"]', "action_success", "approve");
  steps.push(await captureStep(cdp, { id: "08b-proposal-approve-success-en-desktop", url: `${baseUrl}/proposals/r4-live-proposal`, viewport: desktop, expectedStatus: "ready", expectedRouteComponent: "proposal" }));

  await clickAndWaitForNotice(cdp, '[data-action-id="merge"]', "action_success", "merge");
  steps.push(await captureStep(cdp, { id: "09-proposal-merge-success-en-desktop", url: `${baseUrl}/proposals/r4-live-proposal`, viewport: desktop, expectedStatus: "ready", expectedRouteComponent: "proposal" }));

  await emitQaSseEvent(cdp, "proposal.merged", "proposal");
  await waitFor<BrowserAudit>(
    cdp,
    "proposal SSE refresh notice",
    auditExpression(),
    (audit) => audit.notice.visible && audit.notice.kind === "sse_refresh" && audit.notice.eventType === "proposal.merged" && Number(audit.live.refreshCount ?? "0") > 0
  );
  steps.push(await captureStep(cdp, { id: "10-proposal-sse-refresh-notice-en-desktop", url: `${baseUrl}/proposals/r4-live-proposal`, viewport: desktop, expectedStatus: "ready", expectedRouteComponent: "proposal" }));

  await setViewport(cdp, mobile);
  await cdp.evaluate("window.scrollTo(0, 680); true");
  await new Promise((resolve) => setTimeout(resolve, 250));
  steps.push(await captureStep(cdp, { id: "11-proposal-en-mobile-scrolled-notice-route-component", url: `${baseUrl}/proposals/r4-live-proposal`, viewport: mobile, expectedStatus: "ready", expectedRouteComponent: "proposal" }));

  await navigate(cdp, `${baseUrl}/dashboard/cost`, "ready");
  steps.push(await captureStep(cdp, { id: "12-cost-en-mobile-route-component", url: `${baseUrl}/dashboard/cost`, viewport: mobile, expectedStatus: "ready", expectedRouteComponent: "cost" }));

  await waitFor<BrowserAudit>(
    cdp,
    "cost SSE stream connected",
    auditExpression(),
    (audit) => Number(audit.live.connectedCount ?? "0") > 0 && audit.live.streamCount === "1"
  );
  await emitQaSseEvent(cdp, "budget.warning", "me");
  await waitFor<BrowserAudit>(
    cdp,
    "budget warning notice",
    auditExpression(),
    (audit) => audit.notice.visible && audit.notice.kind === "budget_warning" && audit.notice.eventType === "budget.warning" && Number(audit.live.refreshCount ?? "0") > 0
  );
  steps.push(await captureStep(cdp, { id: "12a-cost-budget-warning-notice-en-mobile", url: `${baseUrl}/dashboard/cost`, viewport: mobile, expectedStatus: "ready", expectedRouteComponent: "cost" }));

  await setViewport(cdp, desktop);
  await navigate(cdp, `${baseUrl}/dashboard/agents`, "ready");
  steps.push(await captureStep(cdp, { id: "12aa-agents-en-desktop-route-component", url: `${baseUrl}/dashboard/agents`, viewport: desktop, expectedStatus: "ready", expectedRouteComponent: "agents" }));

  await setViewport(cdp, mobile);
  await navigate(cdp, `${baseUrl}/dashboard/agents`, "ready");
  steps.push(await captureStep(cdp, { id: "12ab-agents-en-mobile-no-overflow", url: `${baseUrl}/dashboard/agents`, viewport: mobile, expectedStatus: "ready", expectedRouteComponent: "agents" }));

  await setViewport(cdp, desktop);
  await navigate(cdp, `${baseUrl}/knowledge/search?q=regional&workItemId=r4-live-workitem`, "ready");
  steps.push(await captureStep(cdp, { id: "12b-knowledge-fallback-en-desktop-route-component", url: `${baseUrl}/knowledge/search?q=regional&workItemId=r4-live-workitem`, viewport: desktop, expectedStatus: "ready", expectedRouteComponent: "knowledge" }));

  await clickAndWaitForNotice(cdp, '[data-action-id="use_for_current_task"]', "action_success", "use_for_current_task");
  steps.push(await captureStep(cdp, { id: "12c-knowledge-bind-success-en-desktop", url: `${baseUrl}/knowledge/search?q=regional&workItemId=r4-live-workitem`, viewport: desktop, expectedStatus: "ready", expectedRouteComponent: "knowledge" }));

  await setViewport(cdp, mobile);
  await navigate(cdp, `${baseUrl}/intake/r4-live-session`, "ready");
  steps.push(await captureStep(cdp, { id: "12d-intake-en-mobile-no-overflow", url: `${baseUrl}/intake/r4-live-session`, viewport: mobile, expectedStatus: "ready", expectedRouteComponent: "intake" }));

  await setViewport(cdp, desktop);
  await navigate(cdp, `${baseUrl}/settings`, "ready");
  steps.push(await captureStep(cdp, { id: "13-settings-en-desktop-route-component", url: `${baseUrl}/settings`, viewport: desktop, expectedStatus: "ready", expectedRouteComponent: "settings" }));

  await cdp.evaluate("fetch('/api/__qa/fail-next-preference-patch', { method: 'POST' }).then((response) => response.ok)");
  await clickAndWaitForNotice(cdp, '[data-wh-locale="zh-CN"]', "locale_persistence_failed", "locale_switch");
  steps.push(await captureStep(cdp, { id: "13a-settings-locale-persistence-fail-closed-en-desktop", url: `${baseUrl}/settings`, viewport: desktop, expectedStatus: "ready", expectedRouteComponent: "settings" }));

  await clickAndWaitForNotice(cdp, '[data-action-id="open_desktop_settings"]', "desktop_required", "open_desktop_settings");
  steps.push(await captureStep(cdp, { id: "14-settings-desktop-gate-en-desktop", url: `${baseUrl}/settings`, viewport: desktop, expectedStatus: "ready", expectedRouteComponent: "settings" }));

  await setViewport(cdp, mobile);
  steps.push(await captureStep(cdp, { id: "14a-settings-en-mobile-boundary-no-overflow", url: `${baseUrl}/settings`, viewport: mobile, expectedStatus: "ready", expectedRouteComponent: "settings" }));
  await setViewport(cdp, desktop);

  await navigate(cdp, `${baseUrl}/agent-runs/r4-live-run/replay`, "ready");
  steps.push(await captureStep(cdp, { id: "15-replay-en-desktop-route-component", url: `${baseUrl}/agent-runs/r4-live-run/replay`, viewport: desktop, expectedStatus: "ready", expectedRouteComponent: "replay" }));

  await clickAndWaitForNotice(cdp, '[data-action-id="restore_deliverable"]', "action_success", "restore_deliverable");
  steps.push(await captureStep(cdp, { id: "15a-replay-restore-success-en-desktop", url: `${baseUrl}/agent-runs/r4-live-run/replay`, viewport: desktop, expectedStatus: "ready", expectedRouteComponent: "replay" }));

  await navigate(cdp, `${baseUrl}/projects`, "ready");
  steps.push(await captureStep(cdp, { id: "15ab-projects-en-desktop-route-component", url: `${baseUrl}/projects`, viewport: desktop, expectedStatus: "ready", expectedRouteComponent: "projects" }));

  await fillTextInput(cdp, "[data-r8-project-name-input]", qaCreatedProjectName);
  await clickAndWait(cdp, "[data-r8-project-create]", `/projects/${qaCreatedProjectId}`);
  steps.push(await captureStep(cdp, { id: "15aba-project-create-named-en-desktop", url: `${baseUrl}/projects/${qaCreatedProjectId}`, viewport: desktop, expectedStatus: "ready", expectedRouteComponent: "project-home" }));

  await navigate(cdp, `${baseUrl}/projects`, "ready");
  await clickAndWait(cdp, `[data-r8-project-open="${qaProjectId}"]`, `/projects/${qaProjectId}`);
  steps.push(await captureStep(cdp, { id: "15ac-project-home-en-desktop-route-component", url: `${baseUrl}/projects/${qaProjectId}`, viewport: desktop, expectedStatus: "ready", expectedRouteComponent: "project-home" }));

  await clickAndWait(cdp, "[data-r8-project-home-new-task]", "/intake");
  steps.push(await captureStep(cdp, { id: "15ad-project-home-new-task-intake-en-desktop", url: `${baseUrl}/intake?project_id=${qaProjectId}`, viewport: desktop, expectedStatus: "ready", expectedRouteComponent: "intake" }));

  await navigate(cdp, `${baseUrl}/projects/${qaProjectId}`, "ready");
  await clickAndWait(cdp, "[data-r8-project-home-open-drive]", "/drive");
  steps.push(await captureStep(cdp, { id: "15b-drive-en-desktop-route-component", url: `${baseUrl}/drive?project_id=${qaProjectId}`, viewport: desktop, expectedStatus: "ready", expectedRouteComponent: "drive" }));

  await clickAndWaitForNotice(cdp, '[data-action-id="comment_to_draft"]', "action_success", "comment_to_draft");
  steps.push(await captureStep(cdp, { id: "15bb-drive-comment-to-draft-success-en-desktop", url: `${baseUrl}/drive?project_id=${qaProjectId}`, viewport: desktop, expectedStatus: "ready", expectedRouteComponent: "drive" }));

  await clickAndWait(cdp, 'a[href="/workitems/r4-live-workitem"]', "/workitems/r4-live-workitem");
  steps.push(await captureStep(cdp, { id: "15bc-drive-open-workitem-draft-en-desktop", url: `${baseUrl}/workitems/r4-live-workitem`, viewport: desktop, expectedStatus: "ready", expectedRouteComponent: "workitem" }));

  await clickAndWaitForNotice(cdp, '[data-action-id="drive_draft_to_proposal"]', "action_success", "drive_draft_to_proposal");
  steps.push(await captureStep(cdp, { id: "15bd-drive-draft-to-proposal-success-en-desktop", url: `${baseUrl}/workitems/r4-live-workitem`, viewport: desktop, expectedStatus: "ready", expectedRouteComponent: "workitem" }));

  await navigate(cdp, `${baseUrl}/drive?project_id=${qaProjectId}`, "ready");
  steps.push(await captureStep(cdp, { id: "15be-drive-proposal-link-en-desktop", url: `${baseUrl}/drive?project_id=${qaProjectId}`, viewport: desktop, expectedStatus: "ready", expectedRouteComponent: "drive" }));

  await uploadDriveFileViaInput(cdp, qaDriveUploadFilename, "# Regional launch brief\n\nPrepared by field operations for the launch readiness review.");
  steps.push(await captureStep(cdp, { id: "15c-drive-upload-success-en-desktop", url: `${baseUrl}/drive?project_id=${qaProjectId}`, viewport: desktop, expectedStatus: "ready", expectedRouteComponent: "drive" }));

  await clickSelector(cdp, `[data-r5-drive-item-link-id="${qaManualDriveItemId}"]`);
  await waitFor<BrowserAudit>(
    cdp,
    "Drive uploaded item deep-link selected",
    auditExpression(),
    (audit) =>
      audit.pathname === "/drive" &&
      audit.search.includes(`item_id=${qaManualDriveItemId}`) &&
      audit.routeData.driveSelectedItemId === qaManualDriveItemId
  );
  steps.push(await captureStep(cdp, { id: "15ca-drive-uploaded-item-deeplink-en-desktop", url: `${baseUrl}/drive?project_id=${qaProjectId}&item_id=${qaManualDriveItemId}`, viewport: desktop, expectedStatus: "ready", expectedRouteComponent: "drive" }));

  await clickAndWaitForNotice(cdp, '[data-action-id="drive_delete_item"]', "action_success", "drive_delete_item");
  steps.push(await captureStep(cdp, { id: "15d-drive-delete-success-en-desktop", url: `${baseUrl}/drive?project_id=${qaProjectId}`, viewport: desktop, expectedStatus: "ready", expectedRouteComponent: "drive" }));

  await clickAndWaitForNotice(cdp, '[data-action-id="drive_restore_item"]', "action_success", "drive_restore_item");
  steps.push(await captureStep(cdp, { id: "15e-drive-restore-success-en-desktop", url: `${baseUrl}/drive?project_id=${qaProjectId}`, viewport: desktop, expectedStatus: "ready", expectedRouteComponent: "drive" }));

  await navigate(cdp, `${baseUrl}/meetings?project_id=${meetingProjectId}&m=${meetingId}`, "ready");
  steps.push(await captureStep(cdp, { id: "15f-meetings-insight-en-desktop", url: `${baseUrl}/meetings?project_id=${meetingProjectId}&m=${meetingId}`, viewport: desktop, expectedStatus: "ready", expectedRouteComponent: "meetings" }));

  await clickAndWaitForNotice(cdp, '[data-action-id="meeting_insight_to_draft"]', "action_success", "meeting_insight_to_draft");
  steps.push(await captureStep(cdp, { id: "15g-meeting-insight-draft-en-desktop", url: `${baseUrl}/meetings?project_id=${meetingProjectId}&m=${meetingId}`, viewport: desktop, expectedStatus: "ready", expectedRouteComponent: "meetings" }));

  await clickAndWait(cdp, `a[href="/workitems/${meetingWorkItemId}"]`, `/workitems/${meetingWorkItemId}`);
  steps.push(await captureStep(cdp, { id: "15h-meeting-workitem-source-en-desktop", url: `${baseUrl}/workitems/${meetingWorkItemId}`, viewport: desktop, expectedStatus: "ready", expectedRouteComponent: "workitem" }));

  await clickAndWaitForNotice(cdp, '[data-action-id="meeting_draft_to_proposal"]', "action_success", "meeting_draft_to_proposal");
  steps.push(await captureStep(cdp, { id: "15i-meeting-draft-proposal-en-desktop", url: `${baseUrl}/workitems/${meetingWorkItemId}`, viewport: desktop, expectedStatus: "ready", expectedRouteComponent: "workitem" }));

  await setViewport(cdp, mobile);
  await navigate(cdp, `${baseUrl}/meetings?project_id=${meetingProjectId}&m=${meetingId}`, "ready");
  steps.push(await captureStep(cdp, { id: "15j-meetings-en-mobile-no-overflow", url: `${baseUrl}/meetings?project_id=${meetingProjectId}&m=${meetingId}`, viewport: mobile, expectedStatus: "ready", expectedRouteComponent: "meetings" }));

  await setViewport(cdp, desktop);
  await navigate(cdp, `${baseUrl}/notifications`, "ready");
  steps.push(await captureStep(cdp, { id: "15k-notifications-en-desktop", url: `${baseUrl}/notifications`, viewport: desktop, expectedStatus: "ready", expectedRouteComponent: "notifications" }));

  await clickAndWaitForNotice(cdp, `[data-r5-notification-item="${notificationMeetingId}"] [data-r5-notification-mark-read]`, "action_success", "notification_mark_read");
  steps.push(await captureStep(cdp, { id: "15l-notification-mark-read-en-desktop", url: `${baseUrl}/notifications`, viewport: desktop, expectedStatus: "ready", expectedRouteComponent: "notifications" }));

  await clickAndWaitForNotice(cdp, `[data-r5-notification-item="${notificationMeetingId}"] [data-r5-notification-dismiss]`, "action_success", "notification_dismiss");
  steps.push(await captureStep(cdp, { id: "15m-notification-dismiss-en-desktop", url: `${baseUrl}/notifications`, viewport: desktop, expectedStatus: "ready", expectedRouteComponent: "notifications" }));

  await clickAndWaitForNotice(cdp, "[data-r5-notification-mark-all-read]", "action_success", "notification_mark_all_read");
  steps.push(await captureStep(cdp, { id: "15n-notification-mark-all-read-en-desktop", url: `${baseUrl}/notifications`, viewport: desktop, expectedStatus: "ready", expectedRouteComponent: "notifications" }));

  await clickAndWaitForNotice(cdp, `[data-r5-notification-item="${notificationDriveId}"] [data-r5-notification-complete]`, "action_success", "notification_complete");
  steps.push(await captureStep(cdp, { id: "15o-notification-complete-en-desktop", url: `${baseUrl}/notifications`, viewport: desktop, expectedStatus: "ready", expectedRouteComponent: "notifications" }));

  await setViewport(cdp, mobile);
  await navigate(cdp, `${baseUrl}/notifications`, "ready");
  steps.push(await captureStep(cdp, { id: "15p-notifications-en-mobile-no-overflow", url: `${baseUrl}/notifications`, viewport: mobile, expectedStatus: "ready", expectedRouteComponent: "notifications" }));

  await setViewport(cdp, desktop);
  await navigate(cdp, `${baseUrl}/calendar?date=2026-06-11&view=week`, "ready");
  steps.push(await captureStep(cdp, { id: "15q-calendar-en-desktop", url: `${baseUrl}/calendar?date=2026-06-11&view=week`, viewport: desktop, expectedStatus: "ready", expectedRouteComponent: "calendar" }));

  await clickAndWait(cdp, "[data-r5-calendar-open-target]", `/workitems/${meetingWorkItemId}`);
  steps.push(await captureStep(cdp, { id: "15qa-calendar-open-target-workitem-en-desktop", url: `${baseUrl}/workitems/${meetingWorkItemId}`, viewport: desktop, expectedStatus: "ready", expectedRouteComponent: "workitem" }));

  await setViewport(cdp, mobile);
  await navigate(cdp, `${baseUrl}/calendar?date=2026-06-11&view=week`, "ready");
  steps.push(await captureStep(cdp, { id: "15r-calendar-en-mobile-no-overflow", url: `${baseUrl}/calendar?date=2026-06-11&view=week`, viewport: mobile, expectedStatus: "ready", expectedRouteComponent: "calendar" }));

  await setViewport(cdp, desktop);
  await navigate(cdp, `${baseUrl}/dashboard/health`, "ready");
  steps.push(await captureStep(cdp, { id: "15s-health-en-desktop", url: `${baseUrl}/dashboard/health`, viewport: desktop, expectedStatus: "ready", expectedRouteComponent: "health" }));

  await clickAndWait(cdp, "[data-r5-7-health-open-project]", `/projects/${meetingProjectId}`);
  steps.push(await captureStep(cdp, { id: "15sa-health-open-project-en-desktop", url: `${baseUrl}/projects/${meetingProjectId}`, viewport: desktop, expectedStatus: "ready", expectedRouteComponent: "project-home" }));

  await setViewport(cdp, mobile);
  await navigate(cdp, `${baseUrl}/dashboard/health`, "ready");
  steps.push(await captureStep(cdp, { id: "15t-health-en-mobile-no-overflow", url: `${baseUrl}/dashboard/health`, viewport: mobile, expectedStatus: "ready", expectedRouteComponent: "health" }));

  await setViewport(cdp, desktop);
  await navigate(cdp, `${baseUrl}/dashboard/skills`, "ready");
  steps.push(await captureStep(cdp, { id: "15v-skills-en-desktop-route-component", url: `${baseUrl}/dashboard/skills`, viewport: desktop, expectedStatus: "ready", expectedRouteComponent: "skills" }));

  await setViewport(cdp, mobile);
  await navigate(cdp, `${baseUrl}/dashboard/skills`, "ready");
  steps.push(await captureStep(cdp, { id: "15w-skills-en-mobile-no-overflow", url: `${baseUrl}/dashboard/skills`, viewport: mobile, expectedStatus: "ready", expectedRouteComponent: "skills" }));

  await setViewport(cdp, desktop);
  await navigate(cdp, `${baseUrl}/notifications`, "ready");
  await clickAndWait(cdp, `[data-r5-notification-item="${notificationMeetingId}"] [data-r5-7-notification-evidence-ref="knowledge_search"]`, "/knowledge/search");
  steps.push(await captureStep(cdp, { id: "15u-notification-evidence-jump-en-desktop", url: `${baseUrl}/knowledge/search`, viewport: desktop, expectedStatus: "ready", expectedRouteComponent: "knowledge" }));

  await setViewport(cdp, mobile);
  // 簇A 后 approvals 空态不再塌(改在外壳内渲染,见 routes.test)；通用 "empty" 态改用仍合法塌陷的网盘无项目路径演示。
  await navigate(cdp, `${baseUrl}/drive?empty=drive`, "empty");
  steps.push(await captureStep(cdp, { id: "16-empty-drive-no-project-mobile", url: `${baseUrl}/drive?empty=drive`, viewport: mobile, expectedStatus: "empty" }));

  await setViewport(cdp, desktop);
  await navigate(cdp, `${baseUrl}/workitems/r4-live-forbidden`, "forbidden");
  steps.push(await captureStep(cdp, { id: "17-forbidden-workitem-desktop", url: `${baseUrl}/workitems/r4-live-forbidden`, viewport: desktop, expectedStatus: "forbidden" }));

  await navigate(cdp, `${baseUrl}/missing-r4-live-route`, "notFound");
  steps.push(await captureStep(cdp, { id: "18-unknown-route-notfound", url: `${baseUrl}/missing-r4-live-route`, viewport: desktop, expectedStatus: "notFound" }));

  await navigate(cdp, `${baseUrl}/approvals`, "ready");
  await clickSelector(cdp, "[data-wh-logout]");
  await waitFor<string>(
    cdp,
    "logout -> onboarding",
    "document.querySelector('[data-r4-web-route-status]')?.getAttribute('data-r4-web-route-status') || ''",
    (value) => value === "onboarding"
  );
  steps.push(await captureStep(cdp, { id: "19-logout-onboarding-en-desktop", url: `${baseUrl}/approvals`, viewport: desktop, expectedStatus: "onboarding" }));

  await submitOnboardingForm(cdp, "Pilot Two");
  steps.push(await captureStep(cdp, { id: "19a-second-user-deeplink-en-desktop", url: `${baseUrl}/approvals`, viewport: desktop, expectedStatus: "ready", expectedRouteComponent: "approvals" }));

  return steps;
}

async function submitOnboardingForm(cdp: CdpClient, nickname: string) {
  const filled = await cdp.evaluate<boolean>(`(() => {
    const input = document.querySelector("[data-r5-9-onboarding-nickname]");
    const form = document.querySelector("[data-r5-9-onboarding-form]");
    if (!input || !form) return false;
    input.value = ${JSON.stringify(nickname)};
    form.requestSubmit();
    return true;
  })()`);
  if (!filled) {
    throw new Error("Onboarding form not found for scripted registration");
  }
  await waitFor<string>(
    cdp,
    `register ${nickname} -> ready`,
    "document.querySelector('[data-r4-web-route-status]')?.getAttribute('data-r4-web-route-status') || ''",
    (value) => value === "ready"
  );
}

function requestProof(requests: ApiRequestRecord[]) {
  const count = (pathname: string, method = "GET") =>
    requests.filter((request) => request.method === method && request.pathname === pathname).length;
  const countMatch = (pattern: RegExp, method = "GET") =>
    requests.filter((request) => request.method === method && pattern.test(request.pathname)).length;
  const bodyMatch = (pattern: RegExp, method = "POST", bodyFragment: string) =>
    requests.some((request) =>
      request.method === method &&
      pattern.test(request.pathname) &&
      typeof request.body === "string" &&
      request.body.includes(bodyFragment)
    );
  return {
    attention: requests.some((request) => request.pathname === "/api/pages/attention" && request.locale === "zh-CN"),
    approvals: requests.some((request) => request.pathname === "/api/pages/approvals"),
    workitem: requests.some((request) => request.pathname === "/api/pages/workitems/r4-live-workitem"),
    workitemEn: requests.some((request) => request.pathname === "/api/pages/workitems/r4-live-workitem" && request.locale === "en-US"),
    session: requests.some((request) => request.pathname === "/api/sessions/r4-live-session" && request.locale === "zh-CN"),
    sessionEn: requests.some((request) => request.pathname === "/api/sessions/r4-live-session" && request.locale === "en-US"),
    nextQuestion: requests.some((request) => request.method === "POST" && /^\/api\/sessions\/[^/]+\/next-question$/u.test(request.pathname)),
    createWorkItem: requests.some((request) => request.method === "POST" && request.pathname === "/api/workitems"),
    knowledge: requests.some((request) => request.method === "POST" && request.pathname === "/api/knowledge/search" && request.locale === "en-US"),
    evidenceBinding: requests.some((request) => request.method === "POST" && /^\/api\/workitems\/[^/]+\/evidence-bindings$/u.test(request.pathname)),
    projects: requests.some((request) => request.pathname === "/api/projects"),
    projectHome: requests.some((request) => request.pathname === `/api/pages/project/${qaProjectId}` && request.locale === "en-US"),
    createNamedProject: requests.some((request) =>
      request.method === "POST" &&
      request.pathname === "/api/projects/bootstrap" &&
      typeof request.body === "string" &&
      request.body.includes(qaCreatedProjectName)
    ),
    proposal: requests.some((request) => request.pathname === "/api/pages/proposals/r4-live-proposal"),
    conflicts: requests.some((request) => /^\/api\/workitems\/[^/]+\/conflicts$/u.test(request.pathname)),
    drive: requests.some((request) => request.pathname === "/api/pages/drive" && request.locale === "en-US"),
    driveProjectParam: requests.some((request) => request.pathname === "/api/pages/drive" && request.search.includes(`project_id=${qaProjectId}`)),
    driveItemParam: requests.some((request) => request.pathname === "/api/pages/drive" && request.search.includes(`item_id=${qaManualDriveItemId}`)),
    driveCommentDraft: requests.some((request) => request.method === "POST" && /^\/api\/drive\/projects\/[^/]+\/comments\/[^/]+\/draft$/u.test(request.pathname)),
    driveDraftProposal: requests.some((request) => request.method === "POST" && /^\/api\/drive\/workitems\/[^/]+\/proposal-draft$/u.test(request.pathname)),
    meetings: requests.some((request) => request.pathname === "/api/pages/meetings" && request.locale === "en-US"),
    meetingsProjectParam: requests.some((request) => request.pathname === "/api/pages/meetings" && request.search.includes(`project_id=${meetingProjectId}`)),
    meetingWorkitem: requests.some((request) => request.pathname === `/api/pages/workitems/${meetingWorkItemId}` && request.locale === "en-US"),
    meetingInsightDraft: requests.some((request) => request.method === "POST" && /^\/api\/meetings\/projects\/[^/]+\/insights\/[^/]+\/draft$/u.test(request.pathname)),
    meetingInsightDismiss: requests.some((request) => request.method === "POST" && /^\/api\/meetings\/projects\/[^/]+\/insights\/[^/]+\/dismiss$/u.test(request.pathname)),
    meetingDraftProposal: requests.some((request) => request.method === "POST" && /^\/api\/meetings\/workitems\/[^/]+\/proposal-draft$/u.test(request.pathname)),
    notifications: requests.some((request) => request.pathname === "/api/pages/notifications" && request.locale === "en-US"),
    calendar: requests.some((request) => request.pathname === "/api/pages/calendar" && request.locale === "en-US"),
    calendarWeekQuery: requests.some((request) => request.pathname === "/api/pages/calendar" && request.search.includes("date=2026-06-11") && request.search.includes("view=week")),
    notificationMarkRead: requests.some((request) => request.method === "POST" && request.pathname === `/api/notifications/${notificationMeetingId}/read`),
    notificationMarkAllRead: requests.some((request) => request.method === "POST" && request.pathname === "/api/notifications/read-all"),
    notificationDismiss: requests.some((request) => request.method === "POST" && request.pathname === `/api/notifications/${notificationMeetingId}/dismiss`),
    notificationComplete: requests.some((request) => request.method === "POST" && request.pathname === `/api/notifications/${notificationDriveId}/complete`),
    identifyRegistration: requests.some((request) =>
      request.method === "POST" &&
      request.pathname === "/api/auth/identify" &&
      typeof request.body === "string" &&
      request.body.includes("R4 Live Reviewer")
    ),
    identifySecondUser: requests.some((request) =>
      request.method === "POST" &&
      request.pathname === "/api/auth/identify" &&
      typeof request.body === "string" &&
      request.body.includes("Pilot Two")
    ),
    logout: requests.some((request) => request.method === "POST" && request.pathname === "/api/auth/logout"),
    health: requests.some((request) => request.pathname === "/api/pages/health" && request.locale === "en-US"),
    knowledgeSourceRef: requests.some((request) =>
      request.method === "POST" &&
      request.pathname === "/api/knowledge/search" &&
      typeof request.body === "string" &&
      request.body.includes(`notification:${notificationMeetingId}`)
    ),
    agents: requests.some((request) => request.pathname === "/api/pages/agents" && request.locale === "en-US"),
    skills: requests.some((request) => request.pathname === "/api/pages/skills" && request.locale === "en-US"),
    cost: requests.some((request) => request.pathname === "/api/pages/cost" && request.locale === "en-US"),
    settings: requests.some((request) => request.pathname === "/api/pages/settings" && request.locale === "en-US"),
    replay: requests.some((request) => request.pathname === "/api/agent-runs/r4-live-run/replay" && request.locale === "en-US"),
    goldPath: requests.filter((request) => request.pathname === "/api/pages/gold-path").length === 0,
    goldPathEn: requests.every((request) => request.pathname !== "/api/pages/gold-path" || request.locale !== "en-US"),
    localePatch: requests.some((request) => request.method === "PATCH" && request.pathname === "/api/auth/preferences"),
    localePatchFailureArmed: requests.some((request) => request.method === "POST" && request.pathname === "/api/__qa/fail-next-preference-patch"),
    counts: {
      attention: count("/api/pages/attention"),
      approvals: count("/api/pages/approvals"),
      workitem: count("/api/pages/workitems/r4-live-workitem"),
      workitemForbidden: count("/api/pages/workitems/r4-live-forbidden"),
      session: count("/api/sessions/r4-live-session"),
      nextQuestion: countMatch(/^\/api\/sessions\/[^/]+\/next-question$/u, "POST"),
      createWorkItem: count("/api/workitems", "POST"),
      knowledgeSearch: count("/api/knowledge/search", "POST"),
      evidenceBinding: countMatch(/^\/api\/workitems\/[^/]+\/evidence-bindings$/u, "POST"),
      projects: count("/api/projects"),
      projectHome: count(`/api/pages/project/${qaProjectId}`),
      createNamedProject: count("/api/projects/bootstrap", "POST"),
      proposal: count("/api/pages/proposals/r4-live-proposal"),
      proposalConflicts: countMatch(/^\/api\/workitems\/[^/]+\/conflicts$/u),
      drive: count("/api/pages/drive"),
      approvalRespond: countMatch(/^\/api\/approvals\/[^/]+\/respond$/u, "POST"),
      proposalReview: countMatch(/^\/api\/proposals\/[^/]+\/review$/u, "POST"),
      proposalMerge: countMatch(/^\/api\/proposals\/[^/]+\/merge$/u, "POST"),
      mergeApply: countMatch(/^\/api\/merge-proposals\/[^/]+\/apply$/u, "POST"),
      acceptedDeliverableRestore: countMatch(/^\/api\/workitems\/[^/]+\/deliverables\/[^/]+\/restore$/u, "POST"),
      driveUpload: countMatch(/^\/api\/drive\/projects\/[^/]+\/files$/u, "POST"),
      driveCommentDraft: countMatch(/^\/api\/drive\/projects\/[^/]+\/comments\/[^/]+\/draft$/u, "POST"),
      driveDraftProposal: countMatch(/^\/api\/drive\/workitems\/[^/]+\/proposal-draft$/u, "POST"),
      driveDelete: countMatch(/^\/api\/drive\/projects\/[^/]+\/items\/[^/]+\/delete$/u, "POST"),
      driveRestore: countMatch(/^\/api\/drive\/projects\/[^/]+\/items\/[^/]+\/restore$/u, "POST"),
      meetings: count("/api/pages/meetings"),
      meetingWorkitem: count(`/api/pages/workitems/${meetingWorkItemId}`),
      meetingInsightDraft: countMatch(/^\/api\/meetings\/projects\/[^/]+\/insights\/[^/]+\/draft$/u, "POST"),
      meetingInsightDismiss: countMatch(/^\/api\/meetings\/projects\/[^/]+\/insights\/[^/]+\/dismiss$/u, "POST"),
      meetingDraftProposal: countMatch(/^\/api\/meetings\/workitems\/[^/]+\/proposal-draft$/u, "POST"),
      notifications: count("/api/pages/notifications"),
      calendar: count("/api/pages/calendar"),
      notificationMarkRead: countMatch(/^\/api\/notifications\/[^/]+\/read$/u, "POST"),
      notificationMarkAllRead: count("/api/notifications/read-all", "POST"),
      notificationDismiss: countMatch(/^\/api\/notifications\/[^/]+\/dismiss$/u, "POST"),
      notificationComplete: countMatch(/^\/api\/notifications\/[^/]+\/complete$/u, "POST"),
      identify: count("/api/auth/identify", "POST"),
      logout: count("/api/auth/logout", "POST"),
      health: count("/api/pages/health"),
      agents: count("/api/pages/agents"),
      skills: count("/api/pages/skills"),
      cost: count("/api/pages/cost"),
      settings: count("/api/pages/settings"),
      replay: count("/api/agent-runs/r4-live-run/replay"),
      qaEmit: count("/api/__qa/emit"),
      preferenceFailureArmed: count("/api/__qa/fail-next-preference-patch", "POST"),
      sseProposal: count("/api/push/stream/proposal/r4-live-proposal"),
      goldPath: count("/api/pages/gold-path"),
      preferencePatch: count("/api/auth/preferences", "PATCH")
    },
    advancedPayloads: {
      nextQuestionSelection: bodyMatch(/^\/api\/sessions\/[^/]+\/next-question$/u, "POST", "risk-first"),
      createWorkItemSelection: bodyMatch(/^\/api\/workitems$/u, "POST", "create-worker"),
      knowledgeWorkItemFilter: bodyMatch(/^\/api\/knowledge\/search$/u, "POST", "r4-live-workitem"),
      evidenceBindingRefs: bodyMatch(/^\/api\/workitems\/[^/]+\/evidence-bindings$/u, "POST", "evidence_bubble_id"),
      createNamedProjectName: bodyMatch(/^\/api\/projects\/bootstrap$/u, "POST", qaCreatedProjectName),
      textHunkOverrides: bodyMatch(/^\/api\/merge-proposals\/[^/]+\/apply$/u, "POST", "text_hunk_overrides"),
      textHunkFullCoverage:
        bodyMatch(/^\/api\/merge-proposals\/[^/]+\/apply$/u, "POST", "hunk_index") &&
        bodyMatch(/^\/api\/merge-proposals\/[^/]+\/apply$/u, "POST", "start_line") &&
        bodyMatch(/^\/api\/merge-proposals\/[^/]+\/apply$/u, "POST", "end_line") &&
        bodyMatch(/^\/api\/merge-proposals\/[^/]+\/apply$/u, "POST", "decision"),
      taskPlanScope: bodyMatch(/^\/api\/merge-proposals\/[^/]+\/apply$/u, "POST", "task_plan_scope"),
      structuredItemOverrides: bodyMatch(/^\/api\/merge-proposals\/[^/]+\/apply$/u, "POST", "structured_item_overrides"),
      structuredFieldOverrides: bodyMatch(/^\/api\/merge-proposals\/[^/]+\/apply$/u, "POST", "structured_field_overrides"),
      customFieldValue: bodyMatch(/^\/api\/merge-proposals\/[^/]+\/apply$/u, "POST", "R4.13 custom reviewed title"),
      driveUploadFilename: bodyMatch(/^\/api\/drive\/projects\/[^/]+\/files$/u, "POST", qaDriveUploadFilename),
      driveCommentDraftRequest: requests.some((request) =>
        request.method === "POST" &&
        new RegExp(`^/api/drive/projects/${qaProjectId}/comments/10000000-0000-4000-8000-000000001623/draft$`, "u").test(request.pathname)
      ),
      driveDraftProposalRequest: requests.some((request) =>
        request.method === "POST" &&
        /^\/api\/drive\/workitems\/r4-live-workitem\/proposal-draft$/u.test(request.pathname)
      ),
      meetingInsightDraftRequest: requests.some((request) =>
        request.method === "POST" &&
        new RegExp(`^/api/meetings/projects/${meetingProjectId}/insights/${meetingInsightId}/draft$`, "u").test(request.pathname)
      ),
      meetingDraftProposalRequest: requests.some((request) =>
        request.method === "POST" &&
        new RegExp(`^/api/meetings/workitems/${meetingWorkItemId}/proposal-draft$`, "u").test(request.pathname)
      ),
      driveDeleteExpectedCurrent: bodyMatch(/^\/api\/drive\/projects\/[^/]+\/items\/[^/]+\/delete$/u, "POST", "expected_current_version_id") &&
        bodyMatch(/^\/api\/drive\/projects\/[^/]+\/items\/[^/]+\/delete$/u, "POST", "10000000-0000-4000-8000-000000001625")
    }
  };
}

function hasActiveComponent(steps: StepReport[], id: string, key: string) {
  return steps.some((step) =>
    step.id === id &&
    step.audit.routeComponent === key &&
    step.audit.routeComponentSource === "page-vm" &&
    step.audit.routeComponentActive &&
    step.audit.routeSpecificMarker
  );
}

function vmDomValueMatches(steps: StepReport[], surface: GoldPathSurfaceVM) {
  const byId = new Map(steps.map((step) => [step.id, step]));
  const workitem = byId.get("03-workitem-click-zh-desktop-route-component")?.audit.routeData;
  const proposal = byId.get("11-proposal-en-mobile-scrolled-notice-route-component")?.audit.routeData;
  const cost = byId.get("12-cost-en-mobile-route-component")?.audit.routeData;
  const agents = byId.get("12aa-agents-en-desktop-route-component")?.audit.routeData;
  const skills = byId.get("15v-skills-en-desktop-route-component")?.audit.routeData;
  const settings = byId.get("13-settings-en-desktop-route-component")?.audit.routeData;
  const skillsVm = teamSkillsPage();
  const agentsVm = agentArmyDashboardVm();
  return Boolean(
    workitem &&
      workitem.workitemTraceCount === String(surface.page_vms.workitem.agent_trace_preview.length) &&
      workitem.workitemEvidenceCount === String(surface.page_vms.workitem.evidence_refs.length) &&
      workitem.workitemAcceptanceCount === String(surface.page_vms.workitem.acceptance.length) &&
      proposal &&
      proposal.proposalChangeCount === String(surface.page_vms.proposal.manifest.changes.length) &&
      // 两段流：opened 态动作行只渲 approve+request_changes，merge 在确认后由 next_action 原地换入。
      proposal.proposalActionCount === String([
        surface.page_vms.proposal.review_actions.approve,
        surface.page_vms.proposal.review_actions.request_changes
      ].filter(Boolean).length) &&
      proposal.proposalEvidenceCount === String(surface.page_vms.proposal.evidence_refs.length) &&
      proposal.proposalConflictCount === String(proposalConflictsFromSurface(surface).length) &&
      cost &&
      cost.costTotalTokens === String(surface.page_vms.cost.token_in + surface.page_vms.cost.token_out) &&
      cost.costTotalCny === surface.page_vms.cost.total_cost_cny &&
      cost.costBudgetCount === String(surface.page_vms.cost.budget.length) &&
      cost.costModelCount === String(surface.page_vms.cost.model_breakdown.length) &&
      agents &&
      agents.agentPlanCount === String(agentsVm.plans.length) &&
      agents.agentRecentCount === String(agentsVm.recent_escalations.length) &&
      agents.agentActiveTeams === String(agentsVm.kpis.active_team_count) &&
      agents.agentWaitingDecision === String(agentsVm.kpis.waiting_decision_count) &&
      agents.agentKpiCount === "4" &&
      agents.agentPlanCardCount === "1" &&
      agents.agentRecentAccordion === "true" &&
      agents.agentMobileMode === "single-column" &&
      agents.agentEmpty === "false" &&
      skills &&
      skills.skillActiveCount === String(skillsVm.totals.active) &&
      skills.skillAiAuthoredCount === String(skillsVm.totals.ai_authored) &&
      skills.skillRefinedCount === String(skillsVm.totals.refined) &&
      skills.skillCardCount === String(skillsVm.skills.length) &&
      skills.skillRefinedBadge === "true" &&
      skills.skillEmpty === "false" &&
      settings &&
      settings.settingsPetModelInWeb === "false" &&
      settings.settingsWorkerCount === "2" &&
      settings.settingsRuntimeStatus === "ready" &&
      settings.settingsActiveLocale === "en-US" &&
      settings.settingsPreferenceLocale === "en-US" &&
      settings.settingsPreferenceSynced === "true" &&
      settings.settingsSecretSafe === "true" &&
      settings.settingsRestoreRequiresDesktop === "true" &&
      settings.settingsWebLocalActions === "false"
  );
}

async function main() {
  const chromePath = findChrome();
  if (!chromePath) {
    throw new Error("Chrome/Chromium is required. Set CHROME_PATH to run R4.5 live browser route interaction QA.");
  }

  await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });

  const surface = productSurface();
  const requests: ApiRequestRecord[] = [];
  const apiServer = createMockApiServer(surface, requests);
  let viteServer: ViteDevServer | undefined;
  let chrome: { child: ChildProcessWithoutNullStreams; cdp: CdpClient } | undefined;
  const userDataDir = path.join(os.tmpdir(), `workhub-r4-live-route-${Date.now()}`);

  try {
    const apiPort = await listen(apiServer);
    const vitePort = await freePort();
    const debugPort = await freePort();
    const apiTarget = `http://127.0.0.1:${apiPort}`;
    viteServer = await createViteServer({
      configFile: false,
      root: webRoot,
      server: {
        host: "127.0.0.1",
        port: vitePort,
        strictPort: true,
        proxy: {
          "/api": apiTarget,
          "/openapi.json": apiTarget
        }
      }
    });
    await viteServer.listen();
    const baseUrl = `http://127.0.0.1:${vitePort}`;
    chrome = await launchChrome(chromePath, debugPort, userDataDir);
    const steps = await runScenario(chrome.cdp, baseUrl);
    await navigateFileAndCaptureContactSheet(chrome.cdp, steps);
    const contactSheetFresh = await contactSheetFreshness({ outputDir, steps });
    const proof = requestProof(requests);
    const readyProductSteps = steps.filter((step) => step.audit.productShell && step.audit.status === "ready");
    const routePageVmByComponent: Record<string, string> = {
      home: "attention",
      projects: "projects",
      "project-home": "project-home",
      intake: "session",
      approvals: "approvals",
      workitem: "workitem",
      proposal: "proposal",
      drive: "drive",
      meetings: "meetings",
      notifications: "notifications",
      calendar: "calendar",
      health: "health",
      replay: "replay",
      cost: "cost",
      agents: "agents",
      knowledge: "evidence",
      skills: "skills",
      settings: "settings"
    };
    const routeAdapterPageVmTruth = (step: StepReport) => {
      if (step.audit.routeComponent === "intake" && step.audit.routeComponentSource === "project-bootstrap") {
        return step.audit.routeTreePageVm === "session" &&
          step.audit.hydrationPageVm === "project_bootstrap" &&
          step.audit.hydrationPanelPageVm === "project_bootstrap";
      }
      const expected = routePageVmByComponent[step.audit.routeComponent ?? ""];
      return step.audit.routeTreePageVm === expected &&
        step.audit.hydrationPageVm === expected &&
        step.audit.hydrationPanelPageVm === expected;
    };
    const migratedReactSteps = readyProductSteps.filter((step) => Boolean(step.audit.routeComponent && r4ReactComponentByRoute[step.audit.routeComponent]));
    const gates = {
      dev_server_started: Boolean(viteServer.httpServer?.listening),
      screenshots_captured: steps.every((step) => existsSync(path.join(outputDir, step.screenshot))) && existsSync(path.join(outputDir, "contact-sheet.png")),
      contact_sheet_fresh: contactSheetFresh.ok,
      path_nav_clicks: steps.some((step) => step.id === "02-approvals-click-zh-desktop" && step.audit.pathname === "/approvals") &&
        steps.some((step) => step.id === "03-workitem-click-zh-desktop-route-component" && step.audit.pathname === "/workitems/r4-live-workitem"),
      history_back_forward: steps.some((step) => step.id === "04-history-back-approvals" && step.audit.pathname === "/approvals") &&
        steps.some((step) => step.id === "05-history-forward-workitem" && step.audit.pathname === "/workitems/r4-live-workitem"),
      locale_toggle_reload: steps.some((step) => step.id === "06-locale-toggle-en-workitem-route-component" && step.audit.lang === "en-US" && step.audit.enChrome && step.audit.activeLocale === "en-US"),
      ready_empty_forbidden_notfound_routes: ["ready", "empty", "forbidden", "notFound"].every((status) => steps.some((step) => step.audit.status === status)),
      ready_routes_use_page_vm_endpoints: proof.attention && proof.approvals && proof.workitem && proof.workitemEn && proof.projects && proof.projectHome && proof.proposal && proof.conflicts && proof.drive && proof.meetings && proof.notifications && proof.calendar && proof.cost && proof.agents && proof.skills && proof.settings && proof.replay && proof.localePatch,
      r4_14_ready_routes_use_session_knowledge_endpoints:
        proof.session &&
        proof.sessionEn &&
        proof.nextQuestion &&
        proof.createWorkItem &&
        proof.knowledge &&
        proof.evidenceBinding,
      r4_10_home_approvals_replay_route_components:
        steps.some((step) =>
          step.id === "01-home-zh-desktop" &&
          step.audit.routeComponent === "home" &&
          step.audit.routeComponentSource === "page-vm" &&
          step.audit.routeComponentActive &&
          step.audit.routeData.homeProjectDesk === "true" &&
          step.audit.routeData.homeProjectCount === "2" &&
          step.audit.routeData.homeDriveCta === `/drive?project_id=${qaProjectId}`
        ) &&
        steps.some((step) => step.id === "02-approvals-click-zh-desktop" && step.audit.routeComponent === "approvals" && step.audit.routeComponentSource === "page-vm" && step.audit.routeComponentActive) &&
        steps.some((step) => step.id === "15-replay-en-desktop-route-component" && step.audit.routeComponent === "replay" && step.audit.routeComponentSource === "page-vm" && step.audit.routeComponentActive),
      r4_11_workitem_proposal_cost_settings_route_components:
        hasActiveComponent(steps, "03-workitem-click-zh-desktop-route-component", "workitem") &&
        hasActiveComponent(steps, "11-proposal-en-mobile-scrolled-notice-route-component", "proposal") &&
        hasActiveComponent(steps, "12-cost-en-mobile-route-component", "cost") &&
        hasActiveComponent(steps, "13-settings-en-desktop-route-component", "settings"),
      r8_projects_project_home_route_components:
        proof.projects &&
        proof.projectHome &&
        proof.createNamedProject &&
        proof.advancedPayloads.createNamedProjectName &&
        proof.counts.projects >= 1 &&
        proof.counts.projectHome >= 3 &&
        proof.counts.createNamedProject === 1 &&
        hasActiveComponent(steps, "15ab-projects-en-desktop-route-component", "projects") &&
        hasActiveComponent(steps, "15aba-project-create-named-en-desktop", "project-home") &&
        hasActiveComponent(steps, "15ac-project-home-en-desktop-route-component", "project-home") &&
        steps.some((step) =>
          step.id === "15ab-projects-en-desktop-route-component" &&
          step.audit.routeData.projectsCount === "2" &&
          !step.audit.horizontalOverflow &&
          step.audit.textOverflowCount === 0
        ) &&
        steps.some((step) =>
          step.id === "15aba-project-create-named-en-desktop" &&
          step.audit.notice.kind === "action_success" &&
          step.audit.notice.actionId === "create_named_project" &&
          step.audit.routeData.projectHomeId === qaCreatedProjectId &&
          step.audit.routeData.projectHomeOpenCount === "0" &&
          step.audit.routeData.projectHomeFileCount === "0" &&
          !step.audit.horizontalOverflow &&
          step.audit.textOverflowCount === 0
        ) &&
        steps.some((step) =>
          step.id === "15ac-project-home-en-desktop-route-component" &&
          step.audit.routeData.projectHomeId === qaProjectId &&
          step.audit.routeData.projectHomeSlug === "regional-launch" &&
          step.audit.routeData.projectHomeOpenCount === "2" &&
          step.audit.routeData.projectHomeItemCount === "2" &&
          step.audit.routeData.projectHomeFileCount === "3" &&
          step.audit.routeData.projectHomeMoreCount === "1" &&
          step.audit.routeData.projectHomeFilesMoreCount === "1" &&
          !step.audit.horizontalOverflow &&
          step.audit.textOverflowCount === 0
        ) &&
        steps.some((step) =>
          step.id === "15ad-project-home-new-task-intake-en-desktop" &&
          step.audit.routeComponent === "intake" &&
          step.audit.routeComponentActive &&
          step.audit.routeSpecificMarker &&
          step.audit.routeComponentSource === "project-bootstrap" &&
          step.audit.routeData.intakeOptionCount === null &&
          !step.audit.horizontalOverflow &&
          step.audit.textOverflowCount === 0
        ),
      r5_1_drive_route_component:
        hasActiveComponent(steps, "15b-drive-en-desktop-route-component", "drive") &&
        proof.drive &&
        proof.driveProjectParam &&
        proof.counts.drive >= 1 &&
        steps.some((step) =>
          step.id === "15b-drive-en-desktop-route-component" &&
          step.audit.routeComponentSource === "page-vm" &&
          step.audit.routeData.driveProjectId === "10000000-0000-4000-8000-000000001600" &&
          step.audit.routeData.driveItemCount === "2" &&
          step.audit.routeData.driveVersionCount === "2" &&
          step.audit.routeData.driveAcceptedCount === "1" &&
          step.audit.routeData.driveCommentCount === "1" &&
          step.audit.routeData.driveDeletedCount === "0" &&
          step.audit.routeData.driveOperationCount === "1" &&
          !step.audit.horizontalOverflow &&
          step.audit.textOverflowCount === 0
        ),
      r5_2_drive_upload_recycle_operation_log:
        proof.counts.drive === 8 &&
        proof.counts.driveUpload === 1 &&
        proof.counts.driveDelete === 1 &&
        proof.counts.driveRestore === 1 &&
        proof.advancedPayloads.driveUploadFilename &&
        proof.driveItemParam &&
        proof.advancedPayloads.driveDeleteExpectedCurrent &&
        steps.some((step) =>
          step.id === "15c-drive-upload-success-en-desktop" &&
          step.audit.notice.kind === "action_success" &&
          step.audit.notice.actionId === "drive_upload_file" &&
          step.audit.routeData.driveCanManage === "true" &&
          step.audit.routeData.driveItemCount === "3" &&
          step.audit.routeData.driveVersionCount === "3" &&
          step.audit.routeData.driveDeletedCount === "0" &&
          step.audit.routeData.driveOperationCount === "4" &&
          !step.audit.horizontalOverflow &&
          step.audit.textOverflowCount === 0
        ) &&
        steps.some((step) =>
          step.id === "15ca-drive-uploaded-item-deeplink-en-desktop" &&
          step.audit.pathname === "/drive" &&
          step.audit.search.includes(`item_id=${qaManualDriveItemId}`) &&
          step.audit.routeData.driveSelectedItemId === qaManualDriveItemId &&
          step.audit.routeData.driveItemCount === "3" &&
          step.audit.routeData.driveVersionCount === "3" &&
          step.audit.routeData.driveOperationCount === "4" &&
          !step.audit.horizontalOverflow &&
          step.audit.textOverflowCount === 0
        ) &&
        steps.some((step) =>
          step.id === "15d-drive-delete-success-en-desktop" &&
          step.audit.notice.kind === "action_success" &&
          step.audit.notice.actionId === "drive_delete_item" &&
          step.audit.routeData.driveItemCount === "2" &&
          step.audit.routeData.driveDeletedCount === "1" &&
          step.audit.routeData.driveOperationCount === "5" &&
          !step.audit.horizontalOverflow &&
          step.audit.textOverflowCount === 0
        ) &&
        steps.some((step) =>
          step.id === "15e-drive-restore-success-en-desktop" &&
          step.audit.notice.kind === "action_success" &&
          step.audit.notice.actionId === "drive_restore_item" &&
          step.audit.routeData.driveItemCount === "3" &&
          step.audit.routeData.driveDeletedCount === "0" &&
          step.audit.routeData.driveOperationCount === "6" &&
          !step.audit.horizontalOverflow &&
          step.audit.textOverflowCount === 0
        ),
      r5_3_drive_comment_to_draft:
        proof.driveCommentDraft &&
        proof.counts.driveCommentDraft === 1 &&
        proof.advancedPayloads.driveCommentDraftRequest &&
        steps.some((step) =>
          step.id === "15bb-drive-comment-to-draft-success-en-desktop" &&
          step.audit.notice.kind === "action_success" &&
          step.audit.notice.actionId === "comment_to_draft" &&
          step.audit.routeData.driveProjectId === "10000000-0000-4000-8000-000000001600" &&
          step.audit.routeData.driveItemCount === "2" &&
          step.audit.routeData.driveVersionCount === "2" &&
          step.audit.routeData.driveAcceptedCount === "1" &&
          step.audit.routeData.driveCommentCount === "1" &&
          step.audit.routeData.driveDeletedCount === "0" &&
          step.audit.routeData.driveOperationCount === "2" &&
          !step.audit.horizontalOverflow &&
          step.audit.textOverflowCount === 0
        ),
      r5_4_drive_draft_to_proposal:
        proof.driveDraftProposal &&
        proof.counts.driveDraftProposal === 1 &&
        proof.advancedPayloads.driveDraftProposalRequest &&
        steps.some((step) =>
          step.id === "15bc-drive-open-workitem-draft-en-desktop" &&
          step.audit.routeComponent === "workitem" &&
          step.audit.routeData.workitemSourceContext === "drive_comment" &&
          step.audit.routeData.workitemSourceCommentId === "10000000-0000-4000-8000-000000001623" &&
          step.audit.routeData.workitemCreateProposalAction === "true" &&
          !step.audit.horizontalOverflow &&
          step.audit.textOverflowCount === 0
        ) &&
        steps.some((step) =>
          step.id === "15bd-drive-draft-to-proposal-success-en-desktop" &&
          step.audit.notice.kind === "action_success" &&
          step.audit.notice.actionId === "drive_draft_to_proposal" &&
          step.audit.routeData.workitemSourceContext === "drive_comment" &&
          step.audit.routeData.workitemSourceProposalId === driveDraftProposalId &&
          step.audit.routeData.workitemCreateProposalAction === "false" &&
          !step.audit.horizontalOverflow &&
          step.audit.textOverflowCount === 0
        ) &&
        steps.some((step) =>
          step.id === "15be-drive-proposal-link-en-desktop" &&
          step.audit.routeComponent === "drive" &&
          step.audit.routeData.driveProposalLink === "true" &&
          step.audit.routeData.driveProposalHref === `/proposals/${driveDraftProposalId}` &&
          step.audit.routeData.driveProposalStatus === "opened" &&
          step.audit.routeData.driveOperationCount === "3" &&
          !step.audit.horizontalOverflow &&
          step.audit.textOverflowCount === 0
        ),
      r5_5_meeting_insight_to_draft:
        proof.meetings &&
        proof.meetingsProjectParam &&
        proof.meetingWorkitem &&
        proof.meetingInsightDraft &&
        proof.meetingDraftProposal &&
        proof.counts.meetings === 3 &&
        proof.counts.meetingWorkitem >= 2 &&
        proof.counts.meetingInsightDraft === 1 &&
        proof.counts.meetingInsightDismiss === 0 &&
        proof.counts.meetingDraftProposal === 1 &&
        proof.advancedPayloads.meetingInsightDraftRequest &&
        proof.advancedPayloads.meetingDraftProposalRequest &&
        steps.some((step) =>
          step.id === "15f-meetings-insight-en-desktop" &&
          step.audit.routeComponent === "meetings" &&
          step.audit.routeData.meetingProjectId === meetingProjectId &&
          step.audit.routeData.meetingSelectedId === meetingId &&
          step.audit.routeData.meetingCount === "1" &&
          step.audit.routeData.meetingPendingInsights === "1" &&
          step.audit.routeData.meetingConfirmedInsights === "0" &&
          step.audit.routeData.meetingDismissedInsights === "0" &&
          step.audit.routeData.meetingCanManage === "true" &&
          step.audit.routeData.meetingInsightId === meetingInsightId &&
          step.audit.routeData.meetingInsightStatus === "pending" &&
          step.audit.routeData.meetingDraftLink === "false" &&
          step.audit.routeData.meetingProposalLink === "false" &&
          !step.audit.horizontalOverflow &&
          step.audit.textOverflowCount === 0
        ) &&
        steps.some((step) =>
          step.id === "15g-meeting-insight-draft-en-desktop" &&
          step.audit.notice.kind === "action_success" &&
          step.audit.notice.actionId === "meeting_insight_to_draft" &&
          step.audit.routeData.meetingPendingInsights === "0" &&
          step.audit.routeData.meetingConfirmedInsights === "1" &&
          step.audit.routeData.meetingInsightStatus === "confirmed" &&
          step.audit.routeData.meetingDraftLink === "true" &&
          step.audit.routeData.meetingDraftHref === `/workitems/${meetingWorkItemId}` &&
          step.audit.routeData.meetingProposalLink === "false" &&
          !step.audit.horizontalOverflow &&
          step.audit.textOverflowCount === 0
        ) &&
        steps.some((step) =>
          step.id === "15h-meeting-workitem-source-en-desktop" &&
          step.audit.routeComponent === "workitem" &&
          step.audit.routeData.workitemSourceContext === "meeting_insight" &&
          step.audit.routeData.workitemSourceMeetingId === meetingId &&
          step.audit.routeData.workitemSourceInsightId === meetingInsightId &&
          step.audit.routeData.workitemCreateProposalAction === "true" &&
          !step.audit.horizontalOverflow &&
          step.audit.textOverflowCount === 0
        ) &&
        steps.some((step) =>
          step.id === "15i-meeting-draft-proposal-en-desktop" &&
          step.audit.notice.kind === "action_success" &&
          step.audit.notice.actionId === "meeting_draft_to_proposal" &&
          step.audit.routeData.workitemSourceContext === "meeting_insight" &&
          step.audit.routeData.workitemSourceProposalId === meetingDraftProposalId &&
          step.audit.routeData.workitemCreateProposalAction === "false" &&
          !step.audit.horizontalOverflow &&
          step.audit.textOverflowCount === 0
        ) &&
        steps.some((step) =>
          step.id === "15j-meetings-en-mobile-no-overflow" &&
          step.audit.routeComponent === "meetings" &&
          step.audit.routeData.meetingPendingInsights === "0" &&
          step.audit.routeData.meetingConfirmedInsights === "1" &&
          step.audit.routeData.meetingInsightStatus === "confirmed" &&
          step.audit.routeData.meetingDraftLink === "true" &&
          step.audit.routeData.meetingProposalLink === "true" &&
          step.audit.routeData.meetingProposalHref === `/proposals/${meetingDraftProposalId}` &&
          step.audit.routeData.meetingProposalStatus === "opened" &&
          !step.audit.horizontalOverflow &&
          !step.audit.navHorizontalOverflow &&
          step.audit.textOverflowCount === 0
        ),
      r5_6_schedule_notify_routes:
        proof.notifications &&
        proof.calendar &&
        proof.calendarWeekQuery &&
        proof.notificationMarkRead &&
        proof.notificationDismiss &&
        proof.notificationMarkAllRead &&
        proof.notificationComplete &&
        proof.counts.notifications === 7 &&
        proof.counts.calendar === 2 &&
        proof.counts.notificationMarkRead === 1 &&
        proof.counts.notificationDismiss === 1 &&
        proof.counts.notificationMarkAllRead === 1 &&
        proof.counts.notificationComplete === 1 &&
        steps.some((step) =>
          step.id === "15k-notifications-en-desktop" &&
          step.audit.routeComponent === "notifications" &&
          step.audit.routeData.notificationTotalCount === "2" &&
          step.audit.routeData.notificationUnreadCount === "2" &&
          step.audit.routeData.notificationNeedsDecisionCount === "1" &&
          step.audit.routeData.notificationFyiCount === "1" &&
          step.audit.routeData.notificationDoneCount === "0" &&
          step.audit.routeData.notificationMeetingItemStatus === "unread" &&
          step.audit.routeData.notificationMeetingSourceType === "meeting_insight" &&
          step.audit.routeData.notificationMeetingOpenHref === `/meetings?project_id=${meetingProjectId}&m=${meetingId}&insight_id=${meetingInsightId}` &&
          step.audit.routeData.notificationDriveOpenHref === "/drive?project_id=10000000-0000-4000-8000-000000001600" &&
          step.audit.routeData.notificationMarkReadAction === "true" &&
          step.audit.routeData.notificationDismissAction === "true" &&
          step.audit.routeData.notificationCompleteAction === "true" &&
          !step.audit.horizontalOverflow &&
          step.audit.textOverflowCount === 0
        ) &&
        steps.some((step) =>
          step.id === "15l-notification-mark-read-en-desktop" &&
          step.audit.notice.kind === "action_success" &&
          step.audit.notice.actionId === "notification_mark_read" &&
          step.audit.routeData.notificationUnreadCount === "1" &&
          step.audit.routeData.notificationMeetingItemStatus === "read"
        ) &&
        steps.some((step) =>
          step.id === "15m-notification-dismiss-en-desktop" &&
          step.audit.notice.kind === "action_success" &&
          step.audit.notice.actionId === "notification_dismiss" &&
          step.audit.routeData.notificationNeedsDecisionCount === "0" &&
          step.audit.routeData.notificationDoneCount === "1" &&
          step.audit.routeData.notificationMeetingItemStatus === "done"
        ) &&
        steps.some((step) =>
          step.id === "15n-notification-mark-all-read-en-desktop" &&
          step.audit.notice.kind === "action_success" &&
          step.audit.notice.actionId === "notification_mark_all_read" &&
          step.audit.routeData.notificationUnreadCount === "0" &&
          step.audit.routeData.notificationDriveItemStatus === "read"
        ) &&
        steps.some((step) =>
          step.id === "15o-notification-complete-en-desktop" &&
          step.audit.notice.kind === "action_success" &&
          step.audit.notice.actionId === "notification_complete" &&
          step.audit.routeData.notificationFyiCount === "0" &&
          step.audit.routeData.notificationDoneCount === "2" &&
          step.audit.routeData.notificationDriveItemStatus === "done"
        ) &&
        steps.some((step) =>
          step.id === "15p-notifications-en-mobile-no-overflow" &&
          step.audit.routeComponent === "notifications" &&
          !step.audit.horizontalOverflow &&
          !step.audit.navHorizontalOverflow &&
          step.audit.textOverflowCount === 0
        ) &&
        steps.some((step) =>
          step.id === "15q-calendar-en-desktop" &&
          step.audit.routeComponent === "calendar" &&
          step.audit.routeData.calendarDate === "2026-06-11" &&
          step.audit.routeData.calendarView === "week" &&
          step.audit.routeData.calendarBlockCount === "2" &&
          step.audit.routeData.calendarTodayCount === "1" &&
          step.audit.routeData.calendarWorkItemBlock === "10000000-0000-4000-8000-000000001811" &&
          step.audit.routeData.calendarMeetingBlock === "10000000-0000-4000-8000-000000001812" &&
          step.audit.routeData.calendarDayCount === "1" &&
          step.audit.routeData.calendarOpenTarget === "true" &&
          !step.audit.horizontalOverflow &&
          step.audit.textOverflowCount === 0
        ) &&
        steps.some((step) =>
          step.id === "15r-calendar-en-mobile-no-overflow" &&
          step.audit.routeComponent === "calendar" &&
          !step.audit.horizontalOverflow &&
          !step.audit.navHorizontalOverflow &&
          step.audit.textOverflowCount === 0
        ) &&
        steps.some((step) =>
          step.id === "15qa-calendar-open-target-workitem-en-desktop" &&
          step.audit.routeComponent === "workitem" &&
          step.audit.routeData.workitemSourceContext === "meeting_insight" &&
          !step.audit.horizontalOverflow &&
          step.audit.textOverflowCount === 0
        ),
      r5_7_health_grounding_routes:
        proof.health &&
        proof.knowledgeSourceRef &&
        proof.counts.health === 2 &&
        steps.some((step) =>
          step.id === "15s-health-en-desktop" &&
          step.audit.routeComponent === "health" &&
          step.audit.routeData.healthViewerScope === "member" &&
          step.audit.routeData.healthProjectCount === "1" &&
          step.audit.routeData.healthAttentionCount === "1" &&
          step.audit.routeData.healthCardBand === "attention" &&
          step.audit.routeData.healthBandsOnly === "true" &&
          step.audit.routeData.healthOpenProject === "true" &&
          step.audit.routeData.healthSignalCount === "5" &&
          !step.audit.horizontalOverflow &&
          step.audit.textOverflowCount === 0
        ) &&
        steps.some((step) =>
          step.id === "15t-health-en-mobile-no-overflow" &&
          step.audit.routeComponent === "health" &&
          !step.audit.horizontalOverflow &&
          !step.audit.navHorizontalOverflow &&
          step.audit.textOverflowCount === 0
        ) &&
        steps.some((step) =>
          step.id === "15sa-health-open-project-en-desktop" &&
          step.audit.routeComponent === "project-home" &&
          step.audit.routeData.projectHomeId === meetingProjectId &&
          !step.audit.horizontalOverflow &&
          step.audit.textOverflowCount === 0
        ) &&
        steps.some((step) =>
          step.id === "15k-notifications-en-desktop" &&
          step.audit.routeData.notificationGrounding === "true" &&
          (step.audit.routeData.notificationEvidenceSearchRef ?? "").includes(`source_ref=notification:${notificationMeetingId}`)
        ) &&
        steps.some((step) =>
          step.id === "15u-notification-evidence-jump-en-desktop" &&
          step.audit.routeComponent === "knowledge" &&
          step.audit.routeData.knowledgeSourceRef === `notification:${notificationMeetingId}` &&
          !step.audit.horizontalOverflow &&
          step.audit.textOverflowCount === 0
        ),
      r8_skills_route_component:
        proof.skills &&
        proof.counts.skills === 2 &&
        steps.some((step) =>
          step.id === "15v-skills-en-desktop-route-component" &&
          step.audit.routeComponent === "skills" &&
          step.audit.routeComponentSource === "page-vm" &&
          step.audit.routeData.skillActiveCount === "2" &&
          step.audit.routeData.skillAiAuthoredCount === "1" &&
          step.audit.routeData.skillRefinedCount === "1" &&
          step.audit.routeData.skillCardCount === "2" &&
          step.audit.routeData.skillRefinedBadge === "true" &&
          step.audit.routeData.skillEmpty === "false" &&
          !step.audit.horizontalOverflow &&
          step.audit.textOverflowCount === 0
        ) &&
        steps.some((step) =>
          step.id === "15w-skills-en-mobile-no-overflow" &&
          step.audit.routeComponent === "skills" &&
          !step.audit.horizontalOverflow &&
          !step.audit.navHorizontalOverflow &&
          step.audit.textOverflowCount === 0
        ),
      r9_6_agent_army_route_component:
        proof.agents &&
        proof.counts.agents === 2 &&
        steps.some((step) =>
          step.id === "12aa-agents-en-desktop-route-component" &&
          step.audit.routeComponent === "agents" &&
          step.audit.routeComponentSource === "page-vm" &&
          step.audit.routeData.agentPlanCount === "1" &&
          step.audit.routeData.agentRecentCount === "1" &&
          step.audit.routeData.agentActiveTeams === "1" &&
          step.audit.routeData.agentWaitingDecision === "2" &&
          step.audit.routeData.agentKpiCount === "4" &&
          step.audit.routeData.agentPlanCardCount === "1" &&
          step.audit.routeData.agentRecentAccordion === "true" &&
          step.audit.routeData.agentEmpty === "false" &&
          !step.audit.horizontalOverflow &&
          step.audit.textOverflowCount === 0
        ) &&
        steps.some((step) =>
          step.id === "12ab-agents-en-mobile-no-overflow" &&
          step.audit.routeComponent === "agents" &&
          step.audit.routeData.agentMobileMode === "single-column" &&
          !step.audit.horizontalOverflow &&
          !step.audit.navHorizontalOverflow &&
          step.audit.textOverflowCount === 0
        ),
      r5_9_onboarding_routes:
        proof.identifyRegistration &&
        proof.identifySecondUser &&
        proof.logout &&
        proof.counts.identify === 2 &&
        proof.counts.logout === 1 &&
        steps.some((step) =>
          step.id === "00-onboarding-zh-desktop" &&
          step.audit.status === "onboarding" &&
          step.audit.routeData.onboardingScreen === "true" &&
          step.audit.routeData.onboardingLocale === "zh-CN" &&
          step.audit.routeData.onboardingNicknameInput === "true" &&
          step.audit.routeData.onboardingAdminToggle === "true" &&
          !step.audit.horizontalOverflow &&
          step.audit.textOverflowCount === 0
        ) &&
        steps.some((step) =>
          step.id === "00a-onboarding-zh-mobile-no-overflow" &&
          step.audit.status === "onboarding" &&
          !step.audit.horizontalOverflow &&
          step.audit.textOverflowCount === 0
        ) &&
        steps.some((step) =>
          step.id === "01-home-zh-desktop" &&
          step.audit.routeData.currentUserChip === "R4 Live Reviewer" &&
          step.audit.routeData.logoutAction === "true"
        ) &&
        steps.some((step) =>
          step.id === "19-logout-onboarding-en-desktop" &&
          step.audit.status === "onboarding" &&
          step.audit.routeData.onboardingLocale === "en-US" &&
          step.audit.routeData.onboardingTarget === "/approvals" &&
          step.audit.locationHash === "" &&
          !step.audit.horizontalOverflow &&
          step.audit.textOverflowCount === 0
        ) &&
        steps.some((step) =>
          step.id === "19a-second-user-deeplink-en-desktop" &&
          step.audit.status === "ready" &&
          step.audit.pathname === "/approvals" &&
          step.audit.routeComponent === "approvals" &&
          step.audit.routeData.currentUserChip === "Pilot Two" &&
          step.audit.routeData.currentUserAdmin === "false"
        ),
      r4_11_route_component_source_truth: steps
        .filter((step) => step.audit.productShell && step.audit.status === "ready" && !["intake", "knowledge"].includes(step.audit.routeComponent ?? ""))
        .every((step) => step.audit.routeComponentSource === "page-vm"),
      r4_11_route_specific_markers: steps
        .filter((step) => step.audit.productShell && step.audit.status === "ready")
        .every((step) => step.audit.routeSpecificMarker),
      r4_11_vm_dom_value_match: vmDomValueMatches(steps, surface),
      r4_12_approval_response_notice:
        steps.some((step) => step.id === "02a-approval-deny-reason-gate-zh-desktop" && step.audit.notice.kind === "reason_required" && step.audit.notice.actionId === "deny" && step.audit.notice.locale === "zh-CN" && step.audit.notice.reasonButtonCount >= 3) &&
        steps.some((step) => step.id === "02b-approval-deny-success-zh-desktop" && step.audit.notice.kind === "action_success" && step.audit.notice.actionId === "deny" && step.audit.notice.locale === "zh-CN") &&
        steps.some((step) => step.id === "02c-approval-approve-success-zh-desktop" && step.audit.notice.kind === "action_success" && step.audit.notice.actionId === "approve" && step.audit.notice.locale === "zh-CN") &&
        proof.counts.approvalRespond === 2,
      r4_12_reason_gate_blocks_without_reason:
        steps.some((step) => step.id === "07-proposal-reason-gate-en-desktop" && step.audit.notice.kind === "reason_required" && step.audit.notice.reasonButtonCount >= 3) &&
        // 两段流下 review POST=2：带理由的 request_changes + approve（无需理由）；仍证明无理由点击被门拦住没偷跑 POST。
        proof.counts.proposalReview === 2,
      r4_12_request_changes_success_notice:
        steps.some((step) => step.id === "08-proposal-request-changes-success-en-desktop" && step.audit.notice.kind === "action_success" && step.audit.notice.actionId === "request_changes" && step.audit.notice.locale === "en-US"),
      r4_12_merge_success_notice:
        steps.some((step) => step.id === "09-proposal-merge-success-en-desktop" && step.audit.notice.kind === "action_success" && step.audit.notice.actionId === "merge" && step.audit.notice.tone === "success") &&
        proof.counts.proposalMerge === 1,
      r4_12_sse_refresh_notice:
        steps.some((step) => step.id === "10-proposal-sse-refresh-notice-en-desktop" && step.audit.notice.kind === "sse_refresh" && step.audit.notice.source === "sse" && step.audit.notice.eventType === "proposal.merged" && step.audit.notice.stream === "proposal" && Number(step.audit.live.refreshCount ?? "0") >= 1) &&
        proof.counts.qaEmit >= 3,
      r4_12_budget_warning_notice:
        steps.some((step) => step.id === "12a-cost-budget-warning-notice-en-mobile" && step.audit.notice.kind === "budget_warning" && step.audit.notice.source === "sse" && step.audit.notice.eventType === "budget.warning" && step.audit.notice.tone === "warning" && !step.audit.horizontalOverflow),
      r4_12_desktop_gate_fail_closed:
        steps.some((step) => step.id === "14-settings-desktop-gate-en-desktop" && step.audit.pathname === "/settings" && step.audit.search === "" && step.audit.notice.kind === "desktop_required" && step.audit.notice.actionId === "open_desktop_settings"),
      r4_12_retry_access_route_states:
        steps.some((step) => step.id === "17-forbidden-workitem-desktop" && step.audit.routeState.kind === "forbidden" && step.audit.routeState.actionText === "Go somewhere you can access") &&
        steps.some((step) => step.id === "18-unknown-route-notfound" && step.audit.routeState.kind === "notFound" && step.audit.routeState.actionText === "Back to home"),
      r4_12_mobile_notice_no_overflow:
        steps.some((step) => step.id === "11-proposal-en-mobile-scrolled-notice-route-component" && step.audit.notice.kind === "sse_refresh" && !step.audit.horizontalOverflow && step.audit.textOverflowCount === 0),
      r4_13_proposal_advanced_route_dom:
        steps.some((step) =>
          step.id === "06a-proposal-advanced-review-en-desktop" &&
          step.audit.routeData.proposalConflictCount === "2" &&
          step.audit.routeData.proposalLineEditorFileCount === "1" &&
          step.audit.routeData.proposalLineEditorHunkCount === "1" &&
          step.audit.routeData.proposalStructuredFieldEditorCount === "2" &&
          step.audit.routeData.proposalSubrecordItemCount === "1"
        ),
      r4_13_proposal_advanced_route_sections:
        steps.some((step) =>
          step.id === "06a-proposal-advanced-review-en-desktop" &&
          step.audit.routeData.proposalAdvancedConflicts === "2" &&
          step.audit.routeData.proposalAdvancedLineEditor === "true" &&
          step.audit.routeData.proposalAdvancedFieldEditor === "true" &&
          step.audit.routeData.proposalAdvancedSubrecordEditor === "true"
        ),
      r4_13_advanced_apply_payloads:
        steps.some((step) => step.id === "06b-proposal-line-editor-apply-success-en-desktop" && step.audit.notice.kind === "action_success" && step.audit.notice.actionId === "apply_ai_fusion") &&
        steps.some((step) => step.id === "06c-proposal-task-plan-apply-success-en-desktop" && step.audit.notice.kind === "action_success" && step.audit.notice.actionId === "apply_ai_fusion") &&
        steps.some((step) => step.id === "06d-proposal-subrecord-apply-success-en-desktop" && step.audit.notice.kind === "action_success" && step.audit.notice.actionId === "apply_ai_fusion") &&
        steps.some((step) => step.id === "06f-proposal-custom-field-apply-success-en-desktop" && step.audit.notice.kind === "action_success" && step.audit.notice.actionId === "apply_ai_fusion") &&
        proof.counts.mergeApply === 4 &&
        proof.advancedPayloads.textHunkOverrides &&
        proof.advancedPayloads.taskPlanScope &&
        proof.advancedPayloads.structuredItemOverrides &&
        proof.advancedPayloads.structuredFieldOverrides &&
        proof.advancedPayloads.customFieldValue,
      r4_13_custom_field_fail_closed:
        steps.some((step) =>
          step.id === "06e-proposal-custom-field-empty-fail-closed-en-desktop" &&
          step.audit.notice.kind === "field_value_required" &&
          step.audit.notice.tone === "warning" &&
          step.audit.notice.source === "client" &&
          step.audit.notice.actionId === "apply_ai_fusion"
        ) &&
        proof.counts.mergeApply === 4,
      r4_13_conflict_api_source_truth:
        proof.counts.proposalConflicts === 2 &&
        steps.some((step) => step.id === "06a-proposal-advanced-review-en-desktop" && step.audit.routeData.proposalConflictCount === "2") &&
        steps.some((step) => step.id === "11-proposal-en-mobile-scrolled-notice-route-component" && step.audit.routeData.proposalConflictCount === "2" && !step.audit.horizontalOverflow),
      r4_13_structured_editor_visual_no_overflow:
        steps.some((step) =>
          step.id === "06g-proposal-structured-field-editor-visual-en-desktop" &&
          step.audit.routeData.proposalStructuredFieldEditorCount === "2" &&
          step.audit.routeData.proposalSubrecordItemCount === "1" &&
          !step.audit.horizontalOverflow &&
          step.audit.textOverflowCount === 0
        ),
      r4_13_proposal_advanced_regression:
        steps.some((step) => step.id === "06a-proposal-advanced-review-en-desktop" && step.audit.routeData.proposalAdvancedConflicts === "2") &&
        proof.counts.mergeApply === 4 &&
        proof.advancedPayloads.structuredFieldOverrides,
      r4_14_route_component_source_truth:
        steps.some((step) => step.id === "01a-intake-zh-desktop-route-component" && step.audit.routeComponentSource === "session-vm") &&
        steps.some((step) => step.id === "12b-knowledge-fallback-en-desktop-route-component" && step.audit.routeComponentSource === "evidence-bubble"),
      r4_14_intake_route_component:
        steps.some((step) =>
          step.id === "01a-intake-zh-desktop-route-component" &&
          step.audit.routeComponent === "intake" &&
          step.audit.routeData.intakeOptionCount === "2" &&
          step.audit.routeData.intakeProgressCount === "3" &&
          step.audit.routeData.intakeFreeTextCollapsed === "true" &&
          step.audit.routeData.intakeInputMode === "single_choice" &&
          step.audit.routeData.intakeOptionFirst === "true"
        ),
      r4_14_option_first_no_chat_wall:
        steps.some((step) =>
          step.id === "01a-intake-zh-desktop-route-component" &&
          step.audit.routeSpecificMarker &&
          step.audit.routeData.intakeSelectedCount === "0" &&
          !step.audit.horizontalOverflow &&
          step.audit.textOverflowCount === 0
        ),
      r4_14_intake_fail_closed:
        steps.some((step) =>
          step.id === "01b-intake-empty-fail-closed-zh-desktop" &&
          step.audit.notice.kind === "intake_option_required" &&
          step.audit.notice.tone === "warning" &&
          step.audit.notice.source === "client" &&
          step.audit.notice.actionId === "intake_continue"
        ) &&
        proof.counts.nextQuestion === 1,
      r4_14_intake_submit_success:
        steps.some((step) =>
          step.id === "01c-intake-next-question-success-zh-desktop" &&
          step.audit.notice.kind === "action_success" &&
          step.audit.notice.actionId === "intake_continue" &&
          step.audit.routeData.intakeInputMode === "confirm"
        ) &&
        proof.advancedPayloads.nextQuestionSelection,
      r4_14_intake_create_workitem_success:
        steps.some((step) =>
          step.id === "01d-intake-create-workitem-success-zh-desktop" &&
          step.audit.routeComponent === "workitem" &&
          step.audit.notice.kind === "action_success" &&
          step.audit.notice.actionId === "create_workitem"
        ) &&
        proof.counts.createWorkItem === 1 &&
        proof.advancedPayloads.createWorkItemSelection,
      r4_14_knowledge_fallback_route:
        steps.some((step) =>
          step.id === "12b-knowledge-fallback-en-desktop-route-component" &&
          step.audit.routeComponent === "knowledge" &&
          step.audit.routeData.knowledgeEvidenceCount === "2" &&
          step.audit.routeData.knowledgeActionCount === "2" &&
          step.audit.routeData.knowledgeMissing === "false"
        ) &&
        proof.counts.knowledgeSearch === 2 &&
        proof.advancedPayloads.knowledgeWorkItemFilter,
      r4_14_knowledge_bind_success:
        steps.some((step) =>
          step.id === "12c-knowledge-bind-success-en-desktop" &&
          step.audit.notice.kind === "action_success" &&
          step.audit.notice.actionId === "use_for_current_task"
        ) &&
        proof.counts.evidenceBinding === 1 &&
        proof.advancedPayloads.evidenceBindingRefs,
      r4_14_mobile_no_overflow:
        steps.some((step) =>
          step.id === "12d-intake-en-mobile-no-overflow" &&
          step.audit.routeComponent === "intake" &&
          !step.audit.horizontalOverflow &&
          !step.audit.navHorizontalOverflow &&
          step.audit.textOverflowCount === 0 &&
          !step.audit.topbarNavOverlap
        ),
      r4_15_settings_locale_persistence:
        proof.localePatch &&
        proof.localePatchFailureArmed &&
        proof.counts.preferencePatch === 4 &&
        proof.counts.preferenceFailureArmed === 1 &&
        steps.some((step) =>
          step.id === "13-settings-en-desktop-route-component" &&
          step.audit.routeData.settingsActiveLocale === "en-US" &&
          step.audit.routeData.settingsPreferenceLocale === "en-US" &&
          step.audit.routeData.settingsPreferenceSynced === "true"
        ) &&
        steps.some((step) =>
          step.id === "13a-settings-locale-persistence-fail-closed-en-desktop" &&
          step.audit.notice.kind === "locale_persistence_failed" &&
          step.audit.notice.actionId === "locale_switch" &&
          step.audit.lang === "en-US" &&
          step.audit.storedLocale === "en-US" &&
          step.audit.activeLocale === "en-US"
        ),
      r4_15_settings_secret_safe:
        steps.some((step) =>
          step.id === "13-settings-en-desktop-route-component" &&
          step.audit.routeData.settingsSecretSafe === "true" &&
          step.audit.routeData.settingsPetModelInWeb === "false" &&
          !step.audit.secretLeak
        ),
      r4_15_desktop_boundary_gate:
        steps.some((step) =>
          step.id === "14-settings-desktop-gate-en-desktop" &&
          step.audit.notice.kind === "desktop_required" &&
          step.audit.notice.actionId === "open_desktop_settings" &&
          step.audit.routeData.settingsRestoreRequiresDesktop === "true" &&
          step.audit.routeData.settingsWebLocalActions === "false" &&
          step.audit.routeData.settingsLocalBoundary === "true"
        ),
      r4_15_route_recovery_actions:
        steps.some((step) => step.id === "17-forbidden-workitem-desktop" && step.audit.routeState.kind === "forbidden" && step.audit.routeState.actionText === "Go somewhere you can access") &&
        steps.some((step) => step.id === "18-unknown-route-notfound" && step.audit.routeState.kind === "notFound" && step.audit.routeState.actionText === "Back to home") &&
        steps.some((step) => step.id === "14-settings-desktop-gate-en-desktop" && step.audit.notice.kind === "desktop_required"),
      r4_15_settings_mobile_no_overflow:
        steps.some((step) =>
          step.id === "14a-settings-en-mobile-boundary-no-overflow" &&
          step.audit.routeComponent === "settings" &&
          !step.audit.horizontalOverflow &&
          !step.audit.navHorizontalOverflow &&
          step.audit.textOverflowCount === 0 &&
          !step.audit.topbarNavOverlap
        ),
      r4_14_intake_knowledge_regression:
        steps.some((step) => step.id === "12d-intake-en-mobile-no-overflow" && step.audit.routeComponent === "intake") &&
        steps.some((step) => step.id === "12b-knowledge-fallback-en-desktop-route-component" && step.audit.routeComponent === "knowledge") &&
        proof.counts.nextQuestion === 1 &&
        proof.counts.evidenceBinding === 1,
      r4_16_hydration_boundary_marker: readyProductSteps.every((step) =>
        Boolean(step.audit.hydrationBoundary) &&
        step.audit.hydrationRoute === step.audit.routeComponent &&
        step.audit.hydrationPanelRoute === step.audit.routeComponent &&
        step.audit.hydrationMode === "html-fallback" &&
        step.audit.hydrationPanelMode === "html-fallback" &&
        step.audit.hydrationAdapter === "route-component-v1"
      ),
      r4_16_route_adapter_page_vm_truth: readyProductSteps.every((step) =>
        Boolean(step.audit.reactRouteTree) &&
        step.audit.routeTreeKey === step.audit.routeComponent &&
        step.audit.routeTreeMode === "html-fallback" &&
        step.audit.routeTreeAdapter === "route-component-v1" &&
        step.audit.routeTreeActiveOnly &&
        // R9.6 adds /dashboard/agents to the live route tree; the old exact count 17 was pre-dashboard.
        step.audit.routeTreeRouteCount === "18" &&
        routeAdapterPageVmTruth(step)
      ),
      r4_16_action_dispatcher_parity: readyProductSteps.every((step) =>
        step.audit.hydrationActionCount !== null &&
        step.audit.hydrationActionCount === step.audit.hydrationPanelActionCount
      ),
      r4_16_locale_settings_regression:
        steps.some((step) =>
          step.id === "13-settings-en-desktop-route-component" &&
          step.audit.hydrationRoute === "settings" &&
          step.audit.hydrationSource === "page-vm" &&
          step.audit.hydrationPageVm === "settings" &&
          step.audit.hydrationMode === "html-fallback" &&
          step.audit.routeData.settingsActiveLocale === "en-US" &&
          step.audit.routeData.settingsPreferenceSynced === "true"
        ) &&
        steps.some((step) =>
          step.id === "13a-settings-locale-persistence-fail-closed-en-desktop" &&
          step.audit.notice.kind === "locale_persistence_failed" &&
          step.audit.hydrationRoute === "settings"
        ),
      r4_16_active_only_regression: readyProductSteps.every((step) =>
        step.audit.panelCount === 1 &&
        step.audit.visiblePanelCount === 1 &&
        step.audit.hydrationPanelCount === 1 &&
        step.audit.routeComponentActive
      ),
      r4_17_react_component_marker:
        migratedReactSteps.some((step) => step.audit.routeComponent === "home" && step.audit.reactComponentName === "HomeRouteComponent") &&
        migratedReactSteps.some((step) => step.audit.routeComponent === "settings" && step.audit.reactComponentName === "SettingsRouteComponent") &&
        migratedReactSteps.every((step) =>
          step.audit.routeComponent !== null &&
          step.audit.reactComponentName === r4ReactComponentByRoute[step.audit.routeComponent] &&
          step.audit.reactComponentRoute === step.audit.routeComponent &&
          step.audit.routeTreeReactComponent === r4ReactComponentByRoute[step.audit.routeComponent] &&
          step.audit.hydrationReactComponent === r4ReactComponentByRoute[step.audit.routeComponent] &&
          step.audit.reactComponentAdapter === "react-compatible-route-component-v1" &&
          step.audit.routeTreeReactComponentAdapter === "react-compatible-route-component-v1" &&
          step.audit.hydrationReactComponentAdapter === "react-compatible-route-component-v1"
        ),
      r4_17_html_fallback_parity: migratedReactSteps.every((step) =>
        step.audit.reactComponentMode === "html-fallback" &&
        step.audit.reactComponentHtmlFallback &&
        step.audit.reactComponentPropsSource === "typed-page-vm" &&
        step.audit.hydrationReactComponentMode === "html-fallback" &&
        step.audit.hydrationReactComponentFallback &&
        step.audit.hydrationReactComponentPropsSource === "typed-page-vm" &&
        step.audit.routeTreeReactComponentFallback
      ),
      r4_17_action_dispatcher_single_path: migratedReactSteps.every((step) =>
        step.audit.reactComponentActionCount !== null &&
        step.audit.reactComponentActionCount === step.audit.hydrationActionCount &&
        step.audit.reactComponentActionCount === step.audit.hydrationPanelActionCount
      ),
      r4_17_settings_boundary_regression:
        steps.some((step) =>
          step.id === "13-settings-en-desktop-route-component" &&
          step.audit.reactComponentName === "SettingsRouteComponent" &&
          step.audit.reactComponentPageVm === "settings" &&
          step.audit.reactComponentLocale === "en-US" &&
          step.audit.routeData.settingsSecretSafe === "true" &&
          step.audit.routeData.settingsPetModelInWeb === "false" &&
          step.audit.routeData.settingsRestoreRequiresDesktop === "true" &&
          step.audit.routeData.settingsWebLocalActions === "false" &&
          !step.audit.secretLeak
        ) &&
        steps.some((step) =>
          step.id === "14a-settings-en-mobile-boundary-no-overflow" &&
          step.audit.reactComponentName === "SettingsRouteComponent" &&
          !step.audit.horizontalOverflow &&
          step.audit.textOverflowCount === 0
        ),
      r4_18_cost_react_component_marker:
        steps.some((step) =>
          step.id === "12-cost-en-mobile-route-component" &&
          step.audit.routeComponent === "cost" &&
          step.audit.reactComponentName === "CostRouteComponent" &&
          step.audit.reactComponentRoute === "cost" &&
          step.audit.reactComponentPageVm === "cost" &&
          step.audit.routeTreeReactComponent === "CostRouteComponent" &&
          step.audit.hydrationReactComponent === "CostRouteComponent" &&
          step.audit.routeData.costTotalTokens === String(surface.page_vms.cost.token_in + surface.page_vms.cost.token_out) &&
          step.audit.routeData.costTotalCny === surface.page_vms.cost.total_cost_cny &&
          step.audit.routeData.costBudgetCount === String(surface.page_vms.cost.budget.length) &&
          step.audit.routeData.costModelCount === String(surface.page_vms.cost.model_breakdown.length) &&
          step.audit.routeData.costNoticeCount === String(surface.page_vms.cost.notices.length)
        ),
      r4_18_replay_react_component_marker:
        steps.some((step) =>
          step.id === "15-replay-en-desktop-route-component" &&
          step.audit.routeComponent === "replay" &&
          step.audit.reactComponentName === "ReplayRouteComponent" &&
          step.audit.reactComponentRoute === "replay" &&
          step.audit.reactComponentPageVm === "replay" &&
          step.audit.routeTreeReactComponent === "ReplayRouteComponent" &&
          step.audit.hydrationReactComponent === "ReplayRouteComponent" &&
          step.audit.routeData.replayRunId === surface.page_vms.replay.run.id &&
          step.audit.routeData.replayStepCount === String(surface.page_vms.replay.steps.length) &&
          step.audit.routeData.replayAcceptedDeliverableCount === String(surface.page_vms.replay.accepted_deliverables?.length ?? 0) &&
          step.audit.reactComponentActionCount === "3"
        ),
      r4_18_cost_replay_html_fallback_parity:
        migratedReactSteps
          .filter((step) => step.audit.routeComponent === "cost" || step.audit.routeComponent === "replay")
          .every((step) =>
            step.audit.reactComponentMode === "html-fallback" &&
            step.audit.reactComponentHtmlFallback &&
            step.audit.reactComponentPropsSource === "typed-page-vm" &&
            step.audit.reactComponentActionCount === step.audit.hydrationActionCount &&
            step.audit.reactComponentActionCount === step.audit.hydrationPanelActionCount &&
            step.audit.hydrationReactComponentMode === "html-fallback" &&
            step.audit.hydrationReactComponentFallback &&
            step.audit.routeTreeReactComponentFallback
          ) &&
        migratedReactSteps.some((step) => step.audit.routeComponent === "cost") &&
        migratedReactSteps.some((step) => step.audit.routeComponent === "replay"),
      r4_18_action_dispatcher_single_path: migratedReactSteps.every((step) =>
        step.audit.reactComponentActionCount !== null &&
        step.audit.reactComponentActionCount === step.audit.hydrationActionCount &&
        step.audit.reactComponentActionCount === step.audit.hydrationPanelActionCount
      ) &&
        steps.some((step) =>
          step.id === "15a-replay-restore-success-en-desktop" &&
          step.audit.notice.kind === "action_success" &&
          step.audit.notice.actionId === "restore_deliverable" &&
          step.audit.reactComponentActionCount === "3"
        ) &&
        proof.counts.acceptedDeliverableRestore === 1,
      r4_18_replay_nonzero_deliverable_action_parity:
        steps.some((step) =>
          step.id === "15a-replay-restore-success-en-desktop" &&
          step.audit.routeComponent === "replay" &&
          step.audit.routeData.replayAcceptedDeliverableCount === "1" &&
          step.audit.reactComponentActionCount === step.audit.hydrationActionCount &&
          step.audit.reactComponentActionCount === "3"
        ) &&
        proof.counts.acceptedDeliverableRestore === 1,
      r4_17_first_migration_regression:
        steps.some((step) =>
          step.id === "01-home-zh-desktop" &&
          step.audit.routeComponent === "home" &&
          step.audit.reactComponentName === "HomeRouteComponent" &&
          step.audit.reactComponentPageVm === "attention"
        ) &&
        steps.some((step) =>
          step.id === "13-settings-en-desktop-route-component" &&
          step.audit.routeComponent === "settings" &&
          step.audit.reactComponentName === "SettingsRouteComponent" &&
          step.audit.reactComponentPageVm === "settings" &&
          step.audit.routeData.settingsSecretSafe === "true" &&
          step.audit.routeData.settingsPetModelInWeb === "false"
        ),
      r4_19_pre_true_react_mount:
        steps.some((step) =>
          step.id === "01-home-zh-desktop" &&
          step.audit.routeComponent === "home" &&
          step.audit.routeTreeRuntimeMount &&
          step.audit.routeTreeRuntimeStrategy === "react-18-createRoot-probe" &&
          step.audit.routeTreeRuntimePropsUpdate === "sse-react-render" &&
          step.audit.routeTreeRuntimeDispatcher === "delegated-click-bubble" &&
          step.audit.reactRuntimeMounted &&
          step.audit.reactRuntimeComponent === "HomeRouteComponent" &&
          step.audit.reactRuntimeRoute === "home" &&
          step.audit.reactRuntimeName === "react-18-createRoot" &&
          step.audit.reactRuntimePropsSource === "typed-page-vm" &&
          step.audit.reactRuntimeLastUpdateReason === "initial" &&
          step.audit.reactRuntimeMountCount === "1"
        ),
      r4_19_pre_dispatcher_coexistence:
        steps.some((step) =>
          step.id === "01r-home-react-dispatcher-probe-zh-desktop" &&
          step.audit.reactRuntimeDispatcherProbe &&
          step.audit.reactRuntimeDispatcherProbeActionId === "r4_react_mount_probe" &&
          step.audit.notice.kind === "action_pending" &&
          step.audit.notice.actionId === "r4_react_mount_probe" &&
          step.audit.reactRuntimeMountCount === "1"
        ),
      // findings[#118]：home SSE 刷新从「只更新隐藏 React 探针 (react-props)」改为整页 VM 重渲染
      // (page-vm-render)，可见决策收件箱真正刷新。仍出可见的 budget_warning 提示；home React 岛随整页重渲染重挂。
      r4_19_pre_sse_props_update_without_full_render:
        steps.some((step) =>
          step.id === "01s-home-react-sse-props-update-zh-desktop" &&
          step.audit.notice.kind === "budget_warning" &&
          step.audit.notice.source === "sse" &&
          step.audit.notice.eventType === "budget.warning" &&
          step.audit.notice.stream === "me" &&
          step.audit.live.refreshMode === "page-vm-render" &&
          step.audit.reactRuntimeComponent === "HomeRouteComponent" &&
          step.audit.reactRuntimeRoute === "home"
        ),
      r4_19_proposal_split_component_marker:
        steps.some((step) =>
          step.id === "06a-proposal-advanced-review-en-desktop" &&
          step.audit.routeComponent === "proposal" &&
          step.audit.reactComponentName === "ProposalRouteComponent" &&
          step.audit.reactComponentRoute === "proposal" &&
          step.audit.reactComponentPageVm === "proposal" &&
          step.audit.routeTreeReactComponent === "ProposalRouteComponent" &&
          step.audit.hydrationReactComponent === "ProposalRouteComponent" &&
          step.audit.routeData.proposalSplitAdapter === "true"
        ),
      r4_19_proposal_advanced_fallback_boundary:
        steps.some((step) =>
          step.id === "06a-proposal-advanced-review-en-desktop" &&
          step.audit.routeData.proposalAdvancedFallbackPreserved === "true" &&
          step.audit.routeData.proposalAdvancedFallback === "true" &&
          step.audit.routeData.proposalAdvancedFallbackSource === "proposal-advanced-editors-html-fallback" &&
          step.audit.routeData.proposalAdvancedFieldEditor === "true" &&
          step.audit.routeData.proposalAdvancedSubrecordEditor === "true" &&
          step.audit.routeData.proposalFieldEditorFallback === "true" &&
          step.audit.routeData.proposalSubrecordEditorFallback === "true"
        ),
      r4_19_proposal_readonly_props_parity:
        steps.some((step) =>
          step.id === "06a-proposal-advanced-review-en-desktop" &&
          step.audit.routeData.proposalChangeCount === String(surface.page_vms.proposal.manifest.changes.length) &&
          step.audit.routeData.proposalEvidenceCount === String(surface.page_vms.proposal.evidence_refs.length) &&
          step.audit.routeData.proposalConflictCount === "2" &&
          step.audit.routeData.proposalReadonlyReviewActionCount === "2" &&
          step.audit.reactComponentActionCount === step.audit.hydrationActionCount &&
          step.audit.reactComponentActionCount === step.audit.hydrationPanelActionCount
        ),
      r4_19_dirty_edit_sse_guard:
        steps.some((step) =>
          step.id === "06aa-proposal-dirty-edit-sse-guard-en-desktop" &&
          step.audit.notice.kind === "sse_dirty_guard" &&
          step.audit.notice.eventType === "proposal.merged" &&
          step.audit.notice.stream === "proposal" &&
          step.audit.live.refreshMode === "dirty-deferred" &&
          step.audit.live.dirtyRoute === "proposal" &&
          step.audit.live.dirtyPendingEvent === "proposal.merged" &&
          step.audit.live.dirtyPendingStream === "proposal" &&
          step.audit.routeData.routeDirty === "true" &&
          step.audit.routeData.proposalLineEditorSearchValue === "scope" &&
          step.audit.routeData.proposalCustomFieldValue === "R4.19 guarded custom title"
        ) &&
        proof.counts.proposal === 2 &&
        proof.counts.proposalConflicts === 2,
      r4_19_no_new_fixture_chrome:
        proof.counts.goldPath === 0 &&
        proof.counts.proposal === 2 &&
        proof.counts.proposalConflicts === 2 &&
        steps.every((step) => !step.audit.weeklyFixtureLeak),
      r4_20_app_level_sse_runtime:
        steps.some((step) =>
          step.id === "01-home-zh-desktop" &&
          step.audit.live.runtime === "app-level" &&
          step.audit.live.activeSourceCount === "1" &&
          Number(step.audit.live.openCount ?? "0") >= 1
        ),
      r4_20_route_switch_does_not_rebuild_all_event_sources:
        (() => {
          const workitem = steps.find((step) => step.id === "01d-intake-create-workitem-success-zh-desktop");
          const approvals = steps.find((step) => step.id === "02-approvals-click-zh-desktop");
          const workitemAgain = steps.find((step) => step.id === "03-workitem-click-zh-desktop-route-component");
          return Boolean(
            workitem &&
              approvals &&
              workitemAgain &&
              workitem.audit.live.runtime === "app-level" &&
              approvals.audit.live.runtime === "app-level" &&
              workitemAgain.audit.live.runtime === "app-level" &&
              workitem.audit.live.activeSourceCount === "2" &&
              approvals.audit.live.activeSourceCount === "1" &&
              workitemAgain.audit.live.activeSourceCount === "2" &&
              approvals.audit.live.openCount === workitem.audit.live.openCount &&
              Number(approvals.audit.live.reuseCount ?? "0") > Number(workitem.audit.live.reuseCount ?? "0") &&
              Number(workitemAgain.audit.live.reuseCount ?? "0") > Number(approvals.audit.live.reuseCount ?? "0")
          );
        })() &&
        proof.counts.sseProposal === 1,
      r4_20_page_vm_local_refetch:
        steps.some((step) =>
          step.id === "10-proposal-sse-refresh-notice-en-desktop" &&
          step.audit.live.refreshMode === "page-vm-render" &&
          step.audit.notice.kind === "sse_refresh"
        ) &&
        proof.counts.goldPath === 0,
      r4_20_shell_chrome_no_gold_path_fixture_dependency:
        proof.goldPath &&
        proof.goldPathEn &&
        proof.counts.goldPath === 0 &&
        steps.every((step) => step.audit.productShell ? (step.audit.zhChrome || step.audit.enChrome) : true) &&
        steps.every((step) => !step.audit.weeklyFixtureLeak),
      r4_20_last_event_id_or_cursor_contract:
        steps.some((step) =>
          step.id === "01s-home-react-sse-props-update-zh-desktop" &&
          /^evt_r4_20_/u.test(step.audit.live.lastEventId ?? "") &&
          step.audit.live.cursorStrategy === "sse-id-and-query-last_event_id"
        ) &&
        steps.some((step) =>
          step.id === "01a-intake-zh-desktop-route-component" &&
          step.audit.live.lastOpenHadCursor === "true"
        ),
      r4_20_dirty_guard_regression:
        steps.some((step) =>
          step.id === "06aa-proposal-dirty-edit-sse-guard-en-desktop" &&
          step.audit.notice.kind === "sse_dirty_guard" &&
          step.audit.live.refreshMode === "dirty-deferred" &&
          step.audit.routeData.proposalLineEditorSearchValue === "scope" &&
          step.audit.routeData.proposalCustomFieldValue === "R4.19 guarded custom title"
        ),
      // findings[#118]：回归——home SSE 现在整页 VM 重渲染（修复「可见决策收件箱永不刷新」），不再是 react-props 短路。
      r4_20_home_react_props_update_regression:
        steps.some((step) =>
          step.id === "01s-home-react-sse-props-update-zh-desktop" &&
          step.audit.live.refreshMode === "page-vm-render" &&
          step.audit.reactRuntimeComponent === "HomeRouteComponent"
        ),
      r4_20_no_new_fixture_chrome:
        proof.counts.goldPath === 0 &&
        steps.every((step) => !step.audit.weeklyFixtureLeak),
      r4_21_shared_runtime_dispatcher_parity:
        readyProductSteps.every((step) => step.audit.live.sharedActionRuntime === "notice-payload-line-editor") &&
        steps.some((step) => step.id === "06b-proposal-line-editor-apply-success-en-desktop" && step.audit.notice.kind === "action_success") &&
        steps.some((step) => step.id === "06aa-proposal-dirty-edit-sse-guard-en-desktop" && step.audit.notice.kind === "sse_dirty_guard"),
      r4_21_shared_notice_locale_parity:
        steps.some((step) => step.id === "02a-approval-deny-reason-gate-zh-desktop" && step.audit.notice.kind === "reason_required" && step.audit.notice.locale === "zh-CN") &&
        steps.some((step) => step.id === "07-proposal-reason-gate-en-desktop" && step.audit.notice.kind === "reason_required" && step.audit.notice.locale === "en-US"),
      r4_21_r4_20_sse_runtime_regression:
        steps.some((step) => step.id === "01-home-zh-desktop" && step.audit.live.sharedRuntime === "@workhub/web-runtime" && step.audit.live.sharedLiveRuntime === "true") &&
        steps.some((step) => step.id === "10-proposal-sse-refresh-notice-en-desktop" && step.audit.live.refreshMode === "page-vm-render"),
      r4_21_dirty_guard_regression:
        steps.some((step) =>
          step.id === "06aa-proposal-dirty-edit-sse-guard-en-desktop" &&
          step.audit.live.sharedActionRuntime === "notice-payload-line-editor" &&
          step.audit.notice.kind === "sse_dirty_guard" &&
          step.audit.live.refreshMode === "dirty-deferred"
        ),
      r4_21_no_new_browser_smoke_sprawl: steps.length === expectedLiveRouteSmokeSteps,
      r4_22_visible_react_mutation_editor:
        steps.some((step) =>
          step.id === "06a-proposal-advanced-review-en-desktop" &&
          step.audit.routeComponent === "proposal" &&
          step.audit.routeTreeRuntimeStrategy === "react-18-visible-mutation-editor" &&
          step.audit.routeTreeRuntimeMutationEditor === "structured-field-scalar" &&
          step.audit.reactRuntimeMounted &&
          step.audit.reactRuntimeRoute === "proposal" &&
          step.audit.reactRuntimeComponent === "ProposalMutationEditor" &&
          step.audit.reactRuntimeName === "react-18-createRoot" &&
          step.audit.reactRuntimeVisibleMutationEditor === "true" &&
          step.audit.reactRuntimeMutationEditorKind === "structured-field-scalar" &&
          step.audit.reactRuntimeControlledField === "title"
        ),
      r4_22_controlled_state_survives_sse:
        steps.some((step) =>
          step.id === "06aa-proposal-dirty-edit-sse-guard-en-desktop" &&
          step.audit.notice.kind === "sse_dirty_guard" &&
          step.audit.live.refreshMode === "dirty-deferred" &&
          step.audit.reactRuntimeRoute === "proposal" &&
          step.audit.reactRuntimeComponent === "ProposalMutationEditor" &&
          step.audit.reactRuntimeControlledField === "title" &&
          step.audit.reactRuntimeControlledValue === "R4.19 guarded custom title" &&
          step.audit.routeData.proposalCustomFieldValue === "R4.19 guarded custom title"
        ) &&
        proof.counts.proposal === 2 &&
        proof.counts.proposalConflicts === 2,
      r4_22_single_dispatcher_regression:
        steps.some((step) =>
          step.id === "06e-proposal-custom-field-empty-fail-closed-en-desktop" &&
          step.audit.notice.kind === "field_value_required" &&
          step.audit.reactRuntimeRoute === "proposal"
        ) &&
        steps.some((step) =>
          step.id === "06f-proposal-custom-field-apply-success-en-desktop" &&
          step.audit.notice.kind === "action_success" &&
          step.audit.reactRuntimeRoute === "proposal"
        ) &&
        proof.advancedPayloads.structuredFieldOverrides,
      r4_22_html_fallback_boundary_regression:
        steps.some((step) =>
          step.id === "06a-proposal-advanced-review-en-desktop" &&
          step.audit.routeData.proposalAdvancedFallbackPreserved === "true" &&
          step.audit.routeData.proposalAdvancedFallbackSource === "proposal-advanced-editors-html-fallback" &&
          step.audit.routeData.proposalLineEditorFallback === "true" &&
          step.audit.routeData.proposalFieldEditorFallback === "true" &&
          step.audit.routeData.proposalSubrecordEditorFallback === "true" &&
          Number(step.audit.routeData.proposalStructuredFieldEditorCount ?? "0") >= 1 &&
          step.audit.reactRuntimeHtmlFallbackPreserved === "true" &&
          step.audit.reactRuntimeHtmlFallbackHidden === "true"
        ),
      r4_22_no_new_smoke_sprawl: steps.length === expectedLiveRouteSmokeSteps,
      r4_23_visible_react_line_editor:
        steps.some((step) =>
          step.id === "06a-proposal-advanced-review-en-desktop" &&
          step.audit.routeComponent === "proposal" &&
          step.audit.routeTreeRuntimeStrategy === "react-18-visible-mutation-editor" &&
          step.audit.routeTreeRuntimeLineEditor === "text-hunk" &&
          step.audit.reactRuntimeRoute === "proposal" &&
          step.audit.reactRuntimeVisibleLineEditor === "true" &&
          step.audit.reactRuntimeLineEditorKind === "text-hunk" &&
          step.audit.routeData.proposalLineEditorFileCount === "1" &&
          step.audit.routeData.proposalLineEditorHunkCount === "1"
        ),
      r4_23_hunk_state_survives_sse:
        steps.some((step) =>
          step.id === "06aa-proposal-dirty-edit-sse-guard-en-desktop" &&
          step.audit.notice.kind === "sse_dirty_guard" &&
          step.audit.live.refreshMode === "dirty-deferred" &&
          step.audit.reactRuntimeLineEditorKind === "text-hunk" &&
          Boolean(step.audit.reactRuntimeLineEditorSelectedDecision) &&
          step.audit.reactRuntimeLineEditorSelectedDecision === step.audit.routeData.proposalLineEditorSelectedDecision &&
          step.audit.reactRuntimeLineEditorSearchValue === "scope" &&
          step.audit.routeData.proposalLineEditorSearchValue === "scope"
        ),
      r4_23_line_editor_payload_parity:
        steps.some((step) =>
          step.id === "06b-proposal-line-editor-apply-success-en-desktop" &&
          step.audit.notice.kind === "action_success" &&
          step.audit.notice.actionId === "apply_ai_fusion" &&
          step.audit.reactRuntimeLineEditorKind === "text-hunk"
        ) &&
        proof.advancedPayloads.textHunkOverrides &&
        proof.advancedPayloads.textHunkFullCoverage,
      r4_23_html_fallback_boundary_regression:
        steps.some((step) =>
          step.id === "06a-proposal-advanced-review-en-desktop" &&
          step.audit.routeData.proposalAdvancedFallbackPreserved === "true" &&
          step.audit.routeData.proposalLineEditorFallback === "true" &&
          step.audit.reactRuntimeLineEditorHtmlFallbackPreserved === "true" &&
          step.audit.reactRuntimeLineEditorHtmlFallbackHidden === "true"
        ),
      r4_23_single_dispatcher_regression:
        steps.some((step) =>
          step.id === "06b-proposal-line-editor-apply-success-en-desktop" &&
          step.audit.notice.kind === "action_success" &&
          step.audit.notice.actionId === "apply_ai_fusion"
        ) &&
        proof.counts.mergeApply >= 4 &&
        proof.advancedPayloads.textHunkOverrides,
      r4_23_no_new_smoke_sprawl: steps.length === expectedLiveRouteSmokeSteps,
      r4_24_no_hash_write:
        steps.length === expectedLiveRouteSmokeSteps &&
        steps.every((step) => !step.audit.hashNavigationLeak && !step.audit.locationHash.startsWith("#/")),
      r4_24_r4_23_react_line_editor_regression:
        steps.some((step) =>
          step.id === "06a-proposal-advanced-review-en-desktop" &&
          step.audit.reactRuntimeVisibleLineEditor === "true" &&
          step.audit.reactRuntimeLineEditorKind === "text-hunk"
        ) &&
        steps.some((step) =>
          step.id === "06aa-proposal-dirty-edit-sse-guard-en-desktop" &&
          step.audit.notice.kind === "sse_dirty_guard" &&
          step.audit.reactRuntimeLineEditorSearchValue === "scope"
        ) &&
        steps.some((step) =>
          step.id === "06b-proposal-line-editor-apply-success-en-desktop" &&
          step.audit.notice.kind === "action_success" &&
          step.audit.reactRuntimeLineEditorKind === "text-hunk"
        ) &&
        proof.advancedPayloads.textHunkOverrides &&
        proof.advancedPayloads.textHunkFullCoverage,
      r4_16_hydration_boundary_regression: readyProductSteps.every((step) =>
        Boolean(step.audit.hydrationBoundary) &&
        step.audit.hydrationRoute === step.audit.routeComponent &&
        step.audit.hydrationMode === "html-fallback" &&
        step.audit.hydrationAdapter === "route-component-v1" &&
        step.audit.panelCount === 1 &&
        step.audit.visiblePanelCount === 1 &&
        step.audit.hydrationPanelCount === 1
      ),
      r4_15_settings_boundary_regression:
        steps.some((step) => step.id === "14-settings-desktop-gate-en-desktop" && step.audit.routeData.settingsRestoreRequiresDesktop === "true" && step.audit.routeData.settingsWebLocalActions === "false") &&
        steps.some((step) => step.id === "14a-settings-en-mobile-boundary-no-overflow" && step.audit.routeComponent === "settings" && !step.audit.horizontalOverflow),
      active_only_product_panels: steps.filter((step) => step.audit.productShell && step.audit.status === "ready").every((step) => step.audit.panelCount === 1 && step.audit.visiblePanelCount === 1),
      r4_10_active_only_product_panels: steps.filter((step) => step.audit.productShell && step.audit.status === "ready").every((step) => step.audit.panelCount === 1 && step.audit.visiblePanelCount === 1),
      product_shell_stays_path_mode: steps.filter((step) => step.audit.productShell).every((step) => step.audit.linkModePath),
      no_duplicate_route_loader_calls:
        proof.counts.approvals === 4 &&
        proof.counts.workitem === 6 &&
        proof.counts.workitemForbidden === 1 &&
        // UX-U8：会议页补项目导航后 meetings loader 每次加载多取一次 /api/projects（smoke 内 meetings 加载 3 次）→ 11+3。
        // R4（性能）：drive/meetings loader 改 Promise.all 并行后，no_project 的 empty 探针（/drive?empty=drive 加载 1 次）
        // 也会并行发出一次 /api/projects（不再等 drive 返回后短路）→ 14+1=15。这是并行化的确定性代价，非 N+1 回归。
        proof.counts.projects === 15 &&
        proof.counts.projectHome === 4 &&
        proof.counts.createNamedProject === 1 &&
        proof.counts.drive === 8 &&
        proof.counts.driveDraftProposal === 1 &&
        proof.counts.meetings === 3 &&
        proof.counts.meetingWorkitem === 3 &&
        proof.counts.meetingInsightDraft === 1 &&
        proof.counts.meetingInsightDismiss === 0 &&
        proof.counts.meetingDraftProposal === 1 &&
        proof.counts.notifications === 7 &&
        proof.counts.calendar === 2 &&
        proof.counts.notificationMarkRead === 1 &&
        proof.counts.notificationMarkAllRead === 1 &&
        proof.counts.notificationDismiss === 1 &&
        proof.counts.notificationComplete === 1 &&
        proof.counts.session === 3 &&
        proof.counts.nextQuestion === 1 &&
        proof.counts.createWorkItem === 1 &&
        proof.counts.knowledgeSearch === 2 &&
        proof.counts.evidenceBinding === 1 &&
        proof.counts.proposal === 2 &&
        proof.counts.proposalConflicts === 2 &&
        proof.counts.approvalRespond === 2 &&
        proof.counts.proposalReview === 2 &&
        proof.counts.proposalMerge === 1 &&
        proof.counts.mergeApply === 4 &&
        proof.counts.acceptedDeliverableRestore === 1 &&
        proof.counts.cost === 2 &&
        proof.counts.agents === 2 &&
        proof.counts.settings === 1 &&
        // 交付物还原成功后当前路由重渲（renderCurrentRoute）→ replay loader 合法地取了两次。
        proof.counts.replay === 2 &&
        proof.counts.preferencePatch === 4 &&
        proof.counts.preferenceFailureArmed === 1 &&
        proof.counts.qaEmit === 4 &&
        proof.counts.sseProposal === 1 &&
        proof.counts.goldPath === 0,
      mobile_scroll_no_topbar_nav_overlap: steps.some((step) => step.id === "11-proposal-en-mobile-scrolled-notice-route-component" && !step.audit.topbarNavOverlap),
      no_main_window_cuu: steps.every((step) => !step.audit.cuuLeak),
      no_default_kanban: steps.every((step) => !step.audit.kanbanLeak),
      no_old_preview_shell: steps.every((step) => !step.audit.oldShellLeak),
      no_weekly_fixture_copy: steps.every((step) => !step.audit.weeklyFixtureLeak),
      no_hash_navigation: steps.every((step) => !step.audit.hashNavigationLeak),
      no_horizontal_overflow: steps.every((step) => !step.audit.horizontalOverflow && !step.audit.navHorizontalOverflow),
      no_text_box_overflow: steps.every((step) => step.audit.textOverflowCount === 0)
    };
    const report = {
      generated_at: new Date().toISOString(),
      module: smokeTitle,
      chrome_path: chromePath,
      vite_url: baseUrl,
      api_target: apiTarget,
      output_dir: path.relative(repoRoot, outputDir).replace(/\\/gu, "/"),
      contact_sheet: "contact-sheet.png",
      contact_sheet_freshness: contactSheetFresh,
      gates,
      request_proof: proof,
      api_requests: requests,
      steps
    };
    await writeFile(path.join(outputDir, reportFilename), `${JSON.stringify(report, null, 2)}\n`, "utf8");
    await writeFile(
      path.join(outputDir, "smoke-summary.md"),
      [
        `# ${smokeTitle}`,
        "",
        `- ok: ${String(Object.values(gates).every(Boolean))}`,
        `- steps: ${String(steps.length)}`,
        `- contact sheet fresh: ${String(gates.contact_sheet_fresh)}`,
        `- path nav clicks: ${String(gates.path_nav_clicks)}`,
        `- history back/forward: ${String(gates.history_back_forward)}`,
        `- locale toggle reload: ${String(gates.locale_toggle_reload)}`,
        `- R4.10 route components: ${String(gates.r4_10_home_approvals_replay_route_components)}`,
        `- R4.11 route components: ${String(gates.r4_11_workitem_proposal_cost_settings_route_components)}`,
        `- R5.1 Drive route component: ${String(gates.r5_1_drive_route_component)}`,
        `- R5.2 Drive upload/recycle/operation log: ${String(gates.r5_2_drive_upload_recycle_operation_log)}`,
        `- R5.3 Drive comment to draft: ${String(gates.r5_3_drive_comment_to_draft)}`,
        `- R5.4 Drive draft to proposal: ${String(gates.r5_4_drive_draft_to_proposal)}`,
        `- R5.5 Meeting insight to draft: ${String(gates.r5_5_meeting_insight_to_draft)}`,
        `- R5.6 Schedule/Notify routes: ${String(gates.r5_6_schedule_notify_routes)}`,
        `- R5.7 Health/Grounding routes: ${String(gates.r5_7_health_grounding_routes)}`,
        `- R8 Team skills route: ${String(gates.r8_skills_route_component)}`,
        `- R5.9 Onboarding routes: ${String(gates.r5_9_onboarding_routes)}`,
        `- R4.11 source truth: ${String(gates.r4_11_route_component_source_truth)}`,
        `- R4.11 VM/DOM match: ${String(gates.r4_11_vm_dom_value_match)}`,
        `- R4.14 session/knowledge endpoints: ${String(gates.r4_14_ready_routes_use_session_knowledge_endpoints)}`,
        `- R4.12 approval response notice: ${String(gates.r4_12_approval_response_notice)}`,
        `- R4.12 reason gate: ${String(gates.r4_12_reason_gate_blocks_without_reason)}`,
        `- R4.12 request changes notice: ${String(gates.r4_12_request_changes_success_notice)}`,
        `- R4.12 merge notice: ${String(gates.r4_12_merge_success_notice)}`,
        `- R4.12 SSE refresh notice: ${String(gates.r4_12_sse_refresh_notice)}`,
        `- R4.12 budget warning notice: ${String(gates.r4_12_budget_warning_notice)}`,
        `- R4.12 desktop gate: ${String(gates.r4_12_desktop_gate_fail_closed)}`,
        `- R4.12 route-state actions: ${String(gates.r4_12_retry_access_route_states)}`,
        `- R4.13 proposal advanced route DOM: ${String(gates.r4_13_proposal_advanced_route_dom)}`,
        `- R4.13 proposal advanced route sections: ${String(gates.r4_13_proposal_advanced_route_sections)}`,
        `- R4.13 advanced apply payloads: ${String(gates.r4_13_advanced_apply_payloads)}`,
        `- R4.13 custom field fail-closed: ${String(gates.r4_13_custom_field_fail_closed)}`,
        `- R4.13 conflict API source truth: ${String(gates.r4_13_conflict_api_source_truth)}`,
        `- R4.13 structured editor visual: ${String(gates.r4_13_structured_editor_visual_no_overflow)}`,
        `- R4.13 proposal regression: ${String(gates.r4_13_proposal_advanced_regression)}`,
        `- R4.14 route component source truth: ${String(gates.r4_14_route_component_source_truth)}`,
        `- R4.14 intake route: ${String(gates.r4_14_intake_route_component)}`,
        `- R4.14 option-first fail-closed: ${String(gates.r4_14_intake_fail_closed)}`,
        `- R4.14 intake submit/create: ${String(gates.r4_14_intake_submit_success && gates.r4_14_intake_create_workitem_success)}`,
        `- R4.14 knowledge fallback/bind: ${String(gates.r4_14_knowledge_fallback_route && gates.r4_14_knowledge_bind_success)}`,
        `- R4.14 mobile no overflow: ${String(gates.r4_14_mobile_no_overflow)}`,
        `- R4.15 settings locale persistence: ${String(gates.r4_15_settings_locale_persistence)}`,
        `- R4.15 settings secret safe: ${String(gates.r4_15_settings_secret_safe)}`,
        `- R4.15 desktop boundary gate: ${String(gates.r4_15_desktop_boundary_gate)}`,
        `- R4.15 route recovery actions: ${String(gates.r4_15_route_recovery_actions)}`,
        `- R4.15 settings mobile no overflow: ${String(gates.r4_15_settings_mobile_no_overflow)}`,
        `- R4.14 intake/knowledge regression: ${String(gates.r4_14_intake_knowledge_regression)}`,
        `- R4.16 hydration boundary marker: ${String(gates.r4_16_hydration_boundary_marker)}`,
        `- R4.16 route adapter Page VM truth: ${String(gates.r4_16_route_adapter_page_vm_truth)}`,
        `- R4.16 action dispatcher parity: ${String(gates.r4_16_action_dispatcher_parity)}`,
        `- R4.16 locale/settings regression: ${String(gates.r4_16_locale_settings_regression)}`,
        `- R4.16 active-only regression: ${String(gates.r4_16_active_only_regression)}`,
        `- R4.17 React component marker: ${String(gates.r4_17_react_component_marker)}`,
        `- R4.17 HTML fallback parity: ${String(gates.r4_17_html_fallback_parity)}`,
        `- R4.17 action dispatcher single path: ${String(gates.r4_17_action_dispatcher_single_path)}`,
        `- R4.17 settings boundary regression: ${String(gates.r4_17_settings_boundary_regression)}`,
        `- R4.18 Cost React component marker: ${String(gates.r4_18_cost_react_component_marker)}`,
        `- R4.18 Replay React component marker: ${String(gates.r4_18_replay_react_component_marker)}`,
        `- R4.18 Cost/Replay fallback parity: ${String(gates.r4_18_cost_replay_html_fallback_parity)}`,
        `- R4.18 action dispatcher single path: ${String(gates.r4_18_action_dispatcher_single_path)}`,
        `- R4.18 Replay nonzero deliverable action parity: ${String(gates.r4_18_replay_nonzero_deliverable_action_parity)}`,
        `- R4.17 first migration regression: ${String(gates.r4_17_first_migration_regression)}`,
        `- R4.19-pre true React mount: ${String(gates.r4_19_pre_true_react_mount)}`,
        `- R4.19-pre dispatcher coexistence: ${String(gates.r4_19_pre_dispatcher_coexistence)}`,
        `- R4.19-pre SSE props update without full render: ${String(gates.r4_19_pre_sse_props_update_without_full_render)}`,
        `- R4.19 Proposal split component marker: ${String(gates.r4_19_proposal_split_component_marker)}`,
        `- R4.19 Proposal advanced fallback boundary: ${String(gates.r4_19_proposal_advanced_fallback_boundary)}`,
        `- R4.19 Proposal readonly props parity: ${String(gates.r4_19_proposal_readonly_props_parity)}`,
        `- R4.19 dirty edit SSE guard: ${String(gates.r4_19_dirty_edit_sse_guard)}`,
        `- R4.19 no-new-fixture chrome: ${String(gates.r4_19_no_new_fixture_chrome)}`,
        `- R4.20 app-level SSE runtime: ${String(gates.r4_20_app_level_sse_runtime)}`,
        `- R4.20 route switch stable EventSource: ${String(gates.r4_20_route_switch_does_not_rebuild_all_event_sources)}`,
        `- R4.20 page VM local refetch: ${String(gates.r4_20_page_vm_local_refetch)}`,
        `- R4.20 shell chrome no fixture dependency: ${String(gates.r4_20_shell_chrome_no_gold_path_fixture_dependency)}`,
        `- R4.20 Last-Event-ID cursor: ${String(gates.r4_20_last_event_id_or_cursor_contract)}`,
        `- R4.20 dirty guard regression: ${String(gates.r4_20_dirty_guard_regression)}`,
        `- R4.20 Home React props regression: ${String(gates.r4_20_home_react_props_update_regression)}`,
        `- R4.20 no-new-fixture chrome: ${String(gates.r4_20_no_new_fixture_chrome)}`,
        `- R4.21 shared runtime dispatcher parity: ${String(gates.r4_21_shared_runtime_dispatcher_parity)}`,
        `- R4.21 shared notice locale parity: ${String(gates.r4_21_shared_notice_locale_parity)}`,
        `- R4.21 R4.20 SSE runtime regression: ${String(gates.r4_21_r4_20_sse_runtime_regression)}`,
        `- R4.21 dirty guard regression: ${String(gates.r4_21_dirty_guard_regression)}`,
        `- R4.21 no new browser smoke sprawl: ${String(gates.r4_21_no_new_browser_smoke_sprawl)}`,
        `- R4.22 visible React mutation editor: ${String(gates.r4_22_visible_react_mutation_editor)}`,
        `- R4.22 controlled state survives SSE: ${String(gates.r4_22_controlled_state_survives_sse)}`,
        `- R4.22 single dispatcher regression: ${String(gates.r4_22_single_dispatcher_regression)}`,
        `- R4.22 HTML fallback boundary regression: ${String(gates.r4_22_html_fallback_boundary_regression)}`,
        `- R4.22 no new smoke sprawl: ${String(gates.r4_22_no_new_smoke_sprawl)}`,
        `- R4.23 visible React line editor: ${String(gates.r4_23_visible_react_line_editor)}`,
        `- R4.23 hunk state survives SSE: ${String(gates.r4_23_hunk_state_survives_sse)}`,
        `- R4.23 line editor payload parity: ${String(gates.r4_23_line_editor_payload_parity)}`,
        `- R4.23 HTML fallback boundary regression: ${String(gates.r4_23_html_fallback_boundary_regression)}`,
        `- R4.23 single dispatcher regression: ${String(gates.r4_23_single_dispatcher_regression)}`,
        `- R4.23 no new smoke sprawl: ${String(gates.r4_23_no_new_smoke_sprawl)}`,
        `- R4.24 no hash write: ${String(gates.r4_24_no_hash_write)}`,
        `- R4.24 R4.23 React line editor regression: ${String(gates.r4_24_r4_23_react_line_editor_regression)}`,
        `- R4.16 hydration boundary regression: ${String(gates.r4_16_hydration_boundary_regression)}`,
        `- R4.15 settings boundary regression: ${String(gates.r4_15_settings_boundary_regression)}`,
        `- active-only product panels: ${String(gates.active_only_product_panels)}`,
        `- no text box overflow: ${String(gates.no_text_box_overflow)}`,
        ""
      ].join("\n"),
      "utf8"
    );
    if (!Object.values(gates).every(Boolean)) {
      throw new Error(`${smokeTitle} failed: ${JSON.stringify(gates)}`);
    }
    console.log(JSON.stringify({ ok: true, output_dir: report.output_dir, steps: steps.length }, null, 2));
  } finally {
    chrome?.cdp.close();
    await stopChrome(chrome?.child);
    if (viteServer) {
      await viteServer.close();
    }
    await closeServer(apiServer).catch(() => undefined);
    await removeBestEffort(userDataDir);
  }
}

function isDirectInvocation() {
  const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : undefined;
  return invokedPath === import.meta.url;
}

if (isDirectInvocation()) {
  void main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
