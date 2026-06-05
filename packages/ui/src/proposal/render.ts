import type {
  ActionSpec,
  CuuState,
  DeliverableChange,
  DeliverableCheck,
  EvidenceRef,
  ProposalDetailVM
} from "@workhub/contracts";

export type ProposalRenderSurface = "web" | "desktop";

export type ProposalRenderedPage = {
  surface: ProposalRenderSurface;
  proposalId: string;
  workItemId: string;
  title: string;
  css: string;
  html: string;
  actionHrefs: string[];
  changeCount: number;
  evidenceCount: number;
  cuuState: CuuState;
};

export const proposalCss = [
  ":root{color-scheme:light;--ink:#182033;--muted:#5e6a86;--line:#dfe5f1;--paper:#fff;--soft:#f5f8fc;--blue:#355cff;--green:#24a66a;--coral:#ee6b5f;--amber:#d98b16;--danger:#d94a3a}",
  ".wh-proposal{font-family:\"Aptos\",\"Segoe UI\",sans-serif;color:var(--ink);background:linear-gradient(180deg,#f8fbff 0%,#eef4fb 100%);padding:24px;box-sizing:border-box}",
  ".wh-proposal-frame{max-width:1120px;margin:0 auto;display:grid;grid-template-columns:minmax(0,1fr) 280px;gap:20px;align-items:start}",
  ".wh-proposal-main,.wh-proposal-rail{background:rgba(255,255,255,.92);border:1px solid var(--line);border-radius:8px;box-shadow:0 18px 50px rgba(37,51,79,.08)}",
  ".wh-proposal-main{padding:24px}.wh-proposal-rail{padding:18px;position:sticky;top:16px}.wh-kicker{font-size:12px;color:var(--blue);font-weight:700;text-transform:uppercase;letter-spacing:0}",
  ".wh-title{font-size:30px;line-height:1.12;margin:8px 0}.wh-subtle{color:var(--muted);line-height:1.55}.wh-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:14px;margin-top:18px}",
  ".wh-card{border:1px solid var(--line);background:var(--paper);border-radius:8px;padding:16px}.wh-row{display:flex;justify-content:space-between;gap:14px;border-top:1px solid var(--line);padding:12px 0}.wh-row:first-child{border-top:0}",
  ".wh-pill{display:inline-flex;align-items:center;gap:6px;border-radius:999px;background:var(--soft);padding:5px 9px;font-size:12px;color:var(--muted)}.wh-pill-danger{background:#fff1ef;color:var(--danger)}",
  ".wh-check{display:grid;gap:4px;border-left:3px solid var(--green);padding-left:10px}.wh-check[data-status=warning],.wh-check[data-status=skipped]{border-left-color:var(--amber)}.wh-check[data-status=failed]{border-left-color:var(--danger)}",
  ".wh-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:18px}.wh-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;border-radius:8px;border:1px solid var(--line);padding:9px 12px;color:var(--ink);text-decoration:none;background:#fff;font-weight:650}.wh-btn-primary{background:var(--blue);color:#fff;border-color:var(--blue)}.wh-btn-danger{background:#fff4f3;color:#a94137;border-color:#f3c5c0}",
  ".wh-desktop .wh-proposal-frame{max-width:940px;grid-template-columns:1fr 240px}.wh-desktop .wh-proposal{background:linear-gradient(135deg,#edf6ff,#f8fbff)}@media (max-width:860px){.wh-proposal-frame{grid-template-columns:1fr}.wh-proposal-rail{position:static}.wh-title{font-size:24px}}"
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

function actionClass(action: ActionSpec, index: number) {
  if (action.id === "request_changes") {
    return "wh-btn wh-btn-danger";
  }
  return index === 0 ? "wh-btn wh-btn-primary" : "wh-btn";
}

function renderActions(actions: ActionSpec[]) {
  return `<div class="wh-actions">${actions
    .map((action, index) => {
      const reason = action.requires_reason ? ' data-requires-reason="true"' : "";
      const desktop = action.requires_desktop ? ' data-requires-desktop="true"' : "";
      return `<a class="${actionClass(action, index)}" href="${escapeHtml(action.href)}" data-action-id="${escapeHtml(action.id)}" data-method="${escapeHtml(action.method)}"${reason}${desktop}>${escapeHtml(action.label)}</a>`;
    })
    .join("")}</div>`;
}

function renderChange(change: DeliverableChange) {
  const path = change.target_ref.path ?? change.target_ref.entity_id ?? change.target_ref.entity_type;
  const preview = change.preview_ref
    ? `<a class="wh-pill" href="${escapeHtml(change.preview_ref.href)}">${escapeHtml(change.preview_ref.kind)}</a>`
    : "";
  return `<div class="wh-row" data-change-kind="${escapeHtml(change.target_kind)}" data-change-type="${escapeHtml(change.change_type)}">
    <div>
      <strong>${escapeHtml(change.human_summary)}</strong>
      <p class="wh-subtle">${escapeHtml(path)}</p>
    </div>
    <div>
      <span class="wh-pill">${escapeHtml(change.target_kind)}</span>
      <span class="wh-pill">${escapeHtml(change.change_type)}</span>
      ${preview}
    </div>
  </div>`;
}

function renderCheck(check: DeliverableCheck) {
  return `<div class="wh-check" data-status="${escapeHtml(check.status)}">
    <strong>${escapeHtml(check.label)}</strong>
    <span class="wh-subtle">${escapeHtml(check.status)}${check.detail ? ` · ${escapeHtml(check.detail)}` : ""}</span>
  </div>`;
}

function renderEvidence(evidenceRefs: EvidenceRef[]) {
  if (evidenceRefs.length === 0) {
    return '<p class="wh-subtle">没有找到可展示的证据。</p>';
  }
  return evidenceRefs
    .map(
      (ref) =>
        `<article class="wh-card" data-evidence-source="${escapeHtml(ref.source_type)}"><strong>${escapeHtml(ref.title)}</strong><p class="wh-subtle">${escapeHtml(ref.excerpt ?? ref.source_id)}</p>${ref.href ? `<a class="wh-pill" href="${escapeHtml(ref.href)}">打开来源</a>` : `<span class="wh-pill">${escapeHtml(ref.source_type)}</span>`}</article>`
    )
    .join("");
}

function renderRail(vm: ProposalDetailVM) {
  const manifest = vm.manifest;
  return `<aside class="wh-proposal-rail">
    <span class="wh-kicker">Cuu state</span>
    <h2>${vm.status === "merged" ? "完成啦" : "带着交付物"}</h2>
    <p class="wh-subtle">${escapeHtml(manifest.risk.human_label)}</p>
    <article class="wh-card">
      <strong>回滚</strong>
      <p class="wh-subtle">${escapeHtml(manifest.rollback.description)}</p>
      <span class="${manifest.rollback.available ? "wh-pill" : "wh-pill wh-pill-danger"}">${manifest.rollback.available ? "可回滚" : "不可回滚"}</span>
    </article>
    <article class="wh-card">
      <strong>证据</strong>
      <p class="wh-subtle">${vm.evidence_refs.length} 条来源</p>
    </article>
  </aside>`;
}

export function renderProposalDetail(vm: ProposalDetailVM, surface: ProposalRenderSurface): ProposalRenderedPage {
  const actionList = [
    vm.review_actions.approve,
    vm.review_actions.request_changes,
    ...(vm.review_actions.merge ? [vm.review_actions.merge] : [])
  ];
  const rootClass = surface === "desktop" ? "wh-desktop" : "wh-web";
  const summary = stripMarkdown(vm.manifest.summary_md).slice(0, 260);
  const main = `<section class="wh-proposal-main">
    <span class="wh-kicker">Deliverable change request</span>
    <h1 class="wh-title">${escapeHtml(vm.title)}</h1>
    <p class="wh-subtle">${escapeHtml(summary)}</p>
    <div class="wh-grid">
      <article class="wh-card"><strong>改动</strong><p class="wh-subtle">${vm.manifest.changes.length} 项文件或对象</p></article>
      <article class="wh-card"><strong>检查</strong><p class="wh-subtle">${vm.manifest.checks.length} 项检查已记录</p></article>
      <article class="wh-card"><strong>风险</strong><p class="wh-subtle">${escapeHtml(vm.manifest.risk.human_label)}</p></article>
    </div>
    <h2>这次改了什么</h2>
    <div class="wh-card">${vm.manifest.changes.map(renderChange).join("")}</div>
    <h2>检查结果</h2>
    <div class="wh-grid">${vm.manifest.checks.map(renderCheck).join("")}</div>
    <h2>证据</h2>
    <div class="wh-grid">${renderEvidence(vm.evidence_refs)}</div>
    ${vm.comments.length > 0 ? `<h2>负责人意见</h2><div class="wh-card">${vm.comments.map((comment) => `<div class="wh-row"><strong>${escapeHtml(comment.author_label)}</strong><p class="wh-subtle">${escapeHtml(comment.body)}</p></div>`).join("")}</div>` : ""}
    ${renderActions(actionList)}
  </section>`;

  return {
    surface,
    proposalId: vm.proposal_id,
    workItemId: vm.work_item_id,
    title: vm.title,
    css: proposalCss,
    html: `<div class="${rootClass}"><main class="wh-proposal"><div class="wh-proposal-frame">${main}${renderRail(vm)}</div></main></div>`,
    actionHrefs: actionList.map((action) => action.href),
    changeCount: vm.manifest.changes.length,
    evidenceCount: vm.evidence_refs.length,
    cuuState: vm.status === "merged" ? "celebrating" : "carrying_document"
  };
}
