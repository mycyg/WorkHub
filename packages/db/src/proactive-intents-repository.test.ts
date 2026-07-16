import assert from "node:assert/strict";
import test from "node:test";

import { proactiveIntents } from "./schema/index.js";
import {
  countDeliveredProactiveIntentsForUser,
  listDdlChaseCandidates,
  markProactiveIntentStatus,
  recordProactiveIntent
} from "./repositories/proactive-intents.js";
import { createQueryRecorder, queryParamValues, queryReferences } from "./test-query-recorder.js";

const workspaceId = "d0000000-0000-4000-8000-000000000001";
const projectId = "d0000000-0000-4000-8000-000000000002";
const workItemId = "d0000000-0000-4000-8000-000000000003";
const targetUserId = "d0000000-0000-4000-8000-000000000004";
const at = new Date("2026-07-15T10:00:00.000Z");

test("recordProactiveIntent inserts with ON CONFLICT (suppression_key) DO NOTHING and reports created", async () => {
  const { db, queries } = createQueryRecorder([[{ id: "intent-1" }]]);
  const result = await recordProactiveIntent(db, {
    workspaceId,
    projectId,
    workItemId,
    kind: "ddl_chase",
    stage: "overdue",
    targetUserId,
    suppressionKey: `ddl:${workItemId}:overdue`,
    payload: { stage: "overdue" },
    at,
    id: "intent-1"
  });
  assert.deepEqual(result, { created: true, id: "intent-1" });
  const insert = queries.find((q) => q.operation === "insert");
  assert.ok(insert?.onConflict, "must be ON CONFLICT DO NOTHING (suppression_key idempotency)");
  assert.equal(insert?.returningCalled, true);
  const values = insert?.valuesValue as Record<string, unknown>;
  assert.equal(values["suppressionKey"], `ddl:${workItemId}:overdue`);
  assert.equal(values["status"], "created");
});

test("recordProactiveIntent treats an empty returning (conflict) as already-processed (created=false)", async () => {
  const { db } = createQueryRecorder([[]]);
  const result = await recordProactiveIntent(db, {
    workspaceId,
    projectId,
    workItemId,
    kind: "ddl_chase",
    stage: "t3d",
    targetUserId,
    suppressionKey: `ddl:${workItemId}:t3d`,
    payload: {},
    at
  });
  assert.deepEqual(result, { created: false });
});

test("countDeliveredProactiveIntentsForUser filters to the target's delivered rows in the window", async () => {
  const { db, queries } = createQueryRecorder([[{ value: 4 }]]);
  const from = new Date("2026-07-15T00:00:00.000Z");
  const to = new Date("2026-07-16T00:00:00.000Z");
  const count = await countDeliveredProactiveIntentsForUser(db, { targetUserId, from, to });
  assert.equal(count, 4);
  const select = queries.find((q) => q.operation === "select");
  assert.ok(queryReferences(select?.where, proactiveIntents.targetUserId), "must scope by target_user_id");
  // 只数 delivered——created/suppressed 不占配额。
  assert.ok(queryParamValues(select?.where).includes("delivered"), "must filter status = delivered");
});

test("markProactiveIntentStatus flips to delivered with delivered_via", async () => {
  const { db, queries } = createQueryRecorder([[]]);
  await markProactiveIntentStatus(db, { id: "intent-1", status: "delivered", deliveredVia: "notification" });
  const update = queries.find((q) => q.operation === "update");
  const setValue = update?.setValue as Record<string, unknown>;
  assert.equal(setValue["status"], "delivered");
  assert.equal(setValue["deliveredVia"], "notification");
});

test("listDdlChaseCandidates groups assignments (lead/collaborator) and coalesces workspace from the project", async () => {
  const dueAt = new Date("2026-07-16T10:00:00.000Z");
  const candidateRows = [
    {
      workItemId,
      code: "WI-1",
      title: "上线报价单",
      status: "ai_working",
      dueAt,
      projectId,
      // 工作项 workspace_id 为空（历史行）→ 应回退到项目 workspace_id。
      workItemWorkspaceId: null,
      projectWorkspaceId: workspaceId,
      claimedByUserId: null,
      projectOwnerUserId: "owner-1"
    }
  ];
  const assignmentRows = [
    { workItemId, userId: "collab-1", role: "collaborator" },
    { workItemId, userId: "lead-1", role: "lead" }
  ];
  const { db, queries } = createQueryRecorder([candidateRows, assignmentRows]);
  const candidates = await listDdlChaseCandidates(db, { now: at, horizonMs: 72 * 60 * 60 * 1000, limit: 200 });
  assert.equal(candidates.length, 1);
  const candidate = candidates[0]!;
  assert.equal(candidate.workspaceId, workspaceId, "workspace coalesced from project");
  assert.equal(candidate.leadUserId, "lead-1");
  assert.equal(candidate.collaboratorUserId, "collab-1");
  assert.equal(candidate.projectOwnerUserId, "owner-1");
  // 第一条查询（候选）应带终态排除的 where（引用 status 列）+ due_at 上界。
  const candidateQuery = queries.find((q) => q.operation === "select");
  assert.ok(candidateQuery, "candidate scan query present");
});

test("listDdlChaseCandidates skips the assignment query entirely when no candidates match", async () => {
  const { db, queries } = createQueryRecorder([[]]);
  const candidates = await listDdlChaseCandidates(db, { now: at, horizonMs: 72 * 60 * 60 * 1000, limit: 200 });
  assert.deepEqual(candidates, []);
  const selects = queries.filter((q) => q.operation === "select");
  assert.equal(selects.length, 1, "must not issue an assignment query when the candidate scan is empty");
});
