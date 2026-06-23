import assert from "node:assert/strict";
import test from "node:test";

import type { DriveRecentFileRow, DriveRepository, WorkItemProjectListItemRow, WorkItemDataRepository, WorkItemProjectRow } from "@workhub/db";

import type { AuthActor } from "./middleware/auth.js";
import {
  createProjectHomePageService,
  ProjectHomePageServiceError
} from "./services/project-home-pages.js";

const WS = "11111111-1111-4111-8111-111111111111";
const PROJ = "22222222-2222-4222-8222-222222222222";
const USER = "33333333-3333-4333-8333-333333333333";

function actor(over: Partial<AuthActor> = {}): AuthActor {
  return {
    kind: "human",
    id: USER,
    label: "tester",
    userId: USER,
    isAdmin: false,
    orgId: "00000000-0000-4000-8000-0000000000aa",
    workspaceId: WS,
    ...over
  };
}

function projectRow(over: Partial<WorkItemProjectRow> = {}): WorkItemProjectRow {
  return {
    id: PROJ,
    workspaceId: WS,
    name: "Alpha",
    slug: "alpha",
    description: "An auditable project.",
    ownerNickname: "owner",
    ownerUserId: USER,
    archived: false,
    deletedAt: null,
    ...over
  } as unknown as WorkItemProjectRow;
}

const WI_1 = "44444444-4444-4444-8444-444444444401";
const WI_2 = "44444444-4444-4444-8444-444444444402";
const OTHER_USER = "33333333-3333-4333-8333-3333333333ff";
// 缺省事项由默认 actor(USER) 提交 → 即便是私有态(spec_ready)对其自身也可见(isSubmitter)。
const openItem = (over: Partial<WorkItemProjectListItemRow> = {}): WorkItemProjectListItemRow => ({
  id: WI_1,
  code: "ALP-1",
  title: "Do the thing",
  status: "spec_ready",
  priority: "normal",
  updatedAt: new Date("2026-06-23T00:00:00.000Z"),
  submitterUserId: USER,
  claimedByUserId: null,
  workspaceId: WS,
  ...over
});

function repo(
  findProjectById: WorkItemDataRepository["findProjectById"],
  listOpenByProject: WorkItemDataRepository["listOpenByProject"]
): Pick<WorkItemDataRepository, "findProjectById" | "listOpenByProject"> {
  return { findProjectById, listOpenByProject };
}

// 网盘 repo 切片假实现：缺省无文件；可传入最近文件 + 真实总数（测「超过展示上限」用）。
function driveRepo(
  recentFiles: DriveRecentFileRow[] = [],
  fileCount?: number
): Pick<DriveRepository, "listRecentFilesByProject" | "countFilesByProject"> {
  return {
    listRecentFilesByProject: async (_projectId, limit = 5) => recentFiles.slice(0, limit),
    countFilesByProject: async () => fileCount ?? recentFiles.length
  };
}

const FILE_1 = "55555555-5555-4555-8555-555555555501";

test("project home page returns project meta + open work items + actions", async () => {
  const svc = createProjectHomePageService({
    repo: repo(
      async () => projectRow(),
      async () => [openItem(), openItem({ id: WI_2, code: "ALP-2", title: null })]
    ),
    driveRepo: driveRepo([{ id: FILE_1, name: "客户复盘.md", updatedAt: new Date("2026-06-22T00:00:00.000Z") }], 3),
    now: () => new Date("2026-06-23T00:00:00.000Z")
  });
  const vm = await svc.page({ actor: actor(), projectId: PROJ, locale: "zh-CN" });
  assert.equal(vm.project.id, PROJ);
  assert.equal(vm.project.slug, "alpha");
  assert.equal(vm.project.description, "An auditable project.");
  assert.equal(vm.project.status, "active");
  assert.equal(vm.summary.open_work_item_count, 2);
  assert.equal(vm.open_work_items[0]?.href, `/workitems/${WI_1}`);
  assert.equal(vm.open_work_items[1]?.title, "ALP-2", "null title falls back to code");
  assert.equal(vm.actions.open_drive.href, `/drive?project_id=${PROJ}`);
  // S4b：新任务带项目上下文，进接入起始页时绑定到本项目（不再丢进通用「试点项目」）。
  assert.equal(vm.actions.new_task.href, `/intake?project_id=${PROJ}`);
  // 网盘切片：真实文件总数 + 最近文件（链到项目网盘）
  assert.equal(vm.drive.file_count, 3, "drive file_count = true total");
  assert.equal(vm.drive.recent_files.length, 1);
  assert.equal(vm.drive.recent_files[0]?.name, "客户复盘.md");
  // #5：最近文件深链到网盘并高亮该文件(item_id)，不再都指向同一个通用网盘页。
  assert.equal(vm.drive.recent_files[0]?.href, `/drive?project_id=${PROJ}&item_id=${FILE_1}`);
  assert.equal(vm.empty_state, undefined);
});

test("project home page 404 when the project is missing/archived/deleted", async () => {
  const svc = createProjectHomePageService({
    repo: repo(async () => null, async () => []),
    driveRepo: driveRepo()
  });
  await assert.rejects(
    () => svc.page({ actor: actor(), projectId: PROJ }),
    (error) => error instanceof ProjectHomePageServiceError && error.status === 404
  );
});

test("project home page 403 when a non-admin actor is outside the project's workspace", async () => {
  const svc = createProjectHomePageService({
    repo: repo(
      async () => projectRow({ workspaceId: "99999999-9999-4999-8999-999999999999", ownerUserId: "someone-else" }),
      async () => []
    ),
    driveRepo: driveRepo()
  });
  await assert.rejects(
    () => svc.page({ actor: actor(), projectId: PROJ }),
    (error) => error instanceof ProjectHomePageServiceError && error.status === 403
  );
});

test("project home page flags empty_state when there is no open work", async () => {
  const svc = createProjectHomePageService({
    repo: repo(async () => projectRow(), async () => []),
    driveRepo: driveRepo(),
    now: () => new Date("2026-06-23T00:00:00.000Z")
  });
  const vm = await svc.page({ actor: actor(), projectId: PROJ });
  assert.equal(vm.summary.open_work_item_count, 0);
  assert.equal(vm.empty_state, "no_open_work");
  assert.equal(vm.drive.file_count, 0, "no files → drive slice still present (empty)");
  assert.equal(vm.drive.recent_files.length, 0);
});

test("project home hides private-status work items the viewer can't open (no 403 dead links)", async () => {
  // F9：他人的私有态事项(intake/澄清/spec_ready)点进去会 403——项目主页不该列出这些死链。
  // 清单 = 1 条本人 spec_ready(可见) + 1 条他人 spec_ready(不可见) + 1 条他人非私有态(同 workspace 可见)。
  const svc = createProjectHomePageService({
    repo: repo(
      async () => projectRow({ ownerUserId: OTHER_USER }),
      async () => [
        openItem(),
        openItem({ id: WI_2, code: "ALP-2", submitterUserId: OTHER_USER, status: "spec_ready" }),
        openItem({ id: "44444444-4444-4444-8444-444444444403", code: "ALP-3", submitterUserId: OTHER_USER, status: "in_review" })
      ]
    ),
    driveRepo: driveRepo(),
    now: () => new Date("2026-06-23T00:00:00.000Z")
  });
  const vm = await svc.page({ actor: actor(), projectId: PROJ });
  const ids = vm.open_work_items.map((item) => item.id);
  assert.deepEqual(ids, [WI_1, "44444444-4444-4444-8444-444444444403"], "本人私有态 + 他人非私有态保留;他人私有态过滤掉");
  assert.equal(vm.summary.open_work_item_count, 2, "头部计数与可见清单一致(不计入过滤掉的死链)");
});

test("project home shows nothing (empty_state) when every open item is another user's private draft", async () => {
  // 项目有活动但全是他人私有草稿 → 当前用户在本项目无可处理项,诚实显示空态而非一堆 403 死链。
  const svc = createProjectHomePageService({
    repo: repo(
      async () => projectRow({ ownerUserId: OTHER_USER }),
      async () => [
        openItem({ submitterUserId: OTHER_USER, status: "ai_clarifying" }),
        openItem({ id: WI_2, code: "ALP-2", submitterUserId: OTHER_USER, status: "spec_ready" })
      ]
    ),
    driveRepo: driveRepo(),
    now: () => new Date("2026-06-23T00:00:00.000Z")
  });
  const vm = await svc.page({ actor: actor(), projectId: PROJ });
  assert.equal(vm.open_work_items.length, 0);
  assert.equal(vm.summary.open_work_item_count, 0);
  assert.equal(vm.empty_state, "no_open_work");
});

test("admin sees all open items on project home (incl. others' private drafts)", async () => {
  const svc = createProjectHomePageService({
    repo: repo(
      async () => projectRow({ ownerUserId: OTHER_USER }),
      async () => [openItem({ submitterUserId: OTHER_USER }), openItem({ id: WI_2, code: "ALP-2", submitterUserId: OTHER_USER })]
    ),
    driveRepo: driveRepo(),
    now: () => new Date("2026-06-23T00:00:00.000Z")
  });
  const vm = await svc.page({ actor: actor({ isAdmin: true }), projectId: PROJ });
  assert.equal(vm.summary.open_work_item_count, 2, "admin 可越权读 → 全部可见");
});
