import assert from "node:assert/strict";
import test from "node:test";

import { createP05GoldPathFixture } from "@workhub/agent/fixtures";
import type { AcceptedDeliverableVM, GoldPathSurfaceVM } from "@workhub/contracts";
import { toCuuState } from "@workhub/events";

import { renderGoldPathSurface } from "./render.js";

function surfaceVm() {
  const fixture = createP05GoldPathFixture();
  return {
    fixture_id: fixture.id,
    routes: {
      home: "/",
      intake: "/intake/demo",
      approvals: "/approvals",
      workitem: "/workitems/demo",
      proposal: "/proposals/demo",
      replay: "/agent-runs/demo/replay",
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
    cuu_states: fixture.events.map((event) => toCuuState(event))
  } as const;
}

test("gold path renderer creates the P0.5 pages plus app settings from one shared VM", () => {
  const rendered = renderGoldPathSurface(surfaceVm(), "web");

  assert.equal(rendered.fixtureId, "weekly_report_manifest_doc");
  assert.deepEqual(rendered.pages.map((page) => page.key), [
    "home",
    "intake",
    "approvals",
    "workitem",
    "proposal",
    "replay",
    "cost",
    "settings"
  ]);
  assert.equal(rendered.pages.every((page) => page.html.includes("wh-shell")), true);
});

test("approval center keeps the blocking decision visible without turning into a kanban", () => {
  const approvals = renderGoldPathSurface(surfaceVm(), "web").pages.find((page) => page.key === "approvals");

  assert.equal(approvals?.html.includes("Approval center"), true);
  assert.equal(approvals?.html.includes("data-requires-reason=\"true\""), true);
  assert.equal(approvals?.html.includes("kanban"), false);
  assert.equal(approvals?.cuuState, "asking_approval");
});

test("option intake stays option-first with collapsed free text instead of a chat wall", () => {
  const intake = renderGoldPathSurface(surfaceVm(), "desktop").pages.find((page) => page.key === "intake");

  assert.equal(intake?.html.includes("data-option-id"), true);
  assert.equal(intake?.html.includes("<textarea"), false);
  assert.equal(intake?.html.includes("message-list"), false);
});

test("gold path renderer localizes static page chrome while keeping VM content intact", () => {
  const rendered = renderGoldPathSurface(surfaceVm(), "web", { locale: "en-US" });
  const home = rendered.pages.find((page) => page.key === "home");
  const cost = rendered.pages.find((page) => page.key === "cost");
  const settings = rendered.pages.find((page) => page.key === "settings");

  assert.equal(home?.html.includes("Needs your decision"), true);
  assert.equal(home?.html.includes("The board is fallback only"), true);
  assert.equal(home?.html.includes("Cuu ·"), false);
  assert.equal(home?.html.includes("./assets/cuu/"), false);
  assert.equal(home?.html.includes("data-cuu-asset=\"bitmap\""), false);
  assert.equal(rendered.css.includes("wh-cuu-portrait"), false);
  assert.equal(cost?.html.includes("Budget and cost"), true);
  assert.equal(cost?.html.includes("Regular users see their own slice"), true);
  assert.equal(settings?.html.includes("App settings"), true);
  assert.equal(settings?.html.includes("AI runtime"), true);
  assert.equal(settings?.html.includes("independent pet window"), true);
  assert.equal(settings?.html.includes("data-cuu-settings-model-pack-selectable"), false);
  assert.equal(settings?.html.includes("Cuu settings"), false);
});

test("settings page stays serious and keeps pet model choice out of the main app", () => {
  const settings = renderGoldPathSurface(surfaceVm(), "desktop").pages.find((page) => page.key === "settings");

  assert.equal(settings?.route, "/settings");
  assert.equal(settings?.title, "Settings");
  assert.equal(settings?.html.includes("应用设置"), true);
  assert.equal(settings?.html.includes("桌宠形象只在独立桌宠窗口里配置和验收"), true);
  assert.equal(settings?.html.includes("legacy-cuu-pack"), false);
  assert.equal(settings?.html.includes("Live2D 实验形象"), false);
  assert.equal(settings?.html.includes("data-cuu-settings-model-pack-id"), false);
});

test("proposal and replay pages expose review actions, rollback, cost, and at least five replay steps", () => {
  const rendered = renderGoldPathSurface(surfaceVm(), "web");
  const proposal = rendered.pages.find((page) => page.key === "proposal");
  const replay = rendered.pages.find((page) => page.key === "replay");

  assert.equal(proposal?.html.includes("回滚"), true);
  assert.equal(proposal?.html.includes("data-requires-reason=\"true\""), true);
  assert.equal(proposal?.html.includes("data-action-id=\"merge\""), true);
  assert.equal(replay?.html.includes("估算成本"), true);
  assert.equal((replay?.html.match(/wh-row/gu)?.length ?? 0) >= 5, true);
});

test("replay page surfaces accepted deliverables with preview and download actions", () => {
  const vm = surfaceVm();
  const deliverable: AcceptedDeliverableVM = {
    id: "76000000-0000-4000-8000-000000000001",
    work_item_id: vm.page_vms.replay.run.work_item_id,
    proposal_id: "76000000-0000-4000-8000-000000000002",
    change_id: "76000000-0000-4000-8000-000000000003",
    target_kind: "delivery",
    target_key: "delivery:/outputs/result.md",
    change_type: "created",
    accepted_version: 2,
    target_path: "/outputs/result.md",
    filename: "result.md",
    mime: "text/markdown",
    size_bytes: 42,
    download_href: "/api/workitems/demo/deliverables/accepted-1/download",
    preview_href: "/api/workitems/demo/deliverables/accepted-1/preview",
    restore_href: "/api/workitems/demo/deliverables/accepted-1/restore",
    accepted_at: "2026-06-05T00:00:00.000Z"
  };
  const custom: GoldPathSurfaceVM = {
    ...vm,
    page_vms: {
      ...vm.page_vms,
      replay: {
        ...vm.page_vms.replay,
        accepted_deliverables: [deliverable]
      }
    }
  };

  const replay = renderGoldPathSurface(custom, "web").pages.find((page) => page.key === "replay");

  assert.equal(replay?.html.includes("正式交付物"), true);
  assert.equal(replay?.html.includes("result.md"), true);
  assert.equal(replay?.html.includes("/api/workitems/demo/deliverables/accepted-1/preview"), true);
  assert.equal(replay?.html.includes("/api/workitems/demo/deliverables/accepted-1/download"), true);
  assert.equal(replay?.html.includes("/api/workitems/demo/deliverables/accepted-1/restore"), true);
  assert.equal(replay?.html.includes("data-method=\"POST\""), true);
  assert.deepEqual(replay?.primaryHrefs, [
    "/api/workitems/demo/deliverables/accepted-1/preview",
    "/api/workitems/demo/deliverables/accepted-1/download",
    "/api/workitems/demo/deliverables/accepted-1/restore"
  ]);
});
