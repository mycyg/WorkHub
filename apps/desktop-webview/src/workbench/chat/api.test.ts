import assert from "node:assert/strict";
import { test } from "node:test";

import type { ConversationMessagePageVM, ConversationMessageVM, UserAiProfileVM } from "@workhub/contracts";

import {
  addConversationReaction,
  advanceConversationReadCursor,
  decideActionCardItem,
  deleteActionCardItemFeedback,
  deleteConversationMessage,
  deleteConversationMessageFeedback,
  editConversationMessage,
  fetchConversationMessagesPage,
  fetchConversationPins,
  fetchConversationReceipts,
  fetchLatestConversationMessagesPage,
  fetchMyAiProfile,
  fetchNotifications,
  fetchOlderConversationMessagesPage,
  fetchPresence,
  patchMyAiMode,
  pinConversationMessage,
  pingConversationTyping,
  putActionCardItemFeedback,
  putConversationMessageFeedback,
  removeConversationReaction,
  requestConversationTurn,
  sendConversationFileCardMessage,
  sendConversationTextMessage,
  undoActionCardItem,
  unpinConversationMessage,
  type ActionCardItemDecisionResult,
  type ChatApiClient
} from "./api.js";

function fakeClient(handler: (path: string, init?: RequestInit) => unknown): ChatApiClient {
  return {
    request: async <T>(path: string, init?: RequestInit) => handler(path, init) as T
  };
}

function aiProfile(overrides: Partial<UserAiProfileVM> = {}): UserAiProfileVM {
  return {
    workspace_id: "ws-1",
    user_id: "user-1",
    default_mode: 3,
    granular_settings: {},
    dispatch_policy: "auto",
    cuu_proactivity: "balanced",
    model_tier_preference: null,
    providers: [],
    budget_summary: {
      daily_quota: null,
      usage: {
        day: { period: "day", token_in: 0, token_out: 0, total_tokens: 0, estimated_cost_cny: "0" },
        month: { period: "month", token_in: 0, token_out: 0, total_tokens: 0, estimated_cost_cny: "0" }
      }
    },
    generated_at: "2026-07-12T09:00:00.000000Z",
    updated_at: null,
    ...overrides
  };
}

function textMessage(id: string, seq: number): ConversationMessageVM {
  return {
    id,
    conversation_id: "conv-1",
    seq,
    sender_type: "user",
    sender_user_id: "user-1",
    kind: "text",
    content: { text: `message ${seq}` },
    thread_root_id: null,
    created_at: "2026-07-12T09:00:00.000000Z"
  };
}

test("fetchConversationMessagesPage builds the afterSeq/limit query string", async () => {
  const calls: Array<{ path: string; init: RequestInit | undefined }> = [];
  const client = fakeClient((path, init) => {
    calls.push({ path, init });
    return { messages: [], has_more: false, next_after_seq: 0 } satisfies ConversationMessagePageVM;
  });

  await fetchConversationMessagesPage(client, "conv-1", { afterSeq: 42, limit: 10 });

  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.path, "/api/conversations/conv-1/messages?afterSeq=42&limit=10");
  assert.equal(calls[0]!.init, undefined);
});

test("fetchConversationMessagesPage defaults limit to 100 when not given", async () => {
  const calls: string[] = [];
  const client = fakeClient((path) => {
    calls.push(path);
    return { messages: [], has_more: false, next_after_seq: 0 } satisfies ConversationMessagePageVM;
  });

  await fetchConversationMessagesPage(client, "conv-1", { afterSeq: 0 });

  assert.equal(calls[0], "/api/conversations/conv-1/messages?afterSeq=0&limit=100");
});

test("fetchConversationMessagesPage URL-encodes the conversation id", async () => {
  const calls: string[] = [];
  const client = fakeClient((path) => {
    calls.push(path);
    return { messages: [], has_more: false, next_after_seq: 0 } satisfies ConversationMessagePageVM;
  });

  await fetchConversationMessagesPage(client, "conv/needs escaping", { afterSeq: 0 });

  assert.match(calls[0]!, /^\/api\/conversations\/conv%2Fneeds%20escaping\/messages\?/u);
});

// R12 批8：首屏改为直接要「最新一页」（beforeSeq=Number.MAX_SAFE_INTEGER），替换掉批 2 那个
// "从 afterSeq=0 逐页正向拉到当前"的降级实现——见 api.ts 顶部注释与 batch-2-chat.md 的缺口记录。

test("fetchLatestConversationMessagesPage requests the newest page via beforeSeq=MAX_SAFE_INTEGER", async () => {
  const calls: string[] = [];
  const client = fakeClient((path) => {
    calls.push(path);
    return {
      messages: [textMessage("a", 41), textMessage("b", 42)],
      has_more: true,
      next_after_seq: 42,
      next_before_seq: 41
    } satisfies ConversationMessagePageVM;
  });

  const result = await fetchLatestConversationMessagesPage(client, "conv-1", { limit: 50 });

  assert.equal(calls[0], `/api/conversations/conv-1/messages?beforeSeq=${Number.MAX_SAFE_INTEGER}&limit=50`);
  assert.deepEqual(result.messages.map((m) => m.id), ["a", "b"]);
});

test("fetchLatestConversationMessagesPage defaults limit to 100 when not given", async () => {
  const calls: string[] = [];
  const client = fakeClient((path) => {
    calls.push(path);
    return { messages: [], has_more: false, next_after_seq: 0 } satisfies ConversationMessagePageVM;
  });

  await fetchLatestConversationMessagesPage(client, "conv-1");

  assert.equal(calls[0], `/api/conversations/conv-1/messages?beforeSeq=${Number.MAX_SAFE_INTEGER}&limit=100`);
});

test("fetchOlderConversationMessagesPage builds the beforeSeq/limit query string", async () => {
  const calls: string[] = [];
  const client = fakeClient((path) => {
    calls.push(path);
    return { messages: [textMessage("z", 10)], has_more: false, next_after_seq: 10, next_before_seq: 10 } satisfies ConversationMessagePageVM;
  });

  const result = await fetchOlderConversationMessagesPage(client, "conv-1", { beforeSeq: 41, limit: 30 });

  assert.equal(calls[0], "/api/conversations/conv-1/messages?beforeSeq=41&limit=30");
  assert.equal(result.messages[0]?.id, "z");
});

test("fetchOlderConversationMessagesPage URL-encodes the conversation id", async () => {
  const calls: string[] = [];
  const client = fakeClient((path) => {
    calls.push(path);
    return { messages: [], has_more: false, next_after_seq: 0, next_before_seq: 5 } satisfies ConversationMessagePageVM;
  });

  await fetchOlderConversationMessagesPage(client, "conv/needs escaping", { beforeSeq: 5 });

  assert.match(calls[0]!, /^\/api\/conversations\/conv%2Fneeds%20escaping\/messages\?/u);
});

test("sendConversationTextMessage posts a text-kind payload and returns the created message", async () => {
  const calls: Array<{ path: string; init: RequestInit | undefined }> = [];
  const created = textMessage("new-1", 5);
  const client = fakeClient((path, init) => {
    calls.push({ path, init });
    return created;
  });

  const result = await sendConversationTextMessage(client, "conv-1", "hello team");

  assert.equal(calls[0]!.path, "/api/conversations/conv-1/messages");
  assert.equal(calls[0]!.init?.method, "POST");
  assert.deepEqual(JSON.parse(calls[0]!.init!.body as string), { kind: "text", content: { text: "hello team" } });
  assert.equal(result, created);
});

test("sendConversationTextMessage includes thread_root_id only when given", async () => {
  const calls: Array<RequestInit | undefined> = [];
  const client = fakeClient((_path, init) => {
    calls.push(init);
    return textMessage("new-1", 5);
  });

  await sendConversationTextMessage(client, "conv-1", "reply text", "root-1");

  assert.deepEqual(JSON.parse(calls[0]!.body as string), {
    kind: "text",
    content: { text: "reply text" },
    thread_root_id: "root-1"
  });
});

test("sendConversationFileCardMessage posts a file_card-kind payload with only the drive item id", async () => {
  const calls: Array<RequestInit | undefined> = [];
  const client = fakeClient((_path, init) => {
    calls.push(init);
    return { ...textMessage("new-2", 6), kind: "file_card", content: { drive_item_id: "drive-1", snapshot_name: "report.xlsx" } };
  });

  await sendConversationFileCardMessage(client, "conv-1", "drive-1");

  assert.deepEqual(JSON.parse(calls[0]!.body as string), { kind: "file_card", content: { drive_item_id: "drive-1" } });
});

test("pingConversationTyping posts with no body and surfaces the published flag", async () => {
  const calls: Array<{ path: string; init: RequestInit | undefined }> = [];
  const client = fakeClient((path, init) => {
    calls.push({ path, init });
    return { published: true };
  });

  const result = await pingConversationTyping(client, "conv-1");

  assert.equal(calls[0]!.path, "/api/conversations/conv-1/typing");
  assert.equal(calls[0]!.init?.method, "POST");
  assert.equal(calls[0]!.init?.body, undefined);
  assert.deepEqual(result, { published: true });
});

test("requestConversationTurn posts the user_message_id and returns the turn id + Cuu message VM", async () => {
  const calls: Array<{ path: string; init: RequestInit | undefined }> = [];
  const cuuMessage: ConversationMessageVM = {
    ...textMessage("cuu-msg-1", 9),
    sender_type: "cuu",
    sender_user_id: null
  };
  const client = fakeClient((path, init) => {
    calls.push({ path, init });
    return { turn_id: "turn-1", message: cuuMessage };
  });

  const result = await requestConversationTurn(client, "conv-1", { userMessageId: "user-msg-1" });

  assert.equal(calls[0]!.path, "/api/conversations/conv-1/turns");
  assert.equal(calls[0]!.init?.method, "POST");
  assert.deepEqual(JSON.parse(calls[0]!.init!.body as string), { user_message_id: "user-msg-1" });
  assert.deepEqual(result, { turn_id: "turn-1", message: cuuMessage });
});

test("requestConversationTurn URL-encodes the conversation id", async () => {
  const calls: string[] = [];
  const client = fakeClient((path) => {
    calls.push(path);
    return { turn_id: "turn-1", message: textMessage("cuu-msg-1", 9) };
  });

  await requestConversationTurn(client, "conv/needs escaping", { userMessageId: "user-msg-1" });

  assert.equal(calls[0], "/api/conversations/conv%2Fneeds%20escaping/turns");
});

// —— R12（模式五档弹层）：GET/PATCH /api/me/ai-profile —— //

test("fetchMyAiProfile requests the profile endpoint with no body and returns the parsed VM", async () => {
  const calls: Array<{ path: string; init: RequestInit | undefined }> = [];
  const profile = aiProfile({ default_mode: 4 });
  const client = fakeClient((path, init) => {
    calls.push({ path, init });
    return profile;
  });

  const result = await fetchMyAiProfile(client);

  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.path, "/api/me/ai-profile");
  assert.equal(calls[0]!.init, undefined);
  assert.equal(result, profile);
});

test("patchMyAiMode PATCHes only default_mode and returns the refreshed profile", async () => {
  const calls: Array<{ path: string; init: RequestInit | undefined }> = [];
  const profile = aiProfile({ default_mode: 5 });
  const client = fakeClient((path, init) => {
    calls.push({ path, init });
    return profile;
  });

  const result = await patchMyAiMode(client, 5);

  assert.equal(calls[0]!.path, "/api/me/ai-profile");
  assert.equal(calls[0]!.init?.method, "PATCH");
  assert.deepEqual(JSON.parse(calls[0]!.init!.body as string), { default_mode: 5 });
  assert.equal(result, profile);
});

// —— R12 P0-A1：行动卡条目 decide/undo —— //

function actionCardItemResult(overrides: Partial<ActionCardItemDecisionResult> = {}): ActionCardItemDecisionResult {
  return {
    id: "item-1",
    conversation_id: "conv-1",
    action_card_id: "card-1",
    kind: "decide",
    title_md: "预算是否砍半",
    confidence: "low",
    status: "running",
    assignee_user_id: "user-1",
    work_item_id: "wi-1",
    run_id: null,
    undo_deadline_at: null,
    ...overrides
  };
}

test("decideActionCardItem posts the action and omits assignee_user_id when not given", async () => {
  const calls: Array<{ path: string; init: RequestInit | undefined }> = [];
  const result = actionCardItemResult({ status: "running" });
  const client = fakeClient((path, init) => {
    calls.push({ path, init });
    return result;
  });

  const outcome = await decideActionCardItem(client, { itemId: "item-1", action: "claim" });

  assert.equal(calls[0]!.path, "/api/action-card-items/item-1/decide");
  assert.equal(calls[0]!.init?.method, "POST");
  assert.deepEqual(JSON.parse(calls[0]!.init!.body as string), { action: "claim" });
  assert.equal(outcome, result);
});

test("decideActionCardItem includes assignee_user_id for a reassign action", async () => {
  const calls: Array<RequestInit | undefined> = [];
  const client = fakeClient((_path, init) => {
    calls.push(init);
    return actionCardItemResult({ assignee_user_id: "user-2" });
  });

  await decideActionCardItem(client, { itemId: "item-1", action: "reassign", assigneeUserId: "user-2" });

  assert.deepEqual(JSON.parse(calls[0]!.body as string), { action: "reassign", assignee_user_id: "user-2" });
});

test("decideActionCardItem URL-encodes the item id", async () => {
  const calls: string[] = [];
  const client = fakeClient((path) => {
    calls.push(path);
    return actionCardItemResult();
  });

  await decideActionCardItem(client, { itemId: "item/needs escaping", action: "defer" });

  assert.equal(calls[0], "/api/action-card-items/item%2Fneeds%20escaping/decide");
});

test("undoActionCardItem posts with no body and returns the updated item", async () => {
  const calls: Array<{ path: string; init: RequestInit | undefined }> = [];
  const result = actionCardItemResult({ kind: "execute", status: "undone" });
  const client = fakeClient((path, init) => {
    calls.push({ path, init });
    return result;
  });

  const outcome = await undoActionCardItem(client, { itemId: "item-1" });

  assert.equal(calls[0]!.path, "/api/action-card-items/item-1/undo");
  assert.equal(calls[0]!.init?.method, "POST");
  assert.equal(calls[0]!.init?.body, undefined);
  assert.equal(outcome, result);
});

test("undoActionCardItem URL-encodes the item id", async () => {
  const calls: string[] = [];
  const client = fakeClient((path) => {
    calls.push(path);
    return actionCardItemResult();
  });

  await undoActionCardItem(client, { itemId: "item/needs escaping" });

  assert.equal(calls[0], "/api/action-card-items/item%2Fneeds%20escaping/undo");
});

// —— R13 批 P2（拍板链路收尾）：dispatch_ask 错过补偿 —— //

test("fetchNotifications requests the existing GET /api/notifications endpoint with no body", async () => {
  const calls: Array<{ path: string; init: RequestInit | undefined }> = [];
  const client = fakeClient((path, init) => {
    calls.push({ path, init });
    return { items: [], counts: { unread: 0, total: 0 } };
  });

  const result = await fetchNotifications(client);

  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.path, "/api/notifications");
  assert.equal(calls[0]!.init, undefined);
  assert.deepEqual(result, { items: [], counts: { unread: 0, total: 0 } });
});

// —— R14 批 CHAT：编辑/删除/反应/置顶/已读/presence 端点 —— //

test("sendConversationTextMessage includes reply_to_message_id only when given", async () => {
  const calls: Array<{ path: string; body: unknown }> = [];
  const client = fakeClient((path, init) => {
    calls.push({ path, body: init?.body ? JSON.parse(init.body as string) : undefined });
    return textMessage("m-new", 12);
  });
  await sendConversationTextMessage(client, "conv-1", "回你这句", undefined, "m-target");
  assert.deepEqual(calls[0]!.body, { kind: "text", content: { text: "回你这句" }, reply_to_message_id: "m-target" });
});

test("editConversationMessage PATCHes the message with the new text and returns the updated VM", async () => {
  const calls: Array<{ path: string; init: RequestInit | undefined }> = [];
  const client = fakeClient((path, init) => {
    calls.push({ path, init });
    return { ...textMessage("m1", 3), content: { text: "改过了" }, edited_at: "2026-07-12T09:05:00.000000Z" };
  });
  const result = await editConversationMessage(client, "conv-1", "m1", "改过了");
  assert.equal(calls[0]!.path, "/api/conversations/conv-1/messages/m1");
  assert.equal(calls[0]!.init?.method, "PATCH");
  assert.deepEqual(JSON.parse(calls[0]!.init?.body as string), { text: "改过了" });
  assert.equal(result.edited_at, "2026-07-12T09:05:00.000000Z");
});

test("deleteConversationMessage DELETEs the message and returns the tombstone VM", async () => {
  const calls: Array<{ path: string; init: RequestInit | undefined }> = [];
  const client = fakeClient((path, init) => {
    calls.push({ path, init });
    return { ...textMessage("m1", 3), content: { text: "" }, deleted_at: "2026-07-12T10:00:00.000000Z" };
  });
  const result = await deleteConversationMessage(client, "conv-1", "m1");
  assert.equal(calls[0]!.path, "/api/conversations/conv-1/messages/m1");
  assert.equal(calls[0]!.init?.method, "DELETE");
  assert.equal(result.deleted_at, "2026-07-12T10:00:00.000000Z");
});

test("addConversationReaction / removeConversationReaction PUT/DELETE the slug-keyed reaction path", async () => {
  const calls: Array<{ path: string; method: string | undefined }> = [];
  const client = fakeClient((path, init) => {
    calls.push({ path, method: init?.method });
    return undefined;
  });
  await addConversationReaction(client, "conv-1", "m1", "approve");
  await removeConversationReaction(client, "conv-1", "m1", "watch");
  assert.deepEqual(calls[0], { path: "/api/conversations/conv-1/messages/m1/reactions/approve", method: "PUT" });
  assert.deepEqual(calls[1], { path: "/api/conversations/conv-1/messages/m1/reactions/watch", method: "DELETE" });
});

test("pinConversationMessage / unpinConversationMessage PUT/DELETE the pin path", async () => {
  const calls: Array<{ path: string; method: string | undefined }> = [];
  const client = fakeClient((path, init) => {
    calls.push({ path, method: init?.method });
    return undefined;
  });
  await pinConversationMessage(client, "conv-1", "m1");
  await unpinConversationMessage(client, "conv-1", "m1");
  assert.deepEqual(calls[0], { path: "/api/conversations/conv-1/messages/m1/pin", method: "PUT" });
  assert.deepEqual(calls[1], { path: "/api/conversations/conv-1/messages/m1/pin", method: "DELETE" });
});

test("fetchConversationPins GETs the pins list", async () => {
  const calls: string[] = [];
  const client = fakeClient((path) => {
    calls.push(path);
    return { messages: [textMessage("p1", 5)] };
  });
  const result = await fetchConversationPins(client, "conv-1");
  assert.equal(calls[0], "/api/conversations/conv-1/pins");
  assert.equal(result.messages.length, 1);
});

test("advanceConversationReadCursor PUTs the last_read_seq and returns the clamped cursor", async () => {
  const calls: Array<{ path: string; init: RequestInit | undefined }> = [];
  const client = fakeClient((path, init) => {
    calls.push({ path, init });
    return { last_read_seq: 9 };
  });
  const result = await advanceConversationReadCursor(client, "conv-1", 12);
  assert.equal(calls[0]!.path, "/api/conversations/conv-1/read");
  assert.equal(calls[0]!.init?.method, "PUT");
  assert.deepEqual(JSON.parse(calls[0]!.init?.body as string), { last_read_seq: 12 });
  assert.equal(result.last_read_seq, 9);
});

test("fetchConversationReceipts GETs the receipts list", async () => {
  const calls: string[] = [];
  const client = fakeClient((path) => {
    calls.push(path);
    return { receipts: [{ user_id: "u1", last_read_seq: 7 }] };
  });
  const result = await fetchConversationReceipts(client, "conv-1");
  assert.equal(calls[0], "/api/conversations/conv-1/receipts");
  assert.equal(result.receipts[0]!.last_read_seq, 7);
});

test("putConversationMessageFeedback PUTs {verdict} and omits note when not given", async () => {
  const calls: Array<{ path: string; init: RequestInit | undefined }> = [];
  const client = fakeClient((path, init) => {
    calls.push({ path, init });
    return undefined;
  });
  await putConversationMessageFeedback(client, "conv-1", "m1", { verdict: "useful" });
  assert.equal(calls[0]!.path, "/api/conversations/conv-1/messages/m1/feedback");
  assert.equal(calls[0]!.init?.method, "PUT");
  assert.deepEqual(JSON.parse(calls[0]!.init?.body as string), { verdict: "useful" });
});

test("putConversationMessageFeedback includes note only when given (and never an empty string)", async () => {
  const calls: Array<{ init: RequestInit | undefined }> = [];
  const client = fakeClient((_path, init) => {
    calls.push({ init });
    return undefined;
  });
  await putConversationMessageFeedback(client, "conv-1", "m1", { verdict: "not_useful", note: "答非所问" });
  assert.deepEqual(JSON.parse(calls[0]!.init?.body as string), { verdict: "not_useful", note: "答非所问" });
  await putConversationMessageFeedback(client, "conv-1", "m1", { verdict: "not_useful", note: "" });
  assert.deepEqual(JSON.parse(calls[1]!.init?.body as string), { verdict: "not_useful" });
});

test("deleteConversationMessageFeedback DELETEs the message feedback path", async () => {
  const calls: Array<{ path: string; method: string | undefined }> = [];
  const client = fakeClient((path, init) => {
    calls.push({ path, method: init?.method });
    return undefined;
  });
  await deleteConversationMessageFeedback(client, "conv-1", "m1");
  assert.deepEqual(calls[0], { path: "/api/conversations/conv-1/messages/m1/feedback", method: "DELETE" });
});

test("putActionCardItemFeedback / deleteActionCardItemFeedback PUT/DELETE the item feedback path, no note support", async () => {
  const calls: Array<{ path: string; init: RequestInit | undefined }> = [];
  const client = fakeClient((path, init) => {
    calls.push({ path, init });
    return undefined;
  });
  await putActionCardItemFeedback(client, "i1", "useful");
  await deleteActionCardItemFeedback(client, "i1");
  assert.equal(calls[0]!.path, "/api/action-card-items/i1/feedback");
  assert.equal(calls[0]!.init?.method, "PUT");
  assert.deepEqual(JSON.parse(calls[0]!.init?.body as string), { verdict: "useful" });
  assert.deepEqual(calls[1], { path: "/api/action-card-items/i1/feedback", init: { method: "DELETE" } });
});

test("fetchPresence dedupes/caps user_ids into the query and short-circuits an empty list without a request", async () => {
  const calls: string[] = [];
  const client = fakeClient((path) => {
    calls.push(path);
    return { presence: [{ user_id: "u1", is_online: true, last_seen_at: null }] };
  });
  const result = await fetchPresence(client, ["u1", "u1", "u2"]);
  assert.equal(calls[0], "/api/presence?user_ids=u1%2Cu2");
  assert.equal(result.presence.length, 1);
  const empty = await fetchPresence(client, []);
  assert.deepEqual(empty, { presence: [] });
  assert.equal(calls.length, 1, "empty list must not hit the network");
});
