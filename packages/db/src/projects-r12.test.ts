import assert from "node:assert/strict";
import test from "node:test";

import {
  ProjectSlugOccupiedError,
  createProjectRepository,
  type ProjectRow
} from "./repositories/projects.js";
import { orgs, projectConversations, projects, workspaces } from "./schema/index.js";
import {
  createQueryRecorder,
  queryParamValues,
  queryReferences,
  type RecordedQuery
} from "./test-query-recorder.js";

const now = new Date("2026-07-12T08:00:00.000Z");
const orgId = "12000000-0000-4000-8000-000000000001";
const workspaceId = "12000000-0000-4000-8000-000000000002";
const projectId = "12000000-0000-4000-8000-000000000003";
const requestOwnerUserId = "12000000-0000-4000-8000-000000000004";
const existingOwnerUserId = "12000000-0000-4000-8000-000000000005";

const input = {
  orgId,
  workspaceId,
  projectId,
  name: "桌面工作台",
  slug: "desktop-workbench",
  description: "R12",
  ownerNickname: "owner",
  ownerUserId: requestOwnerUserId,
  at: now
};

function project(overrides: Partial<ProjectRow> = {}): ProjectRow {
  return {
    id: projectId,
    workspaceId,
    name: input.name,
    slug: input.slug,
    description: input.description,
    ownerNickname: input.ownerNickname,
    ownerUserId: requestOwnerUserId,
    archived: false,
    deletedAt: null,
    deletedByNickname: null,
    nextSeq: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

function mainInsert(queries: RecordedQuery[]) {
  return queries.find(
    (query) => query.operation === "insert" && query.targetTable === projectConversations
  );
}

function assertMainInsert(
  query: RecordedQuery | undefined,
  expectedCreator: string,
  expectedProjectId = projectId
) {
  assert.ok(query, "expected an active main conversation insert");
  assert.ok(query.steps.includes("onConflictDoNothing"));
  const values = query.valuesValue as Record<string, unknown>;
  assert.match(String(values["id"]), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
  assert.equal(values["workspaceId"], workspaceId);
  assert.equal(values["projectId"], expectedProjectId);
  assert.equal(values["kind"], "main");
  assert.equal(values["title"], "主区");
  assert.equal(values["visibility"], "project");
  assert.equal(values["nextSeq"], 0);
  assert.equal(values["createdBy"], expectedCreator);
  assert.equal(values["createdAt"], now);
  assert.equal(values["updatedAt"], now);

  const conflict = query.onConflict as { target?: unknown; where?: unknown };
  assert.ok(queryReferences(conflict.target, projectConversations.projectId));
  assert.ok(queryReferences(conflict.where, projectConversations.kind));
  assert.ok(queryReferences(conflict.where, projectConversations.deletedAt));
  assert.ok(queryParamValues(conflict.where).includes("main"));
}

test("R12 project bootstrap creates a project and its main conversation in one transaction", async () => {
  const createdProject = project();
  const { db, queries, transactions } = createQueryRecorder([
    [],
    [],
    [],
    [createdProject],
    [{ id: "12000000-0000-4000-8000-000000000006" }]
  ]);
  const repository = createProjectRepository(db);

  const result = await repository.bootstrapPilotProject(input);

  assert.equal(result.created, true);
  assert.equal(result.project.id, projectId);
  assert.deepEqual(transactions, [{ outcome: "resolved" }]);
  assert.deepEqual(queries.map((query) => query.targetTable ?? query.fromTable), [
    orgs,
    workspaces,
    projects,
    projects,
    projectConversations
  ]);
  assertMainInsert(mainInsert(queries), requestOwnerUserId);
});

test("R12 project bootstrap repairs an existing active project without a main before returning", async () => {
  const existing = project({ ownerUserId: existingOwnerUserId });
  const { db, queries, transactions } = createQueryRecorder([
    [],
    [],
    [existing],
    [{ id: "12000000-0000-4000-8000-000000000007" }]
  ]);
  const repository = createProjectRepository(db);

  const result = await repository.bootstrapPilotProject(input);

  assert.equal(result.created, false);
  assert.equal(result.project.id, projectId);
  assert.deepEqual(transactions, [{ outcome: "resolved" }]);
  assertMainInsert(mainInsert(queries), existingOwnerUserId);
});

test("R12 project bootstrap does not duplicate an existing active main", async () => {
  const existing = project({ ownerUserId: null });
  const { db, queries, transactions } = createQueryRecorder([
    [],
    [],
    [existing],
    [],
    [{ id: "12000000-0000-4000-8000-000000000008" }]
  ]);
  const repository = createProjectRepository(db);

  const result = await repository.bootstrapPilotProject(input);

  assert.equal(result.created, false);
  assert.deepEqual(transactions, [{ outcome: "resolved" }]);
  assert.equal(queries.filter((query) => query.targetTable === projectConversations).length, 1);
  const conversationRead = queries.find((query) => query.fromTable === projectConversations);
  assert.equal(conversationRead?.limit, 1);
  assert.ok(queryReferences(conversationRead?.where, projectConversations.projectId));
  assert.ok(queryReferences(conversationRead?.where, projectConversations.workspaceId));
  assert.ok(queryReferences(conversationRead?.where, projectConversations.kind));
  assert.ok(queryReferences(conversationRead?.where, projectConversations.deletedAt));
  assertMainInsert(mainInsert(queries), requestOwnerUserId);
});

test("R12 project insert race loser re-reads the project and repairs its active main", async () => {
  const raced = project({ id: "12000000-0000-4000-8000-000000000009" });
  const { db, queries, transactions } = createQueryRecorder([
    [],
    [],
    [],
    [],
    [raced],
    [],
    [{ id: "12000000-0000-4000-8000-000000000010" }]
  ]);
  const repository = createProjectRepository(db);

  const result = await repository.bootstrapPilotProject(input);

  assert.equal(result.created, false);
  assert.equal(result.project.id, raced.id);
  assert.deepEqual(transactions, [{ outcome: "resolved" }]);
  assert.equal(queries.filter((query) => query.fromTable === projects).length, 2);
  assertMainInsert(mainInsert(queries), requestOwnerUserId, raced.id);
});

test("R12 project bootstrap rejects the transaction when a main conflict cannot be resolved", async () => {
  const existing = project();
  const { db, queries, transactions } = createQueryRecorder([
    [],
    [],
    [existing],
    [],
    []
  ]);
  const repository = createProjectRepository(db);

  await assert.rejects(
    repository.bootstrapPilotProject(input),
    /active main conversation conflict could not be resolved/u
  );

  assert.deepEqual(transactions, [{ outcome: "rejected", errorName: "Error" }]);
  assert.equal(queries.filter((query) => query.fromTable === projectConversations).length, 1);
});

test("R12 archived or deleted slug occupancy remains typed and never inserts a main", async () => {
  const { db, queries, transactions } = createQueryRecorder([
    [],
    [],
    [],
    [],
    []
  ]);
  const repository = createProjectRepository(db);

  await assert.rejects(
    repository.bootstrapPilotProject(input),
    (error: unknown) => error instanceof ProjectSlugOccupiedError && error.slug === input.slug
  );

  assert.deepEqual(transactions, [{ outcome: "rejected", errorName: "Error" }]);
  assert.equal(queries.some((query) => query.targetTable === projectConversations), false);
});
