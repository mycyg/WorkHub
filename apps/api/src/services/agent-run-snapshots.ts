import path from "node:path";

import { createSnapshotService } from "@workhub/audit";
import type { Settings } from "@workhub/config";
import type { AuditLogRepository, SnapshotRepository } from "@workhub/db";
import type { SnapshotHook, SnapshotHookInput } from "@workhub/tools";

import type { AgentRunQueueRecord } from "../workers/agent-runner.js";
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
  return async (input: SnapshotHookInput) => {
    const stores = options.snapshots && options.auditLogs
      ? { snapshots: options.snapshots, auditLogs: options.auditLogs }
      : getDefaultAuditStores();
    const snapshotRoot = options.snapshotRoot ?? path.join(options.settings.dataDir, "snapshots", "agent-runs", options.run.run_id);
    const service = createSnapshotService({
      snapshotRoot,
      ...(options.now ? { now: options.now } : {}),
      ...(options.id ? { id: options.id } : {})
    });
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
    await stores.auditLogs.createAuditLog({
      orgId: options.settings.auth.defaultOrgId,
      workspaceId: options.settings.auth.defaultWorkspaceId,
      actorKind: "ai",
      actorNickname: "WorkHub AI",
      entityType: "work_item",
      entityId: row.workItemId,
      action: `tool.${input.toolId}.snapshot`,
      detailJson: {
        run_id: input.runId ?? options.run.run_id,
        tool_id: input.toolId,
        side_effect: input.sideEffect,
        input_preview: preview(input.input)
      },
      snapshotId: row.id
    });
    return { snapshotId: row.id };
  };
}
