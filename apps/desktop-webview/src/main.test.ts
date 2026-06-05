import assert from "node:assert/strict";
import test from "node:test";

import type { WorkHubApiClient } from "@workhub/api-client";
import type { GoldPathSurfaceVM } from "@workhub/contracts";

import { desktopWebviewSurface, loadDesktopGoldPathSurface } from "./main.js";

function fakeClient(surface: GoldPathSurfaceVM): WorkHubApiClient {
  return {
    async health() {
      throw new Error("not needed");
    },
    async openapi() {
      throw new Error("not needed");
    },
    async identify() {
      throw new Error("not needed");
    },
    async me() {
      throw new Error("not needed");
    },
    async notifications() {
      throw new Error("not needed");
    },
    async respondApproval() {
      throw new Error("not needed");
    },
    async nextQuestion() {
      throw new Error("not needed");
    },
    async searchKnowledge() {
      throw new Error("not needed");
    },
    async replayAgentRun() {
      throw new Error("not needed");
    },
    pages: {
      async attention() {
        throw new Error("not needed");
      },
      async approvals() {
        throw new Error("not needed");
      },
      async cost() {
        throw new Error("not needed");
      },
      async goldPath() {
        return surface;
      },
      async workItem() {
        throw new Error("not needed");
      },
      async proposal() {
        throw new Error("not needed");
      }
    },
    streamUrl: (path) => path,
    async request() {
      throw new Error("not needed");
    }
  };
}

test("desktop webview surface advertises and loads the shared P0.5 gold path page VM", async () => {
  const surface = {
    fixture_id: "weekly_report_manifest_doc",
    routes: {
      home: "/",
      intake: "/intake/session",
      workitem: "/workitems/work",
      proposal: "/proposals/proposal",
      replay: "/agent-runs/run/replay",
      cost: "/dashboard/cost"
    },
    page_vms: {},
    events: [],
    cuu_states: ["carrying_document"]
  } as unknown as GoldPathSurfaceVM;

  assert.equal(desktopWebviewSurface.pages.includes("/api/pages/gold-path"), true);
  assert.equal((await loadDesktopGoldPathSurface(fakeClient(surface))).fixture_id, "weekly_report_manifest_doc");
});
