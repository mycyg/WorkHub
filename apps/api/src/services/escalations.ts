import type {
  AttentionItem,
  DelegateEscalationRequest,
  ResolveEscalationRequest,
  WorkHubLocale,
  WorkItemStatus
} from "@workhub/contracts";
import {
  delegateEscalationRequestSchema,
  resolveEscalationRequestSchema
} from "@workhub/contracts";
import {
  createAiDecisionRepository,
  createWorkspaceMembershipRepository,
  createUserRepository,
  getSharedDatabaseClient,
  type EscalationServiceRow as DbEscalationServiceRow,
  type UserRepository,
  type WorkspaceMembershipRepository
} from "@workhub/db";

import type { AuthActor } from "../middleware/auth.js";
import { getDefaultAgentRunQueue } from "../workers/agent-runner.js";
import { getDefaultTaskDispatcher, type TaskDispatcher } from "./task-dispatcher.js";
import { getDefaultWorkItemService, type WorkItemService } from "./work-items.js";

export type EscalationServiceRow = DbEscalationServiceRow;

export type EscalationRepository = {
  findById: (id: string) => Promise<EscalationServiceRow | null>;
  listUnresolvedForWorkspace: (input: { workspaceId: string; limit?: number }) => Promise<EscalationServiceRow[]>;
  resolveEscalation: (input: {
    escalationId: string;
    targetStatus: WorkItemStatus;
    workspaceId?: string;
    taskPlanAction?: ResolveEscalationRequest["action"];
    at: Date;
  }) => Promise<EscalationServiceRow | null>;
  reopenEscalation?: (input: {
    escalationId: string;
    targetStatus: WorkItemStatus;
    workspaceId?: string;
    at: Date;
  }) => Promise<EscalationServiceRow | null>;
  delegateEscalation: (input: { escalationId: string; toUserId: string; at: Date }) => Promise<EscalationServiceRow | null>;
};

export class EscalationServiceError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
  }
}

export type EscalationService = ReturnType<typeof createEscalationService>;

type EscalationServiceDependencies = {
  repository?: EscalationRepository;
  users?: Pick<UserRepository, "findActiveById"> | false;
  memberships?: Pick<WorkspaceMembershipRepository, "findActiveForUserWorkspace"> | false;
  workItems?: Pick<WorkItemService, "canReadWorkItems"> | false;
  taskDispatcher?: Pick<TaskDispatcher, "dispatch"> | false;
  now?: () => Date;
};

let defaultDbClient: ReturnType<typeof getSharedDatabaseClient> | undefined;

function getDefaultEscalationRepository(): EscalationRepository {
  defaultDbClient ??= getSharedDatabaseClient();
  const repo = createAiDecisionRepository(defaultDbClient.db);
  return {
    findById: (id) => repo.findEscalationById(id),
    listUnresolvedForWorkspace: (input) => repo.listUnresolvedEscalationsForWorkspace(input),
    resolveEscalation: (input) => repo.resolveEscalation(input),
    reopenEscalation: (input) => repo.reopenEscalation?.(input) ?? Promise.resolve(null),
    delegateEscalation: (input) => repo.delegateEscalation(input)
  };
}

function getDefaultUsers() {
  defaultDbClient ??= getSharedDatabaseClient();
  return createUserRepository(defaultDbClient.db);
}

function getDefaultMemberships() {
  defaultDbClient ??= getSharedDatabaseClient();
  return createWorkspaceMembershipRepository(defaultDbClient.db);
}

function compactText(value: string, max = 220) {
  const compact = value.replace(/\s+/gu, " ").trim();
  if (compact.length <= max) {
    return compact;
  }
  return `${compact.slice(0, max - 3)}...`;
}

function resolveTargetStatus(action: ResolveEscalationRequest["action"]): WorkItemStatus {
  if (action === "retry") {
    return "ai_working";
  }
  if (action === "pm_mode") {
    return "pm_mode";
  }
  return "cancelled";
}

function taskPlanIdFromHandoff(row: EscalationServiceRow) {
  const value = row.handoffJson["task_plan_id"];
  return typeof value === "string" && value.trim() ? value : null;
}

function hasTaskPlanResolutionTarget(row: EscalationServiceRow) {
  if (!taskPlanIdFromHandoff(row)) {
    return false;
  }
  if (typeof row.handoffJson["task_plan_item_id"] === "string") {
    return true;
  }
  return ["failed_item_ids", "skipped_item_ids"].some((key) => {
    const value = row.handoffJson[key];
    return Array.isArray(value) && value.some((item) => typeof item === "string" && item.trim().length > 0);
  });
}

function defaultTaskDispatcher() {
  return getDefaultTaskDispatcher(getDefaultAgentRunQueue());
}

function actionSummary(action: ResolveEscalationRequest["action"], locale: WorkHubLocale) {
  if (locale === "en-US") {
    if (action === "retry") return "Cuu will retry this stuck task.";
    if (action === "pm_mode") return "This task is now in human mode.";
    return "This subtask has been cancelled.";
  }
  if (action === "retry") return "已让它重试这个卡住的任务。";
  if (action === "pm_mode") return "已转成你来处理。";
  return "已取消这个子任务。";
}

function workspaceMatches(row: EscalationServiceRow, actor: AuthActor) {
  return row.workspaceId === actor.workspaceId;
}

function ensureWorkspace(row: EscalationServiceRow, actor: AuthActor) {
  if (!workspaceMatches(row, actor)) {
    throw new EscalationServiceError(403, "forbidden", "你没有权限处理这条升级。");
  }
}

function escalationActions(id: string, locale: WorkHubLocale): AttentionItem["actions"] {
  const zh = locale === "zh-CN";
  const href = `/api/escalations/${id}/resolve`;
  return [
    {
      id: "escalation_retry",
      label: zh ? "让它重试" : "Let it retry",
      style: "primary",
      method: "POST",
      href
    },
    {
      id: "escalation_pm_mode",
      label: zh ? "转成我来做" : "I'll take over",
      style: "secondary",
      method: "POST",
      href
    },
    {
      id: "escalation_cancel",
      label: zh ? "取消这个子任务" : "Cancel this subtask",
      style: "danger",
      method: "POST",
      href
    }
  ];
}

function budgetNoticeFromHandoff(row: EscalationServiceRow) {
  const notice = row.handoffJson["notice"];
  return notice && typeof notice === "object" ? notice as {
    message?: string;
    recommended_action?: string;
    action_href?: string;
    options?: Array<{ id?: string; label?: string; action_href?: string }>;
  } : undefined;
}

function budgetActions(row: EscalationServiceRow, locale: WorkHubLocale): AttentionItem["actions"] {
  const notice = budgetNoticeFromHandoff(row);
  const options = Array.isArray(notice?.options) ? notice.options : [];
  const actions = options
    .filter((option): option is { id: string; label: string; action_href: string } =>
      Boolean(option.id && option.label && option.action_href)
    )
    .map((option, index) => ({
      id: option.id,
      label: option.label,
      style: option.id === notice?.recommended_action || index === 0 ? "primary" as const : "secondary" as const,
      method: "GET" as const,
      href: option.action_href
    }));
  if (actions.length > 0) {
    return actions;
  }
  return [{
    id: "open_cost",
    label: locale === "en-US" ? "Open budget" : "查看预算",
    style: "primary",
    method: "GET",
    href: notice?.action_href ?? "/dashboard/cost"
  }];
}

function buildBudgetAttentionItem(row: EscalationServiceRow, locale: WorkHubLocale): AttentionItem {
  const zh = locale === "zh-CN";
  const notice = budgetNoticeFromHandoff(row);
  const reason = compactText(notice?.message ?? row.reasonMd);
  return {
    id: row.id,
    kind: "budget",
    priority: "high",
    work_item_id: row.workItemId,
    project_id: row.projectId,
    source_ref: {
      entity_type: "budget_notice",
      entity_id: row.id
    },
    title: zh ? `《${row.title}》预算需要处理` : `"${row.title}" needs a budget decision`,
    summary_text: reason,
    reason_text: reason,
    actions: budgetActions(row, locale),
    cuu_state: "asking_approval",
    created_at: row.createdAt.toISOString()
  };
}

export function buildEscalationAttentionItem(row: EscalationServiceRow, locale: WorkHubLocale): AttentionItem {
  if (row.trigger === "budget_exhausted" || row.handoffJson["attention_kind"] === "budget") {
    return buildBudgetAttentionItem(row, locale);
  }
  const zh = locale === "zh-CN";
  const title = zh ? `《${row.title}》卡住了` : `"${row.title}" needs a decision`;
  const reason = compactText(row.reasonMd);
  return {
    id: row.id,
    kind: "escalation",
    priority: "urgent",
    work_item_id: row.workItemId,
    project_id: row.projectId,
    source_ref: {
      entity_type: "escalation_event",
      entity_id: row.id
    },
    title,
    summary_text: reason,
    reason_text: reason,
    actions: escalationActions(row.id, locale),
    cuu_state: "worried",
    created_at: row.createdAt.toISOString()
  };
}

export function createEscalationService(deps: EscalationServiceDependencies = {}) {
  const repository = deps.repository ?? getDefaultEscalationRepository();
  const users = deps.users === false ? undefined : deps.users ?? getDefaultUsers();
  const memberships = deps.memberships === false ? undefined : deps.memberships ?? getDefaultMemberships();
  const workItems = deps.workItems === false ? undefined : deps.workItems ?? getDefaultWorkItemService();
  const injectedTaskDispatcher = deps.taskDispatcher === false ? undefined : deps.taskDispatcher;
  const now = deps.now ?? (() => new Date());

  return {
    async resolve(id: string, actor: AuthActor, input: ResolveEscalationRequest) {
      const payload = resolveEscalationRequestSchema.parse(input);
      const existing = await repository.findById(id);
      if (!existing) {
        throw new EscalationServiceError(404, "escalation_not_found", "没有找到这条升级。");
      }
      ensureWorkspace(existing, actor);
      const targetStatus = resolveTargetStatus(payload.action);
      const taskPlanId = taskPlanIdFromHandoff(existing);
      const taskPlanAction = hasTaskPlanResolutionTarget(existing) ? payload.action : undefined;
      let row: EscalationServiceRow | null;
      try {
        row = await repository.resolveEscalation({
          escalationId: id,
          targetStatus,
          workspaceId: actor.workspaceId,
          ...(taskPlanAction ? { taskPlanAction } : {}),
          at: now()
        });
      } catch (error) {
        if ((error as { message?: string }).message === "escalation_status_transition_conflict") {
          throw new EscalationServiceError(409, "escalation_status_conflict", "当前事项状态已经变化，请刷新后再处理。");
        }
        throw error;
      }
      if (!row) {
        throw new EscalationServiceError(409, "escalation_race", "这条升级已经被处理过了。");
      }
      if (taskPlanAction === "retry" && taskPlanId) {
        try {
          await (injectedTaskDispatcher ?? defaultTaskDispatcher()).dispatch({
            planId: taskPlanId,
            workspaceId: actor.workspaceId,
            orgId: actor.orgId,
            ...(actor.userId ? { actorId: actor.userId } : {})
          });
        } catch {
          await repository.reopenEscalation?.({
            escalationId: id,
            targetStatus: "escalated",
            workspaceId: actor.workspaceId,
            at: now()
          });
          throw new EscalationServiceError(503, "task_dispatch_retry_failed", "重试派发失败，请稍后再试。");
        }
      }
      return {
        escalation: {
          id: row.id,
          work_item_id: row.workItemId,
          resolved_at: row.resolvedAt?.toISOString()
        },
        work_item_status: row.workItemStatus,
        attention: {
          summary_text: actionSummary(payload.action, "zh-CN")
        }
      };
    },

    async delegate(id: string, actor: AuthActor, input: DelegateEscalationRequest) {
      const payload = delegateEscalationRequestSchema.parse(input);
      const existing = await repository.findById(id);
      if (!existing) {
        throw new EscalationServiceError(404, "escalation_not_found", "没有找到这条升级。");
      }
      ensureWorkspace(existing, actor);
      if (users) {
        const target = await users.findActiveById(payload.to_user_id);
        if (!target) {
          throw new EscalationServiceError(404, "delegate_target_not_found", "找不到要转派的成员。");
        }
      }
      if (memberships) {
        const targetMembership = await memberships.findActiveForUserWorkspace(payload.to_user_id, actor.workspaceId);
        if (!targetMembership) {
          throw new EscalationServiceError(404, "delegate_target_not_found", "找不到要转派的成员。");
        }
      }
      const row = await repository.delegateEscalation({
        escalationId: id,
        toUserId: payload.to_user_id,
        at: now()
      });
      if (!row) {
        throw new EscalationServiceError(409, "escalation_race", "这条升级已经被处理过了。");
      }
      return {
        escalation: {
          id: row.id,
          work_item_id: row.workItemId,
          suggested_lead_user_id: row.suggestedLeadUserId
        },
        attention: {
          summary_text: "已转派升级。"
        }
      };
    },

    async listAttentionItems(input: { actor: AuthActor; locale: WorkHubLocale }) {
      const rows = (await repository.listUnresolvedForWorkspace({
        workspaceId: input.actor.workspaceId,
        limit: 50
      })).filter((row) => workspaceMatches(row, input.actor));
      if (rows.length === 0) {
        return [];
      }
      if (!workItems) {
        return rows.map((row) => buildEscalationAttentionItem(row, input.locale));
      }
      const readable = await workItems.canReadWorkItems({
        workItemIds: [...new Set(rows.map((row) => row.workItemId))],
        actor: input.actor
      });
      return rows
        .filter((row) => readable.has(row.workItemId))
        .map((row) => buildEscalationAttentionItem(row, input.locale));
    }
  };
}
