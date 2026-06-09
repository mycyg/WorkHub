import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  buildStructuredFieldPatchDryRun,
  deliverableChangeManifestSchema,
  mergeProposalCandidateChoiceResultSchema,
  proposalConflictListResultSchema,
  proposalSchema,
  reviewSchema,
  structuredFieldPatchDryRunSchema,
  type DeliverableChange,
  type DeliverableChangeManifest,
  type MergeProposalCandidateChoiceResult,
  type ProposalConflict,
  type ProposalConflictListResult,
  type Proposal,
  type Review,
  type StructuredFieldApplyOverrides,
  type StructuredFieldPatchDryRun,
  type StructuredItemApplyOverrides,
  type TaskPlanScopeSelection,
  type TextHunkApplyOverrides
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
  type MergeFusionContentContext,
  type MergeFusionCandidateGenerator
} from "./merge-fusion-candidates.js";
import {
  materializeTextHunkOverrides,
  TextHunkMaterializationError,
  type TextHunkMaterializationResult
} from "./text-hunk-materializer.js";

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
  bulkAction?: {
    action: "keep_current" | "accept_incoming";
    targetKeys: string[];
    conflictCount?: number;
  };
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
  getByMergeProposal: (mergeProposalId: string) => Promise<StoredProposal | null>;
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
    structuredFieldOverrides?: StructuredFieldApplyOverrides;
    structuredItemOverrides?: StructuredItemApplyOverrides;
    textHunkOverrides?: TextHunkApplyOverrides;
    taskPlanScope?: TaskPlanScopeSelection;
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

const maxFusionContextChars = 16_000;

async function readFusionTextExcerpt(input: {
  filePath: string;
  ref?: string;
  sha256?: string;
}) {
  try {
    const fileStat = await stat(input.filePath);
    if (!fileStat.isFile()) {
      return undefined;
    }
    const text = new TextDecoder("utf-8", { fatal: true }).decode(await readFile(input.filePath));
    return {
      text: text.length > maxFusionContextChars ? text.slice(0, maxFusionContextChars) : text,
      bytes: fileStat.size,
      truncated: text.length > maxFusionContextChars,
      ...(input.ref ? { ref: input.ref } : {}),
      ...(input.sha256 ? { sha256: input.sha256 } : {})
    };
  } catch {
    return undefined;
  }
}

async function readFullUtf8TextFile(filePath: string) {
  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) {
      return undefined;
    }
    const text = new TextDecoder("utf-8", { fatal: true }).decode(await readFile(filePath));
    return {
      text,
      bytes: fileStat.size,
      sha256: sha256Text(text)
    };
  } catch {
    return undefined;
  }
}

function normalizeShaRef(value: string | undefined) {
  return value?.replace(/^sha256:/iu, "");
}

function changeForMergeConflict(
  manifest: DeliverableChangeManifest,
  conflict: { change_id: string; target_key: string }
) {
  return manifest.changes.find((change) => change.id === conflict.change_id)
    ?? manifest.changes.find((change) => {
      const ref = change.target_ref;
      if (ref.entity_id) {
        return `${ref.entity_type}:${ref.entity_id}` === conflict.target_key;
      }
      if (ref.path) {
        return `${ref.entity_type}:${normalizeManifestPath(ref.path)}` === conflict.target_key;
      }
      return `${ref.entity_type}:${change.id}` === conflict.target_key;
    });
}

async function fusionContentContextsForConflicts(input: {
  repository: ProposalRepository;
  proposalId: string;
  conflicts: Array<{
    target_key: string;
    target_kind: string;
    target_path?: string;
    change_id: string;
    incoming_version_before?: string;
    incoming_sha256_before?: string;
  }>;
}) {
  const mergeContext = await input.repository.findMergeContext(input.proposalId);
  if (!mergeContext) {
    return undefined;
  }
  const contexts: Record<string, MergeFusionContentContext> = {};
  for (const conflict of input.conflicts) {
    if (conflict.target_kind !== "text_doc" && conflict.target_kind !== "spec_doc") {
      continue;
    }
    const change = changeForMergeConflict(mergeContext.diffManifest, conflict);
    const currentFile = await input.repository.findAcceptedDriveFileForTarget({
      workItemId: mergeContext.workItemId,
      targetKey: conflict.target_key
    });
    const baseFile = (conflict.incoming_version_before || conflict.incoming_sha256_before)
      ? await input.repository.findAcceptedDriveFileForTarget({
          workItemId: mergeContext.workItemId,
          targetKey: conflict.target_key,
          ...(conflict.incoming_version_before ? { ref: conflict.incoming_version_before } : {}),
          ...(conflict.incoming_sha256_before ? { sha256: conflict.incoming_sha256_before } : {})
        })
      : null;
    const current = currentFile?.storagePath
      ? await readFusionTextExcerpt({
          filePath: currentFile.storagePath,
          ...(currentFile.acceptedRef ? { ref: currentFile.acceptedRef } : {}),
          ...(currentFile.sha256After ? { sha256: currentFile.sha256After } : {})
        })
      : undefined;
    const base = baseFile?.storagePath && baseFile.acceptedChangeId !== currentFile?.acceptedChangeId
      ? await readFusionTextExcerpt({
          filePath: baseFile.storagePath,
          ...(baseFile.acceptedRef ? { ref: baseFile.acceptedRef } : {}),
          ...(baseFile.sha256After ? { sha256: baseFile.sha256After } : {})
        })
      : undefined;
    let incoming: Awaited<ReturnType<typeof readFusionTextExcerpt>> | undefined;
    if (mergeContext.workdirRef && change?.target_ref.path) {
      try {
        incoming = await readFusionTextExcerpt({
          filePath: sourcePathForChange(mergeContext.workdirRef, change),
          ...(change.target_ref.version_after ? { ref: change.target_ref.version_after } : {}),
          ...(change.target_ref.sha256_after ? { sha256: change.target_ref.sha256_after } : {})
        });
      } catch {
        incoming = undefined;
      }
    }
    if (current || incoming || base) {
      contexts[conflict.target_key] = {
        conflict_key: conflict.target_key,
        target_kind: conflict.target_kind,
        ...(conflict.target_path ? { target_path: conflict.target_path } : {}),
        ...(current ? { current } : {}),
        ...(incoming ? { incoming } : {}),
        ...(base ? { base } : {})
      };
    }
  }
  return Object.keys(contexts).length > 0 ? contexts : undefined;
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

function structuredMergedValueFieldRecord(mergedValue: Record<string, unknown> | undefined) {
  if (!mergedValue) {
    return {};
  }
  const explicitFields = objectRecord(mergedValue.fields)
    ?? objectRecord(mergedValue.field_updates)
    ?? objectRecord(mergedValue.patch);
  if (explicitFields) {
    return Object.fromEntries(
      Object.entries(explicitFields).filter(([field]) => field.trim().length > 0)
    );
  }
  const nonFieldKeys = new Set([
    "proposed_resolution_md",
    "proposed_resolution",
    "rationale_md",
    "reason",
    "summary",
    "notes",
    "comment"
  ]);
  return Object.fromEntries(
    Object.entries(mergedValue).filter(([field]) => !nonFieldKeys.has(field))
  );
}

function structuredChangeForApplyContext(context: MergeProposalCandidateApplicationContext): DeliverableChange | undefined {
  return context.diffManifest.changes.find((change) => change.id === context.conflict.change_id);
}

function structuredFieldPatchDryRunForApply(context: MergeProposalCandidateApplicationContext) {
  if (effectiveAiFusionTargetKind(context) !== "structured_record") {
    return undefined;
  }
  const qualityGate = objectRecord(context.candidate?.quality_gate);
  const existingDryRun = structuredFieldPatchDryRunSchema.safeParse(
    qualityGate?.["structured_field_patch_dry_run"]
      ?? objectRecord(qualityGate?.["structured_record_patch"])?.["structured_field_patch_dry_run"]
  );
  if (existingDryRun.success) {
    return existingDryRun.data;
  }
  const change = structuredChangeForApplyContext(context);
  return buildStructuredFieldPatchDryRun({
    target_entity_type: change?.target_ref.entity_type,
    target_entity_id: change?.target_ref.entity_id,
    ...(change?.machine_summary?.changed_fields ? { changed_fields: change.machine_summary.changed_fields } : {}),
    merged_fields: structuredMergedValueFieldRecord(context.candidate?.merged_value),
    base_fields: objectRecord(change?.machine_summary?.field_values_before) ?? {},
    source: "ai_fusion"
  });
}

function applyStructuredFieldOverridesToDryRun(
  dryRun: StructuredFieldPatchDryRun,
  overrides: StructuredFieldApplyOverrides | undefined
) {
  if (!overrides) {
    return dryRun;
  }
  const originalFields = new Set(dryRun.patch.operations.map((operation) => operation.field));
  const overridesByField = new Map<string, StructuredFieldApplyOverrides["operations"][number]>();
  for (const override of overrides.operations) {
    if (overridesByField.has(override.field)) {
      throw new ProposalServiceError(
        409,
        "structured_field_patch_override_duplicate",
        `字段 ${override.field} 的编辑出现了重复选择。`
      );
    }
    if (!originalFields.has(override.field)) {
      throw new ProposalServiceError(
        409,
        "structured_field_patch_override_unknown",
        `字段 ${override.field} 不在这次结构化字段建议中。`
      );
    }
    overridesByField.set(override.field, override);
  }
  let hasManualValue = false;
  const operations = dryRun.patch.operations.flatMap((operation) => {
    const override = overridesByField.get(operation.field);
    if (!override || override.decision === "accept_incoming") {
      return [operation];
    }
    if (override.decision === "keep_current") {
      return [];
    }
    hasManualValue = true;
    return [{
      ...operation,
      value: override.value,
      source: "manual" as const
    }];
  });
  if (operations.length === 0) {
    throw new ProposalServiceError(
      409,
      "structured_field_patch_empty",
      "字段级编辑后没有需要写回的字段。"
    );
  }
  const source = hasManualValue ? "manual" : dryRun.patch.source;
  const parsed = structuredFieldPatchDryRunSchema.safeParse({
    ...dryRun,
    patch: {
      ...dryRun.patch,
      operations,
      source
    },
    audit_payload: {
      ...dryRun.audit_payload,
      field_count: operations.length,
      operation_fields: operations.map((operation) => operation.field),
      source
    }
  });
  if (!parsed.success) {
    throw new ProposalServiceError(
      409,
      "structured_field_patch_override_invalid",
      "字段级编辑后的值没有通过结构化字段校验。"
    );
  }
  return parsed.data;
}

type StructuredArrayItem = Record<string, unknown> & { id: string };
type StructuredPatchOperation = StructuredFieldPatchDryRun["patch"]["operations"][number];

function structuredArrayItemRecord(value: unknown): StructuredArrayItem | undefined {
  const record = objectRecord(value);
  const id = typeof record?.["id"] === "string" ? record["id"] : undefined;
  return id && id.trim().length > 0 ? { ...record, id } : undefined;
}

function structuredArrayItems(value: unknown): StructuredArrayItem[] {
  return Array.isArray(value)
    ? value.map(structuredArrayItemRecord).filter((item): item is StructuredArrayItem => Boolean(item))
    : [];
}

function structuredArrayItemsById(items: StructuredArrayItem[]) {
  return new Map(items.map((item) => [item.id, item] as const));
}

function structuredArrayItemsEqual(left: StructuredArrayItem | undefined, right: StructuredArrayItem | undefined) {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function itemOverrideSourceItems(operation: StructuredPatchOperation) {
  const incoming = structuredArrayItems(operation.value);
  const current = structuredArrayItems(
    Object.prototype.hasOwnProperty.call(operation, "current_value")
      ? operation.current_value
      : operation.before_value
  );
  return {
    incoming,
    current,
    incomingById: structuredArrayItemsById(incoming),
    currentById: structuredArrayItemsById(current)
  };
}

function itemOverridesForField(input: {
  dryRun: StructuredFieldPatchDryRun;
  overrides: StructuredItemApplyOverrides;
}) {
  const operationsByField = new Map(input.dryRun.patch.operations.map((operation) => [operation.field, operation] as const));
  const byField = new Map<string, StructuredItemApplyOverrides["items"]>();
  const seen = new Set<string>();
  for (const override of input.overrides.items) {
    const key = `${override.field}:${override.item_id}`;
    if (seen.has(key)) {
      throw new ProposalServiceError(
        409,
        "structured_item_override_duplicate",
        `子记录 ${override.field}/${override.item_id} 的编辑出现了重复选择。`
      );
    }
    seen.add(key);
    const operation = operationsByField.get(override.field);
    if (!operation) {
      throw new ProposalServiceError(
        409,
        "structured_item_override_unknown_field",
        `字段 ${override.field} 不在这次结构化字段建议中。`
      );
    }
    if (!Array.isArray(operation.value)) {
      throw new ProposalServiceError(
        409,
        "structured_item_override_not_array",
        `字段 ${override.field} 不是可逐项编辑的子记录数组。`
      );
    }
    const source = itemOverrideSourceItems(operation);
    if (!source.incomingById.has(override.item_id) && !source.currentById.has(override.item_id)) {
      throw new ProposalServiceError(
        409,
        "structured_item_override_unknown_item",
        `子记录 ${override.field}/${override.item_id} 不在这次结构化字段建议中。`
      );
    }
    byField.set(override.field, [...(byField.get(override.field) ?? []), override]);
  }
  return byField;
}

function applyItemOverridesToOperation(
  operation: StructuredPatchOperation,
  overrides: StructuredItemApplyOverrides["items"]
): StructuredPatchOperation {
  if (!Array.isArray(operation.value)) {
    return operation;
  }
  const source = itemOverrideSourceItems(operation);
  const nextById = new Map(source.incoming.map((item) => [item.id, item] as const));
  for (const override of overrides) {
    const incomingItem = source.incomingById.get(override.item_id);
    const currentItem = source.currentById.get(override.item_id);
    if (override.decision === "accept_incoming") {
      if (incomingItem) {
        nextById.set(override.item_id, incomingItem);
      } else {
        nextById.delete(override.item_id);
      }
      continue;
    }
    if (currentItem) {
      nextById.set(override.item_id, currentItem);
    } else {
      nextById.delete(override.item_id);
    }
  }
  const orderedIds = [
    ...source.incoming.map((item) => item.id),
    ...source.current.map((item) => item.id)
  ].filter((item, index, all) => all.indexOf(item) === index);
  const value = orderedIds
    .map((id) => nextById.get(id))
    .filter((item): item is StructuredArrayItem => Boolean(item));
  const changed = value.length !== source.incoming.length
    || value.some((item, index) => !structuredArrayItemsEqual(item, source.incoming[index]));
  return changed
    ? {
      ...operation,
      value,
      source: "manual"
    }
    : operation;
}

function applyStructuredItemOverridesToDryRun(
  dryRun: StructuredFieldPatchDryRun,
  overrides: StructuredItemApplyOverrides | undefined
) {
  if (!overrides) {
    return dryRun;
  }
  const byField = itemOverridesForField({ dryRun, overrides });
  let changed = false;
  const operations = dryRun.patch.operations.map((operation) => {
    const fieldOverrides = byField.get(operation.field);
    if (!fieldOverrides?.length) {
      return operation;
    }
    const next = applyItemOverridesToOperation(operation, fieldOverrides);
    if (next !== operation) {
      changed = true;
    }
    return next;
  });
  const source = changed ? "manual" : dryRun.patch.source;
  const parsed = structuredFieldPatchDryRunSchema.safeParse({
    ...dryRun,
    patch: {
      ...dryRun.patch,
      operations,
      source
    },
    audit_payload: {
      ...dryRun.audit_payload,
      operation_fields: operations.map((operation) => operation.field),
      source
    }
  });
  if (!parsed.success) {
    throw new ProposalServiceError(
      409,
      "structured_item_override_invalid",
      "子记录逐项编辑后的结构化字段没有通过校验。"
    );
  }
  return parsed.data;
}

function assertStructuredFieldPatchDryRunForApply(context: MergeProposalCandidateApplicationContext) {
  const dryRun = structuredFieldPatchDryRunForApply(context);
  if (!dryRun || dryRun.status !== "blocked") {
    return dryRun;
  }
  throw new ProposalServiceError(
    409,
    "structured_field_patch_dry_run_failed",
    "这个结构化字段建议没有通过字段补丁 dry-run，不能直接写回。"
  );
}

function structuredFieldPatchWritebackForApply(
  context: MergeProposalCandidateApplicationContext,
  overrides?: StructuredFieldApplyOverrides,
  itemOverrides?: StructuredItemApplyOverrides,
  taskPlanScope?: TaskPlanScopeSelection
): {
  dryRun: StructuredFieldPatchDryRun;
  taskPlanScope?: { targetPlanId: string };
} | undefined {
  if (effectiveAiFusionTargetKind(context) !== "structured_record") {
    return undefined;
  }
  const baseDryRun = assertStructuredFieldPatchDryRunForApply(context);
  if (!baseDryRun) {
    return undefined;
  }
  const fieldDryRun = applyStructuredFieldOverridesToDryRun(baseDryRun, overrides);
  const dryRun = applyStructuredItemOverridesToDryRun(fieldDryRun, itemOverrides);
  if (dryRun.status !== "ready" || !dryRun.executable) {
    throw new ProposalServiceError(
      409,
      "structured_field_patch_not_executable",
      "这个结构化字段建议还需要字段级复核，不能直接写回事项字段。"
    );
  }
  if (dryRun.patch.target_entity_type !== "work_item" || dryRun.patch.target_entity_id !== context.workItemId) {
    throw new ProposalServiceError(
      409,
      "structured_field_patch_target_mismatch",
      "这个结构化字段建议的目标事项和当前变更申请不一致。"
    );
  }
  return {
    dryRun,
    ...(taskPlanScope ? { taskPlanScope: { targetPlanId: taskPlanScope.target_plan_id } } : {})
  };
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

async function fullTextContextForHunkMaterialization(input: {
  repository: ProposalRepository;
  context: MergeProposalCandidateApplicationContext;
}) {
  const targetKind = effectiveAiFusionTargetKind(input.context);
  if (targetKind !== "text_doc" && targetKind !== "spec_doc") {
    throw new ProposalServiceError(
      409,
      "text_hunk_target_unsupported",
      "只有文本类融合建议支持逐段写回。"
    );
  }
  const mergeContext = await input.repository.findMergeContext(input.context.proposalId);
  if (!mergeContext) {
    throw new ProposalServiceError(
      409,
      "text_hunk_context_missing",
      "缺少这次变更申请的文本合并上下文。"
    );
  }
  const change = changeForMergeConflict(mergeContext.diffManifest, input.context.conflict);
  if (!change) {
    throw new ProposalServiceError(
      409,
      "text_hunk_change_missing",
      "缺少这次文本冲突对应的变更记录。"
    );
  }
  const currentFile = await input.repository.findAcceptedDriveFileForTarget({
    workItemId: input.context.workItemId,
    targetKey: input.context.conflictKey
  });
  if (!currentFile?.storagePath) {
    throw new ProposalServiceError(
      409,
      "text_hunk_current_missing",
      "找不到当前正式文本，不能逐段写回。"
    );
  }
  const current = await readFullUtf8TextFile(currentFile.storagePath);
  if (!current) {
    throw new ProposalServiceError(
      409,
      "text_hunk_current_missing",
      "当前正式文本不可读取或不是 UTF-8 文本。"
    );
  }
  const expectedCurrentSha = normalizeShaRef(input.context.conflict.existing_sha256_after);
  if (expectedCurrentSha && expectedCurrentSha !== (currentFile.sha256After ?? current.sha256)) {
    throw new ProposalServiceError(
      409,
      "text_hunk_stale_current",
      "正式文本已经变化，需要重新生成合并建议。"
    );
  }

  const baseFile = (input.context.conflict.incoming_version_before || input.context.conflict.incoming_sha256_before)
    ? await input.repository.findAcceptedDriveFileForTarget({
        workItemId: input.context.workItemId,
        targetKey: input.context.conflictKey,
        ...(input.context.conflict.incoming_version_before ? { ref: input.context.conflict.incoming_version_before } : {}),
        ...(input.context.conflict.incoming_sha256_before ? { sha256: input.context.conflict.incoming_sha256_before } : {})
      })
    : null;
  if (!baseFile?.storagePath) {
    throw new ProposalServiceError(
      409,
      "text_hunk_base_missing",
      "缺少文本三方合并的 base 版本，不能逐段写回。"
    );
  }
  const base = await readFullUtf8TextFile(baseFile.storagePath);
  if (!base) {
    throw new ProposalServiceError(
      409,
      "text_hunk_base_missing",
      "文本 base 版本不可读取或不是 UTF-8 文本。"
    );
  }
  const expectedBaseSha = normalizeShaRef(input.context.conflict.incoming_sha256_before);
  if (expectedBaseSha && expectedBaseSha !== base.sha256) {
    throw new ProposalServiceError(
      409,
      "text_hunk_stale_base",
      "文本 base 版本和合并建议不一致，需要重新生成。"
    );
  }

  if (!mergeContext.workdirRef || !change.target_ref.path) {
    throw new ProposalServiceError(
      409,
      "text_hunk_incoming_missing",
      "找不到这次版本的文本文件，不能逐段写回。"
    );
  }
  const incomingPath = sourcePathForChange(mergeContext.workdirRef, change);
  const incoming = await readFullUtf8TextFile(incomingPath);
  if (!incoming) {
    throw new ProposalServiceError(
      409,
      "text_hunk_incoming_missing",
      "这次版本的文本不可读取或不是 UTF-8 文本。"
    );
  }
  const expectedIncomingSha = normalizeShaRef(change.target_ref.sha256_after);
  if (expectedIncomingSha && expectedIncomingSha !== incoming.sha256) {
    throw new ProposalServiceError(
      409,
      "delivery_artifact_changed",
      "交付文件内容和审查版本不一致，需要重新生成变更申请。"
    );
  }

  return {
    base,
    current,
    incoming
  };
}

async function materializeTextHunkCandidate(input: {
  repository: ProposalRepository;
  context: MergeProposalCandidateApplicationContext;
  storageRoot: string;
  changeId: string;
  overrides: TextHunkApplyOverrides;
}) {
  const targetKind = effectiveAiFusionTargetKind(input.context);
  const filename = filenameForAiFusionCandidate(input.context);
  const aiFusionText = textFromAiFusionMergedValue(input.context.candidate?.merged_value);
  if (!aiFusionText) {
    throw new ProposalServiceError(
      409,
      "merge_candidate_missing_text_result",
      "这个 AI 融合建议没有可用于逐段写回的正文。"
    );
  }
  const context = await fullTextContextForHunkMaterialization({
    repository: input.repository,
    context: input.context
  });
  let materialized: TextHunkMaterializationResult;
  try {
    const qualityGate = input.context.candidate?.quality_gate;
    materialized = materializeTextHunkOverrides({
      baseText: context.base.text,
      currentText: context.current.text,
      incomingText: context.incoming.text,
      aiFusionText,
      ...(qualityGate ? { qualityGate } : {}),
      overrides: input.overrides
    });
  } catch (error) {
    if (error instanceof TextHunkMaterializationError) {
      throw new ProposalServiceError(409, error.code, error.message);
    }
    throw error;
  }
  if (containsGitConflictMarkers(materialized.content)) {
    throw new ProposalServiceError(
      409,
      "merge_candidate_contains_conflict_markers",
      "逐段生成后的文本仍有冲突标记，不能直接写回。"
    );
  }
  const root = path.resolve(input.storageRoot);
  const storagePath = path.resolve(
    root,
    safeStorageSegment(input.context.projectId),
    safeStorageSegment(input.context.workItemId),
    safeStorageSegment(input.context.proposalId),
    "text-hunk-overrides",
    safeStorageSegment(input.context.mergeProposalId),
    safeStorageSegment(input.changeId),
    filename
  );
  if (!assertInside(root, storagePath)) {
    throw new ProposalServiceError(409, "delivery_artifact_unsafe_path", "逐段融合稿文件路径越界，不能采纳到正式版。");
  }
  await mkdir(path.dirname(storagePath), { recursive: true });
  await writeFile(storagePath, materialized.content, "utf8");
  return {
    file: {
      changeId: input.changeId,
      filename,
      storagePath,
      sizeBytes: Buffer.byteLength(materialized.content, "utf8"),
      sha256: materialized.sha256,
      mime: mimeForAiFusionTextWriteback({ filename, targetKind })
    },
    patch: {
      source: "text_hunk_overrides" as const,
      overrides: input.overrides,
      decisions: materialized.decisions,
      conflictRanges: materialized.conflictRanges,
      baseSha256: context.base.sha256,
      currentSha256: context.current.sha256,
      incomingSha256: context.incoming.sha256,
      outputSha256: materialized.sha256
    }
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
  assertStructuredFieldPatchDryRunForApply(context);
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
  aiFusionQualityGate?: Record<string, unknown>;
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
      ...(options.aiFusionQualityGate ? { quality_gate: options.aiFusionQualityGate } : {}),
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

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function aiFusionQualityGateByConflictKey(
  supplements: Awaited<ReturnType<MergeFusionCandidateGenerator["generate"]>>
) {
  const byKey = new Map<string, Record<string, unknown>>();
  for (const supplement of supplements) {
    const candidate = supplement.candidates.find((item) => item.option_key === "ai_fusion");
    const qualityGate = objectRecord(candidate?.quality_gate);
    if (qualityGate) {
      byKey.set(supplement.conflictKey, qualityGate);
    }
  }
  return byKey;
}

async function mergeProposalRefsByConflictKey(repository: ProposalRepository, proposalId: string) {
  const refs = new Map<string, {
    mergeProposalId: string;
    aiFusionRationale?: string;
    aiFusionQualityGate?: Record<string, unknown>;
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
      const aiFusionQualityGate = objectRecord(aiFusion?.quality_gate);
      const recommendedOptionId = proposalConflictOptionId(row.recommendedOptionKey);
      refs.set(row.conflictKey, {
        mergeProposalId: row.id,
        ...(aiFusionRationale ? { aiFusionRationale } : {}),
        ...(aiFusionQualityGate ? { aiFusionQualityGate } : {}),
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

    async getByMergeProposal() {
      return null;
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

    async getByMergeProposal(mergeProposalId) {
      const rows = await repository.findProposalByMergeProposalId(mergeProposalId);
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
          ...(ref.aiFusionQualityGate ? { aiFusionQualityGate: ref.aiFusionQualityGate } : {}),
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
      const contentContexts = mergeConflicts.length > 0
        ? await fusionContentContextsForConflicts({
            repository,
            proposalId: proposal.id,
            conflicts: mergeConflicts
          })
        : undefined;
      const candidateSupplements = mergeConflicts.length > 0
        ? await safelyGenerateMergeFusionCandidates(fusionCandidateGenerator, {
            proposalId: proposal.id,
            workItemId: proposal.work_item_id,
            proposalTitle: proposal.title,
            manifest: proposal.diff_manifest,
            conflicts: mergeConflicts,
            ...(contentContexts ? { contentContexts } : {}),
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
          ...(input.conflictResolution?.bulkAction
            ? { bulkAction: input.conflictResolution.bulkAction }
            : {}),
          ...(candidateSupplements.length > 0 ? { candidateSupplements } : {}),
          at: mergedAt
        });
      } catch (error) {
        if (error instanceof ProposalRepositoryMergeConflictError) {
          const refsByKey = await mergeProposalRefsByConflictKey(repository, proposal.id);
          const rationaleByKey = aiFusionRationaleByConflictKey(candidateSupplements);
          const qualityGateByKey = aiFusionQualityGateByConflictKey(candidateSupplements);
          throw new ProposalServiceMergeConflictError(error.conflicts.map((conflict) => {
            const ref = refsByKey.get(conflict.target_key);
            const aiFusionRationale = ref?.aiFusionRationale ?? rationaleByKey.get(conflict.target_key);
            const aiFusionQualityGate = ref?.aiFusionQualityGate ?? qualityGateByKey.get(conflict.target_key);
            return conflictToVm(conflict, {
              ...(aiFusionRationale ? { aiFusionRationale } : {}),
              ...(aiFusionQualityGate ? { aiFusionQualityGate } : {}),
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
      const resolvedStructuredFieldPatch = structuredFieldPatchWritebackForApply(
        context,
        input.structuredFieldOverrides,
        input.structuredItemOverrides,
        input.taskPlanScope
      );
      if (input.textHunkOverrides && resolvedStructuredFieldPatch) {
        throw new ProposalServiceError(
          409,
          "text_hunk_target_unsupported",
          "逐段文本选择不能用于结构化字段写回。"
        );
      }
      const resolvedDriveFile = resolvedStructuredFieldPatch
        ? undefined
        : input.textHunkOverrides
          ? await materializeTextHunkCandidate({
              repository,
              context,
              storageRoot,
              changeId: nextId(),
              overrides: input.textHunkOverrides
            })
          : {
              file: await materializeAiFusionCandidate({
                context,
                storageRoot,
                changeId: nextId()
              })
            };
      const resolvedApplyPayload = resolvedStructuredFieldPatch
        ? { resolvedStructuredFieldPatch }
        : (() => {
            if (!resolvedDriveFile) {
              throw new ProposalServiceError(409, "merge_candidate_artifact_missing", "AI 融合建议没有可写回的正式文件。");
            }
            const textHunkPatch = "patch" in resolvedDriveFile ? resolvedDriveFile.patch : undefined;
            return {
              resolvedDriveFile: resolvedDriveFile.file,
              ...(textHunkPatch ? { resolvedTextHunkPatch: textHunkPatch } : {})
            };
          })();
      let rows: StoredProposalRows | null;
      try {
        rows = await repository.applyMergeProposalCandidate({
          mergeProposalId: input.mergeProposalId,
          mergeSnapshotId: nextId(),
          actor: actorToRepository(input.actor),
          ...resolvedApplyPayload,
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
