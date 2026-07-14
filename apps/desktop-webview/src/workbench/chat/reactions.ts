// WorkHub 桌面 · R14 批 CHAT：精选五键 emoji 反应的纯逻辑层——乐观切换（点一下加/再点一下减）与
// 「我点没点过这个键」的判定。全部无副作用、无 DOM、可单测。
//
// 关键纪律（01-chat-design.md §6）：这个文件只处理 ASCII slug（approve/disagree/done/question/watch），
// 绝不出现 emoji 字形——emoji 只允许出现在 render.ts 的 REACTION_EMOJI 映射常量与它拼出的 HTML 里。
// 服务端/契约层同样只认 slug，这里跟它们对齐。

import { conversationReactionKeySchema, type ConversationMessageReactionVM, type ConversationReactionKey } from "@workhub/contracts";

// 展示顺序 = 契约枚举顺序（approve/disagree/done/question/watch），reaction 行与 hover 工具条的五键
// 快捷加都照这个顺序，两处不各写一份免得漂移。
export const REACTION_KEYS: readonly ConversationReactionKey[] = conversationReactionKeySchema.options;

// 我在这条消息上点没点过某个键——渲染层据此把该 chip 高亮、切换时决定是加还是减。
export function hasOwnReaction(
  reactions: readonly ConversationMessageReactionVM[] | undefined,
  key: ConversationReactionKey,
  currentUserId: string | undefined
): boolean {
  if (!reactions || !currentUserId) {
    return false;
  }
  const entry = reactions.find((reaction) => reaction.key === key);
  return entry ? entry.user_ids.includes(currentUserId) : false;
}

export type OptimisticReactionToggle = {
  reactions: ConversationMessageReactionVM[];
  // 这次切换是「加」还是「减」——view.ts 据此决定发 PUT 还是 DELETE，失败时回滚回原数组。
  action: "add" | "remove";
};

// 乐观切换：把 currentUserId 对 key 的反应加上/去掉，返回新的聚合数组（不改传入的）。语义与服务端
// 幂等 PUT/DELETE 对齐——已经点过就减、没点过就加。空 user_ids 的键整条移除（渲染层不渲空键）。
// currentUserId 缺失（理论上不该发生，桌面端恒有登录用户）时按「加」处理但其实无从记名——直接原样返回，
// 让调用方的 add 请求由服务端按当前 actor 记名，前端不假装知道是谁。
export function toggleOwnReaction(
  reactions: readonly ConversationMessageReactionVM[] | undefined,
  key: ConversationReactionKey,
  currentUserId: string | undefined
): OptimisticReactionToggle {
  const current = (reactions ?? []).map((reaction) => ({ key: reaction.key, user_ids: [...reaction.user_ids] }));
  if (!currentUserId) {
    return { reactions: current, action: "add" };
  }
  const already = hasOwnReaction(reactions, key, currentUserId);
  if (already) {
    const next = current
      .map((reaction) =>
        reaction.key === key
          ? { key: reaction.key, user_ids: reaction.user_ids.filter((id) => id !== currentUserId) }
          : reaction
      )
      .filter((reaction) => reaction.user_ids.length > 0);
    return { reactions: next, action: "remove" };
  }
  const existing = current.find((reaction) => reaction.key === key);
  if (existing) {
    existing.user_ids.push(currentUserId);
    return { reactions: current, action: "add" };
  }
  // 保持 REACTION_KEYS 的稳定展示顺序：新键按枚举顺序插入，不追加到末尾（否则先点 watch 再点 approve
  // 会让 approve 排在 watch 后面，跟工具条五键顺序对不上）。
  const next = [...current, { key, user_ids: [currentUserId] }];
  next.sort((a, b) => REACTION_KEYS.indexOf(a.key) - REACTION_KEYS.indexOf(b.key));
  return { reactions: next, action: "add" };
}
