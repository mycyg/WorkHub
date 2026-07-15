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
import { createNotificationRoutes } from "./routes/notifications.js";
import { NotificationServiceError, type NotificationService } from "./services/notifications.js";

const now = new Date("2026-06-19T00:00:00.000Z");
const userId = "91000000-0000-4000-8000-000000000001";

function user(): UserAuthRow {
  return {
    id: userId,
    nickname: "notif-reader",
    cookieToken: "cookie-notif-reader",
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
  async findActiveById(id: string) {
    return id === userId ? user() : null;
  }

  async findActiveByCookieToken(cookieToken: string) {
    return cookieToken === "cookie-notif-reader" ? user() : null;
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
  return generateSignedCookie(COOKIE_NAME, "cookie-notif-reader", runtimeSettings.auth.cookieSecret);
}

// 复用产线 onError 中通知/HTTPException 的状态映射，让 404 能被断言到。
function withErrors(app: Hono<AuthEnv>) {
  app.onError((error, c) => {
    if (error instanceof ZodError) {
      return c.json({ ok: false, error: { code: "validation_error", message: "invalid payload" } }, 422);
    }
    if (error instanceof NotificationServiceError) {
      return c.json({ ok: false, error: { code: error.code, message: error.message } }, error.status as 400);
    }
    if (error instanceof HTTPException) {
      return c.json({ ok: false, error: { code: httpErrorCodeFor(error), message: error.message } }, error.status);
    }
    throw error;
  });
  return app;
}

// 命中即抛——证明 uuid 守卫在到达通知服务（→ DB uuid 列）之前就以 404 短路了。
function serviceThatMustNotBeReached(): NotificationService {
  const fail = () => {
    throw new Error("notification service must not be reached for a malformed uuid path id");
  };
  return {
    listForUser: fail,
    getPreferences: fail,
    setPreferences: fail,
    markRead: fail,
    markAllRead: fail,
    dismiss: fail,
    complete: fail,
    createNotification: fail,
    createMentionNotification: fail,
    notifyMilestone: fail
  } as unknown as NotificationService;
}

test("R3 guard: POST /:id/read with a non-uuid id yields 404 (not a 500 from PG 22P02) before the service", async () => {
  const runtimeSettings = settings();
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/notifications", createNotificationRoutes({
    auth: authDeps(runtimeSettings),
    service: serviceThatMustNotBeReached()
  }));

  const res = await app.request("/api/notifications/not-a-uuid/read", {
    method: "POST",
    headers: { Cookie: await cookie(runtimeSettings) }
  });
  assert.equal(res.status, 404);
});

test("R3 guard: a genuinely-missing notification still surfaces the service's 404 (same status as malformed)", async () => {
  const runtimeSettings = settings();
  const app = withErrors(new Hono<AuthEnv>());
  // 合法但不存在的 uuid → 服务抛 404；与非法 uuid 同状态，攻击者无法据此区分存在性。
  const service = {
    ...serviceThatMustNotBeReached(),
    async markRead() {
      throw new NotificationServiceError(404, "not_found", "没有找到这条通知。");
    }
  } as unknown as NotificationService;
  app.route("/api/notifications", createNotificationRoutes({
    auth: authDeps(runtimeSettings),
    service
  }));

  const res = await app.request("/api/notifications/91000000-0000-4000-8000-0000000000ff/read", {
    method: "POST",
    headers: { Cookie: await cookie(runtimeSettings) }
  });
  const body = await res.json() as { ok: false; error: { code: string; message: string } };
  assert.equal(res.status, 404);
  assert.equal(body.error.code, "not_found");
  assert.equal(body.error.message, "没有找到这条通知。");
});

test("raw notification list route passes actor context for work item link filtering", async () => {
  const runtimeSettings = settings();
  let received: unknown;
  const service = {
    ...serviceThatMustNotBeReached(),
    async listForUser(input: unknown) {
      received = input;
      return { items: [], counts: { unread: 0, total: 0 } };
    }
  } as unknown as NotificationService;
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/notifications", createNotificationRoutes({
    auth: authDeps(runtimeSettings),
    service
  }));

  const res = await app.request("/api/notifications", {
    headers: { Cookie: await cookie(runtimeSettings) }
  });

  assert.equal(res.status, 200);
  assert.equal(typeof received, "object");
  assert.equal((received as { userId?: string }).userId, userId);
  assert.equal((received as { actor?: { userId?: string } }).actor?.userId, userId);
});

test("notification mutation routes pass actor context for work item visibility checks", async () => {
  const runtimeSettings = settings();
  const notificationId = "91000000-0000-4000-8000-0000000000ff";
  const notification = {
    id: notificationId,
    user_id: userId,
    type: "system.notice",
    severity: "normal",
    title: "通知",
    created_at: now.toISOString(),
    updated_at: now.toISOString()
  };
  const received: Record<string, unknown> = {};
  const service = {
    ...serviceThatMustNotBeReached(),
    async markRead(_id: string, _userId: string, options?: unknown) {
      received.markRead = options;
      return notification;
    },
    async markAllRead(_userId: string, options?: unknown) {
      received.markAllRead = options;
      return { updated: 0 };
    },
    async dismiss(_id: string, _userId: string, options?: unknown) {
      received.dismiss = options;
      return notification;
    },
    async complete(_id: string, _userId: string, options?: unknown) {
      received.complete = options;
      return notification;
    },
    async snooze(_id: string, _userId: string, options?: unknown) {
      received.snooze = options;
      return notification;
    }
  } as unknown as NotificationService;
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/notifications", createNotificationRoutes({
    auth: authDeps(runtimeSettings),
    service
  }));

  const headers = { Cookie: await cookie(runtimeSettings) };
  assert.equal((await app.request(`/api/notifications/${notificationId}/read`, { method: "POST", headers })).status, 200);
  assert.equal((await app.request("/api/notifications/read-all", { method: "POST", headers })).status, 200);
  assert.equal((await app.request(`/api/notifications/${notificationId}/dismiss`, { method: "POST", headers })).status, 200);
  assert.equal((await app.request(`/api/notifications/${notificationId}/complete`, { method: "POST", headers })).status, 200);
  assert.equal((await app.request(`/api/notifications/${notificationId}/snooze`, { method: "POST", headers })).status, 200);

  assert.equal((received.markRead as { actor?: { userId?: string } } | undefined)?.actor?.userId, userId);
  assert.equal((received.markAllRead as { actor?: { userId?: string } } | undefined)?.actor?.userId, userId);
  assert.equal((received.dismiss as { actor?: { userId?: string } } | undefined)?.actor?.userId, userId);
  assert.equal((received.complete as { actor?: { userId?: string } } | undefined)?.actor?.userId, userId);
  assert.equal((received.snooze as { actor?: { userId?: string } } | undefined)?.actor?.userId, userId);
});

test("notification preferences route returns malformed_json for malformed request bodies", async () => {
  const runtimeSettings = settings();
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/notifications", createNotificationRoutes({
    auth: authDeps(runtimeSettings),
    service: serviceThatMustNotBeReached()
  }));

  const res = await app.request("/api/notifications/preferences", {
    method: "PUT",
    headers: {
      Cookie: await cookie(runtimeSettings),
      "Content-Type": "application/json"
    },
    body: "{"
  });

  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), {
    ok: false,
    error: {
      code: "malformed_json",
      message: malformedJsonMessage
    }
  });
});

test("notification preferences route returns validation_error for semantic payload mistakes", async () => {
  const runtimeSettings = settings();
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/notifications", createNotificationRoutes({
    auth: authDeps(runtimeSettings),
    service: serviceThatMustNotBeReached()
  }));

  const res = await app.request("/api/notifications/preferences", {
    method: "PUT",
    headers: {
      Cookie: await cookie(runtimeSettings),
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ muted_notification_types: [42] })
  });

  assert.equal(res.status, 422);
  const body = await res.json() as { ok: false; error: { code: string } };
  assert.equal(body.error.code, "validation_error");
});
