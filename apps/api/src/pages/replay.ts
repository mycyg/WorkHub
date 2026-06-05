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
  const totalTokens = run.usage.token_in + run.usage.token_out;
  const maxTokens = run.budget.max_tokens;
  const remainingTokens = Math.max(maxTokens - totalTokens, 0);
  const maxCostCny = Number.parseFloat(run.budget.max_cost_cny);
  const usedCostCny = Number.parseFloat(run.usage.estimated_cost_cny);
  const remainingCostCny = Number.isFinite(maxCostCny) && Number.isFinite(usedCostCny)
    ? Math.max(maxCostCny - usedCostCny, 0).toFixed(3).replace(/0+$/u, "").replace(/\.$/u, "")
    : "0";
  const usageRatio = maxTokens > 0 ? totalTokens / maxTokens : 0;
  const status = usageRatio >= 1 ? "exhausted" : usageRatio >= 0.95 ? "critical" : usageRatio >= 0.8 ? "warning" : "ok";
  const workitemUsage: CostSummaryVM["scopes"][number] = {
    scope: { kind: "workitem", workitem_id: run.work_item_id },
    scope_label: run.title,
    policy_id: "pcost-workitem-run-v0",
    period: "run",
    period_start: run.created_at,
    period_end: run.updated_at,
    token_in: run.usage.token_in,
    token_out: run.usage.token_out,
    total_tokens: totalTokens,
    max_tokens: maxTokens,
    remaining_tokens: remainingTokens,
    estimated_cost_cny: run.usage.estimated_cost_cny,
    max_cost_cny: run.budget.max_cost_cny,
    remaining_cost_cny: remainingCostCny,
    warning_ratio: usageRatio,
    status
  };
  const userUsage: CostSummaryVM["me"] = {
    ...workitemUsage,
    scope: { kind: "user", user_id: run.actor_id },
    scope_label: "我的当前 AI 执行预算",
    policy_id: "pcost-user-run-summary-v0"
  };

  return {
    me: userUsage,
    scopes: [workitemUsage, userUsage],
    active_notices:
      usageRatio >= 0.8
        ? [
            {
              code: usageRatio >= 1 ? "budget_exhausted" : "budget_warning",
              severity: usageRatio >= 1 ? "critical" : "warning",
              message: usageRatio >= 1 ? "本次 AI 预算已经用完。" : "本次 AI 预算快用完了。",
              scope: workitemUsage.scope,
              usage_ratio: usageRatio,
              recommended_action: usageRatio >= 1 ? "pause" : "downgrade_model",
              options: [
                { id: "open_cost", label: "查看预算", action_href: `/dashboard/cost?workItemId=${run.work_item_id}` }
              ],
              action_href: `/dashboard/cost?workItemId=${run.work_item_id}`
            }
          ]
        : [],
    generated_at: run.updated_at
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
