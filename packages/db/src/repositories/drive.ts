import { randomUUID } from "node:crypto";

import { and, asc, desc, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";

import type { WorkHubDb } from "../client.js";
import { allocateProjectCode } from "../sequences.js";
import {
  acceptedDeliverableChanges,
  auditLogs,
  chatMessages,
  projectDriveComments,
  projectDriveItems,
  projectDriveOperations,
  projectDriveVersions,
  proposals,
  projects,
  workItems
} from "../schema/index.js";

export type DriveProjectRow = typeof projects.$inferSelect;
export type DriveItemRow = typeof projectDriveItems.$inferSelect;
export type DriveVersionRow = typeof projectDriveVersions.$inferSelect;
export type DriveCommentRow = typeof projectDriveComments.$inferSelect;
export type DriveOperationRow = typeof projectDriveOperations.$inferSelect;
export type DriveWorkItemRow = typeof workItems.$inferSelect;
export type DriveProposalRow = typeof proposals.$inferSelect;
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
  commentProposals: DriveProposalRow[];
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

export type DriveCommentDraftRows = {
  comment: DriveCommentRow;
  workItem: DriveWorkItemRow | null;
  operation?: DriveOperationRow;
  created: boolean;
};

export type DriveDraftProposalRows = {
  comment: DriveCommentRow;
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
      | "drive_accepted_deliverable_locked"
      | "drive_comment_draft_exists"
      | "drive_comment_draft_missing"
      | "drive_comment_not_pending",
    message: string
  ) {
    super(message);
  }
}

// findings[#low]：name 预检和实际写入之间存在 TOCTOU 窗口——并发同名 upload/restore 会撞上
// project_drive_items_active_path_uq 唯一索引、抛 pg 23505 冒泡成 500。把这一特定唯一冲突
// 在仓库层翻译成 drive_name_conflict（已映射 409），其余错误原样抛出。
export function isActivePathUniqueViolation(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      (error as { code?: string }).code === "23505" &&
      (error as { constraint?: string }).constraint === "project_drive_items_active_path_uq"
  );
}

// 项目主页(/projects/:id)的「最近文件」卡片用：只取文件（非文件夹）、未删除，按最近更新倒序。
export type DriveRecentFileRow = {
  id: string;
  name: string;
  updatedAt: Date;
};

export type DriveRepository = {
  readPage: (input?: {
    projectId?: string;
    workspaceId?: string;
    limit?: number;
    includeDeleted?: boolean;
    operationLimit?: number;
  }) => Promise<DrivePageRows>;
  // 项目主页文件卡：最近文件清单（轻量，不拉版本/评论/采纳）+ 真实文件总数（不受清单 limit 截断）。
  listRecentFilesByProject: (projectId: string, limit?: number) => Promise<DriveRecentFileRow[]>;
  countFilesByProject: (projectId: string) => Promise<number>;
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
  commentToDraft: (input: DriveRepositoryActor & {
    projectId: string;
    commentId: string;
    at?: Date;
  }) => Promise<DriveCommentDraftRows | null>;
  recordDraftProposal: (input: DriveRepositoryActor & {
    workItemId: string;
    proposalId: string;
    at?: Date;
  }) => Promise<DriveDraftProposalRows | null>;
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
  // R4 #37：原先一次性拉项目下「所有」drive item 建 Map，只为走一条祖先链（≤50 层）。宽而浅的项目
  // 会把成百上千行 load 进内存（每次写操作都触发）。改为按需逐级查父节点（按主键 id 命中、限同项目），
  // 内存与查询量只随链深增长（≤50），结果与原 itemPathFromRows 逐字一致。
  const names: string[] = [];
  const seen = new Set<string>();
  let cursor: DriveItemRow | undefined = item;
  while (cursor && !seen.has(cursor.id) && names.length < 50) {
    seen.add(cursor.id);
    names.unshift(cursor.name);
    if (!cursor.parentId) {
      break;
    }
    const parentRows = await db
      .select()
      .from(projectDriveItems)
      .where(and(eq(projectDriveItems.id, cursor.parentId), eq(projectDriveItems.projectId, item.projectId)))
      .limit(1);
    cursor = parentRows[0];
  }
  return `/${names.join("/")}`;
}

async function findProject(db: WorkHubDb, projectId?: string, workspaceId?: string) {
  const baseConditions = [eq(projects.archived, false), isNull(projects.deletedAt)];
  // 显式 projectId → 按 id 查（上层再做 canView 鉴权）。否则挑「默认项目」时必须限定在 actor 所在 workspace，
  // 不能全库取最老的一个（M8：多租户里 B 工作区成员永远落到别人最老的项目→空 drive）。
  const conditions = projectId
    ? [...baseConditions, eq(projects.id, projectId)]
    : workspaceId
      ? [...baseConditions, eq(projects.workspaceId, workspaceId)]
      : baseConditions;
  const rows = await db
    .select()
    .from(projects)
    .where(and(...conditions))
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
    entityType?: string;
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
    entityType: input.entityType ?? "project_drive_item",
    entityId: input.entityId,
    action: input.action,
    detailJson: input.detailJson,
    createdAt: input.at
  });
}

function draftTitleFromComment(body: string) {
  const firstLine = body.replace(/\s+/gu, " ").trim();
  if (!firstLine) {
    return "Drive comment draft";
  }
  return firstLine.length > 80 ? `${firstLine.slice(0, 77)}...` : firstLine;
}

function commentPreview(body: string) {
  const text = body.replace(/\s+/gu, " ").trim();
  return text.length > 240 ? `${text.slice(0, 237)}...` : text;
}

export function createDriveRepository(db: WorkHubDb): DriveRepository {
  return {
    async readPage(input = {}) {
      const project = await findProject(db, input.projectId, input.workspaceId);
      if (!project) {
        return {
          project: null,
          items: [],
          versions: [],
          acceptedDeliverables: [],
          comments: [],
          deletedItems: [],
          operations: [],
          commentProposals: []
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
          // M12：按采纳记录自身的 projectId 圈定范围（而非 leftJoin 出来的 driveItem.projectId），
          // 否则非 drive 目标（driveItemId 为空，如 text_doc）的采纳会被 eq(NULL, id) 默默丢弃。
          // deletedAt 仅在确有 drive item 时才校验。
          .where(and(
            eq(acceptedDeliverableChanges.projectId, project.id),
            isNull(acceptedDeliverableChanges.supersededAt),
            or(isNull(projectDriveItems.id), isNull(projectDriveItems.deletedAt))
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
      const draftWorkItemIds = [...new Set(comments.map((comment) => comment.draftWorkItemId).filter((id): id is string => Boolean(id)))];
      const commentProposals = draftWorkItemIds.length
        ? await db
          .select()
          .from(proposals)
          .where(inArray(proposals.workItemId, draftWorkItemIds))
          .orderBy(desc(proposals.createdAt))
          .limit(100)
        : [];

      return {
        project,
        items,
        versions: versionRows.map((row) => row.version),
        acceptedDeliverables,
        comments,
        deletedItems,
        operations,
        commentProposals
      };
    },

    async listRecentFilesByProject(projectId, limit = 5) {
      const rows = await db
        .select({ id: projectDriveItems.id, name: projectDriveItems.name, updatedAt: projectDriveItems.updatedAt })
        .from(projectDriveItems)
        .where(and(
          eq(projectDriveItems.projectId, projectId),
          eq(projectDriveItems.kind, "file"),
          isNull(projectDriveItems.deletedAt)
        ))
        .orderBy(desc(projectDriveItems.updatedAt))
        .limit(Math.max(1, Math.min(limit, 50)));
      return rows;
    },

    async countFilesByProject(projectId) {
      const rows = await db
        .select({ value: sql<number>`count(*)` })
        .from(projectDriveItems)
        .where(and(
          eq(projectDriveItems.projectId, projectId),
          eq(projectDriveItems.kind, "file"),
          isNull(projectDriveItems.deletedAt)
        ));
      return Number(rows[0]?.value ?? 0);
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
          // R2 audit#21：对父文件夹行加锁后再校验活跃——softDeleteItem 删父时也对该行 FOR UPDATE(479)。
          // 否则「读到父活跃」与「插入子项」之间可与并发删父交错,把活跃子项遗留在已删父下(孤儿)。
          // FOR UPDATE 会等并发删父事务提交后按其结果重判 isNull(deletedAt)：父已删→不命中→drive_parent_deleted。
          const parentRows = await tx
            .select()
            .from(projectDriveItems)
            .where(and(
              eq(projectDriveItems.id, input.parentId),
              eq(projectDriveItems.projectId, input.projectId),
              eq(projectDriveItems.kind, "folder"),
              isNull(projectDriveItems.deletedAt)
            ))
            .for("update")
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
        let itemRows;
        try {
          itemRows = await tx
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
        } catch (error) {
          // 预检和写入之间的并发同名 → 唯一索引冲突翻译成 409，而不是 500。
          if (isActivePathUniqueViolation(error)) {
            throw new DriveRepositoryConflictError("drive_name_conflict", "同名文件已经存在，请换一个名字。");
          }
          throw error;
        }
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
        // findings[#low]：先对行加锁再做 version/empty 校验，关闭 select→update 之间的丢更新窗口
        //（不把 currentVersionId 塞进 UPDATE WHERE，以免污染错误码语义）。
        const itemRows = await tx
          .select()
          .from(projectDriveItems)
          .where(and(eq(projectDriveItems.id, input.itemId), eq(projectDriveItems.projectId, input.projectId)))
          .for("update")
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
          // R2 audit#21：恢复子项前对父行 FOR UPDATE,与 uploadFile/softDeleteItem 同口径串行化,
          // 否则可与并发删父交错把刚恢复的子项遗留在已删父下(孤儿)。等并发事务提交后按其结果重判 deletedAt。
          const parentRows = await tx
            .select()
            .from(projectDriveItems)
            .where(and(eq(projectDriveItems.id, item.parentId), eq(projectDriveItems.projectId, input.projectId)))
            .for("update")
            .limit(1);
          if (!parentRows[0] || parentRows[0].deletedAt) {
            throw new DriveRepositoryConflictError("drive_parent_deleted", "父文件夹仍在回收站里，先恢复父文件夹。");
          }
        }
        if (await activeItemByName(tx, { projectId: input.projectId, parentId: item.parentId, name: item.name })) {
          throw new DriveRepositoryConflictError("drive_name_conflict", "当前位置已有同名文件，请先重命名后再恢复。");
        }
        let updated;
        try {
          updated = await tx
            .update(projectDriveItems)
            .set({
              deletedAt: null,
              deletedByUserId: null,
              updatedByUserId: input.actorUserId,
              updatedAt: at
            })
            .where(and(eq(projectDriveItems.id, item.id), isNotNull(projectDriveItems.deletedAt)))
            .returning();
        } catch (error) {
          // 预检和恢复之间被人占了同名 → 唯一索引冲突翻译成 409，而不是 500。
          if (isActivePathUniqueViolation(error)) {
            throw new DriveRepositoryConflictError("drive_name_conflict", "当前位置已有同名文件，请先重命名后再恢复。");
          }
          throw error;
        }
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
    },

    async commentToDraft(input) {
      const at = input.at ?? new Date();
      let result: DriveCommentDraftRows | null = null;
      await db.transaction(async (tx) => {
        const project = await findProject(tx, input.projectId);
        if (!project) {
          return;
        }
        const commentRows = await tx
          .select()
          .from(projectDriveComments)
          .where(and(
            eq(projectDriveComments.id, input.commentId),
            eq(projectDriveComments.projectId, input.projectId)
          ))
          .limit(1);
        const comment = commentRows[0];
        if (!comment) {
          return;
        }
        if (comment.draftWorkItemId) {
          const existingRows = await tx
            .select()
            .from(workItems)
            .where(eq(workItems.id, comment.draftWorkItemId))
            .limit(1);
          if (!existingRows[0] || existingRows[0].deletedAt) {
            throw new DriveRepositoryConflictError("drive_comment_draft_missing", "这条评论关联的草稿已经不可用，请刷新后联系项目负责人。");
          }
          result = {
            comment,
            workItem: existingRows[0],
            created: false
          };
          return;
        }
        if (comment.status === "draft_created") {
          throw new DriveRepositoryConflictError("drive_comment_draft_missing", "这条评论的草稿状态不完整，请刷新后联系项目负责人。");
        }
        if (comment.status !== "pending_llm") {
          throw new DriveRepositoryConflictError("drive_comment_not_pending", "只有待生成草稿的网盘评论可以创建草稿。");
        }

        const allocation = await allocateProjectCode(tx, input.projectId);
        const workItemId = randomUUID();
        const title = draftTitleFromComment(comment.body);
        const workItemRows = await tx
          .insert(workItems)
          .values({
            id: workItemId,
            code: allocation.code,
            projectId: input.projectId,
            workspaceId: project.workspaceId,
            submitterUserId: input.actorUserId,
            title,
            rawDescription: comment.body,
            summaryMd: comment.body,
            status: "ai_clarifying",
            priority: "normal",
            mode: "worker",
            humanReserved: false,
            planningNote: `source=drive_comment comment_id=${comment.id}`,
            createdAt: at,
            updatedAt: at
          })
          .returning();
        const workItem = workItemRows[0] as DriveWorkItemRow | undefined;
        if (!workItem) {
          throw new Error("Failed to create work item draft from drive comment");
        }
        await tx.insert(chatMessages).values({
          id: randomUUID(),
          workItemId,
          role: "user",
          kind: "intent",
          contentJson: {
            source: "drive_comment",
            drive_comment_id: comment.id,
            project_id: input.projectId,
            folder_id: comment.folderId ?? null,
            body: comment.body
          },
          userOtherText: comment.body,
          createdAt: at,
          updatedAt: at
        });

        const updatedComments = await tx
          .update(projectDriveComments)
          .set({
            status: "draft_created",
            draftWorkItemId: workItemId,
            updatedAt: at
          })
          .where(and(
            eq(projectDriveComments.id, comment.id),
            eq(projectDriveComments.projectId, input.projectId),
            isNull(projectDriveComments.draftWorkItemId)
          ))
          .returning();
        const updatedComment = updatedComments[0] as DriveCommentRow | undefined;
        if (!updatedComment) {
          throw new DriveRepositoryConflictError("drive_comment_draft_exists", "这条评论已经生成过草稿，请刷新后打开已有草稿。");
        }

        let folderPath = "/";
        if (comment.folderId) {
          const folderRows = await tx
            .select()
            .from(projectDriveItems)
            .where(and(
              eq(projectDriveItems.id, comment.folderId),
              eq(projectDriveItems.projectId, input.projectId)
            ))
            .limit(1);
          if (folderRows[0]) {
            folderPath = await driveItemPath(tx, folderRows[0] as DriveItemRow);
          }
        }
        const payloadJson = {
          drive_comment_id: comment.id,
          work_item_id: workItemId,
          folder_id: comment.folderId ?? null,
          folder_path: folderPath,
          body_preview: commentPreview(comment.body)
        };
        const operation = await insertDriveOperation(tx, {
          ...input,
          projectId: input.projectId,
          opType: "comment_to_draft",
          payloadJson,
          at
        });
        await insertDriveAudit(tx, {
          ...input,
          project,
          entityType: "work_item",
          action: "work_item.created_from_drive_comment",
          entityId: workItemId,
          detailJson: payloadJson,
          at
        });
        await insertDriveAudit(tx, {
          ...input,
          project,
          entityType: "project_drive_comment",
          action: "drive.comment.draft_created",
          entityId: comment.id,
          detailJson: payloadJson,
          at
        });
        result = {
          comment: updatedComment,
          workItem,
          operation,
          created: true
        };
      });
      return result;
    },

    async recordDraftProposal(input) {
      const at = input.at ?? new Date();
      let result: DriveDraftProposalRows | null = null;
      await db.transaction(async (tx) => {
        const commentRows = await tx
          .select()
          .from(projectDriveComments)
          .where(eq(projectDriveComments.draftWorkItemId, input.workItemId))
          .orderBy(desc(projectDriveComments.updatedAt), desc(projectDriveComments.createdAt))
          .limit(1);
        const comment = commentRows[0];
        if (!comment) {
          return;
        }
        const project = await findProject(tx, comment.projectId);
        if (!project) {
          return;
        }
        // findings[#22/#24 后继]：跨服务 draft→proposal 写入非原子且非幂等——并发/重试会写重复的
        // draft_to_proposal operation + audit 行；部分失败又让 service 早返回，把评论卡在 draft_created。
        // 在事务内做幂等闸：若这条评论的 draft→proposal 已落地（评论已 proposal_created 且已存在指向同一
        // proposalId 的 draft_to_proposal operation），直接返回既有行，绝不重复 insert operation/audit。
        // 首次路径保持不变；重跑成为安全 no-op（self-heal 与 'proposal_already_exists' 重跑都因此安全）。
        if (comment.status === "proposal_created") {
          const existingOps = await tx
            .select()
            .from(projectDriveOperations)
            .where(and(
              eq(projectDriveOperations.projectId, comment.projectId),
              eq(projectDriveOperations.opType, "draft_to_proposal")
            ))
            .orderBy(desc(projectDriveOperations.createdAt))
            .limit(50);
          const existingOperation = existingOps.find((op) => {
            const payload = op.payloadJson as Record<string, unknown>;
            return payload.work_item_id === input.workItemId && payload.proposal_id === input.proposalId;
          });
          if (existingOperation) {
            result = { comment, operation: existingOperation };
            return;
          }
        }
        const updatedComments = await tx
          .update(projectDriveComments)
          .set({
            status: "proposal_created",
            updatedAt: at
          })
          .where(and(
            eq(projectDriveComments.id, comment.id),
            eq(projectDriveComments.draftWorkItemId, input.workItemId)
          ))
          .returning();
        const updatedComment = updatedComments[0] as DriveCommentRow | undefined;
        if (!updatedComment) {
          return;
        }
        const payloadJson = {
          drive_comment_id: comment.id,
          work_item_id: input.workItemId,
          proposal_id: input.proposalId,
          proposal_href: `/proposals/${input.proposalId}`
        };
        const operation = await insertDriveOperation(tx, {
          ...input,
          projectId: comment.projectId,
          opType: "draft_to_proposal",
          payloadJson,
          at
        });
        await insertDriveAudit(tx, {
          ...input,
          project,
          entityType: "proposal",
          action: "proposal.created_from_drive_draft",
          entityId: input.proposalId,
          detailJson: payloadJson,
          at
        });
        await insertDriveAudit(tx, {
          ...input,
          project,
          entityType: "project_drive_comment",
          action: "drive.comment.proposal_created",
          entityId: comment.id,
          detailJson: payloadJson,
          at
        });
        result = { comment: updatedComment, operation };
      });
      return result;
    }
  };
}
