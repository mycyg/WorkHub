import assert from "node:assert/strict";
import test from "node:test";

import { Hono } from "hono";
import { generateSignedCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";

import { loadSettings, type Settings } from "@workhub/config";
import type {
  AuditLogRepository,
  AuditLogRow,
  ClientDeviceAuthRow,
  ClientDeviceRepository,
  SnapshotRepository,
  SnapshotRow,
  UserAuthRow,
  UserRepository
} from "@workhub/db";

import { COOKIE_NAME, type AuthDependencies, type AuthEnv } from "./middleware/auth.js";
import { createAuditRoutes } from "./routes/audit.js";

const now = new Date("2026-06-05T00:00:00.000Z");
const userId = "81000000-0000-4000-8000-000000000001";
const workItemId = "81000000-0000-4000-8000-000000000002";
const snapshotId = "81000000-0000-4000-8000-000000000003";
const auditLogId = "81000000-0000-4000-8000-000000000004";

function user(): UserAuthRow {
  return {
    id: userId,
    nickname: "alice",
    cookieToken: "cookie-alice",
    availabilityStatus: "free",
    availabilityText: null,
    availabilityUpdatedAt: null,
    isAdmin: false,
    deletedAt: null,
    createdAt: now,
    updatedAt: now
  };
}

function snapshot(partial: Partial<SnapshotRow> = {}): SnapshotRow {
  return {
    id: snapshotId,
    workItemId,
    branchId: null,
    kind: "pre_step",
    ref: "snapshots/81000000-0000-4000-8000-000000000003",
    contentSha256: null,
    createdByKind: "ai",
    revertedAt: null,
    createdAt: now,
    ...partial
  };
}

function auditLog(partial: Partial<AuditLogRow> = {}): AuditLogRow {
  return {
    id: auditLogId,
    orgId: null,
    workspaceId: null,
    actorKind: "ai",
    actorUserId: null,
    actorNickname: null,
    entityType: "work_item",
    entityId: workItemId,
    action: "tool.write_file",
    detailJson: {},
    snapshotId,
    undoneAt: null,
    createdAt: now,
    ...partial
  };
}

class MemorySnapshots implements SnapshotRepository {
  public rows = [snapshot()];

  async createSnapshot(input: Parameters<SnapshotRepository["createSnapshot"]>[0]) {
    const row = snapshot({
      id: input.id ?? `81000000-0000-4000-8000-${String(this.rows.length + 6).padStart(12, "0")}`,
      workItemId: input.workItemId,
      branchId: input.branchId ?? null,
      kind: input.kind,
      ref: input.ref,
      contentSha256: input.contentSha256 ?? null,
      createdByKind: input.createdByKind
    });
    this.rows.push(row);
    return row;
  }

  async findSnapshotById(id: string) {
    return this.rows.find((row) => row.id === id) ?? null;
  }

  async listSnapshotsForWorkItem(id: string) {
    return this.rows.filter((row) => row.workItemId === id);
  }

  async markSnapshotReverted(id: string, at: Date) {
    const row = this.rows.find((candidate) => candidate.id === id) ?? null;
    if (!row) {
      return null;
    }
    row.revertedAt = at;
    return row;
  }
}

class MemoryAuditLogs implements AuditLogRepository {
  public rows = [auditLog()];

  async createAuditLog(input: Parameters<AuditLogRepository["createAuditLog"]>[0]) {
    const row = auditLog({
      id: input.id ?? `81000000-0000-4000-8000-${String(this.rows.length + 5).padStart(12, "0")}`,
      actorKind: input.actorKind,
      actorUserId: input.actorUserId ?? null,
      actorNickname: input.actorNickname ?? null,
      entityType: input.entityType,
      entityId: input.entityId,
      action: input.action,
      detailJson: input.detailJson ?? {},
      snapshotId: input.snapshotId ?? null
    });
    this.rows.push(row);
    return row;
  }

  async listAuditLogsForEntity(entityType: string, entityId: string) {
    return this.rows.filter((row) => row.entityType === entityType && row.entityId === entityId);
  }

  async listAuditLogsForWorkItem(id: string) {
    return this.listAuditLogsForEntity("work_item", id);
  }

  async markAuditLogUndone(id: string, at: Date) {
    const row = this.rows.find((candidate) => candidate.id === id) ?? null;
    if (!row) {
      return null;
    }
    row.undoneAt = at;
    return row;
  }
}

class MemoryUsers implements UserRepository {
  async findActiveById(id: string) {
    return id === userId ? user() : null;
  }

  async findActiveByCookieToken(cookieToken: string) {
    return cookieToken === "cookie-alice" ? user() : null;
  }

  async findActiveByNickname() {
    return null;
  }

  async createUser(): Promise<UserAuthRow> {
    throw new Error("not needed");
  }

  async getOrCreateActiveByNickname(): Promise<{ user: UserAuthRow; created: boolean }> {
    throw new Error("not needed");
  }

  async rotateCookieToken() {
    return null;
  }
}

class MemoryDevices implements ClientDeviceRepository {
  async findActiveByTokenHash() {
    return null;
  }

  async findActiveByTokenHashForUser() {
    return null;
  }

  async createClientDevice(): Promise<ClientDeviceAuthRow> {
    throw new Error("not needed");
  }

  async listByUser() {
    return [];
  }

  async touchLastSeen() {
    return null;
  }

  async revokeByIdForUser() {
    return null;
  }

  async revokeByTokenHash() {
    return null;
  }
}

function settings(): Settings {
  return loadSettings({
    APP_ENV: "test",
    COOKIE_SECRET: "test-cookie-secret"
  });
}

function authDeps(runtimeSettings: Settings): AuthDependencies {
  return {
    users: new MemoryUsers(),
    devices: new MemoryDevices(),
    settings: runtimeSettings,
    now: () => now
  };
}

function withErrors<T extends { Variables: Record<string, unknown> }>(app: Hono<T>) {
  app.onError((error, c) => {
    if (error instanceof ZodError) {
      return c.json({ ok: false, error: { code: "validation_error", message: "invalid payload" } }, 422);
    }
    if (error instanceof HTTPException) {
      return c.json({ ok: false, error: { code: "http_error", message: error.message } }, error.status);
    }
    throw error;
  });
  return app;
}

async function cookie(runtimeSettings: Settings) {
  return generateSignedCookie(COOKIE_NAME, "cookie-alice", runtimeSettings.auth.cookieSecret);
}

test("audit timeline route returns snapshots, audit logs, and rollback facts", async () => {
  const runtimeSettings = settings();
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api", createAuditRoutes({
    auth: authDeps(runtimeSettings),
    snapshots: new MemorySnapshots(),
    auditLogs: new MemoryAuditLogs(),
    now: () => now
  }));

  const response = await app.request(`/api/workitems/${workItemId}/audit`, {
    headers: {
      Cookie: await cookie(runtimeSettings)
    }
  });

  assert.equal(response.status, 200);
  const body = await response.json() as {
    data: {
      snapshots: SnapshotRow[];
      audit_logs: AuditLogRow[];
      manifest_facts: { rollback: { available: boolean } };
    };
  };
  assert.equal(body.data.snapshots.length, 1);
  assert.equal(body.data.audit_logs.length, 1);
  assert.equal(body.data.manifest_facts.rollback.available, true);
});

test("revert route keeps the local-client gate", async () => {
  const runtimeSettings = settings();
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api", createAuditRoutes({
    auth: authDeps(runtimeSettings),
    snapshots: new MemorySnapshots(),
    auditLogs: new MemoryAuditLogs(),
    now: () => now
  }));

  const response = await app.request("/api/agent-runs/81000000-0000-4000-8000-000000000005/revert", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: await cookie(runtimeSettings)
    },
    body: JSON.stringify({ snapshot_id: snapshotId })
  });

  assert.equal(response.status, 403);
});
