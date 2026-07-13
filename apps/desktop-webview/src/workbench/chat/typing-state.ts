// WorkHub 桌面 · 「正在输入」瞬态状态——纯函数。契约（packages/contracts/src/events.ts 的
// conversationPresenceTypingEventSchema）固定 ttl_ms=3000：这里只存 userId + 过期时间戳，不存 label——
// 展示时由调用方（render.ts/view.ts）拿 userId 去 workspace_members 里查真实昵称，不信任 SSE 事件里
// 可选的 actor.label（成员列表已经是真数据源，没必要维护第二份）。

export type TypingUser = {
  userId: string;
  expiresAtMs: number;
};

export type TypingState = readonly TypingUser[];

export const EMPTY_TYPING_STATE: TypingState = [];

// 收到一次 typing 事件：清掉过期项、把该用户的过期时间刷新到最新（同一用户重复打字，去重成一条）。
export function upsertTypingUser(
  state: TypingState,
  event: { userId: string; expiresAtMs: number },
  nowMs: number
): TypingState {
  const pruned = pruneExpiredTypingUsers(state, nowMs);
  return [...pruned.filter((user) => user.userId !== event.userId), event];
}

export function pruneExpiredTypingUsers(state: TypingState, nowMs: number): TypingState {
  const next = state.filter((user) => user.expiresAtMs > nowMs);
  // 没有任何项被剪掉时返回原数组引用，方便调用方用 === 判断"值没变"、跳过一次没必要的重渲染。
  return next.length === state.length ? state : next;
}
