import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";

import type {
  TaskPlanItemStatus,
  TaskPlanItemRole,
  TaskPlanStatus
} from "@workhub/contracts";

import type { WorkHubDb } from "../client.js";
import type { AgentRunRow } from "./agent-runs.js";
import {
  agentRuns,
  escalationEvents,
  objectiveWorkItemLinks,
  objectives,
  taskPlanItems,
  taskPlans,
  workItems
} from "../schema/index.js";

type JsonObject = Record<string, unknown>;

export type TaskPlanRow = typeof taskPlans.$inferSelect;
export type TaskPlanItemRow = typeof taskPlanItems.$inferSelect;
export type TaskPlanRunRow = Pick<AgentRunRow,
  "id"
  | "parentRunId"
  | "workItemId"
  | "workspaceId"
  | "taskPlanId"
  | "taskPlanItemId"
  | "agentRole"
  | "title"
  | "status"
  | "costEstimate"
  | "outcomeReason"
  | "createdAt"
  | "updatedAt"
  | "finishedAt"
>;

export type CreateTaskPlanItemInput = {
  id: string;
  parentItemId?: string | null;
  seq: number;
  title: string;
  role: TaskPlanItemRole;
  objectiveMd: string;
  acceptanceMd: string;
  budgetSharePct: number;
  dependsOn?: string[];
};

export type CreateDraftTaskPlanInput = {
  id: string;
  workItemId: string;
  workspaceId: string;
  objectiveId?: string | null;
  budgetJson?: JsonObject;
  decompositionContextJson?: JsonObject;
  createdByUserId: string;
  items: CreateTaskPlanItemInput[];
  now?: Date;
};

export class TaskPlanObjectiveScopeMismatch extends Error {
  constructor() {
    super("Task plan objective must be linked to the plan work item in the same workspace.");
    this.name = "TaskPlanObjectiveScopeMismatch";
  }
}

export class TaskPlanWorkItemScopeMismatch extends Error {
  constructor() {
    super("Task plan work item must exist in the requested workspace.");
    this.name = "TaskPlanWorkItemScopeMismatch";
  }
}

export class TaskPlanDraftAlreadyExists extends Error {
  constructor() {
    super("A draft task plan already exists for this work item.");
    this.name = "TaskPlanDraftAlreadyExists";
  }
}

export class TaskPlanItemGraphMismatch extends Error {
  constructor() {
    super("Task plan item parent and dependency links must point to items in the same draft plan.");
    this.name = "TaskPlanItemGraphMismatch";
  }
}

// R9-BLOCK-7.154 / ux-flow-spec §3.2 防呆的服务端硬门：人审修订的预算份额必须合计 100。
// UI 禁用是软门，行内编辑绕过 UI（直接 POST 修订）时靠这里兜底。
export class TaskPlanBudgetShareMismatch extends Error {
  constructor(public readonly totalSharePct: number) {
    super(`Task plan item budget shares must sum to 100, got ${totalSharePct}.`);
    this.name = "TaskPlanBudgetShareMismatch";
  }
}

export type TaskPlanWithItems = {
  plan: TaskPlanRow;
  items: TaskPlanItemRow[];
  itemsCapped: boolean;
  runs?: TaskPlanRunRow[];
  runsCapped?: boolean;
};

export type TaskPlanDashboardPlanRow = {
  plan: TaskPlanRow;
  workItem: {
    id: string;
    code: string;
    title: string | null;
    status: string;
  };
  objective: {
    id: string | null;
    title: string | null;
    progressPercent: number | null;
  } | null;
};

export type TaskPlanDashboardEscalationRow = {
  id: string;
  workItemId: string;
  planId: string | null;
  runId: string | null;
  reasonMd: string;
  createdAt: Date;
};

export type TaskPlanDashboardRead = {
  plans: TaskPlanDashboardPlanRow[];
  plansCapped: boolean;
  items: TaskPlanItemRow[];
  itemsCapped: boolean;
  runs: TaskPlanRunRow[];
  runsCapped: boolean;
  escalations: TaskPlanDashboardEscalationRow[];
  escalationsCapped: boolean;
};

const DEFAULT_ITEM_LIMIT = 50;
const MAX_ITEM_LIMIT = 100;
const DEFAULT_DASHBOARD_PLAN_LIMIT = 20;
const MAX_DASHBOARD_PLAN_LIMIT = 50;
const DEFAULT_DASHBOARD_ITEM_LIMIT = 50;
const DEFAULT_DASHBOARD_RUN_LIMIT = 200;
const MAX_DASHBOARD_RUN_LIMIT = 500;
const DEFAULT_DASHBOARD_ESCALATION_LIMIT = 5;
const MAX_DASHBOARD_ESCALATION_LIMIT = 20;
const DASHBOARD_PLAN_STATUSES = ["proposed", "approved", "dispatching"] satisfies TaskPlanStatus[];
const taskPlanItemColumns = {
  id: taskPlanItems.id,
  planId: taskPlanItems.planId,
  parentItemId: taskPlanItems.parentItemId,
  seq: taskPlanItems.seq,
  title: taskPlanItems.title,
  role: taskPlanItems.role,
  objectiveMd: taskPlanItems.objectiveMd,
  acceptanceMd: taskPlanItems.acceptanceMd,
  budgetSharePct: taskPlanItems.budgetSharePct,
  dependsOn: taskPlanItems.dependsOn,
  status: taskPlanItems.status,
  createdAt: taskPlanItems.createdAt,
  updatedAt: taskPlanItems.updatedAt,
  dispatchEpoch: taskPlanItems.dispatchEpoch
};

function boundedItemLimit(input: number | undefined) {
  if (!Number.isFinite(input)) {
    return DEFAULT_ITEM_LIMIT;
  }
  return Math.min(Math.max(Math.floor(input ?? DEFAULT_ITEM_LIMIT), 0), MAX_ITEM_LIMIT);
}

function boundedLimit(input: number | undefined, fallback: number, max: number) {
  if (!Number.isFinite(input)) {
    return fallback;
  }
  return Math.min(Math.max(Math.floor(input ?? fallback), 0), max);
}

function parentPlanWorkspacePredicate(input: { planId: string; workspaceId: string }) {
  return sql`exists (
    select 1
    from ${taskPlans}
    where ${eq(taskPlans.id, taskPlanItems.planId)}
      and ${eq(taskPlans.id, input.planId)}
      and ${eq(taskPlans.workspaceId, input.workspaceId)}
  )`;
}

// 导出给 proposals repo 的合入写回复用（R9-BLOCK-7.154）：人审后的清单同样要过图校验。
export function validateDraftItemGraph(items: CreateTaskPlanItemInput[]) {
  const itemIds = new Set(items.map((item) => item.id));
  if (itemIds.size !== items.length) {
    throw new TaskPlanItemGraphMismatch();
  }
  for (const item of items) {
    const parentItemId = item.parentItemId ?? null;
    if (parentItemId && (parentItemId === item.id || !itemIds.has(parentItemId))) {
      throw new TaskPlanItemGraphMismatch();
    }
    for (const dependencyId of item.dependsOn ?? []) {
      if (dependencyId === item.id || !itemIds.has(dependencyId)) {
        throw new TaskPlanItemGraphMismatch();
      }
    }
  }
}

export function createTaskPlanRepository(db: WorkHubDb) {
  return {
    async createDraftPlan(input: CreateDraftTaskPlanInput): Promise<void> {
      const now = input.now ?? new Date();
      validateDraftItemGraph(input.items);
      await db.transaction(async (tx) => {
        const [workItemScope] = await tx
          .select({ workItemId: workItems.id })
          .from(workItems)
          .where(and(
            eq(workItems.id, input.workItemId),
            eq(workItems.workspaceId, input.workspaceId),
            isNull(workItems.deletedAt)
          ))
          .for("update")
          .limit(1);
        if (!workItemScope) {
          throw new TaskPlanWorkItemScopeMismatch();
        }
        const [existingDraft] = await tx
          .select({ id: taskPlans.id })
          .from(taskPlans)
          .where(and(
            eq(taskPlans.workItemId, input.workItemId),
            eq(taskPlans.workspaceId, input.workspaceId),
            eq(taskPlans.status, "draft" satisfies TaskPlanStatus)
          ))
          .limit(1);
        if (existingDraft) {
          throw new TaskPlanDraftAlreadyExists();
        }
        if (input.objectiveId) {
          const [scope] = await tx
            .select({ objectiveId: objectives.id })
            .from(objectives)
            .innerJoin(objectiveWorkItemLinks, eq(objectiveWorkItemLinks.objectiveId, objectives.id))
            .innerJoin(workItems, eq(workItems.id, objectiveWorkItemLinks.workItemId))
            .where(and(
              eq(objectives.id, input.objectiveId),
              eq(objectives.workspaceId, input.workspaceId),
              eq(objectiveWorkItemLinks.objectiveId, input.objectiveId),
              eq(objectiveWorkItemLinks.workItemId, input.workItemId),
              eq(objectiveWorkItemLinks.workspaceId, input.workspaceId),
              eq(workItems.id, input.workItemId),
              eq(workItems.workspaceId, input.workspaceId),
              isNull(workItems.deletedAt)
            ))
            .limit(1);
          if (!scope) {
            throw new TaskPlanObjectiveScopeMismatch();
          }
        }
        await tx.insert(taskPlans).values({
          id: input.id,
          workItemId: input.workItemId,
          workspaceId: input.workspaceId,
          status: "draft" satisfies TaskPlanStatus,
          objectiveId: input.objectiveId ?? null,
          budgetJson: input.budgetJson ?? {},
          decompositionContextJson: input.decompositionContextJson ?? {},
          createdByUserId: input.createdByUserId,
          createdAt: now,
          updatedAt: now
        });
        if (input.items.length === 0) {
          return;
        }
        await tx.insert(taskPlanItems).values(input.items.map((item) => ({
          id: item.id,
          planId: input.id,
          parentItemId: item.parentItemId ?? null,
          seq: item.seq,
          title: item.title,
          role: item.role,
          objectiveMd: item.objectiveMd,
          acceptanceMd: item.acceptanceMd,
          budgetSharePct: item.budgetSharePct,
          dependsOn: item.dependsOn ?? [],
          status: "pending" as const,
          createdAt: now,
          updatedAt: now
        })));
      });
    },

    async findDraftPlanForWorkItem(input: {
      workItemId: string;
      workspaceId: string;
    }): Promise<TaskPlanRow | null> {
      const [row] = await db
        .select({ plan: taskPlans })
        .from(taskPlans)
        .innerJoin(workItems, eq(workItems.id, taskPlans.workItemId))
        .where(and(
          eq(taskPlans.workItemId, input.workItemId),
          eq(taskPlans.workspaceId, input.workspaceId),
          eq(taskPlans.status, "draft" satisfies TaskPlanStatus),
          eq(workItems.id, input.workItemId),
          eq(workItems.workspaceId, input.workspaceId),
          isNull(workItems.deletedAt)
        ))
        .orderBy(desc(taskPlans.updatedAt), desc(taskPlans.createdAt), desc(taskPlans.id))
        .limit(1);
      return row?.plan ?? null;
    },

    async getPlanWithItems(input: {
      planId: string;
      workspaceId: string;
      itemLimit?: number;
    }): Promise<TaskPlanWithItems | null> {
      const [row] = await db
        .select({ plan: taskPlans })
        .from(taskPlans)
        .innerJoin(workItems, eq(workItems.id, taskPlans.workItemId))
        .where(and(
          eq(taskPlans.id, input.planId),
          eq(taskPlans.workspaceId, input.workspaceId),
          eq(workItems.workspaceId, input.workspaceId),
          isNull(workItems.deletedAt)
        ))
        .limit(1);
      if (!row) {
        return null;
      }

      const itemLimit = boundedItemLimit(input.itemLimit);
      const rows = await db
        .select(taskPlanItemColumns)
        .from(taskPlanItems)
        .innerJoin(taskPlans, eq(taskPlans.id, taskPlanItems.planId))
        .where(and(
          eq(taskPlanItems.planId, input.planId),
          eq(taskPlans.workspaceId, input.workspaceId)
        ))
        .orderBy(asc(taskPlanItems.seq), asc(taskPlanItems.id))
        .limit(itemLimit + 1);

      return {
        plan: row.plan,
        items: rows.slice(0, itemLimit),
        itemsCapped: rows.length > itemLimit
      };
    },

    async listDashboardPlans(input: {
      workspaceId: string;
      planLimit?: number;
      itemLimit?: number;
      runLimit?: number;
      escalationLimit?: number;
    }): Promise<TaskPlanDashboardRead> {
      const planLimit = boundedLimit(input.planLimit, DEFAULT_DASHBOARD_PLAN_LIMIT, MAX_DASHBOARD_PLAN_LIMIT);
      const itemLimit = boundedLimit(input.itemLimit, DEFAULT_DASHBOARD_ITEM_LIMIT, MAX_ITEM_LIMIT);
      const runLimit = boundedLimit(input.runLimit, DEFAULT_DASHBOARD_RUN_LIMIT, MAX_DASHBOARD_RUN_LIMIT);
      const escalationLimit = boundedLimit(input.escalationLimit, DEFAULT_DASHBOARD_ESCALATION_LIMIT, MAX_DASHBOARD_ESCALATION_LIMIT);
      const planRows = await db
        .select({
          plan: taskPlans,
          workItem: {
            id: workItems.id,
            code: workItems.code,
            title: workItems.title,
            status: workItems.status
          },
          objective: {
            id: objectives.id,
            title: objectives.title,
            progressPercent: objectives.progressPercent
          }
        })
        .from(taskPlans)
        .innerJoin(workItems, eq(workItems.id, taskPlans.workItemId))
        .leftJoin(objectives, and(
          eq(objectives.id, taskPlans.objectiveId),
          eq(objectives.workspaceId, input.workspaceId)
        ))
        .where(and(
          eq(taskPlans.workspaceId, input.workspaceId),
          eq(workItems.workspaceId, input.workspaceId),
          isNull(workItems.deletedAt),
          inArray(taskPlans.status, DASHBOARD_PLAN_STATUSES)
        ))
        .orderBy(desc(taskPlans.updatedAt), desc(taskPlans.createdAt), desc(taskPlans.id))
        .limit(planLimit + 1);
      const plans = planRows.slice(0, planLimit) as TaskPlanDashboardPlanRow[];
      const planIds = plans.map((row) => row.plan.id);
      if (planIds.length === 0) {
        return {
          plans: [],
          plansCapped: planRows.length > planLimit,
          items: [],
          itemsCapped: false,
          runs: [],
          runsCapped: false,
          escalations: [],
          escalationsCapped: false
        };
      }

      const itemRows = await db
        .select(taskPlanItemColumns)
        .from(taskPlanItems)
        .innerJoin(taskPlans, eq(taskPlans.id, taskPlanItems.planId))
        .where(and(
          eq(taskPlans.workspaceId, input.workspaceId),
          inArray(taskPlanItems.planId, planIds)
        ))
        .orderBy(asc(taskPlanItems.planId), asc(taskPlanItems.seq), asc(taskPlanItems.id))
        .limit(itemLimit + 1);
      const runRows = await db
        .select({
          id: agentRuns.id,
          parentRunId: agentRuns.parentRunId,
          workItemId: agentRuns.workItemId,
          workspaceId: agentRuns.workspaceId,
          taskPlanId: agentRuns.taskPlanId,
          taskPlanItemId: agentRuns.taskPlanItemId,
          agentRole: agentRuns.agentRole,
          title: agentRuns.title,
          status: agentRuns.status,
          costEstimate: agentRuns.costEstimate,
          outcomeReason: agentRuns.outcomeReason,
          createdAt: agentRuns.createdAt,
          updatedAt: agentRuns.updatedAt,
          finishedAt: agentRuns.finishedAt
        })
        .from(agentRuns)
        .where(and(
          eq(agentRuns.workspaceId, input.workspaceId),
          inArray(agentRuns.taskPlanId, planIds)
        ))
        .orderBy(desc(agentRuns.updatedAt), desc(agentRuns.createdAt), desc(agentRuns.id))
        .limit(runLimit + 1);
      const handoffTaskPlanId = sql<string>`${escalationEvents.handoffJson}->>'task_plan_id'`;
      const escalationRows = await db
        .select({
          id: escalationEvents.id,
          workItemId: escalationEvents.workItemId,
          planId: sql<string | null>`coalesce(${agentRuns.taskPlanId}::text, ${taskPlans.id}::text)`,
          runId: agentRuns.id,
          reasonMd: escalationEvents.reasonMd,
          createdAt: escalationEvents.createdAt
        })
        .from(escalationEvents)
        .leftJoin(agentRuns, and(
          eq(escalationEvents.agentRunId, agentRuns.id),
          eq(agentRuns.workspaceId, input.workspaceId),
          eq(agentRuns.workItemId, escalationEvents.workItemId)
        ))
        .innerJoin(workItems, eq(escalationEvents.workItemId, workItems.id))
        .leftJoin(taskPlans, and(
          sql`${taskPlans.id}::text = ${handoffTaskPlanId}`,
          eq(taskPlans.workItemId, escalationEvents.workItemId),
          eq(taskPlans.workspaceId, input.workspaceId)
        ))
        .where(and(
          eq(workItems.workspaceId, input.workspaceId),
          isNull(workItems.deletedAt),
          isNull(escalationEvents.resolvedAt),
          or(
            inArray(agentRuns.taskPlanId, planIds),
            inArray(taskPlans.id, planIds)
          )
        ))
        .orderBy(desc(escalationEvents.createdAt), desc(escalationEvents.id))
        .limit(escalationLimit + 1);

      return {
        plans,
        plansCapped: planRows.length > planLimit,
        items: itemRows.slice(0, itemLimit) as TaskPlanItemRow[],
        itemsCapped: itemRows.length > itemLimit,
        runs: runRows.slice(0, runLimit) as TaskPlanRunRow[],
        runsCapped: runRows.length > runLimit,
        escalations: escalationRows.slice(0, escalationLimit) as TaskPlanDashboardEscalationRow[],
        escalationsCapped: escalationRows.length > escalationLimit
      };
    },

    async startDispatchingPlan(input: {
      planId: string;
      workspaceId: string;
      startedAt?: Date;
    }): Promise<TaskPlanRow | null> {
      const startedAt = input.startedAt ?? new Date();
      const [row] = await db
        .update(taskPlans)
        .set({
          status: "dispatching" satisfies TaskPlanStatus,
          updatedAt: startedAt
        })
        .where(and(
          eq(taskPlans.id, input.planId),
          eq(taskPlans.workspaceId, input.workspaceId),
          eq(taskPlans.status, "approved" satisfies TaskPlanStatus)
        ))
        .returning();
      return row ?? null;
    },

    async markItemDispatched(input: {
      planId: string;
      workspaceId: string;
      itemId: string;
      dispatchedAt?: Date;
    }): Promise<TaskPlanItemRow | null> {
      const dispatchedAt = input.dispatchedAt ?? new Date();
      const [row] = await db
        .update(taskPlanItems)
        .set({
          status: "dispatched" satisfies TaskPlanItemStatus,
          // B-R9.2-3：派发代际 +1——run 记住自己的代，结算/恢复只认同代，
          // 人工重派后旧终态 run 不再覆盖新一轮。
          dispatchEpoch: sql`${taskPlanItems.dispatchEpoch} + 1`,
          updatedAt: dispatchedAt
        })
        .where(and(
          eq(taskPlanItems.planId, input.planId),
          parentPlanWorkspacePredicate(input),
          eq(taskPlanItems.id, input.itemId),
          eq(taskPlanItems.status, "pending" satisfies TaskPlanItemStatus)
        ))
        .returning();
      return row ?? null;
    },

    async settleDispatchedItem(input: {
      planId: string;
      workspaceId: string;
      itemId: string;
      status: Extract<TaskPlanItemStatus, "succeeded" | "failed">;
      // B-R9.2-3：结算方（run）所属的派发代。带上时只结算同代 item——
      // 人工重派后旧终态 run 的 CAS 落空返回 null，不覆盖新一轮。
      epoch?: number;
      settledAt?: Date;
    }): Promise<TaskPlanItemRow | null> {
      const settledAt = input.settledAt ?? new Date();
      const [row] = await db
        .update(taskPlanItems)
        .set({
          status: input.status,
          updatedAt: settledAt
        })
        .where(and(
          eq(taskPlanItems.planId, input.planId),
          parentPlanWorkspacePredicate(input),
          eq(taskPlanItems.id, input.itemId),
          eq(taskPlanItems.status, "dispatched" satisfies TaskPlanItemStatus),
          ...(input.epoch === undefined ? [] : [eq(taskPlanItems.dispatchEpoch, input.epoch)])
        ))
        .returning();
      return row ?? null;
    },

    async skipPendingItems(input: {
      planId: string;
      workspaceId: string;
      itemIds: string[];
      skippedAt?: Date;
    }): Promise<TaskPlanItemRow[]> {
      if (input.itemIds.length === 0) {
        return [];
      }
      const skippedAt = input.skippedAt ?? new Date();
      return db
        .update(taskPlanItems)
        .set({
          status: "skipped" satisfies TaskPlanItemStatus,
          updatedAt: skippedAt
        })
        .where(and(
          eq(taskPlanItems.planId, input.planId),
          parentPlanWorkspacePredicate(input),
          inArray(taskPlanItems.id, input.itemIds),
          eq(taskPlanItems.status, "pending" satisfies TaskPlanItemStatus)
        ))
        .returning();
    },

    async markPlanDone(input: {
      planId: string;
      workspaceId: string;
      doneAt?: Date;
    }): Promise<TaskPlanRow | null> {
      const doneAt = input.doneAt ?? new Date();
      const [row] = await db
        .update(taskPlans)
        .set({
          status: "done" satisfies TaskPlanStatus,
          updatedAt: doneAt
        })
        .where(and(
          eq(taskPlans.id, input.planId),
          eq(taskPlans.workspaceId, input.workspaceId),
          eq(taskPlans.status, "dispatching" satisfies TaskPlanStatus)
        ))
        .returning();
      return row ?? null;
    },

    async approvePlan(input: {
      planId: string;
      workspaceId: string;
      workItemId: string;
      approvedAt?: Date;
    }): Promise<TaskPlanRow | null> {
      const approvedAt = input.approvedAt ?? new Date();
      // B-R9.1-1：合入事务内已把计划 CAS 到 approved；本方法作为 service 层兜底必须幂等
      // （draft→approved 或已 approved 均成功），否则合入成功后兜底会误报 409。
      const [row] = await db
        .update(taskPlans)
        .set({
          status: "approved" satisfies TaskPlanStatus,
          updatedAt: approvedAt
        })
        .where(and(
          eq(taskPlans.id, input.planId),
          eq(taskPlans.workspaceId, input.workspaceId),
          eq(taskPlans.workItemId, input.workItemId),
          inArray(taskPlans.status, ["draft", "approved"] satisfies TaskPlanStatus[])
        ))
        .returning();
      return row ?? null;
    },

    async cancelDraftPlan(input: {
      planId: string;
      workspaceId: string;
      cancelledAt?: Date;
    }): Promise<TaskPlanRow | null> {
      const cancelledAt = input.cancelledAt ?? new Date();
      const [row] = await db
        .update(taskPlans)
        .set({
          status: "cancelled" satisfies TaskPlanStatus,
          updatedAt: cancelledAt
        })
        .where(and(
          eq(taskPlans.id, input.planId),
          eq(taskPlans.workspaceId, input.workspaceId),
          eq(taskPlans.status, "draft" satisfies TaskPlanStatus)
        ))
        .returning();
      return row ?? null;
    }
  };
}
