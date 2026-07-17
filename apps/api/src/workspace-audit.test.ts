import assert from "node:assert/strict";
import test from "node:test";

import { HTTPException } from "hono/http-exception";

import type { AuditLogRow, WorkspaceAuditLogFilter } from "@workhub/db";

import type { AuthActor } from "./middleware/auth.js";
import {
  createWorkspaceAuditService,
  type WorkspaceAuditServiceDependencies
} from "./services/workspace-audit.js";

const now = new Date("2026-07-15T00:00:00.000Z");
const workspaceId = "00000000-0000-4000-8000-000000000002";
const otherWorkspaceId = "00000000-0000-4000-8000-000000000099";

function actor(overrides: Partial<AuthActor> = {}): AuthActor {
  return {
    kind: "human",
    id: "62000000-0000-4000-8000-000000000001",
    label: "admin",
    userId: "62000000-0000-4000-8000-000000000001",
    isAdmin: true,
    orgId: "00000000-0000-4000-8000-000000000001",
    workspaceId,
    ...overrides
  };
}

function auditRow(overrides: Partial<AuditLogRow> = {}): AuditLogRow {
  return {
    id: "a-1",
    orgId: null,
    workspaceId,
    actorKind: "human",
    actorUserId: "u-1",
    actorNickname: "someone",
    entityType: "work_item",
    entityId: "wi-1",
    action: "work_item.updated",
    detailJson: {},
    snapshotId: null,
    undoneAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides
  } as AuditLogRow;
}

function service(rows: AuditLogRow[] = [auditRow()]): {
  svc: ReturnType<typeof createWorkspaceAuditService>;
  filters: WorkspaceAuditLogFilter[];
} {
  const filters: WorkspaceAuditLogFilter[] = [];
  const deps: WorkspaceAuditServiceDependencies = {
    auditLogs: {
      async listAuditLogsForWorkspace(filter) {
        filters.push(filter);
        return rows;
      }
    },
    now: () => now
  };
  return { svc: createWorkspaceAuditService(deps), filters };
}

test("admin gets the workspace audit page scoped to their own workspace", async () => {
  const { svc, filters } = service();
  const result = await svc.list({ actor: actor(), query: {} });
  assert.equal(result.workspace_id, workspaceId);
  assert.equal(result.audit_logs.length, 1);
  assert.equal(result.audit_logs[0]?.action, "work_item.updated");
  // 工作区硬隔离：仓库过滤器的 workspaceId 恒取自 actor，不受任何客户端输入影响。
  assert.equal(filters[0]?.workspaceId, workspaceId);
});

test("a non-admin is forbidden (403)", async () => {
  const { svc, filters } = service();
  await assert.rejects(
    () => svc.list({ actor: actor({ isAdmin: false }), query: {} }),
    (error: unknown) => error instanceof HTTPException && error.status === 403
  );
  // 拒绝发生在查询之前——仓库不应被调用。
  assert.deepEqual(filters, []);
});

test("filters and pagination pass through; page reflects effective limit/offset", async () => {
  const { svc, filters } = service();
  const result = await svc.list({
    actor: actor(),
    query: {
      actor_user_id: "u-9",
      action: "snapshot.reverted",
      from: "2026-07-01T00:00:00.000Z",
      to: "2026-07-10T00:00:00.000Z",
      limit: 25,
      offset: 50
    }
  });
  assert.equal(filters[0]?.actorUserId, "u-9");
  assert.equal(filters[0]?.action, "snapshot.reverted");
  assert.deepEqual(filters[0]?.from, new Date("2026-07-01T00:00:00.000Z"));
  assert.deepEqual(filters[0]?.to, new Date("2026-07-10T00:00:00.000Z"));
  assert.equal(filters[0]?.limit, 25);
  assert.equal(filters[0]?.offset, 50);
  assert.deepEqual(result.page, { limit: 25, offset: 50, count: 1 });
});

test("limit is clamped to the max and offset defaults to 0", async () => {
  const { svc, filters } = service();
  const result = await svc.list({ actor: actor(), query: { limit: 9999 } });
  assert.equal(filters[0]?.limit, 200);
  assert.equal(filters[0]?.offset, 0);
  assert.equal(result.page.limit, 200);
  assert.equal(result.page.offset, 0);
});

test("workspace isolation: an admin of another workspace only sees their own workspace's logs", async () => {
  const { svc, filters } = service();
  await svc.list({ actor: actor({ workspaceId: otherWorkspaceId }), query: {} });
  assert.equal(filters[0]?.workspaceId, otherWorkspaceId);
});

test("audit facts preserve the repository order (newest-first as returned)", async () => {
  const newest = auditRow({ id: "a-new", action: "b.second", createdAt: new Date("2026-07-15T00:00:00.000Z") });
  const older = auditRow({ id: "a-old", action: "a.first", createdAt: new Date("2026-07-01T00:00:00.000Z") });
  // 仓库已按时间倒序返回；服务层保序映射。
  const { svc } = service([newest, older]);
  const result = await svc.list({ actor: actor(), query: {} });
  assert.deepEqual(result.audit_logs.map((log) => log.id), ["a-new", "a-old"]);
});
