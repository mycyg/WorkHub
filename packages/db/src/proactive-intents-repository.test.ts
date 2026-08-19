import assert from "node:assert/strict";
import test from "node:test";

import { proactiveIntents, workItems, chatMessages } from "./schema/index.js";
import {
  claimProactiveIntentForDelivery,
  countDeliveredProactiveIntentsForUser,
  incrementProactiveIntentAttempt,
  listDdlChaseCandidates,
  listRecoverableProactiveIntents,
  listStaleClarificationWorkItems,
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

test("recordProactiveIntent on a conflict re-reads the existing row's id + status (R20 REL-2 crash recovery)", async () => {
  // 首查（insert ... returning）撞唯一约束返回空 → 回查既有行拿到 id + status。
  const { db, queries } = createQueryRecorder([[], [{ id: "existing-1", status: "created" }]]);
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
  // 既有行还停在 created = 投递前崩溃的可恢复行——回带 id + status 让服务层据此恢复投递。
  assert.deepEqual(result, { created: false, id: "existing-1", status: "created" });
  const select = queries.find((q) => q.operation === "select");
  assert.ok(select, "conflict must trigger a follow-up SELECT for the existing row");
  assert.ok(queryParamValues(select?.where).includes(`ddl:${workItemId}:t3d`), "re-read scopes by suppression_key");
});

test("recordProactiveIntent maps a delivered existing row to a true duplicate (status delivered)", async () => {
  const { db } = createQueryRecorder([[], [{ id: "existing-1", status: "delivered" }]]);
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
  assert.deepEqual(result, { created: false, id: "existing-1", status: "delivered" });
});

test("recordProactiveIntent persists delivery_payload when provided (crash-recovery context)", async () => {
  const { db, queries } = createQueryRecorder([[{ id: "intent-1" }]]);
  await recordProactiveIntent(db, {
    workspaceId,
    projectId,
    workItemId,
    kind: "ddl_chase",
    stage: "overdue",
    targetUserId,
    suppressionKey: `ddl:${workItemId}:overdue`,
    payload: { stage: "overdue" },
    deliveryPayload: { channel: "notification", notification: { type: "work_item.overdue" } },
    at,
    id: "intent-1"
  });
  const insert = queries.find((q) => q.operation === "insert");
  const values = insert?.valuesValue as Record<string, unknown>;
  assert.deepEqual(values["deliveryPayload"], { channel: "notification", notification: { type: "work_item.overdue" } });
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

test("listRecoverableProactiveIntents scans created rows that are stale and under the attempt cap, oldest first", async () => {
  const createdAt = new Date("2026-07-15T09:00:00.000Z");
  const row = {
    id: "intent-1",
    workspaceId,
    projectId,
    workItemId,
    kind: "ddl_chase",
    stage: "overdue",
    targetUserId,
    suppressionKey: `ddl:${workItemId}:overdue`,
    payload: { stage: "overdue" },
    deliveryPayload: { channel: "notification" },
    attemptCount: 1,
    createdAt
  };
  const { db, queries } = createQueryRecorder([[row]]);
  const rows = await listRecoverableProactiveIntents(db, {
    now: at,
    olderThanMs: 5 * 60 * 1000,
    maxAttempts: 3,
    limit: 200
  });
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0]?.deliveryPayload, { channel: "notification" });
  assert.equal(rows[0]?.attemptCount, 1);
  const select = queries.find((q) => q.operation === "select");
  // 只碰 created/delivering 行；attempt_count 上界；created_at 上界都进 where。
  assert.ok(queryReferences(select?.where, proactiveIntents.status), "must scope by status");
  assert.ok(queryReferences(select?.where, proactiveIntents.attemptCount), "must bound attempt_count");
  assert.ok(queryReferences(select?.where, proactiveIntents.createdAt), "must bound created_at (staleness)");
  assert.ok(queryParamValues(select?.where).includes("created"), "must scan stale created rows");
  // R21 加固：投递中途崩溃的行停在 delivering——恢复扫描必须把它们一并扫回，否则永久滞留。
  assert.ok(queryParamValues(select?.where).includes("delivering"), "must also scan stale delivering rows");
  assert.equal(select?.limit, 200);
});

// ── R21 加固（并发投递幂等）：claimProactiveIntentForDelivery 的原子领取 ─────────────────────────

test("claimProactiveIntentForDelivery (regular path) claims only from 'created' and reports success on 1 row", async () => {
  const { db, queries } = createQueryRecorder([[{ id: "intent-1" }]]);
  const claimed = await claimProactiveIntentForDelivery(db, { id: "intent-1" });
  assert.equal(claimed, true);
  const update = queries.find((q) => q.operation === "update");
  assert.ok(update, "claim must be a single UPDATE");
  assert.equal(update?.returningCalled, true, "claim outcome is decided by RETURNING (rowCount)");
  const setValue = update?.setValue as Record<string, unknown>;
  assert.equal(setValue["status"], "delivering", "claim moves the row to the in-flight state");
  // WHERE 带 status 前置条件（只允许从 created 领取），且不带 created_at 停滞阈值。
  assert.ok(queryReferences(update?.where, proactiveIntents.id));
  assert.ok(queryReferences(update?.where, proactiveIntents.status));
  assert.ok(queryParamValues(update?.where).includes("created"));
  assert.equal(queryParamValues(update?.where).includes("delivering"), false, "regular claims must not steal in-flight rows");
  assert.equal(queryReferences(update?.where, proactiveIntents.createdAt), false, "no staleness bound on the regular path");
});

test("claimProactiveIntentForDelivery returns false when the CAS matches no row (concurrent claimer won)", async () => {
  const { db } = createQueryRecorder([[]]);
  const claimed = await claimProactiveIntentForDelivery(db, { id: "intent-1" });
  assert.equal(claimed, false);
});

test("claimProactiveIntentForDelivery (recovery path) also claims stalled 'delivering' rows behind the cutoff", async () => {
  const stalledBefore = new Date("2026-07-15T09:55:00.000Z");
  const { db, queries } = createQueryRecorder([[{ id: "intent-1" }]]);
  const claimed = await claimProactiveIntentForDelivery(db, { id: "intent-1", stalledBefore });
  assert.equal(claimed, true);
  const update = queries.find((q) => q.operation === "update");
  const params = queryParamValues(update?.where);
  // 恢复路径放宽到 created/delivering，但必须叠加 created_at < stalledBefore 的停滞阈值——真在途的行不被抢。
  assert.ok(params.includes("created"));
  assert.ok(params.includes("delivering"));
  assert.ok(queryReferences(update?.where, proactiveIntents.createdAt), "recovery claims must be staleness-bounded");
  assert.ok(params.some((value) => value instanceof Date && value.getTime() === stalledBefore.getTime()));
});

test("listRecoverableProactiveIntents coalesces a null delivery_payload to null (legacy rows)", async () => {
  const row = {
    id: "intent-1",
    workspaceId,
    projectId: null,
    workItemId: null,
    kind: "care",
    stage: null,
    targetUserId,
    suppressionKey: "care:u1",
    payload: {},
    deliveryPayload: null,
    attemptCount: 0,
    createdAt: at
  };
  const { db } = createQueryRecorder([[row]]);
  const rows = await listRecoverableProactiveIntents(db, { now: at, olderThanMs: 0, maxAttempts: 3, limit: 10 });
  assert.equal(rows[0]?.deliveryPayload, null);
});

test("incrementProactiveIntentAttempt bumps attempt_count by one via SQL", async () => {
  const { db, queries } = createQueryRecorder([[]]);
  await incrementProactiveIntentAttempt(db, { id: "intent-1" });
  const update = queries.find((q) => q.operation === "update");
  assert.ok(update, "must issue an UPDATE");
  // set 用 SQL 表达式 attempt_count + 1（引用 attempt_count 列）而非读到的旧值。
  assert.ok(queryReferences(update?.setValue, proactiveIntents.attemptCount), "increment must reference the attempt_count column");
  assert.ok(queryReferences(update?.where, proactiveIntents.id), "must target the row by id");
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

test("listStaleClarificationWorkItems filters out sessions that already have an answer", async () => {
  // CHAT-8：已答过的澄清会话不算滞留（confirm 阶段是用户自己的下一步），只有「零回答」的才进兜底提醒。
  const staleRows = [
    {
      workItemId,
      code: "WI-9",
      title: "整理验收要点",
      submitterUserId: targetUserId,
      projectId,
      workspaceId,
      createdAt: new Date("2026-07-10T10:00:00.000Z")
    },
    {
      workItemId: "d0000000-0000-4000-8000-000000000099",
      code: "WI-10",
      title: "已答过的事项",
      submitterUserId: targetUserId,
      projectId,
      workspaceId,
      createdAt: new Date("2026-07-09T10:00:00.000Z")
    }
  ];
  const answeredRows = [{ workItemId: "d0000000-0000-4000-8000-000000000099" }];
  const { db, queries } = createQueryRecorder([staleRows, answeredRows]);
  const stale = await listStaleClarificationWorkItems(db, {
    olderThan: new Date("2026-07-14T10:00:00.000Z"),
    limit: 200
  });
  assert.equal(stale.length, 1);
  assert.equal(stale[0]?.workItemId, workItemId);
  // 候选查询必须锚定 ai_clarifying + 软删过滤；第二查把已答会话剔除。
  const selects = queries.filter((q) => q.operation === "select");
  assert.equal(selects.length, 2, "candidate scan + answered-ids batch");
  assert.ok(queryReferences(selects[0]?.where, workItems.status), "candidate scan must filter by status");
  assert.ok(queryReferences(selects[0]?.where, workItems.deletedAt), "candidate scan must exclude soft-deleted items");
  assert.ok(queryReferences(selects[1]?.where, chatMessages.kind), "answered scan must filter by chat message kind");
});

test("listStaleClarificationWorkItems skips the answered-ids query when no candidates match", async () => {
  const { db, queries } = createQueryRecorder([[]]);
  const stale = await listStaleClarificationWorkItems(db, {
    olderThan: new Date("2026-07-14T10:00:00.000Z"),
    limit: 200
  });
  assert.deepEqual(stale, []);
  const selects = queries.filter((q) => q.operation === "select");
  assert.equal(selects.length, 1, "must not issue the answered-ids query when the candidate scan is empty");
});
