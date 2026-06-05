import { randomUUID } from "node:crypto";

import { desc, eq } from "drizzle-orm";

import type {
  ConfidenceGrade,
  ConfidenceVerdict,
  EscalationTrigger,
  RiskLevel
} from "@workhub/contracts";

import type { WorkHubDb } from "../client.js";
import { confidenceRecords, escalationEvents } from "../schema/index.js";

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

export type AiDecisionRepository = {
  createConfidenceRecord: (input: CreateConfidenceRecordInput) => Promise<ConfidenceRecordRow>;
  listConfidenceRecordsForWorkItem: (workItemId: string) => Promise<ConfidenceRecordRow[]>;
  findConfidenceRecordForAgentRun: (agentRunId: string) => Promise<ConfidenceRecordRow | null>;
  createEscalationEvent: (input: CreateEscalationEventInput) => Promise<EscalationEventRow>;
  listEscalationEventsForWorkItem: (workItemId: string) => Promise<EscalationEventRow[]>;
};

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
    }
  };
}
