// WorkHub 桌面 · R15 批 B（人对人私聊）：DM 的数据访问薄层 + 纯逻辑 helper。
//
// 端点契约（apps/api/src/routes/dm.ts）：
//  - GET  /api/dm/list —— actor 参与的 DM 列表（参与者门控，每条 = 会话 + 两名参与者含对方昵称）。
//  - POST /api/dm/open —— 查/开一对用户的 DM（幂等，点头像开聊不越点越多），回 { conversation }。
// 同 chat/api.ts 顶部注释的既有取舍：不为工作台窗口的批次特性扩大 WorkHubApiClient 的具名方法面，
// 全走 client.request<T>（{ok,data} 信封由 client 解出 data；失败抛 WorkHubApiError）。

import type { DmListItemVM, DmListVM, OpenDmResultVM, WorkbenchPageVM } from "@workhub/contracts";

import { fetchPresence } from "./chat/api.js";
import { onlineUserIdsFromPresence } from "./chat/presence-state.js";

type WorkbenchMemberVM = WorkbenchPageVM["workspace_members"]["items"][number];

export type DmApiClient = {
  request: <T>(path: string, init?: RequestInit) => Promise<T>;
};

export function fetchDmList(client: DmApiClient): Promise<DmListVM> {
  return client.request<DmListVM>("/api/dm/list");
}

export function openDirectMessage(client: DmApiClient, targetUserId: string): Promise<OpenDmResultVM> {
  return client.request<OpenDmResultVM>("/api/dm/open", {
    method: "POST",
    body: JSON.stringify({ user_id: targetUserId })
  });
}

// —— 纯逻辑（无副作用、可单测） —— //

// GET /api/presence 一批至多 50 个 user id（见 chat/api.ts 的 fetchPresence 硬切）——roster 可达 100 人、
// 再叠上 DM 对方，联合集合会超 50，必须分批查再并集。去重 + 分块（每块 ≤50），逐块拉，只收 is_online===true。
// 任一块失败不拖垮整体：静默跳过该块（best-effort，同 view.ts 的 presence 取舍），返回已拿到的在线并集。
export function chunkPresenceIds(userIds: readonly string[], size = 50): string[][] {
  const unique = [...new Set(userIds)].filter((id) => id.length > 0);
  const chunks: string[][] = [];
  for (let i = 0; i < unique.length; i += size) {
    chunks.push(unique.slice(i, i + size));
  }
  return chunks;
}

export async function fetchOnlineUserIds(
  client: DmApiClient,
  userIds: readonly string[]
): Promise<Set<string>> {
  const online = new Set<string>();
  const chunks = chunkPresenceIds(userIds);
  for (const chunk of chunks) {
    try {
      const result = await fetchPresence(client, chunk);
      for (const id of onlineUserIdsFromPresence(result.presence)) {
        online.add(id);
      }
    } catch {
      // best-effort：这一块拉不到就跳过，不清掉已拿到的在线并集、也不重试轰炸。
    }
  }
  return online;
}

// DM 列表 upsert：按 conversation.id 去重——命中既有就原地替换（不重复），未命中就插到最前（最近开的
// 排前，与服务端 updatedAt 倒序口径一致）。「发私聊」新建/开既有 DM 后把它并进 store.dmList 用。
export function upsertDmListItem(list: readonly DmListItemVM[], item: DmListItemVM): DmListItemVM[] {
  const index = list.findIndex((existing) => existing.conversation.id === item.conversation.id);
  if (index === -1) {
    return [item, ...list];
  }
  const next = list.slice();
  next[index] = item;
  return next;
}

// 一条 DM 里「对方」参与者（非 self）——rail 私聊行渲染对方昵称/头像、DM 会话头显示对方都用它。
export function dmPeerParticipant(item: DmListItemVM, currentUserId: string | undefined) {
  const peer = item.participants.find((participant) =>
    currentUserId ? participant.user_id !== currentUserId : !participant.is_self
  );
  return peer ?? item.participants.find((participant) => !participant.is_self);
}

// DM 会话的 chat 视图成员集合 = 两名真实参与者（membership_role/is_project_owner 只为满足 WorkbenchMemberVM
// 形状，chat 视图只读 user_id/nickname/is_self）。这是「已读 N/M 分母修复」的关键：chat 视图的 otherMemberIds
// = members 去掉自己，DM 传两名参与者 → 分母恒为 1（1/1），而不是拿全工作区成员当分母（旧病灶）。
export function dmMembersFromParticipants(item: DmListItemVM): WorkbenchMemberVM[] {
  return item.participants.map((participant) => ({
    user_id: participant.user_id,
    nickname: participant.nickname,
    membership_role: "member" as const,
    is_project_owner: false,
    is_self: participant.is_self
  }));
}
