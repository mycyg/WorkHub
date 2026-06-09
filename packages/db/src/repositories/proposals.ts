import { randomUUID } from "node:crypto";

import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";

import type { ActorKind, DeliverableChange, DeliverableChangeManifest } from "@workhub/contracts";

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
  candidateSupplements?: MergeProposalCandidateSupplement[];
  at?: Date;
};

export type ProposalAdoptedDriveFileInput = {
  changeId: string;
  filename: string;
  storagePath: string;
  sizeBytes: number;
  sha256?: string;
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

export type ProposalRepository = {
  createFromManifest: (input: CreateProposalFromManifestInput) => Promise<StoredProposalRows>;
  findMergeContext: (proposalId: string) => Promise<ProposalMergeContext | null>;
  findById: (proposalId: string) => Promise<StoredProposalRows | null>;
  listByWorkItem: (workItemId: string) => Promise<StoredProposalRows[]>;
  listConflictsByWorkItem: (workItemId: string) => Promise<ProposalMergeConflict[]>;
  listMergeAttemptsByProposal: (proposalId: string) => Promise<MergeAttemptRow[]>;
  listMergeProposalsByAttempt: (mergeAttemptId: string) => Promise<MergeProposalRow[]>;
  chooseMergeProposalCandidate: (input: ChooseMergeProposalCandidateInput) => Promise<MergeProposalRow | null>;
  review: (input: ReviewProposalInput) => Promise<StoredProposalRows | null>;
  merge: (input: MergeProposalInput) => Promise<StoredProposalRows | null>;
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
  input: { workItemId: string; targetKey: string }
) {
  const rows = await tx
    .select()
    .from(acceptedDeliverableChanges)
    .where(and(
      eq(acceptedDeliverableChanges.workItemId, input.workItemId),
      eq(acceptedDeliverableChanges.targetKey, input.targetKey),
      isNull(acceptedDeliverableChanges.supersededAt)
    ))
    .orderBy(desc(acceptedDeliverableChanges.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

async function recordMergeAttempt(
  tx: WorkHubTx,
  input: {
    proposalId: string;
    workItemId: string;
    branchId: string;
    actor?: ProposalRepositoryActor;
    result: "conflict" | "merged" | "aborted" | "clean";
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
      const manifest: DeliverableChangeManifest = {
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
          round: 1,
          title: input.title ?? manifest.title,
          status: "opened",
          diffManifest: manifest,
          openedByKind: input.actor.actorKind,
          openedByUserId: input.actor.actorUserId,
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
          diffManifest: proposals.diffManifest
        })
        .from(proposals)
        .innerJoin(workItems, eq(proposals.workItemId, workItems.id))
        .innerJoin(branches, eq(proposals.branchId, branches.id))
        .leftJoin(agentRuns, eq(branches.agentRunId, agentRuns.id))
        .where(eq(proposals.id, proposalId))
        .limit(1);
      return rows[0] ?? null;
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

    async listConflictsByWorkItem(workItemId) {
      const conflicts: ProposalMergeConflict[] = [];
      await db.transaction(async (tx) => {
        const proposalRows = await tx
          .select({
            proposalId: proposals.id,
            workItemId: proposals.workItemId,
            title: proposals.title,
            diffManifest: proposals.diffManifest
          })
          .from(proposals)
          .where(and(
            eq(proposals.workItemId, workItemId),
            eq(proposals.status, "reviewed")
          ))
          .orderBy(desc(proposals.createdAt));
        for (const proposal of proposalRows) {
          for (const change of proposal.diffManifest.changes) {
            const key = targetKey(change);
            const current = await readCurrentAccepted(tx, {
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
        if (row.chosenOptionKey) {
          if (row.chosenOptionKey !== input.optionKey) {
            throw new ProposalRepositoryMergeProposalAlreadyChosenError(input.mergeProposalId, row.chosenOptionKey);
          }
          result = row;
          return;
        }
        await tx
          .update(mergeProposals)
          .set({
            chosenOptionKey: input.optionKey,
            ...(input.actor?.actorUserId ? { chosenByUserId: input.actor.actorUserId } : {}),
            chosenAt: at,
            updatedAt: at
          })
          .where(eq(mergeProposals.id, input.mergeProposalId));
        const updatedRows = await tx
          .select()
          .from(mergeProposals)
          .where(eq(mergeProposals.id, input.mergeProposalId))
          .limit(1);
        result = updatedRows[0] ?? null;
      });
      return result;
    },

    async review(input) {
      const at = input.at ?? new Date();
      let found = false;
      await db.transaction(async (tx) => {
        const proposalRows = await tx
          .select({
            branchId: proposals.branchId
          })
          .from(proposals)
          .where(eq(proposals.id, input.proposalId))
          .limit(1);
        const proposal = proposalRows[0];
        if (!proposal) {
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
        await tx
          .update(proposals)
          .set({
            status: input.decision === "approve" ? "reviewed" : "rejected",
            reviewedAt: at,
            updatedAt: at
          })
          .where(eq(proposals.id, input.proposalId));
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
        const acceptedIncomingTargetKeyList = [...new Set(input.acceptIncomingTargetKeys ?? [])];
        const acceptIncomingTargetKeys = new Set(acceptedIncomingTargetKeyList);
        const targetKeys = proposal.diffManifest.changes.map(targetKey);
        const currentByTargetKey = new Map<string, AcceptedDeliverableChangeRow | null>();
        const conflicts: ProposalMergeConflict[] = [];
        const resolvedConflicts: ProposalMergeConflict[] = [];
        for (const change of proposal.diffManifest.changes) {
          const key = targetKey(change);
          const current = await readCurrentAccepted(tx, { workItemId: proposal.workItemId, targetKey: key });
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
            await tx
              .update(acceptedDeliverableChanges)
              .set({ supersededAt: at, updatedAt: at })
              .where(and(
                eq(acceptedDeliverableChanges.workItemId, proposal.workItemId),
                eq(acceptedDeliverableChanges.targetKey, key),
                isNull(acceptedDeliverableChanges.supersededAt)
              ));
          }
          const acceptedChangeId = randomUUID();
          acceptedRows.push(acceptedChangeId);
          const driveAdoption = driveAdoptionsByChangeId.get(change.id);
          await tx.insert(acceptedDeliverableChanges).values({
            id: acceptedChangeId,
            workItemId: proposal.workItemId,
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
            target_keys: targetKeys
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
    }
  };
}
