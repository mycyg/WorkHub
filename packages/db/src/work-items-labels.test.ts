import assert from "node:assert/strict";
import test from "node:test";

import { createWorkItemRepository } from "./repositories/work-items.js";
import { workItems } from "./schema/index.js";
import { createQueryRecorder, queryParamValues, queryReferences } from "./test-query-recorder.js";

// 成本页「按任务分账」的标签取数：一次查询、工作区围栏、只取 id/code/title；空清单不发查询。

const workspaceId = "11111111-1111-4111-8111-111111111111";

test("listWorkItemLabelsByIds fences on workspace_id and batches the ids into one select", async () => {
  const ids = ["22222222-2222-4222-8222-222222222222", "33333333-3333-4333-8333-333333333333"];
  const { db, queries } = createQueryRecorder([[
    { id: ids[0], code: "PROJ-001", title: "区域发布复盘包" },
    { id: ids[1], code: "PROJ-002", title: null }
  ]]);
  const rows = await createWorkItemRepository(db).listWorkItemLabelsByIds({ workspaceId, workItemIds: ids });
  assert.deepEqual(rows.map((row) => row.code), ["PROJ-001", "PROJ-002"]);
  const selects = queries.filter((query) => query.operation === "select");
  assert.equal(selects.length, 1, "one batched select, not one per id");
  assert.equal(selects[0]?.fromTable, workItems);
  assert.ok(queryReferences(selects[0]?.where, workItems.workspaceId), "must be workspace-fenced");
  const params = queryParamValues(selects[0]?.where);
  assert.ok(params.includes(workspaceId));
  for (const id of ids) {
    assert.ok(params.includes(id), `id ${id} must be in the IN list`);
  }
});

test("listWorkItemLabelsByIds with no ids returns [] without touching the database", async () => {
  const { db, queries } = createQueryRecorder([]);
  const rows = await createWorkItemRepository(db).listWorkItemLabelsByIds({ workspaceId, workItemIds: [] });
  assert.deepEqual(rows, []);
  assert.equal(queries.length, 0);
});
