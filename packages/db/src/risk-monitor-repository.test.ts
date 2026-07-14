import assert from "node:assert/strict";
import test from "node:test";

import {
  listDailyCostByProjects,
  listOpenWorkItemAges,
  listProjectsPendingDigest
} from "./repositories/risk-monitor.js";
import {
  agentRuns,
  costLedgerEntries,
  notifications,
  projectAiGovernance,
  projectConversations,
  projects,
  workItems
} from "./schema/index.js";
import {
  createQueryRecorder,
  queryParamValues,
  queryRawStrings,
  queryReferences,
  queryTextFragments
} from "./test-query-recorder.js";

const projectId = "17000000-0000-4000-8000-000000000001";
const workspaceId = "17000000-0000-4000-8000-000000000002";
const ownerUserId = "17000000-0000-4000-8000-000000000003";

// §3.1: candidate project scan — main-conversation LEFT JOIN + governance LEFT JOIN + a NOT EXISTS
// anti-join against today's dedupeKey (the "already sent today" gate).
test("listProjectsPendingDigest joins governance + main conversation and anti-joins today's dedupeKey", async () => {
  const row = {
    projectId,
    projectName: "星尘短剧",
    workspaceId,
    ownerUserId,
    ownerNickname: "owner",
    mainConversationId: "17000000-0000-4000-8000-000000000004",
    riskMonitorJson: { enabled: true }
  };
  const { db, queries } = createQueryRecorder([[row]]);

  const result = await listProjectsPendingDigest(db, { utcDate: "2026-07-14", limit: 50 });

  assert.deepEqual(result, [row]);
  const query = queries[0];
  assert.equal(query?.fromTable, projects);
  assert.equal(query?.limit, 50);
  assert.deepEqual(query?.joins.map((join) => [join.kind, join.table]), [
    ["left", projectAiGovernance],
    ["left", projectConversations]
  ]);
  const mainJoin = query?.joins[1];
  for (const column of [projectConversations.projectId, projectConversations.kind, projectConversations.deletedAt]) {
    assert.equal(queryReferences(mainJoin?.on, column), true, "main-conversation join must filter by project + kind + not-deleted");
  }
  for (const column of [
    projects.archived,
    projects.deletedAt,
    projects.isPersonal,
    projects.ownerUserId,
    projects.workspaceId
  ]) {
    assert.equal(queryReferences(query?.where, column), true, `candidate scan missing predicate for ${String(column)}`);
  }
  const whereText = queryTextFragments(query?.where).join(" ");
  assert.match(whereText, /coalesce/iu, "must default risk_monitor.enabled to true when governance row is absent");
  assert.match(whereText, /not exists/iu, "must anti-join today's already-sent notifications");
  assert.match(whereText, /risk-digest:/u, "dedupeKey prefix must be baked into the anti-join");
  // utcDate is interpolated directly inside a raw sql`...` template (not through a typed eq()/gte()
  // helper), so drizzle carries it as a bare primitive queryChunk rather than a Param node — it still
  // becomes a proper bind parameter at real-query build time, but the query-recorder harness's
  // queryParamValues() only walks Param nodes; queryRawStrings() is the helper that also catches bare
  // primitives interpolated straight into a sql`` template.
  assert.ok(queryRawStrings(query?.where).includes("2026-07-14"));
});

test("listProjectsPendingDigest drops any row structurally missing owner/workspace instead of asserting", async () => {
  const { db } = createQueryRecorder([[
    {
      projectId,
      projectName: "无主遗留项目",
      workspaceId: null,
      ownerUserId: null,
      ownerNickname: "owner",
      mainConversationId: null,
      riskMonitorJson: null
    }
  ]]);

  const result = await listProjectsPendingDigest(db, { utcDate: "2026-07-14", limit: 50 });

  assert.deepEqual(result, []);
});

// §3.2: open work-item ages — excludes terminal statuses and work items with an active (queued/running)
// agent run via a NOT EXISTS subquery (a run in flight is "AI is busy", not "stalled").
test("listOpenWorkItemAges excludes terminal statuses and work items with an active agent run", async () => {
  const row = {
    projectId,
    id: "17000000-0000-4000-8000-000000000005",
    code: "WI-1",
    title: "接入支付",
    status: "spec_ready" as const,
    updatedAt: new Date("2026-07-01T00:00:00.000Z"),
    dueAt: null
  };
  const { db, queries } = createQueryRecorder([[row]]);

  const result = await listOpenWorkItemAges(db, { projectIds: [projectId], capPerBatch: 500 });

  assert.deepEqual(result, [row]);
  const query = queries[0];
  assert.equal(query?.fromTable, workItems);
  assert.equal(query?.limit, 500);
  for (const column of [workItems.projectId, workItems.deletedAt, workItems.status]) {
    assert.equal(queryReferences(query?.where, column), true, `open work-item scan missing predicate for ${String(column)}`);
  }
  const whereText = queryTextFragments(query?.where).join(" ");
  assert.match(whereText, /not exists/iu, "must anti-join active agent runs");
  assert.match(whereText, /queued/u);
  assert.match(whereText, /running/u);
  assert.equal(queryReferences(query?.where, agentRuns.workItemId), true);
  assert.equal(queryReferences(query?.where, agentRuns.status), true);
});

test("listOpenWorkItemAges short-circuits to an empty array without querying when given no project ids", async () => {
  const { db, queries } = createQueryRecorder([[{ never: "returned" }]]);

  const result = await listOpenWorkItemAges(db, { projectIds: [], capPerBatch: 500 });

  assert.deepEqual(result, []);
  assert.equal(queries.length, 0, "must not issue a query for an empty project id batch");
});

// §3.4: project-level daily cost — JOIN work_items (cost_ledger_entries has no project_id column),
// grouped by (project_id, period_bucket), scope_kind='workitem' only (avoids double-counting the
// same usage record fanned out across multiple ledger scopes).
test("listDailyCostByProjects joins work_items and groups by project + period bucket, scoped to workitem entries", async () => {
  const row = { projectId, periodBucket: "2026-07-14", costCny: "12.5" };
  const { db, queries } = createQueryRecorder([[row]]);

  const result = await listDailyCostByProjects(db, { projectIds: [projectId], sinceBucket: "2026-07-06" });

  assert.deepEqual(result, [row]);
  const query = queries[0];
  assert.equal(query?.fromTable, costLedgerEntries);
  assert.deepEqual(query?.joins.map((join) => [join.kind, join.table]), [["inner", workItems]]);
  for (const column of [costLedgerEntries.scopeKind, costLedgerEntries.periodBucket, workItems.projectId]) {
    assert.equal(queryReferences(query?.where, column), true, `daily cost scan missing predicate for ${String(column)}`);
  }
  assert.ok(query?.groupBy.length === 2, "must group by project + period bucket (one row per project per day)");
  const params = queryParamValues(query?.where);
  assert.ok(params.includes("workitem"));
  assert.ok(params.includes("2026-07-06"));
});

test("listDailyCostByProjects short-circuits to an empty array without querying when given no project ids", async () => {
  const { db, queries } = createQueryRecorder([[{ never: "returned" }]]);

  const result = await listDailyCostByProjects(db, { projectIds: [], sinceBucket: "2026-07-06" });

  assert.deepEqual(result, []);
  assert.equal(queries.length, 0, "must not issue a query for an empty project id batch");
});
