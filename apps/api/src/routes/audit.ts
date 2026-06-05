import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import { revertAgentRunRequestSchema } from "@workhub/contracts";
import {
  type AuditLogRepository,
  type SnapshotRepository
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

export type AuditRoutesDependencies = {
  auth?: AuthDependencySource;
  auditLogs?: AuditLogRepository;
  snapshots?: SnapshotRepository;
  now?: () => Date;
};

export function createAuditRoutes(deps: AuditRoutesDependencies = {}) {
  const routes = new Hono<AuthEnv>();
  const authSource = deps.auth ?? getDefaultAuthDependencies;
  const defaults = deps.auditLogs && deps.snapshots ? null : getDefaultAuditStores();
  const auditLogs = deps.auditLogs ?? defaults?.auditLogs;
  const snapshots = deps.snapshots ?? defaults?.snapshots;
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
    const payload = revertAgentRunRequestSchema.parse(await c.req.json().catch(() => ({})));
    const snapshot = await snapshots.findSnapshotById(payload.snapshot_id);
    if (!snapshot) {
      throw new HTTPException(404, { message: "没有找到可回滚的快照。" });
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
      entityId: c.req.param("id"),
      action: "snapshot.revert_requested",
      detailJson: {
        snapshot_id: snapshot.id,
        ...(payload.reason_md ? { reason_md: payload.reason_md } : {})
      },
      snapshotId: snapshot.id
    });

    return c.json({
      ok: true,
      data: {
        status: "revert_recorded",
        snapshot: toSnapshotVm(reverted ?? snapshot)
      }
    });
  });

  return routes;
}
