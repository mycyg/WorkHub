// WorkHub 桌面 · R14 批 CHAT（桌宠彩蛋，stretch）：把「有人给 Cuu 的一条消息新加了一个反应」翻译成
// 桌宠该露的情绪。纯函数、无副作用、可单测——真正的跨窗口 emit / 桌宠状态驱动在 view.ts + interrupt-
// broadcast.ts + desktop-cuu-runtime.ts 接线，全程失败静默。
//
// 为什么 delta 在这里算而不在 interrupt-broadcast.ts：conversation.reaction.updated 是「全量聚合幂等
// 替换」（不发增量，见契约），单看一条事件根本不知道「刚加的是哪个键」；只有持有上一份 reactions 快照
// 的 view.ts 能 diff 出新增键。所以彩蛋的「反查+diff」放在 view.ts（数据在那），emit 复用既有 Tauri 桥。

import { REACTION_KEYS } from "./reactions.js";
import type { ConversationMessageReactionVM, ConversationReactionKey } from "@workhub/contracts";

// 桌宠情绪三态——对齐 desktop-cuu-runtime.ts / packages/cuu 的 CuuState 词表子集（celebrating/worried/
// thinking 都是既有状态，motion.ts 有现成映射，接收端复用，不新造动作）。
export type CuuReactionEmotion = "celebrating" | "worried" | "thinking";

// 五键 → 情绪（01-chat-design.md §5 拍板）：赞同/完成=庆祝、疑问/反对=担心、关注=思考。
const REACTION_EMOTION: Record<ConversationReactionKey, CuuReactionEmotion> = {
  approve: "celebrating",
  done: "celebrating",
  question: "worried",
  disagree: "worried",
  watch: "thinking"
};

// 相对上一份聚合，这次新增了我方视角下「多出来的」反应键——某个键的 user_ids 变多，或整条键是新出现的，
// 都算「有人刚加了这个键」。按 REACTION_KEYS 稳定顺序返回，调用方取第一个映射情绪即可。
export function newlyAddedReactionKeys(
  previous: readonly ConversationMessageReactionVM[] | undefined,
  next: readonly ConversationMessageReactionVM[]
): ConversationReactionKey[] {
  const prevCount = new Map<ConversationReactionKey, number>();
  for (const reaction of previous ?? []) {
    prevCount.set(reaction.key, reaction.user_ids.length);
  }
  const added: ConversationReactionKey[] = [];
  for (const key of REACTION_KEYS) {
    const nextEntry = next.find((reaction) => reaction.key === key);
    const nextN = nextEntry ? nextEntry.user_ids.length : 0;
    const prevN = prevCount.get(key) ?? 0;
    if (nextN > prevN) {
      added.push(key);
    }
  }
  return added;
}

// 只对 Cuu 发的消息生效（sender_type === 'cuu'），且这次真的新增了反应——取新增里第一个键的情绪。
// 不是 Cuu 消息 / 没有新增 / 只有取消反应 → undefined（调用方据此什么都不做）。
export function pickCuuReactionEmotion(input: {
  senderType: "user" | "cuu" | "system";
  previous: readonly ConversationMessageReactionVM[] | undefined;
  next: readonly ConversationMessageReactionVM[];
}): CuuReactionEmotion | undefined {
  if (input.senderType !== "cuu") {
    return undefined;
  }
  const added = newlyAddedReactionKeys(input.previous, input.next);
  const firstKey = added[0];
  return firstKey ? REACTION_EMOTION[firstKey] : undefined;
}
