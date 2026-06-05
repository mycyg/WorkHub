import type {
  ActionSpec,
  ApprovalCenterVM,
  AttentionAction,
  AttentionItem,
  BudgetNotice,
  CuuState,
  DeliverableChangeManifest,
  DeliverableCheck,
  DeliverableChange,
  EvidenceRef,
  GoldPathSurfaceVM,
  QuestionCard,
  ReplayTraceVM
} from "@workhub/contracts";

export type GoldPathRenderSurface = "web" | "desktop";

export type GoldPathRenderedPage = {
  key: "home" | "intake" | "approvals" | "workitem" | "proposal" | "replay" | "cost";
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

const stateCopy: Record<CuuState, string> = {
  idle: "待命",
  thinking: "整理中",
  asking_approval: "等你点一下",
  carrying_document: "带着交付物",
  searching_evidence: "找证据",
  syncing_files: "同步中",
  worried: "需要留意",
  revision_requested: "继续修改",
  celebrating: "完成啦",
  offline: "离线"
};

export const goldPathCss = [
  ":root{color-scheme:light;--ink:#182033;--muted:#5e6a86;--line:#dfe5f1;--paper:#fff;--soft:#f5f8fc;--blue:#355cff;--green:#24a66a;--coral:#ee6b5f;--amber:#d98b16;--violet:#7863e6}",
  ".wh-shell{font-family:\"Aptos\",\"Segoe UI\",sans-serif;color:var(--ink);background:linear-gradient(180deg,#f8fbff 0%,#eef4fb 100%);padding:24px;min-height:100%;box-sizing:border-box}",
  ".wh-stage{max-width:1180px;margin:0 auto;display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:20px;align-items:start}",
  ".wh-panel{background:rgba(255,255,255,.9);border:1px solid var(--line);border-radius:8px;box-shadow:0 18px 50px rgba(37,51,79,.08)}",
  ".wh-main{padding:24px}.wh-side{padding:18px;position:sticky;top:16px}.wh-kicker{font-size:12px;color:var(--blue);font-weight:700;text-transform:uppercase;letter-spacing:0}",
  ".wh-title{font-size:30px;line-height:1.12;margin:8px 0 8px}.wh-subtle{color:var(--muted);line-height:1.55}.wh-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:14px;margin-top:18px}",
  ".wh-card{border:1px solid var(--line);background:var(--paper);border-radius:8px;padding:16px}.wh-card[data-recommended=true]{border-color:var(--blue);box-shadow:0 0 0 1px rgba(53,92,255,.2)}",
  ".wh-row{display:flex;justify-content:space-between;gap:12px;border-top:1px solid var(--line);padding:12px 0}.wh-row:first-child{border-top:0}.wh-pill{display:inline-flex;align-items:center;gap:6px;border-radius:999px;background:var(--soft);padding:5px 9px;font-size:12px;color:var(--muted)}",
  ".wh-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;border-radius:8px;border:1px solid var(--line);padding:9px 12px;color:var(--ink);text-decoration:none;background:#fff;font-weight:650}.wh-btn-primary{background:var(--blue);color:#fff;border-color:var(--blue)}.wh-btn-danger{background:#fff4f3;color:#a94137;border-color:#f3c5c0}",
  ".wh-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:16px}.wh-list{display:grid;gap:10px;margin-top:14px}.wh-check{display:grid;gap:4px;border-left:3px solid var(--green);padding-left:10px}.wh-warning{border-left-color:var(--amber)}",
  ".wh-cuu{display:grid;gap:14px;text-align:left}.wh-cuu-name{font-weight:800}.wh-cuu-figure{width:118px;height:108px;position:relative;display:grid;place-items:center;isolation:isolate}.wh-cuu-cat{position:relative;width:92px;height:88px;animation:wh-cuu-breathe 2.8s ease-in-out infinite;transform-origin:50% 100%}.wh-cuu-head{position:absolute;left:15px;top:10px;width:62px;height:58px;border-radius:48% 48% 44% 44%;background:linear-gradient(145deg,#ffb65e,#ee842f 72%);box-shadow:inset -8px -10px 0 rgba(166,82,30,.12),0 10px 24px rgba(194,103,36,.2);z-index:2}.wh-cuu-ear{position:absolute;top:0;width:25px;height:28px;background:#ef8732;clip-path:polygon(50% 0,100% 100%,0 100%);z-index:1}.wh-cuu-ear-left{left:17px;transform:rotate(-14deg)}.wh-cuu-ear-right{right:17px;transform:rotate(14deg)}.wh-cuu-ear:after{content:\"\";position:absolute;left:7px;top:9px;width:11px;height:13px;background:#ffd2bd;clip-path:polygon(50% 0,100% 100%,0 100%)}.wh-cuu-eye{position:absolute;top:23px;width:12px;height:15px;border-radius:50%;background:#1c2030;box-shadow:inset 3px 3px 0 rgba(255,255,255,.8)}.wh-cuu-eye-left{left:18px}.wh-cuu-eye-right{right:18px}.wh-cuu-muzzle{position:absolute;left:20px;top:37px;width:22px;height:15px;border-radius:50%;background:#ffe5c7}.wh-cuu-nose{position:absolute;left:28px;top:38px;width:7px;height:5px;border-radius:50%;background:#d6635e}.wh-cuu-body{position:absolute;left:20px;top:51px;width:58px;height:44px;border-radius:50% 50% 44% 44%;background:linear-gradient(140deg,#f6a34b,#dc7930);box-shadow:inset -8px -8px 0 rgba(143,72,26,.1)}.wh-cuu-tail{position:absolute;right:2px;top:52px;width:34px;height:42px;border:9px solid #e88734;border-left:0;border-bottom:0;border-radius:0 90% 0 0;transform:rotate(16deg);animation:wh-cuu-tail 2.4s ease-in-out infinite}.wh-cuu-collar{position:absolute;left:18px;top:63px;width:56px;height:13px;border-radius:999px;background:linear-gradient(90deg,#fff7f4,#f2dfd7);border:1px solid rgba(199,157,143,.55);z-index:3}.wh-cuu-bow{position:absolute;left:35px;top:65px;width:22px;height:13px;z-index:4}.wh-cuu-bow:before,.wh-cuu-bow:after{content:\"\";position:absolute;top:1px;width:11px;height:11px;background:#202436;border-radius:45% 10% 45% 10%}.wh-cuu-bow:before{left:0;transform:rotate(24deg)}.wh-cuu-bow:after{right:0;transform:scaleX(-1) rotate(24deg)}.wh-cuu-stripe{position:absolute;top:14px;width:4px;height:15px;border-radius:999px;background:rgba(153,76,31,.28);z-index:3}.wh-cuu-stripe-one{left:27px;transform:rotate(-16deg)}.wh-cuu-stripe-two{left:38px}.wh-cuu-stripe-three{right:27px;transform:rotate(16deg)}.wh-cuu-shadow{position:absolute;left:23px;right:23px;bottom:5px;height:12px;border-radius:50%;background:rgba(84,55,36,.14);filter:blur(2px);z-index:-1}.wh-cuu-figure[data-cuu-state=thinking] .wh-cuu-cat,.wh-cuu-figure[data-cuu-state=searching_evidence] .wh-cuu-cat{animation:wh-cuu-think 1.5s ease-in-out infinite}.wh-cuu-figure[data-cuu-state=asking_approval] .wh-cuu-cat,.wh-cuu-figure[data-cuu-state=carrying_document] .wh-cuu-cat{animation:wh-cuu-hop 1.8s ease-in-out infinite}.wh-cuu-figure[data-cuu-state=celebrating] .wh-cuu-cat{animation:wh-cuu-celebrate 1.1s ease-in-out infinite}.wh-cuu-figure[data-cuu-state=worried] .wh-cuu-cat{animation:wh-cuu-worry .9s ease-in-out infinite}.wh-progress{height:8px;border-radius:999px;background:#e7ecf6;overflow:hidden}.wh-progress>span{display:block;height:100%;background:var(--blue)}",
  "@keyframes wh-cuu-breathe{0%,100%{transform:translateY(0) scale(1)}50%{transform:translateY(-2px) scale(1.015)}}@keyframes wh-cuu-tail{0%,100%{transform:rotate(16deg)}50%{transform:rotate(28deg)}}@keyframes wh-cuu-hop{0%,100%{transform:translateY(0)}40%{transform:translateY(-5px)}}@keyframes wh-cuu-think{0%,100%{transform:rotate(0deg) translateY(0)}50%{transform:rotate(-3deg) translateY(-3px)}}@keyframes wh-cuu-celebrate{0%,100%{transform:translateY(0) rotate(0deg)}35%{transform:translateY(-7px) rotate(-5deg)}70%{transform:translateY(-3px) rotate(5deg)}}@keyframes wh-cuu-worry{0%,100%{transform:translateX(0)}50%{transform:translateX(2px)}}",
  ".wh-desktop .wh-stage{max-width:1040px;grid-template-columns:1fr 260px}.wh-desktop .wh-shell{background:linear-gradient(135deg,#edf6ff,#f8fbff)}",
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

function evidenceList(evidenceRefs: EvidenceRef[]) {
  if (evidenceRefs.length === 0) {
    return '<p class="wh-subtle">没有找到可展示的证据。</p>';
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

function cuuRail(input: {
  state: CuuState;
  evidenceRefs?: EvidenceRef[] | undefined;
  notices?: BudgetNotice[] | undefined;
}) {
  const notice = input.notices?.[0];
  return `<aside class="wh-panel wh-side wh-cuu">
    <div class="wh-cuu-figure" data-cuu-state="${escapeHtml(input.state)}" aria-hidden="true">
      <div class="wh-cuu-cat">
        <span class="wh-cuu-tail"></span>
        <span class="wh-cuu-ear wh-cuu-ear-left"></span>
        <span class="wh-cuu-ear wh-cuu-ear-right"></span>
        <span class="wh-cuu-body"></span>
        <span class="wh-cuu-head">
          <span class="wh-cuu-stripe wh-cuu-stripe-one"></span>
          <span class="wh-cuu-stripe wh-cuu-stripe-two"></span>
          <span class="wh-cuu-stripe wh-cuu-stripe-three"></span>
          <span class="wh-cuu-eye wh-cuu-eye-left"></span>
          <span class="wh-cuu-eye wh-cuu-eye-right"></span>
          <span class="wh-cuu-muzzle"></span>
          <span class="wh-cuu-nose"></span>
        </span>
        <span class="wh-cuu-collar"></span>
        <span class="wh-cuu-bow"></span>
      </div>
      <span class="wh-cuu-shadow"></span>
    </div>
    <div>
      <div class="wh-cuu-name">Cuu · ${escapeHtml(stateCopy[input.state])}</div>
      <p class="wh-subtle">我会把复杂内容收成一件事、几个选项和能追溯的证据。</p>
    </div>
    ${notice ? `<div class="wh-card"><strong>预算提醒</strong><p class="wh-subtle">${escapeHtml(notice.message)}</p></div>` : ""}
    ${
      input.evidenceRefs && input.evidenceRefs.length > 0
        ? `<div><span class="wh-kicker">Evidence</span>${evidenceList(input.evidenceRefs.slice(0, 2))}</div>`
        : ""
    }
  </aside>`;
}

function pageShell(surface: GoldPathRenderSurface, title: string, main: string, rail: string) {
  const surfaceClass = surface === "desktop" ? "wh-desktop" : "wh-web";
  return `<div class="${surfaceClass}"><main class="wh-shell"><div class="wh-stage"><section class="wh-panel wh-main">${main}</section>${rail}</div></main></div>`;
}

function renderHome(surface: GoldPathRenderSurface, vm: GoldPathSurfaceVM): GoldPathRenderedPage {
  const page = vm.page_vms.attention;
  const primary = page.primary;
  const runs = page.background_runs;
  const main = `<span class="wh-kicker">AI-first home</span>
    <h1 class="wh-title">${escapeHtml(primary?.title ?? "现在没有阻塞你的事")}</h1>
    <p class="wh-subtle">${escapeHtml(primary?.summary_text ?? "Cuu 会在需要你判断时把事项递过来。")}</p>
    ${primary ? actions(primary.actions) : ""}
    <div class="wh-grid">
      <article class="wh-card"><strong>需要你决定</strong><p class="wh-subtle">${escapeHtml(primary ? primary.reason_text ?? primary.summary_text : "暂无")}</p></article>
      <article class="wh-card"><strong>AI 正在做</strong><p class="wh-subtle">${escapeHtml(runs[0]?.preview_text ?? "没有后台运行。")}</p></article>
      <article class="wh-card"><strong>当前入口</strong><p class="wh-subtle">看板只是兜底，主路径从这一件事开始。</p></article>
    </div>`;
  return {
    key: "home",
    route: vm.routes.home,
    title: "AI-first Home",
    html: pageShell(surface, "AI-first Home", main, cuuRail({ state: page.cuu_state, evidenceRefs: primary?.evidence_refs })),
    primaryHrefs: primary?.actions.map((action) => action.href) ?? [],
    cuuState: page.cuu_state
  };
}

function renderIntake(surface: GoldPathRenderSurface, vm: GoldPathSurfaceVM): GoldPathRenderedPage {
  const question: QuestionCard = vm.page_vms.question;
  const optionCards = question.options
    .map((option) => {
      const recommended = question.recommended_option_ids?.includes(option.id) ?? false;
      return `<button class="wh-card" data-option-id="${escapeHtml(option.id)}" data-recommended="${recommended}" type="button">
        <strong>${escapeHtml(option.label)}</strong>
        <p class="wh-subtle">${escapeHtml(option.description ?? option.impact ?? "")}</p>
        ${recommended ? '<span class="wh-pill">Cuu 推荐</span>' : ""}
      </button>`;
    })
    .join("");
  const done = question.progress.filter((item) => item.state === "done").length;
  const progress = Math.round((done / Math.max(question.progress.length, 1)) * 100);
  const main = `<span class="wh-kicker">Option intake</span>
    <h1 class="wh-title">${escapeHtml(question.title)}</h1>
    <p class="wh-subtle">${escapeHtml(question.body ?? "先点一个选项，我再继续。")}</p>
    <div class="wh-progress" aria-label="clarification progress"><span style="width:${progress}%"></span></div>
    <div class="wh-grid">${optionCards}</div>
    <details class="wh-card" ${question.free_text.collapsed_by_default ? "" : "open"}>
      <summary>其他 / 补充</summary>
      <p class="wh-subtle">${escapeHtml(question.free_text.placeholder ?? "需要时再补一句。")}</p>
    </details>
    <div class="wh-actions"><a class="wh-btn wh-btn-primary" href="${href(question.submit.href)}">继续</a></div>`;
  return {
    key: "intake",
    route: vm.routes.intake,
    title: "Option Intake",
    html: pageShell(surface, "Option Intake", main, cuuRail({ state: "asking_approval", evidenceRefs: question.evidence_refs })),
    primaryHrefs: [question.submit.href],
    cuuState: "asking_approval"
  };
}

function renderApprovals(surface: GoldPathRenderSurface, vm: GoldPathSurfaceVM): GoldPathRenderedPage {
  const approvals: ApprovalCenterVM = vm.page_vms.approvals;
  const primary = approvals.items[0];
  const request = approvals.requests[0];
  const requestRows = approvals.requests
    .map(
      (item) =>
        `<div class="wh-row"><div><strong>${escapeHtml(item.action_pattern)}</strong><p class="wh-subtle">${escapeHtml(item.status)}${item.sla_due_at ? ` · SLA ${escapeHtml(item.sla_due_at)}` : ""}</p></div><span class="wh-pill">${escapeHtml(item.routed_to_user_id ?? "未路由")}</span></div>`
    )
    .join("");
  const queueCards = approvals.items
    .map(
      (item) =>
        `<article class="wh-card"><span class="wh-pill">${escapeHtml(item.priority)}</span><h3>${escapeHtml(item.title)}</h3><p class="wh-subtle">${escapeHtml(item.summary_text)}</p>${actions(item.actions)}</article>`
    )
    .join("");
  const main = `<span class="wh-kicker">Approval center</span>
    <h1 class="wh-title">${escapeHtml(primary?.title ?? "没有等你点头的事")}</h1>
    <p class="wh-subtle">${escapeHtml(primary?.reason_text ?? "审批中心只放阻塞用户的事项，完整看板继续下沉。")}</p>
    <div class="wh-grid">
      <article class="wh-card"><strong>待处理</strong><p class="wh-subtle">${approvals.counts.pending ?? approvals.items.length} 件</p></article>
      <article class="wh-card"><strong>SLA</strong><p class="wh-subtle">${escapeHtml(request?.sla_due_at ?? "没有即将超时的审批。")}</p></article>
      <article class="wh-card"><strong>规则</strong><p class="wh-subtle">打回必须说明原因，Cuu 会据此继续改。</p></article>
    </div>
    <div class="wh-list">${queueCards}</div>
    <h2>审批事实</h2><div class="wh-card">${requestRows}</div>`;
  return {
    key: "approvals",
    route: vm.routes.approvals,
    title: "Approval Center",
    html: pageShell(surface, "Approval Center", main, cuuRail({ state: "asking_approval", evidenceRefs: primary?.evidence_refs })),
    primaryHrefs: primary?.actions.map((action) => action.href) ?? [],
    cuuState: "asking_approval"
  };
}

function renderWorkItem(surface: GoldPathRenderSurface, vm: GoldPathSurfaceVM): GoldPathRenderedPage {
  const detail = vm.page_vms.workitem;
  const steps = detail.agent_trace_preview
    .map((step) => `<div class="wh-row"><span>${escapeHtml(step.output_excerpt ?? step.phase)}</span><span class="wh-pill">#${step.step_no}</span></div>`)
    .join("");
  const main = `<span class="wh-kicker">Work item</span>
    <h1 class="wh-title">${escapeHtml(detail.workitem.title ?? detail.workitem.code)}</h1>
    <p class="wh-subtle">${escapeHtml(detail.workitem.summary_md ?? detail.workitem.raw_description ?? "")}</p>
    <div class="wh-grid">
      <article class="wh-card"><strong>状态</strong><p class="wh-subtle">${escapeHtml(detail.workitem.status)}</p></article>
      <article class="wh-card"><strong>交付物</strong><p class="wh-subtle">${escapeHtml(detail.latest_proposal?.title ?? "暂无")}</p></article>
    </div>
    <h2>AI 轨迹预览</h2><div class="wh-card">${steps}</div>
    <div class="wh-actions"><a class="wh-btn wh-btn-primary" href="${href(vm.routes.proposal)}">查看变更申请</a><a class="wh-btn" href="${href(vm.routes.replay)}">看 AI 怎么做的</a></div>`;
  return {
    key: "workitem",
    route: vm.routes.workitem,
    title: "WorkItem Detail",
    html: pageShell(surface, "WorkItem Detail", main, cuuRail({ state: "thinking", evidenceRefs: detail.evidence_refs })),
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

function renderProposal(surface: GoldPathRenderSurface, vm: GoldPathSurfaceVM): GoldPathRenderedPage {
  const proposal = vm.page_vms.proposal;
  const manifest: DeliverableChangeManifest = proposal.manifest;
  const proposalActions = [
    proposal.review_actions.approve,
    proposal.review_actions.request_changes,
    ...(proposal.review_actions.merge ? [proposal.review_actions.merge] : [])
  ];
  const main = `<span class="wh-kicker">Deliverable change request</span>
    <h1 class="wh-title">${escapeHtml(proposal.title)}</h1>
    <p class="wh-subtle">${escapeHtml(manifest.summary_md.replace(/[#*_`-]/gu, " ").slice(0, 220))}</p>
    <div class="wh-grid">
      <article class="wh-card"><strong>风险</strong><p class="wh-subtle">${escapeHtml(manifest.risk.human_label)}</p></article>
      <article class="wh-card"><strong>回滚</strong><p class="wh-subtle">${escapeHtml(manifest.rollback.description)}</p></article>
      <article class="wh-card"><strong>证据</strong><p class="wh-subtle">${manifest.evidence_refs.length} 条来源</p></article>
    </div>
    <h2>改了什么</h2><div class="wh-card">${manifest.changes.map(changeRow).join("")}</div>
    <h2>检查结果</h2><div class="wh-list">${manifest.checks.map(checkRow).join("")}</div>
    ${actions(proposalActions)}`;
  return {
    key: "proposal",
    route: vm.routes.proposal,
    title: "Proposal Detail",
    html: pageShell(surface, "Proposal Detail", main, cuuRail({ state: "carrying_document", evidenceRefs: proposal.evidence_refs })),
    primaryHrefs: proposalActions.map((action) => action.href),
    cuuState: "carrying_document"
  };
}

function renderReplay(surface: GoldPathRenderSurface, vm: GoldPathSurfaceVM): GoldPathRenderedPage {
  const replay: ReplayTraceVM = vm.page_vms.replay;
  const steps = replay.steps
    .map((step) => `<div class="wh-row"><div><strong>${escapeHtml(step.phase)}</strong><p class="wh-subtle">${escapeHtml(step.output_excerpt ?? step.tool_name ?? "记录了一步。")}</p></div><span class="wh-pill">#${step.step_no}</span></div>`)
    .join("");
  const main = `<span class="wh-kicker">Replay Work</span>
    <h1 class="wh-title">看看 Cuu 怎么做的</h1>
    <p class="wh-subtle">${escapeHtml(replay.run.handoff_md ?? replay.run.outcome_reason ?? "关键步骤、证据、快照和成本都在这里。")}</p>
    <div class="wh-card">${steps}</div>
    <div class="wh-grid">
      <article class="wh-card"><strong>Token</strong><p class="wh-subtle">${replay.cost?.me.total_tokens ?? 0}</p></article>
      <article class="wh-card"><strong>估算成本</strong><p class="wh-subtle">¥${escapeHtml(replay.cost?.me.estimated_cost_cny ?? "0")}</p></article>
      <article class="wh-card"><strong>快照</strong><p class="wh-subtle">${replay.snapshots.length} 个回滚点</p></article>
    </div>`;
  return {
    key: "replay",
    route: vm.routes.replay,
    title: "Replay Work",
    html: pageShell(surface, "Replay Work", main, cuuRail({ state: "thinking", evidenceRefs: replay.evidence_refs, notices: replay.cost?.active_notices })),
    primaryHrefs: [],
    cuuState: "thinking"
  };
}

function renderCost(surface: GoldPathRenderSurface, vm: GoldPathSurfaceVM): GoldPathRenderedPage {
  const cost = vm.page_vms.cost;
  const noticeCards = cost.notices.map((notice) => `<article class="wh-card"><strong>${escapeHtml(notice.severity)}</strong><p class="wh-subtle">${escapeHtml(notice.message)}</p></article>`).join("");
  const nearestRisk = cost.top_exhaustion_risks[0];
  const main = `<span class="wh-kicker">Cost governance</span>
    <h1 class="wh-title">预算与成本</h1>
    <p class="wh-subtle">普通用户只看个人切片；管理者再看团队视图。</p>
    <div class="wh-grid">
      <article class="wh-card"><strong>本期 token</strong><p class="wh-subtle">${cost.token_in + cost.token_out}</p></article>
      <article class="wh-card"><strong>估算成本</strong><p class="wh-subtle">¥${escapeHtml(cost.total_cost_cny)}</p></article>
      <article class="wh-card"><strong>预算状态</strong><p class="wh-subtle">${escapeHtml(nearestRisk?.status ?? cost.empty_state ?? "ok")}</p></article>
    </div>
    <div class="wh-list">${noticeCards}</div>`;
  return {
    key: "cost",
    route: vm.routes.cost,
    title: "Cost Dashboard",
    html: pageShell(surface, "Cost Dashboard", main, cuuRail({ state: "worried", notices: cost.notices })),
    primaryHrefs: [],
    cuuState: "worried"
  };
}

export function renderGoldPathSurface(vm: GoldPathSurfaceVM, surface: GoldPathRenderSurface): GoldPathRenderedSurface {
  return {
    surface,
    fixtureId: vm.fixture_id,
    css: goldPathCss,
    pages: [
      renderHome(surface, vm),
      renderIntake(surface, vm),
      renderApprovals(surface, vm),
      renderWorkItem(surface, vm),
      renderProposal(surface, vm),
      renderReplay(surface, vm),
      renderCost(surface, vm)
    ]
  };
}
