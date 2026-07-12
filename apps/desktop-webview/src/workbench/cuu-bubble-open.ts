// WorkHub 桌面 · R12 批7:Cuu 气泡「点击 → 深链进工作台」的真实 invoke 通路。只被 pet-surface.ts 的
// 点击处理器使用(pet-surface.ts 从不被 apps/api 引用)——href 构造/解析等纯函数留在同目录的
// cuu-bubble-deeplink.ts，那个文件会被 desktop-cuu-runtime.ts 引用、并经既有的跨包 QA import
// (apps/api/src/qa/cuu-r3-launcher-harness.ts)被 apps/api 的 tsconfig(无 DOM lib)重新 typecheck，
// 不能带上本文件用到的 `window.localStorage`（见 cuu-bubble-deeplink.ts 顶部注释的拆分理由）。
//
// 深链复用批1已经落地的真实通路(spotlight/views/workbench-open.ts 同款):
//   1. invoke("open_workbench", { projectId, conversationId? })——client-tauri/src-tauri/src/main.rs
//      已注册的真实 command,会走统一的深链管线(段校验/窗口分流/deep-link 事件),不是伪造的第二条协议。
//   2. invoke 之前先 stashPendingWorkbenchDeepLink(...)——冷启动竞态兜底(见 workbench/pending-deep-link.ts
//      顶部注释),同一个已验证过的机制,不另起炉灶。
// invoke 不可用时(浏览器 dev 预览 / capabilities 尚未把气泡所在窗口加进 windows 列表)诚实降级返回
// false,调用方据此显示「打不开」文案，不假装已经跳转。

import { resolveDesktopTauriInvoke, type DesktopWindowControlsScope } from "../desktop-window-controls.js";
import { stashPendingWorkbenchDeepLink, type PendingWorkbenchDeepLinkTarget } from "./pending-deep-link.js";
import type { WorkbenchDeepLinkRouteTarget } from "./cuu-bubble-deeplink.js";

export type OpenWorkbenchRouteInvoke = (command: string, args?: Record<string, unknown>) => Promise<unknown> | unknown;

// 气泡点击 → 深链定位会话/行动卡。真实 invoke 不可用时返回 false（不抛错——调用方决定怎么告知用户）。
export async function openWorkbenchRouteFromPet(
  target: WorkbenchDeepLinkRouteTarget,
  options: {
    invoke?: OpenWorkbenchRouteInvoke;
    scope?: DesktopWindowControlsScope;
    stash?: (target: PendingWorkbenchDeepLinkTarget) => void;
  } = {}
): Promise<boolean> {
  const invoke = options.invoke ?? resolveDesktopTauriInvoke(options.scope);
  if (typeof invoke !== "function") {
    return false;
  }
  const stash = options.stash ?? stashPendingWorkbenchDeepLink;
  stash({
    projectId: target.projectId,
    ...(target.conversationId ? { conversationId: target.conversationId } : {})
  });
  await Promise.resolve(
    invoke("open_workbench", {
      projectId: target.projectId,
      ...(target.conversationId ? { conversationId: target.conversationId } : {})
    })
  );
  return true;
}
