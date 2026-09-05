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
  /**
   * CORE-04 内容去重：调用方持有的「上一份同 workdir 快照」。hashWorkdir 算出的 contentSha256 与之相同
   * 说明工作区自上次快照以来零变化——复用其 ref、跳过整树拷贝（否则每次 side-effect 工具调用都全量
   * 复制一份，最坏 ~3GB/run）。新快照仍得新 id（审计行一行一 id），只是 ref 指向既有目录。
   */
  reuseIfUnchanged?: { contentSha256: string; ref: string };
  /**
   * 快照范围之外的工作目录顶层目录名（按名字精确匹配，不做 glob、不递归）。既不拷进快照，也不进
   * contentSha256——否则这些目录一变，CORE-04「内容未变就复用 ref」的去重就失效。
   * 用于 agent run 的 `.spill/`（B10 落盘的超大工具结果原文）：那是模型自救用的中间产物，不是需要回滚的
   * 工作区状态。含路径分隔符或 `.`/`..` 的条目直接拒绝，不静默忽略。
   */
  excludeDirs?: string[];
};

export type RevertSnapshotInput = {
  snapshot: SnapshotRef;
  workdir: string;
  /**
   * 与 SnapshotTakeInput.excludeDirs 同一份名单。还原是整树原子换入，快照里本来就没有这些目录；
   * 换入后把当前工作目录里的同名目录原样搬回——不因为快照里没有就把它们删掉。
   */
  excludeDirs?: string[];
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
