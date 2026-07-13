import assert from "node:assert/strict";
import test from "node:test";

import { createProposalRepository } from "./repositories/proposals.js";
import { projects, proposals, reviews, workItems } from "./schema/index.js";
import { createQueryRecorder, queryParamValues, queryReferences } from "./test-query-recorder.js";

// Old assertions regexed repositories/proposals.ts. That was wrong because the queue must
// prove the public repository method actually returns scoped rows and builds live-entity guards.
test("proposal review queue refuses non-admin reads without an actor", async () => {
  const { db, queries } = createQueryRecorder();
  const repository = createProposalRepository(db);

  const rows = await repository.listReviewable({ includeAll: false });

  assert.deepEqual(rows, []);
  assert.equal(queries.length, 0);
});

test("proposal review queue joins live work items and projects under workspace scope", async () => {
  const row = {
    id: "proposal-1",
    workItemId: "work-item-1",
    title: "Reviewable proposal",
    status: "opened",
    createdAt: new Date("2026-07-02T08:00:00.000Z")
  };
  const { db, queries } = createQueryRecorder([[row]]);
  const repository = createProposalRepository(db);

  const rows = await repository.listReviewable({
    includeAll: false,
    submitterUserId: "user-1",
    workspaceId: "workspace-1",
    limit: 7
  });

  assert.deepEqual(rows, [row]);
  const [query] = queries;
  assert.equal(query?.fromTable, proposals);
  assert.deepEqual(query?.joins.map((join) => [join.kind, join.table]), [
    ["inner", workItems],
    ["inner", projects]
  ]);
  assert.equal(query?.limit, 7);
  assert.ok(query && query.steps.indexOf("where") < query.steps.indexOf("limit"));
  assert.ok(queryReferences(query?.where, proposals.status));
  assert.ok(queryReferences(query?.where, workItems.deletedAt));
  assert.ok(queryReferences(query?.where, projects.archived));
  assert.ok(queryReferences(query?.where, projects.deletedAt));
  assert.ok(queryReferences(query?.where, workItems.workspaceId));
  assert.ok(queryReferences(query?.where, projects.workspaceId));
  assert.ok(queryReferences(query?.where, workItems.submitterUserId));
  const params = queryParamValues(query?.where).flatMap((value) => Array.isArray(value) ? value : [value]);
  assert.ok(params.includes("opened"));
  assert.ok(params.includes("reviewed"));
  assert.ok(params.includes("workspace-1"));
  assert.ok(params.includes("user-1"));
});

// R13 批 P4（KPI：AI 自动合并数/占比）：today's approve-decision reviews, split by reviewer kind.
test("countTodayMergeReviewsByActorKind scopes to approved reviews within the workspace and splits ai vs human", async () => {
  const rows = [
    { reviewerKind: "ai" },
    { reviewerKind: "human" },
    { reviewerKind: "ai" }
  ];
  const { db, queries } = createQueryRecorder([rows]);
  const repository = createProposalRepository(db);

  const result = await repository.countTodayMergeReviewsByActorKind({
    workspaceId: "workspace-1",
    now: new Date("2026-07-13T12:00:00.000Z")
  });

  assert.deepEqual(result, { total: 3, aiApproved: 2 });
  const [query] = queries;
  assert.equal(query?.fromTable, reviews);
  assert.deepEqual(query?.joins.map((join) => [join.kind, join.table]), [
    ["inner", proposals],
    ["inner", workItems],
    ["inner", projects]
  ]);
  assert.equal(query?.limit, 500);
  assert.ok(queryReferences(query?.where, reviews.decision));
  assert.ok(queryReferences(query?.where, workItems.workspaceId));
  assert.ok(queryReferences(query?.where, projects.workspaceId));
  assert.ok(queryReferences(query?.where, reviews.createdAt));
  const params = queryParamValues(query?.where);
  assert.ok(params.includes("approve"));
  assert.ok(params.includes("workspace-1"));
  // it must NOT pre-filter by reviewerKind (that's the whole point vs. countTodayAiReviewOutcomes).
  assert.equal(queryReferences(query?.where, reviews.reviewerKind), false);
});

test("countTodayMergeReviewsByActorKind returns a zero-safe shape with no reviews today", async () => {
  const { db } = createQueryRecorder([[]]);
  const repository = createProposalRepository(db);

  const result = await repository.countTodayMergeReviewsByActorKind({ workspaceId: "workspace-1" });

  assert.deepEqual(result, { total: 0, aiApproved: 0 });
});

// R13 批 P4（reviewer_kind 溯源）：batch review lookup for accepted_deliverables' reviewer_kind attribution.
test("listReviewsByProposalIds returns [] without querying for an empty id list", async () => {
  const { db, queries } = createQueryRecorder();
  const repository = createProposalRepository(db);

  const rows = await repository.listReviewsByProposalIds([]);

  assert.deepEqual(rows, []);
  assert.equal(queries.length, 0);
});

test("listReviewsByProposalIds batches an IN query ordered by createdAt so the latest review wins on dedupe", async () => {
  const reviewRows = [
    { id: "review-1", proposalId: "proposal-1", reviewerKind: "human", decision: "approve", createdAt: new Date("2026-07-10T00:00:00.000Z") },
    { id: "review-2", proposalId: "proposal-1", reviewerKind: "ai", decision: "approve", createdAt: new Date("2026-07-11T00:00:00.000Z") }
  ];
  const { db, queries } = createQueryRecorder([reviewRows]);
  const repository = createProposalRepository(db);

  const rows = await repository.listReviewsByProposalIds(["proposal-1", "proposal-2"]);

  assert.deepEqual(rows, reviewRows);
  const [query] = queries;
  assert.equal(query?.fromTable, reviews);
  assert.ok(queryReferences(query?.where, reviews.proposalId));
  assert.deepEqual(queryParamValues(query?.where), ["proposal-1", "proposal-2"]);
  assert.ok(query?.orderBy.length, "should be ordered so callers can take the last approve per proposal");
});
