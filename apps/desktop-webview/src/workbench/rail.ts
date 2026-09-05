// WorkHub 桌面 · 工作台左栏：项目树 + 军团总览入口 + 新建项目模态。
// 纯 TS DOM，风格照 spotlight/views/*：render* 是可单测的纯函数，mount* 负责拉数据 + 绑事件。

import type { WorkHubApiClient } from "@workhub/api-client";
import type {
  CreateConversationResultVM,
  DmListItemVM,
  ProjectListItemVM,
  RenameConversationResultVM,
  WorkbenchPageVM
} from "@workhub/contracts";
import { escapeHtml } from "@workhub/web-runtime";

import { avatarTileHtml } from "./chat/render.js";
import { hydrateAvatarPhotos } from "./chat/view.js";
import { applyPresenceToOnlineIds } from "./chat/presence-state.js";
import { dmPeerParticipant, fetchDmList, fetchPresenceEntries } from "./dm.js";
import { workbenchIcons } from "./icons.js";
import type { WorkbenchCenterTab, WorkbenchStore } from "./store.js";

// R15 批 B：rail 的 presence 轮询周期——同 chat/view.ts 成员条的 30s 节奏。
const RAIL_PRESENCE_POLL_INTERVAL_MS = 30_000;

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

// R14FIX 批 workbench（会话重命名，2026-07-15 用户反馈）：PATCH /api/conversations/:id——同
// createCollabConversation 顶部注释的既有取舍（走 client.request 而不是扩大 WorkHubApiClient 的具名
// 方法面）。契约见 apps/api/src/routes/conversation-rename.ts + renameConversationRequestSchema。
export function renameCollabConversation(
  client: Pick<WorkbenchRailApiClient, "request">,
  conversationId: string,
  title: string
): Promise<RenameConversationResultVM> {
  return client.request<RenameConversationResultVM>(`/api/conversations/${encodeURIComponent(conversationId)}`, {
    method: "PATCH",
    body: JSON.stringify({ title })
  });
}

// 改名成功后就地更新左栏树叶——不重拉整份 workbench VM（同 appendCollabConversationToVm 的取舍：省一次
// 往返、避开切项目竞态）。按 id 定位这条会话，替换 title（其余字段透传）。找不到就原样返回（调用方可能
// 已经切走了项目）。
export function renameCollabConversationInVm(
  vm: WorkbenchPageVM,
  conversationId: string,
  title: string
): WorkbenchPageVM {
  let changed = false;
  const conversations = vm.conversations.conversations.map((conversation) => {
    if (conversation.id === conversationId && conversation.title !== title) {
      changed = true;
      return { ...conversation, title };
    }
    return conversation;
  });
  if (!changed) {
    return vm;
  }
  return {
    ...vm,
    conversations: { ...vm.conversations, conversations }
  };
}

// —— R15 批 A6（rail 未读红点）：会话未读数的本地更新纯函数 —— //
// 左栏树叶/私聊行现在渲的是「未读数」而不是消息总数。未读的权威来源是服务端（listConversations /
// listDms 的 unread_count，A4/A6 后端），但实时性只靠一条 /api/push/stream/me 订阅：收到某会话新消息
// 的 notification.created 时本地 +1（近似，不知道服务端精确聚合数），30s 会话列表兜底刷新 + 打开会话
// 清零把它拉回权威。以下四个纯函数是这套本地更新的可测那一半（imperative 的订阅/清零在 shell.ts）。

// 把 vm.conversations 里某条会话（主区/协同）的 unread_count 设为 count；找不到就原样返回（引用不变，
// 调用方据此判断是否真的变了、要不要重渲）。count<0 归零，防御性。
export function setConversationUnreadInVm(
  vm: WorkbenchPageVM,
  conversationId: string,
  count: number
): WorkbenchPageVM {
  const safe = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
  let changed = false;
  const conversations = vm.conversations.conversations.map((conversation) => {
    if (conversation.id === conversationId && (conversation.unread_count ?? 0) !== safe) {
      changed = true;
      return { ...conversation, unread_count: safe };
    }
    return conversation;
  });
  if (!changed) {
    return vm;
  }
  return { ...vm, conversations: { ...vm.conversations, conversations } };
}

// 某条会话未读 +1（本地近似，见上方注释）。找不到就原样返回。
export function bumpConversationUnreadInVm(vm: WorkbenchPageVM, conversationId: string): WorkbenchPageVM {
  const target = vm.conversations.conversations.find((conversation) => conversation.id === conversationId);
  if (!target) {
    return vm;
  }
  return setConversationUnreadInVm(vm, conversationId, (target.unread_count ?? 0) + 1);
}

// 把 dmList 里某条 DM 会话的 unread_count 设为 count；找不到就原样返回（引用不变）。
export function setDmUnread(
  dmList: readonly DmListItemVM[],
  conversationId: string,
  count: number
): DmListItemVM[] {
  const safe = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
  let changed = false;
  const next = dmList.map((dm) => {
    if (dm.conversation.id === conversationId && (dm.conversation.unread_count ?? 0) !== safe) {
      changed = true;
      return { ...dm, conversation: { ...dm.conversation, unread_count: safe } };
    }
    return dm;
  });
  return changed ? next : (dmList as DmListItemVM[]);
}

// 某条 DM 未读 +1。找不到就原样返回。
export function bumpDmUnread(dmList: readonly DmListItemVM[], conversationId: string): DmListItemVM[] {
  const target = dmList.find((dm) => dm.conversation.id === conversationId);
  if (!target) {
    return dmList as DmListItemVM[];
  }
  return setDmUnread(dmList, conversationId, (target.conversation.unread_count ?? 0) + 1);
}

// R20 DSK-UX（R19-9 未读重连补缺）：用一份新拉的权威 VM 把 current VM 里每条会话（主区/协同）的 unread_count
// 对齐到服务端真值。此前主区/协同未读只靠 /me 流本地 +1，从不周期对账、/me 重连也不补缺口（broker
// resume_mode:fresh 不重放），一旦漏事件就永久少算，只有切项目再切回才被新 VM 纠正（DM 有 30s 兜底、
// 主区/协同没有）。重连后拉一次 workbench VM 走这个纯函数把真值收敛回来。skipConversationId=当前正开着的
// 会话（用户在读、chat 视图有自己的 afterSeq 对账并已清零），不拿服务端拉取那一刻的历史未读把它的红点又点亮。
// 无变化时原样返回 current 引用（identity 稳定），调用方据此判断要不要 setState。
export function reconcileConversationUnreadFromVm(
  current: WorkbenchPageVM,
  fresh: WorkbenchPageVM,
  skipConversationId?: string
): WorkbenchPageVM {
  let vm = current;
  for (const conversation of fresh.conversations.conversations) {
    if (conversation.id === skipConversationId) {
      continue;
    }
    vm = setConversationUnreadInVm(vm, conversation.id, conversation.unread_count ?? 0);
  }
  return vm;
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
        (main.unread_count ?? 0) > 0 ? `<span class="wh-wb-leaf-count wh-wb-leaf-count--unread">${main.unread_count}</span>` : ""
      }</button>`
    : "";
  const collabLeaves = vm.conversations.conversations
    .filter((conversation) => conversation.kind === "collab")
    .map((conversation) => {
      const selected = centerTab === "collab" && activeConversationId === conversation.id;
      // R14FIX 批 workbench（会话重命名）：每条协同会话叶子加一个悬停/聚焦才现身的铅笔（兄弟节点，
      // 不套在 open 按钮里——按钮里不能套按钮，同项目设置齿轮的既有取舍）。data-wb-rename-collab 带上
      // 当前标题，mountWorkbenchRail 据此预填重命名弹窗。
      return `<div class="wh-wb-collab-leaf"><button type="button" class="wh-wb-leaf wh-wb-leaf--live${selected ? " sel" : ""}" data-wb-open-collab-chat="${escapeHtml(conversation.id)}">${workbenchIcons.collab}<span>${escapeHtml(conversation.title)}</span>${
        (conversation.unread_count ?? 0) > 0 ? `<span class="wh-wb-leaf-count wh-wb-leaf-count--unread">${conversation.unread_count}</span>` : ""
      }</button><button type="button" class="wh-wb-collab-rename" data-wb-rename-collab="${escapeHtml(conversation.id)}" data-wb-rename-collab-title="${escapeHtml(conversation.title)}" title="${zh ? "重命名" : "Rename"}" aria-label="${zh ? "重命名会话" : "Rename chat"}">${workbenchIcons.edit}</button></div>`;
    })
    .join("");
  // R14FIX 批 workbench（缺「单独和 Cuu 聊」入口 · 2026-07-15 用户反馈）：显眼快捷入口——一键建一条只有
  // 自己 + Cuu 的私有会话并打开（不用先开建群弹窗、再刻意不选人）。文案桌面用 Cuu。
  const soloCuuButton = `<button type="button" class="wh-wb-leaf wh-wb-leaf--live wh-wb-leaf--solo-cuu" data-wb-new-solo-cuu${newCollab.submitting ? " disabled" : ""}>${workbenchIcons.cat}<span>${
    newCollab.submitting ? (zh ? "创建中…" : "Creating…") : zh ? "和 Cuu 单独聊" : "Chat just with Cuu"
  }</span></button>`;
  const newCollabButton = `<div class="wh-wb-new-collab">${soloCuuButton}
    <button type="button" class="wh-wb-leaf wh-wb-leaf--new" data-wb-new-collab-conversation${newCollab.submitting ? " disabled" : ""}>${workbenchIcons.plus}<span>${
      newCollab.submitting ? (zh ? "创建中…" : "Creating…") : zh ? "新建协同会话" : "New collab chat"
    }</span></button>${newCollab.error ? `<p class="wh-wb-new-collab-error">${escapeHtml(newCollab.error)}</p>` : ""}
  </div>`;
  const fileCount = vm.recent_project_files.items.length;
  const driveLeaf = `<button type="button" class="wh-wb-leaf wh-wb-leaf--live${centerTab === "drive" ? " sel" : ""}" data-wb-open-drive>${workbenchIcons.folder}<span>${zh ? "网盘" : "Drive"}</span>${
    fileCount > 0 ? `<span class="wh-wb-leaf-count">${fileCount}</span>` : ""
  }</button>`;
  // R15 批 E2（项目时间线 / 甘特）：与网盘同级的「时间线」树叶——切中栏到 timeline 标签（见 shell.ts 的
  // onOpenTimeline）。选中态跟 centerTab === "timeline" 走，同其它树叶的 sel 约定。
  const timelineLeaf = `<button type="button" class="wh-wb-leaf wh-wb-leaf--live${centerTab === "timeline" ? " sel" : ""}" data-wb-open-timeline>${workbenchIcons.timeline}<span>${zh ? "时间线" : "Timeline"}</span></button>`;
  // R16 批 W2：与时间线同级的「任务看板」树叶——切中栏到 kanban 标签（见 shell.ts 的 onOpenKanban）。
  // 首发带「新」小徽标（复用现有 wh-wb-leaf-count 徽标体系，不造新样式；可后续摘除）。
  const kanbanLeaf = `<button type="button" class="wh-wb-leaf wh-wb-leaf--live${centerTab === "kanban" ? " sel" : ""}" data-wb-open-kanban>${workbenchIcons.kanban}<span>${zh ? "任务看板" : "Board"}</span><span class="wh-wb-leaf-count">${zh ? "新" : "New"}</span></button>`;
  // R16 批 W2：与时间线同级的「日程」树叶——切中栏到 schedule 标签（见 shell.ts 的 onOpenSchedule）。
  // 首发同样带「新」小徽标（复用现有 wh-wb-leaf-count 徽标体系）。
  const scheduleLeaf = `<button type="button" class="wh-wb-leaf wh-wb-leaf--live${centerTab === "schedule" ? " sel" : ""}" data-wb-open-schedule>${workbenchIcons.calendar}<span>${zh ? "日程" : "Schedule"}</span><span class="wh-wb-leaf-count">${zh ? "新" : "New"}</span></button>`;
  return `<div class="wh-wb-tree">${mainLeaf}${collabLeaves}${newCollabButton}${driveLeaf}${timelineLeaf}${kanbanLeaf}${scheduleLeaf}</div>`;
}

// R13 批 S3（个人空间）：项目行 + 树叶的渲染逻辑从 renderProjectTreeHtml 里提出来，供团队项目分组
// 与「我的空间」分组共用（两个分组的每一行长得一样——选中态/树叶/项目设置齿轮全部同一套规则，
// 只是数据源和分组标题不同）。纯函数，行为与提取前逐字节相同。
function renderProjectRowHtml(
  project: ProjectListItemVM,
  active: boolean,
  activeVm: WorkbenchPageVM | undefined,
  zh: boolean,
  centerTab: WorkbenchCenterTab,
  activeConversationId: string | undefined,
  newCollab: NewCollabConversationUiState
): string {
  const leaves = activeVm
    ? renderProjectTreeLeavesHtml(activeVm, zh, centerTab, activeConversationId, newCollab)
    : "";
  // R13 批 P3：项目名右侧的「项目设置」齿轮——只对项目负责人渲染（vm.viewer.is_project_owner；
  // 服务端把治理端点的读与写都锁在负责人上，见 settings/render.ts 顶部注释——给非负责人摆一个
  // 点开只会撞 404 的按钮违反 04 §4 铁律 3）。齿轮是 .wh-wb-project-row 的兄弟节点而不是子节点
  // （按钮里不能套按钮），选中态跟 centerTab === "project-settings" 走，同树叶的 sel 约定。
  const gear = activeVm?.viewer.is_project_owner
    ? `<button type="button" class="wh-wb-project-gear${centerTab === "project-settings" ? " sel" : ""}" data-wb-open-project-settings aria-label="${zh ? "项目设置" : "Project settings"}" title="${zh ? "项目设置" : "Project settings"}">${workbenchIcons.gear}</button>`
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
      return renderProjectRowHtml(
        project,
        active,
        activeVm,
        zh,
        input.centerTab ?? "chat",
        input.activeConversationId,
        input.newCollab ?? IDLE_NEW_COLLAB_STATE
      );
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

// R13 批 S3（个人空间）：rail 顶部独立分组，与「项目」平级但视觉/语义分开——个人空间没有团队
// 成员头像、没有「军团总览」跨项目入口那套团队语境，就是普通项目行（同一套渲染）加一个专属
// 创建入口。列表数据源是 GET /api/me/personal-projects（只回该用户名下 is_personal=true 的项目，
// 见 apps/api/src/routes/personal-projects.ts），与团队项目列表（GET /api/projects，服务端已经
// 过滤掉 is_personal=true 的行）是两个互斥的数据源——不靠前端再去重/再过滤一次。
export function renderPersonalSpaceSectionHtml(input: {
  personalProjects: ProjectListItemVM[];
  selectedProjectId: string | undefined;
  vm: WorkbenchPageVM | undefined;
  locale: Locale;
  centerTab?: WorkbenchCenterTab;
  activeConversationId?: string;
  newCollab?: NewCollabConversationUiState;
}): string {
  const zh = input.locale === "zh-CN";
  const rows = input.personalProjects
    .map((project) => {
      const active = project.id === input.selectedProjectId;
      const activeVm = active && input.vm && input.vm.project.id === project.id ? input.vm : undefined;
      return renderProjectRowHtml(
        project,
        active,
        activeVm,
        zh,
        input.centerTab ?? "chat",
        input.activeConversationId,
        input.newCollab ?? IDLE_NEW_COLLAB_STATE
      );
    })
    .join("");
  const newPersonalSpaceRow = `<div class="wh-wb-project">
    <button type="button" class="wh-wb-project-row" data-wb-new-personal-space>
      <span class="wh-wb-tile wh-wb-tile--new">${workbenchIcons.plus}</span>
      <span class="wh-wb-project-name wh-wb-project-name--muted">${zh ? "新建个人空间" : "New personal space"}</span>
    </button>
  </div>`;
  // R14 批 ONBOARD（个人空间发现性，2026-07-14）：一个人还没建过任何个人空间时，多数人不知道这行
  // 「新建个人空间」按钮是干嘛用的（不是团队项目，容易被当成又一个团队项目而跳过）。只在
  // personalProjects 为空时补一行小字点破用途；一旦建了第一个个人空间，rows 非空，这行就再也不出现——
  // 不是常驻文案，是新手期的一次性引导。
  // 范围围栏不许改 css.ts，这里用内联样式而不是新起一个没有对应规则的 class（同 avatarTileHtml 的
  // 既有先例：hue 色块也是内联 style，不是每一处视觉细节都值得为它专门开一条 CSS 规则）——字号/颜色
  // 抄的是 wh-wb-army-empty-note 同一档"小字浅色提示"视觉语言（12px/ds-ink-faint），保持全应用观感一致。
  const discoveryHint = input.personalProjects.length === 0
    ? `<p data-wb-personal-space-discovery-hint="true" style="margin:2px 14px 10px;font:500 12px/1.5 var(--ds-font);color:var(--ds-ink-faint)">${zh ? "你的私人 AI 工作台——想周报、读材料、记待办都行" : "Your private AI workspace — draft reports, read through materials, or track your own to-dos"}</p>`
    : "";
  return `<div class="wh-wb-rail-head wh-wb-rail-head--personal">${zh ? "我的空间" : "My space"}</div>${rows}${newPersonalSpaceRow}${discoveryHint}`;
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

// R15 批 I1（决策收件箱）：rail 顶部「待拍板」一级入口——横跨项目的决策总览（中栏切到 workbench/inbox）。
// count 来自 store.inboxCount（GET /api/pages/attention 的 queue 长度，shell 维护），>0 才渲红色计数徽标，
// 是「一眼看到有几条待拍板」的核心承诺（对齐主窗聚焦盒的审批角标）。active 由 centerTab === "inbox" 决定，
// 同 army-nav/leaf 的选中态约定。放在 rail 最顶（项目树之上），决策面是全桌面最高优先的日常入口。
export function renderInboxNavHtml(zh: boolean, active: boolean, count: number): string {
  const safeCount = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
  const badge = safeCount > 0
    ? `<span class="wh-wb-inbox-nav-count" data-wb-inbox-count="${safeCount}">${safeCount > 99 ? "99+" : safeCount}</span>`
    : "";
  return `<div class="wh-wb-rail-group wh-wb-rail-group--inbox">
    <button type="button" class="wh-wb-inbox-nav${active ? " active" : ""}" data-wb-open-inbox aria-current="${active ? "true" : "false"}">
      ${workbenchIcons.check}
      <span class="wh-wb-inbox-nav-label">${zh ? "待拍板" : "Decisions"}</span>
      ${badge}
    </button>
  </div>`;
}

// —— R15 批 B（人对人私聊）：成员 roster + 私聊分组 —— //

type WorkbenchMemberVM = WorkbenchPageVM["workspace_members"]["items"][number];

// 成员 roster 排序：排除自己（自己不进这个「找谁聊」的列表），在线者排前——在线优先是稳定排序（同在线
// 态内保持服务端已给的顺序：负责人在前、再按昵称）。纯函数，可单测。
export function sortRosterMembers(
  members: readonly WorkbenchMemberVM[],
  currentUserId: string | undefined,
  onlineUserIds: ReadonlySet<string>
): WorkbenchMemberVM[] {
  const others = members.filter((member) => (currentUserId ? member.user_id !== currentUserId : !member.is_self));
  return others
    .map((member, index) => ({ member, index, online: onlineUserIds.has(member.user_id) }))
    .sort((a, b) => (a.online === b.online ? a.index - b.index : a.online ? -1 : 1))
    .map((entry) => entry.member);
}

// R17 批 G1（#14 邀请 / #15 成员移出）：roster「管理」模式与「邀请成员」入口的瞬态 UI 状态。canManage=
// 当前 viewer 是工作区 admin/owner（viewer.membership_role !== 'member'）时才渲这两个入口；invite 是内联
// 生成邀请的表单态（无未过期邀请列表读端点，只做生成 + 复制 token）。都是 additive optional——不传时
// renderRosterGroupHtml 行为与本批之前逐字一致（既有测试/调用点零回归）。
export type RosterInviteUiState = {
  open: boolean;
  email: string;
  submitting: boolean;
  note?: string | undefined;
  error?: string | undefined;
};

// 成员 roster 分组：workspace_members（工作台 VM 已带，工作区级、cap 100）+ 在线绿点，点成员行 → 头像
// 资料卡（data-wb-open-profile，popover 在 shell 根委托打开）。VM 还没就绪（没选任何项目）时不渲染这个
// 分组（成员列表来自 VM，没有 VM 就没有可靠成员数据，不摆空壳）。
// R17 批 G1：admin/owner 额外渲「管理」开关 + 「邀请成员」入口——管理模式下每行末尾出「移出」（走
// DELETE /api/workspace/members/:userId，带内联确认 + 忙态 + 刷新）。
export function renderRosterGroupHtml(input: {
  members: readonly WorkbenchMemberVM[];
  currentUserId: string | undefined;
  onlineUserIds: ReadonlySet<string>;
  locale: Locale;
  canManage?: boolean;
  manage?: boolean;
  busyUserId?: string | undefined;
  confirmRemoveUserId?: string | undefined;
  manageError?: string | undefined;
  invite?: RosterInviteUiState | undefined;
}): string {
  const zh = input.locale === "zh-CN";
  const sorted = sortRosterMembers(input.members, input.currentUserId, input.onlineUserIds);
  if (sorted.length === 0) {
    return "";
  }
  const canManage = input.canManage ?? false;
  const manage = canManage && (input.manage ?? false);
  const rows = sorted
    .map((member) => {
      const online = input.onlineUserIds.has(member.user_id);
      const tile = avatarTileHtml({ label: member.nickname, id: member.user_id, ...(online ? { online: true } : {}) });
      const profileBtn = `<button type="button" class="wh-wb-roster-row" data-wb-open-profile="${escapeHtml(
        member.user_id
      )}">${tile}<span class="wh-wb-roster-name">${escapeHtml(member.nickname)}</span></button>`;
      if (!manage) {
        return profileBtn;
      }
      const busy = input.busyUserId === member.user_id;
      let control: string;
      if (input.confirmRemoveUserId === member.user_id) {
        control = `<span class="wh-wb-roster-confirm">${zh ? "确认移出？" : "Remove?"}<button type="button" class="wh-wb-roster-confirm-yes" data-wb-remove-member-confirm="${escapeHtml(
          member.user_id
        )}"${busy ? " disabled" : ""}>${busy ? (zh ? "移出中…" : "Removing…") : zh ? "确认" : "Yes"}</button><button type="button" class="wh-wb-roster-confirm-no" data-wb-remove-member-cancel${busy ? " disabled" : ""}>${zh ? "取消" : "No"}</button></span>`;
      } else {
        control = `<button type="button" class="wh-wb-roster-remove" data-wb-remove-member="${escapeHtml(
          member.user_id
        )}"${busy ? " disabled" : ""}>${zh ? "移出" : "Remove"}</button>`;
      }
      return `<div class="wh-wb-roster-row-wrap">${profileBtn}${control}</div>`;
    })
    .join("");
  let head = `<div class="wh-wb-rail-head wh-wb-rail-head--flush">${zh ? "成员" : "Members"}`;
  if (canManage) {
    head += `<span class="wh-wb-roster-actions"><button type="button" class="wh-wb-roster-action" data-wb-roster-manage-toggle>${
      manage ? (zh ? "完成" : "Done") : zh ? "管理" : "Manage"
    }</button><button type="button" class="wh-wb-roster-action" data-wb-invite-member>${zh ? "邀请" : "Invite"}</button></span>`;
  }
  head += "</div>";
  const inviteBox = canManage && input.invite?.open ? renderRosterInviteBoxHtml(input.invite, zh) : "";
  const errorLine =
    manage && input.manageError ? `<p class="wh-wb-roster-invite-error">${escapeHtml(input.manageError)}</p>` : "";
  return `<div class="wh-wb-rail-group">${head}${inviteBox}${errorLine}${rows}</div>`;
}

// R17 批 G1（#14 邀请成员）：内联邀请表单——填被邀请人邮箱 → 生成邀请（POST /invites）→ 一次性 token
// 复制到剪贴板 + 提示。没有未过期邀请列表读端点，故只做生成 + 复制，不渲列表（见交付报告）。
function renderRosterInviteBoxHtml(state: RosterInviteUiState, zh: boolean): string {
  const note = state.error
    ? `<p class="wh-wb-roster-invite-error">${escapeHtml(state.error)}</p>`
    : state.note
      ? `<p class="wh-wb-roster-invite-note">${escapeHtml(state.note)}</p>`
      : "";
  return `<div class="wh-wb-roster-invite">
    <input class="wh-wb-roster-invite-input" type="email" inputmode="email" maxlength="320" placeholder="${
      zh ? "被邀请人邮箱" : "Invitee email"
    }" data-wb-invite-email value="${escapeHtml(state.email)}"${state.submitting ? " disabled" : ""} />
    <div class="wh-wb-roster-invite-actions">
      <button type="button" class="wh-wb-roster-action" data-wb-invite-cancel${state.submitting ? " disabled" : ""}>${
        zh ? "取消" : "Cancel"
      }</button>
      <button type="button" class="wh-wb-roster-action wh-wb-roster-action--primary" data-wb-invite-submit${
        state.submitting || !state.email.trim() ? " disabled" : ""
      }>${state.submitting ? (zh ? "生成中…" : "Creating…") : zh ? "生成邀请" : "Create invite"}</button>
    </div>
    ${note}
  </div>`;
}

// R17 批 G1（#14 邀请成员）：POST /api/auth/invites {email} → 201 { invite_id, token, email, expires_at }。
// 一次性明文 token 只返回这一次（服务端只存 hash）。管理员据 token 自行拼 out-of-band 链接分发（无 SMTP）。
// 仅 admin + 密码模式可用（否则 403/404，UI 诚实透传服务端错误）。
export function createWorkspaceInvite(
  client: Pick<WorkbenchRailApiClient, "request">,
  email: string
): Promise<{ invite_id: string; token: string; email: string; expires_at: string }> {
  return client.request<{ invite_id: string; token: string; email: string; expires_at: string }>("/api/auth/invites", {
    method: "POST",
    body: JSON.stringify({ email })
  });
}

// R17 批 G1（#15 成员移出）：DELETE /api/workspace/members/:userId → 200 { removed_user_id }。仅 admin/
// owner 可调（否则 403）；不能移出自己/最后一名 admin（409）。UI 诚实透传服务端错误。
export function removeWorkspaceMember(
  client: Pick<WorkbenchRailApiClient, "request">,
  userId: string
): Promise<{ removed_user_id: string }> {
  return client.request<{ removed_user_id: string }>(`/api/workspace/members/${encodeURIComponent(userId)}`, {
    method: "DELETE"
  });
}

// 私聊分组：actor 参与的 DM 会话（GET /api/dm/list → store.dmList）。每行 = 对方头像（在线绿点）+ 对方
// 昵称，点击打开该 DM（data-wb-open-dm=会话 id）。空态一行淡字点破「怎么发起私聊」。
export function renderDmGroupHtml(input: {
  dmList: readonly DmListItemVM[];
  currentUserId: string | undefined;
  onlineUserIds: ReadonlySet<string>;
  activeDmConversationId?: string;
  centerTab: WorkbenchCenterTab;
  locale: Locale;
}): string {
  const zh = input.locale === "zh-CN";
  const head = `<div class="wh-wb-rail-head wh-wb-rail-head--flush">${zh ? "私聊" : "Direct messages"}</div>`;
  if (input.dmList.length === 0) {
    const hint = `<p class="wh-wb-dm-empty">${zh ? "点成员头像发起私聊" : "Click a member's avatar to start a chat"}</p>`;
    return `<div class="wh-wb-rail-group">${head}${hint}</div>`;
  }
  const rows = input.dmList
    .map((dm) => {
      const peer = dmPeerParticipant(dm, input.currentUserId);
      const nickname = peer?.nickname ?? (zh ? "私聊" : "Direct message");
      const peerId = peer?.user_id ?? dm.conversation.id;
      const online = peer ? input.onlineUserIds.has(peer.user_id) : false;
      const selected = input.centerTab === "dm" && input.activeDmConversationId === dm.conversation.id;
      const unread = dm.conversation.unread_count ?? 0;
      const unreadBadge = unread > 0 ? `<span class="wh-wb-dm-count">${unread}</span>` : "";
      return `<button type="button" class="wh-wb-dm-row${selected ? " sel" : ""}" data-wb-open-dm="${escapeHtml(
        dm.conversation.id
      )}" aria-current="${selected ? "true" : "false"}">${avatarTileHtml({
        label: nickname,
        id: peerId,
        ...(online ? { online: true } : {})
      })}<span class="wh-wb-dm-name">${escapeHtml(nickname)}</span>${unreadBadge}</button>`;
    })
    .join("");
  return `<div class="wh-wb-rail-group">${head}${rows}</div>`;
}

// L-03（R24 S3 走查）：占位符此前含一个真实公司名——公开仓库不该留客户真名，换成中性示例；
// 与 spotlight/views/new-project.ts 那份盒子内联新建入口用同一个示例名，两处口径一致。
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
        placeholder="${zh ? "项目名，如：产品路线图" : "Project name, e.g. Product roadmap"}"
        data-wb-new-project-name
        value="${escapeHtml(input.name)}"
        ${input.submitting ? "disabled" : ""}
      />
      <p class="wh-wb-modal-note">${
        zh
          ? "创建即自动配好：<b>主区群聊（全员可聊）· 项目网盘 · Cuu 入驻 · 模式默认「分级自动」</b>。项目成员在设置的「成员」分区查看，加人/退群在各协同会话里管理。"
          : "Creating it wires up <b>a team chat, project drive, and Cuu — mode defaults to \"tiered auto\"</b>. See project members under Settings; add or remove people inside each collab chat."
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

// R13 批 S3（个人空间）：创建入口只填名字，不需要选工作区/邀请成员——名字甚至可以留空（服务端
// 按「我的空间」/「我的空间 2」…自动命名），所以提交按钮不像团队项目模态那样要求非空才可点。
// 文案也不提团队语境（无「全员可聊」/「成员邀请」），个人空间仅本人可见。
export function renderNewPersonalSpaceModalHtml(input: {
  locale: Locale;
  open: boolean;
  name: string;
  submitting: boolean;
  error?: string | undefined;
}): string {
  const zh = input.locale === "zh-CN";
  return `<div class="wh-wb-modal-overlay" data-wb-new-personal-space-overlay data-open="${input.open ? "true" : "false"}">
    <div class="wh-wb-modal" role="dialog" aria-modal="true" aria-label="${zh ? "新建个人空间" : "New personal space"}">
      <h3 class="wh-wb-modal-title">${zh ? "新建个人空间" : "New personal space"}</h3>
      <input
        class="wh-wb-modal-input"
        type="text"
        maxlength="128"
        placeholder="${zh ? "留空即自动命名「我的空间」" : "Leave blank to auto-name it \"My space\""}"
        data-wb-new-personal-space-name
        value="${escapeHtml(input.name)}"
        ${input.submitting ? "disabled" : ""}
      />
      <p class="wh-wb-modal-note">${
        zh
          ? "个人空间只有你自己能看到，跳过团队邀请与治理设置，建好即可和 Cuu 对话。"
          : "Only you can see a personal space — no team invites or governance setup, just you and Cuu."
      }</p>
      ${input.error ? `<p class="wh-wb-modal-error">${escapeHtml(input.error)}</p>` : ""}
      <div class="wh-wb-modal-actions">
        <button type="button" class="wh-wb-btn wh-wb-btn--ghost" data-wb-new-personal-space-cancel ${input.submitting ? "disabled" : ""}>${zh ? "取消" : "Cancel"}</button>
        <button type="button" class="wh-wb-btn wh-wb-btn--primary" data-wb-new-personal-space-submit ${input.submitting ? "disabled" : ""}>
          ${input.submitting ? (zh ? "创建中…" : "Creating…") : zh ? "创建个人空间" : "Create personal space"}
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
            // R14 批 AVATAR（头像与资料入口，2026-07-14 用户点名新增）：建群选人器每行加头像 tile——
            // 复用 chat/render.ts 导出的 avatarTileHtml（同一套首字母色块+hue 算法+
            // data-wb-avatar-user-id 钩子），不重写第二份。真实头像图的挂载见 mountWorkbenchRail 的
            // render() 里对 hydrateAvatarPhotos(container) 的调用（从 chat/view.ts 复用同一个函数）。
            return `<label class="wh-wb-new-collab-member-row">
        <input type="checkbox" data-wb-new-collab-member="${escapeHtml(member.userId)}" ${checked ? "checked" : ""} ${state.submitting ? "disabled" : ""} />
        ${avatarTileHtml({ label: member.nickname, id: member.userId })}
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

// R14FIX 批 workbench（会话重命名，2026-07-15 用户反馈）：重命名小弹窗——只有一个标题输入框，复用建群/
// 新建项目那套 .wh-wb-modal* 弹窗外壳（不新造弹窗底盘）。纯函数，imperative 的 PATCH/刷新在
// mountWorkbenchRail 里（同其它 render* 函数）。
export type RenameCollabModalUiState = {
  open: boolean;
  conversationId?: string | undefined;
  title: string;
  submitting: boolean;
  error?: string | undefined;
};

export const IDLE_RENAME_COLLAB_MODAL_STATE: RenameCollabModalUiState = {
  open: false,
  title: "",
  submitting: false
};

export function renderRenameCollabModalHtml(input: { locale: Locale; state: RenameCollabModalUiState }): string {
  const zh = input.locale === "zh-CN";
  const state = input.state;
  return `<div class="wh-wb-modal-overlay" data-wb-rename-collab-overlay data-open="${state.open ? "true" : "false"}">
    <div class="wh-wb-modal" role="dialog" aria-modal="true" aria-label="${zh ? "重命名会话" : "Rename chat"}">
      <h3 class="wh-wb-modal-title">${zh ? "重命名会话" : "Rename chat"}</h3>
      <input
        class="wh-wb-modal-input"
        type="text"
        maxlength="256"
        placeholder="${zh ? "会话名，如：改第三幕" : "Chat name"}"
        data-wb-rename-collab-input
        value="${escapeHtml(state.title)}"
        ${state.submitting ? "disabled" : ""}
      />
      ${state.error ? `<p class="wh-wb-modal-error">${escapeHtml(state.error)}</p>` : ""}
      <div class="wh-wb-modal-actions">
        <button type="button" class="wh-wb-btn wh-wb-btn--ghost" data-wb-rename-collab-cancel ${state.submitting ? "disabled" : ""}>${zh ? "取消" : "Cancel"}</button>
        <button type="button" class="wh-wb-btn wh-wb-btn--primary" data-wb-rename-collab-submit ${state.submitting || !state.title.trim() ? "disabled" : ""}>
          ${state.submitting ? (zh ? "保存中…" : "Saving…") : zh ? "保存" : "Save"}
        </button>
      </div>
    </div>
  </div>`;
}

export type WorkbenchRailHandle = {
  refresh: () => void;
  // R15 批 B（人对人私聊）：只重拉 DM 列表——shell「发私聊」新建后回流对齐服务端权威。
  refreshDms: () => void;
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
    // R15 批 E2（项目时间线 / 甘特）：项目行的「时间线」树叶点击——shell.ts 把它接成 store.centerTab = "timeline"。
    onOpenTimeline?: () => void;
    // R16 批 W2：项目行的「任务看板」树叶点击——shell.ts 把它接成 store.centerTab = "kanban"。
    onOpenKanban?: () => void;
    // R16 批 W2：项目行的「日程」树叶点击——shell.ts 把它接成 store.centerTab = "schedule"。
    onOpenSchedule?: () => void;
    // R13 批 P1：军团总览一级入口点击——shell.ts 把它接成 store.centerTab = "army-overview"。
    onOpenArmyOverview?: () => void;
    // R15 批 I1（决策收件箱）：rail 顶部「待拍板」一级入口点击——shell.ts 把它接成 store.centerTab = "inbox"。
    onOpenInbox?: () => void;
    // R13 批 P3：项目行的「项目设置」齿轮点击——shell.ts 把它接成 store.centerTab = "project-settings"。
    onOpenProjectSettings?: () => void;
    // R15 批 B（人对人私聊）：私聊分组某条 DM 会话被点开——传的是该 DM 会话的真实 id（shell.ts 用它去
    // store.dmList 里找到那条 DmListItemVM，走「按会话直开」路径挂 chat 视图，不拉容器 VM）。
    onOpenDmConversation?: (conversationId: string) => void;
  }
): WorkbenchRailHandle {
  let modalName = "";
  let modalSubmitting = false;
  let modalError: string | undefined;
  let newCollabSubmitting = false;
  let newCollabError: string | undefined;
  // R13 批 S3（个人空间）：与团队项目模态平行的一套瞬态 UI 状态，互不共享。
  let personalSpaceName = "";
  let personalSpaceSubmitting = false;
  let personalSpaceError: string | undefined;
  // R13 批 G1（小群）：建群模态的瞬态输入态——同 modalName/modalSubmitting 一样是纯本地状态，不进
  // 共享 store（只有这个组件自己的渲染需要读它）。newCollabSubmitting/newCollabError 复用批 P2 已有的
  // 那两个变量，语义不变（真的在发 HTTP 请求/请求失败），只是现在由模态的提交按钮触发，不再是树叶
  // 按钮直接触发。
  let newCollabModalOpen = false;
  let newCollabModalTitle = "";
  let newCollabModalSelectedUserIds: string[] = [];
  let newCollabModalCuuEnabled = true;
  // R14FIX 批 workbench（会话重命名）：重命名弹窗的瞬态输入态——独立于建群/新建项目的那几套，互不共享。
  let renameModalOpen = false;
  let renameModalConversationId: string | undefined;
  let renameModalTitle = "";
  let renameSubmitting = false;
  let renameError: string | undefined;
  // R17 批 G1（#14 邀请 / #15 成员移出）：roster 管理模式 + 邀请表单的瞬态本地状态（同其它弹窗，不进
  // 共享 store——只有这个组件的渲染读它）。canManage 由 VM 的 viewer.membership_role 派生（见 render）。
  let rosterManage = false;
  let rosterBusyUserId: string | undefined;
  let rosterConfirmRemoveUserId: string | undefined;
  let rosterManageError: string | undefined;
  let rosterInvite: RosterInviteUiState = { open: false, email: "", submitting: false };
  let disposed = false;

  const render = () => {
    if (disposed) {
      return;
    }
    const state = input.store.getState();
    const zh = input.locale === "zh-CN";
    // R25-Q：连接状态单一真相——不再只要 vm 加载成功就硬编码"已连接"，读 store.connectionState
    // （boot.ts 拉 get_connection_state 初值 + 订阅 workhub-connection-changed 写入）。undefined
    // （应用刚起、还没收到任何判定的极短窗口）沿用"已连接"这个兜底：vm 能加载成功本身就是连通性的
    // 证据，好过在这极短空窗期里显示一个更消极的猜测。
    const connectionWord =
      state.connectionState?.state === "offline"
        ? zh ? "离线" : "Offline"
        : state.connectionState?.state === "reconnecting"
          ? zh ? "重连中" : "Reconnecting"
          : zh ? "已连接" : "connected";
    const viewerLabel = state.vm
      ? `${state.vm.workspace_members.items[0]?.nickname ?? ""} · ${connectionWord}`
      : undefined;
    const activeConversationIdField =
      state.activeConversationId !== undefined ? { activeConversationId: state.activeConversationId } : {};
    // R15 批 B：成员 roster / 私聊分组共用的在线集合 + 当前 viewer。
    const onlineUserIds = new Set(state.onlineUserIds);
    const currentUserId = state.currentUserId ?? state.vm?.viewer.user_id;
    container.innerHTML = `${renderInboxNavHtml(zh, state.centerTab === "inbox", state.inboxCount)}${renderPersonalSpaceSectionHtml({
      personalProjects: state.personalProjects,
      selectedProjectId: state.selectedProjectId,
      vm: state.vm,
      locale: input.locale,
      centerTab: state.centerTab,
      ...activeConversationIdField,
      newCollab: { submitting: newCollabSubmitting, error: newCollabError }
    })}${renderProjectTreeHtml({
      projects: state.projects,
      selectedProjectId: state.selectedProjectId,
      vm: state.vm,
      locale: input.locale,
      centerTab: state.centerTab,
      // exactOptionalPropertyTypes：activeConversationId?: string 不接受显式 undefined（同
      // view.ts toPendingRenderModel 的既有取舍），state.activeConversationId 没值时干脆不传这个键。
      ...activeConversationIdField,
      newCollab: { submitting: newCollabSubmitting, error: newCollabError }
    })}${renderArmyOverviewNavHtml(zh, state.centerTab === "army-overview")}${renderRosterGroupHtml({
      members: state.vm?.workspace_members.items ?? [],
      currentUserId,
      onlineUserIds,
      locale: input.locale,
      // R17 批 G1：只有工作区 admin/owner 才渲「管理」/「邀请」入口（viewer.membership_role !== 'member'）。
      canManage: state.vm ? state.vm.viewer.membership_role !== "member" : false,
      manage: rosterManage,
      busyUserId: rosterBusyUserId,
      confirmRemoveUserId: rosterConfirmRemoveUserId,
      manageError: rosterManageError,
      invite: rosterInvite
    })}${renderDmGroupHtml({
      dmList: state.dmList,
      currentUserId,
      onlineUserIds,
      ...(state.activeDmConversationId !== undefined ? { activeDmConversationId: state.activeDmConversationId } : {}),
      centerTab: state.centerTab,
      locale: input.locale
    })}${renderRailFootHtml(zh, viewerLabel)}${renderNewProjectModalHtml({
      locale: input.locale,
      open: state.newProjectModalOpen,
      name: modalName,
      submitting: modalSubmitting,
      error: modalError
    })}${renderNewPersonalSpaceModalHtml({
      locale: input.locale,
      open: state.newPersonalSpaceModalOpen,
      name: personalSpaceName,
      submitting: personalSpaceSubmitting,
      error: personalSpaceError
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
    })}${renderRenameCollabModalHtml({
      locale: input.locale,
      state: {
        open: renameModalOpen,
        ...(renameModalConversationId !== undefined ? { conversationId: renameModalConversationId } : {}),
        title: renameModalTitle,
        submitting: renameSubmitting,
        error: renameError
      }
    })}`;
    // R14 批 AVATAR：建群选人器行的头像 tile 换真图（若有）——复用 chat/view.ts 的同一个命令式
    // 挂载步骤，不重写第二份 fetch+blob URL 逻辑。
    hydrateAvatarPhotos(container);
  };

  const loadPersonalProjects = async () => {
    input.store.setState({ personalProjectsLoad: "loading" });
    try {
      const result = await input.client.request<{ projects: ProjectListItemVM[] }>("/api/me/personal-projects");
      if (disposed) {
        return;
      }
      input.store.setState({ personalProjects: result.projects, personalProjectsLoad: "ready" });
    } catch {
      if (disposed) {
        return;
      }
      input.store.setState({ personalProjectsLoad: "error" });
    }
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

  // R15 批 B（人对人私聊）：拉 actor 参与的 DM 列表（私聊分组数据源）。没选任何项目也能拉（不依赖 VM）。
  // 顺手兜一次 currentUserId（VM 还没就绪时，从 DM 的 is_self 参与者拿），供 roster 排除自己/资料卡判自己。
  const loadDms = async () => {
    input.store.setState({ dmListLoad: "loading" });
    try {
      const result = await fetchDmList(input.client);
      if (disposed) {
        return;
      }
      const state = input.store.getState();
      const selfFromDm = result.items
        .flatMap((item) => item.participants)
        .find((participant) => participant.is_self)?.user_id;
      input.store.setState({
        dmList: result.items,
        dmListLoad: "ready",
        ...(state.currentUserId === undefined && selfFromDm ? { currentUserId: selfFromDm } : {})
      });
      // 拉到新的一批人（DM 对方）后立即刷一次在线态，不干等 30s 轮询。
      void loadPresence();
    } catch {
      if (disposed) {
        return;
      }
      input.store.setState({ dmListLoad: "error" });
    }
  };

  // R15 批 B（在线两态）：为 roster 成员 + DM 对方拉在线态（≤50 一批，分批并集，见 dm.ts 的
  // fetchOnlineUserIds）。排除自己（自己不显示在线点）。空集不打网络。
  const loadPresence = async () => {
    const state = input.store.getState();
    const self = state.currentUserId ?? state.vm?.viewer.user_id;
    const ids = new Set<string>();
    for (const member of state.vm?.workspace_members.items ?? []) {
      if (member.user_id !== self) {
        ids.add(member.user_id);
      }
    }
    for (const dm of state.dmList) {
      for (const participant of dm.participants) {
        if (participant.user_id !== self) {
          ids.add(participant.user_id);
        }
      }
    }
    if (ids.size === 0) {
      return;
    }
    try {
      // R20 DSK-UX（R19-11 presence 单源）：拿每个 user 的 is_online 原值，per-user 合并进单源
      // store.onlineUserIds（不再整列替换）——这样聊天区经同一 presence handle 写进来的、rail 本批没查的
      // user 不会被 rail 这拍误清成离线。rail 每拍都查全 roster+DM 对方，离线者本就在批里，会被正常移除。
      const entries = await fetchPresenceEntries(input.client, [...ids]);
      if (disposed) {
        return;
      }
      const current = input.store.getState().onlineUserIds;
      const next = applyPresenceToOnlineIds(current, entries);
      if (next !== current) {
        input.store.setState({ onlineUserIds: next });
      }
    } catch {
      // best-effort：拉不到就保持上一次的在线集合，不清成「全离线」骚扰视觉。
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

  // R13 批 S3（个人空间）：POST /api/me/personal-projects——名字可以留空（服务端按「我的空间」/
  // 「我的空间 2」…自动命名），所以这里不像 submitNewProject 那样在空名时直接 return。走
  // client.request 而不是新增 WorkHubApiClient 具名方法（同 createCollabConversation 顶部注释的
  // 既有取舍：不为单个批次特性扩大具名方法面）。
  const submitNewPersonalSpace = async () => {
    if (personalSpaceSubmitting) {
      return;
    }
    const name = personalSpaceName.trim();
    personalSpaceSubmitting = true;
    personalSpaceError = undefined;
    render();
    try {
      const result = await input.client.request<{ project: { id: string } }>("/api/me/personal-projects", {
        method: "POST",
        body: JSON.stringify(name ? { name } : {})
      });
      if (disposed) {
        return;
      }
      personalSpaceSubmitting = false;
      personalSpaceName = "";
      input.store.setState({ newPersonalSpaceModalOpen: false });
      await loadPersonalProjects();
      if (disposed) {
        return;
      }
      input.onSelectProject(result.project.id);
    } catch (error) {
      if (disposed) {
        return;
      }
      personalSpaceSubmitting = false;
      personalSpaceError =
        error instanceof Error ? error.message : input.locale === "zh-CN" ? "创建失败，请重试" : "Couldn't create it — retry";
      render();
    }
  };

  const openNewPersonalSpaceModal = () => {
    personalSpaceName = "";
    personalSpaceError = undefined;
    input.store.setState({ newPersonalSpaceModalOpen: true });
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

  // R14FIX 批 workbench（缺「单独和 Cuu 聊」入口）：一键建一条只有自己 + Cuu 的私有会话并打开——复用
  // createCollabConversation（participantUserIds 空 = 1:1、cuuEnabled=true），不经过建群弹窗。in-flight/
  // error 复用 newCollabSubmitting/newCollabError（语义都是"正在建一条协同会话/建失败了"），跟树叶按钮
  // 的忙碌态天然联动。
  const submitSoloCuuConversation = async () => {
    if (newCollabSubmitting) {
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
        title: input.locale === "zh-CN" ? "和 Cuu 单独聊" : "Just me and Cuu",
        participantUserIds: [],
        cuuEnabled: true
      });
      if (disposed) {
        return;
      }
      newCollabSubmitting = false;
      const latestVm = input.store.getState().vm;
      if (latestVm && latestVm.project.id === projectId) {
        input.store.setState({ vm: appendCollabConversationToVm(latestVm, result.conversation) });
        input.onOpenCollabConversation?.(result.conversation.id);
      } else {
        render();
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

  // R14FIX 批 workbench（会话重命名）：铅笔点开重命名弹窗，预填当前标题（从叶子 data 属性带过来，不再
  // 回 store 找）。开弹窗时清掉上一次的错误/提交态。
  const openRenameModal = (conversationId: string, currentTitle: string) => {
    renameModalConversationId = conversationId;
    renameModalTitle = currentTitle;
    renameError = undefined;
    renameSubmitting = false;
    renameModalOpen = true;
    render();
  };

  const closeRenameModal = () => {
    renameModalOpen = false;
    renameModalConversationId = undefined;
    renameError = undefined;
    render();
  };

  // PATCH /api/conversations/:id 改名，成功后就地改左栏树叶（renameCollabConversationInVm），不重拉整份
  // VM（同 submitNewCollabConversation 的取舍）。请求打完之间用户可能已经切走了项目——只在还停在同一个
  // 项目时才把新标题合并进当前 VM。
  const submitRenameConversation = async () => {
    if (renameSubmitting) {
      return;
    }
    const conversationId = renameModalConversationId;
    const title = renameModalTitle.trim();
    if (!conversationId || !title) {
      return;
    }
    renameSubmitting = true;
    renameError = undefined;
    render();
    try {
      const result = await renameCollabConversation(input.client, conversationId, title);
      if (disposed) {
        return;
      }
      renameSubmitting = false;
      renameModalOpen = false;
      renameModalConversationId = undefined;
      const latestVm = input.store.getState().vm;
      if (latestVm) {
        input.store.setState({
          vm: renameCollabConversationInVm(latestVm, conversationId, result.conversation.title)
        });
      } else {
        render();
      }
    } catch (error) {
      if (disposed) {
        return;
      }
      renameSubmitting = false;
      renameError =
        error instanceof Error ? error.message : input.locale === "zh-CN" ? "改名失败，请重试" : "Couldn't rename it — retry";
      render();
    }
  };

  // ── R17 批 G1（#14 邀请 / #15 成员移出）：roster 管理/邀请处理器 ────────────────────────────
  const toggleRosterManage = () => {
    rosterManage = !rosterManage;
    rosterConfirmRemoveUserId = undefined;
    rosterManageError = undefined;
    render();
  };

  const openRosterInvite = () => {
    rosterInvite = { open: true, email: "", submitting: false };
    render();
    const emailInput = container.querySelector<HTMLInputElement>("[data-wb-invite-email]");
    emailInput?.focus();
  };

  const closeRosterInvite = () => {
    rosterInvite = { open: false, email: "", submitting: false };
    render();
  };

  const submitRosterInvite = async () => {
    if (rosterInvite.submitting) {
      return;
    }
    const email = rosterInvite.email.trim();
    if (!email) {
      return;
    }
    rosterInvite = { ...rosterInvite, submitting: true, note: undefined, error: undefined };
    render();
    try {
      const result = await createWorkspaceInvite(input.client, email);
      if (disposed) {
        return;
      }
      // 一次性 token 复制到剪贴板——复制失败就把 token 落进提示文案，绝不让它丢失（只能取回这一次）。
      let copied = false;
      try {
        await globalThis.navigator?.clipboard?.writeText(result.token);
        copied = true;
      } catch {
        copied = false;
      }
      const zh = input.locale === "zh-CN";
      const note = copied
        ? zh
          ? `已生成邀请并复制 token，发给 ${result.email} 即可加入。`
          : `Invite created and token copied — send it to ${result.email}.`
        : zh
          ? `邀请 token（复制失败，请手动复制）：${result.token}`
          : `Invite token (copy failed, copy manually): ${result.token}`;
      rosterInvite = { open: true, email: "", submitting: false, note };
      render();
    } catch (error) {
      if (disposed) {
        return;
      }
      rosterInvite = {
        ...rosterInvite,
        submitting: false,
        error:
          error instanceof Error
            ? error.message
            : input.locale === "zh-CN"
              ? "生成邀请失败，请重试"
              : "Couldn't create the invite — retry"
      };
      render();
    }
  };

  const requestRemoveMember = (userId: string) => {
    rosterConfirmRemoveUserId = userId;
    rosterManageError = undefined;
    render();
  };

  const cancelRemoveMember = () => {
    rosterConfirmRemoveUserId = undefined;
    render();
  };

  const confirmRemoveMember = async (userId: string) => {
    if (rosterBusyUserId) {
      return;
    }
    rosterBusyUserId = userId;
    rosterManageError = undefined;
    render();
    try {
      await removeWorkspaceMember(input.client, userId);
      if (disposed) {
        return;
      }
      rosterBusyUserId = undefined;
      rosterConfirmRemoveUserId = undefined;
      // 乐观就地从 roster 剔除（工作区花名册在 VM 里，无独立轻量重拉端点）——顺带把计数对齐。
      const vm = input.store.getState().vm;
      if (vm) {
        const items = vm.workspace_members.items.filter((member) => member.user_id !== userId);
        if (items.length !== vm.workspace_members.items.length) {
          input.store.setState({
            vm: {
              ...vm,
              workspace_members: {
                ...vm.workspace_members,
                items,
                total: Math.max(items.length, vm.workspace_members.total - 1),
                returned: items.length
              }
            }
          });
        }
      }
      render();
    } catch (error) {
      if (disposed) {
        return;
      }
      rosterBusyUserId = undefined;
      rosterConfirmRemoveUserId = undefined;
      rosterManageError =
        error instanceof Error
          ? error.message
          : input.locale === "zh-CN"
            ? "移出失败，请重试"
            : "Couldn't remove them — retry";
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
    if (target.closest("[data-wb-new-personal-space]")) {
      openNewPersonalSpaceModal();
      return;
    }
    if (target.closest("[data-wb-open-main-chat]")) {
      input.onOpenMainConversation?.();
      return;
    }
    // R14FIX 批 workbench：会话叶子的重命名铅笔——它是 open 按钮的兄弟节点，必须在 open 判定之前拦下
    // （虽然 closest 各自独立，但先判它更直白）。
    const renameBtn = target.closest<HTMLElement>("[data-wb-rename-collab]");
    if (renameBtn?.dataset.wbRenameCollab) {
      openRenameModal(renameBtn.dataset.wbRenameCollab, renameBtn.dataset.wbRenameCollabTitle ?? "");
      return;
    }
    const collabLeaf = target.closest<HTMLElement>("[data-wb-open-collab-chat]");
    if (collabLeaf?.dataset.wbOpenCollabChat) {
      input.onOpenCollabConversation?.(collabLeaf.dataset.wbOpenCollabChat);
      return;
    }
    // R15 批 B（人对人私聊）：私聊分组的 DM 行点击——把该 DM 会话 id 抛给 shell 走「按会话直开」路径。
    const dmRow = target.closest<HTMLElement>("[data-wb-open-dm]");
    if (dmRow?.dataset.wbOpenDm) {
      input.onOpenDmConversation?.(dmRow.dataset.wbOpenDm);
      return;
    }
    // R14FIX 批 workbench：「和 Cuu 单独聊」快捷入口。
    if (target.closest("[data-wb-new-solo-cuu]")) {
      void submitSoloCuuConversation();
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
    if (target.closest("[data-wb-open-timeline]")) {
      input.onOpenTimeline?.();
      return;
    }
    if (target.closest("[data-wb-open-kanban]")) {
      input.onOpenKanban?.();
      return;
    }
    if (target.closest("[data-wb-open-schedule]")) {
      input.onOpenSchedule?.();
      return;
    }
    if (target.closest("[data-wb-open-inbox]")) {
      input.onOpenInbox?.();
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
    // R17 批 G1（#14 邀请 / #15 成员移出）：roster 管理模式切换 / 邀请入口 / 移出确认。
    if (target.closest("[data-wb-roster-manage-toggle]")) {
      toggleRosterManage();
      return;
    }
    if (target.closest("[data-wb-invite-member]")) {
      openRosterInvite();
      return;
    }
    if (target.closest("[data-wb-invite-cancel]")) {
      closeRosterInvite();
      return;
    }
    if (target.closest("[data-wb-invite-submit]")) {
      void submitRosterInvite();
      return;
    }
    const removeConfirmBtn = target.closest<HTMLElement>("[data-wb-remove-member-confirm]");
    if (removeConfirmBtn?.dataset.wbRemoveMemberConfirm) {
      void confirmRemoveMember(removeConfirmBtn.dataset.wbRemoveMemberConfirm);
      return;
    }
    if (target.closest("[data-wb-remove-member-cancel]")) {
      cancelRemoveMember();
      return;
    }
    const removeBtn = target.closest<HTMLElement>("[data-wb-remove-member]");
    if (removeBtn?.dataset.wbRemoveMember) {
      requestRemoveMember(removeBtn.dataset.wbRemoveMember);
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
    // R13 批 S3：新建个人空间模态的取消/背景点击/提交——与上面团队项目模态同一套约定，独立状态。
    const clickedPersonalSpaceOverlayBackdrop = target.hasAttribute("data-wb-new-personal-space-overlay");
    if (target.closest("[data-wb-new-personal-space-cancel]") || clickedPersonalSpaceOverlayBackdrop) {
      input.store.setState({ newPersonalSpaceModalOpen: false });
      return;
    }
    if (target.closest("[data-wb-new-personal-space-submit]")) {
      void submitNewPersonalSpace();
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
      return;
    }
    // R14FIX 批 workbench：重命名弹窗的取消/点遮罩背景关闭 + 提交，同其它弹窗同一套约定。
    const clickedRenameOverlayBackdrop = target.hasAttribute("data-wb-rename-collab-overlay");
    if (target.closest("[data-wb-rename-collab-cancel]") || clickedRenameOverlayBackdrop) {
      closeRenameModal();
      return;
    }
    if (target.closest("[data-wb-rename-collab-submit]")) {
      void submitRenameConversation();
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
    if (target instanceof HTMLInputElement && target.matches("[data-wb-new-personal-space-name]")) {
      personalSpaceName = target.value;
      render();
      const input3 = container.querySelector<HTMLInputElement>("[data-wb-new-personal-space-name]");
      if (input3) {
        input3.focus();
        const end = input3.value.length;
        try {
          input3.setSelectionRange(end, end);
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
      return;
    }
    // R14FIX 批 workbench：重命名弹窗标题输入——同上一套"重渲后还焦点/光标"处理。
    if (target instanceof HTMLInputElement && target.matches("[data-wb-rename-collab-input]")) {
      renameModalTitle = target.value;
      render();
      const renameInput = container.querySelector<HTMLInputElement>("[data-wb-rename-collab-input]");
      if (renameInput) {
        renameInput.focus();
        const end = renameInput.value.length;
        try {
          renameInput.setSelectionRange(end, end);
        } catch {
          // ignore: some input rendering modes reject setSelectionRange.
        }
      }
      return;
    }
    // R17 批 G1（#14 邀请成员）：邀请邮箱输入——重渲后把焦点/光标位置还给输入框（innerHTML 重建会丢焦点）。
    if (target instanceof HTMLInputElement && target.matches("[data-wb-invite-email]")) {
      rosterInvite = { ...rosterInvite, email: target.value };
      render();
      const emailInput = container.querySelector<HTMLInputElement>("[data-wb-invite-email]");
      if (emailInput) {
        emailInput.focus();
        const end = emailInput.value.length;
        try {
          emailInput.setSelectionRange(end, end);
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
  void loadPersonalProjects();
  // R15 批 B（人对人私聊）：拉 DM 列表 + 起 presence 轮询（成员 roster / 私聊行的在线绿点）。
  void loadDms();
  // R15 批 A6：与在线态同 30s 节奏兜底刷 DM 列表——把私聊行的未读数拉回服务端权威（me-stream 的本地 +1
  // 只是近似）。loadDms 内部拉完列表会顺手刷一次在线态（见 loadDms 尾部），所以这条 tick 同时覆盖了原来
  // 单独 loadPresence 的职责；DM 拉取失败那一拍在线态不刷，下一拍重试即可（都是 best-effort）。
  const presencePollTimer = setInterval(() => {
    if (!disposed) {
      void loadDms();
    }
  }, RAIL_PRESENCE_POLL_INTERVAL_MS);

  return {
    refresh: () => {
      void loadProjects();
      void loadPersonalProjects();
      void loadDms();
    },
    // R15 批 B：shell 的「发私聊」新建 DM 后回流——重拉列表把服务端权威顺序/参与者对齐。
    refreshDms: () => {
      void loadDms();
    },
    openNewProjectModal,
    dispose: () => {
      disposed = true;
      clearInterval(presencePollTimer);
      unsubscribe();
    }
  };
}
