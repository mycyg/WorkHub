import assert from "node:assert/strict";
import test from "node:test";

import type { UserAuthRow, UserRepository, WorkspaceMembershipRepository, WorkspaceMembershipRow } from "@workhub/db";

import type { AuthActor } from "./middleware/auth.js";

const now = new Date("2026-07-14T09:00:00.000Z");
const userId = "17000000-0000-4000-8000-000000000001";
const otherUserId = "17000000-0000-4000-8000-000000000002";
const workspaceId = "17000000-0000-4000-8000-000000000003";

function actor(overrides: Partial<AuthActor> = {}): AuthActor {
  return {
    kind: "human",
    id: userId,
    label: "张三",
    userId,
    isAdmin: false,
    orgId: "17000000-0000-4000-8000-000000000004",
    workspaceId,
    ...overrides
  };
}

// exactOptionalPropertyTypes 下不能显式赋 `userId: undefined`——用解构丢弃 key（同
// user-profile-service.test.ts 的既有写法），构造一个真的没有 userId 属性的非人类 actor。
function systemActorWithoutUserId(): AuthActor {
  const { userId: _humanUserId, ...rest } = actor();
  return { ...rest, kind: "system" };
}

// —— minimal valid samples per format (magic bytes + a little padding) ——
function pngBytes(): Buffer {
  return Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0]);
}
function jpegBytes(): Buffer {
  return Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
}
function webpBytes(): Buffer {
  return Buffer.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0, 0, 0, 0]);
}
function garbageBytes(): Buffer {
  return Buffer.from("this is not an image, just plain text padding to look real", "utf8");
}

function userRow(overrides: Partial<UserAuthRow> = {}): UserAuthRow {
  return {
    id: userId,
    nickname: "张三",
    cookieToken: "cookie-avatar",
    preferredLocale: "zh-CN",
    availabilityStatus: "free",
    availabilityText: null,
    availabilityUpdatedAt: null,
    isAdmin: false,
    mutedNotificationTypes: [],
    deletedAt: null,
    deletedByUserId: null,
    createdAt: now,
    updatedAt: now,
    ...overrides
  } as UserAuthRow;
}

type RepoOptions = {
  setAvatar?: NonNullable<UserRepository["setAvatar"]>;
  clearAvatar?: NonNullable<UserRepository["clearAvatar"]>;
  findAvatar?: NonNullable<UserRepository["findAvatar"]>;
  omitMethods?: Array<"setAvatar" | "clearAvatar" | "findAvatar">;
};

function fakeUsers(options: RepoOptions = {}) {
  const calls: { setAvatar: unknown[]; clearAvatar: unknown[]; findAvatar: unknown[] } = {
    setAvatar: [],
    clearAvatar: [],
    findAvatar: []
  };
  const omit = new Set(options.omitMethods ?? []);
  const repo: UserRepository = {
    async findActiveById() {
      return userRow();
    },
    async findActiveByCookieToken() {
      return null;
    },
    async findActiveByNickname() {
      return null;
    },
    async createUser() {
      throw new Error("not needed");
    },
    async getOrCreateActiveByNickname() {
      throw new Error("not needed");
    },
    async rotateCookieToken() {
      return null;
    },
    ...(!omit.has("setAvatar")
      ? {
          setAvatar: async (id: string, bytes: Buffer, at: Date) => {
            calls.setAvatar.push({ id, bytes, at });
            if (options.setAvatar) {
              return options.setAvatar(id, bytes, at);
            }
            return userRow({ avatarWebp: bytes, avatarUpdatedAt: at });
          }
        }
      : {}),
    ...(!omit.has("clearAvatar")
      ? {
          clearAvatar: async (id: string, at: Date) => {
            calls.clearAvatar.push({ id, at });
            if (options.clearAvatar) {
              return options.clearAvatar(id, at);
            }
            return userRow({ avatarWebp: null, avatarUpdatedAt: null });
          }
        }
      : {}),
    ...(!omit.has("findAvatar")
      ? {
          findAvatar: async (id: string) => {
            calls.findAvatar.push(id);
            if (options.findAvatar) {
              return options.findAvatar(id);
            }
            return null;
          }
        }
      : {})
  };
  return { repo, calls };
}

function fakeMemberships(activeUserIds: readonly string[] = []) {
  const calls: Array<{ userId: string; workspaceId: string }> = [];
  const repo: Pick<WorkspaceMembershipRepository, "findActiveForUserWorkspace"> = {
    async findActiveForUserWorkspace(uid, wsId) {
      calls.push({ userId: uid, workspaceId: wsId });
      if (!activeUserIds.includes(uid)) {
        return null;
      }
      return {
        id: "membership-1",
        workspaceId: wsId,
        userId: uid,
        role: "member",
        defaultWorkspace: true,
        deletedAt: null,
        createdAt: now,
        updatedAt: now
      } as WorkspaceMembershipRow;
    }
  };
  return { repo, calls };
}

async function serviceModule() {
  const module = await import("./services/user-avatar.js").catch(() => null);
  assert.ok(module, "missing user-avatar service module");
  assert.equal(typeof module.createUserAvatarService, "function", "missing createUserAvatarService export");
  return module;
}

// ── putMyAvatar: format validation ──────────────────────────────────────────────────

for (const [label, bytes] of [
  ["png", pngBytes()],
  ["jpeg", jpegBytes()],
  ["webp", webpBytes()]
] as const) {
  test(`PUT /me/avatar accepts a legal ${label} upload and returns the new avatar_updated_at`, async () => {
    const module = await serviceModule();
    const users = fakeUsers();
    const memberships = fakeMemberships();
    const service = module.createUserAvatarService({ users: users.repo, memberships: memberships.repo, now: () => now });

    const result = await service.putMyAvatar({ actor: actor(), bytes });

    assert.deepEqual(result, { avatar_updated_at: now.toISOString() });
    assert.equal(users.calls.setAvatar.length, 1);
    assert.deepEqual(users.calls.setAvatar[0], { id: userId, bytes, at: now });
  });
}

test("PUT /me/avatar rejects an unrecognized format (not webp/png/jpeg magic bytes) with 400", async () => {
  const module = await serviceModule();
  const users = fakeUsers();
  const memberships = fakeMemberships();
  const service = module.createUserAvatarService({ users: users.repo, memberships: memberships.repo, now: () => now });

  await assert.rejects(
    service.putMyAvatar({ actor: actor(), bytes: garbageBytes() }),
    (error: unknown) =>
      error instanceof module.UserAvatarServiceError && error.status === 400 && error.code === "avatar_invalid_format"
  );
  assert.equal(users.calls.setAvatar.length, 0, "an invalid upload must never reach the repository");
});

test("PUT /me/avatar rejects an empty body with 400 before touching the repository", async () => {
  const module = await serviceModule();
  const users = fakeUsers();
  const memberships = fakeMemberships();
  const service = module.createUserAvatarService({ users: users.repo, memberships: memberships.repo, now: () => now });

  await assert.rejects(
    service.putMyAvatar({ actor: actor(), bytes: Buffer.alloc(0) }),
    (error: unknown) => error instanceof module.UserAvatarServiceError && error.status === 400 && error.code === "avatar_empty"
  );
  assert.equal(users.calls.setAvatar.length, 0);
});

test("PUT /me/avatar rejects a body over the 256KB hard cap with 413, in Chinese, before touching the repository", async () => {
  const module = await serviceModule();
  const users = fakeUsers();
  const memberships = fakeMemberships();
  const service = module.createUserAvatarService({ users: users.repo, memberships: memberships.repo, now: () => now });
  const oversized = Buffer.concat([pngBytes(), Buffer.alloc(module.AVATAR_MAX_BYTES)]);

  await assert.rejects(
    service.putMyAvatar({ actor: actor(), bytes: oversized }),
    (error: unknown) => {
      assert.ok(error instanceof module.UserAvatarServiceError);
      assert.equal(error.status, 413);
      assert.equal(error.code, "avatar_too_large");
      assert.match(error.message, /256KB/u);
      assert.doesNotMatch(error.message, /[a-zA-Z]{4,}/u, "error copy should read as Chinese, not an English sentence");
      return true;
    }
  );
  assert.equal(users.calls.setAvatar.length, 0);
});

test("PUT /me/avatar rejects a non-human actor (403) before touching the repository", async () => {
  const module = await serviceModule();
  const users = fakeUsers();
  const memberships = fakeMemberships();
  const service = module.createUserAvatarService({ users: users.repo, memberships: memberships.repo, now: () => now });

  await assert.rejects(
    service.putMyAvatar({ actor: systemActorWithoutUserId(), bytes: pngBytes() }),
    (error: unknown) => error instanceof module.UserAvatarServiceError && error.status === 403
  );
  assert.equal(users.calls.setAvatar.length, 0);
});

test("PUT /me/avatar returns 501 when the injected user repository does not implement setAvatar (legacy/fake repo)", async () => {
  const module = await serviceModule();
  const users = fakeUsers({ omitMethods: ["setAvatar"] });
  const memberships = fakeMemberships();
  const service = module.createUserAvatarService({ users: users.repo, memberships: memberships.repo, now: () => now });

  await assert.rejects(
    service.putMyAvatar({ actor: actor(), bytes: pngBytes() }),
    (error: unknown) => error instanceof module.UserAvatarServiceError && error.status === 501 && error.code === "avatar_not_supported"
  );
});

// ── deleteMyAvatar ───────────────────────────────────────────────────────────────────

test("DELETE /me/avatar clears the avatar and returns avatar_updated_at: null", async () => {
  const module = await serviceModule();
  const users = fakeUsers();
  const memberships = fakeMemberships();
  const service = module.createUserAvatarService({ users: users.repo, memberships: memberships.repo, now: () => now });

  const result = await service.deleteMyAvatar({ actor: actor() });

  assert.deepEqual(result, { avatar_updated_at: null });
  assert.deepEqual(users.calls.clearAvatar, [{ id: userId, at: now }]);
});

test("DELETE /me/avatar rejects a non-human actor (403) before touching the repository", async () => {
  const module = await serviceModule();
  const users = fakeUsers();
  const memberships = fakeMemberships();
  const service = module.createUserAvatarService({ users: users.repo, memberships: memberships.repo, now: () => now });

  await assert.rejects(
    service.deleteMyAvatar({ actor: systemActorWithoutUserId() }),
    (error: unknown) => error instanceof module.UserAvatarServiceError && error.status === 403
  );
  assert.equal(users.calls.clearAvatar.length, 0);
});

// ── getUserAvatar: cross-workspace visibility (fail-closed) ─────────────────────────

test("GET /users/:id/avatar allows a user to view their own avatar without a membership lookup", async () => {
  const module = await serviceModule();
  const users = fakeUsers({ findAvatar: async () => ({ avatarWebp: pngBytes(), avatarUpdatedAt: now }) });
  const memberships = fakeMemberships();
  const service = module.createUserAvatarService({ users: users.repo, memberships: memberships.repo, now: () => now });

  const result = await service.getUserAvatar({ actor: actor(), targetUserId: userId });

  assert.equal(result.kind, "found");
  assert.equal(memberships.calls.length, 0, "self-view must not need a membership round-trip");
});

test("GET /users/:id/avatar fails closed (404) for a user outside the viewer's workspace, not leaking existence", async () => {
  const module = await serviceModule();
  const users = fakeUsers({ findAvatar: async () => ({ avatarWebp: pngBytes(), avatarUpdatedAt: now }) });
  const memberships = fakeMemberships([]); // nobody is an active member — simulates cross-workspace target
  const service = module.createUserAvatarService({ users: users.repo, memberships: memberships.repo, now: () => now });

  await assert.rejects(
    service.getUserAvatar({ actor: actor(), targetUserId: otherUserId }),
    (error: unknown) =>
      error instanceof module.UserAvatarServiceError && error.status === 404 && error.code === "user_avatar_not_found"
  );
  assert.equal(users.calls.findAvatar.length, 0, "must fail closed before ever reading avatar bytes for a non-member target");
  assert.deepEqual(memberships.calls, [{ userId: otherUserId, workspaceId }]);
});

test("GET /users/:id/avatar succeeds for a same-workspace member", async () => {
  const module = await serviceModule();
  const users = fakeUsers({ findAvatar: async () => ({ avatarWebp: webpBytes(), avatarUpdatedAt: now }) });
  const memberships = fakeMemberships([otherUserId]);
  const service = module.createUserAvatarService({ users: users.repo, memberships: memberships.repo, now: () => now });

  const result = await service.getUserAvatar({ actor: actor(), targetUserId: otherUserId });

  assert.equal(result.kind, "found");
  if (result.kind === "found") {
    assert.equal(result.contentType, "image/webp");
  }
});

test("GET /users/:id/avatar returns 404 when the (visible) target user has no avatar set", async () => {
  const module = await serviceModule();
  const users = fakeUsers({ findAvatar: async () => ({ avatarWebp: null, avatarUpdatedAt: null }) });
  const memberships = fakeMemberships([otherUserId]);
  const service = module.createUserAvatarService({ users: users.repo, memberships: memberships.repo, now: () => now });

  await assert.rejects(
    service.getUserAvatar({ actor: actor(), targetUserId: otherUserId }),
    (error: unknown) =>
      error instanceof module.UserAvatarServiceError && error.status === 404 && error.code === "user_avatar_not_found"
  );
});

// ── getUserAvatar: ETag / 304 ────────────────────────────────────────────────────────

test("GET /users/:id/avatar returns 'found' with a quoted ETag derived from avatar_updated_at's millisecond value", async () => {
  const module = await serviceModule();
  const users = fakeUsers({ findAvatar: async () => ({ avatarWebp: pngBytes(), avatarUpdatedAt: now }) });
  const memberships = fakeMemberships();
  const service = module.createUserAvatarService({ users: users.repo, memberships: memberships.repo, now: () => now });

  const result = await service.getUserAvatar({ actor: actor(), targetUserId: userId });

  assert.equal(result.kind, "found");
  assert.equal(result.etag, `"${now.getTime()}"`);
});

test("GET /users/:id/avatar with a matching If-None-Match returns 'not_modified' without re-transmitting bytes", async () => {
  const module = await serviceModule();
  const users = fakeUsers({ findAvatar: async () => ({ avatarWebp: pngBytes(), avatarUpdatedAt: now }) });
  const memberships = fakeMemberships();
  const service = module.createUserAvatarService({ users: users.repo, memberships: memberships.repo, now: () => now });

  const result = await service.getUserAvatar({
    actor: actor(),
    targetUserId: userId,
    ifNoneMatch: `"${now.getTime()}"`
  });

  assert.deepEqual(result, { kind: "not_modified", etag: `"${now.getTime()}"` });
});

test("GET /users/:id/avatar with a stale If-None-Match still returns the fresh bytes", async () => {
  const module = await serviceModule();
  const users = fakeUsers({ findAvatar: async () => ({ avatarWebp: pngBytes(), avatarUpdatedAt: now }) });
  const memberships = fakeMemberships();
  const service = module.createUserAvatarService({ users: users.repo, memberships: memberships.repo, now: () => now });

  const result = await service.getUserAvatar({
    actor: actor(),
    targetUserId: userId,
    ifNoneMatch: '"stale-etag-value"'
  });

  assert.equal(result.kind, "found");
});

test("GET /users/:id/avatar returns 501 when the injected user repository does not implement findAvatar", async () => {
  const module = await serviceModule();
  const users = fakeUsers({ omitMethods: ["findAvatar"] });
  const memberships = fakeMemberships();
  const service = module.createUserAvatarService({ users: users.repo, memberships: memberships.repo, now: () => now });

  await assert.rejects(
    service.getUserAvatar({ actor: actor(), targetUserId: userId }),
    (error: unknown) => error instanceof module.UserAvatarServiceError && error.status === 501
  );
});

// ── detectAvatarMimeType (unit-level, exported for the route/UI to reuse for Content-Type) ──

test("detectAvatarMimeType identifies png/jpeg/webp by magic bytes and rejects anything else", async () => {
  const module = await serviceModule();
  assert.equal(module.detectAvatarMimeType(pngBytes()), "image/png");
  assert.equal(module.detectAvatarMimeType(jpegBytes()), "image/jpeg");
  assert.equal(module.detectAvatarMimeType(webpBytes()), "image/webp");
  assert.equal(module.detectAvatarMimeType(garbageBytes()), null);
  assert.equal(module.detectAvatarMimeType(Buffer.alloc(0)), null);
});
