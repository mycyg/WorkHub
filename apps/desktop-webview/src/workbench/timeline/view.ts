// WorkHub 桌面 · 工作台「时间线」标签——imperative 挂载/事件绑定层（照 drive/view.ts 的分工：纯渲染
// 在 render.ts，这里负责拉数据、绑 DOM 事件、维护标签内的瞬态 UI 态：里程碑内联表单草稿、忙态、
// 上一次写动作的人话化错误）。所有写动作都走 E1 已上线的端点（api.ts 薄封装），成功后重拉整页 VM
// （阻塞计数/关键路径是全图派生量，本地增量算不准，重拉最诚实），忙态期间禁用控件给出手感。

import {
  addDependency,
  attachMilestone,
  createMilestone,
  deleteMilestone,
  fetchProjectTimeline,
  humanizeTimelineError,
  removeDependency,
  updateMilestone,
  type TimelineApiClient
} from "./api.js";
import {
  emptyTimelineUiState,
  renderTimelineErrorHtml,
  renderTimelineHtml,
  renderTimelineLoadingHtml,
  type TimelineUiState
} from "./render.js";
import type { ProjectTimelinePageVM } from "@workhub/contracts";

type Locale = "zh-CN" | "en-US";

export type TimelineViewApiClient = TimelineApiClient;

export type TimelineViewHandle = {
  dispose: () => void;
  refresh: () => void;
};

// yyyy-mm-dd（表单 <input type=date>）→ ISO datetime（服务端要带偏移的 datetime）。空串 → null。
function dueInputToIso(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  return `${trimmed}T00:00:00Z`;
}

export function mountTimelineView(
  container: HTMLElement,
  input: {
    client: TimelineViewApiClient;
    locale: Locale;
    projectId: string;
    projectName: string;
  }
): TimelineViewHandle {
  let disposed = false;
  let vm: ProjectTimelinePageVM | undefined;
  let vmLoad: "loading" | "ready" | "error" = "loading";
  let ui: TimelineUiState = emptyTimelineUiState();
  let loadGeneration = 0;

  const zh = input.locale === "zh-CN";

  function render(): void {
    if (disposed) {
      return;
    }
    if (vmLoad === "loading" && !vm) {
      container.innerHTML = renderTimelineLoadingHtml(input.locale);
      return;
    }
    if (vmLoad === "error" || !vm) {
      container.innerHTML = renderTimelineErrorHtml(input.locale);
      return;
    }
    container.innerHTML = renderTimelineHtml({ vm, locale: input.locale, ui });
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

  // 写动作统一包裹：置忙 → 跑 → 成功重拉整页并清表单/错误 → 失败人话化错误并解除忙态。单调代次守卫
  // 避免晚到的重拉覆盖后续动作。
  async function runWrite(action: () => Promise<unknown>, options: { closeForm?: boolean } = {}): Promise<void> {
    if (ui.busy) {
      return;
    }
    ui = { ...ui, busy: true, error: undefined };
    render();
    try {
      await action();
      if (disposed) {
        return;
      }
      // 成功：先解除忙态、按需关表单，再重拉（load 自己会重渲）。
      ui = options.closeForm
        ? { ...ui, busy: false, error: undefined, milestoneForm: undefined, draftTitle: "", draftDue: "" }
        : { ...ui, busy: false, error: undefined };
      await load();
    } catch (error) {
      if (disposed) {
        return;
      }
      ui = { ...ui, busy: false, error: humanizeTimelineError(error, input.locale) };
      render();
    }
  }

  function readMilestoneDraft(): { title: string; due: string } {
    const titleEl = container.querySelector<HTMLInputElement>("[data-wb-tl-mform-title]");
    const dueEl = container.querySelector<HTMLInputElement>("[data-wb-tl-mform-due]");
    return { title: titleEl?.value.trim() ?? "", due: dueEl?.value ?? "" };
  }

  function submitMilestoneForm(): void {
    const draft = readMilestoneDraft();
    if (!draft.title) {
      ui = { ...ui, error: zh ? "里程碑名称不能为空。" : "Milestone name can't be empty." };
      render();
      return;
    }
    const form = ui.milestoneForm;
    if (form?.mode === "edit") {
      void runWrite(
        () => updateMilestone(input.client, input.projectId, form.milestoneId, { title: draft.title, due_at: dueInputToIso(draft.due) }),
        { closeForm: true }
      );
    } else {
      void runWrite(
        () => createMilestone(input.client, input.projectId, { title: draft.title, due_at: dueInputToIso(draft.due) }),
        { closeForm: true }
      );
    }
  }

  function focusRow(itemId: string): void {
    const row = container.querySelector<HTMLElement>(`[data-wb-tl-row="${CSS.escape(itemId)}"]`);
    if (!row) {
      return;
    }
    row.scrollIntoView({ block: "center", behavior: "smooth" });
    row.classList.add("wh-wb-tl-row--flash");
    window.setTimeout(() => row.classList.remove("wh-wb-tl-row--flash"), 1400);
  }

  container.addEventListener("click", (event) => {
    if (!(event.target instanceof HTMLElement)) {
      return;
    }
    const target = event.target;

    if (target.closest("[data-wb-tl-retry]")) {
      void load();
      return;
    }
    const focusChip = target.closest<HTMLElement>("[data-wb-tl-focus-item]");
    if (focusChip?.dataset.wbTlFocusItem) {
      focusRow(focusChip.dataset.wbTlFocusItem);
      return;
    }
    if (target.closest("[data-wb-tl-new-milestone]")) {
      ui = { ...ui, milestoneForm: { mode: "create" }, draftTitle: "", draftDue: "", error: undefined };
      render();
      focusMilestoneTitle();
      return;
    }
    if (target.closest("[data-wb-tl-mform-cancel]")) {
      ui = { ...ui, milestoneForm: undefined, draftTitle: "", draftDue: "", error: undefined };
      render();
      return;
    }
    if (target.closest("[data-wb-tl-mform-save]")) {
      // form submit 也会触发；按钮是 type=submit，交给 submit 处理，避免双跑。
      return;
    }
    const editBtn = target.closest<HTMLElement>("[data-wb-tl-medit]");
    if (editBtn?.dataset.wbTlMedit && vm) {
      const milestone = vm.milestones.find((m) => m.id === editBtn.dataset.wbTlMedit);
      if (milestone) {
        ui = {
          ...ui,
          milestoneForm: { mode: "edit", milestoneId: milestone.id },
          draftTitle: milestone.title,
          draftDue: milestone.due_at ? milestone.due_at.slice(0, 10) : "",
          error: undefined
        };
        render();
        focusMilestoneTitle();
      }
      return;
    }
    const toggleBtn = target.closest<HTMLElement>("[data-wb-tl-mtoggle]");
    if (toggleBtn?.dataset.wbTlMtoggle) {
      const milestoneId = toggleBtn.dataset.wbTlMtoggle;
      const nextStatus = toggleBtn.dataset.wbTlMstatus === "done" ? "open" : "done";
      void runWrite(() => updateMilestone(input.client, input.projectId, milestoneId, { status: nextStatus }));
      return;
    }
    const deleteBtn = target.closest<HTMLElement>("[data-wb-tl-mdelete]");
    if (deleteBtn?.dataset.wbTlMdelete) {
      const milestoneId = deleteBtn.dataset.wbTlMdelete;
      const ok = container.ownerDocument?.defaultView?.confirm(
        zh ? "删除这个里程碑？挂在它下面的工作项会变回未挂里程碑。" : "Delete this milestone? Its work items go back to unassigned."
      );
      if (ok) {
        void runWrite(() => deleteMilestone(input.client, input.projectId, milestoneId));
      }
      return;
    }
    const depX = target.closest<HTMLElement>("[data-wb-tl-dep-remove]");
    if (depX?.dataset.wbTlDepRemove && depX.dataset.wbTlDepOn) {
      const itemId = depX.dataset.wbTlDepRemove;
      const dependsOn = depX.dataset.wbTlDepOn;
      void runWrite(() => removeDependency(input.client, itemId, dependsOn));
      return;
    }
  });

  container.addEventListener("submit", (event) => {
    if (event.target instanceof HTMLElement && event.target.closest("[data-wb-tl-mform]")) {
      event.preventDefault();
      submitMilestoneForm();
    }
  });

  container.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement)) {
      return;
    }
    const attachId = target.dataset.wbTlAttach;
    if (attachId) {
      const milestoneId = target.value || null;
      void runWrite(() => attachMilestone(input.client, attachId, milestoneId));
      return;
    }
    const depAddId = target.dataset.wbTlDepAdd;
    if (depAddId && target.value) {
      const dependsOn = target.value;
      void runWrite(() => addDependency(input.client, depAddId, dependsOn));
      return;
    }
  });

  function focusMilestoneTitle(): void {
    const titleEl = container.querySelector<HTMLInputElement>("[data-wb-tl-mform-title]");
    titleEl?.focus();
  }

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
