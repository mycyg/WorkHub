import assert from "node:assert/strict";
import { test } from "node:test";

import type { ProjectListItemVM, WorkbenchPageVM } from "@workhub/contracts";

import { renderArmyOverviewNavHtml, renderNewProjectModalHtml, renderProjectTreeHtml, renderRailFootHtml } from "./rail.js";

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
});

// R12 批 2：主区群聊接进这个窗口后，「主区」树叶从只读升级成真按钮（会话点击路由）——
// batch-1-frontend.md 已经预告了这次升级（"批 2/6 把对应视图接进来时再升级成可点"）。
// 「网盘」还没有对应视图（批 6），继续保持只读，不给假点击反馈。
test("the main-conversation leaf is a real, clickable button once batch 2 wires the chat view", () => {
  const vm = workbenchVm();
  const html = renderProjectTreeHtml({
    projects: [project()],
    selectedProjectId: project().id,
    vm,
    locale: "zh-CN"
  });
  assert.match(html, /<button[^>]*data-wb-open-main-chat[^>]*>[^]*主区/u);
});

// R12 批 6：网盘视图接进这个窗口后，「网盘」树叶从只读升级成真按钮（切中栏到 drive 标签，见
// shell.ts 的 onOpenDrive）——上面批 2 的测试已经预告了这次升级会在批 6 发生，这不是临时改断言迁就
// 实现，是照原定计划把断言换成新行为。
test("the drive leaf is a real, clickable button once batch 6 wires the drive view", () => {
  const vm = workbenchVm();
  const html = renderProjectTreeHtml({
    projects: [project()],
    selectedProjectId: project().id,
    vm,
    locale: "zh-CN"
  });
  assert.match(html, /<button[^>]*data-wb-open-drive[^>]*>[^]*网盘/u);
});

function leafTag(html: string, marker: string): string {
  const match = html.match(new RegExp(`<button[^>]*${marker}[^>]*>`, "u"));
  assert.ok(match, `expected to find a <button> tag carrying ${marker}`);
  return match![0];
}

test("centerTab decides which leaf is visually selected (defaults to the main chat)", () => {
  const vm = workbenchVm();
  const defaultTab = renderProjectTreeHtml({ projects: [project()], selectedProjectId: project().id, vm, locale: "zh-CN" });
  const driveTab = renderProjectTreeHtml({ projects: [project()], selectedProjectId: project().id, vm, locale: "zh-CN", centerTab: "drive" });
  assert.match(leafTag(defaultTab, "data-wb-open-main-chat"), / sel/u);
  assert.match(leafTag(driveTab, "data-wb-open-drive"), / sel/u);
  assert.doesNotMatch(leafTag(driveTab, "data-wb-open-main-chat"), / sel/u);
});

// leafTag 只截取开标签（够 rail 既有测试判断 " sel" class 用）；这里还要断言标签内部的计数徽标，
// 需要连闭合 </button> 一起截出来。
function leafButtonOuterHtml(html: string, marker: string): string {
  const match = html.match(new RegExp(`<button[^>]*${marker}[^>]*>[^]*?</button>`, "u"));
  assert.ok(match, `expected to find a full <button>...</button> carrying ${marker}`);
  return match![0];
}

// R12（final-turns-wiring）：协同会话树叶——批 4a 只做了服务端 POST /conversations/:id/turns，
// 从没有任何 UI 调用方能真的点开一个协同会话；这几条测试锁死 rail 这一侧的洞已经补上。
function collabConversationVm(over: Partial<WorkbenchPageVM["conversations"]["conversations"][number]> = {}) {
  return {
    id: "90000000-0000-4000-8000-000000000102",
    workspace_id: "90000000-0000-4000-8000-000000000000",
    project_id: "90000000-0000-4000-8000-000000000001",
    kind: "collab" as const,
    title: "与 Cuu 的对话",
    parent_conversation_id: null,
    source_message_id: null,
    visibility: "private" as const,
    next_seq: 4,
    created_by: "90000000-0000-4000-8000-000000000009",
    participant_role: "owner" as const,
    created_at: "2026-07-01T00:00:00.000Z",
    updated_at: "2026-07-01T00:00:00.000Z",
    ...over
  };
}

test("renderProjectTreeHtml renders a real, clickable leaf for every collab conversation visible to the viewer", () => {
  const vm = workbenchVm({
    conversations: {
      conversations: [...workbenchVm().conversations.conversations, collabConversationVm()],
      capped: false,
      next_cursor: null
    }
  });
  const html = renderProjectTreeHtml({ projects: [project()], selectedProjectId: project().id, vm, locale: "zh-CN" });
  assert.match(html, /<button[^>]*data-wb-open-collab-chat="90000000-0000-4000-8000-000000000102"[^>]*>[^]*与 Cuu 的对话/u);
  assert.match(
    leafButtonOuterHtml(html, 'data-wb-open-collab-chat="90000000-0000-4000-8000-000000000102"'),
    /wh-wb-leaf-count">4</u
  );
});

test("renderProjectTreeHtml renders one leaf per collab conversation when there are several", () => {
  const vm = workbenchVm({
    conversations: {
      conversations: [
        ...workbenchVm().conversations.conversations,
        collabConversationVm({ id: "collab-a", title: "阿曼与 Cuu" }),
        collabConversationVm({ id: "collab-b", title: "小马与 Cuu" })
      ],
      capped: false,
      next_cursor: null
    }
  });
  const html = renderProjectTreeHtml({ projects: [project()], selectedProjectId: project().id, vm, locale: "zh-CN" });
  assert.match(html, /data-wb-open-collab-chat="collab-a"/u);
  assert.match(html, /data-wb-open-collab-chat="collab-b"/u);
});

test("a collab leaf is marked selected only when centerTab is 'collab' and its id matches activeConversationId", () => {
  const vm = workbenchVm({
    conversations: {
      conversations: [...workbenchVm().conversations.conversations, collabConversationVm()],
      capped: false,
      next_cursor: null
    }
  });
  const notSelected = renderProjectTreeHtml({ projects: [project()], selectedProjectId: project().id, vm, locale: "zh-CN" });
  assert.doesNotMatch(leafTag(notSelected, 'data-wb-open-collab-chat="90000000-0000-4000-8000-000000000102"'), / sel/u);

  const selected = renderProjectTreeHtml({
    projects: [project()],
    selectedProjectId: project().id,
    vm,
    locale: "zh-CN",
    centerTab: "collab",
    activeConversationId: "90000000-0000-4000-8000-000000000102"
  });
  assert.match(leafTag(selected, 'data-wb-open-collab-chat="90000000-0000-4000-8000-000000000102"'), / sel/u);
  // Selecting a collab conversation must not also mark the main leaf as selected.
  assert.doesNotMatch(leafTag(selected, "data-wb-open-main-chat"), / sel/u);
});

test("no collab leaves render when the project has no visible collab conversations (the common case today)", () => {
  const vm = workbenchVm();
  const html = renderProjectTreeHtml({ projects: [project()], selectedProjectId: project().id, vm, locale: "zh-CN" });
  assert.doesNotMatch(html, /data-wb-open-collab-chat/u);
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

// R13 批 P1：军团总览从 rail-foot 的不可点预告条升级成左栏一级入口（renderArmyOverviewNavHtml，
// 见下面新测试）——rail-foot 现在只剩「我」这一行，旧的"即将上线"摘要条已退役（用户拍板 4）。
test("renderRailFootHtml no longer carries the retired army-overview summary strip, only the viewer label", () => {
  const withViewer = renderRailFootHtml(true, "阿曼 · 已连接");
  assert.doesNotMatch(withViewer, /军团总览/u);
  assert.doesNotMatch(withViewer, /wh-wb-army-sum/u);
  assert.match(withViewer, /阿曼 · 已连接/u);
  const withoutViewer = renderRailFootHtml(true, undefined);
  assert.doesNotMatch(withoutViewer, /wh-wb-me/u);
});

test("renderArmyOverviewNavHtml is a real, clickable top-level entry point (peer to the project list)", () => {
  const html = renderArmyOverviewNavHtml(true, false);
  assert.match(html, /<button[^>]*data-wb-open-army-overview[^>]*>[^]*军团总览/u);
});

test("renderArmyOverviewNavHtml marks itself active only when the caller says so", () => {
  const active = renderArmyOverviewNavHtml(true, true);
  assert.match(active, /class="wh-wb-army-nav active"/u);
  const inactive = renderArmyOverviewNavHtml(true, false);
  assert.doesNotMatch(inactive, /class="wh-wb-army-nav active"/u);
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
