import type {
  ActionSpec,
  ApprovalCenterVM,
  AttentionAction,
  AttentionItem,
  CuuState,
  DeliverableChangeManifest,
  DeliverableCheck,
  DeliverableChange,
  EvidenceRef,
  GoldPathSurfaceVM,
  QuestionCard,
  ReplayTraceVM
} from "@workhub/contracts";
import { goldPathT, normalizeWorkHubLocale, type GoldPathCopyKey, type WorkHubLocale } from "./i18n.js";

export type GoldPathRenderSurface = "web" | "desktop";
export type GoldPathRenderOptions = {
  locale?: WorkHubLocale | undefined;
};

export type GoldPathRenderedPage = {
  key: "home" | "intake" | "approvals" | "workitem" | "proposal" | "replay" | "cost" | "settings";
  route: string;
  title: string;
  html: string;
  primaryHrefs: string[];
  cuuState: CuuState;
};

export type GoldPathRenderedSurface = {
  surface: GoldPathRenderSurface;
  fixtureId: string;
  css: string;
  pages: GoldPathRenderedPage[];
};

export const goldPathCss = [
  ":root{color-scheme:light;--ink:#182033;--muted:#5e6a86;--line:#dfe5f1;--paper:#fff;--soft:#f5f8fc;--blue:#355cff;--green:#24a66a;--coral:#ee6b5f;--amber:#d98b16;--violet:#7863e6}",
  ".wh-shell{font-family:\"Aptos\",\"Segoe UI\",sans-serif;color:var(--ink);background:linear-gradient(180deg,#f8fbff 0%,#eef4fb 100%);padding:24px;min-height:100%;box-sizing:border-box}",
  ".wh-stage{max-width:1040px;margin:0 auto;display:grid;grid-template-columns:minmax(0,1fr);gap:20px;align-items:start}",
  ".wh-panel{background:rgba(255,255,255,.9);border:1px solid var(--line);border-radius:8px;box-shadow:0 18px 50px rgba(37,51,79,.08)}",
  ".wh-main{padding:24px}.wh-side{padding:18px;position:sticky;top:16px}.wh-kicker{font-size:12px;color:var(--blue);font-weight:700;text-transform:uppercase;letter-spacing:0}",
  ".wh-title{font-size:30px;line-height:1.12;margin:8px 0 8px}.wh-subtle{color:var(--muted);line-height:1.55}.wh-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:14px;margin-top:18px}",
  ".wh-card{border:1px solid var(--line);background:var(--paper);border-radius:8px;padding:16px}.wh-card[data-recommended=true]{border-color:var(--blue);box-shadow:0 0 0 1px rgba(53,92,255,.2)}",
  ".wh-row{display:flex;justify-content:space-between;gap:12px;border-top:1px solid var(--line);padding:12px 0}.wh-row:first-child{border-top:0}.wh-pill{display:inline-flex;align-items:center;gap:6px;border-radius:999px;background:var(--soft);padding:5px 9px;font-size:12px;color:var(--muted)}",
  ".wh-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;border-radius:8px;border:1px solid var(--line);padding:9px 12px;color:var(--ink);text-decoration:none;background:#fff;font-weight:650}.wh-btn-primary{background:var(--blue);color:#fff;border-color:var(--blue)}.wh-btn-danger{background:#fff4f3;color:#a94137;border-color:#f3c5c0}",
  ".wh-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:16px}.wh-list{display:grid;gap:10px;margin-top:14px}.wh-check{display:grid;gap:4px;border-left:3px solid var(--green);padding-left:10px}.wh-warning{border-left-color:var(--amber)}",
  ".wh-progress{height:8px;border-radius:999px;background:#e7ecf6;overflow:hidden}.wh-progress>span{display:block;height:100%;background:var(--blue)}",
  ".wh-desktop .wh-stage{max-width:1040px;grid-template-columns:1fr}.wh-desktop .wh-shell{background:linear-gradient(135deg,#edf6ff,#f8fbff)}",
  "@media (max-width:860px){.wh-stage{grid-template-columns:1fr}.wh-side{position:static}.wh-title{font-size:24px}}"
].join("");

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;");
}

function href(value: string) {
  return escapeHtml(value);
}

function t(locale: WorkHubLocale, key: GoldPathCopyKey) {
  return goldPathT(locale, key);
}

function evidenceList(evidenceRefs: EvidenceRef[], locale: WorkHubLocale) {
  if (evidenceRefs.length === 0) {
    return `<p class="wh-subtle">${escapeHtml(t(locale, "empty.evidence"))}</p>`;
  }
  return `<div class="wh-list">${evidenceRefs
    .map(
      (ref) =>
        `<article class="wh-card"><strong>${escapeHtml(ref.title)}</strong><p class="wh-subtle">${escapeHtml(ref.excerpt ?? ref.source_id)}</p><span class="wh-pill">${escapeHtml(ref.source_type)}</span></article>`
    )
    .join("")}</div>`;
}

function actionHref(action: AttentionAction | ActionSpec) {
  return action.href;
}

function actions(actions: (AttentionAction | ActionSpec)[]) {
  return `<div class="wh-actions">${actions
    .map((action, index) => {
      const style =
        "style" in action && action.style === "danger"
          ? "wh-btn wh-btn-danger"
          : index === 0
            ? "wh-btn wh-btn-primary"
            : "wh-btn";
      const reason = action.requires_reason ? " data-requires-reason=\"true\"" : "";
      const method = "method" in action ? ` data-method="${escapeHtml(action.method)}"` : "";
      return `<a class="${style}" href="${href(actionHref(action))}" data-action-id="${escapeHtml(action.id)}"${reason}${method}>${escapeHtml(action.label)}</a>`;
    })
    .join("")}</div>`;
}

function pageShell(surface: GoldPathRenderSurface, title: string, main: string) {
  const surfaceClass = surface === "desktop" ? "wh-desktop" : "wh-web";
  return `<div class="${surfaceClass}"><main class="wh-shell"><div class="wh-stage"><section class="wh-panel wh-main">${main}</section></div></main></div>`;
}

function renderHome(surface: GoldPathRenderSurface, vm: GoldPathSurfaceVM, locale: WorkHubLocale): GoldPathRenderedPage {
  const page = vm.page_vms.attention;
  const primary = page.primary;
  const runs = page.background_runs;
  const main = `<span class="wh-kicker">${escapeHtml(t(locale, "home.kicker"))}</span>
    <h1 class="wh-title">${escapeHtml(primary?.title ?? t(locale, "home.emptyTitle"))}</h1>
    <p class="wh-subtle">${escapeHtml(primary?.summary_text ?? t(locale, "home.emptySummary"))}</p>
    ${primary ? actions(primary.actions) : ""}
    <div class="wh-grid">
      <article class="wh-card"><strong>${escapeHtml(t(locale, "home.decisionTitle"))}</strong><p class="wh-subtle">${escapeHtml(primary ? primary.reason_text ?? primary.summary_text : t(locale, "home.decisionEmpty"))}</p></article>
      <article class="wh-card"><strong>${escapeHtml(t(locale, "home.aiWorkingTitle"))}</strong><p class="wh-subtle">${escapeHtml(runs[0]?.preview_text ?? t(locale, "home.aiWorkingEmpty"))}</p></article>
      <article class="wh-card"><strong>${escapeHtml(t(locale, "home.entryTitle"))}</strong><p class="wh-subtle">${escapeHtml(t(locale, "home.entryText"))}</p></article>
    </div>`;
  return {
    key: "home",
    route: vm.routes.home,
    title: "AI-first Home",
    html: pageShell(surface, "AI-first Home", main),
    primaryHrefs: primary?.actions.map((action) => action.href) ?? [],
    cuuState: page.cuu_state
  };
}

function renderIntake(surface: GoldPathRenderSurface, vm: GoldPathSurfaceVM, locale: WorkHubLocale): GoldPathRenderedPage {
  const question: QuestionCard = vm.page_vms.question;
  const optionCards = question.options
    .map((option) => {
      const recommended = question.recommended_option_ids?.includes(option.id) ?? false;
      return `<button class="wh-card" data-option-id="${escapeHtml(option.id)}" data-recommended="${recommended}" type="button">
        <strong>${escapeHtml(option.label)}</strong>
        <p class="wh-subtle">${escapeHtml(option.description ?? option.impact ?? "")}</p>
        ${recommended ? `<span class="wh-pill">${escapeHtml(t(locale, "intake.recommended"))}</span>` : ""}
      </button>`;
    })
    .join("");
  const done = question.progress.filter((item) => item.state === "done").length;
  const progress = Math.round((done / Math.max(question.progress.length, 1)) * 100);
  const main = `<span class="wh-kicker">${escapeHtml(t(locale, "intake.kicker"))}</span>
    <h1 class="wh-title">${escapeHtml(question.title)}</h1>
    <p class="wh-subtle">${escapeHtml(question.body ?? t(locale, "intake.bodyFallback"))}</p>
    <div class="wh-progress" aria-label="${escapeHtml(t(locale, "intake.progressLabel"))}"><span style="width:${progress}%"></span></div>
    <div class="wh-grid">${optionCards}</div>
    <details class="wh-card" ${question.free_text.collapsed_by_default ? "" : "open"}>
      <summary>${escapeHtml(t(locale, "intake.otherSummary"))}</summary>
      <p class="wh-subtle">${escapeHtml(question.free_text.placeholder ?? t(locale, "intake.freeTextFallback"))}</p>
    </details>
    <div class="wh-actions"><a class="wh-btn wh-btn-primary" href="${href(question.submit.href)}">${escapeHtml(t(locale, "intake.continue"))}</a></div>`;
  return {
    key: "intake",
    route: vm.routes.intake,
    title: "Option Intake",
    html: pageShell(surface, "Option Intake", main),
    primaryHrefs: [question.submit.href],
    cuuState: "asking_approval"
  };
}

function renderApprovals(surface: GoldPathRenderSurface, vm: GoldPathSurfaceVM, locale: WorkHubLocale): GoldPathRenderedPage {
  const approvals: ApprovalCenterVM = vm.page_vms.approvals;
  const primary = approvals.items[0];
  const request = approvals.requests[0];
  const requestRows = approvals.requests
    .map(
      (item) =>
        `<div class="wh-row"><div><strong>${escapeHtml(item.action_pattern)}</strong><p class="wh-subtle">${escapeHtml(item.status)}${item.sla_due_at ? ` · SLA ${escapeHtml(item.sla_due_at)}` : ""}</p></div><span class="wh-pill">${escapeHtml(item.routed_to_user_id ?? t(locale, "approvals.unrouted"))}</span></div>`
    )
    .join("");
  const queueCards = approvals.items
    .map(
      (item) =>
        `<article class="wh-card"><span class="wh-pill">${escapeHtml(item.priority)}</span><h3>${escapeHtml(item.title)}</h3><p class="wh-subtle">${escapeHtml(item.summary_text)}</p>${actions(item.actions)}</article>`
    )
    .join("");
  const main = `<span class="wh-kicker">${escapeHtml(t(locale, "approvals.kicker"))}</span>
    <h1 class="wh-title">${escapeHtml(primary?.title ?? t(locale, "approvals.emptyTitle"))}</h1>
    <p class="wh-subtle">${escapeHtml(primary?.reason_text ?? t(locale, "approvals.reasonFallback"))}</p>
    <div class="wh-grid">
      <article class="wh-card"><strong>${escapeHtml(t(locale, "approvals.pendingTitle"))}</strong><p class="wh-subtle">${approvals.counts.pending ?? approvals.items.length}${escapeHtml(t(locale, "approvals.pendingUnit"))}</p></article>
      <article class="wh-card"><strong>${escapeHtml(t(locale, "approvals.slaTitle"))}</strong><p class="wh-subtle">${escapeHtml(request?.sla_due_at ?? t(locale, "approvals.slaEmpty"))}</p></article>
      <article class="wh-card"><strong>${escapeHtml(t(locale, "approvals.ruleTitle"))}</strong><p class="wh-subtle">${escapeHtml(t(locale, "approvals.ruleText"))}</p></article>
    </div>
    <div class="wh-list">${queueCards}</div>
    <h2>${escapeHtml(t(locale, "approvals.factsTitle"))}</h2><div class="wh-card">${requestRows}</div>`;
  return {
    key: "approvals",
    route: vm.routes.approvals,
    title: "Approval Center",
    html: pageShell(surface, "Approval Center", main),
    primaryHrefs: primary?.actions.map((action) => action.href) ?? [],
    cuuState: "asking_approval"
  };
}

function renderWorkItem(surface: GoldPathRenderSurface, vm: GoldPathSurfaceVM, locale: WorkHubLocale): GoldPathRenderedPage {
  const detail = vm.page_vms.workitem;
  const steps = detail.agent_trace_preview
    .map((step) => `<div class="wh-row"><span>${escapeHtml(step.output_excerpt ?? step.phase)}</span><span class="wh-pill">#${step.step_no}</span></div>`)
    .join("");
  const main = `<span class="wh-kicker">${escapeHtml(t(locale, "workitem.kicker"))}</span>
    <h1 class="wh-title">${escapeHtml(detail.workitem.title ?? detail.workitem.code)}</h1>
    <p class="wh-subtle">${escapeHtml(detail.workitem.summary_md ?? detail.workitem.raw_description ?? "")}</p>
    <div class="wh-grid">
      <article class="wh-card"><strong>${escapeHtml(t(locale, "workitem.statusTitle"))}</strong><p class="wh-subtle">${escapeHtml(detail.workitem.status)}</p></article>
      <article class="wh-card"><strong>${escapeHtml(t(locale, "workitem.deliverableTitle"))}</strong><p class="wh-subtle">${escapeHtml(detail.latest_proposal?.title ?? t(locale, "workitem.emptyDeliverable"))}</p></article>
    </div>
    <h2>${escapeHtml(t(locale, "workitem.traceTitle"))}</h2><div class="wh-card">${steps}</div>
    <div class="wh-actions"><a class="wh-btn wh-btn-primary" href="${href(vm.routes.proposal)}">${escapeHtml(t(locale, "workitem.openProposal"))}</a><a class="wh-btn" href="${href(vm.routes.replay)}">${escapeHtml(t(locale, "workitem.openReplay"))}</a></div>`;
  return {
    key: "workitem",
    route: vm.routes.workitem,
    title: "WorkItem Detail",
    html: pageShell(surface, "WorkItem Detail", main),
    primaryHrefs: [vm.routes.proposal, vm.routes.replay],
    cuuState: "thinking"
  };
}

function changeRow(change: DeliverableChange) {
  return `<div class="wh-row"><div><strong>${escapeHtml(change.human_summary)}</strong><p class="wh-subtle">${escapeHtml(change.target_ref.path ?? change.target_kind)}</p></div><span class="wh-pill">${escapeHtml(change.target_kind)}</span></div>`;
}

function checkRow(check: DeliverableCheck) {
  const className = check.status === "warning" ? "wh-check wh-warning" : "wh-check";
  return `<div class="${className}"><strong>${escapeHtml(check.label)}</strong><span class="wh-subtle">${escapeHtml(check.status)}${check.detail ? ` · ${escapeHtml(check.detail)}` : ""}</span></div>`;
}

function renderProposal(surface: GoldPathRenderSurface, vm: GoldPathSurfaceVM, locale: WorkHubLocale): GoldPathRenderedPage {
  const proposal = vm.page_vms.proposal;
  const manifest: DeliverableChangeManifest = proposal.manifest;
  const proposalActions = [
    proposal.review_actions.approve,
    proposal.review_actions.request_changes,
    ...(proposal.review_actions.merge ? [proposal.review_actions.merge] : [])
  ];
  const main = `<span class="wh-kicker">${escapeHtml(t(locale, "proposal.kicker"))}</span>
    <h1 class="wh-title">${escapeHtml(proposal.title)}</h1>
    <p class="wh-subtle">${escapeHtml(manifest.summary_md.replace(/[#*_`-]/gu, " ").slice(0, 220))}</p>
    <div class="wh-grid">
      <article class="wh-card"><strong>${escapeHtml(t(locale, "proposal.riskTitle"))}</strong><p class="wh-subtle">${escapeHtml(manifest.risk.human_label)}</p></article>
      <article class="wh-card"><strong>${escapeHtml(t(locale, "proposal.rollbackTitle"))}</strong><p class="wh-subtle">${escapeHtml(manifest.rollback.description)}</p></article>
      <article class="wh-card"><strong>${escapeHtml(t(locale, "proposal.evidenceTitle"))}</strong><p class="wh-subtle">${manifest.evidence_refs.length}${escapeHtml(t(locale, "proposal.evidenceUnit"))}</p></article>
    </div>
    <h2>${escapeHtml(t(locale, "proposal.changedTitle"))}</h2><div class="wh-card">${manifest.changes.map(changeRow).join("")}</div>
    <h2>${escapeHtml(t(locale, "proposal.checksTitle"))}</h2><div class="wh-list">${manifest.checks.map(checkRow).join("")}</div>
    ${actions(proposalActions)}`;
  return {
    key: "proposal",
    route: vm.routes.proposal,
    title: "Proposal Detail",
    html: pageShell(surface, "Proposal Detail", main),
    primaryHrefs: proposalActions.map((action) => action.href),
    cuuState: "carrying_document"
  };
}

function renderReplay(surface: GoldPathRenderSurface, vm: GoldPathSurfaceVM, locale: WorkHubLocale): GoldPathRenderedPage {
  const replay: ReplayTraceVM = vm.page_vms.replay;
  const steps = replay.steps
    .map((step) => `<div class="wh-row"><div><strong>${escapeHtml(step.phase)}</strong><p class="wh-subtle">${escapeHtml(step.output_excerpt ?? step.tool_name ?? t(locale, "replay.stepFallback"))}</p></div><span class="wh-pill">#${step.step_no}</span></div>`)
    .join("");
  const acceptedDeliverables = replay.accepted_deliverables ?? [];
  const deliverableHrefs = acceptedDeliverables
    .flatMap((item) => [item.preview_href, item.download_href])
    .filter((item): item is string => Boolean(item));
  const deliverableCards = acceptedDeliverables
    .map((item) => {
      const actionsHtml = [
        item.preview_href
          ? `<a class="wh-btn" href="${href(item.preview_href)}">${escapeHtml(t(locale, "replay.previewDeliverable"))}</a>`
          : "",
        item.download_href
          ? `<a class="wh-btn wh-btn-primary" href="${href(item.download_href)}">${escapeHtml(t(locale, "replay.openDeliverable"))}</a>`
          : ""
      ].filter(Boolean).join("");
      return `<article class="wh-card"><strong>${escapeHtml(item.filename ?? item.target_key)}</strong><p class="wh-subtle">${escapeHtml(item.target_path ?? item.target_key)}</p>${actionsHtml ? `<div class="wh-actions">${actionsHtml}</div>` : ""}</article>`;
    })
    .join("");
  const main = `<span class="wh-kicker">${escapeHtml(t(locale, "replay.kicker"))}</span>
    <h1 class="wh-title">${escapeHtml(t(locale, "replay.title"))}</h1>
    <p class="wh-subtle">${escapeHtml(replay.run.handoff_md ?? replay.run.outcome_reason ?? t(locale, "replay.empty"))}</p>
    <div class="wh-card">${steps}</div>
    <div class="wh-grid">
      <article class="wh-card"><strong>${escapeHtml(t(locale, "replay.tokenTitle"))}</strong><p class="wh-subtle">${replay.cost?.me.total_tokens ?? 0}</p></article>
      <article class="wh-card"><strong>${escapeHtml(t(locale, "replay.costTitle"))}</strong><p class="wh-subtle">¥${escapeHtml(replay.cost?.me.estimated_cost_cny ?? "0")}</p></article>
      <article class="wh-card"><strong>${escapeHtml(t(locale, "replay.snapshotTitle"))}</strong><p class="wh-subtle">${replay.snapshots.length}${escapeHtml(t(locale, "replay.snapshotUnit"))}</p></article>
      <article class="wh-card"><strong>${escapeHtml(t(locale, "replay.deliverableTitle"))}</strong><p class="wh-subtle">${acceptedDeliverables.length}${escapeHtml(t(locale, "replay.deliverableUnit"))}</p></article>
    </div>
    ${deliverableCards ? `<h2>${escapeHtml(t(locale, "replay.deliverableTitle"))}</h2><div class="wh-list">${deliverableCards}</div>` : ""}`;
  return {
    key: "replay",
    route: vm.routes.replay,
    title: "Replay Work",
    html: pageShell(surface, "Replay Work", main),
    primaryHrefs: deliverableHrefs,
    cuuState: "thinking"
  };
}

function renderCost(surface: GoldPathRenderSurface, vm: GoldPathSurfaceVM, locale: WorkHubLocale): GoldPathRenderedPage {
  const cost = vm.page_vms.cost;
  const noticeCards = cost.notices.map((notice) => `<article class="wh-card"><strong>${escapeHtml(notice.severity)}</strong><p class="wh-subtle">${escapeHtml(notice.message)}</p></article>`).join("");
  const nearestRisk = cost.top_exhaustion_risks[0];
  const main = `<span class="wh-kicker">${escapeHtml(t(locale, "cost.kicker"))}</span>
    <h1 class="wh-title">${escapeHtml(t(locale, "cost.title"))}</h1>
    <p class="wh-subtle">${escapeHtml(t(locale, "cost.summary"))}</p>
    <div class="wh-grid">
      <article class="wh-card"><strong>${escapeHtml(t(locale, "cost.tokenTitle"))}</strong><p class="wh-subtle">${cost.token_in + cost.token_out}</p></article>
      <article class="wh-card"><strong>${escapeHtml(t(locale, "cost.estimatedTitle"))}</strong><p class="wh-subtle">¥${escapeHtml(cost.total_cost_cny)}</p></article>
      <article class="wh-card"><strong>${escapeHtml(t(locale, "cost.statusTitle"))}</strong><p class="wh-subtle">${escapeHtml(nearestRisk?.status ?? cost.empty_state ?? t(locale, "cost.statusFallback"))}</p></article>
    </div>
    <div class="wh-list">${noticeCards}</div>`;
  return {
    key: "cost",
    route: vm.routes.cost,
    title: "Cost Dashboard",
    html: pageShell(surface, "Cost Dashboard", main),
    primaryHrefs: [],
    cuuState: "worried"
  };
}

function renderSettings(surface: GoldPathRenderSurface, locale: WorkHubLocale): GoldPathRenderedPage {
  const main = `<span class="wh-kicker">${escapeHtml(t(locale, "settings.kicker"))}</span>
    <h1 class="wh-title">${escapeHtml(t(locale, "settings.title"))}</h1>
    <p class="wh-subtle">${escapeHtml(t(locale, "settings.summary"))}</p>
    <div class="wh-grid">
      <article class="wh-card"><strong>${escapeHtml(t(locale, "settings.runtimeTitle"))}</strong><p class="wh-subtle">${escapeHtml(t(locale, "settings.runtimeBody"))}</p></article>
      <article class="wh-card"><strong>${escapeHtml(t(locale, "settings.desktopTitle"))}</strong><p class="wh-subtle">${escapeHtml(t(locale, "settings.desktopBody"))}</p></article>
      <article class="wh-card"><strong>${escapeHtml(t(locale, "settings.costTitle"))}</strong><p class="wh-subtle">${escapeHtml(t(locale, "settings.costBody"))}</p></article>
      <article class="wh-card"><strong>${escapeHtml(t(locale, "settings.languageTitle"))}</strong><p class="wh-subtle">${escapeHtml(t(locale, "settings.languageBody"))}</p></article>
    </div>`;
  return {
    key: "settings",
    route: "/settings",
    title: "Settings",
    html: pageShell(surface, "Settings", main),
    primaryHrefs: [],
    cuuState: "idle"
  };
}

export function renderGoldPathSurface(
  vm: GoldPathSurfaceVM,
  surface: GoldPathRenderSurface,
  options: GoldPathRenderOptions = {}
): GoldPathRenderedSurface {
  const locale = normalizeWorkHubLocale(options.locale);
  return {
    surface,
    fixtureId: vm.fixture_id,
    css: goldPathCss,
    pages: [
      renderHome(surface, vm, locale),
      renderIntake(surface, vm, locale),
      renderApprovals(surface, vm, locale),
      renderWorkItem(surface, vm, locale),
      renderProposal(surface, vm, locale),
      renderReplay(surface, vm, locale),
      renderCost(surface, vm, locale),
      renderSettings(surface, locale)
    ]
  };
}
