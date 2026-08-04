import assert from "node:assert/strict";
import test from "node:test";

import { Hono } from "hono";
import { generateSignedCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";

import { loadSettings, type Settings } from "@workhub/config";
import type {
  ClientDeviceAuthRow,
  ClientDeviceRepository,
  ProjectRow,
  UserAuthRow,
  UserRepository,
  WorkItemProjectRow
} from "@workhub/db";

import { COOKIE_NAME, type AuthActor, type AuthDependencies, type AuthEnv } from "./middleware/auth.js";
import { httpErrorCodeFor } from "./http-error-codes.js";
import { createProjectRoutes } from "./routes/projects.js";
import { ProjectServiceError } from "./services/projects.js";
import { createProjectOpsService, type ProjectOpsService } from "./services/project-ops.js";

const now = new Date("2026-07-15T00:00:00.000Z");
const ownerId = "62000000-0000-4000-8000-000000000001";
const projectId = "62000000-0000-4000-8000-0000000000aa";

function ownerActor(overrides: Partial<AuthActor> = {}): AuthActor {
  return {
    kind: "human",
    id: ownerId,
    label: "owner",
    userId: ownerId,
    isAdmin: false,
    orgId: "00000000-0000-4000-8000-000000000001",
    workspaceId: "00000000-0000-4000-8000-000000000002",
    ...overrides
  };
}

function activeProject(overrides: Partial<WorkItemProjectRow> = {}): WorkItemProjectRow {
  return {
    id: projectId,
    workspaceId: "00000000-0000-4000-8000-000000000002",
    name: "渠道增长",
    slug: "growth",
    description: null,
    ownerNickname: "owner",
    ownerUserId: ownerId,
    archived: false,
    deletedAt: null,
    isPersonal: false,
    isDmContainer: false,
    orgId: "00000000-0000-4000-8000-000000000001",
    ...overrides
  } as unknown as WorkItemProjectRow;
}

function resultRow(overrides: Partial<ProjectRow> = {}): ProjectRow {
  return {
    id: projectId,
    workspaceId: "00000000-0000-4000-8000-000000000002",
    name: "渠道增长",
    slug: "growth",
    description: null,
    ownerNickname: "owner",
    ownerUserId: ownerId,
    archived: true,
    deletedAt: null,
    isPersonal: false,
    ...overrides
  } as unknown as ProjectRow;
}

function service(overrides: {
  project?: WorkItemProjectRow | null;
  archiveReturns?: ProjectRow | null;
  deleteReturns?: ProjectRow | null;
  calls?: { archive: string[]; softDelete: Array<{ projectId: string; deletedByNickname: string | null | undefined }> };
} = {}) {
  const calls = overrides.calls ?? { archive: [], softDelete: [] };
  return {
    svc: createProjectOpsService({
      projectLookup: {
        async findProjectById() {
          return overrides.project === undefined ? activeProject() : overrides.project;
        }
      },
      projects: {
        async archiveProject(input) {
          calls.archive.push(input.projectId);
          return overrides.archiveReturns === undefined ? resultRow() : overrides.archiveReturns;
        },
        async softDeleteProject(input) {
          calls.softDelete.push({ projectId: input.projectId, deletedByNickname: input.deletedByNickname });
          return overrides.deleteReturns === undefined ? resultRow({ deletedAt: now }) : overrides.deleteReturns;
        }
      },
      now: () => now
    }),
    calls
  };
}

// ---- service unit tests ----

test("archiveProject: owner can archive; repo receives the project id and VM is returned", async () => {
  const { svc, calls } = service();
  const result = await svc.archiveProject({ projectId, actor: ownerActor() });
  assert.equal(result.archived, true);
  assert.equal(result.project.id, projectId);
  assert.deepEqual(calls.archive, [projectId]);
});

test("archiveProject: admin (non-owner) can archive within the workspace", async () => {
  const { svc, calls } = service({ project: activeProject({ ownerUserId: "someone-else" }) });
  const result = await svc.archiveProject({
    projectId,
    actor: ownerActor({ isAdmin: true, userId: "admin-user", id: "admin-user" })
  });
  assert.equal(result.archived, true);
  assert.deepEqual(calls.archive, [projectId]);
});

test("archiveProject: non-owner non-admin is forbidden and the repo is never called", async () => {
  const { svc, calls } = service({ project: activeProject({ ownerUserId: "someone-else" }) });
  await assert.rejects(
    () => svc.archiveProject({ projectId, actor: ownerActor({ userId: "intruder", id: "intruder" }) }),
    (error: unknown) => error instanceof ProjectServiceError && error.status === 403 && error.code === "project_forbidden"
  );
  assert.deepEqual(calls.archive, []);
});

// R21 加固（NULL 旁路收口）：workspaceId 为 NULL 的孤儿项目不再对任意租户的管理员敞开。
test("archiveProject: an admin from another tenant cannot manage a NULL-workspace orphan project", async () => {
  const { svc, calls } = service({
    project: activeProject({ workspaceId: null, ownerUserId: "someone-else" } as Partial<WorkItemProjectRow>)
  });
  await assert.rejects(
    () =>
      svc.archiveProject({
        projectId,
        actor: ownerActor({
          isAdmin: true,
          userId: "cross-admin",
          id: "cross-admin",
          workspaceId: "99999999-0000-4000-8000-000000000099"
        })
      }),
    (error: unknown) => error instanceof ProjectServiceError && error.status === 403 && error.code === "project_forbidden"
  );
  assert.deepEqual(calls.archive, [], "orphan rows must not be manageable by any admin");
});

test("archiveProject: an admin cannot manage a project in a DIFFERENT workspace (explicit cross-tenant deny)", async () => {
  const { svc, calls } = service({ project: activeProject({ ownerUserId: "someone-else" }) });
  await assert.rejects(
    () =>
      svc.archiveProject({
        projectId,
        actor: ownerActor({
          isAdmin: true,
          userId: "cross-admin",
          id: "cross-admin",
          workspaceId: "99999999-0000-4000-8000-000000000099"
        })
      }),
    (error: unknown) => error instanceof ProjectServiceError && error.status === 403
  );
  assert.deepEqual(calls.archive, []);
});

test("deleteProject: the owner can still manage their own NULL-workspace project (ownership beats orphanhood)", async () => {
  const { svc, calls } = service({
    project: activeProject({ workspaceId: null } as Partial<WorkItemProjectRow>)
  });
  const result = await svc.deleteProject({ projectId, actor: ownerActor() });
  assert.equal(result.deleted, true);
  assert.equal(calls.softDelete.length, 1);
});

test("archiveProject: missing project maps to 404 project_not_found", async () => {
  const { svc } = service({ project: null });
  await assert.rejects(
    () => svc.archiveProject({ projectId, actor: ownerActor() }),
    (error: unknown) => error instanceof ProjectServiceError && error.status === 404 && error.code === "project_not_found"
  );
});

test("archiveProject: CAS miss after the permission gate maps to 404", async () => {
  const { svc } = service({ archiveReturns: null });
  await assert.rejects(
    () => svc.archiveProject({ projectId, actor: ownerActor() }),
    (error: unknown) => error instanceof ProjectServiceError && error.status === 404
  );
});

test("deleteProject: owner can soft-delete; deleter nickname is recorded", async () => {
  const { svc, calls } = service();
  const result = await svc.deleteProject({ projectId, actor: ownerActor({ label: "owner-name" }) });
  assert.equal(result.deleted, true);
  assert.equal(calls.softDelete.length, 1);
  assert.equal(calls.softDelete[0]?.deletedByNickname, "owner-name");
});

test("deleteProject: non-owner non-admin is forbidden", async () => {
  const { svc, calls } = service({ project: activeProject({ ownerUserId: "someone-else" }) });
  await assert.rejects(
    () => svc.deleteProject({ projectId, actor: ownerActor({ userId: "intruder", id: "intruder" }) }),
    (error: unknown) => error instanceof ProjectServiceError && error.status === 403
  );
  assert.deepEqual(calls.softDelete, []);
});

// ---- route wiring tests ----

function settings(): Settings {
  return loadSettings({ APP_ENV: "test", COOKIE_SECRET: "test-cookie-secret" });
}

function user(): UserAuthRow {
  return {
    id: ownerId,
    nickname: "owner",
    cookieToken: "cookie-owner",
    preferredLocale: "zh-CN",
    availabilityStatus: "free",
    availabilityText: null,
    availabilityUpdatedAt: null,
    mutedNotificationTypes: [],
    avatarWebp: null,
    avatarUpdatedAt: null,
    isAdmin: false,
    deletedAt: null,
    deletedByUserId: null,
    createdAt: now,
    updatedAt: now
  };
}

class MemoryUsers implements UserRepository {
  async findActiveById(id: string) { return id === ownerId ? user() : null; }
  async findActiveByCookieToken(token: string) { return token === "cookie-owner" ? user() : null; }
  async findActiveByNickname() { return null; }
  async createUser(): Promise<UserAuthRow> { throw new Error("not needed"); }
  async getOrCreateActiveByNickname(): Promise<{ user: UserAuthRow; created: boolean }> { throw new Error("not needed"); }
  async rotateCookieToken() { return null; }
}

class MemoryDevices implements ClientDeviceRepository {
  async findActiveByTokenHash() { return null; }
  async findActiveByTokenHashForUser() { return null; }
  async createClientDevice(): Promise<ClientDeviceAuthRow> { throw new Error("not needed"); }
  async listByUser() { return []; }
  async touchLastSeen() { return null; }
  async revokeByIdForUser() { return null; }
  async revokeByTokenHash() { return null; }
}

function authDeps(runtimeSettings: Settings): AuthDependencies {
  return { users: new MemoryUsers(), devices: new MemoryDevices(), settings: runtimeSettings, now: () => now };
}

async function cookie(runtimeSettings: Settings) {
  return generateSignedCookie(COOKIE_NAME, "cookie-owner", runtimeSettings.auth.cookieSecret);
}

function withErrors(app: Hono<AuthEnv>) {
  app.onError((error, c) => {
    if (error instanceof ZodError) {
      return c.json({ ok: false, error: { code: "validation_error", message: "invalid payload" } }, 422);
    }
    if (error instanceof ProjectServiceError) {
      return c.json({ ok: false, error: { code: error.code, message: error.message } }, error.status as 400);
    }
    if (error instanceof HTTPException) {
      return c.json({ ok: false, error: { code: httpErrorCodeFor(error), message: error.message } }, error.status);
    }
    throw error;
  });
  return app;
}

function fakeProjectOps(): ProjectOpsService {
  return {
    async archiveProject({ projectId: id }) {
      return { project: { id, workspace_id: null, name: "P", slug: "p", owner_nickname: "o", owner_user_id: null, is_personal: false }, archived: true };
    },
    async deleteProject({ projectId: id }) {
      return { project: { id, workspace_id: null, name: "P", slug: "p", owner_nickname: "o", owner_user_id: null, is_personal: false }, deleted: true };
    }
  };
}

function projectRoutesApp(projectOps: ProjectOpsService) {
  const runtimeSettings = settings();
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/projects", createProjectRoutes({
    auth: authDeps(runtimeSettings),
    projects: {
      async bootstrapProject() { throw new Error("unused"); },
      async listProjects() { return { generated_at: now.toISOString(), projects: [] }; },
      async createPersonalProject() { throw new Error("unused"); },
      async listPersonalProjects() { throw new Error("unused"); }
    },
    projectOps
  }));
  return { app, runtimeSettings };
}

test("POST /api/projects/:id/archive returns 200 with the archived VM", async () => {
  const { app, runtimeSettings } = projectRoutesApp(fakeProjectOps());
  const response = await app.request(`/api/projects/${projectId}/archive`, {
    method: "POST",
    headers: { Cookie: await cookie(runtimeSettings) }
  });
  assert.equal(response.status, 200);
  const body = await response.json() as { data: { archived: boolean; project: { id: string } } };
  assert.equal(body.data.archived, true);
  assert.equal(body.data.project.id, projectId);
});

test("POST /api/projects/:id/delete surfaces service forbidden as 403", async () => {
  const ops: ProjectOpsService = {
    async archiveProject() { throw new Error("unused"); },
    async deleteProject() { throw new ProjectServiceError(403, "project_forbidden", "no"); }
  };
  const { app, runtimeSettings } = projectRoutesApp(ops);
  const response = await app.request(`/api/projects/${projectId}/delete`, {
    method: "POST",
    headers: { Cookie: await cookie(runtimeSettings) }
  });
  assert.equal(response.status, 403);
  const body = await response.json() as { error: { code: string } };
  assert.equal(body.error.code, "project_forbidden");
});

test("POST /api/projects/:id/archive rejects a non-uuid id as 404 before the service", async () => {
  let called = false;
  const ops: ProjectOpsService = {
    async archiveProject() { called = true; throw new Error("must not run"); },
    async deleteProject() { throw new Error("unused"); }
  };
  const { app, runtimeSettings } = projectRoutesApp(ops);
  const response = await app.request(`/api/projects/not-a-uuid/archive`, {
    method: "POST",
    headers: { Cookie: await cookie(runtimeSettings) }
  });
  assert.equal(response.status, 404);
  assert.equal(called, false);
});

test("POST /api/projects/:id/archive requires identity", async () => {
  const { app } = projectRoutesApp(fakeProjectOps());
  const response = await app.request(`/api/projects/${projectId}/archive`, { method: "POST" });
  assert.equal(response.status, 401);
});
