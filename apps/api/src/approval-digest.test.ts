import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPendingDigestContent,
  createApprovalDigestService,
  type ApprovalDigestServiceDeps
} from "./services/approval-digest.js";
import type { PendingApprovalDigestRow, PendingDigestCardRow } from "@workhub/db";

const now = new Date("2026-07-15T00:00:00.000Z");
const workspaceId = "a3000000-0000-4000-8000-000000000001";
const projectId = "a3000000-0000-4000-8000-000000000002";
const mainConversationId = "a3000000-0000-4000-8000-000000000003";
const messageId = "a3000000-0000-4000-8000-000000000004";

function candidate(overrides: Partial<PendingApprovalDigestRow> = {}): PendingApprovalDigestRow {
  return {
    projectId,
    workspaceId,
    mainConversationId,
    pendingCount: 3,
    oldestPendingAt: new Date("2026-07-13T00:00:00.000Z"), // 2 天前
    ...overrides
  };
}

function card(overrides: Partial<PendingDigestCardRow> = {}): PendingDigestCardRow {
  return {
    conversationId: mainConversationId,
    workspaceId,
    projectId,
    messageId,
    seq: 10,
    storedCount: 3,
    ...overrides
  };
}

function harness(setup: {
  candidates?: PendingApprovalDigestRow[];
  cards?: PendingDigestCardRow[];
}) {
  const posts: Array<{ conversationId: string; content: Record<string, unknown> }> = [];
  const tombstones: Array<{ conversationId: string; messageId: string }> = [];
  const deps: ApprovalDigestServiceDeps = {
    repository: {
      async listProjectsWithPendingApprovals() {
        return setup.candidates ?? [];
      },
      async listActivePendingDigestCards() {
        return setup.cards ?? [];
      },
      async tombstonePendingDigestCard(input) {
        tombstones.push({ conversationId: input.conversationId, messageId: input.messageId });
        return true;
      }
    },
    async postSystemMessage(input) {
      posts.push({ conversationId: input.conversationId, content: input.content });
      return {};
    },
    now: () => now,
    logger: { warn() {} }
  };
  return { service: createApprovalDigestService(deps), posts, tombstones };
}

test("A3 unchanged pending count is a no-op — never re-posts and never tombstones", async () => {
  const { service, posts, tombstones } = harness({
    candidates: [candidate({ pendingCount: 3 })],
    cards: [card({ storedCount: 3 })]
  });
  const result = await service.runOnce();
  assert.equal(result.unchanged, 1);
  assert.equal(result.posted + result.updated + result.zeroed, 0);
  assert.equal(posts.length, 0, "no re-post on unchanged count");
  assert.equal(tombstones.length, 0, "no tombstone on unchanged count");
});

test("A3 first creation posts a fresh digest card with no previous link", async () => {
  const { service, posts, tombstones } = harness({
    candidates: [candidate({ pendingCount: 2 })],
    cards: []
  });
  const result = await service.runOnce();
  assert.equal(result.posted, 1);
  assert.equal(tombstones.length, 0, "nothing to tombstone on first creation");
  assert.equal(posts.length, 1);
  assert.equal(posts[0]?.content.kind, "pending_digest");
  assert.equal(posts[0]?.content.pending_count, 2);
  assert.equal(posts[0]?.content.oldest_days, 2);
  assert.equal(posts[0]?.content.previous_digest_message_id, undefined);
});

test("A3 changed count tombstones the old card and posts a new one linking the previous id", async () => {
  const { service, posts, tombstones } = harness({
    candidates: [candidate({ pendingCount: 5 })],
    cards: [card({ storedCount: 3, messageId })]
  });
  const result = await service.runOnce();
  assert.equal(result.updated, 1);
  assert.deepEqual(tombstones, [{ conversationId: mainConversationId, messageId }]);
  assert.equal(posts.length, 1);
  assert.equal(posts[0]?.content.pending_count, 5);
  assert.equal(posts[0]?.content.previous_digest_message_id, messageId, "new card must link the tombstoned one");
});

test("A3 pending dropping to zero tombstones the existing card and posts nothing", async () => {
  const { service, posts, tombstones } = harness({
    candidates: [], // 没有任何待办审批候选 → 现存卡所在会话归零
    cards: [card({ storedCount: 3, messageId })]
  });
  const result = await service.runOnce();
  assert.equal(result.zeroed, 1);
  assert.deepEqual(tombstones, [{ conversationId: mainConversationId, messageId }]);
  assert.equal(posts.length, 0, "zero-out must not post a new card");
});

test("A3 tombstones stale duplicate cards in the same conversation", async () => {
  const stale = card({ messageId: "a3000000-0000-4000-8000-0000000000ff", seq: 8, storedCount: 3 });
  const { service, tombstones } = harness({
    candidates: [candidate({ pendingCount: 3 })], // 当前卡数字没变 → 当前卡不动
    cards: [card({ seq: 10, storedCount: 3 }), stale] // seq 10 是当前卡，seq 8 是重复
  });
  const result = await service.runOnce();
  assert.equal(result.duplicates_tombstoned, 1);
  assert.equal(result.unchanged, 1);
  assert.deepEqual(tombstones, [{ conversationId: mainConversationId, messageId: stale.messageId }]);
});

test("A3 digest content omits the oldest clause when nothing is older than a day", async () => {
  assert.equal(
    buildPendingDigestContent({ projectId, pendingCount: 1, oldestDays: 0 }).summary,
    "待你拍板 1 件"
  );
  assert.equal(
    buildPendingDigestContent({ projectId, pendingCount: 4, oldestDays: 3 }).summary,
    "待你拍板 4 件，最久 3 天"
  );
});
