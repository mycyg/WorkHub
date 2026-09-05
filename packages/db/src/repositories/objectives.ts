import { randomUUID } from "node:crypto";

import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";

import type { WorkItemStatus } from "@workhub/contracts";

import type { WorkHubDb } from "../client.js";
import {
  keyResults,
  objectiveWorkItemLinks,
  objectives,
  taskPlans,
  workItems
} from "../schema/index.js";

export type ObjectiveRow = typeof objectives.$inferSelect;
export type KeyResultRow = typeof keyResults.$inferSelect;
export type ObjectiveWorkItemLinkRow = typeof objectiveWorkItemLinks.$inferSelect;
export type ObjectiveLinkedWorkItemRow = Pick<typeof workItems.$inferSelect, "id" | "status">;

export type CreateObjectiveKeyResultInput = {
  id: string;
  seq: number;
  title: string;
  targetValue?: string | null;
  currentValue?: string | null;
  unit?: string | null;
  progressPercent?: number;
};

export type CreateObjectiveInput = {
  id: string;
  workspaceId: string;
  title: string;
  descriptionMd?: string | null;
  ownerUserId?: string | null;
  status?: ObjectiveRow["status"];
  keyResults?: CreateObjectiveKeyResultInput[];
  now?: Date;
};

export type LinkObjectiveWorkItemInput = {
  id?: string;
  workspaceId: string;
  objectiveId: string;
  workItemId: string;
  linkedByUserId?: string | null;
  now?: Date;
};

export type ObjectivePlanningContextItem = {
  objective: ObjectiveRow;
  keyResults: KeyResultRow[];
};

export type ObjectivePlanningContextResult = {
  objectives: ObjectivePlanningContextItem[];
  objectivesCapped: boolean;
  keyResultsCapped: boolean;
};

export type ObjectiveProgressSnapshot = {
  objective: ObjectiveRow;
  keyResults: KeyResultRow[];
  linkedWorkItems: ObjectiveLinkedWorkItemRow[];
  keyResultsCapped: boolean;
  workItemsCapped: boolean;
};

// R23 F-01（OKR 列表/详情持久化）——列表只喂项目主页 OKR 卡的行渲染（标题/状态/进度），不带 key
// results（列表页从不展示它们，详情页才展示），避免每次列出一整屏目标时再搭一份不会用到的联表。
export type ObjectiveListResult = {
  items: ObjectiveRow[];
  capped: boolean;
};

// 比 ObjectiveLinkedWorkItemRow（进度刷新用，只要 id+status）多带 code/title——详情页要能渲一行
// 可点的工作项链接，不能只给裸 uuid。
export type ObjectiveDetailLinkedWorkItemRow = Pick<typeof workItems.$inferSelect, "id" | "code" | "title" | "status">;
// task_plans.objective_id 这条既有列此前没有任何查询读过（只有反向：按 plan 找它挂的 objective，见
// task-plans 仓库的 listDashboardPlans）——详情页顺手把「挂了这个目标的执行计划」列出来。
export type ObjectiveDetailLinkedTaskPlanRow = Pick<typeof taskPlans.$inferSelect, "id" | "workItemId" | "status" | "createdAt">;

export type ObjectiveDetailResult = {
  objective: ObjectiveRow;
  keyResults: KeyResultRow[];
  linkedWorkItems: ObjectiveDetailLinkedWorkItemRow[];
  linkedTaskPlans: ObjectiveDetailLinkedTaskPlanRow[];
  keyResultsCapped: boolean;
  workItemsCapped: boolean;
  taskPlansCapped: boolean;
};

export type ObjectiveRepository = {
  createObjective: (input: CreateObjectiveInput) => Promise<ObjectiveRow>;
  linkWorkItem: (input: LinkObjectiveWorkItemInput) => Promise<ObjectiveWorkItemLinkRow>;
  listPlanningContextForWorkItem: (input: {
    workspaceId: string;
    workItemId: string;
    limit?: number;
    keyResultLimit?: number;
  }) => Promise<ObjectivePlanningContextResult>;
  readObjectiveProgressSnapshot: (input: {
    workspaceId: string;
    objectiveId: string;
    keyResultLimit?: number;
    workItemLimit?: number;
  }) => Promise<ObjectiveProgressSnapshot | null>;
  updateObjectiveProgress: (input: {
    workspaceId: string;
    objectiveId: string;
    progressPercent: number;
    progressUpdatedAt?: Date;
  }) => Promise<ObjectiveRow | null>;
  // B-R9.5-1：夜间聚合刷新进度的输入面——按工作区列活跃 objective。
  // UX-M10：成本页按目标维度的标题源。
  listObjectiveTitlesByIds: (input: { workspaceId: string; objectiveIds: string[] }) => Promise<Map<string, string>>;
  listActiveObjectiveIdsForWorkspace: (input: { workspaceId: string; limit?: number }) => Promise<string[]>;
  // R23 F-01：项目主页 OKR 面板首屏真拉取——按工作区列全部状态的目标（不只 active），按最近更新排序。
  listObjectivesForWorkspace: (input: { workspaceId: string; limit?: number }) => Promise<ObjectiveListResult>;
  // R23 F-01：目标详情——同 readObjectiveProgressSnapshot 的对象/关键结果/挂链工作项查询，但工作项带
  // code/title（供渲染），并额外带上挂了这个目标的任务计划。刻意与 readObjectiveProgressSnapshot 分开
  // （不复用同一条查询）：后者是夜间刷新进度的热路径，不该为一个展示增强字段多担一条计划表联查的成本。
  readObjectiveDetail: (input: {
    workspaceId: string;
    objectiveId: string;
    keyResultLimit?: number;
    workItemLimit?: number;
    planLimit?: number;
  }) => Promise<ObjectiveDetailResult | null>;
};

export class ObjectiveLinkScopeMismatch extends Error {
  constructor() {
    super("objective_link_scope_mismatch");
    this.name = "ObjectiveLinkScopeMismatch";
  }
}

const DEFAULT_OBJECTIVE_LIMIT = 5;
const MAX_OBJECTIVE_LIMIT = 20;
const DEFAULT_KEY_RESULT_LIMIT = 8;
const MAX_KEY_RESULT_LIMIT = 40;
const DEFAULT_WORK_ITEM_LIMIT = 100;
const MAX_WORK_ITEM_LIMIT = 300;
// R23 F-01：用户可见的「列出目标」页比 LLM 规划上下文（DEFAULT_OBJECTIVE_LIMIT=5，专为提示词预算裁的
// 小值）宽松得多——独立一组常量，别复用规划上下文那两个。
const DEFAULT_OBJECTIVE_LIST_LIMIT = 20;
const MAX_OBJECTIVE_LIST_LIMIT = 50;
const DEFAULT_LINKED_TASK_PLAN_LIMIT = 20;
const MAX_LINKED_TASK_PLAN_LIMIT = 50;

function boundedLimit(input: number | undefined, fallback: number, max: number) {
  if (!Number.isFinite(input)) {
    return fallback;
  }
  return Math.min(Math.max(Math.floor(input ?? fallback), 0), max);
}

function clampProgress(input: number) {
  if (!Number.isFinite(input)) {
    return 0;
  }
  return Math.min(Math.max(Math.round(input), 0), 100);
}

function groupKeyResults(rows: Array<{ keyResult: KeyResultRow }>, objectiveIds: string[]) {
  const byObjective = new Map<string, KeyResultRow[]>();
  for (const id of objectiveIds) {
    byObjective.set(id, []);
  }
  for (const row of rows) {
    const bucket = byObjective.get(row.keyResult.objectiveId);
    if (bucket) {
      bucket.push(row.keyResult);
    }
  }
  return byObjective;
}

export function createObjectiveRepository(db: WorkHubDb): ObjectiveRepository {
  return {
    async createObjective(input) {
      const at = input.now ?? new Date();
      const objective = await db.transaction(async (tx) => {
        const [inserted] = await tx
          .insert(objectives)
          .values({
            id: input.id,
            workspaceId: input.workspaceId,
            title: input.title,
            descriptionMd: input.descriptionMd ?? null,
            ownerUserId: input.ownerUserId ?? null,
            status: input.status ?? "active",
            progressPercent: 0,
            progressUpdatedAt: null,
            createdAt: at,
            updatedAt: at
          })
          .returning();
        const inputKeyResults = input.keyResults ?? [];
        if (inputKeyResults.length > 0) {
          await tx
            .insert(keyResults)
            .values(inputKeyResults.map((row) => ({
              id: row.id,
              objectiveId: input.id,
              workspaceId: input.workspaceId,
              seq: row.seq,
              title: row.title,
              targetValue: row.targetValue ?? null,
              currentValue: row.currentValue ?? null,
              unit: row.unit ?? null,
              status: "active" as const,
              progressPercent: clampProgress(row.progressPercent ?? 0),
              createdAt: at,
              updatedAt: at
            })))
            .returning();
        }
        return inserted;
      });
      return objective!;
    },

    async linkWorkItem(input) {
      const [scope] = await db
        .select({
          objectiveId: objectives.id,
          workItemId: workItems.id
        })
        .from(objectives)
        .innerJoin(workItems, eq(workItems.id, input.workItemId))
        .where(and(
          eq(objectives.workspaceId, input.workspaceId),
          eq(objectives.id, input.objectiveId),
          eq(workItems.workspaceId, input.workspaceId),
          eq(workItems.id, input.workItemId),
          isNull(workItems.deletedAt)
        ))
        .limit(1);
      if (!scope) {
        throw new ObjectiveLinkScopeMismatch();
      }
      const [link] = await db
        .insert(objectiveWorkItemLinks)
        .values({
          id: input.id ?? randomUUID(),
          workspaceId: input.workspaceId,
          objectiveId: input.objectiveId,
          workItemId: input.workItemId,
          linkedByUserId: input.linkedByUserId ?? null,
          createdAt: input.now ?? new Date()
        })
        .returning();
      return link!;
    },

    async listPlanningContextForWorkItem(input) {
      const limit = boundedLimit(input.limit, DEFAULT_OBJECTIVE_LIMIT, MAX_OBJECTIVE_LIMIT);
      const keyResultLimit = boundedLimit(input.keyResultLimit, DEFAULT_KEY_RESULT_LIMIT, MAX_KEY_RESULT_LIMIT);
      const objectiveRows = await db
        .select({ objective: objectives })
        .from(objectiveWorkItemLinks)
        .innerJoin(objectives, eq(objectiveWorkItemLinks.objectiveId, objectives.id))
        .innerJoin(workItems, eq(objectiveWorkItemLinks.workItemId, workItems.id))
        .where(and(
          eq(objectiveWorkItemLinks.workspaceId, input.workspaceId),
          eq(objectiveWorkItemLinks.workItemId, input.workItemId),
          eq(objectives.workspaceId, input.workspaceId),
          eq(objectives.status, "active"),
          eq(workItems.workspaceId, input.workspaceId),
          isNull(workItems.deletedAt)
        ))
        .orderBy(desc(objectives.updatedAt), asc(objectives.id))
        .limit(limit + 1);
      const visibleObjectiveRows = objectiveRows.slice(0, limit);
      const objectiveIds = visibleObjectiveRows.map((row) => row.objective.id);
      if (objectiveIds.length === 0) {
        return {
          objectives: [],
          objectivesCapped: false,
          keyResultsCapped: false
        };
      }

      const keyResultRows = await db
        .select({ keyResult: keyResults })
        .from(keyResults)
        .where(and(
          eq(keyResults.workspaceId, input.workspaceId),
          inArray(keyResults.objectiveId, objectiveIds)
        ))
        .orderBy(asc(keyResults.objectiveId), asc(keyResults.seq), asc(keyResults.id))
        .limit(keyResultLimit + 1);
      const groupedKeyResults = groupKeyResults(keyResultRows.slice(0, keyResultLimit), objectiveIds);
      return {
        objectives: visibleObjectiveRows.map((row) => ({
          objective: row.objective,
          keyResults: groupedKeyResults.get(row.objective.id) ?? []
        })),
        objectivesCapped: objectiveRows.length > limit,
        keyResultsCapped: keyResultRows.length > keyResultLimit
      };
    },

    async readObjectiveProgressSnapshot(input) {
      const [objective] = await db
        .select()
        .from(objectives)
        .where(and(
          eq(objectives.workspaceId, input.workspaceId),
          eq(objectives.id, input.objectiveId)
        ))
        .limit(1);
      if (!objective) {
        return null;
      }
      const keyResultLimit = boundedLimit(input.keyResultLimit, DEFAULT_KEY_RESULT_LIMIT, MAX_KEY_RESULT_LIMIT);
      const workItemLimit = boundedLimit(input.workItemLimit, DEFAULT_WORK_ITEM_LIMIT, MAX_WORK_ITEM_LIMIT);
      const [keyResultRows, workItemRows] = await Promise.all([
        db
          .select()
          .from(keyResults)
          .where(and(
            eq(keyResults.workspaceId, input.workspaceId),
            eq(keyResults.objectiveId, input.objectiveId)
          ))
          .orderBy(asc(keyResults.seq), asc(keyResults.id))
          .limit(keyResultLimit + 1),
        db
          .select({
            id: workItems.id,
            status: workItems.status
          })
          .from(objectiveWorkItemLinks)
          .innerJoin(workItems, eq(objectiveWorkItemLinks.workItemId, workItems.id))
          .where(and(
            eq(objectiveWorkItemLinks.workspaceId, input.workspaceId),
            eq(objectiveWorkItemLinks.objectiveId, input.objectiveId),
            eq(workItems.workspaceId, input.workspaceId),
            isNull(workItems.deletedAt)
          ))
          .orderBy(desc(workItems.updatedAt), asc(workItems.id))
          .limit(workItemLimit + 1)
      ]);
      return {
        objective,
        keyResults: keyResultRows.slice(0, keyResultLimit),
        linkedWorkItems: workItemRows.slice(0, workItemLimit).map((row) => ({
          id: row.id,
          status: row.status as WorkItemStatus
        })),
        keyResultsCapped: keyResultRows.length > keyResultLimit,
        workItemsCapped: workItemRows.length > workItemLimit
      };
    },

    async updateObjectiveProgress(input) {
      const at = input.progressUpdatedAt ?? new Date();
      const [updated] = await db
        .update(objectives)
        .set({
          progressPercent: clampProgress(input.progressPercent),
          progressUpdatedAt: at,
          updatedAt: at
        })
        .where(and(
          eq(objectives.workspaceId, input.workspaceId),
          eq(objectives.id, input.objectiveId)
        ))
        .returning();
      return updated ?? null;
    },

    // UX-M10（成本页按目标维度）：批量取目标标题——成本账目里只有 objective id，
    // 渲染层不许拿裸 UUID 当名称。workspace 钉死。
    async listObjectiveTitlesByIds(input: { workspaceId: string; objectiveIds: string[] }): Promise<Map<string, string>> {
      const ids = [...new Set(input.objectiveIds)].slice(0, 50);
      const titles = new Map<string, string>();
      if (ids.length === 0) {
        return titles;
      }
      const rows = await db
        .select({ id: objectives.id, title: objectives.title })
        .from(objectives)
        .where(and(
          eq(objectives.workspaceId, input.workspaceId),
          inArray(objectives.id, ids)
        ));
      for (const row of rows) {
        titles.set(row.id, row.title);
      }
      return titles;
    },

    async listActiveObjectiveIdsForWorkspace(input) {
      const limit = Math.max(1, Math.min(Math.floor(input.limit ?? 20), 50));
      const rows = await db
        .select({ id: objectives.id })
        .from(objectives)
        .where(and(
          eq(objectives.workspaceId, input.workspaceId),
          eq(objectives.status, "active")
        ))
        .orderBy(desc(objectives.updatedAt))
        .limit(limit);
      return rows.map((row) => row.id);
    },

    // R23 F-01：项目主页 OKR 面板首屏——不筛状态（已完成/暂停的目标用户仍应能在列表里看到），按最近
    // 更新时间倒序。只取目标行本身，不带 key results（列表行渲染用不到，见 ObjectiveListResult 注释）。
    async listObjectivesForWorkspace(input) {
      const limit = boundedLimit(input.limit, DEFAULT_OBJECTIVE_LIST_LIMIT, MAX_OBJECTIVE_LIST_LIMIT);
      const rows = await db
        .select()
        .from(objectives)
        .where(eq(objectives.workspaceId, input.workspaceId))
        .orderBy(desc(objectives.updatedAt), asc(objectives.id))
        .limit(limit + 1);
      return {
        items: rows.slice(0, limit),
        capped: rows.length > limit
      };
    },

    async readObjectiveDetail(input) {
      const [objective] = await db
        .select()
        .from(objectives)
        .where(and(
          eq(objectives.workspaceId, input.workspaceId),
          eq(objectives.id, input.objectiveId)
        ))
        .limit(1);
      if (!objective) {
        return null;
      }
      const keyResultLimit = boundedLimit(input.keyResultLimit, DEFAULT_KEY_RESULT_LIMIT, MAX_KEY_RESULT_LIMIT);
      const workItemLimit = boundedLimit(input.workItemLimit, DEFAULT_WORK_ITEM_LIMIT, MAX_WORK_ITEM_LIMIT);
      const planLimit = boundedLimit(input.planLimit, DEFAULT_LINKED_TASK_PLAN_LIMIT, MAX_LINKED_TASK_PLAN_LIMIT);
      const [keyResultRows, workItemRows, planRows] = await Promise.all([
        db
          .select()
          .from(keyResults)
          .where(and(
            eq(keyResults.workspaceId, input.workspaceId),
            eq(keyResults.objectiveId, input.objectiveId)
          ))
          .orderBy(asc(keyResults.seq), asc(keyResults.id))
          .limit(keyResultLimit + 1),
        db
          .select({
            id: workItems.id,
            code: workItems.code,
            title: workItems.title,
            status: workItems.status
          })
          .from(objectiveWorkItemLinks)
          .innerJoin(workItems, eq(objectiveWorkItemLinks.workItemId, workItems.id))
          .where(and(
            eq(objectiveWorkItemLinks.workspaceId, input.workspaceId),
            eq(objectiveWorkItemLinks.objectiveId, input.objectiveId),
            eq(workItems.workspaceId, input.workspaceId),
            isNull(workItems.deletedAt)
          ))
          .orderBy(desc(workItems.updatedAt), asc(workItems.id))
          .limit(workItemLimit + 1),
        // task_plans.objective_id 是可空的直接列（不经链接表），按目标反查它挂了哪些执行计划。
        db
          .select({
            id: taskPlans.id,
            workItemId: taskPlans.workItemId,
            status: taskPlans.status,
            createdAt: taskPlans.createdAt
          })
          .from(taskPlans)
          .where(and(
            eq(taskPlans.workspaceId, input.workspaceId),
            eq(taskPlans.objectiveId, input.objectiveId)
          ))
          .orderBy(desc(taskPlans.createdAt), asc(taskPlans.id))
          .limit(planLimit + 1)
      ]);
      return {
        objective,
        keyResults: keyResultRows.slice(0, keyResultLimit),
        linkedWorkItems: workItemRows.slice(0, workItemLimit),
        linkedTaskPlans: planRows.slice(0, planLimit),
        keyResultsCapped: keyResultRows.length > keyResultLimit,
        workItemsCapped: workItemRows.length > workItemLimit,
        taskPlansCapped: planRows.length > planLimit
      };
    }
  };
}
