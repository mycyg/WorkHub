import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";

import { Hono } from "hono";
import { generateSignedCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";

import { loadSettings, type Settings } from "@workhub/config";
import type { WorkspaceRosterResultVM } from "@workhub/contracts";
import type {
  ClientDeviceAuthRow,
  ClientDeviceRepository,
  UserAuthRow,
  UserRepository,
  WorkspaceMembershipRow
} from "@workhub/db";

import { COOKIE_NAME, type AuthDependencies, type AuthEnv } from "../middleware/auth.js";
import {
  WorkspaceMemberServiceError,
  type WorkspaceMemberService
} from "../services/workspace-members.js";
import { createWorkspaceMemberRoutes, type WorkspaceRosterReader } from "./workspace-members.js";

const now = new Date("2026-07-16T09:00:00.000Z");
const adminUserId = "70000000-0000-4000-8000-0000000000a1";
const targetUserId = "70000000-0000-4000-8000-0000000000b1";

function settings(): Settings {
  return loadSettings({ APP_ENV: "test", COOKIE_SECRET: "r17-workspace-members-secret" });
}

function user(): UserAuthRow {
  return {
    id: adminUserId,
    nickname: "r17-admin",
    cookieToken: "cookie-r17-admin",
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
    return id === adminUserId ? user() : null;
  }
  async findActiveByCookieToken(token: string) {
    return token === "cookie-r17-admin" ? user() : null;
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
  return { users: new MemoryUsers(), devices: new MemoryDevices(), settings: runtimeSettings, now: () => now };
}

async function cookie(runtimeSettings: Settings) {
  return generateSignedCookie(COOKIE_NAME, "cookie-r17-admin", runtimeSettings.auth.cookieSecret);
}

function memberService(overrides: Partial<WorkspaceMemberService> = {}): WorkspaceMemberService {
  const reject = (name: string) => async () => {
    throw new Error(`${name} not expected`);
  };
  return {
    listMembers: reject("listMembers"),
    removeMember: reject("removeMember"),
    updateMemberRole: reject("updateMemberRole"),
    ...overrides
  } as WorkspaceMemberService;
}

function withErrors(app: Hono<AuthEnv>) {
  app.onError((error, c) => {
    if (error instanceof ZodError) {
      return c.json({ ok: false, error: { code: "validation_error", message: "invalid payload" } }, 422);
    }
    if (error instanceof WorkspaceMemberServiceError) {
      return c.json({ ok: false, error: { code: error.code, message: error.message } }, error.status);
    }
    if (error instanceof HTTPException) {
      return c.json({ ok: false, error: { code: "unauthorized", message: error.message } }, error.status);
    }
    return c.json({ ok: false, error: { code: "internal_error", message: "internal" } }, 500);
  });
  return app;
}

function routeApp(runtimeSettings: Settings, members: WorkspaceMemberService) {
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api", createWorkspaceMemberRoutes({ auth: authDeps(runtimeSettings), members }));
  return app;
}

test("GET members requires authentication before reaching the service", async () => {
  const runtimeSettings = settings();
  const app = routeApp(
    runtimeSettings,
    memberService({
      async listMembers() {
        throw new Error("anonymous request must not reach the service");
      }
    })
  );

  const response = await app.request("/api/workspace/members");

  assert.equal(response.status, 401);
});

test("GET members returns the roster from the service", async () => {
  const runtimeSettings = settings();
  let seen: unknown;
  const roster = {
    members: [
      { user_id: adminUserId, nickname: "r17-admin", role: "owner" as const, joined_at: now.toISOString(), is_self: true },
      { user_id: targetUserId, nickname: "小赵", role: "member" as const, joined_at: now.toISOString(), is_self: false }
    ]
  };
  const app = routeApp(
    runtimeSettings,
    memberService({
      async listMembers(input) {
        seen = input;
        return roster;
      }
    })
  );
  const headers = { Cookie: await cookie(runtimeSettings) };

  const response = await app.request("/api/workspace/members", { headers });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, data: roster });
  assert.ok((seen as { actor: unknown }).actor, "the actor is forwarded to the service");
});

test("GET members preserves the service's typed 403 for non-managers", async () => {
  const runtimeSettings = settings();
  const app = routeApp(
    runtimeSettings,
    memberService({
      async listMembers() {
        throw new WorkspaceMemberServiceError(403, "member_manage_forbidden", "只有工作区管理员可以管理成员。");
      }
    })
  );
  const headers = { Cookie: await cookie(runtimeSettings) };

  const response = await app.request("/api/workspace/members", { headers });

  assert.equal(response.status, 403);
  assert.equal(((await response.json()) as { error: { code: string } }).error.code, "member_manage_forbidden");
});

test("DELETE member requires authentication before reaching the service", async () => {
  const runtimeSettings = settings();
  const app = routeApp(
    runtimeSettings,
    memberService({
      async removeMember() {
        throw new Error("anonymous request must not reach the service");
      }
    })
  );

  const response = await app.request(`/api/workspace/members/${targetUserId}`, { method: "DELETE" });

  assert.equal(response.status, 401);
});

test("DELETE member 404s a malformed user id without entering the service", async () => {
  const runtimeSettings = settings();
  let calls = 0;
  const app = routeApp(
    runtimeSettings,
    memberService({
      async removeMember() {
        calls += 1;
        throw new Error("invalid id must not reach the service");
      }
    })
  );
  const headers = { Cookie: await cookie(runtimeSettings) };

  const response = await app.request("/api/workspace/members/not-a-uuid", { method: "DELETE", headers });

  assert.equal(response.status, 404);
  assert.equal(calls, 0);
});

test("DELETE member forwards the target and returns the removed id", async () => {
  const runtimeSettings = settings();
  let seen: unknown;
  const app = routeApp(
    runtimeSettings,
    memberService({
      async removeMember(input) {
        seen = input;
        return { removed_user_id: targetUserId };
      }
    })
  );
  const headers = { Cookie: await cookie(runtimeSettings) };

  const response = await app.request(`/api/workspace/members/${targetUserId}`, { method: "DELETE", headers });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, data: { removed_user_id: targetUserId } });
  assert.equal((seen as { targetUserId: string }).targetUserId, targetUserId);
});

test("DELETE member preserves the service's typed 409 for the last admin", async () => {
  const runtimeSettings = settings();
  const app = routeApp(
    runtimeSettings,
    memberService({
      async removeMember() {
        throw new WorkspaceMemberServiceError(409, "member_last_admin", "不能移出最后一名管理员。");
      }
    })
  );
  const headers = { Cookie: await cookie(runtimeSettings) };

  const response = await app.request(`/api/workspace/members/${targetUserId}`, { method: "DELETE", headers });

  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: { code: "member_last_admin", message: "不能移出最后一名管理员。" }
  });
});

test("PATCH member role forwards the role and returns the updated pair", async () => {
  const runtimeSettings = settings();
  let seen: unknown;
  const app = routeApp(
    runtimeSettings,
    memberService({
      async updateMemberRole(input) {
        seen = input;
        return { user_id: targetUserId, role: "admin" };
      }
    })
  );
  const headers = { Cookie: await cookie(runtimeSettings), "content-type": "application/json" };

  const response = await app.request(`/api/workspace/members/${targetUserId}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ role: "admin" })
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, data: { user_id: targetUserId, role: "admin" } });
  assert.equal((seen as { role: string }).role, "admin");
});

test("PATCH member role rejects an unknown role with 422 before the service", async () => {
  const runtimeSettings = settings();
  let calls = 0;
  const app = routeApp(
    runtimeSettings,
    memberService({
      async updateMemberRole() {
        calls += 1;
        throw new Error("invalid role must not reach the service");
      }
    })
  );
  const headers = { Cookie: await cookie(runtimeSettings), "content-type": "application/json" };

  const response = await app.request(`/api/workspace/members/${targetUserId}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ role: "superuser" })
  });

  assert.equal(response.status, 422);
  assert.equal(calls, 0);
});

// ── R20 P2A（P1-08 修复 · GET /api/workspace/roster） ──────────────────────────────────────────
// 内存假 roster 读者：以「带 workspaceId 的成员种子」为真源，findActiveForUserWorkspace 判归属、
// listActiveRosterPageByWorkspace 按工作区过滤 + 昵称排序 + limit/offset 切片——足以在路由边界断言
// 工作区隔离、分页、无 200 截断、非成员 403，无需真 DB。

type RosterSeed = {
  workspaceId: string;
  userId: string;
  nickname: string;
  role: "member" | "admin" | "owner";
  joinedAt: Date;
  avatarUpdatedAt: Date | null;
};

function rosterReader(seed: RosterSeed[]): {
  reader: WorkspaceRosterReader;
  calls: Array<{ workspaceId: string; limit: number; offset: number }>;
} {
  const calls: Array<{ workspaceId: string; limit: number; offset: number }> = [];
  const reader: WorkspaceRosterReader = {
    async findActiveForUserWorkspace(userId, workspaceId) {
      const member = seed.find((row) => row.userId === userId && row.workspaceId === workspaceId);
      return member ? ({ id: "membership", userId, workspaceId } as unknown as WorkspaceMembershipRow) : null;
    },
    async listActiveRosterPageByWorkspace(workspaceId, page) {
      calls.push({ workspaceId, limit: page.limit, offset: page.offset });
      const all = seed
        .filter((row) => row.workspaceId === workspaceId)
        .sort((a, b) => a.nickname.localeCompare(b.nickname));
      const slice = all.slice(page.offset, page.offset + page.limit);
      return {
        total: all.length,
        members: slice.map((row) => ({
          userId: row.userId,
          nickname: row.nickname,
          role: row.role,
          joinedAt: row.joinedAt,
          avatarUpdatedAt: row.avatarUpdatedAt
        }))
      };
    }
  };
  return { reader, calls };
}

function rosterApp(runtimeSettings: Settings, reader: WorkspaceRosterReader) {
  const app = withErrors(new Hono<AuthEnv>());
  app.route(
    "/api",
    createWorkspaceMemberRoutes({ auth: authDeps(runtimeSettings), members: memberService(), roster: reader })
  );
  return app;
}

const otherWorkspaceId = "00000000-0000-4000-8000-0000000000ff";

test("GET roster requires authentication before reaching the reader", async () => {
  const runtimeSettings = settings();
  const { reader, calls } = rosterReader([]);
  const app = rosterApp(runtimeSettings, reader);

  const response = await app.request("/api/workspace/roster");

  assert.equal(response.status, 401);
  assert.equal(calls.length, 0);
});

test("GET roster 403s a caller who is not an active member of the workspace", async () => {
  const runtimeSettings = settings();
  const { reader, calls } = rosterReader([
    { workspaceId: otherWorkspaceId, userId: randomUUID(), nickname: "外人", role: "member", joinedAt: now, avatarUpdatedAt: null }
  ]);
  const app = rosterApp(runtimeSettings, reader);
  const headers = { Cookie: await cookie(runtimeSettings) };

  const response = await app.request("/api/workspace/roster", { headers });

  assert.equal(response.status, 403);
  assert.equal(((await response.json()) as { error: { code: string } }).error.code, "roster_forbidden");
  assert.equal(calls.length, 0, "a non-member is rejected before the roster query runs");
});

test("GET roster returns only the caller's workspace members with avatar/online placeholders", async () => {
  const runtimeSettings = settings();
  const wsA = runtimeSettings.auth.defaultWorkspaceId;
  const peerId = randomUUID();
  const avatarAt = new Date("2026-07-14T00:00:00.000Z");
  const { reader, calls } = rosterReader([
    { workspaceId: wsA, userId: adminUserId, nickname: "r17-admin", role: "owner", joinedAt: now, avatarUpdatedAt: avatarAt },
    { workspaceId: wsA, userId: peerId, nickname: "小赵", role: "member", joinedAt: now, avatarUpdatedAt: null },
    { workspaceId: otherWorkspaceId, userId: randomUUID(), nickname: "他区成员", role: "member", joinedAt: now, avatarUpdatedAt: null }
  ]);
  const app = rosterApp(runtimeSettings, reader);
  const headers = { Cookie: await cookie(runtimeSettings) };

  const response = await app.request("/api/workspace/roster", { headers });

  assert.equal(response.status, 200);
  const body = (await response.json()) as { ok: true; data: WorkspaceRosterResultVM };
  // 隔离：只用 actor 的工作区查、只回该工作区成员——他区成员绝不泄露。
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.workspaceId, wsA);
  assert.equal(body.data.total, 2);
  assert.deepEqual(
    body.data.members.map((member) => member.user_id).sort(),
    [adminUserId, peerId].sort()
  );
  // 占位字段：online 恒 null；avatar_updated_at 有头像回 ISO、无头像回 null；is_self 正确标本人。
  const self = body.data.members.find((member) => member.user_id === adminUserId);
  assert.ok(self);
  assert.equal(self.is_self, true);
  assert.equal(self.online, null);
  assert.equal(self.avatar_updated_at, avatarAt.toISOString());
  const peer = body.data.members.find((member) => member.user_id === peerId);
  assert.ok(peer);
  assert.equal(peer.is_self, false);
  assert.equal(peer.avatar_updated_at, null);
});

test("GET roster paginates via limit/offset", async () => {
  const runtimeSettings = settings();
  const wsA = runtimeSettings.auth.defaultWorkspaceId;
  const { reader, calls } = rosterReader([
    { workspaceId: wsA, userId: adminUserId, nickname: "a-self", role: "owner", joinedAt: now, avatarUpdatedAt: null },
    { workspaceId: wsA, userId: randomUUID(), nickname: "b-two", role: "member", joinedAt: now, avatarUpdatedAt: null },
    { workspaceId: wsA, userId: randomUUID(), nickname: "c-three", role: "member", joinedAt: now, avatarUpdatedAt: null }
  ]);
  const app = rosterApp(runtimeSettings, reader);
  const headers = { Cookie: await cookie(runtimeSettings) };

  const response = await app.request("/api/workspace/roster?limit=1&offset=1", { headers });

  assert.equal(response.status, 200);
  const body = (await response.json()) as { data: WorkspaceRosterResultVM };
  assert.deepEqual(calls[0], { workspaceId: wsA, limit: 1, offset: 1 });
  assert.equal(body.data.total, 3);
  assert.equal(body.data.limit, 1);
  assert.equal(body.data.offset, 1);
  assert.equal(body.data.members.length, 1);
  assert.equal(body.data.members[0]?.nickname, "b-two");
});

test("GET roster surfaces members beyond the old 200 cap via offset", async () => {
  const runtimeSettings = settings();
  const wsA = runtimeSettings.auth.defaultWorkspaceId;
  const seed: RosterSeed[] = [
    { workspaceId: wsA, userId: adminUserId, nickname: "zz-admin", role: "owner", joinedAt: now, avatarUpdatedAt: null }
  ];
  for (let index = 0; index < 250; index += 1) {
    seed.push({
      workspaceId: wsA,
      userId: randomUUID(),
      nickname: `member-${String(index).padStart(3, "0")}`,
      role: "member",
      joinedAt: now,
      avatarUpdatedAt: null
    });
  }
  const { reader } = rosterReader(seed);
  const app = rosterApp(runtimeSettings, reader);
  const headers = { Cookie: await cookie(runtimeSettings) };

  const response = await app.request("/api/workspace/roster?limit=100&offset=200", { headers });

  assert.equal(response.status, 200);
  const body = (await response.json()) as { data: WorkspaceRosterResultVM };
  assert.equal(body.data.total, 251, "total counts every active member, not a 200 cap");
  // 第 201 个及以后的成员现在可经 offset 翻到（/api/users 硬 .limit(200) 时代它们对消费端永不可见）。
  const nicknames = body.data.members.map((member) => member.nickname);
  assert.ok(nicknames.includes("member-249"), "the 250th member is reachable past offset 200");
});
