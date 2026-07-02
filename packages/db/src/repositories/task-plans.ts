import { and, asc, eq, inArray, isNull } from "drizzle-orm";

import type {
  TaskPlanItemStatus,
  TaskPlanItemRole,
  TaskPlanStatus
} from "@workhub/contracts";

import type { WorkHubDb } from "../client.js";
import {
  taskPlanItems,
  taskPlans,
  workItems
} from "../schema/index.js";

type JsonObject = Record<string, unknown>;

export type TaskPlanRow = typeof taskPlans.$inferSelect;
export type TaskPlanItemRow = typeof taskPlanItems.$inferSelect;

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

export type TaskPlanWithItems = {
  plan: TaskPlanRow;
  items: TaskPlanItemRow[];
  itemsCapped: boolean;
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

    async settleDispatchedItem(input: {
      planId: string;
      itemId: string;
      status: Extract<TaskPlanItemStatus, "succeeded" | "failed">;
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
          eq(taskPlanItems.id, input.itemId),
          eq(taskPlanItems.status, "dispatched" satisfies TaskPlanItemStatus)
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
