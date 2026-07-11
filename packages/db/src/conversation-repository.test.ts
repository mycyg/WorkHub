import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  ConversationAccessDeniedError,
  ConversationInsertFailedError,
  ConversationMessageInsertFailedError,
  ConversationParentAccessError,
  ConversationParticipantInsertFailedError,
  ConversationParticipantMembershipError,
  ConversationRepositoryInputError,
  ConversationSequenceAllocationError,
  ConversationSequenceExhaustedError,
  ConversationSourceMessageMismatchError,
  ConversationThreadRootMismatchError,
  createConversationRepository,
  type ConversationAccessRecord,
  type ConversationMessageRow,
  type ConversationParticipantRow,
  type ConversationRow
} from "./repositories/conversations.js";
import {
  conversationMessages,
  conversationParticipants,
  projectConversations,
  projects,
  workspaceMemberships
} from "./schema/index.js";
import {
  createQueryRecorder,
  queryParamValues,
  queryReferences,
  queryTextFragments,
  type RecordedQuery
} from "./test-query-recorder.js";

const now = new Date("2026-07-12T09:00:00.000Z");
const workspaceId = "13000000-0000-4000-8000-000000000001";
const otherWorkspaceId = "13000000-0000-4000-8000-000000000002";
const projectId = "13000000-0000-4000-8000-000000000003";
const conversationId = "13000000-0000-4000-8000-000000000004";
const parentConversationId = "13000000-0000-4000-8000-000000000005";
const sourceMessageId = "13000000-0000-4000-8000-000000000006";
const creatorUserId = "13000000-0000-4000-8000-000000000007";
const memberUserId = "13000000-0000-4000-8000-000000000008";
const secondMemberUserId = "13000000-0000-4000-8000-000000000009";
const listCursorCreatedAt = new Date("2026-07-12T08:30:00.000Z");
const listCursorId = "13000000-0000-4000-8000-000000000011";

function conversation(overrides: Partial<ConversationRow> = {}): ConversationRow {
  return {
    id: conversationId,
    workspaceId,
    projectId,
    kind: "collab",
    title: "协作区",
    parentConversationId: null,
    sourceMessageId: null,
    visibility: "private",
    nextSeq: 0,
    createdBy: creatorUserId,
    deletedAt: null,
    deletedByUserId: null,
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

function participant(
  userId: string,
  role: "owner" | "member",
  overrides: Partial<ConversationParticipantRow> = {}
): ConversationParticipantRow {
  return {
    id: `23000000-0000-4000-8000-0000000000${role === "owner" ? "01" : userId === memberUserId ? "02" : "03"}`,
    conversationId,
    userId,
    role,
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

function message(seq: number, overrides: Partial<ConversationMessageRow> = {}): ConversationMessageRow {
  return {
    id: `33000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    conversationId,
    seq,
    senderType: "user",
    senderUserId: creatorUserId,
    kind: "text",
    contentJson: { text: `message ${seq}` },
    threadRootId: null,
    createdAt: now,
    ...overrides
  };
}

function accessRecord(overrides: Partial<ConversationAccessRecord> = {}): ConversationAccessRecord {
  return {
    conversation: conversation(),
    projectOwnerUserId: creatorUserId,
    membershipRole: "member",
    participantRole: "owner",
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

function assertFullConversationAccessPredicates(
  query: RecordedQuery | undefined,
  expected: { viewerUserId: string; conversationId?: string; projectId?: string }
) {
  assert.ok(query, "expected a conversation access query");
  assert.equal(query.fromTable, projectConversations);
  for (const column of [
    projectConversations.workspaceId,
    projectConversations.projectId,
    projectConversations.kind,
    projectConversations.deletedAt,
    projects.id,
    projects.workspaceId,
    projects.archived,
    projects.deletedAt,
    workspaceMemberships.workspaceId,
    workspaceMemberships.userId,
    workspaceMemberships.deletedAt,
    conversationParticipants.conversationId,
    conversationParticipants.userId
  ]) {
    assert.equal(referencesAny(query, column), true, `missing access predicate for ${String(column)}`);
  }
  const params = allParams(query);
  assert.ok(params.includes(workspaceId));
  assert.ok(params.includes(expected.viewerUserId));
  assert.ok(params.includes("main"));
  assert.ok(params.includes("collab"));
  if (expected.conversationId) {
    assert.ok(params.includes(expected.conversationId));
  }
  if (expected.projectId) {
    assert.ok(params.includes(expected.projectId));
  }
}

test("R12 conversation list is tenant-safe, participant-aware, and truthfully capped", async () => {
  const first = { ...conversation({ kind: "main", visibility: "project" }), participantRole: null };
  const second = { ...conversation({ id: parentConversationId }), participantRole: "member" as const };
  const extra = { ...conversation({ id: "13000000-0000-4000-8000-000000000010" }), participantRole: "member" as const };
  const { db, queries } = createQueryRecorder([[first, second, extra]]);

  const result = await createConversationRepository(db).listVisibleForProject({
    workspaceId,
    viewerUserId: memberUserId,
    projectId,
    after: { createdAt: listCursorCreatedAt, id: listCursorId },
    limit: 2
  });

  assert.deepEqual(result, {
    rows: [first, second],
    capped: true,
    nextCursor: { createdAt: second.createdAt, id: second.id }
  });
  const query = queries[0];
  assert.equal(query?.limit, 3);
  assertFullConversationAccessPredicates(query, { viewerUserId: memberUserId, projectId });
  assert.equal(query?.orderBy.length, 2);
  assert.ok(queryReferences(query?.where, projectConversations.createdAt));
  assert.ok(queryReferences(query?.where, projectConversations.id));
  assert.ok(queryParamValues(query?.where).some(
    (value) => value instanceof Date && value.getTime() === listCursorCreatedAt.getTime()
  ));
  assert.ok(queryParamValues(query?.where).includes(listCursorId));
});

test("R12 access record fails closed on deleted or cross-workspace visibility", async () => {
  const { db, queries } = createQueryRecorder([[]]);

  const result = await createConversationRepository(db).findVisibleAccessRecord({
    workspaceId,
    viewerUserId: memberUserId,
    conversationId
  });

  assert.equal(result, null);
  assertFullConversationAccessPredicates(queries[0], { viewerUserId: memberUserId, conversationId });
  assert.equal(allParams(queries[0]).includes(otherWorkspaceId), false);
  assert.equal(queries[0]?.limit, 1);
});

test("R12 collab creation inserts the owner and requested members in one transaction", async () => {
  const created = conversation({ parentConversationId, sourceMessageId });
  const participants = [
    participant(creatorUserId, "owner"),
    participant(memberUserId, "member"),
    participant(secondMemberUserId, "member")
  ];
  const { db, queries, transactions } = createQueryRecorder([
    [{ projectId, projectOwnerUserId: creatorUserId, membershipRole: "owner" }],
    [{ userId: memberUserId }, { userId: secondMemberUserId }],
    [accessRecord({ conversation: conversation({ id: parentConversationId, kind: "main" }), participantRole: null })],
    [{ id: sourceMessageId }],
    [created],
    participants
  ]);

  const result = await createConversationRepository(db).createCollab({
    id: conversationId,
    workspaceId,
    projectId,
    creatorUserId,
    title: "协作区",
    visibility: "private",
    parentConversationId,
    sourceMessageId,
    participantUserIds: [memberUserId, secondMemberUserId],
    at: now
  });

  assert.deepEqual(result, { conversation: created, participants });
  assert.deepEqual(transactions, [{ outcome: "resolved" }]);
  const projectLock = queries[0];
  assert.equal(projectLock?.fromTable, projects);
  assert.equal(projectLock?.lock, "update");
  for (const column of [
    projects.id,
    projects.workspaceId,
    projects.archived,
    projects.deletedAt,
    workspaceMemberships.workspaceId,
    workspaceMemberships.userId,
    workspaceMemberships.deletedAt
  ]) {
    assert.equal(referencesAny(projectLock, column), true);
  }
  assertFullConversationAccessPredicates(queries[2], {
    viewerUserId: creatorUserId,
    conversationId: parentConversationId,
    projectId
  });
  const sourceRead = queries[3];
  assert.equal(sourceRead?.fromTable, conversationMessages);
  assert.ok(queryReferences(sourceRead?.where, conversationMessages.conversationId));
  assert.ok(queryReferences(sourceRead?.where, conversationMessages.id));

  const conversationInsert = queries[4];
  assert.equal(conversationInsert?.targetTable, projectConversations);
  assert.equal(conversationInsert?.returningCalled, true);
  const participantInsert = queries[5];
  assert.equal(participantInsert?.targetTable, conversationParticipants);
  assert.equal(participantInsert?.returningCalled, true);
  assert.deepEqual(
    (participantInsert?.valuesValue as Array<Record<string, unknown>>).map(({ userId, role }) => ({ userId, role })),
    [
      { userId: creatorUserId, role: "owner" },
      { userId: memberUserId, role: "member" },
      { userId: secondMemberUserId, role: "member" }
    ]
  );
});

test("R12 collab creation rejects incomplete participant membership and rolls back", async () => {
  const { db, queries, transactions } = createQueryRecorder([
    [{ projectId, projectOwnerUserId: creatorUserId, membershipRole: "owner" }],
    [{ userId: memberUserId }]
  ]);

  await assert.rejects(
    createConversationRepository(db).createCollab({
      workspaceId,
      projectId,
      creatorUserId,
      title: "协作区",
      visibility: "private",
      participantUserIds: [memberUserId, secondMemberUserId],
      at: now
    }),
    (error: unknown) => error instanceof ConversationParticipantMembershipError
  );

  assert.deepEqual(transactions, [{ outcome: "rejected", errorName: "ConversationParticipantMembershipError" }]);
  assert.equal(queries.some((query) => query.operation === "insert"), false);
});

test("R12 collab creation rejects an invisible parent and wrong-parent source with rollback", async () => {
  const invisible = createQueryRecorder([
    [{ projectId, projectOwnerUserId: creatorUserId, membershipRole: "owner" }],
    [],
    []
  ]);
  await assert.rejects(
    createConversationRepository(invisible.db).createCollab({
      workspaceId,
      projectId,
      creatorUserId,
      title: "协作区",
      visibility: "private",
      parentConversationId,
      participantUserIds: [],
      at: now
    }),
    (error: unknown) => error instanceof ConversationParentAccessError
  );
  assert.deepEqual(invisible.transactions, [{ outcome: "rejected", errorName: "ConversationParentAccessError" }]);
  assert.equal(invisible.queries.some((query) => query.operation === "insert"), false);

  const wrongSource = createQueryRecorder([
    [{ projectId, projectOwnerUserId: creatorUserId, membershipRole: "owner" }],
    [accessRecord({ conversation: conversation({ id: parentConversationId, kind: "main" }), participantRole: null })],
    []
  ]);
  await assert.rejects(
    createConversationRepository(wrongSource.db).createCollab({
      workspaceId,
      projectId,
      creatorUserId,
      title: "协作区",
      visibility: "private",
      parentConversationId,
      sourceMessageId,
      participantUserIds: [],
      at: now
    }),
    (error: unknown) => error instanceof ConversationSourceMessageMismatchError
  );
  assert.deepEqual(wrongSource.transactions, [
    { outcome: "rejected", errorName: "ConversationSourceMessageMismatchError" }
  ]);
  assert.equal(wrongSource.queries.some((query) => query.operation === "insert"), false);
});

test("R12 collab creation fails closed on missing conversation or participant returning rows", async () => {
  const noConversation = createQueryRecorder([
    [{ projectId, projectOwnerUserId: creatorUserId, membershipRole: "owner" }],
    []
  ]);
  await assert.rejects(
    createConversationRepository(noConversation.db).createCollab({
      workspaceId,
      projectId,
      creatorUserId,
      title: "协作区",
      visibility: "private",
      participantUserIds: [],
      at: now
    }),
    (error: unknown) => error instanceof ConversationInsertFailedError
  );

  const created = conversation();
  const noParticipants = createQueryRecorder([
    [{ projectId, projectOwnerUserId: creatorUserId, membershipRole: "owner" }],
    [created],
    []
  ]);
  await assert.rejects(
    createConversationRepository(noParticipants.db).createCollab({
      workspaceId,
      projectId,
      creatorUserId,
      title: "协作区",
      visibility: "private",
      participantUserIds: [],
      at: now
    }),
    (error: unknown) => error instanceof ConversationParticipantInsertFailedError
  );
});

test("R12 user message allocates next_seq atomically before inserting", async () => {
  const inserted = message(1);
  const { db, queries, transactions } = createQueryRecorder([
    [accessRecord()],
    [{ nextSeq: 1 }],
    [inserted]
  ]);

  const result = await createConversationRepository(db).createUserMessage({
    id: inserted.id,
    workspaceId,
    conversationId,
    senderUserId: creatorUserId,
    kind: "text",
    contentJson: { text: "message 1" },
    at: now
  });

  assert.deepEqual(result, inserted);
  assert.deepEqual(transactions, [{ outcome: "resolved" }]);
  assertFullConversationAccessPredicates(queries[0], { viewerUserId: creatorUserId, conversationId });
  assert.equal(queries[0]?.lock, "update");
  const allocation = queries[1];
  assert.equal(allocation?.operation, "update");
  assert.equal(allocation?.targetTable, projectConversations);
  assert.equal(allocation?.returningCalled, true);
  assert.ok(queryReferences(allocation?.setValue, projectConversations.nextSeq));
  assert.ok(queryTextFragments(allocation?.setValue).join("").includes(" + "));
  assert.ok(queryReferences(allocation?.where, projectConversations.workspaceId));
  assert.ok(queryReferences(allocation?.where, projectConversations.id));
  assert.ok(queryReferences(allocation?.where, projectConversations.deletedAt));
  const insert = queries[2];
  assert.equal(insert?.targetTable, conversationMessages);
  assert.equal(insert?.returningCalled, true);
  assert.equal((insert?.valuesValue as Record<string, unknown>)["seq"], 1);
});

test("R12 user message rejects a wrong thread root before sequence allocation", async () => {
  const { db, queries, transactions } = createQueryRecorder([[accessRecord()], []]);

  await assert.rejects(
    createConversationRepository(db).createUserMessage({
      workspaceId,
      conversationId,
      senderUserId: creatorUserId,
      kind: "text",
      contentJson: { text: "reply" },
      threadRootId: sourceMessageId,
      at: now
    }),
    (error: unknown) => error instanceof ConversationThreadRootMismatchError
  );

  assert.deepEqual(transactions, [{ outcome: "rejected", errorName: "ConversationThreadRootMismatchError" }]);
  assert.equal(queries.some((query) => query.operation === "update"), false);
});

test("R12 message sequence exhaustion and missing returning rows are explicit transaction errors", async () => {
  const exhausted = createQueryRecorder([
    [accessRecord({ conversation: conversation({ nextSeq: Number.MAX_SAFE_INTEGER }) })]
  ]);
  await assert.rejects(
    createConversationRepository(exhausted.db).createUserMessage({
      workspaceId,
      conversationId,
      senderUserId: creatorUserId,
      kind: "text",
      contentJson: { text: "overflow" },
      at: now
    }),
    (error: unknown) => error instanceof ConversationSequenceExhaustedError
  );
  assert.equal(exhausted.queries.some((query) => query.operation === "update"), false);

  const missingAllocation = createQueryRecorder([[accessRecord()], []]);
  await assert.rejects(
    createConversationRepository(missingAllocation.db).createUserMessage({
      workspaceId,
      conversationId,
      senderUserId: creatorUserId,
      kind: "text",
      contentJson: { text: "missing allocation" },
      at: now
    }),
    (error: unknown) => error instanceof ConversationSequenceAllocationError
  );

  const missingMessage = createQueryRecorder([[accessRecord()], [{ nextSeq: 1 }], []]);
  await assert.rejects(
    createConversationRepository(missingMessage.db).createUserMessage({
      workspaceId,
      conversationId,
      senderUserId: creatorUserId,
      kind: "text",
      contentJson: { text: "missing insert" },
      at: now
    }),
    (error: unknown) => error instanceof ConversationMessageInsertFailedError
  );
});

test("R12 message page repeats full access predicates and advances a safe ascending cursor", async () => {
  const { db, queries } = createQueryRecorder([
    [accessRecord()],
    [message(2), message(3), message(4)]
  ]);

  const result = await createConversationRepository(db).listMessagesAfter({
    workspaceId,
    viewerUserId: creatorUserId,
    conversationId,
    afterSeq: 1,
    limit: 2
  });

  assert.deepEqual(result, { rows: [message(2), message(3)], hasMore: true, nextAfterSeq: 3 });
  assertFullConversationAccessPredicates(queries[0], { viewerUserId: creatorUserId, conversationId });
  const messageQuery = queries[1];
  assert.equal(messageQuery?.fromTable, conversationMessages);
  assert.equal(messageQuery?.limit, 3);
  assert.equal(messageQuery?.orderBy.length, 1);
  assert.ok(queryReferences(messageQuery?.where, conversationMessages.seq));
  assert.ok(queryParamValues(messageQuery?.where).includes(1));
  for (const column of [
    projectConversations.workspaceId,
    projectConversations.projectId,
    projectConversations.kind,
    projectConversations.deletedAt,
    projects.id,
    projects.workspaceId,
    projects.archived,
    projects.deletedAt,
    workspaceMemberships.workspaceId,
    workspaceMemberships.userId,
    workspaceMemberships.deletedAt,
    conversationParticipants.conversationId,
    conversationParticipants.userId
  ]) {
    assert.equal(referencesAny(messageQuery, column), true, `message page missing ${String(column)}`);
  }
});

test("R12 repository rejects invalid bounds and participant identities before querying", async () => {
  const { db, queries } = createQueryRecorder();
  const repository = createConversationRepository(db);

  await assert.rejects(
    repository.listVisibleForProject({ workspaceId, viewerUserId: creatorUserId, projectId, limit: 0 }),
    (error: unknown) => error instanceof ConversationRepositoryInputError
  );
  await assert.rejects(
    repository.listMessagesAfter({
      workspaceId,
      viewerUserId: creatorUserId,
      conversationId,
      afterSeq: Number.MAX_SAFE_INTEGER + 1,
      limit: 50
    }),
    (error: unknown) => error instanceof ConversationRepositoryInputError
  );
  await assert.rejects(
    repository.createCollab({
      workspaceId,
      projectId,
      creatorUserId,
      title: "协作区",
      visibility: "private",
      participantUserIds: [creatorUserId],
      at: now
    }),
    (error: unknown) => error instanceof ConversationRepositoryInputError
  );
  await assert.rejects(
    repository.listVisibleForProject({
      workspaceId,
      viewerUserId: creatorUserId,
      projectId,
      after: { createdAt: new Date("invalid"), id: listCursorId },
      limit: 50
    }),
    (error: unknown) => error instanceof ConversationRepositoryInputError
  );
  assert.equal(queries.length, 0);
});

test("R12 conversation repository source never allocates sequence through max(seq)", async () => {
  const source = await readFile(new URL("./repositories/conversations.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /max\s*\(\s*(?:[\w.]+\.)?seq\s*\)/iu);
});

test("R12 inaccessible conversation cannot create a message", async () => {
  const { db, queries, transactions } = createQueryRecorder([[]]);

  await assert.rejects(
    createConversationRepository(db).createUserMessage({
      workspaceId,
      conversationId,
      senderUserId: creatorUserId,
      kind: "file_card",
      contentJson: { drive_item_id: sourceMessageId, snapshot_name: "brief.docx" },
      at: now
    }),
    (error: unknown) => error instanceof ConversationAccessDeniedError
  );

  assert.deepEqual(transactions, [{ outcome: "rejected", errorName: "ConversationAccessDeniedError" }]);
  assert.equal(queries.some((query) => query.operation === "insert" || query.operation === "update"), false);
});
