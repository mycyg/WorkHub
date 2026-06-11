import { randomUUID } from "node:crypto";

import { and, asc, desc, eq, isNotNull, isNull } from "drizzle-orm";

import type { WorkHubDb } from "../client.js";
import {
  acceptedDeliverableChanges,
  auditLogs,
  projectDriveComments,
  projectDriveItems,
  projectDriveOperations,
  projectDriveVersions,
  projects
} from "../schema/index.js";

export type DriveProjectRow = typeof projects.$inferSelect;
export type DriveItemRow = typeof projectDriveItems.$inferSelect;
export type DriveVersionRow = typeof projectDriveVersions.$inferSelect;
export type DriveCommentRow = typeof projectDriveComments.$inferSelect;
export type DriveOperationRow = typeof projectDriveOperations.$inferSelect;
export type DriveAcceptedDeliverableRow = {
  accepted: typeof acceptedDeliverableChanges.$inferSelect;
  driveItem: typeof projectDriveItems.$inferSelect | null;
  driveVersion: typeof projectDriveVersions.$inferSelect | null;
};

export type DrivePageRows = {
  project: DriveProjectRow | null;
  items: DriveItemRow[];
  versions: DriveVersionRow[];
  acceptedDeliverables: DriveAcceptedDeliverableRow[];
  comments: DriveCommentRow[];
  deletedItems: DriveItemRow[];
  operations: DriveOperationRow[];
};

export type DriveRepositoryActor = {
  actorKind: "human" | "ai" | "system" | string;
  actorUserId: string;
};

export type DriveMutationRows = {
  item: DriveItemRow;
  version?: DriveVersionRow;
  operation: DriveOperationRow;
};

export class DriveRepositoryConflictError extends Error {
  constructor(
    public readonly code:
      | "drive_name_conflict"
      | "drive_parent_deleted"
      | "drive_item_already_deleted"
      | "drive_item_not_deleted"
      | "drive_folder_not_empty"
      | "drive_current_version_changed"
      | "drive_accepted_deliverable_locked",
    message: string
  ) {
    super(message);
  }
}

export type DriveRepository = {
  readPage: (input?: {
    projectId?: string;
    limit?: number;
    includeDeleted?: boolean;
    operationLimit?: number;
  }) => Promise<DrivePageRows>;
  uploadFile: (input: DriveRepositoryActor & {
    projectId: string;
    parentId?: string | null;
    filename: string;
    mime?: string;
    sizeBytes: number;
    sha256?: string;
    parsedText?: string;
    parsedTextPath?: string;
    at?: Date;
  }) => Promise<DriveMutationRows | null>;
  softDeleteItem: (input: DriveRepositoryActor & {
    projectId: string;
    itemId: string;
    expectedCurrentVersionId?: string | null;
    at?: Date;
  }) => Promise<DriveMutationRows | null>;
  restoreDeletedItem: (input: DriveRepositoryActor & {
    projectId: string;
    itemId: string;
    at?: Date;
  }) => Promise<DriveMutationRows | null>;
};

function clampLimit(limit: number | undefined) {
  return Math.max(1, Math.min(limit ?? 200, 500));
}

function parentCondition(parentId: string | null | undefined) {
  return parentId ? eq(projectDriveItems.parentId, parentId) : isNull(projectDriveItems.parentId);
}

function itemPathFromRows(item: DriveItemRow, itemById: Map<string, DriveItemRow>) {
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

async function driveItemPath(db: WorkHubDb, item: DriveItemRow) {
  const rows = await db
    .select()
    .from(projectDriveItems)
    .where(eq(projectDriveItems.projectId, item.projectId));
  const itemById = new Map(rows.map((row) => [row.id, row]));
  return itemPathFromRows(item, itemById);
}

async function findProject(db: WorkHubDb, projectId?: string) {
  const baseConditions = [eq(projects.archived, false), isNull(projects.deletedAt)];
  const rows = await db
    .select()
    .from(projects)
    .where(and(...(projectId ? [...baseConditions, eq(projects.id, projectId)] : baseConditions)))
    .orderBy(asc(projects.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

async function activeItemByName(
  db: WorkHubDb,
  input: { projectId: string; parentId?: string | null; name: string }
) {
  const rows = await db
    .select()
    .from(projectDriveItems)
    .where(and(
      eq(projectDriveItems.projectId, input.projectId),
      parentCondition(input.parentId),
      eq(projectDriveItems.name, input.name),
      isNull(projectDriveItems.deletedAt)
    ))
    .limit(1);
  return rows[0] ?? null;
}

async function insertDriveOperation(
  db: WorkHubDb,
  input: DriveRepositoryActor & {
    projectId: string;
    opType: string;
    payloadJson: Record<string, unknown>;
    at: Date;
  }
) {
  const rows = await db
    .insert(projectDriveOperations)
    .values({
      id: randomUUID(),
      projectId: input.projectId,
      actorUserId: input.actorUserId,
      opType: input.opType,
      payloadJson: input.payloadJson,
      createdAt: input.at,
      updatedAt: input.at
    })
    .returning();
  return rows[0] as DriveOperationRow;
}

async function insertDriveAudit(
  db: WorkHubDb,
  input: DriveRepositoryActor & {
    action: string;
    project: DriveProjectRow;
    entityId: string;
    detailJson: Record<string, unknown>;
    at: Date;
  }
) {
  await db.insert(auditLogs).values({
    id: randomUUID(),
    orgId: null,
    workspaceId: input.project.workspaceId,
    actorKind: input.actorKind,
    actorUserId: input.actorUserId,
    entityType: "project_drive_item",
    entityId: input.entityId,
    action: input.action,
    detailJson: input.detailJson,
    createdAt: input.at
  });
}

export function createDriveRepository(db: WorkHubDb): DriveRepository {
  return {
    async readPage(input = {}) {
      const project = await findProject(db, input.projectId);
      if (!project) {
        return {
          project: null,
          items: [],
          versions: [],
          acceptedDeliverables: [],
          comments: [],
          deletedItems: [],
          operations: []
        };
      }

      const limit = clampLimit(input.limit);
      const [items, deletedItems, versionRows, acceptedDeliverables, comments, operations] = await Promise.all([
        db
          .select()
          .from(projectDriveItems)
          .where(and(eq(projectDriveItems.projectId, project.id), isNull(projectDriveItems.deletedAt)))
          .orderBy(asc(projectDriveItems.parentId), asc(projectDriveItems.name), asc(projectDriveItems.createdAt))
          .limit(limit),
        input.includeDeleted
          ? db
            .select()
            .from(projectDriveItems)
            .where(and(eq(projectDriveItems.projectId, project.id), isNotNull(projectDriveItems.deletedAt)))
            .orderBy(desc(projectDriveItems.deletedAt), asc(projectDriveItems.name))
            .limit(limit)
          : Promise.resolve([]),
        db
          .select({ version: projectDriveVersions })
          .from(projectDriveVersions)
          .innerJoin(projectDriveItems, eq(projectDriveVersions.itemId, projectDriveItems.id))
          .where(and(eq(projectDriveItems.projectId, project.id), isNull(projectDriveItems.deletedAt)))
          .orderBy(desc(projectDriveVersions.createdAt), desc(projectDriveVersions.versionNo))
          .limit(limit),
        db
          .select({
            accepted: acceptedDeliverableChanges,
            driveItem: projectDriveItems,
            driveVersion: projectDriveVersions
          })
          .from(acceptedDeliverableChanges)
          .leftJoin(projectDriveItems, eq(acceptedDeliverableChanges.driveItemId, projectDriveItems.id))
          .leftJoin(projectDriveVersions, eq(acceptedDeliverableChanges.driveVersionId, projectDriveVersions.id))
          .where(and(
            eq(projectDriveItems.projectId, project.id),
            isNull(projectDriveItems.deletedAt),
            isNull(acceptedDeliverableChanges.supersededAt)
          ))
          .orderBy(desc(acceptedDeliverableChanges.createdAt))
          .limit(limit),
        db
          .select()
          .from(projectDriveComments)
          .where(eq(projectDriveComments.projectId, project.id))
          .orderBy(desc(projectDriveComments.createdAt))
          .limit(50),
        db
          .select()
          .from(projectDriveOperations)
          .where(eq(projectDriveOperations.projectId, project.id))
          .orderBy(desc(projectDriveOperations.createdAt))
          .limit(Math.max(1, Math.min(input.operationLimit ?? 20, 100)))
      ]);

      return {
        project,
        items,
        versions: versionRows.map((row) => row.version),
        acceptedDeliverables,
        comments,
        deletedItems,
        operations
      };
    },

    async uploadFile(input) {
      const at = input.at ?? new Date();
      let result: DriveMutationRows | null = null;
      await db.transaction(async (tx) => {
        const project = await findProject(tx, input.projectId);
        if (!project) {
          return;
        }
        if (input.parentId) {
          const parentRows = await tx
            .select()
            .from(projectDriveItems)
            .where(and(
              eq(projectDriveItems.id, input.parentId),
              eq(projectDriveItems.projectId, input.projectId),
              eq(projectDriveItems.kind, "folder"),
              isNull(projectDriveItems.deletedAt)
            ))
            .limit(1);
          if (!parentRows[0]) {
            throw new DriveRepositoryConflictError("drive_parent_deleted", "父文件夹不可用，请刷新后重试。");
          }
        }
        if (await activeItemByName(tx, { projectId: input.projectId, parentId: input.parentId ?? null, name: input.filename })) {
          throw new DriveRepositoryConflictError("drive_name_conflict", "同名文件已经存在，请换一个名字。");
        }

        const itemId = randomUUID();
        const versionId = randomUUID();
        const storagePath = `drive/${input.projectId}/${itemId}/${versionId}/${input.filename}`;
        const itemRows = await tx
          .insert(projectDriveItems)
          .values({
            id: itemId,
            projectId: input.projectId,
            parentId: input.parentId ?? null,
            name: input.filename,
            kind: "file",
            currentVersionId: versionId,
            createdByUserId: input.actorUserId,
            updatedByUserId: input.actorUserId,
            createdAt: at,
            updatedAt: at
          })
          .returning();
        const versionRows = await tx
          .insert(projectDriveVersions)
          .values({
            id: versionId,
            itemId,
            versionNo: 1,
            filename: input.filename,
            mime: input.mime,
            sizeBytes: input.sizeBytes,
            storagePath,
            sha256: input.sha256,
            parsedText: input.parsedText,
            parsedTextPath: input.parsedTextPath,
            createdByUserId: input.actorUserId,
            createdAt: at,
            updatedAt: at
          })
          .returning();
        const path = await driveItemPath(tx, itemRows[0] as DriveItemRow);
        const payloadJson = {
          drive_item_id: itemId,
          drive_version_id: versionId,
          filename: input.filename,
          path,
          size_bytes: input.sizeBytes,
          sha256: input.sha256 ?? null
        };
        const operation = await insertDriveOperation(tx, {
          ...input,
          projectId: input.projectId,
          opType: "upload_file",
          payloadJson,
          at
        });
        await insertDriveAudit(tx, {
          ...input,
          project,
          action: "drive.item.uploaded",
          entityId: itemId,
          detailJson: payloadJson,
          at
        });
        result = {
          item: itemRows[0] as DriveItemRow,
          version: versionRows[0] as DriveVersionRow,
          operation
        };
      });
      return result;
    },

    async softDeleteItem(input) {
      const at = input.at ?? new Date();
      let result: DriveMutationRows | null = null;
      await db.transaction(async (tx) => {
        const project = await findProject(tx, input.projectId);
        if (!project) {
          return;
        }
        const itemRows = await tx
          .select()
          .from(projectDriveItems)
          .where(and(eq(projectDriveItems.id, input.itemId), eq(projectDriveItems.projectId, input.projectId)))
          .limit(1);
        const item = itemRows[0];
        if (!item) {
          return;
        }
        if (item.deletedAt) {
          throw new DriveRepositoryConflictError("drive_item_already_deleted", "这个文件已经在回收站里。");
        }
        if (input.expectedCurrentVersionId !== undefined && item.currentVersionId !== input.expectedCurrentVersionId) {
          throw new DriveRepositoryConflictError("drive_current_version_changed", "文件版本已经变化，请刷新后重试。");
        }
        const acceptedRows = await tx
          .select({ id: acceptedDeliverableChanges.id })
          .from(acceptedDeliverableChanges)
          .where(and(
            eq(acceptedDeliverableChanges.driveItemId, item.id),
            isNull(acceptedDeliverableChanges.supersededAt)
          ))
          .limit(1);
        if (acceptedRows[0]) {
          throw new DriveRepositoryConflictError("drive_accepted_deliverable_locked", "正式交付物不能直接移到回收站，请走版本还原或变更申请。");
        }
        if (item.kind === "folder") {
          const childRows = await tx
            .select({ id: projectDriveItems.id })
            .from(projectDriveItems)
            .where(and(eq(projectDriveItems.parentId, item.id), isNull(projectDriveItems.deletedAt)))
            .limit(1);
          if (childRows[0]) {
            throw new DriveRepositoryConflictError("drive_folder_not_empty", "文件夹里还有内容，先清空后再移到回收站。");
          }
        }
        const updated = await tx
          .update(projectDriveItems)
          .set({
            deletedAt: at,
            deletedByUserId: input.actorUserId,
            updatedByUserId: input.actorUserId,
            updatedAt: at
          })
          .where(and(eq(projectDriveItems.id, item.id), isNull(projectDriveItems.deletedAt)))
          .returning();
        if (!updated[0]) {
          throw new DriveRepositoryConflictError("drive_item_already_deleted", "这个文件已经在回收站里。");
        }
        const path = await driveItemPath(tx, item);
        const payloadJson = {
          drive_item_id: item.id,
          path,
          previous_current_version_id: item.currentVersionId
        };
        const operation = await insertDriveOperation(tx, {
          ...input,
          projectId: input.projectId,
          opType: "delete_item",
          payloadJson,
          at
        });
        await insertDriveAudit(tx, {
          ...input,
          project,
          action: "drive.item.deleted",
          entityId: item.id,
          detailJson: payloadJson,
          at
        });
        result = { item: updated[0] as DriveItemRow, operation };
      });
      return result;
    },

    async restoreDeletedItem(input) {
      const at = input.at ?? new Date();
      let result: DriveMutationRows | null = null;
      await db.transaction(async (tx) => {
        const project = await findProject(tx, input.projectId);
        if (!project) {
          return;
        }
        const itemRows = await tx
          .select()
          .from(projectDriveItems)
          .where(and(eq(projectDriveItems.id, input.itemId), eq(projectDriveItems.projectId, input.projectId)))
          .limit(1);
        const item = itemRows[0];
        if (!item) {
          return;
        }
        if (!item.deletedAt) {
          throw new DriveRepositoryConflictError("drive_item_not_deleted", "这个文件不在回收站里。");
        }
        if (item.parentId) {
          const parentRows = await tx
            .select()
            .from(projectDriveItems)
            .where(and(eq(projectDriveItems.id, item.parentId), eq(projectDriveItems.projectId, input.projectId)))
            .limit(1);
          if (!parentRows[0] || parentRows[0].deletedAt) {
            throw new DriveRepositoryConflictError("drive_parent_deleted", "父文件夹仍在回收站里，先恢复父文件夹。");
          }
        }
        if (await activeItemByName(tx, { projectId: input.projectId, parentId: item.parentId, name: item.name })) {
          throw new DriveRepositoryConflictError("drive_name_conflict", "当前位置已有同名文件，请先重命名后再恢复。");
        }
        const updated = await tx
          .update(projectDriveItems)
          .set({
            deletedAt: null,
            deletedByUserId: null,
            updatedByUserId: input.actorUserId,
            updatedAt: at
          })
          .where(and(eq(projectDriveItems.id, item.id), isNotNull(projectDriveItems.deletedAt)))
          .returning();
        if (!updated[0]) {
          throw new DriveRepositoryConflictError("drive_item_not_deleted", "这个文件不在回收站里。");
        }
        const path = await driveItemPath(tx, item);
        const payloadJson = {
          drive_item_id: item.id,
          path,
          restored_current_version_id: item.currentVersionId
        };
        const operation = await insertDriveOperation(tx, {
          ...input,
          projectId: input.projectId,
          opType: "restore_item",
          payloadJson,
          at
        });
        await insertDriveAudit(tx, {
          ...input,
          project,
          action: "drive.item.restored",
          entityId: item.id,
          detailJson: payloadJson,
          at
        });
        result = { item: updated[0] as DriveItemRow, operation };
      });
      return result;
    }
  };
}
