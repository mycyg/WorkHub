import assert from "node:assert/strict";
import test from "node:test";

import {
  projectGithubActivities,
  projectGithubBindings,
  projects,
  workspaceMemberships
} from "./schema/index.js";
import {
  createQueryRecorder,
  queryParamValues,
  queryRawStrings,
  queryReferences,
  type RecordedQuery
} from "./test-query-recorder.js";

const now = new Date("2026-07-14T10:00:00.000Z");
const workspaceId = "14000000-0000-4000-8000-0000000000a1";
const projectId = "14000000-0000-4000-8000-0000000000a2";
const ownerUserId = "14000000-0000-4000-8000-0000000000a3";
const intruderUserId = "14000000-0000-4000-8000-0000000000a4";

const project = {
  id: projectId,
  workspaceId,
  ownerUserId,
  archived: false,
  deletedAt: null
};

const binding = {
  projectId,
  repoFullName: "octocat/Hello-World",
  patCiphertext: Buffer.from("cipher"),
  patIv: Buffer.from("iv"),
  patAuthTag: Buffer.from("tag"),
  enabled: true,
  createdByUserId: ownerUserId,
  commitsSince: null,
  issuesSince: null,
  etagJson: {},
  lastSyncedAt: null,
  lastError: null,
  lastErrorAt: null,
  createdAt: now,
  updatedAt: now
};

async function repositoryModule() {
  return import("./repositories/github-bindings.js");
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

test("R14 批 GH: owner access record enforces the strict active-owner condition plus live membership", async () => {
  const { createGithubBindingRepository } = await repositoryModule();
  const { db, queries } = createQueryRecorder([[{ project, binding }]]);

  const record = await createGithubBindingRepository(db).findBindingOwnerAccessRecord({
    workspaceId,
    projectId,
    actorUserId: ownerUserId
  });

  assert.deepEqual(record, { project, binding });
  const query = queries[0];
  assert.equal(query?.fromTable, projects);
  assert.equal(query?.limit, 1);
  // 无 isAdmin 旁路：收口列齐全——owner、workspace、archived、deletedAt + 活跃 membership join。
  for (const column of [
    projects.id,
    projects.workspaceId,
    projects.ownerUserId,
    projects.archived,
    projects.deletedAt,
    workspaceMemberships.workspaceId,
    workspaceMemberships.userId,
    workspaceMemberships.deletedAt
  ]) {
    assert.equal(references(query, column), true, `missing owner access predicate for ${String(column)}`);
  }
  assert.ok(params(query).includes(ownerUserId));
  assert.equal(params(query).includes(intruderUserId), false);
});

test("R14 批 GH: owner access fails closed instead of manufacturing a record", async () => {
  const { createGithubBindingRepository } = await repositoryModule();
  const { db } = createQueryRecorder([[]]);

  assert.equal(
    await createGithubBindingRepository(db).findBindingOwnerAccessRecord({
      workspaceId,
      projectId,
      actorUserId: intruderUserId
    }),
    null
  );
});

test("R14 批 GH: binding upsert locks owner access and fully resets watermarks on rebind", async () => {
  const { createGithubBindingRepository } = await repositoryModule();
  const { db, queries, transactions } = createQueryRecorder([
    [project],
    [{ membershipRole: "member" }],
    [binding]
  ]);

  const written = await createGithubBindingRepository(db).upsertBinding({
    workspaceId,
    projectId,
    actorUserId: ownerUserId,
    repoFullName: "octocat/Hello-World",
    patCiphertext: Buffer.from("cipher"),
    patIv: Buffer.from("iv"),
    patAuthTag: Buffer.from("tag"),
    at: now
  });

  assert.deepEqual(written, binding);
  assert.deepEqual(transactions, [{ outcome: "resolved" }]);
  const lock = queries[0];
  assert.equal(lock?.fromTable, projects);
  assert.equal(lock?.lock, "share");
  assert.equal(references(lock, projects.ownerUserId), true);
  const membershipLock = queries[1];
  assert.equal(membershipLock?.fromTable, workspaceMemberships);
  assert.equal(membershipLock?.lock, "share");

  const upsert = queries[2];
  assert.equal(upsert?.targetTable, projectGithubBindings);
  assert.ok(upsert?.onConflict && typeof upsert.onConflict === "object");
  const conflict = upsert.onConflict as { target: unknown; set: Record<string, unknown> };
  assert.equal(conflict.target, projectGithubBindings.projectId);
  // 换 repo/换 PAT=重新开始：水位、ETag、失败记录全部重置，不带旧仓库状态拉新仓库。
  assert.equal(conflict.set.commitsSince, null);
  assert.equal(conflict.set.issuesSince, null);
  assert.deepEqual(conflict.set.etagJson, {});
  assert.equal(conflict.set.lastSyncedAt, null);
  assert.equal(conflict.set.lastError, null);
  assert.equal(conflict.set.lastErrorAt, null);
  assert.equal(conflict.set.repoFullName, "octocat/Hello-World");
});

test("R14 批 GH: binding upsert throws access-denied when the actor is not the active owner", async () => {
  const { createGithubBindingRepository, GithubBindingAccessDeniedError } = await repositoryModule();
  const { db, transactions } = createQueryRecorder([[]]);

  await assert.rejects(
    createGithubBindingRepository(db).upsertBinding({
      workspaceId,
      projectId,
      actorUserId: intruderUserId,
      repoFullName: "octocat/Hello-World",
      patCiphertext: Buffer.from("cipher"),
      patIv: Buffer.from("iv"),
      patAuthTag: Buffer.from("tag")
    }),
    GithubBindingAccessDeniedError
  );
  assert.deepEqual(transactions, [{ outcome: "rejected", errorName: "GithubBindingAccessDeniedError" }]);
});

test("R14 批 GH: unbinding physically deletes the row (ciphertext destroyed) after the owner lock", async () => {
  const { createGithubBindingRepository } = await repositoryModule();
  const { db, queries } = createQueryRecorder([
    [project],
    [{ membershipRole: "member" }],
    [binding]
  ]);

  const removed = await createGithubBindingRepository(db).deleteBinding({
    workspaceId,
    projectId,
    actorUserId: ownerUserId
  });

  assert.equal(removed, true);
  const remove = queries[2];
  assert.equal(remove?.operation, "delete");
  assert.equal(remove?.targetTable, projectGithubBindings);
  assert.equal(queryReferences(remove?.where, projectGithubBindings.projectId), true);
});

// R14 批 GH-B（轮询 worker 消费的仓库原语）：listEnabledBindings 是 worker 每 tick 的候选来源，
// "enabled=false 跳过"这条纪律必须落在这条 WHERE 里，不是 worker 侧再过滤一遍。
test("R14 批 GH: listEnabledBindings filters to enabled=true at the SQL layer", async () => {
  const { createGithubBindingRepository } = await repositoryModule();
  const { db, queries } = createQueryRecorder([[binding]]);

  const rows = await createGithubBindingRepository(db).listEnabledBindings();

  assert.deepEqual(rows, [binding]);
  const query = queries[0];
  assert.equal(query?.fromTable, projectGithubBindings);
  assert.equal(references(query, projectGithubBindings.enabled), true, "must filter on the enabled column");
  assert.deepEqual(params(query), [true]);
});

test("R14 批 GH: activity upsert targets the three-column dedupe key and only updates mutable fields", async () => {
  const { createGithubBindingRepository } = await repositoryModule();
  const { db, queries } = createQueryRecorder([[]]);

  await createGithubBindingRepository(db).upsertActivity({
    projectId,
    kind: "pull_request",
    externalId: "42",
    title: "feat: hello",
    htmlUrl: "https://github.com/octocat/Hello-World/pull/42",
    occurredAt: now,
    authorLogin: "octocat",
    state: "merged"
  });

  const upsert = queries[0];
  assert.equal(upsert?.targetTable, projectGithubActivities);
  const conflict = upsert?.onConflict as { target: unknown[]; set: Record<string, unknown> };
  assert.deepEqual(conflict.target, [
    projectGithubActivities.projectId,
    projectGithubActivities.kind,
    projectGithubActivities.externalId
  ]);
  // PR open 变 merged 更新已存行：只动 title/state/author，不覆盖 occurred_at/html_url。
  assert.deepEqual(Object.keys(conflict.set).sort(), ["authorLogin", "state", "title"]);
});

test("R14 批 GH: sync success clears the failure note while sync failure never touches watermarks", async () => {
  const { createGithubBindingRepository } = await repositoryModule();
  const { db, queries } = createQueryRecorder([[], []]);
  const repository = createGithubBindingRepository(db);

  await repository.recordSyncSuccess(projectId, { commitsSince: now, etagJson: { commits: '"abc"' } }, now);
  await repository.recordSyncFailure(projectId, "GitHub 连接失败：仓库不存在或无访问权限", now);

  const success = queries[0]?.setValue as Record<string, unknown>;
  assert.equal(success.commitsSince, now);
  assert.equal("issuesSince" in success, false, "unsupplied watermark must stay untouched");
  assert.equal(success.lastError, null);
  assert.equal(success.lastErrorAt, null);

  const failure = queries[1]?.setValue as Record<string, unknown>;
  assert.equal(failure.lastError, "GitHub 连接失败：仓库不存在或无访问权限");
  assert.equal("commitsSince" in failure, false, "failure must not advance watermarks");
  assert.equal("issuesSince" in failure, false);
  assert.equal("etagJson" in failure, false);
  assert.equal("lastSyncedAt" in failure, false);
});

test("R14 批 GH: stale-repo hook short-circuits on an empty project list without touching the database", async () => {
  const { listStaleReposSinceThreshold } = await repositoryModule();
  const { db, queries } = createQueryRecorder([]);

  const rows = await listStaleReposSinceThreshold(db, {
    projectIds: [],
    thresholdDays: 7,
    now
  });

  assert.deepEqual(rows, []);
  assert.equal(queries.length, 0);
});

// R23 P3b（SA-03）：这条查询开始真正驱动风险日报的第四信号后，两道诚实性闸不能被后人顺手删掉——
// 少了任何一道，用户都会收到一条我们其实没有证据的「你的仓库没动静」指控。
test("R23 P3b: the stale-repo query never accuses a repo it has not actually synced, nor one bound today", async () => {
  const { listStaleReposSinceThreshold } = await repositoryModule();
  const { db, queries } = createQueryRecorder([[]]);

  await listStaleReposSinceThreshold(db, { projectIds: [projectId], thresholdDays: 7, now });

  const where = queryRawStrings(queries[0]?.where).join(" ");
  assert.match(where, /is not null/u, "a binding that never synced successfully must be excluded");
  assert.equal(
    queryReferences(queries[0]?.where, projectGithubBindings.lastSyncedAt),
    true,
    "the never-synced guard must read last_synced_at"
  );
  assert.equal(
    queryReferences(queries[0]?.where, projectGithubBindings.createdAt),
    true,
    "a binding younger than the threshold cannot be N days stale"
  );
  assert.equal(
    queryReferences(queries[0]?.where, projectGithubBindings.enabled),
    true,
    "a disabled binding is not a signal"
  );
});
