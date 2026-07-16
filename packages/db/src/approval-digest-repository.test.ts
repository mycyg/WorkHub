import assert from "node:assert/strict";
import test from "node:test";

import {
  listActivePendingDigestCards,
  listProjectsWithPendingApprovals,
  tombstonePendingDigestCard
} from "./repositories/approval-digest.js";
import { approvalRequests, conversationMessages } from "./schema/index.js";
import { createQueryRecorder, queryReferences, queryTextFragments } from "./test-query-recorder.js";

const projectId = "18000000-0000-4000-8000-000000000001";
const workspaceId = "18000000-0000-4000-8000-000000000002";
const conversationId = "18000000-0000-4000-8000-000000000003";
const messageId = "18000000-0000-4000-8000-000000000004";
const oldestPendingAt = new Date("2026-07-13T00:00:00.000Z");

test("listProjectsWithPendingApprovals groups pending approvals per project with the main conversation", async () => {
  const { db, queries } = createQueryRecorder([
    [
      { projectId, workspaceId, mainConversationId: conversationId, pendingCount: 4, oldestPendingAt },
      // 结构上不可达的空 workspace 行——应被丢弃而不是断言。
      { projectId: "x", workspaceId: null, mainConversationId: "y", pendingCount: 1, oldestPendingAt }
    ]
  ]);

  const result = await listProjectsWithPendingApprovals(db, { limit: 200 });
  assert.deepEqual(result, [
    { projectId, workspaceId, mainConversationId: conversationId, pendingCount: 4, oldestPendingAt }
  ]);
  const query = queries[0];
  assert.equal(query?.joins.length, 3, "approvals → work items → projects → main conversation");
  assert.ok(query?.joins.every((join) => join.kind === "inner"));
  assert.ok(queryReferences(query?.where, approvalRequests.status), "filters pending status");
  assert.ok((query?.groupBy.length ?? 0) >= 1);
});

test("listActivePendingDigestCards filters system_event pending_digest tombstone-free cards", async () => {
  const canned = { conversationId, workspaceId, projectId, messageId, seq: 10, storedCount: 3 };
  const { db, queries } = createQueryRecorder([[canned]]);
  const result = await listActivePendingDigestCards(db, { limit: 500 });
  assert.deepEqual(result, [canned]);
  const query = queries[0];
  assert.ok(queryReferences(query?.where, conversationMessages.kind));
  assert.ok(queryReferences(query?.where, conversationMessages.deletedAt), "must exclude tombstones");
  assert.ok(queryTextFragments(query?.where).join("").includes("pending_digest"), "must match the digest kind");
});

test("tombstonePendingDigestCard soft-deletes a system_event message and reports whether it hit", async () => {
  const hit = createQueryRecorder([[{ id: messageId }]]);
  assert.equal(
    await tombstonePendingDigestCard(hit.db, { conversationId, messageId, at: new Date() }),
    true
  );
  const query = hit.queries[0];
  assert.equal(query?.operation, "update");
  // .set({ deletedAt }) 记录的是普通对象（键即列属性名），不是 SQL 列引用树。
  assert.ok((query?.setValue as { deletedAt?: unknown })?.deletedAt instanceof Date, "sets deleted_at");
  assert.ok(queryReferences(query?.where, conversationMessages.id));
  assert.ok(queryReferences(query?.where, conversationMessages.conversationId));
  assert.ok(queryReferences(query?.where, conversationMessages.deletedAt), "guards against re-tombstoning");

  const miss = createQueryRecorder([[]]);
  assert.equal(
    await tombstonePendingDigestCard(miss.db, { conversationId, messageId, at: new Date() }),
    false
  );
});
