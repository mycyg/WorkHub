import assert from "node:assert/strict";
import test from "node:test";

import { WorkHubApiError, type WorkHubApiClient } from "@workhub/api-client";
import { createP05GoldPathFixture, validateP05GoldPathFixture } from "@workhub/agent/fixtures";
import type {
  ApprovalCenterVM,
  AttentionHomeVM,
  CostDashboardVM,
  EvidenceBubble,
  GoldPathSurfaceVM,
  ProposalConflict,
  ReplayTraceVM,
  SessionVM,
  SettingsPageVM
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
  replay?: ReplayTraceVM;
  session?: SessionVM;
  knowledge?: EvidenceBubble;
  settings?: SettingsPageVM;
  conflicts?: ProposalConflict[];
  attentionError?: Error;
  approvalsError?: Error;
  costError?: Error;
};

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
  const localeCall = (name: string, options?: { locale?: string }) => {
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
      async settings(options?: { locale?: string }) {
        localeCall("settings", options);
        return overrides.settings ?? settingsVm(options?.locale === "en-US" ? "en-US" : "zh-CN");
      },
      async goldPath(options?: { locale?: string }) {
        localeCall("goldPath", options);
        return surface;
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

test("R4 web route registry resolves product URL routes", () => {
  assert.deepEqual(webRouteRegistry.map((route) => route.key), [
    "home",
    "intake",
    "approvals",
    "workitem",
    "proposal",
    "replay",
    "cost",
    "knowledge",
    "settings"
  ]);
  assert.equal(resolveWebRoute("/")?.key, "home");
  assert.equal(resolveWebRoute("/approvals?filter=pending")?.key, "approvals");
  assert.equal(resolveWebRoute("/dashboard/cost")?.key, "cost");
  assert.equal(resolveWebRoute("/knowledge/search?q=weekly")?.key, "knowledge");
  assert.equal(resolveWebRoute("/knowledge/search?q=weekly")?.search, "?q=weekly");
  assert.equal(resolveWebRoute("/workitems/WH-001")?.params["id"], "WH-001");
  assert.equal(resolveWebRoute("/agent-runs/run-1/replay")?.params["id"], "run-1");
  assert.equal(resolveWebRoute("/#/approvals")?.key, "approvals");
  assert.equal(resolveWebRoute("/unknown"), undefined);
  assert.equal(webRouteHref("https://workhub.local/proposals/p-1?tab=diff#top"), "/proposals/p-1?tab=diff#top");
  assert.equal(webRouteHref("https://workhub.local/#/agent-runs/run-1/replay?from=old"), "/agent-runs/run-1/replay?from=old");
});

test("R4.16 web route tree declares hydration fallback boundaries for every product route", () => {
  assert.deepEqual(webReactRouteTree.map((route) => route.key), webRouteRegistry.map((route) => route.key));
  assert.deepEqual(
    webReactRouteTree.map((route) => [route.key, route.hydration.pageVm]),
    [
      ["home", "attention"],
      ["intake", "session"],
      ["approvals", "approvals"],
      ["workitem", "workitem"],
      ["proposal", "proposal"],
      ["replay", "replay"],
      ["cost", "cost"],
      ["knowledge", "evidence"],
      ["settings", "settings"]
    ]
  );
  assert.equal(webReactRouteTree.every((route) => route.hydration.enabled), true);
  assert.equal(webReactRouteTree.every((route) => route.hydration.mode === "html-fallback"), true);
  assert.equal(webReactRouteTree.every((route) => route.hydration.adapter === "route-component-v1"), true);
  assert.equal(webReactRouteTree.every((route) => route.hydration.activeOnly), true);
});

test("R4.18 web route tree marks expanded React-compatible route components", () => {
  const migrated = webReactRouteTree
    .filter((route) => route.hydration.reactComponent)
    .map((route) => [route.key, route.hydration.reactComponent?.componentName, route.hydration.reactComponent?.propsSource]);

  assert.deepEqual(migrated, [
    ["home", "HomeRouteComponent", "typed-page-vm"],
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

  assert.deepEqual(runtimeMounted, ["home"]);
  assert.equal(home?.hydration.runtimeMount?.strategy, "react-18-createRoot-probe");
  assert.equal(home?.hydration.runtimeMount?.componentName, "HomeRouteComponent");
  assert.equal(home?.hydration.runtimeMount?.fallbackPreserved, true);
  assert.equal(home?.hydration.runtimeMount?.propsUpdate, "sse-react-render");
  assert.equal(home?.hydration.runtimeMount?.dispatcher, "delegated-click-bubble");
});

test("R4.14 intake route loader carries Session VM data into an option-first route component", async () => {
  const surface = goldPathSurfaceVm();
  const session = routeSession();
  const { client, calls } = fakeRouteClient(surface, { session });
  const match = resolveWebRoute("/intake/r4-route-registry-session");
  assert.ok(match);

  const result = await loadWebRoute(client, match, "en-US");

  assert.equal(result.status, "ready");
  assert.deepEqual(calls.slice(0, 2), ["session:r4-route-registry-session:en-US", "goldPath:en-US"]);
  assert.equal(result.html.includes('data-r4-route-component="intake"'), true);
  assert.equal(result.html.includes('data-r4-route-component-source="session-vm"'), true);
  assert.equal(result.html.includes('data-r4-intake-option-count="2"'), true);
  assert.equal(result.html.includes('data-r4-intake-free-text-collapsed="true"'), true);
  assert.equal(result.html.includes('data-r4-intake-option-first="true"'), true);
  assert.equal(result.html.includes('data-intake-submit="next-question"'), true);
  assert.equal(result.html.includes("<textarea"), false);
  assert.equal(result.html.includes("message-list"), false);
});

test("R4.14 knowledge route loader carries search payload into a cited fallback route component", async () => {
  const surface = goldPathSurfaceVm();
  const knowledge = routeEvidenceBubble();
  const { client, calls } = fakeRouteClient(surface, { knowledge });
  const match = resolveWebRoute("/knowledge/search?q=regional&workItemId=10000000-0000-4000-8000-000000000932");
  assert.ok(match);

  const result = await loadWebRoute(client, match, "en-US");

  assert.equal(result.status, "ready");
  assert.deepEqual(calls.slice(0, 2), [
    'knowledge:{"q":"regional","work_item_id":"10000000-0000-4000-8000-000000000932","limit":6}:en-US',
    "goldPath:en-US"
  ]);
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
  assert.deepEqual(calls.slice(0, 3), [
    "proposal:proposal-42:en-US",
    `conflicts:${surface.page_vms.proposal.work_item_id}:none`,
    "goldPath:en-US"
  ]);
  assert.equal(result.html.includes('data-r4-route-component="proposal"'), true);
  assert.equal(result.html.includes('data-r4-proposal-conflict-count="1"'), true);
  assert.equal(result.html.includes('data-r4-proposal-advanced-review="true"'), true);
  assert.equal(result.html.includes('data-r4-proposal-conflicts="1"'), true);
  assert.equal(result.html.includes('data-r4-proposal-line-editor="true"'), true);
  assert.equal(result.html.includes('data-proposal-conflicts="1"'), true);
  assert.equal(result.html.includes('data-route-line-editor="true"'), true);
  assert.equal(result.html.includes('data-line-editor-apply="true"'), true);
  assert.equal(result.html.includes("Use AI fusion draft"), true);
});

test("R4 web loader uses typed Page VM endpoints before rendering ready routes", async () => {
  const surface = goldPathSurfaceVm();

  for (const [path, endpointCall] of [
    ["/", "attention:en-US"],
    ["/approvals", "approvals:en-US"],
    ["/dashboard/cost", "cost:en-US"],
    ["/settings", "settings:en-US"]
  ] as const) {
    const { client, calls } = fakeRouteClient(surface);
    const match = resolveWebRoute(path);
    assert.ok(match);
    const result = await loadWebRoute(client, match, "en-US");
    assert.equal(result.status, "ready");
    assert.deepEqual(calls.slice(0, 2), [endpointCall, "goldPath:en-US"]);
    assert.equal(result.html.includes('data-r4-web-route-status="ready"'), true);
    assert.equal(result.html.includes('data-r4-product-shell="true"'), true);
    assert.equal(result.html.includes('data-r4-product-masthead="true"'), true);
    assert.equal(result.html.match(/data-wh-panel=/gu)?.length, 1);
    assert.equal(result.html.includes('href="#/approvals"'), false);
    assert.equal(result.html.includes('href="/approvals"'), true);
    assert.equal(result.html.toLowerCase().includes("kanban"), false);
  }
});

test("R4 web loader uses detail Page VM endpoints before rendering ready routes", async () => {
  const surface = goldPathSurfaceVm();

  for (const [path, endpointCalls] of [
    ["/workitems/work-42", ["workItem:work-42:en-US", "goldPath:en-US"]],
    ["/proposals/proposal-42", [
      "proposal:proposal-42:en-US",
      `conflicts:${surface.page_vms.proposal.work_item_id}:none`,
      "goldPath:en-US"
    ]],
    ["/agent-runs/run-42/replay", ["replayAgentRun:run-42:en-US", "goldPath:en-US"]]
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

test("R4.11 web loader marks ready routes as route components", async () => {
  const surface = goldPathSurfaceVm();

  for (const [path, endpointCalls, routeComponent] of [
    ["/", ["attention:en-US", "goldPath:en-US"], "home"],
    ["/approvals", ["approvals:en-US", "goldPath:en-US"], "approvals"],
    ["/workitems/work-42", ["workItem:work-42:en-US", "goldPath:en-US"], "workitem"],
    ["/proposals/proposal-42", [
      "proposal:proposal-42:en-US",
      `conflicts:${surface.page_vms.proposal.work_item_id}:none`,
      "goldPath:en-US"
    ], "proposal"],
    ["/agent-runs/run-42/replay", ["replayAgentRun:run-42:en-US", "goldPath:en-US"], "replay"],
    ["/dashboard/cost", ["cost:en-US", "goldPath:en-US"], "cost"],
    ["/settings", ["settings:en-US", "goldPath:en-US"], "settings"]
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
