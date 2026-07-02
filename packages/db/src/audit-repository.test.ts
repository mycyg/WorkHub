import assert from "node:assert/strict";
import test from "node:test";

import { AUDIT_LOGS_FOR_WORK_ITEM_LIMIT } from "./repositories/audit.js";
import { createAuditLogRepository } from "./repositories/audit.js";
import { auditLogs } from "./schema/index.js";
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
