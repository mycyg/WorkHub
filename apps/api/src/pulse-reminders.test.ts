import assert from "node:assert/strict";
import test from "node:test";

import type {
  CreateNotificationInput,
  NotificationRepository,
  NotificationRow,
  NotificationWriteResult
} from "@workhub/db";

import {
  APPROVAL_REMINDER_INTERVAL_MS,
  REMINDER_MAX_COUNT,
  createNotificationService
} from "./services/notifications.js";
import { createPulseScheduler } from "./workers/pulse-scheduler.js";

const userId = "90000000-0000-4000-8000-0000000000aa";

function notificationRow(partial: Partial<NotificationRow> = {}): NotificationRow {
  const at = new Date("2026-07-15T00:00:00.000Z");
  return {
    id: "90000000-0000-4000-8000-000000000001",
    userId,
    type: "approval.routed",
    severity: "high",
    title: "待你审批：改报价",
    body: "预算已用完",
    targetUrl: "/approvals",
    projectId: null,
    workItemId: "90000000-0000-4000-8000-000000000003",
    dedupeKey: "approval_routed:abc",
    readAt: null,
    archivedAt: null,
    nextRemindAt: null,
    reminderCount: 0,
    createdAt: at,
    updatedAt: at,
    ...partial
  };
}

// 忠实内存仓库：实现提醒阶梯相关方法（含 applyReminderTick 的未读未归档守卫，镜像真实 SQL WHERE），
// 其余方法按最小占位。
class MemoryReminders implements NotificationRepository {
  constructor(public rows: NotificationRow[] = []) {}

  async createOrUpdateNotification(input: CreateNotificationInput, at: Date): Promise<NotificationWriteResult> {
    const existing = input.dedupeKey
      ? this.rows.find((row) => row.userId === input.userId && row.dedupeKey === input.dedupeKey)
      : undefined;
    if (existing) {
      existing.type = input.type;
      existing.severity = input.severity;
      existing.title = input.title;
      existing.body = input.body ?? null;
      existing.targetUrl = input.targetUrl ?? null;
      existing.projectId = input.projectId ?? null;
      existing.workItemId = input.workItemId ?? null;
      existing.readAt = null;
      existing.archivedAt = null;
      if (input.nextRemindAt !== undefined) {
        existing.nextRemindAt = input.nextRemindAt;
        existing.reminderCount = 0;
      }
      existing.updatedAt = at;
      return { notification: { ...existing }, created: false, resurfaced: true };
    }
    const row = notificationRow({
      id: `row-${this.rows.length + 1}`,
      userId: input.userId,
      type: input.type,
      severity: input.severity,
      title: input.title,
      body: input.body ?? null,
      targetUrl: input.targetUrl ?? null,
      projectId: input.projectId ?? null,
      workItemId: input.workItemId ?? null,
      dedupeKey: input.dedupeKey ?? null,
      nextRemindAt: input.nextRemindAt ?? null,
      reminderCount: 0,
      createdAt: at,
      updatedAt: at
    });
    this.rows.push(row);
    return { notification: { ...row }, created: true, resurfaced: true };
  }

  async listDueReminders(at: Date, limit: number) {
    return this.rows
      .filter((row) => row.nextRemindAt !== null && row.nextRemindAt.getTime() <= at.getTime() && !row.readAt && !row.archivedAt)
      .sort((left, right) => left.nextRemindAt!.getTime() - right.nextRemindAt!.getTime())
      .slice(0, Math.max(1, Math.min(limit, 500)))
      .map((row) => ({ ...row }));
  }

  async applyReminderTick(id: string, params: { nextRemindAt: Date | null; at: Date }) {
    const row = this.rows.find((entry) => entry.id === id);
    // 未读未归档守卫：镜像真实仓库 SQL WHERE——扫描与更新之间被读/归档则落空返回 null。
    if (!row || row.readAt || row.archivedAt) {
      return null;
    }
    row.reminderCount += 1;
    row.nextRemindAt = params.nextRemindAt;
    row.updatedAt = params.at;
    return { ...row };
  }

  async snoozeReminder(id: string, uid: string, at: Date) {
    const row = this.rows.find((entry) => entry.id === id && entry.userId === uid);
    if (!row) {
      return null;
    }
    row.nextRemindAt = null;
    row.updatedAt = at;
    return { ...row };
  }

  async findByIdForUser(id: string, uid: string) {
    return this.rows.find((row) => row.id === id && row.userId === uid) ?? null;
  }

  async markRead(id: string, uid: string, at: Date) {
    const row = this.rows.find((entry) => entry.id === id && entry.userId === uid);
    if (!row) {
      return null;
    }
    row.readAt = at;
    row.updatedAt = at;
    return { ...row };
  }

  async archive(id: string, uid: string, at: Date) {
    const row = this.rows.find((entry) => entry.id === id && entry.userId === uid);
    if (!row) {
      return null;
    }
    row.readAt = at;
    row.archivedAt = at;
    row.updatedAt = at;
    return { ...row };
  }

  async listForUser() {
    return this.rows.map((row) => ({ ...row }));
  }

  async markReadMany(ids: string[]) {
    return ids.length;
  }

  async markAllRead() {
    return 0;
  }

  async archiveByDedupeKey() {
    return 0;
  }

  async archiveStaleLifecycleForWorkItem() {
    return 0;
  }
}

class RecordingBus {
  public published: Array<{ topic: string; type: string; id: string }> = [];
  async publish(topic: string, type: string, payload: unknown) {
    this.published.push({ topic, type, id: (payload as { id: string }).id });
  }
}

test("reminder ladder walks 0 -> 1 -> 2 -> 3 then stops, pushing SSE each rung", async () => {
  const t0 = new Date("2026-07-15T00:00:00.000Z");
  const repo = new MemoryReminders([notificationRow({ nextRemindAt: t0, reminderCount: 0 })]);
  const bus = new RecordingBus();
  const service = createNotificationService({ notifications: repo, bus, now: () => t0 });

  // 第 1 提：0 -> 1，next 续 +24h，推一条 SSE。
  const r1 = await service.runNotificationReminders({ limit: 100 });
  assert.deepEqual(r1, { scanned: 1, reminded: 1, stopped: 0 });
  assert.equal(repo.rows[0]!.reminderCount, 1);
  assert.equal(repo.rows[0]!.nextRemindAt!.getTime(), t0.getTime() + APPROVAL_REMINDER_INTERVAL_MS);

  // 尚未到下一提醒点：扫不到。
  const idle = createNotificationService({ notifications: repo, bus, now: () => new Date(t0.getTime() + 1000) });
  assert.deepEqual(await idle.runNotificationReminders(), { scanned: 0, reminded: 0, stopped: 0 });

  // 第 2 提：1 -> 2。
  const svc2 = createNotificationService({ notifications: repo, bus, now: () => new Date(t0.getTime() + APPROVAL_REMINDER_INTERVAL_MS) });
  const r2 = await svc2.runNotificationReminders();
  assert.deepEqual(r2, { scanned: 1, reminded: 1, stopped: 0 });
  assert.equal(repo.rows[0]!.reminderCount, 2);

  // 第 3 提：2 -> 3，达上限，next 置空，stopped 计一。
  const svc3 = createNotificationService({ notifications: repo, bus, now: () => new Date(t0.getTime() + 2 * APPROVAL_REMINDER_INTERVAL_MS) });
  const r3 = await svc3.runNotificationReminders();
  assert.deepEqual(r3, { scanned: 1, reminded: 1, stopped: 1 });
  assert.equal(repo.rows[0]!.reminderCount, REMINDER_MAX_COUNT);
  assert.equal(repo.rows[0]!.nextRemindAt, null);

  // 阶梯到顶后不再扫到。
  const svc4 = createNotificationService({ notifications: repo, bus, now: () => new Date(t0.getTime() + 5 * APPROVAL_REMINDER_INTERVAL_MS) });
  assert.deepEqual(await svc4.runNotificationReminders(), { scanned: 0, reminded: 0, stopped: 0 });

  // 三次提醒各推一条 notification.created 到收件人频道。
  assert.equal(bus.published.length, 3);
  assert.ok(bus.published.every((entry) => entry.topic === `user:${userId}` && entry.type === "notification.created"));
});

test("reading or archiving a routed approval notification retires it from the reminder ladder", async () => {
  const t0 = new Date("2026-07-15T00:00:00.000Z");
  const at = new Date(t0.getTime() + APPROVAL_REMINDER_INTERVAL_MS);

  // 已读：扫不到。
  const readRepo = new MemoryReminders([notificationRow({ id: "r-read", nextRemindAt: t0, readAt: t0 })]);
  const readSvc = createNotificationService({ notifications: readRepo, now: () => at });
  assert.deepEqual(await readSvc.runNotificationReminders(), { scanned: 0, reminded: 0, stopped: 0 });

  // 已归档：扫不到。
  const archivedRepo = new MemoryReminders([notificationRow({ id: "r-arch", nextRemindAt: t0, archivedAt: t0, readAt: t0 })]);
  const archivedSvc = createNotificationService({ notifications: archivedRepo, now: () => at });
  assert.deepEqual(await archivedSvc.runNotificationReminders(), { scanned: 0, reminded: 0, stopped: 0 });
});

test("applyReminderTick guard: a notification read between scan and update is skipped, not resurfaced", async () => {
  const t0 = new Date("2026-07-15T00:00:00.000Z");
  const repo = new MemoryReminders([
    notificationRow({ id: "a", nextRemindAt: t0 }),
    notificationRow({ id: "b", dedupeKey: "approval_routed:b", nextRemindAt: t0 })
  ]);
  const bus = new RecordingBus();
  // listDueReminders 返回 a、b 的快照后，抢在服务更新前把 a 标记已读——applyReminderTick 的守卫应让 a 落空。
  const racingRepo = new (class extends MemoryReminders {
    override async listDueReminders(atArg: Date, limit: number) {
      const due = await super.listDueReminders(atArg, limit);
      const a = this.rows.find((row) => row.id === "a");
      if (a) {
        a.readAt = atArg;
      }
      return due;
    }
  })(repo.rows);
  const service = createNotificationService({ notifications: racingRepo, bus, now: () => new Date(t0.getTime() + APPROVAL_REMINDER_INTERVAL_MS) });

  const result = await service.runNotificationReminders();
  // 扫到 2 条，但 a 已被读、更新落空 → 只有 b 真正复活推送。
  assert.deepEqual(result, { scanned: 2, reminded: 1, stopped: 0 });
  assert.equal(racingRepo.rows.find((row) => row.id === "a")!.reminderCount, 0);
  assert.equal(racingRepo.rows.find((row) => row.id === "b")!.reminderCount, 1);
  assert.deepEqual(bus.published.map((entry) => entry.id), ["b"]);
});

test("reminder scan honors the batch cap", async () => {
  const t0 = new Date("2026-07-15T00:00:00.000Z");
  const rows = Array.from({ length: 5 }, (_unused, index) =>
    notificationRow({ id: `n-${index}`, dedupeKey: `approval_routed:${index}`, nextRemindAt: new Date(t0.getTime() + index) })
  );
  const repo = new MemoryReminders(rows);
  const service = createNotificationService({ notifications: repo, now: () => new Date(t0.getTime() + APPROVAL_REMINDER_INTERVAL_MS) });

  const result = await service.runNotificationReminders({ limit: 2 });
  // 本 tick 只处理 next_remind_at 最早的 2 条。
  assert.equal(result.scanned, 2);
  assert.equal(result.reminded, 2);
  assert.equal(repo.rows.filter((row) => row.reminderCount === 1).length, 2);
  assert.deepEqual(
    repo.rows.filter((row) => row.reminderCount === 1).map((row) => row.id),
    ["n-0", "n-1"]
  );
});

test("creating a routed approval notification seeds the 24h reminder, and snooze clears it without touching read/archive state", async () => {
  const t0 = new Date("2026-07-15T00:00:00.000Z");
  const repo = new MemoryReminders();
  const service = createNotificationService({ notifications: repo, now: () => t0 });

  // 镜像 approvals.ts 创建 approval.routed 的入参：带 nextRemindAt = 创建时刻 + 24h。
  await service.createNotification({
    userId,
    type: "approval.routed",
    severity: "high",
    title: "待你审批：改报价",
    body: "预算已用完",
    targetUrl: "/approvals",
    workItemId: "90000000-0000-4000-8000-000000000003",
    dedupeKey: "approval_routed:seed",
    nextRemindAt: new Date(t0.getTime() + APPROVAL_REMINDER_INTERVAL_MS)
  });
  const seeded = repo.rows[0]!;
  assert.equal(seeded.nextRemindAt!.getTime(), t0.getTime() + APPROVAL_REMINDER_INTERVAL_MS);
  assert.equal(seeded.reminderCount, 0);

  // 暂停提醒：next_remind_at 清空，但读/归档态不变（仍留在待决策队列）。
  const snoozed = await service.snooze(seeded.id, userId);
  assert.equal(snoozed.read_at, undefined);
  assert.equal(snoozed.archived_at, undefined);
  assert.equal(repo.rows[0]!.nextRemindAt, null);

  // 之后不再被提醒扫到。
  const later = createNotificationService({ notifications: repo, now: () => new Date(t0.getTime() + 5 * APPROVAL_REMINDER_INTERVAL_MS) });
  assert.deepEqual(await later.runNotificationReminders(), { scanned: 0, reminded: 0, stopped: 0 });
});

test("pulse notification-reminder task drives the service through injected deps", async () => {
  let calls = 0;
  const scheduler = createPulseScheduler();
  scheduler.register({
    name: "notification-reminder",
    intervalMs: 3_600_000,
    maxDrainPerTick: 200,
    tick: async (ctx) => {
      calls += 1;
      assert.equal(ctx.maxDrainPerTick, 200);
      return { scanned: 0, reminded: 0, stopped: 0 };
    }
  });
  const outcome = await scheduler.runTask("notification-reminder");
  assert.deepEqual(outcome, { status: "ran", value: { scanned: 0, reminded: 0, stopped: 0 } });
  assert.equal(calls, 1);
});
