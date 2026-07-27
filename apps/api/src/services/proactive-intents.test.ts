import assert from "node:assert/strict";
import test from "node:test";

import type { Notification } from "@workhub/contracts";
import type { ProactiveIntentStatus, RecoverableProactiveIntentRow } from "@workhub/db";

import {
  createProactiveIntentService,
  isWithinProactiveQuietHours,
  parseProactiveQuietHours,
  type ProactiveConversationDelivery,
  type ProactiveActionCardDelivery,
  type ProactiveIntentInput,
  type ProactiveIntentRepositoryDeps
} from "./proactive-intents.js";

const at = new Date("2026-07-15T14:00:00.000Z");

function intent(over: Partial<ProactiveIntentInput> = {}): ProactiveIntentInput {
  return {
    workspaceId: "d0000000-0000-4000-8000-000000000001",
    projectId: "d0000000-0000-4000-8000-000000000002",
    workItemId: "d0000000-0000-4000-8000-000000000003",
    kind: "ddl_chase",
    stage: "overdue",
    targetUserId: "d0000000-0000-4000-8000-000000000004",
    suppressionKey: "ddl:wi:overdue",
    payload: { stage: "overdue" },
    notification: {
      type: "work_item.overdue",
      severity: "high",
      title: "上线报价单 已逾期",
      body: "尽快处理。",
      targetUrl: "/workitems/d0000000-0000-4000-8000-000000000003",
      dedupeKey: "ddl:wi:overdue"
    },
    ...over
  };
}

type RepoState = {
  recorded: Array<Parameters<ProactiveIntentRepositoryDeps["recordIntent"]>[0]>;
  status: Array<Parameters<ProactiveIntentRepositoryDeps["markStatus"]>[0]>;
  incremented: string[];
  // R21 加固：投递前原子领取的调用记录（并发幂等断言用）。
  claims: Array<Parameters<ProactiveIntentRepositoryDeps["claimForDelivery"]>[0]>;
};

function fakeRepo(options: {
  created?: boolean;
  // 撞唯一约束时回带的既有行状态（R20 REL-2 崩溃恢复：'created'=可恢复、其余=真 duplicate）。
  existingStatus?: ProactiveIntentStatus;
  existingId?: string;
  deliveredToday?: number;
  recoverable?: RecoverableProactiveIntentRow[];
  // R21 加固：领取结果（缺省 true = 领到）。false 模拟并发对手先领走——服务必须按 duplicate 收口/跳过。
  claimReturns?: boolean;
} = {}): {
  repo: ProactiveIntentRepositoryDeps;
  state: RepoState;
} {
  const state: RepoState = { recorded: [], status: [], incremented: [], claims: [] };
  const repo: ProactiveIntentRepositoryDeps = {
    async recordIntent(input) {
      state.recorded.push(input);
      const created = options.created ?? true;
      if (created) {
        return { created: true, id: "intent-1" };
      }
      // 撞唯一约束——回带既有行 id + status（默认 'delivered' = 真 duplicate）。
      return { created: false, id: options.existingId ?? "intent-1", status: options.existingStatus ?? "delivered" };
    },
    async countDeliveredForUserOnDay() {
      return options.deliveredToday ?? 0;
    },
    async markStatus(input) {
      state.status.push(input);
    },
    async claimForDelivery(input) {
      state.claims.push(input);
      return options.claimReturns ?? true;
    },
    async listRecoverable() {
      return options.recoverable ?? [];
    },
    async incrementAttempt(input) {
      state.incremented.push(input.id);
    }
  };
  return { repo, state };
}

function notificationRow(): Notification {
  return {
    id: "notif-1",
    user_id: "d0000000-0000-4000-8000-000000000004",
    type: "work_item.overdue",
    severity: "high",
    title: "上线报价单 已逾期",
    created_at: at.toISOString(),
    updated_at: at.toISOString()
  };
}

test("recordAndDeliver: first-time intent under cap and not muted delivers via notification", async () => {
  const { repo, state } = fakeRepo();
  const created: unknown[] = [];
  const service = createProactiveIntentService({
    repository: repo,
    notifications: {
      async createNotification(draft) {
        created.push(draft);
        return notificationRow();
      }
    },
    dailyCapPerUser: 10,
    now: () => at
  });
  const result = await service.recordAndDeliver(intent());
  assert.deepEqual(result, { status: "delivered", intentId: "intent-1" });
  assert.equal(created.length, 1);
  assert.deepEqual(state.status, [{ id: "intent-1", status: "delivered", deliveredVia: "notification" }]);
  // overdue 不带 nextRemindAt（由 ddl-chase 决定；这里入参没给）——闸不自作主张添加。
  assert.equal((created[0] as Record<string, unknown>)["nextRemindAt"], undefined);
});

test("recordAndDeliver: nextRemindAt on the intent is threaded into the notification (overdue reminder ladder)", async () => {
  const { repo } = fakeRepo();
  const nextRemindAt = new Date(at.getTime() + 24 * 60 * 60 * 1000);
  let seen: Record<string, unknown> | undefined;
  const service = createProactiveIntentService({
    repository: repo,
    notifications: {
      async createNotification(draft) {
        seen = draft as Record<string, unknown>;
        return notificationRow();
      }
    },
    dailyCapPerUser: 10,
    now: () => at
  });
  await service.recordAndDeliver(intent({ notification: { ...intent().notification, nextRemindAt } }));
  assert.equal((seen?.["nextRemindAt"] as Date | undefined)?.getTime(), nextRemindAt.getTime());
});

test("recordAndDeliver: a duplicate suppression_key is idempotently skipped without delivering", async () => {
  const { repo, state } = fakeRepo({ created: false });
  let notified = 0;
  const service = createProactiveIntentService({
    repository: repo,
    notifications: {
      async createNotification() {
        notified += 1;
        return notificationRow();
      }
    },
    dailyCapPerUser: 10,
    now: () => at
  });
  const result = await service.recordAndDeliver(intent());
  assert.deepEqual(result, { status: "suppressed", reason: "duplicate" });
  assert.equal(notified, 0, "duplicate must not deliver");
  assert.equal(state.status.length, 0, "duplicate does not touch status (row already terminal)");
});

// R20 REL-2（#P1-11）：崩溃恢复腿 1——同 key 重试。既有行还停在 created（投递前进程崩溃）→ 不再误判成
// duplicate，而是就地复用手里的 intent 恢复投递。旧代码此处稳定返回 { suppressed, duplicate }（红）。
test("recordAndDeliver: a same-key retry whose existing row is still 'created' (pre-delivery crash) RESUMES delivery", async () => {
  const { repo, state } = fakeRepo({ created: false, existingStatus: "created", existingId: "intent-1" });
  let notified = 0;
  const service = createProactiveIntentService({
    repository: repo,
    notifications: {
      async createNotification() {
        notified += 1;
        return notificationRow();
      }
    },
    dailyCapPerUser: 10,
    now: () => at
  });
  const result = await service.recordAndDeliver(intent());
  // 恢复投递并顶 delivered——不是 duplicate。
  assert.deepEqual(result, { status: "delivered", intentId: "intent-1" });
  assert.equal(notified, 1, "the crashed intent is re-delivered on the same-key retry");
  assert.deepEqual(state.status, [{ id: "intent-1", status: "delivered", deliveredVia: "notification" }]);
});

// R21 加固（并发投递幂等）：投递前必须先原子领取（created → delivering）。下面三条钉死并发语义——
// 领不到（并发对手先领走）就绝不执行任何投递副作用。
test("recordAndDeliver: a fresh insert that loses the delivery claim race is a duplicate with zero side effects", async () => {
  const { repo, state } = fakeRepo({ claimReturns: false });
  let notified = 0;
  const service = createProactiveIntentService({
    repository: repo,
    notifications: {
      async createNotification() {
        notified += 1;
        return notificationRow();
      }
    },
    dailyCapPerUser: 10,
    now: () => at
  });
  const result = await service.recordAndDeliver(intent());
  assert.deepEqual(result, { status: "suppressed", reason: "duplicate" });
  assert.equal(notified, 0, "losing the claim must not deliver");
  assert.equal(state.status.length, 0, "the loser must not touch the row status either");
  // 常规路径的领取不带 stalledBefore（只允许从 created 领取）。
  assert.deepEqual(state.claims, [{ id: "intent-1" }]);
});

test("recordAndDeliver: a same-key retry on a 'created' row that loses the claim race is a duplicate (no double delivery)", async () => {
  const { repo, state } = fakeRepo({ created: false, existingStatus: "created", existingId: "intent-1", claimReturns: false });
  let notified = 0;
  const service = createProactiveIntentService({
    repository: repo,
    notifications: {
      async createNotification() {
        notified += 1;
        return notificationRow();
      }
    },
    dailyCapPerUser: 10,
    now: () => at
  });
  const result = await service.recordAndDeliver(intent());
  assert.deepEqual(result, { status: "suppressed", reason: "duplicate" });
  assert.equal(notified, 0, "two concurrent same-key retries must deliver at most once");
  assert.equal(state.status.length, 0);
});

test("recordAndDeliver: a same-key retry whose existing row is 'delivering' (in-flight elsewhere) is a duplicate without claiming", async () => {
  const { repo, state } = fakeRepo({ created: false, existingStatus: "delivering", existingId: "intent-1" });
  let notified = 0;
  const service = createProactiveIntentService({
    repository: repo,
    notifications: {
      async createNotification() {
        notified += 1;
        return notificationRow();
      }
    },
    dailyCapPerUser: 10,
    now: () => at
  });
  const result = await service.recordAndDeliver(intent());
  assert.deepEqual(result, { status: "suppressed", reason: "duplicate" });
  assert.equal(notified, 0, "an in-flight row must not be re-delivered by a same-key retry");
  assert.equal(state.claims.length, 0, "the regular path does not even attempt to claim a delivering row");
});

test("recordAndDeliver: a same-key retry whose existing row is 'suppressed' stays a true duplicate", async () => {
  const { repo, state } = fakeRepo({ created: false, existingStatus: "suppressed", existingId: "intent-1" });
  let notified = 0;
  const service = createProactiveIntentService({
    repository: repo,
    notifications: {
      async createNotification() {
        notified += 1;
        return notificationRow();
      }
    },
    dailyCapPerUser: 10,
    now: () => at
  });
  const result = await service.recordAndDeliver(intent());
  assert.deepEqual(result, { status: "suppressed", reason: "duplicate" });
  assert.equal(notified, 0, "an already-terminal row must not re-deliver");
  assert.equal(state.status.length, 0);
});

test("recordAndDeliver: reaching the per-user daily cap suppresses the intent (recorded, not delivered)", async () => {
  const { repo, state } = fakeRepo({ deliveredToday: 10 });
  let notified = 0;
  const service = createProactiveIntentService({
    repository: repo,
    notifications: {
      async createNotification() {
        notified += 1;
        return notificationRow();
      }
    },
    dailyCapPerUser: 10,
    now: () => at
  });
  const result = await service.recordAndDeliver(intent());
  assert.deepEqual(result, { status: "suppressed", reason: "daily_cap", intentId: "intent-1" });
  assert.equal(notified, 0, "over-cap must not deliver");
  assert.deepEqual(state.status, [{ id: "intent-1", status: "suppressed" }]);
});

test("recordAndDeliver: a muted recipient (notification returns null) marks the intent suppressed", async () => {
  const { repo, state } = fakeRepo();
  const service = createProactiveIntentService({
    repository: repo,
    notifications: {
      async createNotification() {
        return null; // isMutedForRecipient inside the notification service
      }
    },
    dailyCapPerUser: 10,
    now: () => at
  });
  const result = await service.recordAndDeliver(intent());
  assert.deepEqual(result, { status: "suppressed", reason: "muted", intentId: "intent-1" });
  assert.deepEqual(state.status, [{ id: "intent-1", status: "suppressed" }]);
});

// ── D2 会话通道（conversation_message）───────────────────────────────────────────────────

type ConversationDeliveryCall = Parameters<ProactiveConversationDelivery["deliverCuuMessage"]>[0];

function fakeConversationDelivery(
  outcome: Awaited<ReturnType<ProactiveConversationDelivery["deliverCuuMessage"]>> | (() => never)
): { delivery: ProactiveConversationDelivery; calls: ConversationDeliveryCall[] } {
  const calls: ConversationDeliveryCall[] = [];
  const delivery: ProactiveConversationDelivery = {
    async deliverCuuMessage(input) {
      calls.push(input);
      if (typeof outcome === "function") {
        outcome();
      }
      return outcome as Awaited<ReturnType<ProactiveConversationDelivery["deliverCuuMessage"]>>;
    }
  };
  return { delivery, calls };
}

function conversationIntent(over: Partial<ProactiveIntentInput> = {}): ProactiveIntentInput {
  return intent({ channel: "conversation_message", conversationText: "提醒一下：「上线报价单」明天就到期了。", ...over });
}

test("recordAndDeliver: conversation channel delivers a Cuu message and marks delivered_via=conversation_message", async () => {
  const { repo, state } = fakeRepo();
  const { delivery, calls } = fakeConversationDelivery({ delivered: true, conversationId: "conv-1" });
  let notified = 0;
  const service = createProactiveIntentService({
    repository: repo,
    notifications: {
      async createNotification() {
        notified += 1;
        return notificationRow();
      }
    },
    conversationDelivery: delivery,
    dailyCapPerUser: 10,
    now: () => at
  });
  const result = await service.recordAndDeliver(conversationIntent());
  assert.deepEqual(result, { status: "delivered", intentId: "intent-1" });
  assert.equal(calls.length, 1, "conversation channel must be attempted");
  assert.equal(calls[0]?.text, "提醒一下：「上线报价单」明天就到期了。");
  assert.equal(calls[0]?.proactiveIntentId, "intent-1", "intent id threads onto the delivered message");
  assert.equal(notified, 0, "a successful conversation delivery must not also fire a notification");
  assert.deepEqual(state.status, [{ id: "intent-1", status: "delivered", deliveredVia: "conversation_message" }]);
});

test("recordAndDeliver: conversation channel degrades to notification when the personal space is missing", async () => {
  const { repo, state } = fakeRepo();
  const { delivery, calls } = fakeConversationDelivery({ delivered: false, reason: "no_personal_space" });
  const notifications: unknown[] = [];
  const service = createProactiveIntentService({
    repository: repo,
    notifications: {
      async createNotification(draft) {
        notifications.push(draft);
        return notificationRow();
      }
    },
    conversationDelivery: delivery,
    dailyCapPerUser: 10,
    now: () => at
  });
  const result = await service.recordAndDeliver(conversationIntent());
  assert.deepEqual(result, { status: "delivered", intentId: "intent-1" });
  assert.equal(calls.length, 1, "conversation channel is attempted first");
  assert.equal(notifications.length, 1, "then it degrades to the notification channel");
  assert.deepEqual(state.status, [{ id: "intent-1", status: "delivered", deliveredVia: "notification" }]);
});

test("recordAndDeliver: conversation channel degrades to notification when delivery throws", async () => {
  const { repo, state } = fakeRepo();
  const { delivery } = fakeConversationDelivery(() => {
    throw new Error("broker down");
  });
  let notified = 0;
  const service = createProactiveIntentService({
    repository: repo,
    notifications: {
      async createNotification() {
        notified += 1;
        return notificationRow();
      }
    },
    conversationDelivery: delivery,
    dailyCapPerUser: 10,
    now: () => at,
    logger: { warn() {} }
  });
  const result = await service.recordAndDeliver(conversationIntent());
  assert.deepEqual(result, { status: "delivered", intentId: "intent-1" });
  assert.equal(notified, 1, "a delivery throw degrades to notification (fail-open)");
  assert.deepEqual(state.status, [{ id: "intent-1", status: "delivered", deliveredVia: "notification" }]);
});

test("recordAndDeliver: a conversation-channel intent with no delivery port injected degrades to notification", async () => {
  const { repo, state } = fakeRepo();
  let notified = 0;
  const service = createProactiveIntentService({
    repository: repo,
    notifications: {
      async createNotification() {
        notified += 1;
        return notificationRow();
      }
    },
    // conversationDelivery 未注入。
    dailyCapPerUser: 10,
    now: () => at
  });
  const result = await service.recordAndDeliver(conversationIntent());
  assert.deepEqual(result, { status: "delivered", intentId: "intent-1" });
  assert.equal(notified, 1);
  assert.deepEqual(state.status, [{ id: "intent-1", status: "delivered", deliveredVia: "notification" }]);
});

test("recordAndDeliver: the per-user daily cap suppresses a conversation-channel intent before any delivery", async () => {
  const { repo, state } = fakeRepo({ deliveredToday: 10 });
  const { delivery, calls } = fakeConversationDelivery({ delivered: true, conversationId: "conv-1" });
  const service = createProactiveIntentService({
    repository: repo,
    notifications: {
      async createNotification() {
        return notificationRow();
      }
    },
    conversationDelivery: delivery,
    dailyCapPerUser: 10,
    now: () => at
  });
  const result = await service.recordAndDeliver(conversationIntent());
  assert.deepEqual(result, { status: "suppressed", reason: "daily_cap", intentId: "intent-1" });
  assert.equal(calls.length, 0, "the cap gate runs before the conversation channel");
  assert.deepEqual(state.status, [{ id: "intent-1", status: "suppressed" }]);
});

test("recordAndDeliver: a duplicate conversation-channel intent is idempotently skipped without delivering", async () => {
  const { repo, state } = fakeRepo({ created: false });
  const { delivery, calls } = fakeConversationDelivery({ delivered: true, conversationId: "conv-1" });
  const service = createProactiveIntentService({
    repository: repo,
    notifications: {
      async createNotification() {
        return notificationRow();
      }
    },
    conversationDelivery: delivery,
    dailyCapPerUser: 10,
    now: () => at
  });
  const result = await service.recordAndDeliver(conversationIntent());
  assert.deepEqual(result, { status: "suppressed", reason: "duplicate" });
  assert.equal(calls.length, 0, "duplicate must not deliver on any channel");
  assert.equal(state.status.length, 0);
});

// ── 批 F 关怀通道（degradeToNotification=false：不降级到系统通知）─────────────────────────────

function careIntent(over: Partial<ProactiveIntentInput> = {}): ProactiveIntentInput {
  return intent({
    projectId: null,
    workItemId: null,
    kind: "care",
    stage: "high_load",
    suppressionKey: "care:u1:high_load:20260713",
    channel: "conversation_message",
    conversationText: "最近你手上的活儿有点多，记得给自己留点喘口气的空间。",
    degradeToNotification: false,
    ...over
  });
}

test("recordAndDeliver: a care intent with no personal space is suppressed, NEVER degraded to a notification", async () => {
  const { repo, state } = fakeRepo();
  const { delivery, calls } = fakeConversationDelivery({ delivered: false, reason: "no_personal_space" });
  let notified = 0;
  const service = createProactiveIntentService({
    repository: repo,
    notifications: {
      async createNotification() {
        notified += 1;
        return notificationRow();
      }
    },
    conversationDelivery: delivery,
    dailyCapPerUser: 10,
    now: () => at,
    logger: { warn() {} }
  });
  const result = await service.recordAndDeliver(careIntent());
  assert.deepEqual(result, { status: "suppressed", reason: "no_personal_space", intentId: "intent-1" });
  assert.equal(calls.length, 1, "conversation channel is attempted");
  assert.equal(notified, 0, "care must NOT fall back to a system notification");
  assert.deepEqual(state.status, [{ id: "intent-1", status: "suppressed" }]);
});

test("recordAndDeliver: a care intent delivers via the conversation channel when the personal space exists", async () => {
  const { repo, state } = fakeRepo();
  const { delivery, calls } = fakeConversationDelivery({ delivered: true, conversationId: "conv-1" });
  let notified = 0;
  const service = createProactiveIntentService({
    repository: repo,
    notifications: {
      async createNotification() {
        notified += 1;
        return notificationRow();
      }
    },
    conversationDelivery: delivery,
    dailyCapPerUser: 10,
    now: () => at
  });
  const result = await service.recordAndDeliver(careIntent());
  assert.deepEqual(result, { status: "delivered", intentId: "intent-1" });
  assert.equal(calls[0]?.text, "最近你手上的活儿有点多，记得给自己留点喘口气的空间。");
  assert.equal(notified, 0);
  assert.deepEqual(state.status, [{ id: "intent-1", status: "delivered", deliveredVia: "conversation_message" }]);
});

test("recordAndDeliver: a care intent with no delivery port injected is suppressed (no notification)", async () => {
  const { repo, state } = fakeRepo();
  let notified = 0;
  const service = createProactiveIntentService({
    repository: repo,
    notifications: {
      async createNotification() {
        notified += 1;
        return notificationRow();
      }
    },
    // conversationDelivery 未注入 + degradeToNotification=false → 不降级，直接 suppressed。
    dailyCapPerUser: 10,
    now: () => at
  });
  const result = await service.recordAndDeliver(careIntent());
  assert.deepEqual(result, { status: "suppressed", reason: "no_personal_space", intentId: "intent-1" });
  assert.equal(notified, 0);
  assert.deepEqual(state.status, [{ id: "intent-1", status: "suppressed" }]);
});

test("parseProactiveQuietHours parses cross-midnight, same-day, and rejects malformed", () => {
  assert.deepEqual(parseProactiveQuietHours("22-08"), { startHour: 22, endHour: 8 });
  assert.deepEqual(parseProactiveQuietHours(" 1 - 6 "), { startHour: 1, endHour: 6 });
  assert.equal(parseProactiveQuietHours(""), null);
  assert.equal(parseProactiveQuietHours(undefined), null);
  assert.equal(parseProactiveQuietHours("nope"), null);
  assert.equal(parseProactiveQuietHours("08-08"), null, "equal bounds = empty window = disabled");
  assert.equal(parseProactiveQuietHours("25-08"), null, "out-of-range hour rejected");
});

test("isWithinProactiveQuietHours covers cross-midnight and same-day windows by local hour", () => {
  const cross = parseProactiveQuietHours("22-08");
  // 本地 23 点在 22-08 窗内；本地 12 点不在。
  assert.equal(isWithinProactiveQuietHours(cross, new Date(2026, 6, 15, 23, 0)), true);
  assert.equal(isWithinProactiveQuietHours(cross, new Date(2026, 6, 15, 3, 0)), true);
  assert.equal(isWithinProactiveQuietHours(cross, new Date(2026, 6, 15, 8, 0)), false);
  assert.equal(isWithinProactiveQuietHours(cross, new Date(2026, 6, 15, 12, 0)), false);
  const sameDay = parseProactiveQuietHours("01-06");
  assert.equal(isWithinProactiveQuietHours(sameDay, new Date(2026, 6, 15, 3, 0)), true);
  assert.equal(isWithinProactiveQuietHours(sameDay, new Date(2026, 6, 15, 23, 0)), false);
  assert.equal(isWithinProactiveQuietHours(null, new Date(2026, 6, 15, 3, 0)), false);
});

// ── D4b：action_card 通道（项目主区插系统「找人」卡） ─────────────────────────────────────────

type ActionCardDeliveryCall = Parameters<ProactiveActionCardDelivery["deliverFindOwnerCard"]>[0];

function fakeActionCardDelivery(
  outcome: Awaited<ReturnType<ProactiveActionCardDelivery["deliverFindOwnerCard"]>> | (() => never)
): { delivery: ProactiveActionCardDelivery; calls: ActionCardDeliveryCall[] } {
  const calls: ActionCardDeliveryCall[] = [];
  const delivery: ProactiveActionCardDelivery = {
    async deliverFindOwnerCard(input) {
      calls.push(input);
      if (typeof outcome === "function") {
        outcome();
      }
      return outcome as Awaited<ReturnType<ProactiveActionCardDelivery["deliverFindOwnerCard"]>>;
    }
  };
  return { delivery, calls };
}

function findOwnerIntent(over: Partial<ProactiveIntentInput> = {}): ProactiveIntentInput {
  return intent({
    channel: "action_card",
    kind: "find_owner",
    stage: "needs_owner",
    suppressionKey: "ddl_card:wi",
    notification: {
      type: "work_item.needs_owner",
      severity: "high",
      title: "上线报价单 逾期且无人负责",
      body: "这个工作项已逾期，但还没有人认领。",
      targetUrl: "/workitems/d0000000-0000-4000-8000-000000000003",
      dedupeKey: "ddl_card:wi"
    },
    ...over
  });
}

test("recordAndDeliver: action_card channel inserts a find-owner card and marks delivered_via=action_card", async () => {
  const { repo, state } = fakeRepo();
  const { delivery, calls } = fakeActionCardDelivery({ delivered: true, conversationId: "conv-main" });
  let notified = 0;
  const service = createProactiveIntentService({
    repository: repo,
    notifications: {
      async createNotification() {
        notified += 1;
        return notificationRow();
      }
    },
    actionCardDelivery: delivery,
    dailyCapPerUser: 10,
    now: () => at
  });
  const result = await service.recordAndDeliver(findOwnerIntent());
  assert.deepEqual(result, { status: "delivered", intentId: "intent-1" });
  assert.equal(calls.length, 1, "action_card channel must be attempted");
  assert.equal(calls[0]?.titleMd, "上线报价单 逾期且无人负责", "card title reuses the notification title");
  assert.equal(calls[0]?.proactiveIntentId, "intent-1", "intent id threads onto the card for audit");
  assert.equal(calls[0]?.workItemId, "d0000000-0000-4000-8000-000000000003");
  assert.equal(notified, 0, "a successful card delivery must not also fire a notification");
  assert.deepEqual(state.status, [{ id: "intent-1", status: "delivered", deliveredVia: "action_card" }]);
});

test("recordAndDeliver: action_card channel degrades to notification when the project main conversation is missing", async () => {
  const { repo, state } = fakeRepo();
  const { delivery, calls } = fakeActionCardDelivery({ delivered: false, reason: "no_main_conversation" });
  const notifications: unknown[] = [];
  const service = createProactiveIntentService({
    repository: repo,
    notifications: {
      async createNotification(draft) {
        notifications.push(draft);
        return notificationRow();
      }
    },
    actionCardDelivery: delivery,
    dailyCapPerUser: 10,
    now: () => at
  });
  const result = await service.recordAndDeliver(findOwnerIntent());
  assert.deepEqual(result, { status: "delivered", intentId: "intent-1" });
  assert.equal(calls.length, 1, "card channel is attempted first");
  assert.equal(notifications.length, 1, "then it degrades to the notification channel");
  assert.deepEqual(state.status, [{ id: "intent-1", status: "delivered", deliveredVia: "notification" }]);
});

test("recordAndDeliver: action_card channel degrades to notification when card insertion throws", async () => {
  const { repo, state } = fakeRepo();
  const { delivery } = fakeActionCardDelivery(() => {
    throw new Error("card insert failed");
  });
  let notified = 0;
  const service = createProactiveIntentService({
    repository: repo,
    notifications: {
      async createNotification() {
        notified += 1;
        return notificationRow();
      }
    },
    actionCardDelivery: delivery,
    dailyCapPerUser: 10,
    now: () => at,
    logger: { warn() {} }
  });
  const result = await service.recordAndDeliver(findOwnerIntent());
  assert.deepEqual(result, { status: "delivered", intentId: "intent-1" });
  assert.equal(notified, 1, "a delivery throw degrades to notification (fail-open)");
  assert.deepEqual(state.status, [{ id: "intent-1", status: "delivered", deliveredVia: "notification" }]);
});

test("recordAndDeliver: an action_card intent with no delivery port injected degrades to notification", async () => {
  const { repo, state } = fakeRepo();
  let notified = 0;
  const service = createProactiveIntentService({
    repository: repo,
    notifications: {
      async createNotification() {
        notified += 1;
        return notificationRow();
      }
    },
    // actionCardDelivery 未注入。
    dailyCapPerUser: 10,
    now: () => at
  });
  const result = await service.recordAndDeliver(findOwnerIntent());
  assert.deepEqual(result, { status: "delivered", intentId: "intent-1" });
  assert.equal(notified, 1);
  assert.deepEqual(state.status, [{ id: "intent-1", status: "delivered", deliveredVia: "notification" }]);
});

test("parseProactiveQuietHours parses cross-midnight, same-day, and rejects malformed", () => {
  assert.deepEqual(parseProactiveQuietHours("22-08"), { startHour: 22, endHour: 8 });
  assert.deepEqual(parseProactiveQuietHours(" 1 - 6 "), { startHour: 1, endHour: 6 });
  assert.equal(parseProactiveQuietHours(""), null);
  assert.equal(parseProactiveQuietHours(undefined), null);
  assert.equal(parseProactiveQuietHours("nope"), null);
  assert.equal(parseProactiveQuietHours("08-08"), null, "equal bounds = empty window = disabled");
  assert.equal(parseProactiveQuietHours("25-08"), null, "out-of-range hour rejected");
});

test("isWithinProactiveQuietHours covers cross-midnight and same-day windows by local hour", () => {
  const cross = parseProactiveQuietHours("22-08");
  // 本地 23 点在 22-08 窗内；本地 12 点不在。
  assert.equal(isWithinProactiveQuietHours(cross, new Date(2026, 6, 15, 23, 0)), true);
  assert.equal(isWithinProactiveQuietHours(cross, new Date(2026, 6, 15, 3, 0)), true);
  assert.equal(isWithinProactiveQuietHours(cross, new Date(2026, 6, 15, 8, 0)), false);
  assert.equal(isWithinProactiveQuietHours(cross, new Date(2026, 6, 15, 12, 0)), false);
  const sameDay = parseProactiveQuietHours("01-06");
  assert.equal(isWithinProactiveQuietHours(sameDay, new Date(2026, 6, 15, 3, 0)), true);
  assert.equal(isWithinProactiveQuietHours(sameDay, new Date(2026, 6, 15, 23, 0)), false);
  assert.equal(isWithinProactiveQuietHours(null, new Date(2026, 6, 15, 3, 0)), false);
});

// ── R20 REL-2（#P1-11）：崩溃恢复兜底扫描（recoverStalled）─────────────────────────────────

function recoverableRow(over: Partial<RecoverableProactiveIntentRow> = {}): RecoverableProactiveIntentRow {
  return {
    id: "intent-1",
    workspaceId: "d0000000-0000-4000-8000-000000000001",
    projectId: "d0000000-0000-4000-8000-000000000002",
    workItemId: "d0000000-0000-4000-8000-000000000003",
    kind: "ddl_chase",
    stage: "overdue",
    targetUserId: "d0000000-0000-4000-8000-000000000004",
    suppressionKey: "ddl:wi:overdue",
    payload: { stage: "overdue" },
    // record 时落库的投递上下文（notification 通道）。
    deliveryPayload: {
      channel: "notification",
      notification: {
        type: "work_item.overdue",
        severity: "high",
        title: "上线报价单 已逾期",
        body: "尽快处理。",
        targetUrl: "/workitems/d0000000-0000-4000-8000-000000000003",
        dedupeKey: "ddl:wi:overdue"
      }
    },
    attemptCount: 0,
    createdAt: new Date("2026-07-15T13:00:00.000Z"),
    ...over
  };
}

const recoverInput = { now: at, olderThanMs: 5 * 60 * 1000, maxAttempts: 3, limit: 100 };

test("recoverStalled: a reconstructable stale created row is re-delivered and counted as recovered", async () => {
  const { repo, state } = fakeRepo({ recoverable: [recoverableRow()] });
  let notified = 0;
  const service = createProactiveIntentService({
    repository: repo,
    notifications: {
      async createNotification() {
        notified += 1;
        return notificationRow();
      }
    },
    dailyCapPerUser: 10,
    now: () => at
  });
  const result = await service.recoverStalled(recoverInput);
  assert.deepEqual(result, { scanned: 1, recovered: 1, suppressed: 0, stalled: 0, retryable: 0 });
  assert.equal(notified, 1, "the stalled intent is re-delivered from its persisted delivery_payload");
  assert.deepEqual(state.incremented, ["intent-1"], "each attempt bumps attempt_count first");
  assert.deepEqual(state.status, [{ id: "intent-1", status: "delivered", deliveredVia: "notification" }]);
});

test("recoverStalled: a row that keeps failing at the attempt cap is marked suppressed(stalled)", async () => {
  // attemptCount=2 → 本次 = 第 3 次（=maxAttempts）；投递又抛 → 封顶判死。
  const { repo, state } = fakeRepo({ recoverable: [recoverableRow({ attemptCount: 2 })] });
  const service = createProactiveIntentService({
    repository: repo,
    notifications: {
      async createNotification() {
        throw new Error("delivery down");
      }
    },
    dailyCapPerUser: 10,
    now: () => at,
    logger: { warn() {} }
  });
  const result = await service.recoverStalled(recoverInput);
  assert.deepEqual(result, { scanned: 1, recovered: 0, suppressed: 0, stalled: 1, retryable: 0 });
  assert.deepEqual(state.incremented, ["intent-1"]);
  assert.deepEqual(state.status, [{ id: "intent-1", status: "suppressed", deliveredVia: "stalled" }]);
});

test("recoverStalled: a failing row still under the attempt cap stays created for the next tick (retryable)", async () => {
  const { repo, state } = fakeRepo({ recoverable: [recoverableRow({ attemptCount: 0 })] });
  const service = createProactiveIntentService({
    repository: repo,
    notifications: {
      async createNotification() {
        throw new Error("transient");
      }
    },
    dailyCapPerUser: 10,
    now: () => at,
    logger: { warn() {} }
  });
  const result = await service.recoverStalled(recoverInput);
  assert.deepEqual(result, { scanned: 1, recovered: 0, suppressed: 0, stalled: 0, retryable: 1 });
  assert.deepEqual(state.incremented, ["intent-1"], "attempt is still bumped");
  assert.equal(state.status.length, 0, "not marked terminal — remains created for the next tick");
});

test("recoverStalled: a legacy row with no delivery_payload cannot be rebuilt and is marked suppressed(stalled)", async () => {
  const { repo, state } = fakeRepo({ recoverable: [recoverableRow({ deliveryPayload: null })] });
  let notified = 0;
  const service = createProactiveIntentService({
    repository: repo,
    notifications: {
      async createNotification() {
        notified += 1;
        return notificationRow();
      }
    },
    dailyCapPerUser: 10,
    now: () => at
  });
  const result = await service.recoverStalled(recoverInput);
  assert.deepEqual(result, { scanned: 1, recovered: 0, suppressed: 0, stalled: 1, retryable: 0 });
  assert.equal(notified, 0, "no reconstruct → no delivery attempt");
  assert.deepEqual(state.incremented, ["intent-1"], "attempt still bumped");
  assert.deepEqual(state.status, [{ id: "intent-1", status: "suppressed", deliveredVia: "stalled" }]);
});

test("recoverStalled: a retry that hits the daily cap is a legitimate suppressed terminal (not stalled)", async () => {
  const { repo, state } = fakeRepo({ recoverable: [recoverableRow()], deliveredToday: 10 });
  const service = createProactiveIntentService({
    repository: repo,
    notifications: {
      async createNotification() {
        return notificationRow();
      }
    },
    dailyCapPerUser: 10,
    now: () => at
  });
  const result = await service.recoverStalled(recoverInput);
  assert.deepEqual(result, { scanned: 1, recovered: 0, suppressed: 1, stalled: 0, retryable: 0 });
  assert.deepEqual(state.status, [{ id: "intent-1", status: "suppressed" }], "deliver already terminalized to suppressed");
});

// R21 加固：恢复重投同样先原子领取（额外允许领「停滞的 delivering」）——领不到 = 另一个并发调用正在投，
// 整行跳过（不自增 attempt、不投递、不动状态）。
test("recoverStalled: a row that loses the recovery claim race is skipped entirely", async () => {
  const { repo, state } = fakeRepo({ recoverable: [recoverableRow()], claimReturns: false });
  let notified = 0;
  const service = createProactiveIntentService({
    repository: repo,
    notifications: {
      async createNotification() {
        notified += 1;
        return notificationRow();
      }
    },
    dailyCapPerUser: 10,
    now: () => at
  });
  const result = await service.recoverStalled(recoverInput);
  assert.deepEqual(result, { scanned: 1, recovered: 0, suppressed: 0, stalled: 0, retryable: 0 });
  assert.equal(notified, 0, "losing the claim must not re-deliver");
  assert.equal(state.incremented.length, 0, "attempt_count must not be bumped by the loser");
  assert.equal(state.status.length, 0);
  // 恢复路径的领取带 stalledBefore（= now - 停滞阈值），允许领回投递中途崩溃的 delivering 行。
  assert.deepEqual(state.claims, [
    { id: "intent-1", stalledBefore: new Date(at.getTime() - recoverInput.olderThanMs) }
  ]);
});

test("recoverStalled: an empty scan does nothing", async () => {
  const { repo, state } = fakeRepo({ recoverable: [] });
  const service = createProactiveIntentService({
    repository: repo,
    notifications: {
      async createNotification() {
        return notificationRow();
      }
    },
    dailyCapPerUser: 10,
    now: () => at
  });
  const result = await service.recoverStalled(recoverInput);
  assert.deepEqual(result, { scanned: 0, recovered: 0, suppressed: 0, stalled: 0, retryable: 0 });
  assert.equal(state.incremented.length, 0);
});
