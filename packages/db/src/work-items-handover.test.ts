import assert from "node:assert/strict";
import test from "node:test";

import { createWorkItemRepository } from "./repositories/work-items.js";
import { auditLogs, workItems } from "./schema/index.js";
import { createQueryRecorder, queryReferences } from "./test-query-recorder.js";

// R21 加固（A8 停用善后审计缺口）：unassignActiveClaimsForUserWithAudit 必须把「退回认领 + 逐项审计」
// 收进同一个 db 事务——审计写失败则退回一并回滚（真回滚语义只有真 PG 能验，这里用 query recorder 钉住
// 结构：单事务、UPDATE 在前、每条受影响行各一条 audit_logs INSERT、字段与顺序写路径逐字一致）。

const at = new Date("2026-07-18T09:00:00.000Z");
const targetUserId = "a0000000-0000-4000-8000-000000000001";
const actorUserId = "a0000000-0000-4000-8000-000000000002";

test("unassignActiveClaimsForUserWithAudit runs the unassign UPDATE and per-item audit INSERTs in one transaction", async () => {
  // responses[0] = UPDATE ... RETURNING 两条受影响行；后续每条 INSERT 各消费一个空响应。
  const { db, queries, transactions } = createQueryRecorder([[{ id: "wi-1" }, { id: "wi-2" }], [], []]);
  const repository = createWorkItemRepository(db);

  const affected = await repository.unassignActiveClaimsForUserWithAudit!({
    userId: targetUserId,
    at,
    actorUserId
  });

  assert.deepEqual(affected, [{ id: "wi-1" }, { id: "wi-2" }]);
  // 单事务收口，且事务正常提交。
  assert.deepEqual(transactions, [{ outcome: "resolved" }]);

  const update = queries.find((q) => q.operation === "update");
  assert.ok(update, "must issue the unassign UPDATE");
  assert.equal(update?.targetTable, workItems);
  assert.equal(update?.returningCalled, true);
  assert.ok(queryReferences(update?.where, workItems.claimedByUserId));
  assert.ok(queryReferences(update?.where, workItems.status), "terminal statuses stay untouched");
  assert.ok(queryReferences(update?.where, workItems.deletedAt), "soft-deleted items stay untouched");

  const inserts = queries.filter((q) => q.operation === "insert");
  assert.equal(inserts.length, 2, "one audit row per handed-over item");
  for (const [index, insert] of inserts.entries()) {
    assert.equal(insert.targetTable, auditLogs);
    const values = insert.valuesValue as Record<string, unknown>;
    assert.equal(values["actorKind"], "human");
    assert.equal(values["actorUserId"], actorUserId);
    assert.equal(values["entityType"], "work_item");
    assert.equal(values["entityId"], index === 0 ? "wi-1" : "wi-2");
    assert.equal(values["action"], "work_item.unassigned_on_offboarding");
    assert.deepEqual(values["detailJson"], { offboarded_user_id: targetUserId });
  }
});

test("unassignActiveClaimsForUserWithAudit writes no audit rows when nothing was claimed (idempotent rerun)", async () => {
  const { db, queries, transactions } = createQueryRecorder([[]]);
  const repository = createWorkItemRepository(db);

  const affected = await repository.unassignActiveClaimsForUserWithAudit!({
    userId: targetUserId,
    at,
    actorUserId
  });

  assert.deepEqual(affected, []);
  assert.deepEqual(transactions, [{ outcome: "resolved" }]);
  assert.equal(queries.filter((q) => q.operation === "insert").length, 0);
});
