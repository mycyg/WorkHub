import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { AUDIT_LOGS_FOR_WORK_ITEM_LIMIT } from "./repositories/audit.js";

// db-repos-7: listAuditLogsForWorkItem 曾经无 limit 对 audit_logs 做无界扫描；这里断言真实
// 导出的常量而不是把数字写死在测试里，常量一改这条测试就跟着体现新值——防止两处漂移。
test("listAuditLogsForWorkItem exports a bounded default row limit", () => {
  assert.equal(typeof AUDIT_LOGS_FOR_WORK_ITEM_LIMIT, "number");
  assert.ok(
    AUDIT_LOGS_FOR_WORK_ITEM_LIMIT > 0 && AUDIT_LOGS_FOR_WORK_ITEM_LIMIT <= 1000,
    "work item audit timeline must stay bounded, not unlimited"
  );
});

test("work item audit timeline includes proposal and deliverable logs anchored by detail work_item_id, capped and narrowed by entity type", () => {
  const source = readFileSync(join(process.cwd(), "src", "repositories", "audit.ts"), "utf8");
  const start = source.indexOf("async listAuditLogsForWorkItem");
  const end = source.indexOf("async markAuditLogUndone", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const body = source.slice(start, end);

  // 主路径仍走 (entity_type, entity_id) 索引。
  assert.match(body, /eq\(auditLogs\.entityType,\s*"work_item"\)/u);
  assert.match(body, /eq\(auditLogs\.entityId,\s*workItemId\)/u);
  // 补充路径必须先收窄 entityType 到会写 work_item_id 到 detailJson 的那两类，
  // 而不是对整表做 JSON 提取（db-repos-7 的核心修复点）。
  assert.match(body, /entityType.*in\s*\(\s*'approval_request',\s*'agent_run'\s*\)/u);
  assert.match(body, /auditLogs\.detailJson/u);
  assert.match(body, /work_item_id/u);
  assert.match(body, /or\(/u);
  // 必须有上限，且默认用导出的常量而不是魔法数字。
  assert.match(body, /\.limit\(limit\)/u);
  assert.match(body, /AUDIT_LOGS_FOR_WORK_ITEM_LIMIT/u);
});
