import assert from "node:assert/strict";
import test from "node:test";

import { createWorkItemRepository } from "./repositories/work-items.js";
import { projects, workItemAssignments, workItems, workspaces } from "./schema/index.js";
import { createQueryRecorder, queryReferences } from "./test-query-recorder.js";

// Old assertions inspected the work-items source text. That was wrong because permission
// callers need the repository result to carry orgId and assignments after the joins run.
test("findWorkItemAccessRecord returns project org id and assignment rows", async () => {
  const accessRow = {
    id: "work-item-1",
    status: "spec_ready",
    submitterUserId: "submitter-1",
    claimedByUserId: "claimer-1",
    workspaceId: "workspace-item",
    projectArchived: false,
    projectDeletedAt: null,
    projectOwnerUserId: "owner-1",
    projectWorkspaceId: "workspace-project",
    projectOrgId: "org-1"
  };
  const assignments = [
    { userId: "reviewer-1", role: "reviewer" },
    { userId: "owner-1", role: "owner" }
  ];
  const { db, queries } = createQueryRecorder([[accessRow], assignments]);
  const repository = createWorkItemRepository(db);

  const result = await repository.findWorkItemAccessRecord("work-item-1");

  assert.deepEqual(result, {
    id: "work-item-1",
    // R11：通知点名事项——access 查询顺带带出 code/title（recorder 夹具行没给则为 undefined）。
    code: undefined,
    title: undefined,
    status: "spec_ready",
    submitterUserId: "submitter-1",
    claimedByUserId: "claimer-1",
    workspaceId: "workspace-item",
    project: {
      archived: false,
      deletedAt: null,
      ownerUserId: "owner-1",
      name: undefined,
      workspaceId: "workspace-project",
      orgId: "org-1"
    },
    assignments
  });

  const [accessQuery, assignmentQuery] = queries;
  assert.equal(accessQuery?.fromTable, workItems);
  assert.deepEqual(accessQuery?.joins.map((join) => [join.kind, join.table]), [
    ["inner", projects],
    ["left", workspaces]
  ]);
  assert.equal(accessQuery?.limit, 1);
  assert.ok(queryReferences(accessQuery?.where, workItems.id));
  assert.equal(assignmentQuery?.fromTable, workItemAssignments);
  assert.ok(queryReferences(assignmentQuery?.where, workItemAssignments.workItemId));
});
