import type {
  ActionSpec,
  CuuState,
  DeliverableChange,
  DeliverableCheck,
  EvidenceRef,
  ProposalConflict,
  ProposalConflictOption,
  ProposalDetailVM
} from "@workhub/contracts";

import {
  changeTypeLabel,
  checkStatusLabel,
  deliverableTargetLabel,
  evidenceSourceLabel,
  previewKindLabel,
  uiCount,
  uiLocale,
  uiT,
  type UiRenderOptions
} from "../i18n.js";

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
  conflictCount: number;
  cuuState: CuuState;
};

export type ProposalRenderOptions = UiRenderOptions & {
  conflicts?: ProposalConflict[];
};

export type ProposalConflictRenderedCards = {
  html: string;
  actionHrefs: string[];
  conflictCount: number;
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
  ".wh-conflict-list{display:grid;gap:12px;margin:20px 0}.wh-conflict-head{display:grid;gap:4px;border:1px solid #ffd6c8;background:#fff7f3;border-radius:8px;padding:14px}.wh-conflict-head .wh-kicker{color:#b94733}",
  ".wh-conflict-card{border:1px solid #f1d2c8;background:#fffdfb;border-radius:8px;padding:14px;display:grid;gap:10px}.wh-conflict-meta{display:flex;gap:8px;flex-wrap:wrap}.wh-conflict-summary{margin:0;color:var(--muted);line-height:1.5}.wh-conflict-options{display:flex;gap:10px;flex-wrap:wrap}.wh-recommended{font-size:11px;font-weight:800;border-radius:999px;padding:3px 7px;background:#eaf0ff;color:var(--blue)}",
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

function shortFingerprint(value: string | undefined) {
  return value ? value.slice(0, 10) : undefined;
}

function conflictOptionLabel(option: ProposalConflictOption, options?: UiRenderOptions) {
  const locale = uiLocale(options);
  if (option.id === "keep_current") {
    return uiT(locale, "proposal.conflictKeepCurrent");
  }
  if (option.id === "accept_incoming") {
    return uiT(locale, "proposal.conflictAcceptIncoming");
  }
  if (option.id === "ai_fusion") {
    if (option.action?.id === "apply_ai_fusion") {
      return uiT(locale, "proposal.conflictApplyAiFusion");
    }
    return uiT(locale, "proposal.conflictAiFusion");
  }
  return option.label;
}

function conflictOptionClass(option: ProposalConflictOption) {
  if (option.id === "accept_incoming") {
    return "wh-btn wh-btn-danger";
  }
  return option.recommended ? "wh-btn wh-btn-primary" : "wh-btn";
}

function renderConflictOption(option: ProposalConflictOption, options?: UiRenderOptions) {
  const locale = uiLocale(options);
  const recommended = option.recommended
    ? `<span class="wh-recommended">${escapeHtml(uiT(locale, "proposal.conflictRecommended"))}</span>`
    : "";
  if (!option.action?.href) {
    return `<span class="${conflictOptionClass(option)}" data-conflict-option-id="${escapeHtml(option.id)}">${escapeHtml(conflictOptionLabel(option, { locale }))}${recommended}</span>`;
  }
  const requestJson = option.action.request_json
    ? ` data-request-json="${escapeHtml(JSON.stringify(option.action.request_json))}"`
    : "";
  return `<a class="${conflictOptionClass(option)}" href="${escapeHtml(option.action.href)}" data-action-id="${escapeHtml(option.action.id)}" data-conflict-option-id="${escapeHtml(option.id)}" data-method="${escapeHtml(option.action.method)}"${requestJson}>${escapeHtml(conflictOptionLabel(option, { locale }))}${recommended}</a>`;
}

function renderConflict(conflict: ProposalConflict, options?: UiRenderOptions) {
  const locale = uiLocale(options);
  const target = conflict.target_path ?? conflict.target_key;
  const existing = shortFingerprint(conflict.existing.sha256 ?? conflict.existing.ref);
  const incoming = shortFingerprint(conflict.incoming.sha256_after ?? conflict.incoming.ref);
  const meta = [
    `<span class="wh-pill">${escapeHtml(uiT(locale, "proposal.conflictTarget"))}: ${escapeHtml(target)}</span>`,
    existing ? `<span class="wh-pill">${escapeHtml(uiT(locale, "proposal.conflictExisting"))}: ${escapeHtml(existing)}</span>` : "",
    incoming ? `<span class="wh-pill">${escapeHtml(uiT(locale, "proposal.conflictIncoming"))}: ${escapeHtml(incoming)}</span>` : ""
  ].filter(Boolean).join("");

  return `<article class="wh-conflict-card" data-conflict-id="${escapeHtml(conflict.id)}" data-target-key="${escapeHtml(conflict.target_key)}">
    <strong>${escapeHtml(conflict.headline)}</strong>
    <p class="wh-conflict-summary">${escapeHtml(conflict.summary_text)}</p>
    <div class="wh-conflict-meta">${meta}</div>
    <div class="wh-conflict-options">${conflict.options.map((option) => renderConflictOption(option, { locale })).join("")}</div>
  </article>`;
}

export function renderProposalConflictCards(
  conflicts: ProposalConflict[] = [],
  options?: UiRenderOptions
): ProposalConflictRenderedCards {
  const locale = uiLocale(options);
  const actionHrefs = conflicts.flatMap((conflict) =>
    conflict.options.map((option) => option.action?.href).filter((href): href is string => Boolean(href))
  );
  if (conflicts.length === 0) {
    return { html: "", actionHrefs, conflictCount: 0 };
  }
  return {
    conflictCount: conflicts.length,
    actionHrefs,
    html: `<section class="wh-conflict-list" data-proposal-conflicts="${conflicts.length}">
      <div class="wh-conflict-head">
        <span class="wh-kicker">${escapeHtml(uiT(locale, "proposal.conflictTitle"))}</span>
        <p class="wh-subtle">${escapeHtml(uiT(locale, "proposal.conflictBody"))}</p>
      </div>
      ${conflicts.map((conflict) => renderConflict(conflict, { locale })).join("")}
    </section>`
  };
}

function renderChange(change: DeliverableChange, options?: UiRenderOptions) {
  const locale = uiLocale(options);
  const path = change.target_ref.path ?? change.target_ref.entity_id ?? change.target_ref.entity_type;
  const preview = change.preview_ref
    ? `<a class="wh-pill" href="${escapeHtml(change.preview_ref.href)}">${escapeHtml(previewKindLabel(locale, change.preview_ref.kind))}</a>`
    : "";
  return `<div class="wh-row" data-change-kind="${escapeHtml(change.target_kind)}" data-change-type="${escapeHtml(change.change_type)}">
    <div>
      <strong>${escapeHtml(change.human_summary)}</strong>
      <p class="wh-subtle">${escapeHtml(path)}</p>
    </div>
    <div>
      <span class="wh-pill">${escapeHtml(deliverableTargetLabel(locale, change.target_kind))}</span>
      <span class="wh-pill">${escapeHtml(changeTypeLabel(locale, change.change_type))}</span>
      ${preview}
    </div>
  </div>`;
}

function renderCheck(check: DeliverableCheck, options?: UiRenderOptions) {
  const locale = uiLocale(options);
  return `<div class="wh-check" data-status="${escapeHtml(check.status)}">
    <strong>${escapeHtml(check.label)}</strong>
    <span class="wh-subtle">${escapeHtml(checkStatusLabel(locale, check.status))}${check.detail ? ` · ${escapeHtml(check.detail)}` : ""}</span>
  </div>`;
}

function renderEvidence(evidenceRefs: EvidenceRef[], options?: UiRenderOptions) {
  const locale = uiLocale(options);
  if (evidenceRefs.length === 0) {
    return `<p class="wh-subtle">${escapeHtml(uiT(locale, "generic.noEvidence"))}</p>`;
  }
  return evidenceRefs
    .map(
      (ref) =>
        `<article class="wh-card" data-evidence-source="${escapeHtml(ref.source_type)}"><strong>${escapeHtml(ref.title)}</strong><p class="wh-subtle">${escapeHtml(ref.excerpt ?? ref.source_id)}</p>${ref.href ? `<a class="wh-pill" href="${escapeHtml(ref.href)}">${escapeHtml(uiT(locale, "generic.openSource"))}</a>` : `<span class="wh-pill">${escapeHtml(evidenceSourceLabel(locale, ref.source_type))}</span>`}</article>`
    )
    .join("");
}

function renderRail(vm: ProposalDetailVM, options?: UiRenderOptions) {
  const locale = uiLocale(options);
  const manifest = vm.manifest;
  return `<aside class="wh-proposal-rail">
    <span class="wh-kicker">${escapeHtml(uiT(locale, "generic.aiStatus"))}</span>
    <h2>${escapeHtml(vm.status === "merged" ? uiT(locale, "proposal.railComplete") : uiT(locale, "proposal.railCarrying"))}</h2>
    <p class="wh-subtle">${escapeHtml(manifest.risk.human_label)}</p>
    <article class="wh-card">
      <strong>${escapeHtml(uiT(locale, "generic.rollback"))}</strong>
      <p class="wh-subtle">${escapeHtml(manifest.rollback.description)}</p>
      <span class="${manifest.rollback.available ? "wh-pill" : "wh-pill wh-pill-danger"}">${escapeHtml(manifest.rollback.available ? uiT(locale, "proposal.rollbackAvailable") : uiT(locale, "proposal.rollbackUnavailable"))}</span>
    </article>
    <article class="wh-card">
      <strong>${escapeHtml(uiT(locale, "generic.evidence"))}</strong>
      <p class="wh-subtle">${escapeHtml(uiCount(locale, vm.evidence_refs.length, "条来源", "source"))}</p>
    </article>
  </aside>`;
}

export function renderProposalDetail(
  vm: ProposalDetailVM,
  surface: ProposalRenderSurface,
  options?: ProposalRenderOptions
): ProposalRenderedPage {
  const locale = uiLocale(options);
  const conflictCards = renderProposalConflictCards(options?.conflicts ?? [], { locale });
  const actionList = [
    vm.review_actions.approve,
    vm.review_actions.request_changes,
    ...(vm.review_actions.merge ? [vm.review_actions.merge] : [])
  ];
  const rootClass = surface === "desktop" ? "wh-desktop" : "wh-web";
  const summary = stripMarkdown(vm.manifest.summary_md).slice(0, 260);
  const main = `<section class="wh-proposal-main">
    <span class="wh-kicker">${escapeHtml(uiT(locale, "proposal.kicker"))}</span>
    <h1 class="wh-title">${escapeHtml(vm.title)}</h1>
    <p class="wh-subtle">${escapeHtml(summary)}</p>
    <div class="wh-grid">
      <article class="wh-card"><strong>${escapeHtml(uiT(locale, "generic.changes"))}</strong><p class="wh-subtle">${escapeHtml(uiCount(locale, vm.manifest.changes.length, "项文件或对象", "change"))}</p></article>
      <article class="wh-card"><strong>${escapeHtml(uiT(locale, "generic.checks"))}</strong><p class="wh-subtle">${escapeHtml(uiCount(locale, vm.manifest.checks.length, "项检查已记录", "recorded check"))}</p></article>
      <article class="wh-card"><strong>${escapeHtml(uiT(locale, "generic.risk"))}</strong><p class="wh-subtle">${escapeHtml(vm.manifest.risk.human_label)}</p></article>
    </div>
    <h2>${escapeHtml(uiT(locale, "proposal.changeSummary"))}</h2>
    <div class="wh-card">${vm.manifest.changes.map((change) => renderChange(change, { locale })).join("")}</div>
    <h2>${escapeHtml(uiT(locale, "proposal.checkResults"))}</h2>
    <div class="wh-grid">${vm.manifest.checks.map((check) => renderCheck(check, { locale })).join("")}</div>
    <h2>${escapeHtml(uiT(locale, "generic.evidence"))}</h2>
    <div class="wh-grid">${renderEvidence(vm.evidence_refs, { locale })}</div>
    ${vm.comments.length > 0 ? `<h2>${escapeHtml(uiT(locale, "proposal.comments"))}</h2><div class="wh-card">${vm.comments.map((comment) => `<div class="wh-row"><strong>${escapeHtml(comment.author_label)}</strong><p class="wh-subtle">${escapeHtml(comment.body)}</p></div>`).join("")}</div>` : ""}
    ${conflictCards.html}
    ${renderActions(actionList)}
  </section>`;

  return {
    surface,
    proposalId: vm.proposal_id,
    workItemId: vm.work_item_id,
    title: vm.title,
    css: proposalCss,
    html: `<div class="${rootClass}"><main class="wh-proposal"><div class="wh-proposal-frame">${main}${renderRail(vm, { locale })}</div></main></div>`,
    actionHrefs: [...actionList.map((action) => action.href), ...conflictCards.actionHrefs],
    changeCount: vm.manifest.changes.length,
    evidenceCount: vm.evidence_refs.length,
    conflictCount: conflictCards.conflictCount,
    cuuState: vm.status === "merged" ? "celebrating" : "carrying_document"
  };
}
