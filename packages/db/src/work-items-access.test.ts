import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

test("findWorkItemAccessRecord carries project org id for scoped permission checks", () => {
  const source = readFileSync(join(process.cwd(), "src", "repositories", "work-items.ts"), "utf8");
  const start = source.indexOf("async findWorkItemAccessRecord");
  const end = source.indexOf("async findProjectById", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const body = source.slice(start, end);

  assert.match(body, /leftJoin\(workspaces,\s*eq\(projects\.workspaceId,\s*workspaces\.id\)\)/u);
  assert.match(body, /projectOrgId:\s*workspaces\.orgId/u);
  assert.match(body, /orgId:\s*row\.projectOrgId/u);
});
