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
