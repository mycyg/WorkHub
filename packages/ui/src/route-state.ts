import { normalizeWorkHubLocale, type WorkHubLocale } from "./gold-path/i18n.js";

import { uiCopyT } from "./locales.js";
import { routeInfo, stateCopy } from "./route-state-copy.js";

export type RouteStateKind = "loading" | "empty" | "error" | "forbidden" | "notFound";

export type R4WebRouteKey =
  | "home"
  | "projects"
  | "project-home"
  | "project-timeline"
  | "intake"
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
  "project-timeline",
  "intake",
  "approvals",
  "workitem",
  "proposal",
  "conversation",
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
  ".wh-route-state-trace{margin:0;color:#93a0b8;font-size:11px;font-weight:600;overflow-wrap:anywhere}",
  "@media (max-width:980px){.wh-route-state-row{grid-template-columns:1fr}.wh-route-state-route{position:sticky;top:0;z-index:1}}"
].join("");

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
  // L（错误态诚实层级）：错误卡顶部 pill 曾直接渲工程 trace 串(status=/code=)，用户读到一串黑话。
  // 顶部 pill 改渲路由(与其它态一致)，把 trace 降到正文之后的弱化 footer——工程师仍可取证，用户不被黑话劝退。
  const meta = input.state === "forbidden"
    ? input.ownerLabel ?? (uiCopyT(locale, "needsOwnerApproval"))
    : input.route ?? route.route;
  // A2-06：没有 traceId 时不再拼一条内部代号兜底串（旧值是轮次代号 + 模块名），整条 footer 不渲染。
  const errorFooter = input.state === "error" && input.traceId
    ? `<p class="wh-route-state-trace" data-route-state-trace="true">${escapeHtml(input.traceId)}</p>`
    : "";
  return `<article class="wh-route-state-card" data-route-key="${input.routeKey}" data-route-state="${input.state}" data-locale="${locale}">
    <span class="wh-route-state-pill">${escapeHtml(meta)}</span>
    <h3>${escapeHtml(input.titleOverride ?? copy.title)}</h3>
    <p>${escapeHtml(input.bodyOverride ?? copy.body)}</p>
    <a class="wh-route-state-action" href="${escapeHtml(safeHref(actionHref))}">${escapeHtml(input.actionLabel ?? copy.action)}</a>
    ${errorFooter}
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
