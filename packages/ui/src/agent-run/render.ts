import type { AgentRunLiveVM, AgentStep, CuuState } from "@workhub/contracts";

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
  ".wh-title{font-size:28px;line-height:1.14;margin:8px 0}.wh-subtle{color:var(--muted);line-height:1.55}.wh-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;margin-top:18px}",
  ".wh-card{border:1px solid var(--line);background:var(--paper);border-radius:8px;padding:15px}.wh-row{display:flex;justify-content:space-between;gap:14px;border-top:1px solid var(--line);padding:12px 0}.wh-row:first-child{border-top:0}",
  ".wh-pill{display:inline-flex;align-items:center;gap:6px;border-radius:999px;background:var(--soft);padding:5px 9px;font-size:12px;color:var(--muted)}.wh-pill-run{background:#eaf6f4;color:var(--teal)}.wh-pill-done{background:#eaf8f0;color:var(--green)}.wh-pill-warn{background:#fff6e8;color:var(--amber)}.wh-pill-danger{background:#fff1ef;color:var(--danger)}",
  ".wh-trace{display:grid;gap:10px}.wh-step{display:grid;grid-template-columns:26px minmax(0,1fr);gap:10px;align-items:start}.wh-dot{width:24px;height:24px;border-radius:999px;background:#edf1ff;color:var(--blue);display:grid;place-items:center;font-size:12px;font-weight:750}.wh-step[data-phase=tool_result] .wh-dot{background:#eaf8f0;color:var(--green)}.wh-step[data-phase=final] .wh-dot{background:#fff6e8;color:var(--amber)}",
  ".wh-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:18px}.wh-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;border-radius:8px;border:1px solid var(--line);padding:9px 12px;color:var(--ink);text-decoration:none;background:#fff;font-weight:700}.wh-btn-primary{background:var(--blue);border-color:var(--blue);color:#fff}.wh-btn-danger{background:#fff4f3;color:#a94137;border-color:#f3c5c0}",
  ".wh-desktop .wh-run-frame{max-width:920px;grid-template-columns:minmax(0,1fr) 240px}.wh-desktop .wh-run{background:linear-gradient(135deg,#edf6ff,#f8fbff)}@media (max-width:860px){.wh-run-frame{grid-template-columns:1fr}.wh-run-rail{position:static}.wh-title{font-size:24px}}"
].join("");

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;");
}

function cuuStateFor(vm: AgentRunLiveVM): CuuState {
  if (vm.status === "succeeded") {
    return "celebrating";
  }
  if (vm.status === "budget_exhausted") {
    return "asking_approval";
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
  if (status === "failed" || status === "escalated" || status === "budget_exhausted") {
    return "wh-pill wh-pill-danger";
  }
  if (status === "queued" || status === "running") {
    return "wh-pill wh-pill-run";
  }
  return "wh-pill wh-pill-warn";
}

function renderTrace(steps: AgentStep[]) {
  if (steps.length === 0) {
    return '<p class="wh-subtle">Cuu 已排队，开始后会把关键步骤放在这里。</p>';
  }
  return `<div class="wh-trace">${steps
    .map(
      (step) =>
        `<div class="wh-step" data-phase="${escapeHtml(step.phase)}"><span class="wh-dot">${step.step_no}</span><div><strong>${escapeHtml(step.phase)}</strong><p class="wh-subtle">${escapeHtml(step.output_excerpt ?? step.tool_name ?? "记录了一步。")}</p>${step.snapshot_id ? `<span class="wh-pill">snapshot</span>` : ""}</div></div>`
    )
    .join("")}</div>`;
}

function renderHandoff(vm: AgentRunLiveVM) {
  if (!vm.handoff) {
    return '<p class="wh-subtle">暂无交接事项。</p>';
  }
  const lines = [
    ...vm.handoff.done.map((line) => `已完成: ${line}`),
    ...vm.handoff.remaining.map((line) => `还剩: ${line}`),
    ...vm.handoff.next_steps.map((line) => `下一步: ${line}`),
    ...vm.handoff.blockers.map((line) => `阻塞: ${line}`)
  ];
  return lines.map((line) => `<div class="wh-row"><span>${escapeHtml(line)}</span></div>`).join("");
}

export function renderAgentRunLive(vm: AgentRunLiveVM, surface: AgentRunRenderSurface): AgentRunRenderedPage {
  const rootClass = surface === "desktop" ? "wh-desktop" : "wh-web";
  const cuuState = cuuStateFor(vm);
  const latestStep = vm.trace.at(-1);
  const title = vm.title || `AI run ${vm.run_id}`;
  const active = vm.status === "queued" || vm.status === "running";
  const main = `<section class="wh-run-main" data-run-id="${escapeHtml(vm.run_id)}">
    <span class="wh-kicker">Live trace</span>
    <h1 class="wh-title">${escapeHtml(title)}</h1>
    <p class="wh-subtle">${escapeHtml(latestStep?.output_excerpt ?? "Cuu 会把关键步骤和证据变化记录在这里。")}</p>
    <div class="wh-grid">
      <article class="wh-card"><strong>状态</strong><p><span class="${statusClass(vm.status)}">${escapeHtml(vm.status)}</span></p></article>
      <article class="wh-card"><strong>预算</strong><p class="wh-subtle">${vm.usage.token_in + vm.usage.token_out} / ${vm.budget.max_tokens} tokens</p></article>
      <article class="wh-card"><strong>步骤</strong><p class="wh-subtle">${vm.trace.length} 条</p></article>
    </div>
    <h2>AI 实时执行</h2>
    <article class="wh-card">${renderTrace(vm.trace)}</article>
    <h2>交接</h2>
    <article class="wh-card">${renderHandoff(vm)}</article>
    <div class="wh-actions">
      <a class="wh-btn wh-btn-primary" href="${escapeHtml(vm.replay_href)}">查看回放</a>
      <a class="wh-btn" href="/workitems/${escapeHtml(vm.work_item_id)}">回到任务</a>
      ${active ? `<a class="wh-btn wh-btn-danger" href="/api/agent-runs/${escapeHtml(vm.run_id)}/abort" data-method="POST">取消执行</a>` : ""}
    </div>
  </section>`;
  const rail = `<aside class="wh-run-rail">
    <span class="wh-kicker">Cuu</span>
    <h2>${cuuState === "celebrating" ? "做完啦" : cuuState === "worried" ? "需要关注" : "正在思考"}</h2>
    <p class="wh-subtle">${cuuState === "celebrating" ? "我把这次执行整理好了，可以查看回放和交付物。" : "我会只把关键节点递给你，完整过程放进回放。"}</p>
    <article class="wh-card">
      <strong>模型</strong>
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
