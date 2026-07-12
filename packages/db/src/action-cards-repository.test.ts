import assert from "node:assert/strict";
import test from "node:test";

import {
  ActionCardConversationNotFoundError,
  ActionCardInsertFailedError,
  ActionCardMessageInsertFailedError,
  ActionCardRepositoryInputError,
  ActionCardSequenceAllocationError,
  createActionCardRepository,
  type ActionCardItemRow,
  type ActionCardRow,
  type ObserverStateRow
} from "./repositories/action-cards.js";
import {
  actionCardItems,
  actionCards,
  conversationMessages,
  conversationObserverState,
  projectAiGovernance,
  projectConversations,
  projects,
  users,
  workspaceMemberships
} from "./schema/index.js";
import {
  createQueryRecorder,
  queryParamValues,
  queryReferences,
  type RecordedQuery
} from "./test-query-recorder.js";

const now = new Date("2026-07-12T09:00:00.000Z");
const workspaceId = "13000000-0000-4000-8000-000000000001";
const projectId = "13000000-0000-4000-8000-000000000003";
const conversationId = "13000000-0000-4000-8000-000000000004";
const cardId = "13000000-0000-4000-8000-000000000005";
const messageId = "13000000-0000-4000-8000-000000000006";
const itemId = "13000000-0000-4000-8000-000000000007";
const userId = "13000000-0000-4000-8000-000000000008";

function cardRow(overrides: Partial<ActionCardRow> = {}): ActionCardRow {
  return {
    id: cardId,
    conversationId,
    messageId,
    status: "active",
    analyzedToSeq: 3,
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

function itemRow(overrides: Partial<ActionCardItemRow> = {}): ActionCardItemRow {
  return {
    id: itemId,
    workspaceId,
    projectId,
    conversationId,
    actionCardId: cardId,
    ordinal: 0,
    kind: "execute",
    titleMd: "重写第三节",
    confidence: "high",
    workItemId: null,
    runId: null,
    assigneeUserId: userId,
    status: "running",
    undoDeadlineAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

function observerStateRow(overrides: Partial<ObserverStateRow> = {}): ObserverStateRow {
  return {
    conversationId,
    lastAnalyzedSeq: 3,
    activeCardId: cardId,
    consecutiveFailures: 0,
    updatedAt: now,
    ...overrides
  };
}

function allPredicates(query: RecordedQuery | undefined) {
  assert.ok(query, "expected recorded query");
  return [query.where, ...query.joins.map((join) => join.on)];
}

function referencesAny(query: RecordedQuery | undefined, target: unknown) {
  return allPredicates(query).some((predicate) => queryReferences(predicate, target));
}

function allParams(query: RecordedQuery | undefined) {
  return allPredicates(query).flatMap((predicate) => queryParamValues(predicate));
}

// ── listObserverCandidates ──────────────────────────────────────────────────────────

test("listObserverCandidates is tenant/active-project scoped, joins governance and observer state, and caps its scan", async () => {
  const { db, queries } = createQueryRecorder([
    [
      {
        conversationId,
        projectId,
        workspaceId,
        nextSeq: 5,
        lastAnalyzedSeq: 3,
        activeCardId: null,
        consecutiveFailures: 0,
        silenceWindowSecs: 60,
        quietHoursJson: { enabled: false },
        lastMessageAt: new Date("2026-07-12T08:58:00.000Z")
      }
    ]
  ]);

  const rows = await createActionCardRepository(db).listObserverCandidates({ now, limit: 50 });

  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.conversationId, conversationId);
  const query = queries[0];
  assert.equal(query?.fromTable, projectConversations);
  assert.equal(query?.limit, 50);
  for (const column of [
    projects.id,
    projects.workspaceId,
    projects.archived,
    projects.deletedAt,
    projectAiGovernance.projectId,
    conversationObserverState.conversationId
  ]) {
    assert.equal(referencesAny(query, column), true, `missing predicate for ${String(column)}`);
  }
  assert.equal(query?.joins.length, 3);
});

test("listObserverCandidates rejects an out-of-range limit before querying", async () => {
  const { db, queries } = createQueryRecorder();
  await assert.rejects(
    createActionCardRepository(db).listObserverCandidates({ now, limit: 0 }),
    (error: unknown) => error instanceof ActionCardRepositoryInputError
  );
  await assert.rejects(
    createActionCardRepository(db).listObserverCandidates({ now, limit: 101 }),
    (error: unknown) => error instanceof ActionCardRepositoryInputError
  );
  assert.equal(queries.length, 0);
});

test("listObserverCandidates filters out rows without a resolvable last-message timestamp", async () => {
  const { db } = createQueryRecorder([
    [
      {
        conversationId,
        projectId,
        workspaceId,
        nextSeq: 1,
        lastAnalyzedSeq: 0,
        activeCardId: null,
        consecutiveFailures: 0,
        silenceWindowSecs: 60,
        quietHoursJson: { enabled: false },
        lastMessageAt: null
      }
    ]
  ]);
  const rows = await createActionCardRepository(db).listObserverCandidates({ now, limit: 10 });
  assert.deepEqual(rows, []);
});

// ── listMessagesForAnalysis ─────────────────────────────────────────────────────────

test("listMessagesForAnalysis scopes to workspace/project/conversation and orders by seq ascending", async () => {
  const message = { id: messageId, conversationId, seq: 4, senderType: "user", senderUserId: userId, kind: "text", contentJson: { text: "hi" }, threadRootId: null, createdAt: now };
  const { db, queries } = createQueryRecorder([[{ message }]]);

  const rows = await createActionCardRepository(db).listMessagesForAnalysis({
    workspaceId,
    projectId,
    conversationId,
    afterSeq: 3,
    limit: 50
  });

  assert.deepEqual(rows, [message]);
  const query = queries[0];
  assert.equal(query?.fromTable, conversationMessages);
  assert.equal(query?.limit, 50);
  assert.equal(referencesAny(query, projectConversations.workspaceId), true);
  assert.equal(referencesAny(query, projectConversations.projectId), true);
  assert.ok(allParams(query).includes(workspaceId));
  assert.ok(allParams(query).includes(projectId));
});

test("listMessagesForAnalysis rejects an unsafe afterSeq before querying", async () => {
  const { db, queries } = createQueryRecorder();
  await assert.rejects(
    createActionCardRepository(db).listMessagesForAnalysis({
      workspaceId,
      projectId,
      conversationId,
      afterSeq: -1,
      limit: 10
    }),
    (error: unknown) => error instanceof ActionCardRepositoryInputError
  );
  assert.equal(queries.length, 0);
});

// ── createOrAppendCard: create path ─────────────────────────────────────────────────

test("createOrAppendCard opens a new card when no active card exists, atomically allocating the message seq", async () => {
  const insertedMessage = { id: "new-message", conversationId, seq: 6, senderType: "cuu", senderUserId: null, kind: "action_card", contentJson: {}, threadRootId: null, createdAt: now };
  const insertedCard = cardRow({ id: "new-card", messageId: "new-message" });
  const insertedItems = [itemRow({ id: "new-item", actionCardId: "new-card", ordinal: 0 })];
  const { db, queries, transactions } = createQueryRecorder([
    [{ id: conversationId, nextSeq: 5 }], // lock conversation
    [], // observer state: none yet
    [{ nextSeq: 6 }], // allocate seq
    [insertedMessage], // insert message
    [insertedCard], // insert card
    insertedItems, // insert items
    [observerStateRow({ activeCardId: "new-card" })] // upsert observer state
  ]);

  const result = await createActionCardRepository(db).createOrAppendCard({
    workspaceId,
    projectId,
    conversationId,
    analyzedToSeq: 6,
    items: [
      { kind: "execute", titleMd: "重写第三节", confidence: "high", status: "running", assigneeUserId: userId }
    ],
    at: now,
    cardId: "new-card",
    cardMessageId: "new-message"
  });

  assert.equal(result.appended, false);
  assert.equal(result.card.id, "new-card");
  assert.deepEqual(result.items, insertedItems);
  assert.deepEqual(transactions, [{ outcome: "resolved" }]);

  const messageInsert = queries[3];
  assert.equal(messageInsert?.targetTable, conversationMessages);
  assert.equal((messageInsert?.valuesValue as Record<string, unknown>)["seq"], 6);
  assert.equal((messageInsert?.valuesValue as Record<string, unknown>)["kind"], "action_card");
  assert.equal((messageInsert?.valuesValue as Record<string, unknown>)["senderType"], "cuu");

  const itemInsert = queries[5];
  assert.equal(itemInsert?.targetTable, actionCardItems);
  const itemValues = (itemInsert?.valuesValue as Array<Record<string, unknown>>)[0];
  assert.equal(itemValues?.["workspaceId"], workspaceId);
  assert.equal(itemValues?.["projectId"], projectId);
  assert.equal(itemValues?.["ordinal"], 0);

  const stateUpsert = queries[6];
  assert.equal(stateUpsert?.targetTable, conversationObserverState);
  assert.ok(stateUpsert?.onConflict);
});

test("createOrAppendCard falls back to a new card when the observer state's active card was superseded", async () => {
  const insertedMessage = { id: "new-message", conversationId, seq: 6, senderType: "cuu", senderUserId: null, kind: "action_card", contentJson: {}, threadRootId: null, createdAt: now };
  const { db, queries } = createQueryRecorder([
    [{ id: conversationId, nextSeq: 5 }],
    [observerStateRow({ activeCardId: cardId })], // state points at a card…
    [], // …but the card lookup (status='active') finds nothing (superseded)
    [{ nextSeq: 6 }],
    [insertedMessage],
    [cardRow({ id: "new-card", messageId: "new-message" })],
    [itemRow({ id: "new-item", actionCardId: "new-card" })],
    [observerStateRow({ activeCardId: "new-card" })]
  ]);

  const result = await createActionCardRepository(db).createOrAppendCard({
    workspaceId,
    projectId,
    conversationId,
    analyzedToSeq: 6,
    items: [{ kind: "observe", titleMd: "记一笔", confidence: "low", status: "done" }],
    at: now,
    cardMessageId: "new-message"
  });

  assert.equal(result.appended, false);
  assert.equal(queries.length, 8);
});

test("createOrAppendCard rejects an empty item batch and a bad watermark before opening a transaction", async () => {
  const { db, queries } = createQueryRecorder();
  const repository = createActionCardRepository(db);
  await assert.rejects(
    repository.createOrAppendCard({ workspaceId, projectId, conversationId, analyzedToSeq: 1, items: [] }),
    (error: unknown) => error instanceof ActionCardRepositoryInputError
  );
  await assert.rejects(
    repository.createOrAppendCard({
      workspaceId,
      projectId,
      conversationId,
      analyzedToSeq: -1,
      items: [{ kind: "observe", titleMd: "x", confidence: "low", status: "done" }]
    }),
    (error: unknown) => error instanceof ActionCardRepositoryInputError
  );
  assert.equal(queries.length, 0);
});

test("createOrAppendCard fails closed when the conversation is not an active main conversation", async () => {
  const { db, transactions } = createQueryRecorder([[]]);
  await assert.rejects(
    createActionCardRepository(db).createOrAppendCard({
      workspaceId,
      projectId,
      conversationId,
      analyzedToSeq: 1,
      items: [{ kind: "observe", titleMd: "x", confidence: "low", status: "done" }],
      at: now
    }),
    (error: unknown) => error instanceof ActionCardConversationNotFoundError
  );
  assert.deepEqual(transactions, [{ outcome: "rejected", errorName: "ActionCardConversationNotFoundError" }]);
});

test("createOrAppendCard raises a sequence-allocation error when the CAS update misses", async () => {
  const { db, transactions } = createQueryRecorder([
    [{ id: conversationId, nextSeq: 5 }],
    [],
    [] // CAS update returns no row (concurrent writer already advanced next_seq)
  ]);
  await assert.rejects(
    createActionCardRepository(db).createOrAppendCard({
      workspaceId,
      projectId,
      conversationId,
      analyzedToSeq: 1,
      items: [{ kind: "observe", titleMd: "x", confidence: "low", status: "done" }],
      at: now
    }),
    (error: unknown) => error instanceof ActionCardSequenceAllocationError
  );
  assert.deepEqual(transactions, [{ outcome: "rejected", errorName: "ActionCardSequenceAllocationError" }]);
});

// ── createOrAppendCard: append path ─────────────────────────────────────────────────

test("createOrAppendCard appends to the active card in place, extends ordinals, and rewrites the card message", async () => {
  const existingItem = itemRow({ ordinal: 0 });
  const newItem = itemRow({ id: "new-item", ordinal: 1, kind: "decide", titleMd: "预算是否砍半", confidence: "low" });
  const updatedMessage = { id: messageId, conversationId, seq: 3, senderType: "cuu", senderUserId: null, kind: "action_card", contentJson: {}, threadRootId: null, createdAt: now };
  const { db, queries, transactions } = createQueryRecorder([
    [{ id: conversationId, nextSeq: 6 }],
    [observerStateRow()],
    [cardRow()], // active card lookup succeeds
    [{ maxOrdinal: 0 }],
    [newItem],
    [existingItem, newItem], // full item read for the rewritten message
    [updatedMessage],
    [cardRow({ analyzedToSeq: 6 })],
    [observerStateRow({ lastAnalyzedSeq: 6 })]
  ]);

  const result = await createActionCardRepository(db).createOrAppendCard({
    workspaceId,
    projectId,
    conversationId,
    analyzedToSeq: 6,
    items: [{ kind: "decide", titleMd: "预算是否砍半", confidence: "low", status: "waiting_decision" }],
    at: now
  });

  assert.equal(result.appended, true);
  assert.deepEqual(result.items, [newItem]);
  assert.equal(result.card.analyzedToSeq, 6);
  assert.deepEqual(transactions, [{ outcome: "resolved" }]);

  const itemInsert = queries[4];
  const insertedValues = (itemInsert?.valuesValue as Array<Record<string, unknown>>)[0];
  assert.equal(insertedValues?.["ordinal"], 1, "new item must continue the ordinal sequence, not restart at 0");

  const messageUpdate = queries[6];
  assert.equal(messageUpdate?.targetTable, conversationMessages);
  assert.equal(referencesAny(messageUpdate, conversationMessages.id), true);
  const setValue = messageUpdate?.setValue as { contentJson?: { items?: unknown[] } };
  assert.equal(setValue?.contentJson?.items?.length, 2, "card message content must reflect the full item set, not just the new items");

  const stateUpdate = queries[8];
  assert.equal(stateUpdate?.targetTable, conversationObserverState);
});

test("createOrAppendCard raises when the append path's item insert returns an incomplete set", async () => {
  const { db, transactions } = createQueryRecorder([
    [{ id: conversationId, nextSeq: 6 }],
    [observerStateRow()],
    [cardRow()],
    [{ maxOrdinal: 0 }],
    [] // insert().returning() comes back short
  ]);
  await assert.rejects(
    createActionCardRepository(db).createOrAppendCard({
      workspaceId,
      projectId,
      conversationId,
      analyzedToSeq: 6,
      items: [{ kind: "execute", titleMd: "x", confidence: "high", status: "running" }],
      at: now
    }),
    (error: unknown) => error instanceof ActionCardInsertFailedError
  );
  assert.deepEqual(transactions, [{ outcome: "rejected", errorName: "ActionCardInsertFailedError" }]);
});

test("createOrAppendCard raises when the append path's message rewrite finds no matching row", async () => {
  const { db, transactions } = createQueryRecorder([
    [{ id: conversationId, nextSeq: 6 }],
    [observerStateRow()],
    [cardRow()],
    [{ maxOrdinal: 0 }],
    [itemRow({ id: "new-item", ordinal: 1 })],
    [itemRow({ ordinal: 0 }), itemRow({ id: "new-item", ordinal: 1 })],
    [] // message update returns no row
  ]);
  await assert.rejects(
    createActionCardRepository(db).createOrAppendCard({
      workspaceId,
      projectId,
      conversationId,
      analyzedToSeq: 6,
      items: [{ kind: "execute", titleMd: "x", confidence: "high", status: "running" }],
      at: now
    }),
    (error: unknown) => error instanceof ActionCardMessageInsertFailedError
  );
  assert.deepEqual(transactions, [{ outcome: "rejected", errorName: "ActionCardMessageInsertFailedError" }]);
});

// ── recordAnalysisFailure ───────────────────────────────────────────────────────────

test("recordAnalysisFailure upserts and increments the consecutive-failure counter", async () => {
  const { db, queries } = createQueryRecorder([[observerStateRow({ consecutiveFailures: 2 })]]);
  const row = await createActionCardRepository(db).recordAnalysisFailure({ conversationId, at: now });
  assert.equal(row.consecutiveFailures, 2);
  const query = queries[0];
  assert.equal(query?.targetTable, conversationObserverState);
  assert.ok(query?.onConflict);
});

// ── advanceWatermark / listNicknamesByUserIds ───────────────────────────────────────

test("advanceWatermark upserts the watermark without touching active_card_id and resets failures", async () => {
  const { db, queries } = createQueryRecorder([[observerStateRow({ lastAnalyzedSeq: 9, activeCardId: null })]]);
  const row = await createActionCardRepository(db).advanceWatermark({ conversationId, analyzedToSeq: 9, at: now });
  assert.equal(row.lastAnalyzedSeq, 9);
  const query = queries[0];
  assert.equal(query?.targetTable, conversationObserverState);
  assert.ok(query?.onConflict);
  const values = query?.valuesValue as Record<string, unknown>;
  assert.equal(values?.["activeCardId"], null);
});

test("advanceWatermark rejects an unsafe sequence before writing", async () => {
  const { db, queries } = createQueryRecorder();
  await assert.rejects(
    createActionCardRepository(db).advanceWatermark({ conversationId, analyzedToSeq: -1 }),
    (error: unknown) => error instanceof ActionCardRepositoryInputError
  );
  assert.equal(queries.length, 0);
});

test("listNicknamesByUserIds dedupes ids, returns a lookup map, and short-circuits on an empty batch", async () => {
  const { db, queries } = createQueryRecorder([[{ id: userId, nickname: "张三" }]]);
  const map = await createActionCardRepository(db).listNicknamesByUserIds([userId, userId]);
  assert.deepEqual(map, new Map([[userId, "张三"]]));
  assert.equal(queries.length, 1);

  const { db: emptyDb, queries: emptyQueries } = createQueryRecorder();
  const emptyMap = await createActionCardRepository(emptyDb).listNicknamesByUserIds([]);
  assert.deepEqual(emptyMap, new Map());
  assert.equal(emptyQueries.length, 0);
});

test("listNicknamesByUserIds rejects a batch larger than the cap", async () => {
  const { db, queries } = createQueryRecorder();
  const ids = Array.from({ length: 101 }, (_unused, index) => `id-${index}`);
  await assert.rejects(
    createActionCardRepository(db).listNicknamesByUserIds(ids),
    (error: unknown) => error instanceof ActionCardRepositoryInputError
  );
  assert.equal(queries.length, 0);
});

// ── findItemForActor / transitionItemStatus ─────────────────────────────────────────

test("findItemForActor scopes strictly to the item id and workspace, returning both the item and its card", async () => {
  const { db, queries } = createQueryRecorder([[{ item: itemRow(), card: cardRow() }]]);
  const record = await createActionCardRepository(db).findItemForActor({ itemId, workspaceId });
  assert.deepEqual(record, { item: itemRow(), card: cardRow() });
  const query = queries[0];
  assert.equal(query?.fromTable, actionCardItems);
  assert.equal(referencesAny(query, actionCardItems.workspaceId), true);
  assert.ok(allParams(query).includes(workspaceId));
  assert.ok(allParams(query).includes(itemId));
});

test("findItemForActor returns null for a cross-tenant or missing item id", async () => {
  const { db } = createQueryRecorder([[]]);
  const record = await createActionCardRepository(db).findItemForActor({ itemId, workspaceId });
  assert.equal(record, null);
});

test("transitionItemStatus is a CAS write scoped by workspace and source statuses, returning null on a lost race", async () => {
  const updated = itemRow({ status: "undone" });
  const { db, queries } = createQueryRecorder([[updated]]);
  const result = await createActionCardRepository(db).transitionItemStatus({
    itemId,
    workspaceId,
    fromStatuses: ["running"],
    toStatus: "undone",
    at: now
  });
  assert.deepEqual(result, updated);
  const query = queries[0];
  assert.equal(query?.operation, "update");
  assert.equal(query?.targetTable, actionCardItems);
  assert.equal(referencesAny(query, actionCardItems.status), true);
  assert.equal(referencesAny(query, actionCardItems.workspaceId), true);

  const raced = createQueryRecorder([[]]);
  const lost = await createActionCardRepository(raced.db).transitionItemStatus({
    itemId,
    workspaceId,
    fromStatuses: ["running"],
    toStatus: "undone",
    at: now
  });
  assert.equal(lost, null);
});

test("transitionItemStatus rejects an empty source-status list before writing", async () => {
  const { db, queries } = createQueryRecorder();
  await assert.rejects(
    createActionCardRepository(db).transitionItemStatus({
      itemId,
      workspaceId,
      fromStatuses: [],
      toStatus: "undone"
    }),
    (error: unknown) => error instanceof ActionCardRepositoryInputError
  );
  assert.equal(queries.length, 0);
});

// ── listCardsForConversation ────────────────────────────────────────────────────────

test("listCardsForConversation groups items under their card and skips the item query when there are no cards", async () => {
  const { db, queries } = createQueryRecorder([[]]);
  const result = await createActionCardRepository(db).listCardsForConversation({
    workspaceId,
    conversationId,
    limit: 10
  });
  assert.deepEqual(result, []);
  assert.equal(queries.length, 1, "must not issue an item query when the card scan is empty");
});

test("listCardsForConversation returns cards paired with only their own items", async () => {
  const otherCard = cardRow({ id: "other-card", messageId: "other-message" });
  const itemA = itemRow({ id: "item-a", actionCardId: cardId, ordinal: 0 });
  const itemB = itemRow({ id: "item-b", actionCardId: "other-card", ordinal: 0 });
  const { db, queries } = createQueryRecorder([
    [cardRow(), otherCard],
    [itemA, itemB]
  ]);
  const result = await createActionCardRepository(db).listCardsForConversation({
    workspaceId,
    conversationId,
    limit: 10
  });
  assert.deepEqual(result, [
    { card: cardRow(), items: [itemA] },
    { card: otherCard, items: [itemB] }
  ]);
  assert.equal(referencesAny(queries[1], actionCardItems.workspaceId), true);
});

// ── postSystemMessage ────────────────────────────────────────────────────────────────

test("postSystemMessage atomically allocates the next seq and threads under the given root", async () => {
  const created = { id: "sys-1", conversationId, seq: 4, senderType: "system", senderUserId: null, kind: "system_event", contentJson: { note: "撤销" }, threadRootId: messageId, createdAt: now };
  const { db, queries, transactions } = createQueryRecorder([
    [{ id: conversationId, nextSeq: 3 }],
    [{ nextSeq: 4 }],
    [created]
  ]);
  const message = await createActionCardRepository(db).postSystemMessage({
    workspaceId,
    conversationId,
    senderType: "system",
    content: { note: "撤销" },
    threadRootId: messageId,
    at: now
  });
  assert.deepEqual(message, created);
  assert.deepEqual(transactions, [{ outcome: "resolved" }]);
  const insert = queries[2];
  assert.equal((insert?.valuesValue as Record<string, unknown>)["threadRootId"], messageId);
  assert.equal((insert?.valuesValue as Record<string, unknown>)["senderType"], "system");
});

// ── resolveAssigneeByNickname / isActiveWorkspaceMember ─────────────────────────────

test("resolveAssigneeByNickname matches case-insensitively within the workspace and returns null for blank input", async () => {
  const { db, queries } = createQueryRecorder([[{ userId, nickname: "张三" }]]);
  const resolved = await createActionCardRepository(db).resolveAssigneeByNickname({
    workspaceId,
    nickname: "  张三  "
  });
  assert.deepEqual(resolved, { userId, nickname: "张三" });
  const query = queries[0];
  assert.equal(referencesAny(query, workspaceMemberships.workspaceId), true);
  assert.equal(referencesAny(query, users.deletedAt), true);

  const { db: blankDb, queries: blankQueries } = createQueryRecorder();
  const blank = await createActionCardRepository(blankDb).resolveAssigneeByNickname({ workspaceId, nickname: "   " });
  assert.equal(blank, null);
  assert.equal(blankQueries.length, 0);
});

test("isActiveWorkspaceMember reports membership presence scoped to workspace and user", async () => {
  const present = createQueryRecorder([[{ id: "membership-1" }]]);
  assert.equal(
    await createActionCardRepository(present.db).isActiveWorkspaceMember({ workspaceId, userId }),
    true
  );
  const absent = createQueryRecorder([[]]);
  assert.equal(
    await createActionCardRepository(absent.db).isActiveWorkspaceMember({ workspaceId, userId }),
    false
  );
});

// ── findObserverState ────────────────────────────────────────────────────────────────

test("findObserverState returns null when the conversation has never been analyzed", async () => {
  const { db } = createQueryRecorder([[]]);
  const state = await createActionCardRepository(db).findObserverState(conversationId);
  assert.equal(state, null);
});
