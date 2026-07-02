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
import { malformedJsonMessage } from "./routes/json-body.js";
import { createKnowledgeRoutes } from "./routes/knowledge.js";
import { WorkItemServiceError, type WorkItemService } from "./services/work-items.js";

const now = new Date("2026-06-29T00:00:00.000Z");
const userId = "17000000-0000-4000-8000-000000000001";

function user(): UserAuthRow {
  return {
    id: userId,
    nickname: "knowledge-user",
    cookieToken: "cookie-knowledge-user",
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
    return cookieToken === "cookie-knowledge-user" ? user() : null;
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

function settings(): Settings {
  return loadSettings({
    APP_ENV: "test",
    COOKIE_SECRET: "test-cookie-secret"
  });
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
  return generateSignedCookie(COOKIE_NAME, "cookie-knowledge-user", runtimeSettings.auth.cookieSecret);
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

test("knowledge search route preserves WorkItem service error codes", async () => {
  const runtimeSettings = settings();
  const workItems = {
    async searchKnowledge() {
      throw new WorkItemServiceError(403, "forbidden", "你没有权限检索这个项目。");
    }
  } as unknown as WorkItemService;
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/knowledge", createKnowledgeRoutes({ auth: authDeps(runtimeSettings), workItems }));

  const response = await app.request("/api/knowledge/search", {
    method: "POST",
    headers: { Cookie: await cookie(runtimeSettings), "Content-Type": "application/json" },
    body: JSON.stringify({ query: "验收材料" })
  });

  assert.equal(response.status, 403);
  const body = await response.json() as { error: { code: string; message: string } };
  assert.equal(body.error.code, "forbidden");
  assert.match(body.error.message, /权限/u);
});

test("knowledge search checks work item access before unrelated schema errors", async () => {
  const runtimeSettings = settings();
  let searched = false;
  const workItemId = "17000000-0000-4000-8000-0000000000aa";
  const workItems = {
    async detailPage(input: Parameters<WorkItemService["detailPage"]>[0]) {
      assert.equal(input.workItemId, workItemId);
      throw new WorkItemServiceError(403, "forbidden", "你没有权限检索这个事项。");
    },
    async searchKnowledge() {
      searched = true;
      throw new Error("searchKnowledge must not be reached before the work item access gate");
    }
  } as unknown as WorkItemService;
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/knowledge", createKnowledgeRoutes({ auth: authDeps(runtimeSettings), workItems }));

  const response = await app.request("/api/knowledge/search", {
    method: "POST",
    headers: { Cookie: await cookie(runtimeSettings), "Content-Type": "application/json" },
    body: JSON.stringify({
      work_item_id: workItemId,
      limit: "not-a-number"
    })
  });

  assert.equal(response.status, 403);
  const body = await response.json() as { error: { code: string; message: string } };
  assert.equal(body.error.code, "forbidden");
  assert.match(body.error.message, /事项/u);
  assert.equal(searched, false);
});

test("knowledge search validates malformed work item ids before touching the work item service", async () => {
  const runtimeSettings = settings();
  let detailPageCalled = false;
  let searched = false;
  const workItems = {
    async detailPage() {
      detailPageCalled = true;
      throw new WorkItemServiceError(500, "db_uuid_error", "uuid cast failed");
    },
    async searchKnowledge() {
      searched = true;
      throw new Error("searchKnowledge must not be reached for an invalid work_item_id");
    }
  } as unknown as WorkItemService;
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/knowledge", createKnowledgeRoutes({ auth: authDeps(runtimeSettings), workItems }));

  const response = await app.request("/api/knowledge/search", {
    method: "POST",
    headers: { Cookie: await cookie(runtimeSettings), "Content-Type": "application/json" },
    body: JSON.stringify({
      query: "验收材料",
      work_item_id: "not-a-uuid"
    })
  });

  assert.equal(response.status, 422);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: {
      code: "validation_error",
      message: "invalid payload"
    }
  });
  assert.equal(detailPageCalled, false);
  assert.equal(searched, false);
});

test("knowledge search route returns malformed_json for malformed request bodies", async () => {
  const runtimeSettings = settings();
  const app = withErrors(new Hono<AuthEnv>());
  const workItems = {
    async searchKnowledge() {
      throw new Error("searchKnowledge must not be reached for malformed JSON");
    }
  } as unknown as WorkItemService;
  app.route("/api/knowledge", createKnowledgeRoutes({ auth: authDeps(runtimeSettings), workItems }));

  const response = await app.request("/api/knowledge/search", {
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
