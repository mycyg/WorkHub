import assert from "node:assert/strict";
import test from "node:test";

import {
  acceptedDeliverableChanges,
  projects,
  userProfiles,
  users,
  workItemAssignments,
  workItems,
  workspaceMemberships
} from "./schema/index.js";
import {
  createQueryRecorder,
  queryParamValues,
  queryReferences,
  type RecordedQuery
} from "./test-query-recorder.js";

const now = new Date("2026-07-13T10:00:00.000Z");
const userId = "15000000-0000-4000-8000-000000000001";
const projectId = "15000000-0000-4000-8000-000000000002";

const profileRow = {
  id: "15000000-0000-4000-8000-000000000003",
  userId,
  bioMd: "前端负责人，做过三个交付项目",
  skillsText: null,
  skillTags: ["react", "typescript"],
  availabilityPref: {},
  onboardedAt: null,
  title: "前端负责人",
  createdAt: now,
  updatedAt: now
};

async function repositoryModule() {
  return import("./repositories/user-profiles.js");
}

function predicates(query: RecordedQuery | undefined) {
  assert.ok(query, "expected a recorded query");
  return [query.where, ...query.joins.map((join) => join.on)];
}

function references(query: RecordedQuery | undefined, column: unknown) {
  return predicates(query).some((predicate) => queryReferences(predicate, column));
}

function params(query: RecordedQuery | undefined) {
  return predicates(query).flatMap((predicate) => queryParamValues(predicate));
}

function conflictShape(query: RecordedQuery | undefined) {
  assert.ok(query?.onConflict && typeof query.onConflict === "object", "expected ON CONFLICT update");
  return query.onConflict as { target: unknown; set: Record<string, unknown> };
}

// ── findByUserId ──────────────────────────────────────────────────────────────────

test("R13 A2 findByUserId reads the single profile row scoped to userId", async () => {
  const { createUserProfileRepository } = await repositoryModule();
  const { db, queries } = createQueryRecorder([[profileRow]]);

  const result = await createUserProfileRepository(db).findByUserId(userId);

  assert.deepEqual(result, profileRow);
  const query = queries[0];
  assert.equal(query?.fromTable, userProfiles);
  assert.equal(query?.limit, 1);
  assert.equal(references(query, userProfiles.userId), true);
  assert.ok(params(query).includes(userId));
});

test("R13 A2 findByUserId fails closed to null instead of manufacturing a profile", async () => {
  const { createUserProfileRepository } = await repositoryModule();
  const { db } = createQueryRecorder([[]]);

  assert.equal(await createUserProfileRepository(db).findByUserId(userId), null);
});

// ── upsert ────────────────────────────────────────────────────────────────────────

test("R13 A2 upsert inserts a fresh row with a generated id and defaults absent fields", async () => {
  const { createUserProfileRepository } = await repositoryModule();
  const { db, queries } = createQueryRecorder([[profileRow]]);

  const result = await createUserProfileRepository(db).upsert({
    userId,
    patch: { title: "前端负责人" },
    at: now
  });

  assert.deepEqual(result, profileRow);
  const write = queries[0];
  assert.equal(write?.targetTable, userProfiles);
  assert.equal(write?.returningCalled, true);
  const values = write?.valuesValue as Record<string, unknown>;
  assert.equal(values.userId, userId);
  assert.equal(values.title, "前端负责人");
  assert.equal(values.bioMd, null);
  assert.deepEqual(values.skillTags, []);
  assert.equal(values.createdAt, now);
  assert.equal(values.updatedAt, now);
  assert.equal(typeof values.id, "string");
  assert.ok((values.id as string).length > 0);

  const conflict = conflictShape(write);
  assert.equal(conflict.target, userProfiles.userId);
  assert.deepEqual(Object.keys(conflict.set).sort(), ["title", "updatedAt"]);
  assert.equal(conflict.set.title, "前端负责人");
  assert.equal(conflict.set.updatedAt, now);
});

test("R13 A2 upsert only updates fields explicitly present in the patch", async () => {
  const { createUserProfileRepository } = await repositoryModule();
  const updated = { ...profileRow, bioMd: "更新后的简介" };
  const { db, queries } = createQueryRecorder([[updated]]);

  const result = await createUserProfileRepository(db).upsert({
    userId,
    patch: { bioMd: "更新后的简介" },
    at: now
  });

  assert.deepEqual(result, updated);
  const write = queries[0];
  const conflict = conflictShape(write);
  assert.deepEqual(Object.keys(conflict.set).sort(), ["bioMd", "updatedAt"]);
  assert.equal(conflict.set.bioMd, "更新后的简介");
});

test("R13 A2 upsert rejects an empty patch before issuing any query", async () => {
  const module = await repositoryModule();
  const { db, queries } = createQueryRecorder();

  await assert.rejects(
    module.createUserProfileRepository(db).upsert({ userId, patch: {} }),
    (error: unknown) => error instanceof module.UserProfileEmptyPatchError
  );
  assert.deepEqual(queries, []);
});

test("R13 A2 upsert rejects an unknown patch key before issuing any query", async () => {
  const module = await repositoryModule();
  const { db, queries } = createQueryRecorder();

  await assert.rejects(
    module.createUserProfileRepository(db).upsert({
      userId,
      patch: { arbitrary: true } as never
    }),
    (error: unknown) => error instanceof module.UserProfileInvalidPatchError
  );
  assert.deepEqual(queries, []);
});

// ── listCandidatesForProject ───────────────────────────────────────────────────────

test("R13 A2 listCandidatesForProject aggregates lead-only delivery history for the project's active workspace members", async () => {
  const { createUserProfileRepository } = await repositoryModule();
  const candidateRow = {
    userId,
    nickname: "张三",
    title: "前端负责人",
    bioMd: "做过三个交付项目",
    skillTags: ["react", "typescript"],
    acceptedDeliverableCount: 5,
    lastAcceptedAt: now
  };
  const { db, queries } = createQueryRecorder([[candidateRow]]);

  const result = await createUserProfileRepository(db).listCandidatesForProject({ projectId });

  assert.deepEqual(result, [candidateRow]);
  const query = queries[0];
  assert.equal(query?.fromTable, projects);
  assert.equal(query?.limit, 50);
  assert.equal(references(query, projects.id), true);
  assert.equal(references(query, workspaceMemberships.workspaceId), true);
  assert.equal(references(query, workspaceMemberships.deletedAt), true);
  assert.equal(references(query, users.deletedAt), true);
  assert.equal(references(query, workItemAssignments.role), true);
  assert.equal(references(query, workItems.projectId), true);
  assert.equal(references(query, acceptedDeliverableChanges.workItemId), true);
  assert.ok(params(query).includes(projectId));
  // 历史交付信号只算给 role='lead'（04 铁律讨论的默认值——见 repositories/user-profiles.ts 顶部注释）。
  assert.ok(params(query).includes("lead"));
  assert.equal(query?.joins.some((join) => join.kind === "inner" && join.table === workspaceMemberships), true);
  assert.equal(query?.joins.some((join) => join.kind === "inner" && join.table === users), true);
  assert.equal(query?.joins.some((join) => join.kind === "left" && join.table === userProfiles), true);
});

test("R13 A2 listCandidatesForProject honors a caller-supplied limit and rejects out-of-range values", async () => {
  const module = await repositoryModule();
  const { db, queries } = createQueryRecorder([[]]);

  await module.createUserProfileRepository(db).listCandidatesForProject({ projectId, limit: 8 });
  assert.equal(queries[0]?.limit, 8);

  const invalid = createQueryRecorder();
  await assert.rejects(
    module.createUserProfileRepository(invalid.db).listCandidatesForProject({ projectId, limit: 0 }),
    (error: unknown) => error instanceof module.UserProfileRepositoryInputError
  );
  await assert.rejects(
    module.createUserProfileRepository(invalid.db).listCandidatesForProject({ projectId, limit: 500 }),
    (error: unknown) => error instanceof module.UserProfileRepositoryInputError
  );
  await assert.rejects(
    module.createUserProfileRepository(invalid.db).listCandidatesForProject({ projectId, limit: 1.5 }),
    (error: unknown) => error instanceof module.UserProfileRepositoryInputError
  );
  assert.deepEqual(invalid.queries, []);
});
