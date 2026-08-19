import { createHash } from "node:crypto";
import { rm } from "node:fs/promises";

import {
  getSharedDatabaseClient,
  createDriveRepository,
  createWorkItemRepository,
  DriveRepositoryConflictError,
  type DriveItemRow,
  type DriveOperationRow,
  type DrivePageRows,
  type DriveRepository,
  type DriveVersionRow,
  type WorkItemAccessRow,
  type WorkItemDataRepository,
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
import { ASSIGNMENT_ROLES, canManageProjectDrive, canViewProjectDrive, canViewWorkItemRecord } from "@workhub/permissions";

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
    // #5：项目主页「最近文件」深链带 item_id → 网盘渲染时高亮该文件。
    itemId?: string;
    // R4（规模化）：按名称搜索——200 条截断外的文件用户可达出路。
    nameQuery?: string;
  }) => Promise<DrivePageVM>;
  file: (input: DriveMutationInput & {
    itemId: string;
  }) => Promise<DriveStoredFile>;
  uploadFile: (input: DriveMutationInput & {
    parentId?: string | null;
    filename: string;
    mime?: string;
    sizeBytes?: number;
    storagePath?: string;
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
  // UX-U3：网盘评论 composer 的写端——发一条评论（进入 pending_llm，后续可生成草稿）。
  createComment: (input: DriveMutationInput & {
    body: string;
    folderId?: string;
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
  workItems?: Pick<WorkItemService, "detailPage" | "assertCanMutateArtifacts">;
  // xlink-authz-2：findWorkItemAccessRecords（批量）是可选的——真实仓库都实现了它，workItemLinkAccessForActor
  // 命中即用一次批量查询；未实现时（部分测试假仓库只给单条方法）退回并发单查，语义不变、只是慢一点。
  workItemAccess?: Pick<WorkItemDataRepository, "findWorkItemAccessRecord"> & {
    findWorkItemAccessRecords?: WorkItemDataRepository["findWorkItemAccessRecords"];
  };
  now?: () => Date;
};

export type DriveMutationInput = {
  actor: AuthActor;
  projectId: string;
  locale?: WorkHubLocale;
};

export type DriveStoredFile = {
  id: string;
  itemId: string;
  projectId: string;
  filename: string;
  mime?: string;
  sizeBytes: number;
  storagePath: string;
  sha256?: string;
  parsedText?: string;
};

type WorkItemLinkAccess = {
  readable: ReadonlySet<string>;
  restorable: ReadonlySet<string>;
};

export class DrivePageServiceError extends Error {
  constructor(
    public readonly status: 400 | 403 | 404 | 409 | 413,
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

function sha256Text(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function compactText(value: string | null | undefined, max = 260) {
  const text = value?.replace(/\s+/gu, " ").trim();
  if (!text) {
    return undefined;
  }
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

function isDriveTextPreview(filename: string, mime?: string | null) {
  const normalizedMime = mime?.toLowerCase() ?? "";
  const lower = filename.toLowerCase();
  return normalizedMime.startsWith("text/")
    || normalizedMime === "application/json"
    || normalizedMime === "application/xml"
    || normalizedMime === "application/yaml"
    || /\.(csv|json|md|markdown|txt|tsv|html|xml|yaml|yml)$/u.test(lower);
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

function filterAcceptedDeliverableLinks(
  accepted: AcceptedDeliverableVM,
  linkAccess?: WorkItemLinkAccess,
  locale: WorkHubLocale = "zh-CN"
): AcceptedDeliverableVM {
  if (!linkAccess) {
    return accepted;
  }
  if (!linkAccess.readable.has(accepted.work_item_id)) {
    const {
      download_href: _downloadHref,
      preview_href: _previewHref,
      restore_href: _restoreHref,
      ...rest
    } = accepted;
    return {
      ...rest,
      access_notice: locale === "zh-CN"
        ? "受限：需要拥有来源工作项权限后才能预览或下载这个交付物。"
        : "Restricted: you need access to the backing work item to preview or download this deliverable."
    };
  }
  if (linkAccess.restorable.has(accepted.work_item_id)) {
    return accepted;
  }
  const {
    restore_href: _restoreHref,
    ...rest
  } = accepted;
  return rest;
}

function acceptedDeliverableVersionMarker(accepted: AcceptedDeliverableVM): AcceptedDeliverableVM {
  const {
    download_href: _downloadHref,
    preview_href: _previewHref,
    restore_href: _restoreHref,
    ...marker
  } = accepted;
  return marker;
}

function canMutateAcceptedDeliverables(record: WorkItemAccessRow, actor: AuthActor) {
  const actorUserId = actor.userId ?? actor.id;
  const inWorkspace = !actor.workspaceId
    || actor.workspaceId === record.workspaceId
    || actor.workspaceId === record.project?.workspaceId;
  const projectActive = Boolean(record.project && !record.project.archived && record.project.deletedAt == null);
  const canWorkAssignment = record.assignments?.some(
    (assignment) => assignment.userId === actorUserId && (ASSIGNMENT_ROLES as readonly string[]).includes(assignment.role)
  ) ?? false;
  const ownsOrWorksItem = record.project?.ownerUserId === actorUserId
    || record.submitterUserId === actorUserId
    || record.claimedByUserId === actorUserId
    || canWorkAssignment;
  return projectActive && inWorkspace && (actor.isAdmin === true || ownsOrWorksItem);
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
  protectedAcceptedItemIds: ReadonlySet<string>;
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
  if (item.kind === "file" && currentVersion && !item.deletedAt) {
    if (accepted) {
      if (accepted.download_href) {
        vm.download_href = accepted.download_href;
      }
      if (accepted.preview_href) {
        vm.preview_href = accepted.preview_href;
      }
    } else if (!input.protectedAcceptedItemIds.has(item.id)) {
      vm.download_href = `/api/drive/projects/${item.projectId}/items/${item.id}/download`;
      if (isDriveTextPreview(currentVersion.filename, currentVersion.mime)) {
        vm.preview_href = `/api/drive/projects/${item.projectId}/items/${item.id}/preview`;
      }
    }
  }
  if (accepted) {
    vm.accepted_deliverable = accepted;
  }
  if (item.deletedAt) {
    vm.deleted_at = item.deletedAt.toISOString();
  }
  return vm;
}

function buildDrivePage(
  rows: DrivePageRows,
  now: Date,
  actor: AuthActor,
  requestedItemId?: string,
  linkAccess?: WorkItemLinkAccess,
  locale: WorkHubLocale = "zh-CN",
  nameQuery?: string
): DrivePageVM {
  const allItems = [...rows.items, ...rows.deletedItems];
  const itemById = new Map(allItems.map((item) => [item.id, item]));
  const pathByItemId = new Map(allItems.map((item) => [item.id, itemPath(item, itemById)]));
  // DF-3：优先用仓库的全量 count(*) group by parent_id;只有它缺失(旧调用/假仓库)时才回退到从已载入的
  // (受 200 行上限截断的)items 数 —— 否则子项排在 200 之外的文件夹会读成 children_count=0,被误判空可删。
  const childrenCount = new Map<string, number>();
  if (rows.childCountsByParent) {
    for (const { parentId, count } of rows.childCountsByParent) {
      childrenCount.set(parentId, count);
    }
  } else {
    for (const item of rows.items) {
      if (item.parentId) {
        childrenCount.set(item.parentId, (childrenCount.get(item.parentId) ?? 0) + 1);
      }
    }
  }

  const rawAcceptedDeliverableVms = rows.acceptedDeliverables
    .map((row) => acceptedDeliverableToVm(row))
    .map((accepted, index) => {
      const filtered = filterAcceptedDeliverableLinks(accepted, linkAccess, locale);
      return rows.acceptedDeliverables[index]?.accepted.supersededAt
        ? acceptedDeliverableVersionMarker(filtered)
        : filtered;
    });
  const acceptedDeliverables = rawAcceptedDeliverableVms.filter(
    (accepted, index) =>
      rows.acceptedDeliverables[index]?.accepted.supersededAt == null
  );
  const readableAcceptedDeliverables = acceptedDeliverables.filter(
    (accepted) => !linkAccess || linkAccess.readable.has(accepted.work_item_id)
  );
  const visibleAcceptedVersionCandidates = rawAcceptedDeliverableVms
    .map((accepted, index) => ({
      accepted,
      row: rows.acceptedDeliverables[index]
    }))
    .filter((entry): entry is {
      accepted: AcceptedDeliverableVM & { drive_version_id: string };
      row: NonNullable<DrivePageRows["acceptedDeliverables"][number]>;
    } =>
      !!entry.row
      && !!entry.accepted.drive_version_id
      && (!linkAccess || linkAccess.readable.has(entry.accepted.work_item_id))
    );
  const acceptedByVersionId = new Map<string, AcceptedDeliverableVM & { drive_version_id: string }>();
  for (const { accepted, row } of visibleAcceptedVersionCandidates) {
    if (row.accepted.supersededAt == null && !acceptedByVersionId.has(accepted.drive_version_id)) {
      acceptedByVersionId.set(accepted.drive_version_id, accepted);
    }
  }
  for (const { accepted } of visibleAcceptedVersionCandidates) {
    if (!acceptedByVersionId.has(accepted.drive_version_id)) {
      acceptedByVersionId.set(accepted.drive_version_id, accepted);
    }
  }
  // findings[#low]：同一 drive_item_id 可能有多条已采纳交付（多版本）。acceptedDeliverables 是
  // newest-first，而 new Map(entries) 是 last-wins → 会留下最旧的一条。改 first-wins 保留最新。
  const acceptedByItemId = new Map<string, AcceptedDeliverableVM & { drive_item_id: string }>();
  for (const accepted of readableAcceptedDeliverables) {
    if (accepted.drive_item_id && !acceptedByItemId.has(accepted.drive_item_id)) {
      acceptedByItemId.set(accepted.drive_item_id, accepted as AcceptedDeliverableVM & { drive_item_id: string });
    }
  }
  const protectedAcceptedItemIds = new Set(
    rows.acceptedDeliverables
      .filter((row) => row.accepted.supersededAt == null)
      .filter((row) => row.driveItem?.id)
      .filter((row) => linkAccess && !linkAccess.readable.has(row.accepted.workItemId))
      .map((row) => row.driveItem!.id)
  );
  const versionById = new Map(rows.versions.map((version) => [version.id, version]));
  const currentVersionIdByItemId = new Map(allItems.map((item) => [item.id, item.currentVersionId]));
  const versionVms = rows.versions.map((version) =>
    versionToVm(version, currentVersionIdByItemId.get(version.itemId) ?? null, acceptedByVersionId)
  );
  const versionVmById = new Map(versionVms.map((version) => [version.id, version]));
  const itemVmInput = { pathByItemId, childrenCount, versionById, versionVmById, acceptedByItemId, protectedAcceptedItemIds };
  const itemVms: DriveItemVM[] = rows.items.map((item) => buildDriveItemVm({ item, ...itemVmInput }));
  const deletedItemVms: DriveItemVM[] = rows.deletedItems.map((item) => buildDriveItemVm({ item, ...itemVmInput }));
  const loadedFileCount = itemVms.filter((item) => item.kind === "file").length;
  const loadedFolderCount = itemVms.filter((item) => item.kind === "folder").length;
  const totalFileCount = Math.max(loadedFileCount, rows.totalFileCount ?? 0);
  const totalFolderCount = Math.max(loadedFolderCount, rows.totalFolderCount ?? 0);
  const totalItemCount = Math.max(itemVms.length, rows.totalItemCount ?? totalFileCount + totalFolderCount);
  const totalDeletedItemCount = Math.max(deletedItemVms.length, rows.totalDeletedItemCount ?? 0);

  const loadedPendingCommentCount = rows.comments.filter((comment) => commentStatus(comment.status) === "pending_llm").length;
  const manualFileDeleteCandidates = itemVms
    .filter((item) => item.kind === "file" && !item.accepted_deliverable && !protectedAcceptedItemIds.has(item.id))
    .sort((left, right) => Date.parse(right.updated_at) - Date.parse(left.updated_at));
  const emptyFolderDeleteCandidates = itemVms
    .filter((item) => item.kind === "folder" && !item.accepted_deliverable && item.children_count === 0)
    .sort((left, right) => Date.parse(right.updated_at) - Date.parse(left.updated_at));
  const deletableItem = manualFileDeleteCandidates[0] ?? emptyFolderDeleteCandidates[0];
  // #5：从项目主页「最近文件」深链进来时带 item_id → 优先高亮该文件(必须确实存在于清单)；
  // 否则回退到原默认(可删项/首个文件/首项)，避免无效 id 高亮空。
  const selectableItemVms = [...itemVms, ...deletedItemVms];
  const requestedSelected = requestedItemId && selectableItemVms.some((item) => item.id === requestedItemId)
    ? requestedItemId
    : undefined;
  const requestedItemMissing = Boolean(requestedItemId && !requestedSelected);
  const selectedItemId = requestedItemMissing
    ? undefined
    : requestedSelected ?? deletableItem?.id ?? itemVms.find((item) => item.kind === "file")?.id ?? itemVms[0]?.id;
  const projectId = rows.project?.id;
  const canManage = rows.project ? canManageProjectDrive(rows.project, actor) : false;
  // F3：给每个回收站项一个自己的 restore_href、每个可删项(文件或空文件夹)一个自己的 delete_href,
  // 让 UI 逐行渲染 Restore/Delete。此前只有全局按钮(restore 钉死 deleted[0]、delete 钉死单个 deletable),
  // 想恢复第 2/3 个删除项或删非首选文件都点不到。端点本就是逐项的(.../items/:id/restore|delete),仅缺逐项暴露。
  if (canManage && projectId) {
    const deletedItemIds = new Set(deletedItemVms.map((item) => item.id));
    const activeNameKeys = new Set(itemVms.map((item) => `${item.parent_id ?? ""}\u0000${item.name}`));
    const restoreBlockedItemIds = new Set(rows.restoreBlockedItemIds ?? []);
    for (const item of deletedItemVms) {
      const parentStillDeleted = item.parent_id ? deletedItemIds.has(item.parent_id) : false;
      const activeNameConflict = activeNameKeys.has(`${item.parent_id ?? ""}\u0000${item.name}`);
      if (!parentStillDeleted && !activeNameConflict && !restoreBlockedItemIds.has(item.id)) {
        item.restore_href = `/api/drive/projects/${projectId}/items/${item.id}/restore`;
      } else {
        // R7（撤销路径）：还原按钮消失时说明白为什么——三种阻塞在视觉上曾与可还原行完全一样。
        item.restore_blocked_reason = parentStillDeleted
          ? "父文件夹也在回收站，先还原父文件夹。"
          : activeNameConflict
            ? "已有同名文件占位，改名或删除后再还原。"
            : "该项暂不可还原。";
      }
    }
    const deletableIds = new Set(
      [...manualFileDeleteCandidates, ...emptyFolderDeleteCandidates].map((item) => item.id)
    );
    for (const item of itemVms) {
      if (deletableIds.has(item.id)) {
        item.delete_href = `/api/drive/projects/${projectId}/items/${item.id}/delete`;
      }
    }
  }
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
      // item/file/folder 三个主统计都取项目内 active 总数；items 树只是当前加载窗口，避免 >limit 时出现 file_count > item_count。
      item_count: totalItemCount,
      file_count: totalFileCount,
      folder_count: totalFolderCount,
      deleted_item_count: totalDeletedItemCount,
      version_count: Math.max(versionVms.length, rows.totalVersionCount ?? 0),
      accepted_deliverable_count: linkAccess
        ? acceptedDeliverables.length
        : Math.max(acceptedDeliverables.length, rows.totalAcceptedDeliverableCount ?? 0),
      pending_comment_count: Math.max(loadedPendingCommentCount, rows.totalPendingCommentCount ?? 0),
      operation_count: Math.max(rows.operations.length, rows.totalOperationCount ?? 0)
    },
    can_manage: canManage,
    ...(selectedItemId ? { selected_item_id: selectedItemId } : {}),
    ...(requestedItemMissing ? { requested_item_missing: true } : {}),
    items: itemVms,
    deleted_items: deletedItemVms,
    versions: versionVms,
    accepted_deliverables: acceptedDeliverables,
    comments: rows.comments.map((comment) => {
      const folderPath = comment.folderId ? pathByItemId.get(comment.folderId) : undefined;
      const canCreateDraft = canManage && projectId && commentStatus(comment.status) === "pending_llm" && !comment.draftWorkItemId;
      const proposal = comment.draftWorkItemId ? latestProposalByWorkItemId.get(comment.draftWorkItemId) : undefined;
      const canLinkDraft = !comment.draftWorkItemId || !linkAccess || linkAccess.readable.has(comment.draftWorkItemId);
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
          ...(canLinkDraft ? { draft_href: `/workitems/${comment.draftWorkItemId}` } : {})
        } : {}),
        ...(proposal && canLinkDraft ? {
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
        label: "Upload file",
        method: "POST",
        href: `/api/drive/projects/${projectId}/files`
      },
      delete_item: deletableItem ? {
        id: "drive_delete_item",
        label: `Move ${deletableItem.name} to recycle`,
        method: "POST",
        href: `/api/drive/projects/${projectId}/items/${deletableItem.id}/delete`
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
    // 搜索无命中 vs 真空盘：nameQuery 非空且过滤后 0 命中 → no_search_match，否则真空盘 no_drive_items。
    ...(rows.project && itemVms.length === 0
      ? { empty_state: nameQuery ? "no_search_match" : "no_drive_items" }
      : {}),
    // nameQuery 非空时回填查询串（不论有无命中），供前端诚实提示「关于 X 的搜索」。
    ...(nameQuery ? { search_query: nameQuery } : {})
  };
  return parseOutputContract(drivePageVmSchema, data, "drive.page");
}

export function createDrivePageService(deps: DrivePageServiceDependencies): DrivePageService {
  const proposalService = () => deps.proposals ?? getDefaultProposalService();
  const workItemService = () => deps.workItems ?? getDefaultWorkItemService();
  const workItemAccess = () => deps.workItemAccess;

  async function workItemLinkAccessForActor(input: { actor: AuthActor; workItemIds: Iterable<string> }) {
    const access = workItemAccess();
    if (!access) {
      return undefined;
    }
    const uniqueIds = [...new Set([...input.workItemIds].filter(Boolean))];
    const readable = new Set<string>();
    const restorable = new Set<string>();
    const actorUserId = input.actor.userId ?? input.actor.id;
    // xlink-authz-2：原先对每个 work item id 串行 await findWorkItemAccessRecord（一个页面可能挂几十个
    // 采纳交付物/评论草稿），改用一次批量查询（fake repo 没实现批量接口时退回逐条查，语义不变）。
    const recordsByWorkItemId = access.findWorkItemAccessRecords
      ? await access.findWorkItemAccessRecords(uniqueIds)
      : new Map(
        (await Promise.all(uniqueIds.map(async (workItemId) => [workItemId, await access.findWorkItemAccessRecord(workItemId)] as const)))
          .filter((entry): entry is [string, NonNullable<typeof entry[1]>] => Boolean(entry[1]))
      );
    for (const workItemId of uniqueIds) {
      const record = recordsByWorkItemId.get(workItemId);
      if (record && canViewWorkItemRecord(record, { id: actorUserId, isAdmin: input.actor.isAdmin }, { workspaceId: input.actor.workspaceId })) {
        readable.add(workItemId);
        if (canMutateAcceptedDeliverables(record, input.actor)) {
          restorable.add(workItemId);
        }
      }
    }
    return { readable, restorable };
  }

  async function assertAcceptedDriveFileReadable(input: { actor: AuthActor; projectId: string; itemId: string; versionId: string }) {
    if (!workItemAccess()) {
      return;
    }
    // services-a-5：下载/预览是网盘热路径，原先每次都跑一趟完整 readPage（200 items + 5 个 count
    // 聚合 + 祖先链）只为过滤出这个 item+version 挂在哪些采纳交付物上。改用窄方法直查；
    // 仓库未实现窄方法时（如某些测试假仓库）退回原 readPage 路径，结果集完全一致。
    const workItemIds = deps.repo.findAcceptedDeliverableWorkItemIds
      ? await deps.repo.findAcceptedDeliverableWorkItemIds({
        projectId: input.projectId,
        driveItemId: input.itemId,
        driveVersionId: input.versionId
      })
      : (await deps.repo.readPage({
        projectId: input.projectId,
        targetItemId: input.itemId,
        includeDeleted: false,
        operationLimit: 1
      })).acceptedDeliverables
        .filter((row) => row.accepted.driveItemId === input.itemId)
        .filter((row) => row.accepted.driveVersionId === input.versionId)
        .map((row) => row.accepted.workItemId);
    if (workItemIds.length === 0) {
      return;
    }
    const linkAccess = await workItemLinkAccessForActor({
      actor: input.actor,
      workItemIds
    });
    if (!workItemIds.some((workItemId) => linkAccess?.readable.has(workItemId))) {
      throw new DrivePageServiceError(403, "你没有权限查看这个正式交付物文件。", "drive_forbidden");
    }
  }

  async function pageForActor(input: { actor: AuthActor; projectId?: string; itemId?: string; nameQuery?: string }) {
    const rows = await deps.repo.readPage({
      ...(input.projectId ? { projectId: input.projectId } : {}),
      // 无显式 projectId 时，默认项目限定在 actor 所在 workspace（M8：否则全库取最老项目，多租户落空）。
      ...(input.actor.workspaceId ? { workspaceId: input.actor.workspaceId } : {}),
      includeDeleted: true,
      operationLimit: 12,
      ...(input.itemId ? { targetItemId: input.itemId } : {}),
      ...(input.nameQuery ? { nameQuery: input.nameQuery } : {})
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
    // 取项目内文件总数 + 每父文件夹真实子项数(均不受 items 200 行树上限影响),供 summary.file_count 与
    // children_count/空文件夹删除候选用——与项目主页同口径,且避免 >200 项时把有子项的文件夹误判为空可删(DF-3)。
    if (rows.project) {
      const [totalFileCount, childCountsByParent] = await Promise.all([
        deps.repo.countFilesByProject(rows.project.id),
        deps.repo.countChildrenByParent?.(rows.project.id)
      ]);
      return { ...rows, totalFileCount, ...(childCountsByParent ? { childCountsByParent } : {}) };
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

  async function pageAfterMutation(input: DriveMutationInput, targetItemId?: string) {
    const rows = await pageForActor({
      ...input,
      ...(targetItemId ? { itemId: targetItemId } : {})
    });
    const linkAccess = await workItemLinkAccessForActor({
      actor: input.actor,
      workItemIds: [
        ...rows.comments.map((comment) => comment.draftWorkItemId).filter((id): id is string => Boolean(id)),
        ...rows.acceptedDeliverables.map((accepted) => accepted.accepted.workItemId)
      ]
    });
    return buildDrivePage(rows, deps.now?.() ?? new Date(), input.actor, targetItemId, linkAccess, input.locale);
  }

  function mutationError(error: unknown): never {
    if (error instanceof DriveRepositoryConflictError) {
      throw new DrivePageServiceError(409, error.message, error.code);
    }
    throw error;
  }

  async function cleanupRejectedUpload(storagePath?: string) {
    if (!storagePath) {
      return;
    }
    await rm(storagePath, { force: true }).catch(() => undefined);
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
    const drivePath = `${source.folder_path ?? "/Drive"}/drive-comment-${workItem.code}.md`.replace(/\/{2,}/gu, "/");
    const targetPath = `/outputs${drivePath.startsWith("/") ? drivePath : `/${drivePath}`}`;
    const sourcePreview = compactText(source.body, 240) ?? "Drive comment";
    const sourceBody = source.body.trim().length > 0 ? source.body.trim() : "（空评论）";
    const generatedContent = [
      `# ${titleBase}`,
      "",
      "## 来源评论",
      "",
      sourceBody,
      "",
      "## 交付建议",
      "",
      "请基于这条网盘评论完善后续交付物，并在审阅后采纳到项目网盘。"
    ].join("\n");
    const generatedSha = sha256Text(generatedContent);
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
            entity_type: "delivery" as const,
            path: targetPath,
            sha256_after: generatedSha
          },
          change_type: "generated" as const,
          human_summary: "Generate a proposal draft from the Drive comment.",
          machine_summary: {
            before_excerpt: "",
            after_excerpt: sourcePreview,
            generated_content_md: generatedContent,
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
      const rows = await pageForActor(input);
      const linkAccess = await workItemLinkAccessForActor({
        actor: input.actor,
        workItemIds: [
          ...rows.comments.map((comment) => comment.draftWorkItemId).filter((id): id is string => Boolean(id)),
          ...rows.acceptedDeliverables.map((accepted) => accepted.accepted.workItemId)
        ]
      });
      return buildDrivePage(rows, deps.now?.() ?? new Date(), input.actor, input.itemId, linkAccess, input.locale, input.nameQuery);
    },
    async file(input) {
      const rows = await deps.repo.readFile?.({ projectId: input.projectId, itemId: input.itemId });
      if (!rows?.project) {
        throw new DrivePageServiceError(404, "没有找到这个项目网盘。", "drive_not_found");
      }
      if (!canViewProjectDrive(rows.project, input.actor)) {
        throw new DrivePageServiceError(403, "你没有权限查看这个项目网盘。", "drive_forbidden");
      }
      if (!rows.item || !rows.version || rows.item.deletedAt || rows.item.kind !== "file") {
        throw new DrivePageServiceError(404, "没有找到这个网盘文件。", "drive_file_not_found");
      }
      await assertAcceptedDriveFileReadable({
        actor: input.actor,
        projectId: input.projectId,
        itemId: input.itemId,
        versionId: rows.version.id
      });
      return {
        id: rows.version.id,
        itemId: rows.item.id,
        projectId: rows.item.projectId,
        filename: rows.version.filename,
        ...(rows.version.mime ? { mime: rows.version.mime } : {}),
        sizeBytes: rows.version.sizeBytes,
        storagePath: rows.version.storagePath,
        ...(rows.version.sha256 ? { sha256: rows.version.sha256 } : {}),
        ...(rows.version.parsedText ? { parsedText: rows.version.parsedText } : {})
      };
    },
    async uploadFile(input) {
      let committed = false;
      try {
        const actorUserId = ensureHumanActor(input);
        await ensureCanManage(input);
        const created = await deps.repo.uploadFile({
          actorKind: input.actor.kind,
          actorUserId,
          projectId: input.projectId,
          ...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
          filename: input.filename,
          ...(input.mime ? { mime: input.mime } : {}),
          sizeBytes: input.sizeBytes ?? Buffer.byteLength(input.parsedText ?? input.filename, "utf8"),
          ...(input.storagePath ? { storagePath: input.storagePath } : {}),
          ...(input.sha256 ? { sha256: input.sha256 } : {}),
          ...(input.parsedText ? { parsedText: input.parsedText } : {}),
          at: deps.now?.() ?? new Date()
        });
        if (!created) {
          throw new DrivePageServiceError(404, "没有找到这个项目网盘。", "drive_not_found");
        }
        committed = true;
        return await pageAfterMutation(input, created.item.id);
      } catch (error) {
        if (!committed) {
          await cleanupRejectedUpload(input.storagePath);
        }
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
          throw new DrivePageServiceError(404, "没有找到这个网盘文件。", "drive_file_not_found");
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
          throw new DrivePageServiceError(404, "没有找到这个回收站文件。", "drive_file_not_found");
        }
        return pageAfterMutation(input, restored.item.id);
      } catch (error) {
        mutationError(error);
      }
    },
    async createComment(input) {
      const actorUserId = ensureHumanActor(input);
      await ensureCanManage(input);
      const body = input.body.trim();
      if (!body) {
        throw new DrivePageServiceError(400, "评论内容不能为空。", "drive_comment_body_required");
      }
      if (body.length > 4000) {
        throw new DrivePageServiceError(400, "评论最长 4000 字。", "drive_comment_body_too_long");
      }
      const created = await deps.repo.createComment({
        actorKind: input.actor.kind,
        actorUserId,
        projectId: input.projectId,
        body,
        authorNickname: input.actor.label,
        ...(input.folderId ? { folderId: input.folderId } : {}),
        at: deps.now?.() ?? new Date()
      });
      if (!created) {
        throw new DrivePageServiceError(404, "没有找到这个项目。", "drive_not_found");
      }
      return pageAfterMutation(input);
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
      const workItems = workItemService();
      const initialPage = await workItems.detailPage(detailInput);
      await workItems.assertCanMutateArtifacts({
        workItemId: input.workItemId,
        actor: input.actor
      });
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
          return workItems.detailPage({
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
      return workItems.detailPage({
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
      repo: createDriveRepository(defaultDrivePageDbClient.db),
      workItemAccess: createWorkItemRepository(defaultDrivePageDbClient.db)
    });
  }
  return defaultDrivePageService;
}
