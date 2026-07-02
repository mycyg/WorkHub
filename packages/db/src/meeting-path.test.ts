import assert from "node:assert/strict";
import test from "node:test";

import { createMeetingRepository } from "./repositories/meetings.js";
import { auditLogs, meetingInsights, meetingRecords, projects, workItems } from "./schema/index.js";
import { createQueryRecorder, queryReferences } from "./test-query-recorder.js";

// Old assertions read repositories/meetings.ts and matched statement order. That was wrong
// because the idempotency path must prove the repository actually locks before follow-up reads.
test("meeting insightToDraft locks the source insight before checking an existing draft", async () => {
  const project = { id: "project-1", workspaceId: "workspace-1", archived: false, deletedAt: null };
  const insight = {
    id: "insight-1",
    meetingId: "meeting-1",
    createdWorkItemId: "work-item-1",
    status: "pending",
    title: "Draft title",
    description: "Draft description",
    confidenceReason: "Enough evidence"
  };
  const meeting = { id: "meeting-1", projectId: "project-1", title: "Weekly" };
  const workItem = { id: "work-item-1", deletedAt: null, title: "Existing draft" };
  const { db, queries } = createQueryRecorder([
    [project],
    [{ insight, meeting }],
    [workItem]
  ]);
  const repository = createMeetingRepository(db);

  const result = await repository.insightToDraft({
    actorKind: "human",
    actorUserId: "user-1",
    projectId: "project-1",
    insightId: "insight-1"
  });

  assert.equal(result?.created, false);
  assert.equal(result?.workItem, workItem);
  const insightIndex = queries.findIndex((query) => query.fromTable === meetingInsights);
  const draftIndex = queries.findIndex((query) => query.fromTable === workItems);
  const insightQuery = queries[insightIndex];
  assert.equal(queries[0]?.fromTable, projects);
  assert.ok(insightIndex > -1 && draftIndex > insightIndex);
  assert.equal(insightQuery?.lock, "update");
  assert.ok(queryReferences(insightQuery?.where, meetingInsights.id));
  assert.ok(queryReferences(insightQuery?.where, meetingRecords.projectId));
});

test("meeting recordDraftProposal locks the source insight before the audit idempotency gate", async () => {
  const project = { id: "project-1", workspaceId: "workspace-1", archived: false, deletedAt: null };
  const insight = {
    id: "insight-1",
    meetingId: "meeting-1",
    createdWorkItemId: "work-item-1",
    status: "pending",
    title: "Draft title",
    description: "Draft description",
    confidenceReason: "Enough evidence"
  };
  const meeting = { id: "meeting-1", projectId: "project-1", title: "Weekly" };
  const { db, queries } = createQueryRecorder([
    [{ insight, meeting }],
    [project],
    [{ id: "audit-1" }]
  ]);
  const repository = createMeetingRepository(db);

  const result = await repository.recordDraftProposal({
    actorKind: "human",
    actorUserId: "user-1",
    workItemId: "work-item-1",
    proposalId: "proposal-1"
  });

  assert.equal(result?.created, false);
  const insightIndex = queries.findIndex((query) => query.fromTable === meetingInsights);
  const auditIndex = queries.findIndex((query) => query.fromTable === auditLogs);
  const insightQuery = queries[insightIndex];
  assert.ok(insightIndex > -1 && auditIndex > insightIndex);
  assert.equal(insightQuery?.lock, "update");
  assert.ok(queryReferences(insightQuery?.where, meetingInsights.createdWorkItemId));
});
