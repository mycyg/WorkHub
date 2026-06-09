import { randomUUID } from "node:crypto";

import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";

import type { ActorKind, DeliverableChange, DeliverableChangeManifest } from "@workhub/contracts";

import type { WorkHubDb } from "../client.js";
import {
  acceptedDeliverableChanges,
  agentRuns,
  auditLogs,
  branches,
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

export class ProposalRepositoryMergeConflictError extends Error {
  public readonly code = "merge_conflict";

  constructor(public readonly conflicts: ProposalMergeConflict[]) {
    super("Proposal merge conflicts with accepted deliverables");
  }
}

export type ProposalRepository = {
  createFromManifest: (input: CreateProposalFromManifestInput) => Promise<StoredProposalRows>;
  findMergeContext: (proposalId: string) => Promise<ProposalMergeContext | null>;
  findById: (proposalId: string) => Promise<StoredProposalRows | null>;
  listByWorkItem: (workItemId: string) => Promise<StoredProposalRows[]>;
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
      await db.transaction(async (tx) => {
        const proposalRows = await tx
          .select({
            workItemId: proposals.workItemId,
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
        const currentByTargetKey = new Map<string, AcceptedDeliverableChangeRow | null>();
        const conflicts: ProposalMergeConflict[] = [];
        for (const change of proposal.diffManifest.changes) {
          const key = targetKey(change);
          const current = await readCurrentAccepted(tx, { workItemId: proposal.workItemId, targetKey: key });
          currentByTargetKey.set(key, current);
          if (current) {
            const conflict = conflictsWithCurrentAccepted({
              proposalId: input.proposalId,
              change,
              targetKey: key,
              current
            });
            if (conflict) {
              conflicts.push(conflict);
            }
          }
        }
        if (conflicts.length > 0) {
          throw new ProposalRepositoryMergeConflictError(conflicts);
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
            accepted_change_ids: acceptedRows,
            accepted_change_count: acceptedRows.length,
            adopted_drive_version_ids: [...driveAdoptionsByChangeId.values()].map((adoption) => adoption.driveVersionId),
            adopted_drive_version_count: driveAdoptionsByChangeId.size,
            conflict_checked: true,
            target_keys: proposal.diffManifest.changes.map(targetKey)
          },
          snapshotId: mergeSnapshotId,
          createdAt: at
        });
      });
      if (!found) {
        return null;
      }
      return readStoredProposal(db, input.proposalId);
    }
  };
}
