import assert from "node:assert/strict";
import { test } from "node:test";

import type { ConversationMessagePageVM, ConversationMessageVM } from "@workhub/contracts";

import {
  fetchConversationMessagesPage,
  fetchLatestConversationMessagesPage,
  fetchOlderConversationMessagesPage,
  pingConversationTyping,
  sendConversationFileCardMessage,
  sendConversationTextMessage,
  type ChatApiClient
} from "./api.js";

function fakeClient(handler: (path: string, init?: RequestInit) => unknown): ChatApiClient {
  return {
    request: async <T>(path: string, init?: RequestInit) => handler(path, init) as T
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
