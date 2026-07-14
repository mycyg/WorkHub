import { normalizeWorkHubLocale, type WorkHubLocale } from "./gold-path/i18n.js";

export type RouteStateKind = "loading" | "empty" | "error" | "forbidden" | "notFound";

export type R4WebRouteKey =
  | "home"
  | "projects"
  | "project-home"
  | "intake"
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
  | "agents"
  | "knowledge"
  | "search"
  | "skills"
  | "settings"
  | "memory";

export type RouteStateCardInput = {
  routeKey: R4WebRouteKey;
  state: RouteStateKind;
  locale?: WorkHubLocale | undefined;
  route?: string | undefined;
  traceId?: string | undefined;
  ownerLabel?: string | undefined;
  actionHref?: string | undefined;
  // 自定义动作按钮文案：当 actionHref 被改写(如空态回链到 /projects)时,标签也要随目的地走,
  // 否则会出现「按钮写『回到总览』却跳 /projects」的文不对题。不传则用该状态的默认文案。
  actionLabel?: string | undefined;
  // M7：个别路由的空态需要专属标题/正文（如网盘无项目时说「先创建或选择一个项目」，而不是通用的
  // 「现在没有需要处理的事项」——后者听起来像收件箱已清空，而非「你还没有项目」）。不传则回落到通用文案。
  titleOverride?: string | undefined;
  bodyOverride?: string | undefined;
};

export const r4WebRouteKeys = [
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
  "agents",
  "knowledge",
  "search",
  "skills",
  "settings",
  "memory"
] as const satisfies readonly R4WebRouteKey[];

export const r4RouteStateKinds = [
  "loading",
  "empty",
  "error",
  "forbidden",
  "notFound"
] as const satisfies readonly RouteStateKind[];

export const routeStateCss = [
  ".wh-route-state-matrix{display:grid;gap:16px;min-width:0;max-width:100%}",
  ".wh-route-state-row{display:grid;grid-template-columns:160px repeat(5,minmax(0,1fr));gap:12px;align-items:stretch;min-width:0}",
  ".wh-route-state-route{border:1px solid #dfe5f1;border-radius:8px;background:#fff;padding:14px;display:grid;align-content:center;gap:6px;min-width:0;overflow-wrap:anywhere}",
  ".wh-route-state-route strong{font-size:14px}.wh-route-state-route span{font-size:12px;color:#66728c;overflow-wrap:anywhere}",
  ".wh-route-state-card{border:1px solid #dfe5f1;background:rgba(255,255,255,.94);border-radius:8px;padding:14px;display:grid;gap:10px;min-width:0;max-width:100%;overflow-wrap:anywhere;word-break:break-word;box-shadow:0 14px 38px rgba(37,51,79,.07)}",
  ".wh-route-state-card[data-route-state=loading]{border-color:#b8c7ff}.wh-route-state-card[data-route-state=empty]{border-color:#dfe8d7}.wh-route-state-card[data-route-state=error]{border-color:#f0c5bd}.wh-route-state-card[data-route-state=forbidden]{border-color:#d8dff2}.wh-route-state-card[data-route-state=notFound]{border-color:#e6d8f2}",
  ".wh-route-state-pill{display:inline-flex;align-items:center;max-width:100%;border-radius:999px;background:#f5f8fc;color:#66728c;font-size:11px;font-weight:800;padding:5px 8px;overflow-wrap:anywhere}",
  ".wh-route-state-card h3{margin:0;font-size:16px;line-height:1.35;overflow-wrap:anywhere}.wh-route-state-card p{margin:0;color:#66728c;font-size:13px;line-height:1.5;overflow-wrap:anywhere}",
  ".wh-route-state-action{display:inline-flex;width:max-content;max-width:100%;align-items:center;justify-content:center;border:1px solid #dfe5f1;border-radius:8px;background:#fff;color:#172033;text-decoration:none;font-weight:800;font-size:12px;padding:8px 10px;overflow-wrap:anywhere}",
  "@media (max-width:980px){.wh-route-state-row{grid-template-columns:1fr}.wh-route-state-route{position:sticky;top:0;z-index:1}}"
].join("");

const routeInfo: Record<WorkHubLocale, Record<R4WebRouteKey, { label: string; route: string }>> = {
  "zh-CN": {
    home: { label: "总览", route: "/" },
    projects: { label: "项目", route: "/projects" },
    "project-home": { label: "项目主页", route: "/projects/:id" },
    intake: { label: "快捷入口", route: "/intake/:sessionId" },
    approvals: { label: "审批中心", route: "/approvals" },
    workitem: { label: "工作项详情", route: "/workitems/:id" },
    proposal: { label: "变更申请", route: "/proposals/:id" },
    drive: { label: "项目网盘", route: "/drive" },
    meetings: { label: "会议洞察", route: "/meetings" },
    notifications: { label: "通知中心", route: "/notifications" },
    calendar: { label: "日程", route: "/calendar" },
    health: { label: "项目健康", route: "/dashboard/health" },
    replay: { label: "执行回放", route: "/agent-runs/:id/replay" },
    cost: { label: "成本仪表盘", route: "/dashboard/cost" },
    agents: { label: "军团", route: "/dashboard/agents" },
    knowledge: { label: "证据检索", route: "/knowledge/search" },
    search: { label: "搜索", route: "/dashboard/search" },
    skills: { label: "团队技能", route: "/dashboard/skills" },
    settings: { label: "设置", route: "/settings" },
    memory: { label: "记忆管理", route: "/settings/memory" }
  },
  "en-US": {
    home: { label: "Overview", route: "/" },
    projects: { label: "Projects", route: "/projects" },
    "project-home": { label: "Project home", route: "/projects/:id" },
    intake: { label: "Intake", route: "/intake/:sessionId" },
    approvals: { label: "Approval center", route: "/approvals" },
    workitem: { label: "Work item detail", route: "/workitems/:id" },
    proposal: { label: "Change request", route: "/proposals/:id" },
    drive: { label: "Project drive", route: "/drive" },
    meetings: { label: "Meeting insights", route: "/meetings" },
    notifications: { label: "Notifications", route: "/notifications" },
    calendar: { label: "Calendar", route: "/calendar" },
    health: { label: "Project health", route: "/dashboard/health" },
    replay: { label: "Run replay", route: "/agent-runs/:id/replay" },
    cost: { label: "Cost dashboard", route: "/dashboard/cost" },
    agents: { label: "Agent teams", route: "/dashboard/agents" },
    knowledge: { label: "Evidence search", route: "/knowledge/search" },
    search: { label: "Search", route: "/dashboard/search" },
    skills: { label: "Team skills", route: "/dashboard/skills" },
    settings: { label: "Settings", route: "/settings" },
    memory: { label: "Memory", route: "/settings/memory" }
  }
};

const stateCopy: Record<WorkHubLocale, Record<RouteStateKind, { title: string; body: string; action: string }>> = {
  "zh-CN": {
    loading: {
      title: "正在加载真实数据",
      body: "正在等待后台返回真实数据，不会显示假的成功或过期内容。",
      action: "保持等待"
    },
    empty: {
      title: "现在没有需要处理的事项",
      body: "这里暂时没有内容，可以新建、返回或查看历史。",
      action: "回到总览"
    },
    error: {
      title: "页面暂时加载失败",
      body: "已记录出错信息，你可以重试；需要时把这一页发给技术同事帮忙排查。",
      action: "重试"
    },
    forbidden: {
      title: "你没有权限查看",
      body: "这部分内容需要授权，请联系有权限的人开通。",
      action: "申请访问"
    },
    notFound: {
      title: "没有找到这个页面",
      body: "链接可能已经失效，或这条内容已被删除、移动。",
      action: "返回首页"
    }
  },
  "en-US": {
    loading: {
      title: "Loading real data",
      body: "The page waits for the backend service instead of showing fake success.",
      action: "Keep waiting"
    },
    empty: {
      title: "Nothing needs action right now",
      body: "Empty states stay quiet and leave a create, back, or history entry.",
      action: "Back to overview"
    },
    error: {
      title: "This page failed to load",
      body: "The page keeps context and a trace id so users can retry and engineers can debug.",
      action: "Retry"
    },
    forbidden: {
      title: "You do not have access",
      body: "The state explains who can grant access without exposing private work.",
      action: "Request access"
    },
    notFound: {
      title: "We couldn't find this page",
      body: "The link may be broken, or this item was moved or deleted.",
      action: "Back to home"
    }
  }
};

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#39;");
}

// 外部/契约来源的 href 可能带 javascript:/data: → XSS。只放行相对路径与 http(s)/mailto，其余拦成 "#"。
function safeHref(value: unknown): string {
  const v = String(value ?? "").trim();
  if ((v.startsWith("/") && !v.startsWith("//")) || /^(?:https?:|mailto:)/iu.test(v)) {
    return v;
  }
  return "#";
}

export function renderRouteStateCard(input: RouteStateCardInput) {
  const locale = normalizeWorkHubLocale(input.locale);
  const route = routeInfo[locale][input.routeKey];
  const copy = stateCopy[locale][input.state];
  const actionHref = input.actionHref ?? (input.state === "empty" || input.state === "notFound" ? "/" : input.route ?? route.route);
  const meta = input.state === "error"
    ? input.traceId ?? "trace_id=r4-web-route-state"
    : input.state === "forbidden"
      ? input.ownerLabel ?? (locale === "zh-CN" ? "需要负责人授权" : "Needs owner approval")
      : input.route ?? route.route;
  return `<article class="wh-route-state-card" data-route-key="${input.routeKey}" data-route-state="${input.state}" data-locale="${locale}">
    <span class="wh-route-state-pill">${escapeHtml(meta)}</span>
    <h3>${escapeHtml(input.titleOverride ?? copy.title)}</h3>
    <p>${escapeHtml(input.bodyOverride ?? copy.body)}</p>
    <a class="wh-route-state-action" href="${escapeHtml(safeHref(actionHref))}">${escapeHtml(input.actionLabel ?? copy.action)}</a>
  </article>`;
}

export function renderRouteStateMatrix(input: {
  locale?: WorkHubLocale | undefined;
  routeKeys?: readonly R4WebRouteKey[] | undefined;
  states?: readonly RouteStateKind[] | undefined;
} = {}) {
  const locale = normalizeWorkHubLocale(input.locale);
  const keys = input.routeKeys ?? r4WebRouteKeys;
  const states = input.states ?? r4RouteStateKinds;
  return `<section class="wh-route-state-matrix" data-r4-route-state-matrix="true" data-locale="${locale}">
    ${keys.map((routeKey) => {
    const route = routeInfo[locale][routeKey];
    return `<div class="wh-route-state-row" data-route-key="${routeKey}">
      <div class="wh-route-state-route"><strong>${escapeHtml(route.label)}</strong><span>${escapeHtml(route.route)}</span></div>
      ${states.map((state) => renderRouteStateCard({ routeKey, state, locale, route: route.route })).join("")}
    </div>`;
  }).join("")}
  </section>`;
}
