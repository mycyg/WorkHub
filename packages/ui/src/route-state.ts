import { normalizeWorkHubLocale, type WorkHubLocale } from "./gold-path/i18n.js";

export type RouteStateKind = "loading" | "empty" | "error" | "forbidden";

export type R4WebRouteKey =
  | "home"
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
  | "knowledge"
  | "settings";

export type RouteStateCardInput = {
  routeKey: R4WebRouteKey;
  state: RouteStateKind;
  locale?: WorkHubLocale | undefined;
  route?: string | undefined;
  traceId?: string | undefined;
  ownerLabel?: string | undefined;
  actionHref?: string | undefined;
};

export const r4WebRouteKeys = [
  "home",
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
  "settings"
] as const satisfies readonly R4WebRouteKey[];

export const r4RouteStateKinds = [
  "loading",
  "empty",
  "error",
  "forbidden"
] as const satisfies readonly RouteStateKind[];

export const routeStateCss = [
  ".wh-route-state-matrix{display:grid;gap:16px;min-width:0;max-width:100%}",
  ".wh-route-state-row{display:grid;grid-template-columns:160px repeat(4,minmax(0,1fr));gap:12px;align-items:stretch;min-width:0}",
  ".wh-route-state-route{border:1px solid #dfe5f1;border-radius:8px;background:#fff;padding:14px;display:grid;align-content:center;gap:6px;min-width:0;overflow-wrap:anywhere}",
  ".wh-route-state-route strong{font-size:14px}.wh-route-state-route span{font-size:12px;color:#66728c;overflow-wrap:anywhere}",
  ".wh-route-state-card{border:1px solid #dfe5f1;background:rgba(255,255,255,.94);border-radius:8px;padding:14px;display:grid;gap:10px;min-width:0;max-width:100%;overflow-wrap:anywhere;word-break:break-word;box-shadow:0 14px 38px rgba(37,51,79,.07)}",
  ".wh-route-state-card[data-route-state=loading]{border-color:#b8c7ff}.wh-route-state-card[data-route-state=empty]{border-color:#dfe8d7}.wh-route-state-card[data-route-state=error]{border-color:#f0c5bd}.wh-route-state-card[data-route-state=forbidden]{border-color:#d8dff2}",
  ".wh-route-state-pill{display:inline-flex;align-items:center;max-width:100%;border-radius:999px;background:#f5f8fc;color:#66728c;font-size:11px;font-weight:800;padding:5px 8px;overflow-wrap:anywhere}",
  ".wh-route-state-card h3{margin:0;font-size:16px;line-height:1.35;overflow-wrap:anywhere}.wh-route-state-card p{margin:0;color:#66728c;font-size:13px;line-height:1.5;overflow-wrap:anywhere}",
  ".wh-route-state-action{display:inline-flex;width:max-content;max-width:100%;align-items:center;justify-content:center;border:1px solid #dfe5f1;border-radius:8px;background:#fff;color:#172033;text-decoration:none;font-weight:800;font-size:12px;padding:8px 10px;overflow-wrap:anywhere}",
  "@media (max-width:980px){.wh-route-state-row{grid-template-columns:1fr}.wh-route-state-route{position:sticky;top:0;z-index:1}}"
].join("");

const routeInfo: Record<WorkHubLocale, Record<R4WebRouteKey, { label: string; route: string }>> = {
  "zh-CN": {
    home: { label: "总览", route: "/" },
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
    knowledge: { label: "证据检索", route: "/knowledge/search" },
    settings: { label: "设置", route: "/settings" }
  },
  "en-US": {
    home: { label: "Overview", route: "/" },
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
    knowledge: { label: "Evidence search", route: "/knowledge/search" },
    settings: { label: "Settings", route: "/settings" }
  }
};

const stateCopy: Record<WorkHubLocale, Record<RouteStateKind, { title: string; body: string; action: string }>> = {
  "zh-CN": {
    loading: {
      title: "正在加载真实数据",
      body: "页面等待 WorkHub daemon 返回，不显示假成功或旧缓存。",
      action: "保持等待"
    },
    empty: {
      title: "现在没有需要处理的事项",
      body: "空态保持安静，只保留创建、返回或查看历史的入口。",
      action: "回到总览"
    },
    error: {
      title: "页面暂时加载失败",
      body: "保留上下文和追踪编号，用户可以重试，工程侧可以排查。",
      action: "重试"
    },
    forbidden: {
      title: "你没有权限查看",
      body: "说明需要谁授权，不暴露敏感正文、证据或交付物。",
      action: "申请访问"
    }
  },
  "en-US": {
    loading: {
      title: "Loading real data",
      body: "The page waits for the WorkHub daemon instead of showing fake success.",
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
    }
  }
};

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;");
}

export function renderRouteStateCard(input: RouteStateCardInput) {
  const locale = normalizeWorkHubLocale(input.locale);
  const route = routeInfo[locale][input.routeKey];
  const copy = stateCopy[locale][input.state];
  const actionHref = input.actionHref ?? (input.state === "empty" ? "/" : route.route);
  const meta = input.state === "error"
    ? input.traceId ?? "trace_id=r4-web-route-state"
    : input.state === "forbidden"
      ? input.ownerLabel ?? (locale === "zh-CN" ? "需要负责人授权" : "Needs owner approval")
      : input.route ?? route.route;
  return `<article class="wh-route-state-card" data-route-key="${input.routeKey}" data-route-state="${input.state}" data-locale="${locale}">
    <span class="wh-route-state-pill">${escapeHtml(meta)}</span>
    <h3>${escapeHtml(copy.title)}</h3>
    <p>${escapeHtml(copy.body)}</p>
    <a class="wh-route-state-action" href="${escapeHtml(actionHref)}">${escapeHtml(copy.action)}</a>
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
