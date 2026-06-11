import { WorkHubApiError, type WorkHubApiClient } from "@workhub/api-client";
import type {
  ApprovalCenterVM,
  AttentionHomeVM,
  CostDashboardVM,
  EvidenceBubble,
  GoldPathSurfaceVM,
  ProposalConflict,
  ProposalDetailVM,
  ReplayTraceVM,
  SessionVM,
  SettingsPageVM,
  WorkItemDetailVM
} from "@workhub/contracts";
import {
  renderGoldPathSurface,
  renderWebRouteComponents,
  renderWebProductShell,
  type GoldPathAppShell,
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
  surface: GoldPathSurfaceVM;
};

export type WebRouteStateResult = {
  status: Exclude<WebRouteLoadStatus, "ready">;
  match: WebRouteMatch;
  html: string;
};

export type WebRouteLoadResult = WebRouteReadyResult | WebRouteStateResult;

type GoldPathSurfaceWithProposalConflicts = GoldPathSurfaceVM & {
  proposal_conflicts?: ProposalConflict[];
};

type R4RouteSurface = GoldPathSurfaceWithProposalConflicts & {
  intake_session?: SessionVM;
  knowledge_evidence?: EvidenceBubble;
};

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
      strategy: "react-18-createRoot-probe";
      routeKey: "home";
      componentName: "HomeRouteComponent";
      fallbackPreserved: true;
      propsUpdate: "sse-react-render";
      dispatcher: "delegated-click-bubble";
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

async function loadGoldPathTemplate(client: WorkHubApiClient, locale: WorkHubLocale) {
  return client.pages.goldPath(withLocale(locale));
}

function withCurrentRoute(surface: GoldPathSurfaceVM, match: WebRouteMatch): GoldPathSurfaceVM {
  const routes = { ...surface.routes };
  if (match.key === "home") {
    routes.home = match.pathname;
  } else if (match.key === "intake") {
    routes.intake = match.pathname;
  } else if (match.key === "approvals") {
    routes.approvals = match.pathname;
  } else if (match.key === "workitem") {
    routes.workitem = match.pathname;
  } else if (match.key === "proposal") {
    routes.proposal = match.pathname;
  } else if (match.key === "replay") {
    routes.replay = match.pathname;
  } else if (match.key === "cost") {
    routes.cost = match.pathname;
  } else if (match.key === "knowledge") {
    routes.knowledge = match.pathname;
  }
  return { ...surface, routes };
}

function withIntake(surface: GoldPathSurfaceVM, match: WebRouteMatch, session: SessionVM): R4RouteSurface {
  return {
    ...withCurrentRoute(surface, match),
    intake_session: session,
    page_vms: {
      ...surface.page_vms,
      question: session.question
    }
  };
}

function withAttention(surface: GoldPathSurfaceVM, match: WebRouteMatch, attention: AttentionHomeVM) {
  return {
    ...withCurrentRoute(surface, match),
    page_vms: {
      ...surface.page_vms,
      attention
    }
  };
}

function withApprovals(surface: GoldPathSurfaceVM, match: WebRouteMatch, approvals: ApprovalCenterVM) {
  return {
    ...withCurrentRoute(surface, match),
    page_vms: {
      ...surface.page_vms,
      approvals
    }
  };
}

function withCost(surface: GoldPathSurfaceVM, match: WebRouteMatch, cost: CostDashboardVM) {
  return {
    ...withCurrentRoute(surface, match),
    page_vms: {
      ...surface.page_vms,
      cost
    }
  };
}

function withWorkItem(surface: GoldPathSurfaceVM, match: WebRouteMatch, workitem: WorkItemDetailVM) {
  return {
    ...withCurrentRoute(surface, match),
    page_vms: {
      ...surface.page_vms,
      workitem
    }
  };
}

function withProposal(
  surface: GoldPathSurfaceVM,
  match: WebRouteMatch,
  proposal: ProposalDetailVM,
  conflicts: ProposalConflict[] = []
): GoldPathSurfaceWithProposalConflicts {
  return {
    ...withCurrentRoute(surface, match),
    proposal_conflicts: conflicts,
    page_vms: {
      ...surface.page_vms,
      proposal
    }
  };
}

function withReplay(surface: GoldPathSurfaceVM, match: WebRouteMatch, replay: ReplayTraceVM) {
  return {
    ...withCurrentRoute(surface, match),
    page_vms: {
      ...surface.page_vms,
      replay
    }
  };
}

function withSettings(surface: GoldPathSurfaceVM, match: WebRouteMatch, settings: SettingsPageVM) {
  return {
    ...withCurrentRoute(surface, match),
    page_vms: {
      ...surface.page_vms,
      settings
    }
  };
}

function withKnowledge(surface: GoldPathSurfaceVM, match: WebRouteMatch, evidence: EvidenceBubble): R4RouteSurface {
  return {
    ...withCurrentRoute(surface, match),
    knowledge_evidence: evidence,
    page_vms: {
      ...surface.page_vms,
      evidence
    }
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
    return withAttention(await loadGoldPathTemplate(client, locale), match, attention);
  }
  if (match.key === "intake") {
    const sessionId = match.params["sessionId"] ?? "";
    if (!sessionId) {
      return "empty" as const;
    }
    const session = await client.getSession(sessionId, withLocale(locale));
    return withIntake(await loadGoldPathTemplate(client, locale), match, session);
  }
  if (match.key === "approvals") {
    const approvals = await client.pages.approvals(withLocale(locale));
    if (isApprovalCenterEmpty(approvals)) {
      return "empty" as const;
    }
    return withApprovals(await loadGoldPathTemplate(client, locale), match, approvals);
  }
  if (match.key === "cost") {
    const cost = await client.pages.cost(withLocale(locale));
    if (isCostDashboardEmpty(cost)) {
      return "empty" as const;
    }
    return withCost(await loadGoldPathTemplate(client, locale), match, cost);
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
    return withKnowledge(await loadGoldPathTemplate(client, locale), match, evidence);
  }
  if (match.key === "workitem") {
    const workitem = await client.pages.workItem(match.params["id"] ?? "", withLocale(locale));
    return withWorkItem(await loadGoldPathTemplate(client, locale), match, workitem);
  }
  if (match.key === "proposal") {
    const proposal = await client.pages.proposal(match.params["id"] ?? "", withLocale(locale));
    const result = await client.listWorkItemConflicts(proposal.work_item_id);
    const conflicts = result.conflicts.filter((conflict) => conflict.proposal_id === proposal.proposal_id);
    return withProposal(await loadGoldPathTemplate(client, locale), match, proposal, conflicts);
  }
  if (match.key === "replay") {
    const replay = await client.replayAgentRun(match.params["id"] ?? "", withLocale(locale));
    if (isReplayEmpty(replay)) {
      return "empty" as const;
    }
    return withReplay(await loadGoldPathTemplate(client, locale), match, replay);
  }
  if (match.key === "settings") {
    const settings = await client.pages.settings(withLocale(locale));
    return withSettings(await loadGoldPathTemplate(client, locale), match, settings);
  }
  return withCurrentRoute(await loadGoldPathTemplate(client, locale), match);
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
  surface: GoldPathSurfaceVM,
  match: WebRouteMatch,
  locale: WorkHubLocale
): WebRouteReadyResult {
  const rendered = renderGoldPathSurface(surface, "web", { locale });
  const routeComponents = renderWebRouteComponents(surface, { locale });
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
    html: `<style>${shell.css}</style><div data-r4-web-route-status="ready" data-r4-web-route-key="${escapeHtml(match.key)}" data-r4-web-route-pattern="${escapeHtml(match.pattern)}" data-r4-react-route-tree="true" data-r4-route-tree-key="${escapeHtml(routeTreeNode?.key ?? match.key)}" data-r4-route-tree-page-vm="${escapeHtml(routeTreeNode?.hydration.pageVm ?? "")}" data-r4-route-tree-mode="${escapeHtml(routeTreeNode?.hydration.mode ?? "html-fallback")}" data-r4-route-tree-adapter="${escapeHtml(routeTreeNode?.hydration.adapter ?? "route-component-v1")}" data-r4-route-tree-active-only="${escapeHtml(String(routeTreeNode?.hydration.activeOnly ?? true))}" data-r4-route-tree-route-count="${escapeHtml(String(webReactRouteTree.length))}" data-r4-route-tree-react-component="${escapeHtml(routeTreeNode?.hydration.reactComponent?.componentName ?? "")}" data-r4-route-tree-react-component-adapter="${escapeHtml(routeTreeNode?.hydration.reactComponent?.adapter ?? "")}" data-r4-route-tree-react-component-fallback="${escapeHtml(String(routeTreeNode?.hydration.reactComponent?.htmlFallback ?? false))}" data-r4-route-tree-runtime-mount="${escapeHtml(String(routeTreeNode?.hydration.runtimeMount?.enabled ?? false))}" data-r4-route-tree-runtime-strategy="${escapeHtml(routeTreeNode?.hydration.runtimeMount?.strategy ?? "")}" data-r4-route-tree-runtime-props-update="${escapeHtml(routeTreeNode?.hydration.runtimeMount?.propsUpdate ?? "")}" data-r4-route-tree-runtime-dispatcher="${escapeHtml(routeTreeNode?.hydration.runtimeMount?.dispatcher ?? "")}">${shell.html}</div>`
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
