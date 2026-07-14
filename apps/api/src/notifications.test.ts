import assert from "node:assert/strict";
import test from "node:test";

import type {
  AuditLogRepository,
  AuditLogRow,
  CreateNotificationInput,
  NotificationRepository,
  NotificationRow,
  NotificationWriteResult
} from "@workhub/db";

import { createNotificationService, NotificationServiceError } from "./services/notifications.js";

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
  public archives = 0;

  constructor(private readonly stored = row()) {}

  async createOrUpdateNotification(): Promise<NotificationWriteResult> {
    this.writes += 1;
    return {
      notification: row(),
      created: this.writes === 1,
      resurfaced: this.writes === 1
    };
  }

  async listForUser() {
    return [this.stored];
  }

  async findByIdForUser() {
    return this.stored;
  }

  async markRead() {
    return row({ readAt: now });
  }

  async markReadMany(ids: string[]) {
    return ids.length;
  }

  async markAllRead() {
    return 1;
  }

  async archive() {
    this.archives += 1;
    return { ...this.stored, readAt: now, archivedAt: now, updatedAt: now };
  }

  async archiveByDedupeKey() {
    return 0;
  }

  async archiveStaleLifecycleForWorkItem() {
    return 0;
  }
}

class DriftedSeverityNotifications extends StubNotifications {
  async listForUser() {
    return [row({ severity: "critical" })];
  }
}

class ThrowingAuditLogs implements AuditLogRepository {
  async createAuditLog(_input: Parameters<AuditLogRepository["createAuditLog"]>[0]): Promise<AuditLogRow> {
    throw new Error("audit sink unavailable");
  }

  async listAuditLogsForEntity(): Promise<AuditLogRow[]> {
    return [];
  }

  async listAuditLogsForWorkItem(): Promise<AuditLogRow[]> {
    return [];
  }

  async markAuditLogUndone(): Promise<AuditLogRow | null> {
    return null;
  }
}

// 团队就绪 must-have（通知偏好-按类型静音）：记录每次 createOrUpdate 的入参，便于断言哪些类型被建。
class RecordingNotifications implements NotificationRepository {
  public created: { userId: string; type: string }[] = [];
  // R14 FIX（通知深链缺 conversation_id）：额外记完整 input（含 targetUrl），不动上面那个只记
  // {userId,type} 的旧数组——上面几条既有用例对 `created` 做 exact deepEqual，混进 targetUrl 会炸掉它们。
  public createdInputs: { userId: string; type: string; targetUrl: string | undefined }[] = [];

  async createOrUpdateNotification(
    input: CreateNotificationInput,
    _at: Date
  ): Promise<NotificationWriteResult> {
    this.created.push({ userId: input.userId, type: input.type });
    this.createdInputs.push({ userId: input.userId, type: input.type, targetUrl: input.targetUrl });
    return {
      notification: row({ userId: input.userId, type: input.type, targetUrl: input.targetUrl ?? null }),
      created: true,
      resurfaced: true
    };
  }

  async listForUser() {
    return [];
  }

  async findByIdForUser() {
    return row({ type: "system.notice", severity: "normal", workItemId: null, targetUrl: null });
  }

  async markRead() {
    return row({ readAt: now });
  }

  async markReadMany(ids: string[]) {
    return ids.length;
  }

  async markAllRead() {
    return 0;
  }

  async archive() {
    return row({ archivedAt: now });
  }

  async archiveByDedupeKey() {
    return 0;
  }

  async archiveStaleLifecycleForWorkItem() {
    return 0;
  }
}

class VisibilityNotifications implements NotificationRepository {
  public markedIds: string[] = [];
  public archivedIds: string[] = [];

  constructor(private readonly rows: NotificationRow[]) {}

  async createOrUpdateNotification(): Promise<NotificationWriteResult> {
    throw new Error("not needed");
  }

  async listForUser(
    userId: string,
    options: { includeArchived?: boolean; limit?: number; unreadOnly?: boolean; before?: { createdAt: Date; id: string } } = {}
  ) {
    return this.rows
      .filter((stored) => stored.userId === userId)
      .filter((stored) => options.includeArchived || !stored.archivedAt)
      .filter((stored) => !options.unreadOnly || !stored.readAt)
      .filter((stored) => !options.before ||
        stored.createdAt.getTime() < options.before.createdAt.getTime() ||
        (stored.createdAt.getTime() === options.before.createdAt.getTime() && stored.id < options.before.id)
      )
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime() || right.id.localeCompare(left.id))
      .slice(0, options.limit ?? this.rows.length);
  }

  async findByIdForUser(id: string, userId: string) {
    return this.rows.find((stored) => stored.id === id && stored.userId === userId) ?? null;
  }

  async markRead(id: string, userId: string, at: Date) {
    const stored = await this.findByIdForUser(id, userId);
    if (!stored) {
      return null;
    }
    this.markedIds.push(id);
    stored.readAt = at;
    stored.updatedAt = at;
    return { ...stored };
  }

  async markAllRead(userId: string, at: Date) {
    const unread = this.rows.filter((stored) => stored.userId === userId && !stored.readAt);
    for (const stored of unread) {
      this.markedIds.push(stored.id);
      stored.readAt = at;
      stored.updatedAt = at;
    }
    return unread.length;
  }

  async markReadMany(ids: string[], userId: string, at: Date) {
    const idSet = new Set(ids);
    const unread = this.rows.filter((stored) =>
      stored.userId === userId &&
      idSet.has(stored.id) &&
      !stored.readAt
    );
    for (const stored of unread) {
      this.markedIds.push(stored.id);
      stored.readAt = at;
      stored.updatedAt = at;
    }
    return unread.length;
  }

  async archive(id: string, userId: string, at: Date) {
    const stored = await this.findByIdForUser(id, userId);
    if (!stored) {
      return null;
    }
    this.archivedIds.push(id);
    stored.readAt = at;
    stored.archivedAt = at;
    stored.updatedAt = at;
    return { ...stored };
  }

  snapshot(id: string) {
    return this.rows.find((stored) => stored.id === id) ?? null;
  }

  async archiveByDedupeKey() {
    return 0;
  }

  async archiveStaleLifecycleForWorkItem() {
    return 0;
  }
}

class CappedVisibilityNotifications extends VisibilityNotifications {
  async listForUser(
    userId: string,
    options: { includeArchived?: boolean; limit?: number; unreadOnly?: boolean; before?: { createdAt: Date; id: string } } = {}
  ) {
    return super.listForUser(userId, { ...options, limit: options.limit ?? 200 });
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

test("notification preferences normalize drifted stored values before returning them", async () => {
  const service = createNotificationService({
    notifications: new StubNotifications(),
    now: () => now,
    users: fakeUsers({
      [recipientId]: [
        " workitem.escalated ",
        "",
        "workitem.escalated",
        "x".repeat(65),
        "comment.mention"
      ]
    })
  });

  const prefs = await service.getPreferences(recipientId);
  assert.deepEqual(prefs.muted_notification_types, ["workitem.escalated", "comment.mention"]);
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

// R14 FIX（通知深链缺 conversation_id）：agent-runner.ts 的 notifyRunMilestone 在 run 带
// source_conversation_id（即工作项是工作台会话观察者派发出去的）时，把它透传成 notifyMilestone 的
// conversationId 参数——这条测试锁死"透传后 targetUrl 真的带上了 ?conversation_id=" 这条产生点行为，
// 不只是类型层面接受这个参数。
test("notifyMilestone appends conversation_id onto the lifecycle draft's targetUrl when the triggering run came from a conversation", async () => {
  const repo = new RecordingNotifications();
  const service = createNotificationService({
    notifications: repo,
    now: () => now
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
    reasonOneline: "预算已经用完",
    conversationId: "90000000-0000-4000-8000-000000000099"
  });

  // "escalated" 里程碑的收件人清单是 submitter+approver 两个角色（见 packages/events/src/lifecycle.ts
  // 的 lifecycleMilestones.escalated.recipients），本例两者不同人，故落两条草稿——都该带上同一个
  // conversation_id（同一次里程碑事件，同一个会话来源，不分收件人）。
  assert.equal(repo.createdInputs.length, 2);
  for (const created of repo.createdInputs) {
    assert.equal(
      created.targetUrl,
      "/workitems/90000000-0000-4000-8000-000000000003?conversation_id=90000000-0000-4000-8000-000000000099"
    );
  }
});

// 没有会话上下文的里程碑通知（run 不是从工作台会话派发的）不该硬造 conversation_id——targetUrl 原样
// 指向工作项页，和这批之前的行为完全一致，不能因为新增了可选参数就改变了老调用方（没传
// conversationId 的调用点）的输出。
test("notifyMilestone leaves targetUrl untouched when there is no conversation context", async () => {
  const repo = new RecordingNotifications();
  const service = createNotificationService({
    notifications: repo,
    now: () => now
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

  assert.equal(repo.createdInputs.length, 2);
  for (const created of repo.createdInputs) {
    assert.equal(created.targetUrl, "/workitems/90000000-0000-4000-8000-000000000003");
  }
});

test("notification list clamps drifted DB severity values to the public contract", async () => {
  const service = createNotificationService({
    notifications: new DriftedSeverityNotifications(),
    now: () => now
  });

  const list = await service.listForUser("90000000-0000-4000-8000-000000000002");
  assert.equal(list.items[0]?.severity, "normal");
});

// R13 批 P2（拍板链路收尾）：conversation_id 是从 target_url 的查询串解出来的 additive 字段
// （notifications 表本身没有这一列，见 services/notifications.ts 的 extractConversationIdFromTargetUrl
// 顶部注释）——这三条锁死"能解出来才暴露、格式不对/没有就诚实地不带这个字段"。
test("notification list exposes conversation_id parsed from a dispatch_ask target_url query param", async () => {
  const service = createNotificationService({
    notifications: new StubNotifications(
      row({
        type: "action_card_item.dispatch_ask",
        targetUrl: "/workitems/90000000-0000-4000-8000-000000000003?conversation_id=90000000-0000-4000-8000-000000000099"
      })
    ),
    now: () => now
  });

  const list = await service.listForUser("90000000-0000-4000-8000-000000000002");
  assert.equal(list.items[0]?.conversation_id, "90000000-0000-4000-8000-000000000099");
  // The path itself keeps working as a work item deep link — additive, not a replacement.
  assert.equal(list.items[0]?.work_item_id, "90000000-0000-4000-8000-000000000003");
});

test("notification list omits conversation_id when target_url carries no such query param", async () => {
  const service = createNotificationService({
    notifications: new StubNotifications(),
    now: () => now
  });

  const list = await service.listForUser("90000000-0000-4000-8000-000000000002");
  assert.equal(list.items[0]?.conversation_id, undefined);
});

test("notification list ignores a malformed conversation_id query param instead of exposing garbage", async () => {
  const service = createNotificationService({
    notifications: new StubNotifications(
      row({ targetUrl: "/workitems/90000000-0000-4000-8000-000000000003?conversation_id=not-a-uuid" })
    ),
    now: () => now
  });

  const list = await service.listForUser("90000000-0000-4000-8000-000000000002");
  assert.equal(list.items[0]?.conversation_id, undefined);
});

test("notification list hides unreadable work item notifications from raw list and counts", async () => {
  const hiddenWorkItemId = "90000000-0000-4000-8000-000000000003";
  const service = createNotificationService({
    notifications: new StubNotifications(),
    now: () => now,
    workItems: {
      async findWorkItemAccessRecord(id: string) {
        assert.equal(id, hiddenWorkItemId);
        return {
          id,
          status: "ai_clarifying",
          submitterUserId: "90000000-0000-4000-8000-00000000aaaa",
          claimedByUserId: null,
          workspaceId: "workspace-1",
          project: {
            archived: false,
            deletedAt: null,
            ownerUserId: "90000000-0000-4000-8000-00000000bbbb",
            workspaceId: "workspace-1"
          },
          assignments: []
        };
      }
    }
  });

  const list = await service.listForUser({
    userId: "90000000-0000-4000-8000-000000000002",
    actor: {
      kind: "human",
      id: "90000000-0000-4000-8000-000000000002",
      userId: "90000000-0000-4000-8000-000000000002",
      label: "notif-reader",
      isAdmin: false,
      orgId: "org-1",
      workspaceId: "workspace-1"
    }
  });

  assert.equal(list.counts.total, 0);
  assert.equal(list.counts.unread, 0);
  assert.deepEqual(list.items, []);
});

test("notification list hides project-only notifications outside the actor workspace", async () => {
  const foreignProjectId = "90000000-0000-4000-8000-000000000071";
  const service = createNotificationService({
    notifications: new StubNotifications(row({
      id: "90000000-0000-4000-8000-000000000072",
      type: "project.updated",
      severity: "normal",
      title: "Foreign project changed",
      body: "A different workspace changed.",
      targetUrl: `/projects/${foreignProjectId}`,
      projectId: foreignProjectId,
      workItemId: null,
      dedupeKey: "foreign-project"
    })),
    now: () => now,
    workItems: {
      async findWorkItemAccessRecord() {
        throw new Error("project-only notifications should not check work item access");
      },
      async findProjectById(id: string) {
        assert.equal(id, foreignProjectId);
        return {
          id,
          workspaceId: "workspace-2",
          orgId: "org-1",
          ownerUserId: "90000000-0000-4000-8000-00000000bbbb",
          archived: false,
          deletedAt: null
        } as never;
      }
    }
  });

  const list = await service.listForUser({
    userId: "90000000-0000-4000-8000-000000000002",
    actor: {
      kind: "human",
      id: "90000000-0000-4000-8000-000000000002",
      userId: "90000000-0000-4000-8000-000000000002",
      label: "notif-reader",
      isAdmin: false,
      orgId: "org-1",
      workspaceId: "workspace-1"
    }
  });

  assert.equal(list.counts.total, 0);
  assert.equal(list.counts.unread, 0);
  assert.deepEqual(list.items, []);
});

test("notification list keeps visible project notifications while stripping unreadable work item ids", async () => {
  const projectId = "90000000-0000-4000-8000-000000000073";
  const hiddenWorkItemId = "90000000-0000-4000-8000-000000000074";
  const service = createNotificationService({
    notifications: new StubNotifications(row({
      id: "90000000-0000-4000-8000-000000000075",
      type: "meeting.insight.pending",
      severity: "normal",
      title: "会议洞察待处理",
      body: "项目会议里有新洞察。",
      targetUrl: `/meetings?project_id=${projectId}`,
      projectId,
      workItemId: hiddenWorkItemId,
      dedupeKey: "meeting-visible-project"
    })),
    now: () => now,
    workItems: {
      async findWorkItemAccessRecord(id: string) {
        assert.equal(id, hiddenWorkItemId);
        return {
          id,
          status: "ai_clarifying",
          submitterUserId: "90000000-0000-4000-8000-00000000aaaa",
          claimedByUserId: null,
          workspaceId: "workspace-1",
          project: {
            archived: false,
            deletedAt: null,
            ownerUserId: "90000000-0000-4000-8000-00000000bbbb",
            workspaceId: "workspace-1"
          },
          assignments: []
        };
      },
      async findProjectById(id: string) {
        assert.equal(id, projectId);
        return {
          id,
          workspaceId: "workspace-1",
          orgId: "org-1",
          ownerUserId: "90000000-0000-4000-8000-00000000bbbb",
          archived: false,
          deletedAt: null
        } as never;
      }
    }
  });

  const list = await service.listForUser({
    userId: "90000000-0000-4000-8000-000000000002",
    actor: {
      kind: "human",
      id: "90000000-0000-4000-8000-000000000002",
      userId: "90000000-0000-4000-8000-000000000002",
      label: "notif-reader",
      isAdmin: false,
      orgId: "org-1",
      workspaceId: "workspace-1"
    }
  });

  assert.equal(list.counts.total, 1);
  assert.equal(list.counts.unread, 1);
  assert.equal(list.items[0]?.project_id, projectId);
  assert.equal(list.items[0]?.target_url, `/meetings?project_id=${projectId}`);
  assert.equal(list.items[0]?.work_item_id, undefined);
});

test("notification mark-read keeps visible project notifications redacted when work item is unreadable", async () => {
  const projectId = "90000000-0000-4000-8000-000000000073";
  const hiddenWorkItemId = "90000000-0000-4000-8000-000000000074";
  const notificationId = "90000000-0000-4000-8000-000000000076";
  const userId = "90000000-0000-4000-8000-000000000002";
  const actor = {
    kind: "human" as const,
    id: userId,
    userId,
    label: "notif-reader",
    isAdmin: false,
    orgId: "org-1",
    workspaceId: "workspace-1"
  };
  const service = createNotificationService({
    notifications: new VisibilityNotifications([
      row({
        id: notificationId,
        userId,
        type: "meeting.insight.pending",
        severity: "normal",
        title: "会议洞察待处理",
        body: "项目会议里有新洞察。",
        targetUrl: `/workitems/${hiddenWorkItemId}`,
        projectId,
        workItemId: hiddenWorkItemId,
        dedupeKey: "meeting-visible-project"
      })
    ]),
    now: () => now,
    workItems: {
      async findWorkItemAccessRecord(id: string) {
        assert.equal(id, hiddenWorkItemId);
        return {
          id,
          status: "ai_clarifying",
          submitterUserId: "90000000-0000-4000-8000-00000000aaaa",
          claimedByUserId: null,
          workspaceId: "workspace-1",
          project: {
            archived: false,
            deletedAt: null,
            ownerUserId: "90000000-0000-4000-8000-00000000bbbb",
            workspaceId: "workspace-1"
          },
          assignments: []
        };
      },
      async findProjectById(id: string) {
        assert.equal(id, projectId);
        return {
          id,
          workspaceId: "workspace-1",
          orgId: "org-1",
          ownerUserId: "90000000-0000-4000-8000-00000000bbbb",
          archived: false,
          deletedAt: null
        } as never;
      }
    }
  });

  const updated = await service.markRead(notificationId, userId, { actor });

  assert.equal(updated.project_id, projectId);
  assert.equal(updated.work_item_id, undefined);
  assert.equal(updated.target_url, undefined);
  assert.equal(updated.read_at, now.toISOString());
});

test("notification list scans past capped hidden rows to find older visible notifications", async () => {
  const userId = "90000000-0000-4000-8000-000000000002";
  const actor = {
    kind: "human" as const,
    id: userId,
    userId,
    label: "notif-reader",
    isAdmin: false,
    orgId: "org-1",
    workspaceId: "workspace-1"
  };
  const hiddenRows = Array.from({ length: 500 }, (_value, index) => row({
    id: `90000000-0000-4000-8000-${(index + 600).toString(16).padStart(12, "0")}`,
    userId,
    workItemId: `91000000-0000-4000-8000-${(index + 600).toString(16).padStart(12, "0")}`,
    targetUrl: `/workitems/91000000-0000-4000-8000-${(index + 600).toString(16).padStart(12, "0")}`,
    dedupeKey: `hidden-${index}`,
    createdAt: new Date(now.getTime() - index)
  }));
  const visible = row({
    id: "90000000-0000-4000-8000-000000000999",
    userId,
    type: "system.notice",
    severity: "normal",
    workItemId: null,
    targetUrl: "/notifications/older-visible",
    dedupeKey: "older-visible",
    createdAt: new Date(now.getTime() - hiddenRows.length)
  });
  const service = createNotificationService({
    notifications: new CappedVisibilityNotifications([...hiddenRows, visible]),
    now: () => now,
    workItems: {
      async findWorkItemAccessRecord(id: string) {
        return {
          id,
          status: "ai_clarifying",
          submitterUserId: "90000000-0000-4000-8000-00000000aaaa",
          claimedByUserId: null,
          workspaceId: "workspace-1",
          project: {
            archived: false,
            deletedAt: null,
            ownerUserId: "90000000-0000-4000-8000-00000000bbbb",
            workspaceId: "workspace-1"
          },
          assignments: []
        };
      }
    }
  });

  const list = await service.listForUser({ userId, actor });

  assert.equal(list.counts.total, 1);
  assert.equal(list.counts.unread, 1);
  assert.deepEqual(list.items.map((item) => item.id), [visible.id]);
});

// R9 批次1-2 性能收口回归：codex 曾把 listForUser 改成 `pageLimit=500; for(;;)` 无上限翻完全量历史。
// 构造超过 cap(200) 的可见通知，断言响应硬封顶在 200 条且计数口径与实际返回一致(不虚报未截断的总量)。
test("notification list output is capped even when far more than the cap is visible", async () => {
  const userId = "90000000-0000-4000-8000-000000000002";
  const actor = {
    kind: "human" as const,
    id: userId,
    userId,
    label: "notif-reader",
    isAdmin: false,
    orgId: "org-1",
    workspaceId: "workspace-1"
  };
  const rows = Array.from({ length: 350 }, (_value, index) => row({
    id: `90000000-0000-4000-8000-${(index + 800).toString(16).padStart(12, "0")}`,
    userId,
    type: "system.notice",
    severity: "normal",
    workItemId: null,
    targetUrl: null,
    dedupeKey: `capped-${index}`,
    createdAt: new Date(now.getTime() - index)
  }));
  const service = createNotificationService({
    notifications: new VisibilityNotifications(rows),
    now: () => now
  });

  const list = await service.listForUser({ userId, actor });

  assert.equal(list.items.length, 200);
  assert.equal(list.counts.total, 200);
  assert.equal(list.counts.unread, 200);
  // 保留最新的 200 条(index 0..199)，不是随机/无序截断。
  assert.deepEqual(list.items.map((item) => item.dedupe_key), rows.slice(0, 200).map((entry) => entry.dedupeKey));
});

// R9 批次1-2 性能收口回归：readableWorkItemIdsForRows/readableProjectIdsForRows 必须批量化(并发)查询，
// 不能对去重后的每个 id 逐条 await 串行查库；否则老账号一次 GET 会触发成百上千次单行查询。
// 用一个"若还在排队等待前一条完成才被调用就会抛错"的桩仓库钉住并发行为。
test("notification list issues work item and project access checks concurrently, not serially", async () => {
  const userId = "90000000-0000-4000-8000-000000000002";
  const actor = {
    kind: "human" as const,
    id: userId,
    userId,
    label: "notif-reader",
    isAdmin: false,
    orgId: "org-1",
    workspaceId: "workspace-1"
  };
  const workItemIds = Array.from({ length: 12 }, (_value, index) =>
    `91000000-0000-4000-8000-${(index + 1).toString(16).padStart(12, "0")}`);
  const rows = workItemIds.map((workItemId, index) => row({
    id: `90000000-0000-4000-8000-${(index + 900).toString(16).padStart(12, "0")}`,
    userId,
    type: "workitem.escalated",
    severity: "high",
    workItemId,
    targetUrl: `/workitems/${workItemId}`,
    dedupeKey: `concurrent-${index}`,
    createdAt: new Date(now.getTime() - index)
  }));

  let inFlight = 0;
  let maxInFlight = 0;

  const service = createNotificationService({
    notifications: new VisibilityNotifications(rows),
    now: () => now,
    workItems: {
      async findWorkItemAccessRecord(id: string) {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        // 让所有并发调用先都进来排队，再逐个放行——若实现是逐条串行 await，
        // maxInFlight 会恒为 1；批量化后应观察到多条同时在途。
        await new Promise((resolve) => setTimeout(resolve, 0));
        inFlight -= 1;
        return {
          id,
          status: "ai_clarifying",
          submitterUserId: "90000000-0000-4000-8000-00000000aaaa",
          claimedByUserId: userId,
          workspaceId: "workspace-1",
          project: {
            archived: false,
            deletedAt: null,
            ownerUserId: "90000000-0000-4000-8000-00000000bbbb",
            workspaceId: "workspace-1"
          },
          assignments: []
        };
      }
    }
  });

  const list = await service.listForUser({ userId, actor });

  assert.equal(list.items.length, workItemIds.length);
  assert.ok(maxInFlight > 1, `expected concurrent access checks, saw max in-flight = ${maxInFlight}`);
});

test("notification mutations reject unreadable work item notifications before mutating", async () => {
  const userId = "90000000-0000-4000-8000-000000000002";
  const hiddenNotificationId = "90000000-0000-4000-8000-000000000031";
  const hiddenWorkItemId = "90000000-0000-4000-8000-000000000003";
  const visibleWorkItemId = "90000000-0000-4000-8000-000000000004";
  const actor = {
    kind: "human" as const,
    id: userId,
    userId,
    label: "notif-reader",
    isAdmin: false,
    orgId: "org-1",
    workspaceId: "workspace-1"
  };
  const notifications = new VisibilityNotifications([
    row({ id: hiddenNotificationId, userId, workItemId: hiddenWorkItemId }),
    row({
      id: "90000000-0000-4000-8000-000000000032",
      userId,
      severity: "normal",
      type: "system.notice",
      workItemId: visibleWorkItemId,
      targetUrl: `/workitems/${visibleWorkItemId}`,
      dedupeKey: "visible"
    })
  ]);
  const service = createNotificationService({
    notifications,
    now: () => now,
    workItems: {
      async findWorkItemAccessRecord(id: string) {
        return {
          id,
          status: "ai_clarifying",
          submitterUserId: id === visibleWorkItemId ? userId : "90000000-0000-4000-8000-00000000aaaa",
          claimedByUserId: null,
          workspaceId: "workspace-1",
          project: {
            archived: false,
            deletedAt: null,
            ownerUserId: "90000000-0000-4000-8000-00000000bbbb",
            workspaceId: "workspace-1"
          },
          assignments: []
        };
      }
    }
  });
  const serviceWithActor = service as typeof service & {
    markRead: (id: string, userId: string, options: { actor: typeof actor }) => ReturnType<typeof service.markRead>;
    dismiss: (id: string, userId: string, options: { actor: typeof actor }) => ReturnType<typeof service.dismiss>;
    complete: (id: string, userId: string, options: { actor: typeof actor }) => ReturnType<typeof service.complete>;
  };
  const notFound = (error: unknown) =>
    error instanceof NotificationServiceError &&
    error.status === 404 &&
    error.code === "not_found";

  await assert.rejects(() => serviceWithActor.markRead(hiddenNotificationId, userId, { actor }), notFound);
  await assert.rejects(() => serviceWithActor.dismiss(hiddenNotificationId, userId, { actor }), notFound);
  await assert.rejects(() => serviceWithActor.complete(hiddenNotificationId, userId, { actor }), notFound);
  assert.deepEqual(notifications.markedIds, []);
  assert.deepEqual(notifications.archivedIds, []);
});

test("notification mark-all-read scopes actor to readable work item notifications", async () => {
  const userId = "90000000-0000-4000-8000-000000000002";
  const hiddenNotificationId = "90000000-0000-4000-8000-000000000041";
  const visibleNotificationId = "90000000-0000-4000-8000-000000000042";
  const hiddenWorkItemId = "90000000-0000-4000-8000-000000000003";
  const visibleWorkItemId = "90000000-0000-4000-8000-000000000004";
  const actor = {
    kind: "human" as const,
    id: userId,
    userId,
    label: "notif-reader",
    isAdmin: false,
    orgId: "org-1",
    workspaceId: "workspace-1"
  };
  // R12：mark-all-read 语义收紧为「不吞待决策」——本测试考的是 actor 可见性收口，
  // 夹具改用信息类通知（normal/merged），避免与新语义相撞。
  const notifications = new VisibilityNotifications([
    row({ id: hiddenNotificationId, userId, workItemId: hiddenWorkItemId, type: "workitem.merged", severity: "normal" }),
    row({
      id: visibleNotificationId,
      userId,
      workItemId: visibleWorkItemId,
      targetUrl: `/workitems/${visibleWorkItemId}`,
      dedupeKey: "visible",
      type: "workitem.merged",
      severity: "normal"
    })
  ]);
  const service = createNotificationService({
    notifications,
    now: () => now,
    workItems: {
      async findWorkItemAccessRecord(id: string) {
        return {
          id,
          status: "ai_clarifying",
          submitterUserId: id === visibleWorkItemId ? userId : "90000000-0000-4000-8000-00000000aaaa",
          claimedByUserId: null,
          workspaceId: "workspace-1",
          project: {
            archived: false,
            deletedAt: null,
            ownerUserId: "90000000-0000-4000-8000-00000000bbbb",
            workspaceId: "workspace-1"
          },
          assignments: []
        };
      }
    }
  });
  const serviceWithActor = service as typeof service & {
    markAllRead: (userId: string, options: { actor: typeof actor }) => ReturnType<typeof service.markAllRead>;
  };

  const result = await serviceWithActor.markAllRead(userId, { actor });

  assert.deepEqual(result, { updated: 1 });
  assert.deepEqual(notifications.markedIds, [visibleNotificationId]);
  assert.equal(notifications.snapshot(hiddenNotificationId)?.readAt, null);
});

test("notification mark-all-read reaches visible unread notifications beyond the first page", async () => {
  const userId = "90000000-0000-4000-8000-000000000002";
  const actor = {
    kind: "human" as const,
    id: userId,
    userId,
    label: "notif-reader",
    isAdmin: false,
    orgId: "org-1",
    workspaceId: "workspace-1"
  };
  const rows = Array.from({ length: 501 }, (_value, index) => row({
    id: `90000000-0000-4000-8000-${(index + 100).toString(16).padStart(12, "0")}`,
    userId,
    type: "system.notice",
    severity: "normal",
    workItemId: null,
    targetUrl: null,
    dedupeKey: `visible-${index}`,
    createdAt: new Date(now.getTime() - index)
  }));
  const notifications = new VisibilityNotifications(rows);
  const service = createNotificationService({
    notifications,
    now: () => now
  });
  const serviceWithActor = service as typeof service & {
    markAllRead: (userId: string, options: { actor: typeof actor }) => ReturnType<typeof service.markAllRead>;
  };

  const result = await serviceWithActor.markAllRead(userId, { actor });

  assert.deepEqual(result, { updated: 501 });
  assert.equal(rows.filter((stored) => stored.readAt).length, 501);
});

test("notification actions return committed results even when post-write audit fails", async () => {
  const service = createNotificationService({
    notifications: new StubNotifications(row({ type: "system.notice", severity: "normal", workItemId: null, targetUrl: null })),
    audit: new ThrowingAuditLogs(),
    now: () => now
  });

  const read = await service.markRead("90000000-0000-4000-8000-000000000001", "90000000-0000-4000-8000-000000000002");
  assert.equal(read.read_at, now.toISOString());

  const allRead = await service.markAllRead("90000000-0000-4000-8000-000000000002");
  assert.equal(allRead.updated, 1);

  const dismissed = await service.dismiss("90000000-0000-4000-8000-000000000001", "90000000-0000-4000-8000-000000000002");
  assert.equal(dismissed.archived_at, now.toISOString());

  const completed = await service.complete("90000000-0000-4000-8000-000000000001", "90000000-0000-4000-8000-000000000002");
  assert.equal(completed.archived_at, now.toISOString());
});

test("notification complete rejects needs-decision notifications before archiving", async () => {
  const notifications = new StubNotifications();
  const service = createNotificationService({
    notifications,
    now: () => now
  });

  await assert.rejects(
    () => service.complete("90000000-0000-4000-8000-000000000001", "90000000-0000-4000-8000-000000000002"),
    (error) => error instanceof NotificationServiceError &&
      error.status === 409 &&
      error.code === "notification_needs_decision"
  );
  assert.equal(notifications.archives, 0);
});

test("notification creation returns committed result even when post-write publish fails", async () => {
  const service = createNotificationService({
    notifications: new StubNotifications(),
    now: () => now,
    bus: {
      async publish() {
        throw new Error("push bus unavailable");
      }
    }
  });

  const created = await service.createNotification({
    userId: recipientId,
    type: "workitem.escalated",
    severity: "high",
    title: "后台已经创建通知",
    body: "实时推送失败也不能让创建结果变成失败。",
    targetUrl: "/workitems/90000000-0000-4000-8000-000000000003",
    workItemId: "90000000-0000-4000-8000-000000000003",
    dedupeKey: "publish-failed:1"
  });

  assert.ok(created);
  assert.equal(created.id, "90000000-0000-4000-8000-000000000001");
});
