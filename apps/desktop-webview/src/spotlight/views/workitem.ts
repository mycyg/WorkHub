// WorkHub 桌面 · Spotlight「工作项」能力内联视图。
// 无全局 work-item 列表端点 → 列表借 pages.attention.background_runs（在跑/排队的工作项，去重）；
// 点开 pages.workItem(id) → 统一玻璃详情（状态/验收/最新改动/AI 轨迹）+ spec_ready 时一键派活 startAgentRun。
// 历史/其它工作项从 项目/审批/看改动 进入。list→detail 盒内联 morph。

import type { WorkItemDetailVM } from "@workhub/contracts";
import { publicProposalDisplayTitle } from "@workhub/ui/proposal";
import { escapeHtml } from "@workhub/web-runtime";

import { spotlightErrorHtml, type SpotlightCapabilityView, type SpotlightViewContext } from "../view-context.js";
import { agentStepPhaseLabel, agentStepPublicSummary, workItemPriorityLabel, workItemStatusLabel } from "../labels.js";

export function detailHtml(vm: WorkItemDetailVM, zh: boolean): string {
  const w = vm.workitem;
  // #22：与 web 同口径——已有变更/已跑过就不再显示「派给 AI」，否则会出现「再跑一发」歧义按钮。
  const canRun = w.status === "spec_ready" && !vm.latest_proposal && (vm.agent_trace_preview?.length ?? 0) === 0;
  // #11：从网盘评论/会议洞察生成的工作项带 create_proposal_draft 动作 → 桌面也给「生成变更草稿」入口。
  const createDraft = vm.actions.create_proposal_draft
    ? `<button type="button" class="wh-spot-act wh-spot-act--primary ds-pressable" data-wi-create-proposal="${escapeHtml(w.id)}">${zh ? "生成变更草稿" : "Create proposal draft"}</button>`
    : "";
  const trace = vm.agent_trace_preview ?? [];
  const traceHtml = trace.length
    ? `<div class="wh-spot-trace">${trace
        .slice(0, 8)
        .map((s) => `<div class="wh-spot-trace-step"><div class="wh-spot-trace-phase">${escapeHtml(agentStepPhaseLabel(s.phase, zh))}${s.tool_name ? ` · ${escapeHtml(s.tool_name)}` : ""}</div><div class="wh-spot-trace-out">${escapeHtml(agentStepPublicSummary(s, zh))}</div></div>`)
        .join("")}</div>`
    : "";
  const proposal = vm.latest_proposal
    ? `<div class="wh-spot-change"><div class="wh-spot-change-head"><span class="wh-spot-chip wh-spot-chip--info">${zh ? "最新改动" : "Latest change"}</span></div><div class="wh-spot-change-sum">${escapeHtml(publicProposalDisplayTitle(vm.latest_proposal.title, zh ? "zh-CN" : "en-US"))}</div></div>`
    : "";
  return `<div class="wh-spot-dash ds-anim-fade-in">
    <button type="button" class="wh-spot-act wh-spot-act--quiet ds-pressable" data-wi-back style="align-self:flex-start">${zh ? "← 返回" : "← Back"}</button>
    <div>
      <div class="wh-spot-card-head"><span class="wh-spot-chip wh-spot-chip--approval">${escapeHtml(workItemStatusLabel(w.status, zh))}</span><span class="wh-spot-change-path">${escapeHtml(w.code)}</span></div>
      <h3 class="wh-spot-card-title" style="margin-top:10px">${escapeHtml(w.title ?? w.code)}</h3>
    </div>
    <div class="wh-spot-metrics">
      <div class="wh-spot-metric"><span class="wh-spot-metric-k">${zh ? "优先级" : "Priority"}</span><span class="wh-spot-metric-v" style="font-size:14px">${escapeHtml(workItemPriorityLabel(w.priority, zh))}</span></div>
      <div class="wh-spot-metric"><span class="wh-spot-metric-k">${zh ? "验收项" : "Acceptance"}</span><span class="wh-spot-metric-v">${vm.acceptance.length}</span></div>
      <div class="wh-spot-metric"><span class="wh-spot-metric-k">${zh ? "交付物" : "Deliverables"}</span><span class="wh-spot-metric-v">${vm.accepted_deliverables.length}</span></div>
    </div>
    ${proposal}
    ${traceHtml}
    ${createDraft || canRun ? `<div class="wh-spot-card-actions">${createDraft}${canRun ? `<button type="button" class="wh-spot-act wh-spot-act--primary ds-pressable" data-wi-run="${escapeHtml(w.id)}">${zh ? "派给 AI 干" : "Dispatch to AI"}</button>` : ""}</div>` : ""}
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
      // M4：单调代次，防 list↔detail 快切时晚到的 await 覆盖更新一帧。
      let loadGen = 0;
      // rank7：上次失败的加载器，点「重试」即重跑。
      let retry: (() => void) | undefined;
      // #11：记住当前详情,以便「生成变更草稿」按 source_context 选 drive/meeting 客户端方法。
      let currentDetail: WorkItemDetailVM | null = null;

      const showList = async () => {
        const gen = ++loadGen;
        ctx.setSubtitle(zh ? "进行中的工作" : "Active work");
        body.innerHTML = `<div class="wh-spot-loading"><span class="wh-spot-spinner"></span>${zh ? "正在拉工作项…" : "Loading…"}</div>`;
        ctx.requestResize();
        try {
          const vm = await client.pages.attention({ locale: ctx.locale });
          if (disposed || gen !== loadGen) return;
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
          if (!disposed && gen === loadGen) {
            retry = () => void showList();
            body.innerHTML = spotlightErrorHtml(zh, zh ? "工作项没拉到" : "Couldn't load");
          }
        }
        ctx.requestResize();
      };

      const showDetail = async (id: string) => {
        const gen = ++loadGen;
        body.innerHTML = `<div class="wh-spot-loading"><span class="wh-spot-spinner"></span>${zh ? "正在拉详情…" : "Loading…"}</div>`;
        ctx.requestResize();
        try {
          const vm = await client.pages.workItem(id, { locale: ctx.locale });
          if (disposed || gen !== loadGen) return;
          currentDetail = vm;
          ctx.setSubtitle(vm.workitem.code);
          body.innerHTML = detailHtml(vm, zh);
        } catch {
          if (!disposed && gen === loadGen) {
            retry = () => void showDetail(id);
            body.innerHTML = spotlightErrorHtml(zh, zh ? "详情没拉到" : "Couldn't load");
          }
        }
        ctx.requestResize();
      };

      body.addEventListener("click", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        if (target.closest("[data-spot-retry]")) {
          retry?.();
          return;
        }
        if (target.closest("[data-wi-back]")) {
          void showList();
          return;
        }
        const open = target.closest<HTMLElement>("[data-wi-open]");
        if (open?.dataset.wiOpen) {
          void showDetail(open.dataset.wiOpen);
          return;
        }
        const draft = target.closest<HTMLElement>("[data-wi-create-proposal]");
        if (draft?.dataset.wiCreateProposal && !busy) {
          busy = true;
          const id = draft.dataset.wiCreateProposal;
          draft.textContent = zh ? "生成中…" : "Creating…";
          // 会议洞察 → createMeetingDraftProposal；网盘评论(及其它) → createDriveDraftProposal，与 web 同分流。
          const call = currentDetail?.source_context?.source_type === "meeting_insight"
            ? client.createMeetingDraftProposal(id, { locale: ctx.locale })
            : client.createDriveDraftProposal(id, { locale: ctx.locale });
          void call
            .then(() => ctx.toast(zh ? "已生成变更草稿" : "Proposal draft created", "ok"))
            .catch(() => ctx.toast(zh ? "生成失败，稍后重试" : "Couldn't create draft — retry", "error"))
            .finally(() => {
              busy = false;
              void showDetail(id);
            });
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

      // rank13：深链/托盘带了工作项 id → 直接开详情；否则从列表起。
      if (ctx.target?.id) {
        void showDetail(ctx.target.id);
      } else {
        void showList();
      }
      return () => {
        disposed = true;
      };
    }
  };
}
