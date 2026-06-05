import type { AuditLogFact, CostSummaryVM, EvidenceRef, ManifestFacts, Snapshot } from "@workhub/contracts";
import { buildManifestFacts, type AuditLogFact as InternalAuditLogFact, type SnapshotRef } from "@workhub/audit";
import type { AuditLogRow, SnapshotRow } from "@workhub/db";

import type { AgentRunQueueRecord } from "../workers/agent-runner.js";

export function toSnapshotVm(row: SnapshotRow): Snapshot {
  const snapshot: Snapshot = {
    id: row.id,
    work_item_id: row.workItemId,
    kind: row.kind as Snapshot["kind"],
    ref: row.ref,
    created_by_kind: row.createdByKind as Snapshot["created_by_kind"],
    created_at: row.createdAt.toISOString()
  };
  if (row.branchId) {
    snapshot.branch_id = row.branchId;
  }
  if (row.contentSha256) {
    snapshot.content_sha256 = row.contentSha256;
  }
  if (row.revertedAt) {
    snapshot.reverted_at = row.revertedAt.toISOString();
  }
  return snapshot;
}

export function toAuditLogFact(row: AuditLogRow): AuditLogFact {
  const fact: AuditLogFact = {
    id: row.id,
    actor: {
      actor_kind: row.actorKind as AuditLogFact["actor"]["actor_kind"]
    },
    entity: {
      entity_type: row.entityType,
      entity_id: row.entityId
    },
    action: row.action,
    detail_json: row.detailJson,
    created_at: row.createdAt.toISOString()
  };
  if (row.orgId) {
    fact.org_id = row.orgId;
  }
  if (row.workspaceId) {
    fact.workspace_id = row.workspaceId;
  }
  if (row.actorUserId) {
    fact.actor.actor_user_id = row.actorUserId;
  }
  if (row.actorNickname) {
    fact.actor.actor_nickname = row.actorNickname;
  }
  if (row.snapshotId) {
    fact.snapshot_id = row.snapshotId;
  }
  if (row.undoneAt) {
    fact.undone_at = row.undoneAt.toISOString();
  }
  return fact;
}

function toInternalSnapshot(snapshot: Snapshot): SnapshotRef {
  const ref: SnapshotRef = {
    id: snapshot.id,
    workItemId: snapshot.work_item_id,
    kind: snapshot.kind,
    ref: snapshot.ref,
    createdByKind: snapshot.created_by_kind,
    createdAt: snapshot.created_at
  };
  if (snapshot.branch_id) {
    ref.branchId = snapshot.branch_id;
  }
  if (snapshot.content_sha256) {
    ref.contentSha256 = snapshot.content_sha256;
  }
  if (snapshot.reverted_at) {
    ref.revertedAt = snapshot.reverted_at;
  }
  return ref;
}

function toInternalAuditLog(log: AuditLogFact): InternalAuditLogFact {
  const fact: InternalAuditLogFact = {
    id: log.id,
    actor: {
      actorKind: log.actor.actor_kind
    },
    entity: {
      entityType: log.entity.entity_type,
      entityId: log.entity.entity_id
    },
    action: log.action,
    detailJson: log.detail_json,
    createdAt: log.created_at
  };
  if (log.actor.actor_user_id) {
    fact.actor.actorUserId = log.actor.actor_user_id;
  }
  if (log.actor.actor_nickname) {
    fact.actor.actorNickname = log.actor.actor_nickname;
  }
  if (log.snapshot_id) {
    fact.snapshotId = log.snapshot_id;
  }
  if (log.undone_at) {
    fact.undoneAt = log.undone_at;
  }
  return fact;
}

export function buildReplayManifestFacts(input: {
  snapshots: Snapshot[];
  auditLogs: AuditLogFact[];
  sideEffects?: { sideEffect: "none" | "sandbox_file" | "business_write" | "external_effect"; action?: string }[];
}): ManifestFacts {
  return buildManifestFacts({
    snapshots: input.snapshots.map(toInternalSnapshot),
    auditLogs: input.auditLogs.map(toInternalAuditLog),
    ...(input.sideEffects ? { sideEffects: input.sideEffects } : {})
  });
}

export function buildReplayEvidenceRefs(auditLogs: AuditLogFact[]): EvidenceRef[] {
  return auditLogs.map((log) => ({
    id: log.id,
    source_type: "audit_log",
    source_id: log.id,
    title: `${log.action} audit`,
    href: `/api/workitems/${log.entity.entity_id}/audit`
  }));
}

export function buildReplayCostSummary(run: AgentRunQueueRecord): CostSummaryVM {
  return {
    me: {
      total_tokens: run.usage.token_in + run.usage.token_out,
      estimated_cost_cny: run.usage.estimated_cost_cny,
      warning_ratio: 0
    },
    active_notices: []
  };
}

export function buildReplayTracePage(input: {
  run: AgentRunQueueRecord;
  snapshots?: Snapshot[];
  auditLogs?: AuditLogFact[];
  manifestFacts?: ManifestFacts;
}) {
  const snapshots = input.snapshots ?? [];
  const auditLogs = input.auditLogs ?? [];
  return {
    run: input.run,
    steps: input.run.trace,
    evidence_refs: buildReplayEvidenceRefs(auditLogs),
    snapshots,
    audit_logs: auditLogs,
    manifest_facts: input.manifestFacts ?? buildReplayManifestFacts({ snapshots, auditLogs }),
    cost: buildReplayCostSummary(input.run)
  };
}
