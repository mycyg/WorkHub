import assert from "node:assert/strict";
import test from "node:test";

import type { NotificationRepository, NotificationRow, NotificationWriteResult } from "@workhub/db";

import { createNotificationService } from "./services/notifications.js";

const now = new Date("2026-06-05T00:00:00.000Z");

function row(partial: Partial<NotificationRow> = {}): NotificationRow {
  return {
    id: "90000000-0000-4000-8000-000000000001",
    userId: "90000000-0000-4000-8000-000000000002",
    type: "workitem.escalated",
    severity: "high",
    title: "WH-1 需要你来定一下",
    body: "这个活我先卡住了:预算已经用完。",
    targetUrl: "/workitems/90000000-0000-4000-8000-000000000003",
    projectId: null,
    workItemId: "90000000-0000-4000-8000-000000000003",
    dedupeKey: "escalated:90000000-0000-4000-8000-000000000003:ai-auto",
    readAt: null,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
    ...partial
  };
}

class StubNotifications implements NotificationRepository {
  public writes = 0;

  async createOrUpdateNotification(): Promise<NotificationWriteResult> {
    this.writes += 1;
    return {
      notification: row(),
      created: this.writes === 1,
      resurfaced: this.writes === 1
    };
  }

  async listForUser() {
    return [row()];
  }

  async markRead() {
    return row({ readAt: now });
  }

  async markAllRead() {
    return 1;
  }

  async archive() {
    return row({ readAt: now, archivedAt: now });
  }
}

// 团队就绪 must-have（通知偏好-按类型静音）：记录每次 createOrUpdate 的入参，便于断言哪些类型被建。
class RecordingNotifications implements NotificationRepository {
  public created: { userId: string; type: string }[] = [];

  async createOrUpdateNotification(
    input: { userId: string; type: string },
    _at: Date
  ): Promise<NotificationWriteResult> {
    this.created.push({ userId: input.userId, type: input.type });
    return {
      notification: row({ userId: input.userId, type: input.type }),
      created: true,
      resurfaced: true
    };
  }

  async listForUser() {
    return [];
  }

  async markRead() {
    return row({ readAt: now });
  }

  async markAllRead() {
    return 0;
  }

  async archive() {
    return row({ archivedAt: now });
  }
}

const recipientId = "90000000-0000-4000-8000-0000000000aa";

function fakeUsers(muted: Record<string, string[]>) {
  return {
    async getMutedNotificationTypes(userId: string) {
      return muted[userId] ?? [];
    }
  };
}

test("a recipient who muted type X does not get an X notification but still gets type Y", async () => {
  const repo = new RecordingNotifications();
  const service = createNotificationService({
    notifications: repo,
    now: () => now,
    users: fakeUsers({ [recipientId]: ["workitem.escalated"] })
  });

  // 静音类型 X：不应创建。
  const muted = await service.createNotification({
    userId: recipientId,
    type: "workitem.escalated",
    severity: "high",
    title: "X 通知",
    body: "应被静音",
    targetUrl: "/workitems/90000000-0000-4000-8000-000000000003",
    workItemId: "90000000-0000-4000-8000-000000000003",
    dedupeKey: "x:1"
  });
  assert.equal(muted, null);

  // 未静音类型 Y：应正常创建。
  const fired = await service.createNotification({
    userId: recipientId,
    type: "workitem.claimed",
    severity: "normal",
    title: "Y 通知",
    body: "应正常发出",
    targetUrl: "/workitems/90000000-0000-4000-8000-000000000003",
    workItemId: "90000000-0000-4000-8000-000000000003",
    dedupeKey: "y:1"
  });
  assert.ok(fired);
  assert.equal(fired.type, "workitem.claimed");

  assert.deepEqual(
    repo.created,
    [{ userId: recipientId, type: "workitem.claimed" }],
    "only the non-muted type should reach the write path"
  );
});

test("muted mention type suppresses mention notifications (default-off otherwise)", async () => {
  const repo = new RecordingNotifications();
  const service = createNotificationService({
    notifications: repo,
    now: () => now,
    users: fakeUsers({ [recipientId]: ["comment.mention"] })
  });

  const result = await service.createMentionNotification({
    userId: recipientId,
    title: "有人@了你",
    body: "评论提及",
    dedupeKey: "mention:1"
  });
  assert.equal(result, null);
  assert.equal(repo.created.length, 0, "muted mention must not be written");
});

test("a recipient with empty prefs receives everything (DEFAULT-OFF)", async () => {
  const repo = new RecordingNotifications();
  const service = createNotificationService({
    notifications: repo,
    now: () => now,
    users: fakeUsers({}) // 无任何静音偏好
  });

  const fired = await service.createNotification({
    userId: recipientId,
    type: "workitem.escalated",
    severity: "high",
    title: "X 通知",
    body: "空偏好应照常发出",
    targetUrl: "/workitems/90000000-0000-4000-8000-000000000003",
    workItemId: "90000000-0000-4000-8000-000000000003",
    dedupeKey: "x:2"
  });
  assert.ok(fired);
  assert.equal(repo.created.length, 1);
});

test("DEFAULT-OFF holds when prefs lookup is absent or throws", async () => {
  const repo = new RecordingNotifications();

  // 无 users 依赖（仓库不可用）：照常创建。
  const noUsers = createNotificationService({ notifications: repo, now: () => now });
  const a = await noUsers.createNotification({
    userId: recipientId,
    type: "workitem.escalated",
    severity: "high",
    title: "no-users",
    body: "应照常发出",
    targetUrl: "/workitems/90000000-0000-4000-8000-000000000003",
    workItemId: "90000000-0000-4000-8000-000000000003",
    dedupeKey: "x:3"
  });
  assert.ok(a);

  // 查询抛错：fail-open，照常创建。
  const throwingRepo = new RecordingNotifications();
  const throwing = createNotificationService({
    notifications: throwingRepo,
    now: () => now,
    users: {
      async getMutedNotificationTypes() {
        throw new Error("db down");
      }
    }
  });
  const b = await throwing.createNotification({
    userId: recipientId,
    type: "workitem.escalated",
    severity: "high",
    title: "throwing",
    body: "查询抛错也应照常发出",
    targetUrl: "/workitems/90000000-0000-4000-8000-000000000003",
    workItemId: "90000000-0000-4000-8000-000000000003",
    dedupeKey: "x:4"
  });
  assert.ok(b);
  assert.equal(throwingRepo.created.length, 1);
});

test("milestone notifications publish only private user topics and dedupe replays", async () => {
  const repo = new StubNotifications();
  const published: { topic: string; type: string }[] = [];
  const service = createNotificationService({
    notifications: repo,
    now: () => now,
    bus: {
      async publish(topic, type) {
        published.push({ topic, type });
      }
    }
  });

  await service.notifyMilestone({
    workItem: {
      id: "90000000-0000-4000-8000-000000000003",
      code: "WH-1",
      title: "预算申请",
      submitterUserId: "90000000-0000-4000-8000-000000000004",
      approverUserId: "90000000-0000-4000-8000-000000000002"
    },
    actor: { id: "ai-auto", label: "AI 工人" },
    newStatus: "escalated",
    reasonOneline: "预算已经用完"
  });
  await service.notifyMilestone({
    workItem: {
      id: "90000000-0000-4000-8000-000000000003",
      code: "WH-1",
      title: "预算申请",
      submitterUserId: "90000000-0000-4000-8000-000000000004",
      approverUserId: "90000000-0000-4000-8000-000000000002"
    },
    actor: { id: "ai-auto", label: "AI 工人" },
    newStatus: "escalated",
    reasonOneline: "预算已经用完"
  });

  assert.deepEqual(published, [{ topic: "user:90000000-0000-4000-8000-000000000002", type: "notification.created" }]);
  assert.equal(published.some((event) => event.topic === "all"), false);
});
