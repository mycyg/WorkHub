import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

test("work item audit timeline includes proposal and deliverable logs anchored by detail work_item_id", () => {
  const source = readFileSync(join(process.cwd(), "src", "repositories", "audit.ts"), "utf8");
  const start = source.indexOf("async listAuditLogsForWorkItem");
  const end = source.indexOf("async markAuditLogUndone", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const body = source.slice(start, end);

  assert.match(body, /eq\(auditLogs\.entityType,\s*"work_item"\)/u);
  assert.match(body, /eq\(auditLogs\.entityId,\s*workItemId\)/u);
  assert.match(body, /auditLogs\.detailJson/u);
  assert.match(body, /work_item_id/u);
  assert.match(body, /or\(/u);
});
