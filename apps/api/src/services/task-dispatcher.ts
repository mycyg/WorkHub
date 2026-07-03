import {
  createAiDecisionRepository,
  createAuditLogRepository,
  createProposalRepository,
  createTaskPlanArbitrationRepository,
  createTaskPlanRepository,
  getSharedDatabaseClient,
  type AiDecisionRepository,
  type AuditLogRepository,
  type TaskPlanItemRow,
  type TaskPlanRow,
  type TaskPlanWithItems
} from "@workhub/db";

import { getDefaultStructuredLogger } from "../logging.js";
import type {
  AgentRunQueue,
  AgentRunQueueRecord
} from "../workers/agent-runner.js";
import { createCrossAgentJudge } from "./cross-agent-judge.js";
import { getDefaultProviderRegistry } from "./provider-registry.js";
import { createDbProposalService } from "./proposals.js";
import {
  createDbTaskDispatchArbitrationCandidateStore,
  createTaskDispatchArbitrationSink
} from "./task-dispatcher-arbitration.js";

type SettledItemStatus = Extract<TaskPlanItemRow["status"], "succeeded" | "failed">;
type EscalationReason = "cycle" | "dependency_failed" | "partial_failure";

export type TaskDispatcherRepository = {
  getPlanWithItems: (input: {
    planId: string;
    workspaceId: string;
    itemLimit?: number;
  }) => Promise<TaskPlanWithItems | null>;
  startDispatchingPlan: (input: {
    planId: string;
    workspaceId: string;
    startedAt?: Date;
  }) => Promise<TaskPlanRow | null>;
  markItemDispatched: (input: {
    planId: string;
    workspaceId: string;
    itemId: string;
    dispatchedAt?: Date;
  }) => Promise<TaskPlanItemRow | null>;
  settleDispatchedItem: (input: {
    planId: string;
    workspaceId: string;
    itemId: string;
    status: SettledItemStatus;
    settledAt?: Date;
  }) => Promise<TaskPlanItemRow | null>;
  skipPendingItems: (input: {
    planId: string;
    workspaceId: string;
    itemIds: string[];
    skippedAt?: Date;
  }) => Promise<TaskPlanItemRow[]>;
  markPlanDone: (input: {
    planId: string;
    workspaceId: string;
    doneAt?: Date;
  }) => Promise<TaskPlanRow | null>;
};

export type TaskDispatchInput = {
  planId: string;
  workspaceId: string;
  orgId?: string;
  actorId?: string;
  parentRunId?: string;
};

export type TaskDispatchResult = {
  planId: string;
  enqueuedItemIds: string[];
  skippedItemIds: string[];
  casMissItemIds: string[];
  completed: boolean;
};

export type TaskRunSettledResult = {
  planId: string;
  settledItemId: string;
  settledStatus: SettledItemStatus;
  dispatch: TaskDispatchResult;
};

export type TaskDispatchEscalationSink = (input: {
  plan: TaskPlanRow;
  items: TaskPlanItemRow[];
  skippedItemIds: string[];
  failedItemIds?: string[];
  failedRunId?: string;
  reason: EscalationReason;
  at: Date;
}) => Promise<void> | void;

export type TaskDispatchCompletionSink = (input: {
  plan: TaskPlanRow;
  items: TaskPlanItemRow[];
  summaryMd: string;
  at: Date;
}) => Promise<void> | void;

export type TaskDispatchArbitrationSink = (input: {
  plan: TaskPlanRow;
  items: TaskPlanItemRow[];
  at: Date;
}) => Promise<void> | void;

export class TaskDispatcherError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
  }
}

const ITEM_READ_LIMIT = 100;
const TERMINAL_ITEM_STATUSES = new Set<TaskPlanItemRow["status"]>(["succeeded", "failed", "skipped"]);
const FAILED_DEPENDENCY_STATUSES = new Set<TaskPlanItemRow["status"]>(["failed", "skipped"]);

function itemById(items: TaskPlanItemRow[]) {
  return new Map(items.map((item) => [item.id, item]));
}

function pendingItems(items: TaskPlanItemRow[]) {
  return items.filter((item) => item.status === "pending");
}

function hasDependencyCycle(items: TaskPlanItemRow[]) {
  const byId = itemById(items);
  const visiting = new Set<string>();
  const visited = new Set<string>();

  const visit = (id: string): boolean => {
    if (visiting.has(id)) {
      return true;
    }
    if (visited.has(id)) {
      return false;
    }
    const item = byId.get(id);
    if (!item) {
      return false;
    }
    visiting.add(id);
    for (const dependencyId of item.dependsOn ?? []) {
      if (byId.has(dependencyId) && visit(dependencyId)) {
        return true;
      }
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  };

  return items.some((item) => visit(item.id));
}

function blockedByFailedDependency(items: TaskPlanItemRow[]) {
  const byId = itemById(items);
  const blocked = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const item of pendingItems(items)) {
      if (blocked.has(item.id)) {
        continue;
      }
      const hasBlockedDependency = (item.dependsOn ?? []).some((dependencyId) => {
        const dependency = byId.get(dependencyId);
        return !dependency || blocked.has(dependencyId) || FAILED_DEPENDENCY_STATUSES.has(dependency.status);
      });
      if (hasBlockedDependency) {
        blocked.add(item.id);
        changed = true;
      }
    }
  }
  return pendingItems(items).filter((item) => blocked.has(item.id));
}

function readyPendingItems(items: TaskPlanItemRow[]) {
  const byId = itemById(items);
  return pendingItems(items).filter((item) =>
    (item.dependsOn ?? []).every((dependencyId) => byId.get(dependencyId)?.status === "succeeded")
  );
}

function allTerminal(items: TaskPlanItemRow[]) {
  return items.length > 0 && items.every((item) => TERMINAL_ITEM_STATUSES.has(item.status));
}

function hasArbitrableOutputs(items: TaskPlanItemRow[]) {
  return items.filter((item) => item.status === "succeeded").length >= 2;
}

function taskObjective(item: TaskPlanItemRow) {
  return [
    "Objective:",
    item.objectiveMd,
    "",
    "Acceptance:",
    item.acceptanceMd,
    "",
    `Budget share: ${item.budgetSharePct}%`
  ].join("\n");
}

function updateLocalItemStatus(items: TaskPlanItemRow[], itemId: string, status: TaskPlanItemRow["status"], at: Date) {
  const item = items.find((candidate) => candidate.id === itemId);
  if (item) {
    item.status = status;
    item.updatedAt = at;
  }
}

function updateLocalItems(items: TaskPlanItemRow[], rows: TaskPlanItemRow[]) {
  for (const row of rows) {
    const index = items.findIndex((item) => item.id === row.id);
    if (index >= 0) {
      items[index] = row;
    }
  }
}

function completionSummary(plan: TaskPlanRow, items: TaskPlanItemRow[]) {
  const succeeded = items.filter((item) => item.status === "succeeded");
  const failed = items.filter((item) => item.status === "failed");
  const skipped = items.filter((item) => item.status === "skipped");
  return [
    `Task plan ${plan.id} completed.`,
    `Succeeded items: ${succeeded.map((item) => item.title).join(", ") || "none"}.`,
    `Failed items: ${failed.map((item) => item.title).join(", ") || "none"}.`,
    `Skipped items: ${skipped.map((item) => item.title).join(", ") || "none"}.`
  ].join("\n");
}

function terminalStatusForRun(run: AgentRunQueueRecord): SettledItemStatus | null {
  if (run.status === "succeeded") {
    return "succeeded";
  }
  if (run.status === "failed" || run.status === "escalated" || run.status === "cancelled") {
    return "failed";
  }
  return null;
}

async function requireEscalation(
  sink: TaskDispatchEscalationSink | undefined,
  input: Parameters<TaskDispatchEscalationSink>[0]
) {
  if (!sink) {
    throw new TaskDispatcherError(500, "task_dispatch_escalation_sink_missing", "任务计划需要人工关注，但决策收件箱写入器未配置。");
  }
  try {
    await sink(input);
  } catch (error) {
    getDefaultStructuredLogger().warn("task_dispatch_escalation_failed", {
      planId: input.plan.id,
      reason: input.reason,
      error
    });
    throw error;
  }
}

async function requireCompletion(
  sink: TaskDispatchCompletionSink | undefined,
  input: Parameters<TaskDispatchCompletionSink>[0]
) {
  if (!sink) {
    return;
  }
  try {
    await sink(input);
  } catch (error) {
    getDefaultStructuredLogger().warn("task_dispatch_completion_failed", {
      planId: input.plan.id,
      error
    });
    throw error;
  }
}

async function requireArbitration(
  sink: TaskDispatchArbitrationSink | undefined,
  input: Parameters<TaskDispatchArbitrationSink>[0]
) {
  if (!sink) {
    return;
  }
  try {
    await sink(input);
  } catch (error) {
    getDefaultStructuredLogger().warn("task_dispatch_arbitration_failed", {
      planId: input.plan.id,
      error
    });
    throw error;
  }
}

export function createTaskDispatcher(options: {
  repository: TaskDispatcherRepository;
  queue: Pick<AgentRunQueue, "enqueue">;
  escalationSink?: TaskDispatchEscalationSink | false;
  completionSink?: TaskDispatchCompletionSink | false;
  arbitrationSink?: TaskDispatchArbitrationSink | false;
  now?: () => Date;
}) {
  const now = options.now ?? (() => new Date());
  const escalationSink = options.escalationSink === false ? undefined : options.escalationSink;
  const completionSink = options.completionSink === false ? undefined : options.completionSink;
  const arbitrationSink = options.arbitrationSink === false ? undefined : options.arbitrationSink;

  async function loadPlan(input: { planId: string; workspaceId: string }) {
    const loaded = await options.repository.getPlanWithItems({
      planId: input.planId,
      workspaceId: input.workspaceId,
      itemLimit: ITEM_READ_LIMIT
    });
    if (!loaded) {
      throw new TaskDispatcherError(404, "task_plan_not_found", "没有找到这个任务计划。");
    }
    if (loaded.itemsCapped) {
      throw new TaskDispatcherError(409, "task_plan_items_capped", "任务计划子项超过执行上限，请先拆小。");
    }
    return loaded;
  }

  async function maybeCompletePlan(plan: TaskPlanRow, items: TaskPlanItemRow[], at: Date) {
    if (!allTerminal(items)) {
      return false;
    }
    if (hasArbitrableOutputs(items)) {
      await requireArbitration(arbitrationSink, {
        plan,
        items,
        at
      });
    }
    const completedPlan: TaskPlanRow = { ...plan, status: "done", updatedAt: at };
    await requireCompletion(completionSink, {
      plan: completedPlan,
      items,
      summaryMd: completionSummary(completedPlan, items),
      at
    });
    const done = await options.repository.markPlanDone({
      planId: plan.id,
      workspaceId: plan.workspaceId,
      doneAt: at
    });
    if (!done) {
      return false;
    }
    return true;
  }

  async function dispatch(input: TaskDispatchInput): Promise<TaskDispatchResult> {
    const at = now();
    const loaded = await loadPlan(input);
    let plan = loaded.plan;
    const items = loaded.items.map((item) => ({ ...item }));
    const result: TaskDispatchResult = {
      planId: plan.id,
      enqueuedItemIds: [],
      skippedItemIds: [],
      casMissItemIds: [],
      completed: false
    };

    if (plan.status === "approved") {
      plan = await options.repository.startDispatchingPlan({
        planId: input.planId,
        workspaceId: input.workspaceId,
        startedAt: at
      }) ?? plan;
    }
    if (plan.status !== "approved" && plan.status !== "dispatching") {
      result.completed = await maybeCompletePlan(plan, items, at);
      return result;
    }

    if (hasDependencyCycle(items)) {
      const toSkip = pendingItems(items).map((item) => item.id);
      const skipped = await options.repository.skipPendingItems({
        planId: plan.id,
        workspaceId: plan.workspaceId,
        itemIds: toSkip,
        skippedAt: at
      });
      updateLocalItems(items, skipped);
      result.skippedItemIds.push(...skipped.map((item) => item.id));
      await requireEscalation(escalationSink, {
        plan,
        items,
        skippedItemIds: result.skippedItemIds,
        reason: "cycle",
        at
      });
      result.completed = await maybeCompletePlan(plan, items, at);
      return result;
    }

    const blocked = blockedByFailedDependency(items);
    if (blocked.length > 0) {
      const skipped = await options.repository.skipPendingItems({
        planId: plan.id,
        workspaceId: plan.workspaceId,
        itemIds: blocked.map((item) => item.id),
        skippedAt: at
      });
      updateLocalItems(items, skipped);
      result.skippedItemIds.push(...skipped.map((item) => item.id));
      await requireEscalation(escalationSink, {
        plan,
        items,
        skippedItemIds: result.skippedItemIds,
        reason: "dependency_failed",
        at
      });
    }

    for (const item of readyPendingItems(items)) {
      const dispatched = await options.repository.markItemDispatched({
        planId: plan.id,
        workspaceId: plan.workspaceId,
        itemId: item.id,
        dispatchedAt: at
      });
      if (!dispatched) {
        result.casMissItemIds.push(item.id);
        continue;
      }
      updateLocalItemStatus(items, item.id, "dispatched", at);
      try {
        await options.queue.enqueue({
          workItemId: plan.workItemId,
          actorId: input.actorId ?? plan.createdByUserId,
          ...(input.orgId ? { orgId: input.orgId } : {}),
          workspaceId: plan.workspaceId,
          ...(input.parentRunId ? { parentRunId: input.parentRunId } : {}),
          taskPlanId: plan.id,
          taskPlanItemId: item.id,
          ...(plan.objectiveId ? { objectiveId: plan.objectiveId } : {}),
          agentRole: item.role,
          objectiveMd: taskObjective(item),
          title: item.title,
          mode: "worker"
        });
      } catch (error) {
        const failed = await options.repository.settleDispatchedItem({
          planId: plan.id,
          workspaceId: plan.workspaceId,
          itemId: item.id,
          status: "failed",
          settledAt: at
        });
        if (failed) {
          updateLocalItems(items, [failed]);
          await requireEscalation(escalationSink, {
            plan,
            items,
            skippedItemIds: [],
            failedItemIds: [item.id],
            reason: "partial_failure",
            at
          });
        }
        throw error;
      }
      result.enqueuedItemIds.push(item.id);
    }

    result.completed = await maybeCompletePlan(plan, items, at);
    return result;
  }

  async function handleRunSettled(run: AgentRunQueueRecord): Promise<TaskRunSettledResult | null> {
    const settledStatus = terminalStatusForRun(run);
    if (!settledStatus || !run.task_plan_id || !run.task_plan_item_id) {
      return null;
    }
    if (!run.workspace_id) {
      getDefaultStructuredLogger().warn("task_dispatch_run_settled_missing_workspace", {
        runId: run.run_id,
        taskPlanId: run.task_plan_id,
        taskPlanItemId: run.task_plan_item_id
      });
      return null;
    }
    const at = now();
    const settled = await options.repository.settleDispatchedItem({
      planId: run.task_plan_id,
      workspaceId: run.workspace_id,
      itemId: run.task_plan_item_id,
      status: settledStatus,
      settledAt: at
    });
    if (!settled) {
      return null;
    }
    if (settledStatus === "failed") {
      const loaded = await loadPlan({
        planId: run.task_plan_id,
        workspaceId: run.workspace_id
      });
      if (blockedByFailedDependency(loaded.items).length === 0) {
        await requireEscalation(escalationSink, {
          plan: loaded.plan,
          items: loaded.items,
          skippedItemIds: [],
          failedItemIds: [run.task_plan_item_id],
          failedRunId: run.run_id,
          reason: "partial_failure",
          at
        });
      }
    }
    const dispatchResult = await dispatch({
      planId: run.task_plan_id,
      workspaceId: run.workspace_id,
      ...(run.org_id ? { orgId: run.org_id } : {}),
      actorId: run.actor_id,
      ...(run.parent_run_id ? { parentRunId: run.parent_run_id } : {})
    });
    return {
      planId: run.task_plan_id,
      settledItemId: run.task_plan_item_id,
      settledStatus,
      dispatch: dispatchResult
    };
  }

  return {
    dispatch,
    handleRunSettled
  };
}

export type TaskDispatcher = ReturnType<typeof createTaskDispatcher>;

export function createDbTaskDispatchEscalationSink(
  decisions: Pick<AiDecisionRepository, "createEscalationEvent">
): TaskDispatchEscalationSink {
  return async (input) => {
    const reasonMd = input.reason === "cycle"
      ? "任务计划依赖图存在循环，已跳过尚未开始的子任务，请人工调整计划后重试。"
      : input.reason === "partial_failure"
        ? "任务计划已有子任务失败，请在决策收件箱选择重试、转人工或改计划。"
        : "任务计划的上游子任务失败或被跳过，依赖它的子任务已跳过，请人工决定是否重试或改计划。";
    await decisions.createEscalationEvent({
      workItemId: input.plan.workItemId,
      ...(input.failedRunId ? { agentRunId: input.failedRunId } : {}),
      trigger: input.reason === "cycle" ? "doom_loop" : "unqualified",
      reasonMd,
      handoffJson: {
        source: "task_dispatcher",
        reason: input.reason,
        task_plan_id: input.plan.id,
        ...(input.failedItemIds ? { failed_item_ids: input.failedItemIds } : {}),
        ...(input.failedRunId ? { failed_run_id: input.failedRunId } : {}),
        skipped_item_ids: input.skippedItemIds
      }
    });
  };
}

export function createDbTaskDispatchCompletionSink(
  auditLogs: Pick<AuditLogRepository, "createAuditLog">
): TaskDispatchCompletionSink {
  return async (input) => {
    await auditLogs.createAuditLog({
      workspaceId: input.plan.workspaceId,
      actorKind: "system",
      actorNickname: "WorkHub",
      entityType: "work_item",
      entityId: input.plan.workItemId,
      action: "task_plan.completed",
      detailJson: {
        task_plan_id: input.plan.id,
        summary_md: input.summaryMd,
        item_statuses: input.items.map((item) => ({
          id: item.id,
          title: item.title,
          status: item.status,
          role: item.role
        }))
      }
    });
  };
}

let defaultTaskDispatcher: TaskDispatcher | undefined;

export function getDefaultTaskDispatcher(queue: Pick<AgentRunQueue, "enqueue">) {
  if (!defaultTaskDispatcher) {
    const dbClient = getSharedDatabaseClient();
    const providerRegistry = getDefaultProviderRegistry();
    const reviewRoute = providerRegistry.routeFor("review");
    const proposals = createDbProposalService(createProposalRepository(dbClient.db));
    defaultTaskDispatcher = createTaskDispatcher({
      repository: createTaskPlanRepository(dbClient.db),
      queue,
      escalationSink: createDbTaskDispatchEscalationSink(createAiDecisionRepository(dbClient.db)),
      completionSink: createDbTaskDispatchCompletionSink(createAuditLogRepository(dbClient.db)),
      arbitrationSink: createTaskDispatchArbitrationSink({
        candidates: createDbTaskDispatchArbitrationCandidateStore(createTaskPlanArbitrationRepository(dbClient.db)),
        judge: createCrossAgentJudge({ providerRegistry }),
        proposalReviews: proposals,
        judgeClientRef: `${reviewRoute.provider.name}:${reviewRoute.model.model}:review`
      })
    });
  }
  return defaultTaskDispatcher;
}
