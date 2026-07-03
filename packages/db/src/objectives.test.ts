import assert from "node:assert/strict";
import test from "node:test";

import { createObjectiveRepository } from "./repositories/objectives.js";
import {
  keyResults,
  objectiveWorkItemLinks,
  objectives,
  workItems
} from "./schema/index.js";
import { createQueryRecorder, queryParamValues, queryReferences } from "./test-query-recorder.js";

const now = new Date("2026-07-03T08:00:00.000Z");
const workspaceId = "96000000-0000-4000-8000-000000000001";
const objectiveId = "96000000-0000-4000-8000-000000000002";
const secondObjectiveId = "96000000-0000-4000-8000-000000000003";
const workItemId = "96000000-0000-4000-8000-000000000004";
const userId = "96000000-0000-4000-8000-000000000005";
const firstKeyResultId = "96000000-0000-4000-8000-000000000011";
const secondKeyResultId = "96000000-0000-4000-8000-000000000012";
const linkId = "96000000-0000-4000-8000-000000000021";

const objectiveRow = {
  id: objectiveId,
  workspaceId,
  title: "Launch reliable agent army",
  descriptionMd: "Raise R9 confidence without blocking unrelated work.",
  ownerUserId: userId,
  status: "active",
  progressPercent: 20,
  progressUpdatedAt: now,
  createdAt: now,
  updatedAt: now
};

const secondObjectiveRow = {
  ...objectiveRow,
  id: secondObjectiveId,
  title: "Reduce review escapes"
};

const firstKeyResult = {
  id: firstKeyResultId,
  objectiveId,
  workspaceId,
  seq: 1,
  title: "All R9 slices pass CI first time",
  targetValue: "100",
  currentValue: "25",
  unit: "%",
  status: "active",
  progressPercent: 25,
  createdAt: now,
  updatedAt: now
};

const secondKeyResult = {
  ...firstKeyResult,
  id: secondKeyResultId,
  seq: 2,
  title: "Adversarial review gaps reach zero",
  progressPercent: 75
};

test("R9.5 objective repository creates objectives and key results in one transaction", async () => {
  const { db, queries, transactions } = createQueryRecorder([[objectiveRow], [firstKeyResult, secondKeyResult]]);
  const repository = createObjectiveRepository(db);

  const created = await repository.createObjective({
    id: objectiveId,
    workspaceId,
    title: objectiveRow.title,
    descriptionMd: objectiveRow.descriptionMd,
    ownerUserId: userId,
    keyResults: [
      {
        id: firstKeyResultId,
        seq: 1,
        title: firstKeyResult.title,
        targetValue: "100",
        currentValue: "25",
        unit: "%",
        progressPercent: 25
      },
      {
        id: secondKeyResultId,
        seq: 2,
        title: secondKeyResult.title,
        progressPercent: 75
      }
    ],
    now
  });

  assert.equal(created.id, objectiveId);
  assert.deepEqual(transactions, [{ outcome: "resolved" }]);
  assert.equal(queries.length, 2);

  const [objectiveInsert, keyResultInsert] = queries;
  assert.equal(objectiveInsert?.operation, "insert");
  assert.equal(objectiveInsert?.targetTable, objectives);
  assert.deepEqual(objectiveInsert?.valuesValue, {
    id: objectiveId,
    workspaceId,
    title: objectiveRow.title,
    descriptionMd: objectiveRow.descriptionMd,
    ownerUserId: userId,
    status: "active",
    progressPercent: 0,
    progressUpdatedAt: null,
    createdAt: now,
    updatedAt: now
  });
  assert.equal(objectiveInsert?.returningCalled, true);

  assert.equal(keyResultInsert?.operation, "insert");
  assert.equal(keyResultInsert?.targetTable, keyResults);
  assert.deepEqual(keyResultInsert?.valuesValue, [
    {
      id: firstKeyResultId,
      objectiveId,
      workspaceId,
      seq: 1,
      title: firstKeyResult.title,
      targetValue: "100",
      currentValue: "25",
      unit: "%",
      status: "active",
      progressPercent: 25,
      createdAt: now,
      updatedAt: now
    },
    {
      id: secondKeyResultId,
      objectiveId,
      workspaceId,
      seq: 2,
      title: secondKeyResult.title,
      targetValue: null,
      currentValue: null,
      unit: null,
      status: "active",
      progressPercent: 75,
      createdAt: now,
      updatedAt: now
    }
  ]);
});

test("R9.5 objective repository stores work item links as optional soft links", async () => {
  const { db, queries } = createQueryRecorder([
    [{ objectiveId, workItemId }],
    [{
      id: linkId,
      workspaceId,
      objectiveId,
      workItemId,
      linkedByUserId: userId,
      createdAt: now
    }]
  ]);
  const repository = createObjectiveRepository(db);

  const link = await repository.linkWorkItem({
    id: linkId,
    workspaceId,
    objectiveId,
    workItemId,
    linkedByUserId: userId,
    now
  });

  assert.equal(link.id, linkId);
  assert.equal(queries.length, 2);
  const [scopeQuery, query] = queries;
  assert.equal(scopeQuery?.fromTable, objectives);
  assert.deepEqual(scopeQuery?.joins.map((join) => [join.kind, join.table]), [
    ["inner", workItems]
  ]);
  assert.equal(scopeQuery?.limit, 1);
  // R9.7 redline: the previous insert assertion trusted the caller-supplied
  // workspace_id. The objective and work item must be proven in the same workspace first.
  assert.ok(queryReferences(scopeQuery?.where, objectives.workspaceId));
  assert.ok(queryReferences(scopeQuery?.where, objectives.id));
  assert.ok(queryReferences(scopeQuery?.where, workItems.workspaceId));
  assert.ok(queryReferences(scopeQuery?.where, workItems.id));
  assert.ok(queryReferences(scopeQuery?.where, workItems.deletedAt));
  assert.ok(queryParamValues(scopeQuery?.where).includes(workspaceId));
  assert.ok(queryParamValues(scopeQuery?.where).includes(objectiveId));
  assert.ok(queryParamValues(scopeQuery?.where).includes(workItemId));

  assert.equal(query?.operation, "insert");
  assert.equal(query?.targetTable, objectiveWorkItemLinks);
  assert.deepEqual(query?.valuesValue, {
    id: linkId,
    workspaceId,
    objectiveId,
    workItemId,
    linkedByUserId: userId,
    createdAt: now
  });
  assert.equal(query?.returningCalled, true);
});

test("R9.7 objective repository refuses cross-workspace work item links", async () => {
  const { db, queries } = createQueryRecorder([[]]);
  const repository = createObjectiveRepository(db);

  await assert.rejects(
    repository.linkWorkItem({
      id: linkId,
      workspaceId,
      objectiveId,
      workItemId,
      linkedByUserId: userId,
      now
    }),
    { name: "ObjectiveLinkScopeMismatch" }
  );

  assert.equal(queries.length, 1);
  const [scopeQuery] = queries;
  assert.equal(scopeQuery?.fromTable, objectives);
  assert.deepEqual(scopeQuery?.joins.map((join) => [join.kind, join.table]), [
    ["inner", workItems]
  ]);
  assert.ok(queryReferences(scopeQuery?.where, objectives.workspaceId));
  assert.ok(queryReferences(scopeQuery?.where, workItems.workspaceId));
  assert.ok(queryReferences(scopeQuery?.where, workItems.deletedAt));
  assert.ok(queryParamValues(scopeQuery?.where).includes(workspaceId));
});

test("R9.5 objective repository returns empty planning context for unlinked work items", async () => {
  const { db, queries } = createQueryRecorder([[]]);
  const repository = createObjectiveRepository(db);

  const result = await repository.listPlanningContextForWorkItem({
    workspaceId,
    workItemId
  });

  assert.deepEqual(result, {
    objectives: [],
    objectivesCapped: false,
    keyResultsCapped: false
  });
  assert.equal(queries.length, 1);
  assert.equal(queries[0]?.fromTable, objectiveWorkItemLinks);
  assert.equal(queries[0]?.limit, 6);
});

test("R9.5 objective repository reads planning context with workspace filters and honest caps", async () => {
  const { db, queries } = createQueryRecorder([
    [{ objective: objectiveRow }, { objective: secondObjectiveRow }],
    [{ keyResult: firstKeyResult }, { keyResult: secondKeyResult }]
  ]);
  const repository = createObjectiveRepository(db);

  const result = await repository.listPlanningContextForWorkItem({
    workspaceId,
    workItemId,
    limit: 1,
    keyResultLimit: 2
  });

  assert.equal(result.objectives.length, 1);
  assert.equal(result.objectives[0]?.objective.id, objectiveId);
  assert.deepEqual(result.objectives[0]?.keyResults.map((row) => row.id), [firstKeyResultId, secondKeyResultId]);
  assert.equal(result.objectivesCapped, true);
  assert.equal(result.keyResultsCapped, false);
  assert.equal(queries.length, 2);

  const [objectiveQuery, keyResultQuery] = queries;
  assert.equal(objectiveQuery?.fromTable, objectiveWorkItemLinks);
  assert.deepEqual(objectiveQuery?.joins.map((join) => [join.kind, join.table]), [
    ["inner", objectives],
    ["inner", workItems]
  ]);
  assert.equal(objectiveQuery?.limit, 2);
  assert.ok(queryReferences(objectiveQuery?.where, objectiveWorkItemLinks.workspaceId));
  assert.ok(queryReferences(objectiveQuery?.where, objectiveWorkItemLinks.workItemId));
  assert.ok(queryReferences(objectiveQuery?.where, objectives.workspaceId));
  assert.ok(queryReferences(objectiveQuery?.where, objectives.status));
  assert.ok(queryReferences(objectiveQuery?.where, workItems.workspaceId));
  assert.ok(queryReferences(objectiveQuery?.where, workItems.deletedAt));
  assert.ok(queryParamValues(objectiveQuery?.where).includes(workspaceId));
  assert.ok(queryParamValues(objectiveQuery?.where).includes(workItemId));
  assert.ok(queryParamValues(objectiveQuery?.where).includes("active"));

  assert.equal(keyResultQuery?.fromTable, keyResults);
  assert.equal(keyResultQuery?.limit, 3);
  assert.ok(keyResultQuery && keyResultQuery.steps.indexOf("where") < keyResultQuery.steps.indexOf("limit"));
  assert.ok(queryReferences(keyResultQuery?.where, keyResults.workspaceId));
  assert.ok(queryReferences(keyResultQuery?.where, keyResults.objectiveId));
  assert.ok(queryParamValues(keyResultQuery?.where).includes(workspaceId));
});

test("R9.5 objective repository refreshes progress only inside the objective workspace", async () => {
  const updatedRow = {
    ...objectiveRow,
    progressPercent: 50,
    progressUpdatedAt: now,
    updatedAt: now
  };
  const { db, queries } = createQueryRecorder([[updatedRow]]);
  const repository = createObjectiveRepository(db);

  const result = await repository.updateObjectiveProgress({
    workspaceId,
    objectiveId,
    progressPercent: 50,
    progressUpdatedAt: now
  });

  assert.equal(result?.progressPercent, 50);
  const [query] = queries;
  assert.equal(query?.operation, "update");
  assert.equal(query?.targetTable, objectives);
  assert.deepEqual(query?.setValue, {
    progressPercent: 50,
    progressUpdatedAt: now,
    updatedAt: now
  });
  assert.equal(query?.returningCalled, true);
  assert.ok(queryReferences(query?.where, objectives.workspaceId));
  assert.ok(queryReferences(query?.where, objectives.id));
  assert.ok(queryParamValues(query?.where).includes(workspaceId));
  assert.ok(queryParamValues(query?.where).includes(objectiveId));
});
