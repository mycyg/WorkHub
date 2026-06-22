// WorkHub 桌面 · Spotlight「工作项」能力内联视图。
// 无全局 work-item 列表端点 → 列表借 pages.attention.background_runs（在跑/排队的工作项，去重）；
// 点开 pages.workItem(id) → 统一玻璃详情（状态/验收/最新改动/AI 轨迹）+ spec_ready 时一键派活 startAgentRun。
// 历史/其它工作项从 项目/审批/看改动 进入。list→detail 盒内联 morph。

import type { WorkItemDetailVM } from "@workhub/contracts";
import { escapeHtml } from "@workhub/web-runtime";

import type { SpotlightCapabilityView, SpotlightViewContext } from "../view-context.js";

function statusLabel(status: string, zh: boolean): string {
  const map: Record<string, [string, string]> = {
    intake: ["接收中", "Intake"],
    ai_clarifying: ["澄清中", "Clarifying"],
    spec_ready: ["待派活", "Ready to run"],
    in_progress: ["进行中", "In progress"],
    in_review: ["待审阅", "In review"],
    delivery_ready: ["待交付", "Delivery ready"],
    accepted: ["已采纳", "Accepted"],
    done: ["已完成", "Done"],
    cancelled: ["已取消", "Cancelled"]
  };
  const e = map[status];
  return e ? (zh ? e[0] : e[1]) : status;
}

function detailHtml(vm: WorkItemDetailVM, zh: boolean): string {
  const w = vm.workitem;
  const canRun = w.status === "spec_ready";
  const trace = vm.agent_trace_preview ?? [];
  const traceHtml = trace.length
    ? `<div class="wh-spot-trace">${trace
        .slice(0, 8)
        .map((s) => `<div class="wh-spot-trace-step"><div class="wh-spot-trace-phase">${escapeHtml(s.phase)}${s.tool_name ? ` · ${escapeHtml(s.tool_name)}` : ""}</div>${s.output_excerpt ? `<div class="wh-spot-trace-out">${escapeHtml(s.output_excerpt)}</div>` : ""}</div>`)
        .join("")}</div>`
    : "";
  const proposal = vm.latest_proposal
    ? `<div class="wh-spot-change"><div class="wh-spot-change-head"><span class="wh-spot-chip wh-spot-chip--info">${zh ? "最新改动" : "Latest change"}</span></div><div class="wh-spot-change-sum">${escapeHtml(vm.latest_proposal.title)}</div></div>`
    : "";
  return `<div class="wh-spot-dash">
    <button type="button" class="wh-spot-act wh-spot-act--quiet ds-pressable" data-wi-back style="align-self:flex-start">${zh ? "← 返回" : "← Back"}</button>
    <div>
      <div class="wh-spot-card-head"><span class="wh-spot-chip wh-spot-chip--approval">${escapeHtml(statusLabel(w.status, zh))}</span><span class="wh-spot-change-path">${escapeHtml(w.code)}</span></div>
      <h3 class="wh-spot-card-title" style="margin-top:10px">${escapeHtml(w.title ?? w.code)}</h3>
    </div>
    <div class="wh-spot-metrics">
      <div class="wh-spot-metric"><span class="wh-spot-metric-k">${zh ? "优先级" : "Priority"}</span><span class="wh-spot-metric-v" style="font-size:14px">${escapeHtml(w.priority)}</span></div>
      <div class="wh-spot-metric"><span class="wh-spot-metric-k">${zh ? "验收项" : "Acceptance"}</span><span class="wh-spot-metric-v">${vm.acceptance.length}</span></div>
      <div class="wh-spot-metric"><span class="wh-spot-metric-k">${zh ? "交付物" : "Deliverables"}</span><span class="wh-spot-metric-v">${vm.accepted_deliverables.length}</span></div>
    </div>
    ${proposal}
    ${traceHtml}
    ${canRun ? `<div class="wh-spot-card-actions"><button type="button" class="wh-spot-act wh-spot-act--primary ds-pressable" data-wi-run="${escapeHtml(w.id)}">${zh ? "派给 AI 干" : "Dispatch to AI"}</button></div>` : ""}
  </div>`;
}

export function createWorkItemView(): SpotlightCapabilityView {
  return {
    id: "workitem",
    mount(ctx: SpotlightViewContext) {
      const zh = ctx.locale === "zh-CN";
      const { client, body } = ctx;
      let disposed = false;
      let busy = false;

      const showList = async () => {
        ctx.setSubtitle(zh ? "进行中的工作" : "Active work");
        body.innerHTML = `<div class="wh-spot-loading"><span class="wh-spot-spinner"></span>${zh ? "正在拉工作项…" : "Loading…"}</div>`;
        ctx.requestResize();
        try {
          const vm = await client.pages.attention({ locale: ctx.locale });
          if (disposed) return;
          const seen = new Set<string>();
          const items = (vm.background_runs ?? [])
            .filter((r) => r.work_item_id && !seen.has(r.work_item_id) && seen.add(r.work_item_id))
            .map((r) => ({ id: r.work_item_id as string, title: r.title }));
          if (!items.length) {
            body.innerHTML = `<div class="wh-spot-empty"><div class="wh-spot-empty-face">(=･ｪ･=)</div><h3 class="wh-spot-empty-title">${zh ? "暂无进行中的工作项" : "No active work items"}</h3><p class="wh-spot-empty-sub">${zh ? "派个活，或从 项目 / 审批 进入具体工作项" : "Dispatch a task, or open one from Projects / Approvals"}</p></div>`;
          } else {
            ctx.setSubtitle(zh ? `${items.length} 个进行中` : `${items.length} active`);
            body.innerHTML = `<div class="wh-spot-list ds-stagger">${items
              .map((it) => `<button type="button" class="wh-spot-row" data-wi-open="${escapeHtml(it.id)}" style="cursor:pointer;width:100%;text-align:left"><div class="wh-spot-row-main"><div class="wh-spot-row-title">${escapeHtml(it.title)}</div></div></button>`)
              .join("")}</div>`;
          }
        } catch {
          if (!disposed) body.innerHTML = `<div class="wh-spot-error">${zh ? "工作项没拉到，稍后重试" : "Couldn't load — retry"}</div>`;
        }
        ctx.requestResize();
      };

      const showDetail = async (id: string) => {
        body.innerHTML = `<div class="wh-spot-loading"><span class="wh-spot-spinner"></span>${zh ? "正在拉详情…" : "Loading…"}</div>`;
        ctx.requestResize();
        try {
          const vm = await client.pages.workItem(id, { locale: ctx.locale });
          if (disposed) return;
          ctx.setSubtitle(vm.workitem.code);
          body.innerHTML = detailHtml(vm, zh);
        } catch {
          if (!disposed) body.innerHTML = `<div class="wh-spot-error">${zh ? "详情没拉到，稍后重试" : "Couldn't load — retry"}</div>`;
        }
        ctx.requestResize();
      };

      body.addEventListener("click", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        if (target.closest("[data-wi-back]")) {
          void showList();
          return;
        }
        const open = target.closest<HTMLElement>("[data-wi-open]");
        if (open?.dataset.wiOpen) {
          void showDetail(open.dataset.wiOpen);
          return;
        }
        const run = target.closest<HTMLElement>("[data-wi-run]");
        if (run?.dataset.wiRun && !busy) {
          busy = true;
          const id = run.dataset.wiRun;
          run.textContent = zh ? "派活中…" : "Dispatching…";
          void client
            .startAgentRun(id)
            .then(() => {
              ctx.toast(zh ? "已派给 AI，Cuu 开干了" : "Dispatched to AI", "ok");
            })
            .catch(() => ctx.toast(zh ? "派活失败，稍后重试" : "Dispatch failed — retry", "error"))
            .finally(() => {
              busy = false;
              void showDetail(id);
            });
        }
      });

      void showList();
      return () => {
        disposed = true;
      };
    }
  };
}
