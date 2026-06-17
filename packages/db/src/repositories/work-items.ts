import { randomUUID } from "node:crypto";

import { and, asc, desc, eq, ilike, inArray, isNotNull, isNull, lt, or, sql, type SQL } from "drizzle-orm";

import { allowedWorkItemTransitions, sessionFinalizeFromStatuses } from "@workhub/contracts";
import type { EvidenceRef, WorkItemMode, WorkItemStatus } from "@workhub/contracts";

import type { WorkHubDb } from "../client.js";
import {
  acceptedDeliverableChanges,
  agentRuns,
  agentSteps,
  auditLogs,
  chatMessages,
  knowledgeDocuments,
  meetingInsights,
  meetingRecords,
  projectDriveComments,
  projectDriveItems,
  projectDriveOperations,
  projectDriveVersions,
  projects,
  proposals,
  workItemAcceptanceItems,
  workItems
} from "../schema/index.js";
import { allocateProjectCode } from "../sequences.js";

const humanReservedGuardColumns = {
  id: workItems.id,
  code: workItems.code,
  title: workItems.title,
  status: workItems.status,
  mode: workItems.mode,
  humanReserved: workItems.humanReserved,
  submitterUserId: workItems.submitterUserId,
  claimedByUserId: workItems.claimedByUserId
};

const notificationContextColumns = {
  id: workItems.id,
  code: workItems.code,
  title: workItems.title,
  projectId: workItems.projectId,
  submitterUserId: workItems.submitterUserId,
  claimedByUserId: workItems.claimedByUserId,
  projectOwnerUserId: projects.ownerUserId
};

const pmModeEligibleStatuses = ["spec_ready", "ai_working", "escalated", "pm_mode", "in_review"] as const;

export type WorkItemHumanReservedRow = {
  id: string;
  code: string;
  title: string | null;
  status: WorkItemStatus;
  mode: WorkItemMode;
  humanReserved: boolean;
  submitterUserId: string;
  claimedByUserId: string | null;
};

export type WorkItemNotificationContextRow = {
  id: string;
  code: string;
  title: string | null;
  projectId: string;
  submitterUserId: string;
  claimedByUserId: string | null;
  projectOwnerUserId: string | null;
};

export type WorkItemProjectRow = typeof projects.$inferSelect;
export type WorkItemRow = typeof workItems.$inferSelect;
export type WorkItemAcceptanceRow = typeof workItemAcceptanceItems.$inferSelect;
export type WorkItemAgentStepRow = typeof agentSteps.$inferSelect;
export type WorkItemProposalRow = typeof proposals.$inferSelect;
export type WorkItemChatMessageRow = typeof chatMessages.$inferSelect;
export type WorkItemKnowledgeDocumentRow = typeof knowledgeDocuments.$inferSelect;
export type WorkItemDriveSourceCommentRow = {
  comment: typeof projectDriveComments.$inferSelect;
  folder: typeof projectDriveItems.$inferSelect | null;
  folderPath: string | null;
};
export type WorkItemMeetingSourceInsightRow = {
  insight: typeof meetingInsights.$inferSelect;
  meeting: typeof meetingRecords.$inferSelect;
};
export type WorkItemAcceptedDeliverableRow = {
  accepted: typeof acceptedDeliverableChanges.$inferSelect;
  driveItem: typeof projectDriveItems.$inferSelect | null;
  driveVersion: typeof projectDriveVersions.$inferSelect | null;
};

type WorkHubTx = Parameters<Parameters<WorkHubDb["transaction"]>[0]>[0];

export class WorkItemAcceptedDeliverableRestoreError extends Error {
  constructor(
    public readonly code:
      | "deliverable_not_versioned"
      | "deliverable_no_previous_version"
      | "deliverable_version_changed",
    message: string
  ) {
    super(message);
  }
}

export type CreateStoredWorkItemInput = {
  id?: string;
  projectId: string;
  workspaceId?: string | null;
  submitterUserId: string;
  title?: string | null;
  rawDescription?: string | null;
  summaryMd?: string | null;
  status?: WorkItemStatus;
  priority?: string;
  mode?: WorkItemMode;
  selectedOptionIds?: string[];
  planningNote?: string | null;
  acceptanceItems?: WorkItemAcceptanceSeedInput[];
  at?: Date;
};

export type UpdateStoredWorkItemFromSessionInput = {
  workItemId: string;
  title?: string;
  rawDescription?: string;
  summaryMd?: string;
  status: WorkItemStatus;
  selectedOptionIds?: string[];
  planningNote?: string | null;
  acceptanceItems?: WorkItemAcceptanceSeedInput[];
  at?: Date;
};

export type WorkItemAcceptanceSeedInput = {
  title: string;
  description?: string | null;
  status?: "open" | "met" | "unmet" | "waived";
  sortOrder?: number;
};

export type InsertStoredChatMessageInput = {
  id?: string;
  workItemId: string;
  role: "user" | "assistant" | "system";
  kind: string;
  contentJson: Record<string, unknown>;
  selectedOptionKey?: string;
  userOtherText?: string;
  at?: Date;
};

export type StoredWorkItemDetailRows = {
  workItem: WorkItemRow;
  projectOwnerUserId: string | null;
  acceptance: WorkItemAcceptanceRow[];
  agentSteps: WorkItemAgentStepRow[];
  latestProposal: WorkItemProposalRow | null;
  acceptedDeliverables: WorkItemAcceptedDeliverableRow[];
  evidenceBindings: WorkItemChatMessageRow[];
  driveSourceComment: WorkItemDriveSourceCommentRow | null;
  meetingSourceInsight: WorkItemMeetingSourceInsightRow | null;
};

export type WorkItemKnowledgeSearchInput = {
  query?: string;
  projectId?: string;
  workItemId?: string;
  limit?: number;
};

export type WorkItemKnowledgeSearchRows = {
  documents: WorkItemKnowledgeDocumentRow[];
  workItems: WorkItemRow[];
};

export type WorkItemRepository = {
  findWorkItemForHumanReservedGuard: (workItemId: string) => Promise<WorkItemHumanReservedRow | null>;
  findWorkItemForNotificationContext: (workItemId: string) => Promise<WorkItemNotificationContextRow | null>;
  markHumanReservedPmMode: (input: {
    workItemId: string;
    at: Date;
  }) => Promise<WorkItemHumanReservedRow | null>;
  // findings[H8/H9]：CAS 守卫的状态机迁移——仅当当前状态是 `to` 的合法前驱(按 allowedWorkItemTransitions)时才写，
  // 否则 0 行(no-op，返回 null)。供 agent-runner 把跑完的工作项推进 ai_working→in_review / ai_working→escalated，
  // 也防止 illegal 迁移(此前各处直接 SET status 不校验前驱)。
  transitionWorkItemStatus: (input: {
    workItemId: string;
    to: WorkItemStatus;
    at: Date;
  }) => Promise<{ id: string; status: WorkItemStatus } | null>;
};

export type WorkItemDataRepository = WorkItemRepository & {
  findProjectById: (projectId: string) => Promise<WorkItemProjectRow | null>;
  findFirstActiveProject: () => Promise<WorkItemProjectRow | null>;
  createWorkItem: (input: CreateStoredWorkItemInput) => Promise<WorkItemRow>;
  updateWorkItemFromSession: (input: UpdateStoredWorkItemFromSessionInput) => Promise<WorkItemRow | null>;
  insertChatMessage: (input: InsertStoredChatMessageInput) => Promise<WorkItemChatMessageRow>;
  listSessionSelectedOptionIds: (workItemId: string) => Promise<string[]>;
  findWorkItemById: (workItemId: string) => Promise<WorkItemRow | null>;
  readWorkItemDetail: (workItemId: string) => Promise<StoredWorkItemDetailRows | null>;
  findAcceptedDeliverableFile: (
    workItemId: string,
    acceptedChangeId: string
  ) => Promise<WorkItemAcceptedDeliverableRow | null>;
  restoreAcceptedDeliverable: (input: {
    workItemId: string;
    acceptedChangeId: string;
    actorKind: "human" | "ai" | "system";
    actorUserId: string;
    at?: Date;
  }) => Promise<WorkItemAcceptedDeliverableRow | null>;
  searchKnowledge: (input: WorkItemKnowledgeSearchInput) => Promise<WorkItemKnowledgeSearchRows>;
};

const trueCondition = sql`true`;

function whereAll(conditions: SQL[]) {
  return conditions.length > 0 ? and(...conditions) : trueCondition;
}

function uniqueSelectedOptionIds(ids: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const id of ids) {
    const trimmed = id.trim();
    if (trimmed && !seen.has(trimmed)) {
      seen.add(trimmed);
      result.push(trimmed);
    }
  }
  return result;
}

function selectedOptionIdsFromChatContent(contentJson: unknown, selectedOptionKey?: string | null) {
  const rawIds = contentJson && typeof contentJson === "object" && !Array.isArray(contentJson)
    ? (contentJson as Record<string, unknown>)["selected_option_ids"]
    : undefined;
  const ids = Array.isArray(rawIds)
    ? rawIds.filter((id): id is string => typeof id === "string")
    : [];
  if (selectedOptionKey) {
    ids.push(selectedOptionKey);
  }
  return uniqueSelectedOptionIds(ids);
}

function acceptedDeliverableColumns() {
  return {
    accepted: acceptedDeliverableChanges,
    driveItem: projectDriveItems,
    driveVersion: projectDriveVersions
  };
}

type DriveFolderNode = { id: string; parentId: string | null; name: string };

// findings[#24]：原实现为算一个文件夹路径，把整个项目的 drive items 全量(所有列)拉进内存建 Map——开销随项目
// drive 总量线性增长（不是路径深度），是潜在全表扫描悬崖。改为从该文件夹按 parentId 逐级单行上溯（≤50 跳，
// 与旧实现的环/深度上限一致），每跳只取 id/parentId/name 三列、按主键命中。fetchParent 注入以便纯函数单测。
export async function resolveDriveFolderPath(
  folder: DriveFolderNode,
  fetchParent: (id: string) => Promise<DriveFolderNode | undefined>
): Promise<string> {
  const names: string[] = [folder.name];
  const seen = new Set<string>([folder.id]);
  let parentId = folder.parentId;
  while (parentId && !seen.has(parentId) && names.length < 50) {
    seen.add(parentId);
    const parent = await fetchParent(parentId);
    if (!parent) {
      break;
    }
    names.unshift(parent.name);
    parentId = parent.parentId;
  }
  return `/${names.join("/")}`;
}

function acceptedDeliverableQuery(db: WorkHubDb, input: { workItemId: string; acceptedChangeId?: string }) {
  const conditions: SQL[] = [
    eq(acceptedDeliverableChanges.workItemId, input.workItemId),
    isNull(acceptedDeliverableChanges.supersededAt)
  ];
  if (input.acceptedChangeId) {
    conditions.push(eq(acceptedDeliverableChanges.id, input.acceptedChangeId));
  }
  return db
    .select(acceptedDeliverableColumns())
    .from(acceptedDeliverableChanges)
    .leftJoin(projectDriveItems, eq(acceptedDeliverableChanges.driveItemId, projectDriveItems.id))
    .leftJoin(projectDriveVersions, eq(acceptedDeliverableChanges.driveVersionId, projectDriveVersions.id))
    .where(and(...conditions));
}

function acceptedDeliverableQueryForTx(
  tx: WorkHubTx,
  input: { workItemId: string; acceptedChangeId?: string }
) {
  const conditions: SQL[] = [
    eq(acceptedDeliverableChanges.workItemId, input.workItemId),
    isNull(acceptedDeliverableChanges.supersededAt)
  ];
  if (input.acceptedChangeId) {
    conditions.push(eq(acceptedDeliverableChanges.id, input.acceptedChangeId));
  }
  return tx
    .select(acceptedDeliverableColumns())
    .from(acceptedDeliverableChanges)
    .leftJoin(projectDriveItems, eq(acceptedDeliverableChanges.driveItemId, projectDriveItems.id))
    .leftJoin(projectDriveVersions, eq(acceptedDeliverableChanges.driveVersionId, projectDriveVersions.id))
    .where(and(...conditions));
}

export function createWorkItemRepository(db: WorkHubDb): WorkItemDataRepository {
  return {
    async findWorkItemForHumanReservedGuard(workItemId) {
      const rows = await db
        .select(humanReservedGuardColumns)
        .from(workItems)
        .where(eq(workItems.id, workItemId))
        .limit(1);
      return rows[0] ?? null;
    },

    async findWorkItemForNotificationContext(workItemId) {
      const rows = await db
        .select(notificationContextColumns)
        .from(workItems)
        .innerJoin(projects, eq(workItems.projectId, projects.id))
        .where(eq(workItems.id, workItemId))
        .limit(1);
      return rows[0] ?? null;
    },

    async markHumanReservedPmMode(input) {
      const rows = await db
        .update(workItems)
        .set({
          status: "pm_mode",
          mode: "pm",
          version: sql`${workItems.version} + 1`,
          updatedAt: input.at
        })
        .where(
          and(
            eq(workItems.id, input.workItemId),
            eq(workItems.humanReserved, true),
            inArray(workItems.status, pmModeEligibleStatuses)
          )
        )
        .returning(humanReservedGuardColumns);
      return rows[0] ?? null;
    },

    async transitionWorkItemStatus(input) {
      // 反查 allowedWorkItemTransitions 得到 `to` 的所有合法前驱状态。
      const predecessors = (Object.entries(allowedWorkItemTransitions) as [WorkItemStatus, readonly WorkItemStatus[]][])
        .filter(([, targets]) => targets.includes(input.to))
        .map(([from]) => from);
      if (predecessors.length === 0) {
        return null;
      }
      const rows = await db
        .update(workItems)
        .set({
          status: input.to,
          version: sql`${workItems.version} + 1`,
          updatedAt: input.at
        })
        .where(
          and(
            eq(workItems.id, input.workItemId),
            inArray(workItems.status, predecessors),
            isNull(workItems.deletedAt)
          )
        )
        .returning({ id: workItems.id, status: workItems.status });
      return rows[0] ?? null;
    },

    async findProjectById(projectId) {
      const rows = await db
        .select()
        .from(projects)
        .where(and(eq(projects.id, projectId), eq(projects.archived, false), isNull(projects.deletedAt)))
        .limit(1);
      return rows[0] ?? null;
    },

    async findFirstActiveProject() {
      const rows = await db
        .select()
        .from(projects)
        .where(and(eq(projects.archived, false), isNull(projects.deletedAt)))
        .orderBy(asc(projects.createdAt))
        .limit(1);
      return rows[0] ?? null;
    },

    async createWorkItem(input) {
      const at = input.at ?? new Date();
      const allocation = await allocateProjectCode(db, input.projectId);
      const values: typeof workItems.$inferInsert = {
          id: input.id ?? randomUUID(),
          code: allocation.code,
          projectId: input.projectId,
          submitterUserId: input.submitterUserId,
          status: input.status ?? "intake",
          priority: input.priority ?? "normal",
          mode: input.mode ?? "worker",
          humanReserved: false,
          createdAt: at,
          updatedAt: at
        };
      if (input.workspaceId) values.workspaceId = input.workspaceId;
      if (input.title) values.title = input.title;
      if (input.rawDescription) values.rawDescription = input.rawDescription;
      if (input.summaryMd) values.summaryMd = input.summaryMd;
      if (input.planningNote) {
        values.planningNote = input.planningNote;
      } else if (input.selectedOptionIds?.length) {
        values.planningNote = `selected_options: ${input.selectedOptionIds.join(",")}`;
      }
      const rows = await db
        .insert(workItems)
        .values(values)
        .returning();
      const row = rows[0];
      if (!row) {
        throw new Error("Failed to create work item");
      }
      if (input.acceptanceItems?.length) {
        await db.insert(workItemAcceptanceItems).values(
          input.acceptanceItems.map((item, index) => ({
            id: randomUUID(),
            workItemId: row.id,
            title: item.title,
            ...(item.description ? { description: item.description } : {}),
            status: item.status ?? "open",
            sortOrder: item.sortOrder ?? index,
            createdAt: at,
            updatedAt: at
          }))
        );
      }
      return row;
    },

    async updateWorkItemFromSession(input) {
      const at = input.at ?? new Date();
      // findings[#19/H4]：session-finalize 只允许从「澄清阶段」(intake/ai_clarifying/spec_ready) 或同状态幂等改写
      // 推进——绝不能把已交付/终态(merged/done/cancelled)或在审/升级(in_review/escalated/pm_mode)的事项回滚到
      // spec_ready/ai_working：那会复活成品、覆盖 title/raw_description/summary，并(下方)清空已评审的验收态。
      // service 层只会传 spec_ready/ai_working，故终态事项经公开 API 永远进不来。`input.status` 自纳保证同状态
      // 改写(如 r1-pg smoke 模拟「并发人工改标题」对自身状态重写)照常通过，与具体当前状态无关。
      // 0 行命中 → 返回 null → service 抛 409 状态冲突(item 必存在，requireDetail 先于此已校验)。
      const allowedFromStatuses = sessionFinalizeFromStatuses(input.status);
      // findings[#20/H5]：状态更新 + 验收项删/插放进同一事务原子完成——否则崩在 delete 与 insert 之间会永久
      // 留下零验收行；状态守卫也确保终态/在审事项的验收态绝不被本路径截断重写。
      return db.transaction(async (tx) => {
        const rows = await tx
          .update(workItems)
          .set({
            ...(input.title ? { title: input.title } : {}),
            ...(input.rawDescription ? { rawDescription: input.rawDescription } : {}),
            ...(input.summaryMd ? { summaryMd: input.summaryMd } : {}),
            status: input.status,
            planningNote: input.planningNote
              ? input.planningNote
              : input.selectedOptionIds?.length
              ? `selected_options: ${input.selectedOptionIds.join(",")}`
              : undefined,
            version: sql`${workItems.version} + 1`,
            updatedAt: at
          })
          .where(and(
            eq(workItems.id, input.workItemId),
            inArray(workItems.status, allowedFromStatuses),
            isNull(workItems.deletedAt)
          ))
          .returning();
        const row = rows[0] ?? null;
        if (row && input.acceptanceItems) {
          await tx.delete(workItemAcceptanceItems).where(eq(workItemAcceptanceItems.workItemId, input.workItemId));
          if (input.acceptanceItems.length > 0) {
            await tx.insert(workItemAcceptanceItems).values(
              input.acceptanceItems.map((item, index) => ({
                id: randomUUID(),
                workItemId: input.workItemId,
                title: item.title,
                ...(item.description ? { description: item.description } : {}),
                status: item.status ?? "open",
                sortOrder: item.sortOrder ?? index,
                createdAt: at,
                updatedAt: at
              }))
            );
          }
        }
        return row;
      });
    },

    async insertChatMessage(input) {
      const at = input.at ?? new Date();
      const values: typeof chatMessages.$inferInsert = {
          id: input.id ?? randomUUID(),
          workItemId: input.workItemId,
          role: input.role,
          kind: input.kind,
          contentJson: input.contentJson,
          createdAt: at,
          updatedAt: at
        };
      if (input.selectedOptionKey) values.selectedOptionKey = input.selectedOptionKey;
      if (input.userOtherText) values.userOtherText = input.userOtherText;
      const rows = await db
        .insert(chatMessages)
        .values(values)
        .returning();
      const row = rows[0];
      if (!row) {
        throw new Error("Failed to create chat message");
      }
      return row;
    },

    async listSessionSelectedOptionIds(workItemId) {
      const rows = await db
        .select({
          contentJson: chatMessages.contentJson,
          selectedOptionKey: chatMessages.selectedOptionKey
        })
        .from(chatMessages)
        .where(and(eq(chatMessages.workItemId, workItemId), eq(chatMessages.kind, "clarification_answer")))
        .orderBy(asc(chatMessages.createdAt));
      return uniqueSelectedOptionIds(
        rows.flatMap((row) => selectedOptionIdsFromChatContent(row.contentJson, row.selectedOptionKey))
      );
    },

    async findWorkItemById(workItemId) {
      const rows = await db.select().from(workItems).where(eq(workItems.id, workItemId)).limit(1);
      return rows[0] ?? null;
    },

    async readWorkItemDetail(workItemId) {
      const rows = await db
        .select({
          workItem: workItems,
          projectOwnerUserId: projects.ownerUserId
        })
        .from(workItems)
        .innerJoin(projects, eq(workItems.projectId, projects.id))
        // findings：补 isNull(deletedAt)——此前中央读路径漏了软删过滤（其它读路径如 search/findProject 都有），
        // 导致已软删的工作项仍能经 detailPage 读出。
        .where(and(eq(workItems.id, workItemId), isNull(workItems.deletedAt)))
        .limit(1);
      const row = rows[0];
      if (!row) {
        return null;
      }

      const latestRunRows = await db
        .select({ id: agentRuns.id })
        .from(agentRuns)
        .where(eq(agentRuns.workItemId, workItemId))
        .orderBy(desc(agentRuns.createdAt))
        .limit(1);
      const latestRunId = latestRunRows[0]?.id;
      const agentStepRows = latestRunId
        ? await db
            .select()
            .from(agentSteps)
            .where(eq(agentSteps.agentRunId, latestRunId))
            .orderBy(asc(agentSteps.seq), asc(agentSteps.createdAt))
            .limit(8)
        : [];

      const [acceptance, latestProposals, acceptedDeliverables, evidenceBindings, driveSourceComments, meetingSourceInsights] = await Promise.all([
        db
          .select()
          .from(workItemAcceptanceItems)
          .where(eq(workItemAcceptanceItems.workItemId, workItemId))
          .orderBy(asc(workItemAcceptanceItems.sortOrder), asc(workItemAcceptanceItems.createdAt)),
        db
          .select()
          .from(proposals)
          .where(eq(proposals.workItemId, workItemId))
          .orderBy(desc(proposals.createdAt))
          .limit(1),
        acceptedDeliverableQuery(db, { workItemId })
          .orderBy(desc(acceptedDeliverableChanges.createdAt)),
        db
          .select()
          .from(chatMessages)
          .where(and(eq(chatMessages.workItemId, workItemId), eq(chatMessages.kind, "evidence_binding")))
          .orderBy(desc(chatMessages.createdAt))
          .limit(20),
        db
          .select({
            comment: projectDriveComments,
            folder: projectDriveItems
          })
          .from(projectDriveComments)
          .leftJoin(projectDriveItems, eq(projectDriveComments.folderId, projectDriveItems.id))
          .where(eq(projectDriveComments.draftWorkItemId, workItemId))
          .orderBy(desc(projectDriveComments.updatedAt), desc(projectDriveComments.createdAt))
          .limit(1),
        db
          .select({
            insight: meetingInsights,
            meeting: meetingRecords
          })
          .from(meetingInsights)
          .innerJoin(meetingRecords, eq(meetingInsights.meetingId, meetingRecords.id))
          .where(eq(meetingInsights.createdWorkItemId, workItemId))
          .orderBy(desc(meetingInsights.updatedAt), desc(meetingInsights.createdAt))
          .limit(1)
      ]);

      const driveSourceComment = driveSourceComments[0] ?? null;
      let driveSourceCommentWithPath: WorkItemDriveSourceCommentRow | null = null;
      if (driveSourceComment) {
        let folderPath: string | null = null;
        if (driveSourceComment.folder) {
          folderPath = await resolveDriveFolderPath(driveSourceComment.folder, async (id) => {
            const rows = await db
              .select({ id: projectDriveItems.id, parentId: projectDriveItems.parentId, name: projectDriveItems.name })
              .from(projectDriveItems)
              .where(eq(projectDriveItems.id, id))
              .limit(1);
            return rows[0];
          });
        }
        driveSourceCommentWithPath = {
          ...driveSourceComment,
          folderPath
        };
      }

      return {
        workItem: row.workItem,
        projectOwnerUserId: row.projectOwnerUserId,
        acceptance,
        agentSteps: agentStepRows,
        latestProposal: latestProposals[0] ?? null,
        acceptedDeliverables,
        evidenceBindings,
        driveSourceComment: driveSourceCommentWithPath,
        meetingSourceInsight: meetingSourceInsights[0] ?? null
      };
    },

    async findAcceptedDeliverableFile(workItemId, acceptedChangeId) {
      const rows = await acceptedDeliverableQuery(db, { workItemId, acceptedChangeId })
        .limit(1);
      return rows[0] ?? null;
    },

    async restoreAcceptedDeliverable(input) {
      const at = input.at ?? new Date();
      let restoredAcceptedChangeId: string | undefined;
      await db.transaction(async (tx) => {
        // 与 merge()/apply() 同 project-merge advisory lock 串行化：否则 restore 与并发采纳交错，
        // 同一 targetKey 可能出现两个未被 superseded 的「当前」交付物。锁后再读当前版本。
        const wiRows = await tx
          .select({ projectId: workItems.projectId })
          .from(workItems)
          .where(eq(workItems.id, input.workItemId))
          .limit(1);
        const projectId = wiRows[0]?.projectId;
        if (projectId) {
          await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`project-merge:${projectId}`})::bigint)`);
        }
        const currentRows = await acceptedDeliverableQueryForTx(tx, {
          workItemId: input.workItemId,
          acceptedChangeId: input.acceptedChangeId
        }).limit(1);
        const current = currentRows[0];
        if (!current) {
          return;
        }
        if (!current.driveItem || !current.driveVersion || !current.accepted.driveItemId || !current.accepted.driveVersionId) {
          throw new WorkItemAcceptedDeliverableRestoreError(
            "deliverable_not_versioned",
            "这份正式交付物没有可还原的文件版本。"
          );
        }
        if (current.driveItem.currentVersionId !== current.driveVersion.id) {
          throw new WorkItemAcceptedDeliverableRestoreError(
            "deliverable_version_changed",
            "正式交付物版本已经变化，请刷新后重试。"
          );
        }

        const previousRows = await tx
          .select(acceptedDeliverableColumns())
          .from(acceptedDeliverableChanges)
          .leftJoin(projectDriveItems, eq(acceptedDeliverableChanges.driveItemId, projectDriveItems.id))
          .leftJoin(projectDriveVersions, eq(acceptedDeliverableChanges.driveVersionId, projectDriveVersions.id))
          .where(and(
            eq(acceptedDeliverableChanges.workItemId, current.accepted.workItemId),
            eq(acceptedDeliverableChanges.targetKey, current.accepted.targetKey),
            eq(acceptedDeliverableChanges.driveItemId, current.driveItem.id),
            lt(acceptedDeliverableChanges.acceptedVersion, current.accepted.acceptedVersion),
            isNotNull(acceptedDeliverableChanges.supersededAt),
            isNotNull(acceptedDeliverableChanges.driveVersionId)
          ))
          .orderBy(desc(acceptedDeliverableChanges.acceptedVersion), desc(acceptedDeliverableChanges.createdAt))
          .limit(1);
        const previous = previousRows[0];
        if (!previous?.driveVersion) {
          throw new WorkItemAcceptedDeliverableRestoreError(
            "deliverable_no_previous_version",
            "这份正式交付物还没有上一版可还原。"
          );
        }

        const updatedItems = await tx
          .update(projectDriveItems)
          .set({
            currentVersionId: previous.driveVersion.id,
            updatedByUserId: input.actorUserId,
            updatedAt: at
          })
          .where(and(
            eq(projectDriveItems.id, current.driveItem.id),
            eq(projectDriveItems.currentVersionId, current.driveVersion.id)
          ))
          .returning({ id: projectDriveItems.id });
        if (updatedItems.length === 0) {
          throw new WorkItemAcceptedDeliverableRestoreError(
            "deliverable_version_changed",
            "正式交付物版本已经变化，请刷新后重试。"
          );
        }

        await tx
          .update(acceptedDeliverableChanges)
          .set({ supersededAt: at, updatedAt: at })
          .where(eq(acceptedDeliverableChanges.id, current.accepted.id));
        await tx
          .update(acceptedDeliverableChanges)
          .set({ supersededAt: null, updatedAt: at })
          .where(eq(acceptedDeliverableChanges.id, previous.accepted.id));
        await tx
          .update(workItems)
          .set({
            version: sql`${workItems.version} + 1`,
            updatedAt: at
          })
          .where(eq(workItems.id, current.accepted.workItemId));
        await tx.insert(projectDriveOperations).values({
          id: randomUUID(),
          projectId: current.driveItem.projectId,
          actorUserId: input.actorUserId,
          opType: "restore_version",
          payloadJson: {
            work_item_id: current.accepted.workItemId,
            accepted_change_id: current.accepted.id,
            restored_accepted_change_id: previous.accepted.id,
            drive_item_id: current.driveItem.id,
            from_drive_version_id: current.driveVersion.id,
            to_drive_version_id: previous.driveVersion.id,
            target_key: current.accepted.targetKey
          },
          createdAt: at,
          updatedAt: at
        });
        await tx.insert(auditLogs).values({
          id: randomUUID(),
          actorKind: input.actorKind,
          actorUserId: input.actorUserId,
          entityType: "accepted_deliverable",
          entityId: current.accepted.id,
          action: "accepted_deliverable.reverted",
          detailJson: {
            work_item_id: current.accepted.workItemId,
            restored_accepted_change_id: previous.accepted.id,
            drive_item_id: current.driveItem.id,
            from_drive_version_id: current.driveVersion.id,
            to_drive_version_id: previous.driveVersion.id,
            target_key: current.accepted.targetKey
          },
          createdAt: at
        });
        restoredAcceptedChangeId = previous.accepted.id;
      });

      if (!restoredAcceptedChangeId) {
        return null;
      }
      const rows = await acceptedDeliverableQuery(db, {
        workItemId: input.workItemId,
        acceptedChangeId: restoredAcceptedChangeId
      }).limit(1);
      return rows[0] ?? null;
    },

    async searchKnowledge(input) {
      const query = input.query?.trim();
      const limit = Math.max(1, Math.min(input.limit ?? 10, 20));
      const pattern = query ? `%${query}%` : undefined;
      const documentConditions: SQL[] = [];
      const workItemConditions: SQL[] = [isNull(workItems.deletedAt)];

      if (input.projectId) {
        documentConditions.push(eq(knowledgeDocuments.projectId, input.projectId));
        workItemConditions.push(eq(workItems.projectId, input.projectId));
      }
      if (input.workItemId) {
        documentConditions.push(eq(knowledgeDocuments.workItemId, input.workItemId));
        workItemConditions.push(eq(workItems.id, input.workItemId));
      }
      if (pattern) {
        documentConditions.push(
          or(
            ilike(knowledgeDocuments.title, pattern),
            ilike(knowledgeDocuments.sourceId, pattern),
            ilike(knowledgeDocuments.sourceUrl, pattern)
          ) ?? trueCondition
        );
        workItemConditions.push(
          or(
            ilike(workItems.code, pattern),
            ilike(workItems.title, pattern),
            ilike(workItems.rawDescription, pattern),
            ilike(workItems.summaryMd, pattern)
          ) ?? trueCondition
        );
      }

      const [documents, workItemRows] = await Promise.all([
        db
          .select()
          .from(knowledgeDocuments)
          .where(whereAll(documentConditions))
          .orderBy(desc(knowledgeDocuments.updatedAt))
          .limit(limit),
        db
          .select()
          .from(workItems)
          .where(whereAll(workItemConditions))
          .orderBy(desc(workItems.updatedAt))
          .limit(limit)
      ]);

      return {
        documents,
        workItems: workItemRows
      };
    }
  };
}
