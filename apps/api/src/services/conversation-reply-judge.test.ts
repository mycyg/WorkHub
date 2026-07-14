import assert from "node:assert/strict";
import test from "node:test";

import type { ReplyJudgeCandidateRow } from "@workhub/db";

import { createConversationReplyJudgeService, type ConversationReplyJudgeServiceDeps } from "./conversation-reply-judge.js";
import type { ConversationTurnResultVM } from "./conversation-turns.js";

const workspaceId = "20000000-0000-4000-8000-000000000001";
const projectId = "20000000-0000-4000-8000-000000000002";
const conversationId = "20000000-0000-4000-8000-000000000003";
const senderUserId = "20000000-0000-4000-8000-000000000004";
const messageId = "20000000-0000-4000-8000-000000000005";
const now = new Date("2026-07-13T09:00:00.000Z");

function candidate(overrides: Partial<ReplyJudgeCandidateRow> = {}): ReplyJudgeCandidateRow {
  return {
    conversationId,
    workspaceId,
    projectId,
    participantCount: 3,
    lastMessageId: messageId,
    lastMessageSeq: 5,
    lastMessageSenderUserId: senderUserId,
    lastMessageKind: "text",
    lastMessageContentJson: { text: "帮我把上季度报告发一下" },
    // 早于 startedAt 至少一个默认合并窗口（30s），否则默认测试会被限频合并挡住。
    lastMessageCreatedAt: new Date(now.getTime() - 60_000),
    ...overrides
  };
}

function turnResult(): ConversationTurnResultVM {
  return {
    turn_id: "20000000-0000-4000-8000-000000000009",
    message: {
      id: "20000000-0000-4000-8000-000000000010",
      conversation_id: conversationId,
      seq: 6,
      sender_type: "cuu",
      sender_user_id: null,
      thread_root_id: null,
      created_at: now.toISOString(),
      kind: "text",
      content: { text: "好的，马上发。" }
    }
  };
}

function baseDeps(overrides: Partial<ConversationReplyJudgeServiceDeps> = {}): ConversationReplyJudgeServiceDeps {
  return {
    conversations: {
      async listReplyJudgeCandidates() {
        return [candidate()];
      }
    },
    turns: {
      async createTurn() {
        return turnResult();
      }
    },
    now: () => now,
    logger: { warn: () => {} },
    ...overrides
  };
}

test("runOnce triggers a turn for an imperative request in a real group (participantCount>1), using the last sender as the actor", async () => {
  const turnCalls: unknown[] = [];
  const service = createConversationReplyJudgeService(
    baseDeps({
      turns: {
        async createTurn(input) {
          turnCalls.push(input);
          return turnResult();
        }
      }
    })
  );

  const result = await service.runOnce();

  assert.equal(result.scanned, 1);
  assert.equal(result.judged, 1);
  assert.equal(result.replied, 1);
  assert.equal(turnCalls.length, 1);
  const call = turnCalls[0] as { actor: { kind: string; userId?: string; workspaceId: string }; conversationId: string; payload: { user_message_id: string } };
  assert.equal(call.actor.kind, "human");
  assert.equal(call.actor.userId, senderUserId);
  assert.equal(call.actor.workspaceId, workspaceId);
  assert.equal(call.conversationId, conversationId);
  assert.equal(call.payload.user_message_id, messageId);
});

test("runOnce does not reply to pure chitchat and does not call createTurn", async () => {
  let createTurnCalled = false;
  const service = createConversationReplyJudgeService(
    baseDeps({
      conversations: {
        async listReplyJudgeCandidates() {
          return [candidate({ lastMessageContentJson: { text: "哈哈哈" } })];
        }
      },
      turns: {
        async createTurn() {
          createTurnCalled = true;
          throw new Error("must not be called");
        }
      }
    })
  );

  const result = await service.runOnce();

  assert.equal(result.replied, 0);
  assert.equal(createTurnCalled, false);
});

test("runOnce honors cuu_enabled=false as the highest-priority silence, even for an imperative request", async () => {
  let createTurnCalled = false;
  const service = createConversationReplyJudgeService(
    baseDeps({
      cuuEnabledForConversation: async () => false,
      turns: {
        async createTurn() {
          createTurnCalled = true;
          throw new Error("must not be called");
        }
      }
    })
  );

  const result = await service.runOnce();

  assert.equal(result.skipped_cuu_disabled, 1);
  assert.equal(result.replied, 0);
  assert.equal(createTurnCalled, false);
});

test("runOnce skips a non-text last message (e.g. file_card) without crashing", async () => {
  const service = createConversationReplyJudgeService(
    baseDeps({
      conversations: {
        async listReplyJudgeCandidates() {
          return [candidate({ lastMessageKind: "file_card", lastMessageContentJson: { drive_item_id: "x", snapshot_name: "x.pdf" } })];
        }
      }
    })
  );

  const result = await service.runOnce();

  assert.equal(result.skipped_non_text, 1);
  assert.equal(result.judged, 1);
  assert.equal(result.replied, 0);
});

test("runOnce withholds evaluation while the candidate's last message is still inside the merge window (rapid burst)", async () => {
  const service = createConversationReplyJudgeService(
    baseDeps({
      conversations: {
        async listReplyJudgeCandidates() {
          return [candidate({ lastMessageCreatedAt: new Date(now.getTime() - 5_000) })];
        }
      }
    })
  );

  const result = await service.runOnce();

  assert.equal(result.skipped_merge_window, 1);
  assert.equal(result.judged, 0);
});

test("runOnce does not re-judge the same last message twice across ticks (idempotent watermark)", async () => {
  let createTurnCalls = 0;
  const service = createConversationReplyJudgeService(
    baseDeps({
      turns: {
        async createTurn() {
          createTurnCalls += 1;
          return turnResult();
        }
      }
    })
  );

  const first = await service.runOnce();
  const second = await service.runOnce();

  assert.equal(first.judged, 1);
  assert.equal(first.replied, 1);
  assert.equal(second.judged, 0);
  assert.equal(second.skipped_already_judged, 1);
  assert.equal(createTurnCalls, 1);
});

// R14 FIX批10（被 @ 的回复延迟：事件驱动直通）：markMentionHandled 写的是 runOnce 自己读的同一张
// lastJudgedByConversation 水位线——这条测试钉死"直通已经处理过的消息，轮询 tick 绝不再重复触发一次
// createTurn"，不依赖直通那一侧的任何真实实现，只验证这个服务自己暴露的去重契约。
test("markMentionHandled marks a message as already judged, so a subsequent tick skips it instead of calling createTurn a second time", async () => {
  let createTurnCalls = 0;
  const service = createConversationReplyJudgeService(
    baseDeps({
      turns: {
        async createTurn() {
          createTurnCalls += 1;
          return turnResult();
        }
      }
    })
  );

  // 模拟：这条消息已经被 createMessage 的直通路径处理过（它会在触发 turn 之前同步调用这个方法）。
  service.markMentionHandled({ conversationId, messageId });

  const result = await service.runOnce();

  assert.equal(result.judged, 0);
  assert.equal(result.skipped_already_judged, 1);
  assert.equal(result.replied, 0);
  assert.equal(createTurnCalls, 0, "the tick must not call createTurn a second time for a message the direct trigger already handled");
});

// 没被标记过的消息（不同 messageId）不应该被这张水位线误伤——markMentionHandled 只挡它明确记录过的
// 那一条，不会连坐同一会话里后续的新消息。
test("markMentionHandled does not suppress a later, different message in the same conversation", async () => {
  const otherMessageId = "20000000-0000-4000-8000-000000000099";
  let createTurnCalls = 0;
  const service = createConversationReplyJudgeService(
    baseDeps({
      conversations: {
        async listReplyJudgeCandidates() {
          return [candidate({ lastMessageId: otherMessageId })];
        }
      },
      turns: {
        async createTurn() {
          createTurnCalls += 1;
          return turnResult();
        }
      }
    })
  );

  service.markMentionHandled({ conversationId, messageId });
  const result = await service.runOnce();

  assert.equal(result.skipped_already_judged, 0);
  assert.equal(result.replied, 1);
  assert.equal(createTurnCalls, 1);
});

test("runOnce falls to the LLM classifier tier for ambiguous prose and honors a should_reply=true verdict", async () => {
  const classifyCalls: unknown[] = [];
  const service = createConversationReplyJudgeService(
    baseDeps({
      conversations: {
        async listReplyJudgeCandidates() {
          return [candidate({ lastMessageContentJson: { text: "这个方案我觉得还需要再打磨一下细节部分的措辞" } })];
        }
      },
      llmClassifierFactory: (workspaceIdArg) => async (input) => {
        classifyCalls.push({ workspaceIdArg, input });
        return { shouldReply: true, reason: "有分歧要收敛" };
      }
    })
  );

  const result = await service.runOnce();

  assert.equal(result.replied, 1);
  assert.equal(classifyCalls.length, 1);
  assert.equal((classifyCalls[0] as { workspaceIdArg: string }).workspaceIdArg, workspaceId);
});

test("runOnce catches a failing candidate (e.g. createTurn throws) and keeps scanning the rest instead of crashing the whole tick", async () => {
  const otherConversationId = "20000000-0000-4000-8000-000000000030";
  const otherMessageId = "20000000-0000-4000-8000-000000000031";
  let createTurnCalls = 0;
  const service = createConversationReplyJudgeService(
    baseDeps({
      conversations: {
        async listReplyJudgeCandidates() {
          return [
            candidate(),
            candidate({ conversationId: otherConversationId, lastMessageId: otherMessageId })
          ];
        }
      },
      turns: {
        async createTurn(input) {
          createTurnCalls += 1;
          if (input.conversationId === conversationId) {
            throw new Error("boom");
          }
          return turnResult();
        }
      }
    })
  );

  const result = await service.runOnce();

  assert.equal(result.scanned, 2);
  assert.equal(result.judged, 2);
  assert.equal(result.replied, 1);
  assert.equal(result.failed, 1);
  assert.equal(createTurnCalls, 2);
});

test("runOnce scopes the candidate scan to a bounded recent window and cap", async () => {
  const queryCalls: unknown[] = [];
  const service = createConversationReplyJudgeService(
    baseDeps({
      conversations: {
        async listReplyJudgeCandidates(query) {
          queryCalls.push(query);
          return [];
        }
      },
      maxCandidatesPerTick: 5,
      candidateLookbackMs: 60_000
    })
  );

  await service.runOnce();

  assert.equal(queryCalls.length, 1);
  const query = queryCalls[0] as { limit: number; sinceCreatedAt: Date };
  assert.equal(query.limit, 5);
  assert.equal(query.sinceCreatedAt.getTime(), now.getTime() - 60_000);
});
