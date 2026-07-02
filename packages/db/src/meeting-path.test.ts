import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

test("meeting insightToDraft locks the source insight before checking for an existing draft", () => {
  const source = readFileSync(join(process.cwd(), "src", "repositories", "meetings.ts"), "utf8");
  const start = source.indexOf("async insightToDraft");
  const end = source.indexOf("const allocation = await allocateProjectCode", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const body = source.slice(start, end);

  assert.match(
    body,
    /from\(meetingInsights\)[\s\S]*\.where\(and\([\s\S]*eq\(meetingInsights\.id,\s*input\.insightId\)[\s\S]*eq\(meetingRecords\.projectId,\s*input\.projectId\)[\s\S]*\.for\("update"\)[\s\S]*const source = rows\[0\][\s\S]*if \(source\.insight\.createdWorkItemId\)[\s\S]*if \(source\.insight\.status !== "pending"\)/u
  );
});

test("meeting recordDraftProposal locks the source insight before the idempotency audit gate", () => {
  const source = readFileSync(join(process.cwd(), "src", "repositories", "meetings.ts"), "utf8");
  const start = source.indexOf("async recordDraftProposal");
  const end = source.indexOf("const existingAudit = await tx", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const body = source.slice(start, end);

  assert.match(
    body,
    /from\(meetingInsights\)[\s\S]*\.where\(eq\(meetingInsights\.createdWorkItemId,\s*input\.workItemId\)\)[\s\S]*\.for\("update"\)[\s\S]*const source = rows\[0\]/u
  );
});
