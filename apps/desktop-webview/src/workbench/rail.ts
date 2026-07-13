// WorkHub 桌面 · 工作台左栏：项目树 + 军团总览入口 + 新建项目模态。
// 纯 TS DOM，风格照 spotlight/views/*：render* 是可单测的纯函数，mount* 负责拉数据 + 绑事件。

import type { WorkHubApiClient } from "@workhub/api-client";
import type { CreateConversationResultVM, ProjectListItemVM, WorkbenchPageVM } from "@workhub/contracts";
import { escapeHtml } from "@workhub/web-runtime";

import { workbenchIcons } from "./icons.js";
import type { WorkbenchCenterTab, WorkbenchStore } from "./store.js";

// R13 批 P2（拍板链路收尾）：协同会话「+ 新建」真按钮需要 client.request——同 chat/api.ts 顶部注释的
// 既有取舍(不为一个批次特性扩大 WorkHubApiClient 具名方法面，POST /projects/:id/conversations 走
// client.request 而不是新增具名方法)。
export type WorkbenchRailApiClient = Pick<WorkHubApiClient, "listProjects" | "bootstrapProject" | "pages" | "request">;

type Locale = "zh-CN" | "en-US";

type WorkbenchConversationVM = WorkbenchPageVM["conversations"]["conversations"][number];

// 原型的多项目辨识度:每个项目一个稳定色块(accent/success/warn/cuu 四色,按 id 哈希),同 id 永远同色。
export function tileVariantClass(projectId: string): string {
  let hash = 0;
  for (let i = 0; i < projectId.length; i += 1) {
    hash = (hash * 31 + projectId.charCodeAt(i)) >>> 0;
  }
  const variants = ["", "wh-wb-tile--ok", "wh-wb-tile--warn", "wh-wb-tile--cuu"];
  return variants[hash % variants.length] ?? "";
}

function projectInitial(name: string): string {
  const trimmed = name.trim();
  return trimmed ? trimmed[0]!.toUpperCase() : "?";
}

// R13 批 P2：协同会话「+ 新建」——rail.ts 的项目树协同分组此前只能渲染服务端已经建好的会话
// （final-turns-wiring 补的树叶），从没有任何入口能真的建一个新的（POST /projects/:id/conversations
// 从 R12 批 0 落地起就没有 UI 调用方，见 apps/api/src/routes/conversations.ts）。这三个纯函数是
// 这次补洞的可测那一半（imperative 的拉取/挂载在 mountWorkbenchRail 里，同本文件其它 mount* 函数
// 一样不直接单测——见 rail.test.ts 只测 render*/纯函数这一既有事实）。

// 极简自动命名："协同会话 N"——N 按当前项目里已有多少条协同会话（不含主区）计数 + 1。不追求全局
// 唯一（标题本来就不是唯一键，服务端 createConversationRequestSchema 也没有唯一约束），两个人几乎
// 同时各自新建一条也只是标题偶尔重复，不影响可用性，比引入服务端往返生成序号更简单诚实。
export function nextCollabConversationTitle(
  existingConversations: readonly Pick<WorkbenchConversationVM, "kind">[],
  locale: Locale
): string {
  const collabCount = existingConversations.filter((conversation) => conversation.kind === "collab").length;
  return locale === "zh-CN" ? `协同会话 ${collabCount + 1}` : `Collab chat ${collabCount + 1}`;
}

// 新建成功后立即让这条会话在左栏树叶/中栏可见——不用重新拉一次完整 workbench VM（避免一次网络往返
// 和潜在的竞态：期间用户可能已经切换了项目)，直接把服务端返回的会话 VM（形状与 vm.conversations.
// conversations 的元素完全一致，见 packages/contracts 的 conversationVmSchema/createConversationResultVmSchema
// 共用同一个 conversationVmSchema）就地追加进去。按 id 去重防重复追加（比如调用方意外重复调用一次）。
export function appendCollabConversationToVm(vm: WorkbenchPageVM, conversation: WorkbenchConversationVM): WorkbenchPageVM {
  if (vm.conversations.conversations.some((existing) => existing.id === conversation.id)) {
    return vm;
  }
  return {
    ...vm,
    conversations: {
      ...vm.conversations,
      conversations: [...vm.conversations.conversations, conversation]
    }
  };
}

export type CreateCollabConversationApiClient = Pick<WorkbenchRailApiClient, "request">;

// POST /api/projects/:id/conversations——契约见 apps/api/src/routes/conversations.ts +
// packages/contracts 的 createConversationRequestSchema：kind 固定 'collab'（主区会话只能随项目
// 原子创建，公共端点拒绝 kind='main'，见该 schema 顶部注释），visibility 固定 'private'
// （00-interaction-design.md §3：协同会话是"1:1 人机为主，可拉其他成员"的单聊，服务端当前运行时
// 对 project/private 一视同仁只放行参与者可见——这里选 private 是更准确的协议语义，不影响实际可见性）。
// 同 chat/api.ts 里其它会话端点一样,不为这一个批次特性扩大 WorkHubApiClient 的具名方法面。
//
// R13 批 G1（小群）：participantUserIds/cuuEnabled 都是新增的可选字段（additive，契约层
// createConversationRequestSchema 两者都有 zod default）——省略时请求体和批 P2 落地时完全一样，
// 不影响任何既有调用方/既有测试的期望 body 形状。
export function createCollabConversation(
  client: CreateCollabConversationApiClient,
  projectId: string,
  input: { title: string; participantUserIds?: string[]; cuuEnabled?: boolean }
): Promise<CreateConversationResultVM> {
  return client.request<CreateConversationResultVM>(`/api/projects/${encodeURIComponent(projectId)}/conversations`, {
    method: "POST",
    body: JSON.stringify({
      kind: "collab",
      title: input.title,
      visibility: "private",
      ...(input.participantUserIds !== undefined ? { participant_user_ids: input.participantUserIds } : {}),
      ...(input.cuuEnabled !== undefined ? { cuu_enabled: input.cuuEnabled } : {})
    })
  });
}

// 项目行下的树叶——批 1 全部只读(没有任何视图能接)。批 2 把主区群聊接进这个窗口后，「主区」升级成
// 真按钮(会话点击路由：点它把焦点交回已经挂载好的 chat composer，见 shell.ts 的 onOpenMainConversation)；
// 批 6 把网盘视图接进这个窗口后，「网盘」同样升级成真按钮(data-wb-open-drive，切中栏到 drive 标签，
// 见 shell.ts 的 onOpenDrive)——.wh-wb-leaf--live 现在挂在两个叶子上。selected 参数标出当前中栏
// 显示哪个标签(sel 高亮跟着走，而不是主区永远高亮)。
//
// final-turns-wiring：协同会话（kind='collab'）也升级成真按钮——这是批 4a 只做了服务端
// POST /conversations/:id/turns、从没有任何 UI 调用方留下的洞（Cuu 在协同会话里没法被真正点开/回话）。
// vm.conversations.conversations 里本来就包含调用方可见的 collab 会话（服务端 listConversations 已经
// 按参与者过滤，见 apps/api/src/services/conversations.ts），只是这个文件之前从没渲染出来。每个
// collab 会话一个叶子，用 workbenchIcons.collab（批 1 就已经定义、此前从未被用到的双人图标）区分于
// 主区的单气泡图标；选中态按会话 id 比对，不是简单布尔量（一个项目可能有多个 collab 会话）。
//
// R13 批 P2：协同分组末尾加「+ 新建协同会话」真按钮（data-wb-new-collab-conversation）——
// mountWorkbenchRail 点击后调 createCollabConversation，submitting/error 是瞬态 UI 状态（同
// renderNewProjectModalHtml 的既有取舍），跟渲染函数一起传进来，保持这个函数本身是纯的可测函数。
export type NewCollabConversationUiState = {
  submitting: boolean;
  error?: string | undefined;
};

const IDLE_NEW_COLLAB_STATE: NewCollabConversationUiState = { submitting: false };

function renderProjectTreeLeavesHtml(
  vm: WorkbenchPageVM,
  zh: boolean,
  centerTab: WorkbenchCenterTab,
  activeConversationId: string | undefined,
  newCollab: NewCollabConversationUiState
): string {
  const main = vm.conversations.conversations.find((conversation) => conversation.kind === "main");
  const mainLeaf = main
    ? `<button type="button" class="wh-wb-leaf wh-wb-leaf--live${centerTab === "chat" ? " sel" : ""}" data-wb-open-main-chat>${workbenchIcons.chat}<span>${escapeHtml(main.title)}</span>${
        main.next_seq > 0 ? `<span class="wh-wb-leaf-count">${main.next_seq}</span>` : ""
      }</button>`
    : "";
  const collabLeaves = vm.conversations.conversations
    .filter((conversation) => conversation.kind === "collab")
    .map((conversation) => {
      const selected = centerTab === "collab" && activeConversationId === conversation.id;
      return `<button type="button" class="wh-wb-leaf wh-wb-leaf--live${selected ? " sel" : ""}" data-wb-open-collab-chat="${escapeHtml(conversation.id)}">${workbenchIcons.collab}<span>${escapeHtml(conversation.title)}</span>${
        conversation.next_seq > 0 ? `<span class="wh-wb-leaf-count">${conversation.next_seq}</span>` : ""
      }</button>`;
    })
    .join("");
  const newCollabButton = `<div class="wh-wb-new-collab">
    <button type="button" class="wh-wb-leaf wh-wb-leaf--new" data-wb-new-collab-conversation${newCollab.submitting ? " disabled" : ""}>${workbenchIcons.plus}<span>${
      newCollab.submitting ? (zh ? "创建中…" : "Creating…") : zh ? "新建协同会话" : "New collab chat"
    }</span></button>${newCollab.error ? `<p class="wh-wb-new-collab-error">${escapeHtml(newCollab.error)}</p>` : ""}
  </div>`;
  const fileCount = vm.recent_project_files.items.length;
  const driveLeaf = `<button type="button" class="wh-wb-leaf wh-wb-leaf--live${centerTab === "drive" ? " sel" : ""}" data-wb-open-drive>${workbenchIcons.folder}<span>${zh ? "网盘" : "Drive"}</span>${
    fileCount > 0 ? `<span class="wh-wb-leaf-count">${fileCount}</span>` : ""
  }</button>`;
  return `<div class="wh-wb-tree">${mainLeaf}${collabLeaves}${newCollabButton}${driveLeaf}</div>`;
}

export function renderProjectTreeHtml(input: {
  projects: ProjectListItemVM[];
  selectedProjectId: string | undefined;
  vm: WorkbenchPageVM | undefined;
  locale: Locale;
  centerTab?: WorkbenchCenterTab;
  activeConversationId?: string;
  newCollab?: NewCollabConversationUiState;
}): string {
  const zh = input.locale === "zh-CN";
  const rows = input.projects
    .map((project) => {
      const active = project.id === input.selectedProjectId;
      const activeVm = active && input.vm && input.vm.project.id === project.id ? input.vm : undefined;
      const leaves = activeVm
        ? renderProjectTreeLeavesHtml(
            activeVm,
            zh,
            input.centerTab ?? "chat",
            input.activeConversationId,
            input.newCollab ?? IDLE_NEW_COLLAB_STATE
          )
        : "";
      // R13 批 P3：项目名右侧的「项目设置」齿轮——只对项目负责人渲染（vm.viewer.is_project_owner；
      // 服务端把治理端点的读与写都锁在负责人上，见 settings/render.ts 顶部注释——给非负责人摆一个
      // 点开只会撞 404 的按钮违反 04 §4 铁律 3）。齿轮是 .wh-wb-project-row 的兄弟节点而不是子节点
      // （按钮里不能套按钮），选中态跟 centerTab === "project-settings" 走，同树叶的 sel 约定。
      const gear = activeVm?.viewer.is_project_owner
        ? `<button type="button" class="wh-wb-project-gear${input.centerTab === "project-settings" ? " sel" : ""}" data-wb-open-project-settings aria-label="${zh ? "项目设置" : "Project settings"}" title="${zh ? "项目设置" : "Project settings"}">${workbenchIcons.gear}</button>`
        : "";
      return `<div class="wh-wb-project${active ? " active" : ""}">
        <div class="wh-wb-project-head">
        <button type="button" class="wh-wb-project-row" data-wb-select-project="${escapeHtml(project.id)}" aria-current="${active ? "true" : "false"}">
          <span class="wh-wb-tile ${tileVariantClass(project.id)}">${escapeHtml(projectInitial(project.name))}</span>
          <span class="wh-wb-project-name">${escapeHtml(project.name)}</span>
          ${project.open_work_item_count > 0 ? `<span class="wh-wb-project-dot" title="${zh ? "有进行中工作项" : "Has open work"}"></span>` : ""}
        </button>
        ${gear}
        </div>
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

// R13 批 P1：军团总览从这条预告条升级成左栏一级入口（renderArmyOverviewNavHtml，与项目列表平级，见
// 下方注释）——rail-foot 现在只剩「我」这一行（用户拍板 4：旧摘要条退役）。
export function renderRailFootHtml(_zh: boolean, viewerLabel: string | undefined): string {
  return `<div class="wh-wb-rail-foot">
    ${viewerLabel ? `<div class="wh-wb-me">${escapeHtml(viewerLabel)}</div>` : ""}
  </div>`;
}

// 军团总览一级入口（R13 批 P1，用户拍板 4：与项目列表平级，位置在项目列表下方独立分组）——真实
// GET /me/army 聚合端点已经挂载（army/overview.ts），这是一个真按钮：点击切 centerTab 到
// "army-overview"，中栏渲染跨项目军团卡片流。active 由 centerTab 决定，同 renderProjectTreeHtml
// 的 leaf 选中态判定同一套约定。
export function renderArmyOverviewNavHtml(zh: boolean, active: boolean): string {
  return `<div class="wh-wb-rail-group">
    <button type="button" class="wh-wb-army-nav${active ? " active" : ""}" data-wb-open-army-overview aria-current="${active ? "true" : "false"}">
      ${workbenchIcons.army}
      <span class="wh-wb-army-nav-label">${zh ? "军团总览" : "Army overview"}</span>
    </button>
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

// R13 批 G1（小群）：建群模态——把批 P2 落地的"点一下就用自动标题建一条只有自己的协同会话"极简流程
// 升级为"标题 + 成员多选 + Cuu 开关"。成员候选来自当前项目 workbench VM 已经在拉的
// workspace_members.items（@ picker 同一份数据源），按 is_self 排除自己（服务端 assertCollabInput
// 本来就要求 participant_user_ids 不含创建者，这里在 UI 层先天然满足，不依赖服务端兜底报错）。
export type NewCollabMemberOption = {
  userId: string;
  nickname: string;
};

export type NewCollabModalUiState = {
  open: boolean;
  title: string;
  selectedUserIds: readonly string[];
  cuuEnabled: boolean;
  submitting: boolean;
  error?: string | undefined;
};

export const IDLE_NEW_COLLAB_MODAL_STATE: NewCollabModalUiState = {
  open: false,
  title: "",
  selectedUserIds: [],
  cuuEnabled: true,
  submitting: false
};

export function renderNewCollabModalHtml(input: {
  locale: Locale;
  state: NewCollabModalUiState;
  memberOptions: readonly NewCollabMemberOption[];
}): string {
  const zh = input.locale === "zh-CN";
  const state = input.state;
  const selected = new Set(state.selectedUserIds);
  const memberRowsHtml =
    input.memberOptions.length > 0
      ? input.memberOptions
          .map((member) => {
            const checked = selected.has(member.userId);
            return `<label class="wh-wb-new-collab-member-row">
        <input type="checkbox" data-wb-new-collab-member="${escapeHtml(member.userId)}" ${checked ? "checked" : ""} ${state.submitting ? "disabled" : ""} />
        <span>${escapeHtml(member.nickname)}</span>
      </label>`;
          })
          .join("")
      : `<p class="wh-wb-new-collab-member-empty">${zh ? "这个工作区暂时没有其他成员" : "No other workspace members yet"}</p>`;
  return `<div class="wh-wb-modal-overlay" data-wb-new-collab-overlay data-open="${state.open ? "true" : "false"}">
    <div class="wh-wb-modal" role="dialog" aria-modal="true" aria-label="${zh ? "新建协同会话" : "New collab chat"}">
      <h3 class="wh-wb-modal-title">${zh ? "新建协同会话" : "New collab chat"}</h3>
      <input
        class="wh-wb-modal-input"
        type="text"
        maxlength="256"
        placeholder="${zh ? "会话名，如：改第三幕" : "Chat name"}"
        data-wb-new-collab-title
        value="${escapeHtml(state.title)}"
        ${state.submitting ? "disabled" : ""}
      />
      <div class="wh-wb-new-collab-members">
        <p class="wh-wb-new-collab-members-label">${zh ? "拉人进来（不选就只有你和 Cuu）" : "Add members (leave empty for just you and Cuu)"}</p>
        ${memberRowsHtml}
      </div>
      <label class="wh-wb-new-collab-cuu-toggle">
        <input type="checkbox" data-wb-new-collab-cuu-toggle ${state.cuuEnabled ? "checked" : ""} ${state.submitting ? "disabled" : ""} />
        <span>${zh ? "Cuu 参与这个会话" : "Cuu takes part in this chat"}</span>
      </label>
      ${state.error ? `<p class="wh-wb-modal-error">${escapeHtml(state.error)}</p>` : ""}
      <div class="wh-wb-modal-actions">
        <button type="button" class="wh-wb-btn wh-wb-btn--ghost" data-wb-new-collab-cancel ${state.submitting ? "disabled" : ""}>${zh ? "取消" : "Cancel"}</button>
        <button type="button" class="wh-wb-btn wh-wb-btn--primary" data-wb-new-collab-submit ${state.submitting || !state.title.trim() ? "disabled" : ""}>
          ${state.submitting ? (zh ? "创建中…" : "Creating…") : zh ? "创建" : "Create"}
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
// 「主区」/「协同会话」/「网盘」树叶点击路由（切 store.centerTab（+ activeConversationId），见
// renderProjectTreeLeavesHtml 的注释）。
export function mountWorkbenchRail(
  container: HTMLElement,
  input: {
    client: WorkbenchRailApiClient;
    store: WorkbenchStore;
    locale: Locale;
    onSelectProject: (projectId: string) => void;
    onOpenMainConversation?: () => void;
    // final-turns-wiring：某个协同会话树叶被点开——传的是那个会话的真实 id（shell.ts 用它去
    // vm.conversations.conversations 里找到对应的 collab 会话并挂载 chat 视图）。
    onOpenCollabConversation?: (conversationId: string) => void;
    onOpenDrive?: () => void;
    // R13 批 P1：军团总览一级入口点击——shell.ts 把它接成 store.centerTab = "army-overview"。
    onOpenArmyOverview?: () => void;
    // R13 批 P3：项目行的「项目设置」齿轮点击——shell.ts 把它接成 store.centerTab = "project-settings"。
    onOpenProjectSettings?: () => void;
  }
): WorkbenchRailHandle {
  let modalName = "";
  let modalSubmitting = false;
  let modalError: string | undefined;
  let newCollabSubmitting = false;
  let newCollabError: string | undefined;
  // R13 批 G1（小群）：建群模态的瞬态输入态——同 modalName/modalSubmitting 一样是纯本地状态，不进
  // 共享 store（只有这个组件自己的渲染需要读它）。newCollabSubmitting/newCollabError 复用批 P2 已有的
  // 那两个变量，语义不变（真的在发 HTTP 请求/请求失败），只是现在由模态的提交按钮触发，不再是树叶
  // 按钮直接触发。
  let newCollabModalOpen = false;
  let newCollabModalTitle = "";
  let newCollabModalSelectedUserIds: string[] = [];
  let newCollabModalCuuEnabled = true;
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
      centerTab: state.centerTab,
      // exactOptionalPropertyTypes：activeConversationId?: string 不接受显式 undefined（同
      // view.ts toPendingRenderModel 的既有取舍），state.activeConversationId 没值时干脆不传这个键。
      ...(state.activeConversationId !== undefined ? { activeConversationId: state.activeConversationId } : {}),
      newCollab: { submitting: newCollabSubmitting, error: newCollabError }
    })}${renderArmyOverviewNavHtml(zh, state.centerTab === "army-overview")}${renderRailFootHtml(zh, viewerLabel)}${renderNewProjectModalHtml({
      locale: input.locale,
      open: state.newProjectModalOpen,
      name: modalName,
      submitting: modalSubmitting,
      error: modalError
    })}${renderNewCollabModalHtml({
      locale: input.locale,
      state: {
        open: newCollabModalOpen,
        title: newCollabModalTitle,
        selectedUserIds: newCollabModalSelectedUserIds,
        cuuEnabled: newCollabModalCuuEnabled,
        submitting: newCollabSubmitting,
        error: newCollabError
      },
      memberOptions: (state.vm?.workspace_members.items ?? [])
        .filter((member) => !member.is_self)
        .map((member) => ({ userId: member.user_id, nickname: member.nickname }))
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

  // R13 批 G1（小群）：「+ 新建协同会话」从批 P2 的"点一下就用自动标题建一条只有自己的会话"升级为
  // 打开建群模态——标题预填自动命名（用户仍可改）、成员多选默认不选（不选=1:1）、Cuu 开关默认开。
  const openNewCollabModal = () => {
    const state = input.store.getState();
    const vm = state.vm;
    newCollabModalTitle = vm ? nextCollabConversationTitle(vm.conversations.conversations, input.locale) : "";
    newCollabModalSelectedUserIds = [];
    newCollabModalCuuEnabled = true;
    newCollabError = undefined;
    newCollabModalOpen = true;
    render();
  };

  const closeNewCollabModal = () => {
    newCollabModalOpen = false;
    render();
  };

  // R13 批 P2：协同会话「+ 新建」——POST /projects/:id/conversations 建好之后立即打开它(store.centerTab
  // = "collab" + activeConversationId)，不是建完还要用户自己再点一次左栏树叶。这条只在已经选中一个
  // 项目、且这个项目的 workbench VM 已经就绪时才有意义(按钮本身只在这个状态下才会被渲染出来，见
  // renderProjectTreeLeavesHtml 只在 active && vm.project.id === project.id 时才画协同分组)，
  // 但这里仍然老实地判一次现状而不是假设调用时机(用户可能在网络请求还没打完前切换了项目)。
  const submitNewCollabConversation = async () => {
    if (newCollabSubmitting) {
      return;
    }
    const title = newCollabModalTitle.trim();
    if (!title) {
      return;
    }
    const state = input.store.getState();
    const projectId = state.selectedProjectId;
    const vm = state.vm;
    if (!projectId || !vm || vm.project.id !== projectId) {
      return;
    }
    newCollabSubmitting = true;
    newCollabError = undefined;
    render();
    try {
      const result = await createCollabConversation(input.client, projectId, {
        title,
        participantUserIds: [...newCollabModalSelectedUserIds],
        cuuEnabled: newCollabModalCuuEnabled
      });
      if (disposed) {
        return;
      }
      newCollabSubmitting = false;
      newCollabModalOpen = false;
      const latestVm = input.store.getState().vm;
      // 请求打完之间用户可能已经切走了项目——只在还停在同一个项目时才把新会话合并进当前 VM 并跳过去，
      // 切走了就只是静默地把它建在服务端(会话仍然存在，下次回到这个项目时会在树叶里看到)，不硬切回去。
      if (latestVm && latestVm.project.id === projectId) {
        input.store.setState({ vm: appendCollabConversationToVm(latestVm, result.conversation) });
        input.onOpenCollabConversation?.(result.conversation.id);
      }
    } catch (error) {
      if (disposed) {
        return;
      }
      newCollabSubmitting = false;
      newCollabError =
        error instanceof Error ? error.message : input.locale === "zh-CN" ? "创建失败，请重试" : "Couldn't create it — retry";
      render();
    }
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
    const collabLeaf = target.closest<HTMLElement>("[data-wb-open-collab-chat]");
    if (collabLeaf?.dataset.wbOpenCollabChat) {
      input.onOpenCollabConversation?.(collabLeaf.dataset.wbOpenCollabChat);
      return;
    }
    if (target.closest("[data-wb-new-collab-conversation]")) {
      openNewCollabModal();
      return;
    }
    if (target.closest("[data-wb-open-drive]")) {
      input.onOpenDrive?.();
      return;
    }
    if (target.closest("[data-wb-open-army-overview]")) {
      input.onOpenArmyOverview?.();
      return;
    }
    if (target.closest("[data-wb-open-project-settings]")) {
      input.onOpenProjectSettings?.();
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
      return;
    }
    // R13 批 G1：建群模态的取消/点遮罩背景关闭，同新建项目模态同一套约定。
    const clickedNewCollabOverlayBackdrop = target.hasAttribute("data-wb-new-collab-overlay");
    if (target.closest("[data-wb-new-collab-cancel]") || clickedNewCollabOverlayBackdrop) {
      closeNewCollabModal();
      return;
    }
    if (target.closest("[data-wb-new-collab-submit]")) {
      void submitNewCollabConversation();
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
      return;
    }
    // R13 批 G1：建群模态标题输入——同上一段新建项目名称输入同一套"重渲后还焦点/光标"处理。
    if (target instanceof HTMLInputElement && target.matches("[data-wb-new-collab-title]")) {
      newCollabModalTitle = target.value;
      render();
      const titleInput = container.querySelector<HTMLInputElement>("[data-wb-new-collab-title]");
      if (titleInput) {
        titleInput.focus();
        const end = titleInput.value.length;
        try {
          titleInput.setSelectionRange(end, end);
        } catch {
          // ignore: some input rendering modes reject setSelectionRange.
        }
      }
    }
  });

  // R13 批 G1：建群模态的成员多选 checkbox + Cuu 开关 checkbox——用 change 而不是 click/input，
  // 匹配 checkbox 的原生语义（复选框状态变化事件），委托到容器同其它监听器一致。
  container.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || target.type !== "checkbox") {
      return;
    }
    const memberUserId = target.dataset.wbNewCollabMember;
    if (memberUserId) {
      newCollabModalSelectedUserIds = target.checked
        ? [...newCollabModalSelectedUserIds, memberUserId]
        : newCollabModalSelectedUserIds.filter((userId) => userId !== memberUserId);
      render();
      return;
    }
    if (target.matches("[data-wb-new-collab-cuu-toggle]")) {
      newCollabModalCuuEnabled = target.checked;
      render();
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
