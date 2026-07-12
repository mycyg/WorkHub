// WorkHub 桌面 · 工作台左栏：项目树 + 军团总览入口 + 新建项目模态。
// 纯 TS DOM，风格照 spotlight/views/*：render* 是可单测的纯函数，mount* 负责拉数据 + 绑事件。

import type { WorkHubApiClient } from "@workhub/api-client";
import type { ProjectListItemVM, WorkbenchPageVM } from "@workhub/contracts";
import { escapeHtml } from "@workhub/web-runtime";

import { workbenchIcons } from "./icons.js";
import type { WorkbenchStore } from "./store.js";

export type WorkbenchRailApiClient = Pick<WorkHubApiClient, "listProjects" | "bootstrapProject" | "pages">;

type Locale = "zh-CN" | "en-US";

function projectInitial(name: string): string {
  const trimmed = name.trim();
  return trimmed ? trimmed[0]!.toUpperCase() : "?";
}

// 项目行下的树叶——批 1 全部只读(没有任何视图能接)。批 2 把主区群聊接进这个窗口后，「主区」升级成
// 真按钮(会话点击路由：点它把焦点交回已经挂载好的 chat composer，见 shell.ts 的 onOpenMainConversation)；
// 批 6 把网盘视图接进这个窗口后，「网盘」同样升级成真按钮(data-wb-open-drive，切中栏到 drive 标签，
// 见 shell.ts 的 onOpenDrive)——.wh-wb-leaf--live 现在挂在两个叶子上。selected 参数标出当前中栏
// 显示哪个标签(sel 高亮跟着走，而不是主区永远高亮)。
function renderProjectTreeLeavesHtml(vm: WorkbenchPageVM, zh: boolean, centerTab: "chat" | "drive"): string {
  const main = vm.conversations.conversations.find((conversation) => conversation.kind === "main");
  const mainLeaf = main
    ? `<button type="button" class="wh-wb-leaf wh-wb-leaf--live${centerTab === "chat" ? " sel" : ""}" data-wb-open-main-chat>${workbenchIcons.chat}<span>${escapeHtml(main.title)}</span>${
        main.next_seq > 0 ? `<span class="wh-wb-leaf-count">${main.next_seq}</span>` : ""
      }</button>`
    : "";
  const fileCount = vm.recent_project_files.items.length;
  const driveLeaf = `<button type="button" class="wh-wb-leaf wh-wb-leaf--live${centerTab === "drive" ? " sel" : ""}" data-wb-open-drive>${workbenchIcons.folder}<span>${zh ? "网盘" : "Drive"}</span>${
    fileCount > 0 ? `<span class="wh-wb-leaf-count">${fileCount}</span>` : ""
  }</button>`;
  return `<div class="wh-wb-tree">${mainLeaf}${driveLeaf}</div>`;
}

export function renderProjectTreeHtml(input: {
  projects: ProjectListItemVM[];
  selectedProjectId: string | undefined;
  vm: WorkbenchPageVM | undefined;
  locale: Locale;
  centerTab?: "chat" | "drive";
}): string {
  const zh = input.locale === "zh-CN";
  const rows = input.projects
    .map((project) => {
      const active = project.id === input.selectedProjectId;
      const leaves = active && input.vm && input.vm.project.id === project.id
        ? renderProjectTreeLeavesHtml(input.vm, zh, input.centerTab ?? "chat")
        : "";
      return `<div class="wh-wb-project${active ? " active" : ""}">
        <button type="button" class="wh-wb-project-row" data-wb-select-project="${escapeHtml(project.id)}" aria-current="${active ? "true" : "false"}">
          <span class="wh-wb-tile">${escapeHtml(projectInitial(project.name))}</span>
          <span class="wh-wb-project-name">${escapeHtml(project.name)}</span>
          ${project.open_work_item_count > 0 ? `<span class="wh-wb-project-dot" title="${zh ? "有进行中工作项" : "Has open work"}"></span>` : ""}
        </button>
        ${leaves}
      </div>`;
    })
    .join("");
  const newProjectRow = `<div class="wh-wb-project">
    <button type="button" class="wh-wb-project-row" data-wb-new-project>
      <span class="wh-wb-tile wh-wb-tile--new">${workbenchIcons.plus}</span>
      <span class="wh-wb-project-name wh-wb-project-name--muted">${zh ? "新建项目" : "New project"}</span>
    </button>
  </div>`;
  return `<div class="wh-wb-rail-head">${zh ? "项目" : "Projects"}</div>${rows}${newProjectRow}`;
}

// 军团总览的真内容(逐 actor 鉴权聚合端点)是批 5 的活；批 1 只给一个诚实的预告条——不渲染成按钮，
// 不给 hover/点击反馈(css.ts 的 .wh-wb-army-sum 没有 cursor:pointer)，免得看起来能点却什么都不做。
export function renderRailFootHtml(zh: boolean, viewerLabel: string | undefined): string {
  return `<div class="wh-wb-rail-foot">
    <div class="wh-wb-army-sum">
      ${workbenchIcons.army}
      <span>
        <span class="wh-wb-army-sum-t">${zh ? "军团总览" : "Army overview"}</span>
        <br /><span class="wh-wb-army-sum-s">${zh ? "批 5 开放" : "Opens in batch 5"}</span>
      </span>
    </div>
    ${viewerLabel ? `<div class="wh-wb-me">${escapeHtml(viewerLabel)}</div>` : ""}
  </div>`;
}

export function renderNewProjectModalHtml(input: {
  locale: Locale;
  open: boolean;
  name: string;
  submitting: boolean;
  error?: string | undefined;
}): string {
  const zh = input.locale === "zh-CN";
  return `<div class="wh-wb-modal-overlay" data-wb-new-project-overlay data-open="${input.open ? "true" : "false"}">
    <div class="wh-wb-modal" role="dialog" aria-modal="true" aria-label="${zh ? "新建项目" : "New project"}">
      <h3 class="wh-wb-modal-title">${zh ? "新建项目" : "New project"}</h3>
      <input
        class="wh-wb-modal-input"
        type="text"
        maxlength="128"
        placeholder="${zh ? "项目名，如：泰诺麦博推广" : "Project name"}"
        data-wb-new-project-name
        value="${escapeHtml(input.name)}"
        ${input.submitting ? "disabled" : ""}
      />
      <p class="wh-wb-modal-note">${
        zh
          ? "创建即自动配好：<b>主区群聊（全员可聊）· 项目网盘 · Cuu 入驻 · 模式默认「分级自动」</b>。成员邀请和权限之后在项目设置里调。"
          : "Creating it wires up <b>a team chat, project drive, and Cuu — mode defaults to \"tiered auto\"</b>. Invite members and adjust permissions later in project settings."
      }</p>
      ${input.error ? `<p class="wh-wb-modal-error">${escapeHtml(input.error)}</p>` : ""}
      <div class="wh-wb-modal-actions">
        <button type="button" class="wh-wb-btn wh-wb-btn--ghost" data-wb-new-project-cancel ${input.submitting ? "disabled" : ""}>${zh ? "取消" : "Cancel"}</button>
        <button type="button" class="wh-wb-btn wh-wb-btn--primary" data-wb-new-project-submit ${input.submitting || !input.name.trim() ? "disabled" : ""}>
          ${input.submitting ? (zh ? "创建中…" : "Creating…") : zh ? "创建项目" : "Create project"}
        </button>
      </div>
    </div>
  </div>`;
}

export type WorkbenchRailHandle = {
  refresh: () => void;
  // 开新建项目模态、重置上一次遗留的输入/错误态。中栏的空态 CTA 也调这个（不是自己拼一份重复逻辑），
  // 不然从中栏重开模态会显示上次在这里输入过又取消的残留文本。
  openNewProjectModal: () => void;
  dispose: () => void;
};

// mount 做五件事：拉项目列表填树 + 选中项目时拉 workbench VM + 新建项目模态提交调真端点 +
// 「主区」/「网盘」树叶点击路由（切 store.centerTab，见 renderProjectTreeLeavesHtml 的注释）。
export function mountWorkbenchRail(
  container: HTMLElement,
  input: {
    client: WorkbenchRailApiClient;
    store: WorkbenchStore;
    locale: Locale;
    onSelectProject: (projectId: string) => void;
    onOpenMainConversation?: () => void;
    onOpenDrive?: () => void;
  }
): WorkbenchRailHandle {
  let modalName = "";
  let modalSubmitting = false;
  let modalError: string | undefined;
  let disposed = false;

  const render = () => {
    if (disposed) {
      return;
    }
    const state = input.store.getState();
    const zh = input.locale === "zh-CN";
    const viewerLabel = state.vm
      ? `${state.vm.workspace_members.items[0]?.nickname ?? ""}${zh ? " · 已连接" : " · connected"}`
      : undefined;
    container.innerHTML = `${renderProjectTreeHtml({
      projects: state.projects,
      selectedProjectId: state.selectedProjectId,
      vm: state.vm,
      locale: input.locale,
      centerTab: state.centerTab
    })}${renderRailFootHtml(zh, viewerLabel)}${renderNewProjectModalHtml({
      locale: input.locale,
      open: state.newProjectModalOpen,
      name: modalName,
      submitting: modalSubmitting,
      error: modalError
    })}`;
  };

  const loadProjects = async () => {
    input.store.setState({ projectsLoad: "loading" });
    try {
      const result = await input.client.listProjects();
      if (disposed) {
        return;
      }
      input.store.setState({ projects: result.projects, projectsLoad: "ready" });
    } catch {
      if (disposed) {
        return;
      }
      input.store.setState({ projectsLoad: "error" });
    }
  };

  const submitNewProject = async () => {
    const name = modalName.trim();
    if (!name || modalSubmitting) {
      return;
    }
    modalSubmitting = true;
    modalError = undefined;
    render();
    try {
      const result = await input.client.bootstrapProject({ name });
      if (disposed) {
        return;
      }
      modalSubmitting = false;
      modalName = "";
      input.store.setState({ newProjectModalOpen: false });
      await loadProjects();
      if (disposed) {
        return;
      }
      input.onSelectProject(result.project.id);
    } catch (error) {
      if (disposed) {
        return;
      }
      modalSubmitting = false;
      modalError =
        error instanceof Error ? error.message : input.locale === "zh-CN" ? "创建失败，请重试" : "Couldn't create the project — retry";
      render();
    }
  };

  const openNewProjectModal = () => {
    modalName = "";
    modalError = undefined;
    input.store.setState({ newProjectModalOpen: true });
  };

  container.addEventListener("click", (event) => {
    if (!(event.target instanceof HTMLElement)) {
      return;
    }
    const target = event.target;
    const selectBtn = target.closest<HTMLElement>("[data-wb-select-project]");
    if (selectBtn?.dataset.wbSelectProject) {
      input.onSelectProject(selectBtn.dataset.wbSelectProject);
      return;
    }
    if (target.closest("[data-wb-new-project]")) {
      openNewProjectModal();
      return;
    }
    if (target.closest("[data-wb-open-main-chat]")) {
      input.onOpenMainConversation?.();
      return;
    }
    if (target.closest("[data-wb-open-drive]")) {
      input.onOpenDrive?.();
      return;
    }
    // 取消按钮，或直接点在遮罩背景上（不是点在模态框内容里冒泡出来的）都关闭模态。
    const clickedOverlayBackdrop = target.hasAttribute("data-wb-new-project-overlay");
    if (target.closest("[data-wb-new-project-cancel]") || clickedOverlayBackdrop) {
      input.store.setState({ newProjectModalOpen: false });
      return;
    }
    if (target.closest("[data-wb-new-project-submit]")) {
      void submitNewProject();
    }
  });

  container.addEventListener("input", (event) => {
    const target = event.target;
    if (target instanceof HTMLInputElement && target.matches("[data-wb-new-project-name]")) {
      modalName = target.value;
      render();
      const input2 = container.querySelector<HTMLInputElement>("[data-wb-new-project-name]");
      // 重渲后把焦点/光标位置还给输入框——innerHTML 重建会丢焦点。
      if (input2) {
        input2.focus();
        const end = input2.value.length;
        try {
          input2.setSelectionRange(end, end);
        } catch {
          // ignore: some input rendering modes reject setSelectionRange.
        }
      }
    }
  });

  const unsubscribe = input.store.subscribe(() => {
    render();
  });
  render();
  void loadProjects();

  return {
    refresh: () => {
      void loadProjects();
    },
    openNewProjectModal,
    dispose: () => {
      disposed = true;
      unsubscribe();
    }
  };
}
