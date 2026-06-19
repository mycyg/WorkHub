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
  UserRepository
} from "@workhub/db";

import { COOKIE_NAME, type AuthDependencies, type AuthEnv } from "./middleware/auth.js";
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
    if (error instanceof HTTPException) {
      return c.json({ ok: false, error: { code: "http_error", message: error.message } }, error.status);
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
  assert.equal(res.status, 404);
});
