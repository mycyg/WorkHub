import assert from "node:assert/strict";
import test from "node:test";

import { Hono } from "hono";
import { generateSignedCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";

import { loadSettings, type Settings } from "@workhub/config";
import { hashSessionToken, isSessionActive } from "@workhub/db";
import type {
  AuditLogRepository,
  AuditLogRow,
  ClientDeviceAuthRow,
  ClientDeviceRepository,
  CreateAuditLogInput,
  CreateSessionInput,
  CreateInviteInput,
  CreateUserCredentialInput,
  CreateWorkspaceMembershipInput,
  CredentialRepository,
  InviteRepository,
  MembershipRole,
  SessionRepository,
  SessionRow,
  UserAuthRow,
  UserCredentialRow,
  UserInviteRow,
  UserRepository,
  WorkItemClaimHandoverRepository,
  WorkspaceMembershipRepository,
  WorkspaceMembershipRow
} from "@workhub/db";
import type { WorkHubLocale, WorkItemStatus } from "@workhub/contracts";

import {
  COOKIE_NAME,
  LOCAL_CLIENT_HEADER,
  createAiActor,
  createCurrentUserMiddleware,
  createOptionalLocalClientMiddleware,
  createRequireLocalClientMiddleware,
  hashClientToken,
  issueSessionCookie,
  mintSession,
  resolveHumanActor,
  resolveStreamUser,
  validateNickname,
  type AuthDependencies,
  type AuthEnv
} from "./middleware/auth.js";
import { hashPassword, verifyPassword } from "./auth/password.js";
import { WorkspaceMemberServiceError } from "./services/workspace-members.js";
import { createAuthRoutes } from "./routes/auth.js";
import { createClientDeviceRoutes } from "./routes/client-devices.js";
import { httpErrorCodeFor } from "./http-error-codes.js";
import { createAdminClaimThrottle } from "./middleware/admin-claim-throttle.js";
import { malformedJsonMessage } from "./routes/json-body.js";

const now = new Date("2026-06-05T00:00:00.000Z");

function user(partial: Partial<UserAuthRow> = {}): UserAuthRow {
  return {
    id: "10000000-0000-4000-8000-000000000001",
    nickname: "alice",
    cookieToken: "cookie-alice",
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
    updatedAt: now,
    ...partial
  };
}

function device(partial: Partial<ClientDeviceAuthRow> = {}): ClientDeviceAuthRow {
  return {
    id: "20000000-0000-4000-8000-000000000001",
    userId: "10000000-0000-4000-8000-000000000001",
    deviceName: "Tauri Client",
    clientTokenHash: hashClientToken("client-token-alice"),
    platform: "windows",
    lastSeenAt: now,
    revokedAt: null,
    createdAt: now,
    updatedAt: now,
    ...partial
  };
}

class MemoryUsers implements UserRepository {
  constructor(private rows: UserAuthRow[]) {}

  async findActiveById(id: string) {
    return this.rows.find((row) => row.id === id && row.deletedAt === null) ?? null;
  }

  async findActiveByCookieToken(cookieToken: string) {
    return this.rows.find((row) => row.cookieToken === cookieToken && row.deletedAt === null) ?? null;
  }

  async findActiveByNickname(nickname: string) {
    return this.rows.find((row) => row.nickname === nickname && row.deletedAt === null) ?? null;
  }

  async createUser(input: Parameters<UserRepository["createUser"]>[0]) {
    const row = user({
      id: input.id ?? `10000000-0000-4000-8000-${String(this.rows.length + 10).padStart(12, "0")}`,
      nickname: input.nickname,
      cookieToken: input.cookieToken,
      isAdmin: input.isAdmin ?? false
    });
    this.rows.push(row);
    return row;
  }

  async getOrCreateActiveByNickname(nickname: string, newCookieToken: string) {
    const existing = await this.findActiveByNickname(nickname);
    if (existing) {
      return { user: existing, created: false };
    }
    return { user: await this.createUser({ nickname, cookieToken: newCookieToken }), created: true };
  }

  async rotateCookieToken(userId: string, cookieToken: string) {
    const row = this.rows.find((candidate) => candidate.id === userId && candidate.deletedAt === null);
    if (!row) {
      return null;
    }
    row.cookieToken = cookieToken;
    row.updatedAt = now;
    return row;
  }

  async promoteToAdmin(userId: string) {
    const row = this.rows.find((candidate) => candidate.id === userId && candidate.deletedAt === null);
    if (!row) {
      return null;
    }
    row.isAdmin = true;
    row.updatedAt = now;
    return row;
  }

  async updatePreferredLocale(userId: string, locale: WorkHubLocale) {
    const row = this.rows.find((candidate) => candidate.id === userId && candidate.deletedAt === null);
    if (!row) {
      return null;
    }
    row.preferredLocale = locale;
    row.updatedAt = now;
    return row;
  }

  async hasAnyActiveAdmin() {
    return this.rows.some((row) => row.isAdmin && row.deletedAt === null);
  }

  async softDelete(userId: string, deletedByUserId: string, at: Date) {
    const row = this.rows.find((candidate) => candidate.id === userId && candidate.deletedAt === null);
    if (!row) {
      return null;
    }
    row.deletedAt = at;
    row.deletedByUserId = deletedByUserId;
    row.updatedAt = at;
    return row;
  }

  // 含已软删墓碑的批量引用（真库 findRefsByIds 语义）——P2-02 停用善后重试入口据此分辨墓碑 vs 不存在。
  async findRefsByIds(ids: string[]) {
    return this.rows
      .filter((row) => ids.includes(row.id))
      .map((row) => ({ id: row.id, deletedAt: row.deletedAt }));
  }
}

class MemoryDevices implements ClientDeviceRepository {
  public touched: string[] = [];

  constructor(private rows: ClientDeviceAuthRow[]) {}

  async findActiveByTokenHash(tokenHash: string) {
    return this.rows.find((row) => row.clientTokenHash === tokenHash && row.revokedAt === null) ?? null;
  }

  async findActiveByTokenHashForUser(tokenHash: string, userId: string) {
    return (
      this.rows.find(
        (row) => row.clientTokenHash === tokenHash && row.userId === userId && row.revokedAt === null
      ) ?? null
    );
  }

  async createClientDevice(input: Parameters<ClientDeviceRepository["createClientDevice"]>[0]) {
    const row = device({
      id: input.id ?? `20000000-0000-4000-8000-${String(this.rows.length + 10).padStart(12, "0")}`,
      userId: input.userId,
      deviceName: input.deviceName,
      platform: input.platform,
      clientTokenHash: input.clientTokenHash,
      lastSeenAt: input.lastSeenAt
    });
    this.rows.push(row);
    return row;
  }

  async listByUser(userId: string) {
    return this.rows.filter((row) => row.userId === userId);
  }

  async touchLastSeen(deviceId: string, at: Date) {
    const row = this.rows.find((candidate) => candidate.id === deviceId) ?? null;
    if (row) {
      row.lastSeenAt = at;
      row.updatedAt = at;
      this.touched.push(deviceId);
    }
    return row;
  }

  async revokeByIdForUser(deviceId: string, userId: string, at: Date) {
    const row = this.rows.find((candidate) => candidate.id === deviceId && candidate.userId === userId) ?? null;
    if (row && row.revokedAt === null) {
      row.revokedAt = at;
      row.updatedAt = at;
    }
    return row;
  }

  async revokeByTokenHash(tokenHash: string, at: Date) {
    const row = this.rows.find((candidate) => candidate.clientTokenHash === tokenHash && candidate.revokedAt === null);
    if (row) {
      row.revokedAt = at;
      row.updatedAt = at;
    }
    return row ?? null;
  }
}

class ThrowingCleanupDevices extends MemoryDevices {
  listByUser(): ReturnType<MemoryDevices["listByUser"]> {
    return Promise.reject(new Error("device cleanup failed"));
  }
}

function sessionRow(input: CreateSessionInput, seq = 1): SessionRow {
  return {
    id: input.id ?? `30000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    userId: input.userId,
    tokenHash: input.tokenHash,
    authMethod: input.authMethod ?? "password",
    oidcProvider: input.oidcProvider ?? null,
    ipHash: input.ipHash ?? null,
    userAgent: input.userAgent ?? null,
    absoluteExpiresAt: input.absoluteExpiresAt,
    idleExpiresAt: input.idleExpiresAt,
    lastSeenAt: null,
    revokedAt: null,
    createdAt: now,
    updatedAt: now
  };
}

class MemorySessions implements SessionRepository {
  public rows: SessionRow[] = [];
  public touched: string[] = [];

  async create(input: CreateSessionInput) {
    const row = sessionRow(input, this.rows.length + 1);
    this.rows.push(row);
    return row;
  }

  async findActiveByTokenHash(tokenHash: string, at: Date) {
    return this.rows.find((row) => row.tokenHash === tokenHash && isSessionActive(row, at)) ?? null;
  }

  async touch(sessionId: string, idleExpiresAt: Date, at: Date) {
    const row = this.rows.find((candidate) => candidate.id === sessionId && candidate.revokedAt === null);
    if (!row) {
      return null;
    }
    row.idleExpiresAt = idleExpiresAt;
    row.lastSeenAt = at;
    row.updatedAt = at;
    this.touched.push(sessionId);
    return row;
  }

  async revoke(sessionId: string, at: Date) {
    const row = this.rows.find((candidate) => candidate.id === sessionId && candidate.revokedAt === null);
    if (!row) {
      return null;
    }
    row.revokedAt = at;
    row.updatedAt = at;
    return row;
  }

  async revokeAllForUser(userId: string, at: Date) {
    let count = 0;
    for (const row of this.rows) {
      if (row.userId === userId && row.revokedAt === null) {
        row.revokedAt = at;
        row.updatedAt = at;
        count += 1;
      }
    }
    return count;
  }

  async deleteExpired(at: Date) {
    const before = this.rows.length;
    this.rows = this.rows.filter((row) => row.absoluteExpiresAt >= at);
    return before - this.rows.length;
  }
}

class ThrowingCleanupSessions extends MemorySessions {
  revokeAllForUser(): ReturnType<MemorySessions["revokeAllForUser"]> {
    return Promise.reject(new Error("session cleanup failed"));
  }
}

// P2-02：先失败、后（外部瞬时故障恢复后）成功的会话仓库——用于验证停用善后清理可重跑收敛。
class FlakyCleanupSessions extends MemorySessions {
  public fail = true;

  override revokeAllForUser(userId: string, at: Date): ReturnType<MemorySessions["revokeAllForUser"]> {
    if (this.fail) {
      return Promise.reject(new Error("session cleanup transient failure"));
    }
    return super.revokeAllForUser(userId, at);
  }
}

function credentialRow(input: CreateUserCredentialInput, seq = 1): UserCredentialRow {
  return {
    id: input.id ?? `40000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    userId: input.userId,
    email: input.email,
    passwordHash: input.passwordHash,
    passwordAlgo: input.passwordAlgo,
    emailVerifiedAt: input.emailVerifiedAt ?? null,
    failedAttempts: 0,
    lockedUntil: null,
    createdAt: now,
    updatedAt: now
  };
}

class MemoryCredentials implements CredentialRepository {
  public rows: UserCredentialRow[] = [];

  // citext 语义：大小写不敏感匹配。
  async findByEmail(email: string) {
    return this.rows.find((row) => row.email.toLowerCase() === email.toLowerCase()) ?? null;
  }

  async findByUserId(userId: string) {
    return this.rows.find((row) => row.userId === userId) ?? null;
  }

  async createCredential(input: CreateUserCredentialInput) {
    if (await this.findByEmail(input.email)) {
      throw Object.assign(new Error("duplicate email"), { code: "23505" });
    }
    const row = credentialRow(input, this.rows.length + 1);
    this.rows.push(row);
    return row;
  }

  async updatePassword(userId: string, passwordHash: string, passwordAlgo: string) {
    const row = this.rows.find((candidate) => candidate.userId === userId);
    if (!row) {
      return null;
    }
    row.passwordHash = passwordHash;
    row.passwordAlgo = passwordAlgo;
    row.failedAttempts = 0;
    row.lockedUntil = null;
    row.updatedAt = now;
    return row;
  }

  async recordFailedAttempt(userId: string, lockedUntil?: Date | null) {
    const row = this.rows.find((candidate) => candidate.userId === userId);
    if (!row) {
      return null;
    }
    row.failedAttempts += 1;
    row.lockedUntil = lockedUntil ?? null;
    row.updatedAt = now;
    return row;
  }

  async resetFailedAttempts(userId: string) {
    const row = this.rows.find((candidate) => candidate.userId === userId);
    if (!row) {
      return null;
    }
    row.failedAttempts = 0;
    row.lockedUntil = null;
    row.updatedAt = now;
    return row;
  }

  async setEmailVerified(userId: string, at: Date) {
    const row = this.rows.find((candidate) => candidate.userId === userId);
    if (!row) {
      return null;
    }
    row.emailVerifiedAt = at;
    row.updatedAt = at;
    return row;
  }

  async deleteByUserId(userId: string) {
    this.rows = this.rows.filter((row) => row.userId !== userId);
  }
}

class ThrowingCleanupCredentials extends MemoryCredentials {
  deleteByUserId(): ReturnType<MemoryCredentials["deleteByUserId"]> {
    return Promise.reject(new Error("credential cleanup failed"));
  }
}

function membershipRow(input: CreateWorkspaceMembershipInput, seq = 1): WorkspaceMembershipRow {
  return {
    id: input.id ?? `50000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    workspaceId: input.workspaceId,
    userId: input.userId,
    role: input.role ?? "member",
    defaultWorkspace: input.defaultWorkspace ?? false,
    deletedAt: null,
    createdAt: now,
    updatedAt: now
  };
}

class MemoryMemberships implements WorkspaceMembershipRepository {
  public rows: WorkspaceMembershipRow[] = [];

  // 工作区→org 映射（resolveDefaultTenant 在真库里靠 join workspaces 取 org；fake 用预置 map）。
  constructor(private orgByWorkspace: Record<string, string> = {}) {}

  async listForUser(userId: string) {
    return this.rows.filter((row) => row.userId === userId && row.deletedAt === null);
  }

  async findActiveForUserWorkspace(userId: string, workspaceId: string) {
    return (
      this.rows.find((row) => row.userId === userId && row.workspaceId === workspaceId && row.deletedAt === null) ?? null
    );
  }

  async findSoftDeletedForUserWorkspace(userId: string, workspaceId: string) {
    return (
      this.rows
        .filter((row) => row.userId === userId && row.workspaceId === workspaceId && row.deletedAt !== null)
        .sort((a, b) => (b.deletedAt?.getTime() ?? 0) - (a.deletedAt?.getTime() ?? 0))[0] ?? null
    );
  }

  async resolveDefaultWorkspace(userId: string) {
    return this.rows.find((row) => row.userId === userId && row.defaultWorkspace && row.deletedAt === null) ?? null;
  }

  async resolveDefaultTenant(userId: string) {
    const row = this.rows.find((candidate) => candidate.userId === userId && candidate.defaultWorkspace && candidate.deletedAt === null);
    if (!row) {
      return null;
    }
    return {
      workspaceId: row.workspaceId,
      orgId: this.orgByWorkspace[row.workspaceId] ?? "00000000-0000-4000-8000-0000000000fa",
      role: row.role as MembershipRole
    };
  }

  async create(input: CreateWorkspaceMembershipInput) {
    const row = membershipRow(input, this.rows.length + 1);
    this.rows.push(row);
    return row;
  }

  async softDelete(id: string, at: Date) {
    const row = this.rows.find((candidate) => candidate.id === id && candidate.deletedAt === null);
    if (!row) {
      return null;
    }
    row.deletedAt = at;
    row.updatedAt = at;
    return row;
  }

  async listActiveByWorkspace(workspaceId: string) {
    return this.rows.filter((row) => row.workspaceId === workspaceId && row.deletedAt === null);
  }

  async listActiveWithNicknameByWorkspace(workspaceId: string) {
    return this.rows
      .filter((row) => row.workspaceId === workspaceId && row.deletedAt === null)
      .map((row) => ({
        userId: row.userId,
        nickname: `user-${row.userId.slice(0, 8)}`,
        role: row.role as MembershipRole,
        joinedAt: row.createdAt
      }));
  }

  async updateRole(id: string, role: MembershipRole, at: Date) {
    const row = this.rows.find((candidate) => candidate.id === id && candidate.deletedAt === null);
    if (!row) {
      return null;
    }
    row.role = role;
    row.updatedAt = at;
    return row;
  }
}

function inviteRow(input: CreateInviteInput, seq = 1): UserInviteRow {
  return {
    id: input.id ?? `60000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    email: input.email,
    tokenHash: input.tokenHash,
    invitedByUserId: input.invitedByUserId ?? null,
    role: input.role ?? "member",
    workspaceId: input.workspaceId ?? null,
    expiresAt: input.expiresAt,
    acceptedAt: null,
    acceptedUserId: null,
    deletedAt: null,
    createdAt: now,
    updatedAt: now
  };
}

class MemoryInvites implements InviteRepository {
  public rows: UserInviteRow[] = [];

  async create(input: CreateInviteInput) {
    const row = inviteRow(input, this.rows.length + 1);
    this.rows.push(row);
    return row;
  }

  async findActiveByTokenHash(tokenHash: string, at: Date) {
    return (
      this.rows.find(
        (row) => row.tokenHash === tokenHash && row.acceptedAt === null && row.deletedAt === null && row.expiresAt > at
      ) ?? null
    );
  }

  async accept(id: string, acceptedUserId: string, at: Date) {
    const row = this.rows.find((candidate) => candidate.id === id && candidate.acceptedAt === null && candidate.deletedAt === null);
    if (!row) {
      return null;
    }
    row.acceptedAt = at;
    row.acceptedUserId = acceptedUserId;
    row.updatedAt = at;
    return row;
  }

  async revoke(id: string, at: Date) {
    const row = this.rows.find((candidate) => candidate.id === id && candidate.deletedAt === null);
    if (!row) {
      return null;
    }
    row.deletedAt = at;
    row.updatedAt = at;
    return row;
  }

  async listPendingForEmail(email: string) {
    return this.rows.filter(
      (row) => row.email.toLowerCase() === email.toLowerCase() && row.acceptedAt === null && row.deletedAt === null
    );
  }

  async listPending(workspaceId: string, at: Date) {
    return this.rows
      .filter(
        (row) =>
          row.workspaceId === workspaceId &&
          row.acceptedAt === null &&
          row.deletedAt === null &&
          row.expiresAt > at
      )
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }
}

// 用户停用-工作交接的假仓库：只实现 unassignActiveClaimsForUser（停用路由用的唯一方法）。
// 模拟真库语义：清空被停用用户认领的、非终态、未软删事项的认领字段，RETURNING 受影响 id。
type FakeWorkItemClaim = {
  id: string;
  claimedByUserId: string | null;
  status: WorkItemStatus;
  deletedAt: Date | null;
};

const TERMINAL_STATUSES: readonly WorkItemStatus[] = ["merged", "done", "cancelled"];

class MemoryWorkItems implements WorkItemClaimHandoverRepository {
  constructor(public rows: FakeWorkItemClaim[]) {}

  async unassignActiveClaimsForUser(userId: string, at: Date) {
    const affected: { id: string }[] = [];
    for (const row of this.rows) {
      if (
        row.claimedByUserId === userId &&
        row.deletedAt === null &&
        !TERMINAL_STATUSES.includes(row.status)
      ) {
        row.claimedByUserId = null;
        affected.push({ id: row.id });
      }
    }
    void at;
    return affected;
  }
}

class MemoryAuditLogs implements Pick<AuditLogRepository, "createAuditLog"> {
  public rows: AuditLogRow[] = [];

  async createAuditLog(input: CreateAuditLogInput) {
    const row = {
      id: input.id ?? `70000000-0000-4000-8000-${String(this.rows.length + 1).padStart(12, "0")}`,
      orgId: input.orgId ?? null,
      workspaceId: input.workspaceId ?? null,
      actorKind: input.actorKind,
      actorUserId: input.actorUserId ?? null,
      actorNickname: input.actorNickname ?? null,
      entityType: input.entityType,
      entityId: input.entityId,
      action: input.action,
      detailJson: input.detailJson ?? {},
      snapshotId: input.snapshotId ?? null,
      undoneAt: null,
      createdAt: now
    } as AuditLogRow;
    this.rows.push(row);
    return row;
  }
}

function settings(env: Record<string, string | undefined> = {}): Settings {
  return loadSettings({
    APP_ENV: "test",
    COOKIE_SECRET: "test-cookie-secret",
    ...env
  });
}

function deps(users: UserAuthRow[], devices: ClientDeviceAuthRow[], runtimeSettings = settings()): AuthDependencies {
  return {
    users: new MemoryUsers(users),
    devices: new MemoryDevices(devices),
    settings: runtimeSettings,
    now: () => now
  };
}

function withErrors<T extends { Variables: Record<string, unknown> }>(app: Hono<T>) {
  app.onError((error, c) => {
    if (error instanceof ZodError) {
      return c.json({ ok: false, error: { code: "validation_error", message: "invalid payload" } }, 422);
    }
    // SEC-1（P0-01）：fail-closed / identify 拒绝墓碑抛 WorkspaceMemberServiceError（app.ts onError 亦读其 code），
    // 测试镜像同一映射，让响应体带上 workspace_access_revoked 等业务错误码。
    if (error instanceof WorkspaceMemberServiceError) {
      return c.json({ ok: false, error: { code: error.code, message: error.message } }, error.status);
    }
    if (error instanceof HTTPException) {
      return c.json({ ok: false, error: { code: "auth_error", message: error.message } }, error.status);
    }
    throw error;
  });
  return app;
}

function withProductionHttpErrors<T extends { Variables: Record<string, unknown> }>(app: Hono<T>) {
  app.onError((error, c) => {
    if (error instanceof HTTPException) {
      return c.json({ ok: false, error: { code: httpErrorCodeFor(error), message: error.message } }, error.status);
    }
    throw error;
  });
  return app;
}

async function signedCookie(cookieToken: string, runtimeSettings: Settings) {
  return generateSignedCookie(COOKIE_NAME, cookieToken, runtimeSettings.auth.cookieSecret);
}

test("valid device token wins over a different signed cookie identity", async () => {
  const alice = user();
  const bob = user({
    id: "10000000-0000-4000-8000-000000000002",
    nickname: "bob",
    cookieToken: "cookie-bob"
  });
  const authDeps = deps([alice, bob], [device()]);
  const deviceRepo = authDeps.devices as MemoryDevices;
  const app = withErrors(new Hono<AuthEnv>());
  app.get("/who", createCurrentUserMiddleware(authDeps), (c) => c.json({ id: c.var.currentUser.id }));

  const response = await app.request("/who", {
    headers: {
      [LOCAL_CLIENT_HEADER]: "client-token-alice",
      Cookie: await signedCookie(bob.cookieToken, authDeps.settings as Settings)
    }
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { id: alice.id });
  assert.deepEqual(deviceRepo.touched, ["20000000-0000-4000-8000-000000000001"]);
});

test("branded WorkHub client token header authenticates like the legacy local header", async () => {
  const alice = user();
  const authDeps = deps([alice], [device()]);
  const app = withErrors(new Hono<AuthEnv>());
  app.get("/who", createCurrentUserMiddleware(authDeps), (c) => c.json({ id: c.var.currentUser.id }));

  const response = await app.request("/who", {
    headers: { "X-WorkHub-Client-Token": "client-token-alice" }
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { id: alice.id });
});

test("soft-deleted cookie user is treated as not identified", async () => {
  const runtimeSettings = settings();
  const deleted = user({ deletedAt: now });
  const app = withErrors(new Hono<AuthEnv>());
  app.get("/who", createCurrentUserMiddleware(deps([deleted], [], runtimeSettings)), (c) =>
    c.json({ id: c.var.currentUser.id })
  );

  const response = await app.request("/who", {
    headers: { Cookie: await signedCookie(deleted.cookieToken, runtimeSettings) }
  });

  assert.equal(response.status, 401);
});

test("hard and soft local-client gates keep their old distinction", async () => {
  const alice = user();
  const runtimeSettings = settings();
  const authDeps = deps([alice], [], runtimeSettings);
  const app = withErrors(new Hono<AuthEnv>());
  app.get("/hard", createRequireLocalClientMiddleware(authDeps), (c) => c.json({ local: true }));
  app.get("/soft", createOptionalLocalClientMiddleware(authDeps), (c) =>
    c.json({ local: Boolean(c.var.currentClientDevice) })
  );
  const cookie = await signedCookie(alice.cookieToken, runtimeSettings);

  assert.equal((await app.request("/hard", { headers: { Cookie: cookie } })).status, 403);

  const softNoToken = await app.request("/soft", { headers: { Cookie: cookie } });
  assert.equal(softNoToken.status, 200);
  assert.deepEqual(await softNoToken.json(), { local: false });

  const softBadToken = await app.request("/soft", {
    headers: { Cookie: cookie, [LOCAL_CLIENT_HEADER]: "bad-token" }
  });
  assert.equal(softBadToken.status, 403);
});

test("findings: require-local-client honors TOUCH_DEVICE_ON_AUTH=false (no write amplification)", async () => {
  const alice = user();
  const off = deps([alice], [device()], settings({ TOUCH_DEVICE_ON_AUTH: "false" }));
  const offRepo = off.devices as MemoryDevices;
  const offApp = withErrors(new Hono<AuthEnv>());
  offApp.get("/hard", createRequireLocalClientMiddleware(off), (c) => c.json({ ok: true }));
  const cookieOff = await signedCookie(alice.cookieToken, settings({ TOUCH_DEVICE_ON_AUTH: "false" }));
  const offRes = await offApp.request("/hard", {
    headers: { Cookie: cookieOff, [LOCAL_CLIENT_HEADER]: "client-token-alice" }
  });
  assert.equal(offRes.status, 200);
  assert.deepEqual(offRepo.touched, []);

  // 默认（开）仍每次刷新 lastSeen。
  const on = deps([alice], [device()], settings());
  const onRepo = on.devices as MemoryDevices;
  const onApp = withErrors(new Hono<AuthEnv>());
  onApp.get("/hard", createRequireLocalClientMiddleware(on), (c) => c.json({ ok: true }));
  const cookieOn = await signedCookie(alice.cookieToken, settings());
  await onApp.request("/hard", { headers: { Cookie: cookieOn, [LOCAL_CLIENT_HEADER]: "client-token-alice" } });
  assert.equal(onRepo.touched.length >= 1, true);
});

test("findings: current-user gate fails closed on a present-but-invalid client token (no cookie fallback)", async () => {
  const alice = user();
  const runtimeSettings = settings();
  const authDeps = deps([alice], [], runtimeSettings);
  const app = withErrors(new Hono<AuthEnv>());
  app.get("/me", createCurrentUserMiddleware(authDeps), (c) => c.json({ id: c.var.currentUser.id }));
  const cookie = await signedCookie(alice.cookieToken, runtimeSettings);

  // cookie 单独 → 正常鉴权。
  assert.equal((await app.request("/me", { headers: { Cookie: cookie } })).status, 200);

  // 带垃圾 client-token header + 合法 cookie → fail-closed 403，不回退 cookie（堵 CSRF 同源守卫 header-存在即豁免 + cookie 回退的组合）。
  const badToken = await app.request("/me", {
    headers: { Cookie: cookie, [LOCAL_CLIENT_HEADER]: "bad-token" }
  });
  assert.equal(badToken.status, 403);
});

test("GET /auth/me keeps the hard 403 for revoked desktop client tokens (desktop self-heal depends on it)", async () => {
  // R9 批次0-1：桌面端 ensureDesktopClientToken 只有在 client.me() 抛 invalid_client_token
  // 时才会清掉本地死 token 重新 bootstrap。/me 若把它吞成 200 null，被吊销的设备将永久静默失联。
  const alice = user();
  const runtimeSettings = settings();
  const authDeps = deps([alice], [device({ revokedAt: now })], runtimeSettings);
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/auth", createAuthRoutes(authDeps));

  const response = await app.request("/api/auth/me", {
    headers: { [LOCAL_CLIENT_HEADER]: "client-token-alice" }
  });

  assert.equal(response.status, 403);
});

test("findings: stream identity fails closed on a present-but-invalid client token (no cookie fallback)", async () => {
  const alice = user();
  const runtimeSettings = settings();
  const authDeps = deps([alice], [], runtimeSettings);
  const app = withErrors(new Hono<AuthEnv>());
  app.get("/stream-user", async (c) => c.json(await resolveStreamUser(c, authDeps)));
  const cookie = await signedCookie(alice.cookieToken, runtimeSettings);

  assert.equal((await app.request("/stream-user", { headers: { Cookie: cookie } })).status, 200);

  const badToken = await app.request("/stream-user", {
    headers: { Cookie: cookie, [LOCAL_CLIENT_HEADER]: "bad-token" }
  });
  assert.equal(badToken.status, 403);
});

test("admin nickname claim fails closed when admin secret is empty", async () => {
  const admin = user({ nickname: "owner", isAdmin: true });
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/auth", createAuthRoutes(deps([admin], [], settings({ ADMIN_CLAIM_SECRET: "" }))));

  const response = await app.request("/api/auth/identify", {
    method: "POST",
    body: JSON.stringify({ nickname: "owner" }),
    headers: { "Content-Type": "application/json" }
  });

  assert.equal(response.status, 403);
});

test("admin nickname claim accepts the configured secret", async () => {
  const admin = user({ nickname: "owner", isAdmin: true });
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/auth", createAuthRoutes(deps([admin], [], settings({ ADMIN_CLAIM_SECRET: "let-me-in" }))));

  const response = await app.request("/api/auth/identify", {
    method: "POST",
    body: JSON.stringify({ nickname: "owner", admin_secret: "let-me-in" }),
    headers: { "Content-Type": "application/json" }
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Set-Cookie")?.includes(COOKIE_NAME), true);
});

test("admin claim attempts are rate-limited and locked out after repeated wrong secrets", async () => {
  const app = withErrors(new Hono<AuthEnv>());
  // 低阈值 + 固定时钟，确定性验证锁定。
  const throttle = createAdminClaimThrottle({ maxFailures: 2, windowMs: 60_000, lockoutMs: 600_000, now: () => 1_000_000 });
  app.route(
    "/api/auth",
    createAuthRoutes(deps([], [], settings({ ADMIN_CLAIM_SECRET: "let-me-in" })), { adminClaimThrottle: throttle })
  );
  const attempt = (secret: string) =>
    app.request("/api/auth/identify", {
      method: "POST",
      body: JSON.stringify({ nickname: "Sneaky", admin_secret: secret }),
      headers: { "Content-Type": "application/json" }
    });

  // 前两次错误口令 → 403。
  assert.equal((await attempt("wrong-1")).status, 403);
  assert.equal((await attempt("wrong-2")).status, 403);
  // 达到阈值后锁定：第三次（即便口令正确也）被 429 拦在校验之前。
  assert.equal((await attempt("wrong-3")).status, 429);
  assert.equal((await attempt("let-me-in")).status, 429);
});

test("admin claim throttle does not block ordinary nickname logins", async () => {
  const app = withErrors(new Hono<AuthEnv>());
  const throttle = createAdminClaimThrottle({ maxFailures: 1, windowMs: 60_000, lockoutMs: 600_000, now: () => 2_000_000 });
  app.route(
    "/api/auth",
    createAuthRoutes(deps([], [], settings({ ADMIN_CLAIM_SECRET: "let-me-in" })), { adminClaimThrottle: throttle })
  );
  // 普通昵称登录（不带口令）不计入限流，连续多次都正常。
  for (let i = 0; i < 3; i += 1) {
    const response = await app.request("/api/auth/identify", {
      method: "POST",
      body: JSON.stringify({ nickname: `Member ${i}` }),
      headers: { "Content-Type": "application/json" }
    });
    assert.equal(response.status, 201);
  }
});

test("a fresh user claims admin with the configured secret (pilot bootstrap)", async () => {
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/auth", createAuthRoutes(deps([], [], settings({ ADMIN_CLAIM_SECRET: "let-me-in" }))));

  const response = await app.request("/api/auth/identify", {
    method: "POST",
    body: JSON.stringify({ nickname: "Pilot Admin", admin_secret: "let-me-in" }),
    headers: { "Content-Type": "application/json" }
  });

  assert.equal(response.status, 201);
  const body = await response.json() as { is_admin: boolean };
  assert.equal(body.is_admin, true);
});

test("a wrong claim secret fails closed instead of silently downgrading", async () => {
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/auth", createAuthRoutes(deps([], [], settings({ ADMIN_CLAIM_SECRET: "let-me-in" }))));

  const response = await app.request("/api/auth/identify", {
    method: "POST",
    body: JSON.stringify({ nickname: "Sneaky", admin_secret: "wrong" }),
    headers: { "Content-Type": "application/json" }
  });

  assert.equal(response.status, 403);
});

test("registering without a secret stays a regular user", async () => {
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/auth", createAuthRoutes(deps([], [], settings({ ADMIN_CLAIM_SECRET: "let-me-in" }))));

  const response = await app.request("/api/auth/identify", {
    method: "POST",
    body: JSON.stringify({ nickname: "Member One" }),
    headers: { "Content-Type": "application/json" }
  });

  assert.equal(response.status, 201);
  const body = await response.json() as { is_admin: boolean };
  assert.equal(body.is_admin, false);
});

// ——— ENV-01（R12 人工验收打回）：identify/desktop-bootstrap 必须建默认工作区 active membership ———
function identifyCtx(seedUsers: UserAuthRow[] = []) {
  const runtimeSettings = settings();
  const memUsers = new MemoryUsers(seedUsers);
  const memberships = new MemoryMemberships();
  const authDeps: AuthDependencies = {
    users: memUsers,
    devices: new MemoryDevices([]),
    memberships,
    settings: runtimeSettings,
    now: () => now
  };
  return { deps: authDeps, memberships, users: memUsers, runtimeSettings };
}

test("ENV-01: identify creates a default workspace membership for a brand-new nickname user", async () => {
  const { deps: authDeps, memberships, runtimeSettings } = identifyCtx();
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/auth", createAuthRoutes(authDeps));

  const response = await app.request("/api/auth/identify", jsonPost({ nickname: "Nova" }));
  assert.equal(response.status, 201);

  assert.equal(memberships.rows.length, 1, "identify must create exactly one membership row");
  assert.equal(memberships.rows[0]?.workspaceId, runtimeSettings.auth.defaultWorkspaceId);
  assert.equal(memberships.rows[0]?.role, "member");
  assert.equal(memberships.rows[0]?.defaultWorkspace, true);
});

test("ENV-01: repeated identify for the same nickname stays idempotent (no duplicate membership row)", async () => {
  const { deps: authDeps, memberships } = identifyCtx();
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/auth", createAuthRoutes(authDeps));

  const first = await app.request("/api/auth/identify", jsonPost({ nickname: "Nova" }));
  assert.equal(first.status, 201);
  assert.equal(memberships.rows.length, 1);

  const second = await app.request("/api/auth/identify", jsonPost({ nickname: "Nova" }));
  assert.equal(second.status, 200, "returning nickname gets 200, not 201");
  assert.equal(memberships.rows.length, 1, "repeated identify must not create a duplicate membership row");
});

test("ENV-01: identify without a memberships seam wired stays a no-op (legacy runtime / fake repo without membership support)", async () => {
  // deps() 助手默认不带 memberships——回归防护：老运行时/未注入成员仓库时 identify 依旧成功，
  // 不因缺失可选 seam 而抛错。
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/auth", createAuthRoutes(deps([], [])));

  const response = await app.request("/api/auth/identify", jsonPost({ nickname: "Nova" }));
  assert.equal(response.status, 201);
});

test("ENV-01: identify for a user with an existing active membership does not duplicate or overwrite it", async () => {
  const alice = user({ nickname: "alice" });
  const { deps: authDeps, memberships, runtimeSettings } = identifyCtx([alice]);
  await memberships.create({
    workspaceId: runtimeSettings.auth.defaultWorkspaceId,
    userId: alice.id,
    role: "owner",
    defaultWorkspace: true
  });
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/auth", createAuthRoutes(authDeps));

  const response = await app.request("/api/auth/identify", jsonPost({ nickname: "alice" }));
  assert.equal(response.status, 200);
  assert.equal(memberships.rows.length, 1, "must not create a duplicate row for an already-member user");
  assert.equal(memberships.rows[0]?.role, "owner", "must not overwrite the existing role");
});

test("ENV-01: identify does not set a second default-workspace row when the user already has a default elsewhere", async () => {
  const alice = user({ nickname: "alice" });
  const { deps: authDeps, memberships, runtimeSettings } = identifyCtx([alice]);
  const otherWorkspaceId = "70000000-0000-4000-8000-000000000099";
  await memberships.create({ workspaceId: otherWorkspaceId, userId: alice.id, role: "member", defaultWorkspace: true });
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/auth", createAuthRoutes(authDeps));

  const response = await app.request("/api/auth/identify", jsonPost({ nickname: "alice" }));
  assert.equal(response.status, 200);
  assert.equal(memberships.rows.length, 2, "adds a membership row in the default workspace too");
  const defaultWsRow = memberships.rows.find((row) => row.workspaceId === runtimeSettings.auth.defaultWorkspaceId);
  assert.equal(
    defaultWsRow?.defaultWorkspace,
    false,
    "must not set a second default row and violate the partial unique index (workspace_memberships_user_default_uq)"
  );
});

test("ENV-01: desktop-bootstrap also creates a default workspace membership for the bootstrapped user", async () => {
  const { deps: authDeps, memberships, runtimeSettings } = identifyCtx();
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/auth", createAuthRoutes(authDeps));

  const response = await app.request("/api/auth/desktop-bootstrap", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ nickname: "Desktop Nova", device_name: "Nova's Mac", platform: "desktop" })
  });

  assert.equal(response.status, 201);
  assert.equal(memberships.rows.length, 1);
  assert.equal(memberships.rows[0]?.workspaceId, runtimeSettings.auth.defaultWorkspaceId);
  assert.equal(memberships.rows[0]?.role, "member");
  assert.equal(memberships.rows[0]?.defaultWorkspace, true);
});

test("ENV-01: identify degrades to no membership (not a 500) when the default workspace row is missing (FK violation)", async () => {
  // pilot-stack-smoke 病根回归钉：migrate-only 库里 workspaces 表为空，memberships.create 撞 FK
  //（PG code 23503）。identify 必须照常登录成功，而不是把 FK 违约冒泡成 500。
  const { deps: authDeps, memberships } = identifyCtx();
  memberships.create = async () => {
    const error = new Error('insert or update on table "workspace_memberships" violates foreign key constraint');
    (error as Error & { code?: string }).code = "23503";
    throw error;
  };
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/auth", createAuthRoutes(authDeps));

  const response = await app.request("/api/auth/identify", jsonPost({ nickname: "Nova" }));
  assert.equal(response.status, 201, "identify must succeed even when the membership backfill hits a missing workspace");
  assert.equal(memberships.rows.length, 0);
});

// ——— SEC-1（P0-01）：被移出成员的墓碑不得被 identify 复活 ———
test("SEC-1: identify does not revive a removed member's tombstone and denies with 403 workspace_access_revoked", async () => {
  const alice = user({ nickname: "alice" });
  const { deps: authDeps, memberships, runtimeSettings } = identifyCtx([alice]);
  const created = await memberships.create({
    workspaceId: runtimeSettings.auth.defaultWorkspaceId,
    userId: alice.id,
    role: "member",
    defaultWorkspace: true
  });
  await memberships.softDelete(created.id, now); // 管理员移出 → 软删墓碑
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/auth", createAuthRoutes(authDeps));

  const response = await app.request("/api/auth/identify", jsonPost({ nickname: "alice" }));

  assert.equal(response.status, 403, "identify for a removed member must fail closed");
  const body = (await response.json()) as { error?: { code?: string } };
  assert.equal(body.error?.code, "workspace_access_revoked");
  // 墓碑不复活：不得新建 active 成员行（恢复须走管理员显式动作）。
  assert.equal(
    memberships.rows.filter((row) => row.deletedAt === null).length,
    0,
    "identify must not re-create an active membership for a removed member"
  );
});

test("findings: malformed JSON body to /identify returns malformed_json, not a generic 400", async () => {
  const app = withProductionHttpErrors(new Hono<AuthEnv>());
  app.route("/api/auth", createAuthRoutes(deps([], [], settings())));

  const response = await app.request("/api/auth/identify", {
    method: "POST",
    body: "{not valid json",
    headers: { "Content-Type": "application/json" }
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

test("identity exposes and updates the bilingual locale preference", async () => {
  const alice = user();
  const runtimeSettings = settings();
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/auth", createAuthRoutes(deps([alice], [], runtimeSettings)));
  const cookie = await signedCookie(alice.cookieToken, runtimeSettings);

  const before = await app.request("/api/auth/me", {
    headers: { Cookie: cookie }
  });
  assert.equal(before.status, 200);
  const beforeBody = await before.json() as { preferences: { locale: string } };
  assert.equal(beforeBody.preferences.locale, "zh-CN");

  const updated = await app.request("/api/auth/preferences", {
    method: "PATCH",
    body: JSON.stringify({ locale: "en" }),
    headers: { Cookie: cookie, "Content-Type": "application/json" }
  });
  assert.equal(updated.status, 200);
  const updatedBody = await updated.json() as { locale: string };
  assert.equal(updatedBody.locale, "en-US");

  const after = await app.request("/api/auth/me", {
    headers: { Cookie: cookie }
  });
  const body = await after.json() as { locale: string; preferences: { locale: string } };
  assert.equal(body.locale, "en-US");
  assert.equal(body.preferences.locale, "en-US");
});

test("nickname validation rejects tombstones and controls but allows non-ASCII names", () => {
  assert.throws(() => validateNickname("_deleted_alice"));
  assert.throws(() => validateNickname("alice\nbob"));
  assert.equal(validateNickname(" 小云✨ "), "小云✨");
});

test("logout rotates the cookie token and revokes only the presented client token", async () => {
  const alice = user();
  const currentDevice = device();
  const authDeps = deps([alice], [currentDevice]);
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/auth", createAuthRoutes(authDeps));

  const response = await app.request("/api/auth/logout", {
    method: "POST",
    headers: { [LOCAL_CLIENT_HEADER]: "client-token-alice" }
  });

  assert.equal(response.status, 200);
  assert.notEqual(alice.cookieToken, "cookie-alice");
  assert.equal(currentDevice.revokedAt?.toISOString(), now.toISOString());
});

test("logout revokes devices presented through the branded WorkHub client token header", async () => {
  const alice = user();
  const currentDevice = device();
  const authDeps = deps([alice], [currentDevice]);
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/auth", createAuthRoutes(authDeps));

  const response = await app.request("/api/auth/logout", {
    method: "POST",
    headers: { "X-WorkHub-Client-Token": "client-token-alice" }
  });

  assert.equal(response.status, 200);
  assert.equal(currentDevice.revokedAt?.toISOString(), now.toISOString());
});

test("logout does not revoke a different user's session cookie when a client token wins identity", async () => {
  const runtimeSettings = settings({ AUTH_MODE: "password" });
  const alice = user({ id: "10000000-0000-4000-8000-0000000000f1", nickname: "alice-token" });
  const bob = user({ id: "10000000-0000-4000-8000-0000000000f2", nickname: "bob-cookie" });
  const currentDevice = device({ userId: alice.id });
  const sessions = new MemorySessions();
  const bobSessionToken = "bob-session-token";
  const bobSession = await sessions.create({
    userId: bob.id,
    tokenHash: hashSessionToken(bobSessionToken),
    authMethod: "password",
    absoluteExpiresAt: new Date(now.getTime() + 60_000),
    idleExpiresAt: new Date(now.getTime() + 60_000)
  });
  const authDeps: AuthDependencies = {
    users: new MemoryUsers([alice, bob]),
    devices: new MemoryDevices([currentDevice]),
    sessions,
    credentials: new MemoryCredentials(),
    memberships: new MemoryMemberships(),
    settings: runtimeSettings,
    now: () => now
  };
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/auth", createAuthRoutes(authDeps));

  const response = await app.request("/api/auth/logout", {
    method: "POST",
    headers: {
      [LOCAL_CLIENT_HEADER]: "client-token-alice",
      Cookie: await signedCookie(bobSessionToken, runtimeSettings)
    }
  });

  assert.equal(response.status, 200);
  assert.equal(currentDevice.revokedAt?.toISOString(), now.toISOString());
  assert.equal(bobSession.revokedAt, null, "logout must not revoke a session belonging to the cookie identity");
});

test("stream identity resolves without a request-scoped DB session concept", async () => {
  const alice = user();
  const authDeps = deps([alice], [device()]);
  const app = new Hono<AuthEnv>();
  app.get("/stream-user", async (c) => c.json(await resolveStreamUser(c, authDeps)));

  const response = await app.request("/stream-user", {
    headers: { [LOCAL_CLIENT_HEADER]: "client-token-alice" }
  });

  assert.equal(response.status, 200);
  // findings[#tenancy]：StreamUser 现携带认证身份解析出的租户（用于按工作区隔离全局流）。
  // 无成员仓库 → 回退单租户默认 org/workspace，与今天行为等价。
  assert.deepEqual(await response.json(), {
    id: alice.id,
    nickname: alice.nickname,
    isAdmin: false,
    orgId: "00000000-0000-4000-8000-000000000001",
    workspaceId: "00000000-0000-4000-8000-000000000002"
  });
});

test("AI actor construction is first-class and never touches cookie auth", () => {
  const actor = createAiActor("run-123", "AI worker", settings());

  assert.deepEqual(actor, {
    kind: "ai",
    id: "run-123",
    label: "AI worker",
    isAdmin: false,
    orgId: "00000000-0000-4000-8000-000000000001",
    workspaceId: "00000000-0000-4000-8000-000000000002"
  });
});

// ——— R2 auth epic Phase 2b：AUTH_MODE 会话 cookie 解析 ———

test("AUTH_MODE=password resolves a session-secret cookie and slides idle expiry", async () => {
  const runtimeSettings = settings({ AUTH_MODE: "password" });
  const alice = user({ nickname: "alice" });
  const sessions = new MemorySessions();
  const authDeps: AuthDependencies = { ...deps([alice], [], runtimeSettings), sessions };
  const { token, session } = await mintSession(authDeps, alice, { authMethod: "password" });

  const app = withErrors(new Hono<AuthEnv>());
  app.get("/who", createCurrentUserMiddleware(authDeps), (c) => c.json({ id: c.var.currentUser.id }));
  const res = await app.request("/who", { headers: { Cookie: await signedCookie(token, runtimeSettings) } });

  assert.equal(res.status, 200);
  assert.equal(((await res.json()) as { id: string }).id, alice.id);
  assert.ok(sessions.touched.includes(session.id), "每次鉴权应滑动续期会话");
});

test("AUTH_MODE=password rejects revoked and idle-expired sessions", async () => {
  const runtimeSettings = settings({ AUTH_MODE: "password" });
  const alice = user({ nickname: "alice" });
  const sessions = new MemorySessions();
  const authDeps: AuthDependencies = { ...deps([alice], [], runtimeSettings), sessions };

  const revoked = await mintSession(authDeps, alice);
  await sessions.revoke(revoked.session.id, now);

  const expired = await mintSession(authDeps, alice);
  const expiredRow = sessions.rows.find((row) => row.id === expired.session.id);
  assert.ok(expiredRow);
  expiredRow.idleExpiresAt = new Date(now.getTime() - 1000); // 滑动已过期

  const app = withErrors(new Hono<AuthEnv>());
  app.get("/who", createCurrentUserMiddleware(authDeps), (c) => c.json({ id: c.var.currentUser.id }));

  const revokedRes = await app.request("/who", { headers: { Cookie: await signedCookie(revoked.token, runtimeSettings) } });
  assert.equal(revokedRes.status, 401);
  const expiredRes = await app.request("/who", { headers: { Cookie: await signedCookie(expired.token, runtimeSettings) } });
  assert.equal(expiredRes.status, 401);
});

test("AUTH_MODE=password is session-only and ignores the legacy cookieToken", async () => {
  const runtimeSettings = settings({ AUTH_MODE: "password" });
  const alice = user({ nickname: "alice" });
  const sessions = new MemorySessions();
  const authDeps: AuthDependencies = { ...deps([alice], [], runtimeSettings), sessions };

  const app = withErrors(new Hono<AuthEnv>());
  app.get("/who", createCurrentUserMiddleware(authDeps), (c) => c.json({ id: c.var.currentUser.id }));
  // 老的 cookieToken 不再是会话凭据 → 纯 session 模式拒绝。
  const res = await app.request("/who", { headers: { Cookie: await signedCookie(alice.cookieToken, runtimeSettings) } });
  assert.equal(res.status, 401);
});

test("AUTH_MODE=nickname (default) ignores session cookies — gate is off", async () => {
  const runtimeSettings = settings(); // 默认 nickname
  const alice = user({ nickname: "alice" });
  const sessions = new MemorySessions();
  const authDeps: AuthDependencies = { ...deps([alice], [], runtimeSettings), sessions };
  const { token } = await mintSession(authDeps, alice);

  const app = withErrors(new Hono<AuthEnv>());
  app.get("/who", createCurrentUserMiddleware(authDeps), (c) => c.json({ id: c.var.currentUser.id }));
  // 即便存在会话且 cookie 载会话 secret，nickname 模式只认 cookieToken → 会话被忽略。
  const sessionRes = await app.request("/who", { headers: { Cookie: await signedCookie(token, runtimeSettings) } });
  assert.equal(sessionRes.status, 401);
  // 老路径 cookieToken 仍照常工作（逐字节不变）。
  const cookieRes = await app.request("/who", { headers: { Cookie: await signedCookie(alice.cookieToken, runtimeSettings) } });
  assert.equal(cookieRes.status, 200);
});

test("AUTH_MODE=hybrid resolves sessions and falls back to the legacy cookieToken", async () => {
  const runtimeSettings = settings({ AUTH_MODE: "hybrid" });
  const alice = user({ nickname: "alice" });
  const sessions = new MemorySessions();
  const authDeps: AuthDependencies = { ...deps([alice], [], runtimeSettings), sessions };
  const { token } = await mintSession(authDeps, alice);

  const app = withErrors(new Hono<AuthEnv>());
  app.get("/who", createCurrentUserMiddleware(authDeps), (c) => c.json({ id: c.var.currentUser.id }));
  const sessionRes = await app.request("/who", { headers: { Cookie: await signedCookie(token, runtimeSettings) } });
  assert.equal(sessionRes.status, 200);
  // 迁移期：尚未签发会话的老用户继续靠 cookieToken 进。
  const cookieRes = await app.request("/who", { headers: { Cookie: await signedCookie(alice.cookieToken, runtimeSettings) } });
  assert.equal(cookieRes.status, 200);
});

test("AUTH_MODE=hybrid disables the public nickname identify entrypoint", async () => {
  const runtimeSettings = settings({ AUTH_MODE: "hybrid" });
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/auth", createAuthRoutes(deps([], [], runtimeSettings)));

  const response = await app.request("/api/auth/identify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nickname: "legacy-login" })
  });

  assert.equal(response.status, 404);
});

test("issueSessionCookie round-trips through resolveCurrentUser in password mode", async () => {
  const runtimeSettings = settings({ AUTH_MODE: "password" });
  const alice = user({ nickname: "alice" });
  const sessions = new MemorySessions();
  const authDeps: AuthDependencies = { ...deps([alice], [], runtimeSettings), sessions };

  const app = withErrors(new Hono<AuthEnv>());
  app.post("/login", async (c) => {
    const { token } = await mintSession(authDeps, alice, { authMethod: "password" });
    await issueSessionCookie(c, token, runtimeSettings);
    return c.json({ ok: true });
  });
  app.get("/who", createCurrentUserMiddleware(authDeps), (c) => c.json({ id: c.var.currentUser.id }));

  const loginRes = await app.request("/login", { method: "POST" });
  const setCookie = loginRes.headers.get("set-cookie");
  assert.ok(setCookie, "login should set the session cookie");
  const cookiePair = setCookie.split(";")[0] ?? "";
  const whoRes = await app.request("/who", { headers: { Cookie: cookiePair } });
  assert.equal(whoRes.status, 200);
  assert.equal(((await whoRes.json()) as { id: string }).id, alice.id);
});

test("resolveStreamUser resolves a session cookie in password mode", async () => {
  const runtimeSettings = settings({ AUTH_MODE: "password" });
  const alice = user({ nickname: "alice" });
  const sessions = new MemorySessions();
  const authDeps: AuthDependencies = { ...deps([alice], [], runtimeSettings), sessions };
  const { token } = await mintSession(authDeps, alice);

  const app = withErrors(new Hono<AuthEnv>());
  app.get("/stream", async (c) => c.json(await resolveStreamUser(c, authDeps)));
  const res = await app.request("/stream", { headers: { Cookie: await signedCookie(token, runtimeSettings) } });
  assert.equal(res.status, 200);
  assert.equal(((await res.json()) as { nickname: string }).nickname, "alice");
});

// ——— R2 auth epic Phase 3b：密码注册/登录/登出路由 ———

function passwordCtx(seedUsers: UserAuthRow[] = [], seedDevices: ClientDeviceAuthRow[] = []) {
  const runtimeSettings = settings({ AUTH_MODE: "password" });
  const memUsers = new MemoryUsers(seedUsers);
  const devices = new MemoryDevices(seedDevices);
  const sessions = new MemorySessions();
  const credentials = new MemoryCredentials();
  const memberships = new MemoryMemberships();
  const deps: AuthDependencies = {
    users: memUsers,
    devices,
    sessions,
    credentials,
    memberships,
    settings: runtimeSettings,
    now: () => now
  };
  return { deps, devices, sessions, credentials, memberships, users: memUsers, runtimeSettings };
}

function jsonPost(body: unknown) {
  return { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

test("POST /register bootstraps the first user as admin and sets a resolvable session cookie", async () => {
  const { deps, credentials, memberships, runtimeSettings } = passwordCtx();
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/auth", createAuthRoutes(deps));
  app.get("/who", createCurrentUserMiddleware(deps), (c) =>
    c.json({ id: c.var.currentUser.id, admin: c.var.currentUser.isAdmin })
  );

  const res = await app.request("/auth/register", jsonPost({
    email: "Founder@Example.com",
    password: "founder-pass-1",
    nickname: "Founder"
  }));
  assert.equal(res.status, 201);
  const body = (await res.json()) as { is_admin: boolean };
  assert.equal(body.is_admin, true, "首个注册者自举为 admin");
  assert.equal(credentials.rows.length, 1);
  assert.equal(memberships.rows.length, 1);
  assert.equal(memberships.rows[0]?.workspaceId, runtimeSettings.auth.defaultWorkspaceId);
  assert.equal(memberships.rows[0]?.role, "owner");
  assert.equal(memberships.rows[0]?.defaultWorkspace, true);

  const setCookie = res.headers.get("set-cookie");
  assert.ok(setCookie, "register should set a session cookie");
  const cookiePair = setCookie.split(";")[0] ?? "";
  const who = await app.request("/who", { headers: { Cookie: cookiePair } });
  assert.equal(who.status, 200);
  assert.equal(((await who.json()) as { admin: boolean }).admin, true);
});

test("POST /register does not auto-admin when an admin already exists, and rejects duplicate email (409)", async () => {
  const boss = user({ id: "10000000-0000-4000-8000-0000000000ad", nickname: "boss", isAdmin: true });
  const { deps, memberships, runtimeSettings } = passwordCtx([boss]);
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/auth", createAuthRoutes(deps));

  const first = await app.request("/auth/register", jsonPost({
    email: "member@example.com",
    password: "member-pass-1",
    nickname: "Member"
  }));
  assert.equal(first.status, 201);
  assert.equal(((await first.json()) as { is_admin: boolean }).is_admin, false, "已有 admin → 不自举");
  assert.equal(memberships.rows.length, 1);
  assert.equal(memberships.rows[0]?.workspaceId, runtimeSettings.auth.defaultWorkspaceId);
  assert.equal(memberships.rows[0]?.role, "member");
  assert.equal(memberships.rows[0]?.defaultWorkspace, true);

  // 同邮箱（大小写不同，验 citext 语义）→ 409
  const dup = await app.request("/auth/register", jsonPost({
    email: "Member@Example.com",
    password: "another-pass-1",
    nickname: "Member Two"
  }));
  assert.equal(dup.status, 409);
});

test("POST /register and /login are 404 in nickname mode (gate off by default)", async () => {
  const memUsers = new MemoryUsers([]);
  const deps: AuthDependencies = {
    users: memUsers,
    devices: new MemoryDevices([]),
    sessions: new MemorySessions(),
    credentials: new MemoryCredentials(),
    settings: settings(), // 默认 nickname
    now: () => now
  };
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/auth", createAuthRoutes(deps));

  const reg = await app.request("/auth/register", jsonPost({ email: "x@example.com", password: "pw-123456", nickname: "X" }));
  assert.equal(reg.status, 404);
  const login = await app.request("/auth/login", jsonPost({ email: "x@example.com", password: "pw-123456" }));
  assert.equal(login.status, 404);
});

test("POST /login succeeds with the right password and rejects the wrong one (401, generic)", async () => {
  const alice = user({ id: "10000000-0000-4000-8000-0000000000a1", nickname: "alice" });
  const { deps, credentials, memberships, runtimeSettings } = passwordCtx([alice]);
  credentials.rows.push(
    credentialRow({
      userId: alice.id,
      email: "alice@example.com",
      passwordHash: await hashPassword("alice-secret-1"),
      passwordAlgo: "scrypt"
    })
  );
  // SEC-1：种子用户绕过注册直接落库，须补默认工作区成员行，否则 resolveHumanActor fail-closed（生产中登录用户必是成员）。
  await memberships.create({ workspaceId: runtimeSettings.auth.defaultWorkspaceId, userId: alice.id, role: "member", defaultWorkspace: true });
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/auth", createAuthRoutes(deps));
  app.get("/who", createCurrentUserMiddleware(deps), (c) => c.json({ id: c.var.currentUser.id }));

  const okRes = await app.request("/auth/login", jsonPost({ email: "Alice@Example.com", password: "alice-secret-1" }));
  assert.equal(okRes.status, 200);
  const setCookie = okRes.headers.get("set-cookie");
  assert.ok(setCookie);
  const who = await app.request("/who", { headers: { Cookie: setCookie.split(";")[0] ?? "" } });
  assert.equal(who.status, 200);

  const badRes = await app.request("/auth/login", jsonPost({ email: "alice@example.com", password: "wrong-secret" }));
  assert.equal(badRes.status, 401);
  assert.equal((await credentials.findByUserId(alice.id))?.failedAttempts, 1, "wrong password records a failed attempt");
});

test("POST /login returns 401 for an unknown email and 429 once locked out", async () => {
  const bob = user({ id: "10000000-0000-4000-8000-0000000000b2", nickname: "bob" });
  const { deps, credentials } = passwordCtx([bob]);
  const seeded = credentialRow({
    userId: bob.id,
    email: "bob@example.com",
    passwordHash: await hashPassword("bob-secret-1"),
    passwordAlgo: "scrypt"
  });
  seeded.failedAttempts = 9; // 再失败一次即达上限锁定
  credentials.rows.push(seeded);
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/auth", createAuthRoutes(deps));

  const unknown = await app.request("/auth/login", jsonPost({ email: "nobody@example.com", password: "whatever" }));
  assert.equal(unknown.status, 401);

  // 第 10 次失败 → 置锁定
  const trip = await app.request("/auth/login", jsonPost({ email: "bob@example.com", password: "wrong" }));
  assert.equal(trip.status, 401);
  // 现在即使密码正确也被锁 → 429
  const locked = await app.request("/auth/login", jsonPost({ email: "bob@example.com", password: "bob-secret-1" }));
  assert.equal(locked.status, 429);
});

test("POST /logout revokes the active session in password mode", async () => {
  const { deps, sessions } = passwordCtx();
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/auth", createAuthRoutes(deps));
  app.get("/who", createCurrentUserMiddleware(deps), (c) => c.json({ id: c.var.currentUser.id }));

  const reg = await app.request("/auth/register", jsonPost({
    email: "logout@example.com",
    password: "logout-pass-1",
    nickname: "Logouter"
  }));
  assert.equal(reg.status, 201);
  const cookiePair = (reg.headers.get("set-cookie") ?? "").split(";")[0] ?? "";

  // 登出前会话有效
  assert.equal((await app.request("/who", { headers: { Cookie: cookiePair } })).status, 200);
  assert.equal(sessions.rows.filter((row) => row.revokedAt === null).length, 1);

  const logout = await app.request("/auth/logout", { method: "POST", headers: { Cookie: cookiePair } });
  assert.equal(logout.status, 200);
  assert.equal(sessions.rows.filter((row) => row.revokedAt === null).length, 0, "logout should revoke the session");

  // 登出后同一 cookie 不再鉴权
  assert.equal((await app.request("/who", { headers: { Cookie: cookiePair } })).status, 401);
});

test("POST /password revokes other client device tokens but keeps the current local client", async () => {
  const alice = user({ id: "10000000-0000-4000-8000-0000000000c3", nickname: "alice" });
  const currentToken = "current-device-token";
  const otherToken = "other-device-token";
  const { deps, credentials, devices, memberships, runtimeSettings } = passwordCtx([
    alice
  ], [
    device({
      id: "20000000-0000-4000-8000-0000000000c1",
      userId: alice.id,
      clientTokenHash: hashClientToken(currentToken)
    }),
    device({
      id: "20000000-0000-4000-8000-0000000000c2",
      userId: alice.id,
      clientTokenHash: hashClientToken(otherToken)
    })
  ]);
  credentials.rows.push(credentialRow({
    userId: alice.id,
    email: "alice@example.com",
    passwordHash: await hashPassword("old-pass-1"),
    passwordAlgo: "scrypt"
  }));
  // SEC-1：种子用户绕过注册，补默认工作区成员行以通过 resolveHumanActor（/who）。
  await memberships.create({ workspaceId: runtimeSettings.auth.defaultWorkspaceId, userId: alice.id, role: "member", defaultWorkspace: true });
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/auth", createAuthRoutes(deps));
  app.get("/who", createCurrentUserMiddleware(deps), (c) => c.json({ id: c.var.currentUser.id }));

  const response = await app.request("/auth/password", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      [LOCAL_CLIENT_HEADER]: currentToken
    },
    body: JSON.stringify({ current_password: "old-pass-1", new_password: "new-pass-1" })
  });

  assert.equal(response.status, 200);
  const rows = await devices.listByUser(alice.id);
  assert.equal(rows.find((row) => row.id.endsWith("c1"))?.revokedAt, null, "current local client remains usable");
  assert.notEqual(rows.find((row) => row.id.endsWith("c2"))?.revokedAt, null, "other local client is revoked");
  assert.equal((await app.request("/who", { headers: { [LOCAL_CLIENT_HEADER]: currentToken } })).status, 200);
  assert.equal((await app.request("/who", { headers: { [LOCAL_CLIENT_HEADER]: otherToken } })).status, 403);
});

// ——— R2 multi-tenancy epic Phase 2：从成员关系派生 actor 租户 ———

test("resolveHumanActor derives tenant from the user's default membership", async () => {
  const runtimeSettings = settings();
  const alice = user({ id: "10000000-0000-4000-8000-0000000000c1", nickname: "alice" });
  const workspaceId = "22220000-0000-4000-8000-000000000001";
  const orgId = "11110000-0000-4000-8000-000000000001";
  const memberships = new MemoryMemberships({ [workspaceId]: orgId });
  await memberships.create({ workspaceId, userId: alice.id, role: "owner", defaultWorkspace: true });

  const deps: AuthDependencies = {
    users: new MemoryUsers([alice]),
    devices: new MemoryDevices([]),
    memberships,
    settings: runtimeSettings,
    now: () => now
  };
  const actor = await resolveHumanActor(deps, alice);
  assert.equal(actor.workspaceId, workspaceId);
  assert.equal(actor.orgId, orgId);
  assert.equal(actor.userId, alice.id);
  assert.equal(actor.kind, "human");
  assert.deepEqual((actor as { roleIds?: readonly string[] }).roleIds, ["owner"]);
});

// SEC-1（P0-01）：memberships 仓库已接线（生产路径）却解析不到 active 成员行 → fail-closed 403，
// 绝不回退默认租户常量。取代旧「无成员行→默认 workspace」语义。
test("SEC-1: resolveHumanActor fails closed (403 workspace_access_revoked) when memberships are wired but no active row resolves", async () => {
  const runtimeSettings = settings();
  const alice = user({ nickname: "alice" });
  const deps: AuthDependencies = {
    users: new MemoryUsers([alice]),
    devices: new MemoryDevices([]),
    memberships: new MemoryMemberships(), // 接线但无 active 成员行
    settings: runtimeSettings,
    now: () => now
  };
  await assert.rejects(
    () => resolveHumanActor(deps, alice),
    (error: unknown) =>
      error instanceof WorkspaceMemberServiceError &&
      error.status === 403 &&
      error.code === "workspace_access_revoked"
  );
});

// SEC-1（P0-01）：被移出成员（membership 软删墓碑）即便持有仍有效的 nickname cookie，也必须 403。
// 移出只软删成员行，用户行与 cookieToken 仍活——靠 resolveHumanActor fail-closed（安全带）挡住。
test("SEC-1: a removed member with a still-valid cookie is denied 403 workspace_access_revoked", async () => {
  const runtimeSettings = settings();
  const alice = user({ nickname: "alice" });
  const workspaceId = runtimeSettings.auth.defaultWorkspaceId;
  const memberships = new MemoryMemberships();
  const created = await memberships.create({ workspaceId, userId: alice.id, role: "member", defaultWorkspace: true });
  await memberships.softDelete(created.id, now); // 管理员移出 → 软删墓碑
  const authDeps: AuthDependencies = {
    users: new MemoryUsers([alice]),
    devices: new MemoryDevices([]),
    memberships,
    settings: runtimeSettings,
    now: () => now
  };
  const app = withErrors(new Hono<AuthEnv>());
  app.get("/who", createCurrentUserMiddleware(authDeps), (c) => c.json({ id: c.var.currentUser.id }));

  const response = await app.request("/who", {
    headers: { Cookie: await signedCookie(alice.cookieToken, runtimeSettings) }
  });

  assert.equal(response.status, 403, "removed member must be denied even with a valid cookie");
  const body = (await response.json()) as { error?: { code?: string } };
  assert.equal(body.error?.code, "workspace_access_revoked");
});

test("resolveHumanActor uses the constant when no memberships repository is wired (today's default)", async () => {
  const runtimeSettings = settings();
  const alice = user({ nickname: "alice" });
  const deps: AuthDependencies = {
    users: new MemoryUsers([alice]),
    devices: new MemoryDevices([]),
    settings: runtimeSettings,
    now: () => now
  };
  const actor = await resolveHumanActor(deps, alice);
  assert.equal(actor.workspaceId, runtimeSettings.auth.defaultWorkspaceId);
  assert.equal(actor.orgId, runtimeSettings.auth.defaultOrgId);
});

// ——— R2 auth epic：账号生命周期-停用 ———

test("POST /users/:id/deactivate (admin) soft-deletes the user and revokes their sessions + devices", async () => {
  const runtimeSettings = settings();
  const admin = user({ id: "10000000-0000-4000-8000-0000000000d1", nickname: "admin", isAdmin: true });
  const target = user({ id: "10000000-0000-4000-8000-0000000000d2", nickname: "target", cookieToken: "cookie-target" });
  const sessions = new MemorySessions();
  const devices = new MemoryDevices([
    device({ id: "20000000-0000-4000-8000-0000000000d2", userId: target.id, clientTokenHash: hashClientToken("target-device") })
  ]);
  const users = new MemoryUsers([admin, target]);
  const deps: AuthDependencies = {
    users,
    devices,
    sessions,
    settings: runtimeSettings,
    now: () => now
  };
  await sessions.create({
    userId: target.id,
    tokenHash: "target-session-hash",
    authMethod: "password",
    absoluteExpiresAt: new Date(now.getTime() + 3_600_000),
    idleExpiresAt: new Date(now.getTime() + 1_800_000)
  });

  const app = withErrors(new Hono<AuthEnv>());
  app.route("/auth", createAuthRoutes(deps));

  const res = await app.request("/auth/users/" + target.id + "/deactivate", {
    method: "POST",
    headers: { Cookie: await signedCookie(admin.cookieToken, runtimeSettings) }
  });
  assert.equal(res.status, 200);
  assert.equal(await users.findActiveById(target.id), null, "target is soft-deleted");
  assert.equal(sessions.rows.filter((row) => row.userId === target.id && row.revokedAt === null).length, 0, "sessions revoked");
  const targetDevices = await devices.listByUser(target.id);
  assert.equal(targetDevices.every((d) => d.revokedAt !== null), true, "devices revoked");
});

test("P2-02: deactivate surfaces cleanup failure (does not fake success as { ok: true })", async () => {
  // 根因：停用善后（撤会话/设备/凭据/在线态）此前是尽力而为——中途失败被静默吞掉、仍回 200 ok:true，
  // 留下半清理态且无从感知。修复后：任一善后步失败 → 非 200 + 结构化告知失败步（不吞错伪装成功）。
  const runtimeSettings = settings();
  const admin = user({ id: "10000000-0000-4000-8000-0000000000d5", nickname: "admin", isAdmin: true });
  const target = user({ id: "10000000-0000-4000-8000-0000000000d6", nickname: "target", cookieToken: "cookie-target-cleanup" });
  const users = new MemoryUsers([admin, target]);
  const deps: AuthDependencies = {
    users,
    devices: new ThrowingCleanupDevices([]),
    sessions: new ThrowingCleanupSessions(),
    credentials: new ThrowingCleanupCredentials(),
    settings: runtimeSettings,
    now: () => now,
    forgetUser: () => {
      throw new Error("presence cleanup failed");
    }
  };
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/auth", createAuthRoutes(deps));

  const res = await app.request("/auth/users/" + target.id + "/deactivate", {
    method: "POST",
    headers: { Cookie: await signedCookie(admin.cookieToken, runtimeSettings) }
  });

  // 失败可见：不再伪装成功。账号墓碑已置（停用是权威动作），但善后未完成 → 500 + 失败步清单。
  assert.equal(res.status, 500, "incomplete cleanup surfaces as non-200 (no fake success)");
  const body = (await res.json()) as {
    ok: boolean;
    deactivated?: boolean;
    cleanup?: { complete: boolean; steps: Array<{ step: string; ok: boolean }> };
  };
  assert.equal(body.ok, false, "response is not ok when cleanup incomplete");
  assert.equal(body.deactivated, true, "tombstone is set even though cleanup is incomplete");
  assert.equal(body.cleanup?.complete, false, "cleanup reported as not complete");
  const failedSteps = (body.cleanup?.steps ?? []).filter((entry) => !entry.ok).map((entry) => entry.step);
  // 会话/设备/凭据/在线态四步都失败 → 都进失败清单（调用方可据此判断残留）。
  for (const step of ["credentials.delete_by_user", "sessions.revoke_all_for_user", "devices.revoke_for_user", "presence.forget_user"]) {
    assert.ok(failedSteps.includes(step), `failed step reported: ${step}`);
  }
  assert.equal(await users.findActiveById(target.id), null, "target is soft-deleted (tombstone) despite cleanup failure");
});

test("P2-02: deactivate cleanup is re-entrant — retry converges to fully-cleaned", async () => {
  // 根因：善后失败后没有可重入的重试路径——重发停用请求会因 softDelete 落空一律 404，半清理态永久卡住。
  // 修复后：墓碑存在时重发本请求即重跑幂等清理并收敛；某会话撤销瞬时失败 → 首发 500、残留会话；
  // 瞬时故障恢复后重发 → 200、会话/设备全撤、cleanup.complete。
  const runtimeSettings = settings();
  const admin = user({ id: "10000000-0000-4000-8000-0000000000d7", nickname: "admin", isAdmin: true });
  const target = user({ id: "10000000-0000-4000-8000-0000000000d8", nickname: "target", cookieToken: "cookie-target-retry" });
  const users = new MemoryUsers([admin, target]);
  const sessions = new FlakyCleanupSessions();
  const devices = new MemoryDevices([
    device({ id: "20000000-0000-4000-8000-0000000000d8", userId: target.id, clientTokenHash: hashClientToken("target-device-retry") })
  ]);
  const forgotten: string[] = [];
  const deps: AuthDependencies = {
    users,
    devices,
    sessions,
    settings: runtimeSettings,
    now: () => now,
    forgetUser: (userId) => {
      forgotten.push(userId);
    }
  };
  await sessions.create({
    userId: target.id,
    tokenHash: "target-retry-session-hash",
    authMethod: "password",
    absoluteExpiresAt: new Date(now.getTime() + 3_600_000),
    idleExpiresAt: new Date(now.getTime() + 1_800_000)
  });

  const app = withErrors(new Hono<AuthEnv>());
  app.route("/auth", createAuthRoutes(deps));
  const path = "/auth/users/" + target.id + "/deactivate";
  const cookie = await signedCookie(admin.cookieToken, runtimeSettings);

  // 首发：会话撤销瞬时失败 → 500、半清理态（墓碑已置但会话仍在）。
  const first = await app.request(path, { method: "POST", headers: { Cookie: cookie } });
  assert.equal(first.status, 500, "transient session-revoke failure surfaces as 500");
  assert.equal(await users.findActiveById(target.id), null, "target soft-deleted after first attempt");
  assert.equal(
    sessions.rows.filter((row) => row.userId === target.id && row.revokedAt === null).length,
    1,
    "half-cleaned: session still active because revoke step failed"
  );

  // 瞬时故障恢复，管理员重发同一停用请求（重试入口）——不再 404，重跑幂等清理收敛到全清理。
  sessions.fail = false;
  const retry = await app.request(path, { method: "POST", headers: { Cookie: cookie } });
  assert.equal(retry.status, 200, "retry succeeds once the transient failure clears");
  const retryBody = (await retry.json()) as { ok: boolean };
  assert.equal(retryBody.ok, true, "retry reports ok once cleanup is complete");
  // 收敛证据：残留会话/设备/在线态被彻底清干净。
  assert.equal(
    sessions.rows.filter((row) => row.userId === target.id && row.revokedAt === null).length,
    0,
    "converged: sessions revoked after retry"
  );
  const targetDevices = await devices.listByUser(target.id);
  assert.equal(targetDevices.every((d) => d.revokedAt !== null), true, "devices revoked after retry");
  assert.ok(forgotten.includes(target.id), "presence forgotten after retry");
});

test("POST /users/:id/deactivate hands over the target's active claims (unassign + audit) and leaves terminal items", async () => {
  const runtimeSettings = settings();
  const admin = user({ id: "10000000-0000-4000-8000-0000000000d3", nickname: "admin", isAdmin: true });
  const target = user({ id: "10000000-0000-4000-8000-0000000000d4", nickname: "target", cookieToken: "cookie-target-ho" });
  const workItems = new MemoryWorkItems([
    // 两条该用户认领中的非终态事项 → 应被退回（claimedByUserId 清空）。
    { id: "a0000000-0000-4000-8000-000000000001", claimedByUserId: target.id, status: "ai_working", deletedAt: null },
    { id: "a0000000-0000-4000-8000-000000000002", claimedByUserId: target.id, status: "in_review", deletedAt: null },
    // 终态事项（merged）→ 不动，保溯源「谁交付的」。
    { id: "a0000000-0000-4000-8000-000000000003", claimedByUserId: target.id, status: "merged", deletedAt: null },
    // 别人认领的非终态事项 → 不受影响。
    { id: "a0000000-0000-4000-8000-000000000004", claimedByUserId: admin.id, status: "ai_working", deletedAt: null }
  ]);
  const auditLogs = new MemoryAuditLogs();
  const deps: AuthDependencies = {
    users: new MemoryUsers([admin, target]),
    devices: new MemoryDevices([]),
    sessions: new MemorySessions(),
    workItems,
    auditLogs,
    settings: runtimeSettings,
    now: () => now
  };

  const app = withErrors(new Hono<AuthEnv>());
  app.route("/auth", createAuthRoutes(deps));

  const res = await app.request("/auth/users/" + target.id + "/deactivate", {
    method: "POST",
    headers: { Cookie: await signedCookie(admin.cookieToken, runtimeSettings) }
  });
  assert.equal(res.status, 200);

  // 该用户认领的两条非终态事项被退回可领取池。
  const byId = new Map(workItems.rows.map((row) => [row.id, row]));
  assert.equal(byId.get("a0000000-0000-4000-8000-000000000001")?.claimedByUserId, null, "active claim #1 unassigned");
  assert.equal(byId.get("a0000000-0000-4000-8000-000000000002")?.claimedByUserId, null, "active claim #2 unassigned");
  // 终态事项保持认领（不交接，保溯源）。
  assert.equal(byId.get("a0000000-0000-4000-8000-000000000003")?.claimedByUserId, target.id, "terminal item untouched");
  // 别人的认领不受影响。
  assert.equal(byId.get("a0000000-0000-4000-8000-000000000004")?.claimedByUserId, admin.id, "other user's claim untouched");

  // 每条退回的事项各写一笔审计：action / actor(admin) / entity(work_item) 都对。
  const handoverLogs = auditLogs.rows.filter((row) => row.action === "work_item.unassigned_on_offboarding");
  assert.equal(handoverLogs.length, 2, "one audit log per reassigned item");
  assert.equal(handoverLogs.every((row) => row.actorUserId === admin.id), true, "actor is the admin performing the deactivate");
  assert.equal(handoverLogs.every((row) => row.entityType === "work_item"), true, "entity is the work item");
  assert.deepEqual(
    handoverLogs.map((row) => row.entityId).sort(),
    ["a0000000-0000-4000-8000-000000000001", "a0000000-0000-4000-8000-000000000002"],
    "audit entityIds are exactly the reassigned items"
  );
});

// R21 加固（停用善后审计缺口）：仓储提供「退回+审计」原子入口时，路由必须优先走它（同一 db 事务，
// 审计写失败则退回一并回滚）——而不是先退回、再事后逐条写审计的裂缝写法。
class MemoryWorkItemsWithAtomicHandover extends MemoryWorkItems {
  public atomicCalls: Array<{ userId: string; actorUserId: string }> = [];
  // 模拟真库实现：事务内退回 + 逐项审计写到自己的 sink（不是路由的 auditLogs seam）。
  constructor(rows: FakeWorkItemClaim[], private readonly auditSink: MemoryAuditLogs, private readonly failWith?: Error) {
    super(rows);
  }

  async unassignActiveClaimsForUserWithAudit(input: { userId: string; at: Date; actorUserId: string }) {
    this.atomicCalls.push({ userId: input.userId, actorUserId: input.actorUserId });
    if (this.failWith) {
      // 模拟事务回滚：整步失败、不留任何半态（不退回、不写审计）。
      throw this.failWith;
    }
    const affected = await this.unassignActiveClaimsForUser(input.userId, input.at);
    for (const item of affected) {
      await this.auditSink.createAuditLog({
        actorKind: "human",
        actorUserId: input.actorUserId,
        entityType: "work_item",
        entityId: item.id,
        action: "work_item.unassigned_on_offboarding",
        detailJson: { offboarded_user_id: input.userId }
      });
    }
    return affected;
  }
}

test("POST /users/:id/deactivate prefers the atomic unassign+audit repository entry point when available", async () => {
  const runtimeSettings = settings();
  const admin = user({ id: "10000000-0000-4000-8000-0000000000d5", nickname: "admin", isAdmin: true });
  const target = user({ id: "10000000-0000-4000-8000-0000000000d6", nickname: "target", cookieToken: "cookie-target-at" });
  const repoAuditSink = new MemoryAuditLogs();
  const workItems = new MemoryWorkItemsWithAtomicHandover(
    [{ id: "a0000000-0000-4000-8000-000000000011", claimedByUserId: target.id, status: "ai_working", deletedAt: null }],
    repoAuditSink
  );
  const seamAuditLogs = new MemoryAuditLogs();
  const deps: AuthDependencies = {
    users: new MemoryUsers([admin, target]),
    devices: new MemoryDevices([]),
    sessions: new MemorySessions(),
    workItems,
    auditLogs: seamAuditLogs,
    settings: runtimeSettings,
    now: () => now
  };

  const app = withErrors(new Hono<AuthEnv>());
  app.route("/auth", createAuthRoutes(deps));

  const res = await app.request("/auth/users/" + target.id + "/deactivate", {
    method: "POST",
    headers: { Cookie: await signedCookie(admin.cookieToken, runtimeSettings) }
  });
  assert.equal(res.status, 200);

  // 原子入口被调用（带执行停用的管理员），退回照常生效。
  assert.deepEqual(workItems.atomicCalls, [{ userId: target.id, actorUserId: admin.id }]);
  assert.equal(workItems.rows[0]?.claimedByUserId, null, "claim handed back through the atomic path");
  // 审计随事务落在仓储侧（sink），路由不再经 seam 事后补写逐项审计（seam 上只剩账号级安全事件）。
  assert.equal(
    repoAuditSink.rows.filter((row) => row.action === "work_item.unassigned_on_offboarding").length,
    1,
    "per-item handover audit written inside the atomic entry point"
  );
  assert.equal(
    seamAuditLogs.rows.some((row) => row.action === "work_item.unassigned_on_offboarding"),
    false,
    "the route must not duplicate handover audits through the seam when the atomic path ran"
  );
});

test("POST /users/:id/deactivate reports an incomplete handover step when the atomic unassign+audit rolls back", async () => {
  const runtimeSettings = settings();
  const admin = user({ id: "10000000-0000-4000-8000-0000000000d7", nickname: "admin", isAdmin: true });
  const target = user({ id: "10000000-0000-4000-8000-0000000000d8", nickname: "target", cookieToken: "cookie-target-rb" });
  const repoAuditSink = new MemoryAuditLogs();
  const workItems = new MemoryWorkItemsWithAtomicHandover(
    [{ id: "a0000000-0000-4000-8000-000000000012", claimedByUserId: target.id, status: "ai_working", deletedAt: null }],
    repoAuditSink,
    new Error("audit insert failed inside the tx")
  );
  const deps: AuthDependencies = {
    users: new MemoryUsers([admin, target]),
    devices: new MemoryDevices([]),
    sessions: new MemorySessions(),
    workItems,
    auditLogs: new MemoryAuditLogs(),
    settings: runtimeSettings,
    now: () => now
  };

  const app = withErrors(new Hono<AuthEnv>());
  app.route("/auth", createAuthRoutes(deps));

  const res = await app.request("/auth/users/" + target.id + "/deactivate", {
    method: "POST",
    headers: { Cookie: await signedCookie(admin.cookieToken, runtimeSettings) }
  });
  // 善后未完成 → 500 offboard_cleanup_incomplete（重发本请求即重试）。
  assert.equal(res.status, 500);
  const body = await res.json() as { error: { code: string }; cleanup: { complete: boolean; steps: Array<{ step: string; ok: boolean }> } };
  assert.equal(body.error.code, "offboard_cleanup_incomplete");
  assert.equal(body.cleanup.steps.find((entry) => entry.step === "workitems.handover")?.ok, false);
  // 回滚语义：退回与审计要么同成、要么同败——这里同败，认领仍在、审计为空，重跑可真收敛。
  assert.equal(workItems.rows[0]?.claimedByUserId, target.id, "rollback leaves the claim in place");
  assert.equal(repoAuditSink.rows.length, 0, "rollback leaves no orphan audit rows");
});

test("POST /users/:id/deactivate rejects non-admins (403) and self-deactivation (400)", async () => {
  const runtimeSettings = settings();
  const admin = user({ id: "10000000-0000-4000-8000-0000000000e1", nickname: "admin", isAdmin: true });
  const member = user({ id: "10000000-0000-4000-8000-0000000000e2", nickname: "member", cookieToken: "cookie-member" });
  const deps: AuthDependencies = {
    users: new MemoryUsers([admin, member]),
    devices: new MemoryDevices([]),
    sessions: new MemorySessions(),
    settings: runtimeSettings,
    now: () => now
  };
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/auth", createAuthRoutes(deps));

  // 非管理员 → 403
  const byMember = await app.request("/auth/users/" + admin.id + "/deactivate", {
    method: "POST",
    headers: { Cookie: await signedCookie(member.cookieToken, runtimeSettings) }
  });
  assert.equal(byMember.status, 403);

  // 管理员停用自己 → 400
  const selfDeactivate = await app.request("/auth/users/" + admin.id + "/deactivate", {
    method: "POST",
    headers: { Cookie: await signedCookie(admin.cookieToken, runtimeSettings) }
  });
  assert.equal(selfDeactivate.status, 400);
});

test("POST /users/:id/deactivate with a non-uuid targetId returns 404 (not a 500 from PG 22P02)", async () => {
  const runtimeSettings = settings();
  const admin = user({ id: "10000000-0000-4000-8000-0000000000e3", nickname: "admin", isAdmin: true });
  const deps: AuthDependencies = {
    users: new MemoryUsers([admin]),
    devices: new MemoryDevices([]),
    sessions: new MemorySessions(),
    settings: runtimeSettings,
    now: () => now
  };
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/auth", createAuthRoutes(deps));

  const res = await app.request("/auth/users/not-a-uuid/deactivate", {
    method: "POST",
    headers: { Cookie: await signedCookie(admin.cookieToken, runtimeSettings) }
  });
  assert.equal(res.status, 404);
});

// ——— R2 auth epic：账号生命周期-改密 ———

test("POST /password changes the password, revokes old sessions, and reissues the current session", async () => {
  const alice = user({ id: "10000000-0000-4000-8000-0000000000f1", nickname: "alice" });
  const { deps, sessions, credentials, runtimeSettings } = passwordCtx([alice]);
  credentials.rows.push(
    credentialRow({
      userId: alice.id,
      email: "alice-change@example.com",
      passwordHash: await hashPassword("old-pass-1"),
      passwordAlgo: "scrypt"
    })
  );
  const { token, session } = await mintSession(deps, alice, { authMethod: "password" });

  const app = withErrors(new Hono<AuthEnv>());
  app.route("/auth", createAuthRoutes(deps));

  const res = await app.request("/auth/password", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: await signedCookie(token, runtimeSettings) },
    body: JSON.stringify({ current_password: "old-pass-1", new_password: "new-pass-2" })
  });
  assert.equal(res.status, 200);

  // 旧会话被撤销（含发起请求所用的那条）。
  const oldSession = sessions.rows.find((row) => row.id === session.id);
  assert.ok(oldSession && oldSession.revokedAt !== null, "old session revoked on password change");
  // 新会话 cookie 已签发。
  assert.ok(res.headers.get("set-cookie"), "a fresh session cookie is issued");
  // 凭据已更新为新密码。
  const updated = await credentials.findByUserId(alice.id);
  assert.equal(await verifyPassword("new-pass-2", updated?.passwordHash ?? ""), true);
  assert.equal(await verifyPassword("old-pass-1", updated?.passwordHash ?? ""), false);
});

test("POST /password rejects a wrong current password (403) and is 404 in nickname mode", async () => {
  const alice = user({ id: "10000000-0000-4000-8000-0000000000f2", nickname: "alice" });
  const { deps, credentials, runtimeSettings } = passwordCtx([alice]);
  credentials.rows.push(
    credentialRow({
      userId: alice.id,
      email: "alice-wrong@example.com",
      passwordHash: await hashPassword("real-pass-1"),
      passwordAlgo: "scrypt"
    })
  );
  const { token } = await mintSession(deps, alice, { authMethod: "password" });
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/auth", createAuthRoutes(deps));

  const wrong = await app.request("/auth/password", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: await signedCookie(token, runtimeSettings) },
    body: JSON.stringify({ current_password: "guessed-wrong", new_password: "new-pass-2" })
  });
  assert.equal(wrong.status, 403);

  // nickname 模式：路由 404（密码功能未启用）。
  const nicknameSettings = settings();
  const nicknameDeps: AuthDependencies = {
    users: new MemoryUsers([alice]),
    devices: new MemoryDevices([]),
    sessions: new MemorySessions(),
    credentials: new MemoryCredentials(),
    settings: nicknameSettings,
    now: () => now
  };
  const nicknameApp = withErrors(new Hono<AuthEnv>());
  nicknameApp.route("/auth", createAuthRoutes(nicknameDeps));
  const gated = await nicknameApp.request("/auth/password", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: await signedCookie(alice.cookieToken, nicknameSettings) },
    body: JSON.stringify({ current_password: "x", new_password: "new-pass-2" })
  });
  assert.equal(gated.status, 404);
});

// ——— R2 auth epic：邀请路由（out-of-band create + accept） ———

function inviteCtx(adminUser: UserAuthRow) {
  const runtimeSettings = settings({ AUTH_MODE: "password" });
  const users = new MemoryUsers([adminUser]);
  const sessions = new MemorySessions();
  const credentials = new MemoryCredentials();
  const memberships = new MemoryMemberships();
  const invites = new MemoryInvites();
  const deps: AuthDependencies = {
    users,
    devices: new MemoryDevices([]),
    sessions,
    credentials,
    memberships,
    invites,
    settings: runtimeSettings,
    now: () => now
  };
  return { deps, users, sessions, credentials, memberships, invites, runtimeSettings };
}

test("invite create→accept end-to-end builds an account, credential, default membership, and session", async () => {
  const admin = user({ id: "10000000-0000-4000-8000-0000000000aa", nickname: "admin", isAdmin: true });
  const { deps, credentials, memberships, invites, runtimeSettings } = inviteCtx(admin);
  // SEC-1：创建邀请要经 resolveHumanActor 派生工作区——生产中创建邀请的管理员必是 active 成员，测试同构预置。
  await memberships.create({ workspaceId: runtimeSettings.auth.defaultWorkspaceId, userId: admin.id, role: "owner", defaultWorkspace: true });
  const { token: adminToken } = await mintSession(deps, admin, { authMethod: "password" });

  const app = withErrors(new Hono<AuthEnv>());
  app.route("/auth", createAuthRoutes(deps));

  const createRes = await app.request("/auth/invites", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: await signedCookie(adminToken, runtimeSettings) },
    body: JSON.stringify({ email: "Newbie@Example.com" })
  });
  assert.equal(createRes.status, 201);
  const inviteToken = ((await createRes.json()) as { token: string }).token;
  assert.ok(inviteToken && inviteToken.length > 0, "create returns a one-time token");

  const acceptRes = await app.request("/auth/invites/accept", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: inviteToken, nickname: "Newbie", password: "newbie-pass-1" })
  });
  assert.equal(acceptRes.status, 201);
  assert.ok(acceptRes.headers.get("set-cookie"), "accept mints a session cookie");
  assert.ok(await credentials.findByEmail("newbie@example.com"), "credential created with the invited email (citext)");
  assert.equal(memberships.rows.some((m) => m.defaultWorkspace && m.role === "member"), true, "default membership created");
  assert.equal(invites.rows[0]?.acceptedAt !== null, true, "invite marked accepted (cannot be reused)");
});

test("invite accept rejects an invalid token (404); create requires admin (403)", async () => {
  const admin = user({ id: "10000000-0000-4000-8000-0000000000ab", nickname: "admin", isAdmin: true });
  const member = user({ id: "10000000-0000-4000-8000-0000000000ac", nickname: "member" });
  const { deps, users, runtimeSettings } = inviteCtx(admin);
  (users as unknown as { rows: UserAuthRow[] }).rows.push(member);
  const { token: memberToken } = await mintSession(deps, member, { authMethod: "password" });

  const app = withErrors(new Hono<AuthEnv>());
  app.route("/auth", createAuthRoutes(deps));

  const badAccept = await app.request("/auth/invites/accept", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: "not-a-real-invite-token", nickname: "Ghost", password: "ghost-pass-1" })
  });
  assert.equal(badAccept.status, 404);

  const badLinkWithBadForm = await app.request("/auth/invites/accept", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: "not-a-real-invite-token", nickname: "", password: "short" })
  });
  assert.equal(badLinkWithBadForm.status, 404);

  const byMember = await app.request("/auth/invites", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: await signedCookie(memberToken, runtimeSettings) },
    body: JSON.stringify({ email: "x@example.com" })
  });
  assert.equal(byMember.status, 403);
});

test("invite create derives tenant and role from the server-side admin context", async () => {
  const admin = user({ id: "10000000-0000-4000-8000-0000000000ad", nickname: "admin", isAdmin: true });
  const { deps, memberships, invites, runtimeSettings } = inviteCtx(admin);
  await memberships.create({
    workspaceId: "22220000-0000-4000-8000-0000000000ad",
    userId: admin.id,
    role: "owner",
    defaultWorkspace: true
  });
  const { token: adminToken } = await mintSession(deps, admin, { authMethod: "password" });

  const app = withErrors(new Hono<AuthEnv>());
  app.route("/auth", createAuthRoutes(deps));

  const response = await app.request("/auth/invites", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: await signedCookie(adminToken, runtimeSettings) },
    body: JSON.stringify({
      email: "tenant-escape@example.com",
      role: "owner",
      workspace_id: "33330000-0000-4000-8000-0000000000ad"
    })
  });

  assert.equal(response.status, 201);
  assert.equal(invites.rows[0]?.role, "member");
  assert.equal(invites.rows[0]?.workspaceId, "22220000-0000-4000-8000-0000000000ad");
});

// R18 批 H1：GET /api/auth/invites?status=pending —— 列未过期邀请（未接受∧未撤销∧未过期），绝不回 token。
test("invite list returns pending invites without tokens, excluding accepted/revoked/expired", async () => {
  const admin = user({ id: "10000000-0000-4000-8000-0000000000ae", nickname: "admin", isAdmin: true });
  const { deps, invites, memberships, runtimeSettings } = inviteCtx(admin);
  const workspaceId = runtimeSettings.auth.defaultWorkspaceId;
  // SEC-1：列邀请要经 resolveHumanActor 派生工作区——管理员须为 active 成员，测试同构预置。
  await memberships.create({ workspaceId, userId: admin.id, role: "owner", defaultWorkspace: true });
  const { token: adminToken } = await mintSession(deps, admin, { authMethod: "password" });

  const app = withErrors(new Hono<AuthEnv>());
  app.route("/auth", createAuthRoutes(deps));
  const cookie = await signedCookie(adminToken, runtimeSettings);

  // 一条活跃邀请（POST 创建，workspaceId = actor 默认工作区）。
  const createRes = await app.request("/auth/invites", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ email: "pending@example.com" })
  });
  assert.equal(createRes.status, 201);
  // 一条已过期、一条已接受、一条已撤销——都不该出现在清单里。
  await invites.create({ email: "expired@example.com", tokenHash: "hash-expired", workspaceId, expiresAt: new Date(now.getTime() - 1000) });
  const accepted = await invites.create({ email: "accepted@example.com", tokenHash: "hash-accepted", workspaceId, expiresAt: new Date(now.getTime() + 1_000_000) });
  await invites.accept(accepted.id, admin.id, now);
  const revoked = await invites.create({ email: "revoked@example.com", tokenHash: "hash-revoked", workspaceId, expiresAt: new Date(now.getTime() + 1_000_000) });
  await invites.revoke(revoked.id, now);

  const listRes = await app.request("/auth/invites?status=pending", { headers: { Cookie: cookie } });
  assert.equal(listRes.status, 200);
  const body = (await listRes.json()) as { invites: Array<Record<string, unknown>> };
  assert.equal(body.invites.length, 1, "only the single active invite is listed");
  const only = body.invites[0]!;
  assert.equal(only["email"], "pending@example.com");
  assert.ok(typeof only["invite_id"] === "string" && (only["invite_id"] as string).length > 0);
  assert.ok(typeof only["expires_at"] === "string");
  assert.ok(typeof only["created_at"] === "string");
  assert.equal("token" in only, false, "list never leaks the invite token");
});

test("invite list requires admin (403) and rejects non-pending status (400)", async () => {
  const admin = user({ id: "10000000-0000-4000-8000-0000000000af", nickname: "admin", isAdmin: true });
  const member = user({ id: "10000000-0000-4000-8000-0000000000b0", nickname: "member" });
  const { deps, users, runtimeSettings } = inviteCtx(admin);
  (users as unknown as { rows: UserAuthRow[] }).rows.push(member);
  const { token: adminToken } = await mintSession(deps, admin, { authMethod: "password" });
  const { token: memberToken } = await mintSession(deps, member, { authMethod: "password" });

  const app = withErrors(new Hono<AuthEnv>());
  app.route("/auth", createAuthRoutes(deps));

  const byMember = await app.request("/auth/invites?status=pending", {
    headers: { Cookie: await signedCookie(memberToken, runtimeSettings) }
  });
  assert.equal(byMember.status, 403);

  const badStatus = await app.request("/auth/invites?status=accepted", {
    headers: { Cookie: await signedCookie(adminToken, runtimeSettings) }
  });
  assert.equal(badStatus.status, 400);
});

// R20 P1-05：DELETE /api/auth/invites/:inviteId —— 管理员撤销本工作区一条未过期邀请（软删）。
test("invite revoke soft-deletes a pending invite and drops it from the pending list", async () => {
  const admin = user({ id: "10000000-0000-4000-8000-0000000000c1", nickname: "admin", isAdmin: true });
  const { deps, invites, memberships, runtimeSettings } = inviteCtx(admin);
  const workspaceId = runtimeSettings.auth.defaultWorkspaceId;
  await memberships.create({ workspaceId, userId: admin.id, role: "owner", defaultWorkspace: true });
  const { token: adminToken } = await mintSession(deps, admin, { authMethod: "password" });

  const app = withErrors(new Hono<AuthEnv>());
  app.route("/auth", createAuthRoutes(deps));
  const cookie = await signedCookie(adminToken, runtimeSettings);

  const created = await invites.create({
    email: "revoke-me@example.com",
    tokenHash: "hash-revoke-me",
    workspaceId,
    expiresAt: new Date(now.getTime() + 1_000_000)
  });

  const revokeRes = await app.request(`/auth/invites/${created.id}`, { method: "DELETE", headers: { Cookie: cookie } });
  assert.equal(revokeRes.status, 200);
  const body = (await revokeRes.json()) as { ok: boolean; invite_id: string };
  assert.equal(body.ok, true);
  assert.equal(body.invite_id, created.id);
  assert.equal(invites.rows[0]?.deletedAt !== null, true, "invite soft-deleted (deletedAt set)");

  const listRes = await app.request("/auth/invites?status=pending", { headers: { Cookie: cookie } });
  const listBody = (await listRes.json()) as { invites: Array<Record<string, unknown>> };
  assert.equal(listBody.invites.length, 0, "revoked invite no longer appears in the pending list");
});

test("invite revoke: member 403; foreign-workspace / unknown / already-revoked id 404 (no cross-tenant revoke)", async () => {
  const admin = user({ id: "10000000-0000-4000-8000-0000000000c2", nickname: "admin", isAdmin: true });
  const member = user({ id: "10000000-0000-4000-8000-0000000000c3", nickname: "member" });
  const { deps, users, invites, memberships, runtimeSettings } = inviteCtx(admin);
  (users as unknown as { rows: UserAuthRow[] }).rows.push(member);
  const workspaceId = runtimeSettings.auth.defaultWorkspaceId;
  await memberships.create({ workspaceId, userId: admin.id, role: "owner", defaultWorkspace: true });
  const { token: adminToken } = await mintSession(deps, admin, { authMethod: "password" });
  const { token: memberToken } = await mintSession(deps, member, { authMethod: "password" });

  const app = withErrors(new Hono<AuthEnv>());
  app.route("/auth", createAuthRoutes(deps));
  const adminCookie = await signedCookie(adminToken, runtimeSettings);

  // 别的工作区的活跃邀请——管理员据 id 也不能撤（listPending 谓词按 actor.workspaceId 隔离）。
  const foreign = await invites.create({
    email: "foreign@example.com",
    tokenHash: "hash-foreign",
    workspaceId: "99990000-0000-4000-8000-0000000000ff",
    expiresAt: new Date(now.getTime() + 1_000_000)
  });
  // 本工作区一条已撤销的邀请——重复撤销幂等 404。
  const alreadyRevoked = await invites.create({
    email: "already@example.com",
    tokenHash: "hash-already",
    workspaceId,
    expiresAt: new Date(now.getTime() + 1_000_000)
  });
  await invites.revoke(alreadyRevoked.id, now);

  const byMember = await app.request(`/auth/invites/${foreign.id}`, { method: "DELETE", headers: { Cookie: await signedCookie(memberToken, runtimeSettings) } });
  assert.equal(byMember.status, 403);

  const foreignByAdmin = await app.request(`/auth/invites/${foreign.id}`, { method: "DELETE", headers: { Cookie: adminCookie } });
  assert.equal(foreignByAdmin.status, 404, "an invite from another workspace is not revocable");
  assert.equal(invites.rows.find((row) => row.id === foreign.id)?.deletedAt, null, "foreign invite untouched");

  const unknownByAdmin = await app.request(`/auth/invites/10000000-0000-4000-8000-000000000999`, { method: "DELETE", headers: { Cookie: adminCookie } });
  assert.equal(unknownByAdmin.status, 404);

  const revokeAgain = await app.request(`/auth/invites/${alreadyRevoked.id}`, { method: "DELETE", headers: { Cookie: adminCookie } });
  assert.equal(revokeAgain.status, 404, "revoking an already-revoked invite is an idempotent 404");
});

// ——— 团队就绪 gap[41]：安全/身份事件审计 ———

// auditLogs 写必抛——验「尽力而为」：审计失败绝不破坏认证主流程的状态码/响应体。
class ThrowingAuditLogs implements Pick<AuditLogRepository, "createAuditLog"> {
  public attempts = 0;
  async createAuditLog(_input: CreateAuditLogInput): Promise<AuditLogRow> {
    this.attempts += 1;
    throw new Error("audit sink is down");
  }
}

function passwordCtxWithAudit(seedUsers: UserAuthRow[] = []) {
  const base = passwordCtx(seedUsers);
  const auditLogs = new MemoryAuditLogs();
  (base.deps as AuthDependencies).auditLogs = auditLogs;
  return { ...base, auditLogs };
}

test("gap[41]: POST /register writes auth.user_registered (and admin_bootstrapped for the first user)", async () => {
  const { deps, auditLogs } = passwordCtxWithAudit();
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/auth", createAuthRoutes(deps));

  const res = await app.request("/auth/register", jsonPost({
    email: "founder@example.com",
    password: "founder-pass-1",
    nickname: "Founder"
  }));
  assert.equal(res.status, 201);

  const registered = auditLogs.rows.filter((row) => row.action === "auth.user_registered");
  assert.equal(registered.length, 1, "one auth.user_registered audit");
  assert.equal(registered[0]?.entityType, "user");
  assert.equal(registered[0]?.actorKind, "human");
  assert.equal((registered[0]?.detailJson as { nickname?: string }).nickname, "Founder");
  // 首个注册者自举为 admin → 一并记 admin_bootstrapped。
  const bootstrapped = auditLogs.rows.filter((row) => row.action === "auth.admin_bootstrapped");
  assert.equal(bootstrapped.length, 1, "first user registration also writes admin_bootstrapped");
});

test("gap[41]: POST /login success writes auth.login_succeeded", async () => {
  const alice = user({ id: "10000000-0000-4000-8000-0000000000e1", nickname: "alice" });
  const { deps, credentials, auditLogs } = passwordCtxWithAudit([alice]);
  credentials.rows.push(
    credentialRow({
      userId: alice.id,
      email: "alice@example.com",
      passwordHash: await hashPassword("alice-secret-1"),
      passwordAlgo: "scrypt"
    })
  );
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/auth", createAuthRoutes(deps));

  const res = await app.request("/auth/login", jsonPost({ email: "alice@example.com", password: "alice-secret-1" }));
  assert.equal(res.status, 200);

  const succeeded = auditLogs.rows.filter((row) => row.action === "auth.login_succeeded");
  assert.equal(succeeded.length, 1, "one auth.login_succeeded audit");
  assert.equal(succeeded[0]?.entityId, alice.id);
  assert.equal(succeeded[0]?.actorUserId, alice.id);
  assert.equal(auditLogs.rows.some((row) => row.action === "auth.login_failed"), false, "no failure audit on success");
});

test("gap[41]: failed login writes auth.login_failed (and account_locked on the lockout trip)", async () => {
  const bob = user({ id: "10000000-0000-4000-8000-0000000000e2", nickname: "bob" });
  const { deps, credentials, auditLogs } = passwordCtxWithAudit([bob]);
  const seeded = credentialRow({
    userId: bob.id,
    email: "bob@example.com",
    passwordHash: await hashPassword("bob-secret-1"),
    passwordAlgo: "scrypt"
  });
  seeded.failedAttempts = 9; // 下一次失败即达上限 → 锁定
  credentials.rows.push(seeded);
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/auth", createAuthRoutes(deps));

  const res = await app.request("/auth/login", jsonPost({ email: "bob@example.com", password: "wrong" }));
  assert.equal(res.status, 401, "bad password still returns generic 401");

  const failed = auditLogs.rows.filter((row) => row.action === "auth.login_failed");
  assert.equal(failed.length, 1, "one auth.login_failed audit");
  assert.equal(failed[0]?.entityId, bob.id);
  assert.equal((failed[0]?.detailJson as { reason?: string }).reason, "bad_password");
  // 第 10 次失败触发锁定 → account_locked。
  const locked = auditLogs.rows.filter((row) => row.action === "auth.account_locked");
  assert.equal(locked.length, 1, "lockout trip writes auth.account_locked");
});

test("gap[41]: POST /logout writes auth.logout", async () => {
  const { deps, auditLogs } = passwordCtxWithAudit();
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/auth", createAuthRoutes(deps));

  const reg = await app.request("/auth/register", jsonPost({
    email: "logout-audit@example.com",
    password: "logout-pass-1",
    nickname: "LogoutAudit"
  }));
  assert.equal(reg.status, 201);
  const cookiePair = (reg.headers.get("set-cookie") ?? "").split(";")[0] ?? "";

  const logout = await app.request("/auth/logout", { method: "POST", headers: { Cookie: cookiePair } });
  assert.equal(logout.status, 200);

  const logoutLogs = auditLogs.rows.filter((row) => row.action === "auth.logout");
  assert.equal(logoutLogs.length, 1, "one auth.logout audit");
  assert.equal(logoutLogs[0]?.entityType, "user");
});

test("gap[41]: account deactivate writes account-level auth.user_deactivated (distinct from G3 per-item handover)", async () => {
  const runtimeSettings = settings();
  const admin = user({ id: "10000000-0000-4000-8000-0000000000e3", nickname: "admin", isAdmin: true });
  const target = user({ id: "10000000-0000-4000-8000-0000000000e4", nickname: "target", cookieToken: "cookie-deact-audit" });
  const auditLogs = new MemoryAuditLogs();
  const deps: AuthDependencies = {
    users: new MemoryUsers([admin, target]),
    devices: new MemoryDevices([]),
    sessions: new MemorySessions(),
    auditLogs,
    settings: runtimeSettings,
    now: () => now
  };
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/auth", createAuthRoutes(deps));

  const res = await app.request("/auth/users/" + target.id + "/deactivate", {
    method: "POST",
    headers: { Cookie: await signedCookie(admin.cookieToken, runtimeSettings) }
  });
  assert.equal(res.status, 200);

  const deactivated = auditLogs.rows.filter((row) => row.action === "auth.user_deactivated");
  assert.equal(deactivated.length, 1, "one account-level auth.user_deactivated audit");
  assert.equal(deactivated[0]?.entityId, target.id, "subject is the deactivated user");
  assert.equal(deactivated[0]?.actorUserId, admin.id, "actor is the admin");
  // 不与 G3 逐工作项审计重复（本场景无 workItems dep → 零交接审计）。
  assert.equal(auditLogs.rows.some((row) => row.action === "work_item.unassigned_on_offboarding"), false);
});

test("gap[41]: best-effort — auth flow still succeeds when the audit write throws", async () => {
  const base = passwordCtx();
  const throwing = new ThrowingAuditLogs();
  (base.deps as AuthDependencies).auditLogs = throwing;
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/auth", createAuthRoutes(base.deps));
  app.get("/who", createCurrentUserMiddleware(base.deps), (c) => c.json({ id: c.var.currentUser.id }));

  // 注册（审计抛）→ 仍 201 且会话可用。
  const reg = await app.request("/auth/register", jsonPost({
    email: "besteffort@example.com",
    password: "best-pass-1",
    nickname: "BestEffort"
  }));
  assert.equal(reg.status, 201, "register succeeds despite audit throw");
  const cookiePair = (reg.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  assert.equal((await app.request("/who", { headers: { Cookie: cookiePair } })).status, 200, "session usable");

  // 登录（审计抛）→ 仍 200。
  const login = await app.request("/auth/login", jsonPost({ email: "besteffort@example.com", password: "best-pass-1" }));
  assert.equal(login.status, 200, "login succeeds despite audit throw");

  // 登出（审计抛）→ 仍 200。
  const logout = await app.request("/auth/logout", { method: "POST", headers: { Cookie: cookiePair } });
  assert.equal(logout.status, 200, "logout succeeds despite audit throw");

  assert.ok(throwing.attempts > 0, "audit writes were actually attempted (and swallowed)");
});

test("gap[41]: auditLogs seam absent → no throw, auth flow unaffected", async () => {
  const { deps } = passwordCtx(); // 不挂 auditLogs（老运行时/假仓库语义）
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/auth", createAuthRoutes(deps));

  const reg = await app.request("/auth/register", jsonPost({
    email: "noseam@example.com",
    password: "noseam-pass-1",
    nickname: "NoSeam"
  }));
  assert.equal(reg.status, 201, "register works with no auditLogs seam wired");
});

// ——— 桌面首启引导 desktop-bootstrap（跨源客户端令牌地基 C1）———
test("desktop-bootstrap (nickname mode) mints a device-bound client token that then authenticates", async () => {
  const authDeps = deps([], []);
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/auth", createAuthRoutes(authDeps));
  app.get("/who", createCurrentUserMiddleware(authDeps), (c) => c.json({ id: c.var.currentUser.id }));

  const res = await app.request("/api/auth/desktop-bootstrap", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ nickname: "WorkHub Desktop", device_name: "WorkHub Desktop", platform: "desktop" })
  });
  assert.equal(res.status, 201);
  const body = (await res.json()) as {
    client_token: string;
    identity: { nickname: string };
    device: { device_name: string };
  };
  assert.ok(body.client_token.length >= 32, "returns a usable client token in the body");
  assert.equal(body.identity.nickname, "WorkHub Desktop");
  assert.equal(body.device.device_name, "WorkHub Desktop");

  // 关键：用回响应体里的 token（无 cookie）即可鉴权后续请求——这正是桌面跨源所需。
  const who = await app.request("/who", { headers: { [LOCAL_CLIENT_HEADER]: body.client_token } });
  assert.equal(who.status, 200, "minted token authenticates a follow-up request with no cookie");
});

test("desktop-bootstrap rejects blank device names before creating a device", async () => {
  const deviceRepo = new MemoryDevices([]);
  const authDeps: AuthDependencies = {
    users: new MemoryUsers([]),
    devices: deviceRepo,
    settings: settings(),
    now: () => now
  };
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/auth", createAuthRoutes(authDeps));

  const response = await app.request("/api/auth/desktop-bootstrap", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ nickname: "WorkHub Desktop", device_name: "   ", platform: "desktop" })
  });

  assert.equal(response.status, 422);
  assert.equal((await deviceRepo.listByUser("any")).length, 0);
});

test("client device register route returns malformed_json for malformed request bodies", async () => {
  const alice = user();
  const runtimeSettings = settings();
  const deviceRepo = new MemoryDevices([]);
  const authDeps: AuthDependencies = {
    users: new MemoryUsers([alice]),
    devices: deviceRepo,
    settings: runtimeSettings,
    now: () => now
  };
  const app = withProductionHttpErrors(new Hono<AuthEnv>());
  app.route("/api/client-devices", createClientDeviceRoutes(authDeps));

  const response = await app.request("/api/client-devices/register", {
    method: "POST",
    headers: {
      Cookie: await signedCookie(alice.cookieToken, runtimeSettings),
      "Content-Type": "application/json"
    },
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
  assert.equal((await deviceRepo.listByUser(alice.id)).length, 0);
});

test("client device register rejects blank device names before creating a device", async () => {
  const alice = user();
  const runtimeSettings = settings();
  const deviceRepo = new MemoryDevices([]);
  const authDeps: AuthDependencies = {
    users: new MemoryUsers([alice]),
    devices: deviceRepo,
    settings: runtimeSettings,
    now: () => now
  };
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/client-devices", createClientDeviceRoutes(authDeps));

  const response = await app.request("/api/client-devices/register", {
    method: "POST",
    headers: {
      Cookie: await signedCookie(alice.cookieToken, runtimeSettings),
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ device_name: "   ", platform: "desktop" })
  });

  assert.equal(response.status, 422);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: {
      code: "validation_error",
      message: "invalid payload"
    }
  });
  assert.equal((await deviceRepo.listByUser(alice.id)).length, 0);
});

test("desktop-bootstrap refuses an existing admin nickname (no unauthenticated admin device token)", async () => {
  const admin = user({ nickname: "boss", isAdmin: true });
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/auth", createAuthRoutes(deps([admin], [])));
  const res = await app.request("/api/auth/desktop-bootstrap", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ nickname: "boss", device_name: "x" })
  });
  assert.equal(res.status, 403, "admin nickname must not get an unauthenticated device token");
});

test("desktop-bootstrap mints a device token for an existing admin nickname with the admin secret", async () => {
  const admin = user({ nickname: "boss", isAdmin: true });
  const authDeps = deps([admin], [], settings({ ADMIN_CLAIM_SECRET: "let-me-in" }));
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/auth", createAuthRoutes(authDeps));
  app.get("/who", createCurrentUserMiddleware(authDeps), (c) =>
    c.json({ id: c.var.currentUser.id, is_admin: c.var.currentUser.isAdmin })
  );

  const res = await app.request("/api/auth/desktop-bootstrap", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      nickname: "boss",
      admin_secret: "let-me-in",
      device_name: "Admin Mac",
      platform: "desktop"
    })
  });

  assert.equal(res.status, 201);
  const body = (await res.json()) as {
    client_token: string;
    identity: { id: string; is_admin: boolean };
    device: { user_id: string; device_name: string };
  };
  assert.equal(body.identity.id, admin.id);
  assert.equal(body.identity.is_admin, true);
  assert.equal(body.device.user_id, admin.id);
  assert.equal(body.device.device_name, "Admin Mac");

  const who = await app.request("/who", { headers: { [LOCAL_CLIENT_HEADER]: body.client_token } });
  assert.equal(who.status, 200, "admin desktop token authenticates without relying on a SameSite cookie");
  assert.deepEqual(await who.json(), { id: admin.id, is_admin: true });
});

test("desktop-bootstrap (password mode) refuses nickname self-provision without a session (404)", async () => {
  // P1-02（REL-5）：密码模式不再无条件 404——但无会话（首启尚未凭据登录）仍拒。桌面据此 404 渲凭据登录门。
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/auth", createAuthRoutes(deps([], [], settings({ AUTH_MODE: "password" }))));
  const res = await app.request("/api/auth/desktop-bootstrap", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ nickname: "anyone", device_name: "x" })
  });
  assert.equal(res.status, 404, "password mode must require credentials, not nickname self-provision");
});

test("desktop-bootstrap (password mode) exchanges a valid session for a device token", async () => {
  // 修复前：密码模式对本请求无条件 404（无可用登录链路）。修复后：已凭据登录（持有效会话）→ 换设备令牌。
  const runtimeSettings = settings({ AUTH_MODE: "password" });
  const alice = user({ nickname: "alice" });
  const sessions = new MemorySessions();
  const authDeps: AuthDependencies = { ...deps([alice], [], runtimeSettings), sessions };
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/auth", createAuthRoutes(authDeps));
  app.get("/who", createCurrentUserMiddleware(authDeps), (c) => c.json({ id: c.var.currentUser.id }));

  // 模拟「已通过 /api/auth/login」：建一条会话，其 secret 走 signed cookie（与 issueSessionCookie 同键）。
  const { token: sessionToken } = await mintSession(authDeps, alice, { authMethod: "password" });
  const res = await app.request("/api/auth/desktop-bootstrap", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Cookie: await signedCookie(sessionToken, runtimeSettings)
    },
    // nickname 在密码模式被忽略（身份来自会话）；仍按 schema 传占位值（nickname 必填）。
    body: JSON.stringify({ nickname: "ignored-in-password-mode", device_name: "Alice Mac", platform: "desktop" })
  });
  assert.equal(res.status, 201, "valid session must exchange for a device token in password mode");
  const body = (await res.json()) as {
    client_token: string;
    identity: { id: string };
    device: { device_name: string; user_id: string };
  };
  assert.ok(body.client_token.length >= 32, "returns a usable device client token in the body");
  assert.equal(body.identity.id, alice.id);
  assert.equal(body.device.user_id, alice.id);
  assert.equal(body.device.device_name, "Alice Mac");

  // 换到的设备令牌无 cookie 即可鉴权后续请求——这正是桌面跨源所需（同 nickname 引导的最终形态）。
  const who = await app.request("/who", { headers: { [LOCAL_CLIENT_HEADER]: body.client_token } });
  assert.equal(who.status, 200, "minted device token authenticates a follow-up request with no cookie");
  assert.deepEqual(await who.json(), { id: alice.id });
});

test("desktop-bootstrap (password mode) rejects a garbage client token with 403", async () => {
  // 呈递了 client-token header 却解析不到设备 → fail-closed 403（绝不落到 404/静默签发设备令牌）。
  const runtimeSettings = settings({ AUTH_MODE: "password" });
  const authDeps: AuthDependencies = { ...deps([], [], runtimeSettings), sessions: new MemorySessions() };
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/auth", createAuthRoutes(authDeps));
  const res = await app.request("/api/auth/desktop-bootstrap", {
    method: "POST",
    headers: { "content-type": "application/json", [LOCAL_CLIENT_HEADER]: "garbage-token" },
    body: JSON.stringify({ nickname: "x", device_name: "x" })
  });
  assert.equal(res.status, 403, "bad client token must fail closed, not exchange for a device token");
});
