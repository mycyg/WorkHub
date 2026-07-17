// WorkHub 桌面 · R20 DSK-UX（R19-11 presence 单源）。
//
// 病灶：聊天区（chat/view.ts）此前维护自己的私有 onlineUserIds（自带 30s 轮询 + SSE 重连即时刷），而 rail
// 名册/私聊行/头像资料卡读的是另一套 store.onlineUserIds（rail 自己的 30s 轮询写入）。两个消费者各打各的
// GET /api/presence、相位不同，且聊天区那份从不回写 store——于是同一个人、同一时刻，界面上能出现两颗自相
// 矛盾的在线圆点（最长差 30s）。
//
// 收敛：store.onlineUserIds 是唯一真源。这个 handle 是它薄薄的读/写/订阅门面——聊天区与 rail 都通过它
// applyPresence（per-user 合并，见 applyPresenceToOnlineIds）写同一个集合、都从它 getOnline 读、都能 subscribe
// 到集合变化重渲。谁刷到更鲜活的在线态都立即惠及另一处（如聊天区 SSE 重连补刷会顺带更新 rail 的资料卡圆点）。

import type { PresenceEntryVm } from "@workhub/contracts";

import { applyPresenceToOnlineIds } from "./chat/presence-state.js";
import type { WorkbenchStore } from "./store.js";

export type PresenceHandle = {
  // 当前在线的 user id 集合（读侧一律走这里，不再各留私有副本）。
  getOnline: () => ReadonlySet<string>;
  // 把一批 GET /api/presence 响应合并进单源集合（per-user 权威，见 applyPresenceToOnlineIds）。
  applyPresence: (entries: readonly PresenceEntryVm[]) => void;
  // 订阅在线集合的变化（仅在 onlineUserIds 引用真变时回调，不被 store 其它字段变化打扰）。返回退订函数。
  subscribe: (listener: () => void) => () => void;
};

export function createPresenceHandle(store: WorkbenchStore): PresenceHandle {
  return {
    getOnline() {
      return new Set(store.getState().onlineUserIds);
    },
    applyPresence(entries) {
      const current = store.getState().onlineUserIds;
      const next = applyPresenceToOnlineIds(current, entries);
      // applyPresenceToOnlineIds 无变化时原样返回入参引用——据此跳过多余 setState（避免无谓通知/重渲）。
      if (next !== current) {
        store.setState({ onlineUserIds: next });
      }
    },
    subscribe(listener) {
      let prev = store.getState().onlineUserIds;
      return store.subscribe((state) => {
        if (state.onlineUserIds !== prev) {
          prev = state.onlineUserIds;
          listener();
        }
      });
    }
  };
}
