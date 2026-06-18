import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import { settings } from "@workhub/config";
import { decideRunBudget, type BudgetPolicyStore, type CostLedgerStore } from "@workhub/cost";
import {
  normalizeWorkHubLocale,
  type ApprovalCenterVM,
  type AttentionHomeVM,
  type CalendarPageVM,
  type MeetingPageVM,
  type NotificationPageVM,
  type ProjectHealthPageVM,
  type ApprovalRequest,
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
import { createTeamSkillRepository, getSharedDatabaseClient, type TeamSkillRepository } from "@workhub/db";

import { buildAttentionHomePage } from "../pages/attention.js";
import { getDefaultAiWorklogMetricsService, type AiWorklogMetricsService } from "../services/ai-worklog-metrics.js";
import { buildCostDashboardPage } from "../pages/cost.js";
import { buildTeamSkillsPage } from "../pages/team-skills.js";
import { buildP05GoldPathSurfacePage } from "../pages/gold-path.js";
import { buildProposalDetailPage, buildProposalReviewAttentionItem } from "../pages/proposals.js";
import { buildSettingsPage } from "../pages/settings.js";
import {
  DrivePageServiceError,
  getDefaultDrivePageService,
  type DrivePageService
} from "../services/drive-pages.js";
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
  type ApprovalService
} from "../services/approvals.js";
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
import { getDefaultCostLedgerStore } from "../services/cost-ledger-store.js";
import { getDefaultBudgetPolicyStore } from "../services/cost-policy-store.js";

export type PageRoutesDependencies = {
  auth?: AuthDependencySource;
  approvals?: ApprovalService;
  proposals?: ProposalService;
  queue?: AgentRunQueue;
  policyStore?: BudgetPolicyStore;
  ledgerStore?: CostLedgerStore;
  workItems?: WorkItemService;
  drivePages?: DrivePageService;
  meetingPages?: MeetingPageService;
  scheduleNotifyPages?: ScheduleNotifyPageService;
  projectHealthPages?: ProjectHealthPageService;
  aiWorklog?: AiWorklogMetricsService;
  teamSkills?: Pick<TeamSkillRepository, "listActive">;
  allowUnauthenticatedGoldPath?: boolean;
};

function requestLocale(c: { req: { query: (key: string) => string | undefined; header: (key: string) => string | undefined } }): WorkHubLocale {
  return normalizeWorkHubLocale(c.req.query("locale") ?? c.req.header("Accept-Language"));
}

// findings[#74/#80]：管理员成本看板的时间窗口（天）。窗口内的账目走 period_bucket 索引下推，避免每次
// 加载都全表扫描 cost_ledger_entries、也把 trend 桶数封顶。窗口外的历史不在看板展示（按需另查累计）。
const COST_DASHBOARD_WINDOW_DAYS = 90;

function costDashboardSinceBucket(now: Date): string {
  const cutoff = new Date(now.getTime() - COST_DASHBOARD_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  return cutoff.toISOString().slice(0, 10);
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

async function canReadWorkItem(
  workItems: Pick<WorkItemService, "detailPage">,
  workItemId: string | undefined,
  actor: AuthEnv["Variables"]["actor"]
) {
  if (!workItemId) {
    return true;
  }
  try {
    await workItems.detailPage({ workItemId, actor });
    return true;
  } catch (error) {
    if (error instanceof WorkItemServiceError && (error.status === 403 || error.status === 404)) {
      return false;
    }
    throw error;
  }
}

async function visibleApprovalCenter(
  data: ApprovalCenterVM,
  workItems: Pick<WorkItemService, "detailPage">,
  actor: AuthEnv["Variables"]["actor"]
) {
  const visibleRequests: ApprovalRequest[] = [];
  const visibleRequestIds = new Set<string>();
  for (const request of data.requests) {
    if (await canReadWorkItem(workItems, request.work_item_id, actor)) {
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
  return {
    ...data,
    items: visibleItems,
    items_detail: Object.fromEntries(
      Object.entries(data.items_detail).filter(([itemId]) => visibleItemIds.has(itemId))
    ),
    requests: visibleRequests,
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
  const proposals = deps.proposals ?? getDefaultProposalService();
  const queue = deps.queue ?? getDefaultAgentRunQueue();
  const policyStore = deps.policyStore ?? getDefaultBudgetPolicyStore();
  const ledgerStore = deps.ledgerStore ?? getDefaultCostLedgerStore();
  const workItems = deps.workItems ?? getDefaultWorkItemService();
  const drivePages = deps.drivePages ?? getDefaultDrivePageService();
  const meetingPages = deps.meetingPages ?? getDefaultMeetingPageService();
  const scheduleNotifyPages = deps.scheduleNotifyPages ?? createScheduleNotifyPageService();
  const projectHealthPages = deps.projectHealthPages ?? createProjectHealthPageService();
  const aiWorklog = deps.aiWorklog ?? getDefaultAiWorklogMetricsService();
  const teamSkills = deps.teamSkills ?? createTeamSkillRepository(getSharedDatabaseClient().db);

  routes.get("/attention", createCurrentUserMiddleware(authSource), async (c) => {
    const locale = requestLocale(c);
    // 只展示请求者自己的在跑 AI（管理员看全部）。否则首页 background_runs 会泄露所有用户的活跃 run。
    const actor = c.var.actor;
    const activeRuns = (await queue.listActive()).filter((run) => actor.isAdmin || run.actor_id === actor.id);
    // 战绩是首页加分项：取数失败/无数据时静默降级（worklog 为可选字段，UI 不渲染横幅）。
    let worklog: Awaited<ReturnType<AiWorklogMetricsService["getTodayMetrics"]>> | undefined;
    try {
      worklog = await aiWorklog.getTodayMetrics();
    } catch {
      worklog = undefined;
    }
    // 决策队列：把"这个用户当前待决策的审批"接进首页收件箱（与 /approvals 同源、同按用户路由）。
    // 这是 W1 决策收件箱此前缺的真实数据源——没接前首页决策卡恒为空。取数失败静默降级成空队列，不拖垮首页。
    let decisionQueue: AttentionHomeVM["queue"] = [];
    try {
      const pending = await approvals.listPendingForUser(c.var.currentUser, { locale });
      // findings：决策队列要和 /approvals 一样按可读工作项过滤——否则被路由到的审批若其工作项不可读，
      // 卡片仍会在首页泄露事项信息。复用同一个 visibleApprovalCenter 收口。
      decisionQueue = (await visibleApprovalCenter(pending, workItems, c.var.actor)).items;
    } catch {
      decisionQueue = [];
    }
    // GAP-1：把「AI 已交付、待这个用户评审」的提议接进首页决策队列(proposal_review 卡),
    // 与审批同源、同按用户路由(非 admin 只看自己提交的工作项)。这是此前缺的真实数据源——
    // 没接前 AI 干完活、提议 opened 只进通知中心,决策卡牌(今日待办)看不到。取数失败静默降级。
    try {
      const reviewable = await proposals.listReviewableForUser({ user: c.var.currentUser });
      decisionQueue = [
        ...decisionQueue,
        ...reviewable.map((summary) => buildProposalReviewAttentionItem(summary, locale))
      ];
    } catch {
      // 保留已有审批队列,不拖垮首页。
    }
    return c.json(pageEnvelope(
      buildAttentionHomePage({ queue: decisionQueue, backgroundRuns: activeRuns, locale, worklog }),
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
    const data = await approvals.listPendingForUser(c.var.currentUser, { locale });
    return c.json(pageEnvelope(await visibleApprovalCenter(data, workItems, c.var.actor), locale));
  });

  routes.get("/workitems/:id", createCurrentUserMiddleware(authSource), async (c) => {
    const locale = requestLocale(c);
    try {
      const data = await workItems.detailPage({
        workItemId: c.req.param("id"),
        actor: c.var.actor,
        locale
      });
      return c.json(pageEnvelope(data, locale));
    } catch (error) {
      if (error instanceof WorkItemServiceError) {
        throw new HTTPException(error.status as 400, { message: error.message });
      }
      throw error;
    }
  });

  routes.get("/proposals/:id", createCurrentUserMiddleware(authSource), async (c) => {
    const locale = requestLocale(c);
    const proposal = await proposals.get(c.req.param("id"));
    if (!proposal) {
      throw new HTTPException(404, { message: "没有找到这个变更申请。" });
    }
    if (!await canReadWorkItem(workItems, proposal.work_item_id, c.var.actor)) {
      throw new HTTPException(403, { message: "你没有权限查看这个变更申请。" });
    }
    return c.json(pageEnvelope(buildProposalDetailPage(proposal, locale), locale));
  });

  routes.get("/drive", createCurrentUserMiddleware(authSource), async (c) => {
    const locale = requestLocale(c);
    const projectId = c.req.query("project_id");
    try {
      const data = await drivePages.page({
        actor: c.var.actor,
        locale,
        ...(projectId ? { projectId } : {})
      });
      return c.json(pageEnvelope(data, locale));
    } catch (error) {
      if (error instanceof DrivePageServiceError) {
        throw new HTTPException(error.status, { message: error.message });
      }
      throw error;
    }
  });

  routes.get("/meetings", createCurrentUserMiddleware(authSource), async (c) => {
    const locale = requestLocale(c);
    const projectId = c.req.query("project_id");
    const meetingId = c.req.query("m") ?? c.req.query("meeting_id");
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
        throw new HTTPException(error.status, { message: error.message });
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
        throw new HTTPException(error.status as 400, { message: error.message });
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
        throw new HTTPException(error.status as 400, { message: error.message });
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
    const teamId = settings.auth.defaultWorkspaceId;
    const decision = decideRunBudget({
      settings,
      scopeIds: {
        userId: c.var.currentUser.id,
        teamId
      },
      policies: await policyStore.listPolicies(settings),
      usage: await ledgerStore.usageSnapshots({ userId: c.var.currentUser.id, teamId })
    });
    // 非管理员只读自己 user scope 的账目（走索引，不全表扫描，也不带 team scope——否则会把同队他人的花费混进总额）。
    // team/me 预算卡片来自 decision.usages（与账目无关），所以团队预算状态照常可见。管理员才取全组织视图。M8/M9。
    const ledgerEntries = c.var.currentUser.isAdmin
      ? (ledgerStore.listEntries
          ? await ledgerStore.listEntries({ sinceBucket: costDashboardSinceBucket(new Date()) })
          : ledgerStore.entries)
      : (ledgerStore.listEntriesForScopes
          ? await ledgerStore.listEntriesForScopes({ userId: c.var.currentUser.id })
          // L[1]：非管理员且 store 未实现按 scope 查询时 fail-closed 返回空——绝不回退到 listEntries()/entries
          // （全组织账目）。跨租户读账目宁可空，也不能 fail-open 把别人的花费泄露给普通成员。
          : []);
    const data = buildCostDashboardPage({
      settings,
      isAdmin: c.var.currentUser.isAdmin,
      userId: c.var.currentUser.id,
      locale,
      budgetUsages: decision.usages,
      ledgerEntries
    });
    return c.json(pageEnvelope(data, locale));
  });

  routes.get("/skills", createCurrentUserMiddleware(authSource), async (c) => {
    const locale = requestLocale(c);
    // R2 多租户 Phase 3：技能按 actor 的工作区读（取代写死默认工作区常量）——单租户下 actor.workspaceId
    // 经 seed 成员解析 == 默认工作区，零变化；多租户下各成员只看自己工作区的技能。
    const workspaceId = c.var.actor.workspaceId;
    const active = await teamSkills.listActive(workspaceId);
    return c.json(pageEnvelope(buildTeamSkillsPage({ skills: active }), locale));
  });

  routes.get("/settings", createCurrentUserMiddleware(authSource), (c) => {
    const locale = requestLocale(c);
    const preferenceLocale = normalizeWorkHubLocale(c.var.currentUser.preferredLocale);
    return c.json(pageEnvelope(buildSettingsPage({
      settings: authSettings,
      locale,
      preferenceLocale,
      preferenceSource: "server"
    }), locale));
  });

  return routes;
}
