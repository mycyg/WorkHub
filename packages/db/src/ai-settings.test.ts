import assert from "node:assert/strict";
import test from "node:test";

import {
  projectAiGovernance,
  projects,
  userAiProfiles,
  workspaceMemberships
} from "./schema/index.js";
import {
  createQueryRecorder,
  queryParamValues,
  queryReferences,
  type RecordedQuery
} from "./test-query-recorder.js";

const now = new Date("2026-07-12T10:00:00.000Z");
const workspaceId = "14000000-0000-4000-8000-000000000001";
const otherWorkspaceId = "14000000-0000-4000-8000-000000000002";
const userId = "14000000-0000-4000-8000-000000000003";
const projectId = "14000000-0000-4000-8000-000000000004";

const profile = {
  workspaceId,
  userId,
  defaultMode: 3 as const,
  granularJson: {},
  dispatchPolicy: "auto" as const,
  cuuProactivity: "balanced" as const,
  modelTierPref: null,
  createdAt: now,
  updatedAt: now
};

const project = {
  id: projectId,
  workspaceId,
  name: "R12",
  slug: "r12",
  description: null,
  ownerNickname: "owner",
  ownerUserId: userId,
  archived: false,
  deletedAt: null,
  deletedByNickname: null,
  nextSeq: 0,
  createdAt: now,
  updatedAt: now
};

const governance = {
  projectId,
  observerEnabled: true,
  silenceWindowSecs: 60,
  quietHoursJson: { enabled: false },
  granularJson: {},
  createdAt: now,
  updatedAt: now
};

async function settingsModule() {
  return import("./repositories/ai-settings.js");
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

test("R12 profile access reads only an exact active workspace membership", async () => {
  const { createAiSettingsRepository } = await settingsModule();
  const { db, queries } = createQueryRecorder([
    [{ membershipRole: "member", profile }]
  ]);

  const result = await createAiSettingsRepository(db).findUserProfileAccessRecord({ workspaceId, userId });

  assert.deepEqual(result, { membershipRole: "member", profile });
  const query = queries[0];
  assert.equal(query?.fromTable, workspaceMemberships);
  assert.equal(query?.limit, 1);
  assert.equal(query?.joins.some((join) => join.kind === "left" && join.table === userAiProfiles), true);
  for (const column of [
    workspaceMemberships.workspaceId,
    workspaceMemberships.userId,
    workspaceMemberships.deletedAt,
    userAiProfiles.workspaceId,
    userAiProfiles.userId
  ]) {
    assert.equal(references(query, column), true, `missing profile access predicate for ${String(column)}`);
  }
  assert.ok(params(query).includes(workspaceId));
  assert.ok(params(query).includes(userId));
  assert.equal(params(query).includes(otherWorkspaceId), false);
});

test("R12 profile access fails closed instead of manufacturing a profile", async () => {
  const { createAiSettingsRepository } = await settingsModule();
  const { db } = createQueryRecorder([[]]);

  assert.equal(
    await createAiSettingsRepository(db).findUserProfileAccessRecord({ workspaceId, userId }),
    null
  );
});

test("R12 profile upsert locks membership, inserts central defaults, and updates only supplied fields", async () => {
  const { createAiSettingsRepository } = await settingsModule();
  const updated = { ...profile, dispatchPolicy: "ask" as const };
  const { db, queries, transactions } = createQueryRecorder([
    [{ membershipRole: "member" }],
    [updated]
  ]);

  const result = await createAiSettingsRepository(db).upsertUserProfile({
    workspaceId,
    userId,
    patch: { dispatchPolicy: "ask", modelTierPref: null },
    at: now
  });

  assert.deepEqual(result, updated);
  assert.deepEqual(transactions, [{ outcome: "resolved" }]);
  const lock = queries[0];
  assert.equal(lock?.fromTable, workspaceMemberships);
  assert.equal(lock?.lock, "share");
  for (const column of [
    workspaceMemberships.workspaceId,
    workspaceMemberships.userId,
    workspaceMemberships.deletedAt
  ]) {
    assert.equal(references(lock, column), true);
  }

  const write = queries[1];
  assert.equal(write?.targetTable, userAiProfiles);
  assert.equal(write?.returningCalled, true);
  assert.deepEqual(write?.valuesValue, {
    workspaceId,
    userId,
    defaultMode: 3,
    granularJson: {},
    dispatchPolicy: "ask",
    cuuProactivity: "balanced",
    modelTierPref: null,
    createdAt: now,
    updatedAt: now
  });
  const conflict = conflictShape(write);
  assert.ok(Array.isArray(conflict.target));
  assert.equal(conflict.target[0], userAiProfiles.workspaceId);
  assert.equal(conflict.target[1], userAiProfiles.userId);
  assert.deepEqual(Object.keys(conflict.set).sort(), ["dispatchPolicy", "modelTierPref", "updatedAt"]);
  assert.equal(conflict.set.dispatchPolicy, "ask");
  assert.equal(conflict.set.modelTierPref, null);
  assert.equal(conflict.set.updatedAt, now);
});

test("R12 profile upsert rejects empty or unauthorized patches inside a rollback-capable boundary", async () => {
  const module = await settingsModule();
  const empty = createQueryRecorder();
  await assert.rejects(
    module.createAiSettingsRepository(empty.db).upsertUserProfile({ workspaceId, userId, patch: {} }),
    (error: unknown) => error instanceof module.AiSettingsEmptyPatchError && error.name === "AiSettingsEmptyPatchError"
  );
  assert.deepEqual(empty.transactions, []);
  assert.deepEqual(empty.queries, []);

  const denied = createQueryRecorder([[]]);
  await assert.rejects(
    module.createAiSettingsRepository(denied.db).upsertUserProfile({
      workspaceId,
      userId,
      patch: { defaultMode: 4 },
      at: now
    }),
    (error: unknown) => error instanceof module.AiSettingsAccessDeniedError
  );
  assert.deepEqual(denied.transactions, [{ outcome: "rejected", errorName: "AiSettingsAccessDeniedError" }]);
  assert.equal(denied.queries.some((query) => query.operation === "insert"), false);
});

test("R12 repository rejects undefined-only and unknown patch keys instead of touching updated_at", async () => {
  const module = await settingsModule();
  const recorder = createQueryRecorder();

  await assert.rejects(
    module.createAiSettingsRepository(recorder.db).upsertUserProfile({
      workspaceId,
      userId,
      patch: { defaultMode: undefined } as never
    }),
    (error: unknown) => error instanceof module.AiSettingsEmptyPatchError
  );
  await assert.rejects(
    module.createAiSettingsRepository(recorder.db).upsertProjectGovernance({
      workspaceId,
      projectId,
      actorUserId: userId,
      patch: { arbitrary: true } as never
    }),
    (error: unknown) => error instanceof module.AiSettingsInvalidPatchError
  );
  assert.deepEqual(recorder.queries, []);
  assert.deepEqual(recorder.transactions, []);
});

test("R12 profile upsert treats a missing returning row as a named rollback error", async () => {
  const module = await settingsModule();
  const { db, transactions } = createQueryRecorder([
    [{ membershipRole: "member" }],
    []
  ]);

  await assert.rejects(
    module.createAiSettingsRepository(db).upsertUserProfile({
      workspaceId,
      userId,
      patch: { defaultMode: 4 },
      at: now
    }),
    (error: unknown) => error instanceof module.AiSettingsWriteFailedError
  );
  assert.deepEqual(transactions, [{ outcome: "rejected", errorName: "AiSettingsWriteFailedError" }]);
});

test("R12 governance access is project-owner-only across active project and membership scope", async () => {
  const { createAiSettingsRepository } = await settingsModule();
  const { db, queries } = createQueryRecorder([
    [{ membershipRole: "admin", project, governance }]
  ]);

  const result = await createAiSettingsRepository(db).findProjectGovernanceAccessRecord({
    workspaceId,
    projectId,
    actorUserId: userId
  });

  assert.deepEqual(result, { membershipRole: "admin", project, governance });
  const query = queries[0];
  assert.equal(query?.fromTable, projects);
  assert.equal(query?.limit, 1);
  assert.equal(query?.joins.some((join) => join.kind === "inner" && join.table === workspaceMemberships), true);
  assert.equal(query?.joins.some((join) => join.kind === "left" && join.table === projectAiGovernance), true);
  for (const column of [
    projects.id,
    projects.workspaceId,
    projects.ownerUserId,
    projects.archived,
    projects.deletedAt,
    workspaceMemberships.workspaceId,
    workspaceMemberships.userId,
    workspaceMemberships.deletedAt,
    projectAiGovernance.projectId
  ]) {
    assert.equal(references(query, column), true, `missing governance access predicate for ${String(column)}`);
  }
  assert.ok(params(query).includes(workspaceId));
  assert.ok(params(query).includes(projectId));
  assert.ok(params(query).filter((value) => value === userId).length >= 2);
});

test("R12 governance upsert rechecks and locks owner access before a guarded project write", async () => {
  const { createAiSettingsRepository } = await settingsModule();
  const enabledQuietHours = {
    enabled: true as const,
    timezone: "Asia/Singapore",
    start_minute: 1320,
    end_minute: 480,
    weekdays: [1, 2, 3, 4, 5]
  };
  const updated = { ...governance, observerEnabled: false, quietHoursJson: enabledQuietHours };
  const { db, queries, transactions } = createQueryRecorder([
    [project],
    [{ membershipRole: "owner" }],
    [updated]
  ]);

  const result = await createAiSettingsRepository(db).upsertProjectGovernance({
    workspaceId,
    projectId,
    actorUserId: userId,
    patch: { observerEnabled: false, quietHoursJson: enabledQuietHours },
    at: now
  });

  assert.deepEqual(result, updated);
  assert.deepEqual(transactions, [{ outcome: "resolved" }]);
  const projectLock = queries[0];
  assert.equal(projectLock?.fromTable, projects);
  assert.equal(projectLock?.lock, "share");
  for (const column of [
    projects.id,
    projects.workspaceId,
    projects.ownerUserId,
    projects.archived,
    projects.deletedAt
  ]) {
    assert.equal(references(projectLock, column), true);
  }
  assert.equal(projectLock?.joins.length, 0, "project lock order must not depend on a joined planner order");

  const membershipLock = queries[1];
  assert.equal(membershipLock?.fromTable, workspaceMemberships);
  assert.equal(membershipLock?.lock, "share");
  for (const column of [
    workspaceMemberships.workspaceId,
    workspaceMemberships.userId,
    workspaceMemberships.deletedAt
  ]) {
    assert.equal(references(membershipLock, column), true);
  }
  assert.equal(membershipLock?.joins.length, 0, "membership lock must be an explicit second lock step");

  const write = queries[2];
  assert.equal(write?.targetTable, projectAiGovernance);
  assert.deepEqual(write?.valuesValue, {
    projectId,
    observerEnabled: false,
    silenceWindowSecs: 60,
    quietHoursJson: enabledQuietHours,
    granularJson: {},
    createdAt: now,
    updatedAt: now
  });
  const conflict = conflictShape(write);
  assert.equal(conflict.target, projectAiGovernance.projectId);
  assert.deepEqual(Object.keys(conflict.set).sort(), ["observerEnabled", "quietHoursJson", "updatedAt"]);
  assert.equal(conflict.set.observerEnabled, false);
  assert.deepEqual(conflict.set.quietHoursJson, enabledQuietHours);
  assert.equal(conflict.set.updatedAt, now);
});

test("R12 governance upsert rejects empty/non-owner writes and never trusts membership role", async () => {
  const module = await settingsModule();
  const empty = createQueryRecorder();
  await assert.rejects(
    module.createAiSettingsRepository(empty.db).upsertProjectGovernance({
      workspaceId,
      projectId,
      actorUserId: userId,
      patch: {}
    }),
    (error: unknown) => error instanceof module.AiSettingsEmptyPatchError
  );
  assert.deepEqual(empty.queries, []);

  const denied = createQueryRecorder([[]]);
  await assert.rejects(
    module.createAiSettingsRepository(denied.db).upsertProjectGovernance({
      workspaceId,
      projectId,
      actorUserId: userId,
      patch: { silenceWindowSecs: 30 },
      at: now
    }),
    (error: unknown) => error instanceof module.AiSettingsAccessDeniedError
  );
  assert.deepEqual(denied.transactions, [{ outcome: "rejected", errorName: "AiSettingsAccessDeniedError" }]);
  assert.equal(denied.queries.some((query) => query.operation === "insert"), false);
  assert.equal(references(denied.queries[0], projects.ownerUserId), true);

  const revokedMembership = createQueryRecorder([
    [project],
    []
  ]);
  await assert.rejects(
    module.createAiSettingsRepository(revokedMembership.db).upsertProjectGovernance({
      workspaceId,
      projectId,
      actorUserId: userId,
      patch: { silenceWindowSecs: 30 },
      at: now
    }),
    (error: unknown) => error instanceof module.AiSettingsAccessDeniedError
  );
  assert.deepEqual(revokedMembership.transactions, [
    { outcome: "rejected", errorName: "AiSettingsAccessDeniedError" }
  ]);
  assert.deepEqual(
    revokedMembership.queries.map((query) => query.fromTable ?? query.targetTable),
    [projects, workspaceMemberships]
  );
  assert.equal(revokedMembership.queries.some((query) => query.operation === "insert"), false);
});

test("R12 governance missing-return rollback and DB errors remain observable", async () => {
  const module = await settingsModule();
  const missing = createQueryRecorder([
    [project],
    [{ membershipRole: "owner" }],
    []
  ]);
  await assert.rejects(
    module.createAiSettingsRepository(missing.db).upsertProjectGovernance({
      workspaceId,
      projectId,
      actorUserId: userId,
      patch: { observerEnabled: false },
      at: now
    }),
    (error: unknown) => error instanceof module.AiSettingsWriteFailedError
  );
  assert.deepEqual(missing.transactions, [{ outcome: "rejected", errorName: "AiSettingsWriteFailedError" }]);

  const sentinel = new Error("database unavailable");
  const failingDb = {
    async transaction() {
      throw sentinel;
    }
  };
  await assert.rejects(
    module.createAiSettingsRepository(failingDb as never).upsertUserProfile({
      workspaceId,
      userId,
      patch: { defaultMode: 2 }
    }),
    (error: unknown) => error === sentinel
  );
});
