import type { GoldPathAppShell, GoldPathAppShellOptions } from "./app-shell.js";
import { buildGoldPathRouteMap, resolveGoldPathPageKey } from "./app-shell.js";
import { goldPathT, normalizeWorkHubLocale, workHubLocaleOptions, type WorkHubLocale } from "./i18n.js";
import type { GoldPathRenderedPage, GoldPathRenderedSurface } from "./render.js";
import type { WebRouteComponentMap } from "./route-components.js";

export type WebProductMetric = {
  id: string;
  label: string;
  value: string;
};

export type WebProductShellPage = GoldPathRenderedPage & {
  metrics?: WebProductMetric[] | undefined;
};

export type WebProductShellSurface = Omit<GoldPathRenderedSurface, "pages" | "vm"> & {
  vm?: GoldPathRenderedSurface["vm"] | undefined;
  pages: WebProductShellPage[];
};

export type WebProductShellCurrentUser = {
  nickname: string;
  isAdmin: boolean;
};

export type WebProductShellOptions = GoldPathAppShellOptions & {
  currentUser?: WebProductShellCurrentUser | undefined;
  routeComponents?: WebRouteComponentMap | undefined;
  renderActivePanelOnly?: boolean | undefined;
};

type ProductShellCopyKey =
  | "nav.title"
  | "nav.home"
  | "nav.approvals"
  | "nav.workitem"
  | "nav.proposal"
  | "nav.drive"
  | "nav.meetings"
  | "nav.notifications"
  | "nav.calendar"
  | "nav.replay"
  | "nav.cost"
  | "nav.settings"
  | "nav.intake"
  | "topbar.scope"
  | "topbar.rest"
  | "topbar.admin"
  | "topbar.logout"
  | "rail.now"
  | "rail.source"
  | "rail.refresh"
  | "rail.boundary"
  | "rail.next"
  | "rail.nextHome"
  | "rail.nextApprovals"
  | "rail.nextWorkitem"
  | "rail.nextProposal"
  | "rail.nextDrive"
  | "rail.nextMeetings"
  | "rail.nextNotifications"
  | "rail.nextCalendar"
  | "rail.nextReplay"
  | "rail.nextCost"
  | "rail.nextSettings"
  | "masthead.home"
  | "masthead.approvals"
  | "masthead.workitem"
  | "masthead.proposal"
  | "masthead.drive"
  | "masthead.meetings"
  | "masthead.notifications"
  | "masthead.calendar"
  | "masthead.replay"
  | "masthead.cost"
  | "masthead.settings"
  | "masthead.intake"
  | "metric.primary"
  | "metric.queue"
  | "metric.running"
  | "metric.pending"
  | "metric.requests"
  | "metric.trace"
  | "metric.deliverables"
  | "metric.files"
  | "metric.folders"
  | "metric.versions"
  | "metric.evidence"
  | "metric.checks"
  | "metric.comments"
  | "metric.steps"
  | "metric.decisions"
  | "metric.snapshots"
  | "metric.tokens"
  | "metric.cost"
  | "metric.budget"
  | "metric.locale";

const productShellCopy: Record<WorkHubLocale, Record<ProductShellCopyKey, string>> = {
  "zh-CN": {
    "nav.title": "工作入口",
    "nav.home": "总览",
    "nav.approvals": "审批",
    "nav.workitem": "任务",
    "nav.proposal": "变更",
    "nav.drive": "网盘",
    "nav.meetings": "会议",
    "nav.notifications": "通知",
    "nav.calendar": "日程",
    "nav.replay": "回放",
    "nav.cost": "成本",
    "nav.settings": "设置",
    "nav.intake": "提需求",
    "topbar.scope": "网页版",
    "topbar.rest": "实时数据",
    "topbar.admin": "管理员",
    "topbar.logout": "退出",
    "rail.now": "当前焦点",
    "rail.source": "数据源",
    "rail.refresh": "有新动态会自动刷新，数据以后台为准。",
    "rail.boundary": "主窗口专注工作，桌宠在独立窗口陪你 (=^･ω･^=)",
    "rail.next": "下一步",
    "rail.nextHome": "先挑最要紧的一件，其他的我在后台盯着 (๑˃ᴗ˂)",
    "rail.nextApprovals": "打回理由会回灌给 AI 继续改。",
    "rail.nextWorkitem": "核对验收项、AI 轨迹和交付物。",
    "rail.nextProposal": "审查风险、证据和可回滚路径。",
    "rail.nextDrive": "检查正式交付物、版本历史和评论草稿入口。",
    "rail.nextMeetings": "确认待处理洞察，再进入草稿与提议链路。",
    "rail.nextNotifications": "先处理需要你决定的通知，再归档普通消息。",
    "rail.nextCalendar": "看今天和本周的截止时间，优先处理逾期事项。",
    "rail.nextReplay": "回看执行、成本、快照和决策记录。",
    "rail.nextCost": "看预算风险和用量异常。",
    "rail.nextSettings": "确认语言、设备和运行时边界。",
    "masthead.home": "默认只把最该你拿主意的一件事放在最前，其它在后台安静运行。",
    "masthead.approvals": "把需要你拍板的审批、理由、超时提醒和后续操作集中在一起。",
    "masthead.workitem": "任务详情把验收项、证据、AI 工作过程和最近变更放在一起。",
    "masthead.proposal": "变更申请像代码评审一样清楚，但面向文档、表格、文件和版本。",
    "masthead.drive": "项目网盘汇总正式交付物、当前版本、历史版本，以及由评论生成的草稿。",
    "masthead.meetings": "会议洞察把转写、纪要、AI 推荐理由和草稿入口放在同一个项目里。",
    "masthead.notifications": "通知中心按‘待决定’‘了解一下’‘已处理’分组，每条都能回到原始事项。",
    "masthead.calendar": "日程汇总会议后续、任务截止时间和可安排的时间段。",
    "masthead.replay": "完整回看 AI 当时怎么做、花了多少、采纳和回退了什么。",
    "masthead.cost": "成本页按成员、团队、任务和模型拆解预算情况。",
    "masthead.settings": "设置页只管运行和设备，桌宠形象在独立窗口里设置。",
    "masthead.intake": "提需求先选方向，也可以展开手动输入补充。",
    "metric.primary": "当前焦点",
    "metric.queue": "队列",
    "metric.running": "后台运行",
    "metric.pending": "待处理",
    "metric.requests": "请求",
    "metric.trace": "轨迹",
    "metric.deliverables": "交付物",
    "metric.files": "文件",
    "metric.folders": "文件夹",
    "metric.versions": "版本",
    "metric.evidence": "证据",
    "metric.checks": "检查",
    "metric.comments": "评论",
    "metric.steps": "步骤",
    "metric.decisions": "决策",
    "metric.snapshots": "快照",
    "metric.tokens": "Tokens",
    "metric.cost": "成本",
    "metric.budget": "预算",
    "metric.locale": "语言"
  },
  "en-US": {
    "nav.title": "Work entry",
    "nav.home": "Overview",
    "nav.approvals": "Approvals",
    "nav.workitem": "Tasks",
    "nav.proposal": "Changes",
    "nav.drive": "Drive",
    "nav.meetings": "Meetings",
    "nav.notifications": "Inbox",
    "nav.calendar": "Calendar",
    "nav.replay": "Replay",
    "nav.cost": "Cost",
    "nav.settings": "Settings",
    "nav.intake": "New request",
    "topbar.scope": "Web manager",
    "topbar.rest": "Live data",
    "topbar.admin": "Admin",
    "topbar.logout": "Sign out",
    "rail.now": "Focus",
    "rail.source": "Data source",
    "rail.refresh": "Updates refresh automatically; the backend stays the source of truth.",
    "rail.boundary": "The main window stays for focused work; the desktop pet keeps you company in its own window (=^･ω･^=)",
    "rail.next": "Next",
    "rail.nextHome": "Grab the most blocking item first — I'll watch the rest (๑˃ᴗ˂)",
    "rail.nextApprovals": "Rejection reasons flow back into AI work.",
    "rail.nextWorkitem": "Review acceptance, trace, and deliverables.",
    "rail.nextProposal": "Check risk, evidence, and rollback path.",
    "rail.nextDrive": "Inspect accepted deliverables, version history, and comment draft entry points.",
    "rail.nextMeetings": "Confirm pending insights, then continue into draft and proposal review.",
    "rail.nextNotifications": "Handle decisions first, then archive routine updates.",
    "rail.nextCalendar": "Review today and this week, starting with overdue work.",
    "rail.nextReplay": "Review execution, cost, snapshots, and decisions.",
    "rail.nextCost": "Inspect budget risk and usage anomalies.",
    "rail.nextSettings": "Confirm locale, device, and runtime boundaries.",
    "masthead.home": "The default view offers one decision first while background work stays secondary.",
    "masthead.approvals": "A blocking inbox for approvals, reasons, SLA, and follow-up execution.",
    "masthead.workitem": "Task detail keeps acceptance, evidence, AI trace, and recent change together.",
    "masthead.proposal": "Change requests read like PRs, but cover documents, sheets, files, and versions.",
    "masthead.drive": "Project drive shows accepted deliverables, current versions, history, and comment-to-draft signals.",
    "masthead.meetings": "Meeting insights keep transcript, minutes, AI rationale, and draft actions in one project context.",
    "masthead.notifications": "Notifications group decisions, FYI updates, and done items while actions link back to source facts.",
    "masthead.calendar": "Calendar gathers meeting follow-ups, task due dates, and review windows.",
    "masthead.replay": "A read-only explanation of how AI executed, spent, accepted, and rolled back.",
    "masthead.cost": "Cost breaks budget risk down by person, team, task, and model.",
    "masthead.settings": "Settings are for runtime and device controls, not character presentation.",
    "masthead.intake": "Intake starts with choices; typing remains a collapsed fallback.",
    "metric.primary": "Focus",
    "metric.queue": "Queue",
    "metric.running": "Background",
    "metric.pending": "Pending",
    "metric.requests": "Requests",
    "metric.trace": "Trace",
    "metric.deliverables": "Deliverables",
    "metric.files": "Files",
    "metric.folders": "Folders",
    "metric.versions": "Versions",
    "metric.evidence": "Evidence",
    "metric.checks": "Checks",
    "metric.comments": "Comments",
    "metric.steps": "Steps",
    "metric.decisions": "Decisions",
    "metric.snapshots": "Snapshots",
    "metric.tokens": "Tokens",
    "metric.cost": "Cost",
    "metric.budget": "Budget",
    "metric.locale": "Locale"
  }
};

const productShellCss = [
  ":root{color-scheme:light;--wh-product-ink:#1A1D26;--wh-product-secondary:#5B616E;--wh-product-muted:#9AA0AC;--wh-product-faint:#C8CCD4;--wh-product-line:#E6E7EB;--wh-product-line-alt:#EEF0F3;--wh-product-blue:#4F46E5;--wh-product-blue-light:#EEF0FE;--wh-product-blue-tint:#F5F5FE;--wh-product-blue-pale:#D9DBF5;--wh-product-green:#15A05A;--wh-product-green-light:#E7F0EA;--wh-product-green-lighter:#E7F6EE;--wh-product-red:#E5484D;--wh-product-red-light:#FCECEC;--wh-product-coral:#ee6b5f;--wh-product-amber:#E0892A;--wh-product-amber-light:#FCF3E6;--wh-product-paper:#fff;--wh-product-panel:#fff;--wh-product-page:#F7F8FA;--wh-product-soft:#F5F5FE;--wh-radius-card:14px;--wh-radius-button:10px}",
  "body{margin:0;background:var(--wh-product-page);color:var(--wh-product-ink);overflow-x:hidden}",
  ".wh-product-root{min-height:100vh;background:var(--wh-product-page);font-family:\"Segoe UI\",system-ui,-apple-system,\"Microsoft YaHei\",\"PingFang SC\",sans-serif;color:var(--wh-product-ink)}",
  ".wh-product-root,.wh-product-root *{box-sizing:border-box;min-width:0}",
  ".wh-product-topbar{position:sticky;top:0;z-index:30;height:64px;display:flex;align-items:center;justify-content:space-between;gap:16px;border-bottom:1px solid var(--wh-product-line);background:rgba(255,255,255,.9);backdrop-filter:blur(18px);padding:0 22px;overflow:hidden}",
  ".wh-product-brand{display:flex;align-items:center;gap:10px;color:var(--wh-product-ink);text-decoration:none;font-weight:900;min-width:0}.wh-product-brand-mark{width:28px;height:28px;border-radius:8px;background:linear-gradient(135deg,var(--wh-product-blue),var(--wh-product-green) 54%,var(--wh-product-coral));box-shadow:0 10px 24px rgba(53,92,255,.18);flex:0 0 auto}.wh-product-brand span:last-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
  ".wh-product-top-actions{display:flex;align-items:center;justify-content:flex-end;gap:10px;min-width:0;flex:1 1 auto}.wh-product-user{display:flex;align-items:center;gap:8px;min-width:0;max-width:240px}.wh-product-user-name{color:var(--wh-product-ink);font-size:12px;font-weight:850;line-height:1.35;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.wh-product-user .wh-product-rail-tag{flex:0 0 auto}.wh-product-logout{border:1px solid var(--wh-product-line);border-radius:999px;background:#fff;color:var(--wh-product-muted);font-size:11px;font-weight:850;line-height:1.35;padding:5px 10px;cursor:pointer;flex:0 0 auto;font-family:inherit}.wh-product-logout:hover{color:var(--wh-product-ink)}.wh-product-runtime{display:flex;align-items:center;justify-content:flex-end;gap:8px;min-width:0;max-width:100%;overflow:hidden;color:var(--wh-product-muted);font-size:12px;font-weight:800}.wh-product-runtime span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.wh-product-runtime-dot{width:8px;height:8px;border-radius:999px;background:var(--wh-product-green);box-shadow:0 0 0 4px rgba(36,166,106,.12);flex:0 0 auto}",
  ".wh-locale-toggle{display:grid;grid-template-columns:repeat(2,42px);gap:2px;border:1px solid var(--wh-product-line);border-radius:8px;background:#eef3f9;padding:2px;flex:0 0 auto}.wh-locale-toggle button{height:28px;border:0;border-radius:6px;background:transparent;color:var(--wh-product-muted);font-weight:850;font-size:12px;line-height:1.35;cursor:pointer}.wh-locale-toggle button[aria-pressed=true]{background:#fff;color:var(--wh-product-blue);box-shadow:0 5px 14px rgba(37,51,79,.1)}",
  ".wh-product-layout{display:grid;grid-template-columns:218px minmax(0,1fr) 276px;gap:0;min-height:calc(100vh - 64px);width:100%;overflow:hidden}.wh-product-nav{border-right:1px solid var(--wh-product-line);background:rgba(247,250,254,.78);padding:18px 12px;overflow-y:auto;overflow-x:hidden}.wh-product-nav-title{margin:2px 10px 12px;color:var(--wh-product-muted);font-size:12px;font-weight:900;text-transform:uppercase;letter-spacing:0}.wh-product-nav-list{display:grid;gap:6px}.wh-product-nav a{display:grid;grid-template-columns:minmax(0,1fr);align-items:center;gap:3px;border-radius:8px;padding:10px 12px;color:var(--wh-product-ink);font-size:14px;font-weight:800;text-decoration:none}.wh-product-nav a span,.wh-product-nav a small{min-width:0;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.wh-product-nav a:hover{background:#fff}.wh-product-nav a[aria-current=page]{background:#fff;color:var(--wh-product-blue);box-shadow:0 0 0 1px rgba(53,92,255,.18),0 10px 24px rgba(37,51,79,.06)}.wh-product-nav small{color:var(--wh-product-faint);font-size:11px;font-weight:800}",
  ".wh-product-main{min-width:0;max-width:100%;overflow:hidden;padding:24px clamp(14px,2vw,28px)}.wh-product-masthead{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:16px;align-items:end;max-width:1120px;margin:0 auto 18px}.wh-product-kicker{margin:0 0 8px;color:var(--wh-product-blue);font-size:12px;font-weight:900;text-transform:uppercase;letter-spacing:0}.wh-product-masthead h1{margin:0;color:var(--wh-product-ink);font-size:clamp(24px,2.4vw,34px);line-height:1.35;letter-spacing:0;overflow-wrap:anywhere}.wh-product-masthead p{margin:8px 0 0;color:var(--wh-product-muted);font-size:14px;line-height:1.55;max-width:760px;overflow-wrap:anywhere}",
  ".wh-product-metrics{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;align-items:flex-end;max-width:390px}.wh-product-metric{display:grid;gap:2px;border:1px solid var(--wh-product-line);border-radius:8px;background:rgba(255,255,255,.86);padding:8px 10px;min-width:78px;box-shadow:0 10px 28px rgba(37,51,79,.05)}.wh-product-metric strong{font-size:17px;line-height:1.35;overflow-wrap:anywhere}.wh-product-metric span{color:var(--wh-product-muted);font-size:11px;font-weight:850;line-height:1.35;overflow-wrap:anywhere}",
  ".wh-product-route-panels{max-width:1120px;margin:0 auto;min-width:0}.wh-route-panel{min-width:0;max-width:100%;overflow:hidden}.wh-route-panel[hidden]{display:none}.wh-product-route-panels .wh-shell{padding:0;background:transparent;min-height:0}.wh-product-route-panels .wh-stage{max-width:none;margin:0}.wh-product-route-panels .wh-panel{box-shadow:0 16px 42px rgba(37,51,79,.07)}",
  ".wh-product-rail{border-left:1px solid var(--wh-product-line);background:rgba(247,250,254,.68);padding:24px 16px;display:grid;align-content:start;gap:12px;overflow:auto}.wh-product-rail-block{border:1px solid var(--wh-product-line);border-radius:8px;background:rgba(255,255,255,.86);padding:13px 14px;display:grid;gap:6px}.wh-product-rail-block h2{margin:0;color:var(--wh-product-ink);font-size:13px;line-height:1.35}.wh-product-rail-block p{margin:0;color:var(--wh-product-muted);font-size:12px;line-height:1.45;overflow-wrap:anywhere}.wh-product-rail-tag{display:inline-flex;align-items:center;width:max-content;max-width:100%;border-radius:999px;background:#eef4ff;color:var(--wh-product-blue);font-size:11px;font-weight:900;padding:4px 8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
  ".wh-app-notice{position:fixed;right:18px;bottom:18px;z-index:40;display:grid;gap:4px;width:max-content;max-width:min(420px,calc(100vw - 36px));border:1px solid rgba(53,92,255,.22);background:rgba(255,255,255,.96);border-radius:8px;box-shadow:0 18px 60px rgba(37,51,79,.16);padding:12px 14px;color:var(--wh-product-ink);font-weight:750;overflow-wrap:anywhere}.wh-app-notice[hidden]{display:none}.wh-app-notice[data-r4-notice-tone=success]{border-color:rgba(36,166,106,.42);box-shadow:0 18px 60px rgba(36,166,106,.16)}.wh-app-notice[data-r4-notice-tone=warning]{border-color:rgba(217,139,22,.45);box-shadow:0 18px 60px rgba(217,139,22,.15)}.wh-app-notice[data-r4-notice-tone=danger]{border-color:rgba(238,107,95,.45);box-shadow:0 18px 60px rgba(238,107,95,.16)}.wh-app-notice-title{display:block;font-size:13px;line-height:1.35;color:var(--wh-product-ink);font-weight:900}.wh-app-notice-body{display:block;color:var(--wh-product-muted);font-size:12px;line-height:1.45;max-width:100%;overflow-wrap:anywhere}.wh-app-action-row{display:flex;gap:10px;flex-wrap:wrap;margin-top:10px}.wh-app-action-row button{border:1px solid var(--wh-product-line);border-radius:8px;background:#fff;padding:9px 12px;font-weight:750;color:var(--wh-product-ink);cursor:pointer}.wh-app-action-row button:first-child{background:var(--wh-product-blue);border-color:var(--wh-product-blue);color:#fff}",
  "@media (max-width:1120px){.wh-product-layout{grid-template-columns:206px minmax(0,1fr)}.wh-product-rail{display:none}.wh-product-masthead{grid-template-columns:1fr}.wh-product-metrics{justify-content:flex-start;max-width:100%}}",
  "@media (max-width:780px){.wh-product-topbar{height:auto;min-height:62px;padding:10px 12px;align-items:flex-start}.wh-product-top-actions{flex-wrap:wrap}.wh-product-runtime{order:2;flex-basis:100%;justify-content:flex-start}.wh-product-layout{grid-template-columns:1fr;min-height:calc(100vh - 62px)}.wh-product-nav{position:static;border-right:0;border-bottom:1px solid var(--wh-product-line);padding:10px;overflow:hidden}.wh-product-nav-title{display:none}.wh-product-nav-list{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px;min-width:0}.wh-product-nav a{grid-template-columns:minmax(0,1fr);justify-items:center;text-align:center;padding:9px 8px;font-size:13px;white-space:normal}.wh-product-nav small{display:none}.wh-product-main{padding:18px 12px}.wh-product-metrics{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));width:100%}.wh-product-metric{min-width:0}.wh-product-route-panels .wh-main{padding:18px}.wh-locale-toggle{grid-template-columns:repeat(2,36px)}}"
].join("");

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;");
}

function productT(locale: WorkHubLocale, key: ProductShellCopyKey) {
  return productShellCopy[locale][key];
}

function labelForPage(page: GoldPathRenderedPage, locale: WorkHubLocale) {
  const key = `nav.${page.key}` as ProductShellCopyKey;
  return productShellCopy[locale][key] ?? page.title;
}

function subtitleForPage(pageKey: GoldPathRenderedPage["key"], locale: WorkHubLocale) {
  const key = `masthead.${pageKey}` as ProductShellCopyKey;
  return productShellCopy[locale][key] ?? "";
}

function nextForPage(pageKey: GoldPathRenderedPage["key"], locale: WorkHubLocale) {
  const key = `rail.next${pageKey[0]?.toUpperCase() ?? ""}${pageKey.slice(1)}` as ProductShellCopyKey;
  return productShellCopy[locale][key] ?? productShellCopy[locale]["rail.nextHome"];
}

function renderLocaleToggle(locale: WorkHubLocale) {
  return `<div class="wh-locale-toggle" role="group" aria-label="${escapeHtml(goldPathT(locale, "shell.localeAria"))}">${workHubLocaleOptions
    .map(
      (option) =>
        `<button type="button" data-wh-locale="${option.locale}" aria-pressed="${option.locale === locale ? "true" : "false"}" title="${escapeHtml(option.label)}">${escapeHtml(option.shortLabel)}</button>`
    )
    .join("")}</div>`;
}

function renderProductMetrics(page: WebProductShellPage, rendered: WebProductShellSurface, locale: WorkHubLocale) {
  const metrics = pageMetrics(page, rendered, locale).slice(0, 4);
  return `<div class="wh-product-metrics" data-r4-product-metrics="true">${metrics
    .map(
      (metric) =>
        `<div class="wh-product-metric" data-r4-product-metric="${escapeHtml(metric.id)}"><strong>${escapeHtml(metric.value)}</strong><span>${escapeHtml(metric.label)}</span></div>`
    )
    .join("")}</div>`;
}

function pageMetrics(page: WebProductShellPage, rendered: WebProductShellSurface, locale: WorkHubLocale): WebProductMetric[] {
  if (page.metrics) {
    return page.metrics;
  }
  const fallback = [{ id: "locale", label: productT(locale, "metric.locale"), value: locale }];
  const vm = rendered.vm?.page_vms;
  if (!vm) {
    return fallback;
  }
  if (page.key === "home") {
    const attention = vm.attention;
    return [
      { id: "primary", label: productT(locale, "metric.primary"), value: attention.primary ? "1" : "0" },
      { id: "queue", label: productT(locale, "metric.queue"), value: String(attention.queue.length) },
      { id: "running", label: productT(locale, "metric.running"), value: String(attention.background_runs.length) }
    ];
  }
  if (page.key === "approvals") {
    const approvals = vm.approvals;
    return [
      { id: "pending", label: productT(locale, "metric.pending"), value: String(approvals.counts.pending ?? approvals.items.length) },
      { id: "requests", label: productT(locale, "metric.requests"), value: String(approvals.requests.length) },
      { id: "queue", label: productT(locale, "metric.queue"), value: String(approvals.items.length) }
    ];
  }
  if (page.key === "workitem") {
    const workitem = vm.workitem;
    return [
      { id: "trace", label: productT(locale, "metric.trace"), value: String(workitem.agent_trace_preview.length) },
      { id: "deliverables", label: productT(locale, "metric.deliverables"), value: String(workitem.accepted_deliverables.length) },
      { id: "evidence", label: productT(locale, "metric.evidence"), value: String(workitem.evidence_refs.length) }
    ];
  }
  if (page.key === "proposal") {
    const proposal = vm.proposal;
    return [
      { id: "checks", label: productT(locale, "metric.checks"), value: String(proposal.manifest.checks.length) },
      { id: "evidence", label: productT(locale, "metric.evidence"), value: String(proposal.evidence_refs.length) },
      { id: "comments", label: productT(locale, "metric.comments"), value: String(proposal.comments.length) }
    ];
  }
  if (page.key === "replay") {
    const replay = vm.replay;
    return [
      { id: "steps", label: productT(locale, "metric.steps"), value: String(replay.steps.length) },
      { id: "decisions", label: productT(locale, "metric.decisions"), value: String(replay.merge_timeline.length) },
      { id: "snapshots", label: productT(locale, "metric.snapshots"), value: String(replay.snapshots.length) }
    ];
  }
  if (page.key === "cost") {
    const cost = vm.cost;
    const totalTokens = cost.token_in + cost.token_out;
    return [
      { id: "tokens", label: productT(locale, "metric.tokens"), value: String(totalTokens) },
      { id: "cost", label: productT(locale, "metric.cost"), value: cost.currency === "CNY" ? `¥${cost.total_cost_cny}` : cost.total_cost_cny },
      { id: "budget", label: productT(locale, "metric.budget"), value: String(cost.budget.length) }
    ];
  }
  return fallback;
}

function renderProductNav(
  pages: GoldPathRenderedPage[],
  activeKey: GoldPathRenderedPage["key"],
  locale: WorkHubLocale
) {
  return pages
    .map((page) => {
      const active = page.key === activeKey;
      const navHref = page.route;
      return `<a href="${escapeHtml(navHref)}" data-wh-route="${escapeHtml(page.route)}" data-wh-page-key="${page.key}" aria-current="${active ? "page" : "false"}"><span>${escapeHtml(labelForPage(page, locale))}</span></a>`;
    })
    .join("");
}

function renderRoutePanel(page: GoldPathRenderedPage, active: boolean, routeComponents?: WebRouteComponentMap) {
  const routeComponent = routeComponents?.[page.key];
  const componentMarker = routeComponent
    ? ` data-r4-route-component-panel="${page.key}" data-r4-route-component-active="${active ? "true" : "false"}"`
    : "";
  const hydrationMarker = routeComponent
    ? ` data-r4-hydration-panel="true" data-r4-hydration-root-id="${escapeHtml(routeComponent.hydration.rootId)}" data-r4-hydration-route="${escapeHtml(routeComponent.hydration.routeKey)}" data-r4-hydration-mode="${escapeHtml(routeComponent.hydration.mode)}" data-r4-hydration-page-vm="${escapeHtml(routeComponent.hydration.pageVm)}" data-r4-hydration-action-count="${escapeHtml(String(routeComponent.hydration.actionHrefCount))}"`
    : "";
  return `<section class="wh-route-panel" data-wh-panel="${page.key}"${componentMarker}${hydrationMarker} ${active ? "" : "hidden"}>${routeComponent?.html ?? page.html}</section>`;
}

export function renderWebProductShell(
  rendered: WebProductShellSurface,
  options: WebProductShellOptions
): GoldPathAppShell {
  const locale = normalizeWorkHubLocale(options.locale);
  const routeMap = buildGoldPathRouteMap(rendered.pages);
  const activeKey = resolveGoldPathPageKey(routeMap, options.currentRoute ?? "") ?? rendered.pages[0]?.key ?? "home";
  const activePage = rendered.pages.find((page) => page.key === activeKey) ?? rendered.pages[0];
  const nav = renderProductNav(rendered.pages, activeKey, locale);
  const routeComponentCss = [...new Set(Object.values(options.routeComponents ?? {})
    .map((component) => component.css)
    .filter(Boolean))]
    .join("");
  const panelPages = options.renderActivePanelOnly && activePage ? [activePage] : rendered.pages;
  const panels = panelPages.map((page) => renderRoutePanel(page, page.key === activeKey, options.routeComponents)).join("");
  const metrics = activePage ? renderProductMetrics(activePage, rendered, locale) : "";
  const activeTitle = activePage?.title ?? options.appName;
  const activeSubtitle = activePage ? subtitleForPage(activePage.key, locale) : "";
  const activeNext = activePage ? nextForPage(activePage.key, locale) : productT(locale, "rail.nextHome");

  return {
    routeMap,
    css: `${productShellCss}${rendered.css}${routeComponentCss}`,
    html: `<div class="wh-product-root" data-wh-surface="${rendered.surface}" data-r4-product-shell="true" data-r4-product-route-key="${escapeHtml(activeKey)}" data-r4-product-link-mode="path">
      <header class="wh-product-topbar">
        <a class="wh-product-brand" href="/" data-wh-route="/" data-wh-page-key="home"><span class="wh-product-brand-mark" aria-hidden="true"></span><span>${escapeHtml(options.appName)}</span></a>
        <div class="wh-product-top-actions">
          <div class="wh-product-runtime" aria-label="${escapeHtml(productT(locale, "topbar.scope"))}"><span class="wh-product-runtime-dot" aria-hidden="true"></span><span>${escapeHtml(productT(locale, "topbar.scope"))}</span></div>
          ${options.currentUser ? `<div class="wh-product-user" data-wh-current-user="${escapeHtml(options.currentUser.nickname)}" data-wh-current-user-admin="${escapeHtml(String(options.currentUser.isAdmin))}"><span class="wh-product-user-name">${escapeHtml(options.currentUser.nickname)}</span>${options.currentUser.isAdmin ? `<span class="wh-product-rail-tag">${escapeHtml(productT(locale, "topbar.admin"))}</span>` : ""}<button type="button" class="wh-product-logout" data-wh-logout="true" data-action-id="logout">${escapeHtml(productT(locale, "topbar.logout"))}</button></div>` : ""}
          ${renderLocaleToggle(locale)}
        </div>
      </header>
      <div class="wh-product-layout">
        <nav class="wh-product-nav" aria-label="${escapeHtml(goldPathT(locale, "shell.navAria"))}">
          <div class="wh-product-nav-title">${escapeHtml(productT(locale, "nav.title"))}</div>
          <div class="wh-product-nav-list">${nav}</div>
        </nav>
        <main class="wh-product-main">
          ${activeKey === "home" ? "" : `<section class="wh-product-masthead" data-r4-product-masthead="true">
            <div>
              <p class="wh-product-kicker">${escapeHtml(productT(locale, "rail.now"))}</p>
              <h1>${escapeHtml(activeTitle)}</h1>
              <p>${escapeHtml(activeSubtitle)}</p>
            </div>
            ${metrics}
          </section>`}
          <div class="wh-product-route-panels">${panels}</div>
        </main>
        <aside class="wh-product-rail" aria-label="${escapeHtml(productT(locale, "rail.now"))}">
          <section class="wh-product-rail-block">
            <span class="wh-product-rail-tag">${escapeHtml(productT(locale, "rail.source"))}</span>
            <h2>${escapeHtml(productT(locale, "topbar.rest"))}</h2>
            <p>${escapeHtml(productT(locale, "rail.refresh"))}</p>
          </section>
          <section class="wh-product-rail-block">
            <span class="wh-product-rail-tag">${escapeHtml(productT(locale, "rail.next"))}</span>
            <h2>${escapeHtml(activePage ? labelForPage(activePage, locale) : options.appName)}</h2>
            <p>${escapeHtml(activeNext)}</p>
          </section>
          <section class="wh-product-rail-block">
            <span class="wh-product-rail-tag">${escapeHtml(productT(locale, "topbar.scope"))}</span>
            <p>${escapeHtml(productT(locale, "rail.boundary"))}</p>
          </section>
        </aside>
      </div>
      <div class="wh-app-notice" data-wh-app-notice ${options.notice ? "" : "hidden"}>${escapeHtml(options.notice ?? "")}</div>
    </div>`
  };
}
