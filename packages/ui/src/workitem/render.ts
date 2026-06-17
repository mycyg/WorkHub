import type {
  AgentStep,
  CuuState,
  EvidenceRef,
  WorkItemDetailVM,
  WorkItemStatus
} from "@workhub/contracts";

import {
  checkStatusLabel,
  evidenceSourceLabel,
  uiCount,
  uiLocale,
  uiT,
  workItemStatusLabel,
  type UiRenderOptions
} from "../i18n.js";
import { safeHref } from "../safe-href.js";

export type WorkItemRenderSurface = "web" | "desktop";

export type WorkItemRenderedPage = {
  surface: WorkItemRenderSurface;
  workItemId: string;
  title: string;
  status: WorkItemStatus;
  css: string;
  html: string;
  route: string;
  primaryHrefs: string[];
  traceCount: number;
  evidenceCount: number;
  cuuState: CuuState;
};

export const workItemCss = [
  ":root{color-scheme:light;--ink:#182033;--muted:#60708f;--line:#dfe6f2;--paper:#fff;--soft:#f5f8fc;--blue:#355cff;--green:#24a66a;--amber:#d98b16;--danger:#d94a3a;--teal:#0f9f8f}",
  ".wh-workitem{font-family:\"Aptos\",\"Segoe UI\",sans-serif;color:var(--ink);background:linear-gradient(180deg,#f8fbff 0%,#eef5fb 100%);padding:24px;box-sizing:border-box}",
  ".wh-frame{max-width:1180px;margin:0 auto;display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:20px;align-items:start}",
  ".wh-main,.wh-rail{background:rgba(255,255,255,.93);border:1px solid var(--line);border-radius:8px;box-shadow:0 18px 50px rgba(37,51,79,.08)}",
  ".wh-main{padding:24px}.wh-rail{padding:18px;position:sticky;top:16px}.wh-kicker{font-size:12px;color:var(--blue);font-weight:750;text-transform:uppercase;letter-spacing:0}",
  ".wh-title{font-size:30px;line-height:1.35;margin:8px 0}.wh-subtle{color:var(--muted);line-height:1.55}.wh-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:14px;margin-top:18px}",
  ".wh-card{border:1px solid var(--line);background:var(--paper);border-radius:8px;padding:15px}.wh-row{display:flex;justify-content:space-between;gap:14px;border-top:1px solid var(--line);padding:12px 0}.wh-row:first-child{border-top:0}",
  ".wh-pill{display:inline-flex;align-items:center;gap:6px;border-radius:999px;background:var(--soft);padding:5px 9px;font-size:12px;color:var(--muted)}.wh-pill-run{background:#eaf6f4;color:var(--teal)}.wh-pill-review{background:#fff6e8;color:var(--amber)}.wh-pill-done{background:#eaf8f0;color:var(--green)}",
  ".wh-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:18px}.wh-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;border-radius:8px;border:1px solid var(--line);padding:9px 12px;color:var(--ink);text-decoration:none;background:#fff;font-weight:700}.wh-btn-primary{background:var(--blue);border-color:var(--blue);color:#fff}",
  ".wh-trace{display:grid;gap:8px}.wh-trace-dot{width:22px;height:22px;border-radius:999px;background:#edf1ff;color:var(--blue);display:grid;place-items:center;font-size:12px;flex:0 0 auto}.wh-trace-row{display:flex;gap:10px;align-items:flex-start}",
  ".wh-desktop .wh-frame{max-width:980px;grid-template-columns:minmax(0,1fr) 260px}.wh-desktop .wh-workitem{background:linear-gradient(135deg,#edf6ff,#f8fbff)}@media (max-width:860px){.wh-frame{grid-template-columns:1fr}.wh-rail{position:static}.wh-title{font-size:24px}}"
].join("");

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#39;");
}

function stripMarkdown(value: string) {
  return value.replace(/[#*_`>-]/gu, " ").replace(/\s+/gu, " ").trim();
}

function cuuStateFor(status: WorkItemStatus, hasProposal: boolean): CuuState {
  if (status === "merged" || status === "done") {
    return "celebrating";
  }
  if (status === "in_review" || hasProposal) {
    return "carrying_document";
  }
  if (status === "escalated" || status === "pm_mode") {
    return "worried";
  }
  if (status === "intake" || status === "ai_clarifying") {
    return "asking_approval";
  }
  return "thinking";
}

function statusClass(status: WorkItemStatus) {
  if (status === "in_review" || status === "spec_ready") {
    return "wh-pill wh-pill-review";
  }
  if (status === "merged" || status === "done") {
    return "wh-pill wh-pill-done";
  }
  if (status === "ai_working") {
    return "wh-pill wh-pill-run";
  }
  return "wh-pill";
}

function renderTrace(steps: AgentStep[], options?: UiRenderOptions) {
  const locale = uiLocale(options);
  if (steps.length === 0) {
    return `<p class="wh-subtle">${escapeHtml(uiT(locale, "workitem.emptyTrace"))}</p>`;
  }
  return `<div class="wh-trace">${steps
    .map(
      (step) =>
        `<div class="wh-trace-row"><span class="wh-trace-dot">${step.step_no}</span><div><strong>${escapeHtml(step.phase)}</strong><p class="wh-subtle">${escapeHtml(step.output_excerpt ?? step.tool_name ?? uiT(locale, "workitem.stepFallback"))}</p></div></div>`
    )
    .join("")}</div>`;
}

function evidenceRows(evidenceRefs: EvidenceRef[], options?: UiRenderOptions) {
  const locale = uiLocale(options);
  if (evidenceRefs.length === 0) {
    return `<p class="wh-subtle">${escapeHtml(uiT(locale, "generic.noEvidence"))}</p>`;
  }
  return evidenceRefs
    .map(
      (ref) =>
        `<div class="wh-row"><div><strong>${escapeHtml(ref.title)}</strong><p class="wh-subtle">${escapeHtml(ref.excerpt ?? ref.source_id)}</p></div><span class="wh-pill">${escapeHtml(evidenceSourceLabel(locale, ref.source_type))}</span></div>`
    )
    .join("");
}

function acceptanceRows(items: unknown[], options?: UiRenderOptions) {
  const locale = uiLocale(options);
  if (items.length === 0) {
    return `<p class="wh-subtle">${escapeHtml(uiT(locale, "workitem.emptyAcceptance"))}</p>`;
  }
  return items
    .map((item, index) => {
      const record = item && typeof item === "object" ? item as Record<string, unknown> : {};
      const title = record.title ?? `${uiT(locale, "workitem.acceptanceItem")} ${index + 1}`;
      const status = String(record.status ?? "open");
      return `<div class="wh-row"><strong>${escapeHtml(title)}</strong><span class="wh-pill">${escapeHtml(checkStatusLabel(locale, status))}</span></div>`;
    })
    .join("");
}

function primaryHrefs(vm: WorkItemDetailVM) {
  const proposalId = vm.latest_proposal?.proposal_id;
  const runId = vm.agent_trace_preview[0]?.agent_run_id;
  return [
    proposalId ? `/proposals/${proposalId}` : undefined,
    runId ? `/agent-runs/${runId}/replay` : undefined,
    vm.workitem.status === "spec_ready" ? `/api/workitems/${vm.workitem.id}/agent-runs` : undefined
  ].filter((value): value is string => Boolean(value));
}

export function renderWorkItemDetail(
  vm: WorkItemDetailVM,
  surface: WorkItemRenderSurface,
  options?: UiRenderOptions
): WorkItemRenderedPage {
  const locale = uiLocale(options);
  const hasProposal = Boolean(vm.latest_proposal);
  const cuuState = cuuStateFor(vm.workitem.status, hasProposal);
  const hrefs = primaryHrefs(vm);
  const title = vm.workitem.title ?? vm.workitem.code;
  const rootClass = surface === "desktop" ? "wh-desktop" : "wh-web";
  const summary = stripMarkdown(vm.workitem.summary_md ?? vm.workitem.raw_description ?? uiT(locale, "workitem.defaultSummary"));
  const main = `<section class="wh-main" data-workitem-id="${escapeHtml(vm.workitem.id)}">
    <span class="wh-kicker">${escapeHtml(uiT(locale, "workitem.kicker"))}</span>
    <h1 class="wh-title">${escapeHtml(title)}</h1>
    <p class="wh-subtle">${escapeHtml(summary)}</p>
    <div class="wh-grid">
      <article class="wh-card"><strong>${escapeHtml(uiT(locale, "generic.status"))}</strong><p><span class="${statusClass(vm.workitem.status)}">${escapeHtml(workItemStatusLabel(locale, vm.workitem.status))}</span></p></article>
      <article class="wh-card"><strong>${escapeHtml(uiT(locale, "generic.acceptance"))}</strong><p class="wh-subtle">${escapeHtml(uiCount(locale, vm.acceptance.length, "项", "item"))}</p></article>
      <article class="wh-card"><strong>${escapeHtml(uiT(locale, "generic.evidence"))}</strong><p class="wh-subtle">${escapeHtml(uiCount(locale, vm.evidence_refs.length, "条来源", "source"))}</p></article>
    </div>
    <h2>${escapeHtml(uiT(locale, "workitem.liveTitle"))}</h2>
    <article class="wh-card">${renderTrace(vm.agent_trace_preview, { locale })}</article>
    <h2>${escapeHtml(uiT(locale, "workitem.acceptanceTitle"))}</h2>
    <article class="wh-card">${acceptanceRows(vm.acceptance, { locale })}</article>
    <h2>${escapeHtml(uiT(locale, "generic.evidence"))}</h2>
    <article class="wh-card">${evidenceRows(vm.evidence_refs, { locale })}</article>
    ${
      hrefs.length
        ? `<div class="wh-actions">${hrefs
            .map((href, index) => `<a class="${index === 0 ? "wh-btn wh-btn-primary" : "wh-btn"}" href="${escapeHtml(safeHref(href))}">${escapeHtml(index === 0 ? uiT(locale, "generic.continueViewing") : uiT(locale, "generic.open"))}</a>`)
            .join("")}</div>`
        : ""
    }
  </section>`;
  const rail = `<aside class="wh-rail">
    <span class="wh-kicker">${escapeHtml(uiT(locale, "generic.aiStatus"))}</span>
    <h2>${escapeHtml(cuuState === "carrying_document" ? uiT(locale, "workitem.deliveryPending") : cuuState === "thinking" ? uiT(locale, "workitem.started") : uiT(locale, "workitem.currentStatus"))}</h2>
    <p class="wh-subtle">${escapeHtml(hasProposal ? uiT(locale, "workitem.proposalReady") : uiT(locale, "workitem.willReadEvidence"))}</p>
    <article class="wh-card"><strong>${escapeHtml(uiT(locale, "generic.currentThing"))}</strong><p class="wh-subtle">${escapeHtml(title)}</p></article>
  </aside>`;

  return {
    surface,
    workItemId: vm.workitem.id,
    title,
    status: vm.workitem.status,
    css: workItemCss,
    html: `<div class="${rootClass}"><main class="wh-workitem"><div class="wh-frame">${main}${rail}</div></main></div>`,
    route: `/workitems/${encodeURIComponent(vm.workitem.id)}`,
    primaryHrefs: hrefs,
    traceCount: vm.agent_trace_preview.length,
    evidenceCount: vm.evidence_refs.length,
    cuuState
  };
}
