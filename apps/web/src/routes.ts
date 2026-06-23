import { WorkHubApiError, type WorkHubApiClient } from "@workhub/api-client";
import type {
  ApprovalCenterVM,
  AttentionHomeVM,
  CalendarPageVM,
  CostDashboardVM,
  DrivePageVM,
  EvidenceBubble,
  MeetingPageVM,
  NotificationPageVM,
  ProjectHealthPageVM,
  ProjectHomePageVM,
  ProjectListVM,
  ProposalConflict,
  ProposalDetailVM,
  ReplayTraceVM,
  SessionVM,
  SettingsPageVM,
  TeamSkillsPageVM,
  WorkItemDetailVM
} from "@workhub/contracts";
import {
  goldPathCss,
  renderWebRouteComponent,
  renderWebProductShell,
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

export type WebRouteLoadStatus = "idle" | "loading" | "ready" | "empty" | "error" | "forbidden";

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
  | { key: "home"; attention: AttentionHomeVM }
  | { key: "projects"; projects: ProjectListVM }
  | { key: "project-home"; project: ProjectHomePageVM }
  | { key: "intake"; session: SessionVM }
  | { key: "intake"; start: true; project?: { id: string; name: string }; project_unavailable?: boolean }
  | { key: "approvals"; approvals: ApprovalCenterVM }
  | { key: "workitem"; workitem: WorkItemDetailVM }
  | { key: "proposal"; proposal: ProposalDetailVM; proposal_conflicts: ProposalConflict[] }
  | { key: "drive"; drive: DrivePageVM; projects: ProjectListVM }
  | { key: "meetings"; meetings: MeetingPageVM }
  | { key: "notifications"; notifications: NotificationPageVM }
  | { key: "calendar"; calendar: CalendarPageVM }
  | { key: "health"; health: ProjectHealthPageVM }
  | { key: "replay"; replay: ReplayTraceVM }
  | { key: "cost"; cost: CostDashboardVM }
  | { key: "knowledge"; evidence: EvidenceBubble; source_ref?: string | undefined }
  | { key: "skills"; skills: TeamSkillsPageVM }
  | { key: "settings"; settings: SettingsPageVM };

const routeMatchers = [
  {
    key: "home",
    pattern: "/",
    apiBaseLabel: "/api/pages/attention",
    regex: /^\/$/u,
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
    key: "knowledge",
    pattern: "/knowledge/search",
    apiBaseLabel: "/api/knowledge/search",
    regex: /^\/knowledge(?:\/search)?$/u,
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
  | "project"
  | "session"
  | "approvals"
  | "workitem"
  | "proposal"
  | "drive"
  | "meetings"
  | "notifications"
  | "calendar"
  | "health"
  | "replay"
  | "cost"
  | "evidence"
  | "skills"
  | "settings";

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
  "project-home": "project",
  intake: "session",
  approvals: "approvals",
  workitem: "workitem",
  proposal: "proposal",
  drive: "drive",
  meetings: "meetings",
  notifications: "notifications",
  calendar: "calendar",
  health: "health",
  replay: "replay",
  cost: "cost",
  knowledge: "evidence",
  skills: "skills",
  settings: "settings"
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
  ".wh-web-route-state-meta span{min-width:0;overflow-wrap:anywhere}"
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

const shellPageOrder = [
  "home",
  "projects",
  "project-home",
  "intake",
  "approvals",
  "workitem",
  "proposal",
  "drive",
  "meetings",
  "notifications",
  "calendar",
  "health",
  "replay",
  "cost",
  "knowledge",
  "skills",
  "settings"
] as const satisfies readonly GoldPathRenderedPage["key"][];

// intake 不算 detail-only：/intake（无 sessionId）就是"提需求"起点页，应常驻导航,让用户随处可发起新活。
const detailOnlyShellPages = new Set<GoldPathRenderedPage["key"]>([
  "project-home",
  "workitem",
  "proposal",
  "replay"
]);

const shellDefaultRoutes = {
  home: "/",
  projects: "/projects",
  "project-home": "/projects",
  intake: "/intake",
  approvals: "/approvals",
  workitem: "/",
  proposal: "/approvals",
  drive: "/drive",
  meetings: "/meetings",
  notifications: "/notifications",
  calendar: "/calendar",
  health: "/dashboard/health",
  replay: "/",
  cost: "/dashboard/cost",
  knowledge: "/knowledge/search",
  skills: "/dashboard/skills",
  settings: "/settings"
} satisfies Record<GoldPathRenderedPage["key"], string>;

const shellPageTitles: Record<WorkHubLocale, Record<GoldPathRenderedPage["key"], string>> = {
  "zh-CN": {
    home: "总览",
    projects: "项目",
    "project-home": "项目主页",
    intake: "接入",
    approvals: "审批",
    workitem: "任务详情",
    proposal: "变更申请",
    drive: "项目网盘",
    meetings: "会议洞察",
    notifications: "通知中心",
    calendar: "日程",
    health: "项目健康",
    replay: "执行回放",
    cost: "成本",
    knowledge: "知识证据",
    skills: "团队技能",
    settings: "设置"
  },
  "en-US": {
    home: "Overview",
    projects: "Projects",
    "project-home": "Project home",
    intake: "Intake",
    approvals: "Approvals",
    workitem: "Task detail",
    proposal: "Change request",
    drive: "Project drive",
    meetings: "Meeting insights",
    notifications: "Notifications",
    calendar: "Calendar",
    health: "Project health",
    replay: "Execution replay",
    cost: "Cost",
    knowledge: "Knowledge evidence",
    skills: "Team skills",
    settings: "Settings"
  }
};

const metricLabels: Record<WorkHubLocale, Record<string, string>> = {
  "zh-CN": {
    primary: "当前焦点",
    queue: "队列",
    running: "后台运行",
    pending: "待处理",
    requests: "请求",
    trace: "轨迹",
    deliverables: "交付物",
    files: "文件",
    meetings: "会议",
    insights: "洞察",
    unread: "未读",
    done: "已处理",
    overdue: "逾期",
    today: "今日",
    folders: "文件夹",
    versions: "版本",
    evidence: "证据",
    checks: "检查",
    comments: "评论",
    steps: "步骤",
    decisions: "决策",
    snapshots: "快照",
    tokens: "Tokens",
    cost: "成本",
    budget: "预算",
    options: "选项",
    refs: "来源",
    runtime: "运行时",
    projects: "项目",
    attention: "需要关注",
    critical: "告急",
    openwork: "进行中",
    status: "状态",
    owner: "负责人"
  },
  "en-US": {
    primary: "Focus",
    queue: "Queue",
    running: "Background",
    pending: "Pending",
    requests: "Requests",
    trace: "Trace",
    deliverables: "Deliverables",
    files: "Files",
    meetings: "Meetings",
    insights: "Insights",
    unread: "Unread",
    done: "Done",
    overdue: "Overdue",
    today: "Today",
    folders: "Folders",
    versions: "Versions",
    evidence: "Evidence",
    checks: "Checks",
    comments: "Comments",
    steps: "Steps",
    decisions: "Decisions",
    snapshots: "Snapshots",
    tokens: "Tokens",
    cost: "Cost",
    budget: "Budget",
    options: "Options",
    refs: "Sources",
    runtime: "Runtime",
    projects: "Projects",
    attention: "Attention",
    critical: "Critical",
    openwork: "Open",
    status: "Status",
    owner: "Owner"
  }
};

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
    return [
      metric(locale, "primary", surface.attention.primary ? "1" : "0"),
      metric(locale, "queue", String(surface.attention.queue.length)),
      metric(locale, "running", String(surface.attention.background_runs.length))
    ];
  }
  if (surface.key === "projects") {
    const openItems = surface.projects.projects.reduce((sum, project) => sum + project.open_work_item_count, 0);
    const archived = surface.projects.projects.filter((project) => project.archived).length;
    return [
      metric(locale, "projects", String(surface.projects.projects.length)),
      metric(locale, "running", String(openItems)),
      metric(locale, "done", String(archived))
    ];
  }
  if (surface.key === "project-home") {
    const zh = locale === "zh-CN";
    return [
      metric(locale, "openwork", String(surface.project.summary.open_work_item_count)),
      metric(locale, "status", surface.project.project.status === "archived" ? (zh ? "已归档" : "Archived") : (zh ? "进行中" : "Active")),
      metric(locale, "owner", surface.project.project.owner_label)
    ];
  }
  if (surface.key === "intake") {
    if ("start" in surface) {
      // runtime 指示当前接入起点：绑定项目时显示项目名(截断，避免长 CJK 名撑爆 chip)，否则「试点/Pilot」。
      const intakeRuntime = surface.project
        ? (surface.project.name.length > 16 ? `${surface.project.name.slice(0, 15)}…` : surface.project.name)
        : (locale === "zh-CN" ? "试点" : "Pilot");
      return [
        metric(locale, "options", "0"),
        metric(locale, "queue", locale === "zh-CN" ? "待开始" : "Start"),
        metric(locale, "runtime", intakeRuntime)
      ];
    }
    return [
      metric(locale, "options", String(surface.session.question.options.length)),
      metric(locale, "queue", surface.session.question.input_mode),
      metric(locale, "runtime", surface.session.session_id)
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
      metric(locale, "deliverables", String(surface.workitem.accepted_deliverables.length)),
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
      metric(locale, "insights", String(surface.meetings.summary.confirmed_insight_count + surface.meetings.summary.dismissed_insight_count))
    ];
  }
  if (surface.key === "notifications") {
    return [
      metric(locale, "pending", String(surface.notifications.summary.needs_decision_count)),
      metric(locale, "unread", String(surface.notifications.summary.unread_count)),
      metric(locale, "done", String(surface.notifications.summary.done_count))
    ];
  }
  if (surface.key === "calendar") {
    return [
      metric(locale, "today", String(surface.calendar.summary.today_count)),
      metric(locale, "overdue", String(surface.calendar.summary.overdue_count)),
      metric(locale, "queue", String(surface.calendar.summary.block_count))
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
  if (surface.key === "knowledge") {
    return [
      metric(locale, "refs", String(surface.evidence.evidence_refs.length)),
      metric(locale, "evidence", surface.evidence.missing_evidence_note ? (locale === "zh-CN" ? "缺失" : "Missing") : (locale === "zh-CN" ? "已找到" : "Found")),
      metric(locale, "runtime", locale === "zh-CN" ? "实时数据" : "Live data")
    ];
  }
  if (surface.key === "skills") {
    return [
      metric(locale, "primary", String(surface.skills.totals.active)),
      metric(locale, "queue", String(surface.skills.totals.refined)),
      metric(locale, "running", String(surface.skills.totals.ai_authored))
    ];
  }
  return [
    metric(locale, "runtime", surface.settings.runtime.app_env),
    metric(locale, "queue", surface.settings.runtime.broker_backend),
    metric(locale, "primary", surface.settings.locale)
  ];
}

function routeComponentForSurface(surface: WebRouteSurface, locale: WorkHubLocale): WebRouteComponent {
  if (surface.key === "home") {
    return renderWebRouteComponent({ key: "home", attention: surface.attention }, { locale });
  }
  if (surface.key === "projects") {
    return renderWebRouteComponent({ key: "projects", projects: surface.projects }, { locale });
  }
  if (surface.key === "project-home") {
    return renderWebRouteComponent({ key: "project-home", project: surface.project }, { locale });
  }
  if (surface.key === "intake") {
    if ("start" in surface) {
      return renderWebRouteComponent(
        {
          key: "intake",
          start: true,
          ...(surface.project ? { project: surface.project } : {}),
          ...(surface.project_unavailable ? { projectUnavailable: true } : {})
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
      proposalConflicts: surface.proposal_conflicts
    }, { locale });
  }
  if (surface.key === "drive") {
    return renderWebRouteComponent({ key: "drive", drive: surface.drive, projects: surface.projects }, { locale });
  }
  if (surface.key === "meetings") {
    return renderWebRouteComponent({ key: "meetings", meetings: surface.meetings }, { locale });
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
  if (surface.key === "knowledge") {
    return renderWebRouteComponent({ key: "knowledge", evidence: surface.evidence, sourceRef: surface.source_ref }, { locale });
  }
  if (surface.key === "skills") {
    return renderWebRouteComponent({ key: "skills", skills: surface.skills }, { locale });
  }
  return renderWebRouteComponent({ key: "settings", settings: surface.settings }, { locale });
}

function routeComponentsForSurface(surface: WebRouteSurface, locale: WorkHubLocale): WebRouteComponentMap {
  return {
    [surface.key]: routeComponentForSurface(surface, locale)
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

async function loadRouteSurface(client: WorkHubApiClient, match: WebRouteMatch, locale: WorkHubLocale) {
  if (match.notFound) {
    return "error" as const;
  }
  if (match.key === "home") {
    // 首页是落地页,永不塌成通用空卡：即便没有待决策事项,也渲染决策收件箱组件本身
    // （战绩横幅 + 计数 + 可爱空态 + 去提需求 CTA），而不是给叶子路由用的"回到总览"死胡同。
    const attention = await client.pages.attention(withLocale(locale));
    return { key: "home", attention } satisfies WebRouteSurface;
  }
  if (match.key === "projects") {
    const projects = await client.listProjects();
    return { key: "projects", projects } satisfies WebRouteSurface;
  }
  if (match.key === "project-home") {
    // 项目主页永不塌成通用空卡:服务端 VM 自带空态(无进行中工作时 empty_state=no_open_work),
    // 始终渲染项目头 + 入口动作本身,而不是给叶子路由用的"回到项目"死胡同。
    const project = await client.pages.project(match.params["id"] ?? "", withLocale(locale));
    return { key: "project-home", project } satisfies WebRouteSurface;
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
          return { key: "intake", start: true, project_unavailable: true } satisfies WebRouteSurface;
        }
      }
      return { key: "intake", start: true } satisfies WebRouteSurface;
    }
    const session = await client.getSession(sessionId, withLocale(locale));
    return { key: "intake", session } satisfies WebRouteSurface;
  }
  if (match.key === "approvals") {
    const approvals = await client.pages.approvals(withLocale(locale));
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
  if (match.key === "health") {
    const health = await client.pages.projectHealth(withLocale(locale));
    if (health.cards.length === 0) {
      return "empty" as const;
    }
    return { key: "health", health } satisfies WebRouteSurface;
  }
  if (match.key === "knowledge") {
    const params = new URLSearchParams(match.search);
    const q = params.get("q") ?? params.get("query") ?? undefined;
    const projectId = params.get("project_id") ?? params.get("projectId") ?? undefined;
    const workItemId = params.get("work_item_id") ?? params.get("workItemId") ?? undefined;
    const sourceRef = params.get("source_ref") ?? undefined;
    const evidence = await client.searchKnowledge({
      ...(q ? { q } : {}),
      ...(projectId ? { project_id: projectId } : {}),
      ...(workItemId ? { work_item_id: workItemId } : {}),
      ...(sourceRef ? { source_ref: sourceRef } : {}),
      limit: 6
    }, withLocale(locale));
    return { key: "knowledge", evidence, source_ref: sourceRef } satisfies WebRouteSurface;
  }
  if (match.key === "workitem") {
    const workitem = await client.pages.workItem(match.params["id"] ?? "", withLocale(locale));
    return { key: "workitem", workitem } satisfies WebRouteSurface;
  }
  if (match.key === "proposal") {
    const proposal = await client.pages.proposal(match.params["id"] ?? "", withLocale(locale));
    const result = await client.listWorkItemConflicts(proposal.work_item_id);
    const conflicts = result.conflicts.filter((conflict) => conflict.proposal_id === proposal.proposal_id);
    return { key: "proposal", proposal, proposal_conflicts: conflicts } satisfies WebRouteSurface;
  }
  if (match.key === "drive") {
    const params = new URLSearchParams(match.search);
    const projectId = params.get("project_id") ?? params.get("projectId") ?? undefined;
    // #5：项目主页「最近文件」深链带 item_id → 网盘高亮该文件(selected_item_id)。
    const itemId = params.get("item_id") ?? params.get("itemId") ?? undefined;
    const drive = await client.pages.drive({
      ...withLocale(locale),
      ...(projectId ? { projectId } : {}),
      ...(itemId ? { itemId } : {})
    });
    if (drive.empty_state === "no_project") {
      return "empty" as const;
    }
    // 网盘是 GitHub 式核心:同时拉全量项目清单,供面板内的项目切换器/「所有项目」回链使用。
    // M1：清单拉取失败不应连累已加载好的网盘——退化为无切换器(仍展示文件)，而非整页报错。
    let projects: ProjectListVM;
    try {
      projects = await client.listProjects();
    } catch (error) {
      // 会话过期(not_identified)要冒泡到重认证分支,别被「退化为无切换器」吞掉。
      if (error instanceof WorkHubApiError && error.code === "not_identified") {
        throw error;
      }
      projects = { generated_at: new Date().toISOString(), projects: [] };
    }
    return { key: "drive", drive, projects } satisfies WebRouteSurface;
  }
  if (match.key === "meetings") {
    const params = new URLSearchParams(match.search);
    const projectId = params.get("project_id") ?? params.get("projectId") ?? undefined;
    const meetingId = params.get("m") ?? params.get("meeting_id") ?? params.get("meetingId") ?? undefined;
    const meetings = await client.pages.meetings({
      ...withLocale(locale),
      ...(projectId ? { projectId } : {}),
      ...(meetingId ? { meetingId } : {})
    });
    if (meetings.empty_state === "no_project") {
      return "empty" as const;
    }
    return { key: "meetings", meetings } satisfies WebRouteSurface;
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
      return "empty" as const;
    }
    return { key: "replay", replay } satisfies WebRouteSurface;
  }
  if (match.key === "skills") {
    const skills = await client.pages.skills(withLocale(locale));
    return { key: "skills", skills } satisfies WebRouteSurface;
  }
  if (match.key === "settings") {
    const settings = await client.pages.settings(withLocale(locale));
    return { key: "settings", settings } satisfies WebRouteSurface;
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
    return "empty";
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
  return locale === "zh-CN" ? "需要负责人授权" : "Needs owner approval";
}

// 详情路由的空/未找到态回链：项目主页这类从列表点进来的页面，回链应回到来源列表(/projects)
// 而非把用户丢到首页死胡同。网盘/会议是项目级能力，没选到项目(空工作区)时回链也应去 /projects
// 让用户先建/选项目，而不是回总览("回到总览"对"还没有项目"是误导)。其余路由保持回首页。
function routeStateBackHref(match: WebRouteMatch): string {
  if (match.key === "project-home" || match.key === "drive" || match.key === "meetings") {
    return "/projects";
  }
  return "/";
}

// 回链按钮文案随目的地走：回 /projects 时显示「去项目」而非默认的「回到总览」(否则文不对题)。
// 回 "/"(总览)时返回 undefined,沿用该状态默认文案。
function routeStateBackLabel(match: WebRouteMatch, locale: WorkHubLocale): string | undefined {
  if (routeStateBackHref(match) === "/projects") {
    return locale === "zh-CN" ? "去项目" : "Go to projects";
  }
  return undefined;
}

export function renderWebRouteState(
  match: WebRouteMatch,
  status: Exclude<WebRouteLoadStatus, "ready">,
  locale: WorkHubLocale,
  input: { traceId?: string; ownerLabel?: string; actionHref?: string; actionLabel?: string } = {}
): WebRouteStateResult {
  const routeState = routeStateFromStatus(status);
  const html = `<style>${routeStateCss}${webRouteStateScreenCss}</style>
    <main class="wh-web-route-state-screen" data-r4-web-route-status="${escapeHtml(status)}" data-r4-web-route-key="${escapeHtml(match.key)}" data-r4-web-route-pattern="${escapeHtml(match.pattern)}">
      <section class="wh-web-route-state-wrap">
        <div class="wh-web-route-state-meta"><span>WorkHub Web</span><span>${escapeHtml(apiLabelFor(match))}</span></div>
        ${renderRouteStateCard({
    routeKey: match.key,
    state: routeState,
    locale,
    route: match.pathname,
    ...(input.traceId ? { traceId: input.traceId } : {}),
    ...(input.ownerLabel ? { ownerLabel: input.ownerLabel } : {}),
    ...(input.actionHref ? { actionHref: input.actionHref } : {}),
    ...(input.actionLabel ? { actionLabel: input.actionLabel } : {})
  })}
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
  const routeComponents = routeComponentsForSurface(surface, locale);
  const shell = renderWebProductShell(rendered, {
    appName: "WorkHub",
    surfaceLabel: "Web R4",
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

export async function loadWebRoute(
  client: WorkHubApiClient,
  match: WebRouteMatch,
  locale: WorkHubLocale,
  shellUser?: WebProductShellCurrentUser
): Promise<WebRouteLoadResult> {
  try {
    const result = await loadRouteSurface(client, match, locale);
    if (result === "empty" || result === "error") {
      const backLabel = routeStateBackLabel(match, locale);
      const stateInput = result === "error"
        ? { traceId: `route=${match.pathname}`, actionHref: match.pathname }
        : { actionHref: routeStateBackHref(match), ...(backLabel ? { actionLabel: backLabel } : {}) };
      return renderWebRouteState(match, result, locale, {
        ...stateInput
      });
    }
    return renderReadyRoute(result, match, locale, shellUser);
  } catch (error) {
    if (error instanceof WorkHubApiError && error.code === "not_identified") {
      throw error;
    }
    const status = errorStatus(error);
    const backLabel = status === "empty" ? routeStateBackLabel(match, locale) : undefined;
    const stateInput = {
      actionHref: status === "empty" ? routeStateBackHref(match) : match.pathname,
      ...(backLabel ? { actionLabel: backLabel } : {}),
      ...(status === "error" ? { traceId: errorTrace(error) } : {}),
      ...(status === "forbidden" ? { ownerLabel: forbiddenOwnerLabel(error, locale) } : {})
    };
    return renderWebRouteState(match, status, locale, stateInput);
  }
}
