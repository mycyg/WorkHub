import { and, asc, eq, inArray, isNull } from "drizzle-orm";

import type {
  RiskLevel,
  TaskPlanItemStatus,
  TaskPlanItemRole,
  TaskPlanStatus
} from "@workhub/contracts";

import type { WorkHubDb } from "../client.js";
import type { AgentRunRow } from "./agent-runs.js";
import {
  objectives,
  objectiveWorkItemLinks,
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
  riskLevel?: RiskLevel;
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

export type TaskPlanWithItems = {
  plan: TaskPlanRow;
  items: TaskPlanItemRow[];
  itemsCapped: boolean;
  runs?: TaskPlanRunRow[];
  runsCapped?: boolean;
};

const DEFAULT_ITEM_LIMIT = 50;
const MAX_ITEM_LIMIT = 100;

function boundedItemLimit(input: number | undefined) {
  if (!Number.isFinite(input)) {
    return DEFAULT_ITEM_LIMIT;
  }
  return Math.min(Math.max(Math.floor(input ?? DEFAULT_ITEM_LIMIT), 0), MAX_ITEM_LIMIT);
}

export function createTaskPlanRepository(db: WorkHubDb) {
  return {
    async createDraftPlan(input: CreateDraftTaskPlanInput): Promise<void> {
      const now = input.now ?? new Date();
      await db.transaction(async (tx) => {
        const [workItem] = await tx
          .select({ id: workItems.id })
          .from(workItems)
          .where(and(
            eq(workItems.id, input.workItemId),
            eq(workItems.workspaceId, input.workspaceId),
            isNull(workItems.deletedAt)
          ))
          .limit(1);
        if (!workItem) {
          throw new Error("task_plan_work_item_not_found");
        }

        if (input.objectiveId) {
          const [objective] = await tx
            .select({ id: objectives.id })
            .from(objectives)
            .where(and(
              eq(objectives.id, input.objectiveId),
              eq(objectives.workspaceId, input.workspaceId)
            ))
            .limit(1);
          if (!objective) {
            throw new Error("task_plan_objective_not_found");
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
        if (input.objectiveId) {
          await tx.insert(objectiveWorkItemLinks).values({
            objectiveId: input.objectiveId,
            workItemId: input.workItemId,
            workspaceId: input.workspaceId,
            createdByUserId: input.createdByUserId,
            createdAt: now,
            updatedAt: now
          }).onConflictDoNothing({
            target: [objectiveWorkItemLinks.objectiveId, objectiveWorkItemLinks.workItemId]
          });
        }
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
          riskLevel: item.riskLevel ?? "medium",
          dependsOn: item.dependsOn ?? [],
          status: "pending" as const,
          createdAt: now,
          updatedAt: now
        })));
      });
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
        .select()
        .from(taskPlanItems)
        .where(eq(taskPlanItems.planId, input.planId))
        .orderBy(asc(taskPlanItems.seq), asc(taskPlanItems.id))
        .limit(itemLimit + 1);

      return {
        plan: row.plan,
        items: rows.slice(0, itemLimit),
        itemsCapped: rows.length > itemLimit
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
      itemId: string;
      dispatchedAt?: Date;
    }): Promise<TaskPlanItemRow | null> {
      const dispatchedAt = input.dispatchedAt ?? new Date();
      const [row] = await db
        .update(taskPlanItems)
        .set({
          status: "dispatched" satisfies TaskPlanItemStatus,
          activeRunId: null,
          updatedAt: dispatchedAt
        })
        .where(and(
          eq(taskPlanItems.planId, input.planId),
          eq(taskPlanItems.id, input.itemId),
          eq(taskPlanItems.status, "pending" satisfies TaskPlanItemStatus)
        ))
        .returning();
      return row ?? null;
    },

    async markItemActiveRun(input: {
      planId: string;
      itemId: string;
      runId: string;
      activatedAt?: Date;
    }): Promise<TaskPlanItemRow | null> {
      const activatedAt = input.activatedAt ?? new Date();
      const [row] = await db
        .update(taskPlanItems)
        .set({
          activeRunId: input.runId,
          updatedAt: activatedAt
        })
        .where(and(
          eq(taskPlanItems.planId, input.planId),
          eq(taskPlanItems.id, input.itemId),
          eq(taskPlanItems.status, "dispatched" satisfies TaskPlanItemStatus),
          isNull(taskPlanItems.activeRunId)
        ))
        .returning();
      return row ?? null;
    },

    async settleDispatchedItem(input: {
      planId: string;
      itemId: string;
      runId: string;
      status: Extract<TaskPlanItemStatus, "succeeded" | "failed">;
      settledAt?: Date;
    }): Promise<TaskPlanItemRow | null> {
      const settledAt = input.settledAt ?? new Date();
      const [row] = await db
        .update(taskPlanItems)
        .set({
          status: input.status,
          activeRunId: null,
          updatedAt: settledAt
        })
        .where(and(
          eq(taskPlanItems.planId, input.planId),
          eq(taskPlanItems.id, input.itemId),
          eq(taskPlanItems.status, "dispatched" satisfies TaskPlanItemStatus),
          eq(taskPlanItems.activeRunId, input.runId)
        ))
        .returning();
      return row ?? null;
    },

    async skipPendingItems(input: {
      planId: string;
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
      approvedAt?: Date;
    }): Promise<TaskPlanRow | null> {
      const approvedAt = input.approvedAt ?? new Date();
      const [row] = await db
        .update(taskPlans)
        .set({
          status: "approved" satisfies TaskPlanStatus,
          updatedAt: approvedAt
        })
        .where(and(
          eq(taskPlans.id, input.planId),
          eq(taskPlans.workspaceId, input.workspaceId),
          eq(taskPlans.status, "draft" satisfies TaskPlanStatus)
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
