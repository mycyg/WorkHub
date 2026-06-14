import type { ActorKind } from "@workhub/contracts";
import type { ToolSideEffect } from "@workhub/tools";

export type AuditActor = {
  actorKind: ActorKind;
  actorUserId?: string;
  actorNickname?: string;
};

export type AuditEntityRef = {
  entityType: string;
  entityId: string;
};

export type SnapshotRef = {
  id: string;
  workItemId: string;
  branchId?: string;
  kind: "pre_step" | "merge" | "manual" | "base";
  ref: string;
  contentSha256?: string;
  createdByKind: ActorKind;
  createdAt: string;
  revertedAt?: string;
};

export type AuditLogFact = {
  id: string;
  actor: AuditActor;
  entity: AuditEntityRef;
  action: string;
  detailJson: Record<string, unknown>;
  snapshotId?: string;
  undoneAt?: string;
  createdAt: string;
};

export type SnapshotTakeInput = {
  workItemId: string;
  branchId?: string;
  workdir: string;
  snapshotRoot: string;
  kind?: SnapshotRef["kind"];
  createdByKind: ActorKind;
  now?: () => Date;
  id?: () => string;
};

export type RevertSnapshotInput = {
  snapshot: SnapshotRef;
  workdir: string;
};

export type ManifestFacts = {
  checks: {
    snapshot_exists: "passed" | "failed";
    revert_available: "passed" | "failed" | "warning";
    ask_gate_required?: "passed" | "warning";
  };
  rollback: {
    available: boolean;
    snapshot_id?: string;
    description: string;
  };
  risk: {
    reversible: boolean;
    irreversible_reasons: string[];
  };
  evidence_refs: {
    source_type: "agent_step" | "audit_log";
    source_id: string;
    title: string;
  }[];
};

export type SideEffectPolicy = {
  sideEffect: ToolSideEffect;
  action?: string;
};
