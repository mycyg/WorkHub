import {
  getSharedDatabaseClient,
  createWorkItemRepository,
  createUserRepository,
  type WorkHubDatabaseClient,
  type WorkItemRepository,
  type UserRepository
} from "@workhub/db";
import type { LifecycleUserRef, LifecycleWorkItemRef } from "@workhub/events";

type AgentRunRef = {
  work_item_id: string;
  title: string;
};

export type AgentRunNotificationWorkItemResolver = (
  run: AgentRunRef
) => Promise<Partial<LifecycleWorkItemRef> | undefined>;

// R2 audit#5：把一组收件人 id 解析成活跃度引用（含 deletedAt），供 lifecycle 过滤丢弃已停用收件人。
export type AgentRunUserRefResolver = (userIds: string[]) => Promise<LifecycleUserRef[]>;

let defaultDbClient: WorkHubDatabaseClient | undefined;

function getDefaultWorkItemRepository() {
  defaultDbClient ??= getSharedDatabaseClient();
  return createWorkItemRepository(defaultDbClient.db);
}

function getDefaultUserRepository() {
  defaultDbClient ??= getSharedDatabaseClient();
  return createUserRepository(defaultDbClient.db);
}

export function createAgentRunNotificationWorkItemResolver(deps: {
  workItems?: Pick<WorkItemRepository, "findWorkItemForNotificationContext">;
} = {}): AgentRunNotificationWorkItemResolver {
  const workItems = deps.workItems ?? getDefaultWorkItemRepository();
  return async (run) => {
    const row = await workItems.findWorkItemForNotificationContext(run.work_item_id);
    if (!row) {
      return undefined;
    }
    const context: Partial<LifecycleWorkItemRef> = {
      id: row.id,
      code: row.code,
      title: row.title ?? run.title,
      projectId: row.projectId,
      submitterUserId: row.submitterUserId,
      assigneeUserIds: row.claimedByUserId ? [row.claimedByUserId] : []
    };
    if (row.projectOwnerUserId) {
      context.projectOwnerUserId = row.projectOwnerUserId;
    }
    return context;
  };
}

export function createAgentRunUserRefResolver(deps: {
  users?: Pick<UserRepository, "findRefsByIds">;
} = {}): AgentRunUserRefResolver {
  const users = deps.users ?? getDefaultUserRepository();
  return async (userIds) => {
    if (userIds.length === 0 || !users.findRefsByIds) {
      return [];
    }
    const rows = await users.findRefsByIds(userIds);
    return rows.map((row) => ({ id: row.id, deletedAt: row.deletedAt }));
  };
}
