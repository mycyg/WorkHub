import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import { revertFileSnapshot, type SnapshotRef } from "@workhub/audit";
import { revertAgentRunRequestSchema } from "@workhub/contracts";
import {
  type AuditLogRepository,
  type SnapshotRepository,
  type SnapshotRow
} from "@workhub/db";

import {
  createCurrentUserMiddleware,
  createRequireLocalClientMiddleware,
  getDefaultAuthDependencies,
  type AuthDependencySource,
  type AuthEnv
} from "../middleware/auth.js";
import { buildReplayManifestFacts, toAuditLogFact, toSnapshotVm } from "../pages/replay.js";
import { getDefaultAuditStores } from "../services/audit-stores.js";
import { getDefaultAgentRunQueue } from "../workers/agent-runner.js";

export type AuditRoutesDependencies = {
  auth?: AuthDependencySource;
  auditLogs?: AuditLogRepository;
  snapshots?: SnapshotRepository;
  workdirForRun?: (runId: string) => Promise<string | null> | string | null;
  now?: () => Date;
};

export function createAuditRoutes(deps: AuditRoutesDependencies = {}) {
  const routes = new Hono<AuthEnv>();
  const authSource = deps.auth ?? getDefaultAuthDependencies;
  const defaults = deps.auditLogs && deps.snapshots ? null : getDefaultAuditStores();
  const auditLogs = deps.auditLogs ?? defaults?.auditLogs;
  const snapshots = deps.snapshots ?? defaults?.snapshots;
  const workdirForRun = deps.workdirForRun ?? ((runId: string) => getDefaultAgentRunQueue().workdir(runId));
  const now = deps.now ?? (() => new Date());

  if (!auditLogs || !snapshots) {
    throw new Error("Audit routes require audit log and snapshot repositories");
  }

  routes.get("/workitems/:id/audit", createCurrentUserMiddleware(authSource), async (c) => {
    const workItemId = c.req.param("id");
    const snapshotRows = await snapshots.listSnapshotsForWorkItem(workItemId, { includeReverted: true });
    const auditRows = await auditLogs.listAuditLogsForWorkItem(workItemId);
    const snapshotVms = snapshotRows.map(toSnapshotVm);
    const auditFacts = auditRows.map(toAuditLogFact);
    return c.json({
      ok: true,
      data: {
        work_item_id: workItemId,
        snapshots: snapshotVms,
        audit_logs: auditFacts,
        manifest_facts: buildReplayManifestFacts({
          snapshots: snapshotVms,
          auditLogs: auditFacts
        })
      }
    });
  });

  routes.post("/agent-runs/:id/revert", createRequireLocalClientMiddleware(authSource), async (c) => {
    const runId = c.req.param("id");
    const payload = revertAgentRunRequestSchema.parse(await c.req.json().catch(() => ({})));
    const snapshot = await snapshots.findSnapshotById(payload.snapshot_id);
    if (!snapshot) {
      throw new HTTPException(404, { message: "没有找到可回滚的快照。" });
    }
    const snapshotAuditRows = await auditLogs.listAuditLogsForWorkItem(snapshot.workItemId);
    const belongsToRun = snapshotAuditRows.some((row) =>
      row.snapshotId === snapshot.id && detailJson(row.detailJson).run_id === runId
    );
    if (!belongsToRun) {
      throw new HTTPException(404, { message: "这个快照不属于这次 AI 执行。" });
    }

    const workdir = await workdirForRun(runId);
    if (!workdir) {
      throw new HTTPException(409, { message: "没有找到这次 AI 执行的本地工作目录,无法还原文件。" });
    }

    try {
      await revertFileSnapshot({
        snapshot: toSnapshotRef(snapshot),
        workdir
      });
    } catch (error) {
      throw new HTTPException(409, {
        message: error instanceof Error ? error.message : "快照还原失败。"
      });
    }

    const at = now();
    const reverted = await snapshots.markSnapshotReverted(snapshot.id, at);
    const actor = c.var.actor;
    await auditLogs.createAuditLog({
      orgId: actor.orgId,
      workspaceId: actor.workspaceId,
      actorKind: actor.kind,
      ...(actor.userId ? { actorUserId: actor.userId } : {}),
      actorNickname: actor.label,
      entityType: "agent_run",
      entityId: runId,
      action: "snapshot.reverted",
      detailJson: {
        snapshot_id: snapshot.id,
        run_id: runId,
        workdir_restored: true,
        ...(payload.reason_md ? { reason_md: payload.reason_md } : {})
      },
      snapshotId: snapshot.id
    });

    return c.json({
      ok: true,
      data: {
        status: "reverted",
        snapshot: toSnapshotVm(reverted ?? snapshot)
      }
    });
  });

  return routes;
}

function detailJson(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function toSnapshotRef(row: SnapshotRow): SnapshotRef {
  return {
    id: row.id,
    workItemId: row.workItemId,
    ...(row.branchId ? { branchId: row.branchId } : {}),
    kind: toSnapshotKind(row.kind),
    ref: row.ref,
    ...(row.contentSha256 ? { contentSha256: row.contentSha256 } : {}),
    createdByKind: toSnapshotActorKind(row.createdByKind),
    createdAt: row.createdAt.toISOString(),
    ...(row.revertedAt ? { revertedAt: row.revertedAt.toISOString() } : {})
  };
}

function toSnapshotKind(value: string): SnapshotRef["kind"] {
  if (value === "pre_step" || value === "merge" || value === "manual") {
    return value;
  }
  throw new Error(`Unsupported snapshot kind: ${value}`);
}

function toSnapshotActorKind(value: string): SnapshotRef["createdByKind"] {
  if (value === "human" || value === "ai" || value === "system") {
    return value;
  }
  throw new Error(`Unsupported snapshot actor kind: ${value}`);
}
