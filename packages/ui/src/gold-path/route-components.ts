import type {
  ActionSpec,
  ApprovalCenterVM,
  AttentionAction,
  AttentionHomeVM,
  AttentionItem,
  GoldPathSurfaceVM
} from "@workhub/contracts";

import { renderAgentRunReplay } from "../replay/index.js";
import { goldPathT, normalizeWorkHubLocale, type WorkHubLocale } from "./i18n.js";
import type { GoldPathRenderedPage } from "./render.js";

export type WebRouteComponentKey = Extract<GoldPathRenderedPage["key"], "home" | "approvals" | "replay">;

export type WebRouteComponent = {
  key: WebRouteComponentKey;
  html: string;
  css: string;
  primaryHrefs: string[];
};

export type WebRouteComponentMap = Partial<Record<GoldPathRenderedPage["key"], WebRouteComponent>>;

type RouteComponentOptions = {
  locale?: WorkHubLocale | undefined;
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
  ".wh-r4-route-meta{display:flex;gap:6px;flex-wrap:wrap;align-items:center;justify-content:flex-start}",
  ".wh-r4-route-actions{display:flex;gap:10px;flex-wrap:wrap;align-items:center}",
  ".wh-r4-route .wh-btn,.wh-r4-route .wh-pill{max-width:100%;white-space:normal;text-align:left;overflow-wrap:anywhere}",
  ".wh-r4-route-count{display:inline-flex;align-items:center;justify-content:center;border:1px solid var(--wh-product-line,#dce4f1);border-radius:8px;background:#fff;padding:8px 10px;color:var(--wh-product-ink,#172033);font-weight:900;line-height:1}",
  ".wh-r4-route-timeline{display:grid;gap:8px}",
  "@media (max-width:860px){.wh-r4-route-head,.wh-r4-route-grid,.wh-r4-route-row{grid-template-columns:1fr}.wh-r4-route-head{align-items:start}.wh-r4-route-count{width:max-content}.wh-r4-route-actions{align-items:flex-start}}"
].join("");

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;");
}

function actionClass(action: AttentionAction | ActionSpec, index: number) {
  if ("style" in action && action.style === "danger") {
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
      return `<a class="${actionClass(action, index)}" href="${escapeHtml(action.href)}" data-action-id="${escapeHtml(action.id)}"${reason}${method}>${escapeHtml(action.label)}</a>`;
    })
    .join("")}</div>`;
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

  return {
    key: "home",
    css: webRouteComponentCss,
    primaryHrefs: primaryActions.map((action) => action.href),
    html: `<section class="wh-r4-route" data-r4-route-component="home" data-r4-route-component-source="page-vm" data-r4-route-component-locale="${escapeHtml(locale)}" data-r4-home-primary="${escapeHtml(String(Boolean(primary)))}">
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
  };
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

  return {
    key: "approvals",
    css: webRouteComponentCss,
    primaryHrefs: primary?.actions.map((action) => action.href) ?? [],
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
  };
}

function renderReplayRouteComponent(vm: GoldPathSurfaceVM, locale: WorkHubLocale): WebRouteComponent {
  const rendered = renderAgentRunReplay(vm.page_vms.replay, "web", { locale });
  return {
    key: "replay",
    css: `${webRouteComponentCss}${rendered.css}`,
    primaryHrefs: rendered.primaryHrefs,
    html: `<section class="wh-r4-route" data-r4-route-component="replay" data-r4-route-component-source="page-vm" data-r4-route-component-locale="${escapeHtml(locale)}" data-r4-replay-run-id="${escapeHtml(rendered.runId)}" data-r4-replay-step-count="${escapeHtml(String(rendered.stepCount))}">${rendered.html}</section>`
  };
}

export function renderWebRouteComponents(
  vm: GoldPathSurfaceVM,
  options: RouteComponentOptions = {}
): WebRouteComponentMap {
  const locale = normalizeWorkHubLocale(options.locale);
  return {
    home: renderHomeRouteComponent(vm.page_vms.attention, locale),
    approvals: renderApprovalsRouteComponent(vm.page_vms.approvals, locale),
    replay: renderReplayRouteComponent(vm, locale)
  };
}
