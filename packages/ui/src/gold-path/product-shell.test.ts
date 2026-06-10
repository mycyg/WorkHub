import assert from "node:assert/strict";
import test from "node:test";

import { createP05GoldPathFixture, validateP05GoldPathFixture } from "@workhub/agent/fixtures";

import { renderGoldPathSurface } from "./render.js";
import { renderWebProductShell } from "./product-shell.js";

function renderedSurface() {
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
  }, "web", { locale: "en-US" });
}

test("R4 product shell preserves browser hooks while replacing the preview chrome", () => {
  const shell = renderWebProductShell(renderedSurface(), {
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
  const shell = renderWebProductShell(renderedSurface(), {
    appName: "WorkHub",
    surfaceLabel: "Web R4",
    currentRoute: "/workitems/r4-product-shell-workitem",
    locale: "zh-CN",
    linkMode: "path"
  });

  assert.equal(shell.html.includes("工作入口"), true);
  assert.equal(shell.html.includes("当前焦点"), true);
  assert.equal(shell.html.includes("任务详情把验收、证据、AI 轨迹与最近变更放在同一处。"), true);
  assert.equal(shell.html.includes("REST 真相源"), true);
  assert.equal(shell.html.includes("Web 管理端"), true);
  assert.equal(shell.html.includes('data-r4-product-route-key="workitem"'), true);
  assert.equal(shell.html.includes('aria-pressed="true" title="中文"'), true);
});
