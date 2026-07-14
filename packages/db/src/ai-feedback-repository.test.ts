import assert from "node:assert/strict";
import test from "node:test";

import { actionCardItems, aiFeedback, conversationMessages, proposals } from "./schema/index.js";
import {
  createAiFeedbackRepository,
  createFeedbackSubjectExcerptReader,
  type AiFeedbackRow
} from "./repositories/ai-feedback.js";
import { createQueryRecorder, queryParamValues, queryReferences } from "./test-query-recorder.js";

const workspaceId = "8f000000-0000-4000-8000-000000000001";
const userId = "8f000000-0000-4000-8000-000000000002";
const otherUserId = "8f000000-0000-4000-8000-000000000003";
const messageId = "8f000000-0000-4000-8000-000000000004";
const now = new Date("2026-07-14T10:30:00.000Z");

function row(over: Partial<AiFeedbackRow> = {}): AiFeedbackRow {
  return {
    id: "8f000000-0000-4000-8000-0000000000aa",
    subjectType: "conversation_message",
    subjectId: messageId,
    userId,
    verdict: "useful",
    note: null,
    createdAt: now,
    updatedAt: now,
    ...over
  };
}

test("R14 FEEDBACK upsert writes via ON CONFLICT (subject_type, subject_id, user_id) DO UPDATE", async () => {
  const { db, queries } = createQueryRecorder([[row({ verdict: "not_useful", note: "跑偏了" })]]);
  const repo = createAiFeedbackRepository(db);
  const result = await repo.upsert({
    workspaceId,
    subjectType: "conversation_message",
    subjectId: messageId,
    userId,
    verdict: "not_useful",
    note: "跑偏了",
    at: now
  });
  const insert = queries.find((q) => q.operation === "insert");
  assert.ok(insert, "expected an insert");
  // 命中唯一约束就 DO UPDATE（幂等改判，不追加新行）。
  assert.ok(insert?.onConflict, "expected onConflictDoUpdate");
  assert.equal(insert?.returningCalled, true);
  // 落盘的 workspace_id 来自服务端派生的入参（绝不信任客户端）。
  const values = insert?.valuesValue as Record<string, unknown>;
  assert.equal(values["workspaceId"], workspaceId);
  assert.equal(values["verdict"], "not_useful");
  assert.equal(values["note"], "跑偏了");
  // 返回的对外行不含 workspace_id。
  assert.equal("workspaceId" in result, false);
  assert.equal(result.verdict, "not_useful");
});

test("R14 FEEDBACK empty note upserts as null (no empty string)", async () => {
  const { db, queries } = createQueryRecorder([[row()]]);
  const repo = createAiFeedbackRepository(db);
  await repo.upsert({
    workspaceId,
    subjectType: "proposal",
    subjectId: messageId,
    userId,
    verdict: "useful"
    // note omitted
  });
  const insert = queries.find((q) => q.operation === "insert");
  const values = insert?.valuesValue as Record<string, unknown>;
  assert.equal(values["note"], null);
});

test("R14 FEEDBACK remove is a physical delete, true when a row was removed", async () => {
  const removed = createQueryRecorder([[{ id: "8f000000-0000-4000-8000-0000000000aa" }]]);
  const repo = createAiFeedbackRepository(removed.db);
  assert.equal(
    await repo.remove({ subjectType: "conversation_message", subjectId: messageId, userId }),
    true
  );
  const del = removed.queries.find((q) => q.operation === "delete");
  assert.ok(del, "expected a delete");
  assert.ok(queryReferences(del?.where, aiFeedback.userId), "delete must be scoped by user_id");
  // 幂等空操作：本没有 → false。
  const empty = createQueryRecorder([[]]);
  const emptyRepo = createAiFeedbackRepository(empty.db);
  assert.equal(
    await emptyRepo.remove({ subjectType: "conversation_message", subjectId: messageId, userId }),
    false
  );
});

test("R14 FEEDBACK self-visibility: reads are always filtered by the current actor's user_id", async () => {
  // getForSubject
  const single = createQueryRecorder([[row()]]);
  const singleRepo = createAiFeedbackRepository(single.db);
  await singleRepo.getForSubject({ subjectType: "conversation_message", subjectId: messageId, userId });
  const getQuery = single.queries.find((q) => q.operation === "select");
  assert.ok(queryReferences(getQuery?.where, aiFeedback.userId), "getForSubject must filter by user_id");
  assert.ok(queryParamValues(getQuery?.where).includes(userId));
  // 他人的 user_id 不会被这条查询命中（参数里没有 otherUserId）。
  assert.equal(queryParamValues(getQuery?.where).includes(otherUserId), false);

  // listForSubjects
  const batch = createQueryRecorder([[row(), row({ subjectId: "8f000000-0000-4000-8000-0000000000bb" })]]);
  const batchRepo = createAiFeedbackRepository(batch.db);
  const map = await batchRepo.listForSubjects({
    subjectType: "conversation_message",
    subjectIds: [messageId, "8f000000-0000-4000-8000-0000000000bb", messageId],
    userId
  });
  const listQuery = batch.queries.find((q) => q.operation === "select");
  assert.ok(queryReferences(listQuery?.where, aiFeedback.userId), "listForSubjects must filter by user_id");
  assert.ok(queryReferences(listQuery?.where, aiFeedback.subjectId), "listForSubjects must filter by subject_id set");
  assert.equal(map.size, 2);
  assert.equal(map.get(messageId)?.verdict, "useful");
});

test("R14 FEEDBACK listForSubjects short-circuits an empty id set (no query,禁 N+1 friendly)", async () => {
  const { db, queries } = createQueryRecorder([]);
  const repo = createAiFeedbackRepository(db);
  const map = await repo.listForSubjects({ subjectType: "proposal", subjectIds: [], userId });
  assert.equal(map.size, 0);
  assert.equal(queries.length, 0);
});

test("R14 FEEDBACK curation queries: negatives are workspace-scoped not_useful, positives are counts", async () => {
  const negatives = createQueryRecorder([[row({ verdict: "not_useful" })]]);
  const negRepo = createAiFeedbackRepository(negatives.db);
  await negRepo.negativeSamplesSince(workspaceId, now, 20);
  const negQuery = negatives.queries.find((q) => q.operation === "select");
  assert.ok(queryReferences(negQuery?.where, aiFeedback.workspaceId), "negatives filter by workspace_id (zero join)");
  assert.ok(queryReferences(negQuery?.where, aiFeedback.updatedAt), "negatives use the updated_at freshness window");
  assert.ok(queryParamValues(negQuery?.where).includes("not_useful"));
  assert.equal(negQuery?.orderBy.length, 2, "negatives order by updated_at desc, id desc");
  assert.equal(negQuery?.limit, 20);

  const positives = createQueryRecorder([[{ subjectType: "conversation_message", count: 6 }]]);
  const posRepo = createAiFeedbackRepository(positives.db);
  const counts = await posRepo.positiveCountsSince(workspaceId, now);
  const posQuery = positives.queries.find((q) => q.operation === "select");
  assert.ok(queryParamValues(posQuery?.where).includes("useful"));
  assert.equal(posQuery?.groupBy.length, 1, "positives group by subject_type");
  assert.deepEqual(counts, [{ subjectType: "conversation_message", count: 6 }]);
});

test("R14 FEEDBACK negativeSamplesSince clamps a runaway limit", async () => {
  const { db, queries } = createQueryRecorder([[]]);
  const repo = createAiFeedbackRepository(db);
  await repo.negativeSamplesSince(workspaceId, now, 10_000);
  const query = queries.find((q) => q.operation === "select");
  assert.equal(query?.limit, 100, "limit is clamped to the hard cap");
});

// ── R14 批 FEEDBACK · W-B：差评摘要批量取正文 reader（curation 消费用）─────────────────────────

test("R14 FEEDBACK excerpt reader: conversation message texts extract content_json.text, tombstones → null", async () => {
  const { db, queries } = createQueryRecorder([
    [
      { id: "m1", contentJson: { text: "季度汇总答非所问" }, deletedAt: null },
      { id: "m2", contentJson: {}, deletedAt: now }
    ]
  ]);
  const reader = createFeedbackSubjectExcerptReader(db);
  // 传入含重复 id——去重后一条 IN 查询（禁 N+1）。
  const map = await reader.conversationMessageTexts(["m1", "m2", "m1"]);
  const query = queries.find((q) => q.operation === "select");
  assert.ok(queryReferences(query?.where, conversationMessages.id), "batched IN on message id");
  assert.equal(map.get("m1"), "季度汇总答非所问");
  // 墓碑（deleted_at 置位，content_json 已清 {}）→ null。
  assert.equal(map.get("m2"), null);
});

test("R14 FEEDBACK excerpt reader: proposal titles and action card item titles map by id", async () => {
  const { db, queries } = createQueryRecorder([
    [{ id: "p1", title: "季度报告初稿" }],
    [{ id: "a1", titleMd: "导出 CSV" }]
  ]);
  const reader = createFeedbackSubjectExcerptReader(db);
  const titles = await reader.proposalTitles(["p1"]);
  assert.equal(titles.get("p1"), "季度报告初稿");
  const items = await reader.actionCardItemTitles(["a1"]);
  assert.equal(items.get("a1"), "导出 CSV");
  const propQuery = queries.find((q) => queryReferences(q.where, proposals.id));
  assert.ok(propQuery, "proposal titles batched IN on proposals.id");
  const itemQuery = queries.find((q) => queryReferences(q.where, actionCardItems.id));
  assert.ok(itemQuery, "action card item titles batched IN on action_card_items.id");
});

test("R14 FEEDBACK excerpt reader: empty id sets short-circuit (no query, 禁 N+1 friendly)", async () => {
  const { db, queries } = createQueryRecorder([]);
  const reader = createFeedbackSubjectExcerptReader(db);
  assert.equal((await reader.conversationMessageTexts([])).size, 0);
  assert.equal((await reader.proposalTitles([])).size, 0);
  assert.equal((await reader.actionCardItemTitles([])).size, 0);
  assert.equal(queries.length, 0);
});
