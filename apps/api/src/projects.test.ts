import assert from "node:assert/strict";
import test from "node:test";

import { Hono } from "hono";
import { generateSignedCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";

import { loadSettings, type Settings } from "@workhub/config";
import {
  ProjectSlugOccupiedError,
  type ClientDeviceAuthRow,
  type ClientDeviceRepository,
  type ProjectRepository,
  type UserAuthRow,
  type UserRepository
} from "@workhub/db";

import { COOKIE_NAME, type AuthDependencies, type AuthEnv } from "./middleware/auth.js";
import { httpErrorCodeFor } from "./http-error-codes.js";
import { malformedJsonMessage } from "./routes/json-body.js";
import { createProjectRoutes } from "./routes/projects.js";
import {
  createProjectService,
  mainConversationTitleForLocale,
  ProjectServiceError,
  type ProjectService
} from "./services/projects.js";

const now = new Date("2026-06-13T00:00:00.000Z");
const userId = "62000000-0000-4000-8000-000000000001";

function settings(): Settings {
  return loadSettings({
    APP_ENV: "test",
    COOKIE_SECRET: "test-cookie-secret"
  });
}

function user(): UserAuthRow {
  return {
    id: userId,
    nickname: "day0-host",
    cookieToken: "cookie-day0-host",
    preferredLocale: "zh-CN",
    availabilityStatus: "free",
    availabilityText: null,
    availabilityUpdatedAt: null,
    mutedNotificationTypes: [],
    avatarWebp: null,
    avatarUpdatedAt: null,
    isAdmin: true,
    deletedAt: null,
    deletedByUserId: null,
    createdAt: now,
    updatedAt: now
  };
}

class MemoryUsers implements UserRepository {
  async findActiveById(id: string) {
    return id === userId ? user() : null;
  }

  async findActiveByCookieToken(cookieToken: string) {
    return cookieToken === "cookie-day0-host" ? user() : null;
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

class MemoryDevices implements ClientDeviceRepository {
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

function authDeps(runtimeSettings: Settings): AuthDependencies {
  return {
    users: new MemoryUsers(),
    devices: new MemoryDevices(),
    settings: runtimeSettings,
    now: () => now
  };
}

async function cookie(runtimeSettings: Settings) {
  return generateSignedCookie(COOKIE_NAME, "cookie-day0-host", runtimeSettings.auth.cookieSecret);
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

test("project bootstrap creates a Day0 project context for the current actor", async () => {
  const runtimeSettings = settings();
  let actorId = "";
  const projects: ProjectService = {
    async bootstrapProject(input) {
      actorId = input.actor.id;
      return {
        project: {
          id: "62000000-0000-4000-8000-000000000010",
          workspace_id: input.actor.workspaceId,
          name: input.payload.name ?? "Day 0 Pilot Project",
          slug: input.payload.slug ?? "day0-pilot",
          owner_nickname: input.actor.label,
          owner_user_id: input.actor.userId ?? null
        },
        created: true,
        context_ready: true
      };
    },
    async listProjects() {
      return { generated_at: now.toISOString(), projects: [] };
    },
    async createPersonalProject() {
      throw new Error("should not be called");
    },
    async listPersonalProjects() {
      throw new Error("should not be called");
    }
  };
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/projects", createProjectRoutes({
    auth: authDeps(runtimeSettings),
    projects
  }));

  const response = await app.request("/api/projects/bootstrap", {
    method: "POST",
    headers: { Cookie: await cookie(runtimeSettings) },
    body: JSON.stringify({ name: "Day 0 Pilot Project", slug: "day0-pilot" })
  });

  assert.equal(response.status, 201);
  assert.equal(actorId, userId);
  const body = await response.json() as { data: { project: { slug: string }; context_ready: boolean } };
  assert.equal(body.data.project.slug, "day0-pilot");
  assert.equal(body.data.context_ready, true);
});

test("project bootstrap is not available without identity", async () => {
  const runtimeSettings = settings();
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/projects", createProjectRoutes({
    auth: authDeps(runtimeSettings),
    projects: {
      async bootstrapProject() {
        throw new Error("should not be called");
      },
      async listProjects() {
        throw new Error("should not be called");
      },
      async createPersonalProject() {
        throw new Error("should not be called");
      },
      async listPersonalProjects() {
        throw new Error("should not be called");
      }
    }
  }));

  const response = await app.request("/api/projects/bootstrap", { method: "POST" });

  assert.equal(response.status, 401);
});

test("project bootstrap returns malformed_json for malformed request bodies", async () => {
  const runtimeSettings = settings();
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/projects", createProjectRoutes({
    auth: authDeps(runtimeSettings),
    projects: {
      async bootstrapProject() {
        throw new Error("bootstrapProject must not be reached for malformed JSON");
      },
      async listProjects() {
        throw new Error("should not be called");
      },
      async createPersonalProject() {
        throw new Error("should not be called");
      },
      async listPersonalProjects() {
        throw new Error("should not be called");
      }
    }
  }));

  const response = await app.request("/api/projects/bootstrap", {
    method: "POST",
    headers: { Cookie: await cookie(runtimeSettings), "Content-Type": "application/json" },
    body: "{"
  });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: {
      code: "malformed_json",
      message: malformedJsonMessage
    }
  });
});

test("project bootstrap rejects blank names and slugs before creating a default project", async () => {
  const runtimeSettings = settings();
  let bootstrapCalled = false;
  const projects: ProjectService = {
    async bootstrapProject() {
      bootstrapCalled = true;
      throw new Error("bootstrapProject must not be reached for blank project identifiers");
    },
    async listProjects() {
      return { generated_at: now.toISOString(), projects: [] };
    },
    async createPersonalProject() {
      throw new Error("should not be called");
    },
    async listPersonalProjects() {
      throw new Error("should not be called");
    }
  };
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/projects", createProjectRoutes({ auth: authDeps(runtimeSettings), projects }));

  const blankName = await app.request("/api/projects/bootstrap", {
    method: "POST",
    headers: { Cookie: await cookie(runtimeSettings), "Content-Type": "application/json" },
    body: JSON.stringify({ name: "   " })
  });
  const blankSlug = await app.request("/api/projects/bootstrap", {
    method: "POST",
    headers: { Cookie: await cookie(runtimeSettings), "Content-Type": "application/json" },
    body: JSON.stringify({ name: "真实项目", slug: "   " })
  });

  assert.equal(blankName.status, 422);
  assert.equal(blankSlug.status, 422);
  assert.equal(bootstrapCalled, false);
});

test("GET /api/projects preserves project service error codes", async () => {
  const runtimeSettings = settings();
  const projects: ProjectService = {
    async bootstrapProject() {
      throw new Error("should not be called");
    },
    async listProjects() {
      throw new ProjectServiceError(403, "project_forbidden", "你没有权限查看项目。");
    },
    async createPersonalProject() {
      throw new Error("should not be called");
    },
    async listPersonalProjects() {
      throw new Error("should not be called");
    }
  };
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/projects", createProjectRoutes({ auth: authDeps(runtimeSettings), projects }));

  const response = await app.request("/api/projects", {
    headers: { Cookie: await cookie(runtimeSettings) }
  });
  const body = await response.json() as { ok: false; error: { code: string; message: string } };

  assert.equal(response.status, 403);
  assert.equal(body.error.code, "project_forbidden");
  assert.equal(body.error.message, "你没有权限查看项目。");
});

test("GET /api/projects lists the current actor's projects with open work item counts", async () => {
  const runtimeSettings = settings();
  let listedWorkspaceId = "";
  const projects: ProjectService = {
    async bootstrapProject() {
      throw new Error("should not be called");
    },
    async listProjects(input) {
      listedWorkspaceId = input.actor.workspaceId;
      return {
        generated_at: now.toISOString(),
        projects: [
          {
            id: "62000000-0000-4000-8000-000000000020",
            workspace_id: input.actor.workspaceId,
            name: "渠道增长",
            slug: "growth",
            owner_nickname: input.actor.label,
            owner_user_id: input.actor.userId ?? null,
            archived: false,
            created_at: now.toISOString(),
            updated_at: now.toISOString(),
            open_work_item_count: 3
          }
        ]
      };
    },
    async createPersonalProject() {
      throw new Error("should not be called");
    },
    async listPersonalProjects() {
      throw new Error("should not be called");
    }
  };
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/projects", createProjectRoutes({ auth: authDeps(runtimeSettings), projects }));

  const response = await app.request("/api/projects", {
    headers: { Cookie: await cookie(runtimeSettings) }
  });

  assert.equal(response.status, 200);
  assert.notEqual(listedWorkspaceId, "");
  const body = await response.json() as { data: { projects: Array<{ slug: string; open_work_item_count: number }> } };
  assert.equal(body.data.projects.length, 1);
  assert.equal(body.data.projects[0]?.slug, "growth");
  assert.equal(body.data.projects[0]?.open_work_item_count, 3);
});

test("GET /api/projects requires identity", async () => {
  const runtimeSettings = settings();
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/projects", createProjectRoutes({
    auth: authDeps(runtimeSettings),
    projects: {
      async bootstrapProject() {
        throw new Error("should not be called");
      },
      async listProjects() {
        throw new Error("should not be called");
      },
      async createPersonalProject() {
        throw new Error("should not be called");
      },
      async listPersonalProjects() {
        throw new Error("should not be called");
      }
    }
  }));

  const response = await app.request("/api/projects");

  assert.equal(response.status, 401);
});

test("project bootstrap derives a stable slug for repeated non-ascii project names", async () => {
  const seenSlugs: string[] = [];
  const createdBySlug = new Map<string, boolean>();
  const repository: ProjectRepository = {
    async bootstrapPilotProject(input) {
      seenSlugs.push(input.slug);
      const created = !createdBySlug.has(input.slug);
      createdBySlug.set(input.slug, true);
      return {
        created,
        project: {
          id: `62000000-0000-4000-8000-${String(createdBySlug.size).padStart(12, "0")}`,
          workspaceId: input.workspaceId,
          name: input.name,
          slug: input.slug,
          description: input.description ?? null,
          ownerNickname: input.ownerNickname,
          ownerUserId: input.ownerUserId
        } as Awaited<ReturnType<ProjectRepository["bootstrapPilotProject"]>>["project"]
      };
    },
    async listForWorkspace() {
      return [];
    },
    async bootstrapPersonalProject() {
      throw new Error("not needed for this test");
    },
    async listPersonalForUser() {
      return [];
    },
    async updateInstructions() {
      throw new Error("not needed for this test");
    },
    async archiveProject() {
      throw new Error("not needed for this test");
    },
    async softDeleteProject() {
      throw new Error("not needed for this test");
    }
  };
  const service = createProjectService(repository, { settings: settings(), now: () => now });

  const first = await service.bootstrapProject({
    actor: {
      kind: "human",
      id: userId,
      label: "day0-host",
      userId,
      isAdmin: true,
      orgId: "00000000-0000-4000-8000-000000000001",
      workspaceId: "00000000-0000-4000-8000-000000000002"
    },
    payload: { name: "真实项目" }
  });
  const retry = await service.bootstrapProject({
    actor: {
      kind: "human",
      id: userId,
      label: "day0-host",
      userId,
      isAdmin: true,
      orgId: "00000000-0000-4000-8000-000000000001",
      workspaceId: "00000000-0000-4000-8000-000000000002"
    },
    payload: { name: "真实项目" }
  });

  assert.equal(seenSlugs.length, 2);
  assert.equal(seenSlugs[0], seenSlugs[1], "retrying the same Chinese name should hit the same project slug");
  assert.match(seenSlugs[0] ?? "", /^project-[a-f0-9]{8}$/u);
  assert.equal(first.created, true);
  assert.equal(retry.created, false);
});

test("project bootstrap maps archived/deleted slug occupancy to a recoverable conflict", async () => {
  const repository: ProjectRepository = {
    async bootstrapPilotProject() {
      throw new ProjectSlugOccupiedError("archived-project");
    },
    async listForWorkspace() {
      return [];
    },
    async bootstrapPersonalProject() {
      throw new Error("not needed for this test");
    },
    async listPersonalForUser() {
      return [];
    },
    async updateInstructions() {
      throw new Error("not needed for this test");
    },
    async archiveProject() {
      throw new Error("not needed for this test");
    },
    async softDeleteProject() {
      throw new Error("not needed for this test");
    }
  };
  const service = createProjectService(repository, { settings: settings(), now: () => now });

  await assert.rejects(
    () => service.bootstrapProject({
      actor: {
        kind: "human",
        id: userId,
        label: "day0-host",
        userId,
        isAdmin: true,
        orgId: "00000000-0000-4000-8000-000000000001",
        workspaceId: "00000000-0000-4000-8000-000000000002"
      },
      payload: { name: "Archived Project", slug: "archived-project" }
    }),
    (error: unknown) => error instanceof ProjectServiceError
      && error.status === 409
      && error.code === "project_slug_occupied"
  );
});

// R24-K（S5-N-06）：英文界面下工作台侧栏那一行「主区」是整窗唯一的中文——服务端建项目时把内置会话
// 标题写死了。主区不可改名（conversation-rename 对 kind='main' 一律 403），所以这就是个纯展示常量，
// 按建项目那一刻的语言给出。
test("the built-in main conversation is named in the creator's language", async () => {
  const titles: Array<string | undefined> = [];
  const repository: ProjectRepository = {
    async bootstrapPilotProject(input) {
      titles.push(input.mainConversationTitle);
      return {
        created: true,
        project: {
          id: "62000000-0000-4000-8000-000000000021",
          workspaceId: input.workspaceId,
          name: input.name,
          slug: input.slug,
          description: input.description ?? null,
          ownerNickname: input.ownerNickname,
          ownerUserId: input.ownerUserId
        } as Awaited<ReturnType<ProjectRepository["bootstrapPilotProject"]>>["project"]
      };
    },
    async listForWorkspace() {
      return [];
    },
    async bootstrapPersonalProject(input) {
      titles.push(input.mainConversationTitle);
      return {
        created: true,
        project: {
          id: "62000000-0000-4000-8000-000000000022",
          workspaceId: input.workspaceId,
          name: input.name,
          slug: input.slug,
          description: null,
          ownerNickname: input.ownerNickname,
          ownerUserId: input.ownerUserId,
          isPersonal: true
        } as Awaited<ReturnType<ProjectRepository["bootstrapPersonalProject"]>>["project"]
      };
    },
    async listPersonalForUser() {
      return [];
    },
    async updateInstructions() {
      throw new Error("not needed for this test");
    },
    async archiveProject() {
      throw new Error("not needed for this test");
    },
    async softDeleteProject() {
      throw new Error("not needed for this test");
    }
  };
  const service = createProjectService(repository, { settings: settings(), now: () => now });
  const actor = {
    kind: "human" as const,
    id: userId,
    label: "day0-host",
    userId,
    isAdmin: true,
    orgId: "00000000-0000-4000-8000-000000000001",
    workspaceId: "00000000-0000-4000-8000-000000000002"
  };

  await service.bootstrapProject({ actor, payload: { name: "English project" }, locale: "en-US" });
  await service.bootstrapProject({ actor, payload: { name: "中文项目" }, locale: "zh-CN" });
  // 不传 locale 的既有调用方保持中文，不会因为这次改动悄悄换语言。
  await service.bootstrapProject({ actor, payload: { name: "默认项目" } });
  // 个人空间走同一条命名。
  await service.createPersonalProject({ actor, payload: {}, locale: "en-US" });

  assert.deepEqual(titles, ["Main", "主区", "主区", "Main"]);
  assert.equal(mainConversationTitleForLocale("en-US"), "Main");
  assert.equal(mainConversationTitleForLocale("zh-CN"), "主区");
  assert.equal(mainConversationTitleForLocale(undefined), "主区");
});

// 桌面端建项目不带 locale 参数，靠的是建号时存下的 preferred_locale；显式 `?locale=` 仍最优先。
test("project bootstrap resolves its locale from the query first and the stored user preference next", async () => {
  const runtimeSettings = settings();
  const seen: Array<string | undefined> = [];
  const projects: ProjectService = {
    async bootstrapProject(input) {
      seen.push(input.locale);
      return {
        project: {
          id: "62000000-0000-4000-8000-000000000010",
          workspace_id: input.actor.workspaceId,
          name: input.payload.name ?? "Day 0 Pilot Project",
          slug: input.payload.slug ?? "day0-pilot",
          owner_nickname: input.actor.label,
          owner_user_id: input.actor.userId ?? null
        },
        created: true,
        context_ready: true
      };
    },
    async listProjects() {
      return { generated_at: now.toISOString(), projects: [] };
    },
    async createPersonalProject() {
      throw new Error("should not be called");
    },
    async listPersonalProjects() {
      throw new Error("should not be called");
    }
  };
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/projects", createProjectRoutes({ auth: authDeps(runtimeSettings), projects }));
  const headers = { Cookie: await cookie(runtimeSettings) };

  await app.request("/api/projects/bootstrap?locale=en-US", {
    method: "POST",
    headers,
    body: JSON.stringify({ name: "One" })
  });
  // 无 query：落到夹具用户的 preferred_locale（zh-CN），Accept-Language 说英文也压不过它。
  await app.request("/api/projects/bootstrap", {
    method: "POST",
    headers: { ...headers, "Accept-Language": "en-US,en;q=0.9" },
    body: JSON.stringify({ name: "Two" })
  });

  assert.deepEqual(seen, ["en-US", "zh-CN"]);
});
