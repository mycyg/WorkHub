import assert from "node:assert/strict";
import test from "node:test";

import { createP05GoldPathFixture, validateP05GoldPathFixture } from "@workhub/agent/fixtures";

import { renderGoldPathSurface } from "./render.js";
import { renderWebProductShell } from "./product-shell.js";
import { renderWebRouteComponents } from "./route-components.js";

function renderedSurface(locale: "zh-CN" | "en-US" = "en-US") {
  const fixture = validateP05GoldPathFixture(createP05GoldPathFixture());
  return renderGoldPathSurface({
    fixture_id: fixture.id,
    routes: {
      home: "/",
      intake: "/intake/r4-product-shell-session",
      approvals: "/approvals",
      workitem: "/workitems/r4-product-shell-workitem",
      proposal: "/proposals/r4-product-shell-proposal",
      replay: "/agent-runs/r4-product-shell-run/replay",
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
  }, "web", { locale });
}

test("R4 product shell preserves browser hooks while replacing the preview chrome", () => {
  const shell = renderWebProductShell(renderedSurface("zh-CN"), {
    appName: "WorkHub",
    surfaceLabel: "Web R4",
    apiBaseLabel: "/api/pages/attention",
    currentRoute: "/approvals",
    locale: "en-US",
    linkMode: "path"
  });

  assert.equal(shell.html.includes('data-r4-product-shell="true"'), true);
  assert.equal(shell.html.includes('data-r4-product-route-key="approvals"'), true);
  assert.equal(shell.html.includes('data-r4-product-masthead="true"'), true);
  assert.equal(shell.html.includes('data-wh-locale="zh-CN"'), true);
  assert.equal(shell.html.includes('data-wh-page-key="approvals"'), true);
  assert.equal(shell.html.includes('data-wh-panel="approvals"'), true);
  assert.equal(shell.html.includes('href="/approvals"'), true);
  assert.equal(shell.html.includes('href="#/approvals"'), false);
  assert.equal(shell.html.includes("wh-app-root"), false);
  assert.equal(shell.html.toLowerCase().includes("kanban"), false);
  assert.equal(shell.html.includes("data-cuu"), false);
  assert.equal(shell.css.includes("@media (max-width:780px)"), true);
});

test("R4 product shell localizes fixed product chrome", () => {
  const shell = renderWebProductShell(renderedSurface("zh-CN"), {
    appName: "WorkHub",
    surfaceLabel: "Web R4",
    currentRoute: "/workitems/r4-product-shell-workitem",
    locale: "zh-CN",
    linkMode: "path"
  });

  assert.equal(shell.html.includes("工作入口"), true);
  assert.equal(shell.html.includes("<h1>任务详情</h1>"), true);
  assert.equal(shell.html.includes("当前焦点"), true);
  assert.equal(shell.html.includes("任务详情把验收、证据、AI 轨迹与最近变更放在同一处。"), true);
  assert.equal(shell.html.includes("REST 真相源"), true);
  assert.equal(shell.html.includes("Web 管理端"), true);
  assert.equal(shell.html.includes('data-r4-product-route-key="workitem"'), true);
  assert.equal(shell.html.includes('aria-pressed="true" title="中文"'), true);
});

test("R4 product shell defaults to path navigation without hash fallback", () => {
  const shell = renderWebProductShell(renderedSurface(), {
    appName: "WorkHub",
    surfaceLabel: "Web R4",
    currentRoute: "/approvals",
    locale: "en-US"
  });

  assert.equal(shell.html.includes('data-r4-product-link-mode="path"'), true);
  assert.equal(shell.html.includes('href="#/'), false);
  assert.equal(shell.html.includes('href="/approvals"'), true);
});

test("R4 product shell metrics come from Page VM data instead of HTML probes", () => {
  const replaySurface = renderedSurface();
  const replayShell = renderWebProductShell(replaySurface, {
    appName: "WorkHub",
    surfaceLabel: "Web R4",
    currentRoute: "/agent-runs/r4-product-shell-run/replay",
    locale: "en-US",
    linkMode: "path"
  });
  const replay = replaySurface.vm.page_vms.replay;

  assert.equal(
    replayShell.html.includes(
      `data-r4-product-metric="steps"><strong>${replay.steps.length}</strong><span>Steps</span>`
    ),
    true
  );
  assert.equal(
    replayShell.html.includes(
      `data-r4-product-metric="decisions"><strong>${replay.merge_timeline.length}</strong><span>Decisions</span>`
    ),
    true
  );

  const costSurface = renderedSurface();
  const costShell = renderWebProductShell(costSurface, {
    appName: "WorkHub",
    surfaceLabel: "Web R4",
    currentRoute: "/dashboard/cost",
    locale: "en-US",
    linkMode: "path"
  });
  const cost = costSurface.vm.page_vms.cost;

  assert.equal(
    costShell.html.includes(
      `data-r4-product-metric="tokens"><strong>${cost.token_in + cost.token_out}</strong><span>Tokens</span>`
    ),
    true
  );
  assert.equal(
    costShell.html.includes(
      `data-r4-product-metric="cost"><strong>¥${cost.total_cost_cny}</strong><span>Cost</span>`
    ),
    true
  );
});

test("R4.10 product shell can render only the active route component panel", () => {
  const rendered = renderedSurface("en-US");
  const shell = renderWebProductShell(rendered, {
    appName: "WorkHub",
    surfaceLabel: "Web R4",
    currentRoute: "/approvals",
    locale: "en-US",
    linkMode: "path",
    routeComponents: renderWebRouteComponents(rendered.vm, { locale: "en-US" }),
    renderActivePanelOnly: true
  });

  assert.equal(shell.html.includes('data-r4-product-route-key="approvals"'), true);
  assert.equal(shell.html.includes('data-r4-route-component-panel="approvals"'), true);
  assert.equal(shell.html.includes('data-r4-route-component="approvals"'), true);
  assert.equal(shell.html.match(/data-wh-panel=/gu)?.length, 1);
  assert.equal(shell.html.includes('data-wh-panel="home"'), false);
  assert.equal(shell.html.includes('data-wh-panel="replay"'), false);
  assert.equal(shell.html.includes("weekly_report_manifest_doc"), false);
  assert.equal(shell.html.includes('href="#/'), false);
  assert.equal(shell.html.includes("data-cuu"), false);
  assert.equal(shell.html.toLowerCase().includes("kanban"), false);
  assert.match(shell.css, /\.wh-r4-route\{display:grid;gap:16px/u);
});
