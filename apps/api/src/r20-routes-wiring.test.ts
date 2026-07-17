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
  UserAuthRow,
  UserRepository
} from "@workhub/db";

import { COOKIE_NAME, type AuthDependencies, type AuthEnv } from "./middleware/auth.js";
import { httpErrorCodeFor } from "./http-error-codes.js";
import { createInMemoryWorkItemService, WorkItemServiceError } from "./services/work-items.js";
import { createWorkItemRoutes } from "./routes/workitems.js";
import { createWorkspaceAuditRoutes } from "./routes/workspace-audit.js";
import type { WorkItemAssignmentService } from "./services/work-item-assignment.js";
import type { WorkItemCommentService } from "./services/work-item-comments.js";
import type { WorkspaceAuditService } from "./services/workspace-audit.js";

const now = new Date("2026-07-15T00:00:00.000Z");
const userId = "62000000-0000-4000-8000-000000000001";
const workItemId = "62000000-0000-4000-8000-0000000000bb";

function settings(): Settings {
  return loadSettings({ APP_ENV: "test", COOKIE_SECRET: "test-cookie-secret" });
}

function user(): UserAuthRow {
  return {
    id: userId,
    nickname: "host",
    cookieToken: "cookie-host",
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
  async findActiveById(id: string) { return id === userId ? user() : null; }
  async findActiveByCookieToken(token: string) { return token === "cookie-host" ? user() : null; }
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
  return generateSignedCookie(COOKIE_NAME, "cookie-host", runtimeSettings.auth.cookieSecret);
}

function withErrors(app: Hono<AuthEnv>) {
  app.onError((error, c) => {
    if (error instanceof ZodError) {
      return c.json({ ok: false, error: { code: "validation_error", message: "invalid payload" } }, 422);
    }
    if (error instanceof WorkItemServiceError) {
      return c.json({ ok: false, error: { code: error.code, message: error.message } }, error.status as 400);
    }
    if (error instanceof HTTPException) {
      return c.json({ ok: false, error: { code: httpErrorCodeFor(error), message: error.message } }, error.status);
    }
    throw error;
  });
  return app;
}

function assignmentsStub(overrides: Partial<WorkItemAssignmentService> = {}): WorkItemAssignmentService {
  return {
    async assign() {
      return {
        assignment: {
          id: "assign-1",
          work_item_id: workItemId,
          user_id: "62000000-0000-4000-8000-000000000002",
          role: "collaborator",
          assigned_by_user_id: userId,
          created_at: now.toISOString(),
          updated_at: now.toISOString()
        }
      };
    },
    async claim() {
      return { work_item_id: workItemId, claimed_by_user_id: userId };
    },
    ...overrides
  };
}

function commentsStub(overrides: Partial<WorkItemCommentService> = {}): WorkItemCommentService {
  return {
    async list() {
      return {
        work_item_id: workItemId,
        comments: [{
          id: "c-1", work_item_id: workItemId, author_nickname: "host", body: "hi",
          created_at: now.toISOString(), updated_at: now.toISOString()
        }]
      };
    },
    async create() {
      return {
        id: "c-2", work_item_id: workItemId, author_nickname: "host", body: "new",
        created_at: now.toISOString(), updated_at: now.toISOString()
      };
    },
    ...overrides
  };
}

function workItemApp(deps: { assignments?: WorkItemAssignmentService; comments?: WorkItemCommentService } = {}) {
  const runtimeSettings = settings();
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api", createWorkItemRoutes({
    auth: authDeps(runtimeSettings),
    workItems: createInMemoryWorkItemService({ now: () => now }),
    assignments: deps.assignments ?? assignmentsStub(),
    comments: deps.comments ?? commentsStub()
  }));
  return { app, runtimeSettings };
}

test("POST /api/workitems/:id/assign returns 201 with the assignment", async () => {
  const { app, runtimeSettings } = workItemApp();
  const response = await app.request(`/api/workitems/${workItemId}/assign`, {
    method: "POST",
    headers: { Cookie: await cookie(runtimeSettings), "Content-Type": "application/json" },
    body: JSON.stringify({ assignee_user_id: "62000000-0000-4000-8000-000000000002", role: "lead" })
  });
  assert.equal(response.status, 201);
  const body = await response.json() as { data: { assignment: { id: string } } };
  assert.equal(body.data.assignment.id, "assign-1");
});

test("POST /api/workitems/:id/assign maps service forbidden to 403", async () => {
  const { app, runtimeSettings } = workItemApp({
    assignments: assignmentsStub({ async assign() { throw new WorkItemServiceError(403, "forbidden", "no"); } })
  });
  const response = await app.request(`/api/workitems/${workItemId}/assign`, {
    method: "POST",
    headers: { Cookie: await cookie(runtimeSettings), "Content-Type": "application/json" },
    body: JSON.stringify({ assignee_user_id: "62000000-0000-4000-8000-000000000002" })
  });
  assert.equal(response.status, 403);
});

test("POST /api/workitems/:id/assign rejects an invalid role via 422", async () => {
  const { app, runtimeSettings } = workItemApp();
  const response = await app.request(`/api/workitems/${workItemId}/assign`, {
    method: "POST",
    headers: { Cookie: await cookie(runtimeSettings), "Content-Type": "application/json" },
    body: JSON.stringify({ assignee_user_id: "62000000-0000-4000-8000-000000000002", role: "boss" })
  });
  assert.equal(response.status, 422);
});

test("POST /api/workitems/:id/claim maps 409 conflict through", async () => {
  const { app, runtimeSettings } = workItemApp({
    assignments: assignmentsStub({ async claim() { throw new WorkItemServiceError(409, "work_item_not_claimable", "no"); } })
  });
  const response = await app.request(`/api/workitems/${workItemId}/claim`, {
    method: "POST",
    headers: { Cookie: await cookie(runtimeSettings) }
  });
  assert.equal(response.status, 409);
  const body = await response.json() as { error: { code: string } };
  assert.equal(body.error.code, "work_item_not_claimable");
});

test("GET /api/workitems/:id/comments returns the thread", async () => {
  const { app, runtimeSettings } = workItemApp();
  const response = await app.request(`/api/workitems/${workItemId}/comments`, {
    headers: { Cookie: await cookie(runtimeSettings) }
  });
  assert.equal(response.status, 200);
  const body = await response.json() as { data: { comments: unknown[] } };
  assert.equal(body.data.comments.length, 1);
});

test("POST /api/workitems/:id/comments returns 201; blank body is 422", async () => {
  const { app, runtimeSettings } = workItemApp();
  const ok = await app.request(`/api/workitems/${workItemId}/comments`, {
    method: "POST",
    headers: { Cookie: await cookie(runtimeSettings), "Content-Type": "application/json" },
    body: JSON.stringify({ body: "looks good" })
  });
  assert.equal(ok.status, 201);

  const blank = await app.request(`/api/workitems/${workItemId}/comments`, {
    method: "POST",
    headers: { Cookie: await cookie(runtimeSettings), "Content-Type": "application/json" },
    body: JSON.stringify({ body: "   " })
  });
  assert.equal(blank.status, 422);
});

test("work item comment routes reject non-uuid ids as 404 and require identity", async () => {
  const { app, runtimeSettings } = workItemApp();
  const badId = await app.request(`/api/workitems/not-a-uuid/comments`, {
    headers: { Cookie: await cookie(runtimeSettings) }
  });
  assert.equal(badId.status, 404);

  const noAuth = await app.request(`/api/workitems/${workItemId}/claim`, { method: "POST" });
  assert.equal(noAuth.status, 401);
});

// ---- workspace audit route ----

function workspaceAuditApp(svc: WorkspaceAuditService) {
  const runtimeSettings = settings();
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api", createWorkspaceAuditRoutes({ auth: authDeps(runtimeSettings), workspaceAudit: svc }));
  return { app, runtimeSettings };
}

test("GET /api/workspace/audit returns the audit page for an admin", async () => {
  const { app, runtimeSettings } = workspaceAuditApp({
    async list({ actor, query }) {
      return {
        generated_at: now.toISOString(),
        workspace_id: actor.workspaceId,
        audit_logs: [],
        page: { limit: query.limit ?? 50, offset: query.offset ?? 0, count: 0 }
      };
    }
  });
  const response = await app.request(`/api/workspace/audit?limit=10`, {
    headers: { Cookie: await cookie(runtimeSettings) }
  });
  assert.equal(response.status, 200);
  const body = await response.json() as { data: { page: { limit: number } } };
  assert.equal(body.data.page.limit, 10);
});

test("GET /api/workspace/audit maps the admin-only HTTPException to 403 forbidden", async () => {
  const { app, runtimeSettings } = workspaceAuditApp({
    async list() { throw new HTTPException(403, { message: "admin only" }); }
  });
  const response = await app.request(`/api/workspace/audit`, {
    headers: { Cookie: await cookie(runtimeSettings) }
  });
  assert.equal(response.status, 403);
  const body = await response.json() as { error: { code: string } };
  assert.equal(body.error.code, "forbidden");
});

test("GET /api/workspace/audit rejects a malformed limit via 422 and requires identity", async () => {
  const { app, runtimeSettings } = workspaceAuditApp({ async list() { throw new Error("must not run"); } });
  const bad = await app.request(`/api/workspace/audit?limit=0`, {
    headers: { Cookie: await cookie(runtimeSettings) }
  });
  assert.equal(bad.status, 422);

  const noAuth = await app.request(`/api/workspace/audit`);
  assert.equal(noAuth.status, 401);
});
