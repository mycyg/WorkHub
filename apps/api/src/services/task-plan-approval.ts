import type { StoredProposal } from "./proposals.js";
import {
  createTaskPlanRepository,
  getSharedDatabaseClient,
  type TaskPlanRow
} from "@workhub/db";

export type TaskPlanApprovalRepository = {
  approvePlan: (input: { planId: string; workspaceId: string; workItemId: string; approvedAt?: Date }) => Promise<TaskPlanRow | null>;
};

export type TaskPlanMergeApprovalHandler = (proposal: StoredProposal) => Promise<TaskPlanRow | null>;

export class TaskPlanApprovalError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
  }
}

export function taskPlanApprovalTarget(proposal: StoredProposal) {
  const change = proposal.diff_manifest.changes.find((item) =>
    item.target_kind === "structured_record"
    && item.target_ref.entity_type === "task_plan"
  );
  if (!change?.target_ref.entity_id) {
    if (change) {
      throw new TaskPlanApprovalError(
        409,
        "task_plan_approval_failed",
        "任务计划提议缺少 plan id，不能标记为已批准。"
      );
    }
    return undefined;
  }
  const workspaceId = change.target_ref.path?.match(/\/workspaces\/([^/]+)\/task-plans\//u)?.[1];
  if (!workspaceId) {
    throw new TaskPlanApprovalError(
      409,
      "task_plan_approval_failed",
      "任务计划提议缺少工作区范围，不能标记为已批准。"
    );
  }
  return {
    planId: change.target_ref.entity_id,
    workspaceId,
    workItemId: proposal.work_item_id
  };
}

export function createTaskPlanMergeApprovalHandler(input: {
  taskPlans: TaskPlanApprovalRepository;
  now?: () => Date;
}): TaskPlanMergeApprovalHandler {
  const now = input.now ?? (() => new Date());
  return async (proposal) => {
    const target = taskPlanApprovalTarget(proposal);
    if (!target) {
      return null;
    }
    const approved = await input.taskPlans.approvePlan({
      ...target,
      approvedAt: now()
    });
    if (!approved) {
      throw new TaskPlanApprovalError(
        409,
        "task_plan_approval_failed",
        "任务计划提议已合并，但对应草稿未能标记为已批准。"
      );
    }
    return approved;
  };
}

let defaultTaskPlanApprovalHandler: TaskPlanMergeApprovalHandler | undefined;

export function getDefaultTaskPlanMergeApprovalHandler() {
  defaultTaskPlanApprovalHandler ??= createTaskPlanMergeApprovalHandler({
    taskPlans: createTaskPlanRepository(getSharedDatabaseClient().db)
  });
  return defaultTaskPlanApprovalHandler;
}
