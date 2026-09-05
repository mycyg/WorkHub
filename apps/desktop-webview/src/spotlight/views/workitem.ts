// WorkHub 桌面 · Spotlight「工作项」能力内联视图。
// 无全局 work-item 列表端点 → 列表借 pages.attention.background_runs（在跑/排队的工作项，去重）；
// 点开 pages.workItem(id) → 统一玻璃详情（状态/验收/最新改动/AI 轨迹）+ spec_ready 时先生成任务计划给人审。
// 历史/其它工作项从 项目/审批/看改动 进入。list→detail 盒内联 morph。

import type { WorkItemAgentTeamVM, WorkItemDetailVM } from "@workhub/contracts";
import { taskPlanItemRoleLabel, taskPlanItemStatusLabel, taskPlanStatusLabel, uiFormatCny } from "@workhub/ui";
import { publicProposalDisplayTitle } from "@workhub/ui/proposal";
import { escapeHtml, safeHref } from "@workhub/web-runtime";

import { spotlightErrorHtml, type SpotlightCapabilityView, type SpotlightTarget, type SpotlightViewContext } from "../view-context.js";
import { agentStepPhaseLabel, agentStepPublicSummary, workItemPriorityLabel, workItemStatusLabel } from "../labels.js";

import { spotlightViewsT } from "./locales.js";

function taskPlanHtml(vm: WorkItemDetailVM, zh: boolean): string {
  const plan = vm.task_plan;
  if (!plan) {
    return "";
  }
  const locale = zh ? "zh-CN" : "en-US";
  const rows = plan.items.slice(0, 4).map((item, index) => `<div class="wh-spot-trace-step" data-spot-task-plan-item="${escapeHtml(item.id)}">
    <div class="wh-spot-trace-phase">${escapeHtml(`${index + 1}. ${taskPlanItemRoleLabel(locale, item.role)} · ${item.budget_share_pct}%`)}</div>
    <div class="wh-spot-trace-out">${escapeHtml(item.title)}</div>
  </div>`).join("");
  const capped = plan.items_capped
    ? `<div class="wh-spot-change-path" data-spot-task-plan-capped="true">${spotlightViewsT(zh, "showingFirst50Subtasks")}</div>`
    : "";
  return `<div class="wh-spot-change" data-spot-task-plan="true" data-spot-task-plan-status="${escapeHtml(plan.status)}">
    <div class="wh-spot-change-head">
      <span class="wh-spot-chip wh-spot-chip--info">${spotlightViewsT(zh, "taskPlan2")}</span>
      <span class="wh-spot-change-path">${escapeHtml(taskPlanStatusLabel(locale, plan.status))}</span>
    </div>
    <div class="wh-spot-trace">${rows || `<div class="wh-spot-change-path">${spotlightViewsT(zh, "noSubtasksYet")}</div>`}</div>
    ${capped}
  </div>`;
}

// B-R9.6 UX 审计：与 web 同一套状态词表（paused/部分完成/待出发），两端不许各说各话。
function agentTeamTitle(team: WorkItemAgentTeamVM, zh: boolean) {
  const ratio = `${team.completed_count}/${team.total_count}`;
  if (team.status === "done") {
    return team.completed_count < team.total_count
      ? (zh ? `军团部分完成 ${ratio}` : `Agent team partially done ${ratio}`)
      : (zh ? `军团已完成 ${ratio}` : `Agent team completed ${ratio}`);
  }
  if (team.status === "paused") {
    return zh ? `军团已暂停 ${ratio}` : `Agent team paused ${ratio}`;
  }
  if (team.status === "approved") {
    return zh ? `军团待出发 ${ratio}` : `Agent team ready ${ratio}`;
  }
  return zh ? `军团进行中 ${ratio}` : `Agent team in progress ${ratio}`;
}

function agentTeamItemStatusLabel(status: WorkItemAgentTeamVM["items"][number]["status"], zh: boolean) {
  if (status === "needs_human") {
    return spotlightViewsT(zh, "needsDecision");
  }
  return taskPlanItemStatusLabel(zh ? "zh-CN" : "en-US", status);
}

function agentTeamActionTarget(href: string): { view: "replay" | "approvals"; target: SpotlightTarget } | undefined {
  const safe = safeHref(href);
  const replayId = /^\/agent-runs\/([^/?#]+)\/replay$/u.exec(safe)?.[1];
  if (replayId) {
    return { view: "replay", target: { id: decodeURIComponent(replayId), route: safe } };
  }
  if (safe === "/attention") {
    return { view: "approvals", target: { route: safe } };
  }
  return undefined;
}

function agentTeamHtml(vm: WorkItemDetailVM, zh: boolean): string {
  const team = vm.agent_team;
  if (!team) {
    return "";
  }
  const locale = zh ? "zh-CN" : "en-US";
  const rows = team.items.slice(0, 4).map((item) => {
    const action = item.action
      ? `<button type="button" class="wh-spot-chip wh-spot-chip--info ds-pressable" data-spot-agent-team-action="${escapeHtml(item.action.kind)}" data-spot-agent-team-action-href="${escapeHtml(safeHref(item.action.href))}">${escapeHtml(item.action.label)}</button>`
      : "";
    const cost = item.cost_estimate_cny ? `<span class="wh-spot-change-path">${escapeHtml(uiFormatCny(item.cost_estimate_cny))}</span>` : "";
    // UX（规格 §3.1 桌面条款）：行点击 = 盒子内联 morph 到该子 run 轨迹（有 run 才可点）。
    const rowReplay = item.replay_href ? ` data-spot-agent-team-row-replay="${escapeHtml(safeHref(item.replay_href))}"` : "";
    return `<div class="wh-spot-trace-step${item.replay_href ? " ds-pressable" : ""}" data-spot-agent-team-item="${escapeHtml(item.task_plan_item_id)}" data-spot-agent-team-status="${escapeHtml(item.status)}"${rowReplay}>
      <div class="wh-spot-trace-phase">${escapeHtml(`#${item.seq} ${taskPlanItemRoleLabel(locale, item.role)} · ${agentTeamItemStatusLabel(item.status, zh)}`)}</div>
      <div class="wh-spot-trace-out">${escapeHtml(item.title)}</div>
      <div class="wh-spot-change-head">${cost}${action}</div>
    </div>`;
  }).join("");
  const capped = team.runs_capped
    ? `<div class="wh-spot-change-path" data-spot-agent-team-capped="true">${spotlightViewsT(zh, "showingFirst100ChildRuns")}</div>`
    : "";
  return `<div class="wh-spot-change" data-spot-agent-team="true" data-spot-agent-team-status="${escapeHtml(team.status)}">
    <div class="wh-spot-change-head">
      <span class="wh-spot-chip wh-spot-chip--info">${escapeHtml(agentTeamTitle(team, zh))}</span>
      <span class="wh-spot-change-path">${escapeHtml(uiFormatCny(team.cost_used_cny))}</span>
    </div>
    <div class="wh-spot-trace">${rows || `<div class="wh-spot-change-path">${spotlightViewsT(zh, "noChildRunsYet")}</div>`}</div>
    ${capped}
  </div>`;
}

export function detailHtml(vm: WorkItemDetailVM, zh: boolean): string {
  const w = vm.workitem;
  const canDraftTaskPlan =
    w.status === "spec_ready" &&
    !vm.latest_proposal &&
    !vm.task_plan &&
    !vm.agent_team &&
    (vm.agent_trace_preview?.length ?? 0) === 0;
  // #11：从网盘评论/会议洞察生成的工作项带 create_proposal_draft 动作 → 桌面也给「生成变更草稿」入口。
  const createDraft = vm.actions.create_proposal_draft
    ? `<button type="button" class="wh-spot-act wh-spot-act--primary ds-pressable" data-wi-create-proposal="${escapeHtml(w.id)}">${spotlightViewsT(zh, "createProposalDraft")}</button>`
    : "";
  const trace = vm.agent_trace_preview ?? [];
  const traceHtml = trace.length
    ? `<div class="wh-spot-trace">${trace
        .slice(0, 8)
        .map((s) => `<div class="wh-spot-trace-step"><div class="wh-spot-trace-phase">${escapeHtml(agentStepPhaseLabel(s.phase, zh))}</div><div class="wh-spot-trace-out">${escapeHtml(agentStepPublicSummary(s, zh))}</div></div>`)
        .join("")}</div>`
    : "";
  const proposal = vm.latest_proposal
    ? `<div class="wh-spot-change"><div class="wh-spot-change-head"><span class="wh-spot-chip wh-spot-chip--info">${spotlightViewsT(zh, "latestChange")}</span></div><div class="wh-spot-change-sum">${escapeHtml(publicProposalDisplayTitle(vm.latest_proposal.title, zh ? "zh-CN" : "en-US"))}</div></div>`
    : "";
  // B-R9.6 UX 审计（H1 卡位）：同 web——军团活跃/终态渲军团压缩版，否则渲计划快照，不双渲。
  const teamStatuses = new Set(["approved", "dispatching", "paused", "done"]);
  const showTeam = Boolean(vm.agent_team && teamStatuses.has(vm.agent_team.status));
  const taskPlan = showTeam ? "" : taskPlanHtml(vm, zh);
  const agentTeam = showTeam ? agentTeamHtml(vm, zh) : "";
  return `<div class="wh-spot-dash ds-anim-fade-in">
    <button type="button" class="wh-spot-act wh-spot-act--quiet ds-pressable" data-wi-back style="align-self:flex-start">${spotlightViewsT(zh, "back")}</button>
    <div>
      <div class="wh-spot-card-head"><span class="wh-spot-chip wh-spot-chip--approval">${escapeHtml(workItemStatusLabel(w.status, zh))}</span><span class="wh-spot-change-path">${escapeHtml(w.code)}</span></div>
      <h3 class="wh-spot-card-title" style="margin-top:10px">${escapeHtml(w.title ?? w.code)}</h3>
    </div>
    <div class="wh-spot-metrics">
      <div class="wh-spot-metric"><span class="wh-spot-metric-k">${spotlightViewsT(zh, "priority")}</span><span class="wh-spot-metric-v" style="font-size:14px">${escapeHtml(workItemPriorityLabel(w.priority, zh))}</span></div>
      <div class="wh-spot-metric"><span class="wh-spot-metric-k">${spotlightViewsT(zh, "acceptance")}</span><span class="wh-spot-metric-v">${vm.acceptance.length}</span></div>
      <div class="wh-spot-metric"><span class="wh-spot-metric-k">${spotlightViewsT(zh, "deliverables2")}</span><span class="wh-spot-metric-v">${vm.accepted_deliverables.length}</span></div>
    </div>
    ${agentTeam}
    ${taskPlan}
    ${proposal}
    ${traceHtml}
    ${createDraft || canDraftTaskPlan ? `<div class="wh-spot-card-actions">${createDraft}${canDraftTaskPlan ? `<button type="button" class="wh-spot-act wh-spot-act--primary ds-pressable" data-wi-task-plan="${escapeHtml(w.id)}">${spotlightViewsT(zh, "draftTaskPlan")}</button>` : ""}</div>` : ""}
  </div>`;
}

export function workItemListHtml(items: Array<{ id: string; title: string }>, zh: boolean): string {
  if (!items.length) {
    return `<div class="wh-spot-empty"><div class="wh-spot-empty-face">(=･ｪ･=)</div><h3 class="wh-spot-empty-title">${spotlightViewsT(zh, "noActiveWorkItems")}</h3><p class="wh-spot-empty-sub">${spotlightViewsT(zh, "createATaskOrOpenOne")}</p></div>`;
  }
  return `<div class="wh-spot-list ds-stagger">${items
    .map((it) => `<button type="button" class="wh-spot-row" data-wi-open="${escapeHtml(it.id)}" style="cursor:pointer;width:100%;text-align:left"><div class="wh-spot-row-main"><div class="wh-spot-row-title">${escapeHtml(it.title)}</div></div></button>`)
    .join("")}</div>`;
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
        ctx.setSubtitle(spotlightViewsT(ctx.locale, "activeWork"));
        body.innerHTML = `<div class="wh-spot-loading"><span class="wh-spot-spinner"></span>${spotlightViewsT(ctx.locale, "loading3")}</div>`;
        ctx.requestResize();
        try {
          const vm = await client.pages.attention({ locale: ctx.locale });
          if (disposed || gen !== loadGen) return;
          const seen = new Set<string>();
          const items = (vm.background_runs ?? [])
            .filter((r) => r.work_item_id && !seen.has(r.work_item_id) && seen.add(r.work_item_id))
            .map((r) => ({ id: r.work_item_id as string, title: r.title }));
          if (!items.length) {
            body.innerHTML = workItemListHtml([], zh);
          } else {
            ctx.setSubtitle(zh ? `${items.length} 个进行中` : `${items.length} active`);
            body.innerHTML = workItemListHtml(items, zh);
          }
        } catch {
          if (!disposed && gen === loadGen) {
            retry = () => void showList();
            body.innerHTML = spotlightErrorHtml(zh, spotlightViewsT(ctx.locale, "couldnTLoad2"));
          }
        }
        ctx.requestResize();
        // R11（键盘全程）：innerHTML 重渲后焦点掉回 body——交还内容区，Tab 起点可预期。
        ctx.refocusBody();
      };

      const showDetail = async (id: string) => {
        const gen = ++loadGen;
        body.innerHTML = `<div class="wh-spot-loading"><span class="wh-spot-spinner"></span>${spotlightViewsT(ctx.locale, "loading4")}</div>`;
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
            body.innerHTML = spotlightErrorHtml(zh, spotlightViewsT(ctx.locale, "couldnTLoad3"));
          }
        }
        ctx.requestResize();
        // R11（键盘全程）：innerHTML 重渲后焦点掉回 body——交还内容区，Tab 起点可预期。
        ctx.refocusBody();
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
        const agentAction = target.closest<HTMLElement>("[data-spot-agent-team-action-href]");
        if (agentAction?.dataset.spotAgentTeamActionHref) {
          event.preventDefault();
          const actionTarget = agentTeamActionTarget(agentAction.dataset.spotAgentTeamActionHref);
          if (actionTarget) {
            ctx.open(actionTarget.view, actionTarget.target);
          } else {
            ctx.toast(spotlightViewsT(ctx.locale, "thisActionIsNotAvailableHere"), "error");
          }
          return;
        }
        // UX（§3.1 桌面条款）：军团行点击 morph 到子 run 轨迹。
        const teamRow = target.closest<HTMLElement>("[data-spot-agent-team-row-replay]");
        if (teamRow?.dataset.spotAgentTeamRowReplay) {
          event.preventDefault();
          const rowTarget = agentTeamActionTarget(teamRow.dataset.spotAgentTeamRowReplay);
          if (rowTarget) {
            ctx.open(rowTarget.view, rowTarget.target);
          }
          return;
        }
        const draft = target.closest<HTMLElement>("[data-wi-create-proposal]");
        if (draft?.dataset.wiCreateProposal && !busy) {
          busy = true;
          const id = draft.dataset.wiCreateProposal;
          draft.textContent = spotlightViewsT(ctx.locale, "creating2");
          // 会议洞察 → createMeetingDraftProposal；网盘评论(及其它) → createDriveDraftProposal，与 web 同分流。
          const call = currentDetail?.source_context?.source_type === "meeting_insight"
            ? client.createMeetingDraftProposal(id, { locale: ctx.locale })
            : client.createDriveDraftProposal(id, { locale: ctx.locale });
          void call
            .then(() => ctx.toast(spotlightViewsT(ctx.locale, "proposalDraftCreated"), "ok"))
            .catch(() => ctx.toast(spotlightViewsT(ctx.locale, "couldnTCreateDraftRetry"), "error"))
            .finally(() => {
              busy = false;
              void showDetail(id);
            });
          return;
        }
        const taskPlan = target.closest<HTMLElement>("[data-wi-task-plan]");
        if (taskPlan?.dataset.wiTaskPlan && !busy) {
          busy = true;
          const id = taskPlan.dataset.wiTaskPlan;
          taskPlan.textContent = spotlightViewsT(ctx.locale, "draftingPlan");
          let openedProposal = false;
          void client
            .createTaskPlan(id, {}, { locale: ctx.locale })
            .then((result) => {
              ctx.toast(spotlightViewsT(ctx.locale, "taskPlanDraftedReviewItFirst"), "ok");
              ctx.open("proposals", { id: result.proposal_id, route: result.proposal_href });
              openedProposal = true;
            })
            .catch(() => ctx.toast(spotlightViewsT(ctx.locale, "couldnTDraftPlanRetry"), "error"))
            .finally(() => {
              busy = false;
              if (!openedProposal) {
                void showDetail(id);
              }
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
