import assert from "node:assert/strict";
import test from "node:test";

import { listCostByAssigneeForWorkspace } from "./repositories/cost-ledger.js";
import { agentRuns, costLedgerEntries, users } from "./schema/index.js";
import { createQueryRecorder, queryParamValues, queryReferences } from "./test-query-recorder.js";

// R13 批 P4（labor-split 按 assignee 记账）：cost_ledger_entries 本身没有「谁执行的」这一维度——
// 只有 usage.userId 的反规范化列（语义是「起意者」，不一定等于真正跑活的人）。任务书明确要求按
// agent_runs.actor_user_id（run 的执行身份=assignee）聚合，所以这条查询必须 LEFT JOIN agent_runs
// 再 LEFT JOIN users 拿昵称——不能只读 cost_ledger_entries.user_id 这个既有列敷衍过去。
test("listCostByAssigneeForWorkspace joins agent_runs + users and aggregates in one grouped query", async () => {
  const rows = [
    { actorUserId: "user-1", nickname: "张三", costCny: "1.5", tokens: 400, runCount: 2 },
    { actorUserId: null, nickname: null, costCny: "0.25", tokens: 50, runCount: 0 }
  ];
  const { db, queries } = createQueryRecorder([rows]);

  const result = await listCostByAssigneeForWorkspace(db, {
    teamId: "workspace-1",
    sinceBucket: "2026-07-01",
    limit: 10
  });

  assert.deepEqual(result, rows);
  const [query] = queries;
  assert.equal(query?.fromTable, costLedgerEntries);
  assert.deepEqual(query?.joins.map((join) => [join.kind, join.table]), [
    ["left", agentRuns],
    ["left", users]
  ]);
  assert.equal(query?.limit, 10);
  assert.ok(query?.groupBy.length === 2, "should group by actor_user_id and nickname (one row per assignee)");
  assert.ok(queryReferences(query?.where, costLedgerEntries.scopeKind));
  assert.ok(queryReferences(query?.where, costLedgerEntries.scopeId));
  assert.ok(queryReferences(query?.where, costLedgerEntries.periodBucket));
  const params = queryParamValues(query?.where);
  assert.ok(params.includes("team"));
  assert.ok(params.includes("curation"));
  assert.ok(params.includes("workspace-1"));
  assert.ok(params.includes("2026-07-01"));
});

test("listCostByAssigneeForWorkspace clamps limit into [1, 200] and defaults without sinceBucket", async () => {
  const { db, queries } = createQueryRecorder([[]]);

  await listCostByAssigneeForWorkspace(db, { teamId: "workspace-1", limit: 10000 });

  const [query] = queries;
  assert.equal(query?.limit, 200);
  assert.equal(queryReferences(query?.where, costLedgerEntries.periodBucket), false);
});

test("listCostByAssigneeForWorkspace defaults to 50 rows when no limit is given", async () => {
  const { db, queries } = createQueryRecorder([[]]);

  await listCostByAssigneeForWorkspace(db, { teamId: "workspace-1" });

  const [query] = queries;
  assert.equal(query?.limit, 50);
});
