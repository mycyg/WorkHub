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
  listByApproval: (approvalId: string) => Promise<ApprovalCommentRow[]>;
  create: (input: CreateApprovalCommentInput) => Promise<ApprovalCommentRow>;
};

export function createApprovalCommentRepository(db: WorkHubDb): ApprovalCommentRepository {
  return {
    async listByApproval(approvalId) {
      return db
        .select()
        .from(approvalComments)
        .where(eq(approvalComments.approvalId, approvalId))
        .orderBy(asc(approvalComments.createdAt));
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
