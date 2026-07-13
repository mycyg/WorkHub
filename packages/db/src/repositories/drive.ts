import { randomUUID } from "node:crypto";

import { and, asc, desc, eq, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";

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
  users,
  workItems,
  workspaces
} from "../schema/index.js";

export type DriveProjectRow = typeof projects.$inferSelect & { orgId?: string | null };
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
  canRestore?: boolean;
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
  // 项目内未删除 item 总数(count(*), 不受 items 200 行上限影响)。
  totalItemCount?: number;
  // 项目内文件总数(count(*), 不受 items 200 行上限影响)。drive 页 summary.file_count 用它,
  // 与项目主页 countFilesByProject 同口径——否则 >200 文件时两页「文件 N」对不上,像文件丢了。
  totalFileCount?: number;
  // 项目内文件夹总数(count(*), 不受 items 200 行上限影响)。与 totalFileCount 组成 summary.item_count。
  totalFolderCount?: number;
  totalDeletedItemCount?: number;
  totalVersionCount?: number;
  totalAcceptedDeliverableCount?: number;
  totalPendingCommentCount?: number;
  totalOperationCount?: number;
  // DF-3：每个父文件夹的真实子项数(count(*) group by parent_id, 不受 items 200 行上限影响)。
  // children_count 此前只数已载入的 200 行 → 子项排在 200 之外的文件夹会读成 0,被误判「空文件夹」可删。
  childCountsByParent?: { parentId: string; count: number }[];
  // 回收站恢复按钮的全库冲突结果：deletedItems 可能只是分页/深链切片，活动同名 sibling 不一定在 items 中。
  restoreBlockedItemIds?: string[];
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

// 批 6（网盘整合 + git 化）：单文件版本历史行——版本本身字段 + 操作者昵称（前端要展示「谁在什么时候」）。
export type DriveVersionHistoryRow = DriveVersionRow & { createdByLabel: string };

export type DriveVersionHistoryRows = {
  item: DriveItemRow;
  versions: DriveVersionHistoryRow[];
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

export type DriveFileReadRows = {
  project: DriveProjectRow | null;
  item: DriveItemRow | null;
  version: DriveVersionRow | null;
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
      | "drive_comment_not_pending"
      // 批 6（版本历史/回滚）：目标版本已经是当前版本，回滚没有意义。
      | "drive_version_is_current",
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
  acceptedWorkItemIds?: string[];
};

export type UploadFileInput = DriveRepositoryActor & {
  projectId: string;
  parentId?: string | null;
  filename: string;
  mime?: string;
  sizeBytes: number;
  storagePath?: string;
  sha256?: string;
  parsedText?: string;
  parsedTextPath?: string;
  at?: Date;
};

export type DriveRepository = {
  readPage: (input?: {
    projectId?: string;
    workspaceId?: string;
    limit?: number;
    includeDeleted?: boolean;
    operationLimit?: number;
    targetItemId?: string;
    targetFileNames?: string[];
    // R4（规模化）：按名称模糊搜索——200 条字母序截断外的文件唯一用户可达出路。
    nameQuery?: string;
  }) => Promise<DrivePageRows>;
  // 项目主页文件卡：最近文件清单（轻量，不拉版本/评论/采纳）+ 真实文件总数（不受清单 limit 截断）。
  listRecentFilesByProject: (projectId: string, limit?: number) => Promise<DriveRecentFileRow[]>;
  countFilesByProject: (projectId: string) => Promise<number>;
  // DF-3：每个父文件夹的真实子项数(未删除),供 drive 页 children_count 与空文件夹删除候选用,不受 items 上限影响。
  // 可选：真实 DB 仓库实现它;未实现的假仓库则 children_count 回退到从已载入子集数(服务层 buildDrivePage 已兜底)。
  countChildrenByParent?: (projectId: string) => Promise<{ parentId: string; count: number }[]>;
  readFile?: (input: {
    projectId: string;
    itemId: string;
  }) => Promise<DriveFileReadRows>;
  // services-a-5：下载/预览鉴权只需要「这个 item+version 挂在哪些 work item 的采纳交付物上」，
  // 不必跑整页 readPage（200 items + 5 个 count 聚合 + 祖先链）。按 driveItemId+driveVersionId 直查，
  // 命中走 acceptedDeliverableChanges 上 driveItemId/driveVersionId 均有索引的点查，未实现时服务层退回 readPage。
  findAcceptedDeliverableWorkItemIds?: (input: {
    projectId: string;
    driveItemId: string;
    driveVersionId: string;
  }) => Promise<string[]>;
  // R12 E-01（人工验收打回）：同 parent 下已存在同名活跃文件时不再 409——追加新版本
  // （历史版本不抹，见下方 uploadFile 实现里的 appendUploadedVersion）。撞的若是文件夹则仍 409。
  uploadFile: (input: UploadFileInput) => Promise<DriveMutationRows | null>;
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
  // UX-U3（评论闭环缺口）：产品到处承诺「评论生成草稿」，但全站没有创建评论的入口——补写端。
  createComment: (input: DriveRepositoryActor & {
    projectId: string;
    body: string;
    authorNickname: string;
    folderId?: string | null;
    at?: Date;
  }) => Promise<DriveCommentRow | null>;
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
  // 批 6（网盘整合 + git 化，只读）：单文件版本历史，带操作者昵称，cap 上限（服务层默认 50/上限 200）。
  // 可选——真实仓库实现它；未实现的假仓库（既有测试大量以对象字面量方式实现 DriveRepository）不必跟着补桩。
  listVersionsForItem?: (input: {
    projectId: string;
    itemId: string;
    limit?: number;
  }) => Promise<DriveVersionHistoryRows | null>;
  // 批 6（回滚）：回滚=追加新版本（复用目标版本的存储内容，不拷字节、不抹历史），更新 item.currentVersionId，
  // 留痕 project_drive_operations(op_type="restore_version") + audit_logs，可审计。目标版本必须属于该 item；
  // 目标已是当前版本时抛 DriveRepositoryConflictError("drive_version_is_current", ...)。同样是可选方法。
  rollbackToVersion?: (input: DriveRepositoryActor & {
    projectId: string;
    itemId: string;
    targetVersionId: string;
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
  // R13 S3 隐私收尾:个人空间绝不参与「挑默认项目」——裸 /drive 不能落进别人的私人空间。
  const baseConditions = [eq(projects.archived, false), eq(projects.isPersonal, false), isNull(projects.deletedAt)];
  // 显式 projectId → 按 id 查（上层再做 canView 鉴权）。否则挑「默认项目」时必须限定在 actor 所在 workspace，
  // 不能全库取最老的一个（M8：多租户里 B 工作区成员永远落到别人最老的项目→空 drive）。
  const conditions = projectId
    ? [...baseConditions, eq(projects.id, projectId)]
    : workspaceId
      ? [...baseConditions, eq(projects.workspaceId, workspaceId)]
      : baseConditions;
  const rows = await db
    .select({
      project: projects,
      orgId: workspaces.orgId
    })
    .from(projects)
    .leftJoin(workspaces, eq(projects.workspaceId, workspaces.id))
    .where(and(...conditions))
    // XC-4：裸 /drive(无 project_id)挑默认项目要和 /projects 列表同序(最近活跃优先 desc(updatedAt)),
    // 而不是最老的(asc(createdAt))。否则点全局「网盘」导航会落到最老项目的网盘,与列表首项不一致、令人困惑。
    .orderBy(desc(projects.updatedAt))
    .limit(1);
  const row = rows[0];
  return row ? { ...row.project, orgId: row.orgId } : null;
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

function acceptedDriveVersionJoinCondition() {
  return and(
    eq(acceptedDeliverableChanges.driveVersionId, projectDriveVersions.id),
    eq(projectDriveVersions.itemId, acceptedDeliverableChanges.driveItemId)
  );
}

// db-repos-5/xlink-authz-2：原先对每条 acceptedVersion>1 的采纳记录逐行 await 一条『上一版是否存在』查询
// （最多 limit=200 条 → 最多 200 次串行往返）。改成一次批量查询：按涉及到的 targetKey 集合把所有候选
// 「上一版」行一次取回，再在内存里按每行自己的 (projectId|workItemId, targetKey, acceptedVersion) 精确匹配——
// 判定条件与原逐行查询逐字一致，只是把 N 次 DB 往返压成 1 次。
async function attachAcceptedDeliverableRestoreState<T extends DriveAcceptedDeliverableRow>(
  db: WorkHubDb,
  rows: T[]
): Promise<Array<T & { canRestore: boolean }>> {
  const candidateRows = rows.filter((row) => row.accepted.acceptedVersion > 1);
  if (candidateRows.length === 0) {
    return rows.map((row) => ({ ...row, canRestore: false }));
  }
  const targetKeys = [...new Set(candidateRows.map((row) => row.accepted.targetKey))];
  const previousCandidates = await db
    .select({
      targetKey: acceptedDeliverableChanges.targetKey,
      projectId: acceptedDeliverableChanges.projectId,
      workItemId: acceptedDeliverableChanges.workItemId,
      acceptedVersion: acceptedDeliverableChanges.acceptedVersion
    })
    .from(acceptedDeliverableChanges)
    .leftJoin(projectDriveItems, eq(acceptedDeliverableChanges.driveItemId, projectDriveItems.id))
    .leftJoin(projectDriveVersions, acceptedDriveVersionJoinCondition())
    .where(and(
      inArray(acceptedDeliverableChanges.targetKey, targetKeys),
      isNotNull(acceptedDeliverableChanges.supersededAt),
      isNotNull(acceptedDeliverableChanges.driveVersionId),
      isNotNull(projectDriveItems.id),
      isNull(projectDriveItems.deletedAt)
    ));
  // 按 targetKey 分桶，桶内保留每个 (projectId|workItemId 作用域) 出现过的最大 acceptedVersion 集合，
  // 判定时只需检查是否存在一个 < row.accepted.acceptedVersion 的候选版本，无需全量比较。
  const candidatesByTargetKey = new Map<string, typeof previousCandidates>();
  for (const candidate of previousCandidates) {
    const bucket = candidatesByTargetKey.get(candidate.targetKey);
    if (bucket) {
      bucket.push(candidate);
    } else {
      candidatesByTargetKey.set(candidate.targetKey, [candidate]);
    }
  }
  return rows.map((row) => {
    if (row.accepted.acceptedVersion <= 1) {
      return { ...row, canRestore: false };
    }
    const bucket = candidatesByTargetKey.get(row.accepted.targetKey) ?? [];
    const canRestore = bucket.some((candidate) => {
      const scopeMatches = row.accepted.projectId
        ? candidate.projectId === row.accepted.projectId
        : candidate.workItemId === row.accepted.workItemId;
      return scopeMatches && candidate.acceptedVersion < row.accepted.acceptedVersion;
    });
    return { ...row, canRestore };
  });
}

// 批 6：回滚追加新版本时算下一个 version_no——与 proposals.ts 里 nextDriveVersionNo 同口径
// （取该 item 现有最大 versionNo + 1），但那份是 proposals.ts 的私有 helper，这里独立写一份而不是
// 导出复用（两处调用场景不同：一个在采纳交付物事务里，一个在本文件的回滚事务里；各自持有自己的 tx）。
async function nextVersionNoForItem(db: WorkHubDb, itemId: string) {
  const rows = await db
    .select({ versionNo: projectDriveVersions.versionNo })
    .from(projectDriveVersions)
    .where(eq(projectDriveVersions.itemId, itemId))
    .orderBy(desc(projectDriveVersions.versionNo))
    .limit(1);
  return (rows[0]?.versionNo ?? 0) + 1;
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

// R12 E-01（人工验收打回）：同 parent 下重名上传此前直接 409，用户没有"换个名字才能上传"之外的出路。
// 沿用批 6 rollbackToVersion 的版本追加先例——插入新 project_drive_versions 行、把 item.currentVersionId
// 指到新版本、operations+audit 留痕，旧版本行原样保留、历史不抹。调用方（uploadFile）已确认命中的
// matchedItem.kind === "file"（文件夹撞名仍走原 409）；这里对该 item 行重新 FOR UPDATE 加锁，
// 防止与并发的软删/搬移交错（拿到锁后若发现条目已被删或不再是文件，视为真冲突而不是悄悄新建重名条目）。
async function appendUploadedVersion(
  db: WorkHubDb,
  project: DriveProjectRow,
  matchedItem: DriveItemRow,
  input: UploadFileInput,
  at: Date
): Promise<DriveMutationRows> {
  const itemRows = await db
    .select()
    .from(projectDriveItems)
    .where(and(eq(projectDriveItems.id, matchedItem.id), eq(projectDriveItems.projectId, input.projectId)))
    .for("update")
    .limit(1);
  const item = itemRows[0];
  if (!item || item.deletedAt || item.kind !== "file") {
    // 拿锁之间该条目被软删/变成文件夹——按真冲突处理，不悄悄新建一个重名条目。
    throw new DriveRepositoryConflictError("drive_name_conflict", "同名文件已经存在，请换一个名字。");
  }
  const newVersionId = randomUUID();
  const nextVersionNo = await nextVersionNoForItem(db, item.id);
  const storagePath = input.storagePath ?? `drive/${input.projectId}/${item.id}/${newVersionId}/${input.filename}`;
  const versionRows = await db
    .insert(projectDriveVersions)
    .values({
      id: newVersionId,
      itemId: item.id,
      versionNo: nextVersionNo,
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
  const newVersion = versionRows[0] as DriveVersionRow;
  const previousVersionId = item.currentVersionId;
  const updatedItemRows = await db
    .update(projectDriveItems)
    .set({
      currentVersionId: newVersion.id,
      updatedByUserId: input.actorUserId,
      updatedAt: at
    })
    .where(eq(projectDriveItems.id, item.id))
    .returning();
  const updatedItem = updatedItemRows[0] as DriveItemRow;
  const path = await driveItemPath(db, updatedItem);
  // op_type 沿用既有 "upload_file"（packages/contracts 的 op_type 枚举没有专门的"新版本"值，
  // 这个动作本质仍是"上传文件"，只是落到了已有条目上）；payload 额外带 new_version_no/
  // previous_version_id 供审计区分这是一次版本追加而非全新条目。
  const payloadJson = {
    drive_item_id: item.id,
    drive_version_id: newVersion.id,
    filename: input.filename,
    path,
    size_bytes: input.sizeBytes,
    sha256: input.sha256 ?? null,
    new_version_no: newVersion.versionNo,
    ...(previousVersionId ? { previous_version_id: previousVersionId } : {})
  };
  const operation = await insertDriveOperation(db, {
    ...input,
    projectId: input.projectId,
    opType: "upload_file",
    payloadJson,
    at
  });
  await insertDriveAudit(db, {
    ...input,
    project,
    action: "drive.item.version_uploaded",
    entityId: item.id,
    detailJson: payloadJson,
    at
  });
  return { item: updatedItem, version: newVersion, operation };
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
      const [initialItems, initialDeletedItems, initialVersionRows, initialAcceptedDeliverables, initialComments, operations, activeItemCountRows] = await Promise.all([
        db
          .select()
          .from(projectDriveItems)
          .where(and(
            eq(projectDriveItems.projectId, project.id),
            isNull(projectDriveItems.deletedAt),
            ...(input.nameQuery?.trim()
              ? [sql`${projectDriveItems.name} ilike ${`%${input.nameQuery.trim().replace(/[%_\\]/gu, (ch) => `\\${ch}`)}%`}`]
              : [])
          ))
          .orderBy(
            sql`${projectDriveItems.parentId} is not null`,
            asc(projectDriveItems.parentId),
            asc(projectDriveItems.name),
            asc(projectDriveItems.createdAt)
          )
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
          .leftJoin(projectDriveVersions, acceptedDriveVersionJoinCondition())
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
          .limit(Math.max(1, Math.min(input.operationLimit ?? 20, 100))),
        db
          .select({ kind: projectDriveItems.kind, value: sql<number>`count(*)` })
          .from(projectDriveItems)
          .where(and(eq(projectDriveItems.projectId, project.id), isNull(projectDriveItems.deletedAt)))
          .groupBy(projectDriveItems.kind)
      ]);
      let items = initialItems;
      let deletedItems = initialDeletedItems;
      let versions = initialVersionRows.map((row) => row.version);
      let acceptedDeliverables = initialAcceptedDeliverables;
      let comments = initialComments;
      const [
        totalVersionCountRows,
        totalAcceptedDeliverableCountRows,
        totalPendingCommentCountRows,
        totalDeletedItemCountRows,
        totalOperationCountRows
      ] = await Promise.all([
        db
          .select({ value: sql<number>`count(*)` })
          .from(projectDriveVersions)
          .innerJoin(projectDriveItems, eq(projectDriveVersions.itemId, projectDriveItems.id))
          .where(and(eq(projectDriveItems.projectId, project.id), isNull(projectDriveItems.deletedAt))),
        db
          .select({ value: sql<number>`count(*)` })
          .from(acceptedDeliverableChanges)
          .leftJoin(projectDriveItems, eq(acceptedDeliverableChanges.driveItemId, projectDriveItems.id))
          .where(and(
            eq(acceptedDeliverableChanges.projectId, project.id),
            isNull(acceptedDeliverableChanges.supersededAt),
            or(isNull(projectDriveItems.id), isNull(projectDriveItems.deletedAt))
          )),
        db
          .select({ value: sql<number>`count(*)` })
          .from(projectDriveComments)
          .where(and(eq(projectDriveComments.projectId, project.id), eq(projectDriveComments.status, "pending_llm"))),
        db
          .select({ value: sql<number>`count(*)` })
          .from(projectDriveItems)
          .where(and(eq(projectDriveItems.projectId, project.id), isNotNull(projectDriveItems.deletedAt))),
        db
          .select({ value: sql<number>`count(*)` })
          .from(projectDriveOperations)
          .where(eq(projectDriveOperations.projectId, project.id))
      ]);
      const targetSeeds: DriveItemRow[] = [];
      const targetDeletedSeeds: DriveItemRow[] = [];
      if (input.targetItemId) {
        const [target] = await db
          .select()
          .from(projectDriveItems)
          .where(and(
            eq(projectDriveItems.projectId, project.id),
            eq(projectDriveItems.id, input.targetItemId)
          ))
          .limit(1);
        if (target) {
          if (target.deletedAt && input.includeDeleted) {
            targetDeletedSeeds.push(target);
          } else if (!target.deletedAt) {
            targetSeeds.push(target);
          }
        }
      }
      const targetFileNames = [...new Set(input.targetFileNames?.map((name) => name.trim()).filter(Boolean) ?? [])].slice(0, 8);
      if (targetFileNames.length) {
        targetSeeds.push(...await db
          .select()
          .from(projectDriveItems)
          .where(and(
            eq(projectDriveItems.projectId, project.id),
            eq(projectDriveItems.kind, "file"),
            inArray(projectDriveItems.name, targetFileNames),
            isNull(projectDriveItems.deletedAt)
          ))
          .limit(20));
      }
      if (targetDeletedSeeds.length) {
        const knownDeletedIds = new Set(deletedItems.map((item) => item.id));
        deletedItems = [
          ...deletedItems,
          ...targetDeletedSeeds.filter((item) => !knownDeletedIds.has(item.id))
        ];
      }
      const targetChainSeeds = [...targetSeeds, ...targetDeletedSeeds];
      if (targetChainSeeds.length) {
        const targetChainById = new Map<string, DriveItemRow>();
        const seenTargetIds = new Set<string>();
        for (const seed of targetChainSeeds) {
          let cursor: DriveItemRow | undefined = seed;
          while (cursor && !seenTargetIds.has(cursor.id) && targetChainById.size < 80) {
            seenTargetIds.add(cursor.id);
            targetChainById.set(cursor.id, cursor);
            cursor = cursor.parentId
              ? (await db
                .select()
                .from(projectDriveItems)
                .where(and(
                  eq(projectDriveItems.projectId, project.id),
                  eq(projectDriveItems.id, cursor.parentId)
                ))
                .limit(1))[0]
              : undefined;
          }
        }
        const targetChain = [...targetChainById.values()].reverse();
        if (targetChain.length) {
          const loadedIds = new Set(items.map((item) => item.id));
          items = [...items, ...targetChain.filter((item) => !item.deletedAt && !loadedIds.has(item.id))];
          if (input.includeDeleted) {
            const knownDeletedIds = new Set(deletedItems.map((item) => item.id));
            const targetDeletedAncestors = targetChain.filter((item) => item.deletedAt && !knownDeletedIds.has(item.id));
            deletedItems = [...deletedItems, ...targetDeletedAncestors];
          }
          const knownVersionIds = new Set(versions.map((version) => version.id));
          const missingCurrentVersionIds = targetChain
            .map((item) => item.currentVersionId)
            .filter((id): id is string => typeof id === "string" && !knownVersionIds.has(id));
          if (missingCurrentVersionIds.length) {
            const extraVersions = await db
              .select()
              .from(projectDriveVersions)
              .where(inArray(projectDriveVersions.id, missingCurrentVersionIds));
            versions = [...versions, ...extraVersions.filter((version) => !knownVersionIds.has(version.id))];
          }
        }
      }
      const knownLoadedVersionIds = new Set(versions.map((version) => version.id));
      const loadedItemsForVersionBackfill = [...items, ...deletedItems];
      const missingLoadedCurrentVersionIds = [...new Set(loadedItemsForVersionBackfill
        .map((item) => item.currentVersionId)
        .filter((id): id is string => typeof id === "string" && !knownLoadedVersionIds.has(id)))];
      if (missingLoadedCurrentVersionIds.length) {
        const loadedCurrentVersions = await db
          .select()
          .from(projectDriveVersions)
          .where(inArray(projectDriveVersions.id, missingLoadedCurrentVersionIds));
        versions = [
          ...versions,
          ...loadedCurrentVersions.filter((version) => !knownLoadedVersionIds.has(version.id))
        ];
      }
      const loadedItemIds = [...new Set(items.map((item) => item.id))];
      if (loadedItemIds.length) {
        const knownAcceptedDeliverableIds = new Set(acceptedDeliverables.map((row) => row.accepted.id));
        const loadedAcceptedDeliverables = await db
          .select({
            accepted: acceptedDeliverableChanges,
            driveItem: projectDriveItems,
            driveVersion: projectDriveVersions
          })
          .from(acceptedDeliverableChanges)
          .leftJoin(projectDriveItems, eq(acceptedDeliverableChanges.driveItemId, projectDriveItems.id))
          .leftJoin(projectDriveVersions, acceptedDriveVersionJoinCondition())
          .where(and(
            inArray(acceptedDeliverableChanges.driveItemId, loadedItemIds),
            isNull(acceptedDeliverableChanges.supersededAt),
            or(isNull(projectDriveItems.id), isNull(projectDriveItems.deletedAt))
          ))
          .orderBy(desc(acceptedDeliverableChanges.createdAt));
        acceptedDeliverables = [
          ...acceptedDeliverables,
          ...loadedAcceptedDeliverables.filter((row) => !knownAcceptedDeliverableIds.has(row.accepted.id))
        ];
      }
      const loadedVersionIds = [...new Set(versions.map((version) => version.id))];
      if (loadedItemIds.length && loadedVersionIds.length) {
        const knownAcceptedDeliverableIds = new Set(acceptedDeliverables.map((row) => row.accepted.id));
        const rankedHistoricalAccepted = db
          .select({
            acceptedId: acceptedDeliverableChanges.id,
            rowNumber: sql<number>`row_number() over (partition by ${acceptedDeliverableChanges.driveVersionId} order by ${acceptedDeliverableChanges.createdAt} desc)`.as("row_number")
          })
          .from(acceptedDeliverableChanges)
          .leftJoin(projectDriveItems, eq(acceptedDeliverableChanges.driveItemId, projectDriveItems.id))
          .leftJoin(projectDriveVersions, acceptedDriveVersionJoinCondition())
          .where(and(
            eq(acceptedDeliverableChanges.projectId, project.id),
            inArray(acceptedDeliverableChanges.driveItemId, loadedItemIds),
            inArray(acceptedDeliverableChanges.driveVersionId, loadedVersionIds),
            isNotNull(acceptedDeliverableChanges.supersededAt),
            or(isNull(projectDriveItems.id), isNull(projectDriveItems.deletedAt))
          ))
          .as("ranked_historical_accepted_deliverables");
        const historicalAcceptedDeliverables = await db
          .select({
            accepted: acceptedDeliverableChanges,
            driveItem: projectDriveItems,
            driveVersion: projectDriveVersions
          })
          .from(rankedHistoricalAccepted)
          .innerJoin(acceptedDeliverableChanges, eq(acceptedDeliverableChanges.id, rankedHistoricalAccepted.acceptedId))
          .leftJoin(projectDriveItems, eq(acceptedDeliverableChanges.driveItemId, projectDriveItems.id))
          .leftJoin(projectDriveVersions, acceptedDriveVersionJoinCondition())
          .where(eq(rankedHistoricalAccepted.rowNumber, 1))
          .orderBy(desc(acceptedDeliverableChanges.createdAt));
        acceptedDeliverables = [
          ...acceptedDeliverables,
          ...historicalAcceptedDeliverables.filter((row) => !knownAcceptedDeliverableIds.has(row.accepted.id))
        ];
      }
      acceptedDeliverables = await attachAcceptedDeliverableRestoreState(db, acceptedDeliverables);
      const knownCommentIds = new Set(comments.map((comment) => comment.id));
      const pendingComments = await db
        .select()
        .from(projectDriveComments)
        .where(and(eq(projectDriveComments.projectId, project.id), eq(projectDriveComments.status, "pending_llm")))
        .orderBy(desc(projectDriveComments.createdAt))
        .limit(50);
      comments = [
        ...comments,
        ...pendingComments.filter((comment) => !knownCommentIds.has(comment.id))
      ];
      const draftWorkItemIds = [...new Set(comments.map((comment) => comment.draftWorkItemId).filter((id): id is string => Boolean(id)))];
      const commentProposals = draftWorkItemIds.length
        ? await db
          .select()
          .from(proposals)
          .where(inArray(proposals.workItemId, draftWorkItemIds))
          .orderBy(desc(proposals.createdAt))
          .limit(100)
        : [];
      const totalFileCount = Number(activeItemCountRows.find((row) => row.kind === "file")?.value ?? 0);
      const totalFolderCount = Number(activeItemCountRows.find((row) => row.kind === "folder")?.value ?? 0);
      // db-repos-5/xlink-authz-2：原先对每个回收站项逐个 await『查父行』+『查同名活动冲突』（deletedItems
      // 上限 200 → 最多 ~400 次串行往返）。改成两次批量查询：一次按去重后的 parentId 集合取回所有父行，
      // 一次按去重后的 parentId 集合取回该范围内全部活动 item（用于按 (parentId, name) 在内存里判同名冲突，
      // 根 level 项单独用一次按 name 的批量查询）。判定条件与原逐行查询逐字一致。
      const parentIds = [...new Set(deletedItems.map((item) => item.parentId).filter((id): id is string => Boolean(id)))];
      const parentRowsById = new Map<string, { id: string; deletedAt: Date | null }>();
      if (parentIds.length) {
        const parentRows = await db
          .select({ id: projectDriveItems.id, deletedAt: projectDriveItems.deletedAt })
          .from(projectDriveItems)
          .where(and(inArray(projectDriveItems.id, parentIds), eq(projectDriveItems.projectId, project.id)));
        for (const row of parentRows) {
          parentRowsById.set(row.id, row);
        }
      }
      const hasRootLevelDeletedItem = deletedItems.some((item) => !item.parentId);
      const activeSiblingsByParentKey = new Map<string, Set<string>>();
      if (parentIds.length || hasRootLevelDeletedItem) {
        const activeSiblingRows = await db
          .select({ parentId: projectDriveItems.parentId, name: projectDriveItems.name })
          .from(projectDriveItems)
          .where(and(
            eq(projectDriveItems.projectId, project.id),
            isNull(projectDriveItems.deletedAt),
            parentIds.length
              ? or(inArray(projectDriveItems.parentId, parentIds), isNull(projectDriveItems.parentId))
              : isNull(projectDriveItems.parentId)
          ));
        for (const row of activeSiblingRows) {
          const key = row.parentId ?? "";
          const names = activeSiblingsByParentKey.get(key);
          if (names) {
            names.add(row.name);
          } else {
            activeSiblingsByParentKey.set(key, new Set([row.name]));
          }
        }
      }
      const restoreBlockedItemIds: string[] = [];
      for (const item of deletedItems) {
        if (item.parentId) {
          const parentRow = parentRowsById.get(item.parentId);
          if (!parentRow || parentRow.deletedAt) {
            restoreBlockedItemIds.push(item.id);
            continue;
          }
        }
        const siblingNames = activeSiblingsByParentKey.get(item.parentId ?? "");
        if (siblingNames?.has(item.name)) {
          restoreBlockedItemIds.push(item.id);
        }
      }

      return {
        project,
        items,
        versions,
        acceptedDeliverables,
        comments,
        deletedItems,
        operations,
        commentProposals,
        totalItemCount: totalFileCount + totalFolderCount,
        totalFileCount,
        totalFolderCount,
        totalDeletedItemCount: Number(totalDeletedItemCountRows[0]?.value ?? 0),
        totalVersionCount: Number(totalVersionCountRows[0]?.value ?? 0),
        totalAcceptedDeliverableCount: Number(totalAcceptedDeliverableCountRows[0]?.value ?? 0),
        totalPendingCommentCount: Number(totalPendingCommentCountRows[0]?.value ?? 0),
        totalOperationCount: Number(totalOperationCountRows[0]?.value ?? 0),
        restoreBlockedItemIds
      };
    },

    async findAcceptedDeliverableWorkItemIds(input) {
      // 与 readPage 里 acceptedDeliverables 的初始查询同口径：不按 supersededAt 过滤（historical 版本
      // 标签也要能查到自己的采纳记录），只按 projectId + driveItemId + driveVersionId 精确匹配。
      const rows = await db
        .select({ workItemId: acceptedDeliverableChanges.workItemId })
        .from(acceptedDeliverableChanges)
        .where(and(
          eq(acceptedDeliverableChanges.projectId, input.projectId),
          eq(acceptedDeliverableChanges.driveItemId, input.driveItemId),
          eq(acceptedDeliverableChanges.driveVersionId, input.driveVersionId)
        ));
      return [...new Set(rows.map((row) => row.workItemId))];
    },

    async listRecentFilesByProject(projectId, limit = 5) {
      const rows = await db
        .select({
          id: projectDriveItems.id,
          name: projectDriveItems.name,
          updatedAt: projectDriveItems.updatedAt,
          currentVersionId: projectDriveItems.currentVersionId
        })
        .from(projectDriveItems)
        .where(and(
          eq(projectDriveItems.projectId, projectId),
          eq(projectDriveItems.kind, "file"),
          isNull(projectDriveItems.deletedAt)
        ))
        .orderBy(desc(projectDriveItems.updatedAt))
        .limit(Math.max(1, Math.min(limit, 500)));
      if (rows.length === 0) {
        return rows;
      }
      const currentVersionIds = rows
        .map((row) => row.currentVersionId)
        .filter((id): id is string => typeof id === "string");
      const acceptedRows = currentVersionIds.length
        ? await db
          .select({
            driveItemId: acceptedDeliverableChanges.driveItemId,
            workItemId: acceptedDeliverableChanges.workItemId
          })
          .from(acceptedDeliverableChanges)
          .where(and(
            inArray(acceptedDeliverableChanges.driveItemId, rows.map((row) => row.id)),
            inArray(acceptedDeliverableChanges.driveVersionId, currentVersionIds),
            isNull(acceptedDeliverableChanges.supersededAt)
          ))
        : [];
      const acceptedWorkItemsByDriveItemId = new Map<string, string[]>();
      for (const row of acceptedRows) {
        if (!row.driveItemId) {
          continue;
        }
        const bucket = acceptedWorkItemsByDriveItemId.get(row.driveItemId) ?? [];
        bucket.push(row.workItemId);
        acceptedWorkItemsByDriveItemId.set(row.driveItemId, bucket);
      }
      return rows.map(({ currentVersionId: _currentVersionId, ...row }) => {
        const acceptedWorkItemIds = acceptedWorkItemsByDriveItemId.get(row.id);
        return {
          ...row,
          ...(acceptedWorkItemIds?.length ? { acceptedWorkItemIds } : {})
        };
      });
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

    async countChildrenByParent(projectId) {
      // DF-3：每个父文件夹的真实子项数(未删除),count(*) group by parent_id,不受 items 200 行上限影响。
      const rows = await db
        .select({ parentId: projectDriveItems.parentId, value: sql<number>`count(*)` })
        .from(projectDriveItems)
        .where(and(
          eq(projectDriveItems.projectId, projectId),
          isNotNull(projectDriveItems.parentId),
          isNull(projectDriveItems.deletedAt)
        ))
        .groupBy(projectDriveItems.parentId);
      return rows
        .filter((row): row is { parentId: string; value: number } => row.parentId !== null)
        .map((row) => ({ parentId: row.parentId, count: Number(row.value ?? 0) }));
    },

    async readFile(input) {
      const project = await findProject(db, input.projectId);
      if (!project) {
        return { project: null, item: null, version: null };
      }
      const itemRows = await db
        .select()
        .from(projectDriveItems)
        .where(and(
          eq(projectDriveItems.id, input.itemId),
          eq(projectDriveItems.projectId, input.projectId),
          eq(projectDriveItems.kind, "file"),
          isNull(projectDriveItems.deletedAt),
          isNotNull(projectDriveItems.currentVersionId)
        ))
        .limit(1);
      const item = itemRows[0] as DriveItemRow | undefined;
      if (!item?.currentVersionId) {
        return { project, item: item ?? null, version: null };
      }
      const versionRows = await db
        .select()
        .from(projectDriveVersions)
        .where(and(
          eq(projectDriveVersions.id, item.currentVersionId),
          eq(projectDriveVersions.itemId, item.id)
        ))
        .limit(1);
      return {
        project,
        item,
        version: versionRows[0] as DriveVersionRow | undefined ?? null
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
        // R12 E-01：同 parent 下已有同名【活跃文件】时不再 409——追加新版本（历史不抹）。
        // 撞的若是文件夹仍然 409（不能把版本挂在文件夹名下）。同名条目若已被软删——
        // activeItemByName 本就只查 deletedAt IS NULL 的行，查不到即视为"没有活跃同名冲突"，
        // 按仓库现状语义原样落到下面的"全新条目"分支（回收站里的旧条目不受影响）。
        const existingActive = await activeItemByName(tx, {
          projectId: input.projectId,
          parentId: input.parentId ?? null,
          name: input.filename
        });
        if (existingActive) {
          if (existingActive.kind !== "file") {
            throw new DriveRepositoryConflictError("drive_name_conflict", "同名文件已经存在，请换一个名字。");
          }
          result = await appendUploadedVersion(tx, project, existingActive, input, at);
          return;
        }

        const itemId = randomUUID();
        const versionId = randomUUID();
        const storagePath = input.storagePath ?? `drive/${input.projectId}/${itemId}/${versionId}/${input.filename}`;
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
            .where(and(
              eq(projectDriveItems.projectId, input.projectId),
              eq(projectDriveItems.parentId, item.id),
              isNull(projectDriveItems.deletedAt)
            ))
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

    async createComment(input) {
      const at = input.at ?? new Date();
      const project = await findProject(db, input.projectId);
      if (!project || !input.actorUserId) {
        return null;
      }
      const [row] = await db
        .insert(projectDriveComments)
        .values({
          id: randomUUID(),
          projectId: input.projectId,
          folderId: input.folderId ?? null,
          authorUserId: input.actorUserId,
          authorNickname: input.authorNickname,
          body: input.body,
          status: "pending_llm",
          createdAt: at,
          updatedAt: at
        })
        .returning();
      return row ?? null;
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
          .for("update")
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
            eq(projectDriveComments.status, "pending_llm"),
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
          .for("update")
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
          const existingOperationRows = await tx
            .select()
            .from(projectDriveOperations)
            .where(and(
              eq(projectDriveOperations.projectId, comment.projectId),
              eq(projectDriveOperations.opType, "draft_to_proposal"),
              sql`${projectDriveOperations.payloadJson}->>'drive_comment_id' = ${comment.id}`,
              sql`${projectDriveOperations.payloadJson}->>'work_item_id' = ${input.workItemId}`,
              sql`${projectDriveOperations.payloadJson}->>'proposal_id' = ${input.proposalId}`
            ))
            .orderBy(desc(projectDriveOperations.createdAt))
            .limit(1);
          const existingOperation = existingOperationRows[0];
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
            eq(projectDriveComments.draftWorkItemId, input.workItemId),
            inArray(projectDriveComments.status, ["draft_created", "proposal_created"])
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
    },

    async listVersionsForItem(input) {
      const project = await findProject(db, input.projectId);
      if (!project) {
        return null;
      }
      const itemRows = await db
        .select()
        .from(projectDriveItems)
        .where(and(
          eq(projectDriveItems.id, input.itemId),
          eq(projectDriveItems.projectId, input.projectId),
          eq(projectDriveItems.kind, "file")
        ))
        .limit(1);
      const item = itemRows[0] as DriveItemRow | undefined;
      if (!item) {
        return null;
      }
      const limit = Math.max(1, Math.min(input.limit ?? 50, 200));
      const versionRows = await db
        .select({ version: projectDriveVersions, createdByLabel: users.nickname })
        .from(projectDriveVersions)
        .innerJoin(users, eq(users.id, projectDriveVersions.createdByUserId))
        .where(eq(projectDriveVersions.itemId, item.id))
        .orderBy(desc(projectDriveVersions.versionNo))
        .limit(limit);
      return {
        item,
        versions: versionRows.map((row) => ({ ...row.version, createdByLabel: row.createdByLabel }))
      };
    },

    async rollbackToVersion(input) {
      const at = input.at ?? new Date();
      let result: DriveMutationRows | null = null;
      await db.transaction(async (tx) => {
        const project = await findProject(tx, input.projectId);
        if (!project) {
          return;
        }
        // 与 softDeleteItem/restoreDeletedItem 同口径：先对 item 行加锁，关闭并发回滚/其它写操作
        // 交错时 currentVersionId 的丢更新窗口。
        const itemRows = await tx
          .select()
          .from(projectDriveItems)
          .where(and(eq(projectDriveItems.id, input.itemId), eq(projectDriveItems.projectId, input.projectId)))
          .for("update")
          .limit(1);
        const item = itemRows[0];
        if (!item || item.deletedAt || item.kind !== "file") {
          return;
        }
        const targetRows = await tx
          .select()
          .from(projectDriveVersions)
          .where(and(
            eq(projectDriveVersions.id, input.targetVersionId),
            eq(projectDriveVersions.itemId, item.id)
          ))
          .limit(1);
        const target = targetRows[0];
        if (!target) {
          return;
        }
        if (item.currentVersionId === target.id) {
          throw new DriveRepositoryConflictError("drive_version_is_current", "这已经是当前版本，无需找回。");
        }
        const newVersionId = randomUUID();
        // 先算好下一个 version_no 再 insert——不要把 await 塞进 .values({...}) 字面量里：
        // tx.insert(table) 本身是同步调用、会立刻构建出 builder，而 .values() 的参数对象在此之后才求值，
        // 于是内联 `versionNo: await nextVersionNoForItem(...)` 会让这次 select 排在 insert 调用「之后」，
        // 与代码读起来的顺序倒挂，容易在测试/复核时数错查询次数（这里就踩过一次）。
        const nextVersionNo = await nextVersionNoForItem(tx, item.id);
        const versionRows = await tx
          .insert(projectDriveVersions)
          .values({
            id: newVersionId,
            itemId: item.id,
            versionNo: nextVersionNo,
            filename: target.filename,
            mime: target.mime,
            sizeBytes: target.sizeBytes,
            storagePath: target.storagePath,
            sha256: target.sha256,
            parsedText: target.parsedText,
            parsedTextPath: target.parsedTextPath,
            createdByUserId: input.actorUserId,
            createdAt: at,
            updatedAt: at
          })
          .returning();
        const newVersion = versionRows[0] as DriveVersionRow;
        const updatedItemRows = await tx
          .update(projectDriveItems)
          .set({
            currentVersionId: newVersion.id,
            updatedByUserId: input.actorUserId,
            updatedAt: at
          })
          .where(eq(projectDriveItems.id, item.id))
          .returning();
        const updatedItem = updatedItemRows[0] as DriveItemRow;
        const path = await driveItemPath(tx, updatedItem);
        const payloadJson = {
          drive_item_id: item.id,
          path,
          restored_from_version_id: target.id,
          restored_from_version_no: target.versionNo,
          new_version_id: newVersion.id,
          new_version_no: newVersion.versionNo
        };
        const operation = await insertDriveOperation(tx, {
          ...input,
          projectId: input.projectId,
          opType: "restore_version",
          payloadJson,
          at
        });
        await insertDriveAudit(tx, {
          ...input,
          project,
          action: "drive.item.version_restored",
          entityId: item.id,
          detailJson: payloadJson,
          at
        });
        result = { item: updatedItem, version: newVersion, operation };
      });
      return result;
    }
  };
}
