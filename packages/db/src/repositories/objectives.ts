import { randomUUID } from "node:crypto";

import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";

import type { WorkItemStatus } from "@workhub/contracts";

import type { WorkHubDb } from "../client.js";
import {
  keyResults,
  objectiveWorkItemLinks,
  objectives,
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
};

const DEFAULT_OBJECTIVE_LIMIT = 5;
const MAX_OBJECTIVE_LIMIT = 20;
const DEFAULT_KEY_RESULT_LIMIT = 8;
const MAX_KEY_RESULT_LIMIT = 40;
const DEFAULT_WORK_ITEM_LIMIT = 100;
const MAX_WORK_ITEM_LIMIT = 300;

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
    }
  };
}
