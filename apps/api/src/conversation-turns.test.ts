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
import type { DriveItemVM, DrivePageVM, WorkItemDetailVM } from "@workhub/contracts";

import {
  ConversationTurnServiceError,
  createConversationTurnService,
  mentionsCuu,
  type ConversationTurnClientProvider,
  type ConversationTurnResultVM,
  type ConversationTurnServiceDeps,
  type TurnLlmFinalMessage,
  type TurnLlmStream,
  type TurnLlmStreamEvent
} from "./services/conversation-turns.js";
import { DrivePageServiceError, type DriveStoredFile } from "./services/drive-pages.js";
import { ProviderNotConfiguredError } from "@workhub/agent/providers";
import type { AuthActor } from "./middleware/auth.js";
import {
  ASK_CLARIFYING_QUESTION_TOOL,
  CREATE_WORK_ITEM_TOOL,
  DRIVE_SEARCH_TOOL,
  SEND_FILE_CARD_TOOL
} from "@workhub/agent/turns";

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
    cuuEnabled: true,
    // R13 批 C1：默认"从未压缩过"——绝大多数既有测试的 nextSeq 远低于压缩阈值，这两个字段的默认值
    // 只是让 fixture 显式、可预测（同 cuuEnabled 当初被 G1 显式加进这个 fixture 的理由一致）。
    contextSummaryMd: null,
    contextSummaryThroughSeq: 0,
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
    projectIsPersonal: false,
    membershipRole: "member",
    participantRole: "owner",
    participantCount: 1,
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

// R13 批4c：三个工具背后的真实依赖（DrivePageService.page/file、WorkItemService.createWorkItem）
// 的最小夹具——只填测试真正断言到的字段，其余用 `as unknown as` 跳过大型 VM 的全字段要求（这些 VM
// 本身在别处已经有完整契约测试，这里只关心 conversation-turns.ts 怎么消费它们）。
function driveItemFixture(overrides: Partial<DriveItemVM> = {}): DriveItemVM {
  return {
    id: "18000000-0000-4000-8000-000000000001",
    project_id: projectId,
    name: "合同.pdf",
    kind: "file",
    path: "/合同.pdf",
    depth: 0,
    children_count: 0,
    updated_at: now.toISOString(),
    current_version: { id: "19000000-0000-4000-8000-000000000001", item_id: "18000000-0000-4000-8000-000000000001", version_no: 1, filename: "合同.pdf", mime: "application/pdf", size_bytes: 1024, created_at: now.toISOString(), current: true, source: "manual_upload" },
    ...overrides
  } as DriveItemVM;
}

function drivePageFixture(overrides: Partial<DrivePageVM> = {}): DrivePageVM {
  return {
    generated_at: now.toISOString(),
    summary: {
      item_count: 0,
      file_count: 0,
      folder_count: 0,
      deleted_item_count: 0,
      version_count: 0,
      accepted_deliverable_count: 0,
      pending_comment_count: 0,
      operation_count: 0
    },
    can_manage: false,
    items: [],
    deleted_items: [],
    versions: [],
    accepted_deliverables: [],
    comments: [],
    operations: [],
    actions: {},
    ...overrides
  } as DrivePageVM;
}

function driveStoredFileFixture(overrides: Partial<DriveStoredFile> = {}): DriveStoredFile {
  return {
    id: "18000000-0000-4000-8000-000000000001",
    itemId: "18000000-0000-4000-8000-000000000001",
    projectId,
    filename: "合同.pdf",
    mime: "application/pdf",
    sizeBytes: 1024,
    storagePath: "/tmp/合同.pdf",
    ...overrides
  };
}

function workItemDetailFixture(overrides: { id?: string; title?: string } = {}): WorkItemDetailVM {
  return {
    workitem: {
      id: overrides.id ?? "17000000-0000-4000-8000-000000000001",
      title: overrides.title ?? "整理季度报告",
      project_id: projectId
    },
    acceptance: [],
    agent_trace_preview: []
  } as unknown as WorkItemDetailVM;
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

// R13 批4c：受限工具环的测试用具——每次 client.messages.stream 调用按顺序消费下一个"这一轮模型该
// 回什么"（可以是纯文本，也可以是带 tool_use 块的完整 final message），最后一轮之后重复最后一个响应
// （防止测试没写够轮次时崩成 undefined，而不是让断言在错误的地方失败）。
function fakeStreamFinal(events: TurnLlmStreamEvent[], final: TurnLlmFinalMessage): TurnLlmStream {
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

function toolUseFinal(id: string, name: string, input: unknown): TurnLlmFinalMessage {
  return { content: [{ type: "tool_use", id, name, input }] };
}

function textFinal(text: string): TurnLlmFinalMessage {
  return { content: [{ type: "text", text }] };
}

function sequencedClient(
  rounds: Array<{ events?: TurnLlmStreamEvent[]; final: TurnLlmFinalMessage }>,
  spy?: unknown[]
): ConversationTurnClientProvider {
  let callIndex = 0;
  return async (input) => {
    spy?.push(input);
    return {
      messages: {
        async stream(params) {
          spy?.push(params);
          const round = rounds[callIndex] ?? rounds[rounds.length - 1]!;
          callIndex += 1;
          return fakeStreamFinal(round.events ?? [], round.final);
        }
      }
    };
  };
}

// R13 批 C1：`conversations` 依赖的默认桩单独抽出来，既是 baseDeps() 的默认值来源，也是下面浅合并的
// 兜底来源——本文件里几十处既有测试只按各自场景覆盖 `conversations` 里的 1-3 个方法（比如只关心
// findVisibleAccessRecord 返回 null 的 404 分支，从不会真的调用 updateContextSummary）；如果
// `...overrides` 把整个 `conversations` 子对象整体替换掉，这些既有覆盖就都要补全 4 个方法——纯体力活
// 且和那些测试关心的场景无关。baseDeps() 因此对 `conversations` 单独做一层浅合并，让没有显式覆盖某个
// 方法的测试自动继承这里的默认桩，不需要挨个改历史用例。
function defaultConversationsDeps(): ConversationTurnServiceDeps["conversations"] {
  return {
    async findVisibleAccessRecord() {
      return accessRecord();
    },
    async listMessagesAfter() {
      return { rows: [userMessageRow()], hasMore: false, nextAfterSeq: 1 };
    },
    // 回显实际写入的 kind/contentJson——同真实仓库的行为一致，让下游断言看到的是这一轮真正生成的
    // 文本/文件卡/工具日志，而不是一个跟输入脱节的固定夹具（R13 批4c：kind 现在可能不是 text）。
    async createCuuMessage(input) {
      return cuuMessageRow({ kind: input.kind, contentJson: input.contentJson });
    },
    // R13 批 C1：本批既有测试的会话夹具都远低于压缩阈值（nextSeq 恒为个位数），不会触碰这个方法——
    // 命中就说明某处测试的 seq 设置没有按预期短路在压缩触发判定之前，直接报错比静默返回更容易定位。
    async updateContextSummary() {
      throw new Error("updateContextSummary not expected");
    }
  };
}

// R13 批 C1：`overrides.conversations` 特意收窄成 Partial（而不是整个 ConversationTurnServiceDeps 那样
// 逐字段要求完整 Pick）——见 baseDeps() 里的合并逻辑与上面 defaultConversationsDeps() 的注释。
type BaseDepsOverrides = Partial<Omit<ConversationTurnServiceDeps, "conversations">> & {
  conversations?: Partial<ConversationTurnServiceDeps["conversations"]>;
};

function baseDeps(overrides: BaseDepsOverrides = {}): ConversationTurnServiceDeps {
  const { conversations: conversationsOverride, ...restOverrides } = overrides;
  const defaults: ConversationTurnServiceDeps = {
    conversations: { ...defaultConversationsDeps(), ...conversationsOverride },
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
    // R13 批4c：drive_search/send_file_card/create_work_item 三个工具的默认桩——本批既有测试（不涉及
    // 工具调用的纯文本回复）不会碰到它们，命中就说明测试路径没有按预期短路，直接报错比静默返回假数据
    // 更容易定位问题（同这个文件里其它未测方法的既有取舍）。
    drive: {
      async page() {
        throw new Error("drive.page not expected");
      },
      async file() {
        throw new Error("drive.file not expected");
      }
    },
    workItems: {
      async createWorkItem() {
        throw new Error("workItems.createWorkItem not expected");
      }
    },
    now: () => now,
    id: () => turnId,
    bus: { publish: async () => {} },
    logger: { warn: () => {} },
    turnTimeoutMs: 5_000,
    ...restOverrides
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

// —— R13 终验修复：个人空间单聊必回 —— //

test("createTurn allows the main conversation of a personal project and replies without an @Cuu mention (single-chat must-reply)", async () => {
  let deciderCalled = false;
  const service = createConversationTurnService(
    baseDeps({
      conversations: {
        async findVisibleAccessRecord() {
          // 个人空间的默认线程就是项目 main 会话（S3 设计）——1:1 单聊，必回特例：不要求 @Cuu，
          // 判定器也无权否决（用户终裁语义：单聊=判定的必回特例）。
          return accessRecord({
            conversation: conversationRow({ kind: "main" }),
            projectIsPersonal: true,
            participantCount: 0
          });
        },
        async listMessagesAfter() {
          return { rows: [userMessageRow({ contentJson: { text: "帮我想想这周周报怎么写？" } })], hasMore: false, nextAfterSeq: 1 };
        },
        async createCuuMessage(input) {
          return cuuMessageRow({ contentJson: input.contentJson });
        }
      },
      respondDecider: async () => {
        deciderCalled = true;
        return false;
      }
    })
  );

  const result = await service.createTurn({ actor: actor(), conversationId, payload: { user_message_id: userMessageId } });
  assert.equal(result.message.sender_type, "cuu");
  assert.equal(deciderCalled, false, "single-chat must-reply must not consult the respond decider");
});

test("createTurn still rejects the main conversation of a team (non-personal) project with 409 conversation_turn_not_collab", async () => {
  let llmCalled = false;
  const service = createConversationTurnService(
    baseDeps({
      conversations: {
        async findVisibleAccessRecord() {
          return accessRecord({ conversation: conversationRow({ kind: "main" }), projectIsPersonal: false });
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

test("createTurn keeps the cuu_enabled gate above the personal single-chat exception (silence stays absolute)", async () => {
  let llmCalled = false;
  const service = createConversationTurnService(
    baseDeps({
      conversations: {
        async findVisibleAccessRecord() {
          return accessRecord({
            conversation: conversationRow({ kind: "main", cuuEnabled: false }),
            projectIsPersonal: true
          });
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
    (error: unknown) =>
      error instanceof ConversationTurnServiceError && error.status === 409 && error.code === "conversation_turn_cuu_disabled"
  );
  assert.equal(llmCalled, false);
});

// —— R13 批 G1（小群）：cuu_enabled 硬闸 —— //

test("createTurn rejects a cuu_enabled:false conversation with 409 conversation_turn_cuu_disabled and never calls the LLM", async () => {
  let llmCalled = false;
  const service = createConversationTurnService(
    baseDeps({
      conversations: {
        async findVisibleAccessRecord() {
          return accessRecord({ conversation: conversationRow({ cuuEnabled: false }) });
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
    (error: unknown) =>
      error instanceof ConversationTurnServiceError && error.status === 409 && error.code === "conversation_turn_cuu_disabled"
  );
  assert.equal(llmCalled, false);
});

test("createTurn's cuu_enabled gate is not bypassed by an explicit @Cuu mention in the trigger message", async () => {
  // 用户拍板:cuu_enabled=false 是"强静默不可绕过"的硬开关——即便这一轮消息明确 @Cuu,判定器/被@必回
  // 都不应该有机会介入,硬闸必须排在它们前面直接 409。
  let llmCalled = false;
  const service = createConversationTurnService(
    baseDeps({
      conversations: {
        async findVisibleAccessRecord() {
          return accessRecord({ conversation: conversationRow({ cuuEnabled: false }) });
        },
        async listMessagesAfter() {
          return {
            rows: [userMessageRow({ contentJson: { text: "@Cuu 帮我看一下这段" } })],
            hasMore: false,
            nextAfterSeq: 1
          };
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
    (error: unknown) =>
      error instanceof ConversationTurnServiceError && error.status === 409 && error.code === "conversation_turn_cuu_disabled"
  );
  assert.equal(llmCalled, false);
});

test("createTurn rejects cuu_enabled:false ahead of the mode=1 observe-only check (cuu_enabled has top priority)", async () => {
  const service = createConversationTurnService(
    baseDeps({
      conversations: {
        async findVisibleAccessRecord() {
          return accessRecord({ conversation: conversationRow({ cuuEnabled: false }) });
        },
        async listMessagesAfter() {
          throw new Error("must not be called");
        },
        async createCuuMessage() {
          throw new Error("must not be called");
        }
      },
      aiSettings: {
        async findUserProfileAccessRecord() {
          return { membershipRole: "member", profile: userAiProfileRow({ defaultMode: 1 }) };
        }
      }
    })
  );

  await assert.rejects(
    service.createTurn({ actor: actor(), conversationId, payload: { user_message_id: userMessageId } }),
    (error: unknown) =>
      error instanceof ConversationTurnServiceError && error.status === 409 && error.code === "conversation_turn_cuu_disabled"
  );
});

// —— R13 批 G1：回话判定接缝——被 @ 必回 + respondDecider 注入点 —— //

test("createTurn calls the LLM when cuu_enabled is true and no respondDecider is configured (default preserves today's always-reply behavior)", async () => {
  const service = createConversationTurnService(
    baseDeps({
      conversations: {
        async findVisibleAccessRecord() {
          // 小群场景：participantCount > 1，且触发消息没有 @Cuu——没有配置 respondDecider 时,
          // 默认实现必须保守放行（维持存量行为零回归，见 defaultConversationTurnRespondDecider 注释）。
          return accessRecord({ participantCount: 3 });
        },
        async listMessagesAfter() {
          return { rows: [userMessageRow({ contentJson: { text: "这段还需要再改改" } })], hasMore: false, nextAfterSeq: 1 };
        },
        async createCuuMessage(input) {
          return cuuMessageRow({ contentJson: input.contentJson });
        }
      }
    })
  );

  const result = await service.createTurn({ actor: actor(), conversationId, payload: { user_message_id: userMessageId } });
  assert.equal(result.message.sender_type, "cuu");
});

// BUG-02：部署没配 LLM_API_KEY 时，provider registry 的 get() 会 fail-fast 抛 ProviderNotConfiguredError
// （发生在建 transport / 发任何上游请求之前）。createTurn 必须把它映射成明确的 503 ai_provider_not_configured，
// 而不是拿空 key 去打上游、收 401 后被泛化成 500。这里用一个在 acquisition 阶段就抛的 client provider 模拟
// get() 的 fail-fast：既然连 stream 都拿不到，就绝不会打 transport；同时断言不落任何 Cuu 消息。
test("BUG-02: createTurn maps a fail-fast ProviderNotConfiguredError to 503 ai_provider_not_configured without streaming or persisting", async () => {
  let clientAcquisitions = 0;
  const service = createConversationTurnService(
    baseDeps({
      conversations: {
        async findVisibleAccessRecord() {
          return accessRecord({ participantCount: 3 });
        },
        async listMessagesAfter() {
          return { rows: [userMessageRow({ contentJson: { text: "这段还需要再改改" } })], hasMore: false, nextAfterSeq: 1 };
        },
        async createCuuMessage() {
          throw new Error("must not persist a Cuu message when the provider is unconfigured");
        }
      },
      // 模拟 registry.get() 缺 apiKey 时的 fail-fast：client provider 本身抛，永远返回不出一个能 stream
      // （=打 transport）的 client。
      client: async () => {
        clientAcquisitions += 1;
        throw new ProviderNotConfiguredError("deepseek");
      }
    })
  );

  await assert.rejects(
    service.createTurn({ actor: actor(), conversationId, payload: { user_message_id: userMessageId } }),
    (error: unknown) =>
      error instanceof ConversationTurnServiceError &&
      error.status === 503 &&
      error.code === "ai_provider_not_configured"
  );
  // fail-fast 确实发生在主回应的 client acquisition 上（不是被压缩路径悄悄吞掉）。
  assert.equal(clientAcquisitions >= 1, true);
});

test("createTurn rejects with 409 conversation_turn_not_warranted when an injected respondDecider declines an un-mentioned group message", async () => {
  let llmCalled = false;
  let deciderInput: unknown;
  const service = createConversationTurnService(
    baseDeps({
      conversations: {
        async findVisibleAccessRecord() {
          return accessRecord({ participantCount: 4 });
        },
        async listMessagesAfter() {
          return { rows: [userMessageRow({ contentJson: { text: "今天天气不错" } })], hasMore: false, nextAfterSeq: 1 };
        },
        async createCuuMessage() {
          throw new Error("must not be called");
        }
      },
      client: async () => {
        llmCalled = true;
        throw new Error("must not be called");
      },
      respondDecider: async (input) => {
        deciderInput = input;
        return false;
      }
    })
  );

  await assert.rejects(
    service.createTurn({ actor: actor(), conversationId, payload: { user_message_id: userMessageId } }),
    (error: unknown) =>
      error instanceof ConversationTurnServiceError && error.status === 409 && error.code === "conversation_turn_not_warranted"
  );
  assert.equal(llmCalled, false);
  assert.deepEqual(deciderInput, { participantCount: 4, triggerMessageText: "今天天气不错" });
});

test("createTurn's @Cuu mention overrides an injected respondDecider that would otherwise decline", async () => {
  let deciderCalled = false;
  const service = createConversationTurnService(
    baseDeps({
      conversations: {
        async findVisibleAccessRecord() {
          return accessRecord({ participantCount: 4 });
        },
        async listMessagesAfter() {
          return {
            rows: [userMessageRow({ contentJson: { text: "@Cuu 帮我看看这段" } })],
            hasMore: false,
            nextAfterSeq: 1
          };
        },
        async createCuuMessage(input) {
          return cuuMessageRow({ contentJson: input.contentJson });
        }
      },
      respondDecider: async () => {
        deciderCalled = true;
        return false;
      }
    })
  );

  const result = await service.createTurn({ actor: actor(), conversationId, payload: { user_message_id: userMessageId } });
  assert.equal(result.message.sender_type, "cuu");
  assert.equal(deciderCalled, false, "mentioning Cuu must short-circuit before the decider is ever consulted");
});

test("createTurn's un-mentioned gate consults the decider even for a 1:1 conversation (participantCount 1) — only @Cuu is a hardcoded override, the 1:1 short-circuit is the decider's own job (see G1 design note)", async () => {
  // 设计原话:"1:1 时判定器直接短路成'必回'……是判定器的一个输入维度,不是另一套逻辑"——也就是说
  // createTurn 本身不硬编码 participantCount<=1 的旁路,只有"被 @"是钉死的、判定器无法覆盖的例外。
  // 4c 落地前的默认判定器（永远 true）让 1:1 today 照常必回；这里注入一个总是拒绝的判定器，证明
  // 1:1 并不会绕过它——真正的"1:1 必回"要靠判定器自己的实现来保证。
  let deciderCalled = false;
  const service = createConversationTurnService(
    baseDeps({
      conversations: {
        async findVisibleAccessRecord() {
          return accessRecord({ participantCount: 1 });
        },
        async listMessagesAfter() {
          return { rows: [userMessageRow({ contentJson: { text: "顺手帮我查一下这个" } })], hasMore: false, nextAfterSeq: 1 };
        },
        async createCuuMessage() {
          throw new Error("must not be called");
        }
      },
      client: async () => {
        throw new Error("must not be called");
      },
      respondDecider: async (input) => {
        deciderCalled = true;
        assert.equal(input.participantCount, 1);
        return false;
      }
    })
  );

  await assert.rejects(
    service.createTurn({ actor: actor(), conversationId, payload: { user_message_id: userMessageId } }),
    (error: unknown) =>
      error instanceof ConversationTurnServiceError && error.status === 409 && error.code === "conversation_turn_not_warranted"
  );
  assert.equal(deciderCalled, true);
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

// —— R13 批 G1：mentionsCuu 纯函数——脆弱的文本子串匹配，只钉死"带词边界"这条底线 —— //

test("mentionsCuu matches @Cuu and bare Cuu with a word boundary, case-insensitively", () => {
  assert.equal(mentionsCuu("@Cuu 帮我看看这段"), true);
  assert.equal(mentionsCuu("cuu 在吗"), true);
  assert.equal(mentionsCuu("CUU!"), true);
  assert.equal(mentionsCuu("麻烦 Cuu 看一下"), true);
  assert.equal(mentionsCuu("(Cuu)"), true);
});

test("mentionsCuu rejects substrings that merely contain the display name without a word boundary", () => {
  assert.equal(mentionsCuu("这是 reticuum 的写法"), false);
  assert.equal(mentionsCuu("Cuuxyz 是谁"), false);
  assert.equal(mentionsCuu("xCuu"), false);
});

test("mentionsCuu returns false for empty text or an empty display name", () => {
  assert.equal(mentionsCuu(""), false);
  assert.equal(mentionsCuu("Cuu 在吗", ""), false);
});

test("mentionsCuu honors a custom display name (nickname override)", () => {
  assert.equal(mentionsCuu("@小库 帮我看看", "小库"), true);
  assert.equal(mentionsCuu("Cuu 在吗", "小库"), false);
});

// ── R13 批4c: 受限工具环 ──────────────────────────────────────────────────────────────

test("createTurn runs drive_search then send_file_card across rounds, persists a real file_card, and logs a tool_note per call", async () => {
  const createCuuMessageCalls: Array<{ kind: string; contentJson: unknown }> = [];
  const driveCalls: unknown[] = [];
  const service = createConversationTurnService(
    baseDeps({
      conversations: {
        async findVisibleAccessRecord() {
          return accessRecord();
        },
        async listMessagesAfter() {
          return { rows: [userMessageRow({ contentJson: { text: "帮我找一下上次的合同" } })], hasMore: false, nextAfterSeq: 1 };
        },
        async createCuuMessage(callInput) {
          createCuuMessageCalls.push({ kind: callInput.kind, contentJson: callInput.contentJson });
          return cuuMessageRow({ kind: callInput.kind, contentJson: callInput.contentJson });
        }
      },
      drive: {
        async page(pageInput) {
          driveCalls.push({ op: "page", pageInput });
          return drivePageFixture({ items: [driveItemFixture()] });
        },
        async file(fileInput) {
          driveCalls.push({ op: "file", fileInput });
          return driveStoredFileFixture();
        }
      },
      client: sequencedClient([
        { final: toolUseFinal("call1", DRIVE_SEARCH_TOOL, { query: "合同" }) },
        { final: toolUseFinal("call2", SEND_FILE_CARD_TOOL, { drive_item_id: "18000000-0000-4000-8000-000000000001" }) },
        { final: textFinal("找到啦，发给你了。") }
      ])
    })
  );

  const result = await service.createTurn({ actor: actor(), conversationId, payload: { user_message_id: userMessageId } });

  assert.equal(textContent(result.message).text, "找到啦，发给你了。");
  assert.deepEqual(
    createCuuMessageCalls.map((call) => call.kind),
    ["tool_note", "file_card", "tool_note", "text"]
  );
  assert.deepEqual(createCuuMessageCalls[1]?.contentJson, {
    drive_item_id: "18000000-0000-4000-8000-000000000001",
    snapshot_name: "合同.pdf"
  });
  assert.equal(driveCalls.length, 2);
  const pageCall = driveCalls[0] as { op: string; pageInput: { projectId: string; nameQuery?: string } };
  assert.equal(pageCall.op, "page");
  assert.equal(pageCall.pageInput.projectId, projectId);
  assert.equal(pageCall.pageInput.nameQuery, "合同");
});

test("createTurn honestly reports no match when drive_search finds nothing, without inventing a file card", async () => {
  const createCuuMessageCalls: Array<{ kind: string }> = [];
  const service = createConversationTurnService(
    baseDeps({
      conversations: {
        async findVisibleAccessRecord() {
          return accessRecord();
        },
        async listMessagesAfter() {
          return { rows: [userMessageRow({ contentJson: { text: "帮我找一下上次的合同" } })], hasMore: false, nextAfterSeq: 1 };
        },
        async createCuuMessage(callInput) {
          createCuuMessageCalls.push({ kind: callInput.kind });
          return cuuMessageRow({ kind: callInput.kind, contentJson: callInput.contentJson });
        }
      },
      drive: {
        async page() {
          return drivePageFixture({ items: [] });
        },
        async file() {
          throw new Error("file must not be called when nothing was found");
        }
      },
      client: sequencedClient([
        { final: toolUseFinal("call1", DRIVE_SEARCH_TOOL, { query: "合同" }) },
        { final: textFinal("没找到叫这个名字的文件，麻烦确认一下文件名。") }
      ])
    })
  );

  const result = await service.createTurn({ actor: actor(), conversationId, payload: { user_message_id: userMessageId } });

  assert.equal(textContent(result.message).text, "没找到叫这个名字的文件，麻烦确认一下文件名。");
  assert.ok(!createCuuMessageCalls.some((call) => call.kind === "file_card"));
});

test("createTurn does not persist a file_card when the file is not visible (403/404), and tells the model to be honest", async () => {
  const createCuuMessageCalls: Array<{ kind: string }> = [];
  const service = createConversationTurnService(
    baseDeps({
      conversations: {
        async findVisibleAccessRecord() {
          return accessRecord();
        },
        async listMessagesAfter() {
          return { rows: [userMessageRow({ contentJson: { text: "把那个文件发给我" } })], hasMore: false, nextAfterSeq: 1 };
        },
        async createCuuMessage(callInput) {
          createCuuMessageCalls.push({ kind: callInput.kind });
          return cuuMessageRow({ kind: callInput.kind, contentJson: callInput.contentJson });
        }
      },
      drive: {
        async page() {
          throw new Error("page must not be called in this scenario");
        },
        async file() {
          throw new DrivePageServiceError(404, "drive_file_not_found", "not found");
        }
      },
      client: sequencedClient([
        { final: toolUseFinal("call1", SEND_FILE_CARD_TOOL, { drive_item_id: "18000000-0000-4000-8000-000000000001" }) },
        { final: textFinal("没找到这个文件，可能是权限问题。") }
      ])
    })
  );

  const result = await service.createTurn({ actor: actor(), conversationId, payload: { user_message_id: userMessageId } });

  assert.equal(textContent(result.message).text, "没找到这个文件，可能是权限问题。");
  assert.ok(!createCuuMessageCalls.some((call) => call.kind === "file_card"));
});

test("createTurn ends the turn immediately on ask_clarifying_question, persisting the additive clarify markers on a text message", async () => {
  const createCuuMessageCalls: Array<{ kind: string; contentJson: unknown }> = [];
  const service = createConversationTurnService(
    baseDeps({
      conversations: {
        async findVisibleAccessRecord() {
          return accessRecord();
        },
        async listMessagesAfter() {
          return { rows: [userMessageRow({ contentJson: { text: "帮我建个任务" } })], hasMore: false, nextAfterSeq: 1 };
        },
        async createCuuMessage(callInput) {
          createCuuMessageCalls.push({ kind: callInput.kind, contentJson: callInput.contentJson });
          return cuuMessageRow({ kind: callInput.kind, contentJson: callInput.contentJson });
        }
      },
      client: sequencedClient([
        { final: toolUseFinal("callQ", ASK_CLARIFYING_QUESTION_TOOL, { question: "你要 PPT 还是 Word？", options: ["PPT", "Word"] }) }
      ])
    })
  );

  const result = await service.createTurn({ actor: actor(), conversationId, payload: { user_message_id: userMessageId } });

  const content = textContent(result.message) as {
    text: string;
    is_clarifying_question?: boolean;
    clarify_options?: string[];
  };
  assert.equal(content.text, "你要 PPT 还是 Word？");
  assert.equal(content.is_clarifying_question, true);
  assert.deepEqual(content.clarify_options, ["PPT", "Word"]);
  assert.deepEqual(
    createCuuMessageCalls.map((call) => call.kind),
    ["text"]
  );
});

test("createTurn unlocks and executes create_work_item once the previous Cuu message was the clarifying question this reply answers", async () => {
  const clarifyingMessageId = "14000000-0000-4000-8000-000000000010";
  const createWorkItemCalls: unknown[] = [];
  const streamSpy: unknown[] = [];
  const service = createConversationTurnService(
    baseDeps({
      conversations: {
        async findVisibleAccessRecord() {
          return accessRecord();
        },
        async listMessagesAfter() {
          return {
            rows: [
              cuuMessageRow({
                id: clarifyingMessageId,
                seq: 1,
                contentJson: { text: "你要 PPT 还是 Word？", is_clarifying_question: true, clarify_options: ["PPT", "Word"] }
              }),
              userMessageRow({ seq: 2, contentJson: { text: "Word 就行" } })
            ],
            hasMore: false,
            nextAfterSeq: 2
          };
        },
        async createCuuMessage(callInput) {
          return cuuMessageRow({ kind: callInput.kind, contentJson: callInput.contentJson });
        }
      },
      workItems: {
        async createWorkItem(workItemInput) {
          createWorkItemCalls.push(workItemInput);
          return workItemDetailFixture({ title: "整理季度报告（Word 版）" });
        }
      },
      client: sequencedClient(
        [
          { final: toolUseFinal("callW", CREATE_WORK_ITEM_TOOL, { title: "整理季度报告（Word 版）", summary: "按上季度数据整理", clarification_answer: "Word 版本" }) },
          { final: textFinal("已经建好了，麻烦确认一下细节。") }
        ],
        streamSpy
      )
    })
  );

  const result = await service.createTurn({ actor: actor(), conversationId, payload: { user_message_id: userMessageId } });

  assert.equal(textContent(result.message).text, "已经建好了，麻烦确认一下细节。");
  assert.equal(createWorkItemCalls.length, 1);
  const call = createWorkItemCalls[0] as { payload: { project_id: string; title: string; raw_description: string } };
  assert.equal(call.payload.project_id, projectId);
  assert.equal(call.payload.title, "整理季度报告（Word 版）");
  assert.match(call.payload.raw_description, /Word 版本/u);

  // round1 的 stream 调用必须真的把 create_work_item 摆进了 tools 清单——工具可见性门槛与
  // pendingClarification 联动，不是只靠 system prompt 里的一句嘱咐。
  const firstStreamParams = streamSpy[1] as { tools?: Array<{ name: string }> };
  assert.ok(firstStreamParams.tools?.some((tool) => tool.name === CREATE_WORK_ITEM_TOOL));
});

test("createTurn refuses create_work_item server-side even if the model calls it without an answered clarification (defense in depth)", async () => {
  let createWorkItemCalled = false;
  const service = createConversationTurnService(
    baseDeps({
      conversations: {
        async findVisibleAccessRecord() {
          return accessRecord();
        },
        async listMessagesAfter() {
          return { rows: [userMessageRow({ contentJson: { text: "帮我建个任务" } })], hasMore: false, nextAfterSeq: 1 };
        },
        async createCuuMessage(callInput) {
          return cuuMessageRow({ kind: callInput.kind, contentJson: callInput.contentJson });
        }
      },
      workItems: {
        async createWorkItem() {
          createWorkItemCalled = true;
          throw new Error("must not be called without an answered clarification");
        }
      },
      client: sequencedClient([
        { final: toolUseFinal("callW", CREATE_WORK_ITEM_TOOL, { title: "顺嘴建的工单", summary: "没有问清楚" }) },
        { final: textFinal("抱歉，我先问清楚需求。") }
      ])
    })
  );

  const result = await service.createTurn({ actor: actor(), conversationId, payload: { user_message_id: userMessageId } });

  assert.equal(textContent(result.message).text, "抱歉，我先问清楚需求。");
  assert.equal(createWorkItemCalled, false);
});

test("createTurn degrades a truncated/malformed tool_use input to an error tool_result instead of crashing (dangling tool_use guard)", async () => {
  const streamSpy: unknown[] = [];
  const service = createConversationTurnService(
    baseDeps({
      client: sequencedClient(
        [
          // 模拟 max_tokens 截断：anthropic-compatible.ts 的 finalizeBlock 在 partial_json 解析失败时
          // 会把 input 原样存成字符串，而不是对象。
          { final: toolUseFinal("callBad", SEND_FILE_CARD_TOOL, "{\"drive_item_id\": \"not-fini") },
          { final: textFinal("换个方式我再帮你确认一下。") }
        ],
        streamSpy
      )
    })
  );

  const result = await service.createTurn({ actor: actor(), conversationId, payload: { user_message_id: userMessageId } });

  assert.equal(textContent(result.message).text, "换个方式我再帮你确认一下。");
  // sequencedClient 的 spy 记录形状：[0]=client provider 的 input，[1..N]=每一轮 stream 的 params——
  // 这里是 2 轮（工具调用 + 收尾文本），第二轮 params 在下标 2。
  assert.equal(streamSpy.length, 3);
  const secondRoundParams = streamSpy[2] as { messages: Array<{ role: string; content: unknown }> };
  const toolResultMessage = secondRoundParams.messages.at(-1) as { role: string; content: Array<{ type: string; tool_use_id: string; is_error: boolean }> };
  assert.equal(toolResultMessage.role, "user");
  assert.equal(toolResultMessage.content[0]?.tool_use_id, "callBad");
  assert.equal(toolResultMessage.content[0]?.is_error, true);
});

test("createTurn rechecks the soft budget gate before every additional model call and stops calling the LLM once it's exhausted", async () => {
  let usageCallCount = 0;
  const streamSpy: unknown[] = [];
  const createCuuMessageCalls: Array<{ kind: string }> = [];
  const service = createConversationTurnService(
    baseDeps({
      policyStore: {
        listPolicies: () => [
          {
            id: "p1",
            scopeKind: "team" as const,
            period: "day" as const,
            maxTokens: 1_000_000,
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
        usageSnapshots: async () => {
          usageCallCount += 1;
          return [
            {
              scope: { kind: "team" as const, teamId: workspaceId },
              tokenIn: 10,
              tokenOut: 10,
              estimatedCostCny: usageCallCount <= 1 ? "0" : "5"
            }
          ];
        }
      },
      conversations: {
        async findVisibleAccessRecord() {
          return accessRecord();
        },
        async listMessagesAfter() {
          return { rows: [userMessageRow()], hasMore: false, nextAfterSeq: 1 };
        },
        async createCuuMessage(callInput) {
          createCuuMessageCalls.push({ kind: callInput.kind });
          return cuuMessageRow({ kind: callInput.kind, contentJson: callInput.contentJson });
        }
      },
      client: sequencedClient(
        [
          { final: toolUseFinal("call1", DRIVE_SEARCH_TOOL, { query: "合同" }) },
          { final: textFinal("不该被调用到这里。") }
        ],
        streamSpy
      )
    })
  );

  await assert.rejects(
    service.createTurn({ actor: actor(), conversationId, payload: { user_message_id: userMessageId } }),
    (error: unknown) => error instanceof ConversationTurnServiceError && error.status === 429 && error.code === "conversation_turn_budget_exhausted"
  );

  // 只有 1 次 LLM 调用（round 1）——round 2 之前的预算重检查拦下了第二次调用。
  assert.equal(streamSpy.length, 2);
  assert.equal(usageCallCount, 2);
  // round 1 的工具调用（drive_search）已经真实发生过，它的 tool_note 审计日志不会被回滚。
  assert.deepEqual(createCuuMessageCalls.map((call) => call.kind), ["tool_note"]);
});

test("createTurn stops offering tools once the hard cap of 3 tool calls is reached, forcing a text-only closing round", async () => {
  const streamSpy: unknown[] = [];
  const service = createConversationTurnService(
    baseDeps({
      drive: {
        async page() {
          return drivePageFixture({ items: [] });
        },
        async file() {
          throw new Error("file must not be called in this scenario");
        }
      },
      client: sequencedClient(
        [
          { final: toolUseFinal("call1", DRIVE_SEARCH_TOOL, { query: "a" }) },
          { final: toolUseFinal("call2", DRIVE_SEARCH_TOOL, { query: "b" }) },
          { final: toolUseFinal("call3", DRIVE_SEARCH_TOOL, { query: "c" }) },
          { final: textFinal("问完了，都没找到。") }
        ],
        streamSpy
      )
    })
  );

  const result = await service.createTurn({ actor: actor(), conversationId, payload: { user_message_id: userMessageId } });

  assert.equal(textContent(result.message).text, "问完了，都没找到。");
  // sequencedClient 的 spy 形状：[0]=client provider 的 input（只调用一次，createTurn 每次调用只拿
  // 一次 client），[1..N]=每一轮 stream 的 params。4 轮模型调用（3 次工具轮 + 1 次强制收尾轮）→
  // spy 长度 1+4=5，第四轮 params 在下标 4。
  assert.equal(streamSpy.length, 5);
  const fourthRoundParams = streamSpy[4] as { tools?: unknown[] };
  assert.equal(fourthRoundParams.tools, undefined);
});

test("createTurn fails closed with conversation_turn_failed if the model hallucinates a tool_use on the forced final round", async () => {
  const service = createConversationTurnService(
    baseDeps({
      drive: {
        async page() {
          return drivePageFixture({ items: [] });
        },
        async file() {
          throw new Error("file must not be called in this scenario");
        }
      },
      client: sequencedClient([
        { final: toolUseFinal("call1", DRIVE_SEARCH_TOOL, { query: "a" }) },
        { final: toolUseFinal("call2", DRIVE_SEARCH_TOOL, { query: "b" }) },
        { final: toolUseFinal("call3", DRIVE_SEARCH_TOOL, { query: "c" }) },
        // 第 4 轮（强制不带 tools）模型仍然幻觉出一个 tool_use——没有第 5 轮可用，服务端必须 fail
        // closed，而不是挂起或悄悄继续。
        { final: toolUseFinal("call4", DRIVE_SEARCH_TOOL, { query: "d" }) }
      ])
    })
  );

  await assert.rejects(
    service.createTurn({ actor: actor(), conversationId, payload: { user_message_id: userMessageId } }),
    (error: unknown) => error instanceof ConversationTurnServiceError && error.status === 500 && error.code === "conversation_turn_failed"
  );
});

// ── R13 批 C1（会话上下文压缩）────────────────────────────────────────────────────────

test("createTurn does not attempt to compact when the window has not yet crossed the refresh threshold", async () => {
  // afterSeq = nextSeq - 1 - windowSize(50)。选 nextSeq 使 afterSeq 恰好等于阈值本身（=REFRESH_BATCH
  // 20，不大于）——触发条件是严格大于，这一步不该触发压缩。updateContextSummary 桩命中即抛错，让这条
  // 断言真的会失败而不是形同虚设（同这个文件里其它"not expected"桩的既有取舍）。
  const nextSeq = 1 + 50 + 20;
  const service = createConversationTurnService(
    baseDeps({
      conversations: {
        async findVisibleAccessRecord() {
          return accessRecord({ conversation: conversationRow({ nextSeq, contextSummaryThroughSeq: 0 }) });
        },
        async listMessagesAfter() {
          return { rows: [userMessageRow({ seq: nextSeq })], hasMore: false, nextAfterSeq: nextSeq };
        },
        async createCuuMessage(input) {
          return cuuMessageRow({ kind: input.kind, contentJson: input.contentJson });
        },
        async updateContextSummary() {
          throw new Error("updateContextSummary must not be called at or below the refresh threshold");
        }
      }
    })
  );

  const result = await service.createTurn({ actor: actor(), conversationId, payload: { user_message_id: userMessageId } });
  assert.equal(textContent(result.message).text, "看过了，整体不错");
});

test("createTurn compacts the newly slid-out window once the refresh threshold is crossed, persists the summary, and posts a context_compacted system event", async () => {
  const compactionSpy: unknown[] = [];
  const mainSpy: unknown[] = [];
  let updateContextSummaryCall: { workspaceId: string; conversationId: string; summaryMd: string; throughSeq: number } | undefined;
  let postedSystemMessage: { workspaceId: string; conversationId: string; content: Record<string, unknown>; at: Date } | undefined;

  // afterSeq = 80 - 1 - 50 = 29 > 0 + 20 → 触发；这批"新滑出窗口"是 seq 1..29。
  const nextSeq = 80;
  const oldBatch = Array.from({ length: 29 }, (_, i) =>
    userMessageRow({
      id: `21000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
      seq: i + 1,
      senderUserId: userId,
      contentJson: { text: `历史讨论第 ${i + 1} 条` }
    })
  );

  const service = createConversationTurnService(
    baseDeps({
      conversations: {
        async findVisibleAccessRecord() {
          return accessRecord({ conversation: conversationRow({ nextSeq, contextSummaryThroughSeq: 0, contextSummaryMd: null }) });
        },
        async listMessagesAfter(params) {
          if (params.afterSeq === 0) {
            return { rows: oldBatch, hasMore: false, nextAfterSeq: 29 };
          }
          return { rows: [userMessageRow({ seq: nextSeq })], hasMore: false, nextAfterSeq: nextSeq };
        },
        async createCuuMessage(input) {
          return cuuMessageRow({ kind: input.kind, contentJson: input.contentJson });
        },
        async updateContextSummary(input) {
          updateContextSummaryCall = input;
        }
      },
      compactionClient: respondingClient(
        [],
        "当前进度：正在准备季度报告初稿。\n关键决策与偏好：偏好中文回复。\n待办事项：等待对方确认数据来源。",
        compactionSpy
      ),
      postContextCompactionSystemMessage: async (input) => {
        postedSystemMessage = input;
      },
      client: respondingClient([textDeltaEvent("好的，")], "好的，收到", mainSpy)
    })
  );

  const result = await service.createTurn({ actor: actor(), conversationId, payload: { user_message_id: userMessageId } });

  // 压缩失败与否都不该影响这一轮真实回复本身。
  assert.equal(textContent(result.message).text, "好的，收到");

  assert.ok(updateContextSummaryCall, "updateContextSummary should have been called");
  assert.equal(updateContextSummaryCall?.throughSeq, 29);
  assert.match(updateContextSummaryCall?.summaryMd ?? "", /当前进度：正在准备季度报告初稿/);

  assert.ok(postedSystemMessage, "a context_compacted system event should have been posted");
  assert.equal(postedSystemMessage?.content["event"], "context_compacted");
  assert.equal(postedSystemMessage?.content["compacted_message_count"], 29);

  // 压缩调用本身：system prompt 里能看到三段式交接摘要的指令口径；不带 tools（这不是对话轮次）。
  const compactionStreamParams = compactionSpy.find(
    (entry): entry is { system: string; tools?: unknown[] } => typeof (entry as Record<string, unknown>)?.["system"] === "string"
  );
  assert.ok(compactionStreamParams);
  assert.match(compactionStreamParams.system, /项目经理式交接/);
  assert.equal(compactionStreamParams.tools, undefined);

  // 这一轮真正的回复调用：system prompt 里必须已经带上刚刚产出的摘要（本轮压缩产出的摘要，紧接着
  // 就在同一次 createTurn 调用里注入生效）。
  const mainStreamParams = mainSpy.find(
    (entry): entry is { system: string } => typeof (entry as Record<string, unknown>)?.["system"] === "string"
  );
  assert.ok(mainStreamParams);
  assert.match(mainStreamParams.system, /当前进度：正在准备季度报告初稿/);
  assert.match(mainStreamParams.system, /这个会话更早内容的滚动摘要/);
});

test("createTurn injects an already-persisted rolling summary into the system prompt without recompacting below the threshold", async () => {
  const mainSpy: unknown[] = [];
  const existingSummary =
    "当前进度：正在核对交付清单。\n关键决策与偏好：对方偏好周报形式。\n待办事项：等设计稿定稿。";

  const service = createConversationTurnService(
    baseDeps({
      conversations: {
        async findVisibleAccessRecord() {
          return accessRecord({
            conversation: conversationRow({
              nextSeq: 2,
              contextSummaryMd: existingSummary,
              contextSummaryThroughSeq: 40
            })
          });
        },
        async listMessagesAfter() {
          return { rows: [userMessageRow()], hasMore: false, nextAfterSeq: 1 };
        },
        async createCuuMessage(input) {
          return cuuMessageRow({ kind: input.kind, contentJson: input.contentJson });
        },
        async updateContextSummary() {
          throw new Error("updateContextSummary must not be called when nextSeq is nowhere near the threshold");
        }
      },
      client: respondingClient([textDeltaEvent("好的")], "好的", mainSpy)
    })
  );

  await service.createTurn({ actor: actor(), conversationId, payload: { user_message_id: userMessageId } });

  const mainStreamParams = mainSpy.find(
    (entry): entry is { system: string } => typeof (entry as Record<string, unknown>)?.["system"] === "string"
  );
  assert.ok(mainStreamParams);
  assert.match(mainStreamParams.system, /当前进度：正在核对交付清单/);
  assert.match(mainStreamParams.system, /这个会话更早内容的滚动摘要/);
});

test("createTurn fails open when the context-compaction LLM call throws: the real reply still succeeds and nothing is persisted for the failed compaction", async () => {
  const nextSeq = 80; // afterSeq = 29 > 20，仍然会尝试一次压缩
  const service = createConversationTurnService(
    baseDeps({
      conversations: {
        async findVisibleAccessRecord() {
          return accessRecord({ conversation: conversationRow({ nextSeq, contextSummaryThroughSeq: 0, contextSummaryMd: null }) });
        },
        async listMessagesAfter(params) {
          if (params.afterSeq === 0) {
            return {
              rows: [
                userMessageRow({
                  id: "22000000-0000-4000-8000-000000000001",
                  seq: 1,
                  contentJson: { text: "历史消息" }
                })
              ],
              hasMore: false,
              nextAfterSeq: 1
            };
          }
          return { rows: [userMessageRow({ seq: nextSeq })], hasMore: false, nextAfterSeq: nextSeq };
        },
        async createCuuMessage(input) {
          return cuuMessageRow({ kind: input.kind, contentJson: input.contentJson });
        },
        async updateContextSummary() {
          throw new Error("updateContextSummary must not be called when the compaction LLM call fails");
        }
      },
      compactionClient: throwingClient(),
      postContextCompactionSystemMessage: async () => {
        throw new Error("postContextCompactionSystemMessage must not be called when compaction fails upstream");
      }
    })
  );

  const result = await service.createTurn({ actor: actor(), conversationId, payload: { user_message_id: userMessageId } });
  assert.equal(textContent(result.message).text, "看过了，整体不错");
});

// ── R14 批 CHAT（下游墓碑过滤）：turn 历史（buildHistory/historyDisplayText）跳过墓碑 ──────────
test("R14 createTurn omits deleted (tombstone) messages from the history handed to the model", async () => {
  const spy: unknown[] = [];
  const deletedId = "14000000-0000-4000-8000-0000000000de";
  const service = createConversationTurnService(
    baseDeps({
      conversations: {
        async findVisibleAccessRecord() {
          return accessRecord();
        },
        async listMessagesAfter() {
          // 墓碑行故意仍带残留文本（证明 deletedAt 短路本身，而不是被“内容已空”顺带挡下）。
          return {
            rows: [
              userMessageRow({ id: deletedId, seq: 0, deletedAt: now, contentJson: { text: "墓碑残留文本不该进模型" } }),
              userMessageRow({ contentJson: { text: "@Cuu 帮我看看草稿" } })
            ],
            hasMore: false,
            nextAfterSeq: 1
          };
        },
        async createCuuMessage(input) {
          return cuuMessageRow({ contentJson: input.contentJson });
        }
      },
      client: respondingClient([], "好的，我看看。", spy)
    })
  );

  await service.createTurn({ actor: actor(), conversationId, payload: { user_message_id: userMessageId } });

  const serialized = JSON.stringify(spy);
  assert.ok(serialized.includes("@Cuu 帮我看看草稿"), "the anchor message must reach the model");
  assert.ok(!serialized.includes("墓碑残留文本不该进模型"), "tombstone text must be filtered out of the turn history");
});
