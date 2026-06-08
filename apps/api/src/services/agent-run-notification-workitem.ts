import {
  createDatabaseClient,
  createWorkItemRepository,
  type WorkHubDatabaseClient,
  type WorkItemRepository
} from "@workhub/db";
import type { LifecycleWorkItemRef } from "@workhub/events";

type AgentRunRef = {
  work_item_id: string;
  title: string;
};

export type AgentRunNotificationWorkItemResolver = (
  run: AgentRunRef
) => Promise<Partial<LifecycleWorkItemRef> | undefined>;

let defaultDbClient: WorkHubDatabaseClient | undefined;

function getDefaultWorkItemRepository() {
  defaultDbClient ??= createDatabaseClient();
  return createWorkItemRepository(defaultDbClient.db);
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
