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
  createAuditLogRepository,
  createWorkspaceMembershipRepository,
  createUserRepository,
  getSharedDatabaseClient,
  type ActionCardRepository,
  type AuditLogRepository,
  type EscalationServiceRow as DbEscalationServiceRow,
  type UserRepository,
  type WorkspaceMembershipRepository
} from "@workhub/db";

import { localizedBudgetActionLabel, localizedBudgetUsageScopeLabel } from "../budget-labels.js";
import { getDefaultStructuredLogger } from "../logging.js";
import type { AuthActor } from "../middleware/auth.js";
import { serviceTf } from "./locales.js";
import { createNotificationService, type NotificationService } from "./notifications.js";
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
  // R23 F-04：canMutateWorkItems 是 Partial——旧夹具（只实现读判定 + assert）照常编译，缺它时按
  // 「拿不准就不发转交动作」降级，不会凭空发一个点了 403 的按钮。
  workItems?: (
    Pick<WorkItemService, "canReadWorkItems" | "assertCanMutateWorkItem">
    & Partial<Pick<WorkItemService, "canMutateWorkItems">>
  ) | false;
  taskDispatcher?: Pick<TaskDispatcher, "dispatch"> | false;
  // B-R9.0-2：非计划升级「让它重试」要真重新入队 agent run。false 仅供纯读测试用。
  runQueue?: Pick<AgentRunQueue, "enqueue"> | false;
  // R12 A2/A3：观察者 decide 类升级 resolve 后回写行动卡条目状态。false 仅供纯读测试用。
  actionCards?: Pick<ActionCardRepository, "transitionItemStatus"> | false;
  // R23 F-04：转交要留痕 + 通知接手人（照审批转交的做法）。两者都是尽力而为的提交后动作：
  // 写失败只告警，不回滚已经落库的转交。false 供纯读/纯逻辑测试拔掉。
  auditLogs?: Pick<AuditLogRepository, "createAuditLog"> | false;
  notifications?: Pick<NotificationService, "createNotification"> | false;
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

// R23 F-04（升级转交端到端）：升级卡此前只发 resolve / 预算动作，POST /api/escalations/:id/delegate
// 与 SDK delegateEscalation 全是零调用的「后端有、前端进不去」。这里补上动作，形状照审批转交
// （packages/permissions/src/approval-routing.ts 的 delegate 动作）：POST + /delegate href，to_user_id
// 由前端选人器带上。**只对有权改这个工单的人发**（见 listAttentionPage 的 canMutateWorkItems）——
// 无权者点下去必 403，那就是个死按钮。
function escalationDelegateAction(
  row: Pick<EscalationServiceRow, "id" | "suggestedLeadUserId">,
  locale: WorkHubLocale
): AttentionItem["actions"][number] {
  const zh = locale === "zh-CN";
  // 已经有牵头人（AI 建议的或上一次转交定的）时说「改派」，否则说「转交」——同一个动作，两种处境。
  const label = row.suggestedLeadUserId
    ? (zh ? "改派他人" : "Reassign")
    : (zh ? "转交他人" : "Hand off");
  return {
    id: "escalation_delegate",
    label,
    style: "secondary",
    method: "POST",
    href: `/api/escalations/${row.id}/delegate`
  };
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

function buildBudgetAttentionItem(
  row: EscalationServiceRow,
  locale: WorkHubLocale,
  options: EscalationAttentionItemOptions = {}
): AttentionItem {
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
    actions: options.canDelegate
      ? [...budgetActions(row, locale), escalationDelegateAction(row, locale)]
      : budgetActions(row, locale),
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
  const usedPct = maxTokens > 0 ? Math.round((totalTokens / maxTokens) * 100) : 0;
  const line = serviceTf(locale, "budgetUsageLine", {
    pct: usedPct,
    used: formatBudgetCny(usedCost),
    max: formatBudgetCny(maxCost),
    left: formatBudgetCny(remainingCost)
  });
  if (locale === "en-US") {
    return label ? `${label}: ${line}` : line;
  }
  return scopeLabel ? `${label}${suffix}：${line}` : line;
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

// R23 F-04：卡片是否带「转交他人」由调用方按 actor 的写权限决定（默认不带——纯渲染用例/旧夹具
// 不会凭空多出一个点了 403 的按钮）。
export type EscalationAttentionItemOptions = { canDelegate?: boolean };

export function buildEscalationAttentionItem(
  row: EscalationServiceRow,
  locale: WorkHubLocale,
  options: EscalationAttentionItemOptions = {}
): AttentionItem {
  if (row.trigger === "budget_exhausted" || row.handoffJson["attention_kind"] === "budget") {
    return buildBudgetAttentionItem(row, locale, options);
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
    actions: options.canDelegate
      ? [...escalationActions(row.id, locale), escalationDelegateAction(row, locale)]
      : escalationActions(row.id, locale),
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

  // R23 F-04：审计/通知同款懒解析——只有真发生一次转交时才构造（它们挂着真 DB / 推送总线）。
  function resolveAuditLogs(): Pick<AuditLogRepository, "createAuditLog"> | undefined {
    if (deps.auditLogs === false) {
      return undefined;
    }
    if (deps.auditLogs) {
      return deps.auditLogs;
    }
    defaultDbClient ??= getSharedDatabaseClient();
    return createAuditLogRepository(defaultDbClient.db);
  }

  function resolveNotifications(): Pick<NotificationService, "createNotification"> | undefined {
    if (deps.notifications === false) {
      return undefined;
    }
    return deps.notifications ?? createNotificationService();
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
    // R23 F-04：转交是写动作——只给能改这个工单的人发按钮（判定与 delegate 端点的 ensureMutableEscalation
    // 同源，见 canMutateWorkItems）。一次批量查询判完整页，不是逐行 assert。
    let mutableWorkItemIds = new Set<string>();
    if (workItems?.canMutateWorkItems && pageRows.length > 0) {
      mutableWorkItemIds = await workItems.canMutateWorkItems({
        workItemIds: [...new Set(pageRows.map((row) => row.workItemId))],
        actor: input.actor
      });
    }
    const actorUserId = input.actor.userId ?? input.actor.id;
    return {
      items: pageRows.map((row) => buildEscalationAttentionItem(row, input.locale, {
        // 被转交到本人名下的升级，本人当然也能再转交出去（与 ensureMutableEscalation 的放行口径一致）。
        canDelegate: mutableWorkItemIds.has(row.workItemId) || row.suggestedLeadUserId === actorUserId
      })),
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
    // R23 F-04：被点名牵头的人（suggested_lead_user_id——AI 建议的负责人，或上一次转交定下的接手人）
    // 也能处理这条升级，哪怕他不是工单的提交人/认领人/协作者。否则「转交」是空转：接手人收到通知、
    // 看得见卡片，但每个动作都 403。仍要求他能读这个工单（工作区栅栏已在 ensureWorkspace 里）。
    const actorUserId = actor.userId ?? actor.id;
    if (row.suggestedLeadUserId && row.suggestedLeadUserId === actorUserId) {
      const readable = await workItems.canReadWorkItems({ workItemIds: [row.workItemId], actor });
      if (readable.has(row.workItemId)) {
        return;
      }
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
      const previousLeadUserId = existing.suggestedLeadUserId;
      const row = await repository.delegateEscalation({
        escalationId: id,
        toUserId: payload.to_user_id,
        workspaceId: actor.workspaceId,
        at: now()
      });
      if (!row) {
        throw new EscalationServiceError(409, "escalation_race", "这条升级已经被处理过了。");
      }
      // R23 F-04：提交后两件尽力而为的事，照审批转交（services/approvals.ts 的 delegate）做——
      // ① 留痕：谁把哪条升级从谁转给了谁；② 通知接手人，否则对方离线就永远不知道这事归他了。
      // 任一失败只告警：转交本身已经落库，不该因为副作用把用户挡在 500 上。
      const auditLogs = resolveAuditLogs();
      if (auditLogs) {
        try {
          await auditLogs.createAuditLog({
            actorKind: actor.kind === "ai" || actor.kind === "system" ? actor.kind : "human",
            actorNickname: actor.label,
            entityType: "escalation_event",
            entityId: row.id,
            action: "escalation.delegated",
            ...(actor.orgId ? { orgId: actor.orgId } : {}),
            ...(actor.workspaceId ? { workspaceId: actor.workspaceId } : {}),
            ...(actor.userId ? { actorUserId: actor.userId } : {}),
            detailJson: {
              escalation_id: row.id,
              work_item_id: row.workItemId,
              from_user_id: previousLeadUserId,
              to_user_id: payload.to_user_id,
              delegated_by_user_id: actor.userId ?? actor.id
            }
          });
        } catch (error) {
          getDefaultStructuredLogger().warn("escalation_delegate_audit_failed", { id, error });
        }
      }
      const notifications = resolveNotifications();
      if (notifications) {
        try {
          const zh = locale !== "en-US";
          await notifications.createNotification({
            userId: payload.to_user_id,
            // 复用升级类通知（通知中心已认得这个类型的分组与文案），不新造一个前端不认识的枚举值。
            type: "workitem.escalated",
            severity: "high",
            title: zh ? `转交给你处理：${row.title}` : `Handed to you: ${row.title}`,
            body: zh
              ? `${actor.label ?? "同事"}把这件卡住的事转给你拿主意。`
              : `${actor.label ?? "A teammate"} handed this stuck item to you for a call.`,
            targetUrl: `/workitems/${row.workItemId}`,
            workItemId: row.workItemId,
            dedupeKey: `escalation_delegated:${row.id}:${payload.to_user_id}`
          });
        } catch (error) {
          getDefaultStructuredLogger().warn("escalation_delegate_notify_failed", { id, error });
        }
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
