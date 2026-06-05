import { randomUUID } from "node:crypto";

import {
  deliverableChangeManifestSchema,
  proposalSchema,
  reviewSchema,
  type DeliverableChangeManifest,
  type Proposal,
  type Review
} from "@workhub/contracts";

export type ProposalActor = {
  actor_kind: "human" | "ai" | "system";
  actor_user_id?: string;
  label?: string;
};

export type StoredProposal = Proposal & {
  reviews: Review[];
};

export class ProposalServiceError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
  }
}

export type ProposalService = {
  createFromManifest: (input: {
    workItemId: string;
    manifest: DeliverableChangeManifest;
    actor: ProposalActor;
    title?: string;
    branchId?: string;
  }) => Promise<StoredProposal>;
  get: (proposalId: string) => Promise<StoredProposal | null>;
  listByWorkItem: (workItemId: string) => Promise<StoredProposal[]>;
  review: (input: {
    proposalId: string;
    actor: ProposalActor;
    decision: "approve" | "request_changes";
    reasonMd?: string;
  }) => Promise<StoredProposal>;
  merge: (input: {
    proposalId: string;
    actor: ProposalActor;
  }) => Promise<StoredProposal>;
};

function cloneManifestWithIds(input: {
  manifest: DeliverableChangeManifest;
  proposalId: string;
  branchId: string;
  workItemId: string;
  createdAt: string;
}) {
  const base: DeliverableChangeManifest["base"] = {
    ...input.manifest.base
  };
  if (!base.created_at) {
    base.created_at = input.createdAt;
  }

  return deliverableChangeManifestSchema.parse({
    ...input.manifest,
    proposal_id: input.proposalId,
    work_item_id: input.workItemId,
    branch_id: input.branchId,
    base
  });
}

export function createInMemoryProposalService(options: {
  now?: () => Date;
  id?: () => string;
} = {}): ProposalService {
  const now = options.now ?? (() => new Date());
  const nextId = options.id ?? randomUUID;
  const proposals = new Map<string, StoredProposal>();

  function requireProposal(proposalId: string) {
    const proposal = proposals.get(proposalId);
    if (!proposal) {
      throw new ProposalServiceError(404, "not_found", "没有找到这个变更申请。");
    }
    return proposal;
  }

  function save(proposal: StoredProposal) {
    proposals.set(proposal.id, proposal);
    return proposal;
  }

  return {
    async createFromManifest(input) {
      if (input.manifest.work_item_id !== input.workItemId) {
        throw new ProposalServiceError(422, "manifest_workitem_mismatch", "变更申请与事项不匹配。");
      }

      const at = now().toISOString();
      const proposalId = input.manifest.proposal_id ?? nextId();
      if (proposals.has(proposalId)) {
        throw new ProposalServiceError(409, "proposal_already_exists", "这份变更申请已经存在。");
      }
      const branchId = input.branchId ?? input.manifest.branch_id ?? nextId();
      const manifest = cloneManifestWithIds({
        manifest: input.manifest,
        proposalId,
        branchId,
        workItemId: input.workItemId,
        createdAt: at
      });

      const proposalBase = {
        id: proposalId,
        work_item_id: input.workItemId,
        branch_id: branchId,
        round: 1,
        title: input.title ?? manifest.title,
        status: "opened",
        diff_manifest: manifest,
        opened_by_kind: input.actor.actor_kind,
        ...(input.actor.actor_user_id ? { opened_by_user_id: input.actor.actor_user_id } : {}),
        created_at: at,
        updated_at: at
      };

      const proposal = proposalSchema.parse(proposalBase);
      return save({
        ...proposal,
        reviews: []
      });
    },

    async get(proposalId) {
      return proposals.get(proposalId) ?? null;
    },

    async listByWorkItem(workItemId) {
      return [...proposals.values()].filter((proposal) => proposal.work_item_id === workItemId);
    },

    async review(input) {
      const proposal = requireProposal(input.proposalId);
      if (proposal.status === "merged") {
        throw new ProposalServiceError(409, "proposal_already_merged", "这份变更申请已经被采纳。");
      }

      const at = now().toISOString();
      const reviewBase = {
        id: nextId(),
        proposal_id: proposal.id,
        reviewer_kind: input.actor.actor_kind,
        ...(input.actor.actor_user_id ? { reviewer_user_id: input.actor.actor_user_id } : {}),
        decision: input.decision === "approve" ? "approve" : "reject",
        ...(input.reasonMd ? { reason_md: input.reasonMd, reason_fed_back_at: at } : {}),
        created_at: at,
        updated_at: at
      };
      const review = reviewSchema.parse(reviewBase);
      const updated = proposalSchema.parse({
        ...proposal,
        status: input.decision === "approve" ? "reviewed" : "rejected",
        reviewed_at: at,
        updated_at: at
      });
      return save({
        ...updated,
        reviews: [...proposal.reviews, review]
      });
    },

    async merge(input) {
      const proposal = requireProposal(input.proposalId);
      if (proposal.status === "rejected") {
        throw new ProposalServiceError(409, "proposal_rejected", "这份变更申请已经被打回，不能采纳。");
      }
      if (proposal.status === "merged") {
        return proposal;
      }

      const at = now().toISOString();
      const updated = proposalSchema.parse({
        ...proposal,
        status: "merged",
        merge_snapshot_id: nextId(),
        merged_at: at,
        updated_at: at
      });
      return save({
        ...updated,
        reviews: proposal.reviews
      });
    }
  };
}

let defaultProposalService: ProposalService | undefined;

export function getDefaultProposalService() {
  defaultProposalService ??= createInMemoryProposalService();
  return defaultProposalService;
}
