import assert from "node:assert/strict";
import test from "node:test";

import { createProjectHealthRepository } from "./repositories/project-health.js";
import {
  agentRuns,
  approvalRequests,
  projects,
  workItemAssignments,
  workItems
} from "./schema/index.js";
import { createQueryRecorder, queryParamValues, queryReferences } from "./test-query-recorder.js";

// Old assertions read repository source text. That was wrong because source regexes can pass
// while the called repository returns unscoped rows or skips assignment enrichment at runtime.
test("project health repository applies actor visibility before bounded source reads", async () => {
  const project = {
    id: "project-1",
    workspaceId: "workspace-1",
    ownerUserId: "owner-1",
    archived: false,
    deletedAt: null,
    updatedAt: new Date("2026-07-02T08:00:00.000Z")
  };
  const openWorkItem = {
    workItem: { id: "work-item-open", status: "spec_ready", updatedAt: new Date("2026-07-02T08:01:00.000Z") },
    project,
    projectOrgId: "org-1"
  };
  const pendingApproval = {
    approval: { id: "approval-1", routedToUserId: "actor-1", status: "pending" },
    workItem: { id: "work-item-approval", status: "reviewing" },
    project,
    projectOrgId: "org-1"
  };
  const failedRun = {
    run: { id: "run-1", workItemId: "work-item-run", status: "failed", createdAt: new Date("2026-07-02T08:02:00.000Z") },
    workItem: { id: "work-item-run", status: "running" },
    project,
    projectOrgId: "org-1"
  };
  const pendingInsight = {
    insight: { id: "insight-1", status: "pending" },
    meeting: { id: "meeting-1", projectId: "project-1" },
    project,
    projectOrgId: "org-1"
  };
  const { db, queries } = createQueryRecorder([
    [{ project, orgId: "org-1" }],
    [openWorkItem],
    [pendingApproval],
    [failedRun],
    [pendingInsight],
    [{ workItemId: "work-item-open", userId: "actor-1", role: "reviewer" }],
    [{ workItemId: "work-item-approval", userId: "approver-1", role: "approver" }],
    [{ workItemId: "work-item-run", userId: "runner-1", role: "owner" }]
  ]);

  const repository = createProjectHealthRepository(db);
  const result = await repository.readProjectHealthSources({
    actor: { workspaceId: "workspace-1", userId: "actor-1" },
    failedRunsSince: new Date("2026-07-01T00:00:00.000Z"),
    limit: 2
  });

  assert.deepEqual(result.projects, [{ ...project, orgId: "org-1" }]);
  assert.deepEqual(result.openWorkItems[0]?.assignments, [
    { userId: "actor-1", role: "reviewer" }
  ]);
  assert.deepEqual(result.pendingApprovals[0]?.workItemAssignments, [
    { userId: "approver-1", role: "approver" }
  ]);
  assert.deepEqual(result.failedRuns[0]?.workItemAssignments, [
    { userId: "runner-1", role: "owner" }
  ]);

  const [projectQuery, openQuery, approvalQuery, failedRunQuery, insightQuery, ...assignmentQueries] = queries;
  assert.equal(projectQuery?.fromTable, projects);
  assert.equal(projectQuery?.limit, 2);
  assert.equal(openQuery?.fromTable, workItems);
  assert.equal(openQuery?.limit, 2);
  assert.ok(openQuery && openQuery.steps.indexOf("where") < openQuery.steps.indexOf("limit"));
  assert.ok(queryReferences(openQuery?.where, workItems.deletedAt));
  assert.ok(queryReferences(openQuery?.where, workItems.status));
  assert.ok(queryReferences(openQuery?.where, projects.archived));
  assert.ok(queryReferences(openQuery?.where, projects.deletedAt));
  assert.ok(queryReferences(openQuery?.where, workItemAssignments.workItemId));
  assert.ok(queryParamValues(openQuery?.where).includes("workspace-1"));
  assert.ok(queryParamValues(openQuery?.where).includes("actor-1"));

  assert.equal(approvalQuery?.fromTable, approvalRequests);
  assert.ok(queryReferences(approvalQuery?.where, approvalRequests.routedToUserId));
  assert.ok(queryParamValues(approvalQuery?.where).includes("actor-1"));
  assert.equal(failedRunQuery?.fromTable, agentRuns);
  assert.ok(queryReferences(failedRunQuery?.where, agentRuns.status));
  assert.ok(queryReferences(failedRunQuery?.where, agentRuns.createdAt));
  assert.equal(insightQuery?.limit, 2);
  assert.ok(assignmentQueries.every((query) => query.fromTable === workItemAssignments));
});
