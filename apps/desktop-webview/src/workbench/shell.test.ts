import assert from "node:assert/strict";
import { test } from "node:test";

import type { WorkbenchPageVM } from "@workhub/contracts";

import {
  renderCenterErrorHtml,
  renderCenterLoadingHtml,
  renderEmptyStateHtml,
  renderProjectSummaryHtml,
  renderSidePanelPlaceholderHtml,
  renderWorkbenchShellHtml
} from "./shell.js";

function workbenchVm(over: Partial<WorkbenchPageVM> = {}): WorkbenchPageVM {
  return {
    generated_at: "2026-07-12T00:00:00.000Z",
    project: {
      id: "90000000-0000-4000-8000-000000000001",
      workspace_id: "90000000-0000-4000-8000-000000000000",
      name: "星尘短剧",
      slug: "xingchen",
      description: "短剧选题与投放协作",
      owner_label: "阿曼"
    },
    viewer: { user_id: "90000000-0000-4000-8000-000000000009", membership_role: "owner", is_project_owner: true },
    conversations: {
      conversations: [
        {
          id: "90000000-0000-4000-8000-000000000101",
          workspace_id: "90000000-0000-4000-8000-000000000000",
          project_id: "90000000-0000-4000-8000-000000000001",
          kind: "main",
          title: "主区",
          parent_conversation_id: null,
          source_message_id: null,
          visibility: "project",
          next_seq: 7,
          created_by: null,
          participant_role: null,
          created_at: "2026-07-01T00:00:00.000Z",
          updated_at: "2026-07-01T00:00:00.000Z"
        }
      ],
      capped: false,
      next_cursor: null
    },
    workspace_members: {
      scope: "workspace",
      total: 3,
      returned: 3,
      capped: false,
      items: [
        { user_id: "90000000-0000-4000-8000-000000000009", nickname: "阿曼", membership_role: "owner", is_project_owner: true, is_self: true }
      ]
    },
    army_summary: { active_plan_count: 2 },
    recent_project_files: {
      items: [{ id: "90000000-0000-4000-8000-000000000201", name: "选题报告.md", updated_at: "2026-07-01T00:00:00.000Z", href: "/drive" }]
    },
    ...over
  };
}

test("renderWorkbenchShellHtml wires drag region, window controls, and all three column mount points", () => {
  const html = renderWorkbenchShellHtml("zh-CN");
  assert.match(html, /data-wb-titlebar/u);
  assert.match(html, /data-wb-minimize/u);
  assert.match(html, /data-wb-close/u);
  assert.match(html, /data-wb-rail/u);
  assert.match(html, /data-wb-center/u);
  assert.match(html, /data-wb-side/u);
  assert.match(html, /data-wb-toggle-side/u);
  assert.match(html, /data-open="true"/u);
});

// R13 批 V2:macOS 原生红绿灯接管标题栏控制——自绘的 min/close 按钮此时整个不渲染（不是 CSS 藏起来）。
test("renderWorkbenchShellHtml omits the self-drawn minimize/close buttons when nativeWindowChrome is set (macOS native traffic lights take over)", () => {
  const html = renderWorkbenchShellHtml("zh-CN", { nativeWindowChrome: true });
  assert.doesNotMatch(html, /data-wb-minimize/u);
  assert.doesNotMatch(html, /data-wb-close/u);
  assert.match(html, /wh-wb-titlebar--native/u);
  // The rest of the shell (rail/center/side mount points, drag region) is unaffected.
  assert.match(html, /data-wb-titlebar/u);
  assert.match(html, /data-wb-rail/u);
  assert.match(html, /data-wb-center/u);
  assert.match(html, /data-wb-side/u);
});

test("renderWorkbenchShellHtml defaults to the self-drawn window controls when nativeWindowChrome is omitted", () => {
  const html = renderWorkbenchShellHtml("en-US", {});
  assert.match(html, /data-wb-minimize/u);
  assert.match(html, /data-wb-close/u);
  assert.doesNotMatch(html, /wh-wb-titlebar--native/u);
});

test("renderEmptyStateHtml offers a real 'new project' CTA only when there are no projects yet", () => {
  const noProjects = renderEmptyStateHtml("zh-CN", false);
  assert.match(noProjects, /data-wb-new-project/u);
  assert.match(noProjects, /先建一个项目/u);

  const hasProjects = renderEmptyStateHtml("zh-CN", true);
  assert.doesNotMatch(hasProjects, /data-wb-new-project/u);
  assert.match(hasProjects, /选一个项目开始/u);
});

test("renderEmptyStateHtml uses plain, non-jargon guidance copy", () => {
  const html = renderEmptyStateHtml("zh-CN", false);
  assert.doesNotMatch(html, /branch|merge|commit|repository/iu);
});

test("renderProjectSummaryHtml surfaces real VM numbers (message count, members, runs, files)", () => {
  const html = renderProjectSummaryHtml(workbenchVm(), "zh-CN");
  assert.match(html, /星尘短剧/u);
  assert.match(html, /短剧选题与投放协作/u);
  assert.match(html, /wh-wb-summary-metric-v">7</u); // main chat message count
  assert.match(html, /wh-wb-summary-metric-v">3</u); // members
  assert.match(html, /wh-wb-summary-metric-v">2</u); // active runs
  assert.match(html, /wh-wb-summary-metric-v">1</u); // drive files
});

test("renderProjectSummaryHtml falls back to the owner label when the project has no description", () => {
  const html = renderProjectSummaryHtml(workbenchVm({ project: { ...workbenchVm().project, description: null } }), "zh-CN");
  assert.match(html, /负责人 阿曼/u);
});

test("renderCenterLoadingHtml and renderCenterErrorHtml render distinct, honest states", () => {
  assert.match(renderCenterLoadingHtml("zh-CN"), /正在打开工作台/u);
  const errored = renderCenterErrorHtml("zh-CN");
  assert.match(errored, /没打开这个项目的工作台/u);
  assert.match(errored, /data-wb-retry-vm/u);
});

test("renderSidePanelPlaceholderHtml is an honest 'not built yet' notice, not fake data", () => {
  const html = renderSidePanelPlaceholderHtml("zh-CN");
  assert.match(html, /即将上线/u);
  assert.doesNotMatch(html, /wh-wb-runcard/u);
});
