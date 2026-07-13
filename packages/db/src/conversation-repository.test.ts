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
  queryRawStrings,
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
const caseMemberUserId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const caseCreatorUserId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const listCursorCreatedAt = "2026-07-12T08:30:00.123456Z";
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
    cuuEnabled: true,
    // R13 批 C1：默认"从未压缩过"，同 cuuEnabled 当初加进这个 fixture 的理由一致——不加就会撞上
    // ConversationRow 现在多出的两个必需字段（这个 fixture 没有 `as ConversationRow` 兜底断言）。
    contextSummaryMd: null,
    contextSummaryThroughSeq: 0,
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
    id: `23000000-0000-4000-8000-0000000000${role === "owner" ? "01" : userId === memberUserId || userId === caseMemberUserId ? "02" : "03"}`,
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
    projectIsPersonal: false,
    membershipRole: "member",
    participantRole: "owner",
    participantCount: 1,
    ...overrides
  };
}

const creatorMembershipLockRow = {
  id: "43000000-0000-4000-8000-000000000001",
  userId: creatorUserId,
  role: "owner"
};

const creatorParticipantLockRow = {
  id: "43000000-0000-4000-8000-000000000002",
  role: "owner"
};

function messageAccessLockResponses(overrides: Partial<ConversationRow> = {}) {
  return [
    [{ projectId }],
    [{ projectId, projectOwnerUserId: creatorUserId }],
    [conversation(overrides)],
    [creatorMembershipLockRow],
    [creatorParticipantLockRow]
  ];
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
    // R13 批 S3：个人空间 fail-closed 可见性条件必须在每一条会话访问查询里都出现（单会话/消息
    // 翻页/项目内列表共用这同一份 activeConversationCondition），不是只补一处漏掉别处。
    projects.isPersonal,
    projects.ownerUserId,
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
  const firstCursorCreatedAt = "2026-07-12T09:00:00.549357Z";
  const secondCursorCreatedAt = "2026-07-12T09:00:00.549357Z";
  const { db, queries } = createQueryRecorder([
    [{ projectId, membershipRole: "member" }],
    [
      { ...first, cursorCreatedAt: firstCursorCreatedAt },
      { ...second, cursorCreatedAt: secondCursorCreatedAt },
      { ...extra, cursorCreatedAt: "2026-07-12T09:00:00.549358Z" }
    ]
  ]);

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
    nextCursor: { createdAt: secondCursorCreatedAt, id: second.id }
  });
  const query = queries[1];
  assert.equal(query?.limit, 3);
  assertFullConversationAccessPredicates(query, { viewerUserId: memberUserId, projectId });
  assert.equal(query?.orderBy.length, 2);
  assert.ok(queryReferences(query?.where, projectConversations.createdAt));
  assert.ok(queryReferences(query?.where, projectConversations.id));
  assert.ok(queryRawStrings(query?.where).includes(listCursorCreatedAt));
  assert.ok(queryRawStrings(query?.where).includes(listCursorId));
  assert.match(queryTextFragments(query?.selection).join(""), /to_char\(/u);
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

test("R12 authorized conversation list returns an empty tail page instead of access denial", async () => {
  const { db, queries } = createQueryRecorder([
    [{ projectId, membershipRole: "member" }],
    []
  ]);

  const result = await createConversationRepository(db).listVisibleForProject({
    workspaceId,
    viewerUserId: memberUserId,
    projectId,
    after: { createdAt: listCursorCreatedAt, id: listCursorId },
    limit: 50
  });

  assert.deepEqual(result, { rows: [], capped: false, nextCursor: null });
  assert.equal(queries.length, 2);
  const projectAccess = queries[0];
  assert.equal(projectAccess?.fromTable, projects);
  assert.equal(projectAccess?.limit, 1);
  for (const column of [
    projects.id,
    projects.workspaceId,
    projects.archived,
    projects.deletedAt,
    // R13 批 S3：readActiveProjectMembership 也要带这条 fail-closed 条件——否则非 owner 会先
    // 通过这道预检查，等到下面的行查询才被 activeConversationCondition 挡下，行为虽然一致但
    // 少了一层「提前拒绝」的清晰度，这里直接钉死两处都要有。
    projects.isPersonal,
    projects.ownerUserId,
    workspaceMemberships.workspaceId,
    workspaceMemberships.userId,
    workspaceMemberships.deletedAt
  ]) {
    assert.equal(referencesAny(projectAccess, column), true);
  }
  assertFullConversationAccessPredicates(queries[1], { viewerUserId: memberUserId, projectId });
});

test("R12 collab creation inserts the owner and requested members in one transaction", async () => {
  const created = conversation({ parentConversationId, sourceMessageId });
  const participants = [
    participant(creatorUserId, "owner"),
    participant(caseMemberUserId, "member"),
    participant(secondMemberUserId, "member")
  ];
  const { db, queries, transactions } = createQueryRecorder([
    [{ projectId, projectOwnerUserId: creatorUserId }],
    [conversation({ id: parentConversationId, kind: "main" })],
    [
      creatorMembershipLockRow,
      { id: "43000000-0000-4000-8000-000000000003", userId: caseMemberUserId },
      { id: "43000000-0000-4000-8000-000000000004", userId: secondMemberUserId }
    ],
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
    participantUserIds: [caseMemberUserId.toUpperCase(), secondMemberUserId],
    at: now
  });

  assert.deepEqual(result, { conversation: created, participants });
  assert.deepEqual(transactions, [{ outcome: "resolved" }]);
  const projectLock = queries[0];
  assert.equal(projectLock?.fromTable, projects);
  assert.equal(projectLock?.lock, "share");
  for (const column of [
    projects.id,
    projects.workspaceId,
    projects.archived,
    projects.deletedAt
  ]) {
    assert.equal(referencesAny(projectLock, column), true);
  }
  assert.deepEqual(queries.slice(0, 3).map((query) => query.fromTable), [
    projects,
    projectConversations,
    workspaceMemberships
  ]);
  const membershipLocks = queries.filter(
    (query) => query.fromTable === workspaceMemberships && query.lock === "share"
  );
  assert.equal(membershipLocks.length, 1, "all workspace memberships must share one stable lock order");
  assert.equal(membershipLocks[0]?.orderBy.length, 1);
  const parentLock = queries[1];
  assert.equal(parentLock?.fromTable, projectConversations);
  assert.equal(parentLock?.lock, "update", "visible parent conversation must remain locked until commit");
  for (const column of [
    projectConversations.workspaceId,
    projectConversations.projectId,
    projectConversations.id,
    projectConversations.deletedAt
  ]) {
    assert.ok(queryReferences(parentLock?.where, column));
  }
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
      { userId: caseMemberUserId, role: "member" },
      { userId: secondMemberUserId, role: "member" }
    ]
  );
});

// R13 批 S3（个人空间）：projects.is_personal=true 的项目——就算发起人是正常工作区成员，也不能在
// 别人的个人空间下新建协同会话。这条锁死 lockActiveProject 选出 isPersonal/projectOwnerUserId 后
// createCollab 追加的 fail-closed 检查。
test("R13 S3 collab creation rejects a non-owner creating a collab conversation under someone else's personal space", async () => {
  const { db, queries, transactions } = createQueryRecorder([
    [{ projectId, projectOwnerUserId: memberUserId, isPersonal: true }]
  ]);

  await assert.rejects(
    createConversationRepository(db).createCollab({
      workspaceId,
      projectId,
      creatorUserId,
      title: "协作区",
      visibility: "private",
      participantUserIds: [],
      at: now
    }),
    (error: unknown) => error instanceof ConversationAccessDeniedError
  );

  assert.deepEqual(transactions, [{ outcome: "rejected", errorName: "ConversationAccessDeniedError" }]);
  assert.equal(queries.some((query) => query.operation === "insert"), false);
});

test("R13 S3 collab creation allows the personal space's own owner to create a collab conversation in it", async () => {
  const created = conversation();
  const participants = [participant(creatorUserId, "owner")];
  const { db, queries, transactions } = createQueryRecorder([
    [{ projectId, projectOwnerUserId: creatorUserId, isPersonal: true }],
    [creatorMembershipLockRow],
    [created],
    participants
  ]);

  const result = await createConversationRepository(db).createCollab({
    workspaceId,
    projectId,
    creatorUserId,
    title: "协作区",
    visibility: "private",
    participantUserIds: [],
    at: now
  });

  assert.deepEqual(result, { conversation: created, participants });
  assert.deepEqual(transactions, [{ outcome: "resolved" }]);
  assert.equal(queries.some((query) => query.operation === "insert"), true);
});

test("R12 collab creation rejects incomplete participant membership and rolls back", async () => {
  const { db, queries, transactions } = createQueryRecorder([
    [{ projectId, projectOwnerUserId: creatorUserId }],
    [
      creatorMembershipLockRow,
      { id: "43000000-0000-4000-8000-000000000003", userId: memberUserId }
    ]
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
    [{ projectId, projectOwnerUserId: creatorUserId }],
    [conversation({ id: parentConversationId, kind: "collab" })],
    [creatorMembershipLockRow],
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
    [{ projectId, projectOwnerUserId: creatorUserId }],
    [conversation({ id: parentConversationId, kind: "main" })],
    [creatorMembershipLockRow],
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
    [{ projectId, projectOwnerUserId: creatorUserId }],
    [creatorMembershipLockRow],
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
    [{ projectId, projectOwnerUserId: creatorUserId }],
    [creatorMembershipLockRow],
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
    ...messageAccessLockResponses(),
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
  assert.deepEqual(queries.slice(0, 5).map((query) => [query.fromTable, query.lock]), [
    [projectConversations, undefined],
    [projects, "share"],
    [projectConversations, "update"],
    [workspaceMemberships, "share"],
    [conversationParticipants, "share"]
  ]);
  for (const column of [projectConversations.workspaceId, projectConversations.id, projectConversations.deletedAt]) {
    assert.ok(queryReferences(queries[0]?.where, column));
  }
  for (const column of [projects.id, projects.workspaceId, projects.archived, projects.deletedAt]) {
    assert.ok(queryReferences(queries[1]?.where, column));
  }
  for (const column of [
    projectConversations.workspaceId,
    projectConversations.projectId,
    projectConversations.id,
    projectConversations.deletedAt
  ]) {
    assert.ok(queryReferences(queries[2]?.where, column));
  }
  assert.ok(
    queries.some((query) => query.fromTable === workspaceMemberships && query.lock === "share"),
    "sender membership must be revalidated and locked"
  );
  assert.ok(
    queries.some((query) => query.fromTable === conversationParticipants && query.lock === "share"),
    "collab participant row must be revalidated and locked"
  );
  const allocation = queries[5];
  assert.equal(allocation?.operation, "update");
  assert.equal(allocation?.targetTable, projectConversations);
  assert.equal(allocation?.returningCalled, true);
  assert.ok(queryReferences(allocation?.setValue, projectConversations.nextSeq));
  assert.ok(queryTextFragments(allocation?.setValue).join("").includes(" + "));
  assert.ok(queryReferences(allocation?.where, projectConversations.workspaceId));
  assert.ok(queryReferences(allocation?.where, projectConversations.id));
  assert.ok(queryReferences(allocation?.where, projectConversations.deletedAt));
  const insert = queries[6];
  assert.equal(insert?.targetTable, conversationMessages);
  assert.equal(insert?.returningCalled, true);
  assert.equal((insert?.valuesValue as Record<string, unknown>)["seq"], 1);
});

test("R12 user message rejects a wrong thread root before sequence allocation", async () => {
  const { db, queries, transactions } = createQueryRecorder([
    ...messageAccessLockResponses(),
    []
  ]);

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
    ...messageAccessLockResponses({ nextSeq: Number.MAX_SAFE_INTEGER })
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

  const missingAllocation = createQueryRecorder([
    ...messageAccessLockResponses(),
    []
  ]);
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

  const missingMessage = createQueryRecorder([
    ...messageAccessLockResponses(),
    [{ nextSeq: 1 }],
    []
  ]);
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
    // R13 批 S3：个人空间 fail-closed 可见性条件必须在每一条会话访问查询里都出现（单会话/消息
    // 翻页/项目内列表共用这同一份 activeConversationCondition），不是只补一处漏掉别处。
    projects.isPersonal,
    projects.ownerUserId,
    workspaceMemberships.workspaceId,
    workspaceMemberships.userId,
    workspaceMemberships.deletedAt,
    conversationParticipants.conversationId,
    conversationParticipants.userId
  ]) {
    assert.equal(referencesAny(messageQuery, column), true, `message page missing ${String(column)}`);
  }
});

test("R12 message page (beforeSeq) mirrors full access predicates and returns an ascending page from a descending scan", async () => {
  const { db, queries } = createQueryRecorder([
    [accessRecord()],
    [message(4), message(3), message(2)]
  ]);

  const result = await createConversationRepository(db).listMessagesBefore({
    workspaceId,
    viewerUserId: creatorUserId,
    conversationId,
    beforeSeq: 5,
    limit: 2
  });

  assert.deepEqual(result, { rows: [message(3), message(4)], hasMore: true, nextBeforeSeq: 3 });
  assertFullConversationAccessPredicates(queries[0], { viewerUserId: creatorUserId, conversationId });
  const messageQuery = queries[1];
  assert.equal(messageQuery?.fromTable, conversationMessages);
  assert.equal(messageQuery?.limit, 3);
  assert.equal(messageQuery?.orderBy.length, 1);
  assert.ok(
    queryTextFragments(messageQuery?.orderBy[0]).some((fragment) => fragment.includes("desc")),
    "beforeSeq page must scan in descending seq order"
  );
  assert.ok(queryReferences(messageQuery?.where, conversationMessages.seq));
  assert.ok(queryParamValues(messageQuery?.where).includes(5));
  for (const column of [
    projectConversations.workspaceId,
    projectConversations.projectId,
    projectConversations.kind,
    projectConversations.deletedAt,
    projects.id,
    projects.workspaceId,
    projects.archived,
    projects.deletedAt,
    // R13 批 S3：个人空间 fail-closed 可见性条件必须在每一条会话访问查询里都出现（单会话/消息
    // 翻页/项目内列表共用这同一份 activeConversationCondition），不是只补一处漏掉别处。
    projects.isPersonal,
    projects.ownerUserId,
    workspaceMemberships.workspaceId,
    workspaceMemberships.userId,
    workspaceMemberships.deletedAt,
    conversationParticipants.conversationId,
    conversationParticipants.userId
  ]) {
    assert.equal(referencesAny(messageQuery, column), true, `message page (beforeSeq) missing ${String(column)}`);
  }
});

test("R12 message page (beforeSeq) returns an empty page without advancing the cursor when nothing precedes it", async () => {
  const { db } = createQueryRecorder([[accessRecord()], []]);

  const result = await createConversationRepository(db).listMessagesBefore({
    workspaceId,
    viewerUserId: creatorUserId,
    conversationId,
    beforeSeq: 1,
    limit: 50
  });

  assert.deepEqual(result, { rows: [], hasMore: false, nextBeforeSeq: 1 });
});

test("R12 message page (beforeSeq) fails closed on an invisible conversation without leaking a page", async () => {
  const { db, queries } = createQueryRecorder([[]]);

  const result = await createConversationRepository(db).listMessagesBefore({
    workspaceId,
    viewerUserId: creatorUserId,
    conversationId,
    beforeSeq: 5,
    limit: 50
  });

  assert.equal(result, null);
  assert.equal(queries.length, 1);
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
  // R12 批8：listMessagesBefore 复用同一个 assertCursor/assertLimit，边界检查同款。
  await assert.rejects(
    repository.listMessagesBefore({
      workspaceId,
      viewerUserId: creatorUserId,
      conversationId,
      beforeSeq: -1,
      limit: 50
    }),
    (error: unknown) => error instanceof ConversationRepositoryInputError
  );
  await assert.rejects(
    repository.listMessagesBefore({
      workspaceId,
      viewerUserId: creatorUserId,
      conversationId,
      beforeSeq: 5,
      limit: 0
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
    repository.createCollab({
      workspaceId,
      projectId,
      creatorUserId: caseCreatorUserId,
      title: "协作区",
      visibility: "private",
      participantUserIds: [caseCreatorUserId.toUpperCase()],
      at: now
    }),
    (error: unknown) => error instanceof ConversationRepositoryInputError
  );
  await assert.rejects(
    repository.listVisibleForProject({
      workspaceId,
      viewerUserId: creatorUserId,
      projectId,
      after: { createdAt: "invalid", id: listCursorId },
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

// ── R12 批4a: createCuuMessage ──────────────────────────────────────────────────────
// Cuu 回应精简掉了 createUserMessage 的 membership/participant 锁（Cuu 不是 workspace 成员），只保留
// 会话/项目活跃性锁 + 同一套原子 seq 分配。调用方职责：在调用前已经用 findVisibleAccessRecord 确认过
// 发起 turn 的人类是这个会话的可见参与者。

function cuuMessage(seq: number, overrides: Partial<ConversationMessageRow> = {}): ConversationMessageRow {
  return {
    id: `53000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    conversationId,
    seq,
    senderType: "cuu",
    senderUserId: null,
    kind: "text",
    contentJson: { text: `Cuu 回应 ${seq}` },
    threadRootId: null,
    createdAt: now,
    ...overrides
  };
}

function cuuMessageAccessLockResponses(overrides: Partial<ConversationRow> = {}) {
  return [
    [{ projectId }],
    [{ projectId, projectOwnerUserId: creatorUserId }],
    [conversation(overrides)]
  ];
}

test("R12 cuu message allocates next_seq atomically and writes a null-sender text row", async () => {
  const inserted = cuuMessage(1, {
    contentJson: {
      text: "已经帮你查过之前的偏好了",
      memory_citations: [{ kind: "user_memory", title: "偏好中文回复" }]
    }
  });
  const { db, queries, transactions } = createQueryRecorder([
    ...cuuMessageAccessLockResponses(),
    [{ nextSeq: 1 }],
    [inserted]
  ]);

  const result = await createConversationRepository(db).createCuuMessage({
    id: inserted.id,
    workspaceId,
    conversationId,
    kind: "text",
    contentJson: inserted.contentJson as { text: string; memory_citations?: Array<{ kind: "user_memory" | "team_skill"; title: string }> },
    at: now
  });

  assert.deepEqual(result, inserted);
  assert.deepEqual(transactions, [{ outcome: "resolved" }]);
  // 只有 3 把锁（locator/project/conversation），没有 createUserMessage 那两把 membership/participant 锁。
  assert.deepEqual(queries.slice(0, 3).map((query) => [query.fromTable, query.lock]), [
    [projectConversations, undefined],
    [projects, "share"],
    [projectConversations, "update"]
  ]);
  assert.equal(
    queries.some((query) => query.fromTable === workspaceMemberships),
    false,
    "cuu messages must not touch workspace membership locks"
  );
  assert.equal(
    queries.some((query) => query.fromTable === conversationParticipants),
    false,
    "cuu messages must not touch conversation participant locks"
  );
  const allocation = queries[3];
  assert.equal(allocation?.operation, "update");
  assert.equal(allocation?.targetTable, projectConversations);
  assert.equal(allocation?.returningCalled, true);
  const insert = queries[4];
  assert.equal(insert?.targetTable, conversationMessages);
  assert.equal(insert?.returningCalled, true);
  const insertValues = insert?.valuesValue as Record<string, unknown>;
  assert.equal(insertValues["senderType"], "cuu");
  assert.equal(insertValues["senderUserId"], null);
  assert.equal(insertValues["kind"], "text");
  assert.equal(insertValues["seq"], 1);
  assert.deepEqual(insertValues["contentJson"], inserted.contentJson);
});

test("R12 cuu message content rejects empty text and non-array citations before opening a transaction", async () => {
  const { db, queries } = createQueryRecorder();
  const repository = createConversationRepository(db);

  await assert.rejects(
    repository.createCuuMessage({
      workspaceId,
      conversationId,
      kind: "text",
      contentJson: { text: "" },
      at: now
    }),
    (error: unknown) => error instanceof ConversationRepositoryInputError
  );
  await assert.rejects(
    repository.createCuuMessage({
      workspaceId,
      conversationId,
      kind: "text",
      contentJson: { text: "ok", memory_citations: "not-an-array" as unknown as [] },
      at: now
    }),
    (error: unknown) => error instanceof ConversationRepositoryInputError
  );
  assert.equal(queries.length, 0);
});

test("R12 inaccessible conversation cannot create a cuu message", async () => {
  const { db, queries, transactions } = createQueryRecorder([[]]);

  await assert.rejects(
    createConversationRepository(db).createCuuMessage({
      workspaceId,
      conversationId,
      kind: "text",
      contentJson: { text: "hello" },
      at: now
    }),
    (error: unknown) => error instanceof ConversationAccessDeniedError
  );

  assert.deepEqual(transactions, [{ outcome: "rejected", errorName: "ConversationAccessDeniedError" }]);
  assert.equal(queries.some((query) => query.operation === "insert" || query.operation === "update"), false);
});

test("R12 cuu message rejects a wrong thread root before sequence allocation", async () => {
  const { db, queries, transactions } = createQueryRecorder([
    ...cuuMessageAccessLockResponses(),
    []
  ]);

  await assert.rejects(
    createConversationRepository(db).createCuuMessage({
      workspaceId,
      conversationId,
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

test("R12 cuu message sequence exhaustion and missing returning rows are explicit transaction errors", async () => {
  const exhausted = createQueryRecorder([
    ...cuuMessageAccessLockResponses({ nextSeq: Number.MAX_SAFE_INTEGER })
  ]);
  await assert.rejects(
    createConversationRepository(exhausted.db).createCuuMessage({
      workspaceId,
      conversationId,
      kind: "text",
      contentJson: { text: "overflow" },
      at: now
    }),
    (error: unknown) => error instanceof ConversationSequenceExhaustedError
  );
  assert.equal(exhausted.queries.some((query) => query.operation === "update"), false);

  const missingInsert = createQueryRecorder([
    ...cuuMessageAccessLockResponses(),
    [{ nextSeq: 1 }],
    []
  ]);
  await assert.rejects(
    createConversationRepository(missingInsert.db).createCuuMessage({
      workspaceId,
      conversationId,
      kind: "text",
      contentJson: { text: "missing insert" },
      at: now
    }),
    (error: unknown) => error instanceof ConversationMessageInsertFailedError
  );
});

test("R13 G1 collab creation defaults cuu_enabled to true and honors an explicit false", async () => {
  const defaultCreated = conversation({ id: "13000000-0000-4000-8000-000000000021" });
  const defaultRecorder = createQueryRecorder([
    [{ projectId, projectOwnerUserId: creatorUserId }],
    [creatorMembershipLockRow],
    [defaultCreated],
    [participant(creatorUserId, "owner")]
  ]);
  await createConversationRepository(defaultRecorder.db).createCollab({
    id: "13000000-0000-4000-8000-000000000021",
    workspaceId,
    projectId,
    creatorUserId,
    title: "协作区",
    visibility: "private",
    participantUserIds: [],
    at: now
  });
  const defaultInsert = defaultRecorder.queries[2];
  assert.equal(defaultInsert?.targetTable, projectConversations);
  assert.equal((defaultInsert?.valuesValue as Record<string, unknown>)["cuuEnabled"], true);

  const disabledCreated = conversation({ id: "13000000-0000-4000-8000-000000000022", cuuEnabled: false });
  const disabledRecorder = createQueryRecorder([
    [{ projectId, projectOwnerUserId: creatorUserId }],
    [creatorMembershipLockRow],
    [disabledCreated],
    [participant(creatorUserId, "owner")]
  ]);
  const disabledResult = await createConversationRepository(disabledRecorder.db).createCollab({
    id: "13000000-0000-4000-8000-000000000022",
    workspaceId,
    projectId,
    creatorUserId,
    title: "协作区",
    visibility: "private",
    participantUserIds: [],
    cuuEnabled: false,
    at: now
  });
  const disabledInsert = disabledRecorder.queries[2];
  assert.equal((disabledInsert?.valuesValue as Record<string, unknown>)["cuuEnabled"], false);
  assert.equal(disabledResult.conversation.cuuEnabled, false);
});

// ── R13 批4c: createCuuMessage 扩成判别联合 ──────────────────────────────────────────
// file_card/tool_note 是既有 DB kind（check 约束早就允许），只是这个方法之前只会写 text——这里断言
// 新分支落库时把 kind 如实写成对应值（不是继续硬编码 "text"），且各自的内容校验按分支生效。

test("R13 createCuuMessage persists a file_card kind and rejects malformed file card content", async () => {
  const inserted = cuuMessage(1, {
    kind: "file_card",
    contentJson: { drive_item_id: "14000000-0000-4000-8000-000000000001", snapshot_name: "合同.pdf" }
  });
  const { db, queries } = createQueryRecorder([...cuuMessageAccessLockResponses(), [{ nextSeq: 1 }], [inserted]]);

  const result = await createConversationRepository(db).createCuuMessage({
    workspaceId,
    conversationId,
    kind: "file_card",
    contentJson: { drive_item_id: "14000000-0000-4000-8000-000000000001", snapshot_name: "合同.pdf" },
    at: now
  });

  assert.deepEqual(result, inserted);
  const insert = queries[4];
  const insertValues = insert?.valuesValue as Record<string, unknown>;
  assert.equal(insertValues["kind"], "file_card");
  assert.equal(insertValues["senderType"], "cuu");

  const repository = createConversationRepository(createQueryRecorder().db);
  await assert.rejects(
    repository.createCuuMessage({
      workspaceId,
      conversationId,
      kind: "file_card",
      contentJson: { drive_item_id: "", snapshot_name: "合同.pdf" },
      at: now
    }),
    (error: unknown) => error instanceof ConversationRepositoryInputError
  );
});

test("R13 createCuuMessage persists a tool_note kind and rejects a non-object content payload", async () => {
  const inserted = cuuMessage(1, { kind: "tool_note", contentJson: { tool: "drive_search", summary: "检索“合同”，命中 2 条" } });
  const { db, queries } = createQueryRecorder([...cuuMessageAccessLockResponses(), [{ nextSeq: 1 }], [inserted]]);

  const result = await createConversationRepository(db).createCuuMessage({
    workspaceId,
    conversationId,
    kind: "tool_note",
    contentJson: { tool: "drive_search", summary: "检索“合同”，命中 2 条" },
    at: now
  });

  assert.deepEqual(result, inserted);
  const insert = queries[4];
  const insertValues = insert?.valuesValue as Record<string, unknown>;
  assert.equal(insertValues["kind"], "tool_note");

  const repository = createConversationRepository(createQueryRecorder().db);
  await assert.rejects(
    repository.createCuuMessage({
      workspaceId,
      conversationId,
      kind: "tool_note",
      contentJson: ["not", "an", "object"] as unknown as Record<string, unknown>,
      at: now
    }),
    (error: unknown) => error instanceof ConversationRepositoryInputError
  );
});

test("R13 createCuuMessage accepts the additive clarifying-question markers on the text kind", async () => {
  const inserted = cuuMessage(1, {
    contentJson: { text: "你要 PPT 还是 Word？", is_clarifying_question: true, clarify_options: ["PPT", "Word"] }
  });
  const { db } = createQueryRecorder([...cuuMessageAccessLockResponses(), [{ nextSeq: 1 }], [inserted]]);

  const result = await createConversationRepository(db).createCuuMessage({
    workspaceId,
    conversationId,
    kind: "text",
    contentJson: { text: "你要 PPT 还是 Word？", is_clarifying_question: true, clarify_options: ["PPT", "Word"] },
    at: now
  });

  assert.deepEqual(result, inserted);
});

// ── R13 批4c/G1: listReplyJudgeCandidates ────────────────────────────────────────────

test("R13 listReplyJudgeCandidates rejects an out-of-range limit before querying", async () => {
  const { db, queries } = createQueryRecorder();
  await assert.rejects(
    createConversationRepository(db).listReplyJudgeCandidates({ limit: 0, sinceCreatedAt: now }),
    (error: unknown) => error instanceof ConversationRepositoryInputError
  );
  await assert.rejects(
    createConversationRepository(db).listReplyJudgeCandidates({ limit: 101, sinceCreatedAt: now }),
    (error: unknown) => error instanceof ConversationRepositoryInputError
  );
  assert.equal(queries.length, 0);
});

test("R13 listReplyJudgeCandidates returns an empty list without a second query when no group has a recent message", async () => {
  const { db, queries } = createQueryRecorder([[]]);
  const result = await createConversationRepository(db).listReplyJudgeCandidates({ limit: 20, sinceCreatedAt: now });
  assert.deepEqual(result, []);
  assert.equal(queries.length, 1);
});

test("R13 listReplyJudgeCandidates joins each candidate group to its own latest human message via one bounded IN query", async () => {
  const otherConversationId = "13000000-0000-4000-8000-000000000012";
  const groups = [
    { conversationId, workspaceId, projectId, participantCount: 3 },
    { conversationId: otherConversationId, workspaceId, projectId, participantCount: 2 }
  ];
  // 每个会话各两条候选人类消息，倒序返回（seq 大的在前）——归并逻辑必须只留每个会话遇到的第一条
  // （也就是 seq 最大的那条），忽略同会话里更旧的第二条。
  const recentMessages = [
    { conversationId, id: "13000000-0000-4000-8000-000000000020", seq: 5, senderUserId: memberUserId, kind: "text", contentJson: { text: "帮我建个工单" }, createdAt: now },
    { conversationId, id: "13000000-0000-4000-8000-000000000019", seq: 4, senderUserId: memberUserId, kind: "text", contentJson: { text: "较早的一条" }, createdAt: now },
    { conversationId: otherConversationId, id: "13000000-0000-4000-8000-000000000021", seq: 2, senderUserId: secondMemberUserId, kind: "text", contentJson: { text: "在的" }, createdAt: now }
  ];
  const { db, queries } = createQueryRecorder([groups, recentMessages]);

  const result = await createConversationRepository(db).listReplyJudgeCandidates({ limit: 20, sinceCreatedAt: now });

  assert.equal(queries.length, 2);
  assert.deepEqual(result, [
    {
      conversationId,
      workspaceId,
      projectId,
      participantCount: 3,
      lastMessageId: "13000000-0000-4000-8000-000000000020",
      lastMessageSeq: 5,
      lastMessageSenderUserId: memberUserId,
      lastMessageKind: "text",
      lastMessageContentJson: { text: "帮我建个工单" },
      lastMessageCreatedAt: now
    },
    {
      conversationId: otherConversationId,
      workspaceId,
      projectId,
      participantCount: 2,
      lastMessageId: "13000000-0000-4000-8000-000000000021",
      lastMessageSeq: 2,
      lastMessageSenderUserId: secondMemberUserId,
      lastMessageKind: "text",
      lastMessageContentJson: { text: "在的" },
      lastMessageCreatedAt: now
    }
  ]);
});

test("R13 listReplyJudgeCandidates drops a group whose latest human message could not be resolved in the second query", async () => {
  const groups = [{ conversationId, workspaceId, projectId, participantCount: 3 }];
  const { db } = createQueryRecorder([groups, []]);
  const result = await createConversationRepository(db).listReplyJudgeCandidates({ limit: 20, sinceCreatedAt: now });
  assert.deepEqual(result, []);
});
