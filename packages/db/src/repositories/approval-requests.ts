import { randomUUID } from "node:crypto";

import { and, asc, desc, eq, lte } from "drizzle-orm";

import type { ApprovalDecision } from "@workhub/contracts";

import type { WorkHubDb } from "../client.js";
import { approvalRequests } from "../schema/index.js";

export type ApprovalRequestRow = typeof approvalRequests.$inferSelect;

export type CreateApprovalRequestInput = {
  id?: string;
  workItemId?: string;
  agentRunId?: string;
  actionPattern: string;
  payloadJson?: Record<string, unknown>;
  routedToUserId?: string;
  slaDueAt?: Date;
};

export type ApprovalRequestRepository = {
  createApprovalRequest: (input: CreateApprovalRequestInput) => Promise<ApprovalRequestRow>;
  findById: (id: string) => Promise<ApprovalRequestRow | null>;
  listPendingDue: (at: Date, limit?: number) => Promise<ApprovalRequestRow[]>;
  listPendingForUser: (userId: string, options?: { includeAll?: boolean }) => Promise<ApprovalRequestRow[]>;
  respondPending: (
    id: string,
    decision: ApprovalDecision,
    decidedByUserId: string,
    reasonMd: string | null,
    at: Date
  ) => Promise<ApprovalRequestRow | null>;
  delegatePending: (id: string, toUserId: string, at: Date) => Promise<ApprovalRequestRow | null>;
  expirePending: (id: string, at: Date) => Promise<ApprovalRequestRow | null>;
};

export function createApprovalRequestRepository(db: WorkHubDb): ApprovalRequestRepository {
  return {
    async createApprovalRequest(input) {
      const rows = await db
        .insert(approvalRequests)
        .values({
          id: input.id ?? randomUUID(),
          workItemId: input.workItemId,
          agentRunId: input.agentRunId,
          actionPattern: input.actionPattern,
          payloadJson: input.payloadJson ?? {},
          status: "pending",
          routedToUserId: input.routedToUserId,
          slaDueAt: input.slaDueAt
        })
        .returning();
      const approval = rows[0];
      if (!approval) {
        throw new Error("Failed to create approval request");
      }
      return approval;
    },

    async findById(id) {
      const rows = await db.select().from(approvalRequests).where(eq(approvalRequests.id, id)).limit(1);
      return rows[0] ?? null;
    },

    async listPendingDue(at, limit = 50) {
      return db
        .select()
        .from(approvalRequests)
        .where(and(eq(approvalRequests.status, "pending"), lte(approvalRequests.slaDueAt, at)))
        .orderBy(asc(approvalRequests.slaDueAt), asc(approvalRequests.createdAt))
        .limit(limit);
    },

    async listPendingForUser(userId, options = {}) {
      const query = db
        .select()
        .from(approvalRequests)
        .where(
          options.includeAll
            ? eq(approvalRequests.status, "pending")
            : and(eq(approvalRequests.status, "pending"), eq(approvalRequests.routedToUserId, userId))
        )
        .orderBy(desc(approvalRequests.createdAt));
      return query;
    },

    async respondPending(id, decision, decidedByUserId, reasonMd, at) {
      const rows = await db
        .update(approvalRequests)
        .set({
          status: decision === "allow" ? "approved" : "denied",
          decidedByUserId,
          decisionReasonMd: reasonMd,
          updatedAt: at
        })
        .where(and(eq(approvalRequests.id, id), eq(approvalRequests.status, "pending")))
        .returning();
      return rows[0] ?? null;
    },

    async delegatePending(id, toUserId, at) {
      const rows = await db
        .update(approvalRequests)
        .set({
          status: "pending",
          routedToUserId: toUserId,
          delegatedToUserId: toUserId,
          updatedAt: at
        })
        .where(and(eq(approvalRequests.id, id), eq(approvalRequests.status, "pending")))
        .returning();
      return rows[0] ?? null;
    },

    async expirePending(id, at) {
      const rows = await db
        .update(approvalRequests)
        .set({
          status: "expired",
          updatedAt: at
        })
        .where(and(eq(approvalRequests.id, id), eq(approvalRequests.status, "pending")))
        .returning();
      return rows[0] ?? null;
    }
  };
}
