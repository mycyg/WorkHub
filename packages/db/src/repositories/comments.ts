import { randomUUID } from "node:crypto";

import { desc, eq } from "drizzle-orm";

import type { WorkHubDb } from "../client.js";
import { comments } from "../schema/index.js";

export type CommentRow = typeof comments.$inferSelect;

export type InsertCommentInput = {
  id?: string;
  workItemId: string;
  authorNickname: string;
  body: string;
  at?: Date;
};

// R20 P2A（R19-22 工作项评论）：通用 comments 表（work_item_id + author_nickname + body）全库此前零读写，
// 补上读/写两口。评论流是「一个工作项下的讨论」，按 createdAt 升序（对话顺序）。
export const COMMENTS_FOR_WORK_ITEM_LIMIT = 200;

export type CommentRepository = {
  listCommentsForWorkItem: (workItemId: string, options?: { limit?: number }) => Promise<CommentRow[]>;
  insertComment: (input: InsertCommentInput) => Promise<CommentRow>;
};

export function createCommentRepository(db: WorkHubDb): CommentRepository {
  return {
    async listCommentsForWorkItem(workItemId, options = {}) {
      const limit = options.limit ?? COMMENTS_FOR_WORK_ITEM_LIMIT;
      // R21 加固：超过 limit 时保留【最新】的 N 条——先按 createdAt 倒序取（id 做稳定 tie-breaker，
      // 同秒落库的行序确定），再反转回升序返回，保持「对话顺序」的返回形状与契约不变。
      // 旧写法 asc+limit 会截掉最新评论：第 201 条起的新评论永远不可见。
      const rows = await db
        .select()
        .from(comments)
        .where(eq(comments.workItemId, workItemId))
        .orderBy(desc(comments.createdAt), desc(comments.id))
        .limit(limit);
      return rows.reverse();
    },

    async insertComment(input) {
      const at = input.at ?? new Date();
      const rows = await db
        .insert(comments)
        .values({
          id: input.id ?? randomUUID(),
          workItemId: input.workItemId,
          authorNickname: input.authorNickname,
          body: input.body,
          createdAt: at,
          updatedAt: at
        })
        .returning();
      const row = rows[0];
      if (!row) {
        throw new Error("Failed to insert work item comment");
      }
      return row;
    }
  };
}
