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
import { httpErrorCodeFor } from "./http-error-codes.js";
import { createPilotRoutes } from "./routes/pilot.js";
import {
  PilotDay1MetricsServiceError,
  type PilotDay1MetricsService
} from "./services/pilot-day1-metrics.js";

const now = new Date("2026-06-13T00:00:00.000Z");
const userId = "72000000-0000-4000-8000-000000000001";

function settings(): Settings {
  return loadSettings({
    APP_ENV: "test",
    COOKIE_SECRET: "test-cookie-secret"
  });
}

function user(): UserAuthRow {
  return {
    id: userId,
    nickname: "pilot-host",
    cookieToken: "cookie-pilot-host",
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
    return cookieToken === "cookie-pilot-host" ? user() : null;
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
  return generateSignedCookie(COOKIE_NAME, "cookie-pilot-host", runtimeSettings.auth.cookieSecret);
}

function withErrors(app: Hono<AuthEnv>) {
  app.onError((error, c) => {
    if (error instanceof PilotDay1MetricsServiceError) {
      return c.json({ ok: false, error: { code: error.code, message: error.message } }, error.status as 400);
    }
    if (error instanceof HTTPException) {
      return c.json({ ok: false, error: { code: httpErrorCodeFor(error), message: error.message } }, error.status);
    }
    throw error;
  });
  return app;
}

test("pilot day1 metrics route preserves service error codes", async () => {
  const runtimeSettings = settings();
  const metrics: PilotDay1MetricsService = {
    async snapshot() {
      throw new PilotDay1MetricsServiceError(422, "invalid_range", "from must be before to.");
    }
  };
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/pilot", createPilotRoutes({ auth: authDeps(runtimeSettings), metrics }));

  const response = await app.request("/api/pilot/day1/metrics", {
    headers: { Cookie: await cookie(runtimeSettings) }
  });
  const body = await response.json() as { ok: false; error: { code: string; message: string } };

  assert.equal(response.status, 422);
  assert.equal(body.error.code, "invalid_range");
  assert.equal(body.error.message, "from must be before to.");
});

test("pilot day1 metrics route rejects date-only ranges before calling metrics", async () => {
  const runtimeSettings = settings();
  let calls = 0;
  const metrics: PilotDay1MetricsService = {
    async snapshot() {
      calls += 1;
      throw new Error("should not call metrics with invalid date query");
    }
  };
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/pilot", createPilotRoutes({ auth: authDeps(runtimeSettings), metrics }));

  const response = await app.request("/api/pilot/day1/metrics?from=2026-06-13&to=2026-06-14T00:00:00.000Z", {
    headers: { Cookie: await cookie(runtimeSettings) }
  });
  const body = await response.json() as { ok: false; error: { code: string; message: string } };

  assert.equal(response.status, 422);
  assert.equal(body.error.code, "validation_error");
  assert.equal(body.error.message, "from must be an ISO datetime.");
  assert.equal(calls, 0);
});
