// WorkHub 桌面 · 工作台状态容器。
// 批 1 只需要「当前选中项目 + 项目树数据 + 右栏收放」这点状态；批 2 起的会话消息流/军团 run 切片会往这个
// store 上加字段，但不在这里预先设计——先留一个足够薄的订阅容器，避免过度设计（02 §3 明确要求）。

import type { ProjectListItemVM, WorkbenchPageVM } from "@workhub/contracts";

export type WorkbenchLoadState = "idle" | "loading" | "ready" | "error";

export type WorkbenchStoreState = {
  // 左栏项目树数据源。
  projects: ProjectListItemVM[];
  projectsLoad: WorkbenchLoadState;
  // 当前选中的项目（rail 点击 / Spotlight「打开工作台」/ 深链三路共用同一份状态）。
  selectedProjectId: string | undefined;
  // 深链带来的会话目标：批 1 还没有会话视图，先存着，批 2 群聊/协同视图接入时直接消费。
  pendingConversationId: string | undefined;
  // 选中项目的 bootstrap VM（GET /api/pages/workbench/:projectId）。
  vm: WorkbenchPageVM | undefined;
  vmLoad: WorkbenchLoadState;
  vmError: string | undefined;
  // 右栏情境面板收放（批 5 才有真内容，批 1 先给个空壳 + 收放状态）。
  sidePanelOpen: boolean;
  // 新建项目模态开关。
  newProjectModalOpen: boolean;
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
    selectedProjectId: undefined,
    pendingConversationId: undefined,
    vm: undefined,
    vmLoad: "idle",
    vmError: undefined,
    sidePanelOpen: true,
    newProjectModalOpen: false
  };
}

export function createWorkbenchStore(initial: Partial<WorkbenchStoreState> = {}): WorkbenchStore {
  let state: WorkbenchStoreState = { ...initialWorkbenchStoreState(), ...initial };
  const listeners = new Set<WorkbenchStoreListener>();

  return {
    getState() {
      return state;
    },
    setState(patch) {
      state = { ...state, ...patch };
      // 快照当前监听器集合：某个监听器在通知过程中订阅/退订，不应影响本轮派发。
      for (const listener of [...listeners]) {
        listener(state);
      }
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
