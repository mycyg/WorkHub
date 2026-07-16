// WorkHub 桌面 · 工作台「日程」标签——imperative 挂载 / 事件绑定层（照 timeline/view.ts 的分工：纯渲染
// 在 render.ts，这里负责拉数据、绑 DOM 事件、维护标签内的瞬态 UI 态）。
//   右栏周历：纯只读，复用 E1 时间线 VM（切周只改本地 weekOffset 重渲，不重新取数）。
//   左栏项目计划（G4 #9，E3 双端入口）：能管项目的人可「用 Cuu 起草计划」→ 生成草案 → 列表/详情 →
//     批准 / 驳回（带理由）/ 物化。写动作走 project-planner 五端点；无管理权（草案 GET 403）时左栏退回
//     里程碑回落、不给起草假入口（04 §4 铁律 3）。物化成功后重拉时间线，新里程碑/工作项立即落到周历上。

import { WorkHubApiError } from "@workhub/api-client";

import {
  approvePlanDraft,
  createPlanDraft,
  fetchPlanDrafts,
  fetchProjectTimeline,
  materializePlanDraft,
  rejectPlanDraft,
  type ScheduleApiClient,
  type SchedulePlanDraft
} from "./api.js";
import {
  emptyScheduleUiState,
  emptySchedulePlanUiState,
  renderScheduleErrorHtml,
  renderScheduleHtml,
  renderScheduleLoadingHtml,
  type SchedulePlanDraftsState,
  type SchedulePlanUiState,
  type ScheduleUiState
} from "./render.js";
import type { ProjectTimelinePageVM } from "@workhub/contracts";

type Locale = "zh-CN" | "en-US";

export type ScheduleViewApiClient = ScheduleApiClient;

export type ScheduleViewHandle = {
  dispose: () => void;
  refresh: () => void;
};

export function mountScheduleView(
  container: HTMLElement,
  input: {
    client: ScheduleViewApiClient;
    locale: Locale;
    projectId: string;
    projectName: string;
    // 点击日程卡片 → 跳到时间线并定位到这一行（shell.ts 接成切 centerTab=timeline + 挂起该行焦点）。
    onOpenTimelineRow?: (workItemId: string) => void;
  }
): ScheduleViewHandle {
  const zh = input.locale === "zh-CN";
  let disposed = false;
  let vm: ProjectTimelinePageVM | undefined;
  let drafts: SchedulePlanDraft[] = [];
  let draftsState: SchedulePlanDraftsState = "loading";
  let vmLoad: "loading" | "ready" | "error" = "loading";
  let ui: ScheduleUiState = emptyScheduleUiState();
  let plan: SchedulePlanUiState = emptySchedulePlanUiState();
  let loadGeneration = 0;

  function render(): void {
    if (disposed) {
      return;
    }
    if (vmLoad === "loading" && !vm) {
      container.innerHTML = renderScheduleLoadingHtml(input.locale);
      return;
    }
    if (vmLoad === "error" || !vm) {
      container.innerHTML = renderScheduleErrorHtml(input.locale);
      return;
    }
    container.innerHTML = renderScheduleHtml({ vm, drafts, draftsState, plan, locale: input.locale, ui });
  }

  // 拉草案：成功＝能管项目（ready）；403＝无管理权（forbidden，退回里程碑回落）；其它错误也降级成 forbidden
  // （不给假入口，不报错拖垮日程）。
  async function loadDrafts(generation: number): Promise<void> {
    try {
      const list = await fetchPlanDrafts(input.client, input.projectId, input.locale);
      if (disposed || generation !== loadGeneration) {
        return;
      }
      drafts = list;
      draftsState = "ready";
    } catch {
      if (disposed || generation !== loadGeneration) {
        return;
      }
      drafts = [];
      draftsState = "forbidden";
    }
  }

  async function load(): Promise<void> {
    const generation = ++loadGeneration;
    vmLoad = "loading";
    draftsState = "loading";
    render();
    // 周历 VM 是主数据（失败＝整页 error）；计划草案是左栏（失败＝降级 forbidden）。并行发车。
    const draftsPromise = loadDrafts(generation);
    try {
      const page = await fetchProjectTimeline(input.client, input.projectId, input.locale);
      if (disposed || generation !== loadGeneration) {
        return;
      }
      vm = page;
      vmLoad = "ready";
      render();
    } catch {
      if (disposed || generation !== loadGeneration) {
        return;
      }
      vmLoad = "error";
      render();
      return;
    }
    await draftsPromise;
    if (disposed || generation !== loadGeneration) {
      return;
    }
    render();
  }

  // 重拉草案（审批/驳回后用；不动周历 VM）。保持当前 plan mode/selection。
  async function reloadDrafts(): Promise<void> {
    const generation = loadGeneration;
    try {
      const list = await fetchPlanDrafts(input.client, input.projectId, input.locale);
      if (disposed || generation !== loadGeneration) {
        return;
      }
      drafts = list;
      draftsState = "ready";
    } catch {
      // 保持现有 drafts（这是审批后的重拉，权限不该突然消失；失败就沿用上一份）。
    }
  }

  function apiErrorText(error: unknown, fallback: string): string {
    if (error instanceof WorkHubApiError && error.message) {
      return error.message;
    }
    return fallback;
  }

  function shiftWeek(delta: number): void {
    ui = { ...ui, weekOffset: ui.weekOffset + delta };
    render();
  }

  function goToday(): void {
    if (ui.weekOffset === 0) {
      return;
    }
    ui = { ...ui, weekOffset: 0 };
    render();
  }

  // —— 计划草案动作 —— //

  function openCompose(): void {
    plan = { ...plan, mode: "compose", intentDraft: "", error: undefined, notice: undefined };
    render();
  }

  function cancelCompose(): void {
    plan = { ...plan, mode: "list", error: undefined };
    render();
  }

  function submitCompose(): void {
    if (plan.busy) {
      return;
    }
    const textarea = container.querySelector<HTMLTextAreaElement>("[data-wb-sc-plan-compose-intent]");
    const intent = (textarea?.value ?? "").trim();
    if (!intent) {
      plan = { ...plan, error: zh ? "请先填写规划意图。" : "Please describe the planning intent first." };
      render();
      return;
    }
    plan = { ...plan, busy: true, intentDraft: intent, error: undefined, notice: undefined };
    render();
    void createPlanDraft(input.client, input.projectId, intent, input.locale)
      .then(async (created) => {
        if (disposed) {
          return;
        }
        await reloadDrafts();
        if (disposed) {
          return;
        }
        plan = {
          ...plan,
          busy: false,
          mode: "detail",
          selectedDraftId: created.id,
          intentDraft: "",
          notice: zh ? "草案已生成，待你审批。" : "Draft created — ready for your review.",
          error: undefined
        };
        render();
      })
      .catch((error: unknown) => {
        if (disposed) {
          return;
        }
        // 503（LLM 未配置）/409（需人细化）等，服务端 message 已是人话，直接透传。
        plan = { ...plan, busy: false, error: apiErrorText(error, zh ? "起草失败，稍后重试。" : "Couldn't draft — try again later.") };
        render();
      });
  }

  function openDraft(draftId: string): void {
    plan = { ...plan, mode: "detail", selectedDraftId: draftId, rejecting: false, error: undefined, notice: undefined };
    render();
  }

  function backToList(): void {
    plan = { ...plan, mode: "list", selectedDraftId: undefined, rejecting: false, error: undefined };
    render();
  }

  function approveSelected(): void {
    if (plan.busy || !plan.selectedDraftId) {
      return;
    }
    const draftId = plan.selectedDraftId;
    plan = { ...plan, busy: true, error: undefined, notice: undefined };
    render();
    void approvePlanDraft(input.client, draftId, input.locale)
      .then(async () => {
        if (disposed) {
          return;
        }
        await reloadDrafts();
        if (disposed) {
          return;
        }
        plan = { ...plan, busy: false, notice: zh ? "已批准，可物化到时间线。" : "Approved — you can materialize it to the timeline." };
        render();
      })
      .catch((error: unknown) => {
        if (disposed) {
          return;
        }
        plan = { ...plan, busy: false, error: apiErrorText(error, zh ? "批准失败，稍后重试。" : "Couldn't approve — try again.") };
        render();
      });
  }

  function openReject(): void {
    plan = { ...plan, rejecting: true, rejectDraft: "", error: undefined, notice: undefined };
    render();
  }

  function cancelReject(): void {
    plan = { ...plan, rejecting: false, error: undefined };
    render();
  }

  function confirmReject(): void {
    if (plan.busy || !plan.selectedDraftId) {
      return;
    }
    const textarea = container.querySelector<HTMLTextAreaElement>("[data-wb-sc-plan-reject-reason]");
    const reason = (textarea?.value ?? "").trim();
    if (!reason) {
      plan = { ...plan, error: zh ? "驳回需要填写理由。" : "A reason is required to reject." };
      render();
      return;
    }
    const draftId = plan.selectedDraftId;
    plan = { ...plan, busy: true, rejectDraft: reason, error: undefined, notice: undefined };
    render();
    void rejectPlanDraft(input.client, draftId, reason, input.locale)
      .then(async () => {
        if (disposed) {
          return;
        }
        await reloadDrafts();
        if (disposed) {
          return;
        }
        plan = { ...plan, busy: false, rejecting: false, rejectDraft: "", notice: zh ? "已驳回，理由会带入下一次重拟。" : "Rejected — the reason feeds the next redraft." };
        render();
      })
      .catch((error: unknown) => {
        if (disposed) {
          return;
        }
        plan = { ...plan, busy: false, error: apiErrorText(error, zh ? "驳回失败，稍后重试。" : "Couldn't reject — try again.") };
        render();
      });
  }

  function materializeSelected(): void {
    if (plan.busy || !plan.selectedDraftId) {
      return;
    }
    const draftId = plan.selectedDraftId;
    plan = { ...plan, busy: true, error: undefined, notice: undefined };
    render();
    void materializePlanDraft(input.client, draftId, input.locale)
      .then(async (outcome) => {
        if (disposed) {
          return;
        }
        // 物化后周历要显新里程碑/工作项——重拉时间线 VM + 草案。
        try {
          const page = await fetchProjectTimeline(input.client, input.projectId, input.locale);
          if (!disposed) {
            vm = page;
          }
        } catch {
          // 时间线重拉失败不阻断——草案状态已更新，周历沿用旧数据（下次进标签会刷新）。
        }
        await reloadDrafts();
        if (disposed) {
          return;
        }
        const r = outcome.result;
        plan = {
          ...plan,
          busy: false,
          notice: zh
            ? `已物化到时间线：${r.milestone_ids.length} 里程碑 · ${r.work_item_ids.length} 工作项。`
            : `Materialized: ${r.milestone_ids.length} milestones · ${r.work_item_ids.length} items.`
        };
        render();
      })
      .catch((error: unknown) => {
        if (disposed) {
          return;
        }
        plan = { ...plan, busy: false, error: apiErrorText(error, zh ? "物化失败，稍后重试。" : "Couldn't materialize — try again.") };
        render();
      });
  }

  // 起草表单是 <form>，拦截原生 submit（否则会触发导航）。
  container.addEventListener("submit", (event) => {
    if (event.target instanceof HTMLElement && event.target.closest("[data-wb-sc-plan-compose]")) {
      event.preventDefault();
      submitCompose();
    }
  });

  container.addEventListener("click", (event) => {
    if (!(event.target instanceof HTMLElement)) {
      return;
    }
    const target = event.target;
    // 周历控件（沿用原行为）。
    if (target.closest("[data-wb-sc-retry]")) {
      void load();
      return;
    }
    if (target.closest("[data-wb-sc-prev]")) {
      shiftWeek(-1);
      return;
    }
    if (target.closest("[data-wb-sc-next]")) {
      shiftWeek(1);
      return;
    }
    if (target.closest("[data-wb-sc-today]")) {
      goToday();
      return;
    }
    // 计划草案控件。
    if (target.closest("[data-wb-sc-plan-new]")) {
      openCompose();
      return;
    }
    if (target.closest("[data-wb-sc-plan-compose-submit]")) {
      submitCompose();
      return;
    }
    if (target.closest("[data-wb-sc-plan-compose-cancel]")) {
      cancelCompose();
      return;
    }
    if (target.closest("[data-wb-sc-plan-back]")) {
      backToList();
      return;
    }
    if (target.closest("[data-wb-sc-plan-approve]")) {
      approveSelected();
      return;
    }
    if (target.closest("[data-wb-sc-plan-reject-confirm]")) {
      confirmReject();
      return;
    }
    if (target.closest("[data-wb-sc-plan-reject-cancel]")) {
      cancelReject();
      return;
    }
    if (target.closest("[data-wb-sc-plan-reject]")) {
      openReject();
      return;
    }
    if (target.closest("[data-wb-sc-plan-materialize]")) {
      materializeSelected();
      return;
    }
    const draftRow = target.closest<HTMLElement>("[data-wb-sc-plan-draft]");
    if (draftRow?.dataset.wbScPlanDraft) {
      openDraft(draftRow.dataset.wbScPlanDraft);
      return;
    }
    // 周历卡片点击 → 跳时间线。
    const card = target.closest<HTMLElement>("[data-wb-sc-card]");
    if (card?.dataset.wbScId) {
      input.onOpenTimelineRow?.(card.dataset.wbScId);
    }
  });

  // 键盘可达：周历卡片与草案行都是 role=button tabindex=0，回车/空格等同点击。
  container.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }
    if (!(event.target instanceof HTMLElement)) {
      return;
    }
    const draftRow = event.target.closest<HTMLElement>("[data-wb-sc-plan-draft]");
    if (draftRow?.dataset.wbScPlanDraft) {
      event.preventDefault();
      openDraft(draftRow.dataset.wbScPlanDraft);
      return;
    }
    const card = event.target.closest<HTMLElement>("[data-wb-sc-card]");
    if (card?.dataset.wbScId) {
      event.preventDefault();
      input.onOpenTimelineRow?.(card.dataset.wbScId);
    }
  });

  void load();

  return {
    dispose: () => {
      disposed = true;
    },
    refresh: () => {
      void load();
    }
  };
}
