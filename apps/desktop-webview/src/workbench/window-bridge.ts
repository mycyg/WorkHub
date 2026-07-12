// WorkHub 桌面 · 工作台窗口控制桥。
//
// 工作台窗口是 frameless + transparent（tauri.conf.json 的 workbench 窗口 decorations:false），没有原生
// 标题栏，所以顶部拖拽区、最小化、关闭都要自绘并接到 Tauri 的窗口 API。这个窗口没有像主窗/桌宠那样的
// 专属 Rust command（`hide_main_window`/`show_pet_window` 等），批 1 的 Rust 范围（02 §3）也只写了
// `open_workbench` + 深链路由，没有新增 workbench 专属窗口控制 command——所以这里直接走 Tauri v2 内置的
// `@tauri-apps/api/window` Window 对象方法（getCurrentWindow().hide()/.minimize()/.startDragging()），
// 和 pet-window-bridge.ts 解析 currentWindow 的方式一致，不发明新协议。
//
// 已知缺口（写进 batch-1-frontend.md 报告，不在本批修——client-tauri 范围外）：
// client-tauri/src-tauri/capabilities/default.json 的 "windows" 目前只有 ["main","pet"]，不含
// "workbench"。Tauri v2 的 core 插件命令（window/event 等）按 capability 的 windows 字段逐窗口发权限；
// "workbench" 不在名单里意味着这个窗口当前拿不到任何 core 权限，min/hide/startDragging 与下面 boot.ts
// 订阅的 "deep-link" 事件在真机大概率会被 ACL 拒绝。这里仍然接上真实的 Tauri API（不是假按钮），
// 一旦人工把 "workbench" 加进 capabilities 就能直接工作；真机验收前请先确认这一步。

export type WorkbenchWindowBridge = {
  startDragging?: () => void | Promise<void>;
  minimize?: () => void | Promise<void>;
  hide?: () => void | Promise<void>;
  // R12 批7:打扰矩阵用它判断"用户是否正看着这个工作台窗口"(见 workbench/interrupt-broadcast.ts)。
  // Tauri v2 内置 Window.isFocused() 的直接透传,不是新协议。
  isFocused?: () => Promise<boolean>;
};

type TauriWindowHandle = {
  label?: string;
  startDragging?: () => void | Promise<void>;
  minimize?: () => void | Promise<void>;
  hide?: () => void | Promise<void>;
  isFocused?: () => Promise<boolean>;
};

type TauriGlobal = {
  __TAURI__?: {
    window?: {
      getCurrentWindow?: () => TauriWindowHandle;
      appWindow?: TauriWindowHandle;
    };
    webviewWindow?: {
      getCurrentWebviewWindow?: () => TauriWindowHandle;
    };
  };
};

export function resolveWorkbenchWindowBridge(input: unknown = globalThis): WorkbenchWindowBridge | undefined {
  const target = input as TauriGlobal;
  const currentWindow =
    target.__TAURI__?.window?.getCurrentWindow?.() ??
    target.__TAURI__?.webviewWindow?.getCurrentWebviewWindow?.() ??
    target.__TAURI__?.window?.appWindow;
  if (!currentWindow) {
    return undefined;
  }

  const bridge: WorkbenchWindowBridge = {};
  if (typeof currentWindow.startDragging === "function") {
    bridge.startDragging = () => currentWindow.startDragging?.();
  }
  if (typeof currentWindow.minimize === "function") {
    bridge.minimize = () => currentWindow.minimize?.();
  }
  if (typeof currentWindow.hide === "function") {
    bridge.hide = () => currentWindow.hide?.();
  }
  if (typeof currentWindow.isFocused === "function") {
    bridge.isFocused = () => currentWindow.isFocused!();
  }
  return Object.keys(bridge).length > 0 ? bridge : undefined;
}
