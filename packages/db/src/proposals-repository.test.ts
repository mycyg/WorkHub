import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

test("proposal review queue skips deleted work items and inactive projects", () => {
  const source = readFileSync(join(process.cwd(), "src", "repositories", "proposals.ts"), "utf8");
  const start = source.indexOf("async listReviewable");
  const end = source.indexOf("async listConflictsByWorkItem", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const body = source.slice(start, end);

  assert.match(body, /innerJoin\(projects,\s*eq\(projects\.id,\s*workItems\.projectId\)\)/u);
  assert.match(body, /isNull\(workItems\.deletedAt\)/u);
  assert.match(body, /eq\(projects\.archived,\s*false\)/u);
  assert.match(body, /isNull\(projects\.deletedAt\)/u);
});

test("proposal review queue stays scoped to the actor workspace", () => {
  const source = readFileSync(join(process.cwd(), "src", "repositories", "proposals.ts"), "utf8");
  const start = source.indexOf("async listReviewable");
  const end = source.indexOf("async listConflictsByWorkItem", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const body = source.slice(start, end);

  assert.match(body, /input\.workspaceId/u);
  assert.match(body, /eq\(workItems\.workspaceId,\s*input\.workspaceId\)/u);
  assert.match(body, /eq\(projects\.workspaceId,\s*input\.workspaceId\)/u);
});
