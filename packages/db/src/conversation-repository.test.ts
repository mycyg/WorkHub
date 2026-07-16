import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  ConversationAccessDeniedError,
  ConversationDmTargetError,
  ConversationInsertFailedError,
  ConversationLastParticipantError,
  ConversationNotGroupError,
  ConversationParticipantCapError,
  ConversationParticipantNotFoundError,
  ConversationMessageActorMismatchError,
  ConversationMessageDeletedError,
  ConversationMessageEditWindowError,
  ConversationMessageInsertFailedError,
  ConversationMessageNotFoundError,
  ConversationMessageNotTextError,
  ConversationParentAccessError,
  ConversationParticipantInsertFailedError,
  ConversationParticipantMembershipError,
  ConversationReplyTargetError,
  ConversationRepositoryInputError,
  ConversationSequenceAllocationError,
  ConversationSequenceExhaustedError,
  ConversationSourceMessageMismatchError,
  ConversationThreadRootMismatchError,
  createConversationRepository,
  normalizeDmKey,
  type ConversationAccessRecord,
  type ConversationMessageRow,
  type ConversationParticipantRow,
  type ConversationRow
} from "./repositories/conversations.js";
import {
  conversationMessages,
  conversationParticipants,
  conversationReadCursors,
  messageReactions,
  projectConversations,
  projects,
  users,
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
    // R15 批 B：project_conversations 加了 dm_key 列——默认 null（普通会话），DM 用例按需 override。
    dmKey: null,
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
    // R14 批 CHAT：conversation_messages 新增六列（全部 nullable）——fixture 默认「未编辑/未删除/无引用/
    // 未置顶」，各方法测试按需 override。
    editedAt: null,
    deletedAt: null,
    deletedByUserId: null,
    replyToMessageId: null,
    pinnedAt: null,
    pinnedByUserId: null,
    createdAt: now,
    ...overrides
  };
}

function accessRecord(overrides: Partial<ConversationAccessRecord> = {}): ConversationAccessRecord {
  return {
    conversation: conversation(),
    projectOwnerUserId: creatorUserId,
    projectIsPersonal: false,
    // R16 批 W4a：projects 加了 instructions_md/is_dm_container 的显式投影——机械补齐（默认空/非容器）。
    projectInstructionsMd: null,
    projectIsDmContainer: false,
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

// R16 批 W4a（项目级自定义指令）：projects.instructions_md / projects.is_dm_container 必须显式投影——
// 同 projectIsPersonal 当初的教训（见 ConversationAccessRecord 顶部注释），不加进 readVisibleAccess 的
// select，conversation-turns.ts 读到的这两个字段运行时就是 undefined，注入判定悄悄失效。
test("R16 W4a findVisibleAccessRecord projects instructions_md and is_dm_container and returns them on the record", async () => {
  const row = accessRecord({
    projectInstructionsMd: "遇到发布相关的工单，先问一句要不要拉发布负责人。",
    projectIsDmContainer: false
  });
  const { db, queries } = createQueryRecorder([[row]]);

  const result = await createConversationRepository(db).findVisibleAccessRecord({
    workspaceId,
    viewerUserId: creatorUserId,
    conversationId
  });

  assert.equal(result?.projectInstructionsMd, "遇到发布相关的工单，先问一句要不要拉发布负责人。");
  assert.equal(result?.projectIsDmContainer, false);
  assert.ok(queryReferences(queries[0]?.selection, projects.instructionsMd), "select must project projects.instructions_md");
  assert.ok(queryReferences(queries[0]?.selection, projects.isDmContainer), "select must project projects.is_dm_container");
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
    editedAt: null,
    deletedAt: null,
    deletedByUserId: null,
    replyToMessageId: null,
    pinnedAt: null,
    pinnedByUserId: null,
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

  // R14 批 CHAT（下游墓碑过滤）：两条查询（候选分组 + 最新人类消息归并）都必须带 deleted_at is null——
  // 判定器不能被拉去回应一条已删的尾消息。
  assert.ok(referencesAny(queries[0], conversationMessages.deletedAt), "group query must filter tombstones");
  assert.ok(queryReferences(queries[1]?.where, conversationMessages.deletedAt), "recent-message query must filter tombstones");
});

test("R13 listReplyJudgeCandidates drops a group whose latest human message could not be resolved in the second query", async () => {
  const groups = [{ conversationId, workspaceId, projectId, participantCount: 3 }];
  const { db } = createQueryRecorder([groups, []]);
  const result = await createConversationRepository(db).listReplyJudgeCandidates({ limit: 20, sinceCreatedAt: now });
  assert.deepEqual(result, []);
});

// ── R14 批 CHAT：编辑 / 墓碑删除 / 置顶 / reaction / 已读游标 ─────────────────────────────
// lockActiveMessage 用 `.select({ message: conversationMessages })`，故行的 recorder 响应形状是
// `[{ message: <row> }]`（与 createUserMessage 那些 `[{ projectId }]` 平级）。

const editWindowMs = 15 * 60 * 1000;

function messageLock(row: ConversationMessageRow) {
  return [{ message: row }];
}

test("R14 editMessage rewrites text and stamps edited_at inside one locked transaction", async () => {
  const original = message(1);
  const updated = message(1, { contentJson: { text: "改好了" }, editedAt: now });
  const { db, queries, transactions } = createQueryRecorder([messageLock(original), [updated]]);

  const result = await createConversationRepository(db).editMessage({
    workspaceId,
    conversationId,
    messageId: original.id,
    editorUserId: creatorUserId,
    text: "改好了",
    editWindowMs,
    at: now
  });

  assert.deepEqual(result, updated);
  assert.deepEqual(transactions, [{ outcome: "resolved" }]);
  // 消息锁在会话活跃性之下、锁的是 conversation_messages 行。
  assert.equal(queries[0]?.fromTable, conversationMessages);
  assert.equal(queries[0]?.lock, "update");
  assert.ok(queryReferences(queries[0]?.where, conversationMessages.id));
  assert.ok(
    queries[0]?.joins.some((join) => join.table === projectConversations),
    "message lock must join the owning conversation for tenant safety"
  );
  const update = queries[1];
  assert.equal(update?.operation, "update");
  assert.equal(update?.targetTable, conversationMessages);
  assert.equal(update?.returningCalled, true);
  const setValue = update?.setValue as Record<string, unknown>;
  assert.deepEqual(setValue["contentJson"], { text: "改好了" });
  assert.equal(setValue["editedAt"], now);
});

test("R14 editMessage refuses a message the actor did not send", async () => {
  const foreign = message(1, { senderUserId: secondMemberUserId });
  const { db, transactions } = createQueryRecorder([messageLock(foreign)]);
  await assert.rejects(
    createConversationRepository(db).editMessage({
      workspaceId,
      conversationId,
      messageId: foreign.id,
      editorUserId: creatorUserId,
      text: "别人的消息",
      editWindowMs,
      at: now
    }),
    (error: unknown) => error instanceof ConversationMessageActorMismatchError
  );
  assert.deepEqual(transactions, [{ outcome: "rejected", errorName: "ConversationMessageActorMismatchError" }]);
});

test("R14 editMessage refuses a Cuu message (sender_type != user) as a non-owner", async () => {
  const cuu = cuuMessage(1);
  const { db } = createQueryRecorder([messageLock(cuu)]);
  await assert.rejects(
    createConversationRepository(db).editMessage({
      workspaceId,
      conversationId,
      messageId: cuu.id,
      editorUserId: creatorUserId,
      text: "改 Cuu 的话",
      editWindowMs,
      at: now
    }),
    (error: unknown) => error instanceof ConversationMessageActorMismatchError
  );
});

test("R14 editMessage rejects an expired 15-minute window", async () => {
  const stale = message(1, { createdAt: new Date(now.getTime() - editWindowMs - 1000) });
  const { db } = createQueryRecorder([messageLock(stale)]);
  await assert.rejects(
    createConversationRepository(db).editMessage({
      workspaceId,
      conversationId,
      messageId: stale.id,
      editorUserId: creatorUserId,
      text: "太晚了",
      editWindowMs,
      at: now
    }),
    (error: unknown) => error instanceof ConversationMessageEditWindowError
  );
});

test("R14 editMessage rejects a non-text (file_card) message with a distinct error", async () => {
  const fileCard = message(1, {
    kind: "file_card",
    contentJson: { drive_item_id: "53000000-0000-4000-8000-0000000000f1", snapshot_name: "brief.docx" }
  });
  const { db } = createQueryRecorder([messageLock(fileCard)]);
  await assert.rejects(
    createConversationRepository(db).editMessage({
      workspaceId,
      conversationId,
      messageId: fileCard.id,
      editorUserId: creatorUserId,
      text: "改文件卡",
      editWindowMs,
      at: now
    }),
    (error: unknown) => error instanceof ConversationMessageNotTextError
  );
});

test("R14 editMessage rejects editing an already-deleted tombstone", async () => {
  const tombstone = message(1, { deletedAt: now, deletedByUserId: creatorUserId, contentJson: {} });
  const { db } = createQueryRecorder([messageLock(tombstone)]);
  await assert.rejects(
    createConversationRepository(db).editMessage({
      workspaceId,
      conversationId,
      messageId: tombstone.id,
      editorUserId: creatorUserId,
      text: "改墓碑",
      editWindowMs,
      at: now
    }),
    (error: unknown) => error instanceof ConversationMessageDeletedError
  );
});

test("R14 editMessage 404s when the message is missing from the active conversation", async () => {
  const { db } = createQueryRecorder([[]]);
  await assert.rejects(
    createConversationRepository(db).editMessage({
      workspaceId,
      conversationId,
      messageId: message(1).id,
      editorUserId: creatorUserId,
      text: "无此消息",
      editWindowMs,
      at: now
    }),
    (error: unknown) => error instanceof ConversationMessageNotFoundError
  );
});

test("R14 deleteMessage tombstones own message: clears content, sets deleted, drops pin", async () => {
  const pinned = message(1, { pinnedAt: now, pinnedByUserId: creatorUserId });
  const tombstone = message(1, { deletedAt: now, deletedByUserId: creatorUserId, contentJson: {}, pinnedAt: null, pinnedByUserId: null });
  const { db, queries, transactions } = createQueryRecorder([messageLock(pinned), [tombstone]]);

  const result = await createConversationRepository(db).deleteMessage({
    workspaceId,
    conversationId,
    messageId: pinned.id,
    deleterUserId: creatorUserId,
    at: now
  });

  assert.deepEqual(result, tombstone);
  assert.deepEqual(transactions, [{ outcome: "resolved" }]);
  const setValue = queries[1]?.setValue as Record<string, unknown>;
  assert.equal(setValue["deletedAt"], now);
  assert.equal(setValue["deletedByUserId"], creatorUserId);
  assert.deepEqual(setValue["contentJson"], {});
  assert.equal(setValue["pinnedAt"], null);
  assert.equal(setValue["pinnedByUserId"], null);
});

test("R14 deleteMessage is idempotent: re-deleting a tombstone returns current state without an update", async () => {
  const tombstone = message(1, { deletedAt: now, deletedByUserId: creatorUserId, contentJson: {} });
  const { db, queries, transactions } = createQueryRecorder([messageLock(tombstone)]);

  const result = await createConversationRepository(db).deleteMessage({
    workspaceId,
    conversationId,
    messageId: tombstone.id,
    deleterUserId: creatorUserId,
    at: now
  });

  assert.deepEqual(result, tombstone);
  assert.deepEqual(transactions, [{ outcome: "resolved" }]);
  assert.equal(queries.length, 1);
  assert.equal(queries.some((query) => query.operation === "update"), false);
});

test("R14 deleteMessage refuses to tombstone a message the actor did not send", async () => {
  const foreign = message(1, { senderUserId: secondMemberUserId });
  const { db } = createQueryRecorder([messageLock(foreign)]);
  await assert.rejects(
    createConversationRepository(db).deleteMessage({
      workspaceId,
      conversationId,
      messageId: foreign.id,
      deleterUserId: creatorUserId,
      at: now
    }),
    (error: unknown) => error instanceof ConversationMessageActorMismatchError
  );
});

test("R14 pinMessage stamps pinned_at/by; unpinMessage clears them; both are tenant-locked", async () => {
  const plain = message(1);
  const pinned = message(1, { pinnedAt: now, pinnedByUserId: memberUserId });
  const pinRecorder = createQueryRecorder([messageLock(plain), [pinned]]);
  const pinResult = await createConversationRepository(pinRecorder.db).pinMessage({
    workspaceId,
    conversationId,
    messageId: plain.id,
    pinnerUserId: memberUserId,
    at: now
  });
  assert.deepEqual(pinResult, pinned);
  const pinSet = pinRecorder.queries[1]?.setValue as Record<string, unknown>;
  assert.equal(pinSet["pinnedAt"], now);
  assert.equal(pinSet["pinnedByUserId"], memberUserId);

  const unpinned = message(1, { pinnedAt: null, pinnedByUserId: null });
  const unpinRecorder = createQueryRecorder([messageLock(pinned), [unpinned]]);
  const unpinResult = await createConversationRepository(unpinRecorder.db).unpinMessage({
    workspaceId,
    conversationId,
    messageId: pinned.id,
    at: now
  });
  assert.deepEqual(unpinResult, unpinned);
  const unpinSet = unpinRecorder.queries[1]?.setValue as Record<string, unknown>;
  assert.equal(unpinSet["pinnedAt"], null);
  assert.equal(unpinSet["pinnedByUserId"], null);
});

test("R14 pinMessage refuses a deleted message; unpin/pin are idempotent no-ops", async () => {
  const tombstone = message(1, { deletedAt: now, contentJson: {} });
  const pinDeleted = createQueryRecorder([messageLock(tombstone)]);
  await assert.rejects(
    createConversationRepository(pinDeleted.db).pinMessage({
      workspaceId,
      conversationId,
      messageId: tombstone.id,
      pinnerUserId: memberUserId,
      at: now
    }),
    (error: unknown) => error instanceof ConversationMessageDeletedError
  );

  const alreadyPinned = message(1, { pinnedAt: now, pinnedByUserId: creatorUserId });
  const pinAgain = createQueryRecorder([messageLock(alreadyPinned)]);
  const pinResult = await createConversationRepository(pinAgain.db).pinMessage({
    workspaceId,
    conversationId,
    messageId: alreadyPinned.id,
    pinnerUserId: memberUserId,
    at: now
  });
  assert.deepEqual(pinResult, alreadyPinned);
  assert.equal(pinAgain.queries.some((query) => query.operation === "update"), false);

  const notPinned = message(1);
  const unpinNoop = createQueryRecorder([messageLock(notPinned)]);
  const unpinResult = await createConversationRepository(unpinNoop.db).unpinMessage({
    workspaceId,
    conversationId,
    messageId: notPinned.id,
    at: now
  });
  assert.deepEqual(unpinResult, notPinned);
  assert.equal(unpinNoop.queries.some((query) => query.operation === "update"), false);
});

test("R14 addReaction inserts idempotently and returns the full canonical-order aggregate", async () => {
  const target = message(1);
  const { db, queries, transactions } = createQueryRecorder([
    messageLock(target),
    [],
    [
      { reactionKey: "done", userIds: [memberUserId] },
      { reactionKey: "approve", userIds: [creatorUserId, memberUserId] }
    ]
  ]);

  const result = await createConversationRepository(db).addReaction({
    workspaceId,
    conversationId,
    messageId: target.id,
    userId: memberUserId,
    reactionKey: "approve",
    at: now
  });

  // 输出按规范键序（approve 先于 done），不按 DB 返回顺序。
  assert.deepEqual(result, {
    reactions: [
      { key: "approve", userIds: [creatorUserId, memberUserId] },
      { key: "done", userIds: [memberUserId] }
    ]
  });
  assert.deepEqual(transactions, [{ outcome: "resolved" }]);
  const insert = queries[1];
  assert.equal(insert?.operation, "insert");
  assert.equal(insert?.targetTable, messageReactions);
  assert.ok(insert?.steps.includes("onConflictDoNothing"), "reaction insert must be idempotent");
  const aggregate = queries[2];
  assert.equal(aggregate?.fromTable, messageReactions);
  assert.ok((aggregate?.groupBy.length ?? 0) > 0, "aggregate must group by reaction key");
});

test("R14 addReaction refuses to react to a deleted message", async () => {
  const tombstone = message(1, { deletedAt: now, contentJson: {} });
  const { db } = createQueryRecorder([messageLock(tombstone)]);
  await assert.rejects(
    createConversationRepository(db).addReaction({
      workspaceId,
      conversationId,
      messageId: tombstone.id,
      userId: memberUserId,
      reactionKey: "approve",
      at: now
    }),
    (error: unknown) => error instanceof ConversationMessageDeletedError
  );
});

test("R14 removeReaction deletes the row and returns the recomputed aggregate", async () => {
  const target = message(1);
  const { db, queries } = createQueryRecorder([
    messageLock(target),
    [],
    [{ reactionKey: "approve", userIds: [creatorUserId] }]
  ]);

  const result = await createConversationRepository(db).removeReaction({
    workspaceId,
    conversationId,
    messageId: target.id,
    userId: memberUserId,
    reactionKey: "approve",
    at: now
  });

  assert.deepEqual(result, { reactions: [{ key: "approve", userIds: [creatorUserId] }] });
  const del = queries[1];
  assert.equal(del?.operation, "delete");
  assert.equal(del?.targetTable, messageReactions);
});

test("R14 addReaction rejects an unknown reaction key before touching the database", async () => {
  const { db, queries } = createQueryRecorder([]);
  await assert.rejects(
    createConversationRepository(db).addReaction({
      workspaceId,
      conversationId,
      messageId: message(1).id,
      userId: memberUserId,
      reactionKey: "celebrate" as never,
      at: now
    }),
    (error: unknown) => error instanceof ConversationRepositoryInputError
  );
  assert.equal(queries.length, 0);
});

test("R14 advanceReadCursor clamps to conversation max seq and upserts monotonically", async () => {
  const { db, queries, transactions } = createQueryRecorder([
    [{ nextSeq: 3 }],
    [{ lastReadSeq: 3 }]
  ]);

  const result = await createConversationRepository(db).advanceReadCursor({
    workspaceId,
    conversationId,
    userId: memberUserId,
    lastReadSeq: 999,
    at: now
  });

  assert.deepEqual(result, { lastReadSeq: 3 });
  assert.deepEqual(transactions, [{ outcome: "resolved" }]);
  const upsert = queries[1];
  assert.equal(upsert?.operation, "insert");
  assert.equal(upsert?.targetTable, conversationReadCursors);
  assert.ok(upsert?.steps.includes("onConflictDoUpdate"), "read cursor must upsert on conflict");
  assert.equal(upsert?.returningCalled, true);
  // 夹紧到 3（会话最大 seq），而不是把请求里的 999 直接写进去。
  const values = upsert?.valuesValue as Record<string, unknown>;
  assert.equal(values["lastReadSeq"], 3);
  // ON CONFLICT 的 set 用 greatest(...) 保证单调不回退。
  assert.ok(
    queryTextFragments((upsert?.onConflict as { set?: { lastReadSeq?: unknown } })?.set?.lastReadSeq)
      .join("")
      .toLowerCase()
      .includes("greatest")
  );
});

test("R14 advanceReadCursor 404s when the target conversation is not active", async () => {
  const { db } = createQueryRecorder([[]]);
  await assert.rejects(
    createConversationRepository(db).advanceReadCursor({
      workspaceId,
      conversationId,
      userId: memberUserId,
      lastReadSeq: 1,
      at: now
    }),
    (error: unknown) => error instanceof ConversationAccessDeniedError
  );
});

test("R14 advanceReadCursor rejects a negative or unsafe last_read_seq", async () => {
  const { db } = createQueryRecorder([]);
  await assert.rejects(
    createConversationRepository(db).advanceReadCursor({
      workspaceId,
      conversationId,
      userId: memberUserId,
      lastReadSeq: -1,
      at: now
    }),
    (error: unknown) => error instanceof ConversationRepositoryInputError
  );
});

test("R14FIX renameConversation writes a trimmed title inside the tenant fence and returns the row", async () => {
  const renamedRow = conversation({ title: "改第三幕", updatedAt: new Date("2026-07-15T09:00:00.000Z") });
  const { db, queries } = createQueryRecorder([[renamedRow]]);

  const result = await createConversationRepository(db).renameConversation({
    workspaceId,
    conversationId,
    title: "  改第三幕  ",
    at: now
  });

  assert.equal(result.title, "改第三幕");
  const update = queries[0];
  assert.equal(update?.operation, "update");
  assert.equal(update?.targetTable, projectConversations);
  assert.equal(update?.returningCalled, true);
  const setValue = update?.setValue as Record<string, unknown>;
  // 前后空白被 trim 掉再落库。
  assert.equal(setValue["title"], "改第三幕");
  // 租户 + 未删除围栏（workspaceId + id + deletedAt IS NULL）。
  for (const column of [projectConversations.id, projectConversations.workspaceId, projectConversations.deletedAt]) {
    assert.ok(queryReferences(update?.where, column), "rename must fence on tenant + id + not-deleted");
  }
});

test("R14FIX renameConversation 404s (ConversationAccessDeniedError) when no active row matches", async () => {
  const { db } = createQueryRecorder([[]]);
  await assert.rejects(
    createConversationRepository(db).renameConversation({
      workspaceId,
      conversationId,
      title: "改名",
      at: now
    }),
    (error: unknown) => error instanceof ConversationAccessDeniedError
  );
});

test("R14FIX renameConversation rejects an empty or too-long title before any write", async () => {
  const { db, queries } = createQueryRecorder([]);
  for (const title of ["", "   ", "x".repeat(257)]) {
    await assert.rejects(
      createConversationRepository(db).renameConversation({ workspaceId, conversationId, title, at: now }),
      (error: unknown) => error instanceof ConversationRepositoryInputError
    );
  }
  assert.equal(queries.length, 0);
});

// ── R15 批 cuu-toggle：会话级 Cuu 开关翻转 + 参与者列表 ─────────────────────────────────

test("R15 updateCuuEnabled writes only cuu_enabled inside the tenant fence and returns the flipped row", async () => {
  const flippedRow = conversation({ cuuEnabled: false, updatedAt: new Date("2026-07-15T09:00:00.000Z") });
  const { db, queries } = createQueryRecorder([[flippedRow]]);

  const result = await createConversationRepository(db).updateCuuEnabled({
    workspaceId,
    conversationId,
    enabled: false,
    at: now
  });

  assert.equal(result.cuuEnabled, false);
  const update = queries[0];
  assert.equal(update?.operation, "update");
  assert.equal(update?.targetTable, projectConversations);
  assert.equal(update?.returningCalled, true);
  const setValue = update?.setValue as Record<string, unknown>;
  assert.equal(setValue["cuuEnabled"], false);
  assert.equal(setValue["updatedAt"], now);
  // 租户 + 未删除围栏（workspaceId + id + deletedAt IS NULL），同 renameConversation 的既有围栏。
  for (const column of [projectConversations.id, projectConversations.workspaceId, projectConversations.deletedAt]) {
    assert.ok(queryReferences(update?.where, column), "cuu toggle must fence on tenant + id + not-deleted");
  }
});

test("R15 updateCuuEnabled re-flipping to the same value is still a plain update (idempotent, no special-casing)", async () => {
  const sameRow = conversation({ cuuEnabled: true, updatedAt: now });
  const { db, queries } = createQueryRecorder([[sameRow]]);

  const result = await createConversationRepository(db).updateCuuEnabled({
    workspaceId,
    conversationId,
    enabled: true,
    at: now
  });

  assert.equal(result.cuuEnabled, true);
  assert.equal(queries.length, 1);
  assert.equal(queries[0]?.operation, "update");
});

test("R15 updateCuuEnabled 404s (ConversationAccessDeniedError) when no active row matches", async () => {
  const { db } = createQueryRecorder([[]]);
  await assert.rejects(
    createConversationRepository(db).updateCuuEnabled({ workspaceId, conversationId, enabled: true, at: now }),
    (error: unknown) => error instanceof ConversationAccessDeniedError
  );
});

test("R15 listParticipantsWithNickname joins active users, filters by conversation, and caps at 100", async () => {
  const { db, queries } = createQueryRecorder([
    [
      { userId: creatorUserId, nickname: "阿曼", role: "owner" },
      { userId: memberUserId, nickname: "小赵", role: "member" }
    ]
  ]);

  const result = await createConversationRepository(db).listParticipantsWithNickname({ conversationId });

  assert.deepEqual(result, [
    { userId: creatorUserId, nickname: "阿曼", role: "owner" },
    { userId: memberUserId, nickname: "小赵", role: "member" }
  ]);
  const query = queries[0];
  assert.equal(query?.fromTable, conversationParticipants);
  assert.ok(
    query?.joins.some((join) => join.table === users),
    "participants list must join users for nicknames"
  );
  assert.ok(queryReferences(query?.where, conversationParticipants.conversationId));
  assert.equal(query?.limit, 100);
});

test("R14 listReceipts is tenant-joined, ordered, and capped", async () => {
  const { db, queries } = createQueryRecorder([
    [
      { userId: creatorUserId, lastReadSeq: 5 },
      { userId: memberUserId, lastReadSeq: 2 }
    ]
  ]);

  const result = await createConversationRepository(db).listReceipts({ workspaceId, conversationId });

  assert.deepEqual(result, [
    { userId: creatorUserId, lastReadSeq: 5 },
    { userId: memberUserId, lastReadSeq: 2 }
  ]);
  assert.equal(queries[0]?.fromTable, conversationReadCursors);
  assert.ok(
    queries[0]?.joins.some((join) => join.table === projectConversations),
    "receipts must join the conversation for workspace scoping"
  );
  assert.equal(queries[0]?.limit, 500);
});

test("R14 listPins returns pinned, non-deleted messages seq-desc capped by the caller", async () => {
  const pinnedRow = message(4, { pinnedAt: now, pinnedByUserId: creatorUserId });
  const { db, queries } = createQueryRecorder([[pinnedRow]]);

  const result = await createConversationRepository(db).listPins({ workspaceId, conversationId, limit: 50 });

  assert.deepEqual(result, [pinnedRow]);
  assert.equal(queries[0]?.fromTable, conversationMessages);
  assert.ok(queryReferences(queries[0]?.where, conversationMessages.pinnedAt));
  assert.ok(queryReferences(queries[0]?.where, conversationMessages.deletedAt));
  assert.equal(queries[0]?.limit, 50);
});

test("R14 listReactionsForMessages groups one query and canonicalizes key order per message", async () => {
  const messageA = "33000000-0000-4000-8000-00000000000a";
  const messageB = "33000000-0000-4000-8000-00000000000b";
  const { db, queries } = createQueryRecorder([
    [
      { messageId: messageA, reactionKey: "watch", userIds: [memberUserId] },
      { messageId: messageA, reactionKey: "approve", userIds: [creatorUserId] },
      { messageId: messageB, reactionKey: "done", userIds: [creatorUserId, memberUserId] }
    ]
  ]);

  const result = await createConversationRepository(db).listReactionsForMessages({
    conversationId,
    messageIds: [messageA, messageB]
  });

  assert.deepEqual(result.get(messageA), [
    { key: "approve", userIds: [creatorUserId] },
    { key: "watch", userIds: [memberUserId] }
  ]);
  assert.deepEqual(result.get(messageB), [{ key: "done", userIds: [creatorUserId, memberUserId] }]);
  // 单条 grouped 查询，禁 N+1。
  assert.equal(queries.length, 1);
  assert.ok((queries[0]?.groupBy.length ?? 0) > 0);
});

test("R14 listReactionsForMessages short-circuits an empty id set without a query", async () => {
  const { db, queries } = createQueryRecorder([]);
  const result = await createConversationRepository(db).listReactionsForMessages({ conversationId, messageIds: [] });
  assert.equal(result.size, 0);
  assert.equal(queries.length, 0);
});

test("R14 listReplyPreviews returns target message projections in one query keyed by id", async () => {
  const targetId = "33000000-0000-4000-8000-00000000000c";
  const { db, queries } = createQueryRecorder([
    [
      {
        id: targetId,
        senderType: "user",
        senderUserId: creatorUserId,
        kind: "text",
        contentJson: { text: "原始消息" },
        deletedAt: null
      }
    ]
  ]);

  const result = await createConversationRepository(db).listReplyPreviews({
    conversationId,
    messageIds: [targetId]
  });

  assert.deepEqual(result.get(targetId), {
    id: targetId,
    senderType: "user",
    senderUserId: creatorUserId,
    kind: "text",
    contentJson: { text: "原始消息" },
    deletedAt: null
  });
  assert.equal(queries.length, 1);
  assert.ok(queryReferences(queries[0]?.where, conversationMessages.conversationId));
});

// ── R14 批 CHAT（引用回复写路径）：createUserMessage 的 reply_to 目标校验 ───────────────────
// 查询顺序：access lock 五连（messageAccessLockResponses）→ reply 目标读 → seq 分配 → 插入。

test("R14 createUserMessage stores a valid reply_to target (same conversation, not deleted)", async () => {
  const inserted = message(1, { replyToMessageId: sourceMessageId });
  const { db, queries, transactions } = createQueryRecorder([
    ...messageAccessLockResponses(),
    [{ id: sourceMessageId, deletedAt: null }],
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
    replyToMessageId: sourceMessageId,
    at: now
  });

  assert.deepEqual(result, inserted);
  assert.deepEqual(transactions, [{ outcome: "resolved" }]);
  const insert = queries.find((query) => query.operation === "insert" && query.targetTable === conversationMessages);
  assert.equal((insert?.valuesValue as Record<string, unknown>)["replyToMessageId"], sourceMessageId);
});

test("R14 createUserMessage rejects a reply to a deleted target with a 400-mapped error", async () => {
  const { db, transactions } = createQueryRecorder([
    ...messageAccessLockResponses(),
    [{ id: sourceMessageId, deletedAt: now }]
  ]);

  await assert.rejects(
    createConversationRepository(db).createUserMessage({
      workspaceId,
      conversationId,
      senderUserId: creatorUserId,
      kind: "text",
      contentJson: { text: "回复墓碑" },
      replyToMessageId: sourceMessageId,
      at: now
    }),
    (error: unknown) => error instanceof ConversationReplyTargetError
  );
  assert.deepEqual(transactions, [{ outcome: "rejected", errorName: "ConversationReplyTargetError" }]);
});

test("R14 createUserMessage rejects a reply to a target outside the conversation", async () => {
  const { db } = createQueryRecorder([
    ...messageAccessLockResponses(),
    []
  ]);

  await assert.rejects(
    createConversationRepository(db).createUserMessage({
      workspaceId,
      conversationId,
      senderUserId: creatorUserId,
      kind: "text",
      contentJson: { text: "跨会话引用" },
      replyToMessageId: sourceMessageId,
      at: now
    }),
    (error: unknown) => error instanceof ConversationReplyTargetError
  );
});

// ── R15 批 B（人对人私聊）：dm_key 归一化 + openOrCreateDm（容器惰性创建/查重/并发回退/守卫） ──

const dmContainerProjectId = "13000000-0000-4000-8000-000000000020";
const dmActorUserId = creatorUserId;
const dmTargetUserId = memberUserId;
const dmKey = normalizeDmKey(dmActorUserId, dmTargetUserId);

function dmMembershipRow(userId: string) {
  return { id: `53000000-0000-4000-8000-0000000000${userId === dmActorUserId ? "01" : "02"}`, userId };
}

test("R15 B normalizeDmKey is order-insensitive, case-insensitive, and dm-prefixed", () => {
  const [low, high] = [dmActorUserId, dmTargetUserId].sort();
  assert.equal(normalizeDmKey(dmActorUserId, dmTargetUserId), `dm:${low}:${high}`);
  // 顺序无关：交换两个 user id 得到同一个 key。
  assert.equal(normalizeDmKey(dmTargetUserId, dmActorUserId), normalizeDmKey(dmActorUserId, dmTargetUserId));
  // 大小写无关：大写输入归一到同一个 key（DB 里 user id 恒小写，这里守住调用方大小写不一致的情形）。
  assert.equal(normalizeDmKey(dmActorUserId.toUpperCase(), dmTargetUserId), normalizeDmKey(dmActorUserId, dmTargetUserId));
});

test("R15 B openOrCreateDm creates the container, dedups by dm_key, and builds a 2-person cuu-off DM", async () => {
  const createdDm = conversation({
    id: conversationId,
    projectId: dmContainerProjectId,
    kind: "collab",
    visibility: "private",
    cuuEnabled: false,
    dmKey
  });
  const { db, queries, transactions } = createQueryRecorder([
    [{ id: dmContainerProjectId }], // 容器项目 insert returning → 新建成功
    [dmMembershipRow(dmActorUserId), dmMembershipRow(dmTargetUserId)], // 双方成员锁
    [], // findDmConversationByKey → 未命中
    [createdDm], // DM 会话 insert returning
    [] // 参与者 insert（结果不使用）
  ]);

  const result = await createConversationRepository(db).openOrCreateDm({
    workspaceId,
    actorUserId: dmActorUserId,
    targetUserId: dmTargetUserId,
    at: now
  });

  assert.deepEqual(result, { conversation: createdDm, created: true });
  assert.deepEqual(transactions, [{ outcome: "resolved" }]);

  // 容器项目惰性创建：is_dm_container=true、固定命名、onConflictDoNothing 兜并发、returning。
  const containerInsert = queries[0];
  assert.equal(containerInsert?.targetTable, projects);
  assert.equal(containerInsert?.returningCalled, true);
  assert.equal((containerInsert?.valuesValue as Record<string, unknown>).isDmContainer, true);
  assert.equal((containerInsert?.valuesValue as Record<string, unknown>).name, "直达消息");
  assert.equal((containerInsert?.valuesValue as Record<string, unknown>).workspaceId, workspaceId);
  assert.ok(containerInsert?.onConflict, "container insert must be conflict-safe for concurrent lazy creation");

  // 双方成员锁：share 锁、workspace 过滤。
  const membershipLock = queries[1];
  assert.equal(membershipLock?.fromTable, workspaceMemberships);
  assert.equal(membershipLock?.lock, "share");

  // 查重查询锁定在容器项目 + dm_key。
  const findDm = queries[2];
  assert.equal(findDm?.fromTable, projectConversations);
  assert.ok(queryReferences(findDm?.where, projectConversations.dmKey));
  assert.ok(queryReferences(findDm?.where, projectConversations.projectId));
  assert.ok(queryParamValues(findDm?.where).includes(dmKey));

  // DM 会话 insert：kind=collab、cuu_enabled=false、dm_key、容器项目内、部分唯一索引冲突安全。
  const dmInsert = queries[3];
  assert.equal(dmInsert?.targetTable, projectConversations);
  assert.equal(dmInsert?.returningCalled, true);
  const dmValues = dmInsert?.valuesValue as Record<string, unknown>;
  assert.equal(dmValues.kind, "collab");
  assert.equal(dmValues.cuuEnabled, false);
  assert.equal(dmValues.dmKey, dmKey);
  assert.equal(dmValues.projectId, dmContainerProjectId);
  assert.ok(dmInsert?.onConflict, "dm conversation insert must be conflict-safe for concurrent double-open");

  // 固定 2 参与者：发起者 owner、对方 member。
  const participantInsert = queries[4];
  assert.equal(participantInsert?.targetTable, conversationParticipants);
  assert.deepEqual(
    (participantInsert?.valuesValue as Array<Record<string, unknown>>).map(({ userId, role }) => ({ userId, role })),
    [
      { userId: dmActorUserId, role: "owner" },
      { userId: dmTargetUserId, role: "member" }
    ]
  );
});

test("R15 B openOrCreateDm is idempotent — an existing DM is returned without a second insert", async () => {
  const existingDm = conversation({
    projectId: dmContainerProjectId,
    kind: "collab",
    cuuEnabled: false,
    dmKey
  });
  const { db, queries, transactions } = createQueryRecorder([
    [{ id: dmContainerProjectId }],
    [dmMembershipRow(dmActorUserId), dmMembershipRow(dmTargetUserId)],
    [existingDm] // findDmConversationByKey → 命中既有
  ]);

  const result = await createConversationRepository(db).openOrCreateDm({
    workspaceId,
    actorUserId: dmActorUserId,
    targetUserId: dmTargetUserId,
    at: now
  });

  assert.deepEqual(result, { conversation: existingDm, created: false });
  assert.deepEqual(transactions, [{ outcome: "resolved" }]);
  // 命中既有 → 绝不再插会话/参与者（点头像开聊不越点越多）。
  assert.equal(queries.some((query) => query.targetTable === projectConversations && query.operation === "insert"), false);
  assert.equal(queries.some((query) => query.targetTable === conversationParticipants), false);
});

test("R15 B openOrCreateDm falls back to the existing DM when a concurrent double-open loses the unique race", async () => {
  const racedDm = conversation({
    projectId: dmContainerProjectId,
    kind: "collab",
    cuuEnabled: false,
    dmKey
  });
  const { db, queries, transactions } = createQueryRecorder([
    [{ id: dmContainerProjectId }],
    [dmMembershipRow(dmActorUserId), dmMembershipRow(dmTargetUserId)],
    [], // 首次查重未命中
    [], // DM insert returning 空 → 撞唯一约束（另一发抢先建好）
    [racedDm] // 回退查询命中既有
  ]);

  const result = await createConversationRepository(db).openOrCreateDm({
    workspaceId,
    actorUserId: dmActorUserId,
    targetUserId: dmTargetUserId,
    at: now
  });

  assert.deepEqual(result, { conversation: racedDm, created: false });
  assert.deepEqual(transactions, [{ outcome: "resolved" }]);
  // 撞并发后不插参与者（避免给别人建好的会话重复挂人）。
  assert.equal(queries.some((query) => query.targetTable === conversationParticipants), false);
});

test("R15 B openOrCreateDm rejects a target who is not an active member of the workspace", async () => {
  const { db, queries, transactions } = createQueryRecorder([
    [{ id: dmContainerProjectId }],
    [dmMembershipRow(dmActorUserId)] // 只有发起者是成员，目标缺席
  ]);

  await assert.rejects(
    createConversationRepository(db).openOrCreateDm({
      workspaceId,
      actorUserId: dmActorUserId,
      targetUserId: dmTargetUserId,
      at: now
    }),
    (error: unknown) => error instanceof ConversationDmTargetError
  );

  assert.deepEqual(transactions, [{ outcome: "rejected", errorName: "ConversationDmTargetError" }]);
  assert.equal(queries.some((query) => query.targetTable === projectConversations && query.operation === "insert"), false);
});

test("R15 B openOrCreateDm rejects opening a DM with yourself before touching the database", async () => {
  const { db, queries, transactions } = createQueryRecorder([]);

  await assert.rejects(
    createConversationRepository(db).openOrCreateDm({
      workspaceId,
      actorUserId: dmActorUserId,
      targetUserId: dmActorUserId,
      at: now
    }),
    (error: unknown) => error instanceof ConversationRepositoryInputError
  );

  // 自聊在事务之前就被拦下——不开事务、不发任何查询。
  assert.deepEqual(transactions, []);
  assert.equal(queries.length, 0);
});

test("R15 B createCollab refuses to create a normal collab conversation inside a DM container project", async () => {
  const { db, queries, transactions } = createQueryRecorder([
    [{ projectId: dmContainerProjectId, projectOwnerUserId: dmActorUserId, isDmContainer: true }]
  ]);

  await assert.rejects(
    createConversationRepository(db).createCollab({
      workspaceId,
      projectId: dmContainerProjectId,
      creatorUserId: dmActorUserId,
      title: "想在容器里建群",
      visibility: "private",
      participantUserIds: [],
      at: now
    }),
    (error: unknown) => error instanceof ConversationAccessDeniedError
  );

  assert.deepEqual(transactions, [{ outcome: "rejected", errorName: "ConversationAccessDeniedError" }]);
  // 容器守卫在锁到项目后立即 fail-closed——绝不插会话/参与者。
  assert.equal(queries.some((query) => query.operation === "insert"), false);
});

// ── R15 批 A（A4/A5 未读聚合）：读游标口径的未读数聚合 + 参与者列举 ─────────────────────────
test("R15 A4 unreadCountsForViewer aggregates per-conversation in one grouped query with tombstone/self/cursor guards", async () => {
  const conversationA = "13000000-0000-4000-8000-0000000000a1";
  const conversationB = "13000000-0000-4000-8000-0000000000a2";
  const { db, queries } = createQueryRecorder([
    // 未读为 0 的会话在 GROUP BY 下不产出行——只回有未读的两条，调用方 `?? 0` 兜底其余。
    [
      { conversationId: conversationA, unread: 3 },
      { conversationId: conversationB, unread: 1 }
    ]
  ]);

  const result = await createConversationRepository(db).unreadCountsForViewer({
    viewerUserId: memberUserId,
    conversationIds: [conversationA, conversationB, conversationId]
  });

  assert.deepEqual(
    [...result.entries()].sort(),
    [
      [conversationA, 3],
      [conversationB, 1]
    ]
  );
  const query = queries[0];
  // 一条查询算齐（禁 N+1）：单 select + 左连读游标 + GROUP BY 会话。
  assert.equal(queries.length, 1);
  assert.equal(query?.operation, "select");
  assert.equal(query?.joins.length, 1);
  assert.equal(query?.joins[0]?.kind, "left");
  assert.ok((query?.groupBy.length ?? 0) > 0);
  assert.ok(queryReferences(query?.groupBy[0], conversationMessages.conversationId));
  // 墓碑不计 / 自己发的不计 / 游标缺失兜 0（coalesce）。
  assert.ok(queryReferences(query?.where, conversationMessages.deletedAt), "must filter tombstones");
  assert.ok(queryReferences(query?.where, conversationMessages.senderUserId), "must exclude own messages");
  assert.ok(queryTextFragments(query?.where).join("").includes("coalesce"), "missing cursor coalesces to 0");
});

test("R15 A4 unreadCountsForViewer short-circuits an empty conversation set without querying", async () => {
  const { db, queries } = createQueryRecorder([]);
  const result = await createConversationRepository(db).unreadCountsForViewer({
    viewerUserId: memberUserId,
    conversationIds: []
  });
  assert.equal(result.size, 0);
  assert.equal(queries.length, 0);
});

test("R15 A5 unreadCountsForRecipients aggregates per-recipient in one grouped query driven from participants", async () => {
  const { db, queries } = createQueryRecorder([
    [
      { userId: memberUserId, unread: 2 },
      { userId: secondMemberUserId, unread: 0 }
    ]
  ]);

  const result = await createConversationRepository(db).unreadCountsForRecipients({
    conversationId,
    recipientUserIds: [memberUserId, secondMemberUserId]
  });

  assert.equal(result.get(memberUserId), 2);
  assert.equal(result.get(secondMemberUserId), 0);
  const query = queries[0];
  assert.equal(queries.length, 1);
  assert.equal(query?.operation, "select");
  // 从参与者驱动（含从未读过的收件人）+ 两条左连（读游标、命中消息）。
  assert.ok(queryReferences(query?.fromTable, conversationParticipants), "must drive from participants");
  assert.equal(query?.joins.length, 2);
  assert.ok(query?.joins.every((join) => join.kind === "left"));
  assert.ok((query?.groupBy.length ?? 0) > 0);
  assert.ok(queryReferences(query?.groupBy[0], conversationParticipants.userId));
  assert.ok(queryReferences(query?.where, conversationParticipants.conversationId));
  assert.ok(queryTextFragments(query?.joins[1]?.on).join("").includes("coalesce"), "missing cursor coalesces to 0");
});

test("R15 A5 listParticipantUserIds lowercases and reads the conversation's participants with a bounded cap", async () => {
  const upperCaseUser = "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA";
  const { db, queries } = createQueryRecorder([[{ userId: upperCaseUser }, { userId: secondMemberUserId }]]);
  const result = await createConversationRepository(db).listParticipantUserIds({ conversationId });
  assert.deepEqual(result, [upperCaseUser.toLowerCase(), secondMemberUserId]);
  const query = queries[0];
  assert.ok(queryReferences(query?.where, conversationParticipants.conversationId));
  assert.equal(query?.limit, 500);
});

// ── R17 批 G1（群成员管理 · #1 建群后加人 / #16 退群/移出） ─────────────────────────────────

test("R17 G1 addParticipant inserts a member into a non-dm collab and returns added=true", async () => {
  const created = participant(secondMemberUserId, "member");
  const { db, queries, transactions } = createQueryRecorder([
    [{ projectId }], // readConversationProjectId
    [conversation()], // lockActiveConversation (collab, dm_key null)
    [{ id: "43000000-0000-4000-8000-000000000009", userId: secondMemberUserId }], // lockActiveMembershipSet
    [], // existing participant (not present)
    [{ value: 2 }], // participant count
    [created] // insert returning
  ]);

  const result = await createConversationRepository(db).addParticipant({
    workspaceId,
    conversationId,
    addedUserId: secondMemberUserId.toUpperCase(),
    at: now
  });

  assert.deepEqual(result, { participant: created, added: true });
  assert.deepEqual(transactions, [{ outcome: "resolved" }]);
  const insert = queries.find((query) => query.operation === "insert");
  assert.equal(insert?.targetTable, conversationParticipants);
  assert.equal(insert?.returningCalled, true);
  const values = insert?.valuesValue as Record<string, unknown>;
  assert.equal(values.role, "member");
  assert.equal(values.userId, secondMemberUserId.toLowerCase());
});

test("R17 G1 addParticipant is idempotent — an existing participant returns added=false without inserting", async () => {
  const existing = participant(secondMemberUserId, "member");
  const { db, queries } = createQueryRecorder([
    [{ projectId }],
    [conversation()],
    [{ id: "43000000-0000-4000-8000-000000000009", userId: secondMemberUserId }],
    [existing] // existing participant present → short-circuit
  ]);

  const result = await createConversationRepository(db).addParticipant({
    workspaceId,
    conversationId,
    addedUserId: secondMemberUserId,
    at: now
  });

  assert.deepEqual(result, { participant: existing, added: false });
  assert.equal(queries.some((query) => query.operation === "insert"), false);
});

test("R17 G1 addParticipant rejects a main conversation (all-member semantics)", async () => {
  const { db, queries, transactions } = createQueryRecorder([
    [{ projectId }],
    [conversation({ kind: "main" })]
  ]);

  await assert.rejects(
    createConversationRepository(db).addParticipant({
      workspaceId,
      conversationId,
      addedUserId: secondMemberUserId,
      at: now
    }),
    (error: unknown) => error instanceof ConversationNotGroupError
  );
  assert.deepEqual(transactions, [{ outcome: "rejected", errorName: "ConversationNotGroupError" }]);
  assert.equal(queries.some((query) => query.operation === "insert"), false);
});

test("R17 G1 addParticipant rejects a dm conversation (2-person invariant)", async () => {
  const { db } = createQueryRecorder([
    [{ projectId }],
    [conversation({ dmKey: normalizeDmKey(creatorUserId, memberUserId) })]
  ]);

  await assert.rejects(
    createConversationRepository(db).addParticipant({
      workspaceId,
      conversationId,
      addedUserId: secondMemberUserId,
      at: now
    }),
    (error: unknown) => error instanceof ConversationNotGroupError
  );
});

test("R17 G1 addParticipant rejects a target that is not an active workspace member", async () => {
  const { db } = createQueryRecorder([
    [{ projectId }],
    [conversation()],
    [] // membership lock returns nothing → not a member
  ]);

  await assert.rejects(
    createConversationRepository(db).addParticipant({
      workspaceId,
      conversationId,
      addedUserId: secondMemberUserId,
      at: now
    }),
    (error: unknown) => error instanceof ConversationParticipantMembershipError
  );
});

test("R17 G1 addParticipant rejects once the participant cap (100) is reached", async () => {
  const { db } = createQueryRecorder([
    [{ projectId }],
    [conversation()],
    [{ id: "43000000-0000-4000-8000-000000000009", userId: secondMemberUserId }],
    [], // not an existing participant
    [{ value: 100 }] // already at cap
  ]);

  await assert.rejects(
    createConversationRepository(db).addParticipant({
      workspaceId,
      conversationId,
      addedUserId: secondMemberUserId,
      at: now
    }),
    (error: unknown) => error instanceof ConversationParticipantCapError
  );
});

test("R17 G1 removeParticipant lets a plain member leave without promoting a new owner", async () => {
  const owner = participant(creatorUserId, "owner");
  const leaving = participant(memberUserId, "member");
  const { db, queries, transactions } = createQueryRecorder([
    [{ projectId }],
    [conversation()],
    [owner, leaving], // participants lock (createdAt asc)
    [] // delete target
  ]);

  const result = await createConversationRepository(db).removeParticipant({
    workspaceId,
    conversationId,
    targetUserId: memberUserId,
    at: now
  });

  assert.deepEqual(result, { removed: true, newOwnerUserId: null });
  assert.deepEqual(transactions, [{ outcome: "resolved" }]);
  assert.equal(queries.some((query) => query.operation === "update"), false, "no owner handover for a member leaving");
  const del = queries.find((query) => query.operation === "delete");
  assert.equal(del?.targetTable, conversationParticipants);
});

test("R17 G1 removeParticipant promotes the earliest-joined remaining participant when the owner leaves", async () => {
  const owner = participant(creatorUserId, "owner");
  const firstMember = participant(memberUserId, "member", {
    id: "23000000-0000-4000-8000-000000000041",
    createdAt: new Date("2026-07-12T09:01:00.000Z")
  });
  const secondMember = participant(secondMemberUserId, "member", {
    id: "23000000-0000-4000-8000-000000000042",
    createdAt: new Date("2026-07-12T09:02:00.000Z")
  });
  const { db, queries } = createQueryRecorder([
    [{ projectId }],
    [conversation()],
    [owner, firstMember, secondMember], // ordered createdAt asc; owner is the target below
    [], // update successor
    [] // delete target
  ]);

  const result = await createConversationRepository(db).removeParticipant({
    workspaceId,
    conversationId,
    targetUserId: creatorUserId,
    at: now
  });

  assert.deepEqual(result, { removed: true, newOwnerUserId: memberUserId });
  const update = queries.find((query) => query.operation === "update");
  assert.equal(update?.targetTable, conversationParticipants);
  assert.deepEqual(update?.setValue, { role: "owner", updatedAt: now });
});

test("R17 G1 removeParticipant refuses to remove the last remaining member", async () => {
  const soleOwner = participant(creatorUserId, "owner");
  const { db, transactions } = createQueryRecorder([
    [{ projectId }],
    [conversation()],
    [soleOwner] // only one participant
  ]);

  await assert.rejects(
    createConversationRepository(db).removeParticipant({
      workspaceId,
      conversationId,
      targetUserId: creatorUserId,
      at: now
    }),
    (error: unknown) => error instanceof ConversationLastParticipantError
  );
  assert.deepEqual(transactions, [{ outcome: "rejected", errorName: "ConversationLastParticipantError" }]);
});

test("R17 G1 removeParticipant 404s a target that is not a participant", async () => {
  const owner = participant(creatorUserId, "owner");
  const other = participant(memberUserId, "member");
  const { db } = createQueryRecorder([
    [{ projectId }],
    [conversation()],
    [owner, other]
  ]);

  await assert.rejects(
    createConversationRepository(db).removeParticipant({
      workspaceId,
      conversationId,
      targetUserId: secondMemberUserId,
      at: now
    }),
    (error: unknown) => error instanceof ConversationParticipantNotFoundError
  );
});

test("R17 G1 removeParticipant rejects main and dm conversations", async () => {
  const mainRecorder = createQueryRecorder([[{ projectId }], [conversation({ kind: "main" })]]);
  await assert.rejects(
    createConversationRepository(mainRecorder.db).removeParticipant({
      workspaceId,
      conversationId,
      targetUserId: creatorUserId,
      at: now
    }),
    (error: unknown) => error instanceof ConversationNotGroupError
  );

  const dmRecorder = createQueryRecorder([
    [{ projectId }],
    [conversation({ dmKey: normalizeDmKey(creatorUserId, memberUserId) })]
  ]);
  await assert.rejects(
    createConversationRepository(dmRecorder.db).removeParticipant({
      workspaceId,
      conversationId,
      targetUserId: creatorUserId,
      at: now
    }),
    (error: unknown) => error instanceof ConversationNotGroupError
  );
});
