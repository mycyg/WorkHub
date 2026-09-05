import assert from "node:assert/strict";
import test from "node:test";

import { Hono } from "hono";
import { generateSignedCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";

import { loadSettings, type Settings } from "@workhub/config";
import type {
  ClientDeviceAuthRow,
  ClientDeviceRepository,
  UserAuthRow,
  UserRepository,
  WorkspaceMembershipRepository
} from "@workhub/db";

import { COOKIE_NAME, type AuthDependencies, type AuthEnv } from "./middleware/auth.js";
import { httpErrorCodeFor } from "./http-error-codes.js";
import { createObjectiveRoutes } from "./routes/objectives.js";
import { createProjectRoutes } from "./routes/projects.js";
import {
  buildObjectivePlanningLines,
  createObjectiveService,
  type ObjectiveDetailResult,
  type ObjectiveListResult,
  type ObjectiveProgressSnapshot,
  type ObjectiveRepository,
  type ObjectiveService
} from "./services/objectives.js";
import { ProjectServiceError } from "./services/projects.js";
import { WorkspaceMemberServiceError } from "./services/workspace-members.js";

const now = new Date("2026-07-03T08:00:00.000Z");
const workspaceId = "97000000-0000-4000-8000-000000000001";
const objectiveId = "97000000-0000-4000-8000-000000000002";
const workItemId = "97000000-0000-4000-8000-000000000003";
const routeUserId = "97000000-0000-4000-8000-000000000050";
const routeWorkItemId = "97000000-0000-4000-8000-000000000051";
const routeTaskPlanId = "97000000-0000-4000-8000-000000000052";
const routeProjectId = "97000000-0000-4000-8000-000000000053";

const objective: ObjectiveProgressSnapshot["objective"] = {
  id: objectiveId,
  workspaceId,
  title: "Raise R9 review quality",
  descriptionMd: "Use OKRs as planning input, not a workflow blocker.",
  ownerUserId: null,
  status: "active",
  progressPercent: 40,
  progressUpdatedAt: now,
  createdAt: now,
  updatedAt: now
};

// R23 F-01：给「工作区列出多个目标」路由测试用的第二个目标——只需与 objective 区分 id/title。
const secondObjectiveRow: ObjectiveProgressSnapshot["objective"] = {
  ...objective,
  id: "97000000-0000-4000-8000-000000000054",
  title: "Reduce review escapes"
};

const keyResult: ObjectiveProgressSnapshot["keyResults"][number] = {
  id: "97000000-0000-4000-8000-000000000011",
  objectiveId,
  workspaceId,
  seq: 1,
  title: "Every slice has adversarial review notes",
  targetValue: "100",
  currentValue: "40",
  unit: "%",
  status: "active",
  progressPercent: 40,
  createdAt: now,
  updatedAt: now
};

type ListPlanningContextInput = Parameters<ObjectiveRepository["listPlanningContextForWorkItem"]>[0];
type UpdateObjectiveProgressInput = Parameters<ObjectiveRepository["updateObjectiveProgress"]>[0];

test("R9.5 objective planning lines are concise and honest about capped context", () => {
  const lines = buildObjectivePlanningLines({
    objectives: [{
      objective,
      keyResults: [keyResult]
    }],
    objectivesCapped: true,
    keyResultsCapped: false
  });

  assert.equal(lines.capped, true);
  assert.equal(lines.objectiveId, objectiveId);
  assert.equal(lines.lines.length, 3);
  assert.match(lines.lines[0] ?? "", /Objective: Raise R9 review quality/);
  assert.match(lines.lines[0] ?? "", /40%/);
  assert.match(lines.lines[1] ?? "", /KR 1: Every slice has adversarial review notes/);
  assert.match(lines.lines[2] ?? "", /capped/u);
});

test("R9.5 objective service keeps unlinked work items non-blocking", async () => {
  const calls: unknown[] = [];
  const service = createObjectiveService({
    objectives: {
      async listPlanningContextForWorkItem(input: ListPlanningContextInput) {
        calls.push(input);
        return { objectives: [], objectivesCapped: false, keyResultsCapped: false };
      }
    } as unknown as ObjectiveRepository
  });

  const context = await service.planningContextForWorkItem({ workspaceId, workItemId });

  assert.deepEqual(calls, [{ workspaceId, workItemId }]);
  assert.deepEqual(context, { lines: [], capped: false });
});

test("R9.5 objective service refreshes objective progress from key results", async () => {
  const updates: unknown[] = [];
  const snapshot: ObjectiveProgressSnapshot = {
    objective,
    keyResults: [
      { ...keyResult, progressPercent: 25 },
      { ...keyResult, id: "97000000-0000-4000-8000-000000000012", seq: 2, progressPercent: 75 }
    ],
    linkedWorkItems: [],
    keyResultsCapped: false,
    workItemsCapped: false
  };
  const service = createObjectiveService({
    objectives: {
      async readObjectiveProgressSnapshot() {
        return snapshot;
      },
      async updateObjectiveProgress(input: UpdateObjectiveProgressInput) {
        updates.push(input);
        return { ...objective, progressPercent: input.progressPercent, progressUpdatedAt: input.progressUpdatedAt };
      }
    } as unknown as ObjectiveRepository,
    now: () => now
  });

  const result = await service.refreshObjectiveProgress({ workspaceId, objectiveId });

  assert.equal(result?.progressPercent, 50);
  assert.deepEqual(updates, [{
    workspaceId,
    objectiveId,
    progressPercent: 50,
    progressUpdatedAt: now
  }]);
});

test("R9.5 objective service falls back to linked work item completion when key results are absent", async () => {
  const updates: unknown[] = [];
  const service = createObjectiveService({
    objectives: {
      async readObjectiveProgressSnapshot() {
        return {
          objective,
          keyResults: [],
          linkedWorkItems: [
            { id: "97000000-0000-4000-8000-000000000021", status: "done" },
            { id: "97000000-0000-4000-8000-000000000022", status: "ai_working" }
          ],
          keyResultsCapped: false,
          workItemsCapped: false
        };
      },
      async updateObjectiveProgress(input: UpdateObjectiveProgressInput) {
        updates.push(input);
        return { ...objective, progressPercent: input.progressPercent, progressUpdatedAt: input.progressUpdatedAt };
      }
    } as unknown as ObjectiveRepository,
    now: () => now
  });

  const result = await service.refreshObjectiveProgress({ workspaceId, objectiveId });

  assert.equal(result?.progressPercent, 50);
  assert.equal((updates[0] as { progressPercent?: number }).progressPercent, 50);
});

// ── R23 F-01（OKR 列表/详情持久化）：GET /api/objectives/:id 路由级测试 ──────────────────────────
// 鉴权判定与既有 POST /api/objectives、POST /api/objectives/:id/link 同款：未登录 401、
// 工作区访问已被撤销 403（resolveHumanActor fail-closed，同 auth.test.ts 的镜像）。

function routeSettings(): Settings {
  return loadSettings({ APP_ENV: "test", COOKIE_SECRET: "r23-objective-route-secret" });
}

function routeUser(): UserAuthRow {
  return {
    id: routeUserId,
    nickname: "objective-route-tester",
    cookieToken: "cookie-objective-route-tester",
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

class RouteMemoryUsers implements UserRepository {
  async findActiveById(id: string) {
    return id === routeUserId ? routeUser() : null;
  }

  async findActiveByCookieToken(cookieToken: string) {
    return cookieToken === "cookie-objective-route-tester" ? routeUser() : null;
  }

  async findActiveByNickname() {
    return null;
  }

  async createUser(): Promise<UserAuthRow> {
    throw new Error("not needed");
  }

  async getOrCreateActiveByNickname(): Promise<{ user: UserAuthRow; created: boolean }> {
    throw new Error("not needed");
  }

  async rotateCookieToken() {
    return null;
  }
}

class RouteMemoryDevices implements ClientDeviceRepository {
  async findActiveByTokenHash() {
    return null;
  }

  async findActiveByTokenHashForUser() {
    return null;
  }

  async createClientDevice(): Promise<ClientDeviceAuthRow> {
    throw new Error("not needed");
  }

  async listByUser() {
    return [];
  }

  async touchLastSeen() {
    return null;
  }

  async revokeByIdForUser() {
    return null;
  }

  async revokeByTokenHash() {
    return null;
  }
}

// SEC-1（P0-01）fail-closed：resolveHumanActor 提供 memberships 仓库即为多租户路径——解析不到 active
// 成员行时不再回退默认工作区常量，而是抛 WorkspaceMemberServiceError(403, workspace_access_revoked)。
// 这个假仓库全员解析不到租户，专门复现「已被撤销工作区访问」的 403（镜像 auth.test.ts 的同款场景）。
class RouteMembershipsNoTenant implements WorkspaceMembershipRepository {
  async listForUser() {
    return [];
  }

  async findActiveForUserWorkspace() {
    return null;
  }

  async findSoftDeletedForUserWorkspace() {
    return null;
  }

  async resolveDefaultWorkspace() {
    return null;
  }

  async resolveDefaultTenant() {
    return null;
  }

  async create(): Promise<never> {
    throw new Error("not needed");
  }

  async softDelete() {
    return null;
  }

  async listActiveByWorkspace() {
    return [];
  }

  async listActiveWithNicknameByWorkspace() {
    return [];
  }

  async updateRole() {
    return null;
  }
}

function routeAuthDeps(runtimeSettings: Settings, options: { revoked?: boolean } = {}): AuthDependencies {
  return {
    users: new RouteMemoryUsers(),
    devices: new RouteMemoryDevices(),
    settings: runtimeSettings,
    now: () => now,
    ...(options.revoked ? { memberships: new RouteMembershipsNoTenant() } : {})
  };
}

async function routeCookie(runtimeSettings: Settings) {
  return generateSignedCookie(COOKIE_NAME, "cookie-objective-route-tester", runtimeSettings.auth.cookieSecret);
}

function routeWithErrors(app: Hono<AuthEnv>) {
  app.onError((error, c) => {
    if (error instanceof WorkspaceMemberServiceError) {
      return c.json({ ok: false, error: { code: error.code, message: error.message } }, error.status);
    }
    // GET /api/projects/:id/objectives 的 :id 格式校验复用 routes/projects.ts 既有的
    // requireProjectId（抛 ProjectServiceError 404，不是 objectives.ts 那条 HTTPException）。
    if (error instanceof ProjectServiceError) {
      return c.json({ ok: false, error: { code: error.code, message: error.message } }, error.status as 404);
    }
    if (error instanceof HTTPException) {
      return c.json({ ok: false, error: { code: httpErrorCodeFor(error), message: error.message } }, error.status);
    }
    throw error;
  });
  return app;
}

function fakeObjectiveService(overrides: Partial<ObjectiveService> = {}): ObjectiveService {
  return {
    async planningContextForWorkItem() {
      throw new Error("should not be called");
    },
    async refreshObjectiveProgress() {
      throw new Error("should not be called");
    },
    async createObjective() {
      throw new Error("should not be called");
    },
    async linkWorkItem() {
      throw new Error("should not be called");
    },
    async refreshWorkspaceObjectives() {
      throw new Error("should not be called");
    },
    async listObjectives() {
      throw new Error("should not be called");
    },
    async getObjective() {
      throw new Error("should not be called");
    },
    ...overrides
  };
}

function objectiveRouteApp(runtimeSettings: Settings, service: ObjectiveService) {
  const app = routeWithErrors(new Hono<AuthEnv>());
  app.route("/api/objectives", createObjectiveRoutes({ auth: routeAuthDeps(runtimeSettings), service, workItems: false }));
  return app;
}

const fullObjectiveDetail: ObjectiveDetailResult = {
  objective,
  keyResults: [keyResult],
  linkedWorkItems: [{ id: routeWorkItemId, code: "WI-9", title: "接入 R23 F-01", status: "ai_working" }],
  linkedTaskPlans: [{ id: routeTaskPlanId, workItemId: routeWorkItemId, status: "approved", createdAt: now }],
  keyResultsCapped: true,
  workItemsCapped: false,
  taskPlansCapped: true
};

test("GET /api/objectives/:id requires identity", async () => {
  const runtimeSettings = routeSettings();
  const app = objectiveRouteApp(runtimeSettings, fakeObjectiveService({
    async getObjective() {
      throw new Error("anonymous GET must not reach the service");
    }
  }));

  const response = await app.request(`/api/objectives/${objectiveId}`);

  assert.equal(response.status, 401);
});

test("GET /api/objectives/:id returns 403 once workspace access has been revoked", async () => {
  const runtimeSettings = routeSettings();
  const app = new Hono<AuthEnv>();
  routeWithErrors(app);
  app.route("/api/objectives", createObjectiveRoutes({
    auth: routeAuthDeps(runtimeSettings, { revoked: true }),
    service: fakeObjectiveService({
      async getObjective() {
        throw new Error("revoked actor must not reach the service");
      }
    }),
    workItems: false
  }));

  const response = await app.request(`/api/objectives/${objectiveId}`, {
    headers: { Cookie: await routeCookie(runtimeSettings) }
  });
  const body = await response.json() as { error: { code: string } };

  assert.equal(response.status, 403);
  assert.equal(body.error.code, "workspace_access_revoked");
});

test("GET /api/objectives/:id returns 404 for a malformed id without touching the service", async () => {
  const runtimeSettings = routeSettings();
  const app = objectiveRouteApp(runtimeSettings, fakeObjectiveService({
    async getObjective() {
      throw new Error("malformed id must not reach the service");
    }
  }));

  const response = await app.request("/api/objectives/not-a-uuid", {
    headers: { Cookie: await routeCookie(runtimeSettings) }
  });

  assert.equal(response.status, 404);
});

test("GET /api/objectives/:id returns 404 when the objective doesn't exist in the actor's workspace", async () => {
  const runtimeSettings = routeSettings();
  const app = objectiveRouteApp(runtimeSettings, fakeObjectiveService({
    async getObjective() {
      return null;
    }
  }));

  const response = await app.request(`/api/objectives/${objectiveId}`, {
    headers: { Cookie: await routeCookie(runtimeSettings) }
  });

  assert.equal(response.status, 404);
});

test("GET /api/objectives/:id maps the full detail (key results, linked work items, linked task plans) to snake_case with honest caps", async () => {
  const runtimeSettings = routeSettings();
  let seenInput: { workspaceId: string; objectiveId: string } | undefined;
  const app = objectiveRouteApp(runtimeSettings, fakeObjectiveService({
    async getObjective(input) {
      seenInput = input;
      return fullObjectiveDetail;
    }
  }));

  const response = await app.request(`/api/objectives/${objectiveId}`, {
    headers: { Cookie: await routeCookie(runtimeSettings) }
  });
  const body = await response.json() as {
    data: {
      objective_id: string;
      title: string;
      key_results: Array<{ id: string; seq: number }>;
      key_results_capped: boolean;
      linked_work_items: Array<{ id: string; code: string }>;
      linked_work_items_capped: boolean;
      linked_task_plans: Array<{ id: string; work_item_id: string }>;
      linked_task_plans_capped: boolean;
    };
  };

  assert.equal(response.status, 200);
  assert.deepEqual(seenInput, { workspaceId: runtimeSettings.auth.defaultWorkspaceId, objectiveId });
  assert.equal(body.data.objective_id, objectiveId);
  assert.equal(body.data.title, objective.title);
  assert.equal(body.data.key_results.length, 1);
  assert.equal(body.data.key_results[0]?.id, keyResult.id);
  assert.equal(body.data.key_results_capped, true);
  assert.equal(body.data.linked_work_items.length, 1);
  assert.equal(body.data.linked_work_items[0]?.code, "WI-9");
  assert.equal(body.data.linked_work_items_capped, false);
  assert.equal(body.data.linked_task_plans.length, 1);
  assert.equal(body.data.linked_task_plans[0]?.work_item_id, routeWorkItemId);
  assert.equal(body.data.linked_task_plans_capped, true);
});

type ListObjectivesForWorkspaceInput = Parameters<ObjectiveRepository["listObjectivesForWorkspace"]>[0];
type ReadObjectiveDetailInput = Parameters<ObjectiveRepository["readObjectiveDetail"]>[0];

test("R23 F-01 objective service list/detail wrappers delegate straight to the repository", async () => {
  const listResult: ObjectiveListResult = { items: [objective], capped: false };
  const calls: unknown[] = [];
  const service = createObjectiveService({
    objectives: {
      async listObjectivesForWorkspace(input: ListObjectivesForWorkspaceInput) {
        calls.push(["list", input]);
        return listResult;
      },
      async readObjectiveDetail(input: ReadObjectiveDetailInput) {
        calls.push(["detail", input]);
        return fullObjectiveDetail;
      }
    } as unknown as ObjectiveRepository
  });

  const list = await service.listObjectives({ workspaceId });
  const detail = await service.getObjective({ workspaceId, objectiveId });

  assert.equal(list, listResult);
  assert.equal(detail, fullObjectiveDetail);
  assert.deepEqual(calls, [
    ["list", { workspaceId }],
    ["detail", { workspaceId, objectiveId }]
  ]);
});

// ── R23 F-01：GET /api/projects/:id/objectives 路由级测试（同一路由文件，见 routes/projects.ts）──────
// 目标是工作区级实体，这条路由只按 :id 做格式校验（不做项目级过滤）——测试要证明这一点：调用
// objectives.listObjectives 时只带 workspaceId，不带任何 project 相关键。

function fakeListObjectivesOnly(overrides: Partial<Pick<ObjectiveService, "listObjectives">> = {}): Pick<ObjectiveService, "listObjectives"> {
  return {
    async listObjectives() {
      throw new Error("should not be called");
    },
    ...overrides
  };
}

function projectObjectivesRouteApp(runtimeSettings: Settings, objectives: Pick<ObjectiveService, "listObjectives">) {
  const app = routeWithErrors(new Hono<AuthEnv>());
  app.route("/api/projects", createProjectRoutes({ auth: routeAuthDeps(runtimeSettings), objectives }));
  return app;
}

test("GET /api/projects/:id/objectives requires identity", async () => {
  const runtimeSettings = routeSettings();
  const app = projectObjectivesRouteApp(runtimeSettings, fakeListObjectivesOnly({
    async listObjectives() {
      throw new Error("anonymous GET must not reach the service");
    }
  }));

  const response = await app.request(`/api/projects/${routeProjectId}/objectives`);

  assert.equal(response.status, 401);
});

test("GET /api/projects/:id/objectives returns 403 once workspace access has been revoked", async () => {
  const runtimeSettings = routeSettings();
  const app = routeWithErrors(new Hono<AuthEnv>());
  app.route("/api/projects", createProjectRoutes({
    auth: routeAuthDeps(runtimeSettings, { revoked: true }),
    objectives: fakeListObjectivesOnly({
      async listObjectives() {
        throw new Error("revoked actor must not reach the service");
      }
    })
  }));

  const response = await app.request(`/api/projects/${routeProjectId}/objectives`, {
    headers: { Cookie: await routeCookie(runtimeSettings) }
  });
  const body = await response.json() as { error: { code: string } };

  assert.equal(response.status, 403);
  assert.equal(body.error.code, "workspace_access_revoked");
});

test("GET /api/projects/:id/objectives rejects a non-uuid project id as 404 before the service", async () => {
  const runtimeSettings = routeSettings();
  const app = projectObjectivesRouteApp(runtimeSettings, fakeListObjectivesOnly({
    async listObjectives() {
      throw new Error("malformed project id must not reach the service");
    }
  }));

  const response = await app.request("/api/projects/not-a-uuid/objectives", {
    headers: { Cookie: await routeCookie(runtimeSettings) }
  });
  const body = await response.json() as { error: { code: string } };

  assert.equal(response.status, 404);
  assert.equal(body.error.code, "project_not_found");
});

test("GET /api/projects/:id/objectives returns an honest empty list", async () => {
  const runtimeSettings = routeSettings();
  let seenInput: { workspaceId: string } | undefined;
  const app = projectObjectivesRouteApp(runtimeSettings, fakeListObjectivesOnly({
    async listObjectives(input) {
      seenInput = input;
      return { items: [], capped: false };
    }
  }));

  const response = await app.request(`/api/projects/${routeProjectId}/objectives`, {
    headers: { Cookie: await routeCookie(runtimeSettings) }
  });
  const body = await response.json() as { data: { objectives: unknown[]; capped: boolean } };

  assert.equal(response.status, 200);
  assert.deepEqual(seenInput, { workspaceId: runtimeSettings.auth.defaultWorkspaceId });
  assert.deepEqual(body.data, { objectives: [], capped: false });
});

test("GET /api/projects/:id/objectives maps a capped workspace-wide list to snake_case (not project-scoped)", async () => {
  const runtimeSettings = routeSettings();
  const app = projectObjectivesRouteApp(runtimeSettings, fakeListObjectivesOnly({
    async listObjectives() {
      return { items: [objective, secondObjectiveRow], capped: true };
    }
  }));

  const response = await app.request(`/api/projects/${routeProjectId}/objectives`, {
    headers: { Cookie: await routeCookie(runtimeSettings) }
  });
  const body = await response.json() as {
    data: { objectives: Array<{ objective_id: string; title: string; status: string; updated_at: string }>; capped: boolean };
  };

  assert.equal(response.status, 200);
  assert.equal(body.data.objectives.length, 2);
  assert.equal(body.data.objectives[0]?.objective_id, objectiveId);
  assert.equal(body.data.objectives[0]?.title, objective.title);
  assert.equal(body.data.capped, true);
});
