import { WorkHubApiError, type WorkHubApiClient } from "@workhub/api-client";
import { fetchWorkspaceRosterMembers } from "./workspace-roster.js";
import type {
  AgentArmyDashboardVM,
  ApprovalCenterVM,
  AttentionHomeVM,
  CalendarPageVM,
  ConversationMessageVM,
  CostDashboardVM,
  DrivePageVM,
  EvidenceBubble,
  MeetingPageVM,
  NotificationPageVM,
  ProjectHealthPageVM,
  ProjectHomePageVM,
  ProjectListVM,
  ProjectTimelinePageVM,
  ProposalConflict,
  ProposalDetailVM,
  ReplayTraceVM,
  SessionVM,
  SettingsPageVM,
  TeamSkillsPageVM,
  WorkItemDetailVM,
  // R14 批 MEM（记忆可见可治理）：/settings/memory 两 tab 的管理面 VM。
  UserMemoryManagementPageVM,
  TeamSkillManagementPageVM
} from "@workhub/contracts";
import {
  goldPathCss,
  renderWebRouteComponent,
  renderWebProductShell,
  renderWebProductStateShell,
  type GoldPathAppShell,
  type GoldPathRenderedPage,
  type WebProductMetric,
  type WebProductShellCurrentUser,
  type WebProductShellPage,
  type WebProductShellSurface,
  type WebRouteComponent,
  type WebRouteComponentMap,
  type WebReactRouteComponentName,
  type WorkHubLocale
} from "@workhub/ui/gold-path";
import {
  renderRouteStateCard,
  routeStateCss,
  type R4WebRouteKey,
  type RouteStateKind
} from "@workhub/ui";

import { webT } from "./locales.js";
import { metricLabels, shellPageTitles } from "./routes-copy.js";

export type WebRouteLoadStatus = "idle" | "loading" | "ready" | "empty" | "error" | "forbidden" | "notFound";

export type WebRouteMatch = {
  key: R4WebRouteKey;
  pattern: string;
  pathname: string;
  search: string;
  params: Record<string, string>;
  notFound?: boolean;
};

export type WebRouteDefinition = {
  key: R4WebRouteKey;
  pattern: string;
  apiBaseLabel: string;
};

type WebRouteMatcher = WebRouteDefinition & {
  regex: RegExp;
  paramNames: readonly string[];
};

export type WebRouteReadyResult = {
  status: "ready";
  match: WebRouteMatch;
  html: string;
  shell: GoldPathAppShell;
  surface: WebRouteSurface;
};

export type WebRouteStateResult = {
  status: Exclude<WebRouteLoadStatus, "ready">;
  match: WebRouteMatch;
  html: string;
};

export type WebRouteLoadResult = WebRouteReadyResult | WebRouteStateResult;

export type WebRouteSurface =
  | { key: "home"; attention: AttentionHomeVM; projects?: ProjectListVM | undefined }
  | { key: "projects"; projects: ProjectListVM }
  | { key: "project-home"; project: ProjectHomePageVM }
  | { key: "project-timeline"; timeline: ProjectTimelinePageVM }
  | { key: "intake"; session: SessionVM }
  | { key: "intake"; start: true; project?: { id: string; name: string }; project_unavailable?: boolean; projects?: ProjectListVM | undefined }
  | { key: "approvals"; approvals: ApprovalCenterVM }
  | { key: "workitem"; workitem: WorkItemDetailVM }
  | { key: "proposal"; proposal: ProposalDetailVM; proposal_conflicts: ProposalConflict[]; proposal_conflicts_check_failed?: boolean | undefined }
  | {
      key: "conversation";
      conversationId: string;
      messages: ConversationMessageVM[];
      members: Array<{ id: string; nickname: string }>;
      targetSeq?: number | undefined;
      olderBeforeSeq?: number | undefined;
      newerAfterSeq?: number | undefined;
      isLatest: boolean;
      refreshHref: string;
    }
  | { key: "drive"; drive: DrivePageVM; projects: ProjectListVM }
  | { key: "meetings"; meetings: MeetingPageVM; projects?: ProjectListVM }
  | { key: "notifications"; notifications: NotificationPageVM }
  | { key: "calendar"; calendar: CalendarPageVM }
  | { key: "health"; health: ProjectHealthPageVM }
  | { key: "replay"; replay: ReplayTraceVM }
  | { key: "cost"; cost: CostDashboardVM }
  | { key: "agents"; agents: AgentArmyDashboardVM }
  | { key: "knowledge"; evidence: EvidenceBubble; source_ref?: string | undefined; scope_landing?: boolean | undefined; projects?: ProjectListVM | undefined }
  // R14 批 SEARCH（web-search-page）：搜索页服务端只透传 URL 里的 ?q=，不在服务端拉结果——结果由
  // 客户端 route-component fetch GET /api/search 后注入（见 02-search-design.md §7 拍板）。
  | { key: "search"; q?: string | undefined }
  | { key: "skills"; skills: TeamSkillsPageVM }
  | { key: "settings"; settings: SettingsPageVM }
  | { key: "memory"; tab: "profile" | "skills"; userMemories: UserMemoryManagementPageVM; teamSkills: TeamSkillManagementPageVM };

const routeMatchers = [
  {
    key: "home",
    pattern: "/",
    apiBaseLabel: "/api/pages/attention",
    regex: /^\/(?:attention)?$/u,
    paramNames: []
  },
  {
    key: "projects",
    pattern: "/projects",
    apiBaseLabel: "/api/projects",
    regex: /^\/projects\/?(?:\?.*)?$/u,
    paramNames: []
  },
  {
    key: "project-home",
    pattern: "/projects/:id",
    apiBaseLabel: "/api/pages/project/:id",
    regex: /^\/projects\/([^/]+)$/u,
    paramNames: ["id"]
  },
  {
    // R15 批 E2c：项目时间线只读页。锚定 /projects/:id/timeline——正则带 /timeline 后缀，不会与
    // project-home（^/projects/:id$）相撞。
    key: "project-timeline",
    pattern: "/projects/:id/timeline",
    apiBaseLabel: "/api/pages/project/:id/timeline",
    regex: /^\/projects\/([^/]+)\/timeline$/u,
    paramNames: ["id"]
  },
  {
    key: "intake",
    pattern: "/intake/:sessionId",
    apiBaseLabel: "/api/sessions",
    regex: /^\/intake(?:\/([^/]+))?$/u,
    paramNames: ["sessionId"]
  },
  {
    key: "approvals",
    pattern: "/approvals",
    apiBaseLabel: "/api/pages/approvals",
    regex: /^\/approvals$/u,
    paramNames: []
  },
  {
    key: "workitem",
    pattern: "/workitems/:id",
    apiBaseLabel: "/api/pages/workitems/:id",
    regex: /^\/workitems\/([^/]+)$/u,
    paramNames: ["id"]
  },
  {
    key: "proposal",
    pattern: "/proposals/:id",
    apiBaseLabel: "/api/pages/proposals/:id",
    regex: /^\/proposals\/([^/]+)$/u,
    paramNames: ["id"]
  },
  {
    // R15 批 web-mirror：只读会话镜像。消费既有会话消息读端点（参与者门控在服务端）。
    key: "conversation",
    pattern: "/conversations/:id",
    apiBaseLabel: "/api/conversations/:id/messages",
    regex: /^\/conversations\/([^/]+)$/u,
    paramNames: ["id"]
  },
  {
    key: "drive",
    pattern: "/drive",
    apiBaseLabel: "/api/pages/drive",
    regex: /^\/drive$/u,
    paramNames: []
  },
  {
    key: "meetings",
    pattern: "/meetings",
    apiBaseLabel: "/api/pages/meetings",
    regex: /^\/meetings$/u,
    paramNames: []
  },
  {
    key: "notifications",
    pattern: "/notifications",
    apiBaseLabel: "/api/pages/notifications",
    regex: /^\/notifications$/u,
    paramNames: []
  },
  {
    key: "calendar",
    pattern: "/calendar",
    apiBaseLabel: "/api/pages/calendar",
    regex: /^\/calendar$/u,
    paramNames: []
  },
  {
    key: "health",
    pattern: "/dashboard/health",
    apiBaseLabel: "/api/pages/health",
    regex: /^\/dashboard\/health$/u,
    paramNames: []
  },
  {
    key: "replay",
    pattern: "/agent-runs/:id/replay",
    apiBaseLabel: "/api/agent-runs/:id/replay",
    regex: /^\/agent-runs\/([^/]+)\/replay$/u,
    paramNames: ["id"]
  },
  {
    key: "cost",
    pattern: "/dashboard/cost",
    apiBaseLabel: "/api/pages/cost",
    regex: /^\/dashboard\/cost$/u,
    paramNames: []
  },
  {
    key: "agents",
    pattern: "/dashboard/agents",
    apiBaseLabel: "/api/pages/agents",
    regex: /^\/dashboard\/agents$/u,
    paramNames: []
  },
  {
    key: "knowledge",
    pattern: "/knowledge/search",
    apiBaseLabel: "/api/knowledge/search",
    regex: /^\/knowledge(?:\/search)?$/u,
    paramNames: []
  },
  {
    key: "search",
    pattern: "/dashboard/search",
    apiBaseLabel: "/api/search",
    regex: /^\/dashboard\/search$/u,
    paramNames: []
  },
  {
    key: "skills",
    pattern: "/dashboard/skills",
    apiBaseLabel: "/api/pages/skills",
    regex: /^\/dashboard\/skills$/u,
    paramNames: []
  },
  {
    key: "settings",
    pattern: "/settings",
    apiBaseLabel: "/settings",
    regex: /^\/settings$/u,
    paramNames: []
  },
  {
    // R14 批 MEM（记忆可见可治理）：两 tab（关于我/团队技能）用 ?tab= query 切换，不分裂路由——
    // 正则只锚定 pathname，query 由 loadRouteSurface 自己解析（同 knowledge/calendar 既有口径）。
    key: "memory",
    pattern: "/settings/memory",
    apiBaseLabel: "/api/me/memories",
    regex: /^\/settings\/memory$/u,
    paramNames: []
  }
] as const satisfies readonly WebRouteMatcher[];

export const webRouteRegistry: readonly WebRouteDefinition[] = routeMatchers.map((route) => ({
  key: route.key,
  pattern: route.pattern,
  apiBaseLabel: route.apiBaseLabel
}));

type WebRouteTreePageVm =
  | "attention"
  | "projects"
  | "project-home"
  | "project-timeline"
  | "session"
  | "approvals"
  | "workitem"
  | "proposal"
  | "conversation"
  | "drive"
  | "meetings"
  | "notifications"
  | "calendar"
  | "health"
  | "replay"
  | "cost"
  | "agents"
  | "evidence"
  | "search"
  | "skills"
  | "settings"
  | "memory";

export type WebReactRouteTreeNode = WebRouteDefinition & {
  hydration: {
    enabled: true;
    mode: "html-fallback";
    adapter: "route-component-v1";
    pageVm: WebRouteTreePageVm;
    activeOnly: true;
    reactComponent?: {
      componentName: WebReactRouteComponentName;
      adapter: "react-compatible-route-component-v1";
      propsSource: "typed-page-vm";
      htmlFallback: true;
      mode: "html-fallback";
    };
    runtimeMount?: {
      enabled: true;
      strategy: "react-18-createRoot-probe" | "react-18-visible-mutation-editor";
      routeKey: "home" | "proposal";
      componentName: "HomeRouteComponent" | "ProposalMutationEditor";
      fallbackPreserved: true;
      propsUpdate: "sse-react-render" | "dirty-guard-preserves-controlled-state";
      dispatcher: "delegated-click-bubble";
      mutationEditor?: "structured-field-scalar";
      lineEditor?: "text-hunk";
    };
  };
};

const routeTreePageVmByKey = {
  home: "attention",
  projects: "projects",
  "project-home": "project-home",
  "project-timeline": "project-timeline",
  intake: "session",
  approvals: "approvals",
  workitem: "workitem",
  proposal: "proposal",
  conversation: "conversation",
  drive: "drive",
  meetings: "meetings",
  notifications: "notifications",
  calendar: "calendar",
  health: "health",
  replay: "replay",
  cost: "cost",
  agents: "agents",
  knowledge: "evidence",
  search: "search",
  skills: "skills",
  settings: "settings",
  memory: "memory"
} satisfies Record<R4WebRouteKey, WebRouteTreePageVm>;

const routeTreeReactComponentByKey: Partial<Record<R4WebRouteKey, WebReactRouteComponentName>> = {
  home: "HomeRouteComponent",
  proposal: "ProposalRouteComponent",
  replay: "ReplayRouteComponent",
  cost: "CostRouteComponent",
  settings: "SettingsRouteComponent"
};

const routeTreeRuntimeMountByKey: Partial<Record<R4WebRouteKey, WebReactRouteTreeNode["hydration"]["runtimeMount"]>> = {
  home: {
    enabled: true,
    strategy: "react-18-createRoot-probe",
    routeKey: "home",
    componentName: "HomeRouteComponent",
    fallbackPreserved: true,
    propsUpdate: "sse-react-render",
    dispatcher: "delegated-click-bubble"
  },
  proposal: {
    enabled: true,
    strategy: "react-18-visible-mutation-editor",
    routeKey: "proposal",
    componentName: "ProposalMutationEditor",
    fallbackPreserved: true,
    propsUpdate: "dirty-guard-preserves-controlled-state",
    dispatcher: "delegated-click-bubble",
    mutationEditor: "structured-field-scalar",
    lineEditor: "text-hunk"
  }
};

export const webReactRouteTree: readonly WebReactRouteTreeNode[] = webRouteRegistry.map((route) => {
  const componentName = routeTreeReactComponentByKey[route.key];
  const runtimeMount = routeTreeRuntimeMountByKey[route.key];
  return {
    ...route,
    hydration: {
      enabled: true,
      mode: "html-fallback",
      adapter: "route-component-v1",
      pageVm: routeTreePageVmByKey[route.key],
      activeOnly: true,
      ...(componentName
        ? {
          reactComponent: {
            componentName,
            adapter: "react-compatible-route-component-v1",
            propsSource: "typed-page-vm",
            htmlFallback: true,
            mode: "html-fallback"
          }
        }
        : {}),
      ...(runtimeMount ? { runtimeMount } : {})
    }
  };
});

const webRouteStateScreenCss = [
  "body{margin:0;background:#f6f9fd;color:#172033;overflow-x:hidden}",
  ".wh-web-route-state-screen{min-height:100vh;display:grid;place-items:center;padding:24px;font-family:\"Aptos\",\"Segoe UI\",sans-serif;background:linear-gradient(180deg,#fbfdff 0%,#edf4fb 100%);box-sizing:border-box}",
  ".wh-web-route-state-screen,.wh-web-route-state-screen *{box-sizing:border-box}",
  ".wh-web-route-state-wrap{width:min(560px,100%);display:grid;gap:12px;min-width:0}",
  ".wh-web-route-state-meta{display:flex;gap:8px;align-items:center;justify-content:space-between;min-width:0;flex-wrap:wrap;color:#66728c;font-size:12px;font-weight:800}",
  ".wh-web-route-state-meta span{min-width:0;overflow-wrap:anywhere}",
  ".wh-web-route-state-home{color:#4f46e5;text-decoration:none;font-weight:850}.wh-web-route-state-home:hover{text-decoration:underline}"
].join("");

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    // findings: 与 @workhub/web-runtime 的规范 escapeHtml 对齐，补单引号转义（单引号属性场景防注入）。
    .replace(/'/gu, "&#39;");
}

function normalizePathname(input: string) {
  const parsed = new URL(input || "/", "https://workhub.local");
  const pathname = parsed.pathname || "/";
  if (pathname.length > 1 && pathname.endsWith("/")) {
    return pathname.slice(0, -1);
  }
  return pathname;
}

function normalizeSearch(input: string) {
  const parsed = new URL(input || "/", "https://workhub.local");
  return parsed.search;
}

function decodeParam(value: string | undefined) {
  if (!value) {
    return "";
  }
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function resolveWebRoute(input: string): WebRouteMatch | undefined {
  const pathname = normalizePathname(input);
  for (const route of routeMatchers) {
    const match = route.regex.exec(pathname);
    if (!match) {
      continue;
    }
    const params = Object.fromEntries(
      route.paramNames.map((name, index) => [name, decodeParam(match[index + 1])])
    );
    return {
      key: route.key,
      pattern: route.pattern,
      pathname,
      search: normalizeSearch(input),
      params
    };
  }
  return undefined;
}

export function createUnknownWebRouteMatch(input: string): WebRouteMatch {
  return {
    key: "home",
    pattern: "*",
    pathname: normalizePathname(input),
    search: normalizeSearch(input),
    params: {},
    notFound: true
  };
}

export function webRouteHref(input: string) {
  const parsed = new URL(input, "https://workhub.local");
  if (parsed.hash.startsWith("#/")) {
    const hashRoute = new URL(parsed.hash.slice(1), "https://workhub.local");
    return `${normalizePathname(hashRoute.pathname)}${hashRoute.search}`;
  }
  return `${normalizePathname(parsed.pathname)}${parsed.search}`;
}

function apiLabelFor(match: WebRouteMatch) {
  return routeMatchers.find((route) => route.key === match.key)?.apiBaseLabel ?? match.pattern;
}

function routeTreeNodeFor(match: WebRouteMatch) {
  return webReactRouteTree.find((route) => route.key === match.key);
}

function withLocale(locale: WorkHubLocale) {
  return { locale };
}

function nonnegativeIntSearchParam(search: string, key: string): number | undefined {
  const raw = new URLSearchParams(search).get(key);
  if (raw === null) {
    return undefined;
  }
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function positiveIntSearchParam(search: string, key: string): number | undefined {
  const parsed = nonnegativeIntSearchParam(search, key);
  return parsed && parsed > 0 ? parsed : undefined;
}

function approvalPageOptions(match: WebRouteMatch, locale: WorkHubLocale) {
  const offset = nonnegativeIntSearchParam(match.search, "offset");
  const limit = positiveIntSearchParam(match.search, "limit");
  return {
    ...withLocale(locale),
    ...(offset === undefined ? {} : { offset }),
    ...(limit === undefined ? {} : { limit })
  };
}

const shellPageOrder = [
  "home",
  "projects",
  "project-home",
  // R15 批 E2c：时间线是 project-home 的下钻（detail-only），紧邻它。
  "project-timeline",
  "intake",
  "approvals",
  "workitem",
  "proposal",
  // R15 批 web-mirror：只读会话镜像是 detail-only 页（仅激活时出现在壳导航），紧邻 proposal——
  // 与 product-shell.ts productNavGroups 的 "work" 组顺序一致。
  "conversation",
  "drive",
  "meetings",
  "notifications",
  "calendar",
  "health",
  // R14 批 MEM：紧邻 team 组内其余成员（notifications/calendar/health），与 product-shell.ts 的
  // nav 分组顺序保持一致（见 productNavGroups 的 "team" 组）。
  "memory",
  "replay",
  "cost",
  "agents",
  "knowledge",
  "search",
  "skills",
  "settings"
] as const satisfies readonly GoldPathRenderedPage["key"][];

// intake 不算 detail-only：/intake（无 sessionId）就是"提需求"起点页，应常驻导航,让用户随处可发起新活。
const detailOnlyShellPages = new Set<GoldPathRenderedPage["key"]>([
  "project-home",
  "project-timeline",
  "workitem",
  "proposal",
  "conversation",
  "replay"
]);

const shellDefaultRoutes = {
  home: "/",
  projects: "/projects",
  "project-home": "/projects",
  "project-timeline": "/projects",
  intake: "/intake",
  approvals: "/approvals",
  workitem: "/",
  proposal: "/approvals",
  // 会话镜像无 web 列表页——非激活时的兜底回链回首页（同 workitem/replay）。
  conversation: "/",
  drive: "/drive",
  meetings: "/meetings",
  notifications: "/notifications",
  calendar: "/calendar",
  health: "/dashboard/health",
  replay: "/",
  cost: "/dashboard/cost",
  agents: "/dashboard/agents",
  knowledge: "/knowledge/search",
  search: "/dashboard/search",
  skills: "/dashboard/skills",
  settings: "/settings",
  memory: "/settings/memory"
} satisfies Record<GoldPathRenderedPage["key"], string>;


function metric(locale: WorkHubLocale, id: string, value: string): WebProductMetric {
  return {
    id,
    label: metricLabels[locale][id] ?? id,
    value
  };
}

function routeForShellPage(key: GoldPathRenderedPage["key"], match: WebRouteMatch) {
  return key === match.key ? match.pathname : shellDefaultRoutes[key];
}

function shellPageOrderFor(match: WebRouteMatch) {
  return shellPageOrder.filter((key) => !detailOnlyShellPages.has(key) || key === match.key);
}

function shellPagesFor(match: WebRouteMatch, locale: WorkHubLocale, activeMetrics: WebProductMetric[]): WebProductShellPage[] {
  return shellPageOrderFor(match).map((key) => ({
    key,
    route: routeForShellPage(key, match),
    title: shellPageTitles[locale][key],
    html: "",
    primaryHrefs: [],
    cuuState: key === "knowledge" ? "searching_evidence" : "idle",
    ...(key === match.key ? { metrics: activeMetrics } : {})
  }));
}

function metricsForSurface(surface: WebRouteSurface, locale: WorkHubLocale): WebProductMetric[] {
  if (surface.key === "home") {
    // queue chip 与组件正文同口径：live /api 把 primary=queue[0] 留在 queue 里，chip 若直接用 queue.length
    // 会和 Focus(=1) 叠成「Focus 1 · Queue 3」诱导 1+3=4 误读。去掉首决策后只数其余队列。
    const primaryId = surface.attention.primary?.id;
    const queueRest = primaryId
      ? surface.attention.queue.filter((item) => item.id !== primaryId).length
      : surface.attention.queue.length;
    // 「AI 正在做」只数真正在跑的(running/queued)；background_runs 还含 failed / waiting_for_user，
    // 否则 chip 显「3 在做」而正文药丸却标着一条失败、一条等你——把不在做的也算进去了。
    const workingRuns = surface.attention.background_runs.filter(
      (run) => run.state === "running" || run.state === "queued"
    ).length;
    // P1-07：项目清单是独立于 attention 的并行拉取。加载失败时 surface.projects 为 undefined——此时
    // 项目数/开放事项是「未知」而非「零」，用「—」占位、不参与零值统计，避免把「加载失败」谎报成「你没有项目」。
    const projectsLoaded = surface.projects !== undefined;
    const dash = "—";
    const projectCount = projectsLoaded ? String(surface.projects!.projects.length) : dash;
    const openItems = projectsLoaded
      ? String(surface.projects!.projects.reduce((sum, project) => sum + project.open_work_item_count, 0))
      : dash;
    return [
      metric(locale, "projects", projectCount),
      metric(locale, "openwork", openItems),
      metric(locale, "attention", String(workingRuns + queueRest + (surface.attention.primary ? 1 : 0)))
    ];
  }
  if (surface.key === "projects") {
    const openItems = surface.projects.projects.reduce((sum, project) => sum + project.open_work_item_count, 0);
    // 「已归档」chip 此前恒为 0：listForWorkspace 硬过滤 archived=false 且没有任何归档动作会置 true，
    // 是个结构性死指标。换成「有进展的项目数」(有进行中工作的项目)，一个真实、非零、不撞词的事实。
    const activeProjects = surface.projects.projects.filter((project) => project.open_work_item_count > 0).length;
    return [
      metric(locale, "projects", String(surface.projects.projects.length)),
      metric(locale, "openwork", String(openItems)),
      metric(locale, "activeProjects", String(activeProjects))
    ];
  }
  if (surface.key === "project-home") {
    const zh = locale === "zh-CN";
    // L5：这条 masthead 速览原本是 [进行中 N · 状态=进行中 · 负责人 X]——「进行中」在同一条里出现两次
    // (开放计数 vs 项目状态)，且开放计数和负责人在下方页头 pill 已经各显示了一遍，读起来像冗余噪音。
    // 改为三个互不重复、页头没有的事实：进行中数、文件数、项目状态(活跃中/已归档，不再与开放计数撞词)。
    // M5 续：进行中 chip 必须与页头「进行中 N · 你可处理 M」的头条数 N 同口径(全量 total_open_work_item_count)，
    // 否则 chip 显可见数(1)、页头显全量(16)→同一页两个「进行中」数字打架，一无所知用户读不懂到底几件在进行。
    return [
      metric(
        locale,
        "openwork",
        String(surface.project.summary.total_open_work_item_count ?? surface.project.summary.open_work_item_count)
      ),
      metric(locale, "files", String(surface.project.drive.file_count)),
      metric(locale, "status", surface.project.project.status === "archived" ? (webT(locale, "archived")) : (webT(locale, "active")))
    ];
  }
  if (surface.key === "project-timeline") {
    // 只读时间线速览：里程碑数 / 工作项数 / 逾期数（后者与正文关键路径同口径）。
    const overdue = surface.timeline.items.filter((item) => item.overdue).length;
    return [
      metric(locale, "milestones", String(surface.timeline.milestones.length)),
      metric(locale, "events", String(surface.timeline.items.length)),
      metric(locale, "overdue", String(overdue))
    ];
  }
  if (surface.key === "intake") {
    if ("start" in surface) {
      // runtime 指示当前接入起点：绑定项目时显示项目名(截断，避免长 CJK 名撑爆 chip)，否则「试点/Pilot」。
      const intakeRuntime = surface.project
        ? (surface.project.name.length > 16 ? `${surface.project.name.slice(0, 15)}…` : surface.project.name)
        : (webT(locale, "pilot"));
      return [
        metric(locale, "options", "0"),
        metric(locale, "queue", webT(locale, "start")),
        metric(locale, "runtime", intakeRuntime)
      ];
    }
    // 普通用户审查：原样渲 input_mode 枚举（long_text）与 session UUID 是黑话泄漏——换人话。
    const stageLabel = surface.session.question.input_mode === "confirm"
      ? (webT(locale, "confirm2"))
      : (webT(locale, "qA"));
    return [
      ...(surface.session.question.options.length > 0
        ? [metric(locale, "options", String(surface.session.question.options.length))]
        : []),
      metric(locale, "queue", stageLabel),
      metric(locale, "runtime", webT(locale, "clarifying"))
    ];
  }
  if (surface.key === "approvals") {
    return [
      metric(locale, "pending", String(surface.approvals.counts.pending ?? surface.approvals.items.length)),
      metric(locale, "requests", String(surface.approvals.requests.length)),
      metric(locale, "queue", String(surface.approvals.items.length))
    ];
  }
  if (surface.key === "workitem") {
    return [
      metric(locale, "trace", String(surface.workitem.agent_trace_preview.length)),
      // chip 口径是「已采纳交付物」(accepted_deliverables)，而卡片正文列的是 AI 提议的改动(未采纳)。
      // 用 acceptedDeliverables 标签让 chip 不再和卡片标题撞「交付物」却数字对不上。
      metric(locale, "acceptedDeliverables", String(surface.workitem.accepted_deliverables.length)),
      metric(locale, "evidence", String(surface.workitem.evidence_refs.length))
    ];
  }
  if (surface.key === "proposal") {
    return [
      metric(locale, "checks", String(surface.proposal.manifest.checks.length)),
      metric(locale, "evidence", String(surface.proposal.evidence_refs.length)),
      metric(locale, "comments", String(surface.proposal.comments.length))
    ];
  }
  if (surface.key === "conversation") {
    // 只读镜像 masthead：本页拉到的消息条数 + 「只读镜像」状态（诚实标注：这是镜像，不是全量）。
    return [
      metric(locale, "messages", String(surface.messages.length)),
      metric(locale, "runtime", webT(locale, "readOnly"))
    ];
  }
  if (surface.key === "drive") {
    return [
      metric(locale, "files", String(surface.drive.summary.file_count)),
      metric(locale, "versions", String(surface.drive.summary.version_count)),
      metric(locale, "deliverables", String(surface.drive.summary.accepted_deliverable_count))
    ];
  }
  if (surface.key === "meetings") {
    return [
      metric(locale, "meetings", String(surface.meetings.summary.meeting_count)),
      metric(locale, "pending", String(surface.meetings.summary.pending_insight_count)),
      // 这个 chip 是「已处理(确认+忽略)」洞察数，旁边已有 pending chip；旧标签「洞察」会被读成总数(和正文洞察清单打架)。
      metric(locale, "resolvedInsights", String(surface.meetings.summary.confirmed_insight_count + surface.meetings.summary.dismissed_insight_count))
    ];
  }
  if (surface.key === "notifications") {
    return [
      // 这一项就是正文「需要你决定」桶的计数；旧标签「待处理」(和审批/会议共用)让用户看不出是同一队列。
      metric(locale, "needsDecision", String(surface.notifications.summary.needs_decision_count)),
      metric(locale, "unread", String(surface.notifications.summary.unread_count)),
      metric(locale, "done", String(surface.notifications.summary.done_count))
    ];
  }
  if (surface.key === "calendar") {
    return [
      metric(locale, "today", String(surface.calendar.summary.today_count)),
      metric(locale, "overdue", String(surface.calendar.summary.overdue_count)),
      metric(locale, "events", String(surface.calendar.summary.block_count))
    ];
  }
  if (surface.key === "health") {
    return [
      metric(locale, "projects", String(surface.health.summary.project_count)),
      metric(locale, "attention", String(surface.health.summary.attention_count)),
      metric(locale, "critical", String(surface.health.summary.critical_count))
    ];
  }
  if (surface.key === "replay") {
    return [
      metric(locale, "steps", String(surface.replay.steps.length)),
      metric(locale, "decisions", String(surface.replay.merge_timeline.length)),
      metric(locale, "snapshots", String(surface.replay.snapshots.length))
    ];
  }
  if (surface.key === "cost") {
    const tokens = surface.cost.token_in + surface.cost.token_out;
    return [
      metric(locale, "tokens", String(tokens)),
      metric(locale, "cost", surface.cost.currency === "CNY" ? `¥${surface.cost.total_cost_cny}` : surface.cost.total_cost_cny),
      metric(locale, "budget", String(surface.cost.budget.length))
    ];
  }
  if (surface.key === "agents") {
    // R5（视觉层级）：正文 KPI 四卡（带口径注解与落点）是权威版本——masthead 不再复读同名三数，
    // 只留一条独有补充（今日成本），避免同屏三处渲染同一批计数。
    return [
      metric(locale, "cost", surface.agents.kpis.today_cost_cny ? `¥${surface.agents.kpis.today_cost_cny}` : "¥0")
    ];
  }
  if (surface.key === "knowledge") {
    return [
      metric(locale, "refs", String(surface.evidence.evidence_refs.length)),
      metric(locale, "evidence", surface.evidence.missing_evidence_note ? (webT(locale, "missing")) : (webT(locale, "found")))
    ];
  }
  if (surface.key === "search") {
    // 服务端只知道 URL 里的 q（结果由客户端拉取），masthead 如实只报「当前搜索词」，
    // 不编造结果计数（那要等客户端 fetch 完才知道）。
    return [
      metric(locale, "query", surface.q && surface.q.length > 0 ? surface.q : (webT(locale, "notSet2")))
    ];
  }
  if (surface.key === "skills") {
    // 旧代码复用了首页的 primary/queue/running 标签(焦点/队列/后台)，在技能页是彻底错的标签。
    return [
      metric(locale, "skillsActive", String(surface.skills.totals.active)),
      metric(locale, "skillsRefined", String(surface.skills.totals.refined)),
      metric(locale, "skillsAiAuthored", String(surface.skills.totals.ai_authored))
    ];
  }
  if (surface.key === "memory") {
    const deprecatedCount = surface.teamSkills.skills.filter((skill) => skill.status === "deprecated").length;
    return [
      metric(locale, "memoriesActive", String(surface.userMemories.totals.active)),
      metric(locale, "skillsActive", String(surface.teamSkills.skills.filter((skill) => skill.status === "active").length)),
      metric(locale, "skillsDeprecated", String(deprecatedCount))
    ];
  }
  return [
    metric(locale, "runtime", surface.settings.runtime.app_env),
    metric(locale, "queue", surface.settings.runtime.broker_backend),
    metric(locale, "primary", surface.settings.locale)
  ];
}

function routeComponentForSurface(surface: WebRouteSurface, locale: WorkHubLocale, isAdmin: boolean = false): WebRouteComponent {
  if (surface.key === "home") {
    return renderWebRouteComponent({ key: "home", attention: surface.attention, projects: surface.projects }, { locale });
  }
  if (surface.key === "projects") {
    return renderWebRouteComponent({ key: "projects", projects: surface.projects }, { locale });
  }
  if (surface.key === "project-home") {
    return renderWebRouteComponent({ key: "project-home", project: surface.project }, { locale });
  }
  if (surface.key === "project-timeline") {
    return renderWebRouteComponent({ key: "project-timeline", timeline: surface.timeline }, { locale });
  }
  if (surface.key === "intake") {
    if ("start" in surface) {
      return renderWebRouteComponent(
        {
          key: "intake",
          start: true,
          ...(surface.project ? { project: surface.project } : {}),
          ...(surface.project_unavailable ? { projectUnavailable: true } : {}),
          ...(surface.projects ? { projects: surface.projects } : {})
        },
        { locale }
      );
    }
    return renderWebRouteComponent({ key: "intake", session: surface.session }, { locale });
  }
  if (surface.key === "approvals") {
    return renderWebRouteComponent({ key: "approvals", approvals: surface.approvals }, { locale });
  }
  if (surface.key === "workitem") {
    return renderWebRouteComponent({ key: "workitem", workitem: surface.workitem }, { locale });
  }
  if (surface.key === "proposal") {
    return renderWebRouteComponent({
      key: "proposal",
      proposal: surface.proposal,
      proposalConflicts: surface.proposal_conflicts,
      proposalConflictsCheckFailed: surface.proposal_conflicts_check_failed ?? false
    }, { locale });
  }
  if (surface.key === "conversation") {
    return renderWebRouteComponent({
      key: "conversation",
      conversation: {
        conversationId: surface.conversationId,
        messages: surface.messages,
        members: surface.members,
        ...(surface.targetSeq !== undefined ? { targetSeq: surface.targetSeq } : {}),
        ...(surface.olderBeforeSeq !== undefined ? { olderBeforeSeq: surface.olderBeforeSeq } : {}),
        ...(surface.newerAfterSeq !== undefined ? { newerAfterSeq: surface.newerAfterSeq } : {}),
        isLatest: surface.isLatest,
        refreshHref: surface.refreshHref
      }
    }, { locale });
  }
  if (surface.key === "drive") {
    return renderWebRouteComponent({ key: "drive", drive: surface.drive, projects: surface.projects }, { locale });
  }
  if (surface.key === "meetings") {
    return renderWebRouteComponent({ key: "meetings", meetings: surface.meetings, projects: surface.projects }, { locale });
  }
  if (surface.key === "notifications") {
    return renderWebRouteComponent({ key: "notifications", notifications: surface.notifications }, { locale });
  }
  if (surface.key === "calendar") {
    return renderWebRouteComponent({ key: "calendar", calendar: surface.calendar }, { locale });
  }
  if (surface.key === "health") {
    return renderWebRouteComponent({ key: "health", health: surface.health }, { locale });
  }
  if (surface.key === "replay") {
    return renderWebRouteComponent({ key: "replay", replay: surface.replay }, { locale });
  }
  if (surface.key === "cost") {
    return renderWebRouteComponent({ key: "cost", cost: surface.cost }, { locale });
  }
  if (surface.key === "agents") {
    return renderWebRouteComponent({ key: "agents", agents: surface.agents }, { locale });
  }
  if (surface.key === "knowledge") {
    return renderWebRouteComponent({ key: "knowledge", evidence: surface.evidence, sourceRef: surface.source_ref, scopeLanding: surface.scope_landing, projects: surface.projects }, { locale });
  }
  if (surface.key === "search") {
    return renderWebRouteComponent({ key: "search", q: surface.q }, { locale });
  }
  if (surface.key === "skills") {
    // R23 SA-06：isAdmin 决定「立即自学一轮」按钮要不要渲——与团队技能治理 tab 同一条通路（登录态，
    // 非页面 VM）。服务端仍独立判定，前端只是不给非管理员送一次注定 403 的点击。
    return renderWebRouteComponent({ key: "skills", skills: surface.skills, isAdmin }, { locale });
  }
  if (surface.key === "memory") {
    // isAdmin 决定团队技能 tab 的编辑/停用按钮要不要渲——从 shellUser（登录态，SSR 阶段已知）取，
    // 不是从页面 VM 取（同现有 topbar 管理员徽标同一条已验证过的通路，见 03-mem-design §6.1）。
    return renderWebRouteComponent({
      key: "memory",
      memory: { userMemories: surface.userMemories, teamSkills: surface.teamSkills, tab: surface.tab, isAdmin }
    }, { locale });
  }
  return renderWebRouteComponent({ key: "settings", settings: surface.settings, isAdmin }, { locale });
}

function routeComponentsForSurface(surface: WebRouteSurface, locale: WorkHubLocale, isAdmin: boolean): WebRouteComponentMap {
  return {
    [surface.key]: routeComponentForSurface(surface, locale, isAdmin)
  };
}

function shellSurfaceFor(surface: WebRouteSurface, match: WebRouteMatch, locale: WorkHubLocale): WebProductShellSurface {
  return {
    surface: "web",
    fixtureId: "web-route-shell-v1",
    css: goldPathCss,
    pages: shellPagesFor(match, locale, metricsForSurface(surface, locale))
  };
}

function isReplayEmpty(data: ReplayTraceVM) {
  return data.steps.length === 0 && !data.run.handoff_md && !data.run.outcome_reason;
}

// A recoverable empty state whose copy + back link are tailored by the loader using data
// only available after the fetch (e.g. an empty replay's parent work-item id). Distinct
// from the bare "empty" status, which routeStateBackHref/CopyOverride resolve from the URL.
type TailoredEmptyRouteState = {
  status: "empty";
  actionHref: string;
  actionLabel?: string;
  titleOverride?: string;
  bodyOverride?: string;
};

function isTailoredEmptyRouteState(result: unknown): result is TailoredEmptyRouteState {
  return typeof result === "object"
    && result !== null
    && (result as { status?: unknown }).status === "empty"
    && typeof (result as { actionHref?: unknown }).actionHref === "string";
}

// F15/簇A：顶部导航「知识」→ /knowledge/search 无锚点时,后端对非管理员 403(防跨项目泄露知识库)。
// 别让 403 塌成无外壳的裸态把用户困死——合成一个「需要选范围」的知识库落地 bubble,照常在外壳内渲染
// (保留左导航 + 搜索框 + 指引),引导用户进入具体项目/工作项检索。管理员的全局检索仍走真 API,不受影响。
function knowledgeScopeLandingBubble(query: string | undefined, locale: WorkHubLocale): EvidenceBubble {
  return {
    id: "70000000-0000-4000-8000-0000000000a1",
    ...(query ? { query_text: query } : {}),
    summary_text: locale === "en-US"
      ? "Knowledge search is scoped to a project or work item. Open a project from the left nav, or a work item's Evidence, to search within it."
      : "知识库检索需要锚定具体项目或工作项。从左侧「项目」进入某个项目，或打开某个工作项的「证据」，即可在其范围内检索。",
    evidence_refs: [],
    missing_evidence_note: locale === "en-US"
      ? "Pick a project or work item to see its evidence."
      : "选择一个项目或工作项，就能看到它的证据。",
    actions: []
  };
}

// G-web 止血批：home/projects/drive/meetings/知识 403 落地页/intake 起点六处路由分支各自独立调用
// client.listProjects()——当两次导航前后脚打进来(比如上一次还没落地,用户又点了别的导航项)，会并发
// 撞出多个一模一样的 GET /api/projects。这里只做 Promise 级 in-flight 去重：同一时刻只放行一个
// 真实请求，其余等它落地共享结果；请求一落地(无论成功失败)就清空，绝不做 TTL 缓存——不违反
// 「每次导航都要新鲜数据」的既有纪律，下一次导航仍会发出全新请求。按 client 实例隔离，避免测试里
// 不同 fake client 之间串味。
const listProjectsInFlight = new WeakMap<WorkHubApiClient, Promise<ProjectListVM>>();

function listProjectsDeduped(client: WorkHubApiClient): Promise<ProjectListVM> {
  const inFlight = listProjectsInFlight.get(client);
  if (inFlight) {
    return inFlight;
  }
  const request = client.listProjects().finally(() => {
    listProjectsInFlight.delete(client);
  });
  listProjectsInFlight.set(client, request);
  return request;
}

async function loadRouteSurface(client: WorkHubApiClient, match: WebRouteMatch, locale: WorkHubLocale) {
  if (match.notFound) {
    // 未匹配的 URL(打错/失效链接)= 找不到,不是服务器出错。给「没有找到这个页面」+ 回首页,
    // 而不是「页面加载失败 / 重试」(Retry 会反复重撞同一条死链)。
    return "notFound" as const;
  }
  if (match.key === "home") {
    // 首页是项目工作台,不是 AI 收件箱孤岛：先展示项目/网盘入口,再把待决策和后台运行作为运营队列露出。
    // 项目清单是次要数据,拉取失败不应把已可用的决策队列整页打垮。
    // R4（性能）：attention 与项目清单互不依赖——并行拉，首屏不再吃两次串行 RTT。
    // listProjects 的失败语义保持不变：not_identified 冒泡去重认证，其余退化为 undefined。
    const [attention, projectsSettled] = await Promise.all([
      client.pages.attention(withLocale(locale)),
      listProjectsDeduped(client).then(
        (value): ProjectListVM | undefined => value,
        (error: unknown): ProjectListVM | undefined => {
          if (error instanceof WorkHubApiError && error.code === "not_identified") {
            throw error;
          }
          return undefined;
        }
      )
    ]);
    // 普通用户审查（QUEUE-PROMOTE）：?focus=<attention_id> 把队列里那张卡提升为主卡原地处理——
    // 队列行点击不再跳去回放页/无动作的工作项页。
    const focusId = new URLSearchParams(match.search).get("focus");
    if (focusId) {
      const focusIndex = attention.queue.findIndex((item) => item.id === focusId);
      if (focusIndex >= 0) {
        const [focused] = attention.queue.splice(focusIndex, 1);
        if (focused) {
          if (attention.primary && attention.primary.id !== focused.id) {
            attention.queue.unshift(attention.primary);
          }
          attention.primary = focused;
        }
      }
    }
    return { key: "home", attention, projects: projectsSettled } satisfies WebRouteSurface;
  }
  if (match.key === "projects") {
    const projects = await listProjectsDeduped(client);
    return { key: "projects", projects } satisfies WebRouteSurface;
  }
  if (match.key === "project-home") {
    // 项目主页永不塌成通用空卡:服务端 VM 自带空态(无进行中工作时 empty_state=no_open_work),
    // 始终渲染项目头 + 入口动作本身,而不是给叶子路由用的"回到项目"死胡同。
    const project = await client.pages.project(match.params["id"] ?? "", withLocale(locale));
    return { key: "project-home", project } satisfies WebRouteSurface;
  }
  if (match.key === "project-timeline") {
    // R15 批 E2c：只读时间线。projectTimeline 在 PageClient 上是可选字段（同 workbench，见 api-client
    // types.ts 注释）；真实 createApiClient() 一定实现它，这里仍老实处理「万一没有」——报真错误，不假装能拿到数据。
    const fetchTimeline = client.pages.projectTimeline;
    if (!fetchTimeline) {
      return "error" as const;
    }
    const timeline = await fetchTimeline(match.params["id"] ?? "", withLocale(locale));
    return { key: "project-timeline", timeline } satisfies WebRouteSurface;
  }
  if (match.key === "intake") {
    const sessionId = match.params["sessionId"] ?? "";
    if (!sessionId) {
      // 新任务带项目上下文(?project_id=)：拉项目名(顺带过项目级访问 fence)，绑定接入到本项目。
      // 项目拉取失败(无权限/不存在/旧链接)优雅退化为通用接入起点，不让接入页整页报错。
      const projectId = new URLSearchParams(match.search).get("project_id") ?? undefined;
      if (projectId) {
        try {
          const project = await client.pages.project(projectId, withLocale(locale));
          return { key: "intake", start: true, project: { id: project.project.id, name: project.project.name } } satisfies WebRouteSurface;
        } catch (error) {
          // 会话过期(not_identified)要冒泡到 loadWebRoute 的重认证分支,别被「项目不可用」吞掉(否则用户看到能用的接入页而非重新登录)。
          if (error instanceof WorkHubApiError && error.code === "not_identified") {
            throw error;
          }
          // 来自的项目拉不到(已删/无权限/旧链接)：不静默切换，标记 project_unavailable → 渲染明确提示，再退化为通用起点。
          return { key: "intake", start: true, project_unavailable: true, ...(await intakeProjectChoices(client)) } satisfies WebRouteSurface;
        }
      }
      // R10-0c（P1-1）：通用入口不再静默落到共享「试点项目」——拉项目清单渲显式项目选择器，
      // 用户自己挑落点（真活跃排序，首项默认）。清单拉取失败退化为原试点兜底（不挡提需求）。
      return { key: "intake", start: true, ...(await intakeProjectChoices(client)) } satisfies WebRouteSurface;
    }
    try {
      const session = await client.getSession(sessionId, withLocale(locale));
      return { key: "intake", session } satisfies WebRouteSurface;
    } catch (error) {
      // CHAT-1/E2E-01：澄清反问缺失/失效（生成失败后可重试）不塌成一句通用「页面加载失败」——
      // 把服务端的本地化指引原文渲进状态卡正文，动作导回接入起点重新提交（=createSession 重试路径）。
      if (error instanceof WorkHubApiError && error.code === "clarification_draft_missing") {
        const tailored: TailoredEmptyRouteState = {
          status: "empty",
          titleOverride: locale === "en-US" ? "The clarification question isn't ready" : "澄清问题还没有生成",
          bodyOverride: error.message,
          actionHref: "/intake",
          actionLabel: locale === "en-US" ? "Restart intake" : "重新提交需求"
        };
        return tailored;
      }
      throw error;
    }
  }
  if (match.key === "approvals") {
    const approvals = await client.pages.approvals(approvalPageOptions(match, locale));
    // F11/簇A：无待办时不塌成通用空卡(会丢左导航把用户困住)。审批组件自带空态兜底
    // (头部 approvals.emptyTitle / 队列 reasonFallback / 详情 noSelection),照常渲染整页(含外壳)。
    return { key: "approvals", approvals } satisfies WebRouteSurface;
  }
  if (match.key === "cost") {
    const cost = await client.pages.cost(withLocale(locale));
    // F11/簇A：无成本数据(含 usage_not_connected)时不塌成通用空卡。成本组件自带空态兜底
    // (cost.statusFallback 等)，照常渲染整页(含外壳 + 「用量未接入」等可操作提示)，保留导航。
    return { key: "cost", cost } satisfies WebRouteSurface;
  }
  if (match.key === "agents") {
    const agents = await client.pages.agents(withLocale(locale));
    return { key: "agents", agents } satisfies WebRouteSurface;
  }
  if (match.key === "health") {
    const health = await client.pages.projectHealth(withLocale(locale));
    // EDGE-1/簇A：无可见项目时也照常渲染整页(含外壳 + 组件自带的 health.empty「还没有可见的项目」落地态),
    // 不再塌成丢左导航、文不对题的通用空卡「现在没有需要处理的事项」。与 approvals/cost/calendar/notifications 一致。
    return { key: "health", health } satisfies WebRouteSurface;
  }
  if (match.key === "knowledge") {
    const params = new URLSearchParams(match.search);
    const q = params.get("q") ?? params.get("query") ?? undefined;
    const projectId = params.get("project_id") ?? params.get("projectId") ?? undefined;
    const workItemId = params.get("work_item_id") ?? params.get("workItemId") ?? undefined;
    const sourceRef = params.get("source_ref") ?? undefined;
    // M19：只有 project_id / work_item_id 才是后端认可的检索锚点。source_ref(如 notification:xxx)单独
    // 不授权检索 → 非管理员点通知里的「查相关证据」(仅带 source_ref)会 403。把它排除出 hasScope,使这种
    // 无真实锚点的 403 落到外壳内的知识库落地页(指引 + 导航),而不是裸 403 死胡同。
    const hasScope = Boolean(projectId || workItemId);
    try {
      const evidence = await client.searchKnowledge({
        ...(q ? { q } : {}),
        ...(projectId ? { project_id: projectId } : {}),
        ...(workItemId ? { work_item_id: workItemId } : {}),
        ...(sourceRef ? { source_ref: sourceRef } : {}),
        limit: 6
      }, withLocale(locale));
      return { key: "knowledge", evidence, source_ref: sourceRef } satisfies WebRouteSurface;
    } catch (error) {
      // 会话过期要冒泡到重认证分支,别被落地态吞掉。
      if (error instanceof WorkHubApiError && error.code === "not_identified") {
        throw error;
      }
      // 无锚点的全局检索对非管理员 403:不塌成裸 403 死胡同,改在外壳内渲染知识库落地页。
      // 带锚点(项目/工作项)的 403 是真实的越权,照常冒泡为 forbidden 态。
      if (error instanceof WorkHubApiError && error.status === 403 && !hasScope) {
        // R12（多项目）：落地页不再只有「去项目列表」死路——带上项目清单渲检索项目选择器，
        // 非管理员选定项目即可就地检索（服务端单项目口径不变）。清单拉取失败退化为无选择器。
        let landingProjects: ProjectListVM | undefined;
        try {
          landingProjects = await listProjectsDeduped(client);
        } catch {
          landingProjects = undefined;
        }
        return { key: "knowledge", evidence: knowledgeScopeLandingBubble(q, locale), scope_landing: true, ...(landingProjects ? { projects: landingProjects } : {}) } satisfies WebRouteSurface;
      }
      throw error;
    }
  }
  if (match.key === "workitem") {
    const workitem = await client.pages.workItem(match.params["id"] ?? "", withLocale(locale));
    return { key: "workitem", workitem } satisfies WebRouteSurface;
  }
  if (match.key === "proposal") {
    const proposal = await client.pages.proposal(match.params["id"] ?? "", withLocale(locale));
    // EDGE-2：冲突列表是次要数据(它自带 assertCanReadWorkItem,可能独立 403/抖动)。它失败不该把本已加载好的
    // 提议/合并工作台整页塌成错误卡。会话过期(not_identified)仍要冒泡去重认证。
    // R10-P1-4：但失败也绝不能伪装成「零冲突」——审阅者会拿它当决策依据。标志位透传，页面渲显式
    // 「冲突检查暂时失败」提示。
    let conflicts: ProposalConflict[] = [];
    let conflictsCheckFailed = false;
    try {
      const result = await client.listWorkItemConflicts(proposal.work_item_id);
      conflicts = result.conflicts.filter((conflict) => conflict.proposal_id === proposal.proposal_id);
    } catch (error) {
      if (error instanceof WorkHubApiError && error.code === "not_identified") {
        throw error;
      }
      conflicts = [];
      conflictsCheckFailed = true;
    }
    return { key: "proposal", proposal, proposal_conflicts: conflicts, proposal_conflicts_check_failed: conflictsCheckFailed } satisfies WebRouteSurface;
  }
  if (match.key === "conversation") {
    // R15 批 web-mirror：只读会话镜像。翻页语义照 conversationMessageListQuerySchema：
    //   无游标 → beforeSeq=MAX（最新一页，O(1)，同桌面首屏策略）；?before= → 更早一页；
    //   ?after= → 更新一页；?seq= → 定位到含该 seq 的一页（beforeSeq=seq+1，高亮该条）。
    // 只读边界：只 GET 消息与成员目录，绝不 POST（不发消息/不反应/不推进已读游标）。
    const conversationId = match.params["id"] ?? "";
    const CONVERSATION_PAGE_LIMIT = 50;
    const beforeParam = nonnegativeIntSearchParam(match.search, "before");
    const afterParam = nonnegativeIntSearchParam(match.search, "after");
    const seqParam = nonnegativeIntSearchParam(match.search, "seq");
    let mode: "latest" | "before" | "after" | "seq";
    let requestOptions: { beforeSeq?: number; afterSeq?: number; limit: number };
    if (beforeParam !== undefined) {
      mode = "before";
      requestOptions = { beforeSeq: beforeParam, limit: CONVERSATION_PAGE_LIMIT };
    } else if (afterParam !== undefined) {
      mode = "after";
      requestOptions = { afterSeq: afterParam, limit: CONVERSATION_PAGE_LIMIT };
    } else if (seqParam !== undefined) {
      mode = "seq";
      requestOptions = { beforeSeq: seqParam + 1, limit: CONVERSATION_PAGE_LIMIT };
    } else {
      mode = "latest";
      requestOptions = { beforeSeq: Number.MAX_SAFE_INTEGER, limit: CONVERSATION_PAGE_LIMIT };
    }
    // 消息（主数据，参与者门控在服务端——非参与者 404 走既有 notFound 态）与成员目录并行拉。
    // 成员目录仅用于发送者昵称解析，失败 fail-soft（消息照常渲，昵称退化为「未知成员」）；
    // not_identified 仍冒泡去重认证。
    // R20 P1-08 收尾：昵称解析改走工作区花名册（GET /api/workspace/roster，翻页翻到底），不再用全局
    // /api/users——核实过 GET /conversations/:id/participants 这条路：main 会话没有参与者行，恒回
    // scope:"workspace" + 空列表（apps/api/src/services/conversations.ts listParticipants），对本页最常见
    // 的主区会话完全没有昵称可用；collab/DM 虽然有真实参与者行，但退群成员的历史发言同样解析不出——两条
    // 路径对"已离开的历史发言人"都不覆盖，参与者端点对主区会话覆盖面更差（不是"次优"而是"没有"），所以选
    // 工作区花名册这条更通用、且与审批转交选择器（browser.ts）已用的同一数据源一致。
    const [page, members] = await Promise.all([
      client.listConversationMessages(conversationId, requestOptions),
      fetchWorkspaceRosterMembers(client).then(
        (value) => value.map((member) => ({ id: member.user_id, nickname: member.nickname })),
        (error: unknown): Array<{ id: string; nickname: string }> => {
          if (error instanceof WorkHubApiError && error.code === "not_identified") {
            throw error;
          }
          return [];
        }
      )
    ]);
    const messages = page.messages;
    const firstSeq = messages[0]?.seq;
    const lastSeq = messages[messages.length - 1]?.seq;
    let olderBeforeSeq: number | undefined;
    let newerAfterSeq: number | undefined;
    if (mode === "after") {
      // 正向翻页：has_more=更新的还有；更早方向用页内最旧 seq 回溯。
      if (firstSeq !== undefined && firstSeq > 0) {
        olderBeforeSeq = firstSeq;
      }
      if (page.has_more) {
        newerAfterSeq = page.next_after_seq;
      }
    } else {
      // beforeSeq 家族（latest/before/seq）：has_more=更早的还有；非最新页可用页内最新 seq 往后翻。
      if (page.has_more) {
        olderBeforeSeq = page.next_before_seq ?? firstSeq;
      }
      if (mode !== "latest" && lastSeq !== undefined) {
        newerAfterSeq = lastSeq;
      }
    }
    return {
      key: "conversation",
      conversationId,
      messages,
      members,
      ...(mode === "seq" && seqParam !== undefined ? { targetSeq: seqParam } : {}),
      ...(olderBeforeSeq !== undefined ? { olderBeforeSeq } : {}),
      ...(newerAfterSeq !== undefined ? { newerAfterSeq } : {}),
      isLatest: mode === "latest",
      refreshHref: `${match.pathname}${match.search}`
    } satisfies WebRouteSurface;
  }
  if (match.key === "drive") {
    const params = new URLSearchParams(match.search);
    const projectId = params.get("project_id") ?? params.get("projectId") ?? undefined;
    // #5：项目主页「最近文件」深链带 item_id → 网盘高亮该文件(selected_item_id)。
    const itemId = params.get("item_id") ?? params.get("itemId") ?? undefined;
    const driveQuery = params.get("q")?.trim() || undefined;
    // 网盘是 GitHub 式核心:同时拉全量项目清单,供面板内的项目切换器/「所有项目」回链使用。
    // M1：清单拉取失败不应连累已加载好的网盘——退化为无切换器(仍展示文件)，而非整页报错。
    // R4（性能）：两者互不依赖，并行拉；not_identified 仍冒泡去重认证。
    const [drive, projects] = await Promise.all([
      client.pages.drive({
        ...withLocale(locale),
        ...(projectId ? { projectId } : {}),
        ...(itemId ? { itemId } : {}),
        ...(driveQuery ? { q: driveQuery } : {})
      }),
      listProjectsDeduped(client).then(
        (value): ProjectListVM => value,
        (error: unknown): ProjectListVM => {
          if (error instanceof WorkHubApiError && error.code === "not_identified") {
            throw error;
          }
          return { generated_at: new Date().toISOString(), projects: [] };
        }
      )
    ]);
    if (drive.empty_state === "no_project") {
      return "empty" as const;
    }
    return { key: "drive", drive, projects } satisfies WebRouteSurface;
  }
  if (match.key === "meetings") {
    const params = new URLSearchParams(match.search);
    const projectId = params.get("project_id") ?? params.get("projectId") ?? undefined;
    const meetingId = params.get("m") ?? params.get("meeting_id") ?? params.get("meetingId") ?? undefined;
    // 普通用户审查：会议页没有项目切换/返回入口，想看别的项目只能改 URL——与网盘同款项目导航。
    // R4（性能）：会议页与项目清单并行拉；清单失败照旧退化为空清单（原语义即吞所有错误）。
    const [meetings, projects] = await Promise.all([
      client.pages.meetings({
        ...withLocale(locale),
        ...(projectId ? { projectId } : {}),
        ...(meetingId ? { meetingId } : {})
      }),
      listProjectsDeduped(client).then(
        (value): ProjectListVM => value,
        (error: unknown): ProjectListVM => {
          // P1-07：会话过期(not_identified)必须冒泡去重认证——此前一并吞掉，会让掉线用户看到「空项目切换器」
          // 而非重新登录（与 home/drive 的 not_identified 冒泡口径对齐）。其余错误照旧退化为空清单。
          if (error instanceof WorkHubApiError && error.code === "not_identified") {
            throw error;
          }
          return { generated_at: new Date().toISOString(), projects: [] };
        }
      )
    ]);
    if (meetings.empty_state === "no_project") {
      return "empty" as const;
    }
    return { key: "meetings", meetings, projects } satisfies WebRouteSurface;
  }
  if (match.key === "notifications") {
    const notifications = await client.pages.notifications(withLocale(locale));
    // F14：通知箱为空时**不**塌成通用空卡——通知页自带「静音偏好」设置，塌掉会让用户在没有通知时
    // 永远够不着静音设置(且丢失左导航被困住)。组件本身优雅处理空态(每个 bucket 显示「通知箱是空的」),
    // 故照常渲染整页(含外壳 + 静音面板),空只是空清单而已。
    return { key: "notifications", notifications } satisfies WebRouteSurface;
  }
  if (match.key === "calendar") {
    const params = new URLSearchParams(match.search);
    const date = params.get("date") ?? undefined;
    const viewValue = params.get("view");
    const view = viewValue === "day" || viewValue === "week" ? viewValue : undefined;
    const calendar = await client.pages.calendar({
      ...withLocale(locale),
      ...(date ? { date } : {}),
      ...(view ? { view } : {})
    });
    // F11/簇A：没有日程块时不塌成通用空卡(会丢左导航把用户困住)。日程组件本就渲整周(view=week 恒 7 天),
    // 每天空块显示 calendar.empty,故照常在外壳内渲染空周视图,保留导航。
    return { key: "calendar", calendar } satisfies WebRouteSurface;
  }
  if (match.key === "replay") {
    const replay = await client.replayAgentRun(match.params["id"] ?? "", withLocale(locale));
    if (isReplayEmpty(replay)) {
      // M17: an empty replay must not collapse into the generic "现在没有需要处理的事项"
      // card — that's the wrong frame (the user came to watch the run, not clear an inbox)
      // and its back link drops them at the global overview. Tailor the copy and send the
      // back link to the parent work item (always present on an agent run).
      return {
        status: "empty" as const,
        actionHref: `/workitems/${replay.run.work_item_id}`,
        actionLabel: webT(locale, "backToTheWorkItem"),
        titleOverride: webT(locale, "noReplayableStepsYet"),
        bodyOverride: webT(locale, "thisRunHasnTProducedA")
      } satisfies TailoredEmptyRouteState;
    }
    return { key: "replay", replay } satisfies WebRouteSurface;
  }
  if (match.key === "search") {
    // R14 批 SEARCH（web-search-page）：服务端只透传 ?q=，不预取结果——SSR 渲搜索框外壳 + 诚实的
    // 空/短词提示；结果由客户端 route-component fetch GET /api/search 后注入（见 02-search-design.md
    // §7）。这条永不抛错/永不 empty——搜索页本身就是"输入框 + 结果"，不存在"无内容"的空态框架。
    const params = new URLSearchParams(match.search);
    const q = params.get("q")?.trim() || undefined;
    return { key: "search", q } satisfies WebRouteSurface;
  }
  if (match.key === "skills") {
    const skills = await client.pages.skills(withLocale(locale));
    return { key: "skills", skills } satisfies WebRouteSurface;
  }
  if (match.key === "settings") {
    const settings = await client.pages.settings(withLocale(locale));
    return { key: "settings", settings } satisfies WebRouteSurface;
  }
  if (match.key === "memory") {
    // R14 批 MEM：两 tab 用 ?tab= 区分，不分裂路由（默认「关于我」= profile）；两个治理端点各自
    // 全量拉取（同 skills 页既有口径——列表数据不多，服务端已有硬顶 USER_MEMORY_MAX_ACTIVE_PER_USER=50），
    // 零缓存路由层纪律同其余路由一致：每次导航都重新拉取，不让陈旧的编辑/停用结果留在屏上。
    // listUserMemories/listTeamSkillsManage 在 WorkHubApiClient 上是可选字段（不强迫
    // apps/desktop-webview 的完整 mock 字面量跟着补桩，见 packages/api-client/src/types.ts 注释）；
    // 真实 createApiClient() 一定实现它们，这里仍老实处理「万一没有」，不假装能拿到数据。
    const { listUserMemories, listTeamSkillsManage } = client;
    if (!listUserMemories || !listTeamSkillsManage) {
      throw new Error("This client does not support memory governance data");
    }
    const tabParam = new URLSearchParams(match.search).get("tab");
    const tab: "profile" | "skills" = tabParam === "skills" ? "skills" : "profile";
    const [userMemories, teamSkills] = await Promise.all([
      listUserMemories(),
      listTeamSkillsManage()
    ]);
    return { key: "memory", tab, userMemories, teamSkills } satisfies WebRouteSurface;
  }
  return "error" as const;
}

function routeStateFromStatus(status: Exclude<WebRouteLoadStatus, "ready">): RouteStateKind {
  return status === "idle" ? "loading" : status;
}

function errorStatus(error: unknown): Exclude<WebRouteLoadStatus, "idle" | "loading" | "ready"> {
  if (error instanceof WorkHubApiError && error.status === 403) {
    return "forbidden";
  }
  if (error instanceof WorkHubApiError && error.status === 404) {
    // 404 = 这条具体内容不存在/已删,不是「暂时没有内容」的空态。给「没有找到」态(可回来源列表),
    // 而不是误导性的「现在没有需要处理的事项」。
    return "notFound";
  }
  return "error";
}

function errorTrace(error: unknown) {
  if (error instanceof WorkHubApiError) {
    return `status=${error.status} code=${error.code}`;
  }
  return error instanceof Error ? error.message.slice(0, 140) : "route_loader_error";
}

function forbiddenOwnerLabel(error: unknown, locale: WorkHubLocale) {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return webT(locale, "needsOwnerApproval");
}

// 详情路由的空/未找到态回链：项目主页这类从列表点进来的页面，回链应回到来源列表(/projects)
// 而非把用户丢到首页死胡同。网盘/会议是项目级能力，没选到项目(空工作区)时回链也应去 /projects
// 让用户先建/选项目，而不是回总览("回到总览"对"还没有项目"是误导)。其余路由保持回首页。
function routeStateBackHref(match: WebRouteMatch): string {
  // R15 批 E2c：时间线是项目主页的下钻——非 Ready 态回链回到具体项目主页（有 id 时），而不是项目列表死胡同。
  if (match.key === "project-timeline") {
    const id = match.params["id"];
    return id ? `/projects/${id}` : "/projects";
  }
  if (match.key === "project-home" || match.key === "drive" || match.key === "meetings") {
    return "/projects";
  }
  return "/";
}

// M7：网盘是 GitHub 式文件同步核心,但在没有任何项目时它会塌成通用空卡「现在没有需要处理的事项」——
// 这听起来像收件箱已清空,而不是「你还没有项目,去建一个」。给网盘空态专属文案,把它解释成文件同步入口。
function routeStateCopyOverride(
  match: WebRouteMatch,
  state: RouteStateKind,
  locale: WorkHubLocale
): { titleOverride: string; bodyOverride: string } | undefined {
  if (match.key === "drive" && state === "empty") {
    return locale === "zh-CN"
      ? { titleOverride: "网盘还没有项目", bodyOverride: "先创建或选择一个项目，文件和版本会同步到这里。" }
      : { titleOverride: "No project for the drive yet", bodyOverride: "Create or pick a project first — files and versions will sync here." };
  }
  // F7：会议同样是项目维度数据,没有任何项目时塌成通用空卡「现在没有需要处理的事项」会误导成"队列已清空"。
  // 给专属文案,解释真正的下一步是先建/选项目(与 drive 同处理)。
  if (match.key === "meetings" && state === "empty") {
    return locale === "zh-CN"
      ? { titleOverride: "还没有可看的会议", bodyOverride: "先创建或选择一个项目，会议纪要和待办洞察会出现在这里。" }
      : { titleOverride: "No meetings yet", bodyOverride: "Create or pick a project first — meeting minutes and insights will show up here." };
  }
  return undefined;
}

// 回链按钮文案随目的地走：回 /projects 时显示「去项目」而非默认的「回到总览」(否则文不对题)。
// 回 "/"(总览)时返回 undefined,沿用该状态默认文案。
function routeStateBackLabel(match: WebRouteMatch, locale: WorkHubLocale): string | undefined {
  if (routeStateBackHref(match) === "/projects") {
    return webT(locale, "goToProjects");
  }
  return undefined;
}

// R10-0c：intake 起点的项目清单（fail-soft）。会话过期仍要冒泡去重认证。
async function intakeProjectChoices(client: WorkHubApiClient): Promise<{ projects?: ProjectListVM }> {
  try {
    return { projects: await listProjectsDeduped(client) };
  } catch (error) {
    if (error instanceof WorkHubApiError && error.code === "not_identified") {
      throw error;
    }
    return {};
  }
}

// WEB-01：match.pathname 是 location.pathname 的 URL 编码形态——中文路由（/这个路由不存在）会
// 原样渲成 %E8%BF%99… 糊在 404 卡的 pill 上。仅展示层解码；非法编码序列 decodeURIComponent 会抛，
// 回落原串——不为展示把错误态页面搞炸。href/actionHref 一律不动（那些必须保持编码形态）。
function displayPathname(pathname: string): string {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return pathname;
  }
}

export function renderWebRouteState(
  match: WebRouteMatch,
  status: Exclude<WebRouteLoadStatus, "ready">,
  locale: WorkHubLocale,
  input: { traceId?: string; ownerLabel?: string; actionHref?: string; actionLabel?: string; titleOverride?: string; bodyOverride?: string; shellUser?: WebProductShellCurrentUser } = {}
): WebRouteStateResult {
  const routeState = routeStateFromStatus(status);
  const card = renderRouteStateCard({
    routeKey: match.key,
    state: routeState,
    locale,
    route: displayPathname(match.pathname),
    ...(input.traceId ? { traceId: input.traceId } : {}),
    ...(input.ownerLabel ? { ownerLabel: input.ownerLabel } : {}),
    ...(input.actionHref ? { actionHref: input.actionHref } : {}),
    ...(input.actionLabel ? { actionLabel: input.actionLabel } : {}),
    ...(input.titleOverride ? { titleOverride: input.titleOverride } : {}),
    ...(input.bodyOverride ? { bodyOverride: input.bodyOverride } : {})
  });
  // R10-S3（P2-6）：已登录（有 shellUser）时非 Ready 态保留产品壳——顶栏/分组导航/身份都在，
  // 403/404/error 只是主内容区的一张状态卡，不再像被踢出了 WorkHub。boot 阶段（无身份）仍走全屏裸卡。
  if (input.shellUser) {
    const entries = shellPageOrderFor(match)
      .map((key) => ({ key, route: shellDefaultRoutes[key], title: shellPageTitles[locale][key] }));
    const stateShell = renderWebProductStateShell({
      locale,
      appName: "WorkHub",
      currentRoute: match.pathname,
      activeKey: match.key,
      entries,
      currentUser: input.shellUser,
      contentHtml: `<section class="wh-web-route-state-wrap wh-web-route-state-wrap--shelled" data-r4-web-route-api="${escapeHtml(apiLabelFor(match))}">${card}</section>`
    });
    return {
      status,
      match,
      html: `<style>${routeStateCss}${stateShell.css}.wh-product-main .wh-web-route-state-wrap{width:min(560px,100%);display:grid;gap:12px;min-width:0;margin:8vh auto 0}</style>
    <div data-r4-web-route-status="${escapeHtml(status)}" data-r4-web-route-key="${escapeHtml(match.key)}" data-r4-web-route-pattern="${escapeHtml(match.pattern)}">${stateShell.html}</div>`
    };
  }
  const html = `<style>${routeStateCss}${webRouteStateScreenCss}</style>
    <main class="wh-web-route-state-screen" data-r4-web-route-status="${escapeHtml(status)}" data-r4-web-route-key="${escapeHtml(match.key)}" data-r4-web-route-pattern="${escapeHtml(match.pattern)}">
      <section class="wh-web-route-state-wrap">
        <div class="wh-web-route-state-meta" data-r4-web-route-api="${escapeHtml(apiLabelFor(match))}"><a class="wh-web-route-state-home" href="/" data-r4-web-route-home="true">WorkHub</a></div>
        ${card}
      </section>
    </main>`;
  return {
    status,
    match,
    html
  };
}

function renderReadyRoute(
  surface: WebRouteSurface,
  match: WebRouteMatch,
  locale: WorkHubLocale,
  shellUser?: WebProductShellCurrentUser
): WebRouteReadyResult {
  const rendered = shellSurfaceFor(surface, match, locale);
  const routeComponents = routeComponentsForSurface(surface, locale, shellUser?.isAdmin ?? false);
  const shell = renderWebProductShell(rendered, {
    appName: "WorkHub",
    apiBaseLabel: apiLabelFor(match),
    currentRoute: match.pathname,
    locale,
    linkMode: "path",
    routeComponents,
    renderActivePanelOnly: true,
    currentUser: shellUser
  });
  const routeTreeNode = routeTreeNodeFor(match);
  return {
    status: "ready",
    match,
    shell,
    surface,
    html: `<style>${shell.css}</style><div data-r4-web-route-status="ready" data-r4-web-route-key="${escapeHtml(match.key)}" data-r4-web-route-pattern="${escapeHtml(match.pattern)}" data-r4-react-route-tree="true" data-r4-route-tree-key="${escapeHtml(routeTreeNode?.key ?? match.key)}" data-r4-route-tree-page-vm="${escapeHtml(routeTreeNode?.hydration.pageVm ?? "")}" data-r4-route-tree-mode="${escapeHtml(routeTreeNode?.hydration.mode ?? "html-fallback")}" data-r4-route-tree-adapter="${escapeHtml(routeTreeNode?.hydration.adapter ?? "route-component-v1")}" data-r4-route-tree-active-only="${escapeHtml(String(routeTreeNode?.hydration.activeOnly ?? true))}" data-r4-route-tree-route-count="${escapeHtml(String(webReactRouteTree.length))}" data-r4-route-tree-react-component="${escapeHtml(routeTreeNode?.hydration.reactComponent?.componentName ?? "")}" data-r4-route-tree-react-component-adapter="${escapeHtml(routeTreeNode?.hydration.reactComponent?.adapter ?? "")}" data-r4-route-tree-react-component-fallback="${escapeHtml(String(routeTreeNode?.hydration.reactComponent?.htmlFallback ?? false))}" data-r4-route-tree-runtime-mount="${escapeHtml(String(routeTreeNode?.hydration.runtimeMount?.enabled ?? false))}" data-r4-route-tree-runtime-strategy="${escapeHtml(routeTreeNode?.hydration.runtimeMount?.strategy ?? "")}" data-r4-route-tree-runtime-props-update="${escapeHtml(routeTreeNode?.hydration.runtimeMount?.propsUpdate ?? "")}" data-r4-route-tree-runtime-dispatcher="${escapeHtml(routeTreeNode?.hydration.runtimeMount?.dispatcher ?? "")}" data-r4-route-tree-runtime-mutation-editor="${escapeHtml(routeTreeNode?.hydration.runtimeMount?.mutationEditor ?? "")}" data-r4-route-tree-runtime-line-editor="${escapeHtml(routeTreeNode?.hydration.runtimeMount?.lineEditor ?? "")}">${shell.html}</div>`
  };
}

// 设计决策（R4 审查裁定，不是遗漏）：路由层零缓存——每次导航都重新拉取页面 VM。
// 理由：①页面数据是审批/预算/运行态等高时效运营数据，陈旧缓存会直接误导决策；
// ②实时性已由 SSE（refreshCurrentRouteFromLiveEvent）负责推给「停留中」的页面，导航拉新
// 是正确性选择而非性能疏忽；③loader 内已做并行化（Promise.all）压掉串行 RTT。
// 若未来要加缓存，只能做「stale-while-revalidate 的骨架替代」，绝不能把陈旧 VM 当终态渲染。
export async function loadWebRoute(
  client: WorkHubApiClient,
  match: WebRouteMatch,
  locale: WorkHubLocale,
  shellUser?: WebProductShellCurrentUser
): Promise<WebRouteLoadResult> {
  try {
    const result = await loadRouteSurface(client, match, locale);
    if (isTailoredEmptyRouteState(result)) {
      // M17: loader-tailored empty state (custom copy + data-derived back link).
      return renderWebRouteState(match, "empty", locale, {
        actionHref: result.actionHref,
        ...(result.actionLabel ? { actionLabel: result.actionLabel } : {}),
        ...(result.titleOverride ? { titleOverride: result.titleOverride } : {}),
        ...(result.bodyOverride ? { bodyOverride: result.bodyOverride } : {}),
        ...(shellUser ? { shellUser } : {})
      });
    }
    if (result === "empty" || result === "error" || result === "notFound") {
      // empty / notFound 都是可恢复态:动作回到来源列表(详情页→列表)或首页;error 才给「重试」。
      const backLabel = result === "error" ? undefined : routeStateBackLabel(match, locale);
      // R10-P2-12：错误态「重试」保留查询串——/drive?project_id、/knowledge/search?q 等页重试
      // 不再丢上下文打开错误对象。
      const stateInput = result === "error"
        ? { traceId: `route=${match.pathname}`, actionHref: `${match.pathname}${match.search}` }
        : { actionHref: routeStateBackHref(match), ...(backLabel ? { actionLabel: backLabel } : {}) };
      return renderWebRouteState(match, result, locale, {
        ...stateInput,
        ...(routeStateCopyOverride(match, result, locale) ?? {}),
        ...(shellUser ? { shellUser } : {})
      });
    }
    return renderReadyRoute(result, match, locale, shellUser);
  } catch (error) {
    if (error instanceof WorkHubApiError && error.code === "not_identified") {
      throw error;
    }
    const status = errorStatus(error);
    // forbidden 也是「可逃离」态:此前它的 CTA href 回退到 match.pathname——正是刚 403 的那个 URL,
    // 点了又 403,永远在原地打转,唯一出口是顶部 logo。把它和 empty/notFound 一样导回用户能访问的列表/首页,
    // 并给一个诚实的动作文案(默认的「申请访问」其实什么也不申请)。only error 仍留在原地给「重试」。
    const escapable = status === "empty" || status === "notFound" || status === "forbidden";
    const backLabel = status === "forbidden"
      ? (routeStateBackLabel(match, locale) ?? (webT(locale, "goSomewhereYouCanAccess")))
      : (status === "empty" || status === "notFound")
        ? routeStateBackLabel(match, locale)
        : undefined;
    const stateInput = {
      // R10-P2-12：error 留在原地重试时带上查询串。
      actionHref: escapable ? routeStateBackHref(match) : `${match.pathname}${match.search}`,
      ...(backLabel ? { actionLabel: backLabel } : {}),
      ...(status === "error" ? { traceId: errorTrace(error) } : {}),
      ...(status === "forbidden" ? { ownerLabel: forbiddenOwnerLabel(error, locale) } : {}),
      ...(routeStateCopyOverride(match, status, locale) ?? {})
    };
    return renderWebRouteState(match, status, locale, { ...stateInput, ...(shellUser ? { shellUser } : {}) });
  }
}
