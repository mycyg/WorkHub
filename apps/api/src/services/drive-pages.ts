import {
  createDatabaseClient,
  createDriveRepository,
  type DriveAcceptedDeliverableRow,
  type DriveItemRow,
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
  type DrivePageVM,
  type WorkHubLocale
} from "@workhub/contracts";

import type { AuthActor } from "../middleware/auth.js";

export type DrivePageService = {
  page: (input: {
    actor: AuthActor;
    locale?: WorkHubLocale;
    projectId?: string;
  }) => Promise<DrivePageVM>;
};

export type DrivePageServiceDependencies = {
  repo: DriveRepository;
  now?: () => Date;
};

function isPreviewableText(mime?: string | null, filename?: string | null) {
  const lower = (filename ?? "").toLowerCase();
  return !!mime?.startsWith("text/")
    || mime === "application/json"
    || lower.endsWith(".md")
    || lower.endsWith(".json")
    || lower.endsWith(".csv")
    || lower.endsWith(".txt");
}

function acceptedDeliverableToVm(row: DriveAcceptedDeliverableRow): AcceptedDeliverableVM {
  const accepted = row.accepted;
  const driveVersion = row.driveVersion;
  const filename = driveVersion?.filename ?? (accepted.targetPath ? accepted.targetPath.split(/[\\/]/u).pop() : undefined);
  const vm: AcceptedDeliverableVM = {
    id: accepted.id,
    work_item_id: accepted.workItemId,
    proposal_id: accepted.proposalId,
    change_id: accepted.changeId,
    target_kind: accepted.targetKind,
    target_key: accepted.targetKey,
    change_type: accepted.changeType,
    accepted_version: accepted.acceptedVersion,
    accepted_at: accepted.createdAt.toISOString()
  };
  if (accepted.targetPath) {
    vm.target_path = accepted.targetPath;
  }
  if (accepted.sha256After) {
    vm.sha256 = accepted.sha256After;
  }
  if (row.driveItem?.id) {
    vm.drive_item_id = row.driveItem.id;
  }
  if (driveVersion) {
    vm.drive_version_id = driveVersion.id;
    vm.filename = filename ?? driveVersion.filename;
    if (driveVersion.mime) {
      vm.mime = driveVersion.mime;
    }
    vm.size_bytes = driveVersion.sizeBytes;
    vm.download_href = `/api/workitems/${accepted.workItemId}/deliverables/${accepted.id}/download`;
    if (accepted.acceptedVersion > 1) {
      vm.restore_href = `/api/workitems/${accepted.workItemId}/deliverables/${accepted.id}/restore`;
    }
    if (isPreviewableText(driveVersion.mime, driveVersion.filename)) {
      vm.preview_href = `/api/workitems/${accepted.workItemId}/deliverables/${accepted.id}/preview`;
    }
  } else if (filename) {
    vm.filename = filename;
  }
  return vm;
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

function buildDrivePage(rows: DrivePageRows, now: Date): DrivePageVM {
  const itemById = new Map(rows.items.map((item) => [item.id, item]));
  const pathByItemId = new Map(rows.items.map((item) => [item.id, itemPath(item, itemById)]));
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
  const itemVms: DriveItemVM[] = rows.items.map((item) => {
    const path = pathByItemId.get(item.id) ?? `/${item.name}`;
    const currentVersion = item.currentVersionId ? versionById.get(item.currentVersionId) : undefined;
    const currentVersionVm = currentVersion ? versionVmById.get(currentVersion.id) : undefined;
    const vm: DriveItemVM = {
      id: item.id,
      project_id: item.projectId,
      name: item.name,
      kind: item.kind === "folder" ? "folder" : "file",
      path,
      depth: itemDepth(path),
      children_count: childrenCount.get(item.id) ?? 0,
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
    const accepted = acceptedByItemId.get(item.id);
    if (accepted) {
      vm.accepted_deliverable = accepted;
    }
    return vm;
  });

  const pendingCommentCount = rows.comments.filter((comment) => commentStatus(comment.status) === "pending_llm").length;
  const selectedItemId = itemVms.find((item) => item.kind === "file")?.id ?? itemVms[0]?.id;
  const data: DrivePageVM = {
    generated_at: now.toISOString(),
    summary: {
      item_count: itemVms.length,
      file_count: itemVms.filter((item) => item.kind === "file").length,
      folder_count: itemVms.filter((item) => item.kind === "folder").length,
      version_count: versionVms.length,
      accepted_deliverable_count: acceptedDeliverables.length,
      pending_comment_count: pendingCommentCount
    },
    ...(selectedItemId ? { selected_item_id: selectedItemId } : {}),
    items: itemVms,
    versions: versionVms,
    accepted_deliverables: acceptedDeliverables,
    comments: rows.comments.map((comment) => {
      const folderPath = comment.folderId ? pathByItemId.get(comment.folderId) : undefined;
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
          draft_href: `/api/pages/workitems/${comment.draftWorkItemId}`
        } : {})
      };
    }),
    actions: {},
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
  return {
    async page(input) {
      const rows = await deps.repo.readPage({
        ...(input.projectId ? { projectId: input.projectId } : {})
      });
      return buildDrivePage(rows, deps.now?.() ?? new Date());
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
