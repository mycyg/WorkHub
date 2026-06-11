import assert from "node:assert/strict";
import test from "node:test";

import { WorkHubApiError, type WorkHubApiClient } from "@workhub/api-client";
import { createP05GoldPathFixture, validateP05GoldPathFixture } from "@workhub/agent/fixtures";
import type {
  ApprovalCenterVM,
  AttentionHomeVM,
  CostDashboardVM,
  GoldPathSurfaceVM,
  ReplayTraceVM
} from "@workhub/contracts";

import {
  createUnknownWebRouteMatch,
  loadWebRoute,
  resolveWebRoute,
  webRouteHref,
  webRouteRegistry
} from "./routes.js";

type RouteClientOverrides = {
  attention?: AttentionHomeVM;
  approvals?: ApprovalCenterVM;
  cost?: CostDashboardVM;
  replay?: ReplayTraceVM;
  attentionError?: Error;
  approvalsError?: Error;
  costError?: Error;
};

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
      cost: "/dashboard/cost"
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
    async replayAgentRun(id: string, options?: { locale?: string }) {
      localeCall(`replayAgentRun:${id}`, options);
      return overrides.replay ?? surface.page_vms.replay;
    }
  } as unknown as WorkHubApiClient;
  return { client, calls };
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
    "settings"
  ]);
  assert.equal(resolveWebRoute("/")?.key, "home");
  assert.equal(resolveWebRoute("/approvals?filter=pending")?.key, "approvals");
  assert.equal(resolveWebRoute("/dashboard/cost")?.key, "cost");
  assert.equal(resolveWebRoute("/workitems/WH-001")?.params["id"], "WH-001");
  assert.equal(resolveWebRoute("/agent-runs/run-1/replay")?.params["id"], "run-1");
  assert.equal(resolveWebRoute("/#/approvals")?.key, "approvals");
  assert.equal(resolveWebRoute("/unknown"), undefined);
  assert.equal(webRouteHref("https://workhub.local/proposals/p-1?tab=diff#top"), "/proposals/p-1?tab=diff#top");
  assert.equal(webRouteHref("https://workhub.local/#/agent-runs/run-1/replay?from=old"), "/agent-runs/run-1/replay?from=old");
});

test("R4 web loader uses typed Page VM endpoints before rendering ready routes", async () => {
  const surface = goldPathSurfaceVm();

  for (const [path, endpointCall] of [
    ["/", "attention:en-US"],
    ["/approvals", "approvals:en-US"],
    ["/dashboard/cost", "cost:en-US"]
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

  for (const [path, endpointCall] of [
    ["/workitems/work-42", "workItem:work-42:en-US"],
    ["/proposals/proposal-42", "proposal:proposal-42:en-US"],
    ["/agent-runs/run-42/replay", "replayAgentRun:run-42:en-US"]
  ] as const) {
    const { client, calls } = fakeRouteClient(surface);
    const match = resolveWebRoute(path);
    assert.ok(match);
    const result = await loadWebRoute(client, match, "en-US");
    assert.equal(result.status, "ready");
    assert.deepEqual(calls.slice(0, 2), [endpointCall, "goldPath:en-US"]);
    assert.equal(result.html.includes('data-r4-web-route-status="ready"'), true);
    assert.equal(result.html.includes('data-r4-product-shell="true"'), true);
    assert.equal(result.html.match(/data-wh-panel=/gu)?.length, 1);
    assert.equal(result.html.includes(`href="${path}"`) || result.html.includes('href="/approvals"'), true);
    assert.equal(result.html.toLowerCase().includes("kanban"), false);
  }
});

test("R4.10 web loader marks Home, Approvals, and Replay as route components", async () => {
  const surface = goldPathSurfaceVm();

  for (const [path, endpointCall, routeComponent] of [
    ["/", "attention:en-US", "home"],
    ["/approvals", "approvals:en-US", "approvals"],
    ["/agent-runs/run-42/replay", "replayAgentRun:run-42:en-US", "replay"]
  ] as const) {
    const { client, calls } = fakeRouteClient(surface);
    const match = resolveWebRoute(path);
    assert.ok(match);
    const result = await loadWebRoute(client, match, "en-US");
    assert.equal(result.status, "ready");
    assert.deepEqual(calls.slice(0, 2), [endpointCall, "goldPath:en-US"]);
    assert.equal(result.html.includes(`data-r4-route-component="${routeComponent}"`), true);
    assert.equal(result.html.includes('data-r4-route-component-source="page-vm"'), true);
    assert.equal(result.html.includes('data-r4-route-component-locale="en-US"'), true);
    assert.equal(result.html.includes("weekly_report_manifest_doc"), false);
    assert.equal(result.html.includes('href="#/'), false);
    assert.equal(result.html.includes("data-cuu"), false);
    assert.equal(result.html.toLowerCase().includes("kanban"), false);
    assert.equal(result.html.match(/data-wh-panel=/gu)?.length, 1);
  }
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
