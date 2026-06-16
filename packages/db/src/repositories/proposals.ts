import { randomUUID } from "node:crypto";

import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";

import type {
  ActorKind,
  DeliverableChange,
  DeliverableChangeManifest,
  StructuredFieldPatchDryRun,
  StructuredFieldPatchOperation,
  TextHunkApplyOverrides,
  TextHunkOverrideDecision
} from "@workhub/contracts";

import type { WorkHubDb } from "../client.js";
import {
  acceptedDeliverableChanges,
  agentRuns,
  auditLogs,
  branches,
  mergeAttempts,
  mergeProposals,
  projectDriveItems,
  projectDriveVersions,
  proposals,
  reviews,
  snapshots,
  workItemAcceptanceItems,
  workItemTaskItems,
  workItemTaskPlans,
  workItems
} from "../schema/index.js";

export type BranchRow = typeof branches.$inferSelect;
export type ProposalRow = typeof proposals.$inferSelect;
export type ReviewRow = typeof reviews.$inferSelect;
export type AcceptedDeliverableChangeRow = typeof acceptedDeliverableChanges.$inferSelect;
export type MergeAttemptRow = typeof mergeAttempts.$inferSelect;
export type MergeProposalRow = typeof mergeProposals.$inferSelect;

export type StoredProposalRows = {
  proposal: ProposalRow;
  reviews: ReviewRow[];
};

// GAP-1：首页决策队列要展示「AI 已交付、待评审」的提议。这是该查询的轻量行(不带 manifest/reviews)。
export type ReviewableProposalRow = {
  id: string;
  workItemId: string;
  title: string;
  status: string;
  createdAt: Date;
};

type WorkHubTx = Parameters<Parameters<WorkHubDb["transaction"]>[0]>[0];

export type ProposalRepositoryActor = {
  actorKind: ActorKind;
  actorUserId?: string;
};

export type CreateProposalFromManifestInput = {
  proposalId?: string;
  workItemId: string;
  branchId?: string;
  manifest: DeliverableChangeManifest;
  actor: ProposalRepositoryActor;
  title?: string;
  agentRunId?: string;
  confidenceId?: string;
  at?: Date;
};

export type ReviewProposalInput = {
  proposalId: string;
  actor: ProposalRepositoryActor;
  decision: "approve" | "reject";
  reasonMd?: string;
  reasonFedBackAt?: Date;
  at?: Date;
};

export type MergeProposalInput = {
  proposalId: string;
  mergeSnapshotId?: string;
  actor?: ProposalRepositoryActor;
  adoptedDriveFiles?: ProposalAdoptedDriveFileInput[];
  acceptIncomingTargetKeys?: string[];
  bulkAction?: ProposalMergeBulkActionInput;
  candidateSupplements?: MergeProposalCandidateSupplement[];
  at?: Date;
};

// P-COLLAB rebase：对着最新正式版重算冲突并落候选,不动账本(不 supersede/不 accept、不改状态)。
export type RebaseProposalInput = {
  proposalId: string;
  actor?: ProposalRepositoryActor;
  candidateSupplements?: MergeProposalCandidateSupplement[];
  at?: Date;
};

export type ProposalMergeBulkActionInput = {
  action: "keep_current" | "accept_incoming";
  targetKeys: string[];
  conflictCount?: number;
};

export type ProposalAdoptedDriveFileInput = {
  changeId: string;
  filename: string;
  storagePath: string;
  sizeBytes: number;
  sha256?: string;
  mime?: string;
};

export type ProposalAcceptedDriveFile = {
  acceptedChangeId: string;
  targetKey: string;
  acceptedRef?: string;
  sha256After?: string;
  driveVersionId?: string;
  storagePath?: string;
  mime?: string;
};

export type ProposalMergeContext = {
  proposalId: string;
  workItemId: string;
  workItemCode: string;
  projectId: string;
  branchId: string;
  agentRunId: string | null;
  workdirRef: string | null;
  // P-COLLAB M2：本分支 run 开始时拍的 project/ base 快照目录(三方合并的共同祖先来源)。
  // 无 base 快照时为 null,合并/对底稿回退到 accepted-history 祖先。
  baseSnapshotRef: string | null;
  diffManifest: DeliverableChangeManifest;
};

export type ProposalMergeConflict = {
  proposal_id: string;
  work_item_id: string;
  proposal_title: string;
  target_key: string;
  change_id: string;
  target_kind: DeliverableChange["target_kind"];
  change_type: DeliverableChange["change_type"];
  existing_proposal_id: string;
  existing_change_id: string;
  target_path?: string;
  existing_sha256_after?: string;
  incoming_sha256_before?: string;
  incoming_sha256_after?: string;
  existing_ref?: string;
  incoming_version_before?: string;
};

export type MergeProposalCandidate = {
  option_key: string;
  target_kind: DeliverableChange["target_kind"];
  rationale_md: string;
  merged_value?: Record<string, unknown>;
  source?: string;
  quality_gate?: Record<string, unknown>;
};

export type MergeProposalCandidateSupplement = {
  conflictKey: string;
  candidates: MergeProposalCandidate[];
  recommendedOptionKey?: string;
};

export type ChooseMergeProposalCandidateInput = {
  mergeProposalId: string;
  optionKey: string;
  actor?: ProposalRepositoryActor;
  at?: Date;
};

export type MergeProposalCandidateApplicationContext = {
  mergeProposalId: string;
  proposalId: string;
  proposalStatus: ProposalRow["status"];
  proposalTitle: string;
  workItemId: string;
  workItemCode: string;
  projectId: string;
  branchId: string;
  conflictKey: string;
  conflict: ProposalMergeConflict;
  chosenOptionKey: string | null;
  chosenByUserId: string | null;
  chosenAt: Date | null;
  candidate: MergeProposalCandidate | null;
  diffManifest: DeliverableChangeManifest;
};

export type ApplyMergeProposalCandidateInput = {
  mergeProposalId: string;
  mergeSnapshotId?: string;
  actor?: ProposalRepositoryActor;
  resolvedDriveFile?: ProposalAdoptedDriveFileInput;
  resolvedStructuredFieldPatch?: ProposalStructuredFieldPatchInput;
  resolvedTextHunkPatch?: ProposalTextHunkPatchInput;
  at?: Date;
};

export type ProposalStructuredFieldPatchInput = {
  dryRun: StructuredFieldPatchDryRun;
  taskPlanScope?: {
    targetPlanId: string;
  };
};

export type ProposalTextHunkPatchInput = {
  source: "text_hunk_overrides";
  overrides: TextHunkApplyOverrides;
  decisions: Array<{
    hunkIndex: number;
    startLine: number;
    endLine: number;
    decision: TextHunkOverrideDecision;
  }>;
  conflictRanges: Array<{
    hunkIndex: number;
    startLine: number;
    endLine: number;
  }>;
  baseSha256: string;
  currentSha256: string;
  incomingSha256: string;
  outputSha256: string;
};

export class ProposalRepositoryMergeConflictError extends Error {
  public readonly code = "merge_conflict";

  constructor(public readonly conflicts: ProposalMergeConflict[]) {
    super("Proposal merge conflicts with accepted deliverables");
  }
}

export class ProposalRepositoryInvalidMergeProposalCandidateError extends Error {
  public readonly code = "invalid_merge_proposal_candidate";

  constructor(
    public readonly mergeProposalId: string,
    public readonly optionKey: string
  ) {
    super("Merge proposal candidate does not exist");
  }
}

export class ProposalRepositoryMergeProposalAlreadyChosenError extends Error {
  public readonly code = "merge_proposal_already_chosen";

  constructor(
    public readonly mergeProposalId: string,
    public readonly chosenOptionKey: string
  ) {
    super("Merge proposal already has a different chosen option");
  }
}

export class ProposalRepositoryMergeProposalNotChosenError extends Error {
  public readonly code = "merge_proposal_not_chosen";

  constructor(public readonly mergeProposalId: string) {
    super("Merge proposal candidate has not been chosen");
  }
}

export class ProposalRepositoryUnsupportedMergeProposalApplyError extends Error {
  constructor(
    public readonly mergeProposalId: string,
    public readonly code: string,
    message: string
  ) {
    super(message);
  }
}

// P-COLLAB L3 最后防线：advisory lock 下提交前复检发现当前正式版已被并发改动，
// 中止采纳以避免脏写。这是「重试可解」的并发冲突，应映射成 409，而非裸 500。
export class ProposalRepositoryStaleBaseError extends Error {
  public readonly code = "stale_base";

  constructor(public readonly targetKey: string) {
    super(`Accepted base for ${targetKey} changed mid-transaction; apply aborted to avoid lost update.`);
  }
}

// P-COLLAB rebase「对一下底稿再采纳」：撞上 L3 最后防线、但本分支有 base 快照(可做三方合并)时,
// 抛这个而非 StaleBase——上层据此把"裸中止"升级成"先对一下底稿再采纳"的可恢复流程。
export class ProposalRepositoryRebaseRequiredError extends Error {
  public readonly code = "rebase_required";

  constructor(public readonly staleTargetKeys: string[]) {
    super(`Accepted base changed mid-transaction for ${staleTargetKeys.join(", ")}; rebase required before adopting.`);
  }
}

export type ProposalRepository = {
  createFromManifest: (input: CreateProposalFromManifestInput) => Promise<StoredProposalRows>;
  findMergeContext: (proposalId: string) => Promise<ProposalMergeContext | null>;
  findAcceptedDriveFileForTarget: (input: {
    workItemId: string;
    projectId?: string;
    targetKey: string;
    ref?: string;
    sha256?: string;
  }) => Promise<ProposalAcceptedDriveFile | null>;
  findMergeProposalCandidateForApply: (
    mergeProposalId: string
  ) => Promise<MergeProposalCandidateApplicationContext | null>;
  findProposalByMergeProposalId: (mergeProposalId: string) => Promise<StoredProposalRows | null>;
  findById: (proposalId: string) => Promise<StoredProposalRows | null>;
  listByWorkItem: (workItemId: string) => Promise<StoredProposalRows[]>;
  listReviewable: (input: { submitterUserId?: string; includeAll: boolean; limit?: number }) => Promise<ReviewableProposalRow[]>;
  listConflictsByWorkItem: (workItemId: string) => Promise<ProposalMergeConflict[]>;
  listMergeAttemptsByProposal: (proposalId: string) => Promise<MergeAttemptRow[]>;
  listMergeProposalsByAttempt: (mergeAttemptId: string) => Promise<MergeProposalRow[]>;
  chooseMergeProposalCandidate: (input: ChooseMergeProposalCandidateInput) => Promise<MergeProposalRow | null>;
  applyMergeProposalCandidate: (input: ApplyMergeProposalCandidateInput) => Promise<StoredProposalRows | null>;
  review: (input: ReviewProposalInput) => Promise<StoredProposalRows | null>;
  merge: (input: MergeProposalInput) => Promise<StoredProposalRows | null>;
  rebase: (input: RebaseProposalInput) => Promise<ProposalMergeConflict[] | null>;
};

async function readReviewsForProposal(db: WorkHubDb, proposalId: string) {
  return db
    .select()
    .from(reviews)
    .where(eq(reviews.proposalId, proposalId))
    .orderBy(asc(reviews.createdAt));
}

async function readStoredProposal(db: WorkHubDb, proposalId: string): Promise<StoredProposalRows | null> {
  const proposalRows = await db
    .select()
    .from(proposals)
    .where(eq(proposals.id, proposalId))
    .limit(1);
  const proposal = proposalRows[0];
  if (!proposal) {
    return null;
  }
  return {
    proposal,
    reviews: await readReviewsForProposal(db, proposal.id)
  };
}

function normalizeTargetPath(path: string) {
  return path.replace(/\\/gu, "/").replace(/\/{2,}/gu, "/");
}

function targetKey(change: DeliverableChange) {
  const ref = change.target_ref;
  if (ref.entity_id) {
    return `${ref.entity_type}:${ref.entity_id}`;
  }
  if (ref.path) {
    return `${ref.entity_type}:${normalizeTargetPath(ref.path)}`;
  }
  return `${ref.entity_type}:${change.id}`;
}

function baseVersionRef(change: DeliverableChange) {
  return change.target_ref.version_before ?? change.target_ref.sha256_before;
}

function acceptedRef(change: DeliverableChange) {
  return change.target_ref.version_after
    ?? change.target_ref.sha256_after
    ?? change.preview_ref?.href
    ?? change.id;
}

function conflictsWithCurrentAccepted(input: {
  proposalId: string;
  workItemId: string;
  proposalTitle: string;
  change: DeliverableChange;
  targetKey: string;
  current: AcceptedDeliverableChangeRow;
}): ProposalMergeConflict | null {
  const { change, current } = input;
  if (current.proposalId === input.proposalId) {
    return null;
  }

  const incomingShaBefore = change.target_ref.sha256_before;
  const incomingShaAfter = change.target_ref.sha256_after;
  const incomingVersionBefore = change.target_ref.version_before;
  let conflicted = false;

  if (incomingShaBefore) {
    conflicted = current.sha256After !== incomingShaBefore;
  } else if (incomingVersionBefore) {
    conflicted = current.acceptedRef !== incomingVersionBefore;
  } else if (change.change_type === "created" || change.change_type === "generated") {
    conflicted = !incomingShaAfter || current.sha256After !== incomingShaAfter;
  } else {
    conflicted = true;
  }

  if (!conflicted) {
    return null;
  }

  return {
    proposal_id: input.proposalId,
    work_item_id: input.workItemId,
    proposal_title: input.proposalTitle,
    target_key: input.targetKey,
    change_id: change.id,
    target_kind: change.target_kind,
    change_type: change.change_type,
    existing_proposal_id: current.proposalId,
    existing_change_id: current.changeId,
    ...(change.target_ref.path ? { target_path: change.target_ref.path } : {}),
    ...(current.sha256After ? { existing_sha256_after: current.sha256After } : {}),
    ...(incomingShaBefore ? { incoming_sha256_before: incomingShaBefore } : {}),
    ...(incomingShaAfter ? { incoming_sha256_after: incomingShaAfter } : {}),
    ...(current.acceptedRef ? { existing_ref: current.acceptedRef } : {}),
    ...(incomingVersionBefore ? { incoming_version_before: incomingVersionBefore } : {})
  };
}

async function readCurrentAccepted(
  tx: WorkHubTx,
  input: { projectId?: string | null; workItemId: string; targetKey: string }
) {
  // P-COLLAB L1：项目级当前真相——同一项目跨任务改同一文件时，看到的是项目里这个文件的最新态，
  // 不再只看本任务范围；这是"旧底稿采纳不会盖掉别人刚加进去的内容"的查询前提。
  // projectId 缺失（历史行未回填/无项目）时回落任务级，保证向后兼容。
  const scope = input.projectId
    ? eq(acceptedDeliverableChanges.projectId, input.projectId)
    : eq(acceptedDeliverableChanges.workItemId, input.workItemId);
  const rows = await tx
    .select()
    .from(acceptedDeliverableChanges)
    .where(and(
      scope,
      eq(acceptedDeliverableChanges.targetKey, input.targetKey),
      isNull(acceptedDeliverableChanges.supersededAt)
    ))
    .orderBy(desc(acceptedDeliverableChanges.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

function normalizeShaRef(value: string | undefined) {
  return value?.replace(/^sha256:/iu, "");
}

function acceptedDriveFileFromRow(row: {
  accepted: AcceptedDeliverableChangeRow;
  driveVersion: typeof projectDriveVersions.$inferSelect | null;
}): ProposalAcceptedDriveFile {
  return {
    acceptedChangeId: row.accepted.id,
    targetKey: row.accepted.targetKey,
    ...(row.accepted.acceptedRef ? { acceptedRef: row.accepted.acceptedRef } : {}),
    ...(row.accepted.sha256After ? { sha256After: row.accepted.sha256After } : {}),
    ...(row.driveVersion?.id ? { driveVersionId: row.driveVersion.id } : {}),
    ...(row.driveVersion?.storagePath ? { storagePath: row.driveVersion.storagePath } : {}),
    ...(row.driveVersion?.mime ? { mime: row.driveVersion.mime } : {})
  };
}

async function recordMergeAttempt(
  tx: WorkHubTx,
  input: {
    proposalId: string;
    workItemId: string;
    branchId: string;
    actor?: ProposalRepositoryActor;
    result: "conflict" | "merged" | "aborted" | "clean" | "rebased";
    mergeSnapshotId?: string;
    conflicts: ProposalMergeConflict[];
    acceptedTargetKeys: string[];
    targetKeys: string[];
    at: Date;
  }
) {
  const id = randomUUID();
  await tx.insert(mergeAttempts).values({
    id,
    proposalId: input.proposalId,
    workItemId: input.workItemId,
    branchId: input.branchId,
    actorKind: input.actor?.actorKind ?? "system",
    ...(input.actor?.actorUserId ? { actorUserId: input.actor.actorUserId } : {}),
    result: input.result,
    ...(input.mergeSnapshotId ? { mergeSnapshotId: input.mergeSnapshotId } : {}),
    conflictsJson: input.conflicts,
    acceptedTargetKeys: input.acceptedTargetKeys,
    targetKeys: input.targetKeys,
    conflictCount: input.conflicts.length,
    createdAt: input.at
  });
  return id;
}

async function recordBulkActionAudit(
  tx: WorkHubTx,
  input: {
    proposalId: string;
    workItemId: string;
    branchId: string;
    actor?: ProposalRepositoryActor;
    bulkAction: ProposalMergeBulkActionInput;
    result: "conflict" | "merged";
    mergeAttemptId: string;
    acceptedIncomingTargetKeys: string[];
    resolvedConflictTargetKeys: string[];
    blockedTargetKeys: string[];
    targetKeys: string[];
    mergeSnapshotId?: string;
    at: Date;
  }
) {
  await tx.insert(auditLogs).values({
    id: randomUUID(),
    actorKind: input.actor?.actorKind ?? "system",
    ...(input.actor?.actorUserId ? { actorUserId: input.actor.actorUserId } : {}),
    entityType: "proposal",
    entityId: input.proposalId,
    action: "proposal.bulk_action",
    detailJson: {
      work_item_id: input.workItemId,
      branch_id: input.branchId,
      bulk_action: {
        action: input.bulkAction.action,
        target_keys: input.bulkAction.targetKeys,
        conflict_count: input.bulkAction.conflictCount ?? input.bulkAction.targetKeys.length
      },
      result: input.result,
      merge_attempt_id: input.mergeAttemptId,
      ...(input.mergeSnapshotId ? { merge_snapshot_id: input.mergeSnapshotId } : {}),
      accepted_incoming_target_keys: input.acceptedIncomingTargetKeys,
      resolved_conflict_target_keys: input.resolvedConflictTargetKeys,
      blocked_target_keys: input.blockedTargetKeys,
      target_keys: input.targetKeys
    },
    ...(input.mergeSnapshotId ? { snapshotId: input.mergeSnapshotId } : {}),
    createdAt: input.at
  });
}

function bulkActionAuditPayload(input: {
  bulkAction?: ProposalMergeBulkActionInput;
}) {
  return input.bulkAction
    ? {
        bulk_action: {
          action: input.bulkAction.action,
          target_keys: input.bulkAction.targetKeys,
          conflict_count: input.bulkAction.conflictCount ?? input.bulkAction.targetKeys.length
        }
      }
    : {};
}

function mergeProposalCandidates(conflict: ProposalMergeConflict) {
  return [
    {
      option_key: "keep_current",
      target_kind: conflict.target_kind,
      rationale_md: "保留当前正式版，不覆盖已经采纳的交付物。",
      source: "deterministic",
      merged_value: {
        source: "current",
        proposal_id: conflict.existing_proposal_id,
        change_id: conflict.existing_change_id,
        ...(conflict.existing_ref ? { ref: conflict.existing_ref } : {}),
        ...(conflict.existing_sha256_after ? { sha256: conflict.existing_sha256_after } : {})
      }
    },
    {
      option_key: "accept_incoming",
      target_kind: conflict.target_kind,
      rationale_md: "明确采纳这次版本，覆盖当前正式版，并保留还原入口。",
      source: "deterministic",
      merged_value: {
        source: "incoming",
        proposal_id: conflict.proposal_id,
        change_id: conflict.change_id,
        ...(conflict.incoming_version_before ? { base_ref: conflict.incoming_version_before } : {}),
        ...(conflict.incoming_sha256_before ? { sha256_before: conflict.incoming_sha256_before } : {}),
        ...(conflict.incoming_sha256_after ? { sha256_after: conflict.incoming_sha256_after } : {})
      }
    }
  ];
}

function supplementsByConflictKey(supplements: MergeProposalCandidateSupplement[] | undefined) {
  const byKey = new Map<string, MergeProposalCandidateSupplement>();
  for (const supplement of supplements ?? []) {
    if (supplement.candidates.length > 0) {
      byKey.set(supplement.conflictKey, supplement);
    }
  }
  return byKey;
}

function candidatesWithSupplement(conflict: ProposalMergeConflict, supplement?: MergeProposalCandidateSupplement) {
  const byOption = new Map<string, MergeProposalCandidate>();
  for (const candidate of mergeProposalCandidates(conflict)) {
    byOption.set(candidate.option_key, candidate);
  }
  for (const candidate of supplement?.candidates ?? []) {
    if (!candidate.option_key || candidate.option_key === "keep_current" || candidate.option_key === "accept_incoming") {
      continue;
    }
    byOption.set(candidate.option_key, {
      ...candidate,
      target_kind: candidate.target_kind ?? conflict.target_kind
    });
  }
  return [...byOption.values()];
}

function mergeProposalCandidateOptionKeys(row: MergeProposalRow) {
  const candidates = Array.isArray(row.candidatesJson) ? row.candidatesJson : [];
  return new Set(candidates.map((candidate) => {
    if (!candidate || typeof candidate !== "object") {
      return undefined;
    }
    const optionKey = (candidate as Record<string, unknown>).option_key;
    return typeof optionKey === "string" ? optionKey : undefined;
  }).filter((optionKey): optionKey is string => Boolean(optionKey)));
}

function mergeProposalCandidateByOption(row: MergeProposalRow, optionKey: string) {
  const candidates = Array.isArray(row.candidatesJson) ? row.candidatesJson : [];
  const found = candidates.find((candidate) => {
    if (!candidate || typeof candidate !== "object") {
      return false;
    }
    return (candidate as Record<string, unknown>).option_key === optionKey;
  });
  return found && typeof found === "object" ? found as MergeProposalCandidate : null;
}

function conflictByKey(attempt: MergeAttemptRow, conflictKey: string) {
  const conflicts = Array.isArray(attempt.conflictsJson) ? attempt.conflictsJson : [];
  return conflicts.find((conflict) => {
    if (!conflict || typeof conflict !== "object") {
      return false;
    }
    return (conflict as Partial<ProposalMergeConflict>).target_key === conflictKey;
  }) as ProposalMergeConflict | undefined;
}

function changeForConflict(manifest: DeliverableChangeManifest, conflict: ProposalMergeConflict) {
  return manifest.changes.find((change) =>
    change.id === conflict.change_id || targetKey(change) === conflict.target_key
  );
}

function aiFusionResolvedChange(input: {
  sourceChange: DeliverableChange;
  conflict: ProposalMergeConflict;
  candidate: MergeProposalCandidate;
  changeId: string;
  sha256After?: string;
  mergeProposalId: string;
}): DeliverableChange {
  const changedFields = Object.keys(input.candidate.merged_value ?? {});
  return {
    ...input.sourceChange,
    id: input.changeId,
    target_kind: input.candidate.target_kind ?? input.sourceChange.target_kind,
    change_type: "updated",
    target_ref: {
      ...input.sourceChange.target_ref,
      ...(input.conflict.existing_ref ? { version_before: input.conflict.existing_ref } : {}),
      version_after: input.sha256After ? `sha256:${input.sha256After}` : `ai_fusion:${input.mergeProposalId}`,
      ...(input.conflict.existing_sha256_after ? { sha256_before: input.conflict.existing_sha256_after } : {}),
      ...(input.sha256After ? { sha256_after: input.sha256After } : {})
    },
    human_summary: "采纳 AI 融合建议，生成正式融合稿。",
    machine_summary: {
      ...(input.sourceChange.machine_summary ?? {}),
      after_excerpt: input.candidate.rationale_md,
      changed_fields: changedFields.length > 0 ? changedFields : ["ai_fusion"]
    },
    preview_ref: { kind: "text", href: `merge-proposal:${input.mergeProposalId}:ai_fusion` }
  };
}

const structuredWorkItemScalarFields = ["title", "summary_md", "priority", "due_at"] as const;
type StructuredWorkItemScalarField = typeof structuredWorkItemScalarFields[number];
type StructuredWorkItemPatchField = StructuredWorkItemScalarField | "acceptance_items" | "task_items";
type StructuredAcceptanceItemPatchValue = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  sort_order: number;
  source_plan_id: string | null;
};
type StructuredTaskItemPatchValue = {
  id: string;
  title: string;
  description: string | null;
  item_type: string;
  suggested_user_id: string | null;
  estimate_hours: number | null;
  sort_order: number;
};

function isStructuredWorkItemScalarField(field: string): field is StructuredWorkItemScalarField {
  return (structuredWorkItemScalarFields as readonly string[]).includes(field);
}

type StructuredWorkItemFieldChange = {
  field: StructuredWorkItemPatchField;
  valueType: StructuredFieldPatchOperation["value_type"];
  baseValue: unknown;
  beforeValue: unknown;
  afterValue: unknown;
  mergeDecision: "fast_path" | "same_value";
  itemCount?: number;
  targetPlanId?: string;
};

function workItemFieldBeforeValue(row: typeof workItems.$inferSelect, field: StructuredWorkItemScalarField) {
  switch (field) {
    case "title":
      return row.title;
    case "summary_md":
      return row.summaryMd;
    case "priority":
      return row.priority;
    case "due_at":
      return row.dueAt ? row.dueAt.toISOString() : null;
  }
}

function structuredWorkItemComparableValue(field: StructuredWorkItemScalarField, value: unknown) {
  if (field !== "due_at") {
    return value;
  }
  if (value === null) {
    return null;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? value : value.toISOString();
  }
  if (typeof value === "string") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toISOString();
  }
  return value;
}

function structuredWorkItemFieldValuesEqual(input: {
  field: StructuredWorkItemScalarField;
  left: unknown;
  right: unknown;
}) {
  return structuredWorkItemComparableValue(input.field, input.left)
    === structuredWorkItemComparableValue(input.field, input.right);
}

function structuredWorkItemFieldValue(operation: StructuredFieldPatchOperation) {
  switch (operation.field) {
    case "title":
    case "summary_md":
    case "priority":
      if (typeof operation.value !== "string") {
        return undefined;
      }
      return operation.value;
    case "due_at":
      if (operation.value_type === "null") {
        return null;
      }
      if (typeof operation.value !== "string") {
        return undefined;
      }
      return new Date(operation.value);
    default:
      return undefined;
  }
}

function normalizeAcceptanceItemPatchValue(
  value: unknown,
  index: number
): StructuredAcceptanceItemPatchValue | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const item = value as Record<string, unknown>;
  if (typeof item["id"] !== "string" || typeof item["title"] !== "string" || item["title"].trim().length === 0) {
    return undefined;
  }
  const description = typeof item["description"] === "string"
    ? item["description"]
    : item["description"] === null
      ? null
      : null;
  const status = typeof item["status"] === "string" ? item["status"] : "open";
  if (!["open", "met", "unmet", "waived"].includes(status)) {
    return undefined;
  }
  const sortOrder = typeof item["sort_order"] === "number" && Number.isInteger(item["sort_order"])
    ? item["sort_order"]
    : index;
  const sourcePlanId = typeof item["source_plan_id"] === "string"
    ? item["source_plan_id"]
    : item["source_plan_id"] === null
      ? null
      : null;
  return {
    id: item["id"],
    title: item["title"].trim(),
    description,
    status,
    sort_order: sortOrder,
    source_plan_id: sourcePlanId
  };
}

function normalizeAcceptanceItemsPatchValue(value: unknown): StructuredAcceptanceItemPatchValue[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const normalized: StructuredAcceptanceItemPatchValue[] = [];
  const seen = new Set<string>();
  for (const [index, item] of value.entries()) {
    const normalizedItem = normalizeAcceptanceItemPatchValue(item, index);
    if (!normalizedItem || seen.has(normalizedItem.id)) {
      return undefined;
    }
    seen.add(normalizedItem.id);
    normalized.push(normalizedItem);
  }
  return normalized.sort((left, right) =>
    left.sort_order - right.sort_order || left.id.localeCompare(right.id)
  );
}

function acceptanceItemsPatchValueFromRows(
  rows: (typeof workItemAcceptanceItems.$inferSelect)[]
): StructuredAcceptanceItemPatchValue[] {
  return rows
    .map((row) => ({
      id: row.id,
      title: row.title,
      description: row.description ?? null,
      status: row.status,
      sort_order: row.sortOrder,
      source_plan_id: row.sourcePlanId ?? null
    }))
    .sort((left, right) =>
      left.sort_order - right.sort_order || left.id.localeCompare(right.id)
    );
}

function acceptanceItemsPatchValuesEqual(left: unknown, right: unknown) {
  const normalizedLeft = normalizeAcceptanceItemsPatchValue(left);
  const normalizedRight = normalizeAcceptanceItemsPatchValue(right);
  if (!normalizedLeft || !normalizedRight) {
    return false;
  }
  return JSON.stringify(normalizedLeft) === JSON.stringify(normalizedRight);
}

function normalizeTaskItemPatchValue(
  value: unknown,
  index: number
): StructuredTaskItemPatchValue | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const item = value as Record<string, unknown>;
  if (typeof item["id"] !== "string" || typeof item["title"] !== "string" || item["title"].trim().length === 0) {
    return undefined;
  }
  const description = typeof item["description"] === "string"
    ? item["description"]
    : item["description"] === null
      ? null
      : null;
  const itemType = typeof item["item_type"] === "string" ? item["item_type"] : "task";
  if (!["task", "risk", "acceptance"].includes(itemType)) {
    return undefined;
  }
  const suggestedUserId = typeof item["suggested_user_id"] === "string"
    ? item["suggested_user_id"]
    : item["suggested_user_id"] === null
      ? null
      : null;
  let estimateHours: number | null = null;
  if (typeof item["estimate_hours"] === "number") {
    if (!Number.isFinite(item["estimate_hours"]) || item["estimate_hours"] < 0) {
      return undefined;
    }
    estimateHours = item["estimate_hours"];
  } else if (item["estimate_hours"] !== undefined && item["estimate_hours"] !== null) {
    return undefined;
  }
  const sortOrder = typeof item["sort_order"] === "number" && Number.isInteger(item["sort_order"])
    ? item["sort_order"]
    : index;
  return {
    id: item["id"],
    title: item["title"].trim(),
    description,
    item_type: itemType,
    suggested_user_id: suggestedUserId,
    estimate_hours: estimateHours,
    sort_order: sortOrder
  };
}

function normalizeTaskItemsPatchValue(value: unknown): StructuredTaskItemPatchValue[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const normalized: StructuredTaskItemPatchValue[] = [];
  const seen = new Set<string>();
  for (const [index, item] of value.entries()) {
    const normalizedItem = normalizeTaskItemPatchValue(item, index);
    if (!normalizedItem || seen.has(normalizedItem.id)) {
      return undefined;
    }
    seen.add(normalizedItem.id);
    normalized.push(normalizedItem);
  }
  return normalized.sort((left, right) =>
    left.sort_order - right.sort_order || left.id.localeCompare(right.id)
  );
}

function taskItemsPatchValueFromRows(
  rows: (typeof workItemTaskItems.$inferSelect)[]
): StructuredTaskItemPatchValue[] {
  return rows
    .map((row) => ({
      id: row.id,
      title: row.title,
      description: row.description ?? null,
      item_type: row.itemType,
      suggested_user_id: row.suggestedUserId ?? null,
      estimate_hours: row.estimateHours ?? null,
      sort_order: row.sortOrder
    }))
    .sort((left, right) =>
      left.sort_order - right.sort_order || left.id.localeCompare(right.id)
    );
}

function taskItemsPatchValuesEqual(left: unknown, right: unknown) {
  const normalizedLeft = normalizeTaskItemsPatchValue(left);
  const normalizedRight = normalizeTaskItemsPatchValue(right);
  if (!normalizedLeft || !normalizedRight) {
    return false;
  }
  return JSON.stringify(normalizedLeft) === JSON.stringify(normalizedRight);
}

async function readLatestDispatchTaskPlanWithItems(tx: WorkHubTx, workItemId: string) {
  const planRows = await tx
    .select()
    .from(workItemTaskPlans)
    .where(and(eq(workItemTaskPlans.workItemId, workItemId), eq(workItemTaskPlans.stage, "dispatch")))
    .orderBy(desc(workItemTaskPlans.createdAt), desc(workItemTaskPlans.id))
    .limit(1);
  const plan = planRows[0] ?? null;
  const items = plan
    ? await tx
      .select()
      .from(workItemTaskItems)
      .where(eq(workItemTaskItems.planId, plan.id))
      .orderBy(asc(workItemTaskItems.sortOrder), asc(workItemTaskItems.createdAt), asc(workItemTaskItems.id))
    : [];
  return { plan, items };
}

async function readTaskPlansWithItems(tx: WorkHubTx, workItemId: string) {
  const planRows = await tx
    .select()
    .from(workItemTaskPlans)
    .where(eq(workItemTaskPlans.workItemId, workItemId))
    .orderBy(desc(workItemTaskPlans.createdAt), desc(workItemTaskPlans.id));
  const plans: Array<{
    plan: typeof workItemTaskPlans.$inferSelect;
    items: (typeof workItemTaskItems.$inferSelect)[];
  }> = [];
  for (const plan of planRows) {
    const items = await tx
      .select()
      .from(workItemTaskItems)
      .where(eq(workItemTaskItems.planId, plan.id))
      .orderBy(asc(workItemTaskItems.sortOrder), asc(workItemTaskItems.createdAt), asc(workItemTaskItems.id));
    plans.push({ plan, items });
  }
  return plans;
}

async function resolveTaskPlanForTaskItemsPatch(
  tx: WorkHubTx,
  input: {
    mergeProposalId: string;
    workItemId: string;
    scope?: ProposalStructuredFieldPatchInput["taskPlanScope"];
  }
) {
  const plans = await readTaskPlansWithItems(tx, input.workItemId);
  const targetPlanId = input.scope?.targetPlanId;
  if (targetPlanId) {
    const matched = plans.find((plan) => plan.plan.id === targetPlanId);
    if (!matched) {
      throw new ProposalRepositoryUnsupportedMergeProposalApplyError(
        input.mergeProposalId,
        "task_plan_scope_invalid",
        "Selected task plan does not belong to this WorkItem"
      );
    }
    return matched;
  }
  if (plans.length > 1) {
    throw new ProposalRepositoryUnsupportedMergeProposalApplyError(
      input.mergeProposalId,
      "task_plan_scope_required",
      "Multiple task plans exist; choose a target task plan before writing task_items"
    );
  }
  return plans[0] ?? { plan: null, items: [] };
}

function withStructuredWorkItemBaseFields(input: {
  manifest: DeliverableChangeManifest;
  workItem: typeof workItems.$inferSelect;
  acceptanceItems?: (typeof workItemAcceptanceItems.$inferSelect)[];
  taskItems?: (typeof workItemTaskItems.$inferSelect)[];
}) {
  const changes = input.manifest.changes.map((change) => {
    if (
      change.target_kind !== "structured_record"
      || change.target_ref.entity_type !== "work_item"
      || change.target_ref.entity_id !== input.workItem.id
    ) {
      return change;
    }
    const changedFields = change.machine_summary?.changed_fields ?? [];
    const fieldValuesBefore: Record<string, unknown> = {};
    for (const field of changedFields) {
      if (isStructuredWorkItemScalarField(field)) {
        fieldValuesBefore[field] = workItemFieldBeforeValue(input.workItem, field);
      }
      if (field === "acceptance_items") {
        fieldValuesBefore[field] = acceptanceItemsPatchValueFromRows(input.acceptanceItems ?? []);
      }
      if (field === "task_items") {
        fieldValuesBefore[field] = taskItemsPatchValueFromRows(input.taskItems ?? []);
      }
    }
    if (Object.keys(fieldValuesBefore).length === 0) {
      return change;
    }
    return {
      ...change,
      machine_summary: {
        ...change.machine_summary,
        field_values_before: {
          ...(change.machine_summary?.field_values_before ?? {}),
          ...fieldValuesBefore
        }
      }
    };
  });
  return { ...input.manifest, changes };
}

async function applyStructuredWorkItemFieldPatch(
  tx: WorkHubTx,
  input: {
    mergeProposalId: string;
    workItemId: string;
    branchId: string;
    patch: ProposalStructuredFieldPatchInput;
    actorUserId: string;
    at: Date;
  }
) {
  const dryRun = input.patch.dryRun;
  if (dryRun.status !== "ready" || !dryRun.executable) {
    throw new ProposalRepositoryUnsupportedMergeProposalApplyError(
      input.mergeProposalId,
      "structured_field_patch_not_executable",
      "Structured field patch must be ready before it can update WorkItem fields"
    );
  }
  if (dryRun.patch.target_entity_type !== "work_item" || dryRun.patch.target_entity_id !== input.workItemId) {
    throw new ProposalRepositoryUnsupportedMergeProposalApplyError(
      input.mergeProposalId,
      "structured_field_patch_target_mismatch",
      "Structured field patch target does not match the proposal WorkItem"
    );
  }

  const rows = await tx
    .select()
    .from(workItems)
    .where(eq(workItems.id, input.workItemId))
    .limit(1);
  const row = rows[0];
  if (!row) {
    throw new ProposalRepositoryUnsupportedMergeProposalApplyError(
      input.mergeProposalId,
      "structured_field_patch_target_missing",
      "Structured field patch target WorkItem is missing"
    );
  }
  const needsAcceptanceItemsPatch = dryRun.patch.operations.some((operation) => operation.field === "acceptance_items");
  const needsTaskItemsPatch = dryRun.patch.operations.some((operation) => operation.field === "task_items");
  const currentAcceptanceRows = needsAcceptanceItemsPatch
    ? await tx
      .select()
      .from(workItemAcceptanceItems)
      .where(eq(workItemAcceptanceItems.workItemId, input.workItemId))
      .orderBy(asc(workItemAcceptanceItems.sortOrder), asc(workItemAcceptanceItems.createdAt), asc(workItemAcceptanceItems.id))
    : [];
  const currentTaskPlan = needsTaskItemsPatch
    ? await resolveTaskPlanForTaskItemsPatch(tx, {
      mergeProposalId: input.mergeProposalId,
      workItemId: input.workItemId,
      scope: input.patch.taskPlanScope
    })
    : { plan: null, items: [] };

  const update: {
    title?: string;
    summaryMd?: string;
    priority?: string;
    dueAt?: Date | null;
  } = {};
  const fieldChanges: StructuredWorkItemFieldChange[] = [];
  let acceptanceItemsReplacement: StructuredAcceptanceItemPatchValue[] | undefined;
  let taskItemsReplacement: StructuredTaskItemPatchValue[] | undefined;
  for (const operation of dryRun.patch.operations) {
    if (operation.field === "acceptance_items") {
      const incomingItems = normalizeAcceptanceItemsPatchValue(operation.value);
      if (!incomingItems) {
        throw new ProposalRepositoryUnsupportedMergeProposalApplyError(
          input.mergeProposalId,
          "structured_field_patch_field_unsupported",
          "Structured acceptance_items patch is invalid"
        );
      }
      if (!Object.prototype.hasOwnProperty.call(operation, "before_value")) {
        throw new ProposalRepositoryUnsupportedMergeProposalApplyError(
          input.mergeProposalId,
          "structured_field_patch_base_missing",
          "Structured field patch is missing a base value for acceptance_items"
        );
      }
      const baseItems = normalizeAcceptanceItemsPatchValue(operation.before_value);
      if (!baseItems) {
        throw new ProposalRepositoryUnsupportedMergeProposalApplyError(
          input.mergeProposalId,
          "structured_field_patch_base_missing",
          "Structured field patch base value for acceptance_items is invalid"
        );
      }
      const currentItems = acceptanceItemsPatchValueFromRows(currentAcceptanceRows);
      const currentMatchesBase = acceptanceItemsPatchValuesEqual(currentItems, baseItems);
      const currentMatchesIncoming = acceptanceItemsPatchValuesEqual(currentItems, incomingItems);
      if (!currentMatchesBase && !currentMatchesIncoming) {
        throw new ProposalRepositoryUnsupportedMergeProposalApplyError(
          input.mergeProposalId,
          "structured_field_patch_conflict",
          "Structured acceptance_items patch conflicts with the current WorkItem acceptance items"
        );
      }
      acceptanceItemsReplacement = incomingItems;
      fieldChanges.push({
        field: "acceptance_items",
        valueType: operation.value_type,
        baseValue: baseItems,
        beforeValue: currentItems,
        afterValue: incomingItems,
        mergeDecision: currentMatchesBase ? "fast_path" : "same_value",
        itemCount: incomingItems.length,
        ...(currentTaskPlan.plan?.id ? { targetPlanId: currentTaskPlan.plan.id } : {})
      });
      continue;
    }
    if (operation.field === "task_items") {
      const incomingItems = normalizeTaskItemsPatchValue(operation.value);
      if (!incomingItems) {
        throw new ProposalRepositoryUnsupportedMergeProposalApplyError(
          input.mergeProposalId,
          "structured_field_patch_field_unsupported",
          "Structured task_items patch is invalid"
        );
      }
      if (!Object.prototype.hasOwnProperty.call(operation, "before_value")) {
        throw new ProposalRepositoryUnsupportedMergeProposalApplyError(
          input.mergeProposalId,
          "structured_field_patch_base_missing",
          "Structured field patch is missing a base value for task_items"
        );
      }
      const baseItems = normalizeTaskItemsPatchValue(operation.before_value);
      if (!baseItems) {
        throw new ProposalRepositoryUnsupportedMergeProposalApplyError(
          input.mergeProposalId,
          "structured_field_patch_base_missing",
          "Structured field patch base value for task_items is invalid"
        );
      }
      const currentItems = taskItemsPatchValueFromRows(currentTaskPlan.items);
      const currentMatchesBase = taskItemsPatchValuesEqual(currentItems, baseItems);
      const currentMatchesIncoming = taskItemsPatchValuesEqual(currentItems, incomingItems);
      if (!currentMatchesBase && !currentMatchesIncoming) {
        throw new ProposalRepositoryUnsupportedMergeProposalApplyError(
          input.mergeProposalId,
          "structured_field_patch_conflict",
          "Structured task_items patch conflicts with the current WorkItem task items"
        );
      }
      taskItemsReplacement = incomingItems;
      fieldChanges.push({
        field: "task_items",
        valueType: operation.value_type,
        baseValue: baseItems,
        beforeValue: currentItems,
        afterValue: incomingItems,
        mergeDecision: currentMatchesBase ? "fast_path" : "same_value",
        itemCount: incomingItems.length
      });
      continue;
    }
    const value = structuredWorkItemFieldValue(operation);
    if (value === undefined || !isStructuredWorkItemScalarField(operation.field)) {
      throw new ProposalRepositoryUnsupportedMergeProposalApplyError(
        input.mergeProposalId,
        "structured_field_patch_field_unsupported",
        `Structured field patch field is not supported in this slice: ${operation.field}`
      );
    }
    const field = operation.field;
    const currentValue = workItemFieldBeforeValue(row, field);
    const incomingValue = value instanceof Date ? value.toISOString() : value;
    const hasBaseValue = Object.prototype.hasOwnProperty.call(operation, "before_value");
    if (!hasBaseValue) {
      throw new ProposalRepositoryUnsupportedMergeProposalApplyError(
        input.mergeProposalId,
        "structured_field_patch_base_missing",
        `Structured field patch is missing a base value for ${field}`
      );
    }
    const baseValue = structuredWorkItemComparableValue(field, operation.before_value);
    const currentMatchesBase = structuredWorkItemFieldValuesEqual({
      field,
      left: currentValue,
      right: baseValue
    });
    const currentMatchesIncoming = structuredWorkItemFieldValuesEqual({
      field,
      left: currentValue,
      right: incomingValue
    });
    if (!currentMatchesBase && !currentMatchesIncoming) {
      throw new ProposalRepositoryUnsupportedMergeProposalApplyError(
        input.mergeProposalId,
        "structured_field_patch_conflict",
        `Structured field patch conflicts with the current WorkItem value for ${field}`
      );
    }
    if (field === "title") update.title = value as string;
    if (field === "summary_md") update.summaryMd = value as string;
    if (field === "priority") update.priority = value as string;
    if (field === "due_at") update.dueAt = value as Date | null;
    fieldChanges.push({
      field,
      valueType: operation.value_type,
      baseValue,
      beforeValue: currentValue,
      afterValue: incomingValue,
      mergeDecision: currentMatchesBase ? "fast_path" : "same_value"
    });
  }
  if (fieldChanges.length === 0) {
    throw new ProposalRepositoryUnsupportedMergeProposalApplyError(
      input.mergeProposalId,
      "structured_field_patch_empty",
      "Structured field patch has no supported WorkItem field operations"
    );
  }

  if (acceptanceItemsReplacement) {
    await tx
      .delete(workItemAcceptanceItems)
      .where(eq(workItemAcceptanceItems.workItemId, input.workItemId));
    if (acceptanceItemsReplacement.length > 0) {
      await tx.insert(workItemAcceptanceItems).values(
        acceptanceItemsReplacement.map((item) => ({
          id: item.id,
          workItemId: input.workItemId,
          title: item.title,
          description: item.description,
          status: item.status,
          sortOrder: item.sort_order,
          sourcePlanId: item.source_plan_id,
          createdAt: input.at,
          updatedAt: input.at
        }))
      );
    }
  }
  if (taskItemsReplacement) {
    let taskPlanId = currentTaskPlan.plan?.id ?? null;
    if (!taskPlanId && taskItemsReplacement.length > 0) {
      taskPlanId = randomUUID();
      await tx.insert(workItemTaskPlans).values({
        id: taskPlanId,
        workItemId: input.workItemId,
        stage: "dispatch",
        status: "draft",
        summary: "AI fusion task item patch",
        createdByUserId: input.actorUserId,
        createdAt: input.at,
        updatedAt: input.at
      });
    }
    if (taskPlanId) {
      const replacementPlanId = taskPlanId;
      await tx
        .delete(workItemTaskItems)
        .where(eq(workItemTaskItems.planId, replacementPlanId));
      if (taskItemsReplacement.length > 0) {
        await tx.insert(workItemTaskItems).values(
          taskItemsReplacement.map((item) => ({
            id: item.id,
            planId: replacementPlanId,
            title: item.title,
            description: item.description,
            itemType: item.item_type,
            suggestedUserId: item.suggested_user_id,
            estimateHours: item.estimate_hours,
            sortOrder: item.sort_order,
            createdAt: input.at,
            updatedAt: input.at
          }))
        );
      }
    }
  }

  await tx
    .update(workItems)
    .set({
      ...update,
      status: "merged",
      mainBranchId: input.branchId,
      acceptedAt: input.at,
      version: sql`${workItems.version} + 1`,
      updatedAt: input.at
    })
    .where(eq(workItems.id, input.workItemId));

  return fieldChanges;
}

async function recordMergeProposals(
  tx: WorkHubTx,
  input: {
    mergeAttemptId: string;
    conflicts: ProposalMergeConflict[];
    acceptedTargetKeys: string[];
    candidateSupplements?: MergeProposalCandidateSupplement[];
    actor?: ProposalRepositoryActor;
    at: Date;
  }
) {
  const acceptedTargetKeys = new Set(input.acceptedTargetKeys);
  const supplements = supplementsByConflictKey(input.candidateSupplements);
  for (const conflict of input.conflicts) {
    const chosen = acceptedTargetKeys.has(conflict.target_key) ? "accept_incoming" : undefined;
    const supplement = supplements.get(conflict.target_key);
    await tx.insert(mergeProposals).values({
      id: randomUUID(),
      mergeAttemptId: input.mergeAttemptId,
      conflictKey: conflict.target_key,
      candidatesJson: candidatesWithSupplement(conflict, supplement),
      recommendedOptionKey: supplement?.recommendedOptionKey ?? "keep_current",
      ...(chosen ? { chosenOptionKey: chosen } : {}),
      ...(chosen && input.actor?.actorUserId ? { chosenByUserId: input.actor.actorUserId } : {}),
      ...(chosen ? { chosenAt: input.at } : {}),
      createdAt: input.at,
      updatedAt: input.at
    });
  }
}

function drivePathSegments(input: { workItemCode: string; change: DeliverableChange }) {
  const targetPath = normalizeTargetPath(input.change.target_ref.path ?? input.change.id).replace(/^\/+/u, "");
  const targetSegments = targetPath.split("/").filter((segment) => segment.length > 0);
  return ["AI Deliverables", input.workItemCode, ...targetSegments];
}

async function readDriveItem(
  tx: WorkHubTx,
  input: { projectId: string; parentId: string | null; name: string; kind: "file" | "folder" }
) {
  const conditions = [
    eq(projectDriveItems.projectId, input.projectId),
    eq(projectDriveItems.name, input.name),
    eq(projectDriveItems.kind, input.kind),
    isNull(projectDriveItems.deletedAt)
  ];
  if (input.parentId) {
    conditions.push(eq(projectDriveItems.parentId, input.parentId));
  } else {
    conditions.push(isNull(projectDriveItems.parentId));
  }

  const rows = await tx
    .select()
    .from(projectDriveItems)
    .where(and(...conditions))
    .orderBy(desc(projectDriveItems.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

async function ensureDriveFolder(
  tx: WorkHubTx,
  input: { projectId: string; parentId: string | null; name: string; actorUserId: string; at: Date }
) {
  const existing = await readDriveItem(tx, {
    projectId: input.projectId,
    parentId: input.parentId,
    name: input.name,
    kind: "folder"
  });
  if (existing) {
    return existing.id;
  }

  const folderId = randomUUID();
  await tx.insert(projectDriveItems).values({
    id: folderId,
    projectId: input.projectId,
    ...(input.parentId ? { parentId: input.parentId } : {}),
    name: input.name,
    kind: "folder",
    createdByUserId: input.actorUserId,
    updatedByUserId: input.actorUserId,
    createdAt: input.at,
    updatedAt: input.at
  });
  return folderId;
}

async function nextDriveVersionNo(tx: WorkHubTx, itemId: string) {
  const rows = await tx
    .select({ versionNo: projectDriveVersions.versionNo })
    .from(projectDriveVersions)
    .where(eq(projectDriveVersions.itemId, itemId))
    .orderBy(desc(projectDriveVersions.versionNo))
    .limit(1);
  return (rows[0]?.versionNo ?? 0) + 1;
}

async function adoptDriveFileVersion(
  tx: WorkHubTx,
  input: {
    projectId: string;
    actorUserId: string;
    workItemCode: string;
    change: DeliverableChange;
    file: ProposalAdoptedDriveFileInput;
    at: Date;
  }
) {
  const segments = drivePathSegments({ workItemCode: input.workItemCode, change: input.change });
  const filename = input.file.filename || segments.at(-1) || input.change.id;
  const folderSegments = segments.slice(0, -1);
  let parentId: string | null = null;
  for (const segment of folderSegments) {
    parentId = await ensureDriveFolder(tx, {
      projectId: input.projectId,
      parentId,
      name: segment,
      actorUserId: input.actorUserId,
      at: input.at
    });
  }

  const existingFile = await readDriveItem(tx, {
    projectId: input.projectId,
    parentId,
    name: filename,
    kind: "file"
  });
  const driveItemId = existingFile?.id ?? randomUUID();
  if (!existingFile) {
    await tx.insert(projectDriveItems).values({
      id: driveItemId,
      projectId: input.projectId,
      ...(parentId ? { parentId } : {}),
      name: filename,
      kind: "file",
      createdByUserId: input.actorUserId,
      updatedByUserId: input.actorUserId,
      createdAt: input.at,
      updatedAt: input.at
    });
  }

  const driveVersionId = randomUUID();
  await tx.insert(projectDriveVersions).values({
    id: driveVersionId,
    itemId: driveItemId,
    versionNo: await nextDriveVersionNo(tx, driveItemId),
    filename,
    ...(input.file.mime ? { mime: input.file.mime } : {}),
    sizeBytes: input.file.sizeBytes,
    storagePath: input.file.storagePath,
    ...(input.file.sha256 ? { sha256: input.file.sha256 } : {}),
    createdByUserId: input.actorUserId,
    createdAt: input.at,
    updatedAt: input.at
  });
  await tx
    .update(projectDriveItems)
    .set({
      currentVersionId: driveVersionId,
      updatedByUserId: input.actorUserId,
      updatedAt: input.at
    })
    .where(eq(projectDriveItems.id, driveItemId));

  return { driveItemId, driveVersionId };
}

export function createProposalRepository(db: WorkHubDb): ProposalRepository {
  return {
    async createFromManifest(input) {
      const at = input.at ?? new Date();
      const proposalId = input.proposalId ?? input.manifest.proposal_id ?? randomUUID();
      const branchId = input.branchId ?? input.manifest.branch_id ?? randomUUID();
      let manifest: DeliverableChangeManifest = {
        ...input.manifest,
        proposal_id: proposalId,
        work_item_id: input.workItemId,
        branch_id: branchId,
        base: {
          ...input.manifest.base,
          created_at: input.manifest.base.created_at ?? at.toISOString()
        }
      };

      await db.transaction(async (tx) => {
        const workItemRows = await tx
          .select()
          .from(workItems)
          .where(eq(workItems.id, input.workItemId))
          .limit(1);
        if (workItemRows[0]) {
          const acceptanceRows = await tx
            .select()
            .from(workItemAcceptanceItems)
            .where(eq(workItemAcceptanceItems.workItemId, input.workItemId))
            .orderBy(
              asc(workItemAcceptanceItems.sortOrder),
              asc(workItemAcceptanceItems.createdAt),
              asc(workItemAcceptanceItems.id)
            );
          const taskPlan = await readLatestDispatchTaskPlanWithItems(tx, input.workItemId);
          manifest = withStructuredWorkItemBaseFields({
            manifest,
            workItem: workItemRows[0],
            acceptanceItems: acceptanceRows,
            taskItems: taskPlan.items
          });
        }
        const branchRows = await tx
          .select()
          .from(branches)
          .where(eq(branches.id, branchId))
          .limit(1);
        const existingBranch = branchRows[0];
        if (existingBranch && existingBranch.workItemId !== input.workItemId) {
          throw new Error("Proposal branch belongs to a different work item");
        }
        if (!existingBranch) {
          await tx.insert(branches).values({
            id: branchId,
            workItemId: input.workItemId,
            actorKind: input.actor.actorKind,
            actorUserId: input.actor.actorUserId,
            agentRunId: input.agentRunId,
            kind: "work",
            baseSnapshotId: manifest.base.snapshot_id,
            headRef: manifest.base.branch_head_ref,
            status: "open",
            createdAt: at,
            updatedAt: at
          });
        }

        await tx.insert(proposals).values({
          id: proposalId,
          workItemId: input.workItemId,
          branchId,
          // L#57：当前是「一分支一提议」模型，round 恒为 1（多轮修订走新分支）。round 列与
          // (branch_id, round) 唯一索引为未来「同分支多轮」预留；保持恒 1 以维持每分支单提议的不变量。
          round: 1,
          title: input.title ?? manifest.title,
          status: "opened",
          diffManifest: manifest,
          openedByKind: input.actor.actorKind,
          openedByUserId: input.actor.actorUserId,
          // M27：关联本次运行的置信度记录，让提议自带 AI 评级（不再永远为 null）。
          ...(input.confidenceId ? { confidenceId: input.confidenceId } : {}),
          createdAt: at,
          updatedAt: at
        });
        await tx
          .update(branches)
          .set({ status: "proposed", updatedAt: at })
          .where(eq(branches.id, branchId));
      });

      const stored = await readStoredProposal(db, proposalId);
      if (!stored) {
        throw new Error("Failed to create proposal");
      }
      return stored;
    },

    async findMergeContext(proposalId) {
      const rows = await db
        .select({
          proposalId: proposals.id,
          workItemId: proposals.workItemId,
          workItemCode: workItems.code,
          projectId: workItems.projectId,
          branchId: proposals.branchId,
          agentRunId: branches.agentRunId,
          workdirRef: agentRuns.workdirRef,
          baseSnapshotRef: snapshots.ref,
          diffManifest: proposals.diffManifest
        })
        .from(proposals)
        .innerJoin(workItems, eq(proposals.workItemId, workItems.id))
        .innerJoin(branches, eq(proposals.branchId, branches.id))
        .leftJoin(agentRuns, eq(branches.agentRunId, agentRuns.id))
        // P-COLLAB M2：把分支记录的 base 快照(branches.baseSnapshotId,非 FK 软引用)连进来取其目录,
        // 供 diff3 当共同祖先读文件。snapshot 不存在(悬挂/未拍)时 leftJoin 给 null,合并自动回退。
        .leftJoin(snapshots, eq(branches.baseSnapshotId, snapshots.id))
        .where(eq(proposals.id, proposalId))
        .limit(1);
      return rows[0] ?? null;
    },

    async findAcceptedDriveFileForTarget(input) {
      const refSha = normalizeShaRef(input.ref);
      const sha = normalizeShaRef(input.sha256);
      const refConditions = [
        ...(input.ref ? [eq(acceptedDeliverableChanges.acceptedRef, input.ref)] : []),
        ...(refSha ? [eq(acceptedDeliverableChanges.sha256After, refSha)] : []),
        ...(sha ? [eq(acceptedDeliverableChanges.sha256After, sha)] : [])
      ];
      const conditions = [
        // H3：融合/三方合并读取的"当前/底稿"内容必须与撞车判定同范围（project 优先），
        // 否则跨任务采纳同一文件时会读到错的 base，三方校验校验了错的行。
        input.projectId
          ? eq(acceptedDeliverableChanges.projectId, input.projectId)
          : eq(acceptedDeliverableChanges.workItemId, input.workItemId),
        eq(acceptedDeliverableChanges.targetKey, input.targetKey),
        refConditions.length > 0 ? or(...refConditions) : isNull(acceptedDeliverableChanges.supersededAt)
      ];
      const rows = await db
        .select({
          accepted: acceptedDeliverableChanges,
          driveVersion: projectDriveVersions
        })
        .from(acceptedDeliverableChanges)
        .leftJoin(projectDriveVersions, eq(acceptedDeliverableChanges.driveVersionId, projectDriveVersions.id))
        .where(and(...conditions))
        .orderBy(desc(acceptedDeliverableChanges.acceptedVersion), desc(acceptedDeliverableChanges.createdAt))
        .limit(1);
      const row = rows[0];
      return row ? acceptedDriveFileFromRow(row) : null;
    },

    async findMergeProposalCandidateForApply(mergeProposalId) {
      const rows = await db
        .select({
          mergeProposal: mergeProposals,
          mergeAttempt: mergeAttempts,
          proposalId: proposals.id,
          proposalStatus: proposals.status,
          proposalTitle: proposals.title,
          workItemId: proposals.workItemId,
          branchId: proposals.branchId,
          diffManifest: proposals.diffManifest,
          workItemCode: workItems.code,
          projectId: workItems.projectId
        })
        .from(mergeProposals)
        .innerJoin(mergeAttempts, eq(mergeProposals.mergeAttemptId, mergeAttempts.id))
        .innerJoin(proposals, eq(mergeAttempts.proposalId, proposals.id))
        .innerJoin(workItems, eq(proposals.workItemId, workItems.id))
        .where(eq(mergeProposals.id, mergeProposalId))
        .limit(1);
      const row = rows[0];
      if (!row) {
        return null;
      }
      const conflict = conflictByKey(row.mergeAttempt, row.mergeProposal.conflictKey);
      if (!conflict) {
        return null;
      }
      const applyOptionKey = row.mergeProposal.chosenOptionKey ?? "ai_fusion";
      const candidate = mergeProposalCandidateByOption(row.mergeProposal, applyOptionKey);
      return {
        mergeProposalId: row.mergeProposal.id,
        proposalId: row.proposalId,
        proposalStatus: row.proposalStatus,
        proposalTitle: row.proposalTitle,
        workItemId: row.workItemId,
        workItemCode: row.workItemCode,
        projectId: row.projectId,
        branchId: row.branchId,
        conflictKey: row.mergeProposal.conflictKey,
        conflict,
        chosenOptionKey: row.mergeProposal.chosenOptionKey,
        chosenByUserId: row.mergeProposal.chosenByUserId,
        chosenAt: row.mergeProposal.chosenAt,
        candidate,
        diffManifest: row.diffManifest
      };
    },

    async findProposalByMergeProposalId(mergeProposalId) {
      const rows = await db
        .select({ proposalId: proposals.id })
        .from(mergeProposals)
        .innerJoin(mergeAttempts, eq(mergeProposals.mergeAttemptId, mergeAttempts.id))
        .innerJoin(proposals, eq(mergeAttempts.proposalId, proposals.id))
        .where(eq(mergeProposals.id, mergeProposalId))
        .limit(1);
      const row = rows[0];
      return row ? readStoredProposal(db, row.proposalId) : null;
    },

    findById(proposalId) {
      return readStoredProposal(db, proposalId);
    },

    async listByWorkItem(workItemId) {
      const proposalRows = await db
        .select()
        .from(proposals)
        .where(eq(proposals.workItemId, workItemId))
        .orderBy(desc(proposals.createdAt));
      return Promise.all(
        proposalRows.map(async (proposal) => ({
          proposal,
          reviews: await readReviewsForProposal(db, proposal.id)
        }))
      );
    },
    // GAP-1：列出待评审(opened/reviewed)的提议给首页决策队列。inner join work_items 取提交人做鉴权——
    // 非 admin 只看自己提交的工作项的提议(与 routeApprover "proposal"→submitter 一致);admin 看全部。
    async listReviewable(input) {
      const conditions = [inArray(proposals.status, ["opened", "reviewed"])];
      if (!input.includeAll) {
        if (!input.submitterUserId) {
          return [];
        }
        conditions.push(eq(workItems.submitterUserId, input.submitterUserId));
      }
      const rows = await db
        .select({
          id: proposals.id,
          workItemId: proposals.workItemId,
          title: proposals.title,
          status: proposals.status,
          createdAt: proposals.createdAt
        })
        .from(proposals)
        .innerJoin(workItems, eq(workItems.id, proposals.workItemId))
        .where(and(...conditions))
        .orderBy(desc(proposals.createdAt))
        .limit(input.limit ?? 50);
      return rows;
    },

    async listConflictsByWorkItem(workItemId) {
      const conflicts: ProposalMergeConflict[] = [];
      await db.transaction(async (tx) => {
        const proposalRows = await tx
          .select({
            proposalId: proposals.id,
            workItemId: proposals.workItemId,
            projectId: workItems.projectId,
            title: proposals.title,
            diffManifest: proposals.diffManifest
          })
          .from(proposals)
          .innerJoin(workItems, eq(proposals.workItemId, workItems.id))
          .where(and(
            eq(proposals.workItemId, workItemId),
            eq(proposals.status, "reviewed")
          ))
          .orderBy(desc(proposals.createdAt));
        for (const proposal of proposalRows) {
          for (const change of proposal.diffManifest.changes) {
            const key = targetKey(change);
            const current = await readCurrentAccepted(tx, {
              projectId: proposal.projectId,
              workItemId: proposal.workItemId,
              targetKey: key
            });
            if (!current) {
              continue;
            }
            const conflict = conflictsWithCurrentAccepted({
              proposalId: proposal.proposalId,
              workItemId: proposal.workItemId,
              proposalTitle: proposal.title,
              change,
              targetKey: key,
              current
            });
            if (conflict) {
              conflicts.push(conflict);
            }
          }
        }
      });
      return conflicts;
    },

    async listMergeAttemptsByProposal(proposalId) {
      return db
        .select()
        .from(mergeAttempts)
        .where(eq(mergeAttempts.proposalId, proposalId))
        .orderBy(asc(mergeAttempts.createdAt));
    },

    async listMergeProposalsByAttempt(mergeAttemptId) {
      return db
        .select()
        .from(mergeProposals)
        .where(eq(mergeProposals.mergeAttemptId, mergeAttemptId))
        .orderBy(asc(mergeProposals.createdAt));
    },

    async chooseMergeProposalCandidate(input) {
      const at = input.at ?? new Date();
      let result: MergeProposalRow | null = null;
      await db.transaction(async (tx) => {
        const rows = await tx
          .select()
          .from(mergeProposals)
          .where(eq(mergeProposals.id, input.mergeProposalId))
          .limit(1);
        const row = rows[0];
        if (!row) {
          return;
        }
        if (!mergeProposalCandidateOptionKeys(row).has(input.optionKey)) {
          throw new ProposalRepositoryInvalidMergeProposalCandidateError(input.mergeProposalId, input.optionKey);
        }
        // L5：候选里虽含 keep_current / accept_incoming（供展示/推荐），但 applyMergeProposalCandidate 只认
        // ai_fusion，选了那两者会让变更申请永久卡在 reviewed（死状态）。HTTP 路由层（routes/proposals.ts
        // 的 /choose）已 fail-closed 拒绝这两种 option_key——它们的解析走合并接口的 conflict_resolution 内联完成。
        if (row.chosenOptionKey) {
          if (row.chosenOptionKey !== input.optionKey) {
            throw new ProposalRepositoryMergeProposalAlreadyChosenError(input.mergeProposalId, row.chosenOptionKey);
          }
          result = row;
          return;
        }
        // CAS：仅当 chosen_option_key 仍为空时写入，避免 read-check-write 竞态下的 last-write-wins 覆盖。
        const updatedRows = await tx
          .update(mergeProposals)
          .set({
            chosenOptionKey: input.optionKey,
            ...(input.actor?.actorUserId ? { chosenByUserId: input.actor.actorUserId } : {}),
            chosenAt: at,
            updatedAt: at
          })
          .where(and(eq(mergeProposals.id, input.mergeProposalId), isNull(mergeProposals.chosenOptionKey)))
          .returning();
        if (updatedRows.length > 0) {
          result = updatedRows[0] ?? null;
          return;
        }
        // 0 行：并发调用抢先选定。复读后调和——同 optionKey 视为幂等成功，不同则报"已选定"冲突。
        const rereadRows = await tx
          .select()
          .from(mergeProposals)
          .where(eq(mergeProposals.id, input.mergeProposalId))
          .limit(1);
        const reread = rereadRows[0];
        if (reread?.chosenOptionKey === input.optionKey) {
          result = reread;
          return;
        }
        throw new ProposalRepositoryMergeProposalAlreadyChosenError(
          input.mergeProposalId,
          reread?.chosenOptionKey ?? "unknown"
        );
      });
      return result;
    },

    async applyMergeProposalCandidate(input) {
      const at = input.at ?? new Date();
      const mergeSnapshotId = input.mergeSnapshotId ?? randomUUID();
      let found = false;
      let proposalId: string | null = null;
      await db.transaction(async (tx) => {
        const rows = await tx
          .select({
            mergeProposal: mergeProposals,
            mergeAttempt: mergeAttempts,
            proposalId: proposals.id,
            proposalStatus: proposals.status,
            proposalTitle: proposals.title,
            workItemId: proposals.workItemId,
            branchId: proposals.branchId,
            diffManifest: proposals.diffManifest,
            workItemCode: workItems.code,
            projectId: workItems.projectId,
            submitterUserId: workItems.submitterUserId
          })
          .from(mergeProposals)
          .innerJoin(mergeAttempts, eq(mergeProposals.mergeAttemptId, mergeAttempts.id))
          .innerJoin(proposals, eq(mergeAttempts.proposalId, proposals.id))
          .innerJoin(workItems, eq(proposals.workItemId, workItems.id))
          .where(eq(mergeProposals.id, input.mergeProposalId))
          .limit(1);
        const row = rows[0];
        if (!row) {
          return;
        }
        found = true;
        proposalId = row.proposalId;
        // H2/H5：AI 融合稿写回是对同一 targetKey 的完整采纳，必须和 merge() 一样上同项目 advisory lock
        // 并锁内复读状态，否则并发/与 merge 交错会丢更新或重复采纳。
        if (row.projectId) {
          await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`project-merge:${row.projectId}`})::bigint)`);
        }
        const lockedStatus = (await tx
          .select({ status: proposals.status })
          .from(proposals)
          .where(eq(proposals.id, row.proposalId))
          .limit(1))[0]?.status;
        if (lockedStatus === "merged") {
          throw new ProposalRepositoryUnsupportedMergeProposalApplyError(
            input.mergeProposalId,
            "proposal_already_merged",
            "Proposal is already merged"
          );
        }
        if (lockedStatus !== "reviewed") {
          throw new ProposalRepositoryUnsupportedMergeProposalApplyError(
            input.mergeProposalId,
            "proposal_not_reviewed",
            "Proposal must be reviewed before applying a merge candidate"
          );
        }
        if (row.mergeProposal.chosenOptionKey && row.mergeProposal.chosenOptionKey !== "ai_fusion") {
          throw new ProposalRepositoryUnsupportedMergeProposalApplyError(
            input.mergeProposalId,
            "merge_proposal_apply_requires_ai_fusion",
            "Only ai_fusion candidates can be applied through this route"
          );
        }
        const candidate = mergeProposalCandidateByOption(row.mergeProposal, "ai_fusion");
        if (!candidate?.merged_value) {
          throw new ProposalRepositoryUnsupportedMergeProposalApplyError(
            input.mergeProposalId,
            "merge_candidate_missing_result",
            "Chosen merge candidate does not contain a merged value"
          );
        }
        if (candidate.target_kind === "folder") {
          throw new ProposalRepositoryUnsupportedMergeProposalApplyError(
            input.mergeProposalId,
            "merge_candidate_target_unsupported",
            "Folder merge candidates cannot be applied as AI fusion artifacts"
          );
        }
        const resolvedStructuredPatch = input.resolvedStructuredFieldPatch;
        const resolvedFile = input.resolvedDriveFile;
        const resolvedTextHunkPatch = input.resolvedTextHunkPatch;
        if (candidate.target_kind === "structured_record") {
          if (!resolvedStructuredPatch) {
            throw new ProposalRepositoryUnsupportedMergeProposalApplyError(
              input.mergeProposalId,
              "structured_field_patch_missing",
              "Structured record apply requires a structured field patch"
            );
          }
        } else if (!resolvedFile) {
          throw new ProposalRepositoryUnsupportedMergeProposalApplyError(
            input.mergeProposalId,
            "merge_candidate_artifact_missing",
            "AI fusion apply requires a materialized artifact"
          );
        }
        const conflict = conflictByKey(row.mergeAttempt, row.mergeProposal.conflictKey);
        if (!conflict) {
          throw new ProposalRepositoryUnsupportedMergeProposalApplyError(
            input.mergeProposalId,
            "merge_conflict_context_missing",
            "Merge proposal conflict context is missing"
          );
        }
        if (!row.mergeProposal.chosenOptionKey) {
          await tx
            .update(mergeProposals)
            .set({
              chosenOptionKey: "ai_fusion",
              ...(input.actor?.actorUserId ? { chosenByUserId: input.actor.actorUserId } : {}),
              chosenAt: at,
              updatedAt: at
            })
            .where(eq(mergeProposals.id, input.mergeProposalId));
        }
        const sourceChange = changeForConflict(row.diffManifest, conflict);
        if (!sourceChange) {
          throw new ProposalRepositoryUnsupportedMergeProposalApplyError(
            input.mergeProposalId,
            "merge_conflict_change_missing",
            "Merge proposal source change is missing"
          );
        }
        if (candidate.target_kind === "structured_record" && resolvedStructuredPatch) {
          const fieldChanges = await applyStructuredWorkItemFieldPatch(tx, {
            mergeProposalId: input.mergeProposalId,
            workItemId: row.workItemId,
            branchId: row.branchId,
            patch: resolvedStructuredPatch,
            actorUserId: input.actor?.actorUserId ?? row.submitterUserId,
            at
          });
          await tx.insert(snapshots).values({
            id: mergeSnapshotId,
            workItemId: row.workItemId,
            branchId: row.branchId,
            kind: "merge",
            ref: `merge-proposal:${input.mergeProposalId}:structured_field_patch`,
            createdByKind: input.actor?.actorKind ?? "system",
            createdAt: at
          });
          const mergeAttemptId = await recordMergeAttempt(tx, {
            proposalId: row.proposalId,
            workItemId: row.workItemId,
            branchId: row.branchId,
            ...(input.actor ? { actor: input.actor } : {}),
            result: "merged",
            mergeSnapshotId,
            conflicts: [conflict],
            acceptedTargetKeys: [row.mergeProposal.conflictKey],
            targetKeys: [row.mergeProposal.conflictKey],
            at
          });
          await tx.insert(mergeProposals).values({
            id: randomUUID(),
            mergeAttemptId,
            conflictKey: row.mergeProposal.conflictKey,
            candidatesJson: row.mergeProposal.candidatesJson,
            recommendedOptionKey: row.mergeProposal.recommendedOptionKey ?? "ai_fusion",
            chosenOptionKey: "ai_fusion",
            chosenByUserId: input.actor?.actorUserId ?? row.mergeProposal.chosenByUserId,
            chosenAt: at,
            createdAt: at,
            updatedAt: at
          });
          await tx
            .update(proposals)
            .set({
              status: "merged",
              mergeSnapshotId,
              mergedAt: at,
              updatedAt: at
            })
            .where(eq(proposals.id, row.proposalId));
          await tx
            .update(branches)
            .set({
              status: "merged",
              headRef: mergeSnapshotId,
              version: sql`${branches.version} + 1`,
              updatedAt: at
            })
            .where(eq(branches.id, row.branchId));
          await tx.insert(auditLogs).values({
            id: randomUUID(),
            actorKind: input.actor?.actorKind ?? "system",
            ...(input.actor?.actorUserId ? { actorUserId: input.actor.actorUserId } : {}),
            entityType: "proposal",
            entityId: row.proposalId,
            action: "proposal.merged",
            detailJson: {
              work_item_id: row.workItemId,
              branch_id: row.branchId,
              merge_strategy: "field_merge",
              merge_proposal_id: input.mergeProposalId,
              chosen_option_key: "ai_fusion",
              merge_snapshot_id: mergeSnapshotId,
              merge_attempt_id: mergeAttemptId,
              structured_field_patch: resolvedStructuredPatch.dryRun.patch,
              structured_field_patch_dry_run: resolvedStructuredPatch.dryRun,
              structured_field_changes: fieldChanges,
              structured_field_count: fieldChanges.length,
              accepted_change_ids: [],
              accepted_change_count: 0,
              adopted_drive_version_ids: [],
              adopted_drive_version_count: 0,
              conflict_checked: true,
              conflict_count: 1,
              accepted_incoming_target_keys: [],
              resolved_conflict_target_keys: [row.mergeProposal.conflictKey],
              target_keys: [row.mergeProposal.conflictKey]
            },
            snapshotId: mergeSnapshotId,
            createdAt: at
          });
          return;
        }
        if (!resolvedFile) {
          throw new ProposalRepositoryUnsupportedMergeProposalApplyError(
            input.mergeProposalId,
            "merge_candidate_artifact_missing",
            "AI fusion apply requires a materialized artifact"
          );
        }
        const resolvedChange = aiFusionResolvedChange({
          sourceChange,
          conflict,
          candidate,
          changeId: resolvedFile.changeId,
          ...(resolvedFile.sha256 ? { sha256After: resolvedFile.sha256 } : {}),
          mergeProposalId: input.mergeProposalId
        });
        const current = await readCurrentAccepted(tx, {
          projectId: row.projectId,
          workItemId: row.workItemId,
          targetKey: row.mergeProposal.conflictKey
        });
        const driveAdoption = await adoptDriveFileVersion(tx, {
          projectId: row.projectId,
          actorUserId: input.actor?.actorUserId ?? row.submitterUserId,
          workItemCode: row.workItemCode,
          change: resolvedChange,
          file: resolvedFile,
          at
        });
        await tx.insert(snapshots).values({
          id: mergeSnapshotId,
          workItemId: row.workItemId,
          branchId: row.branchId,
          kind: "merge",
          ref: resolvedTextHunkPatch
            ? `merge-proposal:${input.mergeProposalId}:text_hunk_overrides`
            : `merge-proposal:${input.mergeProposalId}:ai_fusion`,
          ...(resolvedFile.sha256 ? { contentSha256: resolvedFile.sha256 } : {}),
          createdByKind: input.actor?.actorKind ?? "system",
          createdAt: at
        });
        const mergeAttemptId = await recordMergeAttempt(tx, {
          proposalId: row.proposalId,
          workItemId: row.workItemId,
          branchId: row.branchId,
          ...(input.actor ? { actor: input.actor } : {}),
          result: "merged",
          mergeSnapshotId,
          conflicts: [conflict],
          acceptedTargetKeys: [row.mergeProposal.conflictKey],
          targetKeys: [row.mergeProposal.conflictKey],
          at
        });
        await tx.insert(mergeProposals).values({
          id: randomUUID(),
          mergeAttemptId,
          conflictKey: row.mergeProposal.conflictKey,
          candidatesJson: row.mergeProposal.candidatesJson,
          recommendedOptionKey: row.mergeProposal.recommendedOptionKey ?? "ai_fusion",
          chosenOptionKey: "ai_fusion",
          chosenByUserId: input.actor?.actorUserId ?? row.mergeProposal.chosenByUserId,
          chosenAt: at,
          createdAt: at,
          updatedAt: at
        });
        await tx
          .update(proposals)
          .set({
            status: "merged",
            mergeSnapshotId,
            mergedAt: at,
            updatedAt: at
          })
          .where(eq(proposals.id, row.proposalId));
        await tx
          .update(branches)
          .set({
            status: "merged",
            headRef: mergeSnapshotId,
            version: sql`${branches.version} + 1`,
            updatedAt: at
          })
          .where(eq(branches.id, row.branchId));
        await tx
          .update(workItems)
          .set({
            status: "merged",
            mainBranchId: row.branchId,
            acceptedAt: at,
            version: sql`${workItems.version} + 1`,
            updatedAt: at
          })
          .where(eq(workItems.id, row.workItemId));
        if (current) {
          const superseded = await tx
            .update(acceptedDeliverableChanges)
            .set({ supersededAt: at, updatedAt: at })
            .where(and(
              row.projectId
                ? eq(acceptedDeliverableChanges.projectId, row.projectId)
                : eq(acceptedDeliverableChanges.workItemId, row.workItemId),
              eq(acceptedDeliverableChanges.targetKey, row.mergeProposal.conflictKey),
              isNull(acceptedDeliverableChanges.supersededAt),
              ...(current.sha256After ? [eq(acceptedDeliverableChanges.sha256After, current.sha256After)] : [])
            ))
            .returning({ id: acceptedDeliverableChanges.id });
          // H2/H5 L3：提交前复检，0 行作废即中止采纳（最后防线，避免盖掉别人内容）。
          if (superseded.length === 0) {
            throw new ProposalRepositoryStaleBaseError(row.mergeProposal.conflictKey);
          }
        }
        const acceptedChangeId = randomUUID();
        await tx.insert(acceptedDeliverableChanges).values({
          id: acceptedChangeId,
          workItemId: row.workItemId,
          ...(row.projectId ? { projectId: row.projectId } : {}),
          proposalId: row.proposalId,
          branchId: row.branchId,
          changeId: resolvedChange.id,
          targetKind: resolvedChange.target_kind,
          targetEntityType: resolvedChange.target_ref.entity_type,
          ...(resolvedChange.target_ref.entity_id ? { targetEntityId: resolvedChange.target_ref.entity_id } : {}),
          ...(resolvedChange.target_ref.path ? { targetPath: resolvedChange.target_ref.path } : {}),
          targetKey: row.mergeProposal.conflictKey,
          changeType: resolvedChange.change_type,
          acceptedVersion: (current?.acceptedVersion ?? 0) + 1,
          ...(baseVersionRef(resolvedChange) ? { baseVersionRef: baseVersionRef(resolvedChange) } : {}),
          acceptedRef: acceptedRef(resolvedChange),
          driveItemId: driveAdoption.driveItemId,
          driveVersionId: driveAdoption.driveVersionId,
          ...(resolvedChange.target_ref.sha256_before ? { sha256Before: resolvedChange.target_ref.sha256_before } : {}),
          ...(resolvedChange.target_ref.sha256_after ? { sha256After: resolvedChange.target_ref.sha256_after } : {}),
          ...(resolvedChange.preview_ref ? { previewRefJson: resolvedChange.preview_ref } : {}),
          manifestChangeJson: resolvedChange,
          createdAt: at,
          updatedAt: at
        });
        await tx.insert(auditLogs).values({
          id: randomUUID(),
          actorKind: input.actor?.actorKind ?? "system",
          ...(input.actor?.actorUserId ? { actorUserId: input.actor.actorUserId } : {}),
          entityType: "proposal",
          entityId: row.proposalId,
          action: "proposal.merged",
          detailJson: {
            work_item_id: row.workItemId,
            branch_id: row.branchId,
            merge_strategy: "ai_resolved",
            merge_proposal_id: input.mergeProposalId,
            chosen_option_key: "ai_fusion",
            merge_snapshot_id: mergeSnapshotId,
            merge_attempt_id: mergeAttemptId,
            accepted_change_ids: [acceptedChangeId],
            accepted_change_count: 1,
            adopted_drive_version_ids: [driveAdoption.driveVersionId],
            adopted_drive_version_count: 1,
            conflict_checked: true,
            conflict_count: 1,
            accepted_incoming_target_keys: [],
            resolved_conflict_target_keys: [row.mergeProposal.conflictKey],
            target_keys: [row.mergeProposal.conflictKey],
            ...(resolvedTextHunkPatch
              ? {
                  text_hunk_overrides: resolvedTextHunkPatch.overrides,
                  text_hunk_decisions: resolvedTextHunkPatch.decisions,
                  text_hunk_conflict_ranges: resolvedTextHunkPatch.conflictRanges,
                  text_hunk_count: resolvedTextHunkPatch.decisions.length,
                  text_hunk_base_sha256: resolvedTextHunkPatch.baseSha256,
                  text_hunk_current_sha256: resolvedTextHunkPatch.currentSha256,
                  text_hunk_incoming_sha256: resolvedTextHunkPatch.incomingSha256,
                  text_hunk_output_sha256: resolvedTextHunkPatch.outputSha256
                }
              : {})
          },
          snapshotId: mergeSnapshotId,
          createdAt: at
        });
      });
      if (!found || !proposalId) {
        return null;
      }
      return readStoredProposal(db, proposalId);
    },

    async review(input) {
      const at = input.at ?? new Date();
      let found = false;
      await db.transaction(async (tx) => {
        const proposalRows = await tx
          .select({
            branchId: proposals.branchId,
            status: proposals.status,
            projectId: workItems.projectId
          })
          .from(proposals)
          .innerJoin(workItems, eq(proposals.workItemId, workItems.id))
          .where(eq(proposals.id, input.proposalId))
          .limit(1);
        const proposal = proposalRows[0];
        if (!proposal) {
          return;
        }
        // 终态(merged/rejected)不可再被 review——否则迟到的 review 会把状态打回 reviewed/rejected、复活已合并的提议。
        if (proposal.status !== "opened" && proposal.status !== "reviewed") {
          return;
        }
        // 与 merge() 同 advisory lock 串行化，避免 review 与并发 merge 交错。
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`project-merge:${proposal.projectId}`})::bigint)`);
        // 锁内 CAS：仅当仍非终态才推进状态；0 行说明等锁期间被并发 merge/reject，放弃且不写 review（事务无副作用）。
        const updated = await tx
          .update(proposals)
          .set({
            status: input.decision === "approve" ? "reviewed" : "rejected",
            reviewedAt: at,
            updatedAt: at
          })
          .where(and(eq(proposals.id, input.proposalId), inArray(proposals.status, ["opened", "reviewed"])))
          .returning({ id: proposals.id });
        if (updated.length === 0) {
          return;
        }
        found = true;
        await tx.insert(reviews).values({
          id: randomUUID(),
          proposalId: input.proposalId,
          reviewerKind: input.actor.actorKind,
          reviewerUserId: input.actor.actorUserId,
          decision: input.decision,
          reasonMd: input.reasonMd,
          reasonFedBackAt: input.reasonFedBackAt,
          createdAt: at,
          updatedAt: at
        });
        if (input.decision === "reject") {
          await tx
            .update(branches)
            .set({
              status: "open",
              updatedAt: at
            })
            .where(eq(branches.id, proposal.branchId));
        }
      });
      if (!found) {
        return null;
      }
      return readStoredProposal(db, input.proposalId);
    },

    async merge(input) {
      const at = input.at ?? new Date();
      const mergeSnapshotId = input.mergeSnapshotId ?? randomUUID();
      let found = false;
      let blockedConflicts: ProposalMergeConflict[] = [];
      await db.transaction(async (tx) => {
        const proposalRows = await tx
          .select({
            workItemId: proposals.workItemId,
            title: proposals.title,
            workItemCode: workItems.code,
            projectId: workItems.projectId,
            submitterUserId: workItems.submitterUserId,
            branchId: proposals.branchId,
            // P-COLLAB：本分支有无 base 快照,决定撞上最后防线时是"可对底稿(rebase)"还是裸 stale_base。
            baseSnapshotId: branches.baseSnapshotId,
            status: proposals.status,
            diffManifest: proposals.diffManifest
          })
          .from(proposals)
          .innerJoin(workItems, eq(proposals.workItemId, workItems.id))
          .innerJoin(branches, eq(proposals.branchId, branches.id))
          .where(eq(proposals.id, input.proposalId))
          .limit(1);
        const proposal = proposalRows[0];
        if (!proposal) {
          return;
        }
        found = true;
        // P-COLLAB L2：同项目采纳串行化。事务级 advisory lock 随提交/回滚自动释放，
        // 消除"两个并发采纳同时读到 reviewed 再同时进事务"的竞态——不丢更新的序列化地基。
        if (proposal.projectId) {
          await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`project-merge:${proposal.projectId}`})::bigint)`);
        }
        // H14：锁内复读 proposal.status（select 在加锁前、可能已被并发采纳改成 merged）。
        // 非 reviewed 即提前返回——found 已 true，merge() 会回读当前态幂等返回已合并结果，
        // 避免对同一已合并提议重复采纳（重复 accepted_deliverable_changes / 快照）。
        const lockedRows = await tx
          .select({ status: proposals.status })
          .from(proposals)
          .where(eq(proposals.id, input.proposalId))
          .limit(1);
        if (lockedRows[0]?.status !== "reviewed") {
          return;
        }
        const acceptedIncomingTargetKeyList = [...new Set(input.acceptIncomingTargetKeys ?? [])];
        const acceptIncomingTargetKeys = new Set(acceptedIncomingTargetKeyList);
        const targetKeys = proposal.diffManifest.changes.map(targetKey);
        const currentByTargetKey = new Map<string, AcceptedDeliverableChangeRow | null>();
        const conflicts: ProposalMergeConflict[] = [];
        const resolvedConflicts: ProposalMergeConflict[] = [];
        for (const change of proposal.diffManifest.changes) {
          const key = targetKey(change);
          const current = await readCurrentAccepted(tx, { projectId: proposal.projectId, workItemId: proposal.workItemId, targetKey: key });
          currentByTargetKey.set(key, current);
          if (current) {
            const conflict = conflictsWithCurrentAccepted({
              proposalId: input.proposalId,
              workItemId: proposal.workItemId,
              proposalTitle: proposal.title,
              change,
              targetKey: key,
              current
            });
            if (conflict) {
              if (acceptIncomingTargetKeys.has(conflict.target_key)) {
                resolvedConflicts.push(conflict);
              } else {
                conflicts.push(conflict);
              }
            }
          }
        }
        if (conflicts.length > 0) {
          blockedConflicts = conflicts;
          const mergeAttemptId = await recordMergeAttempt(tx, {
            proposalId: input.proposalId,
            workItemId: proposal.workItemId,
            branchId: proposal.branchId,
            ...(input.actor ? { actor: input.actor } : {}),
            result: "conflict",
            conflicts,
            acceptedTargetKeys: acceptedIncomingTargetKeyList,
            targetKeys,
            at
          });
          await recordMergeProposals(tx, {
            mergeAttemptId,
            conflicts,
            acceptedTargetKeys: acceptedIncomingTargetKeyList,
            ...(input.candidateSupplements ? { candidateSupplements: input.candidateSupplements } : {}),
            ...(input.actor ? { actor: input.actor } : {}),
            at
          });
          if (input.bulkAction) {
            await recordBulkActionAudit(tx, {
              proposalId: input.proposalId,
              workItemId: proposal.workItemId,
              branchId: proposal.branchId,
              ...(input.actor ? { actor: input.actor } : {}),
              bulkAction: input.bulkAction,
              result: "conflict",
              mergeAttemptId,
              acceptedIncomingTargetKeys: acceptedIncomingTargetKeyList,
              resolvedConflictTargetKeys: resolvedConflicts.map((conflict) => conflict.target_key),
              blockedTargetKeys: conflicts.map((conflict) => conflict.target_key),
              targetKeys,
              at
            });
          }
          return;
        }
        const adoptedFilesByChangeId = new Map(
          (input.adoptedDriveFiles ?? []).map((file) => [file.changeId, file] as const)
        );
        const driveAdoptionsByChangeId = new Map<string, { driveItemId: string; driveVersionId: string }>();
        const driveActorUserId = input.actor?.actorUserId ?? proposal.submitterUserId;
        for (const change of proposal.diffManifest.changes) {
          const file = adoptedFilesByChangeId.get(change.id);
          if (!file) {
            continue;
          }
          driveAdoptionsByChangeId.set(change.id, await adoptDriveFileVersion(tx, {
            projectId: proposal.projectId,
            actorUserId: driveActorUserId,
            workItemCode: proposal.workItemCode,
            change,
            file,
            at
          }));
        }
        const mergeContentSha = proposal.diffManifest.changes.find((change) => change.target_ref.sha256_after)
          ?.target_ref.sha256_after;
        await tx.insert(snapshots).values({
          id: mergeSnapshotId,
          workItemId: proposal.workItemId,
          branchId: proposal.branchId,
          kind: "merge",
          ref: `proposal:${input.proposalId}`,
          ...(mergeContentSha ? { contentSha256: mergeContentSha } : {}),
          createdByKind: input.actor?.actorKind ?? "system",
          createdAt: at
        });
        const mergeAttemptId = await recordMergeAttempt(tx, {
          proposalId: input.proposalId,
          workItemId: proposal.workItemId,
          branchId: proposal.branchId,
          ...(input.actor ? { actor: input.actor } : {}),
          result: "merged",
          mergeSnapshotId,
          conflicts: resolvedConflicts,
          acceptedTargetKeys: acceptedIncomingTargetKeyList,
          targetKeys,
          at
        });
        await recordMergeProposals(tx, {
          mergeAttemptId,
          conflicts: resolvedConflicts,
          acceptedTargetKeys: acceptedIncomingTargetKeyList,
          ...(input.candidateSupplements ? { candidateSupplements: input.candidateSupplements } : {}),
          ...(input.actor ? { actor: input.actor } : {}),
          at
        });
        if (input.bulkAction) {
          await recordBulkActionAudit(tx, {
            proposalId: input.proposalId,
            workItemId: proposal.workItemId,
            branchId: proposal.branchId,
            ...(input.actor ? { actor: input.actor } : {}),
            bulkAction: input.bulkAction,
            result: "merged",
            mergeAttemptId,
            acceptedIncomingTargetKeys: acceptedIncomingTargetKeyList,
            resolvedConflictTargetKeys: resolvedConflicts.map((conflict) => conflict.target_key),
            blockedTargetKeys: [],
            targetKeys,
            mergeSnapshotId,
            at
          });
        }
        await tx
          .update(proposals)
          .set({
            status: "merged",
            mergeSnapshotId,
            mergedAt: at,
            updatedAt: at
          })
          .where(eq(proposals.id, input.proposalId));
        await tx
          .update(branches)
          .set({
            status: "merged",
            headRef: mergeSnapshotId,
            version: sql`${branches.version} + 1`,
            updatedAt: at
          })
          .where(eq(branches.id, proposal.branchId));
        await tx
          .update(workItems)
          .set({
            status: "merged",
            mainBranchId: proposal.branchId,
            acceptedAt: at,
            version: sql`${workItems.version} + 1`,
            updatedAt: at
          })
          .where(eq(workItems.id, proposal.workItemId));
        const acceptedRows: string[] = [];
        for (const change of proposal.diffManifest.changes) {
          const key = targetKey(change);
          const current = currentByTargetKey.get(key) ?? null;
          if (current) {
            const superseded = await tx
              .update(acceptedDeliverableChanges)
              .set({ supersededAt: at, updatedAt: at })
              .where(and(
                proposal.projectId
                  ? eq(acceptedDeliverableChanges.projectId, proposal.projectId)
                  : eq(acceptedDeliverableChanges.workItemId, proposal.workItemId),
                eq(acceptedDeliverableChanges.targetKey, key),
                isNull(acceptedDeliverableChanges.supersededAt),
                ...(current.sha256After ? [eq(acceptedDeliverableChanges.sha256After, current.sha256After)] : [])
              ))
              .returning({ id: acceptedDeliverableChanges.id });
            // P-COLLAB L3：提交前复检。L2 advisory lock 下真相不应在事务内变；若一行都没作废，
            // 说明读到的当前态已被改（最后防线），中止整笔采纳，绝不脏写盖掉别人内容。
            // 本分支有 base 快照(可三方合并)→ 抛 rebase_required,让上层走"对一下底稿再采纳";否则裸 stale_base。
            if (superseded.length === 0) {
              throw proposal.baseSnapshotId
                ? new ProposalRepositoryRebaseRequiredError([key])
                : new ProposalRepositoryStaleBaseError(key);
            }
          }
          const acceptedChangeId = randomUUID();
          acceptedRows.push(acceptedChangeId);
          const driveAdoption = driveAdoptionsByChangeId.get(change.id);
          await tx.insert(acceptedDeliverableChanges).values({
            id: acceptedChangeId,
            workItemId: proposal.workItemId,
            ...(proposal.projectId ? { projectId: proposal.projectId } : {}),
            proposalId: input.proposalId,
            branchId: proposal.branchId,
            changeId: change.id,
            targetKind: change.target_kind,
            targetEntityType: change.target_ref.entity_type,
            ...(change.target_ref.entity_id ? { targetEntityId: change.target_ref.entity_id } : {}),
            ...(change.target_ref.path ? { targetPath: change.target_ref.path } : {}),
            targetKey: key,
            changeType: change.change_type,
            acceptedVersion: (current?.acceptedVersion ?? 0) + 1,
            ...(baseVersionRef(change) ? { baseVersionRef: baseVersionRef(change) } : {}),
            acceptedRef: acceptedRef(change),
            ...(driveAdoption ? { driveItemId: driveAdoption.driveItemId } : {}),
            ...(driveAdoption ? { driveVersionId: driveAdoption.driveVersionId } : {}),
            ...(change.target_ref.sha256_before ? { sha256Before: change.target_ref.sha256_before } : {}),
            ...(change.target_ref.sha256_after ? { sha256After: change.target_ref.sha256_after } : {}),
            ...(change.preview_ref ? { previewRefJson: change.preview_ref } : {}),
            manifestChangeJson: change,
            createdAt: at,
            updatedAt: at
          });
        }
        await tx.insert(auditLogs).values({
          id: randomUUID(),
          actorKind: input.actor?.actorKind ?? "system",
          ...(input.actor?.actorUserId ? { actorUserId: input.actor.actorUserId } : {}),
          entityType: "proposal",
          entityId: input.proposalId,
          action: "proposal.merged",
          detailJson: {
            work_item_id: proposal.workItemId,
            branch_id: proposal.branchId,
            merge_snapshot_id: mergeSnapshotId,
            merge_attempt_id: mergeAttemptId,
            accepted_change_ids: acceptedRows,
            accepted_change_count: acceptedRows.length,
            adopted_drive_version_ids: [...driveAdoptionsByChangeId.values()].map((adoption) => adoption.driveVersionId),
            adopted_drive_version_count: driveAdoptionsByChangeId.size,
            conflict_checked: true,
            conflict_count: resolvedConflicts.length,
            accepted_incoming_target_keys: acceptedIncomingTargetKeyList,
            resolved_conflict_target_keys: resolvedConflicts.map((conflict) => conflict.target_key),
            target_keys: targetKeys,
            ...bulkActionAuditPayload(input)
          },
          snapshotId: mergeSnapshotId,
          createdAt: at
        });
      });
      if (blockedConflicts.length > 0) {
        throw new ProposalRepositoryMergeConflictError(blockedConflicts);
      }
      if (!found) {
        return null;
      }
      return readStoredProposal(db, input.proposalId);
    },
    // P-COLLAB rebase「对一下底稿再采纳」：对着最新正式版重算冲突并落候选,供既有三选项解决,
    // 然后让用户重新采纳。**绝不动账本**——不 supersede、不 insert accepted_deliverable_changes、不改状态,
    // 真正的提交仍由随后那次带 L2+L3 守卫的 merge 完成。这样 rebase 撞上并发也不会双写。
    async rebase(input) {
      const at = input.at ?? new Date();
      let found = false;
      let detected: ProposalMergeConflict[] = [];
      await db.transaction(async (tx) => {
        const proposalRows = await tx
          .select({
            workItemId: proposals.workItemId,
            title: proposals.title,
            projectId: workItems.projectId,
            branchId: proposals.branchId,
            status: proposals.status,
            diffManifest: proposals.diffManifest
          })
          .from(proposals)
          .innerJoin(workItems, eq(proposals.workItemId, workItems.id))
          .where(eq(proposals.id, input.proposalId))
          .limit(1);
        const proposal = proposalRows[0];
        if (!proposal) {
          return;
        }
        found = true;
        // 与 merge 同把 L2 串行化锁,锁内复读状态：已合并/非 reviewed 则无需对底稿,返回空冲突。
        if (proposal.projectId) {
          await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`project-merge:${proposal.projectId}`})::bigint)`);
        }
        const lockedRows = await tx
          .select({ status: proposals.status })
          .from(proposals)
          .where(eq(proposals.id, input.proposalId))
          .limit(1);
        if (lockedRows[0]?.status !== "reviewed") {
          return;
        }
        const targetKeys = proposal.diffManifest.changes.map(targetKey);
        const conflicts: ProposalMergeConflict[] = [];
        for (const change of proposal.diffManifest.changes) {
          const key = targetKey(change);
          const current = await readCurrentAccepted(tx, {
            projectId: proposal.projectId,
            workItemId: proposal.workItemId,
            targetKey: key
          });
          if (current) {
            const conflict = conflictsWithCurrentAccepted({
              proposalId: input.proposalId,
              workItemId: proposal.workItemId,
              proposalTitle: proposal.title,
              change,
              targetKey: key,
              current
            });
            if (conflict) {
              conflicts.push(conflict);
            }
          }
        }
        detected = conflicts;
        const mergeAttemptId = await recordMergeAttempt(tx, {
          proposalId: input.proposalId,
          workItemId: proposal.workItemId,
          branchId: proposal.branchId,
          ...(input.actor ? { actor: input.actor } : {}),
          result: "rebased",
          conflicts,
          acceptedTargetKeys: [],
          targetKeys,
          at
        });
        if (conflicts.length > 0) {
          await recordMergeProposals(tx, {
            mergeAttemptId,
            conflicts,
            acceptedTargetKeys: [],
            ...(input.candidateSupplements ? { candidateSupplements: input.candidateSupplements } : {}),
            ...(input.actor ? { actor: input.actor } : {}),
            at
          });
        }
      });
      if (!found) {
        return null;
      }
      return detected;
    }
  };
}
