import assert from "node:assert/strict";
import { test } from "node:test";

import type { ProjectListItemVM, WorkbenchPageVM } from "@workhub/contracts";

import { renderNewProjectModalHtml, renderProjectTreeHtml, renderRailFootHtml } from "./rail.js";

function project(over: Partial<ProjectListItemVM> = {}): ProjectListItemVM {
  return {
    id: "90000000-0000-4000-8000-000000000001",
    workspace_id: "90000000-0000-4000-8000-000000000000",
    name: "星尘短剧",
    slug: "xingchen",
    owner_nickname: "阿曼",
    archived: false,
    created_at: "2026-07-01T00:00:00.000Z",
    updated_at: "2026-07-01T00:00:00.000Z",
    open_work_item_count: 0,
    ...over
  };
}

function workbenchVm(over: Partial<WorkbenchPageVM> = {}): WorkbenchPageVM {
  return {
    generated_at: "2026-07-12T00:00:00.000Z",
    project: {
      id: "90000000-0000-4000-8000-000000000001",
      workspace_id: "90000000-0000-4000-8000-000000000000",
      name: "星尘短剧",
      slug: "xingchen",
      description: null,
      owner_label: "阿曼"
    },
    viewer: {
      user_id: "90000000-0000-4000-8000-000000000009",
      membership_role: "member",
      is_project_owner: false
    },
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
          next_seq: 12,
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
      total: 1,
      returned: 1,
      capped: false,
      items: [
        { user_id: "90000000-0000-4000-8000-000000000009", nickname: "阿曼", membership_role: "member", is_project_owner: false, is_self: true }
      ]
    },
    army_summary: { active_plan_count: 0, empty_state: "no_active_armies" },
    recent_project_files: { items: [], empty_state: "no_recent_files" },
    ...over
  };
}

test("renderProjectTreeHtml renders every project as a real, selectable button", () => {
  const html = renderProjectTreeHtml({
    projects: [project(), project({ id: "p2", name: "知识库改版", open_work_item_count: 3 })],
    selectedProjectId: undefined,
    vm: undefined,
    locale: "zh-CN"
  });
  assert.match(html, /data-wb-select-project="90000000-0000-4000-8000-000000000001"/u);
  assert.match(html, /data-wb-select-project="p2"/u);
  assert.match(html, /星尘短剧/u);
  assert.match(html, /知识库改版/u);
  // Only the project with open work items gets the "has open work" dot.
  assert.match(html, /wh-wb-project-dot/u);
});

test("renderProjectTreeHtml always includes a real 'new project' entry point", () => {
  const html = renderProjectTreeHtml({ projects: [], selectedProjectId: undefined, vm: undefined, locale: "zh-CN" });
  assert.match(html, /data-wb-new-project/u);
  assert.match(html, /新建项目/u);
});

test("renderProjectTreeHtml marks the selected project active and shows its real conversation/drive leaves", () => {
  const vm = workbenchVm();
  const html = renderProjectTreeHtml({
    projects: [project()],
    selectedProjectId: project().id,
    vm,
    locale: "zh-CN"
  });
  assert.match(html, /class="wh-wb-project active"/u);
  // Real main-conversation title and message count from the VM, not a placeholder.
  assert.match(html, /主区/u);
  assert.match(html, /wh-wb-leaf-count">12</u);
  // Leaves are informational only — no click affordance markers.
  assert.doesNotMatch(html, /data-wb-select-project="90000000-0000-4000-8000-000000000101"/u);
});

test("renderProjectTreeHtml does not leak a stale VM onto a different project's row", () => {
  const vm = workbenchVm();
  const html = renderProjectTreeHtml({
    projects: [project({ id: "other-project" })],
    selectedProjectId: "other-project",
    vm, // vm.project.id is still the first project's id
    locale: "zh-CN"
  });
  assert.doesNotMatch(html, /wh-wb-tree/u);
});

test("renderRailFootHtml surfaces the army overview preview and the viewer label when present", () => {
  const withViewer = renderRailFootHtml(true, "阿曼 · 已连接");
  assert.match(withViewer, /军团总览/u);
  assert.match(withViewer, /批 5 开放/u);
  assert.match(withViewer, /阿曼 · 已连接/u);
  const withoutViewer = renderRailFootHtml(true, undefined);
  assert.doesNotMatch(withoutViewer, /wh-wb-me/u);
});

test("the army overview preview is not rendered as a clickable control (its real endpoint is batch 5)", () => {
  const html = renderRailFootHtml(true, undefined);
  assert.doesNotMatch(html, /<button[^>]*wh-wb-army-sum/u);
  assert.doesNotMatch(html, /data-wb-open-army-overview/u);
});

test("renderNewProjectModalHtml toggles data-open and disables the submit button until a name is entered", () => {
  const closed = renderNewProjectModalHtml({ locale: "zh-CN", open: false, name: "", submitting: false });
  assert.match(closed, /data-open="false"/u);
  assert.match(closed, /data-wb-new-project-submit disabled/u);

  const openWithName = renderNewProjectModalHtml({ locale: "zh-CN", open: true, name: "泰诺麦博推广", submitting: false });
  assert.match(openWithName, /data-open="true"/u);
  assert.doesNotMatch(openWithName, /data-wb-new-project-submit disabled/u);
});

test("renderNewProjectModalHtml disables inputs while submitting and surfaces a server error", () => {
  const submitting = renderNewProjectModalHtml({ locale: "zh-CN", open: true, name: "泰诺麦博推广", submitting: true });
  assert.match(submitting, /data-wb-new-project-name[^>]*disabled/u);
  assert.match(submitting, /创建中/u);

  const errored = renderNewProjectModalHtml({
    locale: "zh-CN",
    open: true,
    name: "泰诺麦博推广",
    submitting: false,
    error: "这个项目标识已被占用"
  });
  assert.match(errored, /这个项目标识已被占用/u);
});

test("renderNewProjectModalHtml never claims a git-jargon action verb in the user-facing copy", () => {
  const html = renderNewProjectModalHtml({ locale: "zh-CN", open: true, name: "", submitting: false });
  assert.doesNotMatch(html, /branch|merge|commit|pull request/iu);
});
