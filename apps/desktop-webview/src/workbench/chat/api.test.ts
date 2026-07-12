import assert from "node:assert/strict";
import { test } from "node:test";

import type { ConversationMessagePageVM, ConversationMessageVM } from "@workhub/contracts";

import {
  fetchAllConversationMessagesFromStart,
  fetchConversationMessagesPage,
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

test("fetchAllConversationMessagesFromStart walks pages forward from afterSeq=0 until has_more is false", async () => {
  const calls: string[] = [];
  const pages: ConversationMessagePageVM[] = [
    { messages: [textMessage("a", 1), textMessage("b", 2)], has_more: true, next_after_seq: 2 },
    { messages: [textMessage("c", 3)], has_more: false, next_after_seq: 3 }
  ];
  let call = 0;
  const client = fakeClient((path) => {
    calls.push(path);
    return pages[call++]!;
  });

  const result = await fetchAllConversationMessagesFromStart(client, "conv-1", { pageLimit: 2 });

  assert.equal(result.truncated, false);
  assert.deepEqual(result.messages.map((m) => m.id), ["a", "b", "c"]);
  assert.deepEqual(calls, [
    "/api/conversations/conv-1/messages?afterSeq=0&limit=2",
    "/api/conversations/conv-1/messages?afterSeq=2&limit=2"
  ]);
});

test("fetchAllConversationMessagesFromStart returns an empty, non-truncated result for a brand-new conversation", async () => {
  const client = fakeClient(() => ({ messages: [], has_more: false, next_after_seq: 0 }) satisfies ConversationMessagePageVM);

  const result = await fetchAllConversationMessagesFromStart(client, "conv-1");

  assert.deepEqual(result, { messages: [], truncated: false });
});

test("fetchAllConversationMessagesFromStart stops at maxPages instead of looping forever, and reports truncated:true", async () => {
  let call = 0;
  const client = fakeClient(() => {
    call += 1;
    // has_more never turns false — a pathological/regressed server would otherwise loop forever.
    return { messages: [textMessage(`m${call}`, call)], has_more: true, next_after_seq: call } satisfies ConversationMessagePageVM;
  });

  const result = await fetchAllConversationMessagesFromStart(client, "conv-1", { pageLimit: 1, maxPages: 3 });

  assert.equal(call, 3);
  assert.equal(result.truncated, true);
  assert.equal(result.messages.length, 3);
});

test("fetchAllConversationMessagesFromStart stops defensively if next_after_seq stops advancing (server contract violation)", async () => {
  let call = 0;
  const client = fakeClient(() => {
    call += 1;
    // next_after_seq stuck at 5 forever while claiming has_more — must not spin forever. The first
    // page still legitimately advances afterSeq 0 -> 5; it's the *second* page repeating next_after_seq=5
    // without progress that must trip the guard (rather than spinning at maxPages=1000).
    return { messages: [textMessage(`m${call}`, 5)], has_more: true, next_after_seq: 5 } satisfies ConversationMessagePageVM;
  });

  const result = await fetchAllConversationMessagesFromStart(client, "conv-1", { pageLimit: 1, maxPages: 1000 });

  assert.equal(call, 2);
  assert.equal(result.truncated, true);
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
