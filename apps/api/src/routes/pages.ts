import { Hono, type Context } from "hono";
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

import { isUuidParam } from "./uuid-param.js";

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
  getDefaultProjectHomePageService,
  ProjectHomePageServiceError,
  type ProjectHomePageService
} from "../services/project-home-pages.js";
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
  projectHomePages?: ProjectHomePageService;
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
  const proposals = deps.proposals ?? getDefaultProposalService();
  const queue = deps.queue ?? getDefaultAgentRunQueue();
  const policyStore = deps.policyStore ?? getDefaultBudgetPolicyStore();
  const ledgerStore = deps.ledgerStore ?? getDefaultCostLedgerStore();
  const workItems = deps.workItems ?? getDefaultWorkItemService();
  const drivePages = deps.drivePages ?? getDefaultDrivePageService();
  const projectHomePages = deps.projectHomePages ?? getDefaultProjectHomePageService();
  const meetingPages = deps.meetingPages ?? getDefaultMeetingPageService();
  const scheduleNotifyPages = deps.scheduleNotifyPages ?? createScheduleNotifyPageService();
  const projectHealthPages = deps.projectHealthPages ?? createProjectHealthPageService();
  const aiWorklog = deps.aiWorklog ?? getDefaultAiWorklogMetricsService();
  const teamSkills = deps.teamSkills ?? createTeamSkillRepository(getSharedDatabaseClient().db);

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
      const pending = await approvals.listPendingForUser(c.var.currentUser, { locale });
      // findings：决策队列要和 /approvals 一样按可读工作项过滤——否则被路由到的审批若其工作项不可读，
      // 卡片仍会在首页泄露事项信息。复用同一个 visibleApprovalCenter 收口。
      decisionQueue = (await visibleApprovalCenter(pending, workItems, c.var.actor)).items;
    } catch {
      decisionQueue = [];
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
    } catch {
      // 保留已有审批队列,不拖垮首页,但不能让用户误以为队列完整。
      sourceWarnings.push({
        source: "proposals",
        message: locale === "en-US"
          ? "Proposal reviews could not be loaded. Open Projects or retry."
          : "变更评审暂时加载失败。请打开项目页或稍后重试。"
      });
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
      throw new HTTPException(404, { message: "没有找到这个事项。" });
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
    return c.json(pageEnvelope(buildProposalDetailPage(proposal, locale), locale));
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
      const data = await drivePages.page({
        actor: c.var.actor,
        locale,
        ...(projectId ? { projectId } : {}),
        ...(itemId ? { itemId } : {})
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
            : ledgerStore.listEntries
              ? await ledgerStore.listEntries({ sinceBucket: costSinceBucket })
              : ledgerStore.entries)
      // routes-b-2/contracts-pkgs-4：非管理员回到按 { userId, teamId } 的窄 scope 查询——只取本人 user-scope
      // 条目并叠加工作区围栏（listEntriesForScopes 内部对 teamId 走子查询半连接，不拉全工作区）。
      : (ledgerStore.listEntriesForScopes
          ? await ledgerStore.listEntriesForScopes({ userId: c.var.currentUser.id, teamId }, { sinceBucket: costSinceBucket })
          // L[1]：非管理员且 store 未实现按 scope 查询时 fail-closed 返回空——绝不回退到 listEntries()/entries
          // （全组织账目）。跨租户读账目宁可空，也不能 fail-open 把别人的花费泄露给普通成员。
          : []);
    const data = buildCostDashboardPage({
      settings: tenantSettings,
      isAdmin: c.var.currentUser.isAdmin,
      userId: c.var.currentUser.id,
      teamId,
      locale,
      budgetUsages: decision.usages,
      budgetNotices: decision.notice ? [decision.notice] : [],
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
