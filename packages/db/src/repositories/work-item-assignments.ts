import { randomUUID } from "node:crypto";

import { asc, eq } from "drizzle-orm";

import type { WorkHubDb } from "../client.js";
import { workItemAssignments } from "../schema/index.js";

export type WorkItemAssignmentRow = typeof workItemAssignments.$inferSelect;

export type AssignWorkItemInput = {
  workItemId: string;
  userId: string;
  role: "lead" | "collaborator";
  assignedByUserId: string;
  at?: Date;
};

// R20 P2A（R19-18 指派/认领）：把工作项显式指派给某成员，落一行 work_item_assignments。生产此前对
// 这张表零 INSERT（唯一写口是找人卡的 claimedByUserId，不写 assignments 行）。单列在自有仓库里——
// 只服务人发起的指派端点，不掺进 WorkItemDataRepository 的大接口（那会牵动一堆 fake 实现）。
export type WorkItemAssignmentRepository = {
  // upsert 语义：同一 (workItemId, userId) 再次指派＝改角色（命中唯一索引 work_item_assignments_item_user_uq），
  // 不新增重复行；assignedByUserId/updatedAt 一并刷新。返回落地后的整行。
  assignWorkItem: (input: AssignWorkItemInput) => Promise<WorkItemAssignmentRow>;
  listAssignmentsForWorkItem: (workItemId: string) => Promise<WorkItemAssignmentRow[]>;
};

export function createWorkItemAssignmentRepository(db: WorkHubDb): WorkItemAssignmentRepository {
  return {
    async assignWorkItem(input) {
      const at = input.at ?? new Date();
      const rows = await db
        .insert(workItemAssignments)
        .values({
          id: randomUUID(),
          workItemId: input.workItemId,
          userId: input.userId,
          role: input.role,
          assignedByUserId: input.assignedByUserId,
          createdAt: at,
          updatedAt: at
        })
        // 已有 (workItemId, userId) 指派行时改角色（不新增重复行）。
        .onConflictDoUpdate({
          target: [workItemAssignments.workItemId, workItemAssignments.userId],
          set: {
            role: input.role,
            assignedByUserId: input.assignedByUserId,
            updatedAt: at
          }
        })
        .returning();
      const row = rows[0];
      if (!row) {
        throw new Error("Failed to write work item assignment");
      }
      return row;
    },

    async listAssignmentsForWorkItem(workItemId) {
      return db
        .select()
        .from(workItemAssignments)
        .where(eq(workItemAssignments.workItemId, workItemId))
        .orderBy(asc(workItemAssignments.createdAt));
    }
  };
}
