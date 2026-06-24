// WorkHub 桌面 · Spotlight「回放」能力内联视图（S8）。
// 列出在跑/排队的 AI 运行（pages.attention.background_runs）→ 点开看该运行的时间线（getAgentRun trace）。
// list→detail 都在盒子内联 morph；历史已完成运行从工作项/审批进入，这里聚焦「Cuu 正在干什么」。

import type { AgentRunLiveVM, AttentionHomeVM } from "@workhub/contracts";
import { escapeHtml } from "@workhub/web-runtime";

import { spotlightErrorHtml, type SpotlightCapabilityView, type SpotlightViewContext } from "../view-context.js";
import { agentRunStatusLabel, agentStepPhaseLabel } from "../labels.js";

type BgRun = AttentionHomeVM["background_runs"][number];

function stateLabel(state: BgRun["state"], zh: boolean): string {
  const map: Record<BgRun["state"], [string, string]> = {
    queued: ["排队中", "Queued"],
    running: ["运行中", "Running"],
    waiting_for_user: ["等你拍板", "Waiting for you"],
    failed: ["失败", "Failed"]
  };
  return zh ? map[state][0] : map[state][1];
}

function runListHtml(runs: BgRun[], zh: boolean): string {
  if (!runs.length) {
    return `<div class="wh-spot-empty"><div class="wh-spot-empty-face">(=・ω・=)</div><h3 class="wh-spot-empty-title">${zh ? "暂时没有在跑的 AI" : "No active runs"}</h3><p class="wh-spot-empty-sub">${zh ? "派个活，Cuu 跑起来就会出现在这里" : "Dispatch a task and runs show up here"}</p></div>`;
  }
  return `<div class="wh-spot-list ds-stagger">${runs
    .map(
      (r) =>
        `<button type="button" class="wh-spot-row" data-run="${escapeHtml(r.run_id)}" data-run-state="${escapeHtml(r.state)}" style="cursor:pointer;width:100%;text-align:left">
          <span class="wh-spot-run-dot wh-spot-run-dot--${r.state}"></span>
          <div class="wh-spot-row-main"><div class="wh-spot-row-title">${escapeHtml(r.title)}</div><div class="wh-spot-row-sub">${escapeHtml(r.preview_text)}</div></div>
          <span class="wh-spot-row-metalabel">${escapeHtml(stateLabel(r.state, zh))}</span>
        </button>`
    )
    .join("")}</div>`;
}

function traceHtml(vm: AgentRunLiveVM, zh: boolean, waiting = false): string {
  const u = vm.usage;
  // L14：列表里这条运行标着「等你拍板」(waiting_for_user，仅 attention 列表态有,详情 VM 的 status 枚举不含它)。
  // 用户点进来就是想处置,trace 详情却只有返回+时间线、无处可点 → 给一颗「去拍板」直达决策收件箱。
  const decideBtn = waiting
    ? `<button type="button" class="wh-spot-act wh-spot-act--primary ds-pressable" data-run-open-decision style="align-self:flex-start">${zh ? "去拍板" : "Open decision"}</button>`
    : "";
  const header = `<div class="wh-spot-metrics">
    <div class="wh-spot-metric"><span class="wh-spot-metric-k">${zh ? "状态" : "Status"}</span><span class="wh-spot-metric-v">${escapeHtml(agentRunStatusLabel(vm.status, zh))}</span></div>
    <div class="wh-spot-metric"><span class="wh-spot-metric-k">${zh ? "步数" : "Steps"}</span><span class="wh-spot-metric-v">${u.steps_used}</span></div>
    <div class="wh-spot-metric"><span class="wh-spot-metric-k">${zh ? "花费" : "Cost"}</span><span class="wh-spot-metric-v">¥${escapeHtml(String(u.estimated_cost_cny))}</span></div>
  </div>`;
  const steps = vm.trace ?? [];
  const timeline = steps.length
    ? `<div class="wh-spot-trace">${steps
        .map(
          (s) =>
            `<div class="wh-spot-trace-step"><div class="wh-spot-trace-phase">${escapeHtml(agentStepPhaseLabel(s.phase, zh))}${s.tool_name ? ` · ${escapeHtml(s.tool_name)}` : ""}</div>${s.output_excerpt ? `<div class="wh-spot-trace-out">${escapeHtml(s.output_excerpt)}</div>` : ""}</div>`
        )
        .join("")}</div>`
    : `<p class="wh-spot-bubble-note" style="color:var(--ds-ink-muted)">${zh ? "还没有步骤" : "No steps yet"}</p>`;
  return `<div class="wh-spot-dash ds-anim-fade-in"><button type="button" class="wh-spot-act wh-spot-act--quiet ds-pressable" data-run-back style="align-self:flex-start">${zh ? "← 返回运行列表" : "← Back to runs"}</button>${header}${decideBtn}${timeline}</div>`;
}

export function createReplayView(): SpotlightCapabilityView {
  return {
    id: "replay",
    mount(ctx: SpotlightViewContext) {
      const zh = ctx.locale === "zh-CN";
      let disposed = false;
      // M4：单调代次，防 list↔trace 快切时晚到的 await 覆盖更新一帧。
      let loadGen = 0;
      // rank7：上次失败的加载器，点「重试」即重跑。
      let retry: (() => void) | undefined;

      const showList = async () => {
        const gen = ++loadGen;
        ctx.setSubtitle(zh ? "AI 运行" : "AI runs");
        ctx.body.innerHTML = `<div class="wh-spot-loading"><span class="wh-spot-spinner"></span>${zh ? "正在拉运行…" : "Loading runs…"}</div>`;
        ctx.requestResize();
        try {
          const vm = await ctx.client.pages.attention({ locale: ctx.locale });
          if (disposed || gen !== loadGen) return;
          const runs = vm.background_runs ?? [];
          // 「在跑」副标题只数真正在跑的(running/queued);background_runs 还含 failed / waiting_for_user,
          // 列表会用各自药丸标出它们——把不在跑的也算「在跑」会和列表自相矛盾(web 首页同款已修)。
          const activeRuns = runs.filter((r) => r.state === "running" || r.state === "queued").length;
          ctx.setSubtitle(zh ? `${activeRuns} 个在跑` : `${activeRuns} active`);
          ctx.body.innerHTML = runListHtml(runs, zh);
        } catch {
          if (disposed || gen !== loadGen) return;
          retry = () => void showList();
          ctx.body.innerHTML = spotlightErrorHtml(zh, zh ? "运行没拉到" : "Couldn't load runs");
        }
        ctx.requestResize();
      };

      const showTrace = async (runId: string, runState?: string) => {
        const gen = ++loadGen;
        ctx.body.innerHTML = `<div class="wh-spot-loading"><span class="wh-spot-spinner"></span>${zh ? "正在拉时间线…" : "Loading trace…"}</div>`;
        ctx.requestResize();
        try {
          const vm = await ctx.client.getAgentRun(runId);
          if (disposed || gen !== loadGen) return;
          ctx.setSubtitle(zh ? "运行时间线" : "Run trace");
          ctx.body.innerHTML = traceHtml(vm, zh, runState === "waiting_for_user");
        } catch {
          if (disposed || gen !== loadGen) return;
          // L14 回归修复：retry 必须带上 runState，否则重试成功后「去拍板」按钮(仅 waiting_for_user 显示)会丢失。
          retry = () => void showTrace(runId, runState);
          ctx.body.innerHTML = spotlightErrorHtml(zh, zh ? "时间线没拉到" : "Couldn't load trace");
        }
        ctx.requestResize();
      };

      ctx.body.addEventListener("click", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        if (target.closest("[data-spot-retry]")) {
          retry?.();
          return;
        }
        if (target.closest("[data-run-back]")) {
          void showList();
          return;
        }
        if (target.closest("[data-run-open-decision]")) {
          ctx.open("approvals");
          return;
        }
        const run = target.closest<HTMLElement>("[data-run]");
        if (run?.dataset.run) {
          void showTrace(run.dataset.run, run.dataset.runState);
        }
      });

      // rank13：深链/托盘带了运行 id → 直接开时间线；否则从列表起。
      if (ctx.target?.id) {
        void showTrace(ctx.target.id);
      } else {
        void showList();
      }
      return () => {
        disposed = true;
      };
    }
  };
}
