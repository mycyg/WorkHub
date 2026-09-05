import { readAgentRunReminderFacts, type AgentRunLiveVM, type AgentStep, type CuuState, type WorkHubLocale } from "@workhub/contracts";

import {
  agentRunReminderLine,
  agentRunReminderPhaseLabel,
  agentRunStatusLabel,
  agentStepPhaseLabel,
  agentStepPublicSummary,
  uiCount,
  uiLocale,
  uiT,
  type UiRenderOptions
} from "../i18n.js";
import { safeHref } from "../safe-href.js";

export type AgentRunRenderSurface = "web" | "desktop";

export type AgentRunRenderedPage = {
  surface: AgentRunRenderSurface;
  runId: string;
  workItemId: string;
  title: string;
  status: AgentRunLiveVM["status"];
  css: string;
  html: string;
  route: string;
  streamHref: string;
  replayHref: string;
  traceCount: number;
  cuuState: CuuState;
};

export const agentRunCss = [
  ":root{color-scheme:light;--ink:#182033;--muted:#60708f;--line:#dfe6f2;--paper:#fff;--soft:#f5f8fc;--blue:#355cff;--green:#24a66a;--amber:#d98b16;--danger:#d94a3a;--teal:#0f9f8f}",
  ".wh-run{font-family:\"Aptos\",\"Segoe UI\",sans-serif;color:var(--ink);background:linear-gradient(180deg,#f8fbff 0%,#eef5fb 100%);padding:24px;box-sizing:border-box}",
  ".wh-run-frame{max-width:1080px;margin:0 auto;display:grid;grid-template-columns:minmax(0,1fr) 280px;gap:20px;align-items:start}",
  ".wh-run-main,.wh-run-rail{background:rgba(255,255,255,.93);border:1px solid var(--line);border-radius:8px;box-shadow:0 18px 50px rgba(37,51,79,.08)}",
  ".wh-run-main{padding:24px}.wh-run-rail{padding:18px;position:sticky;top:16px}.wh-kicker{font-size:12px;color:var(--blue);font-weight:750;text-transform:uppercase;letter-spacing:0}",
  ".wh-title{font-size:28px;line-height:1.35;margin:8px 0}.wh-subtle{color:var(--muted);line-height:1.55}.wh-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;margin-top:18px}",
  ".wh-card{border:1px solid var(--line);background:var(--paper);border-radius:8px;padding:15px}.wh-row{display:flex;justify-content:space-between;gap:14px;border-top:1px solid var(--line);padding:12px 0}.wh-row:first-child{border-top:0}",
  ".wh-pill{display:inline-flex;align-items:center;gap:6px;border-radius:999px;background:var(--soft);padding:5px 9px;font-size:12px;color:var(--muted)}.wh-pill-run{background:#eaf6f4;color:var(--teal)}.wh-pill-done{background:#eaf8f0;color:var(--green)}.wh-pill-warn{background:#fff6e8;color:var(--amber)}.wh-pill-danger{background:#fff1ef;color:var(--danger)}",
  ".wh-trace{display:grid;gap:10px}.wh-step{display:grid;grid-template-columns:26px minmax(0,1fr);gap:10px;align-items:start}.wh-dot{width:24px;height:24px;border-radius:999px;background:#edf1ff;color:var(--blue);display:grid;place-items:center;font-size:12px;font-weight:750}.wh-step[data-phase=tool_result] .wh-dot{background:#eaf8f0;color:var(--green)}.wh-step[data-phase=final] .wh-dot{background:#fff6e8;color:var(--amber)}",
  // B6：提醒行不是模型的一步——琥珀点区分于蓝色步骤点，第二档再压深一档提示「下一次就转交人」。
  ".wh-step[data-phase=reminded] .wh-dot{background:#fff6e8;color:var(--amber)}.wh-step[data-phase=reminded][data-reminder-tier=\"2\"] .wh-dot{background:#fdece2;color:#b4622a}",
  ".wh-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:18px}.wh-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;border-radius:8px;border:1px solid var(--line);padding:9px 12px;color:var(--ink);text-decoration:none;background:#fff;font-weight:700}.wh-btn-primary{background:var(--blue);border-color:var(--blue);color:#fff}.wh-btn-danger{background:#fff4f3;color:#a94137;border-color:#f3c5c0}",
  ".wh-desktop .wh-run-frame{max-width:920px;grid-template-columns:minmax(0,1fr) 240px}.wh-desktop .wh-run{background:linear-gradient(135deg,#edf6ff,#f8fbff)}@media (max-width:860px){.wh-run-frame{grid-template-columns:1fr}.wh-run-rail{position:static}.wh-title{font-size:24px}}"
].join("");

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#39;");
}

function cuuStateFor(vm: AgentRunLiveVM): CuuState {
  if (vm.status === "succeeded") {
    return "celebrating";
  }
  if (vm.status === "failed" || vm.status === "escalated") {
    return "worried";
  }
  return "thinking";
}

function statusClass(status: AgentRunLiveVM["status"]) {
  if (status === "succeeded") {
    return "wh-pill wh-pill-done";
  }
  if (status === "failed" || status === "escalated") {
    return "wh-pill wh-pill-danger";
  }
  if (status === "queued" || status === "running") {
    return "wh-pill wh-pill-run";
  }
  return "wh-pill wh-pill-warn";
}

function renderTrace(steps: AgentStep[], reminders: ReadonlyArray<unknown> | undefined, options?: UiRenderOptions) {
  const locale = uiLocale(options);
  const trailing = trailingRunReminderRows(steps, reminders, locale);
  if (steps.length === 0) {
    // 一步都还没跑完就先被劝过是不可能的（提醒挂在某一步之后），但提醒真的先到时也不能丢——
    // 有提醒行就渲提醒，没有才落到空态。
    return trailing
      ? `<div class="wh-trace">${trailing}</div>`
      : `<p class="wh-subtle">${escapeHtml(uiT(locale, "agent.emptyTrace"))}</p>`;
  }
  return `<div class="wh-trace">${steps
    .map(
      (step) =>
        `<div class="wh-step" data-phase="${escapeHtml(step.phase)}"><span class="wh-dot">${step.step_no}</span><div><strong>${escapeHtml(agentStepPhaseLabel(locale, step.phase))}</strong><p class="wh-subtle">${escapeHtml(agentStepPublicSummary(locale, step))}</p>${step.snapshot_id ? `<span class="wh-pill">${escapeHtml(uiT(locale, "generic.snapshot"))}</span>` : ""}</div></div>${renderRunReminderRows(reminders, step.step_no, locale)}`
    )
    .join("")}${trailing}</div>`;
}

// R26 批 B6 观测面：把「重复动作被劝了几次、劝的是什么」插进步骤时间线。
//
// 提醒不是模型的一步（它是运行环境往对话里追加的一句话），所以不占 step_no，也不冒充 AgentStep——
// 单独一行、单独的 data-phase="reminded"，排在它所属那一步之后。缺字段/脏数据由
// readAgentRunReminderFacts 挡掉（返回 undefined 即整行不渲），绝不把半截事实编成一句话。
export function renderRunReminderRows(
  reminders: ReadonlyArray<unknown> | undefined,
  stepNo: number,
  locale: WorkHubLocale
) {
  if (!reminders?.length) {
    return "";
  }
  return reminders
    .map((entry) => readAgentRunReminderFacts(entry))
    .filter((facts): facts is NonNullable<typeof facts> => Boolean(facts) && facts?.step_no === stepNo)
    .map(
      (facts) =>
        `<div class="wh-step" data-phase="reminded" data-reminder-tier="${facts.tier}"><span class="wh-dot">!</span><div><strong>${escapeHtml(agentRunReminderPhaseLabel(locale))}</strong><p class="wh-subtle">${escapeHtml(agentRunReminderLine(locale, facts))}</p></div></div>`
    )
    .join("");
}

/**
 * 对不上任何已渲染步骤的提醒行（时间线被截断、或提醒先于该步的 trace 行到达）。
 * 直接丢掉等于「劝过但界面上看不见」，正是这批要修的；统一按步序补在时间线末尾。
 */
function trailingRunReminderRows(
  steps: ReadonlyArray<AgentStep>,
  reminders: ReadonlyArray<unknown> | undefined,
  locale: WorkHubLocale
) {
  if (!reminders?.length) {
    return "";
  }
  const rendered = new Set(steps.map((step) => step.step_no));
  const orphans = reminders
    .map((entry) => readAgentRunReminderFacts(entry))
    .filter((facts): facts is NonNullable<typeof facts> => Boolean(facts) && !rendered.has(facts?.step_no ?? -1))
    .sort((a, b) => a.step_no - b.step_no);
  return orphans.map((facts) => renderRunReminderRows([facts], facts.step_no, locale)).join("");
}

function renderHandoff(vm: AgentRunLiveVM, options?: UiRenderOptions) {
  const locale = uiLocale(options);
  if (!vm.handoff) {
    return `<p class="wh-subtle">${escapeHtml(uiT(locale, "agent.emptyHandoff"))}</p>`;
  }
  const lines = [
    ...vm.handoff.done.map((line) => `${uiT(locale, "agent.handoffDone")}: ${line}`),
    ...vm.handoff.remaining.map((line) => `${uiT(locale, "agent.handoffRemaining")}: ${line}`),
    ...vm.handoff.next_steps.map((line) => `${uiT(locale, "agent.handoffNext")}: ${line}`),
    ...vm.handoff.blockers.map((line) => `${uiT(locale, "agent.handoffBlocker")}: ${line}`)
  ];
  return lines.map((line) => `<div class="wh-row"><span>${escapeHtml(line)}</span></div>`).join("");
}

export function renderAgentRunLive(
  vm: AgentRunLiveVM,
  surface: AgentRunRenderSurface,
  options?: UiRenderOptions
): AgentRunRenderedPage {
  const locale = uiLocale(options);
  const rootClass = surface === "desktop" ? "wh-desktop" : "wh-web";
  const cuuState = cuuStateFor(vm);
  const latestStep = vm.trace.at(-1);
  const title = vm.title || `${uiT(locale, "agent.fallbackTitle")} ${vm.run_id}`;
  const active = vm.status === "queued" || vm.status === "running";
  const main = `<section class="wh-run-main" data-run-id="${escapeHtml(vm.run_id)}">
    <span class="wh-kicker">${escapeHtml(uiT(locale, "agent.kicker"))}</span>
    <h1 class="wh-title">${escapeHtml(title)}</h1>
    <p class="wh-subtle">${escapeHtml(latestStep ? agentStepPublicSummary(locale, latestStep) : uiT(locale, "agent.defaultSummary"))}</p>
    <div class="wh-grid">
      <article class="wh-card"><strong>${escapeHtml(uiT(locale, "generic.status"))}</strong><p><span class="${statusClass(vm.status)}">${escapeHtml(agentRunStatusLabel(locale, vm.status))}</span></p></article>
      <article class="wh-card"><strong>${escapeHtml(uiT(locale, "generic.budget"))}</strong><p class="wh-subtle">${vm.usage.token_in + vm.usage.token_out} / ${vm.budget.max_tokens} ${escapeHtml(uiT(locale, "generic.tokens"))}</p></article>
      <article class="wh-card"><strong>${escapeHtml(uiT(locale, "generic.steps"))}</strong><p class="wh-subtle">${escapeHtml(uiCount(locale, vm.trace.length, "条", "step"))}</p></article>
    </div>
    <h2>${escapeHtml(uiT(locale, "agent.liveTitle"))}</h2>
    <article class="wh-card">${renderTrace(vm.trace, vm.reminders, { locale })}</article>
    <h2>${escapeHtml(uiT(locale, "agent.handoff"))}</h2>
    <article class="wh-card">${renderHandoff(vm, { locale })}</article>
    <div class="wh-actions">
      <a class="wh-btn wh-btn-primary" href="${escapeHtml(safeHref(vm.replay_href))}">${escapeHtml(uiT(locale, "agent.viewReplay"))}</a>
      <a class="wh-btn" href="/workitems/${escapeHtml(vm.work_item_id)}">${escapeHtml(uiT(locale, "agent.backToTask"))}</a>
      ${active ? `<a class="wh-btn wh-btn-danger" href="/api/agent-runs/${escapeHtml(vm.run_id)}/abort" data-method="POST">${escapeHtml(uiT(locale, "agent.abort"))}</a>` : ""}
    </div>
  </section>`;
  const rail = `<aside class="wh-run-rail">
    <span class="wh-kicker">${escapeHtml(uiT(locale, "generic.aiStatus"))}</span>
    <h2>${escapeHtml(cuuState === "celebrating" ? uiT(locale, "agent.done") : cuuState === "worried" ? uiT(locale, "agent.needsAttention") : uiT(locale, "agent.thinking"))}</h2>
    <p class="wh-subtle">${escapeHtml(cuuState === "celebrating" ? uiT(locale, "agent.celebratingBody") : uiT(locale, "agent.runningBody"))}</p>
    <article class="wh-card">
      <strong>${escapeHtml(uiT(locale, "generic.model"))}</strong>
      <p class="wh-subtle">${escapeHtml(vm.run.model)}</p>
      <span class="wh-pill">${escapeHtml(vm.budget_decision.model_route.reason)}</span>
    </article>
  </aside>`;

  return {
    surface,
    runId: vm.run_id,
    workItemId: vm.work_item_id,
    title,
    status: vm.status,
    css: agentRunCss,
    html: `<div class="${rootClass}"><main class="wh-run"><div class="wh-run-frame">${main}${rail}</div></main></div>`,
    route: `/agent-runs/${encodeURIComponent(vm.run_id)}`,
    streamHref: vm.stream_href,
    replayHref: vm.replay_href,
    traceCount: vm.trace.length,
    cuuState
  };
}
