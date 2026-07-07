import { randomUUID } from "node:crypto";

import { and, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";

import type {
  ConfidenceGrade,
  ConfidenceVerdict,
  EscalationTrigger,
  RiskLevel,
  TaskPlanItemStatus,
  TaskPlanStatus,
  WorkItemStatus
} from "@workhub/contracts";
import { allowedWorkItemTransitions } from "@workhub/contracts";

import type { WorkHubDb } from "../client.js";
import { agentRuns, confidenceRecords, escalationEvents, taskPlanItems, taskPlans, workItems } from "../schema/index.js";

const DEFAULT_UNRESOLVED_ESCALATION_LIMIT = 50;
const MAX_UNRESOLVED_ESCALATION_SCAN_LIMIT = 101;

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
  targetStatus: WorkItemStatus;
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
  findEscalationById: (input: { id: string; workspaceId: string }) => Promise<EscalationServiceRow | null>;
  listUnresolvedEscalationsForWorkspace: (input: { workspaceId: string; limit?: number }) => Promise<EscalationServiceRow[]>;
  // B-R9.2-4：同 plan 同 reason 的未解决升级卡查重（并发结算/重复触发不许双开卡）。
  findUnresolvedTaskPlanEscalation: (input: { workItemId: string; planId: string; reason: string }) => Promise<EscalationServiceRow | null>;
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

function boundedUnresolvedEscalationLimit(input: number | undefined) {
  if (!Number.isFinite(input)) {
    return DEFAULT_UNRESOLVED_ESCALATION_LIMIT;
  }
  return Math.max(1, Math.min(Math.floor(input ?? DEFAULT_UNRESOLVED_ESCALATION_LIMIT), MAX_UNRESOLVED_ESCALATION_SCAN_LIMIT));
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
  return {
    planId,
    itemIds: uniqueItemIds
  };
}

function budgetTaskPlanId(handoffJson: Record<string, unknown>) {
  return textField(handoffJson["task_plan_id"]);
}

function budgetTaskPlanTerminalStatus(actionId: string): Extract<TaskPlanStatus, "done" | "cancelled"> | null {
  if (actionId === "finish_current_output") {
    return "done";
  }
  if (actionId === "close_scope") {
    return "cancelled";
  }
  return null;
}

function isRollbackPlanStatus(value: unknown): value is Extract<TaskPlanStatus, "dispatching" | "done"> {
  return value === "dispatching" || value === "done";
}

function isRollbackItemStatus(value: unknown): value is Extract<TaskPlanItemStatus, "failed" | "skipped"> {
  return value === "failed" || value === "skipped";
}

function retryRollbackFromHandoff(handoffJson: Record<string, unknown>) {
  const raw = handoffJson["retry_rollback"];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  if (!isRollbackPlanStatus(record["plan_status"])) {
    return null;
  }
  const itemStatusRaw = record["item_statuses"];
  if (!itemStatusRaw || typeof itemStatusRaw !== "object" || Array.isArray(itemStatusRaw)) {
    return null;
  }
  const itemStatuses = Object.fromEntries(
    Object.entries(itemStatusRaw as Record<string, unknown>)
      .filter((entry): entry is [string, Extract<TaskPlanItemStatus, "failed" | "skipped">] =>
        typeof entry[0] === "string" && entry[0].trim().length > 0 && isRollbackItemStatus(entry[1])
      )
  );
  return {
    planStatus: record["plan_status"],
    itemStatuses
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

    async findEscalationById(input) {
      const rows = await db
        .select(escalationServiceColumns)
        .from(escalationEvents)
        .innerJoin(workItems, eq(escalationEvents.workItemId, workItems.id))
        .where(and(
          eq(escalationEvents.id, input.id),
          eq(workItems.workspaceId, input.workspaceId),
          isNull(workItems.deletedAt)
        ))
        .limit(1);
      const row = rows[0];
      return row ? toEscalationServiceRow(row) : null;
    },

    // B-R9.2-4（结算幂等门）：同 plan 同 reason 的未解决升级卡只允许一张——
    // 并发结算/重复 merge 触发的重复开卡在 sink 创建前用它查重。
    async findUnresolvedTaskPlanEscalation(input) {
      const rows = await db
        .select(escalationServiceColumns)
        .from(escalationEvents)
        .innerJoin(workItems, eq(escalationEvents.workItemId, workItems.id))
        .where(and(
          eq(escalationEvents.workItemId, input.workItemId),
          isNull(escalationEvents.resolvedAt),
          isNull(workItems.deletedAt),
          sql`${escalationEvents.handoffJson} ->> 'task_plan_id' = ${input.planId}`,
          sql`${escalationEvents.handoffJson} ->> 'reason' = ${input.reason}`
        ))
        .limit(1);
      const row = rows[0];
      return row ? toEscalationServiceRow(row) : null;
    },

    async listUnresolvedEscalationsForWorkspace(input) {
      const limit = boundedUnresolvedEscalationLimit(input.limit);
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
        .limit(limit);
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
            if (taskTarget.itemIds.length > 0) {
              const snapshotRows = await tx
                .select({
                  planStatus: taskPlans.status,
                  itemId: taskPlanItems.id,
                  itemStatus: taskPlanItems.status
                })
                .from(taskPlanItems)
                .innerJoin(taskPlans, eq(taskPlans.id, taskPlanItems.planId))
                .where(and(
                  eq(taskPlanItems.planId, taskTarget.planId),
                  eq(taskPlans.id, taskTarget.planId),
                  eq(taskPlans.workItemId, updatedEscalation.workItemId),
                  eq(taskPlans.workspaceId, input.workspaceId),
                  inArray(taskPlanItems.id, taskTarget.itemIds),
                  inArray(taskPlanItems.status, ["failed", "skipped"])
                ));
              requireResolutionRows(snapshotRows, taskTarget.itemIds.length);
              const planStatus = snapshotRows[0]?.planStatus;
              if (!isRollbackPlanStatus(planStatus)) {
                throw new Error("task_plan_resolution_conflict");
              }
              const snapshotItems = Object.fromEntries(snapshotRows.map((row) => [row.itemId, row.itemStatus]));
              const snapshotWrites = await tx
                .update(escalationEvents)
                .set({
                  handoffJson: sql`${escalationEvents.handoffJson} || ${JSON.stringify({
                    retry_rollback: {
                      plan_status: planStatus,
                      item_statuses: snapshotItems,
                      captured_at: input.at.toISOString()
                    }
                  })}::jsonb`
                })
                .where(and(
                  eq(escalationEvents.id, updatedEscalation.id),
                  scopedEscalationEventPredicate(input)
                ))
                .returning({ id: escalationEvents.id });
              requireResolutionRows(snapshotWrites, 1);
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
            }
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
                inArray(taskPlans.status, ["approved", "dispatching", "done"])
              ))
              .returning({ id: taskPlans.id });
            requireResolutionRows(resumedPlans, 1);
          } else {
            if (updatedEscalation.agentRunId) {
              const agentRunPredicates = [
                eq(agentRuns.id, updatedEscalation.agentRunId),
                eq(agentRuns.workItemId, updatedEscalation.workItemId),
                eq(agentRuns.workspaceId, input.workspaceId),
                eq(agentRuns.taskPlanId, taskTarget.planId),
                inArray(agentRuns.status, ["queued", "running"])
              ];
              if (taskTarget.itemIds.length > 0) {
                agentRunPredicates.push(inArray(agentRuns.taskPlanItemId, taskTarget.itemIds));
              }
              await tx
                .update(agentRuns)
                .set({
                  status: "cancelled",
                  finishedAt: input.at,
                  updatedAt: input.at
                })
                .where(and(...agentRunPredicates))
                .returning();
            }
            if (taskTarget.itemIds.length > 0) {
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
            // B-R9.0-4（branch-review 状态语义）：pm_mode 与 cancel 原先在 DB 层完全一样，
            // 「转成我来做」永不生效。现在分化：
            // - pm_mode = 人接管整个工单：军团计划停止派发（容忍计划已到终态）+ 工单真迁移到 pm_mode。
            // - cancel  = 切片级只跳过目标子任务（计划继续，工单不动）；计划级取消计划 + 工单迁移到 cancelled。
            if (input.taskPlanAction === "pm_mode") {
              await tx
                .update(taskPlans)
                .set({
                  status: "cancelled",
                  updatedAt: input.at
                })
                .where(and(
                  eq(taskPlans.id, taskTarget.planId),
                  eq(taskPlans.workItemId, updatedEscalation.workItemId),
                  eq(taskPlans.workspaceId, input.workspaceId),
                  inArray(taskPlans.status, ["approved", "dispatching"])
                ))
                .returning({ id: taskPlans.id });
              const takenOver = await tx
                .update(workItems)
                .set({
                  status: "pm_mode",
                  version: sql`${workItems.version} + 1`,
                  updatedAt: input.at
                })
                .where(and(
                  eq(workItems.id, updatedEscalation.workItemId),
                  eq(workItems.workspaceId, input.workspaceId),
                  inArray(workItems.status, predecessorsForStatus("pm_mode")),
                  isNull(workItems.deletedAt)
                ))
                .returning({ id: workItems.id });
              if (!takenOver[0]) {
                throw new Error("escalation_status_transition_conflict");
              }
            } else if (taskTarget.itemIds.length === 0) {
              const cancelledPlans = await tx
                .update(taskPlans)
                .set({
                  status: "cancelled",
                  updatedAt: input.at
                })
                .where(and(
                  eq(taskPlans.id, taskTarget.planId),
                  eq(taskPlans.workItemId, updatedEscalation.workItemId),
                  eq(taskPlans.workspaceId, input.workspaceId),
                  inArray(taskPlans.status, ["approved", "dispatching", "done"])
                ))
                .returning({ id: taskPlans.id });
              requireResolutionRows(cancelledPlans, 1);
              const cancelledWorkItems = await tx
                .update(workItems)
                .set({
                  status: "cancelled",
                  version: sql`${workItems.version} + 1`,
                  updatedAt: input.at
                })
                .where(and(
                  eq(workItems.id, updatedEscalation.workItemId),
                  eq(workItems.workspaceId, input.workspaceId),
                  inArray(workItems.status, predecessorsForStatus("cancelled")),
                  isNull(workItems.deletedAt)
                ))
                .returning({ id: workItems.id });
              if (!cancelledWorkItems[0]) {
                throw new Error("escalation_status_transition_conflict");
              }
            }
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
      const predecessors = predecessorsForStatus(input.targetStatus);
      if (predecessors.length === 0) {
        throw new Error("escalation_status_transition_conflict");
      }
      return db.transaction(async (tx) => {
        const updatedEscalations = await tx
          .update(escalationEvents)
          .set({
            resolvedAt: input.at,
            handoffJson: sql`${escalationEvents.handoffJson} || ${JSON.stringify({
              budget_resolution: {
                action_id: input.actionId,
                target_status: input.targetStatus,
                resolved_at: input.at.toISOString()
              }
            })}::jsonb`
          })
          .where(and(
            eq(escalationEvents.id, input.escalationId),
            isNull(escalationEvents.resolvedAt),
            scopedEscalationEventPredicate(input)
          ))
          .returning({
            id: escalationEvents.id,
            workItemId: escalationEvents.workItemId,
            handoffJson: escalationEvents.handoffJson
          });
        const updatedEscalation = updatedEscalations[0];
        if (!updatedEscalation) {
          return null;
        }

        const planId = budgetTaskPlanId((updatedEscalation.handoffJson ?? {}) as Record<string, unknown>);
        // B-R9.5-3（branch-review 未接线）：「追加预算继续」要真加预算——同事务把计划
        // 预算上调 max(50%, ¥1)，军团派发由 service 层随后恢复；工单状态保持不变
        // （军团仍在 ai_working，不走下方 finish/close 的状态迁移）。
        if (planId && input.actionId === "add_budget") {
          const bumped = await tx
            .update(taskPlans)
            .set({
              budgetJson: sql`coalesce(${taskPlans.budgetJson}, '{}'::jsonb) || jsonb_build_object(
                'max_cost_cny',
                greatest(
                  coalesce((${taskPlans.budgetJson} ->> 'max_cost_cny')::numeric, 0) * 1.5,
                  coalesce((${taskPlans.budgetJson} ->> 'max_cost_cny')::numeric, 0) + 1
                )::text
              )`,
              updatedAt: input.at
            })
            .where(and(
              eq(taskPlans.id, planId),
              eq(taskPlans.workItemId, updatedEscalation.workItemId),
              eq(taskPlans.workspaceId, input.workspaceId)
            ))
            .returning({ id: taskPlans.id });
          requireResolutionRows(bumped, 1);
        }
        const terminalPlanStatus = planId ? budgetTaskPlanTerminalStatus(input.actionId) : null;
        if (planId && terminalPlanStatus) {
          await tx
            .update(agentRuns)
            .set({
              status: "cancelled",
              finishedAt: input.at,
              updatedAt: input.at
            })
            .where(and(
              eq(agentRuns.workItemId, updatedEscalation.workItemId),
              eq(agentRuns.workspaceId, input.workspaceId),
              eq(agentRuns.taskPlanId, planId),
              inArray(agentRuns.status, ["queued", "running"])
            ))
            .returning({ id: agentRuns.id });
          await tx
            .update(taskPlanItems)
            .set({
              status: "skipped",
              updatedAt: input.at
            })
            .where(and(
              eq(taskPlanItems.planId, planId),
              scopedTaskPlanItemPredicate({
                planId,
                workItemId: updatedEscalation.workItemId,
                workspaceId: input.workspaceId
              }),
              inArray(taskPlanItems.status, ["pending", "dispatched", "failed", "skipped"])
            ))
            .returning({ id: taskPlanItems.id });
          const planPredecessors: TaskPlanStatus[] = terminalPlanStatus === "done"
            ? ["approved", "dispatching", "done"]
            : ["draft", "proposed", "approved", "dispatching", "done"];
          const updatedPlans = await tx
            .update(taskPlans)
            .set({
              status: terminalPlanStatus,
              updatedAt: input.at
            })
            .where(and(
              eq(taskPlans.id, planId),
              eq(taskPlans.workItemId, updatedEscalation.workItemId),
              eq(taskPlans.workspaceId, input.workspaceId),
              inArray(taskPlans.status, planPredecessors)
            ))
            .returning({ id: taskPlans.id });
          requireResolutionRows(updatedPlans, 1);
        }

        const updatedWorkItems = input.actionId === "add_budget"
          ? [{ id: updatedEscalation.workItemId }]
          : await tx
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
          .returning({
            id: escalationEvents.id,
            workItemId: escalationEvents.workItemId,
            handoffJson: escalationEvents.handoffJson
          });
        const reopenedEscalation = reopenedEscalations[0];
        if (!reopenedEscalation) {
          return null;
        }
        const taskTarget = taskPlanResolutionTarget((reopenedEscalation.handoffJson ?? {}) as Record<string, unknown>);
        if (!taskTarget) {
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
        } else {
          const rollback = retryRollbackFromHandoff((reopenedEscalation.handoffJson ?? {}) as Record<string, unknown>);
          if (rollback) {
            for (const status of ["failed", "skipped"] satisfies Array<Extract<TaskPlanItemStatus, "failed" | "skipped">>) {
              const itemIds = taskTarget.itemIds.filter((id) => rollback.itemStatuses[id] === status);
              if (itemIds.length === 0) {
                continue;
              }
              const restoredItems = await tx
                .update(taskPlanItems)
                .set({
                  status,
                  updatedAt: input.at
                })
                .where(and(
                  eq(taskPlanItems.planId, taskTarget.planId),
                  scopedTaskPlanItemPredicate({
                    planId: taskTarget.planId,
                    workItemId: reopenedEscalation.workItemId,
                    workspaceId: input.workspaceId
                  }),
                  inArray(taskPlanItems.id, itemIds),
                  inArray(taskPlanItems.status, ["pending", "failed", "skipped"])
                ))
                .returning({ id: taskPlanItems.id });
              requireResolutionRows(restoredItems, itemIds.length);
            }
            const restoredPlans = await tx
              .update(taskPlans)
              .set({
                status: rollback.planStatus,
                updatedAt: input.at
              })
              .where(and(
                eq(taskPlans.id, taskTarget.planId),
                eq(taskPlans.workItemId, reopenedEscalation.workItemId),
                eq(taskPlans.workspaceId, input.workspaceId),
                inArray(taskPlans.status, ["dispatching", "done"])
              ))
              .returning({ id: taskPlans.id });
            requireResolutionRows(restoredPlans, 1);
          }
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
      return this.findEscalationById({ id: updated.id, workspaceId: input.workspaceId });
    }
  };
}
