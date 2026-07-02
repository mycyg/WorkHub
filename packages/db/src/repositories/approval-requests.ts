import { randomUUID } from "node:crypto";

import { and, asc, desc, eq, lte, sql } from "drizzle-orm";

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
  listPendingForUser: (userId: string, options?: { includeAll?: boolean; limit?: number; offset?: number }) => Promise<ApprovalRequestRow[]>;
  countPendingForUser: (userId: string, options?: { includeAll?: boolean }) => Promise<number>;
  respondPending: (
    id: string,
    decision: ApprovalDecision,
    decidedByUserId: string,
    reasonMd: string | null,
    at: Date,
    // findings[#27]：非 admin 决策时传当前审批人 id，让原子更新额外复核 routedToUserId 仍指向他——
    // 堵 respond 与 delegatePending 交错改派的 TOCTOU。admin override 传 undefined（可处理任意路由单据）。
    requireRoutedToUserId?: string
  ) => Promise<ApprovalRequestRow | null>;
  delegatePending: (
    id: string,
    toUserId: string,
    at: Date,
    requireRoutedToUserId?: string
  ) => Promise<ApprovalRequestRow | null>;
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
      // L#W2-2：封顶，避免管理员（includeAll）把全组织 pending 全量拉出再逐条 join（无界 N+1）。
      const limit = Math.max(1, Math.min(options.limit ?? 100, 200));
      const offset = Math.max(0, options.offset ?? 0);
      return db
        .select()
        .from(approvalRequests)
        .where(
          options.includeAll
            ? eq(approvalRequests.status, "pending")
            : and(eq(approvalRequests.status, "pending"), eq(approvalRequests.routedToUserId, userId))
        )
        .orderBy(desc(approvalRequests.createdAt))
        .limit(limit)
        .offset(offset);
    },

    async countPendingForUser(userId, options = {}) {
      const rows = await db
        .select({ value: sql<number>`count(*)::int` })
        .from(approvalRequests)
        .where(
          options.includeAll
            ? eq(approvalRequests.status, "pending")
            : and(eq(approvalRequests.status, "pending"), eq(approvalRequests.routedToUserId, userId))
        );
      return rows[0]?.value ?? 0;
    },

    async respondPending(id, decision, decidedByUserId, reasonMd, at, requireRoutedToUserId) {
      const rows = await db
        .update(approvalRequests)
        .set({
          status: decision === "allow" ? "approved" : "denied",
          decidedByUserId,
          decisionReasonMd: reasonMd,
          updatedAt: at
        })
        .where(and(
          eq(approvalRequests.id, id),
          eq(approvalRequests.status, "pending"),
          // findings[#27]：CAS 复核路由人。respond() 先读单据、按快照鉴权，再 update；若 delegatePending 在中间
          // 把单据改派给别人(仍保持 pending)，原审批人的鉴权快照已失效，这里原子匹配 0 行 → 409 approval_race，
          // 不让过期决策落库。admin override(requireRoutedToUserId=undefined)不加此谓词，可处理任意路由单据。
          ...(requireRoutedToUserId ? [eq(approvalRequests.routedToUserId, requireRoutedToUserId)] : [])
        ))
        .returning();
      return rows[0] ?? null;
    },

    async delegatePending(id, toUserId, at, requireRoutedToUserId) {
      const rows = await db
        .update(approvalRequests)
        .set({
          status: "pending",
          routedToUserId: toUserId,
          delegatedToUserId: toUserId,
          updatedAt: at
        })
        .where(and(
          eq(approvalRequests.id, id),
          eq(approvalRequests.status, "pending"),
          ...(requireRoutedToUserId ? [eq(approvalRequests.routedToUserId, requireRoutedToUserId)] : [])
        ))
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
