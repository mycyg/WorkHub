import { randomUUID } from "node:crypto";

import { and, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";

import type {
  ConfidenceGrade,
  ConfidenceVerdict,
  EscalationTrigger,
  RiskLevel,
  WorkItemStatus
} from "@workhub/contracts";
import { allowedWorkItemTransitions } from "@workhub/contracts";

import type { WorkHubDb } from "../client.js";
import { agentRuns, confidenceRecords, escalationEvents, taskPlanItems, taskPlans, workItems } from "../schema/index.js";

export type ConfidenceRecordRow = typeof confidenceRecords.$inferSelect;
export type EscalationEventRow = typeof escalationEvents.$inferSelect;

export type CreateConfidenceRecordInput = {
  id?: string;
  workItemId: string;
  proposalId?: string;
  agentRunId?: string;
  confidenceScore: number;
  riskScore: number;
  grade: ConfidenceGrade;
  riskLevel: RiskLevel;
  verdict: ConfidenceVerdict;
  signalsJson?: Record<string, unknown>;
  rationaleMd?: string;
};

export type CreateEscalationEventInput = {
  id?: string;
  workItemId: string;
  agentRunId?: string;
  confidenceId?: string;
  trigger: EscalationTrigger;
  reasonMd: string;
  handoffJson?: Record<string, unknown>;
  suggestedLeadUserId?: string;
};

export type EscalationServiceRow = {
  id: string;
  workItemId: string;
  agentRunId: string | null;
  projectId: string;
  title: string;
  reasonMd: string;
  trigger: EscalationTrigger | string;
  handoffJson: Record<string, unknown>;
  suggestedLeadUserId: string | null;
  createdAt: Date;
  resolvedAt: Date | null;
  workItemStatus: WorkItemStatus;
  workspaceId: string | null;
};

export type ResolveEscalationInput = {
  escalationId: string;
  targetStatus: WorkItemStatus;
  workspaceId: string;
  taskPlanAction?: "retry" | "pm_mode" | "cancel";
  at: Date;
};

export type ResolveBudgetDecisionInput = {
  escalationId: string;
  workspaceId: string;
  actionId: string;
  at: Date;
};

export type DelegateEscalationInput = {
  escalationId: string;
  toUserId: string;
  workspaceId: string;
  at: Date;
};

export type AiDecisionRepository = {
  createConfidenceRecord: (input: CreateConfidenceRecordInput) => Promise<ConfidenceRecordRow>;
  listConfidenceRecordsForWorkItem: (workItemId: string) => Promise<ConfidenceRecordRow[]>;
  findConfidenceRecordForAgentRun: (agentRunId: string) => Promise<ConfidenceRecordRow | null>;
  createEscalationEvent: (input: CreateEscalationEventInput) => Promise<EscalationEventRow>;
  listEscalationEventsForWorkItem: (workItemId: string) => Promise<EscalationEventRow[]>;
  findEscalationById: (id: string) => Promise<EscalationServiceRow | null>;
  listUnresolvedEscalationsForWorkspace: (input: { workspaceId: string; limit?: number }) => Promise<EscalationServiceRow[]>;
  resolveEscalation: (input: ResolveEscalationInput) => Promise<EscalationServiceRow | null>;
  resolveBudgetDecision: (input: ResolveBudgetDecisionInput) => Promise<EscalationServiceRow | null>;
  reopenEscalation?: (input: {
    escalationId: string;
    targetStatus: WorkItemStatus;
    workspaceId: string;
    at: Date;
  }) => Promise<EscalationServiceRow | null>;
  delegateEscalation: (input: DelegateEscalationInput) => Promise<EscalationServiceRow | null>;
};

const escalationServiceColumns = {
  id: escalationEvents.id,
  workItemId: escalationEvents.workItemId,
  agentRunId: escalationEvents.agentRunId,
  projectId: workItems.projectId,
  title: workItems.title,
  reasonMd: escalationEvents.reasonMd,
  trigger: escalationEvents.trigger,
  handoffJson: escalationEvents.handoffJson,
  suggestedLeadUserId: escalationEvents.suggestedLeadUserId,
  createdAt: escalationEvents.createdAt,
  resolvedAt: escalationEvents.resolvedAt,
  workItemStatus: workItems.status,
  workspaceId: workItems.workspaceId
};

type EscalationServiceSelectRow = {
  id: string;
  workItemId: string;
  agentRunId: string | null;
  projectId: string;
  title: string | null;
  reasonMd: string;
  trigger: string;
  handoffJson: Record<string, unknown> | null;
  suggestedLeadUserId: string | null;
  createdAt: Date;
  resolvedAt: Date | null;
  workItemStatus: string;
  workspaceId: string | null;
};

function toEscalationServiceRow(row: EscalationServiceSelectRow): EscalationServiceRow {
  return {
    ...row,
    handoffJson: row.handoffJson ?? {},
    title: row.title?.trim() || "当前事项",
    workItemStatus: row.workItemStatus as WorkItemStatus
  };
}

function predecessorsForStatus(to: WorkItemStatus) {
  return (Object.entries(allowedWorkItemTransitions) as [WorkItemStatus, readonly WorkItemStatus[]][])
    .filter(([, targets]) => targets.includes(to))
    .map(([from]) => from);
}

function textField(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function textArrayField(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function taskPlanResolutionTarget(handoffJson: Record<string, unknown>) {
  const planId = textField(handoffJson["task_plan_id"]);
  if (!planId) {
    return null;
  }
  const itemIds = [
    textField(handoffJson["task_plan_item_id"]),
    ...textArrayField(handoffJson["failed_item_ids"]),
    ...textArrayField(handoffJson["skipped_item_ids"])
  ].filter((value): value is string => Boolean(value));
  const uniqueItemIds = [...new Set(itemIds)];
  if (uniqueItemIds.length === 0) {
    return null;
  }
  return {
    planId,
    itemIds: uniqueItemIds
  };
}

function scopedTaskPlanItemPredicate(input: {
  planId: string;
  workItemId: string;
  workspaceId?: string;
}) {
  return sql`exists (
    select 1
    from ${taskPlans}
    where ${eq(taskPlans.id, taskPlanItems.planId)}
      and ${eq(taskPlans.id, input.planId)}
      and ${eq(taskPlans.workItemId, input.workItemId)}
      ${input.workspaceId ? sql`and ${eq(taskPlans.workspaceId, input.workspaceId)}` : sql``}
  )`;
}

function scopedEscalationEventPredicate(input: { workspaceId: string }) {
  return sql`exists (
    select 1
    from ${workItems}
    where ${eq(workItems.id, escalationEvents.workItemId)}
      and ${eq(workItems.workspaceId, input.workspaceId)}
      and ${isNull(workItems.deletedAt)}
  )`;
}

function requireResolutionRows(rows: unknown[], expected: number) {
  if (rows.length !== expected) {
    throw new Error("task_plan_resolution_conflict");
  }
}

export function createAiDecisionRepository(db: WorkHubDb): AiDecisionRepository {
  return {
    async createConfidenceRecord(input) {
      const rows = await db
        .insert(confidenceRecords)
        .values({
          id: input.id ?? randomUUID(),
          workItemId: input.workItemId,
          ...(input.proposalId ? { proposalId: input.proposalId } : {}),
          ...(input.agentRunId ? { agentRunId: input.agentRunId } : {}),
          confidenceScore: input.confidenceScore,
          riskScore: input.riskScore,
          grade: input.grade,
          riskLevel: input.riskLevel,
          verdict: input.verdict,
          signalsJson: input.signalsJson ?? {},
          ...(input.rationaleMd ? { rationaleMd: input.rationaleMd } : {})
        })
        .returning();
      const record = rows[0];
      if (!record) {
        throw new Error("Failed to create confidence record");
      }
      return record;
    },

    async listConfidenceRecordsForWorkItem(workItemId) {
      return db
        .select()
        .from(confidenceRecords)
        .where(eq(confidenceRecords.workItemId, workItemId))
        .orderBy(desc(confidenceRecords.createdAt));
    },

    async findConfidenceRecordForAgentRun(agentRunId) {
      const rows = await db
        .select()
        .from(confidenceRecords)
        .where(eq(confidenceRecords.agentRunId, agentRunId))
        .orderBy(desc(confidenceRecords.createdAt))
        .limit(1);
      return rows[0] ?? null;
    },

    async createEscalationEvent(input) {
      const rows = await db
        .insert(escalationEvents)
        .values({
          id: input.id ?? randomUUID(),
          workItemId: input.workItemId,
          ...(input.agentRunId ? { agentRunId: input.agentRunId } : {}),
          ...(input.confidenceId ? { confidenceId: input.confidenceId } : {}),
          trigger: input.trigger,
          reasonMd: input.reasonMd,
          handoffJson: input.handoffJson ?? {},
          ...(input.suggestedLeadUserId ? { suggestedLeadUserId: input.suggestedLeadUserId } : {})
        })
        .returning();
      const event = rows[0];
      if (!event) {
        throw new Error("Failed to create escalation event");
      }
      return event;
    },

    async listEscalationEventsForWorkItem(workItemId) {
      return db
        .select()
        .from(escalationEvents)
        .where(eq(escalationEvents.workItemId, workItemId))
        .orderBy(desc(escalationEvents.createdAt));
    },

    async findEscalationById(id) {
      const rows = await db
        .select(escalationServiceColumns)
        .from(escalationEvents)
        .innerJoin(workItems, eq(escalationEvents.workItemId, workItems.id))
        .where(and(eq(escalationEvents.id, id), isNull(workItems.deletedAt)))
        .limit(1);
      const row = rows[0];
      return row ? toEscalationServiceRow(row) : null;
    },

    async listUnresolvedEscalationsForWorkspace(input) {
      const rows = await db
        .select(escalationServiceColumns)
        .from(escalationEvents)
        .innerJoin(workItems, eq(escalationEvents.workItemId, workItems.id))
        .where(and(
          isNull(escalationEvents.resolvedAt),
          isNull(workItems.deletedAt),
          eq(workItems.workspaceId, input.workspaceId)
        ))
        .orderBy(desc(escalationEvents.createdAt), desc(escalationEvents.id))
        .limit(input.limit ?? 50);
      return rows.map((row) => toEscalationServiceRow(row));
    },

    async resolveEscalation(input) {
      const predecessors = predecessorsForStatus(input.targetStatus);
      if (predecessors.length === 0) {
        throw new Error("escalation_status_transition_conflict");
      }
      return db.transaction(async (tx) => {
        const updatedEscalations = await tx
          .update(escalationEvents)
          .set({ resolvedAt: input.at })
          .where(and(
            eq(escalationEvents.id, input.escalationId),
            isNull(escalationEvents.resolvedAt),
            scopedEscalationEventPredicate(input)
          ))
          .returning({
            id: escalationEvents.id,
            workItemId: escalationEvents.workItemId,
            agentRunId: escalationEvents.agentRunId,
            handoffJson: escalationEvents.handoffJson
          });
        const updatedEscalation = updatedEscalations[0];
        if (!updatedEscalation) {
          return null;
        }
        const taskTarget = input.taskPlanAction
          ? taskPlanResolutionTarget((updatedEscalation.handoffJson ?? {}) as Record<string, unknown>)
          : null;
        if (taskTarget) {
          if (input.taskPlanAction === "retry") {
            const resetItems = await tx
              .update(taskPlanItems)
              .set({
                status: "pending",
                updatedAt: input.at
              })
              .where(and(
                eq(taskPlanItems.planId, taskTarget.planId),
                scopedTaskPlanItemPredicate({
                  planId: taskTarget.planId,
                  workItemId: updatedEscalation.workItemId,
                  workspaceId: input.workspaceId
                }),
                inArray(taskPlanItems.id, taskTarget.itemIds),
                inArray(taskPlanItems.status, ["failed", "skipped"])
              ))
              .returning({ id: taskPlanItems.id });
            requireResolutionRows(resetItems, taskTarget.itemIds.length);
            const resumedPlans = await tx
              .update(taskPlans)
              .set({
                status: "dispatching",
                updatedAt: input.at
              })
              .where(and(
                eq(taskPlans.id, taskTarget.planId),
                eq(taskPlans.workItemId, updatedEscalation.workItemId),
                eq(taskPlans.workspaceId, input.workspaceId),
                inArray(taskPlans.status, ["dispatching", "done"])
              ))
              .returning({ id: taskPlans.id });
            requireResolutionRows(resumedPlans, 1);
          } else {
            if (updatedEscalation.agentRunId) {
              await tx
                .update(agentRuns)
                .set({
                  status: "cancelled",
                  finishedAt: input.at,
                  updatedAt: input.at
                })
                .where(and(
                  eq(agentRuns.id, updatedEscalation.agentRunId),
                  eq(agentRuns.workItemId, updatedEscalation.workItemId),
                  eq(agentRuns.workspaceId, input.workspaceId),
                  eq(agentRuns.taskPlanId, taskTarget.planId),
                  inArray(agentRuns.taskPlanItemId, taskTarget.itemIds),
                  inArray(agentRuns.status, ["queued", "running"])
                ))
                .returning();
            }
            const skippedItems = await tx
              .update(taskPlanItems)
              .set({
                status: "skipped",
                updatedAt: input.at
              })
              .where(and(
                eq(taskPlanItems.planId, taskTarget.planId),
                scopedTaskPlanItemPredicate({
                  planId: taskTarget.planId,
                  workItemId: updatedEscalation.workItemId,
                  workspaceId: input.workspaceId
                }),
                inArray(taskPlanItems.id, taskTarget.itemIds),
                inArray(taskPlanItems.status, ["pending", "dispatched", "failed", "skipped"])
              ))
              .returning({ id: taskPlanItems.id });
            requireResolutionRows(skippedItems, taskTarget.itemIds.length);
          }
        }
        if (!taskTarget) {
          const updatedWorkItems = await tx
            .update(workItems)
            .set({
              status: input.targetStatus,
              version: sql`${workItems.version} + 1`,
              updatedAt: input.at
            })
            .where(and(
              eq(workItems.id, updatedEscalation.workItemId),
              eq(workItems.workspaceId, input.workspaceId),
              inArray(workItems.status, predecessors),
              isNull(workItems.deletedAt)
            ))
            .returning({ id: workItems.id });
          if (!updatedWorkItems[0]) {
            throw new Error("escalation_status_transition_conflict");
          }
        }
        const rows = await tx
          .select(escalationServiceColumns)
          .from(escalationEvents)
          .innerJoin(workItems, eq(escalationEvents.workItemId, workItems.id))
          .where(and(
            eq(escalationEvents.id, updatedEscalation.id),
            isNull(workItems.deletedAt),
            eq(workItems.workspaceId, input.workspaceId)
          ))
          .limit(1);
        const row = rows[0];
        return row ? toEscalationServiceRow(row) : null;
      });
    },

    async resolveBudgetDecision(input) {
      const rows = await db
        .update(escalationEvents)
        .set({
          resolvedAt: input.at,
          handoffJson: sql`${escalationEvents.handoffJson} || ${JSON.stringify({
            budget_resolution: {
              action_id: input.actionId,
              resolved_at: input.at.toISOString()
            }
          })}::jsonb`
        })
        .where(and(
          eq(escalationEvents.id, input.escalationId),
          isNull(escalationEvents.resolvedAt),
          scopedEscalationEventPredicate(input)
        ))
        .returning({ id: escalationEvents.id });
      const updated = rows[0];
      return updated ? this.findEscalationById(updated.id) : null;
    },

    async reopenEscalation(input) {
      const predecessors = predecessorsForStatus(input.targetStatus);
      if (predecessors.length === 0) {
        throw new Error("escalation_status_transition_conflict");
      }
      return db.transaction(async (tx) => {
        const reopenedEscalations = await tx
          .update(escalationEvents)
          .set({ resolvedAt: null })
          .where(and(
            eq(escalationEvents.id, input.escalationId),
            isNotNull(escalationEvents.resolvedAt),
            scopedEscalationEventPredicate(input)
          ))
          .returning({ id: escalationEvents.id, workItemId: escalationEvents.workItemId });
        const reopenedEscalation = reopenedEscalations[0];
        if (!reopenedEscalation) {
          return null;
        }
        const updatedWorkItems = await tx
          .update(workItems)
          .set({
            status: input.targetStatus,
            version: sql`${workItems.version} + 1`,
            updatedAt: input.at
          })
          .where(and(
            eq(workItems.id, reopenedEscalation.workItemId),
            eq(workItems.workspaceId, input.workspaceId),
            inArray(workItems.status, predecessors),
            isNull(workItems.deletedAt)
          ))
          .returning({ id: workItems.id });
        if (!updatedWorkItems[0]) {
          throw new Error("escalation_status_transition_conflict");
        }
        const rows = await tx
          .select(escalationServiceColumns)
          .from(escalationEvents)
          .innerJoin(workItems, eq(escalationEvents.workItemId, workItems.id))
          .where(and(
            eq(escalationEvents.id, reopenedEscalation.id),
            isNull(workItems.deletedAt),
            eq(workItems.workspaceId, input.workspaceId)
          ))
          .limit(1);
        const row = rows[0];
        return row ? toEscalationServiceRow(row) : null;
      });
    },

    async delegateEscalation(input) {
      const rows = await db
        .update(escalationEvents)
        .set({ suggestedLeadUserId: input.toUserId })
        .where(and(
          eq(escalationEvents.id, input.escalationId),
          isNull(escalationEvents.resolvedAt),
          scopedEscalationEventPredicate(input)
        ))
        .returning({ id: escalationEvents.id });
      const updated = rows[0];
      if (!updated) {
        return null;
      }
      return this.findEscalationById(updated.id);
    }
  };
}
