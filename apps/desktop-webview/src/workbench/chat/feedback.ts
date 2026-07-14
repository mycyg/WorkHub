// WorkHub 桌面 · R14 批 FEEDBACK：Cuu 文字回复 / 行动卡条目的「有用/没用」轻反馈——纯逻辑层（乐观切换
// 判定 + 备注归一化）。全部无副作用、无 DOM，可单测。字符 tile 视觉在 render.ts，网络接线/状态持有在
// view.ts，本地消息数组的落地并入在 timeline.ts（applyMessageFeedbackUpdate/applyActionCardItemFeedbackUpdate，
// 同 applyReactionUpdate 的既有分工）。
//
// SSE 无反馈事件（04-feedback-design.md §0 结论 3/§9：反馈没有跨用户可见面，不值得为它开新事件类型）——
// 本地乐观状态即真相，下次该消息/该会话自然重拉时以服务端为准兜底，同 CHAT 批 reaction 的失败回滚纪律
// 一致，但反馈是单值判定（不是集合），逻辑比 toggleOwnReaction 更简单：不需要维护 user_ids 数组。

import type { AiFeedbackVerdict } from "@workhub/contracts";

export type FeedbackToggleDecision = { mode: "put"; verdict: AiFeedbackVerdict } | { mode: "delete" };

// 点未选中的键 = put 该 verdict；再点已选中的键 = delete（撤销）；点另一个键 = put 新 verdict（覆盖式
// 改判，不需要先 delete）——04-feedback-design.md §7.1A 的交互纪律。
export function decideFeedbackToggle(current: AiFeedbackVerdict | undefined, clicked: AiFeedbackVerdict): FeedbackToggleDecision {
  if (current === clicked) {
    return { mode: "delete" };
  }
  return { mode: "put", verdict: clicked };
}

// 备注归一化——空白字符串等同「无备注」（同服务层 trim→null 的既有口径，见 04-feedback-design.md §2；
// 客户端提前归一，避免多发一次带纯空白的请求，也让「按了保存但没打字」和「按了保存」共用同一条清空路径）。
export function normalizeFeedbackNote(raw: string | undefined): string | undefined {
  const trimmed = raw?.trim();
  return trimmed ? trimmed : undefined;
}
