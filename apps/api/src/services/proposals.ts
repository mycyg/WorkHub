import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  deliverableChangeManifestSchema,
  mergeProposalCandidateChoiceResultSchema,
  proposalConflictListResultSchema,
  proposalSchema,
  reviewSchema,
  type DeliverableChange,
  type DeliverableChangeManifest,
  type MergeProposalCandidateChoiceResult,
  type ProposalConflict,
  type ProposalConflictListResult,
  type Proposal,
  type Review
} from "@workhub/contracts";
import { settings as defaultSettings } from "@workhub/config";
import {
  createDatabaseClient,
  createProposalRepository,
  ProposalRepositoryInvalidMergeProposalCandidateError,
  ProposalRepositoryMergeConflictError,
  ProposalRepositoryMergeProposalNotChosenError,
  ProposalRepositoryMergeProposalAlreadyChosenError,
  ProposalRepositoryUnsupportedMergeProposalApplyError,
  type ProposalAdoptedDriveFileInput,
  type MergeProposalCandidateApplicationContext,
  type MergeProposalRow,
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
  chooseMergeCandidate: (input: {
    mergeProposalId: string;
    optionKey: string;
    actor: ProposalActor;
  }) => Promise<MergeProposalCandidateChoiceResult>;
  applyMergeCandidate: (input: {
    mergeProposalId: string;
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

function sha256Text(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function safeStorageSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/gu, "_").slice(0, 128) || "unknown";
}

function filenameForAiFusionCandidate(context: MergeProposalCandidateApplicationContext) {
  const targetPath = context.conflict.target_path ? normalizeManifestPath(context.conflict.target_path) : "";
  if (targetPath) {
    const basename = path.posix.basename(targetPath);
    if (basename.length > 0) {
      return basename;
    }
  }
  return `${safeStorageSegment(context.conflict.change_id)}.ai-fusion.md`;
}

function aiFusionCandidateMarkdown(context: MergeProposalCandidateApplicationContext) {
  const candidate = context.candidate;
  const mergedValue = JSON.stringify(candidate?.merged_value ?? {}, null, 2);
  return [
    "# AI 融合正式稿",
    "",
    `- 变更申请：${context.proposalTitle}`,
    `- Proposal ID：${context.proposalId}`,
    `- Merge Proposal ID：${context.mergeProposalId}`,
    `- 冲突目标：${context.conflictKey}`,
    `- 选择方案：${context.chosenOptionKey}`,
    `- 候选来源：${candidate?.source ?? "unknown"}`,
    "",
    "## 融合理由",
    "",
    candidate?.rationale_md ?? "未提供融合理由。",
    "",
    "## 融合内容",
    "",
    "```json",
    mergedValue,
    "```",
    ""
  ].join("\n");
}

function effectiveAiFusionTargetKind(context: MergeProposalCandidateApplicationContext) {
  return context.candidate?.target_kind ?? context.conflict.target_kind;
}

function textFromAiFusionMergedValue(mergedValue: Record<string, unknown> | undefined) {
  const textKeys = [
    "merged_text",
    "content_md",
    "content",
    "text",
    "proposed_resolution_md",
    "proposed_resolution",
    "markdown"
  ];
  for (const key of textKeys) {
    const value = mergedValue?.[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }
  return null;
}

function containsGitConflictMarkers(value: string) {
  return /(^|\n)(<<<<<<<[ \t].*|=======$|>>>>>>>[ \t].*)/u.test(value);
}

function mimeForAiFusionTextWriteback(input: { filename: string; targetKind: string }) {
  if (input.targetKind === "spec_doc") {
    return "text/markdown";
  }
  const ext = path.extname(input.filename).toLowerCase();
  return ext === ".md" || ext === ".markdown" || ext === ".mdx"
    ? "text/markdown"
    : "text/plain";
}

function aiFusionCandidateMaterialization(input: {
  context: MergeProposalCandidateApplicationContext;
  filename: string;
}) {
  const targetKind = effectiveAiFusionTargetKind(input.context);
  if (targetKind === "text_doc" || targetKind === "spec_doc") {
    const content = textFromAiFusionMergedValue(input.context.candidate?.merged_value);
    if (!content) {
      throw new ProposalServiceError(
        409,
        "merge_candidate_missing_text_result",
        "这个 AI 融合建议没有可直接写回的正文。"
      );
    }
    if (containsGitConflictMarkers(content)) {
      throw new ProposalServiceError(
        409,
        "merge_candidate_contains_conflict_markers",
        "AI 融合内容仍有冲突标记，不能直接写回。"
      );
    }
    return {
      content,
      mime: mimeForAiFusionTextWriteback({ filename: input.filename, targetKind })
    };
  }
  return {
    content: aiFusionCandidateMarkdown(input.context),
    mime: "text/markdown"
  };
}

function assertAiFusionApplyContext(context: MergeProposalCandidateApplicationContext) {
  if (context.proposalStatus === "merged") {
    throw new ProposalServiceError(409, "proposal_already_merged", "这份变更申请已经被采纳。");
  }
  if (context.proposalStatus !== "reviewed") {
    throw new ProposalServiceError(409, "proposal_not_reviewed", "这份变更申请需要先确认，再采纳到正式版。");
  }
  if (context.chosenOptionKey && context.chosenOptionKey !== "ai_fusion") {
    throw new ProposalServiceError(409, "merge_proposal_apply_requires_ai_fusion", "只有 AI 融合建议可以通过这个入口正式写回。");
  }
  if (!context.candidate?.merged_value) {
    throw new ProposalServiceError(409, "merge_candidate_missing_result", "这个 AI 融合建议没有可写回的融合内容。");
  }
  if (context.candidate.target_kind === "folder") {
    throw new ProposalServiceError(409, "merge_candidate_target_unsupported", "文件夹类建议不能作为 AI 融合稿写回。");
  }
}

async function materializeAiFusionCandidate(input: {
  context: MergeProposalCandidateApplicationContext;
  storageRoot: string;
  changeId: string;
}) {
  const root = path.resolve(input.storageRoot);
  const filename = filenameForAiFusionCandidate(input.context);
  const { content, mime } = aiFusionCandidateMaterialization({
    context: input.context,
    filename
  });
  const storagePath = path.resolve(
    root,
    safeStorageSegment(input.context.projectId),
    safeStorageSegment(input.context.workItemId),
    safeStorageSegment(input.context.proposalId),
    "ai-fusion",
    safeStorageSegment(input.context.mergeProposalId),
    safeStorageSegment(input.changeId),
    filename
  );
  if (!assertInside(root, storagePath)) {
    throw new ProposalServiceError(409, "delivery_artifact_unsafe_path", "融合稿文件路径越界，不能采纳到正式版。");
  }
  await mkdir(path.dirname(storagePath), { recursive: true });
  await writeFile(storagePath, content, "utf8");
  return {
    changeId: input.changeId,
    filename,
    storagePath,
    sizeBytes: Buffer.byteLength(content, "utf8"),
    sha256: sha256Text(content),
    mime
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
  aiFusionMergeProposalId?: string;
  recommendedOptionId?: ProposalConflict["recommended_option_id"];
} = {}): ProposalConflict {
  const targetLabel = conflict.target_path ? `「${conflict.target_path}」` : "这处改动";
  const recommendedOptionId = options.recommendedOptionId ?? "keep_current";
  const conflictOptions: ProposalConflict["options"] = [
    {
      id: "keep_current",
      label: "保留正式版",
      summary_text: "不覆盖当前正式交付物，先回到变更申请看差异。",
      recommended: recommendedOptionId === "keep_current",
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
      recommended: recommendedOptionId === "accept_incoming",
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
      label: options.aiFusionMergeProposalId ? "采用 AI 融合稿" : "AI 融合建议",
      summary_text: options.aiFusionRationale,
      recommended: recommendedOptionId === "ai_fusion",
      action: {
        id: options.aiFusionMergeProposalId ? "apply_ai_fusion" : "open_ai_fusion_candidate",
        label: options.aiFusionMergeProposalId ? "采用 AI 融合稿" : "查看建议",
        method: options.aiFusionMergeProposalId ? "POST" : "GET",
        href: options.aiFusionMergeProposalId
          ? `/api/merge-proposals/${options.aiFusionMergeProposalId}/apply`
          : `/proposals/${conflict.proposal_id}`,
        ...(options.aiFusionMergeProposalId ? { request_json: { confirm: true } } : {})
      }
    });
  }
  return {
    id: `${conflict.proposal_id}:${conflict.change_id}:${conflict.target_key}`,
    work_item_id: conflict.work_item_id,
    proposal_id: conflict.proposal_id,
    ...(options.aiFusionMergeProposalId ? { merge_proposal_id: options.aiFusionMergeProposalId } : {}),
    change_id: conflict.change_id,
    target_key: conflict.target_key,
    target_kind: conflict.target_kind,
    change_type: conflict.change_type,
    ...(conflict.target_path ? { target_path: conflict.target_path } : {}),
    headline: `${targetLabel}和正式版撞车了`,
    summary_text: options.aiFusionRationale
      ? "Cuu 给出安全选项，也可以一键采用 AI 融合稿。"
      : "Cuu 先给两个安全选项：保留正式版，或明确采纳这次版本。",
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
    recommended_option_id: recommendedOptionId,
    options: conflictOptions
  };
}

function proposalConflictOptionId(value: string | null | undefined): ProposalConflict["recommended_option_id"] | undefined {
  if (value === "keep_current" || value === "accept_incoming" || value === "ai_fusion") {
    return value;
  }
  return undefined;
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

async function mergeProposalRefsByConflictKey(repository: ProposalRepository, proposalId: string) {
  const refs = new Map<string, {
    mergeProposalId: string;
    aiFusionRationale?: string;
    recommendedOptionId?: ProposalConflict["recommended_option_id"];
  }>();
  const attempts = await repository.listMergeAttemptsByProposal(proposalId);
  for (const attempt of attempts) {
    if (attempt.result !== "conflict") {
      continue;
    }
    const mergeProposalRows = await repository.listMergeProposalsByAttempt(attempt.id);
    for (const row of mergeProposalRows) {
      const aiFusion = mergeProposalCandidate(row, "ai_fusion");
      const aiFusionRationale =
        typeof aiFusion?.rationale_md === "string" ? aiFusion.rationale_md : undefined;
      const recommendedOptionId = proposalConflictOptionId(row.recommendedOptionKey);
      refs.set(row.conflictKey, {
        mergeProposalId: row.id,
        ...(aiFusionRationale ? { aiFusionRationale } : {}),
        ...(recommendedOptionId ? { recommendedOptionId } : {})
      });
    }
  }
  return refs;
}

function mergeProposalCandidate(row: MergeProposalRow, optionKey: string) {
  const candidates = Array.isArray(row.candidatesJson) ? row.candidatesJson : [];
  return candidates.find((candidate) => {
    if (!candidate || typeof candidate !== "object") {
      return false;
    }
    return (candidate as Record<string, unknown>).option_key === optionKey;
  }) as Record<string, unknown> | undefined;
}

function mergeCandidateChoiceResult(row: MergeProposalRow): MergeProposalCandidateChoiceResult {
  const optionKey = row.chosenOptionKey;
  const chosenAt = iso(row.chosenAt);
  if (!optionKey || !chosenAt) {
    throw new ProposalServiceError(409, "merge_proposal_not_chosen", "这个合并建议还没有被选择。");
  }
  const candidate = mergeProposalCandidate(row, optionKey);
  if (!candidate) {
    throw new ProposalServiceError(409, "merge_proposal_candidate_missing", "被选择的建议内容已经不可用。");
  }
  return mergeProposalCandidateChoiceResultSchema.parse({
    merge_proposal_id: row.id,
    conflict_key: row.conflictKey,
    chosen_option_key: optionKey,
    ...(row.chosenByUserId ? { chosen_by_user_id: row.chosenByUserId } : {}),
    chosen_at: chosenAt,
    candidate
  });
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
    },

    async chooseMergeCandidate(input) {
      throw new ProposalServiceError(
        404,
        "not_found",
        `没有找到这个合并建议：${input.mergeProposalId}`
      );
    },

    async applyMergeCandidate(input) {
      throw new ProposalServiceError(
        404,
        "not_found",
        `没有找到这个合并建议：${input.mergeProposalId}`
      );
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
      const conflicts = await repository.listConflictsByWorkItem(workItemId);
      const refsByProposal = new Map<string, Awaited<ReturnType<typeof mergeProposalRefsByConflictKey>>>();
      for (const proposalId of [...new Set(conflicts.map((conflict) => conflict.proposal_id))]) {
        refsByProposal.set(proposalId, await mergeProposalRefsByConflictKey(repository, proposalId));
      }
      return conflictListResult(conflicts.map((conflict) => {
        const ref = refsByProposal.get(conflict.proposal_id)?.get(conflict.target_key);
        return conflictToVm(conflict, ref ? {
          ...(ref.aiFusionRationale ? { aiFusionRationale: ref.aiFusionRationale } : {}),
          aiFusionMergeProposalId: ref.mergeProposalId,
          ...(ref.recommendedOptionId ? { recommendedOptionId: ref.recommendedOptionId } : {})
        } : {});
      }));
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
          const refsByKey = await mergeProposalRefsByConflictKey(repository, proposal.id);
          const rationaleByKey = aiFusionRationaleByConflictKey(candidateSupplements);
          throw new ProposalServiceMergeConflictError(error.conflicts.map((conflict) => {
            const ref = refsByKey.get(conflict.target_key);
            const aiFusionRationale = ref?.aiFusionRationale ?? rationaleByKey.get(conflict.target_key);
            return conflictToVm(conflict, {
              ...(aiFusionRationale ? { aiFusionRationale } : {}),
              ...(ref?.mergeProposalId ? { aiFusionMergeProposalId: ref.mergeProposalId } : {}),
              ...(ref?.recommendedOptionId ? { recommendedOptionId: ref.recommendedOptionId } : {})
            });
          }));
        }
        throw error;
      }
      if (!rows) {
        throw new ProposalServiceError(404, "not_found", "没有找到这个变更申请。");
      }
      return storedRowsToProposal(rows);
    },

    async chooseMergeCandidate(input) {
      let row: MergeProposalRow | null;
      try {
        row = await repository.chooseMergeProposalCandidate({
          mergeProposalId: input.mergeProposalId,
          optionKey: input.optionKey,
          actor: actorToRepository(input.actor),
          at: now()
        });
      } catch (error) {
        if (error instanceof ProposalRepositoryInvalidMergeProposalCandidateError) {
          throw new ProposalServiceError(
            422,
            error.code,
            "这个合并建议里没有这个可选方案。"
          );
        }
        if (error instanceof ProposalRepositoryMergeProposalAlreadyChosenError) {
          throw new ProposalServiceError(
            409,
            error.code,
            "这个合并建议已经选择过其它方案，不能直接覆盖。"
          );
        }
        throw error;
      }
      if (!row) {
        throw new ProposalServiceError(404, "not_found", "没有找到这个合并建议。");
      }
      return mergeCandidateChoiceResult(row);
    },

    async applyMergeCandidate(input) {
      const context = await repository.findMergeProposalCandidateForApply(input.mergeProposalId);
      if (!context) {
        throw new ProposalServiceError(404, "not_found", "没有找到这个合并建议。");
      }
      assertAiFusionApplyContext(context);
      const resolvedDriveFile = await materializeAiFusionCandidate({
        context,
        storageRoot,
        changeId: nextId()
      });
      let rows: StoredProposalRows | null;
      try {
        rows = await repository.applyMergeProposalCandidate({
          mergeProposalId: input.mergeProposalId,
          mergeSnapshotId: nextId(),
          actor: actorToRepository(input.actor),
          resolvedDriveFile,
          at: now()
        });
      } catch (error) {
        if (error instanceof ProposalRepositoryMergeProposalNotChosenError) {
          throw new ProposalServiceError(409, error.code, "这个合并建议还没有被选择。");
        }
        if (error instanceof ProposalRepositoryUnsupportedMergeProposalApplyError) {
          throw new ProposalServiceError(409, error.code, error.message);
        }
        throw error;
      }
      if (!rows) {
        throw new ProposalServiceError(404, "not_found", "没有找到这个合并建议。");
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
