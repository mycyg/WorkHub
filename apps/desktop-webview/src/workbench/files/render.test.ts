import assert from "node:assert/strict";
import test from "node:test";

import type { ArmyOutputLinkVM, DriveItemVM } from "@workhub/contracts";

import { changedRowsFromOutputs, renderFilesSidePanelHtml, type FilesSidePanelState } from "./render.js";

function output(overrides: Partial<ArmyOutputLinkVM> = {}): ArmyOutputLinkVM {
  return {
    proposal_id: "10000000-0000-4000-8000-000000000001",
    work_item_id: "20000000-0000-4000-8000-000000000001",
    run_id: "30000000-0000-4000-8000-000000000001",
    title: "隐私区文案",
    status: "opened",
    proposal_href: "/proposals/10000000-0000-4000-8000-000000000001",
    updated_at: "2026-07-16T00:00:00.000Z",
    ...overrides
  };
}

test("changedRowsFromOutputs flattens per-proposal changed files and derives basenames", () => {
  const rows = changedRowsFromOutputs([
    output({
      changed_files: [
        { path: "/outputs/privacy-section.md", change_type: "updated", adds: 18, dels: 11 },
        { path: "/outputs/nested/home-hero.md", change_type: "created", adds: 40 }
      ]
    }),
    output({ proposal_id: "10000000-0000-4000-8000-000000000002", changed_files: undefined })
  ]);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], {
    proposalId: "10000000-0000-4000-8000-000000000001",
    proposalTitle: "隐私区文案",
    status: "opened",
    path: "/outputs/privacy-section.md",
    filename: "privacy-section.md",
    changeType: "updated",
    adds: 18,
    dels: 11
  });
  assert.equal(rows[1]?.filename, "home-hero.md");
  assert.equal(rows[1]?.dels, undefined);
});

test("changedRowsFromOutputs skips files with no path (can't open an editor without one)", () => {
  const rows = changedRowsFromOutputs([
    output({ changed_files: [{ change_type: "updated", adds: 1, dels: 1 }] })
  ]);
  assert.equal(rows.length, 0);
});

test("renderFilesSidePanelHtml renders changed rows with a diffstat, status tag and editor hook", () => {
  const state: FilesSidePanelState = {
    sub: "changed",
    changed: {
      status: "ready",
      rows: [
        {
          proposalId: "p1",
          proposalTitle: "t",
          status: "reviewed",
          path: "/outputs/a.md",
          filename: "a.md",
          changeType: "updated",
          adds: 3,
          dels: 2
        }
      ]
    },
    all: { status: "idle" }
  };
  const html = renderFilesSidePanelHtml(state, "zh-CN");
  assert.match(html, /data-wb-files-open-editor/u);
  assert.match(html, /data-wb-files-path="\/outputs\/a\.md"/u);
  assert.match(html, /wh-wb-files-add">\+3/u);
  assert.match(html, /wh-wb-files-del">−2/u);
  assert.match(html, /wh-wb-files-tag--reviewed/u);
  assert.match(html, /变动文件/u);
});

test("renderFilesSidePanelHtml renders the drive tree only in the 'all' sub-tab with preview hooks", () => {
  const item: DriveItemVM = {
    id: "d1",
    project_id: "pr1",
    name: "report.md",
    kind: "file",
    path: "/report.md",
    depth: 0,
    children_count: 0,
    updated_at: "2026-07-16T00:00:00.000Z"
  };
  const state: FilesSidePanelState = {
    sub: "all",
    changed: { status: "ready", rows: [] },
    all: { status: "ready", items: [item] }
  };
  const html = renderFilesSidePanelHtml(state, "zh-CN");
  assert.match(html, /data-wb-files-open-drive/u);
  assert.match(html, /data-wb-files-item="d1"/u);
  assert.doesNotMatch(html, /data-wb-files-open-editor/u);
});

test("renderFilesSidePanelHtml shows an honest empty state when there are no changed files", () => {
  const state: FilesSidePanelState = {
    sub: "changed",
    changed: { status: "ready", rows: [] },
    all: { status: "idle" }
  };
  const html = renderFilesSidePanelHtml(state, "zh-CN");
  assert.match(html, /还没有开着的变更提议/u);
});
