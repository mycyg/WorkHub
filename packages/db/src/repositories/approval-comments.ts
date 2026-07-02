import { randomUUID } from "node:crypto";

import { asc, desc, eq, inArray, lte, sql } from "drizzle-orm";

import type { WorkHubDb } from "../client.js";
import { approvalComments } from "../schema/index.js";

export type ApprovalCommentRow = typeof approvalComments.$inferSelect;

export type CreateApprovalCommentInput = {
  approvalId: string;
  authorUserId: string;
  authorNickname: string;
  body: string;
};

export type ApprovalCommentRepository = {
  listByApproval: (approvalId: string, limit?: number) => Promise<ApprovalCommentRow[]>;
  // 批量读：一条 IN 查询取多审批的评论（审批中心页面预取，避免逐审批 N+1）。
  listByApprovals: (approvalIds: string[], limitPerApproval?: number) => Promise<ApprovalCommentRow[]>;
  create: (input: CreateApprovalCommentInput) => Promise<ApprovalCommentRow>;
};

export function createApprovalCommentRepository(db: WorkHubDb): ApprovalCommentRepository {
  return {
    async listByApproval(approvalId, limit = 100) {
      // L#W2-13：封顶，热门审批的评论流不会把全部正文塞进预取的页面 VM。
      const cappedLimit = Math.max(1, Math.min(limit, 200));
      const rows = await db
        .select()
        .from(approvalComments)
        .where(eq(approvalComments.approvalId, approvalId))
        .orderBy(desc(approvalComments.createdAt), desc(approvalComments.id))
        .limit(cappedLimit);
      return rows.reverse();
    },

    async listByApprovals(approvalIds, limitPerApproval = 20) {
      if (approvalIds.length === 0) {
        return [];
      }
      const limit = Math.max(1, Math.min(limitPerApproval, 100));
      const ranked = db
        .select({
          id: approvalComments.id,
          approvalId: approvalComments.approvalId,
          authorUserId: approvalComments.authorUserId,
          authorNickname: approvalComments.authorNickname,
          body: approvalComments.body,
          createdAt: approvalComments.createdAt,
          updatedAt: approvalComments.updatedAt,
          rowNumber: sql<number>`row_number() over (partition by ${approvalComments.approvalId} order by ${approvalComments.createdAt} desc, ${approvalComments.id} desc)`.as("row_number")
        })
        .from(approvalComments)
        .where(inArray(approvalComments.approvalId, approvalIds))
        .as("ranked_approval_comments");
      return db
        .select({
          id: ranked.id,
          approvalId: ranked.approvalId,
          authorUserId: ranked.authorUserId,
          authorNickname: ranked.authorNickname,
          body: ranked.body,
          createdAt: ranked.createdAt,
          updatedAt: ranked.updatedAt
        })
        .from(ranked)
        .where(lte(ranked.rowNumber, limit))
        .orderBy(asc(ranked.approvalId), asc(ranked.createdAt), asc(ranked.id));
    },

    async create(input) {
      const rows = await db
        .insert(approvalComments)
        .values({
          id: randomUUID(),
          approvalId: input.approvalId,
          authorUserId: input.authorUserId,
          authorNickname: input.authorNickname,
          body: input.body
        })
        .returning();
      const row = rows[0];
      if (!row) {
        throw new Error("Failed to create approval comment");
      }
      return row;
    }
  };
}
