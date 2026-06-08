import { randomUUID } from "node:crypto";

import {
  deliverableChangeManifestSchema,
  proposalSchema,
  reviewSchema,
  type DeliverableChangeManifest,
  type Proposal,
  type Review
} from "@workhub/contracts";
import {
  createDatabaseClient,
  createProposalRepository,
  type ProposalRepository,
  type StoredProposalRows,
  type WorkHubDatabaseClient
} from "@workhub/db";

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

function iso(value: Date | string | null | undefined) {
  if (!value) {
    return undefined;
  }
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function actorToRepository(actor: ProposalActor) {
  return {
    actorKind: actor.actor_kind,
    ...(actor.actor_user_id ? { actorUserId: actor.actor_user_id } : {})
  };
}

function storedRowsToProposal(rows: StoredProposalRows): StoredProposal {
  const proposal = proposalSchema.parse({
    id: rows.proposal.id,
    work_item_id: rows.proposal.workItemId,
    branch_id: rows.proposal.branchId,
    round: rows.proposal.round,
    title: rows.proposal.title,
    status: rows.proposal.status,
    diff_manifest: rows.proposal.diffManifest,
    ...(rows.proposal.confidenceId ? { confidence_id: rows.proposal.confidenceId } : {}),
    ...(rows.proposal.mergeSnapshotId ? { merge_snapshot_id: rows.proposal.mergeSnapshotId } : {}),
    opened_by_kind: rows.proposal.openedByKind,
    ...(rows.proposal.openedByUserId ? { opened_by_user_id: rows.proposal.openedByUserId } : {}),
    ...(iso(rows.proposal.reviewedAt) ? { reviewed_at: iso(rows.proposal.reviewedAt) } : {}),
    ...(iso(rows.proposal.mergedAt) ? { merged_at: iso(rows.proposal.mergedAt) } : {}),
    created_at: iso(rows.proposal.createdAt),
    updated_at: iso(rows.proposal.updatedAt)
  });
  return {
    ...proposal,
    reviews: rows.reviews.map((row) => reviewSchema.parse({
      id: row.id,
      proposal_id: row.proposalId,
      reviewer_kind: row.reviewerKind,
      ...(row.reviewerUserId ? { reviewer_user_id: row.reviewerUserId } : {}),
      decision: row.decision,
      ...(row.reasonMd ? { reason_md: row.reasonMd } : {}),
      ...(iso(row.reasonFedBackAt) ? { reason_fed_back_at: iso(row.reasonFedBackAt) } : {}),
      created_at: iso(row.createdAt),
      updated_at: iso(row.updatedAt)
    }))
  };
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

export function createDbProposalService(repository: ProposalRepository, options: {
  now?: () => Date;
  id?: () => string;
} = {}): ProposalService {
  const now = options.now ?? (() => new Date());
  const nextId = options.id ?? randomUUID;

  async function requireProposal(proposalId: string) {
    const rows = await repository.findById(proposalId);
    if (!rows) {
      throw new ProposalServiceError(404, "not_found", "没有找到这个变更申请。");
    }
    return storedRowsToProposal(rows);
  }

  return {
    async createFromManifest(input) {
      if (input.manifest.work_item_id !== input.workItemId) {
        throw new ProposalServiceError(422, "manifest_workitem_mismatch", "变更申请与事项不匹配。");
      }

      const at = now();
      const createdAt = at.toISOString();
      const proposalId = input.manifest.proposal_id ?? nextId();
      if (await repository.findById(proposalId)) {
        throw new ProposalServiceError(409, "proposal_already_exists", "这份变更申请已经存在。");
      }
      const branchId = input.branchId ?? input.manifest.branch_id ?? nextId();
      const manifest = cloneManifestWithIds({
        manifest: input.manifest,
        proposalId,
        branchId,
        workItemId: input.workItemId,
        createdAt
      });
      const rows = await repository.createFromManifest({
        proposalId,
        branchId,
        workItemId: input.workItemId,
        manifest,
        actor: actorToRepository(input.actor),
        title: input.title ?? manifest.title,
        at
      });
      return storedRowsToProposal(rows);
    },

    async get(proposalId) {
      const rows = await repository.findById(proposalId);
      return rows ? storedRowsToProposal(rows) : null;
    },

    async listByWorkItem(workItemId) {
      const rows = await repository.listByWorkItem(workItemId);
      return rows.map(storedRowsToProposal);
    },

    async review(input) {
      const proposal = await requireProposal(input.proposalId);
      if (proposal.status === "merged") {
        throw new ProposalServiceError(409, "proposal_already_merged", "这份变更申请已经被采纳。");
      }

      const at = now();
      const rows = await repository.review({
        proposalId: input.proposalId,
        actor: actorToRepository(input.actor),
        decision: input.decision === "approve" ? "approve" : "reject",
        ...(input.reasonMd ? { reasonMd: input.reasonMd, reasonFedBackAt: at } : {}),
        at
      });
      if (!rows) {
        throw new ProposalServiceError(404, "not_found", "没有找到这个变更申请。");
      }
      return storedRowsToProposal(rows);
    },

    async merge(input) {
      const proposal = await requireProposal(input.proposalId);
      if (proposal.status === "rejected") {
        throw new ProposalServiceError(409, "proposal_rejected", "这份变更申请已经被打回，不能采纳。");
      }
      if (proposal.status === "merged") {
        return proposal;
      }

      const rows = await repository.merge({
        proposalId: input.proposalId,
        mergeSnapshotId: nextId(),
        at: now()
      });
      if (!rows) {
        throw new ProposalServiceError(404, "not_found", "没有找到这个变更申请。");
      }
      return storedRowsToProposal(rows);
    }
  };
}

let defaultProposalService: ProposalService | undefined;
let defaultProposalDbClient: WorkHubDatabaseClient | undefined;

export function getDefaultProposalService() {
  if (!defaultProposalService) {
    defaultProposalDbClient = createDatabaseClient();
    defaultProposalService = createDbProposalService(createProposalRepository(defaultProposalDbClient.db));
  }
  return defaultProposalService;
}
