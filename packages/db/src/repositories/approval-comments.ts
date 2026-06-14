import { randomUUID } from "node:crypto";

import { asc, eq } from "drizzle-orm";

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
  create: (input: CreateApprovalCommentInput) => Promise<ApprovalCommentRow>;
};

export function createApprovalCommentRepository(db: WorkHubDb): ApprovalCommentRepository {
  return {
    async listByApproval(approvalId, limit = 100) {
      // L#W2-13：封顶，热门审批的评论流不会把全部正文塞进预取的页面 VM。
      return db
        .select()
        .from(approvalComments)
        .where(eq(approvalComments.approvalId, approvalId))
        .orderBy(asc(approvalComments.createdAt))
        .limit(Math.max(1, Math.min(limit, 200)));
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
