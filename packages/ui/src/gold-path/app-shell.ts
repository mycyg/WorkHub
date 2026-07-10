import type { GoldPathRenderedPage, GoldPathRenderedSurface } from "./render.js";
import { goldPathT, normalizeWorkHubLocale, workHubLocaleOptions, type WorkHubLocale } from "./i18n.js";

type PageKey = GoldPathRenderedPage["key"];

export type GoldPathAppShellOptions = {
  appName: string;
  surfaceLabel: string;
  currentRoute?: string;
  apiBaseLabel?: string;
  notice?: string;
  locale?: WorkHubLocale | undefined;
  linkMode?: "path";
};

export type GoldPathHrefAction =
  | { kind: "navigate"; pageKey: PageKey }
  | { kind: "api-action"; requiresReason: boolean; method: "POST" | "GET" | "PUT" | "DELETE" | "UNKNOWN" }
  | { kind: "external" };

export type GoldPathAppShell = {
  css: string;
  html: string;
  routeMap: Record<string, PageKey>;
};

const appCss = [
  ":root{color-scheme:light;--wh-app-ink:#172033;--wh-app-muted:#66728c;--wh-app-line:#dce4f1;--wh-app-blue:#355cff;--wh-app-coral:#ee6b5f;--wh-app-green:#24a66a;--wh-app-paper:rgba(255,255,255,.86);--wh-app-soft:#f5f8fc}",
  "body{margin:0;background:#f6f9fd;color:var(--wh-app-ink);overflow-x:hidden}",
  ".wh-app-root{min-height:100vh;background:linear-gradient(180deg,#fbfdff 0%,#edf4fb 100%);font-family:\"Aptos\",\"Segoe UI\",sans-serif}.wh-app-root,.wh-app-root *{box-sizing:border-box}",
  ".wh-app-topbar{position:sticky;top:0;z-index:20;height:62px;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:0 22px;border-bottom:1px solid var(--wh-app-line);background:rgba(255,255,255,.88);backdrop-filter:blur(18px);overflow:hidden}",
  ".wh-app-brand{display:flex;align-items:center;gap:10px;font-weight:850;min-width:0;flex:0 1 auto}.wh-app-brand span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.wh-app-mark{width:26px;height:26px;border-radius:9px;background:linear-gradient(145deg,#6D8BFF 0%,#4F46E5 48%,#7C3AED 100%);box-shadow:0 8px 20px rgba(79,70,229,.3),inset 0 1px 1px rgba(255,255,255,.6);flex:0 0 auto}",
  ".wh-app-top-actions{display:flex;align-items:center;justify-content:flex-end;gap:12px;min-width:0;flex:1 1 auto;overflow:hidden}.wh-app-runtime{display:flex;align-items:center;gap:10px;color:var(--wh-app-muted);font-size:13px;min-width:0;max-width:100%;flex:1 1 auto;overflow:hidden}.wh-app-runtime span:not(.wh-app-dot){min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.wh-app-dot{width:8px;height:8px;border-radius:50%;background:var(--wh-app-green);box-shadow:0 0 0 4px rgba(36,166,106,.12);flex:0 0 auto}",
  ".wh-locale-toggle{display:grid;grid-template-columns:repeat(2,42px);gap:2px;border:1px solid var(--wh-app-line);border-radius:12px;background:#eef3f9;padding:2px;flex:0 0 auto}.wh-locale-toggle button{height:28px;border:0;border-radius:6px;background:transparent;color:var(--wh-app-muted);font-weight:800;font-size:12px;line-height:1.35;cursor:pointer}.wh-locale-toggle button[aria-pressed=true]{background:#fff;color:var(--wh-app-blue);box-shadow:0 5px 14px rgba(37,51,79,.1)}",
  ".wh-app-layout{display:grid;grid-template-columns:230px minmax(0,1fr);min-height:calc(100vh - 63px);width:100%;overflow:hidden}.wh-app-nav{border-right:1px solid var(--wh-app-line);padding:18px 14px;background:rgba(247,250,254,.72)}",
  ".wh-app-nav-title{font-size:12px;font-weight:800;color:var(--wh-app-muted);text-transform:uppercase;letter-spacing:0;margin:4px 10px 12px}.wh-app-nav-list{display:grid;gap:6px}",
  ".wh-app-nav a{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 12px;border-radius:12px;color:var(--wh-app-ink);text-decoration:none;font-weight:700;font-size:14px}.wh-app-nav a:hover{background:#fff}.wh-app-nav a[aria-current=page]{background:#fff;color:var(--wh-app-blue);box-shadow:0 0 0 1px rgba(53,92,255,.18),0 10px 24px rgba(37,51,79,.06)}",
  ".wh-app-nav small{font-size:11px;color:var(--wh-app-muted);font-weight:650}.wh-app-content{min-width:0;max-width:100%;overflow:hidden}.wh-app-content h1[tabindex]:focus{outline:none}.wh-route-panel{min-width:0;max-width:100%;overflow:hidden}.wh-route-panel[hidden]{display:none}.wh-app-notice{position:fixed;right:max(18px,env(safe-area-inset-right));bottom:max(18px,env(safe-area-inset-bottom));z-index:40;max-width:360px;border:1px solid rgba(53,92,255,.22);background:var(--wh-app-paper);border-radius:16px;box-shadow:0 18px 60px rgba(37,51,79,.16);padding:12px 14px;color:var(--wh-app-ink);font-weight:700}.wh-app-notice[hidden]{display:none}.wh-app-boot{min-height:100vh;display:grid;place-items:center;background:linear-gradient(180deg,#fbfdff,#eef4fb);font-family:\"Aptos\",\"Segoe UI\",sans-serif;color:#172033}.wh-app-boot-card{width:min(420px,calc(100vw - 36px));border:1px solid rgba(255,255,255,.75);border-radius:18px;background:rgba(255,255,255,.82);box-shadow:0 18px 60px rgba(37,51,79,.1);padding:24px}.wh-app-boot-card h1{margin:0 0 8px;font-size:24px}.wh-app-boot-card p{margin:0;color:var(--wh-app-muted);line-height:1.55}",
  ".wh-app-action-row{display:flex;gap:10px;flex-wrap:wrap;margin-top:14px}.wh-app-action-row button{border:1px solid var(--wh-app-line);border-radius:12px;background:rgba(255,255,255,.92);padding:9px 12px;font-weight:750;color:var(--wh-app-ink)}.wh-app-action-row button:first-child{background:var(--wh-app-blue);border-color:var(--wh-app-blue);color:#fff}",
  "@media (max-width:900px){.wh-app-layout{grid-template-columns:1fr}.wh-app-nav{position:sticky;top:62px;z-index:10;border-right:0;border-bottom:1px solid var(--wh-app-line);padding:10px;overflow:auto}.wh-app-nav-list{grid-auto-flow:column;grid-auto-columns:max-content}.wh-app-nav-title{display:none}}",
  "@media (max-width:640px){.wh-app-topbar{padding:0 12px;gap:10px}.wh-app-runtime span:last-child{display:none}.wh-locale-toggle{grid-template-columns:repeat(2,36px)}}"
].join("");

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#39;");
}

function normalizeRoute(route: string) {
  if (!route) {
    return "/";
  }
  try {
    const url = new URL(route, "https://workhub.local");
    return url.pathname === "" ? "/" : url.pathname;
  } catch {
    const [path = "/"] = route.split(/[?#]/u);
    return path || "/";
  }
}

function pageAliases(page: GoldPathRenderedPage) {
  const aliases = new Set<string>([normalizeRoute(page.route), `/${page.key}`]);
  if (page.key === "home") {
    aliases.add("/");
  }
  if (page.key === "intake") {
    aliases.add("/intake");
  }
  if (page.key === "approvals") {
    aliases.add("/approvals");
  }
  if (page.key === "workitem") {
    aliases.add("/workitems");
  }
  if (page.key === "proposal") {
    aliases.add("/proposals");
  }
  if (page.key === "replay") {
    aliases.add("/agent-runs");
  }
  if (page.key === "cost") {
    aliases.add("/dashboard/cost");
  }
  if (page.key === "agents") {
    aliases.add("/dashboard/agents");
  }
  if (page.key === "knowledge") {
    aliases.add("/knowledge");
    aliases.add("/knowledge/search");
  }
  if (page.key === "settings") {
    aliases.add("/settings");
  }
  return [...aliases];
}

function renderLocaleToggle(locale: WorkHubLocale) {
  return `<div class="wh-locale-toggle" role="group" aria-label="${escapeHtml(goldPathT(locale, "shell.localeAria"))}">${workHubLocaleOptions
    .map(
      (option) =>
        `<button type="button" data-wh-locale="${option.locale}" aria-pressed="${option.locale === locale ? "true" : "false"}" title="${escapeHtml(option.label)}">${escapeHtml(option.shortLabel)}</button>`
    )
    .join("")}</div>`;
}

export function buildGoldPathRouteMap(pages: GoldPathRenderedPage[]) {
  const routeMap: Record<string, PageKey> = {};
  for (const page of pages) {
    for (const alias of pageAliases(page)) {
      routeMap[alias] = page.key;
    }
  }
  return routeMap;
}

export function resolveGoldPathPageKey(routeMap: Record<string, PageKey>, href: string): PageKey | undefined {
  const route = normalizeRoute(href);
  if (routeMap[route]) {
    return routeMap[route];
  }
  if (route.startsWith("/intake/")) {
    return "intake";
  }
  if (route.startsWith("/approvals")) {
    return "approvals";
  }
  if (route.startsWith("/projects/")) {
    // 项目主页是 detail-only 路由（不在 shell 导航的 routeMap 里），与 workitem/proposal 同样
    // 走前缀回退识别，让项目行点击走 SPA 导航而非整页刷新。/projects 列表本身已被 routeMap 命中。
    return "project-home";
  }
  if (route.startsWith("/workitems/")) {
    return "workitem";
  }
  if (route.startsWith("/proposals/")) {
    return "proposal";
  }
  if (route.startsWith("/agent-runs/")) {
    return "replay";
  }
  if (route.startsWith("/knowledge")) {
    return "knowledge";
  }
  if (route.startsWith("/settings")) {
    return "settings";
  }
  return undefined;
}

export function classifyGoldPathHref(
  routeMap: Record<string, PageKey>,
  href: string,
  input: { requiresReason?: boolean | undefined; method?: string | undefined } = {}
): GoldPathHrefAction {
  const pageKey = resolveGoldPathPageKey(routeMap, href);
  if (pageKey) {
    return { kind: "navigate", pageKey };
  }
  const route = normalizeRoute(href);
  if (route.startsWith("/api/")) {
    const method = input.method === "POST" || input.method === "GET" || input.method === "PUT" || input.method === "DELETE"
      ? input.method
      : "UNKNOWN";
    return { kind: "api-action", requiresReason: input.requiresReason === true, method };
  }
  return { kind: "external" };
}

export function renderGoldPathAppShell(
  rendered: GoldPathRenderedSurface,
  options: GoldPathAppShellOptions
): GoldPathAppShell {
  const locale = normalizeWorkHubLocale(options.locale);
  const routeMap = buildGoldPathRouteMap(rendered.pages);
  const activeKey = resolveGoldPathPageKey(routeMap, options.currentRoute ?? "") ?? rendered.pages[0]?.key ?? "home";
  const nav = rendered.pages
    .map((page) => {
      const active = page.key === activeKey;
      const navHref = page.route;
      return `<a href="${escapeHtml(navHref)}" data-wh-route="${escapeHtml(page.route)}" data-wh-page-key="${page.key}" aria-current="${active ? "page" : "false"}"><span>${escapeHtml(page.title)}</span></a>`;
    })
    .join("");
  const panels = rendered.pages
    .map(
      (page) =>
        `<section class="wh-route-panel" data-wh-panel="${page.key}" ${page.key === activeKey ? "" : "hidden"}>${page.html}</section>`
    )
    .join("");

  return {
    routeMap,
    css: `${appCss}${rendered.css}`,
    html: `<div class="wh-app-root" data-wh-surface="${rendered.surface}">
      <header class="wh-app-topbar">
        <div class="wh-app-brand"><span class="wh-app-mark" aria-hidden="true"></span><span>${escapeHtml(options.appName)}</span></div>
        <div class="wh-app-top-actions">
          <div class="wh-app-runtime"><span class="wh-app-dot" aria-hidden="true"></span><span>${escapeHtml(options.surfaceLabel)}</span><span>${escapeHtml(options.apiBaseLabel ?? goldPathT(locale, "shell.typedApi"))}</span></div>
          ${renderLocaleToggle(locale)}
        </div>
      </header>
      <div class="wh-app-layout">
        <nav class="wh-app-nav" aria-label="${escapeHtml(goldPathT(locale, "shell.navAria"))}">
          <div class="wh-app-nav-title">${escapeHtml(goldPathT(locale, "shell.navTitle"))}</div>
          <div class="wh-app-nav-list">${nav}</div>
        </nav>
        <div class="wh-app-content">${panels}</div>
      </div>
      <div class="wh-app-notice" role="status" aria-live="polite" aria-atomic="true" data-wh-app-notice ${options.notice ? "" : "hidden"}>${escapeHtml(options.notice ?? "")}</div>
    </div>`
  };
}

export function renderGoldPathBootDocument(input: { title: string; message: string; tone?: "loading" | "error" }) {
  const tone = input.tone ?? "loading";
  return `<style>${appCss}</style><main class="wh-app-boot" data-boot-tone="${tone}"><section class="wh-app-boot-card"><h1>${escapeHtml(input.title)}</h1><p>${escapeHtml(input.message)}</p></section></main>`;
}
