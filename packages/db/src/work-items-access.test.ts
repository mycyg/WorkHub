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

// R15 批 D4：找人卡的 claim/reassign 落地写——CAS 只在事项仍无认领人时把它认领给指定用户。
test("claimOwnerlessWorkItem CAS-writes the claimer, guarded on a still-empty owner", async () => {
  const claimedRow = { id: "wi-1", claimedByUserId: "user-9" };
  const { db, queries } = createQueryRecorder([[claimedRow]]);
  const repository = createWorkItemRepository(db);

  const result = await repository.claimOwnerlessWorkItem({
    workItemId: "wi-1",
    workspaceId: "ws-1",
    userId: "user-9",
    at: new Date("2026-07-15T00:00:00.000Z")
  });

  assert.deepEqual(result, claimedRow);
  const [update] = queries;
  assert.equal(update?.targetTable, workItems);
  // CAS 守卫：id + workspace + 仍无认领人 + 非终态 + 未软删。
  assert.ok(queryReferences(update?.where, workItems.id));
  assert.ok(queryReferences(update?.where, workItems.workspaceId));
  assert.ok(queryReferences(update?.where, workItems.claimedByUserId));
  assert.ok(queryReferences(update?.where, workItems.status));
  assert.ok(queryReferences(update?.where, workItems.deletedAt));
  const setValue = update?.setValue as Record<string, unknown>;
  assert.equal(setValue["claimedByUserId"], "user-9");
  assert.ok("claimedByNickname" in setValue, "claimed nickname is written from a users subquery");
  assert.ok("version" in setValue, "version is bumped so clients see the ownership change");
});

test("claimOwnerlessWorkItem returns null when the CAS guard misses (already claimed)", async () => {
  const { db } = createQueryRecorder([[]]);
  const result = await createWorkItemRepository(db).claimOwnerlessWorkItem({
    workItemId: "wi-1",
    workspaceId: "ws-1",
    userId: "user-9",
    at: new Date("2026-07-15T00:00:00.000Z")
  });
  assert.equal(result, null);
});
