import assert from "node:assert/strict";
import test from "node:test";

import { users } from "./schema/index.js";
import { createQueryRecorder, queryParamValues, queryReferences, type RecordedQuery } from "./test-query-recorder.js";

// R14 批 AVATAR（头像与资料入口）：users 仓库新增的 setAvatar/clearAvatar/findAvatar 三个方法——
// 头像端点（apps/api/src/routes/user-avatar.ts）唯一的数据访问口子。用同一套 query-recorder 假 DB
// 断言「查询形状」（读哪张表/哪些列、写哪些字段、WHERE 是否引用了 userId 与 deletedAt），不需要真
// Postgres——与本目录里 user-profiles-repository.test.ts 同一套纪律。

const userId = "16000000-0000-4000-8000-000000000010";
const now = new Date("2026-07-14T09:00:00.000Z");

async function repositoryModule() {
  return import("./repositories/users.js");
}

function predicate(query: RecordedQuery | undefined) {
  assert.ok(query, "expected a recorded query");
  return query.where;
}

function references(query: RecordedQuery | undefined, column: unknown) {
  return queryReferences(predicate(query), column);
}

function params(query: RecordedQuery | undefined) {
  return queryParamValues(predicate(query));
}

function userRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: userId,
    nickname: "张三",
    cookieToken: "cookie-avatar-owner",
    preferredLocale: "zh-CN",
    availabilityStatus: "free",
    availabilityText: null,
    availabilityUpdatedAt: null,
    isAdmin: false,
    mutedNotificationTypes: [],
    avatarWebp: null,
    avatarUpdatedAt: null,
    deletedAt: null,
    deletedByUserId: null,
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

// ── setAvatar ───────────────────────────────────────────────────────────────────────

test("R14 AVATAR setAvatar writes avatarWebp + avatarUpdatedAt scoped to an active user", async () => {
  const { createUserRepository } = await repositoryModule();
  const bytes = Buffer.from([0x52, 0x49, 0x46, 0x46]);
  const written = userRow({ avatarWebp: bytes, avatarUpdatedAt: now, updatedAt: now });
  const { db, queries } = createQueryRecorder([[written]]);

  const result = await createUserRepository(db).setAvatar!(userId, bytes, now);

  assert.deepEqual(result, written);
  const query = queries[0];
  assert.equal(query?.targetTable, users);
  assert.equal(query?.returningCalled, true);
  const set = query?.setValue as Record<string, unknown>;
  assert.equal(set.avatarWebp, bytes);
  assert.equal(set.avatarUpdatedAt, now);
  assert.equal(set.updatedAt, now);
  assert.equal(references(query, users.id), true);
  assert.equal(references(query, users.deletedAt), true, "must exclude soft-deleted users (fail-closed)");
  assert.ok(params(query).includes(userId));
});

test("R14 AVATAR setAvatar fails closed to null when the user row is soft-deleted or missing", async () => {
  const { createUserRepository } = await repositoryModule();
  const { db } = createQueryRecorder([[]]);

  const result = await createUserRepository(db).setAvatar!(userId, Buffer.from("x"), now);

  assert.equal(result, null);
});

// ── clearAvatar ─────────────────────────────────────────────────────────────────────

test("R14 AVATAR clearAvatar nulls out both avatar columns scoped to an active user", async () => {
  const { createUserRepository } = await repositoryModule();
  const cleared = userRow({ avatarWebp: null, avatarUpdatedAt: null, updatedAt: now });
  const { db, queries } = createQueryRecorder([[cleared]]);

  const result = await createUserRepository(db).clearAvatar!(userId, now);

  assert.deepEqual(result, cleared);
  const query = queries[0];
  const set = query?.setValue as Record<string, unknown>;
  assert.equal(set.avatarWebp, null);
  assert.equal(set.avatarUpdatedAt, null);
  assert.equal(set.updatedAt, now);
  assert.equal(references(query, users.id), true);
  assert.equal(references(query, users.deletedAt), true);
});

test("R14 AVATAR clearAvatar fails closed to null when there is no matching active user", async () => {
  const { createUserRepository } = await repositoryModule();
  const { db } = createQueryRecorder([[]]);

  const result = await createUserRepository(db).clearAvatar!(userId, now);

  assert.equal(result, null);
});

// ── findAvatar ──────────────────────────────────────────────────────────────────────

test("R14 AVATAR findAvatar selects only the two avatar columns, scoped to an active user", async () => {
  const { createUserRepository } = await repositoryModule();
  const bytes = Buffer.from([1, 2, 3]);
  const { db, queries } = createQueryRecorder([[{ avatarWebp: bytes, avatarUpdatedAt: now }]]);

  const result = await createUserRepository(db).findAvatar!(userId);

  assert.deepEqual(result, { avatarWebp: bytes, avatarUpdatedAt: now });
  const query = queries[0];
  assert.equal(query?.fromTable, users);
  assert.equal(query?.limit, 1);
  const selection = query?.selection as Record<string, unknown>;
  assert.deepEqual(Object.keys(selection).sort(), ["avatarUpdatedAt", "avatarWebp"]);
  assert.equal(references(query, users.id), true);
  assert.equal(references(query, users.deletedAt), true);
  assert.ok(params(query).includes(userId));
});

test("R14 AVATAR findAvatar returns null instead of manufacturing a row for an unknown/soft-deleted user", async () => {
  const { createUserRepository } = await repositoryModule();
  const { db } = createQueryRecorder([[]]);

  const result = await createUserRepository(db).findAvatar!(userId);

  assert.equal(result, null);
});

test("R14 AVATAR findAvatar reports an actual missing avatar (row exists, columns null) distinctly from a missing user", async () => {
  const { createUserRepository } = await repositoryModule();
  const { db } = createQueryRecorder([[{ avatarWebp: null, avatarUpdatedAt: null }]]);

  const result = await createUserRepository(db).findAvatar!(userId);

  assert.deepEqual(result, { avatarWebp: null, avatarUpdatedAt: null });
});
