// WorkHub 桌面 · R14 批 CHAT：presence（在线两态）的纯逻辑层——把 GET /api/presence 的响应归约成
// 「谁在线」的 id 集合。无副作用、无 DOM、可单测。
//
// 设计红线（01-chat-design.md §5）：只有真数据（is_online === true）才进这个集合；离线 / 从没见过在线
// 信号（服务端过滤掉不返回，或 is_online false）都不进——渲染层据此只给在线成员画视觉圆点，离线不画
// （不写「在线」文字，绕开 render.test.ts:80「不许编造在线态」断言，符合其「没真数据就不渲染」本意）。

import type { PresenceEntryVm } from "@workhub/contracts";

export type OnlineUserIds = ReadonlySet<string>;

export const EMPTY_ONLINE_USER_IDS: OnlineUserIds = new Set<string>();

// 只收 is_online === true 的 user_id。不在响应里的 id（同工作区之外/服务端过滤掉的）天然不在集合里，
// 等价于「不在线」——不编造占位。
export function onlineUserIdsFromPresence(entries: readonly PresenceEntryVm[]): OnlineUserIds {
  const online = new Set<string>();
  for (const entry of entries) {
    if (entry.is_online) {
      online.add(entry.user_id);
    }
  }
  return online;
}
