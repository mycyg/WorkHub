import assert from "node:assert/strict";
import test from "node:test";

import {
  ConversationAccessDeniedError,
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
import { DrivePageServiceError, type DrivePageService } from "./services/drive-pages.js";
import {
  ConversationServiceError,
  createConversationService
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
    createdAt: now,
    ...overrides
  };
}

function accessRecord(overrides: Partial<ConversationAccessRecord> = {}): ConversationAccessRecord {
  return {
    conversation: conversationRow(),
    projectOwnerUserId: userId,
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
