import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";

import { settings, type Settings } from "@workhub/config";
import { decideRunBudget, type BudgetPolicyStore, type CostLedgerStore } from "@workhub/cost";
import {
  normalizeWorkHubLocale,
  type AgentArmyDashboardVM,
  type ApprovalCenterVM,
  type AttentionHomeVM,
  type CalendarPageVM,
  type MeetingPageVM,
  type NotificationPageVM,
  type ProjectHealthPageVM,
  type ApprovalRequest,
  type TeamSkillCurationStatusVM,
  type WorkHubLocale
} from "@workhub/contracts";

import {
  createCurrentUserMiddleware,
  getAuthSettings,
  getDefaultAuthDependencies,
  resolveAuthDependencies,
  type AuthDependencySource,
  type AuthEnv
} from "../middleware/auth.js";
import {
  createAiFeedbackRepository,
  createObjectiveRepository,
  createProposalRepository,
  createTaskPlanRepository,
  createTeamSkillRepository,
  createWorkItemRepository,
  getSharedDatabaseClient,
  listCostByAssigneeForWorkspace,
  type AiFeedbackRepository,
  type ObjectiveRepository,
  type ProposalRepository,
  type TeamSkillRepository
} from "@workhub/db";

import { isUuidParam } from "./uuid-param.js";
import { serviceT } from "../services/locales.js";

import { buildAttentionHomePage } from "../pages/attention.js";
import { buildAgentArmyDashboardPage } from "../pages/agent-army.js";
import { getDefaultAiWorklogMetricsService, type AiWorklogMetricsService } from "../services/ai-worklog-metrics.js";
import { buildCostDashboardPage, type AssigneeCostInputRow } from "../pages/cost.js";
import { buildTeamSkillsPage } from "../pages/team-skills.js";
import { buildP05GoldPathSurfacePage } from "../pages/gold-path.js";
import { buildProposalDetailPage, buildProposalReviewAttentionItem } from "../pages/proposals.js";
import { buildSettingsPage } from "../pages/settings.js";
import { checkReadiness, type ReadinessResult } from "../readiness.js";
import {
  DrivePageServiceError,
  getDefaultDrivePageService,
  type DrivePageService
} from "../services/drive-pages.js";
import {
  getDefaultProjectHomePageService,
  ProjectHomePageServiceError,
  type ProjectHomePageService
} from "../services/project-home-pages.js";
import {
  getDefaultProjectTimelinePageService,
  ProjectTimelinePageServiceError,
  type ProjectTimelinePageService
} from "../services/project-timeline-pages.js";
import {
  getDefaultWorkbenchPageService,
  WorkbenchPageServiceError,
  type WorkbenchPageService
} from "../services/workbench-pages.js";
import {
  getDefaultMeetingPageService,
  MeetingPageServiceError,
  type MeetingPageService
} from "../services/meeting-pages.js";
import {
  createScheduleNotifyPageService,
  ScheduleNotifyPageServiceError,
  type ScheduleNotifyPageService
} from "../services/schedule-notify-pages.js";
import {
  createProjectHealthPageService,
  type ProjectHealthPageService
} from "../services/project-health-pages.js";
import {
  createApprovalService,
  toPermissionPolicyResponse,
  type ApprovalService
} from "../services/approvals.js";
import {
  createEscalationService,
  type EscalationAttentionPage,
  type EscalationService
} from "../services/escalations.js";
import {
  createMemoryConflictService,
  type MemoryConflictService
} from "../services/memory-conflicts.js";
import {
  getDefaultProposalService,
  type ProposalService
} from "../services/proposals.js";
import {
  getDefaultWorkItemService,
  WorkItemServiceError,
  type WorkItemService
} from "../services/work-items.js";
import {
  getDefaultAgentRunQueue,
  type AgentRunQueue
} from "../workers/agent-runner.js";
import {
  peekSkillCurationRunState,
  skillCurationAvailability
} from "../workers/agent-skill-curation.js";
import { getDefaultCostLedgerStore } from "../services/cost-ledger-store.js";
import { getDefaultPluginService, type PluginService } from "../services/plugins.js";
import { getDefaultMcpServerService, type McpServerService } from "../services/mcp-servers.js";
import { getDefaultBudgetPolicyStore } from "../services/cost-policy-store.js";

export type PageRoutesDependencies = {
  auth?: AuthDependencySource;
  approvals?: ApprovalService;
  // R24-P 阶段 1：设置页的只读插件清单（仅管理员）。懒解析——不注入时推迟到真有管理员请求
  // 设置页才建默认服务，路由工厂本身不建 DB 连接。
  plugins?: Pick<PluginService, "list">;
  // R26 M8：设置页的只读 MCP 服务器清单（仅管理员）。懒解析同 plugins——路由工厂本身不建连接。
  mcpServers?: Pick<McpServerService, "list">;
  escalations?: EscalationService;
  memoryConflicts?: Pick<MemoryConflictService, "listAttentionItems">;
  proposals?: ProposalService;
  // R14 批 FEEDBACK：提议详情页读聚合——本人对这个提议的现状（只读自己，见设计 §4.2）。
  aiFeedback?: Pick<AiFeedbackRepository, "getForSubject">;
  queue?: AgentRunQueue;
  policyStore?: BudgetPolicyStore;
  ledgerStore?: CostLedgerStore;
  workItems?: WorkItemService;
  drivePages?: DrivePageService;
  projectHomePages?: ProjectHomePageService;
  projectTimelinePages?: ProjectTimelinePageService;
  workbenchPages?: WorkbenchPageService;
  meetingPages?: MeetingPageService;
  scheduleNotifyPages?: ScheduleNotifyPageService;
  projectHealthPages?: ProjectHealthPageService;
  aiWorklog?: AiWorklogMetricsService;
  readiness?: (runtimeSettings: Settings) => Promise<ReadinessResult>;
  teamSkills?: Pick<TeamSkillRepository, "listActive">;
  // R23 SA-06：技能页的「AI 夜间自学」状态源。默认直接读 worker 侧真值（只看不建调度器）；
  // 注入点仅供测试替身。
  skillCuration?: () => TeamSkillCurationStatusVM;
  taskPlans?: Pick<ReturnType<typeof createTaskPlanRepository>, "listDashboardPlans" | "listPlanMetaByIds">;
  objectives?: Pick<ObjectiveRepository, "listObjectiveTitlesByIds">;
  // R13 批 P4：KPI「AI 自动合并数/占比」的计数来源（reviews 表 ai actor 的今日通过评审计数）。
  proposalMergeStats?: Pick<ProposalRepository, "countTodayMergeReviewsByActorKind">;
  // R13 批 P4：labor-split 按 assignee 记账的一次性 SQL 聚合读——注入点仅供测试替身，
  // 生产默认直接调 packages/db 的 listCostByAssigneeForWorkspace。
  assigneeCostReader?: (input: { teamId: string; sinceBucket?: string; limit?: number }) => Promise<AssigneeCostInputRow[]>;
  // 成本页「按任务分账」的人话标签（编号 · 标题）：注入点仅供测试替身，生产默认直连 packages/db 一次批量取数。
  workItemLabelReader?: (input: { workspaceId: string; workItemIds: string[] }) => Promise<Map<string, string>>;
  agentArmyDashboard?: {
    page: (input: {
      actor: AuthEnv["Variables"]["actor"];
      currentUser: AuthEnv["Variables"]["currentUser"];
      locale: WorkHubLocale;
    }) => Promise<AgentArmyDashboardVM>;
  };
  allowUnauthenticatedGoldPath?: boolean;
};

// R23 SA-06：技能页的「AI 夜间自学」状态默认取数——只读 worker 侧现状，绝不在这里把调度器建出来
// （页面渲染不该有副作用）。本进程还没跑过就诚实回 running:false / last_run_at:null。
function defaultSkillCurationStatus(): TeamSkillCurationStatusVM {
  const runState = peekSkillCurationRunState();
  return {
    enabled: skillCurationAvailability().enabled,
    running: runState.running,
    last_run_at: runState.lastRunAt
  };
}

const AGENT_DASHBOARD_PUBLIC_PLAN_LIMIT = 20;
const AGENT_DASHBOARD_VISIBILITY_CANDIDATE_LIMIT = 50;

function requestLocale(c: { req: { query: (key: string) => string | undefined; header: (key: string) => string | undefined } }): WorkHubLocale {
  return normalizeWorkHubLocale(c.req.query("locale") ?? c.req.header("Accept-Language"));
}

function nonnegativeIntQuery(c: { req: { query: (key: string) => string | undefined } }, key: string): number | undefined {
  const raw = c.req.query(key);
  if (raw === undefined) {
    return undefined;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return undefined;
  }
  return parsed;
}

function positiveIntQuery(c: { req: { query: (key: string) => string | undefined } }, key: string): number | undefined {
  const parsed = nonnegativeIntQuery(c, key);
  return parsed && parsed > 0 ? parsed : undefined;
}

function approvalPageQuery(c: { req: { query: (key: string) => string | undefined } }) {
  const offset = nonnegativeIntQuery(c, "offset");
  const limit = positiveIntQuery(c, "limit");
  return {
    ...(offset === undefined ? {} : { offset }),
    ...(limit === undefined ? {} : { limit })
  };
}

// findings[#74/#80]：管理员成本看板的时间窗口（天）。窗口内的账目走 period_bucket 索引下推，避免每次
// 加载都全表扫描 cost_ledger_entries、也把 trend 桶数封顶。窗口外的历史不在看板展示（按需另查累计）。
const COST_DASHBOARD_WINDOW_DAYS = 90;

function costDashboardSinceBucket(now: Date): string {
  const cutoff = new Date(now.getTime() - COST_DASHBOARD_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  return cutoff.toISOString().slice(0, 10);
}

function settingsForActor(actor: AuthEnv["Variables"]["actor"]) {
  return {
    ...settings,
    auth: {
      ...settings.auth,
      defaultOrgId: actor.orgId,
      defaultWorkspaceId: actor.workspaceId
    }
  };
}

function pageEnvelope<T>(data: T, locale: WorkHubLocale) {
  return {
    ok: true,
    data,
    meta: {
      locale
    }
  } as const;
}

function pageServiceErrorResponse(
  c: Context<AuthEnv>,
  error: { status: number; code: string; message: string }
) {
  return c.json({
    ok: false,
    error: {
      code: error.code,
      message: error.message
    }
  }, error.status as 400);
}

// routes-a-2/routes-b-1/services-a-2/xlink-authz-4/ux-web-govern-6：可见性判定改用轻量批量接口
// （workItems.canReadWorkItems，一次 IN 查询 access record，不构建整页 detailPage VM），而不是逐次
// 完整装配工作项详情只为拿一个 boolean。单个 workItemId 时退化成一个只含 1 个元素的批量调用。
async function canReadWorkItem(
  workItems: Pick<WorkItemService, "canReadWorkItems">,
  workItemId: string | undefined,
  actor: AuthEnv["Variables"]["actor"]
) {
  if (!workItemId) {
    return true;
  }
  const visible = await workItems.canReadWorkItems({ workItemIds: [workItemId], actor });
  return visible.has(workItemId);
}

// routes-b-1/xlink-authz-4：`alreadyFiltered` skips the redundant per-row detailPage re-check when the caller
// already injected the identical canReadWorkItem predicate into approvals.listPendingForUser (the /approvals
// route below does; /attention's decisionQueue does not, so it still needs this filter for real).
async function visibleApprovalCenter(
  data: ApprovalCenterVM,
  workItems: Pick<WorkItemService, "canReadWorkItems">,
  actor: AuthEnv["Variables"]["actor"],
  alreadyFiltered = false
) {
  const visibleRequests: ApprovalRequest[] = [];
  const visibleRequestIds = new Set<string>();
  // routes-b-1：按 work_item_id 去重的可见性缓存，避免同一工作项的多条审批重复 detailPage
  // （即便 alreadyFiltered=false 也只判一次；此前这里没有缓存，是双重 N+1 的第二层）。
  const workItemVisibility = new Map<string, boolean>();
  for (const request of data.requests) {
    if (alreadyFiltered) {
      visibleRequests.push(request);
      visibleRequestIds.add(request.id);
      continue;
    }
    const cacheKey = request.work_item_id ?? "";
    let allowed = workItemVisibility.get(cacheKey);
    if (allowed === undefined) {
      allowed = await canReadWorkItem(workItems, request.work_item_id, actor);
      workItemVisibility.set(cacheKey, allowed);
    }
    if (allowed) {
      visibleRequests.push(request);
      visibleRequestIds.add(request.id);
    }
  }
  const visibleItems = data.items.filter((item) => {
    const id = item.source_ref.entity_type === "approval_request" ? item.source_ref.entity_id : item.id;
    return visibleRequestIds.has(id);
  });
  // findings[H7]：items_detail 也要按可见 item.id 收口——否则 GET /api/pages/approvals 会把不可读事项的
  // 详情（ai_reason/风险/payload）原样回传（此前只过滤了 items/requests 却 `...data` 带出整张 items_detail）。
  // 与 routes/approvals.ts 的同名 helper 对齐。
  const visibleItemIds = new Set(visibleItems.map((item) => item.id));
  const pageInfo = data.page_info
    ? { ...data.page_info, returned: visibleRequests.length }
    : undefined;
  return {
    ...data,
    items: visibleItems,
    items_detail: Object.fromEntries(
      Object.entries(data.items_detail).filter(([itemId]) => visibleItemIds.has(itemId))
    ),
    requests: visibleRequests,
    ...(pageInfo ? { page_info: pageInfo } : {}),
    counts: {
      ...data.counts,
      pending: visibleRequests.length
    }
  };
}

export function createPageRoutes(deps: PageRoutesDependencies = {}) {
  const routes = new Hono<AuthEnv>();
  const authSource = deps.auth ?? getDefaultAuthDependencies;
  const authSettings = getAuthSettings(resolveAuthDependencies(authSource));
  const allowUnauthenticatedGoldPath = deps.allowUnauthenticatedGoldPath ?? authSettings.appEnv !== "production";
  const approvals = deps.approvals ?? createApprovalService();
  let pluginsService: Pick<PluginService, "list"> | undefined = deps.plugins;
  const plugins = () => (pluginsService ??= getDefaultPluginService());
  let mcpServersService: Pick<McpServerService, "list"> | undefined = deps.mcpServers;
  const mcpServers = () => (mcpServersService ??= getDefaultMcpServerService());
  const escalations = deps.escalations ?? createEscalationService();
  const memoryConflicts = deps.memoryConflicts ?? createMemoryConflictService();
  const proposals = deps.proposals ?? getDefaultProposalService();
  const aiFeedback = deps.aiFeedback ?? createAiFeedbackRepository(getSharedDatabaseClient().db);
  const queue = deps.queue ?? getDefaultAgentRunQueue();
  const policyStore = deps.policyStore ?? getDefaultBudgetPolicyStore();
  const ledgerStore = deps.ledgerStore ?? getDefaultCostLedgerStore();
  const workItems = deps.workItems ?? getDefaultWorkItemService();
  const drivePages = deps.drivePages ?? getDefaultDrivePageService();
  const projectHomePages = deps.projectHomePages ?? getDefaultProjectHomePageService();
  const projectTimelinePages = deps.projectTimelinePages ?? getDefaultProjectTimelinePageService();
  const workbenchPages = deps.workbenchPages ?? getDefaultWorkbenchPageService();
  const meetingPages = deps.meetingPages ?? getDefaultMeetingPageService();
  const scheduleNotifyPages = deps.scheduleNotifyPages ?? createScheduleNotifyPageService();
  const projectHealthPages = deps.projectHealthPages ?? createProjectHealthPageService();
  const aiWorklog = deps.aiWorklog ?? getDefaultAiWorklogMetricsService();
  const readiness = deps.readiness ?? checkReadiness;
  const teamSkills = deps.teamSkills ?? createTeamSkillRepository(getSharedDatabaseClient().db);
  const skillCuration = deps.skillCuration ?? defaultSkillCurationStatus;
  const taskPlans = deps.taskPlans ?? createTaskPlanRepository(getSharedDatabaseClient().db);
  const objectives = deps.objectives ?? createObjectiveRepository(getSharedDatabaseClient().db);
  // R13 批 P4：KPI「AI 自动合并数/占比」+ labor-split 按 assignee 记账，均只读、均照 taskPlans/objectives
  // 同款「未注入则直连共享 DB 客户端」惯例——不新增服务层，直接用 packages/db 的仓库/查询函数。
  const proposalMergeStats = deps.proposalMergeStats ?? createProposalRepository(getSharedDatabaseClient().db);
  const assigneeCostReader = deps.assigneeCostReader
    ?? ((input: { teamId: string; sinceBucket?: string; limit?: number }) =>
      listCostByAssigneeForWorkspace(getSharedDatabaseClient().db, input));
  const workItemLabelReader = deps.workItemLabelReader
    ?? (async (input: { workspaceId: string; workItemIds: string[] }) => {
      const rows = await createWorkItemRepository(getSharedDatabaseClient().db).listWorkItemLabelsByIds(input);
      return new Map(rows.map((row) => [row.id, row.title ? `${row.code} · ${row.title}` : row.code]));
    });

  type DashboardSourceWarning = NonNullable<AgentArmyDashboardVM["source_warnings"]>[number];
  type DashboardSourceWarnings = DashboardSourceWarning[];

  function dashboardSourceWarning(source: DashboardSourceWarning["source"], locale: WorkHubLocale): DashboardSourceWarning {
    const messages: Record<DashboardSourceWarning["source"], { en: string; zh: string }> = {
      escalations: {
        en: "Escalations could not be loaded. Open Attention or retry.",
        zh: "升级待办暂时加载失败。请打开决策收件箱或稍后重试。"
      },
      sync_conflicts: {
        en: "Memory conflicts could not be loaded. Open Settings or retry.",
        zh: "记忆冲突暂时加载失败。请打开设置或稍后重试。"
      },
      approvals: {
        en: "Approval decisions could not be loaded. Open Approvals or retry.",
        zh: "审批待办暂时加载失败。请打开审批页或稍后重试。"
      },
      proposals: {
        en: "Proposal reviews could not be loaded. Open Attention or retry.",
        zh: "变更评审暂时加载失败。请打开决策收件箱或稍后重试。"
      },
      worklog: {
        en: "Autonomy metrics could not be loaded — the 0% shown is missing data, not a real rate.",
        zh: "自主率数据暂时加载失败——显示的 0% 是缺数据，不是真实通过率。"
      }
    };
    const message = messages[source];
    return {
      source,
      message: locale === "en-US" ? message.en : message.zh
    };
  }

  function escalationCapWarning(locale: WorkHubLocale) {
    return {
      source: "escalations" as const,
      message: locale === "en-US"
        ? "Escalation decisions exceeded the visible scan cap; this queue is a lower bound."
        : "升级待办超过可见扫描上限；这里显示的是可见下限。"
    };
  }

  async function listEscalationAttentionPage(input: {
    actor: AuthEnv["Variables"]["actor"];
    locale: WorkHubLocale;
  }): Promise<EscalationAttentionPage> {
    if ("listAttentionPage" in escalations && typeof escalations.listAttentionPage === "function") {
      return escalations.listAttentionPage(input);
    }
    const items = await escalations.listAttentionItems(input);
    return {
      items,
      page_info: {
        limit: items.length,
        returned: items.length,
        has_more: false
      }
    };
  }

  function dashboardSourceLowerBoundWarning(locale: WorkHubLocale): DashboardSourceWarning {
    return {
      source: "approvals",
      message: locale === "en-US"
        ? "Approval decisions exceeded the dashboard scan cap; this KPI shows a visible lower bound. Open Approvals to review everything."
        : "审批待办超过仪表盘扫描上限；这里显示的是可见下限，请打开审批页查看全部。"
    };
  }

  async function attentionDecisionSummary(input: {
    actor: AuthEnv["Variables"]["actor"];
    currentUser: AuthEnv["Variables"]["currentUser"];
    locale: WorkHubLocale;
  }) {
    let count = 0;
    const sourceWarnings: DashboardSourceWarnings = [];
    try {
      const escalationPage = await listEscalationAttentionPage({ actor: input.actor, locale: input.locale });
      count += escalationPage.items.length;
      if (escalationPage.page_info.has_more) {
        sourceWarnings.push(escalationCapWarning(input.locale));
      }
    } catch {
      sourceWarnings.push(dashboardSourceWarning("escalations", input.locale));
    }
    try {
      count += (await memoryConflicts.listAttentionItems({ actor: input.actor, locale: input.locale })).length;
    } catch {
      sourceWarnings.push(dashboardSourceWarning("sync_conflicts", input.locale));
    }
    try {
      const pending = await approvals.listPendingForUser(input.currentUser, {
        locale: input.locale,
        canReadWorkItem: (workItemId) => canReadWorkItem(workItems, workItemId, input.actor)
      });
      const visiblePending = await visibleApprovalCenter(pending, workItems, input.actor, true);
      const visibleCount = Math.max(visiblePending.items.length, visiblePending.requests.length);
      const lowerBoundTotal = pending.counts.pending_total;
      count += typeof lowerBoundTotal === "number"
        ? Math.max(visibleCount, lowerBoundTotal)
        : visibleCount;
      if (pending.counts.pending_total_capped === 1) {
        sourceWarnings.push(dashboardSourceLowerBoundWarning(input.locale));
      }
    } catch {
      sourceWarnings.push(dashboardSourceWarning("approvals", input.locale));
    }
    try {
      count += (await proposals.listReviewableForUser({
        user: {
          id: input.currentUser.id,
          isAdmin: input.currentUser.isAdmin,
          workspaceId: input.actor.workspaceId
        }
      })).length;
    } catch {
      sourceWarnings.push(dashboardSourceWarning("proposals", input.locale));
    }
    return { count, sourceWarnings };
  }

  async function ledgerEntriesForActor(input: {
    actor: AuthEnv["Variables"]["actor"];
    currentUser: AuthEnv["Variables"]["currentUser"];
  }) {
    const teamId = input.actor.workspaceId;
    const sinceBucket = costDashboardSinceBucket(new Date());
    if (input.currentUser.isAdmin) {
      return ledgerStore.listEntriesForWorkspace
        ? ledgerStore.listEntriesForWorkspace(teamId, { sinceBucket })
        : ledgerStore.listEntriesForScopes
          ? ledgerStore.listEntriesForScopes({ teamId }, { sinceBucket })
          : [];
    }
    return ledgerStore.listEntriesForScopes
      ? ledgerStore.listEntriesForScopes({ userId: input.currentUser.id, teamId }, { sinceBucket })
      : [];
  }

  const agentArmyDashboard = deps.agentArmyDashboard ?? {
    async page(input: {
      actor: AuthEnv["Variables"]["actor"];
      currentUser: AuthEnv["Variables"]["currentUser"];
      locale: WorkHubLocale;
    }) {
      const rows = await taskPlans.listDashboardPlans({
        workspaceId: input.actor.workspaceId,
        planLimit: AGENT_DASHBOARD_VISIBILITY_CANDIDATE_LIMIT
      });
      const visibleWorkItems = await workItems.canReadWorkItems({
        workItemIds: rows.plans.map((row) => row.workItem.id),
        actor: input.actor
      });
      const visiblePlanCandidates = rows.plans.filter((row) => visibleWorkItems.has(row.workItem.id));
      const visiblePlans = visiblePlanCandidates.slice(0, AGENT_DASHBOARD_PUBLIC_PLAN_LIMIT);
      const visiblePlanIds = new Set(visiblePlans.map((row) => row.plan.id));
      const visibleWorkItemIds = new Set(visiblePlans.map((row) => row.workItem.id));
      let worklog: Awaited<ReturnType<AiWorklogMetricsService["getTodayMetrics"]>> | undefined;
      try {
        worklog = await aiWorklog.getTodayMetrics({ workspaceId: input.actor.workspaceId });
      } catch {
        worklog = undefined;
      }
      const attention = await attentionDecisionSummary(input);
      // B-R9.6（KPI 真源）：「复核通过率」优先取今日 AI 判官审阅结果；当天没有判官
      // 审阅时回退 run 成功率（旧口径），不再拿成功率冒充通过率。
      let reviewOutcomes: { total: number; approved: number } | undefined;
      try {
        reviewOutcomes = await proposals.countTodayAiReviewOutcomes({
          workspaceId: input.actor.workspaceId
        });
      } catch {
        reviewOutcomes = undefined;
      }
      const autonomyRatePct =
        reviewOutcomes && reviewOutcomes.total > 0
          ? Math.round((reviewOutcomes.approved / reviewOutcomes.total) * 100)
          : (worklog?.autonomy_rate ?? 0);
      // UX-M14：判官源与回退源双双失败时不许把 0% 当真数据端出去——挂 worklog 源警告。
      const kpiWarnings = reviewOutcomes === undefined && worklog === undefined
        ? [...attention.sourceWarnings, dashboardSourceWarning("worklog", input.locale)]
        : attention.sourceWarnings;
      // R13 批 P4（KPI：AI 自动合并数/占比）：与 cost 页同源同口径，同样只对管理员取
      // （暴露的是同组织的评审活动，与 cost 页 by_assignee 同一门槛，两页应给出一致的可见性）。
      let aiAutoMergeCounts: { total: number; aiApproved: number } | undefined;
      if (input.currentUser.isAdmin) {
        try {
          aiAutoMergeCounts = await proposalMergeStats.countTodayMergeReviewsByActorKind({
            workspaceId: input.actor.workspaceId
          });
        } catch {
          aiAutoMergeCounts = undefined;
        }
      }
      return buildAgentArmyDashboardPage({
        locale: input.locale,
        attentionCount: attention.count,
        isAdmin: input.currentUser.isAdmin,
        sourceWarnings: kpiWarnings,
        autonomyRatePct,
        ...(aiAutoMergeCounts ? { aiAutoMergeCounts } : {}),
        plans: visiblePlans,
        items: rows.items.filter((item) => visiblePlanIds.has(item.planId)),
        runs: rows.runs.filter((run) => run.taskPlanId ? visiblePlanIds.has(run.taskPlanId) : false),
        escalations: rows.escalations.filter((escalation) => visibleWorkItemIds.has(escalation.workItemId)),
        ledgerEntries: await ledgerEntriesForActor(input),
        pageInfo: {
          planLimit: AGENT_DASHBOARD_PUBLIC_PLAN_LIMIT,
          plansCapped: rows.plansCapped || visiblePlanCandidates.length > AGENT_DASHBOARD_PUBLIC_PLAN_LIMIT,
          itemsCapped: rows.itemsCapped,
          runsCapped: rows.runsCapped,
          escalationLimit: 5,
          escalationsCapped: rows.escalationsCapped
        }
      });
    }
  };

  routes.get("/attention", createCurrentUserMiddleware(authSource), async (c) => {
    const locale = requestLocale(c);
    // 只展示请求者当前工作区里的在跑 AI：管理员看本工作区全部，普通用户只看自己的。
    // 历史内存/旧持久化 run 可能没有 workspace_id；保留旧单租户可见性，避免滚动升级期间首页突然空白。
    const actor = c.var.actor;
    const activeRuns = (await queue.listActive()).filter((run) => {
      const inWorkspace = !run.workspace_id || run.workspace_id === actor.workspaceId;
      return inWorkspace && (actor.isAdmin || run.actor_id === actor.id);
    });
    // 战绩是首页加分项：取数失败/无数据时静默降级（worklog 为可选字段，UI 不渲染横幅）。
    let worklog: Awaited<ReturnType<AiWorklogMetricsService["getTodayMetrics"]>> | undefined;
    try {
      // AUTHZ-2：今日 AI 战绩按请求者工作区收口,与 /skills、listProjects 一致——否则一旦多工作区,
      // 每个登录用户都会看到跨租户混合的聚合计数(虽只泄露数字总量,不泄露记录身份)。
      worklog = await aiWorklog.getTodayMetrics({ workspaceId: actor.workspaceId });
    } catch {
      worklog = undefined;
    }
    const sourceWarnings: AttentionHomeVM["source_warnings"] = [];
    // 决策队列：把"这个用户当前待决策的审批"接进首页收件箱（与 /approvals 同源、同按用户路由）。
    // 这是 W1 决策收件箱此前缺的真实数据源——没接前首页决策卡恒为空。取数失败保留首页,但显式告诉用户队列未完整加载。
    let decisionQueue: AttentionHomeVM["queue"] = [];
    try {
      const escalationPage = await listEscalationAttentionPage({ actor: c.var.actor, locale });
      decisionQueue = [
        ...escalationPage.items,
        ...decisionQueue
      ];
      if (escalationPage.page_info.has_more) {
        sourceWarnings.push(escalationCapWarning(locale));
      }
    } catch {
      sourceWarnings.push({
        source: "escalations",
        message: locale === "en-US"
          ? "Escalations could not be loaded. Open Projects or retry."
          : "升级待办暂时加载失败。请打开项目或稍后重试。"
      });
    }
    try {
      const memoryConflictItems = await memoryConflicts.listAttentionItems({ actor: c.var.actor, locale });
      decisionQueue = [
        ...decisionQueue,
        ...memoryConflictItems
      ];
    } catch {
      sourceWarnings.push({
        source: "sync_conflicts",
        message: locale === "en-US"
          ? "Memory conflicts could not be loaded. Open Settings or retry."
          : "记忆冲突暂时加载失败。请打开设置或稍后重试。"
      });
    }
    try {
      // R7（跨页一致）：与指挥台 waiting_decision KPI 同口径——传 canReadWorkItem 走 scanCap 翻页分支，
      // 两处对同一批审批不再用不同扫描深度；封顶时首页也诚实提示，不再静默截断装完整。
      const pending = await approvals.listPendingForUser(c.var.currentUser, {
        locale,
        canReadWorkItem: (workItemId) => canReadWorkItem(workItems, workItemId, c.var.actor)
      });
      // findings：决策队列要和 /approvals 一样按可读工作项过滤——否则被路由到的审批若其工作项不可读，
      // 卡片仍会在首页泄露事项信息。复用同一个 visibleApprovalCenter 收口。
      decisionQueue = [
        ...decisionQueue,
        // R9（性能）：listPendingForUser 已用同一 canReadWorkItem 谓词过滤过——传 alreadyFiltered
        // 免去对同一批数据的第二轮串行可见性全扫描（与 KPI 计数处同口径）。
        ...(await visibleApprovalCenter(pending, workItems, c.var.actor, true)).items
      ];
      if (pending.counts.pending_total_capped === 1) {
        sourceWarnings.push({
          source: "approvals",
          message: serviceT(locale, "approvalsCappedMore")
        });
      }
    } catch {
      sourceWarnings.push({
        source: "approvals",
        message: locale === "en-US"
          ? "Approval decisions could not be loaded. Open Approvals or retry."
          : "审批待办暂时加载失败。请打开审批页或稍后重试。"
      });
    }
    // GAP-1：把「AI 已交付、待这个用户评审」的提议接进首页决策队列(proposal_review 卡),
    // 与审批同源、同按用户路由(非 admin 只看自己提交的工作项)。这是此前缺的真实数据源——
    // 没接前 AI 干完活、提议 opened 只进通知中心,决策卡牌(今日待办)看不到。取数失败静默降级。
    try {
      const reviewable = await proposals.listReviewableForUser({
        user: {
          id: c.var.currentUser.id,
          isAdmin: c.var.currentUser.isAdmin,
          workspaceId: c.var.actor.workspaceId
        }
      });
      decisionQueue = [
        ...decisionQueue,
        ...reviewable.map((summary) => buildProposalReviewAttentionItem(summary, locale))
      ];
      // R4 high（规模化）：listReviewableForUser 硬上限 50——打满即可能有更多评审被静默截断，
      // 与升级/审批的诚实上限提示同口径给 sourceWarning，不让用户以为队列已清空。
      if (reviewable.length >= 50) {
        sourceWarnings.push({
          source: "proposals",
          message: locale === "en-US"
            ? "Showing the first 50 reviewable changes — clear some to surface the rest."
            : "变更评审只显示前 50 条——处理掉一些，其余的才会浮现。"
        });
      }
    } catch {
      // 保留已有审批队列,不拖垮首页,但不能让用户误以为队列完整。
      sourceWarnings.push({
        source: "proposals",
        message: locale === "en-US"
          ? "Proposal reviews could not be loaded. Open Projects or retry."
          : "变更评审暂时加载失败。请打开项目页或稍后重试。"
      });
    }
    // R13（多项目一致性）：四路来源（审批/升级预算/记忆冲突/提议评审）只有审批带 project_name——
    // 装配收尾统一按 work_item_id 批量反查补齐，首页/桌面卡与审批中心同构。失败不点名不翻页面。
    try {
      const missingNameWorkItemIds = [...new Set(decisionQueue
        .filter((item) => !item.project_name && item.work_item_id)
        .map((item) => item.work_item_id as string))];
      if (missingNameWorkItemIds.length > 0) {
        const nameMap = await workItems.projectNamesForWorkItems({ workItemIds: missingNameWorkItemIds, actor: c.var.actor });
        for (const item of decisionQueue) {
          if (!item.project_name && item.work_item_id) {
            const name = nameMap.get(item.work_item_id);
            if (name) {
              item.project_name = name;
            }
          }
        }
      }
    } catch {
      // 点名失败不影响决策队列本身。
    }
    return c.json(pageEnvelope(
      buildAttentionHomePage({ queue: decisionQueue, sourceWarnings, backgroundRuns: activeRuns, locale, worklog }),
      locale
    ));
  });

  if (allowUnauthenticatedGoldPath) {
    routes.get("/gold-path", (c) => {
      const locale = requestLocale(c);
      return c.json(pageEnvelope(buildP05GoldPathSurfacePage(locale), locale));
    });
  } else {
    routes.get("/gold-path", createCurrentUserMiddleware(authSource), (c) => {
      const locale = requestLocale(c);
      return c.json(pageEnvelope(buildP05GoldPathSurfacePage(locale), locale));
    });
  }

  routes.get("/approvals", createCurrentUserMiddleware(authSource), async (c) => {
    const locale = requestLocale(c);
    const data = await approvals.listPendingForUser(c.var.currentUser, {
      locale,
      ...approvalPageQuery(c),
      canReadWorkItem: (workItemId) => canReadWorkItem(workItems, workItemId, c.var.actor)
    });
    // routes-b-1：service.listPendingForUser already applied this exact canReadWorkItem predicate
    // (with its own per-workItemId dedupe) while scanning, so skip the second detailPage pass here.
    return c.json(pageEnvelope(await visibleApprovalCenter(data, workItems, c.var.actor, true), locale));
  });

  routes.get("/workitems/:id", createCurrentUserMiddleware(authSource), async (c) => {
    const locale = requestLocale(c);
    // 路由 uuid 形参先校验：非 uuid 串原本直达 detailPage 的 uuid 列 → PG 22P02 → 误报 500；
    // 与「合法但不存在」同样回 404，不泄露事项存在性。
    if (!isUuidParam(c.req.param("id"))) {
      throw new HTTPException(404, { message: serviceT("zh-CN", "taskNotFound") });
    }
    try {
      const data = await workItems.detailPage({
        workItemId: c.req.param("id"),
        actor: c.var.actor,
        locale
      });
      return c.json(pageEnvelope(data, locale));
    } catch (error) {
      if (error instanceof WorkItemServiceError) {
        throw error;
      }
      throw error;
    }
  });

  routes.get("/proposals/:id", createCurrentUserMiddleware(authSource), async (c) => {
    const locale = requestLocale(c);
    // 路由 uuid 形参先校验：非 uuid 串原本直达 proposals.get 的 uuid 列 → PG 22P02 → 误报 500；
    // 与「合法但不存在」同样回 404，不泄露变更申请存在性。
    if (!isUuidParam(c.req.param("id"))) {
      throw new HTTPException(404, { message: "没有找到这个变更申请。" });
    }
    const proposal = await proposals.get(c.req.param("id"));
    if (!proposal) {
      throw new HTTPException(404, { message: "没有找到这个变更申请。" });
    }
    if (!await canReadWorkItem(workItems, proposal.work_item_id, c.var.actor)) {
      throw new HTTPException(403, { message: "你没有权限查看这个变更申请。" });
    }
    // R14 批 FEEDBACK：可见性 403 短路之后再查本人反馈——绝不给无权限用户泄露「这条提议有没有被反馈过」。
    const actorUserId = c.var.actor.userId;
    const myFeedback = actorUserId
      ? await aiFeedback.getForSubject({ subjectType: "proposal", subjectId: proposal.id, userId: actorUserId })
      : null;
    return c.json(pageEnvelope(buildProposalDetailPage(proposal, locale, myFeedback), locale));
  });

  routes.get("/drive", createCurrentUserMiddleware(authSource), async (c) => {
    const locale = requestLocale(c);
    const projectId = c.req.query("project_id");
    const itemId = c.req.query("item_id");
    // 非 uuid 的 project_id 原本直达 projects.id 的 uuid 列 → PG 22P02 → 误报 500；与 /project/:id 一致先校验回 404。
    if (projectId && !isUuidParam(projectId)) {
      return pageServiceErrorResponse(c, new DrivePageServiceError(404, "没有找到这个项目网盘。", "drive_not_found"));
    }
    if (itemId && !isUuidParam(itemId)) {
      return pageServiceErrorResponse(c, new DrivePageServiceError(404, "没有找到这个网盘文件。", "drive_file_not_found"));
    }
    try {
      const nameQuery = c.req.query("q")?.trim().slice(0, 120);
      const data = await drivePages.page({
        actor: c.var.actor,
        locale,
        ...(projectId ? { projectId } : {}),
        ...(itemId ? { itemId } : {}),
        ...(nameQuery ? { nameQuery } : {})
      });
      return c.json(pageEnvelope(data, locale));
    } catch (error) {
      if (error instanceof DrivePageServiceError) {
        return pageServiceErrorResponse(c, error);
      }
      throw error;
    }
  });

  // GitHub 式项目主页：GET /api/pages/project/:id → 项目元信息 + 进行中工作清单 + 入口动作。
  routes.get("/project/:id", createCurrentUserMiddleware(authSource), async (c) => {
    const locale = requestLocale(c);
    const projectId = c.req.param("id");
    // 路由 uuid 形参先校验：非 uuid 串原本直达 projects.id 的 uuid 列 → PG 22P02 → 误报 500；
    // 与「合法但不存在」同样回 404，并保留项目主页领域错误码。
    if (!isUuidParam(projectId)) {
      return pageServiceErrorResponse(c, new ProjectHomePageServiceError(404, "没有找到这个项目。", "project_not_found"));
    }
    try {
      const data = await projectHomePages.page({ actor: c.var.actor, projectId, locale });
      return c.json(pageEnvelope(data, locale));
    } catch (error) {
      if (error instanceof ProjectHomePageServiceError) {
        return pageServiceErrorResponse(c, error);
      }
      throw error;
    }
  });

  // R15 批 E1c：时间线（甘特）VM。GET /api/pages/project/:id/timeline → 里程碑 + 排期条 + 关键路径。纯读。
  routes.get("/project/:id/timeline", createCurrentUserMiddleware(authSource), async (c) => {
    const locale = requestLocale(c);
    const projectId = c.req.param("id");
    if (!isUuidParam(projectId)) {
      return pageServiceErrorResponse(c, new ProjectTimelinePageServiceError(404, "没有找到这个项目。", "project_not_found"));
    }
    try {
      const data = await projectTimelinePages.page({ actor: c.var.actor, projectId, locale });
      return c.json(pageEnvelope(data, locale));
    } catch (error) {
      if (error instanceof ProjectTimelinePageServiceError) {
        return pageServiceErrorResponse(c, error);
      }
      throw error;
    }
  });

  routes.get("/workbench/:projectId", createCurrentUserMiddleware(authSource), async (c) => {
    const locale = requestLocale(c);
    const rawProjectId = c.req.param("projectId");
    if (!isUuidParam(rawProjectId)) {
      return pageServiceErrorResponse(
        c,
        new WorkbenchPageServiceError(404, "workbench_not_found", "没有找到这个桌面工作台。")
      );
    }
    const projectId = rawProjectId.toLowerCase();
    try {
      const data = await workbenchPages.page({ actor: c.var.actor, projectId, locale });
      return c.json(pageEnvelope(data, locale));
    } catch (error) {
      if (error instanceof WorkbenchPageServiceError) {
        return pageServiceErrorResponse(c, error);
      }
      throw error;
    }
  });

  routes.get("/meetings", createCurrentUserMiddleware(authSource), async (c) => {
    const locale = requestLocale(c);
    const projectId = c.req.query("project_id");
    const meetingId = c.req.query("m") ?? c.req.query("meeting_id");
    // 同 /drive：非 uuid 的 project_id 防 PG 22P02 误报 500，先校验回 404，并保留会议页领域错误码。
    if (projectId && !isUuidParam(projectId)) {
      return pageServiceErrorResponse(c, new MeetingPageServiceError(404, "没有找到这个项目会议。", "meeting_not_found"));
    }
    if (meetingId && !isUuidParam(meetingId)) {
      return pageServiceErrorResponse(c, new MeetingPageServiceError(404, "没有找到这场会议。", "meeting_not_found"));
    }
    try {
      const data: MeetingPageVM = await meetingPages.page({
        actor: c.var.actor,
        locale,
        ...(projectId ? { projectId } : {}),
        ...(meetingId ? { meetingId } : {})
      });
      return c.json(pageEnvelope(data, locale));
    } catch (error) {
      if (error instanceof MeetingPageServiceError) {
        return pageServiceErrorResponse(c, error);
      }
      throw error;
    }
  });

  routes.get("/notifications", createCurrentUserMiddleware(authSource), async (c) => {
    const locale = requestLocale(c);
    try {
      const data: NotificationPageVM = await scheduleNotifyPages.notificationsPage({
        actor: c.var.actor,
        locale
      });
      return c.json(pageEnvelope(data, locale));
    } catch (error) {
      if (error instanceof ScheduleNotifyPageServiceError) {
        return pageServiceErrorResponse(c, error);
      }
      throw error;
    }
  });

  routes.get("/calendar", createCurrentUserMiddleware(authSource), async (c) => {
    const locale = requestLocale(c);
    const date = c.req.query("date");
    const view = c.req.query("view");
    try {
      const data: CalendarPageVM = await scheduleNotifyPages.calendarPage({
        actor: c.var.actor,
        locale,
        ...(date ? { date } : {}),
        ...(view ? { view } : {})
      });
      return c.json(pageEnvelope(data, locale));
    } catch (error) {
      if (error instanceof ScheduleNotifyPageServiceError) {
        return pageServiceErrorResponse(c, error);
      }
      throw error;
    }
  });

  routes.get("/health", createCurrentUserMiddleware(authSource), async (c) => {
    const locale = requestLocale(c);
    const data: ProjectHealthPageVM = await projectHealthPages.healthPage({
      actor: c.var.actor,
      locale
    });
    return c.json(pageEnvelope(data, locale));
  });

  routes.get("/cost", createCurrentUserMiddleware(authSource), async (c) => {
    const locale = requestLocale(c);
    const tenantSettings = settingsForActor(c.var.actor);
    // R2 多租户 Phase 4：团队预算卡片按 actor 工作区取（取代写死常量；单租户经 seed 解析==默认工作区零变化）。
    // 注意：非管理员账目仍走下方 user-scope fail-closed；管理员全组织账目的工作区围栏需 cost_ledger_entries
    // 加 denormalized workspace_id 列（Phase 4 deeper，待 2nd-tenant 才有意义，见 plan）。
    const teamId = c.var.actor.workspaceId;
    const decision = decideRunBudget({
      settings: tenantSettings,
      scopeIds: {
        userId: c.var.currentUser.id,
        teamId
      },
      policies: await policyStore.listPolicies(tenantSettings),
      usage: await ledgerStore.usageSnapshots({ userId: c.var.currentUser.id, teamId })
    });
    // 非管理员只读自己 user scope 的账目（走 scope_kind+scope_id 索引 + 工作区子查询半连接，不全表扫描、
    // 不拉整个工作区再在内存过滤）。team/me 预算卡片来自 decision.usages（与账目无关），所以团队预算状态
    // 照常可见。管理员看当前 workspace 的团队账目。
    // DF-1：管理员与非管理员用**同一个** 90 天窗口（costDashboardSinceBucket），否则同一个无标签的
    // total_cost_cny 对管理员=近 90 天、对普通成员=终身累计（两种含义混在一个字段里，且成员越用越慢）。
    const costSinceBucket = costDashboardSinceBucket(new Date());
    const ledgerEntries = c.var.currentUser.isAdmin
      ? (ledgerStore.listEntriesForWorkspace
          ? await ledgerStore.listEntriesForWorkspace(teamId, { sinceBucket: costSinceBucket })
          : ledgerStore.listEntriesForScopes
            ? await ledgerStore.listEntriesForScopes({ teamId }, { sinceBucket: costSinceBucket })
            // R9.7：管理员账目同样必须有 workspace-scoped reader；缺失时 fail-closed，
            // 不能回退到 listEntries()/entries 的全组织账本。
            : [])
      // routes-b-2/contracts-pkgs-4：非管理员回到按 { userId, teamId } 的窄 scope 查询——只取本人 user-scope
      // 条目并叠加工作区围栏（listEntriesForScopes 内部对 teamId 走子查询半连接，不拉全工作区）。
      : (ledgerStore.listEntriesForScopes
          ? await ledgerStore.listEntriesForScopes({ userId: c.var.currentUser.id, teamId }, { sinceBucket: costSinceBucket })
          // L[1]：非管理员且 store 未实现按 scope 查询时 fail-closed 返回空——绝不回退到 listEntries()/entries
          // （全组织账目）。跨租户读账目宁可空，也不能 fail-open 把别人的花费泄露给普通成员。
          : []);
    // B-R9.6 UX-H4：军团行元数据（名称/状态/预算）。展示增强——取数失败降级为无名行，不拖垮成本页。
    let taskPlanMeta: Map<string, { label: string; status: string; maxCostCny?: number }> | undefined;
    let objectiveTitles: Map<string, string> | undefined;
    let workItemLabels: Map<string, string> | undefined;
    if (c.var.currentUser.isAdmin && c.var.actor.workspaceId) {
      const planIds = [...new Set(ledgerEntries
        .map((entry) => entry.taskPlanId ?? (entry.scope.kind === "task" ? entry.scope.taskPlanId : undefined))
        .filter((value): value is string => Boolean(value)))];
      if (planIds.length > 0) {
        try {
          taskPlanMeta = await taskPlans.listPlanMetaByIds({ workspaceId: c.var.actor.workspaceId, planIds });
        } catch {
          taskPlanMeta = undefined;
        }
      }
      // UX-M10：目标标题（按目标维度不渲裸 UUID）；同样降级安全。
      const objectiveIds = [...new Set(ledgerEntries
        .map((entry) => entry.objectiveId ?? (entry.scope.kind === "objective" ? entry.scope.objectiveId : undefined))
        .filter((value): value is string => Boolean(value)))];
      if (objectiveIds.length > 0) {
        try {
          objectiveTitles = await objectives.listObjectiveTitlesByIds({ workspaceId: c.var.actor.workspaceId, objectiveIds });
        } catch {
          objectiveTitles = undefined;
        }
      }
      // 「按任务分账」用编号 · 标题（by_workitem 的 code），不渲内部 id；取数失败同样降级——页面层回落中性词。
      const workItemIds = [...new Set(ledgerEntries
        .map((entry) => entry.workItemId ?? (entry.scope.kind === "workitem" ? entry.scope.workitemId : undefined))
        .filter((value): value is string => Boolean(value)))];
      if (workItemIds.length > 0) {
        try {
          workItemLabels = await workItemLabelReader({ workspaceId: c.var.actor.workspaceId, workItemIds });
        } catch {
          workItemLabels = undefined;
        }
      }
    }
    // R13 批 P4（labor-split 按 assignee 记账 + KPI「AI 自动合并数/占比」）：与 taskPlanMeta/objectiveTitles
    // 同款降级安全——仅管理员取（暴露同组织其他成员花费/评审活动），取数失败静默降级，不拖垮成本页。
    let assigneeCostRows: AssigneeCostInputRow[] | undefined;
    let aiAutoMergeCounts: { total: number; aiApproved: number } | undefined;
    if (c.var.currentUser.isAdmin) {
      try {
        assigneeCostRows = await assigneeCostReader({ teamId, sinceBucket: costSinceBucket, limit: 50 });
      } catch {
        assigneeCostRows = undefined;
      }
      try {
        aiAutoMergeCounts = await proposalMergeStats.countTodayMergeReviewsByActorKind({ workspaceId: teamId });
      } catch {
        aiAutoMergeCounts = undefined;
      }
    }
    const data = buildCostDashboardPage({
      settings: tenantSettings,
      isAdmin: c.var.currentUser.isAdmin,
      userId: c.var.currentUser.id,
      teamId,
      locale,
      budgetUsages: decision.usages,
      budgetNotices: decision.notice ? [decision.notice] : [],
      ledgerEntries,
      ...(taskPlanMeta ? { taskPlanMeta } : {}),
      ...(objectiveTitles ? { objectiveTitles } : {}),
      ...(workItemLabels ? { workItemLabels } : {}),
      ...(assigneeCostRows ? { assigneeCostRows } : {}),
      ...(aiAutoMergeCounts ? { aiAutoMergeCounts } : {})
    });
    return c.json(pageEnvelope(data, locale));
  });

  routes.get("/agents", createCurrentUserMiddleware(authSource), async (c) => {
    const locale = requestLocale(c);
    const data = await agentArmyDashboard.page({
      actor: c.var.actor,
      currentUser: c.var.currentUser,
      locale
    });
    return c.json(pageEnvelope(data, locale));
  });

  routes.get("/skills", createCurrentUserMiddleware(authSource), async (c) => {
    const locale = requestLocale(c);
    // R2 多租户 Phase 3：技能按 actor 的工作区读（取代写死默认工作区常量）——单租户下 actor.workspaceId
    // 经 seed 成员解析 == 默认工作区，零变化；多租户下各成员只看自己工作区的技能。
    const workspaceId = c.var.actor.workspaceId;
    const active = await teamSkills.listActive(workspaceId);
    return c.json(pageEnvelope(buildTeamSkillsPage({ skills: active, curation: skillCuration() }), locale));
  });

  routes.get("/settings", createCurrentUserMiddleware(authSource), async (c) => {
    const locale = requestLocale(c);
    const preferenceLocale = normalizeWorkHubLocale(c.var.currentUser.preferredLocale);
    // APPROVAL-POLICY-UI：常驻审批策略在设置页可见，管理员可直接从当前认证客户端撤销。
    // 取数失败降级为不渲策略区，不拖垮设置页。
    // R6（权限边界 high）：权限策略是 org 级治理面，专用路由 /api/permissions 读写均 admin-only——
    // 设置页此前无条件吐给所有成员（越权读）。与专用路由同门槛：非管理员不取不渲。
    let permissionPolicies: Parameters<typeof buildSettingsPage>[0]["permissionPolicies"];
    if (c.var.currentUser.isAdmin) {
      try {
        permissionPolicies = (await approvals.listPolicies(c.var.actor)).map(toPermissionPolicyResponse);
      } catch {
        permissionPolicies = undefined;
      }
    }
    // R24-P 阶段 1：网页设置页的**只读**插件清单，同一道管理员门（服务端只给管理员填，
    // 非管理员字段结构性缺席）。取数失败降级为不渲这一区，不拖垮整页设置——与上面策略区同款取舍。
    // 网页不做安装/启停：安装要给一个本机绝对路径，那是「这台服务器上的目录」，只在桌面端说得通。
    let installedPlugins: Parameters<typeof buildSettingsPage>[0]["plugins"];
    if (c.var.currentUser.isAdmin) {
      try {
        const listed = await plugins().list({ actor: c.var.actor });
        installedPlugins = listed.plugins.map((plugin) => ({
          id: plugin.id,
          name: plugin.name,
          ...(plugin.version ? { version: plugin.version } : {}),
          enabled: plugin.enabled,
          status: plugin.status,
          trust_level: plugin.trust_level,
          tool_count: plugin.tool_count,
          compat_verdict: plugin.compat_report.verdict
        }));
      } catch {
        installedPlugins = undefined;
      }
    }
    // R26 M8：网页设置页的**只读** MCP 服务器清单，同一道管理员门。列表里每一行都从完整 VM 裁剪成
    // summary（命令 / 参数 / 环境变量 / 密钥引用 / 工作目录一律不进网页），连不上的那一行再补上
    // 稳定错误码——它来自本进程的连接快照，行上没有存码的列，所以拿不到时就不给，界面回落到
    // 通用的一句「连不上」。取数失败降级为不渲这一区，与上面两区同款取舍。
    let registeredMcpServers: Parameters<typeof buildSettingsPage>[0]["mcpServers"];
    if (c.var.currentUser.isAdmin) {
      try {
        const listed = await mcpServers().list({ actor: c.var.actor });
        registeredMcpServers = listed.servers.map((server) => {
          const errorCode = server.last_error_code ?? listed.connections[server.id]?.last_error_code;
          return {
            id: server.id,
            server_name: server.server_name,
            ...(server.display_name ? { display_name: server.display_name } : {}),
            transport: server.transport,
            enabled: server.enabled,
            status: server.status,
            trust_level: server.trust_level,
            tool_count: server.tool_count,
            precheck_verdict: server.precheck_report.verdict,
            ...(server.status === "connect_failed" && errorCode ? { last_error_code: errorCode } : {})
          };
        });
      } catch {
        registeredMcpServers = undefined;
      }
    }
    const runtimeReadiness = await readiness(authSettings);
    return c.json(pageEnvelope(buildSettingsPage({
      settings: authSettings,
      readiness: runtimeReadiness,
      locale,
      preferenceLocale,
      preferenceSource: "server",
      ...(permissionPolicies ? { permissionPolicies } : {}),
      ...(installedPlugins ? { plugins: installedPlugins } : {}),
      ...(registeredMcpServers ? { mcpServers: registeredMcpServers } : {})
    }), locale));
  });

  return routes;
}
