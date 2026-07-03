import { randomUUID } from "node:crypto";

import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";

import type {
  ConfidenceGrade,
  ConfidenceVerdict,
  EscalationTrigger,
  RiskLevel,
  WorkItemStatus
} from "@workhub/contracts";
import { allowedWorkItemTransitions } from "@workhub/contracts";

import type { WorkHubDb } from "../client.js";
import { confidenceRecords, escalationEvents, workItems } from "../schema/index.js";

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
  projectId: string;
  title: string;
  reasonMd: string;
  trigger: EscalationTrigger | string;
  suggestedLeadUserId: string | null;
  createdAt: Date;
  resolvedAt: Date | null;
  workItemStatus: WorkItemStatus;
  workspaceId: string | null;
};

export type ResolveEscalationInput = {
  escalationId: string;
  targetStatus: WorkItemStatus;
  at: Date;
};

export type DelegateEscalationInput = {
  escalationId: string;
  toUserId: string;
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
  delegateEscalation: (input: DelegateEscalationInput) => Promise<EscalationServiceRow | null>;
};

const escalationServiceColumns = {
  id: escalationEvents.id,
  workItemId: escalationEvents.workItemId,
  projectId: workItems.projectId,
  title: workItems.title,
  reasonMd: escalationEvents.reasonMd,
  trigger: escalationEvents.trigger,
  suggestedLeadUserId: escalationEvents.suggestedLeadUserId,
  createdAt: escalationEvents.createdAt,
  resolvedAt: escalationEvents.resolvedAt,
  workItemStatus: workItems.status,
  workspaceId: workItems.workspaceId
};

type EscalationServiceSelectRow = {
  id: string;
  workItemId: string;
  projectId: string;
  title: string | null;
  reasonMd: string;
  trigger: string;
  suggestedLeadUserId: string | null;
  createdAt: Date;
  resolvedAt: Date | null;
  workItemStatus: string;
  workspaceId: string | null;
};

function toEscalationServiceRow(row: EscalationServiceSelectRow): EscalationServiceRow {
  return {
    ...row,
    title: row.title?.trim() || "当前事项",
    workItemStatus: row.workItemStatus as WorkItemStatus
  };
}

function predecessorsForStatus(to: WorkItemStatus) {
  return (Object.entries(allowedWorkItemTransitions) as [WorkItemStatus, readonly WorkItemStatus[]][])
    .filter(([, targets]) => targets.includes(to))
    .map(([from]) => from);
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
          .where(and(eq(escalationEvents.id, input.escalationId), isNull(escalationEvents.resolvedAt)))
          .returning({ id: escalationEvents.id, workItemId: escalationEvents.workItemId });
        const updatedEscalation = updatedEscalations[0];
        if (!updatedEscalation) {
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
            eq(workItems.id, updatedEscalation.workItemId),
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
          .where(eq(escalationEvents.id, updatedEscalation.id))
          .limit(1);
        const row = rows[0];
        return row ? toEscalationServiceRow(row) : null;
      });
    },

    async delegateEscalation(input) {
      const rows = await db
        .update(escalationEvents)
        .set({ suggestedLeadUserId: input.toUserId })
        .where(and(eq(escalationEvents.id, input.escalationId), isNull(escalationEvents.resolvedAt)))
        .returning({ id: escalationEvents.id });
      const updated = rows[0];
      if (!updated) {
        return null;
      }
      return this.findEscalationById(updated.id);
    }
  };
}
