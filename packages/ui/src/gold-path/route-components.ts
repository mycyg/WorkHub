import type {
  ActionSpec,
  ApprovalCenterVM,
  AttentionAction,
  AttentionHomeVM,
  AttentionItem,
  CostDashboardVM,
  DeliverableChange,
  DeliverableCheck,
  EvidenceBubble,
  EvidenceRef,
  ProposalConflict,
  ProposalDetailVM,
  SessionVM,
  SettingsPageVM,
  GoldPathSurfaceVM,
  WorkItemDetailVM
} from "@workhub/contracts";

import { renderAgentRunReplay } from "../replay/index.js";
import { proposalCss, renderProposalConflictCards } from "../proposal/index.js";
import {
  createCostReactRouteComponent,
  createHomeReactRouteComponent,
  createProposalReactRouteComponent,
  createReplayReactRouteComponent,
  createSettingsReactRouteComponent,
  reactRouteComponentMarkerAttrs,
  type WebReactRouteComponentAdapter
} from "./route-react-components.js";
import {
  changeTypeLabel,
  checkStatusLabel,
  deliverableTargetLabel,
  evidenceSourceLabel,
  previewKindLabel,
  uiCount,
  uiT,
  workItemStatusLabel
} from "../i18n.js";
import { goldPathT, normalizeWorkHubLocale, type WorkHubLocale } from "./i18n.js";
import type { GoldPathRenderedPage } from "./render.js";

export type WebRouteComponentKey = Extract<GoldPathRenderedPage["key"], "home" | "intake" | "approvals" | "workitem" | "proposal" | "replay" | "cost" | "knowledge" | "settings">;

export type WebRouteComponent = {
  key: WebRouteComponentKey;
  html: string;
  css: string;
  primaryHrefs: string[];
  hydration: WebRouteHydrationBoundary;
  reactComponent?: WebReactRouteComponentAdapter;
};

export type WebRouteComponentMap = Partial<Record<GoldPathRenderedPage["key"], WebRouteComponent>>;

type RouteComponentOptions = {
  locale?: WorkHubLocale | undefined;
};

export type WebRouteHydrationMode = "html-fallback";

export type WebRouteComponentSource = "page-vm" | "session-vm" | "evidence-bubble";

export type WebRouteHydrationBoundary = {
  rootId: string;
  routeKey: WebRouteComponentKey;
  mode: WebRouteHydrationMode;
  source: WebRouteComponentSource;
  locale: WorkHubLocale;
  pageVm: string;
  actionHrefCount: number;
  adapter: "route-component-v1";
};

type CreateWebRouteComponentInput = {
  key: WebRouteComponentKey;
  css: string;
  primaryHrefs: string[];
  html: string;
  source: WebRouteComponentSource;
  locale: WorkHubLocale;
  pageVm: string;
  reactComponent?: WebReactRouteComponentAdapter;
};

type ProposalConflictSurface = GoldPathSurfaceVM & {
  conflicts?: ProposalConflict[];
  proposal_conflicts?: ProposalConflict[];
};

type R4RouteSurface = ProposalConflictSurface & {
  intake_session?: SessionVM;
  knowledge_evidence?: EvidenceBubble;
};

export const webRouteComponentCss = [
  ".wh-r4-route{display:grid;gap:16px;min-width:0;max-width:100%;overflow:hidden}",
  ".wh-r4-route,.wh-r4-route *{box-sizing:border-box;min-width:0}",
  ".wh-r4-route-head{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:14px;align-items:end}",
  ".wh-r4-route-head h2{margin:4px 0 0;font-size:24px;line-height:1.18;letter-spacing:0;overflow-wrap:anywhere}",
  ".wh-r4-route-head p{margin:6px 0 0;color:var(--wh-product-muted,#66728c);line-height:1.5;overflow-wrap:anywhere}",
  ".wh-r4-route-kicker{color:var(--wh-product-blue,#355cff);font-size:12px;font-weight:900;text-transform:uppercase;letter-spacing:0}",
  ".wh-r4-route-grid{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(260px,.8fr);gap:14px;align-items:start}",
  ".wh-r4-route-stack{display:grid;gap:12px;min-width:0}",
  ".wh-r4-route-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:start;border-top:1px solid var(--wh-product-line,#dce4f1);padding-top:12px}",
  ".wh-r4-route-row:first-child{border-top:0;padding-top:0}",
  ".wh-r4-route-row p,.wh-r4-route-row h3,.wh-r4-route-row strong{margin:0;overflow-wrap:anywhere}",
  ".wh-r4-route-row p{color:var(--wh-product-muted,#66728c);line-height:1.45}",
  ".wh-r4-route-card{display:grid;gap:10px;min-width:0;max-width:100%;overflow:hidden}",
  ".wh-r4-route-card h3{margin:0;font-size:16px;line-height:1.25;overflow-wrap:anywhere}",
  ".wh-r4-route-card p{margin:0;color:var(--wh-product-muted,#66728c);line-height:1.5;overflow-wrap:anywhere}",
  ".wh-r4-route-card--accent{border-color:rgba(53,92,255,.22);box-shadow:0 12px 28px rgba(37,51,79,.06)}",
  ".wh-r4-route-card[data-intake-option-selected=true]{border-color:var(--wh-product-blue,#355cff);box-shadow:0 0 0 1px rgba(53,92,255,.22),0 12px 28px rgba(37,51,79,.08)}",
  ".wh-r4-route-table{display:grid;gap:8px;min-width:0}",
  ".wh-r4-route-meta{display:flex;gap:6px;flex-wrap:wrap;align-items:center;justify-content:flex-start}",
  ".wh-r4-route-actions{display:flex;gap:10px;flex-wrap:wrap;align-items:center}",
  ".wh-r4-route .wh-btn,.wh-r4-route .wh-pill{max-width:100%;white-space:normal;text-align:left;overflow-wrap:anywhere}",
  ".wh-r4-route details:not([open])>*:not(summary){display:none}",
  ".wh-r4-route-count{display:inline-flex;align-items:center;justify-content:center;border:1px solid var(--wh-product-line,#dce4f1);border-radius:8px;background:#fff;padding:8px 10px;color:var(--wh-product-ink,#172033);font-weight:900;line-height:1}",
  ".wh-r4-route-timeline{display:grid;gap:8px}",
  ".wh-r4-route-meter{height:8px;border-radius:999px;background:#e7edf7;overflow:hidden}.wh-r4-route-meter span{display:block;height:100%;border-radius:999px;background:linear-gradient(90deg,var(--wh-product-green,#24a66a),var(--wh-product-amber,#d98b16));max-width:100%}",
  "@media (max-width:860px){.wh-r4-route-head,.wh-r4-route-grid,.wh-r4-route-row{grid-template-columns:1fr}.wh-r4-route-head{align-items:start}.wh-r4-route-count{width:max-content}.wh-r4-route-actions{align-items:flex-start}}"
].join("");

type RouteCopyKey =
  | "workitem.context"
  | "workitem.trace"
  | "workitem.deliverables"
  | "workitem.openProposal"
  | "workitem.openReplay"
  | "workitem.startRun"
  | "intake.summary"
  | "intake.progress"
  | "intake.freeText"
  | "intake.createWorkItem"
  | "intake.continue"
  | "knowledge.kicker"
  | "knowledge.sources"
  | "knowledge.missing"
  | "knowledge.open"
  | "proposal.summary"
  | "proposal.review"
  | "proposal.rollback"
  | "proposal.files"
  | "cost.scopes"
  | "cost.risks"
  | "cost.models"
  | "cost.trend"
  | "cost.remaining"
  | "cost.users"
  | "cost.teams"
  | "cost.workitems"
  | "settings.runtime"
  | "settings.llm"
  | "settings.language"
  | "settings.device"
  | "settings.configured"
  | "settings.notConfigured"
  | "settings.ready"
  | "settings.needsAttention"
  | "settings.synced"
  | "settings.needsSync"
  | "settings.worker"
  | "settings.broker"
  | "settings.database"
  | "settings.runtimeStatus"
  | "settings.lease"
  | "settings.recovery"
  | "settings.provider"
  | "settings.model"
  | "settings.apiKey"
  | "settings.baseUrl"
  | "settings.secretSafe"
  | "settings.activeLocale"
  | "settings.preferenceLocale"
  | "settings.preferenceSource"
  | "settings.preferenceSync"
  | "settings.updateEndpoint"
  | "settings.supported"
  | "settings.storage"
  | "settings.localExecution"
  | "settings.independentPet"
  | "settings.petBoundary"
  | "settings.desktopGate"
  | "settings.webLocalActions"
  | "settings.restore";

const routeCopy: Record<WorkHubLocale, Record<RouteCopyKey, string>> = {
  "zh-CN": {
    "workitem.context": "任务上下文",
    "workitem.trace": "AI 执行轨迹",
    "workitem.deliverables": "交付物入口",
    "workitem.openProposal": "查看变更申请",
    "workitem.openReplay": "查看回放",
    "workitem.startRun": "开始 AI 执行",
    "intake.summary": "接入摘要",
    "intake.progress": "澄清进度",
    "intake.freeText": "打字只是折叠兜底",
    "intake.createWorkItem": "创建工作项",
    "intake.continue": "继续澄清",
    "knowledge.kicker": "证据兜底",
    "knowledge.sources": "证据来源",
    "knowledge.missing": "没有可靠证据，不会编造来源。",
    "knowledge.open": "打开证据",
    "proposal.summary": "AI 摘要",
    "proposal.review": "审阅动作",
    "proposal.rollback": "回滚路径",
    "proposal.files": "文件与对象变化",
    "cost.scopes": "预算范围",
    "cost.risks": "预算风险",
    "cost.models": "模型拆解",
    "cost.trend": "趋势",
    "cost.remaining": "剩余",
    "cost.users": "个人",
    "cost.teams": "团队",
    "cost.workitems": "任务",
    "settings.runtime": "运行时",
    "settings.llm": "AI 运行配置",
    "settings.language": "语言",
    "settings.device": "桌面与本地能力",
    "settings.configured": "已配置",
    "settings.notConfigured": "未配置",
    "settings.ready": "就绪",
    "settings.needsAttention": "需要处理",
    "settings.synced": "已同步",
    "settings.needsSync": "待同步",
    "settings.worker": "Worker",
    "settings.broker": "事件总线",
    "settings.database": "数据库",
    "settings.runtimeStatus": "运行状态",
    "settings.lease": "执行租约",
    "settings.recovery": "恢复间隔",
    "settings.provider": "提供方",
    "settings.model": "模型",
    "settings.apiKey": "密钥状态",
    "settings.baseUrl": "服务地址状态",
    "settings.secretSafe": "密钥安全",
    "settings.activeLocale": "当前语言",
    "settings.preferenceLocale": "服务端偏好",
    "settings.preferenceSource": "偏好来源",
    "settings.preferenceSync": "同步状态",
    "settings.updateEndpoint": "保存接口",
    "settings.supported": "支持语言",
    "settings.storage": "本地键",
    "settings.localExecution": "本地执行边界",
    "settings.independentPet": "独立桌宠窗口",
    "settings.petBoundary": "桌宠形象不在 Web 主窗配置",
    "settings.desktopGate": "桌面能力门",
    "settings.webLocalActions": "Web 本地动作",
    "settings.restore": "恢复入口"
  },
  "en-US": {
    "workitem.context": "Task context",
    "workitem.trace": "AI execution trace",
    "workitem.deliverables": "Deliverable entry",
    "workitem.openProposal": "Open change request",
    "workitem.openReplay": "Open replay",
    "workitem.startRun": "Start AI run",
    "intake.summary": "Intake summary",
    "intake.progress": "Clarification progress",
    "intake.freeText": "Typing stays a collapsed fallback",
    "intake.createWorkItem": "Create work item",
    "intake.continue": "Continue intake",
    "knowledge.kicker": "Knowledge fallback",
    "knowledge.sources": "Evidence sources",
    "knowledge.missing": "No reliable evidence found. WorkHub will not invent sources.",
    "knowledge.open": "Open evidence",
    "proposal.summary": "AI summary",
    "proposal.review": "Review actions",
    "proposal.rollback": "Rollback path",
    "proposal.files": "Files and object changes",
    "cost.scopes": "Budget scopes",
    "cost.risks": "Budget risks",
    "cost.models": "Model breakdown",
    "cost.trend": "Trend",
    "cost.remaining": "Remaining",
    "cost.users": "People",
    "cost.teams": "Teams",
    "cost.workitems": "Work items",
    "settings.runtime": "Runtime",
    "settings.llm": "AI runtime config",
    "settings.language": "Language",
    "settings.device": "Desktop and local capability",
    "settings.configured": "Configured",
    "settings.notConfigured": "Not configured",
    "settings.ready": "Ready",
    "settings.needsAttention": "Needs attention",
    "settings.synced": "Synced",
    "settings.needsSync": "Needs sync",
    "settings.worker": "Worker",
    "settings.broker": "Event broker",
    "settings.database": "Database",
    "settings.runtimeStatus": "Runtime status",
    "settings.lease": "Run lease",
    "settings.recovery": "Recovery interval",
    "settings.provider": "Provider",
    "settings.model": "Model",
    "settings.apiKey": "Key status",
    "settings.baseUrl": "Service URL status",
    "settings.secretSafe": "Secret safety",
    "settings.activeLocale": "Active locale",
    "settings.preferenceLocale": "Server preference",
    "settings.preferenceSource": "Preference source",
    "settings.preferenceSync": "Sync state",
    "settings.updateEndpoint": "Save endpoint",
    "settings.supported": "Supported locales",
    "settings.storage": "Storage key",
    "settings.localExecution": "Local execution boundary",
    "settings.independentPet": "Independent pet window",
    "settings.petBoundary": "Pet look is not configured in the Web main window",
    "settings.desktopGate": "Desktop capability gate",
    "settings.webLocalActions": "Web local actions",
    "settings.restore": "Recovery entry"
  }
};

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;");
}

function dataAttrs(attrs: Record<string, string>) {
  return Object.entries(attrs)
    .map(([key, value]) => ` ${key}="${escapeHtml(value)}"`)
    .join("");
}

function createWebRouteComponent(input: CreateWebRouteComponentInput): WebRouteComponent {
  const hydration: WebRouteHydrationBoundary = {
    rootId: `wh-r4-hydration-${input.key}`,
    routeKey: input.key,
    mode: "html-fallback",
    source: input.source,
    locale: input.locale,
    pageVm: input.pageVm,
    actionHrefCount: input.primaryHrefs.length,
    adapter: "route-component-v1"
  };
  const reactBoundary = input.reactComponent
    ? dataAttrs({
      "data-r4-hydration-react-component": input.reactComponent.componentName,
      "data-r4-hydration-react-component-route": input.reactComponent.routeKey,
      "data-r4-hydration-react-component-mode": input.reactComponent.mode,
      "data-r4-hydration-react-component-props-source": input.reactComponent.propsSource,
      "data-r4-hydration-react-component-fallback": String(input.reactComponent.htmlFallback),
      "data-r4-hydration-react-component-adapter": input.reactComponent.adapter,
      "data-r4-hydration-react-component-fingerprint": input.reactComponent.propsFingerprint
    })
    : "";
  const html = `<div class="wh-r4-hydration-root" id="${escapeHtml(hydration.rootId)}" data-r4-hydration-boundary="true" data-r4-hydration-route="${escapeHtml(hydration.routeKey)}" data-r4-hydration-mode="${escapeHtml(hydration.mode)}" data-r4-hydration-source="${escapeHtml(hydration.source)}" data-r4-hydration-locale="${escapeHtml(hydration.locale)}" data-r4-hydration-page-vm="${escapeHtml(hydration.pageVm)}" data-r4-hydration-action-count="${escapeHtml(String(hydration.actionHrefCount))}" data-r4-hydration-adapter="${escapeHtml(hydration.adapter)}"${reactBoundary}>${input.html}</div>`;
  return {
    key: input.key,
    css: input.css,
    primaryHrefs: input.primaryHrefs,
    hydration,
    ...(input.reactComponent ? { reactComponent: input.reactComponent } : {}),
    html
  };
}

function routeT(locale: WorkHubLocale, key: RouteCopyKey) {
  return routeCopy[locale][key];
}

function stripMarkdown(value: string | undefined) {
  return (value ?? "").replace(/[#*_`>-]/gu, " ").replace(/\s+/gu, " ").trim();
}

function boolLabel(value: boolean, locale: WorkHubLocale) {
  return routeT(locale, value ? "settings.configured" : "settings.notConfigured");
}

function runtimeStatusLabel(value: SettingsPageVM["runtime"]["runtime_status"], locale: WorkHubLocale) {
  return routeT(locale, value === "ready" ? "settings.ready" : "settings.needsAttention");
}

function syncLabel(value: boolean, locale: WorkHubLocale) {
  return routeT(locale, value ? "settings.synced" : "settings.needsSync");
}

function actionClass(action: AttentionAction | ActionSpec, index: number) {
  if (("style" in action && action.style === "danger") || action.id === "request_changes") {
    return "wh-btn wh-btn-danger";
  }
  return index === 0 ? "wh-btn wh-btn-primary" : "wh-btn";
}

function renderActions(actions: (AttentionAction | ActionSpec)[]) {
  if (actions.length === 0) {
    return "";
  }
  return `<div class="wh-r4-route-actions">${actions
    .map((action, index) => {
      const reason = action.requires_reason ? " data-requires-reason=\"true\"" : "";
      const method = "method" in action ? ` data-method="${escapeHtml(action.method)}"` : "";
      const desktop = action.requires_desktop ? " data-requires-desktop=\"true\"" : "";
      return `<a class="${actionClass(action, index)}" href="${escapeHtml(action.href)}" data-action-id="${escapeHtml(action.id)}"${reason}${method}${desktop}>${escapeHtml(action.label)}</a>`;
    })
    .join("")}</div>`;
}

function jsonAttr(value: unknown) {
  return escapeHtml(JSON.stringify(value));
}

function renderAttentionRows(items: AttentionItem[], emptyCopy: string) {
  if (items.length === 0) {
    return `<p class="wh-subtle">${escapeHtml(emptyCopy)}</p>`;
  }
  return items
    .slice(0, 4)
    .map((item) => `<div class="wh-r4-route-row" data-r4-route-attention-item="${escapeHtml(item.id)}">
      <div>
        <strong>${escapeHtml(item.title)}</strong>
        <p>${escapeHtml(item.summary_text)}</p>
      </div>
      <span class="wh-pill">${escapeHtml(item.priority)}</span>
    </div>`)
    .join("");
}

function approvalRouteLabel(routedToUserId: string | undefined, locale: WorkHubLocale) {
  if (!routedToUserId) {
    return goldPathT(locale, "approvals.unrouted");
  }
  return locale === "zh-CN" ? "已路由" : "Routed";
}

function renderHomeRouteComponent(vm: AttentionHomeVM, locale: WorkHubLocale): WebRouteComponent {
  const reactComponent = createHomeReactRouteComponent(vm, locale);
  const reactAttrs = dataAttrs(reactRouteComponentMarkerAttrs(reactComponent));
  const primary = vm.primary;
  const primaryActions = primary?.actions ?? [];
  const backgroundRows = vm.background_runs.length
    ? vm.background_runs.slice(0, 4).map((run) => `<div class="wh-r4-route-row" data-r4-home-background-run="${escapeHtml(run.run_id)}">
      <div>
        <strong>${escapeHtml(run.title)}</strong>
        <p>${escapeHtml(run.preview_text)}</p>
      </div>
      <span class="wh-pill">${escapeHtml(run.state)}</span>
    </div>`).join("")
    : `<p class="wh-subtle">${escapeHtml(goldPathT(locale, "home.aiWorkingEmpty"))}</p>`;
  const evidenceRows = primary?.evidence_refs?.length
    ? primary.evidence_refs.slice(0, 3).map((ref) => `<div class="wh-r4-route-row" data-r4-home-evidence="${escapeHtml(ref.id)}">
      <div>
        <strong>${escapeHtml(ref.title)}</strong>
        <p>${escapeHtml(ref.excerpt ?? ref.source_id)}</p>
      </div>
      <span class="wh-pill">${escapeHtml(ref.source_type)}</span>
    </div>`).join("")
    : `<p class="wh-subtle">${escapeHtml(goldPathT(locale, "empty.evidence"))}</p>`;

  return createWebRouteComponent({
    key: "home",
    css: webRouteComponentCss,
    primaryHrefs: reactComponent.primaryHrefs,
    source: "page-vm",
    locale,
    pageVm: "attention",
    reactComponent,
    html: `<section class="wh-r4-route" data-r4-route-component="home" data-r4-route-component-source="page-vm" data-r4-route-component-locale="${escapeHtml(locale)}"${reactAttrs} data-r4-home-primary="${escapeHtml(String(Boolean(primary)))}">
      <header class="wh-r4-route-head">
        <div>
          <span class="wh-r4-route-kicker">${escapeHtml(goldPathT(locale, "home.kicker"))}</span>
          <h2>${escapeHtml(primary?.title ?? goldPathT(locale, "home.emptyTitle"))}</h2>
          <p>${escapeHtml(primary?.summary_text ?? goldPathT(locale, "home.emptySummary"))}</p>
        </div>
        <span class="wh-r4-route-count">${escapeHtml(String(vm.queue.length + (primary ? 1 : 0)))}</span>
      </header>
      <div class="wh-r4-route-grid">
        <section class="wh-card wh-r4-route-card" data-r4-home-decision="true">
          <span class="wh-r4-route-kicker">${escapeHtml(goldPathT(locale, "home.decisionTitle"))}</span>
          <h3>${escapeHtml(primary?.reason_text ?? primary?.summary_text ?? goldPathT(locale, "home.decisionEmpty"))}</h3>
          ${renderActions(primaryActions)}
        </section>
        <section class="wh-card wh-r4-route-card" data-r4-home-ai-working="true">
          <span class="wh-r4-route-kicker">${escapeHtml(goldPathT(locale, "home.aiWorkingTitle"))}</span>
          <div class="wh-r4-route-timeline">${backgroundRows}</div>
        </section>
      </div>
      <div class="wh-r4-route-grid">
        <section class="wh-card wh-r4-route-card" data-r4-home-queue="true">
          <h3>${escapeHtml(goldPathT(locale, "home.entryTitle"))}</h3>
          ${renderAttentionRows(vm.queue, goldPathT(locale, "home.entryText"))}
        </section>
        <section class="wh-card wh-r4-route-card" data-r4-home-evidence-list="true">
          <h3>${escapeHtml(goldPathT(locale, "empty.evidence"))}</h3>
          ${evidenceRows}
        </section>
      </div>
    </section>`
  });
}

function intakeProgressRows(vm: SessionVM) {
  return vm.question.progress
    .map((step) => `<div class="wh-r4-route-row" data-r4-intake-progress-step="${escapeHtml(step.key)}" data-r4-intake-progress-state="${escapeHtml(step.state)}">
      <strong>${escapeHtml(step.label)}</strong>
      <span class="wh-pill">${escapeHtml(step.state)}</span>
    </div>`)
    .join("");
}

function renderIntakeRouteComponent(vm: SessionVM, locale: WorkHubLocale): WebRouteComponent {
  const question = {
    ...vm.question,
    session_id: vm.question.session_id ?? vm.session_id,
    work_item_id: vm.question.work_item_id ?? vm.work_item_id
  };
  const recommended = new Set(question.recommended_option_ids ?? []);
  const allowMulti = question.input_mode === "multi_choice" || question.input_mode === "rank";
  const optionCards = question.options
    .map((option) => {
      const description = option.description ?? option.impact ?? "";
      return `<button class="wh-card wh-r4-route-card" type="button" data-option-id="${escapeHtml(option.id)}" data-intake-option-id="${escapeHtml(option.id)}" data-intake-option-selected="false" data-intake-option-mode="${escapeHtml(question.input_mode)}" data-intake-option-multi="${escapeHtml(String(allowMulti))}" data-recommended="${escapeHtml(String(recommended.has(option.id)))}">
        <div class="wh-r4-route-meta"><span class="wh-pill">${escapeHtml(recommended.has(option.id) ? goldPathT(locale, "intake.recommended") : option.risk_hint ?? question.input_mode)}</span></div>
        <h3>${escapeHtml(option.label)}</h3>
        <p>${escapeHtml(description)}</p>
      </button>`;
    })
    .join("");
  const freeText = question.free_text.enabled
    ? `<details class="wh-card wh-r4-route-card" data-r4-intake-free-text="true" ${question.free_text.collapsed_by_default ? "" : "open"}>
      <summary>${escapeHtml(routeT(locale, "intake.freeText"))}</summary>
      <p>${escapeHtml(question.free_text.placeholder ?? goldPathT(locale, "intake.freeTextFallback"))}</p>
    </details>`
    : "";
  const continuePayload = { selected_option_ids: [] as string[] };
  const createPayload = { session_id: vm.session_id, selected_option_ids: [] as string[] };
  const createAction = question.input_mode === "confirm"
    ? `<a class="wh-btn wh-btn-primary" href="/api/workitems" data-action-id="create_workitem" data-method="POST" data-intake-create-workitem="true" data-session-id="${escapeHtml(vm.session_id)}" data-request-json="${jsonAttr(createPayload)}">${escapeHtml(routeT(locale, "intake.createWorkItem"))}</a>`
    : "";

  return createWebRouteComponent({
    key: "intake",
    css: webRouteComponentCss,
    primaryHrefs: [question.submit.href, ...(question.input_mode === "confirm" ? ["/api/workitems"] : [])],
    source: "session-vm",
    locale,
    pageVm: "session",
    html: `<section class="wh-r4-route" data-r4-route-component="intake" data-r4-route-component-source="session-vm" data-r4-route-component-locale="${escapeHtml(locale)}" data-r4-intake-session-id="${escapeHtml(vm.session_id)}" data-r4-intake-workitem-id="${escapeHtml(vm.work_item_id ?? "")}" data-r4-intake-option-count="${escapeHtml(String(question.options.length))}" data-r4-intake-progress-count="${escapeHtml(String(question.progress.length))}" data-r4-intake-free-text-collapsed="${escapeHtml(String(question.free_text.collapsed_by_default))}" data-r4-intake-input-mode="${escapeHtml(question.input_mode)}" data-r4-intake-option-first="true">
      <header class="wh-r4-route-head">
        <div>
          <span class="wh-r4-route-kicker">${escapeHtml(goldPathT(locale, "intake.kicker"))}</span>
          <h2>${escapeHtml(question.title)}</h2>
          <p>${escapeHtml(question.body ?? goldPathT(locale, "intake.bodyFallback"))}</p>
        </div>
        <span class="wh-r4-route-count">${escapeHtml(String(question.options.length))}</span>
      </header>
      <div class="wh-r4-route-grid">
        <section class="wh-r4-route-stack" data-r4-intake-options="true" data-r4-intake-allow-multi="${escapeHtml(String(allowMulti))}">
          ${optionCards}
        </section>
        <aside class="wh-r4-route-stack">
          <section class="wh-card wh-r4-route-card" data-r4-intake-summary="true">
            <h3>${escapeHtml(routeT(locale, "intake.summary"))}</h3>
            <div class="wh-r4-route-meta">
              <span class="wh-pill">${escapeHtml(vm.topic)}</span>
              <span class="wh-pill">${escapeHtml(vm.stream_href)}</span>
            </div>
            <p>${escapeHtml(routeT(locale, "intake.freeText"))}</p>
          </section>
          <section class="wh-card wh-r4-route-card" data-r4-intake-progress="true">
            <h3>${escapeHtml(routeT(locale, "intake.progress"))}</h3>
            <div class="wh-r4-route-timeline">${intakeProgressRows(vm)}</div>
          </section>
        </aside>
      </div>
      ${freeText}
      <div class="wh-r4-route-actions">
        <a class="wh-btn" href="${escapeHtml(question.submit.href)}" data-action-id="intake_continue" data-method="${escapeHtml(question.submit.method)}" data-intake-submit="next-question" data-session-id="${escapeHtml(vm.session_id)}" data-request-json="${jsonAttr(continuePayload)}">${escapeHtml(routeT(locale, "intake.continue"))}</a>
        ${createAction}
      </div>
    </section>`
  });
}

function renderApprovalsRouteComponent(vm: ApprovalCenterVM, locale: WorkHubLocale): WebRouteComponent {
  const primary = vm.items[0];
  const pendingCount = vm.counts["pending"] ?? vm.items.length;
  const request = vm.requests[0];
  const queueRows = vm.items
    .map((item) => `<article class="wh-card wh-r4-route-card" data-r4-approval-item="${escapeHtml(item.id)}">
      <div class="wh-r4-route-meta"><span class="wh-pill">${escapeHtml(item.priority)}</span><span class="wh-pill">${escapeHtml(item.kind)}</span></div>
      <h3>${escapeHtml(item.title)}</h3>
      <p>${escapeHtml(item.reason_text ?? item.summary_text)}</p>
      ${renderActions(item.actions)}
    </article>`)
    .join("");
  const requestRows = vm.requests
    .map((item) => `<div class="wh-r4-route-row" data-r4-approval-request="${escapeHtml(item.id)}">
      <div>
        <strong>${escapeHtml(item.action_pattern)}</strong>
        <p>${escapeHtml(item.status)}${item.sla_due_at ? ` SLA ${escapeHtml(item.sla_due_at)}` : ""}</p>
      </div>
      <span class="wh-pill" data-r4-approval-routed="${escapeHtml(String(Boolean(item.routed_to_user_id)))}">${escapeHtml(approvalRouteLabel(item.routed_to_user_id, locale))}</span>
    </div>`)
    .join("");

  return createWebRouteComponent({
    key: "approvals",
    css: webRouteComponentCss,
    primaryHrefs: primary?.actions.map((action) => action.href) ?? [],
    source: "page-vm",
    locale,
    pageVm: "approvals",
    html: `<section class="wh-r4-route" data-r4-route-component="approvals" data-r4-route-component-source="page-vm" data-r4-route-component-locale="${escapeHtml(locale)}" data-r4-approval-pending="${escapeHtml(String(pendingCount))}">
      <header class="wh-r4-route-head">
        <div>
          <span class="wh-r4-route-kicker">${escapeHtml(goldPathT(locale, "approvals.kicker"))}</span>
          <h2>${escapeHtml(primary?.title ?? goldPathT(locale, "approvals.emptyTitle"))}</h2>
          <p>${escapeHtml(primary?.reason_text ?? goldPathT(locale, "approvals.reasonFallback"))}</p>
        </div>
        <span class="wh-r4-route-count">${escapeHtml(String(pendingCount))}</span>
      </header>
      <div class="wh-r4-route-grid">
        <section class="wh-r4-route-stack" data-r4-approval-queue="true">
          ${queueRows || `<article class="wh-card wh-r4-route-card"><p>${escapeHtml(goldPathT(locale, "approvals.reasonFallback"))}</p></article>`}
        </section>
        <aside class="wh-r4-route-stack" data-r4-approval-action-panel="true">
          <section class="wh-card wh-r4-route-card">
            <h3>${escapeHtml(goldPathT(locale, "approvals.ruleTitle"))}</h3>
            <p>${escapeHtml(goldPathT(locale, "approvals.ruleText"))}</p>
          </section>
          <section class="wh-card wh-r4-route-card">
            <h3>${escapeHtml(goldPathT(locale, "approvals.slaTitle"))}</h3>
            <p>${escapeHtml(request?.sla_due_at ?? goldPathT(locale, "approvals.slaEmpty"))}</p>
          </section>
          <section class="wh-card wh-r4-route-card">
            <h3>${escapeHtml(goldPathT(locale, "approvals.factsTitle"))}</h3>
            <div class="wh-r4-route-timeline">${requestRows || `<p class="wh-subtle">${escapeHtml(goldPathT(locale, "approvals.unrouted"))}</p>`}</div>
          </section>
        </aside>
      </div>
    </section>`
  });
}

function acceptanceRows(items: WorkItemDetailVM["acceptance"], locale: WorkHubLocale) {
  if (items.length === 0) {
    return `<p class="wh-subtle">${escapeHtml(uiT(locale, "workitem.emptyAcceptance"))}</p>`;
  }
  return items
    .map((item, index) => {
      const record = item && typeof item === "object" ? item as Record<string, unknown> : {};
      const title = String(record["title"] ?? `${uiT(locale, "workitem.acceptanceItem")} ${index + 1}`);
      const status = String(record["status"] ?? "open");
      return `<div class="wh-r4-route-row" data-r4-workitem-acceptance-item="${escapeHtml(String(record["id"] ?? index))}">
        <strong>${escapeHtml(title)}</strong>
        <span class="wh-pill">${escapeHtml(checkStatusLabel(locale, status))}</span>
      </div>`;
    })
    .join("");
}

function evidenceRows(refs: EvidenceRef[], locale: WorkHubLocale, marker: string) {
  if (refs.length === 0) {
    return `<p class="wh-subtle">${escapeHtml(uiT(locale, "generic.noEvidence"))}</p>`;
  }
  return refs.slice(0, 5)
    .map((ref) => `<div class="wh-r4-route-row" data-${marker}="${escapeHtml(ref.id)}">
      <div>
        <strong>${escapeHtml(ref.title)}</strong>
        <p>${escapeHtml(ref.excerpt ?? ref.source_id)}</p>
      </div>
      <span class="wh-pill">${escapeHtml(evidenceSourceLabel(locale, ref.source_type))}</span>
    </div>`)
    .join("");
}

function traceRows(vm: WorkItemDetailVM, locale: WorkHubLocale) {
  if (vm.agent_trace_preview.length === 0) {
    return `<p class="wh-subtle">${escapeHtml(uiT(locale, "workitem.emptyTrace"))}</p>`;
  }
  return vm.agent_trace_preview.slice(0, 5)
    .map((step) => `<div class="wh-r4-route-row" data-r4-workitem-trace-step="${escapeHtml(step.id)}">
      <div>
        <strong>${escapeHtml(`${step.step_no}. ${step.phase}`)}</strong>
        <p>${escapeHtml(step.output_excerpt ?? step.tool_name ?? uiT(locale, "workitem.stepFallback"))}</p>
      </div>
      <span class="wh-pill">${escapeHtml(step.tool_name ?? step.created_at)}</span>
    </div>`)
    .join("");
}

function workItemActions(vm: WorkItemDetailVM, locale: WorkHubLocale): ActionSpec[] {
  const proposalId = vm.latest_proposal?.proposal_id;
  const runId = vm.agent_trace_preview[0]?.agent_run_id;
  const actions: Array<ActionSpec | undefined> = [
    proposalId
      ? {
        id: "open_proposal",
        label: routeT(locale, "workitem.openProposal"),
        method: "GET" as const,
        href: `/proposals/${proposalId}`
      }
      : undefined,
    runId
      ? {
        id: "open_replay",
        label: routeT(locale, "workitem.openReplay"),
        method: "GET" as const,
        href: `/agent-runs/${runId}/replay`
      }
      : undefined,
    vm.workitem.status === "spec_ready"
      ? {
        id: "start_agent_run",
        label: routeT(locale, "workitem.startRun"),
        method: "POST" as const,
        href: `/api/workitems/${vm.workitem.id}/agent-runs`
      }
      : undefined
  ];
  return actions.filter((action): action is ActionSpec => Boolean(action));
}

function renderWorkItemRouteComponent(vm: WorkItemDetailVM, locale: WorkHubLocale): WebRouteComponent {
  const title = vm.workitem.title ?? vm.workitem.code;
  const summary = stripMarkdown(vm.workitem.summary_md ?? vm.workitem.raw_description ?? uiT(locale, "workitem.defaultSummary"));
  const actions = workItemActions(vm, locale);
  const latestProposal = vm.latest_proposal;
  const deliverableRows = latestProposal?.changes.length
    ? latestProposal.changes.slice(0, 4).map((change) => `<div class="wh-r4-route-row" data-r4-workitem-deliverable-change="${escapeHtml(change.id)}">
      <div>
        <strong>${escapeHtml(change.human_summary)}</strong>
        <p>${escapeHtml(change.target_ref.path ?? change.target_ref.entity_id ?? change.target_ref.entity_type)}</p>
      </div>
      <span class="wh-pill">${escapeHtml(deliverableTargetLabel(locale, change.target_kind))}</span>
    </div>`).join("")
    : `<p class="wh-subtle">${escapeHtml(uiT(locale, "workitem.willReadEvidence"))}</p>`;

  return createWebRouteComponent({
    key: "workitem",
    css: webRouteComponentCss,
    primaryHrefs: actions.map((action) => action.href),
    source: "page-vm",
    locale,
    pageVm: "workitem",
    html: `<section class="wh-r4-route" data-r4-route-component="workitem" data-r4-route-component-source="page-vm" data-r4-route-component-locale="${escapeHtml(locale)}" data-r4-workitem-id="${escapeHtml(vm.workitem.id)}" data-r4-workitem-trace-count="${escapeHtml(String(vm.agent_trace_preview.length))}" data-r4-workitem-evidence-count="${escapeHtml(String(vm.evidence_refs.length))}" data-r4-workitem-acceptance-count="${escapeHtml(String(vm.acceptance.length))}" data-r4-workitem-deliverable-count="${escapeHtml(String(vm.accepted_deliverables.length + (latestProposal?.changes.length ?? 0)))}">
      <header class="wh-r4-route-head">
        <div>
          <span class="wh-r4-route-kicker">${escapeHtml(uiT(locale, "workitem.kicker"))}</span>
          <h2>${escapeHtml(title)}</h2>
          <p>${escapeHtml(summary)}</p>
        </div>
        <span class="wh-r4-route-count">${escapeHtml(workItemStatusLabel(locale, vm.workitem.status))}</span>
      </header>
      <div class="wh-r4-route-grid">
        <section class="wh-card wh-r4-route-card wh-r4-route-card--accent" data-r4-workitem-context="true">
          <h3>${escapeHtml(routeT(locale, "workitem.context"))}</h3>
          <div class="wh-r4-route-meta">
            <span class="wh-pill">${escapeHtml(vm.workitem.code)}</span>
            <span class="wh-pill">${escapeHtml(vm.workitem.priority)}</span>
            <span class="wh-pill">${escapeHtml(vm.workitem.mode)}</span>
          </div>
          <p>${escapeHtml(vm.workitem.planning_note ?? vm.workitem.raw_description)}</p>
          ${renderActions(actions)}
        </section>
        <section class="wh-card wh-r4-route-card" data-r4-workitem-deliverables="true">
          <h3>${escapeHtml(routeT(locale, "workitem.deliverables"))}</h3>
          <div class="wh-r4-route-timeline">${deliverableRows}</div>
        </section>
      </div>
      <div class="wh-r4-route-grid">
        <section class="wh-card wh-r4-route-card" data-r4-workitem-acceptance="true">
          <h3>${escapeHtml(uiT(locale, "workitem.acceptanceTitle"))}</h3>
          <div class="wh-r4-route-table">${acceptanceRows(vm.acceptance, locale)}</div>
        </section>
        <section class="wh-card wh-r4-route-card" data-r4-workitem-trace="true">
          <h3>${escapeHtml(routeT(locale, "workitem.trace"))}</h3>
          <div class="wh-r4-route-timeline">${traceRows(vm, locale)}</div>
        </section>
      </div>
      <section class="wh-card wh-r4-route-card" data-r4-workitem-evidence="true">
        <h3>${escapeHtml(uiT(locale, "generic.evidence"))}</h3>
        <div class="wh-r4-route-timeline">${evidenceRows(vm.evidence_refs, locale, "r4-workitem-evidence-ref")}</div>
      </section>
    </section>`
  });
}

function renderChange(change: DeliverableChange, locale: WorkHubLocale) {
  const path = change.target_ref.path ?? change.target_ref.entity_id ?? change.target_ref.entity_type;
  const preview = change.preview_ref
    ? `<a class="wh-pill" href="${escapeHtml(change.preview_ref.href)}">${escapeHtml(previewKindLabel(locale, change.preview_ref.kind))}</a>`
    : "";
  return `<div class="wh-r4-route-row" data-r4-proposal-change="${escapeHtml(change.id)}" data-r4-proposal-change-kind="${escapeHtml(change.target_kind)}" data-r4-proposal-change-type="${escapeHtml(change.change_type)}">
    <div>
      <strong>${escapeHtml(change.human_summary)}</strong>
      <p>${escapeHtml(path)}</p>
    </div>
    <div class="wh-r4-route-meta">
      <span class="wh-pill">${escapeHtml(deliverableTargetLabel(locale, change.target_kind))}</span>
      <span class="wh-pill">${escapeHtml(changeTypeLabel(locale, change.change_type))}</span>
      ${preview}
    </div>
  </div>`;
}

function renderCheck(check: DeliverableCheck, locale: WorkHubLocale) {
  return `<div class="wh-r4-route-row" data-r4-proposal-check="${escapeHtml(check.id)}" data-r4-proposal-check-status="${escapeHtml(check.status)}">
    <div>
      <strong>${escapeHtml(check.label)}</strong>
      <p>${escapeHtml(check.detail ?? checkStatusLabel(locale, check.status))}</p>
    </div>
    <span class="wh-pill">${escapeHtml(checkStatusLabel(locale, check.status))}</span>
  </div>`;
}

function proposalActions(vm: ProposalDetailVM) {
  return [
    vm.review_actions.approve,
    vm.review_actions.request_changes,
    ...(vm.review_actions.merge ? [vm.review_actions.merge] : [])
  ];
}

function renderProposalRouteComponent(
  vm: ProposalDetailVM,
  locale: WorkHubLocale,
  conflicts: ProposalConflict[] = []
): WebRouteComponent {
  const actions = proposalActions(vm);
  const conflictCards = renderProposalConflictCards(conflicts, { locale });
  const hasLineEditor = conflictCards.html.includes("data-route-line-editor=");
  const hasFieldEditor = conflictCards.html.includes("data-proposal-structured-field-editor=");
  const hasSubrecordEditor = conflictCards.html.includes("data-proposal-subrecord-item-diff=");
  const reactComponent = createProposalReactRouteComponent(vm, conflicts, locale, {
    actionHrefs: conflictCards.actionHrefs,
    lineEditor: hasLineEditor,
    fieldEditor: hasFieldEditor,
    subrecordEditor: hasSubrecordEditor
  });
  const reactAttrs = dataAttrs(reactRouteComponentMarkerAttrs(reactComponent));
  const props = reactComponent.props;
  const summary = stripMarkdown(vm.manifest.summary_md).slice(0, 320);
  const rollbackClass = vm.manifest.rollback.available ? "wh-pill" : "wh-pill wh-pill-danger";
  const comments = vm.comments.length
    ? vm.comments.map((comment) => `<div class="wh-r4-route-row" data-r4-proposal-comment="${escapeHtml(comment.id)}">
      <div>
        <strong>${escapeHtml(comment.author_label)}</strong>
        <p>${escapeHtml(comment.body)}</p>
      </div>
      <span class="wh-pill">${escapeHtml(comment.created_at)}</span>
    </div>`).join("")
    : `<p class="wh-subtle">${escapeHtml(uiT(locale, "proposal.comments"))}</p>`;
  const advancedConflictReview = conflictCards.html
    ? `<section class="wh-r4-route-card" data-r4-proposal-advanced-review="true" data-r4-proposal-advanced-source="workitem-conflicts" data-r4-proposal-advanced-fallback="true" data-r4-proposal-advanced-fallback-source="${escapeHtml(props.advancedFallbackSource)}" data-r4-proposal-advanced-fallback-action-count="${escapeHtml(String(props.advancedFallbackActionCount))}" data-r4-proposal-conflicts="${escapeHtml(String(conflictCards.conflictCount))}" data-r4-proposal-line-editor="${escapeHtml(String(hasLineEditor))}" data-r4-proposal-field-editor="${escapeHtml(String(hasFieldEditor))}" data-r4-proposal-subrecord-editor="${escapeHtml(String(hasSubrecordEditor))}">${conflictCards.html}</section>`
    : "";

  return createWebRouteComponent({
    key: "proposal",
    css: `${webRouteComponentCss}${proposalCss}`,
    primaryHrefs: reactComponent.primaryHrefs,
    source: "page-vm",
    locale,
    pageVm: "proposal",
    reactComponent,
    html: `<section class="wh-r4-route" data-r4-route-component="proposal" data-r4-route-component-source="page-vm" data-r4-route-component-locale="${escapeHtml(locale)}"${reactAttrs} data-r4-proposal-id="${escapeHtml(props.proposalId)}" data-r4-proposal-workitem-id="${escapeHtml(props.workItemId)}" data-r4-proposal-change-count="${escapeHtml(String(props.changeCount))}" data-r4-proposal-check-count="${escapeHtml(String(props.checkCount))}" data-r4-proposal-evidence-count="${escapeHtml(String(props.evidenceRefCount))}" data-r4-proposal-action-count="${escapeHtml(String(actions.length))}" data-r4-proposal-comment-count="${escapeHtml(String(props.commentCount))}" data-r4-proposal-conflict-count="${escapeHtml(String(props.conflictCount))}" data-r4-proposal-split-adapter="true" data-r4-proposal-readonly-review-action-count="${escapeHtml(String(props.reviewActionCount))}" data-r4-proposal-advanced-fallback-preserved="${escapeHtml(String(props.advancedFallbackPreserved))}" data-r4-proposal-advanced-fallback-action-count="${escapeHtml(String(props.advancedFallbackActionCount))}" data-r4-proposal-line-editor-fallback="${escapeHtml(String(props.lineEditorFallback))}" data-r4-proposal-field-editor-fallback="${escapeHtml(String(props.fieldEditorFallback))}" data-r4-proposal-subrecord-editor-fallback="${escapeHtml(String(props.subrecordEditorFallback))}">
      <header class="wh-r4-route-head">
        <div>
          <span class="wh-r4-route-kicker">${escapeHtml(uiT(locale, "proposal.kicker"))}</span>
          <h2>${escapeHtml(vm.title)}</h2>
          <p>${escapeHtml(summary)}</p>
        </div>
        <span class="wh-r4-route-count">${escapeHtml(vm.status)}</span>
      </header>
      <div class="wh-r4-route-grid">
        <section class="wh-card wh-r4-route-card wh-r4-route-card--accent" data-r4-proposal-summary="true">
          <h3>${escapeHtml(routeT(locale, "proposal.summary"))}</h3>
          <div class="wh-r4-route-meta">
            <span class="wh-pill">${escapeHtml(uiT(locale, "generic.risk"))}: ${escapeHtml(vm.manifest.risk.human_label)}</span>
            <span class="${rollbackClass}" data-r4-proposal-rollback-available="${escapeHtml(String(vm.manifest.rollback.available))}">${escapeHtml(vm.manifest.rollback.available ? uiT(locale, "proposal.rollbackAvailable") : uiT(locale, "proposal.rollbackUnavailable"))}</span>
          </div>
          <p>${escapeHtml(vm.manifest.rollback.description)}</p>
          ${renderActions(actions)}
        </section>
        <section class="wh-card wh-r4-route-card" data-r4-proposal-review="true">
          <h3>${escapeHtml(routeT(locale, "proposal.review"))}</h3>
          <div class="wh-r4-route-timeline">${vm.manifest.checks.slice(0, 3).map((check) => renderCheck(check, locale)).join("")}</div>
        </section>
      </div>
      <section class="wh-card wh-r4-route-card" data-r4-proposal-changes="true">
        <h3>${escapeHtml(routeT(locale, "proposal.files"))}</h3>
        <div class="wh-r4-route-table">${vm.manifest.changes.map((change) => renderChange(change, locale)).join("")}</div>
      </section>
      ${advancedConflictReview}
      <div class="wh-r4-route-grid">
        <section class="wh-card wh-r4-route-card" data-r4-proposal-evidence="true">
          <h3>${escapeHtml(uiT(locale, "generic.evidence"))}</h3>
          <div class="wh-r4-route-timeline">${evidenceRows(vm.evidence_refs, locale, "r4-proposal-evidence-ref")}</div>
        </section>
        <section class="wh-card wh-r4-route-card" data-r4-proposal-comments="true">
          <h3>${escapeHtml(uiT(locale, "proposal.comments"))}</h3>
          <div class="wh-r4-route-timeline">${comments}</div>
        </section>
      </div>
    </section>`
  });
}

function proposalConflictsFromSurface(vm: ProposalConflictSurface) {
  const conflicts = vm.proposal_conflicts ?? vm.conflicts ?? [];
  return conflicts.filter((conflict) => conflict.proposal_id === vm.page_vms.proposal.proposal_id);
}

function costAmount(value: string) {
  return `¥${value}`;
}

function renderBudgetRows(vm: CostDashboardVM, locale: WorkHubLocale) {
  if (vm.budget.length === 0) {
    return `<p class="wh-subtle">${escapeHtml(goldPathT(locale, "cost.statusFallback"))}</p>`;
  }
  return vm.budget.slice(0, 5).map((usage) => {
    const ratio = usage.max_tokens > 0 ? Math.round((usage.total_tokens / usage.max_tokens) * 100) : 0;
    return `<div class="wh-r4-route-row" data-r4-cost-budget-scope="${escapeHtml(usage.policy_id)}" data-r4-cost-budget-status="${escapeHtml(usage.status)}">
      <div>
        <strong>${escapeHtml(usage.scope_label)}</strong>
        <p>${escapeHtml(`${usage.total_tokens}/${usage.max_tokens} tokens · ${costAmount(usage.estimated_cost_cny)}/${costAmount(usage.max_cost_cny)}`)}</p>
        <div class="wh-r4-route-meter" aria-hidden="true"><span style="width:${escapeHtml(String(Math.min(100, ratio)))}%"></span></div>
      </div>
      <span class="wh-pill">${escapeHtml(usage.status)}</span>
    </div>`;
  }).join("");
}

function renderCostRouteComponent(vm: CostDashboardVM, locale: WorkHubLocale): WebRouteComponent {
  const reactComponent = createCostReactRouteComponent(vm, locale);
  const reactAttrs = dataAttrs(reactRouteComponentMarkerAttrs(reactComponent));
  const props = reactComponent.props;
  const risks = vm.top_exhaustion_risks.length
    ? vm.top_exhaustion_risks.map((risk) => `<div class="wh-r4-route-row" data-r4-cost-risk="${escapeHtml(risk.label)}" data-r4-cost-risk-status="${escapeHtml(risk.status)}">
      <div>
        <strong>${escapeHtml(risk.label)}</strong>
        <p>${escapeHtml(`${routeT(locale, "cost.remaining")}: ${costAmount(risk.remaining_cost_cny)}`)}</p>
      </div>
      <span class="wh-pill">${escapeHtml(risk.status)}</span>
    </div>`).join("")
    : `<p class="wh-subtle">${escapeHtml(goldPathT(locale, "cost.statusFallback"))}</p>`;
  const notices = vm.notices.length
    ? vm.notices.map((notice) => `<div class="wh-r4-route-row" data-r4-cost-notice="${escapeHtml(notice.code)}" data-r4-cost-notice-severity="${escapeHtml(notice.severity)}">
      <div>
        <strong>${escapeHtml(notice.severity)}</strong>
        <p>${escapeHtml(notice.message)}</p>
      </div>
      ${notice.action_href ? `<a class="wh-pill" href="${escapeHtml(notice.action_href)}">${escapeHtml(goldPathT(locale, "cost.title"))}</a>` : ""}
    </div>`).join("")
    : "";
  const models = vm.model_breakdown.slice(0, 5)
    .map((item) => `<div class="wh-r4-route-row" data-r4-cost-model="${escapeHtml(`${item.provider}:${item.model}`)}">
      <div>
        <strong>${escapeHtml(item.model)}</strong>
        <p>${escapeHtml(`${item.provider} · ${item.count}`)}</p>
      </div>
      <span class="wh-pill">${escapeHtml(costAmount(item.cost_cny))}</span>
    </div>`)
    .join("");

  return createWebRouteComponent({
    key: "cost",
    css: webRouteComponentCss,
    primaryHrefs: reactComponent.primaryHrefs,
    source: "page-vm",
    locale,
    pageVm: "cost",
    reactComponent,
    html: `<section class="wh-r4-route" data-r4-route-component="cost" data-r4-route-component-source="page-vm" data-r4-route-component-locale="${escapeHtml(locale)}"${reactAttrs} data-r4-cost-total-tokens="${escapeHtml(String(props.totalTokens))}" data-r4-cost-total-cny="${escapeHtml(props.totalCostCny)}" data-r4-cost-budget-count="${escapeHtml(String(props.budgetCount))}" data-r4-cost-risk-count="${escapeHtml(String(props.riskCount))}" data-r4-cost-model-count="${escapeHtml(String(props.modelCount))}" data-r4-cost-trend-count="${escapeHtml(String(props.trendCount))}" data-r4-cost-notice-count="${escapeHtml(String(props.noticeCount))}">
      <header class="wh-r4-route-head">
        <div>
          <span class="wh-r4-route-kicker">${escapeHtml(goldPathT(locale, "cost.kicker"))}</span>
          <h2>${escapeHtml(goldPathT(locale, "cost.title"))}</h2>
          <p>${escapeHtml(goldPathT(locale, "cost.summary"))}</p>
        </div>
        <span class="wh-r4-route-count">${escapeHtml(costAmount(props.totalCostCny))}</span>
      </header>
      <div class="wh-r4-route-grid">
        <section class="wh-card wh-r4-route-card wh-r4-route-card--accent" data-r4-cost-metrics="true">
          <h3>${escapeHtml(goldPathT(locale, "cost.estimatedTitle"))}</h3>
          <div class="wh-r4-route-meta">
            <span class="wh-pill">${escapeHtml(goldPathT(locale, "cost.tokenTitle"))}: ${escapeHtml(String(props.totalTokens))}</span>
            <span class="wh-pill">${escapeHtml(goldPathT(locale, "cost.estimatedTitle"))}: ${escapeHtml(costAmount(props.totalCostCny))}</span>
            <span class="wh-pill">${escapeHtml(routeT(locale, "cost.trend"))}: ${escapeHtml(String(props.trendCount))}</span>
          </div>
          ${notices}
        </section>
        <section class="wh-card wh-r4-route-card" data-r4-cost-risks="true">
          <h3>${escapeHtml(routeT(locale, "cost.risks"))}</h3>
          <div class="wh-r4-route-timeline">${risks}</div>
        </section>
      </div>
      <div class="wh-r4-route-grid">
        <section class="wh-card wh-r4-route-card" data-r4-cost-budget="true">
          <h3>${escapeHtml(routeT(locale, "cost.scopes"))}</h3>
          <div class="wh-r4-route-timeline">${renderBudgetRows(vm, locale)}</div>
        </section>
        <section class="wh-card wh-r4-route-card" data-r4-cost-models="true">
          <h3>${escapeHtml(routeT(locale, "cost.models"))}</h3>
          <div class="wh-r4-route-timeline">${models || `<p class="wh-subtle">${escapeHtml(goldPathT(locale, "cost.statusFallback"))}</p>`}</div>
        </section>
      </div>
    </section>`
  });
}

function renderKnowledgeAction(action: EvidenceBubble["actions"][number], vm: EvidenceBubble) {
  if (!action.href) {
    return "";
  }
  const payload = action.id === "use_for_current_task"
    ? { evidence_bubble_id: vm.id, evidence_refs: vm.evidence_refs }
    : undefined;
  return `<a class="wh-btn${action.id === "use_for_current_task" ? " wh-btn-primary" : ""}" href="${escapeHtml(action.href)}" data-action-id="${escapeHtml(action.id)}"${action.method ? ` data-method="${escapeHtml(action.method)}"` : ""}${payload ? ` data-request-json="${jsonAttr(payload)}"` : ""}>${escapeHtml(action.label)}</a>`;
}

function renderKnowledgeRouteComponent(vm: EvidenceBubble, locale: WorkHubLocale): WebRouteComponent {
  const refs = vm.evidence_refs;
  const sourceRows = refs.length
    ? refs.slice(0, 6).map((ref) => `<div class="wh-r4-route-row" data-r4-knowledge-evidence-ref="${escapeHtml(ref.id)}" data-r4-knowledge-source-type="${escapeHtml(ref.source_type)}">
      <div>
        <strong>${escapeHtml(ref.title)}</strong>
        <p>${escapeHtml(ref.excerpt ?? ref.source_id)}</p>
      </div>
      ${ref.href ? `<a class="wh-pill" href="${escapeHtml(ref.href)}">${escapeHtml(routeT(locale, "knowledge.open"))}</a>` : `<span class="wh-pill">${escapeHtml(evidenceSourceLabel(locale, ref.source_type))}</span>`}
    </div>`).join("")
    : `<p class="wh-subtle" data-r4-knowledge-missing-note="true">${escapeHtml(vm.missing_evidence_note ?? routeT(locale, "knowledge.missing"))}</p>`;
  const actions = vm.actions.map((action) => renderKnowledgeAction(action, vm)).join("");

  return createWebRouteComponent({
    key: "knowledge",
    css: webRouteComponentCss,
    primaryHrefs: vm.actions.map((action) => action.href).filter((value): value is string => Boolean(value)),
    source: "evidence-bubble",
    locale,
    pageVm: "evidence",
    html: `<section class="wh-r4-route" data-r4-route-component="knowledge" data-r4-route-component-source="evidence-bubble" data-r4-route-component-locale="${escapeHtml(locale)}" data-r4-knowledge-bubble-id="${escapeHtml(vm.id)}" data-r4-knowledge-query="${escapeHtml(vm.query_text ?? "")}" data-r4-knowledge-evidence-count="${escapeHtml(String(refs.length))}" data-r4-knowledge-missing="${escapeHtml(String(refs.length === 0))}" data-r4-knowledge-action-count="${escapeHtml(String(vm.actions.length))}">
      <header class="wh-r4-route-head">
        <div>
          <span class="wh-r4-route-kicker">${escapeHtml(routeT(locale, "knowledge.kicker"))}</span>
          <h2>${escapeHtml(routeT(locale, "knowledge.sources"))}</h2>
          <p>${escapeHtml(vm.summary_text)}</p>
        </div>
        <span class="wh-r4-route-count">${escapeHtml(String(refs.length))}</span>
      </header>
      <section class="wh-card wh-r4-route-card wh-r4-route-card--accent" data-r4-knowledge-fallback="true">
        <h3>${escapeHtml(routeT(locale, "knowledge.sources"))}</h3>
        <div class="wh-r4-route-timeline">${sourceRows}</div>
        <div class="wh-r4-route-actions">${actions}</div>
      </section>
    </section>`
  });
}

function renderSettingsRouteComponent(vm: SettingsPageVM, locale: WorkHubLocale): WebRouteComponent {
  const reactComponent = createSettingsReactRouteComponent(vm, locale);
  const reactAttrs = dataAttrs(reactRouteComponentMarkerAttrs(reactComponent));
  const props = reactComponent.props;
  return createWebRouteComponent({
    key: "settings",
    css: webRouteComponentCss,
    primaryHrefs: reactComponent.primaryHrefs,
    source: "page-vm",
    locale,
    pageVm: "settings",
    reactComponent,
    html: `<section class="wh-r4-route" data-r4-route-component="settings" data-r4-route-component-source="page-vm" data-r4-route-component-locale="${escapeHtml(locale)}"${reactAttrs} data-r4-settings-generated-at="${escapeHtml(props.generatedAt)}" data-r4-settings-runtime-status="${escapeHtml(props.runtimeStatus)}" data-r4-settings-broker="${escapeHtml(props.brokerBackend)}" data-r4-settings-worker-count="${escapeHtml(String(props.workerCount))}" data-r4-settings-active-locale="${escapeHtml(props.activeLocale)}" data-r4-settings-preference-locale="${escapeHtml(props.preferenceLocale)}" data-r4-settings-preference-source="${escapeHtml(props.preferenceSource)}" data-r4-settings-preference-synced="${escapeHtml(String(props.preferenceSynced))}" data-r4-settings-secret-safe="${escapeHtml(String(props.secretSafe))}" data-r4-settings-pet-model-in-web="${escapeHtml(String(props.petModelSettingsInWeb))}" data-r4-settings-desktop-client="${escapeHtml(props.desktopClient)}" data-r4-settings-local-boundary="${escapeHtml(String(props.localExecutionBoundary))}" data-r4-settings-restore-requires-desktop="${escapeHtml(String(props.restoreRequiresDesktop))}" data-r4-settings-web-local-actions="${escapeHtml(String(props.webLocalActionsEnabled))}">
      <header class="wh-r4-route-head">
        <div>
          <span class="wh-r4-route-kicker">${escapeHtml(goldPathT(locale, "settings.kicker"))}</span>
          <h2>${escapeHtml(goldPathT(locale, "settings.title"))}</h2>
          <p>${escapeHtml(goldPathT(locale, "settings.summary"))}</p>
        </div>
        <span class="wh-r4-route-count">${escapeHtml(props.appEnv)}</span>
      </header>
      <div class="wh-r4-route-grid">
        <section class="wh-card wh-r4-route-card wh-r4-route-card--accent" data-r4-settings-runtime="true">
          <h3>${escapeHtml(routeT(locale, "settings.runtime"))}</h3>
          <div class="wh-r4-route-row"><strong>${escapeHtml(routeT(locale, "settings.runtimeStatus"))}</strong><span class="wh-pill">${escapeHtml(runtimeStatusLabel(props.runtimeStatus, locale))}</span></div>
          <div class="wh-r4-route-row"><strong>${escapeHtml(routeT(locale, "settings.worker"))}</strong><span class="wh-pill">${escapeHtml(String(props.workerCount))}</span></div>
          <div class="wh-r4-route-row"><strong>${escapeHtml(routeT(locale, "settings.broker"))}</strong><span class="wh-pill">${escapeHtml(props.brokerBackend)} · ${escapeHtml(boolLabel(props.brokerConfigured, locale))}</span></div>
          <div class="wh-r4-route-row"><strong>${escapeHtml(routeT(locale, "settings.database"))}</strong><span class="wh-pill">${escapeHtml(boolLabel(props.databaseConfigured, locale))}</span></div>
          <div class="wh-r4-route-row"><strong>${escapeHtml(routeT(locale, "settings.lease"))}</strong><span class="wh-pill">${escapeHtml(String(props.agentRunLeaseMs))}ms</span></div>
          <div class="wh-r4-route-row"><strong>${escapeHtml(routeT(locale, "settings.recovery"))}</strong><span class="wh-pill">${escapeHtml(String(props.agentRunRecoveryIntervalMs))}ms</span></div>
        </section>
        <section class="wh-card wh-r4-route-card" data-r4-settings-llm="true">
          <h3>${escapeHtml(routeT(locale, "settings.llm"))}</h3>
          <div class="wh-r4-route-row"><strong>${escapeHtml(routeT(locale, "settings.provider"))}</strong><span class="wh-pill">${escapeHtml(props.defaultProvider)}</span></div>
          <div class="wh-r4-route-row"><div><strong>${escapeHtml(routeT(locale, "settings.model"))}</strong><p>${escapeHtml(props.defaultModel)}</p></div><span class="wh-pill">${escapeHtml(String(props.providerCount))}</span></div>
          <div class="wh-r4-route-row"><strong>${escapeHtml(routeT(locale, "settings.apiKey"))}</strong><span class="wh-pill">${escapeHtml(boolLabel(props.apiKeyConfigured, locale))}</span></div>
          <div class="wh-r4-route-row"><strong>${escapeHtml(routeT(locale, "settings.baseUrl"))}</strong><span class="wh-pill">${escapeHtml(boolLabel(props.baseUrlConfigured, locale))}</span></div>
          <div class="wh-r4-route-row"><strong>${escapeHtml(routeT(locale, "settings.secretSafe"))}</strong><span class="wh-pill">${escapeHtml(boolLabel(props.secretSafe, locale))}</span></div>
        </section>
      </div>
      <div class="wh-r4-route-grid">
        <section class="wh-card wh-r4-route-card" data-r4-settings-language="true">
          <h3>${escapeHtml(routeT(locale, "settings.language"))}</h3>
          <div class="wh-r4-route-row"><strong>${escapeHtml(routeT(locale, "settings.activeLocale"))}</strong><span class="wh-pill">${escapeHtml(props.activeLocale)}</span></div>
          <div class="wh-r4-route-row"><strong>${escapeHtml(routeT(locale, "settings.preferenceLocale"))}</strong><span class="wh-pill">${escapeHtml(props.preferenceLocale)}</span></div>
          <div class="wh-r4-route-row"><strong>${escapeHtml(routeT(locale, "settings.preferenceSource"))}</strong><span class="wh-pill">${escapeHtml(props.preferenceSource)}</span></div>
          <div class="wh-r4-route-row"><strong>${escapeHtml(routeT(locale, "settings.preferenceSync"))}</strong><span class="wh-pill">${escapeHtml(syncLabel(props.preferenceSynced, locale))}</span></div>
          <div class="wh-r4-route-row"><strong>${escapeHtml(routeT(locale, "settings.supported"))}</strong><span class="wh-pill">${escapeHtml(props.supportedLocales.join(" / "))}</span></div>
          <div class="wh-r4-route-row"><strong>${escapeHtml(routeT(locale, "settings.storage"))}</strong><span class="wh-pill">${escapeHtml(props.storageKey)}</span></div>
          <div class="wh-r4-route-row"><strong>${escapeHtml(routeT(locale, "settings.updateEndpoint"))}</strong><span class="wh-pill">${escapeHtml(props.updateHref)}</span></div>
        </section>
        <section class="wh-card wh-r4-route-card" data-r4-settings-device="true">
          <h3>${escapeHtml(routeT(locale, "settings.device"))}</h3>
          <div class="wh-r4-route-row"><strong>${escapeHtml(routeT(locale, "settings.localExecution"))}</strong><span class="wh-pill">${escapeHtml(String(props.localExecutionBoundary))}</span></div>
          <div class="wh-r4-route-row"><strong>${escapeHtml(routeT(locale, "settings.independentPet"))}</strong><span class="wh-pill">${escapeHtml(String(props.independentPetWindow))}</span></div>
          <div class="wh-r4-route-row"><strong>${escapeHtml(routeT(locale, "settings.petBoundary"))}</strong><span class="wh-pill">${escapeHtml(String(!props.petModelSettingsInWeb))}</span></div>
          <div class="wh-r4-route-row"><strong>${escapeHtml(routeT(locale, "settings.desktopGate"))}</strong><span class="wh-pill">${escapeHtml(String(props.restoreRequiresDesktop))}</span></div>
          <div class="wh-r4-route-row"><strong>${escapeHtml(routeT(locale, "settings.webLocalActions"))}</strong><span class="wh-pill">${escapeHtml(String(props.webLocalActionsEnabled))}</span></div>
          <a class="wh-btn" href="${escapeHtml(props.restoreHref)}" data-action-id="open_desktop_settings" data-method="GET" data-requires-desktop="${escapeHtml(String(props.restoreRequiresDesktop))}">${escapeHtml(routeT(locale, "settings.restore"))}</a>
        </section>
      </div>
    </section>`
  });
}

function renderReplayRouteComponent(vm: GoldPathSurfaceVM, locale: WorkHubLocale): WebRouteComponent {
  const rendered = renderAgentRunReplay(vm.page_vms.replay, "web", { locale });
  const reactComponent = createReplayReactRouteComponent(rendered, locale);
  const reactAttrs = dataAttrs(reactRouteComponentMarkerAttrs(reactComponent));
  return createWebRouteComponent({
    key: "replay",
    css: `${webRouteComponentCss}${rendered.css}`,
    primaryHrefs: reactComponent.primaryHrefs,
    source: "page-vm",
    locale,
    pageVm: "replay",
    reactComponent,
    html: `<section class="wh-r4-route" data-r4-route-component="replay" data-r4-route-component-source="page-vm" data-r4-route-component-locale="${escapeHtml(locale)}"${reactAttrs} data-r4-replay-run-id="${escapeHtml(reactComponent.props.runId)}" data-r4-replay-workitem-id="${escapeHtml(reactComponent.props.workItemId)}" data-r4-replay-step-count="${escapeHtml(String(reactComponent.props.stepCount))}" data-r4-replay-accepted-deliverable-count="${escapeHtml(String(reactComponent.props.acceptedDeliverableCount))}" data-r4-replay-merge-attempt-count="${escapeHtml(String(reactComponent.props.mergeAttemptCount))}" data-r4-replay-structured-audit-count="${escapeHtml(String(reactComponent.props.structuredAuditCount))}">${rendered.html}</section>`
  });
}

export function renderWebRouteComponents(
  vm: GoldPathSurfaceVM,
  options: RouteComponentOptions = {}
): WebRouteComponentMap {
  const locale = normalizeWorkHubLocale(options.locale);
  const routeSurface = vm as R4RouteSurface;
  return {
    home: renderHomeRouteComponent(vm.page_vms.attention, locale),
    ...(routeSurface.intake_session ? { intake: renderIntakeRouteComponent(routeSurface.intake_session, locale) } : {}),
    approvals: renderApprovalsRouteComponent(vm.page_vms.approvals, locale),
    workitem: renderWorkItemRouteComponent(vm.page_vms.workitem, locale),
    proposal: renderProposalRouteComponent(vm.page_vms.proposal, locale, proposalConflictsFromSurface(routeSurface)),
    replay: renderReplayRouteComponent(vm, locale),
    cost: renderCostRouteComponent(vm.page_vms.cost, locale),
    ...(routeSurface.knowledge_evidence ? { knowledge: renderKnowledgeRouteComponent(routeSurface.knowledge_evidence, locale) } : {}),
    ...(vm.page_vms.settings ? { settings: renderSettingsRouteComponent(vm.page_vms.settings, locale) } : {})
  };
}
