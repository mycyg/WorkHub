import assert from "node:assert/strict";
import test from "node:test";

import type {
  DependencyEdge,
  ProjectMilestoneRow,
  ProjectTimelineRepository,
  TimelineWorkItemRow,
  WorkItemDataRepository,
  WorkItemProjectRow
} from "@workhub/db";

import type { AuthActor } from "./middleware/auth.js";
import {
  createProjectTimelinePageService,
  ProjectTimelinePageServiceError
} from "./services/project-timeline-pages.js";

const WS = "11111111-1111-4111-8111-111111111111";
const OTHER_WS = "99999999-9999-4999-8999-999999999999";
const ORG = "00000000-0000-4000-8000-0000000000aa";
const PROJ = "22222222-2222-4222-8222-222222222222";
const MEMBER = "33333333-3333-4333-8333-333333333333";
const OTHER = "33333333-3333-4333-8333-3333333333ff";
const WI_A = "44444444-4444-4444-8444-444444444401";
const WI_B = "44444444-4444-4444-8444-444444444402";
const WI_C = "44444444-4444-4444-8444-444444444403";
const MILE = "55555555-5555-4555-8555-555555555501";
const OBJ = "66666666-6666-4666-8666-666666666601";
const NOW = new Date("2026-07-15T00:00:00.000Z");
const PAST = new Date("2026-07-01T00:00:00.000Z");
const FUTURE = new Date("2026-08-01T00:00:00.000Z");

function actor(over: Partial<AuthActor> = {}): AuthActor {
  return { kind: "human", id: MEMBER, label: "mem", userId: MEMBER, isAdmin: false, orgId: ORG, workspaceId: WS, ...over };
}

function projectRow(over: Partial<WorkItemProjectRow> = {}): WorkItemProjectRow {
  return {
    id: PROJ,
    orgId: ORG,
    workspaceId: WS,
    name: "Alpha",
    slug: "alpha",
    description: null,
    ownerNickname: "owner",
    ownerUserId: MEMBER,
    archived: false,
    deletedAt: null,
    ...over
  } as unknown as WorkItemProjectRow;
}

function item(over: Partial<TimelineWorkItemRow> & Pick<TimelineWorkItemRow, "id" | "code">): TimelineWorkItemRow {
  return {
    title: over.code,
    status: "ai_working",
    startAt: null,
    dueAt: null,
    submitterUserId: MEMBER,
    claimedByUserId: null,
    claimedByNickname: null,
    workspaceId: WS,
    milestoneId: null,
    assignments: [],
    ...over
  } as TimelineWorkItemRow;
}

function milestoneRow(): ProjectMilestoneRow {
  return {
    id: MILE,
    projectId: PROJ,
    title: "M1 GA",
    dueAt: FUTURE,
    sort: 0,
    status: "open",
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null
  };
}

type TimelineRepoSlice = Pick<
  ProjectTimelineRepository,
  "listActiveMilestonesByProject" | "listTimelineWorkItems" | "listDependencyEdgesByProject" | "listObjectiveIdsByWorkItemIds"
>;

function fakeRepo(over: Partial<TimelineRepoSlice> = {}): TimelineRepoSlice {
  return {
    listActiveMilestonesByProject: async () => [],
    listTimelineWorkItems: async () => [],
    listDependencyEdgesByProject: async () => [],
    listObjectiveIdsByWorkItemIds: async () => new Map(),
    ...over
  };
}

function projectRepo(project: WorkItemProjectRow | null): Pick<WorkItemDataRepository, "findProjectById"> {
  return { findProjectById: async () => project };
}

test("timeline returns 404 when the project is missing", async () => {
  const service = createProjectTimelinePageService({ repo: fakeRepo(), projectRepo: projectRepo(null), now: () => NOW });
  await assert.rejects(
    service.page({ actor: actor(), projectId: PROJ }),
    (error: unknown) => error instanceof ProjectTimelinePageServiceError && error.status === 404 && error.code === "project_not_found"
  );
});

test("timeline returns 403 for a non-member (different workspace, not owner)", async () => {
  const service = createProjectTimelinePageService({
    repo: fakeRepo(),
    projectRepo: projectRepo(projectRow({ ownerUserId: MEMBER })),
    now: () => NOW
  });
  await assert.rejects(
    service.page({ actor: actor({ id: OTHER, userId: OTHER, workspaceId: OTHER_WS }), projectId: PROJ }),
    (error: unknown) => error instanceof ProjectTimelinePageServiceError && error.status === 403 && error.code === "project_forbidden"
  );
});

test("timeline assembles milestones, blocking closure, overdue_blocking, assignee, and OKR links", async () => {
  // A 依赖 B、C 依赖 B（C 是他人 spec_ready 私有草稿，对 MEMBER 不可见）。
  // B 逾期（overdue）且全图阻塞 A + C = 2；A 挂里程碑 + 目标；C 应被过滤掉。
  const items = [
    item({ id: WI_B, code: "ALP-2", status: "ai_working", dueAt: PAST, claimedByUserId: MEMBER, claimedByNickname: "mem" }),
    item({ id: WI_A, code: "ALP-1", status: "ai_working", dueAt: FUTURE, milestoneId: MILE }),
    item({ id: WI_C, code: "ALP-3", status: "spec_ready", submitterUserId: OTHER, claimedByUserId: null })
  ];
  const edges: DependencyEdge[] = [
    { workItemId: WI_A, dependsOnWorkItemId: WI_B },
    { workItemId: WI_C, dependsOnWorkItemId: WI_B }
  ];
  const service = createProjectTimelinePageService({
    repo: fakeRepo({
      listActiveMilestonesByProject: async () => [milestoneRow()],
      listTimelineWorkItems: async () => items,
      listDependencyEdgesByProject: async () => edges,
      listObjectiveIdsByWorkItemIds: async () => new Map([[WI_A, [OBJ]]])
    }),
    projectRepo: projectRepo(projectRow()),
    now: () => NOW
  });
  const vm = await service.page({ actor: actor(), projectId: PROJ });

  // 里程碑透传。
  assert.equal(vm.milestones.length, 1);
  assert.equal(vm.milestones[0]!.id, MILE);

  // C（他人 spec_ready 私有草稿）被过滤：只剩 A、B。
  assert.deepEqual(vm.items.map((i) => i.id).sort(), [WI_A, WI_B].sort());

  const a = vm.items.find((i) => i.id === WI_A)!;
  const b = vm.items.find((i) => i.id === WI_B)!;
  // A 的可见依赖 = [B]；A 挂了里程碑与目标。
  assert.deepEqual(a.depends_on, [WI_B]);
  assert.equal(a.milestone_id, MILE);
  assert.deepEqual(a.objective_ids, [OBJ]);
  assert.equal(a.blocks_count, 0);
  assert.equal(a.overdue, false);
  // B 全图阻塞 A + C = 2（诚实计数，即便 C 不展示）；B 已认领 → assignee；B 逾期。
  assert.equal(b.blocks_count, 2);
  assert.equal(b.overdue, true);
  assert.deepEqual(b.assignee, { user_id: MEMBER, label: "mem" });
  // B 的 depends_on 只保留可见目标（B 无依赖）。
  assert.deepEqual(b.depends_on, []);

  // 关键路径：B 上榜 blocking + overdue_blocking；A（阻塞 0）不在。
  assert.deepEqual(vm.critical.blocking, [{ work_item_id: WI_B, blocks_count: 2 }]);
  assert.deepEqual(vm.critical.overdue_blocking, [{ work_item_id: WI_B, blocks_count: 2 }]);
  // G4 #36：未注入 objectives 依赖时只带 objective_ids、不带 objective_titles（回落显裸 id）。
  assert.equal(a.objective_titles, undefined);
});

test("G4 #36: objective_titles joined when objectives dep is provided; falls back to id when a title is missing", async () => {
  const OBJ2 = "70000000-0000-4000-8000-0000000000b2";
  const items = [item({ id: WI_A, code: "ALP-1", status: "ai_working", dueAt: FUTURE })];
  const service = createProjectTimelinePageService({
    repo: fakeRepo({
      listTimelineWorkItems: async () => items,
      listObjectiveIdsByWorkItemIds: async () => new Map([[WI_A, [OBJ, OBJ2]]])
    }),
    projectRepo: projectRepo(projectRow()),
    // 只给 OBJ 有名字；OBJ2 没命中 → 回落成裸 id，保证与 objective_ids 等长。
    objectives: { listObjectiveTitlesByIds: async () => new Map([[OBJ, "把交付周期压到两周"]]) },
    now: () => NOW
  });
  const vm = await service.page({ actor: actor(), projectId: PROJ });
  const a = vm.items.find((i) => i.id === WI_A)!;
  assert.deepEqual(a.objective_ids, [OBJ, OBJ2]);
  assert.deepEqual(a.objective_titles, ["把交付周期压到两周", OBJ2]);
});

test("G4 #36: objective_titles omitted when every title is missing (all fall back to id)", async () => {
  const items = [item({ id: WI_A, code: "ALP-1", status: "ai_working", dueAt: FUTURE })];
  const service = createProjectTimelinePageService({
    repo: fakeRepo({
      listTimelineWorkItems: async () => items,
      listObjectiveIdsByWorkItemIds: async () => new Map([[WI_A, [OBJ]]])
    }),
    projectRepo: projectRepo(projectRow()),
    objectives: { listObjectiveTitlesByIds: async () => new Map() },
    now: () => NOW
  });
  const vm = await service.page({ actor: actor(), projectId: PROJ });
  const a = vm.items.find((i) => i.id === WI_A)!;
  assert.deepEqual(a.objective_ids, [OBJ]);
  assert.equal(a.objective_titles, undefined);
});

test("timeline emits empty_state when no work items are visible", async () => {
  const service = createProjectTimelinePageService({
    repo: fakeRepo({
      // 唯一的项是他人私有草稿 → 对 MEMBER 全部不可见。
      listTimelineWorkItems: async () => [
        item({ id: WI_C, code: "ALP-3", status: "intake", submitterUserId: OTHER })
      ]
    }),
    projectRepo: projectRepo(projectRow()),
    now: () => NOW
  });
  const vm = await service.page({ actor: actor(), projectId: PROJ });
  assert.equal(vm.items.length, 0);
  assert.equal(vm.empty_state, "no_work_items");
  assert.deepEqual(vm.critical, { blocking: [], overdue_blocking: [] });
});
