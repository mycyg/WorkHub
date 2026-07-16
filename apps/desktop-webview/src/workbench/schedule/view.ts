// WorkHub 桌面 · 工作台「日程」标签——imperative 挂载 / 事件绑定层（照 timeline/view.ts 的分工：纯渲染
// 在 render.ts，这里负责拉数据、绑 DOM 事件、维护标签内的瞬态 UI 态：本周偏移）。纯只读——数据复用 E1
// 时间线 VM（右栏周历）+ E3 计划草案（左栏摘要，取不到静默降级），没有任何写动作（工作项创建走 intake
// 现状，日程不造旁路）。周历切周只改本地 weekOffset 重渲，不重新取数（VM 已含全部工作项/里程碑）。

import {
  fetchLatestSettledPlanDraft,
  fetchProjectTimeline,
  type ScheduleApiClient,
  type SchedulePlanDraft
} from "./api.js";
import {
  emptyScheduleUiState,
  renderScheduleErrorHtml,
  renderScheduleHtml,
  renderScheduleLoadingHtml,
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
  let disposed = false;
  let vm: ProjectTimelinePageVM | undefined;
  let planDraft: SchedulePlanDraft | undefined;
  let vmLoad: "loading" | "ready" | "error" = "loading";
  let ui: ScheduleUiState = emptyScheduleUiState();
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
    container.innerHTML = renderScheduleHtml({ vm, planDraft, locale: input.locale, ui });
  }

  async function load(): Promise<void> {
    const generation = ++loadGeneration;
    vmLoad = "loading";
    render();
    // 周历 VM 是主数据（失败＝整页 error）；计划草案是次要装饰（失败＝静默降级，左栏回落里程碑）。
    // 并行发车，各自处理。
    const planPromise = fetchLatestSettledPlanDraft(input.client, input.projectId, input.locale);
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
    // 计划草案回来后补渲左栏（fetchLatestSettledPlanDraft 内部已吞错回 undefined，这里不再 try）。
    const draft = await planPromise;
    if (disposed || generation !== loadGeneration) {
      return;
    }
    planDraft = draft;
    render();
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

  container.addEventListener("click", (event) => {
    if (!(event.target instanceof HTMLElement)) {
      return;
    }
    const target = event.target;
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
    const card = target.closest<HTMLElement>("[data-wb-sc-card]");
    if (card?.dataset.wbScId) {
      input.onOpenTimelineRow?.(card.dataset.wbScId);
    }
  });

  // 键盘可达：卡片是 role=button tabindex=0，回车/空格等同点击（跳时间线）。
  container.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }
    if (!(event.target instanceof HTMLElement)) {
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
