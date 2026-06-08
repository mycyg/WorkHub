import { randomUUID } from "node:crypto";

import { asc, desc, eq } from "drizzle-orm";

import type { ActorKind, DeliverableChangeManifest } from "@workhub/contracts";

import type { WorkHubDb } from "../client.js";
import { branches, proposals, reviews } from "../schema/index.js";

export type BranchRow = typeof branches.$inferSelect;
export type ProposalRow = typeof proposals.$inferSelect;
export type ReviewRow = typeof reviews.$inferSelect;

export type StoredProposalRows = {
  proposal: ProposalRow;
  reviews: ReviewRow[];
};

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
  at?: Date;
};

export type ProposalRepository = {
  createFromManifest: (input: CreateProposalFromManifestInput) => Promise<StoredProposalRows>;
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
      await db.transaction(async (tx) => {
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
      });
      return readStoredProposal(db, input.proposalId);
    },

    async merge(input) {
      const at = input.at ?? new Date();
      const mergeSnapshotId = input.mergeSnapshotId ?? randomUUID();
      await db
        .update(proposals)
        .set({
          status: "merged",
          mergeSnapshotId,
          mergedAt: at,
          updatedAt: at
        })
        .where(eq(proposals.id, input.proposalId));
      return readStoredProposal(db, input.proposalId);
    }
  };
}
