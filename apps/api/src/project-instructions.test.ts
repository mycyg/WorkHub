import assert from "node:assert/strict";
import test from "node:test";

import type { ProjectRepository, ProjectRow, WorkItemDataRepository, WorkItemProjectRow } from "@workhub/db";

import type { AuthActor } from "./middleware/auth.js";
import {
  createProjectInstructionsService,
  ProjectInstructionsServiceError
} from "./services/project-instructions.js";

// 权限门与 E1 里程碑写同一道 fence（canManageProjectDrive）——同 project-timeline.test.ts 的夹具形状,
// 常量命名对齐,方便对照两份测试。
const WS = "11111111-1111-4111-8111-111111111111";
const OTHER_WS = "99999999-9999-4999-8999-999999999999";
const ORG = "00000000-0000-4000-8000-0000000000aa";
const PROJ = "22222222-2222-4222-8222-222222222222";
const OWNER = "33333333-3333-4333-8333-333333333333";
const MEMBER = "33333333-3333-4333-8333-3333333333cc";
const OUTSIDER = "33333333-3333-4333-8333-3333333333ee";
const NOW = new Date("2026-07-16T00:00:00.000Z");

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
    deletedByNickname: null,
    nextSeq: 0,
    isPersonal: false,
    isDmContainer: false,
    instructionsMd: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...over
  } as unknown as WorkItemProjectRow;
}

function updatedProjectRow(over: Partial<ProjectRow> = {}): ProjectRow {
  const { orgId: _orgId, ...base } = projectRow();
  return { ...base, ...over } as ProjectRow;
}

function fakeProjectRepo(project: WorkItemProjectRow | null): Pick<WorkItemDataRepository, "findProjectById"> {
  return { findProjectById: async () => project };
}

function fakeInstructionsRepo(
  impl?: Pick<ProjectRepository, "updateInstructions">["updateInstructions"]
): Pick<ProjectRepository, "updateInstructions"> {
  return {
    updateInstructions: impl ?? (async (input) => updatedProjectRow({ instructionsMd: input.instructionsMd, updatedAt: input.now ?? NOW }))
  };
}

test("getInstructions allows a same-workspace member and returns an empty string when nothing is configured", async () => {
  const service = createProjectInstructionsService({
    projectRepo: fakeProjectRepo(projectRow()),
    instructionsRepo: fakeInstructionsRepo(),
    now: () => NOW
  });
  const vm = await service.getInstructions({ projectId: PROJ, actor: actor() });
  assert.deepEqual(vm, { project_id: PROJ, instructions_md: "", updated_at: NOW.toISOString() });
});

test("getInstructions returns the configured instructions_md verbatim", async () => {
  const service = createProjectInstructionsService({
    projectRepo: fakeProjectRepo(projectRow({ instructionsMd: "遇到发布相关的工单，先问一句要不要拉发布负责人。" })),
    instructionsRepo: fakeInstructionsRepo(),
    now: () => NOW
  });
  const vm = await service.getInstructions({ projectId: PROJ, actor: actor() });
  assert.equal(vm.instructions_md, "遇到发布相关的工单，先问一句要不要拉发布负责人。");
});

test("getInstructions rejects an outsider from another workspace with 403 project_forbidden", async () => {
  const service = createProjectInstructionsService({
    projectRepo: fakeProjectRepo(projectRow()),
    instructionsRepo: fakeInstructionsRepo(),
    now: () => NOW
  });
  await assert.rejects(
    service.getInstructions({ projectId: PROJ, actor: actor({ id: OUTSIDER, userId: OUTSIDER, workspaceId: OTHER_WS }) }),
    (error: unknown) => error instanceof ProjectInstructionsServiceError && error.status === 403 && error.code === "project_forbidden"
  );
});

test("getInstructions returns 404 when the project is missing/archived/deleted (findProjectById null)", async () => {
  const service = createProjectInstructionsService({
    projectRepo: fakeProjectRepo(null),
    instructionsRepo: fakeInstructionsRepo(),
    now: () => NOW
  });
  await assert.rejects(
    service.getInstructions({ projectId: PROJ, actor: actor() }),
    (error: unknown) => error instanceof ProjectInstructionsServiceError && error.status === 404 && error.code === "project_not_found"
  );
});

test("patchInstructions writes the (already trimmed) instructions_md and returns the updated VM", async () => {
  const writes: unknown[] = [];
  const service = createProjectInstructionsService({
    projectRepo: fakeProjectRepo(projectRow()),
    instructionsRepo: fakeInstructionsRepo(async (input) => {
      writes.push(input);
      return updatedProjectRow({ instructionsMd: input.instructionsMd, updatedAt: NOW });
    }),
    now: () => NOW
  });

  const vm = await service.patchInstructions({
    projectId: PROJ,
    actor: actor(),
    payload: { instructions_md: "遇到发布相关的工单，先问一句要不要拉发布负责人。" }
  });

  assert.equal(vm.instructions_md, "遇到发布相关的工单，先问一句要不要拉发布负责人。");
  assert.equal(vm.updated_at, NOW.toISOString());
  assert.deepEqual(writes, [
    { projectId: PROJ, instructionsMd: "遇到发布相关的工单，先问一句要不要拉发布负责人。", now: NOW }
  ]);
});

// 契约层已经把 instructions_md 做了 .trim()——服务层收到的空串只有两种来源：本来就没配置,或者用户
// 显式清空。两种都必须折成 DB 的 NULL（"留空不注入"），不能存成空字符串。
test("patchInstructions folds an empty instructions_md to null (clearing) instead of storing an empty string", async () => {
  const writes: unknown[] = [];
  const service = createProjectInstructionsService({
    projectRepo: fakeProjectRepo(projectRow({ instructionsMd: "旧指令" })),
    instructionsRepo: fakeInstructionsRepo(async (input) => {
      writes.push(input);
      return updatedProjectRow({ instructionsMd: input.instructionsMd, updatedAt: NOW });
    }),
    now: () => NOW
  });

  const vm = await service.patchInstructions({ projectId: PROJ, actor: actor(), payload: { instructions_md: "" } });

  assert.equal(vm.instructions_md, "");
  assert.deepEqual(writes, [{ projectId: PROJ, instructionsMd: null, now: NOW }]);
});

test("patchInstructions is idempotent: writing the same value twice succeeds both times and returns the same content", async () => {
  const service = createProjectInstructionsService({
    projectRepo: fakeProjectRepo(projectRow()),
    instructionsRepo: fakeInstructionsRepo(),
    now: () => NOW
  });
  const payload = { instructions_md: "遇到发布相关的工单，先问一句要不要拉发布负责人。" };

  const first = await service.patchInstructions({ projectId: PROJ, actor: actor(), payload });
  const second = await service.patchInstructions({ projectId: PROJ, actor: actor(), payload });

  assert.equal(first.instructions_md, payload.instructions_md);
  assert.equal(second.instructions_md, payload.instructions_md);
});

test("patchInstructions rejects an outsider from another workspace with 403 before writing", async () => {
  let wrote = false;
  const service = createProjectInstructionsService({
    projectRepo: fakeProjectRepo(projectRow()),
    instructionsRepo: fakeInstructionsRepo(async (input) => {
      wrote = true;
      return updatedProjectRow({ instructionsMd: input.instructionsMd });
    }),
    now: () => NOW
  });
  await assert.rejects(
    service.patchInstructions({
      projectId: PROJ,
      actor: actor({ id: OUTSIDER, userId: OUTSIDER, workspaceId: OTHER_WS }),
      payload: { instructions_md: "x" }
    }),
    (error: unknown) => error instanceof ProjectInstructionsServiceError && error.status === 403 && error.code === "project_forbidden"
  );
  assert.equal(wrote, false, "must not write when the permission check fails");
});

test("patchInstructions returns 404 when the project is missing/archived (findProjectById null)", async () => {
  const service = createProjectInstructionsService({
    projectRepo: fakeProjectRepo(null),
    instructionsRepo: fakeInstructionsRepo(),
    now: () => NOW
  });
  await assert.rejects(
    service.patchInstructions({ projectId: PROJ, actor: actor(), payload: { instructions_md: "x" } }),
    (error: unknown) => error instanceof ProjectInstructionsServiceError && error.status === 404 && error.code === "project_not_found"
  );
});

// 权限门放行之后、写路径真正落库之前，项目被并发归档/软删——updateInstructions 的活跃性 WHERE 落空
// 返回 null，服务层按其它服务同款取舍映射成 404（而不是让调用方看到一个语义不明的 500/静默成功）。
test("patchInstructions maps a race-lost write (repo returns null) to 404 project_not_found", async () => {
  const service = createProjectInstructionsService({
    projectRepo: fakeProjectRepo(projectRow()),
    instructionsRepo: fakeInstructionsRepo(async () => null),
    now: () => NOW
  });
  await assert.rejects(
    service.patchInstructions({ projectId: PROJ, actor: actor(), payload: { instructions_md: "x" } }),
    (error: unknown) => error instanceof ProjectInstructionsServiceError && error.status === 404 && error.code === "project_not_found"
  );
});

// canManageProjectDrive 的 admin 分支走 projectScopeMatches（要求 org 与 workspace 都对得上，比
// canViewProjectDrive 的 admin 分支「只要求同 org」更严——这是「能看」和「能管」两道门故意不同的地方，
// 这个端点走的是「能管」，钉住这条区分，别被将来误改成 view 那道更松的门）。
test("getInstructions rejects an admin from a different workspace even in the same org (manage gate is stricter than view)", async () => {
  const service = createProjectInstructionsService({
    projectRepo: fakeProjectRepo(projectRow()),
    instructionsRepo: fakeInstructionsRepo(),
    now: () => NOW
  });
  const adminActor = actor({ isAdmin: true, workspaceId: OTHER_WS, orgId: ORG });
  await assert.rejects(
    service.getInstructions({ projectId: PROJ, actor: adminActor }),
    (error: unknown) => error instanceof ProjectInstructionsServiceError && error.status === 403 && error.code === "project_forbidden"
  );
});

test("getInstructions allows an admin in the same org and workspace as the project", async () => {
  const service = createProjectInstructionsService({
    projectRepo: fakeProjectRepo(projectRow()),
    instructionsRepo: fakeInstructionsRepo(),
    now: () => NOW
  });
  const adminActor = actor({ isAdmin: true, id: OUTSIDER, userId: OUTSIDER, workspaceId: WS, orgId: ORG });
  const vm = await service.getInstructions({ projectId: PROJ, actor: adminActor });
  assert.equal(vm.project_id, PROJ);
});
