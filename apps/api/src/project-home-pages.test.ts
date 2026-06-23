import assert from "node:assert/strict";
import test from "node:test";

import type { WorkItemProjectListItemRow, WorkItemDataRepository, WorkItemProjectRow } from "@workhub/db";

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
const openItem = (over: Partial<WorkItemProjectListItemRow> = {}): WorkItemProjectListItemRow => ({
  id: WI_1,
  code: "ALP-1",
  title: "Do the thing",
  status: "spec_ready",
  priority: "normal",
  updatedAt: new Date("2026-06-23T00:00:00.000Z"),
  ...over
});

function repo(
  findProjectById: WorkItemDataRepository["findProjectById"],
  listOpenByProject: WorkItemDataRepository["listOpenByProject"],
  countOpenByProject?: WorkItemDataRepository["countOpenByProject"]
): Pick<WorkItemDataRepository, "findProjectById" | "listOpenByProject" | "countOpenByProject"> {
  return {
    findProjectById,
    listOpenByProject,
    // 缺省按清单长度推导真实计数（小项目两者一致）；需要测「超过清单上限」时显式传入。
    countOpenByProject: countOpenByProject ?? (async (projectId) => (await listOpenByProject(projectId, 10_000)).length)
  };
}

test("project home page returns project meta + open work items + actions", async () => {
  const svc = createProjectHomePageService({
    repo: repo(
      async () => projectRow(),
      async () => [openItem(), openItem({ id: WI_2, code: "ALP-2", title: null })]
    ),
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
  assert.equal(vm.actions.new_task.href, "/intake");
  assert.equal(vm.empty_state, undefined);
});

test("project home page 404 when the project is missing/archived/deleted", async () => {
  const svc = createProjectHomePageService({
    repo: repo(async () => null, async () => [])
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
    )
  });
  await assert.rejects(
    () => svc.page({ actor: actor(), projectId: PROJ }),
    (error) => error instanceof ProjectHomePageServiceError && error.status === 403
  );
});

test("project home page flags empty_state when there is no open work", async () => {
  const svc = createProjectHomePageService({
    repo: repo(async () => projectRow(), async () => []),
    now: () => new Date("2026-06-23T00:00:00.000Z")
  });
  const vm = await svc.page({ actor: actor(), projectId: PROJ });
  assert.equal(vm.summary.open_work_item_count, 0);
  assert.equal(vm.empty_state, "no_open_work");
});

test("project home page header count is the true total, not the capped list length", async () => {
  // 清单封顶只返回 2 条，但真实进行中总数 73 → 头部计数应取真实总数(与项目列表卡同口径)，前端据此提示「还有 N 条」。
  const svc = createProjectHomePageService({
    repo: repo(
      async () => projectRow(),
      async () => [openItem(), openItem({ id: WI_2, code: "ALP-2" })],
      async () => 73
    ),
    now: () => new Date("2026-06-23T00:00:00.000Z")
  });
  const vm = await svc.page({ actor: actor(), projectId: PROJ });
  assert.equal(vm.summary.open_work_item_count, 73, "header count = true total");
  assert.equal(vm.open_work_items.length, 2, "list itself stays capped");
  assert.equal(vm.empty_state, undefined);
});
