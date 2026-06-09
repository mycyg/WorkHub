import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";

import {
  deliverableChangeManifestSchema,
  proposalConflictListResultSchema,
  proposalSchema,
  reviewSchema,
  type DeliverableChange,
  type DeliverableChangeManifest,
  type ProposalConflict,
  type ProposalConflictListResult,
  type Proposal,
  type Review
} from "@workhub/contracts";
import { settings as defaultSettings } from "@workhub/config";
import {
  createDatabaseClient,
  createProposalRepository,
  ProposalRepositoryMergeConflictError,
  type ProposalAdoptedDriveFileInput,
  type ProposalRepository,
  type StoredProposalRows,
  type WorkHubDatabaseClient
} from "@workhub/db";
import {
  createLlmMergeFusionCandidateGenerator,
  safelyGenerateMergeFusionCandidates,
  type MergeFusionCandidateGenerator
} from "./merge-fusion-candidates.js";

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

export class ProposalServiceMergeConflictError extends ProposalServiceError {
  constructor(public readonly conflicts: ProposalConflict[]) {
    super(409, "merge_conflict", "这份变更和正式版撞车，需要先选择处理方案。");
  }
}

export type ProposalConflictResolution = {
  acceptIncomingTargetKeys?: string[];
};

export type ProposalService = {
  createFromManifest: (input: {
    workItemId: string;
    manifest: DeliverableChangeManifest;
    actor: ProposalActor;
    title?: string;
    branchId?: string;
    agentRunId?: string;
  }) => Promise<StoredProposal>;
  get: (proposalId: string) => Promise<StoredProposal | null>;
  listByWorkItem: (workItemId: string) => Promise<StoredProposal[]>;
  listConflicts: (workItemId: string) => Promise<ProposalConflictListResult>;
  review: (input: {
    proposalId: string;
    actor: ProposalActor;
    decision: "approve" | "request_changes";
    reasonMd?: string;
  }) => Promise<StoredProposal>;
  merge: (input: {
    proposalId: string;
    actor: ProposalActor;
    conflictResolution?: ProposalConflictResolution;
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

function normalizeManifestPath(value: string) {
  return value.replace(/\\/gu, "/").replace(/\/{2,}/gu, "/").replace(/^\/+/u, "");
}

function assertInside(parent: string, child: string) {
  const relative = path.relative(parent, child);
  return relative.length === 0 || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function sourcePathForChange(workdirRef: string, change: DeliverableChange) {
  const relativePath = change.target_ref.path ? normalizeManifestPath(change.target_ref.path) : "";
  if (!relativePath) {
    throw new ProposalServiceError(409, "delivery_artifact_missing", "找不到这份交付文件，不能采纳到正式版。");
  }
  const root = path.resolve(workdirRef);
  const absolute = path.resolve(root, relativePath);
  if (!assertInside(root, absolute)) {
    throw new ProposalServiceError(409, "delivery_artifact_unsafe_path", "交付文件路径越界，不能采纳到正式版。");
  }
  return absolute;
}

function storagePathForChange(input: {
  storageRoot: string;
  projectId: string;
  workItemId: string;
  proposalId: string;
  change: DeliverableChange;
  filename: string;
}) {
  return path.join(
    input.storageRoot,
    input.projectId,
    input.workItemId,
    input.proposalId,
    input.change.id,
    input.filename
  );
}

function filenameForChange(change: DeliverableChange) {
  const normalized = change.target_ref.path ? normalizeManifestPath(change.target_ref.path) : change.id;
  const parsed = path.posix.basename(normalized);
  return parsed.length > 0 ? parsed : change.id;
}

function mimeForFilename(filename: string) {
  const ext = path.extname(filename).toLowerCase();
  const byExt: Record<string, string> = {
    ".csv": "text/csv",
    ".gif": "image/gif",
    ".html": "text/html",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".json": "application/json",
    ".md": "text/markdown",
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".txt": "text/plain",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".zip": "application/zip"
  };
  return byExt[ext];
}

async function sha256File(filePath: string) {
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return hash.digest("hex");
}

function shouldAdoptDriveFile(change: DeliverableChange) {
  return change.target_ref.entity_type === "delivery"
    && change.target_kind !== "folder"
    && change.change_type !== "deleted"
    && !!change.target_ref.path;
}

async function adoptDriveFilesForMerge(input: {
  repository: ProposalRepository;
  proposalId: string;
  storageRoot: string;
}) {
  const context = await input.repository.findMergeContext(input.proposalId);
  if (!context?.workdirRef) {
    return [];
  }

  const adopted: ProposalAdoptedDriveFileInput[] = [];
  for (const change of context.diffManifest.changes) {
    if (!shouldAdoptDriveFile(change)) {
      continue;
    }
    const sourcePath = sourcePathForChange(context.workdirRef, change);
    let sourceStat: Awaited<ReturnType<typeof stat>>;
    try {
      sourceStat = await stat(sourcePath);
    } catch {
      throw new ProposalServiceError(409, "delivery_artifact_missing", "找不到这份交付文件，不能采纳到正式版。");
    }
    if (!sourceStat.isFile()) {
      continue;
    }

    const sha256 = await sha256File(sourcePath);
    if (change.target_ref.sha256_after && change.target_ref.sha256_after !== sha256) {
      throw new ProposalServiceError(409, "delivery_artifact_changed", "交付文件内容和审查版本不一致，需要重新生成变更申请。");
    }

    const filename = filenameForChange(change);
    const storagePath = storagePathForChange({
      storageRoot: input.storageRoot,
      projectId: context.projectId,
      workItemId: context.workItemId,
      proposalId: context.proposalId,
      change,
      filename
    });
    const storageDir = path.dirname(storagePath);
    await mkdir(storageDir, { recursive: true });
    await copyFile(sourcePath, storagePath);
    const mime = mimeForFilename(filename);
    adopted.push({
      changeId: change.id,
      filename,
      storagePath,
      sizeBytes: sourceStat.size,
      sha256,
      ...(mime ? { mime } : {})
    });
  }
  return adopted;
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

function conflictToVm(conflict: {
  proposal_id: string;
  work_item_id: string;
  proposal_title: string;
  target_key: string;
  change_id: string;
  target_kind: string;
  change_type: string;
  existing_proposal_id: string;
  existing_change_id: string;
  target_path?: string;
  existing_sha256_after?: string;
  incoming_sha256_before?: string;
  incoming_sha256_after?: string;
  existing_ref?: string;
  incoming_version_before?: string;
}, options: {
  aiFusionRationale?: string;
} = {}): ProposalConflict {
  const targetLabel = conflict.target_path ? `「${conflict.target_path}」` : "这处改动";
  const conflictOptions: ProposalConflict["options"] = [
    {
      id: "keep_current",
      label: "保留正式版",
      summary_text: "不覆盖当前正式交付物，先回到变更申请看差异。",
      recommended: true,
      action: {
        id: "open_proposal",
        label: "查看变更申请",
        method: "GET",
        href: `/proposals/${conflict.proposal_id}`
      }
    },
    {
      id: "accept_incoming",
      label: "采纳这次版本",
      summary_text: "明确用这次变更覆盖当前正式版，并保留审计与还原入口。",
      action: {
        id: "accept_incoming",
        label: "采纳这次版本",
        method: "POST",
        href: `/api/proposals/${conflict.proposal_id}/merge`,
        request_json: {
          conflict_resolution: {
            accept_incoming_target_keys: [conflict.target_key]
          }
        }
      }
    }
  ];
  if (options.aiFusionRationale) {
    conflictOptions.push({
      id: "ai_fusion",
      label: "AI 融合建议",
      summary_text: options.aiFusionRationale,
      action: {
        id: "open_ai_fusion_candidate",
        label: "查看建议",
        method: "GET",
        href: `/proposals/${conflict.proposal_id}`
      }
    });
  }
  return {
    id: `${conflict.proposal_id}:${conflict.change_id}:${conflict.target_key}`,
    work_item_id: conflict.work_item_id,
    proposal_id: conflict.proposal_id,
    change_id: conflict.change_id,
    target_key: conflict.target_key,
    target_kind: conflict.target_kind,
    change_type: conflict.change_type,
    ...(conflict.target_path ? { target_path: conflict.target_path } : {}),
    headline: `${targetLabel}和正式版撞车了`,
    summary_text: "Cuu 先给两个安全选项：保留正式版，或明确采纳这次版本。AI 融合方案会在后续调解表落地后加入。",
    existing: {
      proposal_id: conflict.existing_proposal_id,
      change_id: conflict.existing_change_id,
      ...(conflict.existing_ref ? { ref: conflict.existing_ref } : {}),
      ...(conflict.existing_sha256_after ? { sha256: conflict.existing_sha256_after } : {})
    },
    incoming: {
      ...(conflict.incoming_version_before ? { ref: conflict.incoming_version_before } : {}),
      ...(conflict.incoming_sha256_before ? { sha256_before: conflict.incoming_sha256_before } : {}),
      ...(conflict.incoming_sha256_after ? { sha256_after: conflict.incoming_sha256_after } : {})
    },
    recommended_option_id: "keep_current",
    options: conflictOptions
  };
}

function aiFusionRationaleByConflictKey(
  supplements: Awaited<ReturnType<MergeFusionCandidateGenerator["generate"]>>
) {
  const byKey = new Map<string, string>();
  for (const supplement of supplements) {
    const candidate = supplement.candidates.find((item) => item.option_key === "ai_fusion");
    if (candidate?.rationale_md) {
      byKey.set(supplement.conflictKey, candidate.rationale_md);
    }
  }
  return byKey;
}

function conflictListResult(conflicts: ProposalConflict[]): ProposalConflictListResult {
  return proposalConflictListResultSchema.parse({
    conflicts,
    ...(conflicts.length === 0 ? { empty_state: "no_conflicts" } : {})
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

    async listConflicts() {
      return conflictListResult([]);
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
      if (proposal.status !== "reviewed") {
        throw new ProposalServiceError(409, "proposal_not_reviewed", "这份变更申请需要先确认，再采纳到正式版。");
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
  storageRoot?: string;
  fusionCandidateGenerator?: MergeFusionCandidateGenerator;
} = {}): ProposalService {
  const now = options.now ?? (() => new Date());
  const nextId = options.id ?? randomUUID;
  const storageRoot = options.storageRoot ?? path.join(defaultSettings.dataDir, "project-drive");
  const fusionCandidateGenerator = options.fusionCandidateGenerator ?? createLlmMergeFusionCandidateGenerator();

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
        ...(input.agentRunId ? { agentRunId: input.agentRunId } : {}),
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

    async listConflicts(workItemId) {
      return conflictListResult((await repository.listConflictsByWorkItem(workItemId)).map((conflict) => conflictToVm(conflict)));
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
      if (proposal.status !== "reviewed") {
        throw new ProposalServiceError(409, "proposal_not_reviewed", "这份变更申请需要先确认，再采纳到正式版。");
      }

      let rows: StoredProposalRows | null;
      const mergedAt = now();
      const mergeConflicts = (await repository.listConflictsByWorkItem(proposal.work_item_id))
        .filter((conflict) => conflict.proposal_id === proposal.id);
      const candidateSupplements = mergeConflicts.length > 0
        ? await safelyGenerateMergeFusionCandidates(fusionCandidateGenerator, {
            proposalId: proposal.id,
            workItemId: proposal.work_item_id,
            proposalTitle: proposal.title,
            manifest: proposal.diff_manifest,
            conflicts: mergeConflicts,
            actor: input.actor
          })
        : [];
      const adoptedDriveFiles = await adoptDriveFilesForMerge({
        repository,
        proposalId: input.proposalId,
        storageRoot
      });
      try {
        rows = await repository.merge({
          proposalId: input.proposalId,
          mergeSnapshotId: nextId(),
          actor: actorToRepository(input.actor),
          ...(adoptedDriveFiles.length > 0 ? { adoptedDriveFiles } : {}),
          ...(input.conflictResolution?.acceptIncomingTargetKeys
            ? { acceptIncomingTargetKeys: input.conflictResolution.acceptIncomingTargetKeys }
            : {}),
          ...(candidateSupplements.length > 0 ? { candidateSupplements } : {}),
          at: mergedAt
        });
      } catch (error) {
        if (error instanceof ProposalRepositoryMergeConflictError) {
          const rationaleByKey = aiFusionRationaleByConflictKey(candidateSupplements);
          throw new ProposalServiceMergeConflictError(error.conflicts.map((conflict) => {
            const aiFusionRationale = rationaleByKey.get(conflict.target_key);
            return conflictToVm(conflict, aiFusionRationale ? { aiFusionRationale } : {});
          }));
        }
        throw error;
      }
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
