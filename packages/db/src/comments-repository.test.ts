import assert from "node:assert/strict";
import test from "node:test";

import { COMMENTS_FOR_WORK_ITEM_LIMIT, createCommentRepository } from "./repositories/comments.js";
import { comments } from "./schema/index.js";
import { createQueryRecorder, queryReferences, queryTextFragments } from "./test-query-recorder.js";

// R21 加固（A5 评论 200 条封顶丢最新）：旧写法 asc(createdAt)+limit 取的是「最老的 200 条」——第 201 条起
// 的新评论永远不可见。修后取「最新的 limit 条」（desc + limit）再反转回升序返回，返回形状与契约不变。
// 用 query recorder 断言 SQL 语义（真库排序/截断在 PG 里发生，内存 fake 测不到），行序断言测反转本身。

test("listCommentsForWorkItem keeps a bounded default limit", () => {
  assert.equal(typeof COMMENTS_FOR_WORK_ITEM_LIMIT, "number");
  assert.ok(
    COMMENTS_FOR_WORK_ITEM_LIMIT > 0 && COMMENTS_FOR_WORK_ITEM_LIMIT <= 1000,
    "work item comment listing must stay bounded"
  );
});

test("listCommentsForWorkItem takes the NEWEST rows (desc + limit) and returns them re-reversed ascending", async () => {
  // DB 按 desc(createdAt), desc(id) 返回「最新在前」——仓储必须反转成升序（对话顺序）再交给调用方。
  const newest = { id: "c-3", workItemId: "wi-1", body: "最新", createdAt: new Date("2026-07-18T10:02:00.000Z") };
  const middle = { id: "c-2", workItemId: "wi-1", body: "居中", createdAt: new Date("2026-07-18T10:01:00.000Z") };
  const { db, queries } = createQueryRecorder([[newest, middle]]);
  const repository = createCommentRepository(db);

  const rows = await repository.listCommentsForWorkItem("wi-1", { limit: 2 });

  // 返回升序（旧→新），且最新一条一定在窗口内——这正是 >limit 时旧写法丢掉的那条。
  assert.deepEqual(rows.map((row) => (row as { id: string }).id), ["c-2", "c-3"]);
  const [query] = queries;
  assert.equal(query?.fromTable, comments);
  assert.equal(query?.limit, 2);
  assert.ok(queryReferences(query?.where, comments.workItemId));
  // 排序键：desc(createdAt) + desc(id) 稳定 tie-breaker（同秒落库行序确定）。
  assert.equal(query?.orderBy.length, 2, "must order by createdAt with an id tie-breaker");
  assert.ok(queryReferences(query?.orderBy, comments.createdAt));
  assert.ok(queryReferences(query?.orderBy, comments.id));
  const orderText = queryTextFragments(query?.orderBy).join(" ");
  assert.match(orderText, /desc/iu, "must take the newest rows, not the oldest");
  assert.doesNotMatch(orderText, /asc/iu);
});

test("listCommentsForWorkItem applies the default limit when none is given", async () => {
  const { db, queries } = createQueryRecorder([[]]);
  const repository = createCommentRepository(db);
  const rows = await repository.listCommentsForWorkItem("wi-1");
  assert.deepEqual(rows, []);
  assert.equal(queries[0]?.limit, COMMENTS_FOR_WORK_ITEM_LIMIT);
});
