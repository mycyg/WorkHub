import assert from "node:assert/strict";
import test from "node:test";

import {
  TimelineDependencyError,
  TimelineMilestoneScopeError,
  type ProjectMilestoneRow,
  type ProjectTimelineRepository,
  type WorkItemDataRepository,
  type WorkItemProjectRow
} from "@workhub/db";

import type { AuthActor } from "./middleware/auth.js";
import {
  createProjectTimelineService,
  ProjectTimelineServiceError
} from "./services/project-timeline.js";
import { WorkItemServiceError, type WorkItemService } from "./services/work-items.js";

const WS = "11111111-1111-4111-8111-111111111111";
const OTHER_WS = "99999999-9999-4999-8999-999999999999";
const ORG = "00000000-0000-4000-8000-0000000000aa";
const PROJ = "22222222-2222-4222-8222-222222222222";
const OWNER = "33333333-3333-4333-8333-333333333333";
const MEMBER = "33333333-3333-4333-8333-3333333333cc";
const OUTSIDER = "33333333-3333-4333-8333-3333333333ee";
const WI_A = "44444444-4444-4444-8444-444444444401";
const WI_B = "44444444-4444-4444-8444-444444444402";
const MILESTONE = "55555555-5555-4555-8555-555555555501";
const NOW = new Date("2026-07-15T00:00:00.000Z");

function actor(over: Partial<AuthActor> = {}): AuthActor {
  return {
    kind: "human",
    id: MEMBER,
    label: "member",
    userId: MEMBER,
    isAdmin: false,
    orgId: ORG,
    workspaceId: WS,
    ...over
  };
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
    ownerUserId: OWNER,
    archived: false,
    deletedAt: null,
    ...over
  } as unknown as WorkItemProjectRow;
}

function milestoneRow(over: Partial<ProjectMilestoneRow> = {}): ProjectMilestoneRow {
  return {
    id: MILESTONE,
    projectId: PROJ,
    title: "M1",
    dueAt: new Date("2026-08-01T00:00:00.000Z"),
    sort: 0,
    status: "open",
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    ...over
  };
}

// 里程碑写路径只用到 repo 的 create/update/softDelete；其余方法给出安全默认。
function fakeRepo(over: Partial<ProjectTimelineRepository> = {}): ProjectTimelineRepository {
  return {
    createMilestone: async (input) => milestoneRow({ projectId: input.projectId, title: input.title, dueAt: input.dueAt ?? null }),
    updateMilestone: async () => milestoneRow(),
    softDeleteMilestone: async () => true,
    listActiveMilestonesByProject: async () => [],
    addDependency: async (input) => ({
      edge: {
        id: "edge",
        workItemId: input.workItemId,
        dependsOnWorkItemId: input.dependsOnWorkItemId,
        createdByUserId: input.createdByUserId ?? null,
        createdAt: NOW
      },
      created: true
    }),
    removeDependency: async () => true,
    attachWorkItemMilestone: async () => true,
    listTimelineWorkItems: async () => [],
    listDependencyEdgesByProject: async () => [],
    listObjectiveIdsByWorkItemIds: async () => new Map(),
    ...over
  };
}

function fakeProjectRepo(project: WorkItemProjectRow | null): Pick<WorkItemDataRepository, "findProjectById"> {
  return { findProjectById: async () => project };
}

function fakeWorkItems(assertImpl?: WorkItemService["assertCanMutateWorkItem"]): Pick<WorkItemService, "assertCanMutateWorkItem"> {
  return {
    assertCanMutateWorkItem: assertImpl ?? (async () => {})
  };
}

test("createMilestone allows a same-workspace member and returns the milestone VM", async () => {
  const service = createProjectTimelineService({
    repo: fakeRepo(),
    projectRepo: fakeProjectRepo(projectRow()),
    workItems: fakeWorkItems(),
    now: () => NOW
  });
  const vm = await service.createMilestone({ projectId: PROJ, actor: actor(), title: "Beta launch", dueAt: null });
  assert.equal(vm.project_id, PROJ);
  assert.equal(vm.title, "Beta launch");
  assert.equal(vm.status, "open");
  assert.equal(vm.due_at, null);
});

test("createMilestone rejects an outsider from another workspace with 403", async () => {
  const service = createProjectTimelineService({
    repo: fakeRepo(),
    projectRepo: fakeProjectRepo(projectRow()),
    workItems: fakeWorkItems(),
    now: () => NOW
  });
  await assert.rejects(
    service.createMilestone({ projectId: PROJ, actor: actor({ id: OUTSIDER, userId: OUTSIDER, workspaceId: OTHER_WS }), title: "X" }),
    (error: unknown) => error instanceof ProjectTimelineServiceError && error.status === 403 && error.code === "project_forbidden"
  );
});

test("createMilestone returns 404 when the project is missing/archived (findProjectById null)", async () => {
  const service = createProjectTimelineService({
    repo: fakeRepo(),
    projectRepo: fakeProjectRepo(null),
    workItems: fakeWorkItems(),
    now: () => NOW
  });
  await assert.rejects(
    service.createMilestone({ projectId: PROJ, actor: actor(), title: "X" }),
    (error: unknown) => error instanceof ProjectTimelineServiceError && error.status === 404 && error.code === "project_not_found"
  );
});

test("updateMilestone maps a missing milestone (repo null) to 404", async () => {
  const service = createProjectTimelineService({
    repo: fakeRepo({ updateMilestone: async () => null }),
    projectRepo: fakeProjectRepo(projectRow()),
    workItems: fakeWorkItems(),
    now: () => NOW
  });
  await assert.rejects(
    service.updateMilestone({ projectId: PROJ, milestoneId: MILESTONE, actor: actor(), status: "done" }),
    (error: unknown) => error instanceof ProjectTimelineServiceError && error.status === 404 && error.code === "milestone_not_found"
  );
});

test("addDependency propagates the per-work-item mutate guard (403) unchanged", async () => {
  const service = createProjectTimelineService({
    repo: fakeRepo(),
    projectRepo: fakeProjectRepo(projectRow()),
    workItems: fakeWorkItems(async () => {
      throw new WorkItemServiceError(403, "forbidden", "你没有权限修改这个事项。");
    }),
    now: () => NOW
  });
  await assert.rejects(
    service.addDependency({ workItemId: WI_A, dependsOnWorkItemId: WI_B, actor: actor() }),
    (error: unknown) => error instanceof WorkItemServiceError && error.status === 403
  );
});

test("addDependency maps a repo cycle error to 422 dependency_cycle", async () => {
  const service = createProjectTimelineService({
    repo: fakeRepo({
      addDependency: async () => {
        throw new TimelineDependencyError("cycle", "循环依赖");
      }
    }),
    projectRepo: fakeProjectRepo(projectRow()),
    workItems: fakeWorkItems(),
    now: () => NOW
  });
  await assert.rejects(
    service.addDependency({ workItemId: WI_A, dependsOnWorkItemId: WI_B, actor: actor() }),
    (error: unknown) => error instanceof ProjectTimelineServiceError && error.status === 422 && error.code === "dependency_cycle"
  );
});

test("addDependency maps cross-project and self errors to 422, and missing endpoints to 404", async () => {
  for (const [code, expectedStatus, expectedCode] of [
    ["cross_project", 422, "dependency_cross_project"],
    ["self_dependency", 422, "dependency_self_dependency"],
    ["work_item_not_found", 404, "dependency_work_item_not_found"]
  ] as const) {
    const service = createProjectTimelineService({
      repo: fakeRepo({
        addDependency: async () => {
          throw new TimelineDependencyError(code, "boom");
        }
      }),
      projectRepo: fakeProjectRepo(projectRow()),
      workItems: fakeWorkItems(),
      now: () => NOW
    });
    await assert.rejects(
      service.addDependency({ workItemId: WI_A, dependsOnWorkItemId: WI_B, actor: actor() }),
      (error: unknown) =>
        error instanceof ProjectTimelineServiceError && error.status === expectedStatus && error.code === expectedCode
    );
  }
});

test("addDependency reports idempotent created=false when the edge already exists", async () => {
  const service = createProjectTimelineService({
    repo: fakeRepo({
      addDependency: async (input) => ({
        edge: {
          id: "edge",
          workItemId: input.workItemId,
          dependsOnWorkItemId: input.dependsOnWorkItemId,
          createdByUserId: null,
          createdAt: NOW
        },
        created: false
      })
    }),
    projectRepo: fakeProjectRepo(projectRow()),
    workItems: fakeWorkItems(),
    now: () => NOW
  });
  const result = await service.addDependency({ workItemId: WI_A, dependsOnWorkItemId: WI_B, actor: actor() });
  assert.deepEqual(result, { work_item_id: WI_A, depends_on: WI_B, created: false });
});

test("attachMilestone maps a scope mismatch to 422 milestone_scope_mismatch", async () => {
  const service = createProjectTimelineService({
    repo: fakeRepo({
      attachWorkItemMilestone: async () => {
        throw new TimelineMilestoneScopeError();
      }
    }),
    projectRepo: fakeProjectRepo(projectRow()),
    workItems: fakeWorkItems(),
    now: () => NOW
  });
  await assert.rejects(
    service.attachMilestone({ workItemId: WI_A, milestoneId: MILESTONE, actor: actor() }),
    (error: unknown) => error instanceof ProjectTimelineServiceError && error.status === 422 && error.code === "milestone_scope_mismatch"
  );
});

test("attachMilestone detaches (milestone_id=null) and enforces the per-work-item mutate guard", async () => {
  let guarded = false;
  const service = createProjectTimelineService({
    repo: fakeRepo(),
    projectRepo: fakeProjectRepo(projectRow()),
    workItems: fakeWorkItems(async () => {
      guarded = true;
    }),
    now: () => NOW
  });
  const result = await service.attachMilestone({ workItemId: WI_A, milestoneId: null, actor: actor() });
  assert.equal(guarded, true);
  assert.deepEqual(result, { work_item_id: WI_A, milestone_id: null });
});
