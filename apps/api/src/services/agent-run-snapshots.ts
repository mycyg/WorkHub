import path from "node:path";

import { createSnapshotService } from "@workhub/audit";
import type { Settings } from "@workhub/config";
import type { AuditLogRepository, SnapshotRepository } from "@workhub/db";
import type { SnapshotHook, SnapshotHookInput } from "@workhub/tools";

import type { AgentRunQueueRecord } from "../workers/agent-runner.js";
import { getDefaultStructuredLogger } from "../logging.js";
import { getDefaultAuditStores } from "./audit-stores.js";

export type AgentRunSnapshotHookOptions = {
  run: AgentRunQueueRecord;
  settings: Settings;
  snapshotRoot?: string;
  snapshots?: SnapshotRepository;
  auditLogs?: AuditLogRepository;
  now?: () => Date;
  id?: () => string;
};

function preview(value: unknown, maxLength = 300) {
  if (typeof value === "string") {
    return value.slice(0, maxLength);
  }
  try {
    return JSON.stringify(value).slice(0, maxLength);
  } catch {
    return String(value).slice(0, maxLength);
  }
}

export function createAgentRunSnapshotHook(options: AgentRunSnapshotHookOptions): SnapshotHook {
  const snapshotRoot = options.snapshotRoot ?? path.join(options.settings.dataDir, "snapshots", "agent-runs", options.run.run_id);
  // CORE-04：service 提到闭包外只建一次——其内部按 workdir 持有「上一份快照」的 (contentSha256, ref)，
  // 同一 run 内相邻快照内容未变时复用 ref 不再整树拷贝（否则每次 side-effect 工具调用全量复制）。
  const service = createSnapshotService({
    snapshotRoot,
    ...(options.now ? { now: options.now } : {}),
    ...(options.id ? { id: options.id } : {})
  });
  return async (input: SnapshotHookInput) => {
    const stores = options.snapshots && options.auditLogs
      ? { snapshots: options.snapshots, auditLogs: options.auditLogs }
      : getDefaultAuditStores();
    const snapshot = await service.takeSandboxFileSnapshot({
      workItemId: input.workItemId ?? options.run.work_item_id,
      workdir: input.workdir,
      kind: "pre_step",
      createdByKind: "ai"
    });
    const row = await stores.snapshots.createSnapshot({
      id: snapshot.id,
      workItemId: snapshot.workItemId,
      ...(snapshot.branchId ? { branchId: snapshot.branchId } : {}),
      kind: snapshot.kind,
      ref: snapshot.ref,
      ...(snapshot.contentSha256 ? { contentSha256: snapshot.contentSha256 } : {}),
      createdByKind: snapshot.createdByKind
    });
    const action = `tool.${input.toolId}.snapshot`;
    try {
      await stores.auditLogs.createAuditLog({
        orgId: options.run.org_id ?? options.settings.auth.defaultOrgId,
        workspaceId: options.run.workspace_id ?? options.settings.auth.defaultWorkspaceId,
        actorKind: "ai",
        actorNickname: "WorkHub AI",
        entityType: "work_item",
        entityId: row.workItemId,
        action,
        detailJson: {
          run_id: input.runId ?? options.run.run_id,
          tool_id: input.toolId,
          side_effect: input.sideEffect,
          input_preview: preview(input.input)
        },
        snapshotId: row.id
      });
    } catch (error) {
      getDefaultStructuredLogger().warn("agent_run_snapshot_audit_write_failed", {
        action,
        snapshotId: row.id,
        workItemId: row.workItemId,
        error
      });
      throw error;
    }
    return { snapshotId: row.id };
  };
}
