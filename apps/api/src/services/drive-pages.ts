import {
  createDatabaseClient,
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
  type WorkHubLocale
} from "@workhub/contracts";
import { canManageProjectDrive, canViewProjectDrive } from "@workhub/permissions";

import type { AuthActor } from "../middleware/auth.js";
import { acceptedDeliverableToVm } from "./accepted-deliverables.js";

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
};

export type DrivePageServiceDependencies = {
  repo: DriveRepository;
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

function commentStatus(status: string): "pending_llm" | "draft_created" | "dismissed" {
  if (status === "draft_created" || status === "dismissed") {
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
    op_type: operation.opType === "upload_file" || operation.opType === "delete_item" || operation.opType === "restore_item" || operation.opType === "restore_version" || operation.opType === "rename_item" || operation.opType === "comment_to_draft"
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
  const acceptedByItemId = new Map(
    acceptedDeliverables
      .filter((accepted): accepted is AcceptedDeliverableVM & { drive_item_id: string } => !!accepted.drive_item_id)
      .map((accepted) => [accepted.drive_item_id, accepted])
  );
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
  return drivePageVmSchema.parse(data);
}

export function createDrivePageService(deps: DrivePageServiceDependencies): DrivePageService {
  async function pageForActor(input: { actor: AuthActor; projectId?: string }) {
    const rows = await deps.repo.readPage({
      ...(input.projectId ? { projectId: input.projectId } : {}),
      includeDeleted: true,
      operationLimit: 12
    });
    if (rows.project && !canViewProjectDrive(rows.project, input.actor)) {
      if (!input.projectId) {
        return { project: null, items: [], versions: [], acceptedDeliverables: [], comments: [], deletedItems: [], operations: [] };
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
    }
  };
}

let defaultDrivePageService: DrivePageService | undefined;
let defaultDrivePageDbClient: WorkHubDatabaseClient | undefined;

export function getDefaultDrivePageService() {
  if (!defaultDrivePageService) {
    defaultDrivePageDbClient = createDatabaseClient();
    defaultDrivePageService = createDrivePageService({
      repo: createDriveRepository(defaultDrivePageDbClient.db)
    });
  }
  return defaultDrivePageService;
}
