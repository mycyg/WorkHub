// WorkHub 桌面 · Spotlight「回放」能力内联视图（S8）。
// 列出在跑/排队的 AI 运行（pages.attention.background_runs）→ 点开看该运行的时间线（getAgentRun trace）。
// list→detail 都在盒子内联 morph；历史已完成运行从工作项/审批进入，这里聚焦「Cuu 正在干什么」。
//
// F-06（一键回滚桌面挂载）：详情态在既有 trace 之外补一块「改动快照」区——README 承诺的「一键回滚」
// 端点/契约/binder 早就齐了（POST /api/agent-runs/:id/revert、@workhub/ui 的 bindReplayRevertActions），
// 唯独没有真实桌面 UI 调用；这里补上，但不复用 packages/ui/src/replay/render.ts 整页视觉（那是给独立
// 回放整页用的 gold-path 旧卡片语言），改用 Spotlight 自己的玻璃组件词汇（wh-spot-*）画同一份数据，
// 复用同一套 data-* 属性契约让既有、已测试的 binder 原样生效。

import type { AgentRunLiveVM, AgentStep, AttentionHomeVM, ReplayTraceVM } from "@workhub/contracts";
import { escapeHtml } from "@workhub/web-runtime";
import { formatLocalTimestamp } from "@workhub/ui";
import type { ReplayRevertRoot } from "@workhub/ui/replay";

import { bindDesktopAgentRunReplayRevert } from "../../desktop-agent-run-replay.js";
import { spotlightErrorHtml, type SpotlightCapabilityView, type SpotlightViewContext } from "../view-context.js";
import { agentRunStatusLabel, agentStepPhaseLabel, agentStepPublicSummary, snapshotKindLabel } from "../labels.js";

type BgRun = AttentionHomeVM["background_runs"][number];

// R20 R19-30：详情页打开时若这个 run 还在跑，每隔这么久用 GET /api/agent-runs/{id}/trace?after= 的游标
// 增量拉一次新步骤——只拿"上次看到的最大 step_no 之后"的新行，不是每次都整个 run 重新拉一遍（trace 端点
// 本来就支持这个游标，此前前端从来没人传过，见 R19-30 发现）。
const TRACE_POLL_INTERVAL_MS = 4000;
// 增量端点不带 status/usage，单靠"出现 final 步"判断收尾不够稳（失败/升级路径不一定落 final 步）——每
// 这么多轮兜底做一次 getAgentRun 全量核对，跟丢终态。
const STATUS_RESYNC_EVERY_N_POLLS = 5;

function highestStepNo(steps: AgentStep[]): number {
  return steps.reduce((max, step) => Math.max(max, step.step_no), 0);
}

function isActiveRunStatus(status: AgentRunLiveVM["status"]): boolean {
  return status === "queued" || status === "running";
}

function stateLabel(state: BgRun["state"], zh: boolean): string {
  const map: Record<BgRun["state"], [string, string]> = {
    queued: ["排队中", "Queued"],
    running: ["运行中", "Running"],
    waiting_for_user: ["等你拍板", "Waiting for you"],
    failed: ["失败", "Failed"]
  };
  return zh ? map[state][0] : map[state][1];
}

export function runListHtml(runs: BgRun[], zh: boolean): string {
  if (!runs.length) {
    return `<div class="wh-spot-empty"><div class="wh-spot-empty-face">(=・ω・=)</div><h3 class="wh-spot-empty-title">${zh ? "暂时没有在跑的 AI" : "No active runs"}</h3><p class="wh-spot-empty-sub">${zh ? "新建任务后，Cuu 跑起来就会出现在这里" : "Create a task and runs show up here"}</p></div>`;
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
            `<div class="wh-spot-trace-step"><div class="wh-spot-trace-phase">${escapeHtml(agentStepPhaseLabel(s.phase, zh))}</div><div class="wh-spot-trace-out">${escapeHtml(agentStepPublicSummary(s, zh))}</div></div>`
        )
        .join("")}</div>`
    : `<p class="wh-spot-bubble-note" style="color:var(--ds-ink-muted)">${zh ? "还没有步骤" : "No steps yet"}</p>`;
  return `<div class="wh-spot-dash ds-anim-fade-in"><button type="button" class="wh-spot-act wh-spot-act--quiet ds-pressable" data-run-back style="align-self:flex-start">${zh ? "← 返回运行列表" : "← Back to runs"}</button>${header}${decideBtn}${timeline}</div>`;
}

// F-06：改动快照区——每个未回滚快照给一颗「撤销此次改动」按钮（POST /api/agent-runs/:id/revert，
// snapshot_id 走 body），已回滚的只显示「已回滚」标签。data-* 属性与 packages/ui/src/replay/render.ts
// 的 renderSnapshots 同一契约，好让不变的 bindDesktopAgentRunReplayRevert（真正的二次确认状态机）
// 原样生效——这里只换视觉词汇，不碰那份 binder 的行为。零快照、或客户端缺 revertAgentRun（极旧客户端
// 替身）时整块按钮换成纯文本，不渲染点了没反应的假按钮。
export function snapshotsSectionHtml(replay: ReplayTraceVM | undefined, runId: string, zh: boolean, canRevert: boolean): string {
  const snapshots = replay?.snapshots ?? [];
  if (snapshots.length === 0) {
    return "";
  }
  const rows = snapshots
    .map((snap) => {
      const reverted = Boolean(snap.reverted_at);
      const meta = [snapshotKindLabel(snap.kind, zh), snap.created_at ? formatLocalTimestamp(snap.created_at) : ""]
        .filter(Boolean)
        .join(" · ");
      let action: string;
      if (reverted) {
        action = `<span class="wh-spot-row-metalabel" data-replay-snapshot-reverted="true">${escapeHtml(zh ? "已回滚" : "Reverted")}</span>`;
      } else if (canRevert) {
        action = `<button type="button" class="wh-spot-act wh-spot-act--danger ds-pressable" data-replay-revert-snapshot="${escapeHtml(snap.id)}" data-replay-revert-run="${escapeHtml(runId)}" data-revert-label-idle="${escapeHtml(zh ? "撤销此次改动" : "Undo these changes")}" data-revert-label-arm="${escapeHtml(zh ? "确认撤销？再点一次" : "Undo? Click again")}" data-revert-label-reverting="${escapeHtml(zh ? "撤销中…" : "Undoing…")}" data-revert-label-reverted="${escapeHtml(zh ? "已回滚" : "Reverted")}" data-revert-label-retry="${escapeHtml(zh ? "撤销失败，点此重试" : "Undo failed — retry")}">${escapeHtml(zh ? "撤销此次改动" : "Undo these changes")}</button>`;
      } else {
        action = `<span class="wh-spot-row-metalabel">${escapeHtml(zh ? "本机暂不支持撤销" : "Undo unavailable")}</span>`;
      }
      return `<div class="wh-spot-row" data-replay-snapshot="${escapeHtml(snap.id)}" data-replay-snapshot-kind="${escapeHtml(snap.kind)}" style="cursor:default"><div class="wh-spot-row-main"><div class="wh-spot-row-title">${escapeHtml(snap.ref)}</div><div class="wh-spot-row-sub">${escapeHtml(meta)}</div></div>${action}</div>`;
    })
    .join("");
  return `<div style="margin-top:16px;display:flex;flex-direction:column;gap:8px">
    <div class="wh-spot-row-title">${escapeHtml(zh ? "改动快照" : "Change snapshots")}</div>
    <p class="wh-spot-row-sub">${escapeHtml(zh ? "撤销会把文件还原到这份快照，并覆盖之后的改动。" : "Undoing restores files to that snapshot and overwrites later changes.")}</p>
    ${rows}
  </div>`;
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
      // R20 R19-30：增量轮询定时器——list↔trace 切换、离开能力都要先停旧的，否则前一个 run 的轮询
      // 会在后台继续拿新 run 名下不存在的 after 游标乱撞（虽然服务端会正确按 runId 过滤，但纯属浪费）。
      let pollTimer: ReturnType<typeof setTimeout> | undefined;
      // F-06：快照区撤销 binder 的清理函数——离开详情态/换 run/整个能力卸载都要先停掉，否则武装态的
      // 5 秒解除定时器会在已经不可见的 DOM 上空跑。
      let stopRevertBinding: (() => void) | undefined;

      // F-06：详情态当前展示的 run/replay 快照，供轮询 tick 与「回滚成功后重拉」共用同一份
      // 「整体重渲 + 重绑」逻辑（见 renderDetailNow）——不用 querySelector 拆分子槽位，因为
      // bindDesktopAgentRunReplayRevert 的假替身/真实 DOM 都只需要 querySelectorAll 这一个入口，
      // 整体覆盖反而更简单可靠（唯一代价：轮询恰好撞上撤销按钮的二次确认武装窗口会把它重置回
      // 未武装态，需要用户再点一次确认——不丢数据，只是要多点一下，可接受）。
      let currentRunId = "";
      let currentVm: AgentRunLiveVM | undefined;
      let currentReplay: ReplayTraceVM | undefined;
      let currentWaiting = false;

      const stopPolling = () => {
        if (pollTimer !== undefined) {
          clearTimeout(pollTimer);
          pollTimer = undefined;
        }
      };

      const teardownRevertBinding = () => {
        stopRevertBinding?.();
        stopRevertBinding = undefined;
      };

      const showList = async () => {
        stopPolling();
        teardownRevertBinding();
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

      // 详情态整体重渲：trace + 快照区一起画，画完立即（重新）绑定撤销 binder——旧 binder 必须先停，
      // 否则重复绑定会让同一批按钮叠加监听器（每点一下发出成倍的确认/请求）。
      const renderDetailNow = (gen: number) => {
        if (!currentVm) return;
        const canRevert = Boolean(ctx.client.revertAgentRun);
        ctx.body.innerHTML = `${traceHtml(currentVm, zh, currentWaiting)}${snapshotsSectionHtml(currentReplay, currentRunId, zh, canRevert)}`;
        teardownRevertBinding();
        stopRevertBinding = bindDesktopAgentRunReplayRevert(ctx.body as unknown as ReplayRevertRoot, ctx.client, {
          onReverted: () => {
            if (disposed || gen !== loadGen) return;
            void refreshSnapshots(gen);
          }
        });
        ctx.requestResize();
      };

      // 回滚成功后重拉快照（不只信任 binder 自己对被点按钮的乐观 DOM patch）——服务端如果因这次撤销
      // 联动改了其它快照的状态，重拉才能落到权威态。失败保留当前（已乐观更新的）展示，不额外报错
      // 盖住时间线——见 bindReplayRevertActions 对失败态的处理（保留武装，允许原地重试）。
      const refreshSnapshots = async (gen: number) => {
        try {
          const replay = await ctx.client.replayAgentRun(currentRunId);
          if (disposed || gen !== loadGen) return;
          currentReplay = replay;
          renderDetailNow(gen);
        } catch {
          // best-effort：见上方注释。
        }
      };

      // R20 R19-30：仅当详情页打开时这个 run 还在跑（queued/running）才起轮询；已终结的 run 时间线不会
      // 再变，起了也白起。每轮先走增量 trace 游标只要新步骤，省掉整个 run 重新序列化/传输；「出现 final
      // 步」或每 N 轮兜底做一次全量 getAgentRun 核对 status/usage 并判断是否已收尾。
      const pollTrace = (runId: string, gen: number, seedVm: AgentRunLiveVM, waiting: boolean) => {
        if (!isActiveRunStatus(seedVm.status)) {
          return;
        }
        let activeVm = seedVm;
        let cursor = highestStepNo(seedVm.trace ?? []);
        let pollCount = 0;

        const tick = async () => {
          pollTimer = undefined;
          if (disposed || gen !== loadGen) return;
          pollCount += 1;
          try {
            const newSteps = await ctx.client.getAgentRunTrace(runId, cursor);
            if (disposed || gen !== loadGen) return;
            if (newSteps.length > 0) {
              cursor = Math.max(cursor, highestStepNo(newSteps));
              activeVm = { ...activeVm, trace: [...(activeVm.trace ?? []), ...newSteps] };
              currentVm = activeVm;
              renderDetailNow(gen);
              ctx.requestResize();
            }
            const shouldResync = newSteps.some((step) => step.phase === "final")
              || pollCount % STATUS_RESYNC_EVERY_N_POLLS === 0;
            if (shouldResync) {
              const refreshed = await ctx.client.getAgentRun(runId);
              if (disposed || gen !== loadGen) return;
              activeVm = refreshed;
              cursor = Math.max(cursor, highestStepNo(refreshed.trace ?? []));
              currentVm = activeVm;
              renderDetailNow(gen);
              ctx.requestResize();
              if (!isActiveRunStatus(refreshed.status)) {
                return;
              }
            }
          } catch {
            // best-effort：瞬时网络抖动跳过这一轮，下一轮重试，不弹错误态盖掉已经在展示的时间线。
          }
          if (!disposed && gen === loadGen) {
            pollTimer = setTimeout(() => void tick(), TRACE_POLL_INTERVAL_MS);
          }
        };
        pollTimer = setTimeout(() => void tick(), TRACE_POLL_INTERVAL_MS);
      };

      const showTrace = async (runId: string, runState?: string) => {
        stopPolling();
        teardownRevertBinding();
        const gen = ++loadGen;
        currentRunId = runId;
        ctx.body.innerHTML = `<div class="wh-spot-loading"><span class="wh-spot-spinner"></span>${zh ? "正在拉时间线…" : "Loading trace…"}</div>`;
        ctx.requestResize();
        try {
          const vmPromise = ctx.client.getAgentRun(runId);
          // F-06：快照是回放 VM 的附属数据，独立取——旧/测试用的客户端替身可能没实现这个方法，缺失时
          // 当「没有快照」处理，不阻塞主时间线；真出错（服务端 5xx 等）同样 best-effort 吞掉。
          // 与 getAgentRun 并发发起，不因为串行等待多绕一圈网络。
          const replayPromise = typeof ctx.client.replayAgentRun === "function"
            ? ctx.client.replayAgentRun(runId).catch(() => undefined)
            : Promise.resolve(undefined);
          const vm = await vmPromise;
          if (disposed || gen !== loadGen) return;
          ctx.setSubtitle(zh ? "运行时间线" : "Run trace");
          const waiting = runState === "waiting_for_user";
          const replay = await replayPromise;
          if (disposed || gen !== loadGen) return;
          currentVm = vm;
          currentReplay = replay;
          currentWaiting = waiting;
          renderDetailNow(gen);
          pollTrace(runId, gen, vm, waiting);
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
        stopPolling();
        teardownRevertBinding();
      };
    }
  };
}
