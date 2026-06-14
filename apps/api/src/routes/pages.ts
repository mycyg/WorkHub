import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import { settings } from "@workhub/config";
import { decideRunBudget, type BudgetPolicyStore, type CostLedgerStore } from "@workhub/cost";
import {
  normalizeWorkHubLocale,
  type ApprovalCenterVM,
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
import { buildAttentionHomePage } from "../pages/attention.js";
import { getDefaultAiWorklogMetricsService, type AiWorklogMetricsService } from "../services/ai-worklog-metrics.js";
import { buildCostDashboardPage } from "../pages/cost.js";
import { buildP05GoldPathSurfacePage } from "../pages/gold-path.js";
import { buildProposalDetailPage } from "../pages/proposals.js";
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
  allowUnauthenticatedGoldPath?: boolean;
};

function requestLocale(c: { req: { query: (key: string) => string | undefined; header: (key: string) => string | undefined } }): WorkHubLocale {
  return normalizeWorkHubLocale(c.req.query("locale") ?? c.req.header("Accept-Language"));
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
  return {
    ...data,
    items: data.items.filter((item) => {
      const id = item.source_ref.entity_type === "approval_request" ? item.source_ref.entity_id : item.id;
      return visibleRequestIds.has(id);
    }),
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
    return c.json(pageEnvelope(buildAttentionHomePage({ backgroundRuns: activeRuns, locale, worklog }), locale));
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
    const data = buildCostDashboardPage({
      settings,
      isAdmin: c.var.currentUser.isAdmin,
      userId: c.var.currentUser.id,
      locale,
      budgetUsages: decision.usages,
      ledgerEntries: ledgerStore.listEntries ? await ledgerStore.listEntries() : ledgerStore.entries
    });
    return c.json(pageEnvelope(data, locale));
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
