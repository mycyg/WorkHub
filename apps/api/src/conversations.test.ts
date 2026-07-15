import assert from "node:assert/strict";
import test from "node:test";

import {
  ConversationAccessDeniedError,
  ConversationDmTargetError,
  ConversationParticipantMembershipError,
  ConversationParentAccessError,
  ConversationRepositoryInputError,
  ConversationSequenceExhaustedError,
  ConversationSourceMessageMismatchError,
  ConversationThreadRootMismatchError,
  type ConversationAccessRecord,
  type ConversationMessageRow,
  type ConversationParticipantRow,
  type ConversationRepository,
  type ConversationRow,
  type VisibleConversationRow
} from "@workhub/db";
import * as conversationContracts from "@workhub/contracts";
import type { CreateConversationMessageRequest, CreateConversationRequest } from "@workhub/contracts";

import type { AuthActor } from "./middleware/auth.js";
import { InternalContractError } from "./pages/output-contract.js";
import { ConversationTurnServiceError, type ConversationTurnResultVM } from "./services/conversation-turns.js";
import { DrivePageServiceError, type DrivePageService } from "./services/drive-pages.js";
import {
  ConversationServiceError,
  createConversationService,
  type ConversationMentionTriggerDeps
} from "./services/conversations.js";

const now = new Date("2026-07-12T08:30:00.123Z");
const workspaceId = "10000000-0000-4000-8000-000000000001";
const projectId = "20000000-0000-4000-8000-000000000002";
const conversationId = "30000000-0000-4000-8000-000000000003";
const parentConversationId = "30000000-0000-4000-8000-000000000004";
const messageId = "40000000-0000-4000-8000-000000000004";
const sourceMessageId = "40000000-0000-4000-8000-000000000005";
const driveItemId = "50000000-0000-4000-8000-000000000005";
const userId = "60000000-0000-4000-8000-000000000006";
const participantUserId = "60000000-0000-4000-8000-000000000007";

function actor(overrides: Partial<AuthActor> = {}): AuthActor {
  return {
    kind: "human",
    id: userId,
    label: "R12 owner",
    userId,
    isAdmin: false,
    orgId: "00000000-0000-4000-8000-000000000001",
    workspaceId,
    ...overrides
  };
}

function conversationRow(overrides: Partial<ConversationRow> = {}): ConversationRow {
  return {
    id: conversationId,
    workspaceId,
    projectId,
    kind: "collab",
    title: "重写第三节",
    parentConversationId: null,
    sourceMessageId: null,
    visibility: "private",
    nextSeq: 1,
    cuuEnabled: true,
    // R13 批 C1：默认"从未压缩过"——同 cuuEnabled 当初加进这个 fixture 的理由一致，不加就会撞上
    // ConversationRow 现在多出的两个必需字段。
    contextSummaryMd: null,
    contextSummaryThroughSeq: 0,
    // R15 批 B：project_conversations 新增 dm_key（nullable）——普通会话默认 null，DM 用例按需 override。
    dmKey: null,
    createdBy: userId,
    deletedAt: null,
    deletedByUserId: null,
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

function visibleConversationRow(overrides: Partial<VisibleConversationRow> = {}): VisibleConversationRow {
  return {
    ...conversationRow(),
    participantRole: "owner",
    ...overrides
  };
}

function participantRow(overrides: Partial<ConversationParticipantRow> = {}): ConversationParticipantRow {
  return {
    id: "61000000-0000-4000-8000-000000000001",
    conversationId,
    userId,
    role: "owner",
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

function messageRow(overrides: Partial<ConversationMessageRow> = {}): ConversationMessageRow {
  return {
    id: messageId,
    conversationId,
    seq: 1,
    senderType: "user",
    senderUserId: userId,
    kind: "text",
    contentJson: { text: "请先核对引用。" },
    threadRootId: null,
    // R14 批 CHAT：conversation_messages 新增六列（全部 nullable），fixture 默认无编辑/删除/引用/置顶。
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
    conversation: conversationRow(),
    projectOwnerUserId: userId,
    projectIsPersonal: false,
    membershipRole: "member",
    participantRole: "owner",
    participantCount: 1,
    ...overrides
  };
}

function repository(overrides: Partial<ConversationRepository> = {}): ConversationRepository {
  return {
    async listVisibleForProject() {
      throw new Error("listVisibleForProject not expected");
    },
    async findVisibleAccessRecord() {
      throw new Error("findVisibleAccessRecord not expected");
    },
    async createCollab() {
      throw new Error("createCollab not expected");
    },
    // R15 批 B：新增 openOrCreateDm（人对人私聊）——本套件按需 override，未 override 给拒绝桩。
    async openOrCreateDm() {
      throw new Error("openOrCreateDm not expected");
    },
    // R15 批 B：新增 listDmsForUser（私聊列表）——同上，按需 override。
    async listDmsForUser() {
      throw new Error("listDmsForUser not expected");
    },
    async createUserMessage() {
      throw new Error("createUserMessage not expected");
    },
    // R12 批4a：ConversationRepository 新增了 createCuuMessage（apps/api/src/services/
    // conversation-turns.ts 用），这个套件不测那条路径，同其它未测方法一样给个拒绝桩。
    async createCuuMessage() {
      throw new Error("createCuuMessage not expected");
    },
    async listMessagesAfter() {
      throw new Error("listMessagesAfter not expected");
    },
    // R12 批8：新增 listMessagesBefore（反向翻页），同其它未测方法一样给个拒绝桩。
    async listMessagesBefore() {
      throw new Error("listMessagesBefore not expected");
    },
    // R13 批4c/G1：新增 listReplyJudgeCandidates（回话判定器 worker 用），这个套件不测那条路径，
    // 同其它未测方法一样给个拒绝桩。
    async listReplyJudgeCandidates() {
      throw new Error("listReplyJudgeCandidates not expected");
    },
    // R13 批 C1：新增 updateContextSummary（会话上下文压缩用），这个套件不测那条路径，同其它未测
    // 方法一样给个拒绝桩。
    async updateContextSummary() {
      throw new Error("updateContextSummary not expected");
    },
    // R14FIX 批 workbench：新增 renameConversation（协同会话改名）——本套件按需 override，未 override
    // 的给拒绝桩（同其它未测方法）。
    async renameConversation() {
      throw new Error("renameConversation not expected");
    },
    // R15 批 cuu-toggle：新增 updateCuuEnabled/listParticipantsWithNickname——本套件按需 override，
    // 未 override 的给拒绝桩（同其它未测方法）。
    async updateCuuEnabled() {
      throw new Error("updateCuuEnabled not expected");
    },
    async listParticipantsWithNickname() {
      throw new Error("listParticipantsWithNickname not expected");
    },
    // R14 批 CHAT：新增的编辑/删除/置顶/反应/已读/富化仓库方法——本套件按需 override，未 override 的
    // 给拒绝桩（同其它未测方法）。
    async editMessage() {
      throw new Error("editMessage not expected");
    },
    async deleteMessage() {
      throw new Error("deleteMessage not expected");
    },
    async pinMessage() {
      throw new Error("pinMessage not expected");
    },
    async unpinMessage() {
      throw new Error("unpinMessage not expected");
    },
    async addReaction() {
      throw new Error("addReaction not expected");
    },
    async removeReaction() {
      throw new Error("removeReaction not expected");
    },
    async advanceReadCursor() {
      throw new Error("advanceReadCursor not expected");
    },
    async listReceipts() {
      throw new Error("listReceipts not expected");
    },
    async listPins() {
      throw new Error("listPins not expected");
    },
    async listReactionsForMessages() {
      // 富化路径默认返回空聚合——大量既有 listMessages/createMessage 测试不关心 reactions，
      // 给个空 Map 默认桩比逐个 override 干净（要测 reactions 的用例自行 override）。
      return new Map();
    },
    async listReplyPreviews() {
      return new Map();
    },
    // R14 批 FEEDBACK：新增 findMessageForFeedback（反馈目标消息的只读定位），这个套件不测那条路径，
    // 同其它未测方法一样给个拒绝桩（要测反馈资格判定的用例在 ai-feedback.test.ts 自带假仓库）。
    async findMessageForFeedback() {
      throw new Error("findMessageForFeedback not expected");
    },
    // R15 批 A（A4/A5 未读聚合）：新增的未读数聚合 / 参与者列举方法。listConversations 现在会调
    // unreadCountsForViewer——默认给空 Map（未读 0），要测未读数的用例自行 override；另两个默认空。
    async unreadCountsForViewer() {
      return new Map();
    },
    async unreadCountsForRecipients() {
      return new Map();
    },
    async listParticipantUserIds() {
      return [];
    },
    ...overrides
  };
}

function driveFiles(file: DrivePageService["file"]): Pick<DrivePageService, "file"> {
  return { file };
}

function capturingBus(input: { error?: Error; backend?: "memory" | "redis" } = {}) {
  const published: Array<{ topic: string; type: string; data: unknown }> = [];
  return {
    published,
    bus: {
      backend: input.backend ?? "memory",
      async publish(topic: string, type: string, data: unknown) {
        published.push({ topic, type, data });
        if (input.error) {
          throw input.error;
        }
      }
    }
  };
}

function parseCreatedEvent(value: unknown) {
  const schema = (conversationContracts as Record<string, unknown>)["conversationMessageCreatedEventSchema"] as {
    parse(value: unknown): Record<string, unknown>;
  } | undefined;
  if (!schema || typeof schema.parse !== "function") {
    assert.fail("missing conversationMessageCreatedEventSchema");
  }
  return schema.parse(value);
}

function collabPayload(overrides: Partial<CreateConversationRequest> = {}): CreateConversationRequest {
  return {
    kind: "collab",
    title: "重写第三节",
    visibility: "private",
    participant_user_ids: [participantUserId],
    cuu_enabled: true,
    ...overrides
  };
}

// R14 FIX批10（被 @ 的回复延迟：事件驱动直通）——下面这组 fixture/helper 只服务这一批新增的
// createMessage 直通触发测试；turnResult() 的字段形状照抄 conversation-reply-judge.test.ts 里同名
// helper（同一份 ConversationTurnResultVM 契约）。
function turnResult(): ConversationTurnResultVM {
  return {
    turn_id: "70000000-0000-4000-8000-000000000001",
    message: {
      id: "70000000-0000-4000-8000-000000000002",
      conversation_id: conversationId,
      seq: 2,
      sender_type: "cuu",
      sender_user_id: null,
      thread_root_id: null,
      created_at: now.toISOString(),
      kind: "text",
      content: { text: "好的，马上处理。" }
    }
  };
}

// 可控的 fake mentionTrigger：createTurn 默认返回一个由调用方掌控何时 resolve 的 promise——不少直通
// 测试都要证明"createMessage 的返回不等直通 turn 完成"，这需要能在断言时机上手动卡住它。
function mentionTrigger(overrides: {
  createTurn?: ConversationMentionTriggerDeps["turns"]["createTurn"];
  markMentionHandled?: ConversationMentionTriggerDeps["markMentionHandled"];
} = {}) {
  const createTurnCalls: unknown[] = [];
  const markCalls: Array<{ conversationId: string; messageId: string }> = [];
  const deps: ConversationMentionTriggerDeps = {
    turns: {
      createTurn:
        overrides.createTurn
        ?? (async (input) => {
          createTurnCalls.push(input);
          return turnResult();
        })
    },
    markMentionHandled:
      overrides.markMentionHandled
      ?? ((input) => {
        markCalls.push(input);
      })
  };
  return { deps, createTurnCalls, markCalls };
}

test("conversation service requires a human user and a nonempty actor workspace without tenant fallback", async () => {
  let repositoryCalls = 0;
  const repo = repository({
    async listVisibleForProject() {
      repositoryCalls += 1;
      return { rows: [], capped: false, nextCursor: null };
    },
    async findVisibleAccessRecord() {
      repositoryCalls += 1;
      return accessRecord();
    }
  });
  const service = createConversationService(repo, {
    driveFiles: driveFiles(async () => {
      throw new Error("Drive must not be called");
    })
  });
  const actorWithUser = actor();
  const { userId: _omittedUserId, ...actorWithoutUserId } = actorWithUser;

  for (const badActor of [
    actorWithoutUserId,
    actor({ userId: "   " }),
    actor({ kind: "system" }),
    actor({ workspaceId: "" }),
    actor({ workspaceId: "   " })
  ]) {
    await assert.rejects(
      () => service.assertProjectAccess({ actor: badActor, projectId }),
      (error) => error instanceof ConversationServiceError && error.status === 403 && error.code === "human_required"
    );
    await assert.rejects(
      () => service.assertConversationAccess({ actor: badActor, conversationId }),
      (error) => error instanceof ConversationServiceError && error.status === 403 && error.code === "human_required"
    );
  }
  assert.equal(repositoryCalls, 0);
});

test("project access and conversation lists use bounded tenant-safe repository inputs and exact cursors", async () => {
  const calls: unknown[] = [];
  const cursor = {
    createdAt: "2026-07-12T08:30:00.123456Z",
    id: conversationId
  };
  const repo = repository({
    async listVisibleForProject(input) {
      calls.push(input);
      if (input.limit === 1) {
        return { rows: [], capped: false, nextCursor: null };
      }
      return { rows: [visibleConversationRow()], capped: true, nextCursor: cursor };
    }
  });
  const service = createConversationService(repo, {
    driveFiles: driveFiles(async () => {
      throw new Error("Drive must not be called");
    })
  });

  await service.assertProjectAccess({ actor: actor(), projectId });
  const page = await service.listConversations({
    actor: actor(),
    projectId,
    query: { afterCreatedAt: cursor.createdAt, afterId: cursor.id, limit: 25 }
  });

  assert.deepEqual(calls, [
    { workspaceId, viewerUserId: userId, projectId, limit: 1 },
    { workspaceId, viewerUserId: userId, projectId, after: cursor, limit: 25 }
  ]);
  assert.equal(page.conversations[0]?.participant_role, "owner");
  assert.deepEqual(page.next_cursor, { afterCreatedAt: cursor.createdAt, afterId: cursor.id });
  assert.equal(page.capped, true);
});

// ── R15 批 A（A4 未读聚合）：会话列表 VM 带上当前 viewer 的未读数（一次聚合、禁 N+1、聚合失败降级 ──
test("A4 conversation list attaches per-viewer unread_count from one aggregate call and degrades to 0", async () => {
  const otherId = "30000000-0000-4000-8000-0000000000ff";
  let unreadCalls = 0;
  const repo = repository({
    async listVisibleForProject() {
      return {
        rows: [visibleConversationRow(), visibleConversationRow({ id: otherId, participantRole: "member" })],
        capped: false,
        nextCursor: null
      };
    },
    async unreadCountsForViewer(input) {
      unreadCalls += 1;
      assert.deepEqual([...input.conversationIds].sort(), [conversationId, otherId].sort());
      // 只回有未读的会话；未列出的走 `?? 0`。
      return new Map([[conversationId, 4]]);
    }
  });
  const service = createConversationService(repo, {
    driveFiles: driveFiles(async () => {
      throw new Error("Drive must not be called");
    })
  });

  const page = await service.listConversations({ actor: actor(), projectId, query: { limit: 25 } });
  assert.equal(unreadCalls, 1, "unread must be one aggregate call, not per-conversation");
  const byId = new Map(page.conversations.map((c) => [c.id, c.unread_count]));
  assert.equal(byId.get(conversationId), 4);
  assert.equal(byId.get(otherId), 0);
});

test("A4 conversation list still renders (unread_count 0) when the unread aggregate throws", async () => {
  const repo = repository({
    async listVisibleForProject() {
      return { rows: [visibleConversationRow()], capped: false, nextCursor: null };
    },
    async unreadCountsForViewer() {
      throw new Error("aggregate exploded");
    }
  });
  const service = createConversationService(repo, {
    driveFiles: driveFiles(async () => {
      throw new Error("Drive must not be called");
    }),
    logger: { warn() {} }
  });

  const page = await service.listConversations({ actor: actor(), projectId, query: { limit: 25 } });
  assert.equal(page.conversations[0]?.unread_count, 0);
});

test("access preflights map invisible projects and conversations to stable non-oracular 404 errors", async () => {
  const service = createConversationService(repository({
    async listVisibleForProject() {
      return null;
    },
    async findVisibleAccessRecord() {
      return null;
    }
  }), {
    driveFiles: driveFiles(async () => {
      throw new Error("Drive must not be called");
    })
  });

  await assert.rejects(
    () => service.assertProjectAccess({ actor: actor(), projectId }),
    (error) => error instanceof ConversationServiceError
      && error.status === 404
      && error.code === "conversation_project_not_found"
  );
  await assert.rejects(
    () => service.assertConversationAccess({ actor: actor(), conversationId }),
    (error) => error instanceof ConversationServiceError
      && error.status === 404
      && error.code === "conversation_not_found"
  );
  await assert.rejects(
    () => service.createMessage({
      actor: actor(),
      conversationId,
      payload: { kind: "file_card", content: { drive_item_id: driveItemId } }
    }),
    (error) => error instanceof ConversationServiceError
      && error.status === 404
      && error.code === "conversation_not_found"
  );
});

// ── R15 批 B（人对人私聊）：openDm 服务方法 ────────────────────────────────────────────
test("openDm returns the DM conversation VM with is_dm=true, cuu off, and owner role", async () => {
  let received: unknown;
  const dmConversation = conversationRow({
    projectId: "70000000-0000-4000-8000-000000000099",
    kind: "collab",
    visibility: "private",
    cuuEnabled: false,
    dmKey: `dm:${[userId, participantUserId].sort().join(":")}`,
    createdBy: userId
  });
  const repo = repository({
    async openOrCreateDm(input) {
      received = input;
      return { conversation: dmConversation, created: true };
    }
  });
  const service = createConversationService(repo, {
    driveFiles: driveFiles(async () => {
      throw new Error("Drive must not be called");
    }),
    now: () => now
  });

  const result = await service.openDm({ actor: actor(), targetUserId: participantUserId });

  // 转发发起者/对方/工作区/时钟——目标归一由服务层小写化（这里已是小写）。
  assert.deepEqual(received, {
    workspaceId,
    actorUserId: userId,
    targetUserId: participantUserId,
    at: now
  });
  assert.equal(result.conversation.is_dm, true);
  assert.equal(result.conversation.cuu_enabled, false);
  assert.equal(result.conversation.participant_role, "owner");
  assert.equal(result.conversation.kind, "collab");
});

test("openDm rejects opening a DM with yourself before calling the repository", async () => {
  let called = false;
  const repo = repository({
    async openOrCreateDm() {
      called = true;
      throw new Error("repository must not be called for a self-DM");
    }
  });
  const service = createConversationService(repo, {
    driveFiles: driveFiles(async () => {
      throw new Error("Drive must not be called");
    }),
    now: () => now
  });

  await assert.rejects(
    () => service.openDm({ actor: actor(), targetUserId: userId }),
    (error) =>
      error instanceof ConversationServiceError && error.status === 400 && error.code === "conversation_dm_self"
  );
  assert.equal(called, false);
});

test("openDm maps a non-member target to a stable 404 (no leak that the user exists elsewhere)", async () => {
  const repo = repository({
    async openOrCreateDm() {
      throw new ConversationDmTargetError("target user is not an active member of this workspace");
    }
  });
  const service = createConversationService(repo, {
    driveFiles: driveFiles(async () => {
      throw new Error("Drive must not be called");
    }),
    now: () => now
  });

  await assert.rejects(
    () => service.openDm({ actor: actor(), targetUserId: participantUserId }),
    (error) =>
      error instanceof ConversationServiceError
      && error.status === 404
      && error.code === "conversation_dm_target_not_found"
  );
});

test("listDms forwards the actor/workspace + cap and shapes each item with is_dm + 2 participants", async () => {
  let received: unknown;
  const dmConversation = conversationRow({
    projectId: "70000000-0000-4000-8000-000000000099",
    kind: "collab",
    visibility: "private",
    cuuEnabled: false,
    dmKey: `dm:${[userId, participantUserId].sort().join(":")}`,
    createdBy: userId
  });
  const repo = repository({
    async listDmsForUser(input) {
      received = input;
      return [
        {
          conversation: dmConversation,
          participants: [
            { userId, nickname: "me", isSelf: true },
            { userId: participantUserId, nickname: "peer", isSelf: false }
          ]
        }
      ];
    }
  });
  const service = createConversationService(repo, {
    driveFiles: driveFiles(async () => {
      throw new Error("Drive must not be called");
    }),
    now: () => now
  });

  const result = await service.listDms({ actor: actor() });

  assert.deepEqual(received, { workspaceId, userId, limit: 200 });
  assert.equal(result.items.length, 1);
  const item = result.items[0]!;
  assert.equal(item.conversation.is_dm, true);
  // 发起者（created_by === self）→ owner。
  assert.equal(item.conversation.participant_role, "owner");
  assert.deepEqual(item.participants, [
    { user_id: userId, nickname: "me", is_self: true },
    { user_id: participantUserId, nickname: "peer", is_self: false }
  ]);
});

test("listDms attaches the viewer's unread_count per DM via one aggregate (R15 A6 rail red dot)", async () => {
  const dmConversation = conversationRow({
    projectId: "70000000-0000-4000-8000-000000000099",
    kind: "collab",
    visibility: "private",
    cuuEnabled: false,
    dmKey: `dm:${[userId, participantUserId].sort().join(":")}`,
    createdBy: userId
  });
  let unreadInput: unknown;
  const repo = repository({
    async listDmsForUser() {
      return [
        {
          conversation: dmConversation,
          participants: [
            { userId, nickname: "me", isSelf: true },
            { userId: participantUserId, nickname: "peer", isSelf: false }
          ]
        }
      ];
    },
    async unreadCountsForViewer(input) {
      unreadInput = input;
      return new Map([[dmConversation.id, 3]]);
    }
  });
  const service = createConversationService(repo, {
    driveFiles: driveFiles(async () => {
      throw new Error("Drive must not be called");
    }),
    now: () => now
  });

  const result = await service.listDms({ actor: actor() });
  // 一条聚合查询（禁 N+1）——viewer + 本页会话 id 集合。
  assert.deepEqual(unreadInput, { viewerUserId: userId, conversationIds: [dmConversation.id] });
  assert.equal(result.items[0]!.conversation.unread_count, 3);
});

test("listDms degrades to unread 0 when the aggregate throws, never 500s the list", async () => {
  const dmConversation = conversationRow({
    projectId: "70000000-0000-4000-8000-000000000099",
    kind: "collab",
    visibility: "private",
    cuuEnabled: false,
    dmKey: `dm:${[userId, participantUserId].sort().join(":")}`,
    createdBy: userId
  });
  const repo = repository({
    async listDmsForUser() {
      return [
        {
          conversation: dmConversation,
          participants: [
            { userId, nickname: "me", isSelf: true },
            { userId: participantUserId, nickname: "peer", isSelf: false }
          ]
        }
      ];
    },
    async unreadCountsForViewer() {
      throw new Error("aggregate boom");
    }
  });
  const service = createConversationService(repo, {
    driveFiles: driveFiles(async () => {
      throw new Error("Drive must not be called");
    }),
    now: () => now
  });

  const result = await service.listDms({ actor: actor() });
  assert.equal(result.items.length, 1);
  // 未读算不出来时降级成 0（不带红点），而不是让整份 DM 列表崩掉。
  assert.equal(result.items[0]!.conversation.unread_count, 0);
});

test("listDms returns an empty list unchanged (no DM container / no DMs)", async () => {
  const repo = repository({
    async listDmsForUser() {
      return [];
    }
  });
  const service = createConversationService(repo, {
    driveFiles: driveFiles(async () => {
      throw new Error("Drive must not be called");
    }),
    now: () => now
  });

  const result = await service.listDms({ actor: actor() });
  assert.deepEqual(result, { items: [] });
});

test("conversation create maps rows and forwards only actor-scoped repository fields", async () => {
  let received: unknown;
  const repo = repository({
    async createCollab(input) {
      received = input;
      return { conversation: conversationRow(), participants: [participantRow()] };
    }
  });
  const service = createConversationService(repo, {
    driveFiles: driveFiles(async () => {
      throw new Error("Drive must not be called");
    }),
    now: () => now
  });

  const result = await service.createConversation({
    actor: actor(),
    projectId,
    payload: collabPayload({ parent_conversation_id: parentConversationId, source_message_id: sourceMessageId })
  });

  assert.deepEqual(received, {
    workspaceId,
    projectId,
    creatorUserId: userId,
    title: "重写第三节",
    visibility: "private",
    parentConversationId,
    sourceMessageId,
    participantUserIds: [participantUserId],
    cuuEnabled: true,
    at: now
  });
  assert.equal(result.conversation.participant_role, "owner");
  assert.equal(result.participants[0]?.role, "owner");
});

test("conversation create forwards an explicit cuu_enabled:false to the repository and the resulting VM", async () => {
  let received: unknown;
  const repo = repository({
    async createCollab(input) {
      received = input;
      return { conversation: conversationRow({ cuuEnabled: false }), participants: [participantRow()] };
    }
  });
  const service = createConversationService(repo, {
    driveFiles: driveFiles(async () => {
      throw new Error("Drive must not be called");
    }),
    now: () => now
  });

  const result = await service.createConversation({
    actor: actor(),
    projectId,
    payload: collabPayload({ cuu_enabled: false })
  });

  assert.equal((received as { cuuEnabled: boolean }).cuuEnabled, false);
  assert.equal(result.conversation.cuu_enabled, false);
});

test("conversation semantic repository errors stay client-correct while sequence exhaustion is a conflict", async () => {
  const cases = [
    [new ConversationRepositoryInputError("bad participant"), 400, "conversation_invalid_input"],
    [new ConversationParticipantMembershipError("not a member"), 400, "conversation_participant_invalid"],
    [new ConversationParentAccessError("bad parent"), 400, "conversation_parent_invalid"],
    [new ConversationSourceMessageMismatchError("bad source"), 400, "conversation_source_invalid"],
    [new ConversationThreadRootMismatchError("bad root"), 400, "conversation_thread_invalid"],
    [new ConversationAccessDeniedError("gone"), 404, "conversation_not_found"],
    [new ConversationSequenceExhaustedError("full"), 409, "conversation_sequence_exhausted"]
  ] as const;

  for (const [thrown, status, code] of cases) {
    const service = createConversationService(repository({
      async findVisibleAccessRecord() {
        return accessRecord();
      },
      async createCollab() {
        throw thrown;
      },
      async createUserMessage() {
        throw thrown;
      }
    }), {
      driveFiles: driveFiles(async () => {
        throw new Error("Drive must not be called");
      })
    });
    const call = thrown instanceof ConversationThreadRootMismatchError
      || thrown instanceof ConversationSequenceExhaustedError
      ? () => service.createMessage({
        actor: actor(),
        conversationId,
        payload: { kind: "text", content: { text: "hello" } }
      })
      : () => service.createConversation({ actor: actor(), projectId, payload: collabPayload() });
    await assert.rejects(
      call,
      (error) => error instanceof ConversationServiceError && error.status === status && error.code === code
    );
  }
});

test("message listing forwards the safe cursor and maps explicit page metadata", async () => {
  let received: unknown;
  const service = createConversationService(repository({
    async listMessagesAfter(input) {
      received = input;
      return { rows: [messageRow({ seq: 8 })], hasMore: true, nextAfterSeq: 8 };
    }
  }), {
    driveFiles: driveFiles(async () => {
      throw new Error("Drive must not be called");
    })
  });

  const page = await service.listMessages({
    actor: actor(),
    conversationId,
    query: { afterSeq: 7, limit: 20 }
  });

  assert.deepEqual(received, { workspaceId, viewerUserId: userId, conversationId, afterSeq: 7, limit: 20 });
  assert.equal(page.messages[0]?.seq, 8);
  assert.equal(page.has_more, true);
  assert.equal(page.next_after_seq, 8);
});

// R12 批8：beforeSeq（反向翻页）走仓库的 listMessagesBefore，绝不落到 listMessagesAfter——两条路径
// 在契约层就已经互斥（见 conversationMessageListQuerySchema 的 union），这里再验证服务层的分叉正确。
test("message listing with a beforeSeq cursor calls listMessagesBefore and stitches a forward-continuation seq", async () => {
  let received: unknown;
  const service = createConversationService(repository({
    async listMessagesBefore(input) {
      received = input;
      return { rows: [messageRow({ seq: 5 }), messageRow({ seq: 6 })], hasMore: true, nextBeforeSeq: 5 };
    }
  }), {
    driveFiles: driveFiles(async () => {
      throw new Error("Drive must not be called");
    })
  });

  const page = await service.listMessages({
    actor: actor(),
    conversationId,
    query: { beforeSeq: 7, limit: 20 }
  });

  assert.deepEqual(received, { workspaceId, viewerUserId: userId, conversationId, beforeSeq: 7, limit: 20 });
  assert.deepEqual(page.messages.map((message) => message.seq), [5, 6]);
  assert.equal(page.has_more, true);
  assert.equal(page.next_after_seq, 6);
  assert.equal(page.next_before_seq, 5);
});

test("message listing with a beforeSeq cursor on an empty page reports no forward-continuation seq beyond zero", async () => {
  const service = createConversationService(repository({
    async listMessagesBefore() {
      return { rows: [], hasMore: false, nextBeforeSeq: 1 };
    }
  }), {
    driveFiles: driveFiles(async () => {
      throw new Error("Drive must not be called");
    })
  });

  const page = await service.listMessages({
    actor: actor(),
    conversationId,
    query: { beforeSeq: 1, limit: 20 }
  });

  assert.deepEqual(page.messages, []);
  assert.equal(page.has_more, false);
  assert.equal(page.next_after_seq, 0);
  assert.equal(page.next_before_seq, 1);
});

test("message listing with a beforeSeq cursor maps an invisible conversation to the same non-oracular 404", async () => {
  const service = createConversationService(repository({
    async listMessagesBefore() {
      return null;
    }
  }), {
    driveFiles: driveFiles(async () => {
      throw new Error("Drive must not be called");
    })
  });

  await assert.rejects(
    service.listMessages({ actor: actor(), conversationId, query: { beforeSeq: 7, limit: 20 } }),
    (error: unknown) =>
      error instanceof ConversationServiceError && error.status === 404 && error.code === "conversation_not_found"
  );
});

test("text message creation never calls Drive and persists only bounded text metadata", async () => {
  let driveCalls = 0;
  let received: unknown;
  const push = capturingBus();
  const service = createConversationService(repository({
    async findVisibleAccessRecord() {
      return accessRecord();
    },
    async createUserMessage(input) {
      received = input;
      return messageRow({ contentJson: input.contentJson, threadRootId: input.threadRootId ?? null });
    }
  }), {
    driveFiles: driveFiles(async () => {
      driveCalls += 1;
      throw new Error("Drive must not be called for text");
    }),
    now: () => now,
    bus: push.bus
  });
  const payload: CreateConversationMessageRequest = {
    kind: "text",
    content: { text: "请先核对引用。" },
    thread_root_id: sourceMessageId
  };

  const result = await service.createMessage({ actor: actor(), conversationId, payload });

  assert.equal(driveCalls, 0);
  assert.deepEqual(received, {
    workspaceId,
    conversationId,
    senderUserId: userId,
    kind: "text",
    contentJson: { text: "请先核对引用。" },
    threadRootId: sourceMessageId,
    at: now
  });
  assert.deepEqual(result.content, { text: "请先核对引用。" });
  assert.equal(push.published.length, 1);
  assert.equal(push.published[0]?.topic, `conversation:${conversationId}`);
  assert.equal(push.published[0]?.type, "conversation.message.created");
  const event = parseCreatedEvent(push.published[0]?.data);
  assert.match(String(event.event_id), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
  assert.equal(event.type, "conversation.message.created");
  assert.equal(event.topic, `conversation:${conversationId}`);
  assert.equal(event.project_id, projectId);
  assert.deepEqual(event.actor, { actor_kind: "human", actor_user_id: userId, label: "R12 owner" });
  assert.deepEqual(event.data, result);
});

test("message publishing starts only after the repository promise resolves", async () => {
  const push = capturingBus();
  let resolveWrite: ((row: ConversationMessageRow) => void) | undefined;
  const write = new Promise<ConversationMessageRow>((resolve) => {
    resolveWrite = resolve;
  });
  const service = createConversationService(repository({
    async findVisibleAccessRecord() {
      return accessRecord();
    },
    async createUserMessage() {
      return write;
    }
  }), {
    driveFiles: driveFiles(async () => {
      throw new Error("Drive must not be called");
    }),
    now: () => now,
    bus: push.bus
  });

  const pending = service.createMessage({
    actor: actor(),
    conversationId,
    payload: { kind: "text", content: { text: "hello" } }
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(push.published.length, 0);
  assert.ok(resolveWrite);
  resolveWrite(messageRow({ contentJson: { text: "hello" } }));
  await pending;
  assert.equal(push.published.length, 1);
});

test("message output contract failure never reaches the live broker", async () => {
  const push = capturingBus();
  const service = createConversationService(repository({
    async findVisibleAccessRecord() {
      return accessRecord();
    },
    async createUserMessage() {
      return messageRow({ seq: Number.MAX_SAFE_INTEGER + 1 });
    }
  }), {
    driveFiles: driveFiles(async () => {
      throw new Error("Drive must not be called");
    }),
    bus: push.bus
  });

  await assert.rejects(
    () => service.createMessage({
      actor: actor(),
      conversationId,
      payload: { kind: "text", content: { text: "hello" } }
    }),
    (error) => error instanceof InternalContractError && error.context === "conversations.messages.create"
  );
  assert.equal(push.published.length, 0);
});

test("corrupt committed message identity fails the event contract and never publishes", async () => {
  const corruptRows: ConversationMessageRow[] = [
    messageRow({ conversationId: "30000000-0000-4000-8000-000000000099" }),
    messageRow({ senderType: "cuu", senderUserId: null }),
    messageRow({ senderUserId: "60000000-0000-4000-8000-000000000099" })
  ];

  for (const corruptRow of corruptRows) {
    const push = capturingBus();
    const service = createConversationService(repository({
      async findVisibleAccessRecord() {
        return accessRecord();
      },
      async createUserMessage() {
        return corruptRow;
      }
    }), {
      driveFiles: driveFiles(async () => {
        throw new Error("Drive must not be called");
      }),
      bus: push.bus
    });

    await assert.rejects(
      () => service.createMessage({
        actor: actor(),
        conversationId,
        payload: { kind: "text", content: { text: "hello" } }
      }),
      (error) => error instanceof InternalContractError
        && error.context === "conversations.messages.event.created"
    );
    assert.equal(push.published.length, 0);
  }
});

test("post-commit broker failure returns the message and emits one traceable structured warning", async () => {
  const brokerError = new Error("redis publish unavailable");
  const push = capturingBus({ error: brokerError, backend: "redis" });
  const warnings: Array<{ name: string; fields?: Record<string, unknown> }> = [];
  const service = createConversationService(repository({
    async findVisibleAccessRecord() {
      return accessRecord();
    },
    async createUserMessage(input) {
      return messageRow({ contentJson: input.contentJson });
    }
  }), {
    driveFiles: driveFiles(async () => {
      throw new Error("Drive must not be called");
    }),
    now: () => now,
    bus: push.bus,
    logger: {
      warn(name, fields) {
        warnings.push(fields ? { name, fields } : { name });
      }
    }
  });

  const result = await service.createMessage({
    actor: actor(),
    conversationId,
    payload: { kind: "text", content: { text: "hello" } }
  });

  assert.equal(result.id, messageId);
  assert.equal(push.published.length, 1);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0]?.name, "conversation_message_publish_failed");
  assert.deepEqual(warnings[0]?.fields, {
    event_id: (parseCreatedEvent(push.published[0]?.data)).event_id,
    topic: `conversation:${conversationId}`,
    conversation_id: conversationId,
    message_id: messageId,
    seq: 1,
    broker_backend: "redis",
    error: brokerError
  });
});

test("file-card creation authorizes through Drive and persists only server-owned item and filename metadata", async () => {
  const driveCalls: unknown[] = [];
  let received: unknown;
  const push = capturingBus();
  const service = createConversationService(repository({
    async findVisibleAccessRecord() {
      return accessRecord();
    },
    async createUserMessage(input) {
      received = input;
      return messageRow({ kind: "file_card", contentJson: input.contentJson });
    }
  }), {
    driveFiles: driveFiles(async (input) => {
      driveCalls.push(input);
      return {
        id: "51000000-0000-4000-8000-000000000001",
        itemId: driveItemId,
        projectId,
        filename: "brief-v3.docx",
        sizeBytes: 42,
        storagePath: "/private/brief-v3.docx",
        sha256: "secret-hash",
        parsedText: "secret contents"
      };
    }),
    now: () => now,
    bus: push.bus
  });

  const result = await service.createMessage({
    actor: actor(),
    conversationId,
    payload: { kind: "file_card", content: { drive_item_id: driveItemId } }
  });

  assert.deepEqual(driveCalls, [{ actor: actor(), projectId, itemId: driveItemId }]);
  assert.deepEqual(received, {
    workspaceId,
    conversationId,
    senderUserId: userId,
    kind: "file_card",
    contentJson: { drive_item_id: driveItemId, snapshot_name: "brief-v3.docx" },
    at: now
  });
  assert.deepEqual(result.content, { drive_item_id: driveItemId, snapshot_name: "brief-v3.docx" });
  assert.equal("storage_path" in result.content, false);
  assert.equal("parsed_text" in result.content, false);
  assert.equal("sha256" in result.content, false);
  assert.equal(push.published.length, 1);
  const event = parseCreatedEvent(push.published[0]?.data);
  assert.deepEqual(event.data, result);
  assert.equal(JSON.stringify(event).includes("/private/brief-v3.docx"), false);
  assert.equal(JSON.stringify(event).includes("secret contents"), false);
  assert.equal(JSON.stringify(event).includes("secret-hash"), false);
});

test("file-card creation maps forbidden and missing Drive items to the same non-oracular 404", async () => {
  for (const driveError of [
    new DrivePageServiceError(403, "forbidden", "drive_forbidden"),
    new DrivePageServiceError(404, "missing", "drive_file_not_found")
  ]) {
    const service = createConversationService(repository({
      async findVisibleAccessRecord() {
        return accessRecord();
      }
    }), {
      driveFiles: driveFiles(async () => {
        throw driveError;
      })
    });

    await assert.rejects(
      () => service.createMessage({
        actor: actor(),
        conversationId,
        payload: { kind: "file_card", content: { drive_item_id: driveItemId } }
      }),
      (error) => error instanceof ConversationServiceError
        && error.status === 404
        && error.code === "conversation_file_not_found"
    );
  }
});

test("file-card creation rejects mismatched Drive project/item returns and preserves unexpected failures as 500s", async () => {
  for (const returned of [
    { projectId: "20000000-0000-4000-8000-000000000099", itemId: driveItemId },
    { projectId, itemId: "50000000-0000-4000-8000-000000000099" }
  ]) {
    const service = createConversationService(repository({
      async findVisibleAccessRecord() {
        return accessRecord();
      }
    }), {
      driveFiles: driveFiles(async () => ({
        id: "51000000-0000-4000-8000-000000000001",
        filename: "brief.docx",
        sizeBytes: 42,
        storagePath: "/private/brief.docx",
        ...returned
      }))
    });
    await assert.rejects(
      () => service.createMessage({
        actor: actor(),
        conversationId,
        payload: { kind: "file_card", content: { drive_item_id: driveItemId } }
      }),
      (error) => error instanceof Error && !(error instanceof ConversationServiceError)
    );
  }

  const unexpected = new Error("database disconnected");
  const push = capturingBus();
  const service = createConversationService(repository({
    async findVisibleAccessRecord() {
      return accessRecord();
    },
    async createUserMessage() {
      throw unexpected;
    }
  }), {
    driveFiles: driveFiles(async () => { throw new Error("Drive not expected"); }),
    bus: push.bus
  });
  await assert.rejects(
    () => service.createMessage({
      actor: actor(),
      conversationId,
      payload: { kind: "text", content: { text: "hello" } }
    }),
    (error) => error === unexpected
  );
  assert.equal(push.published.length, 0);
});

test("conversation output assembly drift becomes InternalContractError instead of a client 422", async () => {
  const service = createConversationService(repository({
    async listVisibleForProject() {
      return {
        rows: [visibleConversationRow({ nextSeq: Number.MAX_SAFE_INTEGER + 1 })],
        capped: false,
        nextCursor: null
      };
    }
  }), {
    driveFiles: driveFiles(async () => {
      throw new Error("Drive must not be called");
    })
  });

  await assert.rejects(
    () => service.listConversations({ actor: actor(), projectId, query: { limit: 50 } }),
    (error) => error instanceof InternalContractError && error.context === "conversations.list"
  );
});

// ── R14 FIX批10（被 @ 的回复延迟：事件驱动直通）───────────────────────────────────────

test("an @Cuu text message in a real small group asynchronously triggers a direct turn without blocking the response", async () => {
  const createTurnCalls: unknown[] = [];
  const markCalls: Array<{ conversationId: string; messageId: string }> = [];
  let resolveTurn: ((value: ConversationTurnResultVM) => void) | undefined;
  const pendingTurn = new Promise<ConversationTurnResultVM>((resolve) => {
    resolveTurn = resolve;
  });
  const service = createConversationService(repository({
    async findVisibleAccessRecord() {
      return accessRecord({ participantCount: 3 });
    },
    async createUserMessage(input) {
      return messageRow({ contentJson: input.contentJson });
    }
  }), {
    driveFiles: driveFiles(async () => {
      throw new Error("Drive must not be called");
    }),
    now: () => now,
    mentionTrigger: {
      turns: {
        async createTurn(input) {
          createTurnCalls.push(input);
          // 故意不 resolve——证明 createMessage 的返回不等这个直通 turn 完成（fire-and-forget）。
          return pendingTurn;
        }
      },
      markMentionHandled(input) {
        markCalls.push(input);
      }
    }
  });

  const result = await service.createMessage({
    actor: actor(),
    conversationId,
    payload: { kind: "text", content: { text: "@Cuu 帮我看一下这个" } }
  });

  assert.deepEqual(result.content, { text: "@Cuu 帮我看一下这个" });
  // markMentionHandled 必须在 createMessage 返回之前就已经跑完——同步先于触发 createTurn（见实现里
  // "标记必须是函数体接下来第一个同步动作"的注释），这里能断言到就是证据：这个 await 已经完成，
  // pendingTurn 还没有 resolve，markCalls 却已经有记录。
  assert.deepEqual(markCalls, [{ conversationId, messageId }]);
  assert.equal(createTurnCalls.length, 1);
  const call = createTurnCalls[0] as {
    actor: AuthActor;
    conversationId: string;
    payload: { user_message_id: string };
  };
  assert.equal(call.actor.kind, "human");
  assert.equal(call.actor.userId, userId);
  assert.equal(call.actor.workspaceId, workspaceId);
  assert.equal(call.actor.isAdmin, false);
  assert.equal(call.actor.orgId, "");
  assert.equal(call.conversationId, conversationId);
  assert.equal(call.payload.user_message_id, messageId);

  resolveTurn?.(turnResult());
});

test("a busy-conflict from the direct trigger's createTurn is only logged, never surfaces to the message-creation caller (409, no 500)", async () => {
  const warnings: Array<{ name: string; fields?: Record<string, unknown> }> = [];
  const service = createConversationService(repository({
    async findVisibleAccessRecord() {
      return accessRecord({ participantCount: 2 });
    },
    async createUserMessage(input) {
      return messageRow({ contentJson: input.contentJson });
    }
  }), {
    driveFiles: driveFiles(async () => {
      throw new Error("Drive must not be called");
    }),
    now: () => now,
    logger: {
      warn(name, fields) {
        warnings.push(fields ? { name, fields } : { name });
      }
    },
    mentionTrigger: {
      turns: {
        async createTurn() {
          // 模拟真实的会话忙碌闸冲突——另一条路径（判定器 tick / 客户端补请）恰好正在跑这个会话的
          // turn。这必须只记警告，绝不能变成这次消息创建请求的 500。
          throw new ConversationTurnServiceError(
            409,
            "conversation_turn_busy",
            "这个会话已经有一轮 Cuu 回应正在进行，请稍候。"
          );
        }
      },
      markMentionHandled() {}
    }
  });

  const result = await service.createMessage({
    actor: actor(),
    conversationId,
    payload: { kind: "text", content: { text: "@Cuu 帮我看一下这个" } }
  });

  assert.equal(result.id, messageId);
  // 让直通那条 fire-and-forget 链有机会跑完它的 .catch()。
  await new Promise<void>((resolve) => setImmediate(resolve));
  const mentionWarning = warnings.find((entry) => entry.name === "conversation_mention_direct_trigger_failed");
  assert.ok(mentionWarning, "expected a warning for the failed direct trigger, not a thrown/unhandled error");
  assert.equal((mentionWarning?.fields as { conversation_id?: string } | undefined)?.conversation_id, conversationId);
  assert.equal((mentionWarning?.fields as { message_id?: string } | undefined)?.message_id, messageId);
});

test("the direct trigger stays silent for team main chats, cuu-disabled conversations, 1:1 collab, and un-mentioned text", async () => {
  const scenarios: Array<{ label: string; access: Partial<ConversationAccessRecord>; text: string }> = [
    {
      label: "team main conversation (owned by the silent observer, not turns)",
      access: { conversation: conversationRow({ kind: "main" }), participantCount: 5 },
      text: "@Cuu 帮我看一下这个"
    },
    {
      label: "cuu_enabled=false conversation",
      access: { conversation: conversationRow({ cuuEnabled: false }), participantCount: 3 },
      text: "@Cuu 帮我看一下这个"
    },
    {
      label: "1:1 collab (participantCount<=1) — the desktop client's own instant-request path owns this",
      access: { participantCount: 1 },
      text: "@Cuu 帮我看一下这个"
    },
    {
      label: "text without an @Cuu mention — the polling judge remains the fallback for this case",
      access: { participantCount: 3 },
      text: "先这样吧，我再想想"
    }
  ];

  for (const scenario of scenarios) {
    const trigger = mentionTrigger();
    const service = createConversationService(repository({
      async findVisibleAccessRecord() {
        return accessRecord(scenario.access);
      },
      async createUserMessage(input) {
        return messageRow({ contentJson: input.contentJson });
      }
    }), {
      driveFiles: driveFiles(async () => {
        throw new Error("Drive must not be called");
      }),
      now: () => now,
      mentionTrigger: trigger.deps
    });

    await service.createMessage({
      actor: actor(),
      conversationId,
      payload: { kind: "text", content: { text: scenario.text } }
    });
    // 即便这个场景本不该触发，也留一次事件循环空隙——万一实现有 bug 异步触发了，这里能抓到。
    await new Promise<void>((resolve) => setImmediate(resolve));

    assert.equal(trigger.createTurnCalls.length, 0, `${scenario.label}: must not call createTurn`);
    assert.equal(trigger.markCalls.length, 0, `${scenario.label}: must not mark the message as judge-handled`);
  }
});

test("createMessage without a mentionTrigger dependency behaves exactly as before (opt-in, zero regression for existing callers)", async () => {
  const push = capturingBus();
  const service = createConversationService(repository({
    async findVisibleAccessRecord() {
      return accessRecord({ participantCount: 3 });
    },
    async createUserMessage(input) {
      return messageRow({ contentJson: input.contentJson });
    }
  }), {
    driveFiles: driveFiles(async () => {
      throw new Error("Drive must not be called");
    }),
    now: () => now,
    bus: push.bus
    // 故意不传 mentionTrigger——所有既有测试/调用点(路由层) 都是这个形状。
  });

  const result = await service.createMessage({
    actor: actor(),
    conversationId,
    payload: { kind: "text", content: { text: "@Cuu 帮我看一下这个" } }
  });

  assert.deepEqual(result.content, { text: "@Cuu 帮我看一下这个" });
  assert.equal(push.published.length, 1);
});

// ── R14 批 CHAT：编辑 / 删除 / 置顶 / reaction / 已读 服务层 ─────────────────────────────

const otherMessageId = "40000000-0000-4000-8000-000000000024";

function parsePublishedEvent(schemaName: string, data: unknown): { data: Record<string, unknown> } {
  const schema = (conversationContracts as Record<string, unknown>)[schemaName] as
    | { parse(value: unknown): { data: Record<string, unknown> } }
    | undefined;
  if (!schema || typeof schema.parse !== "function") {
    assert.fail(`missing contract schema export: ${schemaName}`);
  }
  return schema.parse(data);
}

test("R14 editMessage returns the edited VM (edited_at set) and broadcasts message.updated", async () => {
  const edited = messageRow({ contentJson: { text: "改好了" }, editedAt: now });
  const editCalls: unknown[] = [];
  const repo = repository({
    async findVisibleAccessRecord() {
      return accessRecord();
    },
    async editMessage(input) {
      editCalls.push(input);
      return edited;
    }
  });
  const capture = capturingBus();
  const service = createConversationService(repo, {
    driveFiles: driveFiles(async () => {
      throw new Error("Drive must not be called");
    }),
    bus: capture.bus,
    now: () => now
  });

  const vm = await service.editMessage({
    actor: actor(),
    conversationId,
    messageId,
    payload: { text: "改好了" }
  });

  assert.equal(vm.kind, "text");
  assert.equal((vm.content as { text: string }).text, "改好了");
  assert.equal(vm.edited_at, now.toISOString());
  assert.deepEqual(editCalls, [
    {
      workspaceId,
      conversationId,
      messageId,
      editorUserId: userId,
      text: "改好了",
      editWindowMs: 15 * 60 * 1000,
      at: now
    }
  ]);
  assert.equal(capture.published.length, 1);
  assert.equal(capture.published[0]?.type, "conversation.message.updated");
  const event = parsePublishedEvent("conversationMessageUpdatedEventSchema", capture.published[0]?.data);
  assert.equal(event.data["id"], messageId);
});

test("R14 editMessage maps a repository actor mismatch to 403 conversation_message_forbidden", async () => {
  const { ConversationMessageActorMismatchError } = await import("@workhub/db");
  const repo = repository({
    async findVisibleAccessRecord() {
      return accessRecord();
    },
    async editMessage() {
      throw new ConversationMessageActorMismatchError("nope");
    }
  });
  const service = createConversationService(repo, {
    driveFiles: driveFiles(async () => {
      throw new Error("Drive must not be called");
    }),
    bus: capturingBus().bus,
    now: () => now
  });

  await assert.rejects(
    service.editMessage({ actor: actor(), conversationId, messageId, payload: { text: "x" } }),
    (error) =>
      error instanceof ConversationServiceError && error.status === 403 && error.code === "conversation_message_forbidden"
  );
});

test("R14 deleteMessage normalizes the tombstone VM (kind text, empty content, deleted_at)", async () => {
  const tombstone = messageRow({
    kind: "file_card",
    contentJson: {},
    deletedAt: now,
    deletedByUserId: userId
  });
  const repo = repository({
    async findVisibleAccessRecord() {
      return accessRecord();
    },
    async deleteMessage() {
      return tombstone;
    }
  });
  const capture = capturingBus();
  const service = createConversationService(repo, {
    driveFiles: driveFiles(async () => {
      throw new Error("Drive must not be called");
    }),
    bus: capture.bus,
    now: () => now
  });

  const vm = await service.deleteMessage({ actor: actor(), conversationId, messageId });

  assert.equal(vm.kind, "text");
  assert.deepEqual(vm.content, { text: "" });
  assert.equal(vm.deleted_at, now.toISOString());
  assert.equal(capture.published[0]?.type, "conversation.message.updated");
});

test("R14 pinMessage resolves void and broadcasts message.updated carrying the pin metadata", async () => {
  const pinned = messageRow({ pinnedAt: now, pinnedByUserId: userId });
  const repo = repository({
    async findVisibleAccessRecord() {
      return accessRecord();
    },
    async pinMessage() {
      return pinned;
    }
  });
  const capture = capturingBus();
  const service = createConversationService(repo, {
    driveFiles: driveFiles(async () => {
      throw new Error("Drive must not be called");
    }),
    bus: capture.bus,
    now: () => now
  });

  const result = await service.pinMessage({ actor: actor(), conversationId, messageId });
  assert.equal(result, undefined);
  const event = parsePublishedEvent("conversationMessageUpdatedEventSchema", capture.published[0]?.data);
  assert.deepEqual(event.data["pinned"], { at: now.toISOString(), by_user_id: userId });
});

test("R14 addReaction publishes a full reaction.updated aggregate; a bad key is a 400 before the repo", async () => {
  let addCalls = 0;
  const repo = repository({
    async findVisibleAccessRecord() {
      return accessRecord();
    },
    async addReaction() {
      addCalls += 1;
      return { reactions: [{ key: "approve", userIds: [userId, participantUserId] }] };
    }
  });
  const capture = capturingBus();
  const service = createConversationService(repo, {
    driveFiles: driveFiles(async () => {
      throw new Error("Drive must not be called");
    }),
    bus: capture.bus,
    now: () => now
  });

  await service.addReaction({ actor: actor(), conversationId, messageId, reactionKey: "approve" });
  assert.equal(addCalls, 1);
  assert.equal(capture.published[0]?.type, "conversation.reaction.updated");
  const event = parsePublishedEvent("conversationReactionUpdatedEventSchema", capture.published[0]?.data);
  assert.deepEqual(event.data["reactions"], [{ key: "approve", user_ids: [userId, participantUserId] }]);

  await assert.rejects(
    service.addReaction({ actor: actor(), conversationId, messageId, reactionKey: "celebrate" }),
    (error) =>
      error instanceof ConversationServiceError && error.status === 400 && error.code === "conversation_reaction_invalid_key"
  );
  // 坏 key 在打库之前就被拦下——repo 只被合法那次调用过一次。
  assert.equal(addCalls, 1);
});

test("R14 advanceReadCursor returns the clamped seq and broadcasts read.updated", async () => {
  const readCalls: unknown[] = [];
  const repo = repository({
    async findVisibleAccessRecord() {
      return accessRecord();
    },
    async advanceReadCursor(input) {
      readCalls.push(input);
      return { lastReadSeq: 3 };
    }
  });
  const capture = capturingBus();
  const service = createConversationService(repo, {
    driveFiles: driveFiles(async () => {
      throw new Error("Drive must not be called");
    }),
    bus: capture.bus,
    now: () => now
  });

  const result = await service.advanceReadCursor({
    actor: actor(),
    conversationId,
    payload: { last_read_seq: 999 }
  });

  assert.deepEqual(result, { last_read_seq: 3 });
  assert.deepEqual(readCalls, [{ workspaceId, conversationId, userId, lastReadSeq: 999, at: now }]);
  assert.equal(capture.published[0]?.type, "conversation.read.updated");
});

test("R14 listReceipts maps repository rows to the receipts VM shape", async () => {
  const repo = repository({
    async findVisibleAccessRecord() {
      return accessRecord();
    },
    async listReceipts() {
      return [
        { userId, lastReadSeq: 5 },
        { userId: participantUserId, lastReadSeq: 2 }
      ];
    }
  });
  const service = createConversationService(repo, {
    driveFiles: driveFiles(async () => {
      throw new Error("Drive must not be called");
    }),
    now: () => now
  });

  const result = await service.listReceipts({ actor: actor(), conversationId });
  assert.deepEqual(result, {
    receipts: [
      { user_id: userId, last_read_seq: 5 },
      { user_id: participantUserId, last_read_seq: 2 }
    ]
  });
});

test("R14 listPins enriches pinned rows and returns the pins VM", async () => {
  const repo = repository({
    async findVisibleAccessRecord() {
      return accessRecord();
    },
    async listPins() {
      return [messageRow({ seq: 4, pinnedAt: now, pinnedByUserId: userId })];
    }
  });
  const service = createConversationService(repo, {
    driveFiles: driveFiles(async () => {
      throw new Error("Drive must not be called");
    }),
    now: () => now
  });

  const result = await service.listPins({ actor: actor(), conversationId });
  assert.equal(result.messages.length, 1);
  assert.deepEqual(result.messages[0]?.pinned, { at: now.toISOString(), by_user_id: userId });
});

test("R14 listMessages normalizes deleted rows into text tombstones for the client", async () => {
  const repo = repository({
    async findVisibleAccessRecord() {
      return accessRecord();
    },
    async listMessagesAfter() {
      return {
        rows: [messageRow({ seq: 2, kind: "file_card", contentJson: {}, deletedAt: now, deletedByUserId: userId })],
        hasMore: false,
        nextAfterSeq: 2
      };
    }
  });
  const service = createConversationService(repo, {
    driveFiles: driveFiles(async () => {
      throw new Error("Drive must not be called");
    }),
    now: () => now
  });

  const page = await service.listMessages({ actor: actor(), conversationId, query: { afterSeq: 0, limit: 50 } });
  assert.equal(page.messages.length, 1);
  assert.equal(page.messages[0]?.kind, "text");
  assert.deepEqual(page.messages[0]?.content, { text: "" });
  assert.equal(page.messages[0]?.deleted_at, now.toISOString());
});

test("R14 createMessage forwards reply_to and enriches the reply preview onto the VM", async () => {
  const created = messageRow({ replyToMessageId: otherMessageId });
  let writeInput: unknown;
  const repo = repository({
    async findVisibleAccessRecord() {
      return accessRecord();
    },
    async createUserMessage(input) {
      writeInput = input;
      return created;
    },
    async listReplyPreviews() {
      return new Map([
        [
          otherMessageId,
          {
            id: otherMessageId,
            senderType: "user" as const,
            senderUserId: participantUserId,
            kind: "text" as const,
            contentJson: { text: "原始消息" },
            deletedAt: null
          }
        ]
      ]);
    }
  });
  const service = createConversationService(repo, {
    driveFiles: driveFiles(async () => {
      throw new Error("Drive must not be called");
    }),
    bus: capturingBus().bus,
    now: () => now
  });

  const vm = await service.createMessage({
    actor: actor(),
    conversationId,
    payload: { kind: "text", content: { text: "回复你" }, reply_to_message_id: otherMessageId }
  });

  assert.equal((writeInput as { replyToMessageId?: string }).replyToMessageId, otherMessageId);
  assert.deepEqual(vm.reply_to, {
    message_id: otherMessageId,
    sender_type: "user",
    sender_user_id: participantUserId,
    preview_text: "原始消息",
    deleted: false
  });
});

// ── R14FIX 批 workbench：协同会话改名 ──────────────────────────────────────────────────

test("renameConversation forwards a tenant-safe title write and returns the renamed collab VM", async () => {
  let renameInput: unknown;
  const service = createConversationService(
    repository({
      async findVisibleAccessRecord() {
        return accessRecord({ participantRole: "owner" });
      },
      async renameConversation(input) {
        renameInput = input;
        return conversationRow({ title: input.title, updatedAt: new Date("2026-07-15T09:00:00.000Z") });
      }
    }),
    {
      driveFiles: driveFiles(async () => {
        throw new Error("Drive must not be called");
      }),
      now: () => now
    }
  );

  const result = await service.renameConversation({
    actor: actor(),
    conversationId,
    payload: { title: "改第三幕" }
  });

  assert.deepEqual(renameInput, {
    workspaceId,
    conversationId,
    title: "改第三幕",
    at: now
  });
  assert.equal(result.conversation.title, "改第三幕");
  assert.equal(result.conversation.kind, "collab");
  assert.equal(result.conversation.participant_role, "owner");
});

test("renameConversation refuses a non-collab (main) conversation with 403 and never writes", async () => {
  let renameCalls = 0;
  const service = createConversationService(
    repository({
      async findVisibleAccessRecord() {
        return accessRecord({ conversation: conversationRow({ kind: "main" }), participantRole: null });
      },
      async renameConversation() {
        renameCalls += 1;
        throw new Error("main conversations must not be renamed");
      }
    }),
    {
      driveFiles: driveFiles(async () => {
        throw new Error("Drive must not be called");
      }),
      now: () => now
    }
  );

  await assert.rejects(
    () => service.renameConversation({ actor: actor(), conversationId, payload: { title: "改名" } }),
    (error: unknown) =>
      error instanceof ConversationServiceError &&
      error.status === 403 &&
      error.code === "conversation_rename_forbidden"
  );
  assert.equal(renameCalls, 0);
});

test("renameConversation refuses a non-participant viewer with 403 and never writes", async () => {
  let renameCalls = 0;
  const service = createConversationService(
    repository({
      async findVisibleAccessRecord() {
        // A project-visible collab that this viewer can see but is not a participant of.
        return accessRecord({ participantRole: null });
      },
      async renameConversation() {
        renameCalls += 1;
        throw new Error("non-participants must not rename");
      }
    }),
    {
      driveFiles: driveFiles(async () => {
        throw new Error("Drive must not be called");
      }),
      now: () => now
    }
  );

  await assert.rejects(
    () => service.renameConversation({ actor: actor(), conversationId, payload: { title: "改名" } }),
    (error: unknown) =>
      error instanceof ConversationServiceError &&
      error.status === 403 &&
      error.code === "conversation_rename_forbidden"
  );
  assert.equal(renameCalls, 0);
});

test("renameConversation 404s an invisible conversation before any write", async () => {
  let renameCalls = 0;
  const service = createConversationService(
    repository({
      async findVisibleAccessRecord() {
        return null;
      },
      async renameConversation() {
        renameCalls += 1;
        throw new Error("invisible conversations must not be renamed");
      }
    }),
    {
      driveFiles: driveFiles(async () => {
        throw new Error("Drive must not be called");
      }),
      now: () => now
    }
  );

  await assert.rejects(
    () => service.renameConversation({ actor: actor(), conversationId, payload: { title: "改名" } }),
    (error: unknown) =>
      error instanceof ConversationServiceError &&
      error.status === 404 &&
      error.code === "conversation_not_found"
  );
  assert.equal(renameCalls, 0);
});

// ── R15 批 cuu-toggle：会话级 Cuu 开关翻转 + 参与者列表 ─────────────────────────────────

test("updateCuuEnabled forwards a tenant-safe write, broadcasts cuu.updated, and returns the flipped VM", async () => {
  let writeInput: unknown;
  const capture = capturingBus();
  const service = createConversationService(
    repository({
      async findVisibleAccessRecord() {
        return accessRecord({ participantRole: "owner" });
      },
      async updateCuuEnabled(input) {
        writeInput = input;
        return conversationRow({ cuuEnabled: input.enabled, updatedAt: new Date("2026-07-15T09:00:00.000Z") });
      }
    }),
    {
      driveFiles: driveFiles(async () => {
        throw new Error("Drive must not be called");
      }),
      bus: capture.bus,
      now: () => now
    }
  );

  const result = await service.updateCuuEnabled({
    actor: actor(),
    conversationId,
    payload: { enabled: false }
  });

  assert.deepEqual(writeInput, {
    workspaceId,
    conversationId,
    enabled: false,
    at: now
  });
  assert.equal(result.conversation.cuu_enabled, false);
  assert.equal(result.conversation.participant_role, "owner");
  assert.equal(capture.published[0]?.type, "conversation.cuu.updated");
  const publishedEvent = capture.published[0]?.data as { data: { conversation_id: string; cuu_enabled: boolean } };
  assert.deepEqual(publishedEvent.data, { conversation_id: conversationId, cuu_enabled: false });
});

test("updateCuuEnabled toggling twice to the same value is idempotent (no special-casing, both calls write)", async () => {
  let writeCalls = 0;
  const service = createConversationService(
    repository({
      async findVisibleAccessRecord() {
        return accessRecord({ participantRole: "member" });
      },
      async updateCuuEnabled(input) {
        writeCalls += 1;
        return conversationRow({ cuuEnabled: input.enabled });
      }
    }),
    {
      driveFiles: driveFiles(async () => {
        throw new Error("Drive must not be called");
      }),
      now: () => now
    }
  );

  const first = await service.updateCuuEnabled({ actor: actor(), conversationId, payload: { enabled: true } });
  const second = await service.updateCuuEnabled({ actor: actor(), conversationId, payload: { enabled: true } });

  assert.equal(first.conversation.cuu_enabled, true);
  assert.equal(second.conversation.cuu_enabled, true);
  assert.equal(writeCalls, 2);
});

test("updateCuuEnabled refuses a non-collab (main) conversation with 409 and never writes", async () => {
  let writeCalls = 0;
  const service = createConversationService(
    repository({
      async findVisibleAccessRecord() {
        return accessRecord({ conversation: conversationRow({ kind: "main" }), participantRole: null });
      },
      async updateCuuEnabled() {
        writeCalls += 1;
        throw new Error("main conversations must not toggle cuu_enabled");
      }
    }),
    {
      driveFiles: driveFiles(async () => {
        throw new Error("Drive must not be called");
      }),
      now: () => now
    }
  );

  await assert.rejects(
    () => service.updateCuuEnabled({ actor: actor(), conversationId, payload: { enabled: true } }),
    (error: unknown) =>
      error instanceof ConversationServiceError &&
      error.status === 409 &&
      error.code === "conversation_cuu_not_collab"
  );
  assert.equal(writeCalls, 0);
});

test("updateCuuEnabled refuses a non-participant viewer with 403 and never writes", async () => {
  let writeCalls = 0;
  const service = createConversationService(
    repository({
      async findVisibleAccessRecord() {
        // A project-visible collab that this viewer can see but is not a participant of.
        return accessRecord({ participantRole: null });
      },
      async updateCuuEnabled() {
        writeCalls += 1;
        throw new Error("non-participants must not toggle cuu_enabled");
      }
    }),
    {
      driveFiles: driveFiles(async () => {
        throw new Error("Drive must not be called");
      }),
      now: () => now
    }
  );

  await assert.rejects(
    () => service.updateCuuEnabled({ actor: actor(), conversationId, payload: { enabled: true } }),
    (error: unknown) =>
      error instanceof ConversationServiceError &&
      error.status === 403 &&
      error.code === "conversation_cuu_forbidden"
  );
  assert.equal(writeCalls, 0);
});

test("updateCuuEnabled 404s an invisible conversation before any write", async () => {
  let writeCalls = 0;
  const service = createConversationService(
    repository({
      async findVisibleAccessRecord() {
        return null;
      },
      async updateCuuEnabled() {
        writeCalls += 1;
        throw new Error("invisible conversations must not toggle cuu_enabled");
      }
    }),
    {
      driveFiles: driveFiles(async () => {
        throw new Error("Drive must not be called");
      }),
      now: () => now
    }
  );

  await assert.rejects(
    () => service.updateCuuEnabled({ actor: actor(), conversationId, payload: { enabled: true } }),
    (error: unknown) =>
      error instanceof ConversationServiceError &&
      error.status === 404 &&
      error.code === "conversation_not_found"
  );
  assert.equal(writeCalls, 0);
});

test("listParticipants returns scope=workspace with an empty list for the main conversation without querying the repository", async () => {
  let listCalls = 0;
  const service = createConversationService(
    repository({
      async findVisibleAccessRecord() {
        return accessRecord({ conversation: conversationRow({ kind: "main" }), participantRole: null });
      },
      async listParticipantsWithNickname() {
        listCalls += 1;
        return [];
      }
    }),
    {
      driveFiles: driveFiles(async () => {
        throw new Error("Drive must not be called");
      }),
      now: () => now
    }
  );

  const result = await service.listParticipants({ actor: actor(), conversationId });

  assert.deepEqual(result, { scope: "workspace", participants: [] });
  assert.equal(listCalls, 0);
});

test("listParticipants returns scope=participants with real rows for a collab (and DM) conversation", async () => {
  const service = createConversationService(
    repository({
      async findVisibleAccessRecord() {
        return accessRecord({ participantRole: "owner" });
      },
      async listParticipantsWithNickname(input) {
        assert.equal(input.conversationId, conversationId);
        return [
          { userId, nickname: "阿曼", role: "owner" },
          { userId: participantUserId, nickname: "小赵", role: "member" }
        ];
      }
    }),
    {
      driveFiles: driveFiles(async () => {
        throw new Error("Drive must not be called");
      }),
      now: () => now
    }
  );

  const result = await service.listParticipants({ actor: actor(), conversationId });

  assert.deepEqual(result, {
    scope: "participants",
    participants: [
      { user_id: userId, nickname: "阿曼", role: "owner" },
      { user_id: participantUserId, nickname: "小赵", role: "member" }
    ]
  });
});

test("listParticipants 404s an invisible (or non-participant) conversation before any query", async () => {
  let listCalls = 0;
  const service = createConversationService(
    repository({
      async findVisibleAccessRecord() {
        return null;
      },
      async listParticipantsWithNickname() {
        listCalls += 1;
        return [];
      }
    }),
    {
      driveFiles: driveFiles(async () => {
        throw new Error("Drive must not be called");
      }),
      now: () => now
    }
  );

  await assert.rejects(
    () => service.listParticipants({ actor: actor(), conversationId }),
    (error: unknown) =>
      error instanceof ConversationServiceError &&
      error.status === 404 &&
      error.code === "conversation_not_found"
  );
  assert.equal(listCalls, 0);
});
