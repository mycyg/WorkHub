import assert from "node:assert/strict";
import test from "node:test";

import { createEventOutboxRepository, MAX_PUBLISH_ATTEMPTS } from "./repositories/event-outbox.js";
import { eventOutbox } from "./schema/index.js";
import {
  createQueryRecorder,
  queryParamValues,
  queryReferences,
  queryTextFragments
} from "./test-query-recorder.js";

// R21 加固（event_outbox 仓储）：A2 重试封顶判死信 / A3 已发布行清理 / A4 markPublished 回报真实更新。
// 用 query recorder 断言仓储真的把这些语义编译进 SQL——纯内存、无真 PG。

const at = new Date("2026-07-18T09:00:00.000Z");

test("markPublished keeps the status='pending' CAS and reports whether a row was actually updated", async () => {
  const { db, queries } = createQueryRecorder([[{ id: "outbox-1" }]]);
  const repository = createEventOutboxRepository(db);
  const marked = await repository.markPublished({ id: "outbox-1", at });
  assert.equal(marked, true);
  const update = queries.find((q) => q.operation === "update");
  assert.equal(update?.returningCalled, true, "the outcome must come from RETURNING, not be assumed");
  assert.ok(queryReferences(update?.where, eventOutbox.status), "CAS must keep the pending precondition");
  assert.ok(queryParamValues(update?.where).includes("pending"));
});

test("markPublished returns false when the CAS matches no row (a concurrent drain already marked it)", async () => {
  const { db } = createQueryRecorder([[]]);
  const repository = createEventOutboxRepository(db);
  const marked = await repository.markPublished({ id: "outbox-1", at });
  assert.equal(marked, false, "A4: the loser must not report a publish it did not record");
});

test("markFailed bumps attempts in SQL and flips to 'failed' once attempts+1 reaches MAX_PUBLISH_ATTEMPTS", async () => {
  const { db, queries } = createQueryRecorder([[]]);
  const repository = createEventOutboxRepository(db);
  await repository.markFailed({ id: "outbox-1", error: "broker down" });
  const update = queries.find((q) => q.operation === "update");
  assert.ok(update, "must issue a single UPDATE");
  const setValue = update?.setValue as Record<string, unknown>;
  // attempts+1 在 SQL 里算（引用 attempts 列），不依赖读到的旧值。
  assert.ok(queryReferences(setValue["attempts"], eventOutbox.attempts));
  assert.equal(setValue["lastError"], "broker down");
  // 封顶判死信：status 用 CASE 表达式在同一条 UPDATE 里判——达上限置 'failed'，否则保持原状态。
  const statusFragments = queryTextFragments(setValue["status"]).join(" ");
  assert.match(statusFragments, /case when/iu);
  assert.match(statusFragments, /'failed'/u);
  // sql 模板里的数字以原生 number 形式进 queryChunks（非 Param）——用 queryReferences 的 Object.is 匹配。
  assert.ok(
    queryReferences(setValue["status"], MAX_PUBLISH_ATTEMPTS),
    "the cap must be the exported MAX_PUBLISH_ATTEMPTS constant"
  );
  assert.ok(queryParamValues(update?.where).includes("pending"), "only pending rows are failable");
});

test("MAX_PUBLISH_ATTEMPTS is a bounded positive constant", () => {
  assert.equal(typeof MAX_PUBLISH_ATTEMPTS, "number");
  assert.ok(MAX_PUBLISH_ATTEMPTS >= 3 && MAX_PUBLISH_ATTEMPTS <= 100, "retry cap must stay sane");
});

test("purgePublishedBefore deletes published rows behind the cutoff via an id IN (subquery LIMIT n) and returns the count", async () => {
  const cutoff = new Date(at.getTime() - 7 * 24 * 60 * 60 * 1000);
  // responses[0] = 子查询构造（不真执行）；responses[1] = DELETE ... RETURNING 命中的两行。
  const { db, queries } = createQueryRecorder([[], [{ id: "outbox-1" }, { id: "outbox-2" }]]);
  const repository = createEventOutboxRepository(db);
  const purged = await repository.purgePublishedBefore({ cutoff, limit: 500 });
  assert.equal(purged, 2);
  const subquery = queries.find((q) => q.operation === "select");
  assert.ok(subquery, "must select candidate ids first (DELETE has no LIMIT in PG)");
  assert.equal(subquery?.limit, 500, "the per-round delete volume must be bounded");
  assert.ok(queryParamValues(subquery?.where).includes("published"), "only published rows are purgable");
  assert.ok(queryReferences(subquery?.where, eventOutbox.createdAt), "must bound by created_at < cutoff");
  const remove = queries.find((q) => q.operation === "delete");
  assert.ok(remove, "must issue a DELETE");
  assert.equal(remove?.targetTable, eventOutbox);
  assert.ok(queryReferences(remove?.where, eventOutbox.id), "DELETE must be scoped by the candidate ids");
});
