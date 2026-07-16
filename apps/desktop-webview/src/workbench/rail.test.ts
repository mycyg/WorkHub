import assert from "node:assert/strict";
import { test } from "node:test";

import type { ConversationVM, DmListItemVM, ProjectListItemVM, WorkbenchPageVM } from "@workhub/contracts";

import {
  appendCollabConversationToVm,
  bumpConversationUnreadInVm,
  bumpDmUnread,
  createCollabConversation,
  IDLE_NEW_COLLAB_MODAL_STATE,
  IDLE_RENAME_COLLAB_MODAL_STATE,
  nextCollabConversationTitle,
  setConversationUnreadInVm,
  setDmUnread,
  renameCollabConversation,
  renameCollabConversationInVm,
  renderArmyOverviewNavHtml,
  renderInboxNavHtml,
  renderDmGroupHtml,
  renderRosterGroupHtml,
  sortRosterMembers,
  renderNewPersonalSpaceModalHtml,
  renderNewCollabModalHtml,
  renderNewProjectModalHtml,
  renderPersonalSpaceSectionHtml,
  renderProjectTreeHtml,
  renderRailFootHtml,
  renderRenameCollabModalHtml,
  type NewCollabModalUiState,
  type RenameCollabModalUiState
} from "./rail.js";

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
          cuu_enabled: true,
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
  const base = workbenchVm();
  // R15 批 A6：树叶尾数字现在是未读数（unread_count），不再是消息总数（next_seq）。
  const vm = setConversationUnreadInVm(base, base.conversations.conversations[0]!.id, 12);
  const html = renderProjectTreeHtml({
    projects: [project()],
    selectedProjectId: project().id,
    vm,
    locale: "zh-CN"
  });
  assert.match(html, /class="wh-wb-project active"/u);
  // Real main-conversation title and unread red badge from the VM, not a placeholder.
  assert.match(html, /主区/u);
  assert.match(html, /wh-wb-leaf-count wh-wb-leaf-count--unread">12</u);
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

// R15 批 E2（项目时间线 / 甘特）：与网盘同级的「时间线」树叶，切中栏到 timeline 标签（见 shell.ts 的
// onOpenTimeline）——真按钮，选中态跟 centerTab === "timeline" 走。
test("the timeline leaf is a real, clickable button (batch E2)", () => {
  const vm = workbenchVm();
  const html = renderProjectTreeHtml({
    projects: [project()],
    selectedProjectId: project().id,
    vm,
    locale: "zh-CN"
  });
  assert.match(html, /<button[^>]*data-wb-open-timeline[^>]*>[^]*时间线/u);
  const selected = renderProjectTreeHtml({
    projects: [project()],
    selectedProjectId: project().id,
    vm,
    locale: "zh-CN",
    centerTab: "timeline"
  });
  assert.match(selected.match(/<button[^>]*data-wb-open-timeline[^>]*>/u)![0], / sel/u);
});

// R16 批 W2：与时间线同级的「任务看板」树叶，切中栏到 kanban 标签（见 shell.ts 的 onOpenKanban）——真按钮，
// 选中态跟 centerTab === "kanban" 走，首发带「新」小徽标（复用现有 wh-wb-leaf-count 徽标类）。
test("the kanban leaf is a real, clickable button with a New badge (batch W2)", () => {
  const vm = workbenchVm();
  const html = renderProjectTreeHtml({
    projects: [project()],
    selectedProjectId: project().id,
    vm,
    locale: "zh-CN"
  });
  const leaf = html.match(/<button[^>]*data-wb-open-kanban[^>]*>[^]*?<\/button>/u)![0];
  assert.match(leaf, /任务看板/u);
  // 「新」徽标复用现有 wh-wb-leaf-count 徽标体系，不造新样式。
  assert.match(leaf, /wh-wb-leaf-count">新</u);
  const selected = renderProjectTreeHtml({
    projects: [project()],
    selectedProjectId: project().id,
    vm,
    locale: "zh-CN",
    centerTab: "kanban"
  });
  assert.match(selected.match(/<button[^>]*data-wb-open-kanban[^>]*>/u)![0], / sel/u);
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
    cuu_enabled: true,
    created_at: "2026-07-01T00:00:00.000Z",
    updated_at: "2026-07-01T00:00:00.000Z",
    ...over
  };
}

test("renderProjectTreeHtml renders a real, clickable leaf for every collab conversation visible to the viewer", () => {
  const vm = workbenchVm({
    conversations: {
      // R15 批 A6：树叶尾数字是未读数（unread_count），不再是 next_seq。
      conversations: [...workbenchVm().conversations.conversations, collabConversationVm({ unread_count: 4 })],
      capped: false,
      next_cursor: null
    }
  });
  const html = renderProjectTreeHtml({ projects: [project()], selectedProjectId: project().id, vm, locale: "zh-CN" });
  assert.match(html, /<button[^>]*data-wb-open-collab-chat="90000000-0000-4000-8000-000000000102"[^>]*>[^]*与 Cuu 的对话/u);
  assert.match(
    leafButtonOuterHtml(html, 'data-wb-open-collab-chat="90000000-0000-4000-8000-000000000102"'),
    /wh-wb-leaf-count wh-wb-leaf-count--unread">4</u
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

// R13 批 P3：项目名右侧的「项目设置」齿轮——只对项目负责人渲染（服务端治理端点读写都锁在负责人上，
// 给非负责人一个点开只会撞 404 的按钮违反 04 §4 铁律 3）。
test("the project-settings gear renders only when the viewer owns the selected project", () => {
  const ownerVm = workbenchVm({
    viewer: { user_id: "90000000-0000-4000-8000-000000000009", membership_role: "member", is_project_owner: true }
  });
  const ownerHtml = renderProjectTreeHtml({ projects: [project()], selectedProjectId: project().id, vm: ownerVm, locale: "zh-CN" });
  assert.match(ownerHtml, /<button[^>]*data-wb-open-project-settings[^>]*>/u);
  assert.match(ownerHtml, /aria-label="项目设置"/u);

  const memberHtml = renderProjectTreeHtml({ projects: [project()], selectedProjectId: project().id, vm: workbenchVm(), locale: "zh-CN" });
  assert.doesNotMatch(memberHtml, /data-wb-open-project-settings/u);
});

test("the project-settings gear never renders on an unselected project row or a stale VM", () => {
  const ownerVm = workbenchVm({
    viewer: { user_id: "90000000-0000-4000-8000-000000000009", membership_role: "member", is_project_owner: true }
  });
  const unselected = renderProjectTreeHtml({ projects: [project()], selectedProjectId: undefined, vm: ownerVm, locale: "zh-CN" });
  assert.doesNotMatch(unselected, /data-wb-open-project-settings/u);
  const staleVm = renderProjectTreeHtml({
    projects: [project({ id: "other-project" })],
    selectedProjectId: "other-project",
    vm: ownerVm,
    locale: "zh-CN"
  });
  assert.doesNotMatch(staleVm, /data-wb-open-project-settings/u);
});

test("the project-settings gear is marked selected while the project-settings tab is open", () => {
  const ownerVm = workbenchVm({
    viewer: { user_id: "90000000-0000-4000-8000-000000000009", membership_role: "member", is_project_owner: true }
  });
  const open = renderProjectTreeHtml({
    projects: [project()],
    selectedProjectId: project().id,
    vm: ownerVm,
    locale: "zh-CN",
    centerTab: "project-settings"
  });
  assert.match(open, /class="wh-wb-project-gear sel"/u);
  const closed = renderProjectTreeHtml({ projects: [project()], selectedProjectId: project().id, vm: ownerVm, locale: "zh-CN" });
  assert.doesNotMatch(closed, /class="wh-wb-project-gear sel"/u);
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

// R15 批 I1（决策收件箱）：rail 顶部「待拍板」一级入口 + 计数徽标。
test("renderInboxNavHtml is a real, clickable top-level entry point in both locales", () => {
  const zh = renderInboxNavHtml(true, false, 0);
  assert.match(zh, /<button[^>]*data-wb-open-inbox[^>]*>[^]*待拍板/u);
  const en = renderInboxNavHtml(false, false, 0);
  assert.match(en, /<button[^>]*data-wb-open-inbox[^>]*>[^]*Decisions/u);
});

test("renderInboxNavHtml shows the count badge only when there are pending decisions", () => {
  const none = renderInboxNavHtml(true, false, 0);
  assert.doesNotMatch(none, /wh-wb-inbox-nav-count/u);
  const some = renderInboxNavHtml(true, false, 3);
  assert.match(some, /class="wh-wb-inbox-nav-count"[^>]*>3</u);
  // 负数/非有限值当作 0（防御性），不渲徽标。
  assert.doesNotMatch(renderInboxNavHtml(true, false, -2), /wh-wb-inbox-nav-count/u);
  assert.doesNotMatch(renderInboxNavHtml(true, false, Number.NaN), /wh-wb-inbox-nav-count/u);
});

test("renderInboxNavHtml caps the badge at 99+ and marks active only when told", () => {
  const big = renderInboxNavHtml(true, true, 250);
  assert.match(big, />99\+</u);
  assert.match(big, /class="wh-wb-inbox-nav active"/u);
  assert.doesNotMatch(renderInboxNavHtml(true, false, 5), /class="wh-wb-inbox-nav active"/u);
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

// R13 批 S3（个人空间）：rail 顶部独立分组——与「项目」平级但是另一个数据源（personalProjects），
// 不出现在团队项目树里。这几条锁死：分组渲染出真实可选行/新建入口、创建模态允许空名提交、
// 中文黑话铁律（04 §4 铁律 12）同样适用于这个模态。
test("renderPersonalSpaceSectionHtml renders a real, selectable row for every personal project", () => {
  const html = renderPersonalSpaceSectionHtml({
    personalProjects: [project({ id: "my-space-1", name: "我的空间" }), project({ id: "my-space-2", name: "我的空间 2" })],
    selectedProjectId: undefined,
    vm: undefined,
    locale: "zh-CN"
  });
  assert.match(html, /我的空间/u);
  assert.match(html, /data-wb-select-project="my-space-1"/u);
  assert.match(html, /data-wb-select-project="my-space-2"/u);
  assert.match(html, /我的空间 2/u);
});

test("renderPersonalSpaceSectionHtml heading says 'My space', distinct from the team project list heading", () => {
  const html = renderPersonalSpaceSectionHtml({ personalProjects: [], selectedProjectId: undefined, vm: undefined, locale: "zh-CN" });
  assert.match(html, /wh-wb-rail-head--personal/u);
  assert.match(html, /我的空间/u);
  const projectListHtml = renderProjectTreeHtml({ projects: [], selectedProjectId: undefined, vm: undefined, locale: "zh-CN" });
  assert.doesNotMatch(projectListHtml, /我的空间/u);
});

test("renderPersonalSpaceSectionHtml always includes a real 'new personal space' entry point", () => {
  const html = renderPersonalSpaceSectionHtml({ personalProjects: [], selectedProjectId: undefined, vm: undefined, locale: "zh-CN" });
  assert.match(html, /data-wb-new-personal-space[^-]/u);
  assert.match(html, /新建个人空间/u);
});

// R14 批 ONBOARD（个人空间发现性）：没有任何个人空间时，「新建个人空间」按钮下补一句点破用途的小字——
// 一旦建了第一个，这行就该消失（不是常驻文案，只是新手期一次性引导）。
test("renderPersonalSpaceSectionHtml shows the discovery hint under 'new personal space' only when the user has none yet", () => {
  const empty = renderPersonalSpaceSectionHtml({ personalProjects: [], selectedProjectId: undefined, vm: undefined, locale: "zh-CN" });
  assert.match(empty, /data-wb-personal-space-discovery-hint="true"/u);
  assert.match(empty, /你的私人 AI 工作台/u);

  const withOne = renderPersonalSpaceSectionHtml({
    personalProjects: [project({ id: "my-space-1", name: "我的空间" })],
    selectedProjectId: undefined,
    vm: undefined,
    locale: "zh-CN"
  });
  assert.doesNotMatch(withOne, /data-wb-personal-space-discovery-hint/u);
});

test("renderPersonalSpaceSectionHtml discovery hint has an English copy too", () => {
  const html = renderPersonalSpaceSectionHtml({ personalProjects: [], selectedProjectId: undefined, vm: undefined, locale: "en-US" });
  assert.match(html, /data-wb-personal-space-discovery-hint="true"/u);
  assert.match(html, /Your private AI workspace/u);
});

test("renderPersonalSpaceSectionHtml marks the selected personal space active and shows its real conversation leaves", () => {
  const vm = workbenchVm({ project: { ...workbenchVm().project, id: "my-space-1" } });
  const html = renderPersonalSpaceSectionHtml({
    personalProjects: [project({ id: "my-space-1", name: "我的空间" })],
    selectedProjectId: "my-space-1",
    vm,
    locale: "zh-CN"
  });
  assert.match(html, /class="wh-wb-project active"/u);
  assert.match(html, /主区/u);
});

test("renderNewPersonalSpaceModalHtml toggles data-open and allows submitting with a blank name (server auto-names it)", () => {
  const closed = renderNewPersonalSpaceModalHtml({ locale: "zh-CN", open: false, name: "", submitting: false });
  assert.match(closed, /data-open="false"/u);
  assert.doesNotMatch(closed, /data-wb-new-personal-space-submit disabled/u);

  const openBlank = renderNewPersonalSpaceModalHtml({ locale: "zh-CN", open: true, name: "", submitting: false });
  assert.match(openBlank, /data-open="true"/u);
  assert.doesNotMatch(openBlank, /data-wb-new-personal-space-submit disabled/u);
});

test("renderNewPersonalSpaceModalHtml disables inputs while submitting and surfaces a server error", () => {
  const submitting = renderNewPersonalSpaceModalHtml({ locale: "zh-CN", open: true, name: "读论文", submitting: true });
  assert.match(submitting, /data-wb-new-personal-space-name[^>]*disabled/u);
  assert.match(submitting, /创建中/u);

  const errored = renderNewPersonalSpaceModalHtml({
    locale: "zh-CN",
    open: true,
    name: "读论文",
    submitting: false,
    error: "创建失败，请重试"
  });
  assert.match(errored, /创建失败，请重试/u);
});

test("renderNewPersonalSpaceModalHtml never claims team-project semantics (no invite/team chat copy) or git jargon", () => {
  const html = renderNewPersonalSpaceModalHtml({ locale: "zh-CN", open: true, name: "", submitting: false });
  assert.doesNotMatch(html, /branch|merge|commit|pull request/iu);
  assert.doesNotMatch(html, /全员可聊|成员邀请/u);
  assert.match(html, /只有你自己能看到/u);
});

// R13 批 P2（拍板链路收尾）：协同会话「+ 新建」——rail.ts 的协同分组此前只能渲染服务端已经建好的会话，
// 从没有任何入口能真的建一个新的（POST /projects/:id/conversations 从 R12 批 0 落地起就没有 UI 调用方）。
// 这几条锁死这次补的真按钮：渲染态（idle/submitting/error）+ 两个纯 helper（自动命名/合并回 VM）+
// 请求 helper 的 method/path/body 形状。

test("renderProjectTreeHtml renders a real 'new collab conversation' button in the active project's tree", () => {
  const vm = workbenchVm();
  const html = renderProjectTreeHtml({ projects: [project()], selectedProjectId: project().id, vm, locale: "zh-CN" });
  assert.match(html, /<button[^>]*data-wb-new-collab-conversation[^>]*>[^]*新建协同会话/u);
  assert.doesNotMatch(leafTag(html, "data-wb-new-collab-conversation"), /disabled/u);
});

test("renderProjectTreeHtml disables the new-collab button and shows a busy label while submitting", () => {
  const vm = workbenchVm();
  const html = renderProjectTreeHtml({
    projects: [project()],
    selectedProjectId: project().id,
    vm,
    locale: "zh-CN",
    newCollab: { submitting: true }
  });
  assert.match(leafTag(html, "data-wb-new-collab-conversation"), /disabled/u);
  assert.match(html, /创建中…/u);
});

test("renderProjectTreeHtml surfaces a gentle inline error under the new-collab button when creation fails", () => {
  const vm = workbenchVm();
  const html = renderProjectTreeHtml({
    projects: [project()],
    selectedProjectId: project().id,
    vm,
    locale: "zh-CN",
    newCollab: { submitting: false, error: "创建失败，请重试" }
  });
  assert.match(html, /wh-wb-new-collab-error">创建失败，请重试/u);
});

test("renderProjectTreeHtml new-collab button never claims a git-jargon action verb", () => {
  const vm = workbenchVm();
  const html = renderProjectTreeHtml({ projects: [project()], selectedProjectId: project().id, vm, locale: "zh-CN" });
  assert.doesNotMatch(html, /branch|merge|commit|pull request/iu);
});

function conversationVm(over: Partial<ConversationVM> = {}): ConversationVM {
  return {
    id: "90000000-0000-4000-8000-000000000201",
    workspace_id: "90000000-0000-4000-8000-000000000000",
    project_id: "90000000-0000-4000-8000-000000000001",
    kind: "collab",
    title: "协同会话 1",
    parent_conversation_id: null,
    source_message_id: null,
    visibility: "private",
    next_seq: 0,
    created_by: "90000000-0000-4000-8000-000000000009",
    participant_role: "owner",
    cuu_enabled: true,
    created_at: "2026-07-13T00:00:00.000Z",
    updated_at: "2026-07-13T00:00:00.000Z",
    ...over
  };
}

test("nextCollabConversationTitle counts only collab conversations (not main) and numbers from 1", () => {
  const main = { kind: "main" as const };
  assert.equal(nextCollabConversationTitle([main], "zh-CN"), "协同会话 1");
  assert.equal(nextCollabConversationTitle([main, { kind: "collab" as const }], "zh-CN"), "协同会话 2");
  assert.equal(
    nextCollabConversationTitle([main, { kind: "collab" as const }, { kind: "collab" as const }], "zh-CN"),
    "协同会话 3"
  );
});

test("nextCollabConversationTitle localizes to English", () => {
  assert.equal(nextCollabConversationTitle([], "en-US"), "Collab chat 1");
});

test("appendCollabConversationToVm appends a newly created conversation so it shows up immediately", () => {
  const vm = workbenchVm();
  const created = conversationVm();
  const next = appendCollabConversationToVm(vm, created);
  assert.equal(next.conversations.conversations.length, vm.conversations.conversations.length + 1);
  assert.ok(next.conversations.conversations.some((conversation) => conversation.id === created.id));
  // Original VM is untouched — the caller decides when to swap it into the store.
  assert.equal(vm.conversations.conversations.length, 1);
});

test("appendCollabConversationToVm is a no-op when the conversation is already present (dedupe by id)", () => {
  const created = conversationVm();
  const vm = workbenchVm({
    conversations: { conversations: [...workbenchVm().conversations.conversations, created], capped: false, next_cursor: null }
  });
  const next = appendCollabConversationToVm(vm, created);
  assert.equal(next.conversations.conversations.length, vm.conversations.conversations.length);
  assert.equal(next, vm);
});

test("createCollabConversation posts kind=collab, visibility=private with the given title to the project's conversations endpoint", async () => {
  const calls: Array<{ path: string; init: RequestInit | undefined }> = [];
  const client = {
    request: async <T>(path: string, init?: RequestInit): Promise<T> => {
      calls.push({ path, init });
      return { conversation: conversationVm(), participants: [] } as unknown as T;
    }
  };
  const result = await createCollabConversation(client, "90000000-0000-4000-8000-000000000001", { title: "协同会话 1" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.path, "/api/projects/90000000-0000-4000-8000-000000000001/conversations");
  assert.equal(calls[0]?.init?.method, "POST");
  assert.deepEqual(JSON.parse(calls[0]?.init?.body as string), {
    kind: "collab",
    title: "协同会话 1",
    visibility: "private"
  });
  assert.equal(result.conversation.id, conversationVm().id);
});

// R13 批 G1（小群）：createCollabConversation 加 participantUserIds/cuuEnabled 两个可选字段（additive）。

test("createCollabConversation posts participant_user_ids and cuu_enabled when a member list and toggle are given", async () => {
  const calls: Array<{ path: string; init: RequestInit | undefined }> = [];
  const client = {
    request: async <T>(path: string, init?: RequestInit): Promise<T> => {
      calls.push({ path, init });
      return { conversation: conversationVm(), participants: [] } as unknown as T;
    }
  };
  await createCollabConversation(client, "90000000-0000-4000-8000-000000000001", {
    title: "改第三幕",
    participantUserIds: ["u1", "u2"],
    cuuEnabled: false
  });
  assert.deepEqual(JSON.parse(calls[0]?.init?.body as string), {
    kind: "collab",
    title: "改第三幕",
    visibility: "private",
    participant_user_ids: ["u1", "u2"],
    cuu_enabled: false
  });
});

// —— R13 批 G1：建群模态（标题 + 成员多选 + Cuu 开关） —— //

function newCollabModalState(over: Partial<NewCollabModalUiState> = {}): NewCollabModalUiState {
  return { ...IDLE_NEW_COLLAB_MODAL_STATE, ...over };
}

test("renderNewCollabModalHtml toggles data-open and renders every candidate member as a real checkbox", () => {
  const closed = renderNewCollabModalHtml({ locale: "zh-CN", state: newCollabModalState(), memberOptions: [] });
  assert.match(closed, /data-open="false"/u);

  const html = renderNewCollabModalHtml({
    locale: "zh-CN",
    state: newCollabModalState({ open: true, title: "改第三幕" }),
    memberOptions: [
      { userId: "u1", nickname: "张三" },
      { userId: "u2", nickname: "李四" }
    ]
  });
  assert.match(html, /data-open="true"/u);
  assert.match(html, /value="改第三幕"/u);
  assert.match(html, /data-wb-new-collab-member="u1"/u);
  assert.match(html, /张三/u);
  assert.match(html, /data-wb-new-collab-member="u2"/u);
  assert.match(html, /李四/u);
});

test("renderNewCollabModalHtml checks exactly the selected member checkboxes and leaves the rest unchecked", () => {
  const html = renderNewCollabModalHtml({
    locale: "zh-CN",
    state: newCollabModalState({ open: true, selectedUserIds: ["u2"] }),
    memberOptions: [
      { userId: "u1", nickname: "张三" },
      { userId: "u2", nickname: "李四" }
    ]
  });
  const u1Row = html.slice(html.indexOf('data-wb-new-collab-member="u1"') - 80, html.indexOf('data-wb-new-collab-member="u1"') + 40);
  const u2Row = html.slice(html.indexOf('data-wb-new-collab-member="u2"') - 80, html.indexOf('data-wb-new-collab-member="u2"') + 40);
  assert.doesNotMatch(u1Row, /checked/u);
  assert.match(u2Row, /checked/u);
});

// R14 批 AVATAR（头像与资料入口，2026-07-14 用户点名新增）：建群选人器每行带头像 tile——复用
// chat/render.ts 的 avatarTileHtml（同一套首字母色块 + data-wb-avatar-user-id 钩子），不是重写
// 第二份。真实头像图片的挂载不在这里测（那部分要真 DOM，见 chat/view.ts 的既有取舍），这里只钉
// SSR 字符串产出的形状：每个候选人行都带上了正确的钩子。
test("renderNewCollabModalHtml gives every member candidate row an avatar tile with the right data hook", () => {
  const html = renderNewCollabModalHtml({
    locale: "zh-CN",
    state: newCollabModalState({ open: true }),
    memberOptions: [
      { userId: "u1", nickname: "张三" },
      { userId: "u2", nickname: "李四" }
    ]
  });
  assert.match(html, /data-wb-avatar-user-id="u1"/u);
  assert.match(html, /data-wb-avatar-user-id="u2"/u);
  assert.equal((html.match(/class="wh-wb-chat-avatar"/gu) ?? []).length, 2);
});

test("renderNewCollabModalHtml shows an honest empty state when the workspace has no other members", () => {
  const html = renderNewCollabModalHtml({ locale: "zh-CN", state: newCollabModalState({ open: true }), memberOptions: [] });
  assert.match(html, /这个工作区暂时没有其他成员/u);
});

test("renderNewCollabModalHtml defaults the Cuu toggle to checked (participates by default)", () => {
  const html = renderNewCollabModalHtml({ locale: "zh-CN", state: newCollabModalState({ open: true }), memberOptions: [] });
  const toggleTag = html.slice(html.indexOf("data-wb-new-collab-cuu-toggle") - 20, html.indexOf("data-wb-new-collab-cuu-toggle") + 60);
  assert.match(toggleTag, /checked/u);
});

test("renderNewCollabModalHtml renders an unchecked Cuu toggle when the state says cuuEnabled is false", () => {
  const html = renderNewCollabModalHtml({
    locale: "zh-CN",
    state: newCollabModalState({ open: true, cuuEnabled: false }),
    memberOptions: []
  });
  const toggleTag = html.slice(html.indexOf("data-wb-new-collab-cuu-toggle") - 20, html.indexOf("data-wb-new-collab-cuu-toggle") + 60);
  assert.doesNotMatch(toggleTag, /checked/u);
});

test("renderNewCollabModalHtml disables submit until a title is entered and shows a busy label while submitting", () => {
  const empty = renderNewCollabModalHtml({ locale: "zh-CN", state: newCollabModalState({ open: true, title: "" }), memberOptions: [] });
  assert.match(empty.slice(empty.indexOf("data-wb-new-collab-submit") - 5, empty.indexOf("data-wb-new-collab-submit") + 40), /disabled/u);

  const submitting = renderNewCollabModalHtml({
    locale: "zh-CN",
    state: newCollabModalState({ open: true, title: "改第三幕", submitting: true }),
    memberOptions: []
  });
  assert.match(submitting, /创建中…/u);
});

test("renderNewCollabModalHtml surfaces a gentle inline error", () => {
  const html = renderNewCollabModalHtml({
    locale: "zh-CN",
    state: newCollabModalState({ open: true, error: "创建失败，请重试" }),
    memberOptions: []
  });
  assert.match(html, /wh-wb-modal-error">创建失败，请重试/u);
});

test("renderNewCollabModalHtml never claims a git-jargon action verb", () => {
  const html = renderNewCollabModalHtml({ locale: "zh-CN", state: newCollabModalState({ open: true }), memberOptions: [] });
  assert.doesNotMatch(html, /branch|merge|commit|pull request/iu);
});

// —— R14FIX 批 workbench：单独和 Cuu 聊 + 会话重命名 —— //

test("the active project tree renders a real 'chat just with Cuu' shortcut button", () => {
  const vm = workbenchVm();
  const html = renderProjectTreeHtml({ projects: [project()], selectedProjectId: project().id, vm, locale: "zh-CN" });
  assert.match(html, /<button[^>]*data-wb-new-solo-cuu[^>]*>[^]*和 Cuu 单独聊/u);
  assert.doesNotMatch(leafTag(html, "data-wb-new-solo-cuu"), /disabled/u);
});

test("the solo-Cuu shortcut is disabled with a busy label while a conversation is being created", () => {
  const vm = workbenchVm();
  const html = renderProjectTreeHtml({
    projects: [project()],
    selectedProjectId: project().id,
    vm,
    locale: "zh-CN",
    newCollab: { submitting: true }
  });
  assert.match(leafTag(html, "data-wb-new-solo-cuu"), /disabled/u);
});

test("every collab leaf carries a hover rename pencil pre-loaded with the current title", () => {
  const vm = workbenchVm({
    conversations: {
      conversations: [...workbenchVm().conversations.conversations, collabConversationVm()],
      capped: false,
      next_cursor: null
    }
  });
  const html = renderProjectTreeHtml({ projects: [project()], selectedProjectId: project().id, vm, locale: "zh-CN" });
  assert.match(
    html,
    /data-wb-rename-collab="90000000-0000-4000-8000-000000000102"[^>]*data-wb-rename-collab-title="与 Cuu 的对话"/u
  );
  // The open button must still render unchanged (rename pencil is a sibling, not nested).
  assert.match(html, /<button[^>]*data-wb-open-collab-chat="90000000-0000-4000-8000-000000000102"[^>]*>[^]*与 Cuu 的对话/u);
});

function renameModalState(over: Partial<RenameCollabModalUiState> = {}): RenameCollabModalUiState {
  return { ...IDLE_RENAME_COLLAB_MODAL_STATE, ...over };
}

test("renderRenameCollabModalHtml toggles data-open and prefills the current title", () => {
  const closed = renderRenameCollabModalHtml({ locale: "zh-CN", state: renameModalState() });
  assert.match(closed, /data-wb-rename-collab-overlay[^>]*data-open="false"/u);
  const open = renderRenameCollabModalHtml({
    locale: "zh-CN",
    state: renameModalState({ open: true, conversationId: "c1", title: "改第三幕" })
  });
  assert.match(open, /data-open="true"/u);
  assert.match(open, /data-wb-rename-collab-input[^>]*value="改第三幕"/u);
});

test("renderRenameCollabModalHtml disables the save button when the title is blank", () => {
  const blank = renderRenameCollabModalHtml({ locale: "zh-CN", state: renameModalState({ open: true, title: "   " }) });
  const submitTag = blank.slice(
    blank.indexOf("data-wb-rename-collab-submit") - 5,
    blank.indexOf("data-wb-rename-collab-submit") + 40
  );
  assert.match(submitTag, /disabled/u);
});

test("renderRenameCollabModalHtml shows a busy label and disables inputs while submitting", () => {
  const html = renderRenameCollabModalHtml({
    locale: "zh-CN",
    state: renameModalState({ open: true, title: "改第三幕", submitting: true })
  });
  assert.match(html, /保存中…/u);
  assert.match(html.slice(html.indexOf("data-wb-rename-collab-input") - 5, html.indexOf("data-wb-rename-collab-input") + 140), /disabled/u);
});

test("renameCollabConversationInVm swaps the title in place and no-ops when it would not change", () => {
  const vm = workbenchVm({
    conversations: {
      conversations: [...workbenchVm().conversations.conversations, collabConversationVm()],
      capped: false,
      next_cursor: null
    }
  });
  const renamed = renameCollabConversationInVm(vm, "90000000-0000-4000-8000-000000000102", "改第三幕");
  const leaf = renamed.conversations.conversations.find((c) => c.id === "90000000-0000-4000-8000-000000000102");
  assert.equal(leaf?.title, "改第三幕");
  // An unchanged title returns the same VM reference (lets subscribers skip a re-render).
  assert.equal(renameCollabConversationInVm(renamed, "90000000-0000-4000-8000-000000000102", "改第三幕"), renamed);
  // An unknown id is a no-op too.
  assert.equal(renameCollabConversationInVm(vm, "does-not-exist", "x"), vm);
});

test("renameCollabConversation PATCHes /api/conversations/:id with the new title", async () => {
  const calls: Array<{ path: string; init: RequestInit | undefined }> = [];
  const client = {
    request: async <T>(path: string, init?: RequestInit): Promise<T> => {
      calls.push({ path, init });
      return { conversation: { ...collabConversationVm(), title: "改第三幕" } } as unknown as T;
    }
  };
  const result = await renameCollabConversation(client, "90000000-0000-4000-8000-000000000102", "改第三幕");
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.path, "/api/conversations/90000000-0000-4000-8000-000000000102");
  assert.equal(calls[0]?.init?.method, "PATCH");
  assert.deepEqual(JSON.parse(calls[0]?.init?.body as string), { title: "改第三幕" });
  assert.equal(result.conversation.title, "改第三幕");
});

// —— R15 批 B（人对人私聊）：成员 roster + 私聊分组 —— //

const R15_SELF = "90000000-0000-4000-8000-000000000009";
const R15_PEER_A = "90000000-0000-4000-8000-0000000000a1";
const R15_PEER_B = "90000000-0000-4000-8000-0000000000a2";

function rosterMember(userId: string, nickname: string, isSelf = false) {
  return { user_id: userId, nickname, membership_role: "member" as const, is_project_owner: false, is_self: isSelf };
}

function r15DmItem(conversationId: string, peerId: string, peerNickname: string): DmListItemVM {
  return {
    conversation: {
      id: conversationId,
      workspace_id: "90000000-0000-4000-8000-000000000000",
      project_id: "20000000-0000-4000-8000-000000000009",
      kind: "collab",
      title: "私聊",
      parent_conversation_id: null,
      source_message_id: null,
      visibility: "private",
      next_seq: 0,
      created_by: R15_SELF,
      participant_role: "owner",
      cuu_enabled: false,
      is_dm: true,
      created_at: "2026-07-15T08:30:00.123Z",
      updated_at: "2026-07-15T08:31:00.123Z"
    },
    participants: [
      { user_id: R15_SELF, nickname: "阿曼", is_self: true },
      { user_id: peerId, nickname: peerNickname, is_self: false }
    ]
  };
}

test("sortRosterMembers excludes self and puts online members first (stable within a status)", () => {
  const members = [
    rosterMember(R15_SELF, "阿曼", true),
    rosterMember(R15_PEER_A, "甲", false),
    rosterMember(R15_PEER_B, "乙", false)
  ];
  const sorted = sortRosterMembers(members, R15_SELF, new Set([R15_PEER_B]));
  // 自己被排除；在线的乙排前，离线的甲在后。
  assert.deepEqual(sorted.map((m) => m.user_id), [R15_PEER_B, R15_PEER_A]);
});

test("renderRosterGroupHtml renders a Members group with per-member profile hooks + online dots, no self", () => {
  const html = renderRosterGroupHtml({
    members: [rosterMember(R15_SELF, "阿曼", true), rosterMember(R15_PEER_A, "甲", false)],
    currentUserId: R15_SELF,
    onlineUserIds: new Set([R15_PEER_A]),
    locale: "zh-CN"
  });
  assert.match(html, /成员/);
  // 每个非自己成员一行，带 data-wb-open-profile（点行开资料卡）。
  assert.match(html, /data-wb-open-profile="90000000-0000-4000-8000-0000000000a1"/);
  // 自己不出现在 roster。
  assert.doesNotMatch(html, /data-wb-open-profile="90000000-0000-4000-8000-000000000009"/);
  // 在线成员画绿点（avatarTileHtml 的 online dot）。
  assert.match(html, /wh-wb-chat-avatar-dot/);
});

test("renderRosterGroupHtml renders nothing when there is no VM member data (no empty shell)", () => {
  assert.equal(renderRosterGroupHtml({ members: [], currentUserId: undefined, onlineUserIds: new Set(), locale: "zh-CN" }), "");
});

test("renderDmGroupHtml lists DMs with peer name + open hook, marking the active one", () => {
  const html = renderDmGroupHtml({
    dmList: [r15DmItem("30000000-0000-4000-8000-000000000031", R15_PEER_A, "甲")],
    currentUserId: R15_SELF,
    onlineUserIds: new Set([R15_PEER_A]),
    activeDmConversationId: "30000000-0000-4000-8000-000000000031",
    centerTab: "dm",
    locale: "zh-CN"
  });
  assert.match(html, /私聊/);
  assert.match(html, /data-wb-open-dm="30000000-0000-4000-8000-000000000031"/);
  // 对方昵称，不是自己的昵称。
  assert.match(html, /甲/);
  // 活跃的 DM 行选中态。
  assert.match(html, /wh-wb-dm-row sel/);
  assert.match(html, /wh-wb-chat-avatar-dot/);
});

test("renderDmGroupHtml shows a faint empty-state hint when there are no DMs", () => {
  const html = renderDmGroupHtml({
    dmList: [],
    currentUserId: R15_SELF,
    onlineUserIds: new Set(),
    centerTab: "chat",
    locale: "zh-CN"
  });
  assert.match(html, /点成员头像发起私聊/);
  assert.doesNotMatch(html, /data-wb-open-dm/);
});

// —— R15 批 A6（rail 未读红点）—— //

test("renderProjectTreeHtml renders an unread red badge on the main leaf only when unread_count > 0", () => {
  const withUnread = renderProjectTreeHtml({
    projects: [project()],
    selectedProjectId: project().id,
    vm: workbenchVm({
      conversations: {
        conversations: [{ ...workbenchVm().conversations.conversations[0]!, unread_count: 3 }],
        capped: false,
        next_cursor: null
      }
    }),
    locale: "zh-CN"
  });
  // 红点徽标带数字 3（未读语义），不是 next_seq 的消息总数。
  assert.match(withUnread, /wh-wb-leaf-count wh-wb-leaf-count--unread">3</);

  const noUnread = renderProjectTreeHtml({
    projects: [project()],
    selectedProjectId: project().id,
    // 默认 workbenchVm 的主区没有 unread_count（=0 语义）——不渲未读红点徽标。
    // 注：wh-wb-leaf-count 是通用徽标类（网盘文件数、R16 看板/日程「新」标同样复用它），这里只断言
    // 不出现「未读」变体（--unread），不再断言整棵树无任何 leaf-count（那会误伤 W2 的「新」徽标）。
    vm: workbenchVm(),
    locale: "zh-CN"
  });
  assert.doesNotMatch(noUnread, /wh-wb-leaf-count--unread/);
});

test("renderDmGroupHtml renders an unread red badge on a DM row only when unread_count > 0", () => {
  const unreadDm = r15DmItem("30000000-0000-4000-8000-000000000031", R15_PEER_A, "甲");
  unreadDm.conversation.unread_count = 5;
  const html = renderDmGroupHtml({
    dmList: [unreadDm],
    currentUserId: R15_SELF,
    onlineUserIds: new Set(),
    centerTab: "chat",
    locale: "zh-CN"
  });
  assert.match(html, /wh-wb-dm-count">5</);

  const readDm = r15DmItem("30000000-0000-4000-8000-000000000032", R15_PEER_B, "乙");
  const readHtml = renderDmGroupHtml({
    dmList: [readDm],
    currentUserId: R15_SELF,
    onlineUserIds: new Set(),
    centerTab: "chat",
    locale: "zh-CN"
  });
  assert.doesNotMatch(readHtml, /wh-wb-dm-count/);
});

test("setConversationUnreadInVm sets a conversation's unread count and returns the same ref when unchanged", () => {
  const vm = workbenchVm();
  const conversationId = vm.conversations.conversations[0]!.id;
  const next = setConversationUnreadInVm(vm, conversationId, 4);
  assert.equal(next.conversations.conversations[0]!.unread_count, 4);
  // 找不到的会话 id → 原样返回同一引用（调用方据此跳过重渲）。
  assert.equal(setConversationUnreadInVm(vm, "no-such-id", 9), vm);
  // 设成与当前相同的值（都视作 0）→ 同一引用。
  assert.equal(setConversationUnreadInVm(vm, conversationId, 0), vm);
  // 负数/非有限数归零。
  assert.equal(setConversationUnreadInVm(next, conversationId, -3).conversations.conversations[0]!.unread_count, 0);
});

test("bumpConversationUnreadInVm increments by one and no-ops for unknown conversations", () => {
  const vm = setConversationUnreadInVm(workbenchVm(), workbenchVm().conversations.conversations[0]!.id, 2);
  const conversationId = vm.conversations.conversations[0]!.id;
  assert.equal(bumpConversationUnreadInVm(vm, conversationId).conversations.conversations[0]!.unread_count, 3);
  // 从"没有 unread_count 字段"（=0）起也能 +1。
  const fresh = workbenchVm();
  assert.equal(bumpConversationUnreadInVm(fresh, fresh.conversations.conversations[0]!.id).conversations.conversations[0]!.unread_count, 1);
  assert.equal(bumpConversationUnreadInVm(vm, "no-such-id"), vm);
});

test("setDmUnread / bumpDmUnread update the matching DM and no-op otherwise", () => {
  const dm = r15DmItem("30000000-0000-4000-8000-000000000031", R15_PEER_A, "甲");
  const list = [dm];
  const set = setDmUnread(list, dm.conversation.id, 7);
  assert.equal(set[0]!.conversation.unread_count, 7);
  assert.equal(setDmUnread(list, "no-such-id", 3), list);
  assert.equal(bumpDmUnread(set, dm.conversation.id)[0]!.conversation.unread_count, 8);
  assert.equal(bumpDmUnread(list, "no-such-id"), list);
  // clear（设 0）把红点清掉。
  assert.equal(setDmUnread(set, dm.conversation.id, 0)[0]!.conversation.unread_count ?? 0, 0);
});
