// WorkHub 桌面 · 工作台状态容器。
// 批 1 只需要「当前选中项目 + 项目树数据 + 右栏收放」这点状态；批 2 起的会话消息流/军团 run 切片会往这个
// store 上加字段，但不在这里预先设计——先留一个足够薄的订阅容器，避免过度设计（02 §3 明确要求）。

import type { ProjectListItemVM, WorkbenchPageVM } from "@workhub/contracts";

export type WorkbenchLoadState = "idle" | "loading" | "ready" | "error";

// 中栏当前显示哪个能力视图。批 2 只有 "chat"；批 6 加 "drive"（rail 的「网盘」树叶接真视图）；
// final-turns-wiring 加 "collab"——rail.ts 新增的协同会话树叶点开后，中栏切到某个具体的协同会话
// （哪一个由下面的 activeConversationId 指出），复用同一个 chat/view.ts 组件（mountChatView 的
// conversationKind 参数区分主区/单聊）。R13 批 P1 加 "army-overview"——rail.ts 新的一级入口「军团总览」
// 点开后中栏切到跨项目军团卡片流（army/overview.ts），这个视图不依赖 selectedProjectId。
// R13 批 P3 加 "project-settings"——rail 项目行的设置按钮（仅项目负责人渲染，见 rail.ts）点开后，
// 中栏切到该项目的 AI 治理表单（settings/view.ts），依赖 selectedProjectId + vm。
export type WorkbenchCenterTab = "chat" | "drive" | "collab" | "army-overview" | "project-settings";

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
  // 右栏情境面板收放（批 5 起有真内容，见 WorkbenchSidePanelContent 注释）。
  sidePanelOpen: boolean;
  sidePanelContent: WorkbenchSidePanelContent;
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
    sidePanelOpen: true,
    sidePanelContent: undefined,
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
