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
  createActionCardRepository,
  createAiDecisionRepository,
  createWorkspaceMembershipRepository,
  createUserRepository,
  getSharedDatabaseClient,
  type ActionCardRepository,
  type EscalationServiceRow as DbEscalationServiceRow,
  type UserRepository,
  type WorkspaceMembershipRepository
} from "@workhub/db";

import { localizedBudgetActionLabel, localizedBudgetUsageScopeLabel } from "../budget-labels.js";
import { getDefaultStructuredLogger } from "../logging.js";
import type { AuthActor } from "../middleware/auth.js";
import { getDefaultAgentRunQueue, type AgentRunQueue } from "../workers/agent-runner.js";
import { getDefaultTaskDispatcher, type TaskDispatcher } from "./task-dispatcher.js";
import { getDefaultWorkItemService, WorkItemServiceError, type WorkItemService } from "./work-items.js";

export type EscalationServiceRow = DbEscalationServiceRow;

const ESCALATION_ATTENTION_PAGE_LIMIT = 50;
const ESCALATION_ATTENTION_SCAN_LIMIT = 100;

export type EscalationAttentionPage = {
  items: AttentionItem[];
  page_info: {
    limit: number;
    returned: number;
    has_more: boolean;
  };
};

export type EscalationRepository = {
  findById: (input: { id: string; workspaceId: string }) => Promise<EscalationServiceRow | null>;
  listUnresolvedForWorkspace: (input: { workspaceId: string; limit?: number }) => Promise<EscalationServiceRow[]>;
  resolveEscalation: (input: {
    escalationId: string;
    targetStatus: WorkItemStatus;
    workspaceId: string;
    taskPlanAction?: ResolveEscalationRequest["action"];
    at: Date;
  }) => Promise<EscalationServiceRow | null>;
  resolveBudgetDecision: (input: {
    escalationId: string;
    workspaceId: string;
    actionId: string;
    targetStatus: WorkItemStatus;
    at: Date;
  }) => Promise<EscalationServiceRow | null>;
  reopenEscalation?: (input: {
    escalationId: string;
    targetStatus: WorkItemStatus;
    workspaceId: string;
    at: Date;
  }) => Promise<EscalationServiceRow | null>;
  delegateEscalation: (input: { escalationId: string; toUserId: string; workspaceId: string; at: Date }) => Promise<EscalationServiceRow | null>;
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
  workItems?: Pick<WorkItemService, "canReadWorkItems" | "assertCanMutateWorkItem"> | false;
  taskDispatcher?: Pick<TaskDispatcher, "dispatch"> | false;
  // B-R9.0-2：非计划升级「让它重试」要真重新入队 agent run。false 仅供纯读测试用。
  runQueue?: Pick<AgentRunQueue, "enqueue"> | false;
  // R12 A2/A3：观察者 decide 类升级 resolve 后回写行动卡条目状态。false 仅供纯读测试用。
  actionCards?: Pick<ActionCardRepository, "transitionItemStatus"> | false;
  now?: () => Date;
};

let defaultDbClient: ReturnType<typeof getSharedDatabaseClient> | undefined;

function getDefaultEscalationRepository(): EscalationRepository {
  defaultDbClient ??= getSharedDatabaseClient();
  const repo = createAiDecisionRepository(defaultDbClient.db);
  return {
    findById: (input) => repo.findEscalationById(input),
    listUnresolvedForWorkspace: (input) => repo.listUnresolvedEscalationsForWorkspace(input),
    resolveEscalation: (input) => repo.resolveEscalation(input),
    resolveBudgetDecision: (input) => repo.resolveBudgetDecision(input),
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
  return Boolean(taskPlanIdFromHandoff(row));
}

// R12 功能审查 A2/A3 修复：观察者的 decide 类升级带着 action_card_item_id（conversation-observer.ts
// 写进 handoffJson）。此前从通用升级卡 resolve 后，群聊里的行动卡条目永久停在 waiting_decision，
// 且之后正规 decide 端点因 requireUnresolvedEscalation 前置检查 409 死锁。这里读出该 id 供 resolve
// 后回写条目状态，让两套状态机保持一致。
function actionCardItemIdFromHandoff(row: EscalationServiceRow) {
  if (row.handoffJson["source"] !== "conversation_observer") {
    return null;
  }
  const value = row.handoffJson["action_card_item_id"];
  return typeof value === "string" && value.trim() ? value : null;
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

// 普通用户审查：「已记录预算选择」看不出任务被收尾还是被取消——按动作说人话。
function budgetDecisionSummary(locale: WorkHubLocale, actionId?: string) {
  if (actionId === "add_budget") {
    return locale === "en-US" ? "Budget topped up — the agent team keeps going." : "已追加预算，军团继续执行。";
  }
  if (actionId === "finish_current_output") {
    return locale === "en-US"
      ? "Wrapping up with what's already produced — the task moved to review."
      : "已按现有产出收尾，任务进入验收。";
  }
  if (actionId === "close_scope") {
    return locale === "en-US"
      ? "Closed out — this task was cancelled and AI will not deliver more on it."
      : "已整体收工——这个任务已取消，AI 不会再交付内容。";
  }
  return locale === "en-US" ? "Budget choice recorded." : "已记录预算选择。";
}

function delegateSummary(locale: WorkHubLocale) {
  return locale === "en-US" ? "Delegated to another owner." : "已转派给负责人处理。";
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

type BudgetNoticeHandoffUsage = {
  scope_label?: string;
  period?: "run" | "day" | "month";
  total_tokens?: number;
  max_tokens?: number;
  remaining_tokens?: number;
  estimated_cost_cny?: string;
  max_cost_cny?: string;
  remaining_cost_cny?: string;
  status?: string;
};

type BudgetNoticeHandoff = {
  message?: string;
  recommended_action?: string;
  action_href?: string;
  options?: Array<{ id?: string; label?: string; action_href?: string }>;
  usage?: BudgetNoticeHandoffUsage;
};

function budgetNoticeFromHandoff(row: EscalationServiceRow) {
  const notice = row.handoffJson["notice"];
  return notice && typeof notice === "object" ? notice as BudgetNoticeHandoff : undefined;
}

function isBudgetEscalation(row: EscalationServiceRow) {
  return row.trigger === "budget_exhausted" || row.handoffJson["attention_kind"] === "budget";
}

function availableBudgetActionIds(row: EscalationServiceRow) {
  const notice = budgetNoticeFromHandoff(row);
  const options = Array.isArray(notice?.options) ? notice.options : [];
  return new Set(
    options
      .map((option) => option.id)
      .filter((id): id is string => typeof id === "string" && id.trim().length > 0)
  );
}

const budgetActionTargetStatus = new Map<string, WorkItemStatus>([
  // B-R9.5-3：追加预算继续——repo 层真加预算（工单状态不变，ai_working 仅作合法性占位），
  // service 层随后恢复军团派发。
  ["add_budget", "ai_working"],
  ["finish_current_output", "in_review"],
  ["close_scope", "cancelled"]
]);

function isResolvableBudgetActionId(actionId: string) {
  return budgetActionTargetStatus.has(actionId);
}

function budgetActions(row: EscalationServiceRow, locale: WorkHubLocale): AttentionItem["actions"] {
  const notice = budgetNoticeFromHandoff(row);
  const options = Array.isArray(notice?.options) ? notice.options : [];
  const actions = options
    .filter((option): option is { id: string; label: string; action_href?: string } =>
      Boolean(option.id && option.label)
    )
    .map((option, index) => {
      const style = option.id === notice?.recommended_action || index === 0 ? "primary" as const : "secondary" as const;
      const label = localizedBudgetActionLabel(option.id, option.label, locale);
      if (!isResolvableBudgetActionId(option.id)) {
        return {
          id: option.id,
          label,
          style,
          method: "GET" as const,
          href: option.action_href ?? notice?.action_href ?? "/dashboard/cost"
        };
      }
      return {
        id: option.id,
        label,
        style,
        method: "POST" as const,
        href: `/api/escalations/${row.id}/budget-actions/${encodeURIComponent(option.id)}`
      };
    });
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
  const baseReason = compactText(notice?.message ?? row.reasonMd);
  const usageReason = budgetUsageReason(notice?.usage, locale);
  const reason = compactText([baseReason, usageReason].filter(Boolean).join(zh ? "\n" : "\n"));
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

function budgetUsageReason(
  usage: BudgetNoticeHandoffUsage | undefined,
  locale: WorkHubLocale
) {
  if (!usage || typeof usage !== "object") {
    return "";
  }
  const totalTokens = typeof usage.total_tokens === "number" ? usage.total_tokens : undefined;
  const maxTokens = typeof usage.max_tokens === "number" ? usage.max_tokens : undefined;
  const remainingTokens = typeof usage.remaining_tokens === "number" ? usage.remaining_tokens : undefined;
  const usedCost = typeof usage.estimated_cost_cny === "string" ? usage.estimated_cost_cny : undefined;
  const maxCost = typeof usage.max_cost_cny === "string" ? usage.max_cost_cny : undefined;
  const remainingCost = typeof usage.remaining_cost_cny === "string" ? usage.remaining_cost_cny : undefined;
  if (totalTokens === undefined || maxTokens === undefined || remainingTokens === undefined || !usedCost || !maxCost || !remainingCost) {
    return "";
  }
  const rawScopeLabel = typeof usage.scope_label === "string" && usage.scope_label.trim() ? usage.scope_label.trim() : undefined;
  const period = usage.period === "run" || usage.period === "day" || usage.period === "month" ? usage.period : undefined;
  const localizedScope = localizedBudgetUsageScopeLabel(rawScopeLabel, period, locale);
  const scopeLabel = localizedScope.label;
  const periodLabel = period && !localizedScope.periodIncluded ? budgetPeriodLabel(locale, period) : "";
  const label = [scopeLabel, periodLabel].filter(Boolean).join(locale === "zh-CN" ? "（" : " ");
  const suffix = scopeLabel && periodLabel && locale === "zh-CN" ? "）" : "";
  if (locale === "en-US") {
    const prefix = label ? `${label}: ` : "";
    return `${prefix}used ${totalTokens}/${maxTokens} tokens, cost ${formatBudgetCny(usedCost)}/${formatBudgetCny(maxCost)}, remaining ${remainingTokens} tokens / ${formatBudgetCny(remainingCost)}.`;
  }
  const prefix = scopeLabel ? `${label}${suffix}：` : "";
  return `${prefix}已用 ${totalTokens}/${maxTokens} 令牌，费用 ${formatBudgetCny(usedCost)}/${formatBudgetCny(maxCost)}，剩余 ${remainingTokens} 令牌 / ${formatBudgetCny(remainingCost)}。`;
}

function budgetPeriodLabel(locale: WorkHubLocale, period: "run" | "day" | "month") {
  if (locale === "en-US") {
    if (period === "run") return "run";
    if (period === "day") return "day";
    return "month";
  }
  if (period === "run") return "本次";
  if (period === "day") return "今日";
  return "本月";
}

function formatBudgetCny(value: string) {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) {
    return `¥${value}`;
  }
  const fixed = parsed < 1 && parsed > 0 ? parsed.toFixed(2) : parsed.toFixed(2).replace(/\.00$/u, "").replace(/(\.\d)0$/u, "$1");
  return `¥${fixed}`;
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
  // 懒解析：默认队列挂着真 DB/worker，只有非计划 retry 真正需要时才构造。
  // false 与其他依赖一致=测试显式拔掉该缝隙；生产默认永远接真队列。
  function resolveRunQueue(): Pick<AgentRunQueue, "enqueue"> | undefined {
    if (deps.runQueue === false) {
      return undefined;
    }
    return deps.runQueue ?? getDefaultAgentRunQueue();
  }

  // R12 A2/A3：同款懒解析——只有观察者 decide 类升级 resolve 时才需要回写行动卡条目。
  function resolveActionCards(): Pick<ActionCardRepository, "transitionItemStatus"> | undefined {
    if (deps.actionCards === false) {
      return undefined;
    }
    if (deps.actionCards) {
      return deps.actionCards;
    }
    defaultDbClient ??= getSharedDatabaseClient();
    return createActionCardRepository(defaultDbClient.db);
  }

  async function listAttentionPage(input: { actor: AuthActor; locale: WorkHubLocale }): Promise<EscalationAttentionPage> {
    const fetchedRows = await repository.listUnresolvedForWorkspace({
      workspaceId: input.actor.workspaceId,
      limit: ESCALATION_ATTENTION_SCAN_LIMIT + 1
    });
    const workspaceRows = fetchedRows.filter((row) => workspaceMatches(row, input.actor));
    const scanCapped = workspaceRows.length > ESCALATION_ATTENTION_SCAN_LIMIT;
    const scanRows = workspaceRows.slice(0, ESCALATION_ATTENTION_SCAN_LIMIT);
    let readableRows = scanRows;
    if (workItems && scanRows.length > 0) {
      const readable = await workItems.canReadWorkItems({
        workItemIds: [...new Set(scanRows.map((row) => row.workItemId))],
        actor: input.actor
      });
      readableRows = scanRows.filter((row) => readable.has(row.workItemId));
    }
    const pageRows = readableRows.slice(0, ESCALATION_ATTENTION_PAGE_LIMIT);
    return {
      items: pageRows.map((row) => buildEscalationAttentionItem(row, input.locale)),
      page_info: {
        limit: ESCALATION_ATTENTION_PAGE_LIMIT,
        returned: pageRows.length,
        has_more: scanCapped || readableRows.length > ESCALATION_ATTENTION_PAGE_LIMIT
      }
    };
  }

  async function ensureReadableEscalation(row: EscalationServiceRow, actor: AuthActor) {
    ensureWorkspace(row, actor);
    if (!workItems) {
      return;
    }
    const readable = await workItems.canReadWorkItems({
      workItemIds: [row.workItemId],
      actor
    });
    if (!readable.has(row.workItemId)) {
      throw new EscalationServiceError(403, "forbidden", "你没有权限处理这条升级。");
    }
  }

  // B-R9.0-1（branch-review 越权洞）：resolve/delegate/预算决定都是写动作，必须按工作项
  // 写权限收口（对齐 approvals/work-items 的 mutate 判定：owner/提交人/认领人/协作 assignment/admin）。
  // canRead 只够展示卡片，不构成「替这个工单拍板」的授权。
  async function ensureMutableEscalation(row: EscalationServiceRow, actor: AuthActor) {
    ensureWorkspace(row, actor);
    if (!workItems) {
      return;
    }
    try {
      await workItems.assertCanMutateWorkItem({ workItemId: row.workItemId, actor });
    } catch (error) {
      if (error instanceof WorkItemServiceError && (error.status === 403 || error.status === 404)) {
        throw new EscalationServiceError(403, "forbidden", "你没有权限处理这条升级。");
      }
      throw error;
    }
  }

  return {
    // API-06：input 收原始 body（unknown），schema 解析放到鉴权之后——
    // 未授权者发畸形 body 应拿 403/404，而不是泄露契约的 422。
    async resolve(id: string, actor: AuthActor, input: unknown, locale: WorkHubLocale = "zh-CN") {
      const existing = await repository.findById({ id, workspaceId: actor.workspaceId });
      if (!existing) {
        throw new EscalationServiceError(404, "escalation_not_found", "没有找到这条升级。");
      }
      await ensureMutableEscalation(existing, actor);
      const payload = resolveEscalationRequestSchema.parse(input);
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
      // R12 A2/A3：观察者 decide 类升级从通用卡 resolve 后，回写群聊行动卡条目状态——
      // 否则聊天里那张卡永久停在「待拍板」，且正规 decide 端点被 requireUnresolvedEscalation 409 死锁。
      // 映射：转成我来做→running(记到操作者名下)；取消→dismissed；让它重试→running(AI 再试)。
      // best-effort：升级/工单状态已是权威结果，条目回写失败只告警不回滚（transitionItemStatus 返回
      // null=条目已被别的路径处理，天然幂等，不算失败）。
      const actionCardItemId = actionCardItemIdFromHandoff(existing);
      if (actionCardItemId) {
        const actionCardsRepo = resolveActionCards();
        if (actionCardsRepo) {
          try {
            await actionCardsRepo.transitionItemStatus({
              itemId: actionCardItemId,
              workspaceId: actor.workspaceId,
              fromStatuses: ["waiting_decision"],
              toStatus: payload.action === "cancel" ? "dismissed" : "running",
              ...(payload.action === "pm_mode" && actor.userId ? { assigneeUserId: actor.userId } : {}),
              at: now()
            });
          } catch (error) {
            getDefaultStructuredLogger().warn("escalation_action_card_backflow_failed", {
              escalationId: id,
              actionCardItemId,
              error
            });
          }
        }
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
          throw new EscalationServiceError(503, "task_dispatch_retry_failed", "重试执行失败，请稍后再试。");
        }
      } else if (payload.action === "retry") {
        // B-R9.0-2（branch-review 假接线）：非计划升级的「让它重试」原先只把工单翻回
        // ai_working，没有任何执行体接手——卡片说"已让它重试"是空话。这里真重新入队
        // 一个 agent run；入队失败则重开升级并如实报错，不留"看起来在跑"的死状态。
        const runQueue = resolveRunQueue();
        if (runQueue) {
          try {
            await runQueue.enqueue({
              workItemId: existing.workItemId,
              actorId: actor.userId ?? actor.id,
              workspaceId: actor.workspaceId,
              ...(actor.orgId ? { orgId: actor.orgId } : {}),
              title: existing.title
            });
          } catch {
            await repository.reopenEscalation?.({
              escalationId: id,
              targetStatus: "escalated",
              workspaceId: actor.workspaceId,
              at: now()
            });
            throw new EscalationServiceError(503, "agent_run_retry_failed", "重试执行失败，请稍后再试。");
          }
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
          summary_text: actionSummary(payload.action, locale)
        }
      };
    },

    async resolveBudgetDecision(id: string, actor: AuthActor, actionId: string, locale: WorkHubLocale = "zh-CN") {
      const normalizedActionId = actionId.trim();
      const existing = await repository.findById({ id, workspaceId: actor.workspaceId });
      if (!existing) {
        throw new EscalationServiceError(404, "escalation_not_found", "没有找到这条升级。");
      }
      await ensureMutableEscalation(existing, actor);
      if (!isBudgetEscalation(existing)) {
        throw new EscalationServiceError(422, "budget_action_not_available", "这条预算选择已经不可用。");
      }
      if (!normalizedActionId || normalizedActionId.length > 64 || !availableBudgetActionIds(existing).has(normalizedActionId)) {
        throw new EscalationServiceError(422, "budget_action_not_available", "这条预算选择已经不可用。");
      }
      if (!isResolvableBudgetActionId(normalizedActionId)) {
        throw new EscalationServiceError(422, "budget_action_requires_budget_update", "请先在预算页完成对应调整。");
      }
      const row = await repository.resolveBudgetDecision({
        escalationId: id,
        workspaceId: actor.workspaceId,
        actionId: normalizedActionId,
        targetStatus: budgetActionTargetStatus.get(normalizedActionId)!,
        at: now()
      });
      if (!row) {
        throw new EscalationServiceError(409, "escalation_race", "这条升级已经被处理过了。");
      }
      // B-R9.5-3：预算已在 repo 事务里真加——现在恢复军团派发；派发失败重开升级卡
      // 如实报错（预算保留提额，重试只需再点一次）。
      const budgetPlanId = taskPlanIdFromHandoff(existing);
      if (normalizedActionId === "add_budget" && budgetPlanId) {
        try {
          await (injectedTaskDispatcher ?? defaultTaskDispatcher()).dispatch({
            planId: budgetPlanId,
            workspaceId: actor.workspaceId,
            orgId: actor.orgId,
            ...(actor.userId ? { actorId: actor.userId } : {})
          });
        } catch {
          await repository.reopenEscalation?.({
            escalationId: id,
            targetStatus: row.workItemStatus,
            workspaceId: actor.workspaceId,
            at: now()
          });
          throw new EscalationServiceError(503, "task_dispatch_retry_failed", "预算已追加，但恢复执行失败，请稍后再点一次。");
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
          summary_text: budgetDecisionSummary(locale, normalizedActionId)
        }
      };
    },

    async delegate(id: string, actor: AuthActor, input: unknown, locale: WorkHubLocale = "zh-CN") {
      const existing = await repository.findById({ id, workspaceId: actor.workspaceId });
      if (!existing) {
        throw new EscalationServiceError(404, "escalation_not_found", "没有找到这条升级。");
      }
      // API-06：同 resolve——鉴权先于 schema 解析。
      await ensureMutableEscalation(existing, actor);
      const payload = delegateEscalationRequestSchema.parse(input);
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
        workspaceId: actor.workspaceId,
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
          summary_text: delegateSummary(locale)
        }
      };
    },

    async listAttentionPage(input: { actor: AuthActor; locale: WorkHubLocale }) {
      return listAttentionPage(input);
    },

    async listAttentionItems(input: { actor: AuthActor; locale: WorkHubLocale }) {
      return (await listAttentionPage(input)).items;
    }
  };
}
