import assert from "node:assert/strict";
import test from "node:test";

import type { Notification } from "@workhub/contracts";
import type { StaleClarificationWorkItemRow } from "@workhub/db";

import {
  CLARIFICATION_PENDING_NOTIFICATION_TYPE,
  createClarificationChaseService
} from "./services/clarification-chase.js";

const now = new Date("2026-08-19T10:00:00.000Z");
const workItemId = "d0000000-0000-4000-8000-000000000101";
const submitterUserId = "d0000000-0000-4000-8000-000000000102";
const projectId = "d0000000-0000-4000-8000-000000000103";

function staleRow(partial: Partial<StaleClarificationWorkItemRow> = {}): StaleClarificationWorkItemRow {
  return {
    workItemId,
    code: "WI-101",
    title: "整理验收要点",
    submitterUserId,
    projectId,
    workspaceId: "d0000000-0000-4000-8000-000000000104",
    createdAt: new Date("2026-08-17T10:00:00.000Z"),
    ...partial
  };
}

function fakeNotifications(options: { muted?: boolean; failFor?: Set<string> } = {}) {
  const calls: Array<Record<string, unknown>> = [];
  return {
    calls,
    async createNotification(draft: Record<string, unknown>): Promise<Notification | null> {
      calls.push(draft);
      if (options.failFor?.has(String(draft["workItemId"]))) {
        throw new Error("notification store exploded");
      }
      if (options.muted) {
        return null;
      }
      return { id: "n-1", created_at: now.toISOString(), updated_at: now.toISOString() } as unknown as Notification;
    }
  };
}

test("CHAT-8: stale clarification sessions notify the submitter with a deduped deep link", async () => {
  const notifications = fakeNotifications();
  const service = createClarificationChaseService({
    listStale: async () => [staleRow()],
    notifications,
    now: () => now
  });

  const result = await service.runOnce();

  assert.deepEqual(
    { scanned: result.scanned, delivered: result.delivered, suppressed_muted: result.suppressed_muted },
    { scanned: 1, delivered: 1, suppressed_muted: 0 }
  );
  assert.equal(notifications.calls.length, 1);
  const draft = notifications.calls[0]!;
  assert.equal(draft["userId"], submitterUserId);
  assert.equal(draft["type"], CLARIFICATION_PENDING_NOTIFICATION_TYPE);
  assert.equal(draft["dedupeKey"], `clarification_pending:${workItemId}`, "dedupe key 幂等：重复 tick 不刷屏");
  assert.equal(draft["targetUrl"], `/intake/${workItemId}`, "深链到接入会话页，落地即可作答");
  assert.equal(draft["workItemId"], workItemId);
  assert.equal(draft["projectId"], projectId);
});

test("CHAT-8: the pending-after threshold is configurable and drives the scan cutoff", async () => {
  const cutoffs: Date[] = [];
  const service = createClarificationChaseService({
    listStale: async (input) => {
      cutoffs.push(input.olderThan);
      return [];
    },
    notifications: fakeNotifications(),
    now: () => now,
    pendingAfterMs: 60 * 60 * 1000 // 1h 而非默认 24h
  });

  await service.runOnce();

  assert.equal(cutoffs.length, 1);
  assert.equal(cutoffs[0]?.toISOString(), new Date(now.getTime() - 60 * 60 * 1000).toISOString());

  // 缺省阈值 = 24h。
  const defaultCutoffs: Date[] = [];
  const defaultService = createClarificationChaseService({
    listStale: async (input) => {
      defaultCutoffs.push(input.olderThan);
      return [];
    },
    notifications: fakeNotifications(),
    now: () => now
  });
  await defaultService.runOnce();
  assert.equal(defaultCutoffs[0]?.toISOString(), new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString());
});

test("CHAT-8: muted recipients are counted, and one failed delivery does not break the tick", async () => {
  // 静音收件人（createNotification 返回 null）计入 suppressed_muted；单条投递抛错不连累其余候选
  // （与 ddl-chase 的逐候选容错同姿态）。
  const notifications = fakeNotifications({ failFor: new Set(["d0000000-0000-4000-8000-000000000105"]) });
  const service = createClarificationChaseService({
    listStale: async () => [
      staleRow(),
      staleRow({ workItemId: "d0000000-0000-4000-8000-000000000105" }),
      staleRow({ workItemId: "d0000000-0000-4000-8000-000000000106" })
    ],
    notifications,
    now: () => now,
    logger: { info() {}, warn() {} }
  });

  const result = await service.runOnce();

  assert.equal(result.scanned, 3);
  assert.equal(result.delivered, 2, "失败的一条不影响其余候选投递");
  assert.equal(notifications.calls.length, 3);

  const mutedService = createClarificationChaseService({
    listStale: async () => [staleRow()],
    notifications: fakeNotifications({ muted: true }),
    now: () => now
  });
  const mutedResult = await mutedService.runOnce();
  assert.deepEqual(
    { delivered: mutedResult.delivered, suppressed_muted: mutedResult.suppressed_muted },
    { delivered: 0, suppressed_muted: 1 }
  );
});

test("CHAT-8: overlong work item titles are clamped to the notification title column width", async () => {
  const notifications = fakeNotifications();
  const service = createClarificationChaseService({
    listStale: async () => [staleRow({ title: "超".repeat(500) })],
    notifications,
    now: () => now
  });

  await service.runOnce();

  const title = String(notifications.calls[0]?.["title"] ?? "");
  assert.ok(title.length <= 210, `title must fit the varchar(256) column with the prefix, got ${title.length}`);
});
