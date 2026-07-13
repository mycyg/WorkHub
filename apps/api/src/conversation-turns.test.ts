import assert from "node:assert/strict";
import test from "node:test";

import type {
  ConversationAccessRecord,
  ConversationMessageRow,
  ConversationRow,
  TeamSkillRow,
  UserAiProfileRow,
  UserMemoryRow
} from "@workhub/db";

import {
  ConversationTurnServiceError,
  createConversationTurnService,
  type ConversationTurnClientProvider,
  type ConversationTurnResultVM,
  type ConversationTurnServiceDeps,
  type TurnLlmFinalMessage,
  type TurnLlmStream,
  type TurnLlmStreamEvent
} from "./services/conversation-turns.js";
import type { AuthActor } from "./middleware/auth.js";

// conversationMessageVmSchema 的 message 是按 kind 判别的联合类型；测试只关心本批唯一会产出的
// text 分支，这里窄化一次，避免每处断言都要重复 assert kind 再做类型断言。
function textContent(
  message: ConversationTurnResultVM["message"]
): { text: string; memory_citations?: Array<{ kind: "user_memory" | "team_skill"; title: string }> | undefined } {
  assert.equal(message.kind, "text");
  if (message.kind !== "text") {
    throw new Error("unreachable");
  }
  return message.content;
}

const now = new Date("2026-07-12T09:00:00.000Z");
const workspaceId = "14000000-0000-4000-8000-000000000001";
const projectId = "14000000-0000-4000-8000-000000000002";
const conversationId = "14000000-0000-4000-8000-000000000003";
const userId = "14000000-0000-4000-8000-000000000004";
const otherUserId = "14000000-0000-4000-8000-000000000005";
const userMessageId = "14000000-0000-4000-8000-000000000006";
const cuuMessageId = "14000000-0000-4000-8000-000000000007";
const turnId = "14000000-0000-4000-8000-000000000009";

function actor(overrides: Partial<AuthActor> = {}): AuthActor {
  return {
    kind: "human",
    id: userId,
    label: "阿曼",
    userId,
    isAdmin: false,
    orgId: "org-1",
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
    title: "和 Cuu 单聊",
    parentConversationId: null,
    sourceMessageId: null,
    visibility: "private",
    nextSeq: 2,
    createdBy: userId,
    deletedAt: null,
    deletedByUserId: null,
    createdAt: now,
    updatedAt: now,
    ...overrides
  } as ConversationRow;
}

function accessRecord(overrides: Partial<ConversationAccessRecord> = {}): ConversationAccessRecord {
  return {
    conversation: conversationRow(),
    projectOwnerUserId: userId,
    membershipRole: "member",
    participantRole: "owner",
    ...overrides
  };
}

function userMessageRow(overrides: Partial<ConversationMessageRow> = {}): ConversationMessageRow {
  return {
    id: userMessageId,
    conversationId,
    seq: 1,
    senderType: "user",
    senderUserId: userId,
    kind: "text",
    contentJson: { text: "帮我看看这段草稿写得怎么样" },
    threadRootId: null,
    createdAt: now,
    ...overrides
  } as ConversationMessageRow;
}

function cuuMessageRow(overrides: Partial<ConversationMessageRow> = {}): ConversationMessageRow {
  return {
    id: cuuMessageId,
    conversationId,
    seq: 2,
    senderType: "cuu",
    senderUserId: null,
    kind: "text",
    contentJson: { text: "看过了，整体不错" },
    threadRootId: null,
    createdAt: now,
    ...overrides
  } as ConversationMessageRow;
}

function userMemoryRow(overrides: Partial<UserMemoryRow> = {}): UserMemoryRow {
  return {
    id: "15000000-0000-4000-8000-000000000001",
    userId,
    workspaceId,
    category: "preference",
    key: "preference:zh",
    valueMd: "偏好中文回复",
    confidence: 0.8,
    sourceRunId: null,
    lastUsedAt: null,
    expiresAt: null,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides
  } as UserMemoryRow;
}

function teamSkillRow(overrides: Partial<TeamSkillRow> = {}): TeamSkillRow {
  return {
    id: "16000000-0000-4000-8000-000000000001",
    workspaceId,
    skillKey: "ppt-review",
    name: "PPT 交付自检",
    whenToUse: "生成对外演示文稿前",
    contentMd: "……",
    status: "active",
    version: 1,
    sourceKind: "distilled",
    createdByKind: "ai",
    confidenceScore: 0.7,
    sampleCount: 3,
    samplesJson: {},
    sourceRunId: null,
    deprecatedReason: null,
    deprecatedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides
  } as TeamSkillRow;
}

function userAiProfileRow(overrides: Partial<UserAiProfileRow> = {}): UserAiProfileRow {
  return {
    workspaceId,
    userId,
    defaultMode: 3,
    granularJson: {},
    dispatchPolicy: "auto",
    cuuProactivity: "balanced",
    modelTierPref: null,
    createdAt: now,
    updatedAt: now,
    ...overrides
  } as UserAiProfileRow;
}

function textDeltaEvent(text: string): TurnLlmStreamEvent {
  return { type: "content_block_delta", data: { delta: { type: "text_delta", text } } };
}

function fakeStream(events: TurnLlmStreamEvent[], finalText: string): TurnLlmStream {
  const final: TurnLlmFinalMessage = { content: [{ type: "text", text: finalText }] };
  return {
    [Symbol.asyncIterator]() {
      let index = 0;
      return {
        async next() {
          if (index >= events.length) {
            return { value: undefined as unknown as TurnLlmStreamEvent, done: true as const };
          }
          const value = events[index]!;
          index += 1;
          return { value, done: false as const };
        }
      };
    },
    async getFinalMessage() {
      return final;
    }
  };
}

function respondingClient(events: TurnLlmStreamEvent[], finalText: string, spy?: unknown[]): ConversationTurnClientProvider {
  return async (input) => {
    spy?.push(input);
    return {
      messages: {
        async stream(params) {
          spy?.push(params);
          return fakeStream(events, finalText);
        }
      }
    };
  };
}

function throwingClient(): ConversationTurnClientProvider {
  return async () => ({
    messages: {
      async stream() {
        throw new Error("provider unavailable");
      }
    }
  });
}

function hangingUntilAbortedClient(): ConversationTurnClientProvider {
  return async () => ({
    messages: {
      async stream(params) {
        return new Promise((_, reject) => {
          params.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        });
      }
    }
  });
}

function baseDeps(overrides: Partial<ConversationTurnServiceDeps> = {}): ConversationTurnServiceDeps {
  const defaults: ConversationTurnServiceDeps = {
    conversations: {
      async findVisibleAccessRecord() {
        return accessRecord();
      },
      async listMessagesAfter() {
        return { rows: [userMessageRow()], hasMore: false, nextAfterSeq: 1 };
      },
      // 回显实际写入的 contentJson——同真实仓库的行为一致，让下游断言看到的是这一轮真正生成的文本/
      // 引用清单，而不是一个跟输入脱节的固定夹具。
      async createCuuMessage(input) {
        return cuuMessageRow({ contentJson: input.contentJson });
      }
    },
    aiSettings: {
      async findUserProfileAccessRecord() {
        return { membershipRole: "member", profile: userAiProfileRow() };
      }
    },
    userMemories: {
      async listForUser() {
        return [userMemoryRow()];
      },
      async touch() {}
    },
    teamSkills: {
      async listActive() {
        return [teamSkillRow()];
      }
    },
    nicknames: async () => new Map([[userId, "阿曼"]]),
    client: respondingClient([textDeltaEvent("看过了，"), textDeltaEvent("整体不错")], "看过了，整体不错"),
    policyStore: { listPolicies: () => [] },
    ledgerStore: { usageSnapshots: async () => [] },
    now: () => now,
    id: () => turnId,
    bus: { publish: async () => {} },
    logger: { warn: () => {} },
    turnTimeoutMs: 5_000,
    ...overrides
  };
  return defaults;
}

test("createTurn rejects non-human actors before touching the repository", async () => {
  const service = createConversationTurnService(
    baseDeps({
      conversations: {
        async findVisibleAccessRecord() {
          throw new Error("must not be called");
        },
        async listMessagesAfter() {
          throw new Error("must not be called");
        },
        async createCuuMessage() {
          throw new Error("must not be called");
        }
      }
    })
  );

  await assert.rejects(
    service.createTurn({
      actor: { kind: "ai", id: userId, label: "阿曼", isAdmin: false, orgId: "org-1", workspaceId },
      conversationId,
      payload: { user_message_id: userMessageId }
    }),
    (error: unknown) => error instanceof ConversationTurnServiceError && error.status === 403 && error.code === "human_required"
  );
});

test("createTurn 404s when the conversation is not visible to the actor", async () => {
  const service = createConversationTurnService(
    baseDeps({
      conversations: {
        async findVisibleAccessRecord() {
          return null;
        },
        async listMessagesAfter() {
          throw new Error("must not be called");
        },
        async createCuuMessage() {
          throw new Error("must not be called");
        }
      }
    })
  );

  await assert.rejects(
    service.createTurn({ actor: actor(), conversationId, payload: { user_message_id: userMessageId } }),
    (error: unknown) => error instanceof ConversationTurnServiceError && error.status === 404 && error.code === "conversation_not_found"
  );
});

test("createTurn rejects the project main conversation with 409 conversation_turn_not_collab", async () => {
  let llmCalled = false;
  const service = createConversationTurnService(
    baseDeps({
      conversations: {
        async findVisibleAccessRecord() {
          return accessRecord({ conversation: conversationRow({ kind: "main" }) });
        },
        async listMessagesAfter() {
          throw new Error("must not be called");
        },
        async createCuuMessage() {
          throw new Error("must not be called");
        }
      },
      client: async () => {
        llmCalled = true;
        throw new Error("must not be called");
      }
    })
  );

  await assert.rejects(
    service.createTurn({ actor: actor(), conversationId, payload: { user_message_id: userMessageId } }),
    (error: unknown) => error instanceof ConversationTurnServiceError && error.status === 409 && error.code === "conversation_turn_not_collab"
  );
  assert.equal(llmCalled, false);
});

test("createTurn rejects mode=1 (observe-only) with 409 conversation_turn_mode_observe_only and never calls the LLM", async () => {
  let llmCalled = false;
  const service = createConversationTurnService(
    baseDeps({
      aiSettings: {
        async findUserProfileAccessRecord() {
          return { membershipRole: "member", profile: userAiProfileRow({ defaultMode: 1 }) };
        }
      },
      client: async () => {
        llmCalled = true;
        throw new Error("must not be called");
      }
    })
  );

  await assert.rejects(
    service.createTurn({ actor: actor(), conversationId, payload: { user_message_id: userMessageId } }),
    (error: unknown) =>
      error instanceof ConversationTurnServiceError && error.status === 409 && error.code === "conversation_turn_mode_observe_only"
  );
  assert.equal(llmCalled, false);
});

test("createTurn allows modes 2 through 5 to run a plain chat turn", async () => {
  for (const mode of [2, 3, 4, 5] as const) {
    const service = createConversationTurnService(
      baseDeps({
        aiSettings: {
          async findUserProfileAccessRecord() {
            return { membershipRole: "member", profile: userAiProfileRow({ defaultMode: mode }) };
          }
        }
      })
    );
    const result = await service.createTurn({ actor: actor(), conversationId, payload: { user_message_id: userMessageId } });
    assert.equal(textContent(result.message).text, "看过了，整体不错");
  }
});

test("createTurn falls back to the default mode (3) when the actor has no ai profile row yet", async () => {
  const service = createConversationTurnService(
    baseDeps({
      aiSettings: {
        async findUserProfileAccessRecord() {
          return { membershipRole: "member", profile: null };
        }
      }
    })
  );
  const result = await service.createTurn({ actor: actor(), conversationId, payload: { user_message_id: userMessageId } });
  assert.equal(result.message.sender_type, "cuu");
});

test("createTurn 404s when user_message_id is not in the recent window", async () => {
  const service = createConversationTurnService(baseDeps());
  await assert.rejects(
    service.createTurn({ actor: actor(), conversationId, payload: { user_message_id: "14000000-0000-4000-8000-000000000099" } }),
    (error: unknown) =>
      error instanceof ConversationTurnServiceError && error.status === 404 && error.code === "conversation_turn_message_not_found"
  );
});

test("createTurn 404s when the referenced message exists but was sent by someone else", async () => {
  const service = createConversationTurnService(
    baseDeps({
      conversations: {
        async findVisibleAccessRecord() {
          return accessRecord();
        },
        async listMessagesAfter() {
          return { rows: [userMessageRow({ senderUserId: otherUserId })], hasMore: false, nextAfterSeq: 1 };
        },
        async createCuuMessage() {
          throw new Error("must not be called");
        }
      }
    })
  );
  await assert.rejects(
    service.createTurn({ actor: actor(), conversationId, payload: { user_message_id: userMessageId } }),
    (error: unknown) =>
      error instanceof ConversationTurnServiceError && error.status === 404 && error.code === "conversation_turn_message_not_found"
  );
});

test("createTurn 404s when the referenced id belongs to a cuu-authored message, not a user message", async () => {
  const service = createConversationTurnService(
    baseDeps({
      conversations: {
        async findVisibleAccessRecord() {
          return accessRecord();
        },
        async listMessagesAfter() {
          return { rows: [cuuMessageRow({ id: userMessageId })], hasMore: false, nextAfterSeq: 1 };
        },
        async createCuuMessage() {
          throw new Error("must not be called");
        }
      }
    })
  );
  await assert.rejects(
    service.createTurn({ actor: actor(), conversationId, payload: { user_message_id: userMessageId } }),
    (error: unknown) =>
      error instanceof ConversationTurnServiceError && error.status === 404 && error.code === "conversation_turn_message_not_found"
  );
});

test("createTurn returns 429 conversation_turn_budget_exhausted and never calls the LLM when the soft budget gate blocks", async () => {
  let llmCalled = false;
  const service = createConversationTurnService(
    baseDeps({
      policyStore: {
        listPolicies: () => [
          {
            id: "p1",
            scopeKind: "team" as const,
            period: "day" as const,
            maxTokens: 1000,
            maxCostCny: "1",
            warningRatio: 0.7,
            criticalRatio: 0.9,
            onWarning: "notify" as const,
            onExhausted: "block_new_run" as const,
            enabled: true,
            version: 1
          }
        ]
      },
      ledgerStore: {
        usageSnapshots: async () => [
          {
            scope: { kind: "team" as const, teamId: workspaceId },
            tokenIn: 10,
            tokenOut: 10,
            estimatedCostCny: "5"
          }
        ]
      },
      client: async () => {
        llmCalled = true;
        throw new Error("must not be called");
      }
    })
  );

  await assert.rejects(
    service.createTurn({ actor: actor(), conversationId, payload: { user_message_id: userMessageId } }),
    (error: unknown) =>
      error instanceof ConversationTurnServiceError && error.status === 429 && error.code === "conversation_turn_budget_exhausted"
  );
  assert.equal(llmCalled, false);
});

test("createTurn streams ordinal-numbered delta events on the conversation topic and persists the final cuu message with citations", async () => {
  const published: Array<{ topic: string; type: string; data: unknown }> = [];
  const createCuuMessageCalls: unknown[] = [];
  const service = createConversationTurnService(
    baseDeps({
      conversations: {
        async findVisibleAccessRecord() {
          return accessRecord();
        },
        async listMessagesAfter() {
          return { rows: [userMessageRow()], hasMore: false, nextAfterSeq: 1 };
        },
        async createCuuMessage(input) {
          createCuuMessageCalls.push(input);
          return cuuMessageRow({ contentJson: input.contentJson });
        }
      },
      bus: {
        async publish(topic, type, data) {
          published.push({ topic, type, data });
        }
      }
    })
  );

  const result = await service.createTurn({ actor: actor(), conversationId, payload: { user_message_id: userMessageId } });

  assert.equal(result.turn_id, turnId);
  assert.equal(result.message.sender_type, "cuu");
  assert.equal(textContent(result.message).text, "看过了，整体不错");
  assert.deepEqual(textContent(result.message).memory_citations, [
    { kind: "user_memory", title: "preference:zh" },
    { kind: "team_skill", title: "PPT 交付自检" }
  ]);

  // R12 批4a 集成修订:2 条瞬态 delta 之后,落库的 Cuu 回复还要广播 1 条 message.created(ai actor),
  // 其他在看成员靠它拿到真 seq/id,不再只能看打字动画。
  assert.equal(published.length, 3);
  assert.equal(published[0]?.topic, `conversation:${conversationId}`);
  assert.equal(published[0]?.type, "conversation.message.delta");
  const firstData = published[0]?.data as { data: { ordinal: number; delta_text: string; turn_id: string } };
  assert.equal(firstData.data.ordinal, 0);
  assert.equal(firstData.data.delta_text, "看过了，");
  assert.equal(firstData.data.turn_id, turnId);
  const secondData = published[1]?.data as { data: { ordinal: number; delta_text: string } };
  assert.equal(secondData.data.ordinal, 1);
  assert.equal(secondData.data.delta_text, "整体不错");
  assert.equal(published[2]?.topic, `conversation:${conversationId}`);
  assert.equal(published[2]?.type, "conversation.message.created");
  const createdData = published[2]?.data as {
    actor: { actor_kind: string; label?: string };
    data: { sender_type: string; sender_user_id: string | null; seq: number };
  };
  assert.equal(createdData.actor.actor_kind, "ai");
  assert.equal(createdData.data.sender_type, "cuu");
  assert.equal(createdData.data.sender_user_id, null);
  assert.equal(typeof createdData.data.seq, "number");

  assert.equal(createCuuMessageCalls.length, 1);
  const persistInput = createCuuMessageCalls[0] as { workspaceId: string; conversationId: string; contentJson: { text: string } };
  assert.equal(persistInput.workspaceId, workspaceId);
  assert.equal(persistInput.conversationId, conversationId);
  assert.equal(persistInput.contentJson.text, "看过了，整体不错");
});

test("createTurn caps injected user memories at USER_MEMORY_PROMPT_TOP_N and team skills at the top-5 slice", async () => {
  const listForUserCalls: unknown[] = [];
  const manyTeamSkills = Array.from({ length: 8 }, (_, index) =>
    teamSkillRow({ id: `skill-${index}`, skillKey: `skill-${index}`, name: `技能 ${index}` })
  );
  const service = createConversationTurnService(
    baseDeps({
      userMemories: {
        async listForUser(actorId, options) {
          listForUserCalls.push({ actorId, options });
          return [userMemoryRow()];
        },
        async touch() {}
      },
      teamSkills: {
        async listActive() {
          return manyTeamSkills;
        }
      }
    })
  );

  const result = await service.createTurn({ actor: actor(), conversationId, payload: { user_message_id: userMessageId } });

  assert.equal(listForUserCalls.length, 1);
  const call = listForUserCalls[0] as { options: { limit: number } };
  assert.equal(call.options.limit, 5);
  const citations = textContent(result.message).memory_citations ?? [];
  const teamSkillCitations = citations.filter((citation) => citation.kind === "team_skill");
  assert.equal(teamSkillCitations.length, 5);
});

test("createTurn touches injected user memories and swallows a touch failure without failing the turn", async () => {
  const touchedIds: unknown[] = [];
  const service = createConversationTurnService(
    baseDeps({
      userMemories: {
        async listForUser() {
          return [userMemoryRow()];
        },
        async touch(ids) {
          touchedIds.push(ids);
          throw new Error("touch failed");
        }
      }
    })
  );

  const result = await service.createTurn({ actor: actor(), conversationId, payload: { user_message_id: userMessageId } });
  assert.equal(result.message.sender_type, "cuu");
  assert.deepEqual(touchedIds, [[userMemoryRow().id]]);
});

test("createTurn returns 500 conversation_turn_failed and persists nothing when the LLM call throws", async () => {
  const createCuuMessageCalls: unknown[] = [];
  const service = createConversationTurnService(
    baseDeps({
      conversations: {
        async findVisibleAccessRecord() {
          return accessRecord();
        },
        async listMessagesAfter() {
          return { rows: [userMessageRow()], hasMore: false, nextAfterSeq: 1 };
        },
        async createCuuMessage(input) {
          createCuuMessageCalls.push(input);
          return cuuMessageRow();
        }
      },
      client: throwingClient()
    })
  );

  await assert.rejects(
    service.createTurn({ actor: actor(), conversationId, payload: { user_message_id: userMessageId } }),
    (error: unknown) => error instanceof ConversationTurnServiceError && error.status === 500 && error.code === "conversation_turn_failed"
  );
  assert.equal(createCuuMessageCalls.length, 0);
});

test("createTurn returns 500 conversation_turn_failed on the 60s hard timeout and persists nothing", async () => {
  const createCuuMessageCalls: unknown[] = [];
  const service = createConversationTurnService(
    baseDeps({
      conversations: {
        async findVisibleAccessRecord() {
          return accessRecord();
        },
        async listMessagesAfter() {
          return { rows: [userMessageRow()], hasMore: false, nextAfterSeq: 1 };
        },
        async createCuuMessage(input) {
          createCuuMessageCalls.push(input);
          return cuuMessageRow();
        }
      },
      client: hangingUntilAbortedClient(),
      turnTimeoutMs: 5
    })
  );

  await assert.rejects(
    service.createTurn({ actor: actor(), conversationId, payload: { user_message_id: userMessageId } }),
    (error: unknown) => error instanceof ConversationTurnServiceError && error.status === 500 && error.code === "conversation_turn_failed"
  );
  assert.equal(createCuuMessageCalls.length, 0);
});

test("createTurn returns 500 conversation_turn_failed when the model returns no text and persists nothing", async () => {
  const createCuuMessageCalls: unknown[] = [];
  const service = createConversationTurnService(
    baseDeps({
      conversations: {
        async findVisibleAccessRecord() {
          return accessRecord();
        },
        async listMessagesAfter() {
          return { rows: [userMessageRow()], hasMore: false, nextAfterSeq: 1 };
        },
        async createCuuMessage(input) {
          createCuuMessageCalls.push(input);
          return cuuMessageRow();
        }
      },
      client: respondingClient([], "   ")
    })
  );

  await assert.rejects(
    service.createTurn({ actor: actor(), conversationId, payload: { user_message_id: userMessageId } }),
    (error: unknown) => error instanceof ConversationTurnServiceError && error.status === 500 && error.code === "conversation_turn_failed"
  );
  assert.equal(createCuuMessageCalls.length, 0);
});

test("createTurn returns 500 conversation_turn_failed when persistence fails after a successful LLM call", async () => {
  const service = createConversationTurnService(
    baseDeps({
      conversations: {
        async findVisibleAccessRecord() {
          return accessRecord();
        },
        async listMessagesAfter() {
          return { rows: [userMessageRow()], hasMore: false, nextAfterSeq: 1 };
        },
        async createCuuMessage() {
          throw new Error("db write failed");
        }
      }
    })
  );

  await assert.rejects(
    service.createTurn({ actor: actor(), conversationId, payload: { user_message_id: userMessageId } }),
    (error: unknown) => error instanceof ConversationTurnServiceError && error.status === 500 && error.code === "conversation_turn_failed"
  );
});

test("createTurn only allows one in-progress turn per conversation and releases the slot once it settles", async () => {
  let releaseFirst: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const service = createConversationTurnService(
    baseDeps({
      client: async () => ({
        messages: {
          async stream() {
            await gate;
            return fakeStream([], "第一轮回复");
          }
        }
      })
    })
  );

  const first = service.createTurn({ actor: actor(), conversationId, payload: { user_message_id: userMessageId } });
  const second = service.createTurn({ actor: actor(), conversationId, payload: { user_message_id: userMessageId } });

  await assert.rejects(
    second,
    (error: unknown) => error instanceof ConversationTurnServiceError && error.status === 409 && error.code === "conversation_turn_busy"
  );

  releaseFirst?.();
  const firstResult = await first;
  assert.equal(textContent(firstResult.message).text, "第一轮回复");

  // 忙碌位已释放：紧接着的第三次调用应当正常跑完，而不是继续 409。
  const third = await service.createTurn({ actor: actor(), conversationId, payload: { user_message_id: userMessageId } });
  assert.equal(third.message.sender_type, "cuu");
});

test("createTurn does not cross-block two different conversations", async () => {
  let releaseFirst: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const otherConversationId = "14000000-0000-4000-8000-000000000008";
  const service = createConversationTurnService(
    baseDeps({
      conversations: {
        async findVisibleAccessRecord(input) {
          return accessRecord({ conversation: conversationRow({ id: input.conversationId }) });
        },
        // 挂在 listMessagesAfter 上按 conversationId 精确门控，而不是靠 client provider 的调用顺序猜时序
        // （client provider 拿不到 conversationId，且两条链路的微任务交错顺序本就不该被测试依赖）。
        async listMessagesAfter(input) {
          if (input.conversationId === conversationId) {
            await gate;
          }
          return { rows: [userMessageRow()], hasMore: false, nextAfterSeq: 1 };
        },
        async createCuuMessage() {
          return cuuMessageRow();
        }
      }
    })
  );

  const first = service.createTurn({ actor: actor(), conversationId, payload: { user_message_id: userMessageId } });
  const other = await service.createTurn({ actor: actor(), conversationId: otherConversationId, payload: { user_message_id: userMessageId } });
  assert.equal(other.message.sender_type, "cuu");

  releaseFirst?.();
  await first;
});
