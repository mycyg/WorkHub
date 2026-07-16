// WorkHub 桌面 · 工作台状态容器。
// 批 1 只需要「当前选中项目 + 项目树数据 + 右栏收放」这点状态；批 2 起的会话消息流/军团 run 切片会往这个
// store 上加字段，但不在这里预先设计——先留一个足够薄的订阅容器，避免过度设计（02 §3 明确要求）。

import type { DmListItemVM, ProjectListItemVM, WorkbenchPageVM } from "@workhub/contracts";

export type WorkbenchLoadState = "idle" | "loading" | "ready" | "error";

// 中栏当前显示哪个能力视图。批 2 只有 "chat"；批 6 加 "drive"（rail 的「网盘」树叶接真视图）；
// final-turns-wiring 加 "collab"——rail.ts 新增的协同会话树叶点开后，中栏切到某个具体的协同会话
// （哪一个由下面的 activeConversationId 指出），复用同一个 chat/view.ts 组件（mountChatView 的
// conversationKind 参数区分主区/单聊）。R13 批 P1 加 "army-overview"——rail.ts 新的一级入口「军团总览」
// 点开后中栏切到跨项目军团卡片流（army/overview.ts），这个视图不依赖 selectedProjectId。
// R13 批 P3 加 "project-settings"——rail 项目行的设置按钮（仅项目负责人渲染，见 rail.ts）点开后，
// 中栏切到该项目的 AI 治理表单（settings/view.ts），依赖 selectedProjectId + vm。
// R15 批 B（人对人私聊）加 "dm"——rail「私聊」分组的会话点开后，中栏切到某条 DM（哪一条由
// activeDmConversationId 指出）。DM 容器项目对项目树/工作台 VM 全线围栏，DM 走「按会话直开」路径
// （不拉容器项目的 VM，见 shell.ts 的 renderCenter 的 "dm" 分支）——数据源是 store.dmList 里那条
// DmListItemVM（会话 + 两名参与者），而不是 selectedProjectId/vm。
// R15 批 I1（决策收件箱进 workbench）加 "inbox"——rail 顶部「待拍板」一级入口点开后，中栏切到跨项目的
// 决策收件箱（workbench/inbox/view.ts，复用 spotlight attention 的全类型决策渲染/动作）。同 army-overview，
// 这个视图不依赖 selectedProjectId（是「所有要你拍板的」总览，横跨项目）。
// R15 批 E2（项目时间线 / 甘特）加 "timeline"——rail 项目行的「时间线」树叶（与主区/网盘同级）点开后，
// 中栏切到该项目的甘特时间线（workbench/timeline/view.ts），依赖 selectedProjectId + vm（同 drive/settings）。
// R16 批 W2 加 "kanban" / "schedule"——rail 项目行的「任务看板」「日程」两叶（与时间线同级）点开后，中栏
// 分别切到该项目的看板（workbench/kanban/view.ts，四列按真实状态归组 + 派发拖拽）与周历日程
// （workbench/schedule/view.ts，左计划摘要 + 右 7 列周历），都依赖 selectedProjectId + vm（同 timeline）。
// R16-W3 加 "editor"——右栏「文件」模式的变动文件行点开后，中栏切到该文件的 tracked-changes 审阅器
// （workbench/editor/view.ts，据 editorTarget 打开）。入口走右栏点击而非 rail 叶;两批都是 append 不重排。
export type WorkbenchCenterTab =
  | "chat"
  | "drive"
  | "collab"
  | "dm"
  | "army-overview"
  | "project-settings"
  | "inbox"
  | "timeline"
  | "kanban"
  | "schedule"
  | "editor";

// 右栏情境面板的内容——刻意保持不透明（ownerId + 预渲染好的 html），store.ts 不认识任何具体视图
// 的类型（drive 的版本历史/军团卡片等），谁在挂载期间持有内容所有权就把自己的 ownerId 写进来、
// 卸载时清空。这样多个视图可以共用同一块右栏而不用互相 import 对方的类型（照本文件顶部注释的
// "薄容器"设计取向）。
export type WorkbenchSidePanelContent = { ownerId: string; html: string } | undefined;

export type WorkbenchStoreState = {
  // 左栏项目树数据源。
  projects: ProjectListItemVM[];
  projectsLoad: WorkbenchLoadState;
  // R13 批 S3（个人空间）：独立于团队项目树的数据源——GET /api/me/personal-projects 只回该用户
  // 名下 is_personal=true 的项目，与 projects（团队列表，服务端已过滤掉 is_personal=true）互斥，
  // rail.ts 渲染成「我的空间」独立分组，不与 renderProjectTreeHtml 的团队项目列表合并。
  personalProjects: ProjectListItemVM[];
  personalProjectsLoad: WorkbenchLoadState;
  // 当前选中的项目（rail 点击 / Spotlight「打开工作台」/ 深链三路共用同一份状态）。
  selectedProjectId: string | undefined;
  // 深链带来的会话目标：批 1 还没有会话视图，先存着，批 2 群聊/协同视图接入时直接消费。
  pendingConversationId: string | undefined;
  // 选中项目的 bootstrap VM（GET /api/pages/workbench/:projectId）。
  vm: WorkbenchPageVM | undefined;
  vmLoad: WorkbenchLoadState;
  vmError: string | undefined;
  // 中栏当前视图（批 6 新增；默认 "chat"，rail「网盘」树叶点击切到 "drive"）。
  centerTab: WorkbenchCenterTab;
  // final-turns-wiring 新增：centerTab === "collab" 时，中栏具体打开的是 vm.conversations.conversations
  // 里哪一个 kind==='collab' 的会话（rail.ts 的协同会话树叶点击写入这个字段，见 shell.ts 的
  // onOpenCollabConversation）。其它 centerTab 下这个字段不参与渲染决策，不必清空。
  activeConversationId: string | undefined;
  // R15 批 B（人对人私聊）：rail「私聊」分组的数据源——GET /api/dm/list 回的 actor 参与的 DM 列表
  // （每条 = 会话 + 两名参与者，含对方昵称/is_self）。DM 容器项目对项目树/工作台 VM 全线围栏，DM 会话
  // 没有任何常规入口，这个列表是唯一入口。centerTab === "dm" 时中栏据 activeDmConversationId 从这里
  // 找到那条 DM 直接挂 chat 视图（不拉容器 VM）。rail 拉一次 + SSE/轮询刷；shell 的「发私聊」新建后
  // 也会把新会话并进这里（openDm 只回会话本体，昵称由发起端已知的 roster 补齐）。
  dmList: DmListItemVM[];
  dmListLoad: WorkbenchLoadState;
  // centerTab === "dm" 时，中栏具体打开的是 dmList 里哪一条 DM 会话（rail 私聊行点击/「发私聊」写入）。
  activeDmConversationId: string | undefined;
  // R15 批 B（在线两态）：rail 成员 roster + 私聊行 + 头像资料卡共用的在线 user id 集合——rail 30s 轮询
  // GET /api/presence（≤50 一批，分批）后写这里（只收 is_online===true，不编造离线）。存成数组便于
  // store patch 浅合并/序列化，读侧转成 Set。空数组 = 谁都不在线（或还没拉到）——渲染层据此不画绿点。
  onlineUserIds: string[];
  // R15 批 B：当前 viewer 的 user id——vm 就绪时取 viewer.user_id、DM 列表就绪时取 is_self 参与者兜底。
  // 头像资料卡据此判自己（不显示「发私聊」），roster 据此排除自己。没有任何数据源时 undefined。
  currentUserId: string | undefined;
  // R15 批 I1（决策收件箱）：rail 顶部「待拍板」入口的计数徽标数据源——GET /api/pages/attention 的 queue
  // 长度（与主窗 refreshApprovalsBadge 同源）。shell 首帧拉一次 + me-stream 收到决策类 notification.created
  // 时刷新 + 收件箱内动作落定后刷新 + 30s 兜底轮询。0 时 rail 不渲徽标。
  inboxCount: number;
  // 右栏情境面板收放（批 5 起有真内容，见 WorkbenchSidePanelContent 注释）。
  sidePanelOpen: boolean;
  sidePanelContent: WorkbenchSidePanelContent;
  // R16-W3：右栏「提议 / 文件」模式（顶部 chip，shell renderSideTabs 渲染）。"proposals"=军团/提议详情
  // （既有默认），"files"=变动文件 + 所有文件（workbench/files 面板）。只在会话情境（chat/collab/editor）
  // 下的 chip 有意义；切到 drive/timeline/设置等 tab 时随 clearContextPanels 复位成 "proposals"。
  sideContextMode: "proposals" | "files";
  // R16-W3：中栏编辑器当前打开的变动文件——右栏变动文件行点击写入（proposalId + manifest change 的
  // target_ref.path + 文件名），关闭时回到 returnTab（打开编辑器前的中栏视图）。
  editorTarget: { proposalId: string; path: string; filename: string; returnTab: WorkbenchCenterTab } | undefined;
  // 新建项目模态开关。
  newProjectModalOpen: boolean;
  // R13 批 S3：新建个人空间模态开关——与团队项目模态分开的独立状态（拍板：个人空间创建只填
  // 名字，不需要选工作区/邀请成员那一整套团队项目的步骤，复用同一个模态语义上会混淆两件事）。
  newPersonalSpaceModalOpen: boolean;
};

export type WorkbenchStoreListener = (state: WorkbenchStoreState) => void;

export type WorkbenchStore = {
  getState: () => WorkbenchStoreState;
  setState: (patch: Partial<WorkbenchStoreState>) => WorkbenchStoreState;
  subscribe: (listener: WorkbenchStoreListener) => () => void;
};

export function initialWorkbenchStoreState(): WorkbenchStoreState {
  return {
    projects: [],
    projectsLoad: "idle",
    personalProjects: [],
    personalProjectsLoad: "idle",
    selectedProjectId: undefined,
    pendingConversationId: undefined,
    vm: undefined,
    vmLoad: "idle",
    vmError: undefined,
    centerTab: "chat",
    activeConversationId: undefined,
    dmList: [],
    dmListLoad: "idle",
    activeDmConversationId: undefined,
    onlineUserIds: [],
    currentUserId: undefined,
    inboxCount: 0,
    sidePanelOpen: true,
    sidePanelContent: undefined,
    sideContextMode: "proposals",
    editorTarget: undefined,
    newProjectModalOpen: false,
    newPersonalSpaceModalOpen: false
  };
}

export function createWorkbenchStore(initial: Partial<WorkbenchStoreState> = {}): WorkbenchStore {
  let state: WorkbenchStoreState = { ...initialWorkbenchStoreState(), ...initial };
  const listeners = new Set<WorkbenchStoreListener>();
  // R12 批 6 踩出来的坑：监听器（shell.ts 的 renderCenter/renderSide/renderCrumb）自己可能在渲染过程中
  // 同步调用 store.setState（比如 driveSidePanel.showIdle() 在 renderCenter 里被调用）。JS 函数参数是
  // 按值绑定的——监听器正在执行的这次调用里，早先传入的 `state` 参数不会因为外层闭包变量被重新赋值就
  // 跟着变，所以同一次监听器调用里后续的 renderSide(state) 还是会用上一刻的旧快照，把刚写进去的新内容
  // 覆盖回去。修法：重入时不递归调用监听器（避免同一函数体内新旧快照打架），只把 state 合并好、标记
  // "notify 完了再补一轮"；等最外层这轮 notify 跑完，用完全合并后的最新 state 干净地再跑一遍全部监听器。
  let notifying = false;
  let pendingRenotify = false;

  function notifyListeners() {
    notifying = true;
    // 快照当前监听器集合：某个监听器在通知过程中订阅/退订，不应影响本轮派发。
    for (const listener of [...listeners]) {
      listener(state);
    }
    notifying = false;
    if (pendingRenotify) {
      pendingRenotify = false;
      notifyListeners();
    }
  }

  return {
    getState() {
      return state;
    },
    setState(patch) {
      state = { ...state, ...patch };
      if (notifying) {
        pendingRenotify = true;
        return state;
      }
      notifyListeners();
      return state;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }
  };
}
