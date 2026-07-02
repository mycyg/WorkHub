import assert from "node:assert/strict";
import test from "node:test";

import { createProposalRepository } from "./repositories/proposals.js";
import { projects, proposals, workItems } from "./schema/index.js";
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
