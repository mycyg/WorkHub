import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

test("project health repository applies actor visibility before source limits", () => {
  const source = readFileSync(join(process.cwd(), "src", "repositories", "project-health.ts"), "utf8");
  const start = source.indexOf("async readProjectHealthSources");
  assert.notEqual(start, -1);
  const body = source.slice(start);

  assert.match(body, /where\(and\(\.\.\.projectScopeConditions\(input\.actor\)\)\)/u);
  assert.match(body, /workItemScopeConditions\(input\.actor\)/u);
  assert.match(body, /eq\(approvalRequests\.routedToUserId,\s*input\.actor\.userId\)/u);
  assert.match(source, /notInArray\(workItems\.status,\s*privateWorkItemStatuses\)/u);
  assert.match(source, /from \$\{workItemAssignments\}/u);
});

test("project health repository scopes work-item signal sources by project before limits", () => {
  const source = readFileSync(join(process.cwd(), "src", "repositories", "project-health.ts"), "utf8");
  const start = source.indexOf("async readProjectHealthSources");
  assert.notEqual(start, -1);
  const body = source.slice(start);

  assert.match(
    body,
    /notInArray\(workItems\.status,\s*doneWorkItemStatuses\),\s*\.\.\.projectScopeConditions\(input\.actor\),\s*\.\.\.workItemScopeConditions\(input\.actor\)/su
  );
  assert.match(
    body,
    /eq\(approvalRequests\.status,\s*"pending"\),\s*isNotNull\(workItems\.id\),\s*isNull\(workItems\.deletedAt\),\s*\.\.\.projectScopeConditions\(input\.actor\),\s*\.\.\.workItemScopeConditions\(input\.actor\)/su
  );
  assert.match(
    body,
    /gte\(agentRuns\.createdAt,\s*input\.failedRunsSince\),\s*isNotNull\(workItems\.id\),\s*isNull\(workItems\.deletedAt\),\s*notInArray\(workItems\.status,\s*doneWorkItemStatuses\),\s*\.\.\.projectScopeConditions\(input\.actor\),\s*\.\.\.workItemScopeConditions\(input\.actor\)/su
  );
});
