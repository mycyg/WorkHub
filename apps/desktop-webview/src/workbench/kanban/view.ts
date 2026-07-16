// WorkHub 桌面 · 工作台「任务看板」标签——imperative 挂载 / 事件绑定层（照 timeline/view.ts 的分工：
// 纯渲染在 render.ts，这里负责拉数据、绑 DOM 事件、维护标签内的瞬态 UI 态：拖拽在途忙态、上一次拖拽的
// 人话提示）。数据复用 E1 时间线 VM；唯一写动作（派发 AI）走 api.ts 薄封装，成功后重拉整页 VM（状态由
// 服务端权威回流，本地不猜）。拖拽的状态机映射由 render.ts 的 resolveKanbanDrop 纯函数裁决：不合法的
// 移动弹回（DOM 不动）+ toast 人话说明，绝不假接线。

import { dispatchWorkItem, fetchProjectTimeline, humanizeKanbanError, type KanbanApiClient } from "./api.js";
import {
  columnOfStatus,
  emptyKanbanUiState,
  renderKanbanErrorHtml,
  renderKanbanHtml,
  renderKanbanLoadingHtml,
  resolveKanbanDrop,
  type KanbanColumn,
  type KanbanUiState
} from "./render.js";
import type { ProjectTimelinePageVM, WorkItemStatus } from "@workhub/contracts";

type Locale = "zh-CN" | "en-US";

export type KanbanViewApiClient = KanbanApiClient;

export type KanbanViewHandle = {
  dispose: () => void;
  refresh: () => void;
};

type DragState = { id: string; status: WorkItemStatus; fromColumn: KanbanColumn };

export function mountKanbanView(
  container: HTMLElement,
  input: {
    client: KanbanViewApiClient;
    locale: Locale;
    projectId: string;
    projectName: string;
    // 点击卡片 → 跳到时间线并定位到这一行（shell.ts 接成切 centerTab=timeline + 挂起该行焦点）。
    onOpenTimelineRow?: (workItemId: string) => void;
  }
): KanbanViewHandle {
  let disposed = false;
  let vm: ProjectTimelinePageVM | undefined;
  let vmLoad: "loading" | "ready" | "error" = "loading";
  let ui: KanbanUiState = emptyKanbanUiState();
  let loadGeneration = 0;
  let dragging: DragState | undefined;
  let noticeTimer: ReturnType<typeof setTimeout> | undefined;

  const zh = input.locale === "zh-CN";
  const view = container.ownerDocument?.defaultView ?? undefined;

  function clearNoticeTimer(): void {
    if (noticeTimer) {
      clearTimeout(noticeTimer);
      noticeTimer = undefined;
    }
  }

  function render(): void {
    if (disposed) {
      return;
    }
    if (vmLoad === "loading" && !vm) {
      container.innerHTML = renderKanbanLoadingHtml(input.locale);
      return;
    }
    if (vmLoad === "error" || !vm) {
      container.innerHTML = renderKanbanErrorHtml(input.locale);
      return;
    }
    container.innerHTML = renderKanbanHtml({ vm, locale: input.locale, ui });
  }

  function showNotice(message: string, tone: "info" | "error"): void {
    clearNoticeTimer();
    ui = { ...ui, notice: message, noticeTone: tone };
    render();
    // 人话提示是瞬态的——几秒后自动消，不长期占顶。
    noticeTimer = setTimeout(() => {
      if (disposed) {
        return;
      }
      ui = { ...ui, notice: undefined, noticeTone: undefined };
      render();
    }, 6000);
  }

  async function load(): Promise<void> {
    const generation = ++loadGeneration;
    vmLoad = "loading";
    render();
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
    }
  }

  // 派发 AI：置忙 → 跑 → 成功清提示并重拉整页（状态权威回流）→ 失败人话化错误并解除忙态。
  async function runDispatch(workItemId: string): Promise<void> {
    if (ui.busy) {
      return;
    }
    clearNoticeTimer();
    ui = { ...ui, busy: true, notice: undefined, noticeTone: undefined };
    render();
    try {
      await dispatchWorkItem(input.client, workItemId);
      if (disposed) {
        return;
      }
      ui = { ...ui, busy: false };
      await load();
    } catch (error) {
      if (disposed) {
        return;
      }
      ui = { ...ui, busy: false };
      showNotice(humanizeKanbanError(error, input.locale), "error");
    }
  }

  function handleDrop(toColumn: KanbanColumn): void {
    const drag = dragging;
    dragging = undefined;
    if (!drag || ui.busy) {
      return;
    }
    const resolution = resolveKanbanDrop({
      status: drag.status,
      fromColumn: drag.fromColumn,
      toColumn,
      locale: input.locale
    });
    if (resolution.kind === "noop") {
      return;
    }
    if (resolution.kind === "bounce") {
      showNotice(resolution.message, "info");
      return;
    }
    // dispatch：真实端点，consequential（启动 AI、耗预算）——先确认。
    const item = vm?.items.find((candidate) => candidate.id === drag.id);
    const title = item?.title ?? "";
    const ok = view?.confirm(
      zh
        ? `把「${title}」派给 AI 开工？会启动一次 AI 执行（消耗预算）。`
        : `Start the AI on “${title}”? This launches an AI run (uses budget).`
    );
    if (ok) {
      void runDispatch(drag.id);
    }
  }

  // —— 事件委托：DnD 事件都冒泡，统一挂在容器上，innerHTML 重渲后无需重新绑卡片监听 ——
  container.addEventListener("dragstart", (event) => {
    if (!(event.target instanceof HTMLElement)) {
      return;
    }
    const card = event.target.closest<HTMLElement>("[data-wb-kb-card]");
    if (!card || !card.dataset.wbKbId || ui.busy) {
      return;
    }
    dragging = {
      id: card.dataset.wbKbId,
      status: (card.dataset.wbKbStatus ?? "intake") as WorkItemStatus,
      fromColumn: (card.dataset.wbKbFrom ?? "todo") as KanbanColumn
    };
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      // 有些平台不设 data 就不触发 drop——放一个无害的载荷。
      event.dataTransfer.setData("text/plain", card.dataset.wbKbId);
    }
    card.classList.add("wh-wb-kb-card--dragging");
  });

  container.addEventListener("dragend", (event) => {
    if (event.target instanceof HTMLElement) {
      event.target.closest<HTMLElement>("[data-wb-kb-card]")?.classList.remove("wh-wb-kb-card--dragging");
    }
    dragging = undefined;
    container.querySelectorAll(".wh-wb-kb-col-list--over").forEach((el) => el.classList.remove("wh-wb-kb-col-list--over"));
  });

  container.addEventListener("dragover", (event) => {
    if (!dragging || !(event.target instanceof HTMLElement)) {
      return;
    }
    const list = event.target.closest<HTMLElement>("[data-wb-kb-col]");
    if (!list) {
      return;
    }
    // 必须 preventDefault 才会触发 drop。
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "move";
    }
    if (!list.classList.contains("wh-wb-kb-col-list--over")) {
      container.querySelectorAll(".wh-wb-kb-col-list--over").forEach((el) => el.classList.remove("wh-wb-kb-col-list--over"));
      list.classList.add("wh-wb-kb-col-list--over");
    }
  });

  container.addEventListener("dragleave", (event) => {
    if (!(event.target instanceof HTMLElement)) {
      return;
    }
    const list = event.target.closest<HTMLElement>("[data-wb-kb-col]");
    // 只有真正离开这个列容器（relatedTarget 不在其内）才摘高亮，避免掠过子元素时闪烁。
    if (list && event.relatedTarget instanceof Node && !list.contains(event.relatedTarget)) {
      list.classList.remove("wh-wb-kb-col-list--over");
    }
  });

  container.addEventListener("drop", (event) => {
    if (!(event.target instanceof HTMLElement)) {
      return;
    }
    const list = event.target.closest<HTMLElement>("[data-wb-kb-col]");
    if (!list || !list.dataset.wbKbCol) {
      return;
    }
    event.preventDefault();
    list.classList.remove("wh-wb-kb-col-list--over");
    handleDrop(list.dataset.wbKbCol as KanbanColumn);
  });

  container.addEventListener("click", (event) => {
    if (!(event.target instanceof HTMLElement)) {
      return;
    }
    const target = event.target;
    if (target.closest("[data-wb-kb-retry]")) {
      void load();
      return;
    }
    const card = target.closest<HTMLElement>("[data-wb-kb-card]");
    if (card?.dataset.wbKbId) {
      input.onOpenTimelineRow?.(card.dataset.wbKbId);
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
    const card = event.target.closest<HTMLElement>("[data-wb-kb-card]");
    if (card?.dataset.wbKbId) {
      event.preventDefault();
      input.onOpenTimelineRow?.(card.dataset.wbKbId);
    }
  });

  void load();

  return {
    dispose: () => {
      disposed = true;
      clearNoticeTimer();
    },
    refresh: () => {
      void load();
    }
  };
}

// 便于外部（如 shell 深链）判断某状态该落哪列——重导出纯函数，不重复实现。
export { columnOfStatus };
