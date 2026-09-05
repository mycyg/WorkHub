import assert from "node:assert/strict";
import test from "node:test";

import { AUDIT_LOGS_FOR_WORK_ITEM_LIMIT } from "./repositories/audit.js";
import { createAuditLogRepository, createSnapshotRepository } from "./repositories/audit.js";
import { auditLogs, snapshots } from "./schema/index.js";
import { createQueryRecorder, queryParamValues, queryReferences, queryTextFragments } from "./test-query-recorder.js";

// db-repos-7: listAuditLogsForWorkItem 曾经无 limit 对 audit_logs 做无界扫描；这里断言真实
// 导出的常量而不是把数字写死在测试里，常量一改这条测试就跟着体现新值——防止两处漂移。
test("listAuditLogsForWorkItem exports a bounded default row limit", () => {
  assert.equal(typeof AUDIT_LOGS_FOR_WORK_ITEM_LIMIT, "number");
  assert.ok(
    AUDIT_LOGS_FOR_WORK_ITEM_LIMIT > 0 && AUDIT_LOGS_FOR_WORK_ITEM_LIMIT <= 1000,
    "work item audit timeline must stay bounded, not unlimited"
  );
});

// Old assertions matched repositories/audit.ts text. That was wrong because the risk is the
// repository issuing an unbounded or broad audit timeline query, not the source containing words.
test("work item audit timeline returns capped logs through narrowed audit predicates", async () => {
  const rows = [
    { id: "audit-1", entityType: "work_item", entityId: "work-item-1", action: "work_item.updated" },
    { id: "audit-2", entityType: "approval_request", entityId: "approval-1", action: "approval.approved" }
  ];
  const { db, queries } = createQueryRecorder([rows]);
  const repository = createAuditLogRepository(db);

  const result = await repository.listAuditLogsForWorkItem("work-item-1", { limit: 3 });

  assert.deepEqual(result, rows);
  const [query] = queries;
  assert.equal(query?.fromTable, auditLogs);
  assert.equal(query?.limit, 3);
  assert.ok(queryReferences(query?.where, auditLogs.entityType));
  assert.ok(queryReferences(query?.where, auditLogs.entityId));
  assert.ok(queryReferences(query?.where, auditLogs.detailJson));
  assert.ok(queryParamValues(query?.where).includes("work_item"));
  assert.ok(queryParamValues(query?.where).includes("work-item-1"));
  const fragments = queryTextFragments(query?.where).join(" ");
  assert.match(fragments, /approval_request/u);
  assert.match(fragments, /agent_run/u);
  assert.match(fragments, /work_item_id/u);
  assert.ok((query?.orderBy.length ?? 0) > 0);
});

// INF-10：快照行 + 审计行此前分两次写（audit 写失败留下 replay 反查不到的孤儿快照行）。
// createSnapshotWithAudit 把两表写放进同一事务，审计行的 snapshotId 指向同事务落库的快照。
test("INF-10: createSnapshotWithAudit writes the snapshot and its audit log in one transaction", async () => {
  const snapshotId = "70000000-0000-4000-8000-0000000000d1";
  const snapshotRow = {
    id: snapshotId,
    workItemId: "work-item-1",
    branchId: null,
    kind: "pre_step",
    ref: "snapshots/agent-runs/run-1/pre-step-1",
    contentSha256: null,
    createdByKind: "ai",
    revertedAt: null,
    createdAt: new Date("2026-07-04T00:00:00.000Z")
  };
  const auditRow = { id: "audit-inf10", snapshotId };
  const { db, queries, transactions } = createQueryRecorder([[snapshotRow], [auditRow]]);
  const repository = createSnapshotRepository(db);
  // 可选方法（additive 惯例）：这里顺带断言 PG 仓储确实实现了原子写，不退回两写路径。
  const createSnapshotWithAudit = repository.createSnapshotWithAudit?.bind(repository);
  assert.ok(createSnapshotWithAudit, "PG snapshot repository must implement the atomic write");

  const row = await createSnapshotWithAudit(
    {
      id: snapshotId,
      workItemId: "work-item-1",
      kind: "pre_step",
      ref: "snapshots/agent-runs/run-1/pre-step-1",
      createdByKind: "ai"
    },
    {
      actorKind: "ai",
      actorNickname: "WorkHub AI",
      entityType: "work_item",
      entityId: "work-item-1",
      action: "tool.write_file.snapshot",
      detailJson: { run_id: "run-1", tool_id: "write_file" }
    }
  );

  assert.equal(row.id, snapshotId);
  assert.equal(transactions.length, 1, "both writes share one transaction");
  assert.equal(transactions[0]?.outcome, "resolved");
  assert.equal(queries.length, 2, "exactly one snapshot insert + one audit insert");
  const [snapshotInsert, auditInsert] = queries;
  assert.equal(snapshotInsert?.operation, "insert");
  assert.equal(snapshotInsert?.targetTable, snapshots);
  assert.equal(auditInsert?.operation, "insert");
  assert.equal(auditInsert?.targetTable, auditLogs);
  assert.equal(
    (auditInsert?.valuesValue as Record<string, unknown> | undefined)?.snapshotId,
    snapshotId,
    "the audit row points at the snapshot written in the same transaction"
  );
});

test("INF-10: createSnapshotWithAudit rolls the snapshot back when the audit insert fails", async () => {
  const snapshotRow = {
    id: "70000000-0000-4000-8000-0000000000d2",
    workItemId: "work-item-1",
    branchId: null,
    kind: "pre_step",
    ref: "snapshots/agent-runs/run-2/pre-step-1",
    contentSha256: null,
    createdByKind: "ai",
    revertedAt: null,
    createdAt: new Date("2026-07-04T00:00:00.000Z")
  };
  // 第二次 insert（审计行）返回空数组 → 仓储抛错 → 事务整体回滚，不留孤儿快照行。
  const { db, transactions } = createQueryRecorder([[snapshotRow], []]);
  const repository = createSnapshotRepository(db);
  const createSnapshotWithAudit = repository.createSnapshotWithAudit?.bind(repository);
  assert.ok(createSnapshotWithAudit, "PG snapshot repository must implement the atomic write");

  await assert.rejects(
    async () => createSnapshotWithAudit(
      {
        id: snapshotRow.id,
        workItemId: "work-item-1",
        kind: "pre_step",
        ref: "snapshots/agent-runs/run-2/pre-step-1",
        createdByKind: "ai"
      },
      {
        actorKind: "ai",
        entityType: "work_item",
        entityId: "work-item-1",
        action: "tool.write_file.snapshot"
      }
    ),
    /Failed to create snapshot audit log/u
  );
  assert.equal(transactions[0]?.outcome, "rejected", "a failed audit write rolls back the snapshot row too");
});
