import type { AuditLogFact, ManifestFacts, SnapshotRef } from "./types.js";
import { isIrreversibleEffect } from "./policy.js";

export function buildManifestFacts(input: {
  snapshots: SnapshotRef[];
  auditLogs: AuditLogFact[];
  sideEffects?: { sideEffect: "none" | "sandbox_file" | "business_write" | "external_effect"; action?: string }[];
}): ManifestFacts {
  let latestSnapshot: SnapshotRef | undefined;
  for (let index = input.snapshots.length - 1; index >= 0; index -= 1) {
    const snapshot = input.snapshots[index];
    if (snapshot && !snapshot.revertedAt) {
      latestSnapshot = snapshot;
      break;
    }
  }
  const irreversibleReasons = new Set<string>();
  for (const effect of input.sideEffects ?? []) {
    const decision = isIrreversibleEffect(effect);
    if (decision.irreversible && decision.reason) {
      irreversibleReasons.add(decision.reason);
    }
  }
  const reversible = Boolean(latestSnapshot) && irreversibleReasons.size === 0;
  const facts: ManifestFacts = {
    checks: {
      snapshot_exists: latestSnapshot ? "passed" : "failed",
      revert_available: reversible ? "passed" : latestSnapshot ? "warning" : "failed"
    },
    rollback: {
      available: reversible,
      description: reversible ? "可以还原到本次改动前。" : "这次改动含不可逆动作,需要人工确认。"
    },
    risk: {
      reversible,
      irreversible_reasons: [...irreversibleReasons]
    },
    evidence_refs: input.auditLogs.map((log) => ({
      source_type: "audit_log",
      source_id: log.id,
      title: `${log.action} audit`
    }))
  };
  if (latestSnapshot) {
    facts.rollback.snapshot_id = latestSnapshot.id;
  }
  if (irreversibleReasons.size > 0) {
    facts.checks.ask_gate_required = "warning";
  }
  return facts;
}
