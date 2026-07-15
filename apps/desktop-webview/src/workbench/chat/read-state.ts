// WorkHub 桌面 · R14 批 CHAT：已读游标的纯逻辑层——游标 Map 维护（单调推进）、未读分割线定位、
// 聚合式「已读 N/M」计算。无副作用、无 DOM、可单测。服务端 GET /receipts 初始化、SSE
// conversation.read.updated 增量，都落到这里的 applyReadReceipt。
//
// 设计取舍（01-chat-design.md §5，PM 对已读回执有异议但用户拍板做聚合式 N/M）：只在「自己发的最后一
// 条消息」下显示 N/M（不做逐人列表，不制造监视压力）；未读分割线与 N/M 共用同一套服务端游标。

import type { ConversationMessageVM, ConversationReadReceiptVM } from "@workhub/contracts";

export type ReadCursorMap = ReadonlyMap<string, number>;

// 从 GET /receipts 的原始游标列表构建初始 Map（同一 user 多条时取最大，防御性——服务端 unique 约束
// 本就保证一人一条）。
export function receiptsToCursorMap(receipts: readonly ConversationReadReceiptVM[]): ReadCursorMap {
  const map = new Map<string, number>();
  for (const receipt of receipts) {
    const existing = map.get(receipt.user_id) ?? -1;
    if (receipt.last_read_seq > existing) {
      map.set(receipt.user_id, receipt.last_read_seq);
    }
  }
  return map;
}

// 单调推进：收到更小/相等的值不回退（返回原 Map 引用，调用方据此可跳过重渲）；更大才写入新 Map。
export function applyReadReceipt(map: ReadCursorMap, userId: string, lastReadSeq: number): ReadCursorMap {
  const existing = map.get(userId);
  if (existing !== undefined && existing >= lastReadSeq) {
    return map;
  }
  const next = new Map(map);
  next.set(userId, lastReadSeq);
  return next;
}

// 本地消息里的最高 seq——PUT /read 的 last_read_seq 用它（服务端还会夹到会话当前最大 seq）。空则 0。
export function highestMessageSeq(messages: readonly ConversationMessageVM[]): number {
  let max = 0;
  for (const message of messages) {
    if (message.seq > max) {
      max = message.seq;
    }
  }
  return max;
}

// 未读分割线：本人游标（entryReadSeq，进会话那一刻的自己的游标——view.ts 固定住它，读的过程中不移动，
// 免得分割线边读边往下跑）之后、第一条「他人」消息的 id——分割线渲在这条消息上方。「他人」= 非当前
// 用户本人发的消息（含 Cuu / 系统事件；一条自己刚发的消息不该把自己挡在「新消息」线下面）。messages
// 必须已按 seq 升序（同 groupMessagesByDay 前置条件）。没有这样的消息（都读过了/后续都是自己发的）
// 返回 undefined。
export function unreadDividerBeforeMessageId(
  messages: readonly ConversationMessageVM[],
  entryReadSeq: number,
  currentUserId: string | undefined
): string | undefined {
  for (const message of messages) {
    if (message.seq <= entryReadSeq) {
      continue;
    }
    const isOwn = currentUserId !== undefined && message.sender_user_id === currentUserId;
    if (!isOwn) {
      return message.id;
    }
  }
  return undefined;
}

// —— R14FIX 批 workbench BUG-05（读游标失败永久丢失，验收报告）：把 PUT /read 的「已尝试(attempted)」
// 与「已确认(acked)」拆开的纯状态机。 ——
// 病根：旧实现在请求发出前就把游标推进到目标 seq（lastSentReadSeq=seq），一旦网络失败，同一个 seq 及
// 之后所有 <= 它的 seq 都被 `seq <= lastSentReadSeq` 永久挡住，读游标永久丢失（他人永远看不到我读到这里）。
// 修法：只有服务端确认才推进 acked；in-flight 用 inFlightSeq 记，失败即清 in-flight（不推 acked），
// 下次触发（重获焦点/恢复网络/新消息）自然重试。无副作用、无 DOM，可单测。
export type ReadCursorSendState = {
  // 服务端已确认的最高游标（单调，永不回退）——重试门槛的下界：只有 highest > ackedSeq 才需要再发。
  ackedSeq: number;
  // 正在发送中的那个 seq（undefined = 当前没有在途请求）。同一时刻只允许一个在途请求，避免并发竞态；
  // 在途请求落定后调用方再自查一次是否有更新的消息要接着报（见 view.ts doMarkRead 的 then 分支）。
  inFlightSeq: number | undefined;
};

export const IDLE_READ_CURSOR_SEND_STATE: ReadCursorSendState = { ackedSeq: 0, inFlightSeq: undefined };

// 进会话（GET /receipts）拿到本人游标后，acked 直接以服务端为基准（服务端已经知道我读到这里了）。
export function readCursorSendStateFromAcked(ackedSeq: number): ReadCursorSendState {
  return { ackedSeq, inFlightSeq: undefined };
}

// 是否应该现在发起一次 PUT /read：本地最高 seq 超过已确认游标，且当前没有在途请求。
export function shouldSendReadCursor(state: ReadCursorSendState, highestSeq: number): boolean {
  return state.inFlightSeq === undefined && highestSeq > state.ackedSeq;
}

// 标记「已发出」——把 inFlightSeq 置为目标 seq（不动 acked：acked 只在服务端确认后才推进）。
export function markReadCursorSent(state: ReadCursorSendState, seq: number): ReadCursorSendState {
  return { ackedSeq: state.ackedSeq, inFlightSeq: seq };
}

// 服务端确认——acked 单调推进到 max(acked, confirmedSeq)（服务端会把游标夹到会话最大 seq，可能比我报的
// 小，以它回的值为准），清空在途。
export function markReadCursorAcked(state: ReadCursorSendState, confirmedSeq: number): ReadCursorSendState {
  return { ackedSeq: Math.max(state.ackedSeq, confirmedSeq), inFlightSeq: undefined };
}

// 请求失败——只清在途，绝不推进 acked（BUG-05 的关键：让同一个 seq 能被重试，不再永久丢失）。
export function markReadCursorFailed(state: ReadCursorSendState): ReadCursorSendState {
  return { ackedSeq: state.ackedSeq, inFlightSeq: undefined };
}

export type ReadReceiptSummary = {
  messageId: string;
  readCount: number;
  total: number;
};

// 聚合式「已读 N/M」——只算「自己发的最后一条（未删除的文本/文件）消息」：
//  - N = 其他成员（otherMemberIds，成员条里除自己以外的人）里，游标 ≥ 这条消息 seq 的人数；
//  - M = otherMemberIds.length（= 成员条人数 - 1）。
// M < 1（单人项目/只有自己）→ 返回 undefined，渲染层据此不渲染。找不到自己发的消息也返回 undefined。
// 墓碑（deleted_at 置位）不算——一条已删除的消息下面挂「已读 N/M」没有意义。
export function readReceiptSummary(
  messages: readonly ConversationMessageVM[],
  cursors: ReadCursorMap,
  currentUserId: string | undefined,
  otherMemberIds: readonly string[]
): ReadReceiptSummary | undefined {
  if (!currentUserId || otherMemberIds.length < 1) {
    return undefined;
  }
  let target: ConversationMessageVM | undefined;
  for (const message of messages) {
    if (message.sender_user_id !== currentUserId) {
      continue;
    }
    if (message.deleted_at !== undefined) {
      continue;
    }
    if (target === undefined || message.seq > target.seq) {
      target = message;
    }
  }
  if (!target) {
    return undefined;
  }
  const seq = target.seq;
  let readCount = 0;
  for (const memberId of otherMemberIds) {
    if ((cursors.get(memberId) ?? 0) >= seq) {
      readCount += 1;
    }
  }
  return { messageId: target.id, readCount, total: otherMemberIds.length };
}
