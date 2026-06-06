import type {
  AgentStep,
  CuuState,
  EvidenceRef,
  WorkItemDetailVM,
  WorkItemStatus
} from "@workhub/contracts";

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
  ".wh-title{font-size:30px;line-height:1.12;margin:8px 0}.wh-subtle{color:var(--muted);line-height:1.55}.wh-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:14px;margin-top:18px}",
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
    .replace(/"/gu, "&quot;");
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

function renderTrace(steps: AgentStep[]) {
  if (steps.length === 0) {
    return '<p class="wh-subtle">Cuu 已准备好，下一步会开始读取证据。</p>';
  }
  return `<div class="wh-trace">${steps
    .map(
      (step) =>
        `<div class="wh-trace-row"><span class="wh-trace-dot">${step.step_no}</span><div><strong>${escapeHtml(step.phase)}</strong><p class="wh-subtle">${escapeHtml(step.output_excerpt ?? step.tool_name ?? "记录了一步。")}</p></div></div>`
    )
    .join("")}</div>`;
}

function evidenceRows(evidenceRefs: EvidenceRef[]) {
  if (evidenceRefs.length === 0) {
    return '<p class="wh-subtle">暂无可展示证据。</p>';
  }
  return evidenceRefs
    .map(
      (ref) =>
        `<div class="wh-row"><div><strong>${escapeHtml(ref.title)}</strong><p class="wh-subtle">${escapeHtml(ref.excerpt ?? ref.source_id)}</p></div><span class="wh-pill">${escapeHtml(ref.source_type)}</span></div>`
    )
    .join("");
}

function acceptanceRows(items: unknown[]) {
  if (items.length === 0) {
    return '<p class="wh-subtle">暂无验收项。</p>';
  }
  return items
    .map((item, index) => {
      const record = item && typeof item === "object" ? item as Record<string, unknown> : {};
      const title = record.title ?? `验收项 ${index + 1}`;
      const status = record.status ?? "open";
      return `<div class="wh-row"><strong>${escapeHtml(title)}</strong><span class="wh-pill">${escapeHtml(status)}</span></div>`;
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

export function renderWorkItemDetail(vm: WorkItemDetailVM, surface: WorkItemRenderSurface): WorkItemRenderedPage {
  const hasProposal = Boolean(vm.latest_proposal);
  const cuuState = cuuStateFor(vm.workitem.status, hasProposal);
  const hrefs = primaryHrefs(vm);
  const title = vm.workitem.title ?? vm.workitem.code;
  const rootClass = surface === "desktop" ? "wh-desktop" : "wh-web";
  const summary = stripMarkdown(vm.workitem.summary_md ?? vm.workitem.raw_description ?? "Cuu 会把这件事拆成可执行的下一步。");
  const main = `<section class="wh-main" data-workitem-id="${escapeHtml(vm.workitem.id)}">
    <span class="wh-kicker">Work item</span>
    <h1 class="wh-title">${escapeHtml(title)}</h1>
    <p class="wh-subtle">${escapeHtml(summary)}</p>
    <div class="wh-grid">
      <article class="wh-card"><strong>状态</strong><p><span class="${statusClass(vm.workitem.status)}">${escapeHtml(vm.workitem.status)}</span></p></article>
      <article class="wh-card"><strong>验收</strong><p class="wh-subtle">${vm.acceptance.length} 项</p></article>
      <article class="wh-card"><strong>证据</strong><p class="wh-subtle">${vm.evidence_refs.length} 条来源</p></article>
    </div>
    <h2>AI 实时执行</h2>
    <article class="wh-card">${renderTrace(vm.agent_trace_preview)}</article>
    <h2>验收清单</h2>
    <article class="wh-card">${acceptanceRows(vm.acceptance)}</article>
    <h2>证据</h2>
    <article class="wh-card">${evidenceRows(vm.evidence_refs)}</article>
    ${
      hrefs.length
        ? `<div class="wh-actions">${hrefs
            .map((href, index) => `<a class="${index === 0 ? "wh-btn wh-btn-primary" : "wh-btn"}" href="${escapeHtml(href)}">${index === 0 ? "继续查看" : "打开"}</a>`)
            .join("")}</div>`
        : ""
    }
  </section>`;
  const rail = `<aside class="wh-rail">
    <span class="wh-kicker">Cuu</span>
    <h2>${cuuState === "carrying_document" ? "交付物待确认" : cuuState === "thinking" ? "我开始处理了" : "当前状态"}</h2>
    <p class="wh-subtle">${hasProposal ? "我已经把改动整理成一份可审的变更申请。" : "我会先读证据，再生成可审批的交付物。"}</p>
    <article class="wh-card"><strong>当前一件事</strong><p class="wh-subtle">${escapeHtml(title)}</p></article>
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
