import assert from "node:assert/strict";
import { test } from "node:test";

import type { DmListItemVM } from "@workhub/contracts";

import {
  chunkPresenceIds,
  createDmListReloadCoordinator,
  dmMembersFromParticipants,
  dmPeerParticipant,
  fetchDmList,
  fetchOnlineUserIds,
  openDirectMessage,
  upsertDmListItem
} from "./dm.js";

const selfId = "60000000-0000-4000-8000-000000000001";
const peerId = "60000000-0000-4000-8000-000000000002";
const convId = "30000000-0000-4000-8000-000000000003";
const containerId = "20000000-0000-4000-8000-000000000009";

function dmItem(over: { conversationId?: string; peerNickname?: string } = {}): DmListItemVM {
  return {
    conversation: {
      id: over.conversationId ?? convId,
      workspace_id: "80000000-0000-4000-8000-000000000008",
      project_id: containerId,
      kind: "collab",
      title: "私聊",
      parent_conversation_id: null,
      source_message_id: null,
      visibility: "private",
      next_seq: 0,
      created_by: selfId,
      participant_role: "owner",
      cuu_enabled: false,
      is_dm: true,
      created_at: "2026-07-15T08:30:00.123Z",
      updated_at: "2026-07-15T08:31:00.123Z"
    },
    participants: [
      { user_id: selfId, nickname: "me", is_self: true },
      { user_id: peerId, nickname: over.peerNickname ?? "peer", is_self: false }
    ]
  };
}

// —— presence 分批（≤50） —— //

test("chunkPresenceIds dedups and splits into chunks of at most 50", () => {
  const ids = Array.from({ length: 120 }, (_, i) => `u-${i}`);
  const chunks = chunkPresenceIds(ids);
  assert.deepEqual(chunks.map((chunk) => chunk.length), [50, 50, 20]);
  // 去重 + 过滤空串。
  assert.deepEqual(chunkPresenceIds(["a", "a", "b", "", "c"]), [["a", "b", "c"]]);
  assert.deepEqual(chunkPresenceIds([]), []);
});

test("fetchOnlineUserIds batches >50 ids into ≤50-id presence calls and unions the online sets", async () => {
  const ids = Array.from({ length: 60 }, (_, i) => `10000000-0000-4000-8000-0000000000${String(i).padStart(2, "0")}`);
  const seenBatches: string[][] = [];
  const client = {
    request: async <T>(path: string): Promise<T> => {
      const query = new URLSearchParams(path.split("?")[1] ?? "");
      const batch = (query.get("user_ids") ?? "").split(",").filter(Boolean);
      seenBatches.push(batch);
      // 每批把第一个 id 标为在线，其余离线。
      const presence = batch.map((id, index) => ({
        user_id: id,
        is_online: index === 0,
        last_seen_at: index === 0 ? "2026-07-15T09:00:00.000Z" : null
      }));
      return { presence } as T;
    }
  };

  const online = await fetchOnlineUserIds(client, ids);

  // 两批（50 + 10），每批 ≤50。
  assert.equal(seenBatches.length, 2);
  assert.equal(seenBatches[0]!.length, 50);
  assert.equal(seenBatches[1]!.length, 10);
  assert.ok(seenBatches.every((batch) => batch.length <= 50));
  // 并集：两批各自的第一个 id 在线。
  assert.equal(online.size, 2);
  assert.ok(online.has(ids[0]!));
  assert.ok(online.has(ids[50]!));
});

test("fetchOnlineUserIds keeps the online union it already has when a later batch throws", async () => {
  const ids = Array.from({ length: 60 }, (_, i) => `20000000-0000-4000-8000-0000000000${String(i).padStart(2, "0")}`);
  let call = 0;
  const client = {
    request: async <T>(path: string): Promise<T> => {
      call += 1;
      if (call === 2) {
        throw new Error("second batch failed");
      }
      const query = new URLSearchParams(path.split("?")[1] ?? "");
      const batch = (query.get("user_ids") ?? "").split(",").filter(Boolean);
      return { presence: batch.map((id) => ({ user_id: id, is_online: true, last_seen_at: null })) } as T;
    }
  };

  const online = await fetchOnlineUserIds(client, ids);
  // 第一批 50 个全在线，第二批抛错被吞——保留已拿到的并集。
  assert.equal(online.size, 50);
});

// —— DM 列表 upsert / peer / members —— //

test("upsertDmListItem prepends a new DM and replaces an existing one in place", () => {
  const a = dmItem({ conversationId: convId });
  const b = dmItem({ conversationId: "30000000-0000-4000-8000-000000000099" });
  const inserted = upsertDmListItem([a], b);
  assert.deepEqual(inserted.map((item) => item.conversation.id), [b.conversation.id, a.conversation.id]);

  // 同一 conversation id → 原地替换，不重复、不改数量。
  const updated = upsertDmListItem([a, b], dmItem({ conversationId: convId, peerNickname: "renamed" }));
  assert.equal(updated.length, 2);
  assert.equal(updated[0]!.participants[1]!.nickname, "renamed");
});

test("dmPeerParticipant returns the non-self participant", () => {
  const item = dmItem();
  assert.equal(dmPeerParticipant(item, selfId)?.user_id, peerId);
  // 没有 currentUserId 时退回 is_self=false 的那位。
  assert.equal(dmPeerParticipant(item, undefined)?.user_id, peerId);
});

test("dmMembersFromParticipants maps the 2 participants into member VMs (denominator fix source)", () => {
  const members = dmMembersFromParticipants(dmItem());
  assert.equal(members.length, 2);
  assert.deepEqual(
    members.map((member) => ({ user_id: member.user_id, is_self: member.is_self })),
    [
      { user_id: selfId, is_self: true },
      { user_id: peerId, is_self: false }
    ]
  );
  // chat 视图的 otherMemberIds = members 去掉自己 → DM 分母恒为 1（1/1，而非全工作区成员）。
  const otherMemberIds = members.map((member) => member.user_id).filter((id) => id !== selfId);
  assert.deepEqual(otherMemberIds, [peerId]);
});

// —— 端点转发 —— //

test("fetchDmList calls GET /api/dm/list and openDirectMessage POSTs /api/dm/open", async () => {
  const calls: { path: string; init?: RequestInit }[] = [];
  const client = {
    request: async <T>(path: string, init?: RequestInit): Promise<T> => {
      calls.push({ path, ...(init ? { init } : {}) });
      if (path === "/api/dm/list") {
        return { items: [] } as T;
      }
      return { conversation: dmItem().conversation } as T;
    }
  };

  await fetchDmList(client);
  await openDirectMessage(client, peerId);

  assert.equal(calls[0]!.path, "/api/dm/list");
  assert.equal(calls[1]!.path, "/api/dm/open");
  assert.equal(calls[1]!.init?.method, "POST");
  assert.deepEqual(JSON.parse(String(calls[1]!.init?.body)), { user_id: peerId });
});

// —— MRG-21：DM 列表加载协调器（在飞单例 + 冷却） —— //

test("createDmListReloadCoordinator shares the in-flight request across concurrent callers", async () => {
  let loads = 0;
  let releaseLoad: (() => void) | undefined;
  const load = () =>
    new Promise<void>((resolve) => {
      loads += 1;
      releaseLoad = resolve;
    });
  const coordinator = createDmListReloadCoordinator({ load });

  const first = coordinator();
  const second = coordinator();
  await Promise.resolve();
  assert.equal(loads, 1, "concurrent calls must share one in-flight request");
  releaseLoad?.();
  await Promise.all([first, second]);
});

test("createDmListReloadCoordinator skips non-forced reloads inside the cooldown window", async () => {
  let now = 10_000;
  let loads = 0;
  const coordinator = createDmListReloadCoordinator({
    load: async () => {
      loads += 1;
    },
    cooldownMs: 5_000,
    now: () => now
  });

  await coordinator();
  assert.equal(loads, 1);

  // 冷却期内的普通触发（未知会话通知 bump 未命中）被跳过——别的项目每条消息都触发也不再打爆后端。
  now += 1_000;
  await coordinator();
  await coordinator();
  assert.equal(loads, 1);

  // 冷却期过后正常再拉。
  now += 5_000;
  await coordinator();
  assert.equal(loads, 2);
});

test("createDmListReloadCoordinator lets force bypass the cooldown but still share the in-flight request", async () => {
  let now = 0;
  let loads = 0;
  let releaseLoad: (() => void) | undefined;
  let pending = false;
  const coordinator = createDmListReloadCoordinator({
    load: () => {
      loads += 1;
      if (pending) {
        return new Promise<void>((resolve) => {
          releaseLoad = resolve;
        });
      }
      return Promise.resolve();
    },
    cooldownMs: 5_000,
    now: () => now
  });

  await coordinator();
  assert.equal(loads, 1);

  // 冷却期内 force（深链兜底）必须真发一次。
  now += 100;
  pending = true;
  const forced = coordinator({ force: true });
  await Promise.resolve();
  assert.equal(loads, 2);

  // force 在飞期间，普通/force 调用都共享同一 promise，不再发第三次。
  const shared = coordinator({ force: true });
  await Promise.resolve();
  assert.equal(loads, 2);
  releaseLoad?.();
  await Promise.all([forced, shared]);

  // 在飞复用后冷却计时从最近一次发起算——刚拉完不久的非 force 调用仍被跳过。
  await coordinator();
  assert.equal(loads, 2);
});
