import assert from "node:assert/strict";
import test from "node:test";

import { Hono } from "hono";
import { generateSignedCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";

import { loadSettings, type Settings } from "@workhub/config";
import type { ClientDeviceAuthRow, ClientDeviceRepository, UserAuthRow, UserRepository } from "@workhub/db";

import { COOKIE_NAME, type AuthDependencies, type AuthEnv } from "./middleware/auth.js";
import { httpErrorCodeFor } from "./http-error-codes.js";
import { malformedJsonMessage } from "./routes/json-body.js";
import { createPersonalProjectRoutes } from "./routes/personal-projects.js";
import { ProjectServiceError, type ProjectService } from "./services/projects.js";

// R13 批 S3（个人空间）：这个路由器故意没有被 app.ts 挂载（见 routes/personal-projects.ts 顶部的
// 挂载清单批注）——本文件像既有 projects.test.ts 一样，自己拼一个最小 Hono app 直接测路由行为，
// 不依赖它出现在 app.test.ts 的运行时路由树里。

const now = new Date("2026-07-13T00:00:00.000Z");
const userId = "63000000-0000-4000-8000-000000000001";

function settings(): Settings {
  return loadSettings({
    APP_ENV: "test",
    COOKIE_SECRET: "test-cookie-secret"
  });
}

function user(): UserAuthRow {
  return {
    id: userId,
    nickname: "personal-space-host",
    cookieToken: "cookie-personal-space-host",
    preferredLocale: "zh-CN",
    availabilityStatus: "free",
    availabilityText: null,
    availabilityUpdatedAt: null,
    mutedNotificationTypes: [],
    isAdmin: false,
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
    return cookieToken === "cookie-personal-space-host" ? user() : null;
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
  return generateSignedCookie(COOKIE_NAME, "cookie-personal-space-host", runtimeSettings.auth.cookieSecret);
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

test("POST /api/me/personal-projects creates a personal space for the current actor", async () => {
  const runtimeSettings = settings();
  let sawActorId = "";
  let sawName: string | undefined;
  const projects: ProjectService = {
    async bootstrapProject() {
      throw new Error("should not be called");
    },
    async listProjects() {
      throw new Error("should not be called");
    },
    async createPersonalProject(input) {
      sawActorId = input.actor.id;
      sawName = input.payload.name;
      return {
        project: {
          id: "63000000-0000-4000-8000-000000000010",
          workspace_id: input.actor.workspaceId,
          name: input.payload.name ?? "我的空间",
          slug: "personal-slug",
          owner_nickname: input.actor.label,
          owner_user_id: input.actor.userId ?? null,
          is_personal: true
        },
        created: true,
        context_ready: true
      };
    },
    async listPersonalProjects() {
      throw new Error("should not be called");
    }
  };
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api", createPersonalProjectRoutes({ auth: authDeps(runtimeSettings), projects }));

  const response = await app.request("/api/me/personal-projects", {
    method: "POST",
    headers: { Cookie: await cookie(runtimeSettings), "Content-Type": "application/json" },
    body: JSON.stringify({ name: "读论文" })
  });

  assert.equal(response.status, 201);
  assert.equal(sawActorId, userId);
  assert.equal(sawName, "读论文");
  const body = await response.json() as { data: { project: { name: string; is_personal?: boolean } } };
  assert.equal(body.data.project.name, "读论文");
  assert.equal(body.data.project.is_personal, true);
});

test("POST /api/me/personal-projects accepts an omitted name (server auto-names it)", async () => {
  const runtimeSettings = settings();
  let sawName: string | undefined = "unset";
  const projects: ProjectService = {
    async bootstrapProject() {
      throw new Error("should not be called");
    },
    async listProjects() {
      throw new Error("should not be called");
    },
    async createPersonalProject(input) {
      sawName = input.payload.name;
      return {
        project: {
          id: "63000000-0000-4000-8000-000000000011",
          workspace_id: input.actor.workspaceId,
          name: "我的空间",
          slug: "personal-slug-2",
          owner_nickname: input.actor.label,
          owner_user_id: input.actor.userId ?? null,
          is_personal: true
        },
        created: true,
        context_ready: true
      };
    },
    async listPersonalProjects() {
      throw new Error("should not be called");
    }
  };
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api", createPersonalProjectRoutes({ auth: authDeps(runtimeSettings), projects }));

  const response = await app.request("/api/me/personal-projects", {
    method: "POST",
    headers: { Cookie: await cookie(runtimeSettings) }
  });

  assert.equal(response.status, 201);
  assert.equal(sawName, undefined);
  const body = await response.json() as { data: { project: { name: string } } };
  assert.equal(body.data.project.name, "我的空间");
});

test("POST /api/me/personal-projects requires identity", async () => {
  const runtimeSettings = settings();
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api", createPersonalProjectRoutes({
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

  const response = await app.request("/api/me/personal-projects", { method: "POST" });

  assert.equal(response.status, 401);
});

test("GET /api/me/personal-projects lists only the current actor's personal spaces", async () => {
  const runtimeSettings = settings();
  let listedActorId = "";
  const projects: ProjectService = {
    async bootstrapProject() {
      throw new Error("should not be called");
    },
    async listProjects() {
      throw new Error("should not be called");
    },
    async createPersonalProject() {
      throw new Error("should not be called");
    },
    async listPersonalProjects(input) {
      listedActorId = input.actor.id;
      return {
        generated_at: now.toISOString(),
        projects: [
          {
            id: "63000000-0000-4000-8000-000000000020",
            workspace_id: input.actor.workspaceId,
            name: "我的空间",
            slug: "personal-slug",
            owner_nickname: input.actor.label,
            owner_user_id: input.actor.userId ?? null,
            is_personal: true,
            archived: false,
            created_at: now.toISOString(),
            updated_at: now.toISOString(),
            open_work_item_count: 0
          }
        ]
      };
    }
  };
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api", createPersonalProjectRoutes({ auth: authDeps(runtimeSettings), projects }));

  const response = await app.request("/api/me/personal-projects", {
    headers: { Cookie: await cookie(runtimeSettings) }
  });

  assert.equal(response.status, 200);
  assert.equal(listedActorId, userId);
  const body = await response.json() as { data: { projects: Array<{ is_personal?: boolean }> } };
  assert.equal(body.data.projects.length, 1);
  assert.equal(body.data.projects[0]?.is_personal, true);
});

test("GET /api/me/personal-projects requires identity", async () => {
  const runtimeSettings = settings();
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api", createPersonalProjectRoutes({
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

  const response = await app.request("/api/me/personal-projects");

  assert.equal(response.status, 401);
});

test("personal-project routes surface project service error codes", async () => {
  const runtimeSettings = settings();
  const projects: ProjectService = {
    async bootstrapProject() {
      throw new Error("should not be called");
    },
    async listProjects() {
      throw new Error("should not be called");
    },
    async createPersonalProject() {
      throw new ProjectServiceError(409, "project_slug_occupied", "这个个人空间暂时创建失败，请重试。");
    },
    async listPersonalProjects() {
      throw new Error("should not be called");
    }
  };
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api", createPersonalProjectRoutes({ auth: authDeps(runtimeSettings), projects }));

  const response = await app.request("/api/me/personal-projects", {
    method: "POST",
    headers: { Cookie: await cookie(runtimeSettings), "Content-Type": "application/json" },
    body: "{}"
  });
  const body = await response.json() as { ok: false; error: { code: string } };

  assert.equal(response.status, 409);
  assert.equal(body.error.code, "project_slug_occupied");
});

test("POST /api/me/personal-projects returns malformed_json for malformed request bodies", async () => {
  const runtimeSettings = settings();
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api", createPersonalProjectRoutes({
    auth: authDeps(runtimeSettings),
    projects: {
      async bootstrapProject() {
        throw new Error("should not be called");
      },
      async listProjects() {
        throw new Error("should not be called");
      },
      async createPersonalProject() {
        throw new Error("createPersonalProject must not be reached for malformed JSON");
      },
      async listPersonalProjects() {
        throw new Error("should not be called");
      }
    }
  }));

  const response = await app.request("/api/me/personal-projects", {
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
