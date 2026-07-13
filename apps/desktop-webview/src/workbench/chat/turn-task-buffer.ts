// WorkHub 桌面 · R13 批 S2（Cuu 异步化与进度可视）：turn 期间的任务事件缓冲——纯函数。
//
// 病根：协同会话里 Cuu 正在流式吐字回复时（turnActive===true），如果这时候收到一条
// conversation.action_card.updated（比如后台某个 run 刚好在这一刻推进了一步/落定），view.ts 原来的
// 处理是立刻 applyActionCardUpdate + renderScroll——整个消息滚动区 innerHTML 重建一次，会打断正在阅读的
// 流式气泡（视觉上像一次没来由的"抖动"）。00 §「异步心智模型」的诉求是"对话流"和"任务流"两条线互不
// 打扰：任务照常推进，但它的画面更新要等这一轮对话说完再露面，不是完全不通知。
//
// 这里只处理 conversation.action_card.updated 这一种"任务类事件"——typing/message.delta 不缓冲，
// 它们本来就是买"实时"这个属性的瞬态展示（打字指示器、正在流式的文字本身），缓冲反而是错误行为，
// 也是 00 文档"对话本身的实时性不受影响"这条边界。
//
// 队列本身只是"按到达顺序攒起来"，不做合并/去重去重——timeline.ts 的 applyActionCardUpdate 是幂等的
// 按条目 id patch，按接收顺序重放能收敛到和"完全不缓冲、事件一来就应用"完全相同的最终状态，只是画面
// 更新的时间点推迟了。

import type { ConversationMessageVM } from "@workhub/contracts";

import type { IncomingActionCardUpdate } from "./events.js";
import { applyActionCardUpdate } from "./timeline.js";

export type BufferedActionCardUpdateQueue = readonly IncomingActionCardUpdate[];

export const EMPTY_BUFFERED_ACTION_CARD_UPDATE_QUEUE: BufferedActionCardUpdateQueue = [];

// 入队——单纯 append，保序。
export function enqueueBufferedActionCardUpdate(
  queue: BufferedActionCardUpdateQueue,
  update: IncomingActionCardUpdate
): BufferedActionCardUpdateQueue {
  return [...queue, update];
}

export type ApplyBufferedActionCardUpdatesResult = {
  messages: ConversationMessageVM[];
  // 队列里至少有一条更新真的改变了某条消息的条目状态——调用方据此决定要不要 renderScroll（避免
  // 队列非空但恰好全是"落地时已经过期/无变化"的更新时白渲染一次）。
  changed: boolean;
  // 需要按需补拉的消息 id（applyActionCardUpdate 的 snapshotStale：本地没有这条消息，或者事件里
  // 出现了本地快照没有的条目——见 timeline.ts 顶部注释）。去重后的列表，调用方对每个 id 各发一次
  // 补拉请求，不是对队列里每条更新都发一次。
  staleMessageIds: string[];
};

// turn 落定（成功/失败都算）后一次性重放整个缓冲队列——按入队顺序逐条 applyActionCardUpdate，语义上
// 等价于"这些事件从一开始就没有被缓冲、来一条应用一条"，只是画面更新被推迟到现在统一发生一次。
export function applyBufferedActionCardUpdates(
  messages: readonly ConversationMessageVM[],
  queue: BufferedActionCardUpdateQueue
): ApplyBufferedActionCardUpdatesResult {
  let current: ConversationMessageVM[] = [...messages];
  let changed = false;
  const staleIds = new Set<string>();
  for (const update of queue) {
    const result = applyActionCardUpdate(current, update);
    if (result.changed) {
      current = result.messages;
      changed = true;
    }
    if (result.snapshotStale) {
      staleIds.add(update.messageId);
    }
  }
  return { messages: current, changed, staleMessageIds: [...staleIds] };
}
