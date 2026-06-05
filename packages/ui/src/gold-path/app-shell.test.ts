import assert from "node:assert/strict";
import test from "node:test";

import { createP05GoldPathFixture } from "@workhub/agent/fixtures";
import { toCuuState } from "@workhub/events";
import type { GoldPathSurfaceVM } from "@workhub/contracts";

import { classifyGoldPathHref, renderGoldPathAppShell, resolveGoldPathPageKey } from "./app-shell.js";
import { renderGoldPathSurface } from "./render.js";

function surfaceVm(): GoldPathSurfaceVM {
  const fixture = createP05GoldPathFixture();
  return {
    fixture_id: fixture.id,
    routes: {
      home: "/",
      intake: "/intake/demo",
      workitem: "/workitems/demo",
      proposal: "/proposals/demo",
      replay: "/agent-runs/demo/replay",
      cost: "/dashboard/cost"
    },
    page_vms: {
      attention: fixture.attentionHome,
      question: fixture.question,
      evidence: fixture.evidenceBubble,
      workitem: fixture.workItemDetail,
      proposal: fixture.proposalDetail,
      replay: fixture.replay,
      cost: fixture.costDashboard
    },
    events: fixture.events,
    cuu_states: fixture.events.map((event) => toCuuState(event))
  };
}

test("gold path app shell renders navigable panels around the shared pages", () => {
  const shell = renderGoldPathAppShell(renderGoldPathSurface(surfaceVm(), "web"), {
    appName: "WorkHub",
    surfaceLabel: "Web P0.5"
  });

  assert.equal(Object.keys(shell.routeMap).includes("/proposals/demo"), true);
  assert.equal(shell.html.includes("data-wh-panel=\"proposal\""), true);
  assert.equal(shell.html.includes("aria-label=\"Gold Path\""), true);
  assert.equal(shell.css.includes("wh-cuu-cat"), true);
});

test("gold path app shell resolves routes and keeps API actions separate from page navigation", () => {
  const shell = renderGoldPathAppShell(renderGoldPathSurface(surfaceVm(), "desktop"), {
    appName: "WorkHub",
    surfaceLabel: "Desktop P0.5"
  });

  assert.equal(resolveGoldPathPageKey(shell.routeMap, "/agent-runs/demo/replay?from=proposal"), "replay");
  assert.deepEqual(classifyGoldPathHref(shell.routeMap, "/proposals/demo"), {
    kind: "navigate",
    pageKey: "proposal"
  });
  assert.deepEqual(classifyGoldPathHref(shell.routeMap, "/api/proposals/demo/review", { requiresReason: true, method: "POST" }), {
    kind: "api-action",
    requiresReason: true,
    method: "POST"
  });
});
