import { and, eq, inArray, isNull } from "drizzle-orm";

import type { WorkHubDb } from "../client.js";
import { workspaceMemberships } from "../schema/index.js";

// R14 CHAT 批（presence-observer 工包）：GET /api/presence 要按「与请求者同工作区有 active
// membership」过滤候选 user_ids——过滤必须下推到 SQL（不能全量捞回应用层再筛），IN 列表本身受路由层
// ≤50 的硬顶约束（apps/api/src/routes/presence.ts），查询走 workspace_memberships_workspace_id_idx。
//
// 独立开一个新文件、新接口，而不是往 repositories/memberships.ts 的既有 WorkspaceMembershipRepository
// 接口里加方法——那个接口被多处测试用手写 fake class 完整实现（如 apps/api/src/auth.test.ts 的
// MemoryMemberships），往里加方法会连带要求改那些不在本工包范围内的文件（本工包禁止越界改动）。
// 这里只开一个窄接口，只服务 presence 读端点这一个用途。
export type PresenceMembershipRepository = {
  /** 从候选 user_ids 里筛出与 workspaceId 有 active（未软删）membership 的那些子集。 */
  listActiveUserIdsInWorkspace: (workspaceId: string, userIds: string[]) => Promise<string[]>;
};

export function createPresenceMembershipRepository(db: WorkHubDb): PresenceMembershipRepository {
  return {
    async listActiveUserIdsInWorkspace(workspaceId, userIds) {
      if (userIds.length === 0) {
        return [];
      }
      const rows = await db
        .select({ userId: workspaceMemberships.userId })
        .from(workspaceMemberships)
        .where(
          and(
            eq(workspaceMemberships.workspaceId, workspaceId),
            inArray(workspaceMemberships.userId, userIds),
            isNull(workspaceMemberships.deletedAt)
          )
        );
      return rows.map((row) => row.userId);
    }
  };
}
