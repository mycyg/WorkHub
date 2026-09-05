import { Hono } from "hono";
import { SPILL_DIR_NAME } from "@workhub/agent";
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
import { readJsonObject } from "./json-body.js";
import { serviceT } from "../services/locales.js";
import { isUuidParam } from "./uuid-param.js";
import { getDefaultAuditStores } from "../services/audit-stores.js";
import { getDefaultAgentRunQueue } from "../workers/agent-runner.js";
import { getDefaultStructuredLogger } from "../logging.js";
import { getDefaultWorkItemService, WorkItemServiceError, type WorkItemService } from "../services/work-items.js";

export type AuditRoutesDependencies = {
  auth?: AuthDependencySource;
  auditLogs?: AuditLogRepository;
  snapshots?: SnapshotRepository;
  workItems?: WorkItemService | false;
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
  const workItems = deps.workItems === false ? undefined : deps.workItems ?? getDefaultWorkItemService();
  const now = deps.now ?? (() => new Date());

  if (!auditLogs || !snapshots) {
    throw new Error("Audit routes require audit log and snapshot repositories");
  }

  // 资源级 fail-closed：审计含历史快照与副作用，必须按 WorkItem 可见性过滤。
  // detailPage 已内置 admin 读全量（§4.4）与普通用户关系/活跃过滤。
  async function assertCanReadWorkItem(workItemId: string, actor: AuthEnv["Variables"]["actor"]) {
    if (!workItems) {
      throw new HTTPException(403, { message: serviceT("zh-CN", "taskAuditViewForbidden") });
    }
    try {
      await workItems.detailPage({ workItemId, actor });
    } catch (error) {
      if (error instanceof WorkItemServiceError) {
        throw error;
      }
      throw error;
    }
  }

  async function assertCanMutateWorkItemArtifacts(workItemId: string, actor: AuthEnv["Variables"]["actor"]) {
    if (!workItems) {
      throw new HTTPException(403, { message: serviceT("zh-CN", "taskArtifactsEditForbidden") });
    }
    try {
      await workItems.assertCanMutateArtifacts({ workItemId, actor });
    } catch (error) {
      if (error instanceof WorkItemServiceError) {
        throw error;
      }
      throw error;
    }
  }

  routes.get("/workitems/:id/audit", createCurrentUserMiddleware(authSource), async (c) => {
    const workItemId = c.req.param("id");
    // 路由 uuid 形参先校验：非 uuid 串原本直达 detailPage / listSnapshotsForWorkItem 的 uuid 列 →
    // PG 22P02 → 误报 500；与「合法但不存在」同样回 404，不泄露事项存在性。
    if (!isUuidParam(workItemId)) {
      throw new HTTPException(404, { message: serviceT("zh-CN", "taskNotFound") });
    }
    await assertCanReadWorkItem(workItemId, c.var.actor);
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
    if (!isUuidParam(runId)) {
      throw new HTTPException(404, { message: "没有找到这次 AI 执行。" });
    }
    const rawPayload = await readJsonObject(c);
    const rawSnapshotId = rawPayload.snapshot_id;
    let snapshot: SnapshotRow | null = null;
    let snapshotMutationChecked = false;
    if (typeof rawSnapshotId === "string" && isUuidParam(rawSnapshotId)) {
      snapshot = await snapshots.findSnapshotById(rawSnapshotId);
      if (!snapshot) {
        throw new HTTPException(404, { message: "没有找到可回滚的快照。" });
      }
      // 资源级 fail-closed：还原是破坏性写操作，必须确认调用方对该快照所属事项有交付物修改权限，
      // 否则普通只读成员也能回滚别人事项的快照（越权）。
      await assertCanMutateWorkItemArtifacts(snapshot.workItemId, c.var.actor);
      snapshotMutationChecked = true;
    }
    const payload = revertAgentRunRequestSchema.parse(rawPayload);
    snapshot ??= await snapshots.findSnapshotById(payload.snapshot_id);
    if (!snapshot) {
      throw new HTTPException(404, { message: "没有找到可回滚的快照。" });
    }
    if (!snapshotMutationChecked) {
      await assertCanMutateWorkItemArtifacts(snapshot.workItemId, c.var.actor);
    }
    const snapshotAuditRows = await auditLogs.listAuditLogsForWorkItem(snapshot.workItemId);
    const belongsToRun = snapshotAuditRows.some((row) =>
      row.snapshotId === snapshot.id && detailJson(row.detailJson).run_id === runId
    );
    if (!belongsToRun) {
      throw new HTTPException(404, { message: "这个快照不属于这次 AI 执行。" });
    }

    const snapshotRef = toSnapshotRef(snapshot);
    const workdir = await workdirForRun(runId);
    if (!workdir) {
      throw new HTTPException(409, { message: "没有找到这次 AI 执行的本地工作目录,无法还原文件。" });
    }

    try {
      await revertFileSnapshot({
        snapshot: snapshotRef,
        workdir,
        // 快照里从来没有 .spill/（B10 落盘的中间产物）：还原时原样保留当前的，不因快照没有就删掉。
        excludeDirs: [SPILL_DIR_NAME]
      });
    } catch (error) {
      throw new HTTPException(409, {
        message: error instanceof Error ? error.message : "快照还原失败。"
      });
    }

    const at = now();
    const reverted = await snapshots.markSnapshotReverted(snapshot.id, at);
    // M23：把这个快照对应的写操作审计行标记为已撤销，否则回滚后审计轨迹/manifest 仍把已被还原的
    // 变更当作生效证据（undone_at=null）。snapshotAuditRows 在创建下面的 revert 日志之前取的，不含它。
    for (const row of snapshotAuditRows) {
      if (row.snapshotId === snapshot.id && row.id) {
        await auditLogs.markAuditLogUndone(row.id, at);
      }
    }
    const actor = c.var.actor;
    try {
      await auditLogs.createAuditLog({
        orgId: actor.orgId,
        workspaceId: actor.workspaceId,
        actorKind: actor.kind,
        ...(actor.userId ? { actorUserId: actor.userId } : {}),
        actorNickname: actor.label,
        // findings[21]：revert 是对该 work item 交付物的破坏性改动，必须挂在 work_item 实体上，
        // 才能和它撤销的那些写入一道出现在 work-item 审计时间线 / 回放视图里（run_id 仍存于 detailJson）。
        entityType: "work_item",
        entityId: snapshot.workItemId,
        action: "snapshot.reverted",
        detailJson: {
          snapshot_id: snapshot.id,
          run_id: runId,
          workdir_restored: true,
          ...(payload.reason_md ? { reason_md: payload.reason_md } : {})
        },
        snapshotId: snapshot.id
      });
    } catch (error) {
      getDefaultStructuredLogger().warn("snapshot_revert_audit_write_failed", {
        snapshotId: snapshot.id,
        workItemId: snapshot.workItemId,
        runId,
        error
      });
    }

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
  const snapshot = toSnapshotVm(row);
  return {
    id: snapshot.id,
    workItemId: snapshot.work_item_id,
    ...(snapshot.branch_id ? { branchId: snapshot.branch_id } : {}),
    kind: snapshot.kind,
    ref: snapshot.ref,
    ...(snapshot.content_sha256 ? { contentSha256: snapshot.content_sha256 } : {}),
    createdByKind: snapshot.created_by_kind,
    createdAt: snapshot.created_at,
    ...(snapshot.reverted_at ? { revertedAt: snapshot.reverted_at } : {})
  };
}
