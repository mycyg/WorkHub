import assert from "node:assert/strict";
import test from "node:test";

import type { Notification } from "@workhub/contracts";

import {
  createProactiveIntentService,
  isWithinProactiveQuietHours,
  parseProactiveQuietHours,
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
};

function fakeRepo(options: { created?: boolean; deliveredToday?: number } = {}): {
  repo: ProactiveIntentRepositoryDeps;
  state: RepoState;
} {
  const state: RepoState = { recorded: [], status: [] };
  const repo: ProactiveIntentRepositoryDeps = {
    async recordIntent(input) {
      state.recorded.push(input);
      const created = options.created ?? true;
      return created ? { created: true, id: "intent-1" } : { created: false };
    },
    async countDeliveredForUserOnDay() {
      return options.deliveredToday ?? 0;
    },
    async markStatus(input) {
      state.status.push(input);
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
