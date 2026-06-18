import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
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

import {
  COOKIE_NAME,
  LOCAL_CLIENT_HEADER,
  hashClientToken,
  type AuthDependencies,
  type AuthEnv
} from "./middleware/auth.js";
import { createAuditRoutes } from "./routes/audit.js";
import { buildReplayEvidenceRefs } from "./pages/replay.js";
import { WorkItemServiceError, type WorkItemService } from "./services/work-items.js";

const now = new Date("2026-06-05T00:00:00.000Z");
const userId = "81000000-0000-4000-8000-000000000001";
const workItemId = "81000000-0000-4000-8000-000000000002";
const snapshotId = "81000000-0000-4000-8000-000000000003";
const auditLogId = "81000000-0000-4000-8000-000000000004";
const agentRunId = "81000000-0000-4000-8000-000000000005";

let userIsAdmin = false;

function user(): UserAuthRow {
  return {
    id: userId,
    nickname: "alice",
    cookieToken: "cookie-alice",
    preferredLocale: "zh-CN",
    availabilityStatus: "free",
    availabilityText: null,
    availabilityUpdatedAt: null,
    mutedNotificationTypes: [],
    isAdmin: userIsAdmin,
    deletedAt: null,
    deletedByUserId: null,
    createdAt: now,
    updatedAt: now
  };
}

function allowingWorkItems(): Pick<WorkItemService, "detailPage"> {
  return {
    async detailPage() {
      return { workitem: {} } as unknown as Awaited<ReturnType<WorkItemService["detailPage"]>>;
    }
  };
}

function denyingWorkItems(): Pick<WorkItemService, "detailPage"> {
  return {
    async detailPage() {
      throw new WorkItemServiceError(403, "forbidden", "你没有权限查看这个事项。");
    }
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

function clientDevice(token: string): ClientDeviceAuthRow {
  return {
    id: "81000000-0000-4000-8000-000000000006",
    userId,
    deviceName: "Cuu desktop",
    platform: "windows",
    clientTokenHash: hashClientToken(token),
    lastSeenAt: now,
    revokedAt: null,
    createdAt: now,
    updatedAt: now
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
  constructor(private readonly rows: ClientDeviceAuthRow[] = []) {}

  async findActiveByTokenHash(tokenHash: string) {
    return this.rows.find((row) => row.clientTokenHash === tokenHash && row.revokedAt === null) ?? null;
  }

  async findActiveByTokenHashForUser(tokenHash: string, id: string) {
    return this.rows.find((row) =>
      row.clientTokenHash === tokenHash &&
      row.userId === id &&
      row.revokedAt === null
    ) ?? null;
  }

  async createClientDevice(): Promise<ClientDeviceAuthRow> {
    throw new Error("not needed");
  }

  async listByUser() {
    return [];
  }

  async touchLastSeen(deviceId: string, at: Date) {
    const row = this.rows.find((candidate) => candidate.id === deviceId) ?? null;
    if (!row) {
      return null;
    }
    row.lastSeenAt = at;
    row.updatedAt = at;
    return row;
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

function authDeps(runtimeSettings: Settings, devices: ClientDeviceAuthRow[] = []): AuthDependencies {
  return {
    users: new MemoryUsers(),
    devices: new MemoryDevices(devices),
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
    workItems: allowingWorkItems() as WorkItemService,
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

test("revert route restores the agent run workdir from the selected snapshot", async () => {
  const runtimeSettings = settings();
  const token = "local-client-token";
  const snapshotDir = await mkdtemp(path.join(os.tmpdir(), "workhub-revert-snapshot-"));
  const workdir = await mkdtemp(path.join(os.tmpdir(), "workhub-revert-workdir-"));
  await mkdir(path.join(snapshotDir, "outputs"), { recursive: true });
  await writeFile(path.join(snapshotDir, "outputs", "result.md"), "before change");
  await mkdir(path.join(workdir, "outputs"), { recursive: true });
  await writeFile(path.join(workdir, "outputs", "result.md"), "dirty change");
  await writeFile(path.join(workdir, "scratch.tmp"), "should disappear");

  const snapshots = new MemorySnapshots();
  snapshots.rows = [snapshot({ ref: snapshotDir })];
  const auditLogs = new MemoryAuditLogs();
  auditLogs.rows = [
    auditLog({
      action: "tool.write_file.snapshot",
      detailJson: { run_id: agentRunId },
      snapshotId
    })
  ];

  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api", createAuditRoutes({
    auth: authDeps(runtimeSettings, [clientDevice(token)]),
    snapshots,
    auditLogs,
    workItems: allowingWorkItems() as WorkItemService,
    workdirForRun: (runId) => runId === agentRunId ? workdir : null,
    now: () => now
  }));

  const response = await app.request(`/api/agent-runs/${agentRunId}/revert`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      [LOCAL_CLIENT_HEADER]: token
    },
    body: JSON.stringify({ snapshot_id: snapshotId, reason_md: "测试还原" })
  });

  assert.equal(response.status, 200);
  const body = await response.json() as {
    ok: true;
    data: {
      status: string;
      snapshot: { id: string; reverted_at?: string };
    };
  };
  assert.equal(body.data.status, "reverted");
  assert.equal(body.data.snapshot.id, snapshotId);
  assert.equal(body.data.snapshot.reverted_at, now.toISOString());
  assert.equal(await readFile(path.join(workdir, "outputs", "result.md"), "utf8"), "before change");
  await assert.rejects(() => readFile(path.join(workdir, "scratch.tmp"), "utf8"), /ENOENT/);
  assert.equal(snapshots.rows[0]?.revertedAt?.toISOString(), now.toISOString());
  const revertLog = auditLogs.rows.at(-1);
  assert.equal(revertLog?.action, "snapshot.reverted");
  // findings[21]：revert 审计挂在 work_item 实体上（而非 agent_run），run_id 仍在 detailJson。
  assert.equal(revertLog?.entityType, "work_item");
  assert.equal(revertLog?.entityId, workItemId);
  assert.equal(revertLog?.snapshotId, snapshotId);
  assert.deepEqual(revertLog?.detailJson, {
    snapshot_id: snapshotId,
    run_id: agentRunId,
    workdir_restored: true,
    reason_md: "测试还原"
  });
  // findings[21] 可见性回归：revert 现在能在 work-item 审计时间线里看到（此前挂在 agent_run 上不可见）。
  const timeline = await app.request(`/api/workitems/${workItemId}/audit`, {
    headers: { [LOCAL_CLIENT_HEADER]: token }
  });
  assert.equal(timeline.status, 200);
  const timelineBody = await timeline.json() as { ok: true; data: { audit_logs: Array<{ action: string }> } };
  assert.equal(timelineBody.data.audit_logs.some((entry) => entry.action === "snapshot.reverted"), true);
  // M23：这个快照对应的写操作审计行（tool.write_file.snapshot）应被标记为已撤销，
  // 让审计轨迹/manifest 不再把已回滚的变更当作生效证据。
  const writeLog = auditLogs.rows.find((row) => row.action === "tool.write_file.snapshot");
  assert.equal(writeLog?.undoneAt?.toISOString(), now.toISOString());
});

test("buildReplayEvidenceRefs skips undone (reverted) audit logs", () => {
  const facts = [
    { id: "log-live", action: "tool.write_file.snapshot", entity: { entity_id: "wi-1" } },
    { id: "log-undone", action: "tool.write_file.snapshot", entity: { entity_id: "wi-1" }, undone_at: now.toISOString() }
  ] as unknown as Parameters<typeof buildReplayEvidenceRefs>[0];
  const refs = buildReplayEvidenceRefs(facts);
  // 已撤销的行不再作为生效证据列出。
  assert.equal(refs.length, 1);
  assert.equal(refs[0]?.source_id, "log-live");
});

test("revert route fails closed for a snapshot whose work item the caller cannot view", async () => {
  const runtimeSettings = settings();
  const token = "local-client-token";
  const snapshots = new MemorySnapshots();
  const auditLogs = new MemoryAuditLogs();
  auditLogs.rows = [auditLog({ action: "tool.write_file.snapshot", detailJson: { run_id: agentRunId }, snapshotId })];

  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api", createAuditRoutes({
    auth: authDeps(runtimeSettings, [clientDevice(token)]),
    snapshots,
    auditLogs,
    workItems: denyingWorkItems() as WorkItemService,
    workdirForRun: () => "/tmp/should-not-be-reached",
    now: () => now
  }));

  const response = await app.request(`/api/agent-runs/${agentRunId}/revert`, {
    method: "POST",
    headers: { "Content-Type": "application/json", [LOCAL_CLIENT_HEADER]: token },
    body: JSON.stringify({ snapshot_id: snapshotId })
  });

  assert.equal(response.status, 403);
  // 越权被挡在还原之前：快照不应被标记 reverted。
  assert.equal(snapshots.rows[0]?.revertedAt ?? null, null);
});

test("audit timeline fails closed for a work item the user cannot view", async () => {
  const runtimeSettings = settings();
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api", createAuditRoutes({
    auth: authDeps(runtimeSettings),
    snapshots: new MemorySnapshots(),
    auditLogs: new MemoryAuditLogs(),
    workItems: denyingWorkItems() as WorkItemService,
    now: () => now
  }));

  const response = await app.request(`/api/workitems/${workItemId}/audit`, {
    headers: { Cookie: await cookie(runtimeSettings) }
  });

  assert.equal(response.status, 403);
});

test("audit timeline lets an admin read across the work item resource gate", async () => {
  userIsAdmin = true;
  try {
    const runtimeSettings = settings();
    const app = withErrors(new Hono<AuthEnv>());
    // admin path uses the real detailPage admin short-circuit; here we model it
    // by allowing access, asserting the route does not block admins.
    app.route("/api", createAuditRoutes({
      auth: authDeps(runtimeSettings),
      snapshots: new MemorySnapshots(),
      auditLogs: new MemoryAuditLogs(),
      workItems: allowingWorkItems() as WorkItemService,
      now: () => now
    }));

    const response = await app.request(`/api/workitems/${workItemId}/audit`, {
      headers: { Cookie: await cookie(runtimeSettings) }
    });

    assert.equal(response.status, 200);
  } finally {
    userIsAdmin = false;
  }
});
