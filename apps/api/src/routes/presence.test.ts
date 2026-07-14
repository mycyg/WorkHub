import assert from "node:assert/strict";
import test from "node:test";

import { Hono } from "hono";
import { generateSignedCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";

import { loadSettings, type Settings } from "@workhub/config";
import type { ClientDeviceAuthRow, ClientDeviceRepository, UserAuthRow, UserRepository } from "@workhub/db";

import { httpErrorCodeFor } from "../http-error-codes.js";
import { COOKIE_NAME, type AuthDependencies, type AuthEnv } from "../middleware/auth.js";
import { createPresenceRoutes, type PresenceRoutesDependencies } from "./presence.js";
import type { PresenceState } from "../broker/index.js";

const now = new Date("2026-07-14T09:00:00.000Z");
const workspaceId = "00000000-0000-4000-8000-000000000002"; // authDefaults.defaultWorkspaceId (no memberships repo injected)
const userId = "33000000-0000-4000-8000-000000000001";
const otherUserId = "33000000-0000-4000-8000-000000000002";
const peerUserId = "33000000-0000-4000-8000-000000000003";
const foreignUserId = "33000000-0000-4000-8000-000000000004"; // never a member of the actor's workspace

function settings(): Settings {
  return loadSettings({ APP_ENV: "test", COOKIE_SECRET: "r14-presence-route-secret" });
}

function userRow(id: string, cookieToken: string): UserAuthRow {
  return {
    id,
    nickname: `r14-presence-${id.slice(-1)}`,
    cookieToken,
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
    if (id === userId) return userRow(userId, "cookie-r14-presence-owner");
    return null;
  }
  async findActiveByCookieToken(token: string) {
    if (token === "cookie-r14-presence-owner") return userRow(userId, token);
    return null;
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

async function cookieFor(runtimeSettings: Settings, token: string) {
  return generateSignedCookie(COOKIE_NAME, token, runtimeSettings.auth.cookieSecret);
}

function withErrors(app: Hono<AuthEnv>) {
  app.onError((error, c) => {
    if (error instanceof ZodError) {
      return c.json({ ok: false, error: { code: "validation_error", message: "invalid payload" } }, 422);
    }
    if (error instanceof HTTPException) {
      return c.json({ ok: false, error: { code: httpErrorCodeFor(error), message: error.message } }, error.status);
    }
    return c.json({ ok: false, error: { code: "internal_error", message: "internal" } }, 500);
  });
  return app;
}

function fakeMemberships(activeUserIds: string[]) {
  const calls: Array<{ workspaceId: string; userIds: string[] }> = [];
  return {
    calls,
    async listActiveUserIdsInWorkspace(ws: string, userIds: string[]) {
      calls.push({ workspaceId: ws, userIds });
      const activeSet = new Set(activeUserIds);
      return userIds.filter((id) => activeSet.has(id));
    }
  };
}

function fakePresenceStore(states: Record<string, PresenceState>) {
  const calls: string[][] = [];
  return {
    calls,
    async getPresenceMap(userIds: string[]) {
      calls.push(userIds);
      const result: Record<string, PresenceState> = {};
      for (const id of userIds) {
        if (states[id]) {
          result[id] = states[id];
        }
      }
      return result;
    }
  };
}

function routeApp(input: {
  runtimeSettings: Settings;
  presence?: PresenceRoutesDependencies["presence"];
  memberships?: PresenceRoutesDependencies["memberships"];
}) {
  const app = withErrors(new Hono<AuthEnv>());
  app.route(
    "/api",
    createPresenceRoutes({
      auth: authDeps(input.runtimeSettings),
      ...(input.presence ? { presence: input.presence } : {}),
      ...(input.memberships ? { memberships: input.memberships } : {})
    })
  );
  return app;
}

test("presence route requires authentication before reaching membership/presence lookups", async () => {
  const runtimeSettings = settings();
  const memberships = fakeMemberships([userId]);
  const app = routeApp({ runtimeSettings, memberships });

  const response = await app.request(`/api/presence?user_ids=${userId}`);

  assert.equal(response.status, 401);
  assert.equal(memberships.calls.length, 0);
});

test("a missing user_ids query parameter 400s without reaching membership/presence lookups", async () => {
  const runtimeSettings = settings();
  const memberships = fakeMemberships([userId]);
  const app = routeApp({ runtimeSettings, memberships });
  const headers = { Cookie: await cookieFor(runtimeSettings, "cookie-r14-presence-owner") };

  const response = await app.request("/api/presence", { headers });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: { code: "bad_request", message: "user_ids query parameter is required" }
  });
  assert.equal(memberships.calls.length, 0);
});

test("a blank user_ids query parameter 400s the same as a missing one", async () => {
  const runtimeSettings = settings();
  const app = routeApp({ runtimeSettings, memberships: fakeMemberships([userId]) });
  const headers = { Cookie: await cookieFor(runtimeSettings, "cookie-r14-presence-owner") };

  const response = await app.request("/api/presence?user_ids=%20%2C%20", { headers });

  assert.equal(response.status, 400);
});

test("an invalid uuid anywhere in user_ids 400s the whole request without a partial result", async () => {
  const runtimeSettings = settings();
  const memberships = fakeMemberships([userId, otherUserId]);
  const app = routeApp({ runtimeSettings, memberships });
  const headers = { Cookie: await cookieFor(runtimeSettings, "cookie-r14-presence-owner") };

  const response = await app.request(`/api/presence?user_ids=${userId},not-a-uuid`, { headers });

  assert.equal(response.status, 400);
  assert.equal(memberships.calls.length, 0);
});

test("more than 50 ids 400s before any per-id uuid validation or lookup", async () => {
  const runtimeSettings = settings();
  const memberships = fakeMemberships([userId]);
  const app = routeApp({ runtimeSettings, memberships });
  const headers = { Cookie: await cookieFor(runtimeSettings, "cookie-r14-presence-owner") };
  const tooMany = Array.from({ length: 51 }, (_, index) => `40000000-0000-4000-8000-${String(index).padStart(12, "0")}`);

  const response = await app.request(`/api/presence?user_ids=${tooMany.join(",")}`, { headers });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: { code: "bad_request", message: "user_ids accepts at most 50 ids" }
  });
  assert.equal(memberships.calls.length, 0);
});

test("exactly 50 distinct ids is accepted (the boundary is inclusive)", async () => {
  const runtimeSettings = settings();
  const fifty = Array.from({ length: 50 }, (_, index) => `40000000-0000-4000-8000-${String(index).padStart(12, "0")}`);
  const app = routeApp({
    runtimeSettings,
    memberships: fakeMemberships(fifty),
    presence: fakePresenceStore({})
  });
  const headers = { Cookie: await cookieFor(runtimeSettings, "cookie-r14-presence-owner") };

  const response = await app.request(`/api/presence?user_ids=${fifty.join(",")}`, { headers });

  assert.equal(response.status, 200);
  const body = (await response.json()) as { ok: boolean; data: { presence: unknown[] } };
  assert.equal(body.data.presence.length, 50);
});

test("membership filtering runs in the SQL layer with the actor's workspace id and the full requested id set", async () => {
  const runtimeSettings = settings();
  const memberships = fakeMemberships([userId]);
  const app = routeApp({ runtimeSettings, memberships, presence: fakePresenceStore({}) });
  const headers = { Cookie: await cookieFor(runtimeSettings, "cookie-r14-presence-owner") };

  await app.request(`/api/presence?user_ids=${userId},${otherUserId}`, { headers });

  assert.equal(memberships.calls.length, 1);
  assert.equal(memberships.calls[0]!.workspaceId, workspaceId);
  assert.deepEqual(memberships.calls[0]!.userIds, [userId, otherUserId]);
});

test("ids outside the actor's workspace are silently dropped from the response, not surfaced as offline placeholders", async () => {
  const runtimeSettings = settings();
  const app = routeApp({
    runtimeSettings,
    memberships: fakeMemberships([userId, peerUserId]), // foreignUserId is deliberately excluded
    presence: fakePresenceStore({ [userId]: { is_online: true }, [peerUserId]: { is_online: false } })
  });
  const headers = { Cookie: await cookieFor(runtimeSettings, "cookie-r14-presence-owner") };

  const response = await app.request(`/api/presence?user_ids=${userId},${peerUserId},${foreignUserId}`, { headers });

  assert.equal(response.status, 200);
  const body = (await response.json()) as { ok: boolean; data: { presence: Array<{ user_id: string }> } };
  const returnedIds = body.data.presence.map((entry) => entry.user_id);
  assert.deepEqual(returnedIds, [userId, peerUserId]);
});

test("when no requested id is visible in the actor's workspace, the presence store is never queried", async () => {
  const runtimeSettings = settings();
  const presence = fakePresenceStore({});
  const app = routeApp({ runtimeSettings, memberships: fakeMemberships([]), presence });
  const headers = { Cookie: await cookieFor(runtimeSettings, "cookie-r14-presence-owner") };

  const response = await app.request(`/api/presence?user_ids=${foreignUserId}`, { headers });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, data: { presence: [] } });
  assert.equal(presence.calls.length, 0);
});

test("duplicate ids in the query string are deduped to a single entry, request order preserved", async () => {
  const runtimeSettings = settings();
  const app = routeApp({
    runtimeSettings,
    memberships: fakeMemberships([userId, otherUserId]),
    presence: fakePresenceStore({ [userId]: { is_online: true }, [otherUserId]: { is_online: false } })
  });
  const headers = { Cookie: await cookieFor(runtimeSettings, "cookie-r14-presence-owner") };

  const response = await app.request(`/api/presence?user_ids=${otherUserId},${userId},${otherUserId}`, { headers });

  assert.equal(response.status, 200);
  const body = (await response.json()) as { ok: boolean; data: { presence: Array<{ user_id: string }> } };
  assert.deepEqual(
    body.data.presence.map((entry) => entry.user_id),
    [otherUserId, userId]
  );
});

test("the response shape carries is_online/last_seen_at exactly per the presence contract, with null for never-seen users", async () => {
  const runtimeSettings = settings();
  const lastSeenAt = new Date("2026-07-14T08:55:00.000Z");
  const app = routeApp({
    runtimeSettings,
    memberships: fakeMemberships([userId, otherUserId]),
    presence: fakePresenceStore({ [userId]: { is_online: true, last_seen_at: lastSeenAt } })
  });
  const headers = { Cookie: await cookieFor(runtimeSettings, "cookie-r14-presence-owner") };

  const response = await app.request(`/api/presence?user_ids=${userId},${otherUserId}`, { headers });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    data: {
      presence: [
        { user_id: userId, is_online: true, last_seen_at: lastSeenAt.toISOString() },
        { user_id: otherUserId, is_online: false, last_seen_at: null }
      ]
    }
  });
});
