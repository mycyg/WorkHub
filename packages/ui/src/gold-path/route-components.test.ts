import assert from "node:assert/strict";
import test from "node:test";

import { createP05GoldPathFixture, validateP05GoldPathFixture } from "@workhub/agent/fixtures";
import type { GoldPathSurfaceVM } from "@workhub/contracts";

import { renderWebRouteComponents } from "./route-components.js";

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
      cost: "/dashboard/cost"
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
      cost: fixture.costDashboard
    },
    events: fixture.events,
    cuu_states: []
  };
}

function assertNoMainWindowBoundaryLeak(html: string) {
  assert.equal(html.includes("data-cuu"), false);
  assert.equal(html.includes("./assets/cuu/"), false);
  assert.equal(html.toLowerCase().includes("kanban"), false);
  assert.equal(html.includes('href="#/'), false);
  assert.equal(html.includes("weekly_report_manifest_doc"), false);
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
