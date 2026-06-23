import { createHash } from "node:crypto";

import {
  getSharedDatabaseClient,
  createDriveRepository,
  DriveRepositoryConflictError,
  type DriveItemRow,
  type DriveOperationRow,
  type DrivePageRows,
  type DriveRepository,
  type DriveVersionRow,
  type WorkHubDatabaseClient
} from "@workhub/db";
import {
  drivePageVmSchema,
  type AcceptedDeliverableVM,
  type DriveFileVersionVM,
  type DriveItemVM,
  type DriveOperationVM,
  type DrivePageVM,
  type WorkItemDetailVM,
  type WorkHubLocale
} from "@workhub/contracts";
import { canManageProjectDrive, canViewProjectDrive } from "@workhub/permissions";

import type { AuthActor } from "../middleware/auth.js";
import { parseOutputContract } from "../pages/output-contract.js";
import { acceptedDeliverableToVm } from "./accepted-deliverables.js";
import {
  getDefaultProposalService,
  ProposalServiceError,
  type ProposalActor,
  type ProposalService
} from "./proposals.js";
import {
  getDefaultWorkItemService,
  type WorkItemService
} from "./work-items.js";

export type DrivePageService = {
  page: (input: {
    actor: AuthActor;
    locale?: WorkHubLocale;
    projectId?: string;
  }) => Promise<DrivePageVM>;
  uploadFile: (input: DriveMutationInput & {
    filename: string;
    mime?: string;
    sizeBytes?: number;
    sha256?: string;
    parsedText?: string;
  }) => Promise<DrivePageVM>;
  deleteItem: (input: DriveMutationInput & {
    itemId: string;
    expectedCurrentVersionId?: string | null;
  }) => Promise<DrivePageVM>;
  restoreItem: (input: DriveMutationInput & {
    itemId: string;
  }) => Promise<DrivePageVM>;
  commentToDraft: (input: DriveMutationInput & {
    commentId: string;
  }) => Promise<DrivePageVM>;
  draftToProposal: (input: {
    actor: AuthActor;
    locale?: WorkHubLocale;
    workItemId: string;
  }) => Promise<WorkItemDetailVM>;
};

export type DrivePageServiceDependencies = {
  repo: DriveRepository;
  proposals?: Pick<ProposalService, "createFromManifest" | "get">;
  workItems?: Pick<WorkItemService, "detailPage">;
  now?: () => Date;
};

export type DriveMutationInput = {
  actor: AuthActor;
  projectId: string;
};

export class DrivePageServiceError extends Error {
  constructor(
    public readonly status: 403 | 404 | 409,
    message: string,
    public readonly code = "drive_error"
  ) {
    super(message);
  }
}

function itemPath(item: DriveItemRow, itemById: Map<string, DriveItemRow>) {
  const names: string[] = [];
  let cursor: DriveItemRow | undefined = item;
  const seen = new Set<string>();
  while (cursor && !seen.has(cursor.id) && names.length < 50) {
    seen.add(cursor.id);
    names.unshift(cursor.name);
    cursor = cursor.parentId ? itemById.get(cursor.parentId) : undefined;
  }
  return `/${names.join("/")}`;
}

function itemDepth(path: string) {
  return Math.max(0, path.split("/").filter(Boolean).length - 1);
}

function stableUuid(input: string) {
  const hex = createHash("sha256").update(input).digest("hex");
  const variant = ((Number.parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, "0");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    `${variant}${hex.slice(18, 20)}`,
    hex.slice(20, 32)
  ].join("-");
}

function compactText(value: string | null | undefined, max = 260) {
  const text = value?.replace(/\s+/gu, " ").trim();
  if (!text) {
    return undefined;
  }
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

function proposalActorFromAuth(actor: AuthActor): ProposalActor {
  if (actor.kind === "human") {
    return {
      actor_kind: "human",
      actor_user_id: actor.userId ?? actor.id,
      label: actor.label
    };
  }
  return {
    actor_kind: actor.kind,
    label: actor.label
  };
}

function versionToVm(
  version: DriveVersionRow,
  currentVersionId: string | null,
  acceptedByVersionId: Map<string, AcceptedDeliverableVM>
): DriveFileVersionVM {
  const accepted = acceptedByVersionId.get(version.id);
  const vm: DriveFileVersionVM = {
    id: version.id,
    item_id: version.itemId,
    version_no: version.versionNo,
    filename: version.filename,
    size_bytes: version.sizeBytes,
    created_at: version.createdAt.toISOString(),
    current: currentVersionId === version.id,
    source: accepted ? "accepted_deliverable" : "manual_upload"
  };
  if (version.mime) {
    vm.mime = version.mime;
  }
  if (version.sha256) {
    vm.sha256 = version.sha256;
  }
  if (accepted) {
    vm.accepted_deliverable_id = accepted.id;
    vm.work_item_id = accepted.work_item_id;
    vm.proposal_id = accepted.proposal_id;
    if (accepted.preview_href) {
      vm.preview_href = accepted.preview_href;
    }
    if (accepted.download_href) {
      vm.download_href = accepted.download_href;
    }
    if (accepted.restore_href) {
      vm.restore_href = accepted.restore_href;
    }
  }
  return vm;
}

function commentStatus(status: string): "pending_llm" | "draft_created" | "proposal_created" | "dismissed" {
  if (status === "draft_created" || status === "proposal_created" || status === "dismissed") {
    return status;
  }
  return "pending_llm";
}

function operationSummary(operation: DriveOperationRow, pathByItemId: Map<string, string>) {
  const payload = operation.payloadJson as Record<string, unknown>;
  const itemId = typeof payload.drive_item_id === "string" ? payload.drive_item_id : undefined;
  const path = typeof payload.path === "string" ? payload.path : itemId ? pathByItemId.get(itemId) : undefined;
  const target = path ?? (typeof payload.filename === "string" ? payload.filename : "Drive item");
  if (operation.opType === "upload_file") {
    return `Uploaded ${target}`;
  }
  if (operation.opType === "delete_item") {
    return `Moved ${target} to recycle`;
  }
  if (operation.opType === "restore_item") {
    return `Restored ${target}`;
  }
  if (operation.opType === "restore_version") {
    return `Restored version for ${target}`;
  }
  if (operation.opType === "comment_to_draft") {
    const workItemId = typeof payload.work_item_id === "string" ? payload.work_item_id : "work item";
    return `Created draft ${workItemId} from Drive comment`;
  }
  if (operation.opType === "draft_to_proposal") {
    const proposalId = typeof payload.proposal_id === "string" ? payload.proposal_id : "proposal";
    return `Created proposal ${proposalId} from Drive draft`;
  }
  return `Updated ${target}`;
}

function operationToVm(operation: DriveOperationRow, pathByItemId: Map<string, string>): DriveOperationVM {
  const payload = operation.payloadJson as Record<string, unknown>;
  const itemId = typeof payload.drive_item_id === "string" ? payload.drive_item_id : undefined;
  const targetPath = typeof payload.path === "string" ? payload.path : itemId ? pathByItemId.get(itemId) : undefined;
  return {
    id: operation.id,
    project_id: operation.projectId,
    actor_user_id: operation.actorUserId,
    op_type: operation.opType === "upload_file" || operation.opType === "delete_item" || operation.opType === "restore_item" || operation.opType === "restore_version" || operation.opType === "rename_item" || operation.opType === "comment_to_draft" || operation.opType === "draft_to_proposal"
      ? operation.opType
      : "rename_item",
    ...(itemId ? { target_item_id: itemId } : {}),
    ...(targetPath ? { target_path: targetPath } : {}),
    summary_text: operationSummary(operation, pathByItemId),
    created_at: operation.createdAt.toISOString()
  };
}

function buildDriveItemVm(input: {
  item: DriveItemRow;
  pathByItemId: Map<string, string>;
  childrenCount: Map<string, number>;
  versionById: Map<string, DriveVersionRow>;
  versionVmById: Map<string, DriveFileVersionVM>;
  acceptedByItemId: Map<string, AcceptedDeliverableVM & { drive_item_id: string }>;
}): DriveItemVM {
  const item = input.item;
  const path = input.pathByItemId.get(item.id) ?? `/${item.name}`;
  const currentVersion = item.currentVersionId ? input.versionById.get(item.currentVersionId) : undefined;
  const currentVersionVm = currentVersion ? input.versionVmById.get(currentVersion.id) : undefined;
  const vm: DriveItemVM = {
    id: item.id,
    project_id: item.projectId,
    name: item.name,
    kind: item.kind === "folder" ? "folder" : "file",
    path,
    depth: itemDepth(path),
    children_count: input.childrenCount.get(item.id) ?? 0,
    updated_at: item.updatedAt.toISOString()
  };
  if (item.parentId) {
    vm.parent_id = item.parentId;
  }
  if (item.currentVersionId) {
    vm.current_version_id = item.currentVersionId;
  }
  if (currentVersionVm) {
    vm.current_version = currentVersionVm;
  }
  const accepted = input.acceptedByItemId.get(item.id);
  if (accepted) {
    vm.accepted_deliverable = accepted;
  }
  if (item.deletedAt) {
    vm.deleted_at = item.deletedAt.toISOString();
  }
  return vm;
}

function buildDrivePage(rows: DrivePageRows, now: Date, actor: AuthActor): DrivePageVM {
  const allItems = [...rows.items, ...rows.deletedItems];
  const itemById = new Map(allItems.map((item) => [item.id, item]));
  const pathByItemId = new Map(allItems.map((item) => [item.id, itemPath(item, itemById)]));
  const childrenCount = new Map<string, number>();
  for (const item of rows.items) {
    if (item.parentId) {
      childrenCount.set(item.parentId, (childrenCount.get(item.parentId) ?? 0) + 1);
    }
  }

  const acceptedDeliverables = rows.acceptedDeliverables.map(acceptedDeliverableToVm);
  const acceptedByVersionId = new Map(
    acceptedDeliverables
      .filter((accepted): accepted is AcceptedDeliverableVM & { drive_version_id: string } => !!accepted.drive_version_id)
      .map((accepted) => [accepted.drive_version_id, accepted])
  );
  // findings[#low]：同一 drive_item_id 可能有多条已采纳交付（多版本）。acceptedDeliverables 是
  // newest-first，而 new Map(entries) 是 last-wins → 会留下最旧的一条。改 first-wins 保留最新。
  const acceptedByItemId = new Map<string, AcceptedDeliverableVM & { drive_item_id: string }>();
  for (const accepted of acceptedDeliverables) {
    if (accepted.drive_item_id && !acceptedByItemId.has(accepted.drive_item_id)) {
      acceptedByItemId.set(accepted.drive_item_id, accepted as AcceptedDeliverableVM & { drive_item_id: string });
    }
  }
  const versionById = new Map(rows.versions.map((version) => [version.id, version]));
  const currentVersionIdByItemId = new Map(rows.items.map((item) => [item.id, item.currentVersionId]));
  const versionVms = rows.versions.map((version) =>
    versionToVm(version, currentVersionIdByItemId.get(version.itemId) ?? null, acceptedByVersionId)
  );
  const versionVmById = new Map(versionVms.map((version) => [version.id, version]));
  const itemVmInput = { pathByItemId, childrenCount, versionById, versionVmById, acceptedByItemId };
  const itemVms: DriveItemVM[] = rows.items.map((item) => buildDriveItemVm({ item, ...itemVmInput }));
  const deletedItemVms: DriveItemVM[] = rows.deletedItems.map((item) => buildDriveItemVm({ item, ...itemVmInput }));

  const pendingCommentCount = rows.comments.filter((comment) => commentStatus(comment.status) === "pending_llm").length;
  const manualFileDeleteCandidates = itemVms
    .filter((item) => item.kind === "file" && !item.accepted_deliverable)
    .sort((left, right) => Date.parse(right.updated_at) - Date.parse(left.updated_at));
  const emptyFolderDeleteCandidates = itemVms
    .filter((item) => item.kind === "folder" && !item.accepted_deliverable && item.children_count === 0)
    .sort((left, right) => Date.parse(right.updated_at) - Date.parse(left.updated_at));
  const deletableItem = manualFileDeleteCandidates[0] ?? emptyFolderDeleteCandidates[0];
  const selectedItemId = deletableItem?.id ?? itemVms.find((item) => item.kind === "file")?.id ?? itemVms[0]?.id;
  const projectId = rows.project?.id;
  const canManage = rows.project ? canManageProjectDrive(rows.project, actor) : false;
  const commentToDraft = canManage
    ? rows.comments.find((comment) => commentStatus(comment.status) === "pending_llm" && !comment.draftWorkItemId)
    : undefined;
  const latestProposalByWorkItemId = new Map<string, (typeof rows.commentProposals)[number]>();
  for (const proposal of rows.commentProposals) {
    const current = latestProposalByWorkItemId.get(proposal.workItemId);
    if (!current || proposal.createdAt > current.createdAt) {
      latestProposalByWorkItemId.set(proposal.workItemId, proposal);
    }
  }
  const data: DrivePageVM = {
    generated_at: now.toISOString(),
    summary: {
      item_count: itemVms.length,
      file_count: itemVms.filter((item) => item.kind === "file").length,
      folder_count: itemVms.filter((item) => item.kind === "folder").length,
      deleted_item_count: deletedItemVms.length,
      version_count: versionVms.length,
      accepted_deliverable_count: acceptedDeliverables.length,
      pending_comment_count: pendingCommentCount,
      operation_count: rows.operations.length
    },
    can_manage: canManage,
    ...(selectedItemId ? { selected_item_id: selectedItemId } : {}),
    items: itemVms,
    deleted_items: deletedItemVms,
    versions: versionVms,
    accepted_deliverables: acceptedDeliverables,
    comments: rows.comments.map((comment) => {
      const folderPath = comment.folderId ? pathByItemId.get(comment.folderId) : undefined;
      const canCreateDraft = canManage && projectId && commentStatus(comment.status) === "pending_llm" && !comment.draftWorkItemId;
      const proposal = comment.draftWorkItemId ? latestProposalByWorkItemId.get(comment.draftWorkItemId) : undefined;
      return {
        id: comment.id,
        project_id: comment.projectId,
        ...(comment.folderId ? { folder_id: comment.folderId } : {}),
        ...(folderPath ? { folder_path: folderPath } : {}),
        author_label: comment.authorNickname,
        body: comment.body,
        status: commentStatus(comment.status),
        created_at: comment.createdAt.toISOString(),
        ...(comment.draftWorkItemId ? {
          draft_work_item_id: comment.draftWorkItemId,
          draft_href: `/workitems/${comment.draftWorkItemId}`
        } : {}),
        ...(proposal ? {
          proposal_id: proposal.id,
          proposal_href: `/proposals/${proposal.id}`,
          proposal_status: proposal.status
        } : {}),
        ...(canCreateDraft ? {
          draft_action: {
            id: "drive_comment_to_draft",
            label: "Create draft",
            method: "POST",
            href: `/api/drive/projects/${projectId}/comments/${comment.id}/draft`
          }
        } : {})
      };
    }),
    operations: rows.operations.map((operation) => operationToVm(operation, pathByItemId)),
    actions: canManage && projectId ? {
      upload_file: {
        id: "drive_upload_file",
        label: "Upload sample",
        method: "POST",
        href: `/api/drive/projects/${projectId}/files`
      },
      delete_item: deletableItem ? {
        id: "drive_delete_item",
        label: `Move ${deletableItem.name} to recycle`,
        method: "POST",
        href: `/api/drive/projects/${projectId}/items/${deletableItem.id}/delete`
      } : undefined,
      restore_item: deletedItemVms[0] ? {
        id: "drive_restore_item",
        label: "Restore item",
        method: "POST",
        href: `/api/drive/projects/${projectId}/items/${deletedItemVms[0].id}/restore`
      } : undefined,
      comment_to_draft: commentToDraft ? {
        id: "drive_comment_to_draft",
        label: "Create draft",
        method: "POST",
        href: `/api/drive/projects/${projectId}/comments/${commentToDraft.id}/draft`
      } : undefined
    } : {},
    ...(rows.project ? {
      project: {
        id: rows.project.id,
        name: rows.project.name,
        slug: rows.project.slug,
        owner_label: rows.project.ownerNickname,
        status: "active"
      }
    } : { empty_state: "no_project" }),
    ...(rows.project && itemVms.length === 0 ? { empty_state: "no_drive_items" } : {})
  };
  return parseOutputContract(drivePageVmSchema, data, "drive.page");
}

export function createDrivePageService(deps: DrivePageServiceDependencies): DrivePageService {
  const proposalService = () => deps.proposals ?? getDefaultProposalService();
  const workItemService = () => deps.workItems ?? getDefaultWorkItemService();

  async function pageForActor(input: { actor: AuthActor; projectId?: string }) {
    const rows = await deps.repo.readPage({
      ...(input.projectId ? { projectId: input.projectId } : {}),
      // 无显式 projectId 时，默认项目限定在 actor 所在 workspace（M8：否则全库取最老项目，多租户落空）。
      ...(input.actor.workspaceId ? { workspaceId: input.actor.workspaceId } : {}),
      includeDeleted: true,
      operationLimit: 12
    });
    // 显式传了 project_id 却查不到(不存在/已归档/已删) → 404，与 /workitems、/proposals、项目主页一致，
    // 不再回 200+no_project 空态(那语义错误，且让前端无法区分"没选项目"和"项目不存在")。
    // 不传 project_id 的裸 /drive 仍走默认项目/空态，不 404。
    if (input.projectId && !rows.project) {
      throw new DrivePageServiceError(404, "没有找到这个项目网盘。", "drive_not_found");
    }
    if (rows.project && !canViewProjectDrive(rows.project, input.actor)) {
      if (!input.projectId) {
        return { project: null, items: [], versions: [], acceptedDeliverables: [], comments: [], deletedItems: [], operations: [], commentProposals: [] };
      }
      throw new DrivePageServiceError(403, "你没有权限查看这个项目网盘。", "drive_forbidden");
    }
    return rows;
  }

  function ensureHumanActor(input: DriveMutationInput) {
    if (!input.actor.userId) {
      throw new DrivePageServiceError(403, "只有具名用户可以管理项目网盘。", "drive_forbidden");
    }
    return input.actor.userId;
  }

  async function ensureCanManage(input: DriveMutationInput) {
    const rows = await pageForActor(input);
    if (!rows.project) {
      throw new DrivePageServiceError(404, "没有找到这个项目网盘。", "drive_not_found");
    }
    if (!canManageProjectDrive(rows.project, input.actor)) {
      throw new DrivePageServiceError(403, "你没有权限管理这个项目网盘。", "drive_forbidden");
    }
    return rows.project;
  }

  async function pageAfterMutation(input: DriveMutationInput) {
    return buildDrivePage(await pageForActor(input), deps.now?.() ?? new Date(), input.actor);
  }

  function mutationError(error: unknown): never {
    if (error instanceof DriveRepositoryConflictError) {
      throw new DrivePageServiceError(409, error.message, error.code);
    }
    throw error;
  }

  function driveDraftProposalManifest(input: {
    page: WorkItemDetailVM;
    actor: AuthActor;
    createdAt: Date;
  }) {
    const source = input.page.source_context;
    if (!source || source.source_type !== "drive_comment") {
      throw new DrivePageServiceError(409, "这个事项不是从网盘评论生成的草稿。", "drive_draft_source_missing");
    }
    const workItem = input.page.workitem;
    const titleBase = compactText(workItem.title ?? workItem.summary_md ?? source.body, 80) ?? "Drive comment proposal";
    const proposalId = stableUuid(`drive-draft-proposal:${workItem.id}:${source.comment_id}`);
    const branchId = stableUuid(`drive-draft-branch:${workItem.id}:${source.comment_id}`);
    const changeId = stableUuid(`drive-draft-change:${workItem.id}:${source.comment_id}`);
    const evidenceId = stableUuid(`drive-draft-evidence:${source.comment_id}`);
    const targetPath = `${source.folder_path ?? "/Drive"}/drive-comment-${workItem.code}.md`.replace(/\/{2,}/gu, "/");
    const sourcePreview = compactText(source.body, 240) ?? "Drive comment";
    const actorUserId = input.actor.kind === "human" ? input.actor.userId ?? input.actor.id : undefined;
    return {
      version: 0 as const,
      proposal_id: proposalId,
      work_item_id: workItem.id,
      branch_id: branchId,
      title: `Drive draft: ${titleBase}`,
      summary_md: [
        "Create a reviewable proposal from the Drive comment draft.",
        "",
        `Source comment: ${sourcePreview}`
      ].join("\n"),
      author: {
        actor_kind: input.actor.kind,
        ...(actorUserId ? { actor_user_id: actorUserId } : {}),
        label: input.actor.label ?? "WorkHub"
      },
      base: {
        created_at: input.createdAt.toISOString()
      },
      changes: [
        {
          id: changeId,
          target_kind: "text_doc" as const,
          target_ref: {
            entity_type: "drive_item" as const,
            ...(source.folder_id ? { entity_id: source.folder_id } : {}),
            path: targetPath
          },
          change_type: "generated" as const,
          human_summary: "Generate a proposal draft from the Drive comment.",
          machine_summary: {
            before_excerpt: "",
            after_excerpt: sourcePreview,
            changed_fields: ["drive_comment.body"]
          },
          preview_ref: {
            kind: "text" as const,
            href: `/workitems/${workItem.id}`
          },
          evidence_refs: [
            {
              id: evidenceId,
              source_type: "comment" as const,
              source_id: source.comment_id,
              title: `Drive comment from ${source.author_label}`,
              excerpt: sourcePreview,
              locator: {
                ...(source.folder_path ? { path: source.folder_path } : {})
              },
              confidence_hint: "found" as const,
              href: `/drive?project_id=${source.project_id}`
            }
          ]
        }
      ],
      checks: [
        {
          id: "drive_comment_source",
          label: "Drive comment source is attached",
          status: "passed" as const,
          detail: source.comment_id
        },
        {
          id: "human_review_required",
          label: "Proposal requires human review before merge",
          status: "passed" as const
        },
        {
          id: "drive_file_unchanged",
          label: "Drive official files are not changed by draft creation",
          status: "passed" as const
        }
      ],
      evidence_refs: [
        {
          id: evidenceId,
          source_type: "comment" as const,
          source_id: source.comment_id,
          title: `Drive comment from ${source.author_label}`,
          excerpt: sourcePreview,
          locator: {
            ...(source.folder_path ? { path: source.folder_path } : {})
          },
          confidence_hint: "found" as const,
          href: `/drive?project_id=${source.project_id}`
        }
      ],
      risk: {
        level: "low" as const,
        human_label: "Preview-only proposal; no Drive file is overwritten.",
        reversible: true
      },
      rollback: {
        available: true,
        description: "Discard this proposal to keep the Drive files unchanged."
      },
      review: {
        suggested_decision: "needs_human" as const,
        reason_required_on_reject: true as const
      }
    };
  }

  return {
    async page(input) {
      return buildDrivePage(await pageForActor(input), deps.now?.() ?? new Date(), input.actor);
    },
    async uploadFile(input) {
      const actorUserId = ensureHumanActor(input);
      await ensureCanManage(input);
      try {
        const created = await deps.repo.uploadFile({
          actorKind: input.actor.kind,
          actorUserId,
          projectId: input.projectId,
          filename: input.filename,
          ...(input.mime ? { mime: input.mime } : {}),
          sizeBytes: input.sizeBytes ?? Buffer.byteLength(input.parsedText ?? input.filename, "utf8"),
          ...(input.sha256 ? { sha256: input.sha256 } : {}),
          ...(input.parsedText ? { parsedText: input.parsedText } : {}),
          at: deps.now?.() ?? new Date()
        });
        if (!created) {
          throw new DrivePageServiceError(404, "没有找到这个项目网盘。", "drive_not_found");
        }
        return pageAfterMutation(input);
      } catch (error) {
        mutationError(error);
      }
    },
    async deleteItem(input) {
      const actorUserId = ensureHumanActor(input);
      await ensureCanManage(input);
      try {
        const deleted = await deps.repo.softDeleteItem({
          actorKind: input.actor.kind,
          actorUserId,
          projectId: input.projectId,
          itemId: input.itemId,
          ...(input.expectedCurrentVersionId !== undefined ? { expectedCurrentVersionId: input.expectedCurrentVersionId } : {}),
          at: deps.now?.() ?? new Date()
        });
        if (!deleted) {
          throw new DrivePageServiceError(404, "没有找到这个网盘项目。", "drive_not_found");
        }
        return pageAfterMutation(input);
      } catch (error) {
        mutationError(error);
      }
    },
    async restoreItem(input) {
      const actorUserId = ensureHumanActor(input);
      await ensureCanManage(input);
      try {
        const restored = await deps.repo.restoreDeletedItem({
          actorKind: input.actor.kind,
          actorUserId,
          projectId: input.projectId,
          itemId: input.itemId,
          at: deps.now?.() ?? new Date()
        });
        if (!restored) {
          throw new DrivePageServiceError(404, "没有找到这个回收站项目。", "drive_not_found");
        }
        return pageAfterMutation(input);
      } catch (error) {
        mutationError(error);
      }
    },
    async commentToDraft(input) {
      const actorUserId = ensureHumanActor(input);
      await ensureCanManage(input);
      try {
        const created = await deps.repo.commentToDraft({
          actorKind: input.actor.kind,
          actorUserId,
          projectId: input.projectId,
          commentId: input.commentId,
          at: deps.now?.() ?? new Date()
        });
        if (!created) {
          throw new DrivePageServiceError(404, "没有找到这条网盘评论。", "drive_comment_not_found");
        }
        return pageAfterMutation(input);
      } catch (error) {
        mutationError(error);
      }
    },
    async draftToProposal(input) {
      const actorUserId = ensureHumanActor({
        actor: input.actor,
        projectId: ""
      });
      const detailInput = {
        workItemId: input.workItemId,
        actor: input.actor,
        ...(input.locale ? { locale: input.locale } : {})
      };
      const initialPage = await workItemService().detailPage(detailInput);
      const source = initialPage.source_context;
      if (!source || source.source_type !== "drive_comment") {
        throw new DrivePageServiceError(409, "这个事项不是从网盘评论生成的草稿。", "drive_draft_source_missing");
      }
      await ensureCanManage({
        actor: input.actor,
        projectId: source.project_id
      });
      if (source.status === "dismissed") {
        throw new DrivePageServiceError(409, "这条网盘评论已经被忽略，不能生成变更提议。", "drive_comment_dismissed");
      }
      const existingProposalId = initialPage.latest_proposal?.proposal_id ?? source.proposal_id;
      if (existingProposalId) {
        // findings[#22/#24 后继]：提议已存在，但 draft→proposal 的跨服务写入可能在上次部分失败——
        // 评论仍停在 draft_created、draft_to_proposal operation/audit 从未落盘。这里 self-heal：
        // 重新调用（已幂等的）recordDraftProposal 把残留状态补完，再返回，而不是直接返回半成品。
        if (source.status !== "proposal_created") {
          await deps.repo.recordDraftProposal({
            actorKind: input.actor.kind,
            actorUserId,
            workItemId: input.workItemId,
            proposalId: existingProposalId,
            at: deps.now?.() ?? new Date()
          });
          return workItemService().detailPage({
            workItemId: input.workItemId,
            actor: input.actor,
            ...(input.locale ? { locale: input.locale } : {})
          });
        }
        return initialPage;
      }

      const createdAt = deps.now?.() ?? new Date();
      const manifest = driveDraftProposalManifest({
        page: initialPage,
        actor: input.actor,
        createdAt
      });
      const actor = proposalActorFromAuth(input.actor);
      try {
        const created = await proposalService().createFromManifest({
          workItemId: input.workItemId,
          manifest,
          actor,
          title: manifest.title,
          branchId: manifest.branch_id
        });
        await deps.repo.recordDraftProposal({
          actorKind: input.actor.kind,
          actorUserId,
          workItemId: input.workItemId,
          proposalId: created.id,
          at: createdAt
        });
      } catch (error) {
        if (error instanceof ProposalServiceError && error.code === "proposal_already_exists") {
          await deps.repo.recordDraftProposal({
            actorKind: input.actor.kind,
            actorUserId,
            workItemId: input.workItemId,
            proposalId: manifest.proposal_id,
            at: createdAt
          });
        } else if (error instanceof ProposalServiceError) {
          const status = error.status === 403 || error.status === 404 || error.status === 409 ? error.status : 409;
          throw new DrivePageServiceError(status, error.message, error.code);
        } else {
          throw error;
        }
      }
      return workItemService().detailPage({
        workItemId: input.workItemId,
        actor: input.actor,
        ...(input.locale ? { locale: input.locale } : {})
      });
    }
  };
}

let defaultDrivePageService: DrivePageService | undefined;
let defaultDrivePageDbClient: WorkHubDatabaseClient | undefined;

export function getDefaultDrivePageService() {
  if (!defaultDrivePageService) {
    defaultDrivePageDbClient = getSharedDatabaseClient();
    defaultDrivePageService = createDrivePageService({
      repo: createDriveRepository(defaultDrivePageDbClient.db)
    });
  }
  return defaultDrivePageService;
}
