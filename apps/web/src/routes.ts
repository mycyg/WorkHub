import { WorkHubApiError, type WorkHubApiClient } from "@workhub/api-client";
import type {
  ApprovalCenterVM,
  AttentionHomeVM,
  CostDashboardVM,
  EvidenceBubble,
  ProposalConflict,
  ProposalDetailVM,
  ReplayTraceVM,
  SessionVM,
  SettingsPageVM,
  WorkItemDetailVM
} from "@workhub/contracts";
import {
  goldPathCss,
  renderWebRouteComponent,
  renderWebProductShell,
  type GoldPathAppShell,
  type GoldPathRenderedPage,
  type WebProductMetric,
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
  | { key: "intake"; session: SessionVM }
  | { key: "approvals"; approvals: ApprovalCenterVM }
  | { key: "workitem"; workitem: WorkItemDetailVM }
  | { key: "proposal"; proposal: ProposalDetailVM; proposal_conflicts: ProposalConflict[] }
  | { key: "replay"; replay: ReplayTraceVM }
  | { key: "cost"; cost: CostDashboardVM }
  | { key: "knowledge"; evidence: EvidenceBubble }
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
  | "session"
  | "approvals"
  | "workitem"
  | "proposal"
  | "replay"
  | "cost"
  | "evidence"
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
    };
  };
};

const routeTreePageVmByKey = {
  home: "attention",
  intake: "session",
  approvals: "approvals",
  workitem: "workitem",
  proposal: "proposal",
  replay: "replay",
  cost: "cost",
  knowledge: "evidence",
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
    mutationEditor: "structured-field-scalar"
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
    .replace(/"/gu, "&quot;");
}

function normalizePathname(input: string) {
  const parsed = new URL(input || "/", "https://workhub.local");
  const hashPath = parsed.hash.startsWith("#/") ? new URL(parsed.hash.slice(1), "https://workhub.local").pathname : "";
  const pathname = hashPath || parsed.pathname || "/";
  if (pathname.length > 1 && pathname.endsWith("/")) {
    return pathname.slice(0, -1);
  }
  return pathname;
}

function normalizeSearch(input: string) {
  const parsed = new URL(input || "/", "https://workhub.local");
  if (parsed.hash.startsWith("#/")) {
    return new URL(parsed.hash.slice(1), "https://workhub.local").search;
  }
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
  return `${normalizePathname(parsed.pathname)}${parsed.search}${parsed.hash}`;
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
  "intake",
  "approvals",
  "workitem",
  "proposal",
  "replay",
  "cost",
  "knowledge",
  "settings"
] as const satisfies readonly GoldPathRenderedPage["key"][];

const shellDefaultRoutes = {
  home: "/",
  intake: "/intake/r4-live-session",
  approvals: "/approvals",
  workitem: "/workitems/r4-live-workitem",
  proposal: "/proposals/r4-live-proposal",
  replay: "/agent-runs/r4-live-run/replay",
  cost: "/dashboard/cost",
  knowledge: "/knowledge/search",
  settings: "/settings"
} satisfies Record<GoldPathRenderedPage["key"], string>;

const shellPageTitles: Record<WorkHubLocale, Record<GoldPathRenderedPage["key"], string>> = {
  "zh-CN": {
    home: "总览",
    intake: "接入",
    approvals: "审批",
    workitem: "任务详情",
    proposal: "变更申请",
    replay: "执行回放",
    cost: "成本",
    knowledge: "知识证据",
    settings: "设置"
  },
  "en-US": {
    home: "Overview",
    intake: "Intake",
    approvals: "Approvals",
    workitem: "Task detail",
    proposal: "Change request",
    replay: "Execution replay",
    cost: "Cost",
    knowledge: "Knowledge evidence",
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
    runtime: "运行时"
  },
  "en-US": {
    primary: "Focus",
    queue: "Queue",
    running: "Background",
    pending: "Pending",
    requests: "Requests",
    trace: "Trace",
    deliverables: "Deliverables",
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
    runtime: "Runtime"
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

function shellPagesFor(match: WebRouteMatch, locale: WorkHubLocale, activeMetrics: WebProductMetric[]): WebProductShellPage[] {
  return shellPageOrder.map((key) => ({
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
  if (surface.key === "intake") {
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
      metric(locale, "evidence", surface.evidence.missing_evidence_note ? "missing" : "found"),
      metric(locale, "runtime", "REST")
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
  if (surface.key === "intake") {
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
  if (surface.key === "replay") {
    return renderWebRouteComponent({ key: "replay", replay: surface.replay }, { locale });
  }
  if (surface.key === "cost") {
    return renderWebRouteComponent({ key: "cost", cost: surface.cost }, { locale });
  }
  if (surface.key === "knowledge") {
    return renderWebRouteComponent({ key: "knowledge", evidence: surface.evidence }, { locale });
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

function isAttentionEmpty(data: AttentionHomeVM) {
  return !data.primary && data.background_runs.length === 0;
}

function isApprovalCenterEmpty(data: ApprovalCenterVM) {
  return data.items.length === 0 && data.requests.length === 0;
}

function isCostDashboardEmpty(data: CostDashboardVM) {
  return Boolean(data.empty_state) && data.token_in === 0 && data.token_out === 0 && data.notices.length === 0;
}

function isReplayEmpty(data: ReplayTraceVM) {
  return data.steps.length === 0 && !data.run.handoff_md && !data.run.outcome_reason;
}

async function loadRouteSurface(client: WorkHubApiClient, match: WebRouteMatch, locale: WorkHubLocale) {
  if (match.notFound) {
    return "error" as const;
  }
  if (match.key === "home") {
    const attention = await client.pages.attention(withLocale(locale));
    if (isAttentionEmpty(attention)) {
      return "empty" as const;
    }
    return { key: "home", attention } satisfies WebRouteSurface;
  }
  if (match.key === "intake") {
    const sessionId = match.params["sessionId"] ?? "";
    if (!sessionId) {
      return "empty" as const;
    }
    const session = await client.getSession(sessionId, withLocale(locale));
    return { key: "intake", session } satisfies WebRouteSurface;
  }
  if (match.key === "approvals") {
    const approvals = await client.pages.approvals(withLocale(locale));
    if (isApprovalCenterEmpty(approvals)) {
      return "empty" as const;
    }
    return { key: "approvals", approvals } satisfies WebRouteSurface;
  }
  if (match.key === "cost") {
    const cost = await client.pages.cost(withLocale(locale));
    if (isCostDashboardEmpty(cost)) {
      return "empty" as const;
    }
    return { key: "cost", cost } satisfies WebRouteSurface;
  }
  if (match.key === "knowledge") {
    const params = new URLSearchParams(match.search);
    const q = params.get("q") ?? params.get("query") ?? undefined;
    const projectId = params.get("project_id") ?? params.get("projectId") ?? undefined;
    const workItemId = params.get("work_item_id") ?? params.get("workItemId") ?? undefined;
    const evidence = await client.searchKnowledge({
      ...(q ? { q } : {}),
      ...(projectId ? { project_id: projectId } : {}),
      ...(workItemId ? { work_item_id: workItemId } : {}),
      limit: 6
    }, withLocale(locale));
    return { key: "knowledge", evidence } satisfies WebRouteSurface;
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
  if (match.key === "replay") {
    const replay = await client.replayAgentRun(match.params["id"] ?? "", withLocale(locale));
    if (isReplayEmpty(replay)) {
      return "empty" as const;
    }
    return { key: "replay", replay } satisfies WebRouteSurface;
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

export function renderWebRouteState(
  match: WebRouteMatch,
  status: Exclude<WebRouteLoadStatus, "ready">,
  locale: WorkHubLocale,
  input: { traceId?: string; ownerLabel?: string; actionHref?: string } = {}
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
    ...(input.actionHref ? { actionHref: input.actionHref } : {})
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
  locale: WorkHubLocale
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
    renderActivePanelOnly: true
  });
  const routeTreeNode = routeTreeNodeFor(match);
  return {
    status: "ready",
    match,
    shell,
    surface,
    html: `<style>${shell.css}</style><div data-r4-web-route-status="ready" data-r4-web-route-key="${escapeHtml(match.key)}" data-r4-web-route-pattern="${escapeHtml(match.pattern)}" data-r4-react-route-tree="true" data-r4-route-tree-key="${escapeHtml(routeTreeNode?.key ?? match.key)}" data-r4-route-tree-page-vm="${escapeHtml(routeTreeNode?.hydration.pageVm ?? "")}" data-r4-route-tree-mode="${escapeHtml(routeTreeNode?.hydration.mode ?? "html-fallback")}" data-r4-route-tree-adapter="${escapeHtml(routeTreeNode?.hydration.adapter ?? "route-component-v1")}" data-r4-route-tree-active-only="${escapeHtml(String(routeTreeNode?.hydration.activeOnly ?? true))}" data-r4-route-tree-route-count="${escapeHtml(String(webReactRouteTree.length))}" data-r4-route-tree-react-component="${escapeHtml(routeTreeNode?.hydration.reactComponent?.componentName ?? "")}" data-r4-route-tree-react-component-adapter="${escapeHtml(routeTreeNode?.hydration.reactComponent?.adapter ?? "")}" data-r4-route-tree-react-component-fallback="${escapeHtml(String(routeTreeNode?.hydration.reactComponent?.htmlFallback ?? false))}" data-r4-route-tree-runtime-mount="${escapeHtml(String(routeTreeNode?.hydration.runtimeMount?.enabled ?? false))}" data-r4-route-tree-runtime-strategy="${escapeHtml(routeTreeNode?.hydration.runtimeMount?.strategy ?? "")}" data-r4-route-tree-runtime-props-update="${escapeHtml(routeTreeNode?.hydration.runtimeMount?.propsUpdate ?? "")}" data-r4-route-tree-runtime-dispatcher="${escapeHtml(routeTreeNode?.hydration.runtimeMount?.dispatcher ?? "")}" data-r4-route-tree-runtime-mutation-editor="${escapeHtml(routeTreeNode?.hydration.runtimeMount?.mutationEditor ?? "")}">${shell.html}</div>`
  };
}

export async function loadWebRoute(
  client: WorkHubApiClient,
  match: WebRouteMatch,
  locale: WorkHubLocale
): Promise<WebRouteLoadResult> {
  try {
    const result = await loadRouteSurface(client, match, locale);
    if (result === "empty" || result === "error") {
      const stateInput = result === "error"
        ? { traceId: `route=${match.pathname}`, actionHref: match.pathname }
        : { actionHref: "/" };
      return renderWebRouteState(match, result, locale, {
        ...stateInput
      });
    }
    return renderReadyRoute(result, match, locale);
  } catch (error) {
    if (error instanceof WorkHubApiError && error.code === "not_identified") {
      throw error;
    }
    const status = errorStatus(error);
    const stateInput = {
      actionHref: status === "empty" ? "/" : match.pathname,
      ...(status === "error" ? { traceId: errorTrace(error) } : {}),
      ...(status === "forbidden" ? { ownerLabel: forbiddenOwnerLabel(error, locale) } : {})
    };
    return renderWebRouteState(match, status, locale, stateInput);
  }
}
