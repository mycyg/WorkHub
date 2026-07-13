// WorkHub 桌面 · 行动卡条目 decide/undo 失败后的温和行内提示——纯函数，照 turn.ts 的
// mapConversationTurnError 同款取舍：不弹阻断式对话框，服务端错误码/文案见
// apps/api/src/services/action-cards.ts 的 ActionCardServiceError 抛出点；这里维护一份独立的、更
// 口语化的桌面端文案（服务端 message 字段是给 API 消费者看的通用文案，不一定是这个具体表面最合适的
// 措辞）。未识别的 code 统一落一句通用重试文案，不暴露内部错误码。

export type ActionCardDecisionErrorSource = { status?: number; code?: string } | undefined;

const ACTION_CARD_ERROR_TEXT: Record<"zh-CN" | "en-US", Record<string, string>> = {
  "zh-CN": {
    human_required: "这个操作需要你用真实账号登录。",
    forbidden: "只有被指派的负责人或管理员能处理这张卡。",
    action_card_item_not_found: "没找到这个条目，它可能已经被移除了。",
    action_card_item_not_decidable: "这个条目不支持这个操作。",
    action_card_reassign_requires_assignee: "改派前先选一个人。",
    action_card_assignee_not_a_member: "这个人不是当前工作区的活跃成员。",
    // 00-interaction-design.md §2.3 的既定文案："这条已经被处理过了"——decide 与 undo 各自的
    // "已经被别人/别处处理过"两个服务端错误码统一落这句话，用户不需要区分是哪种"已处理"。
    action_card_item_already_decided: "这条已经被处理过了。",
    action_card_decision_already_resolved: "这条已经被处理过了。",
    action_card_item_not_undoable: "撤销窗口已经过了，这条没法再撤销。"
  },
  "en-US": {
    human_required: "This action needs you to be signed in as a real user.",
    forbidden: "Only the assigned owner or an admin can act on this card.",
    action_card_item_not_found: "Couldn't find this item — it may have been removed.",
    action_card_item_not_decidable: "This item doesn't support that action.",
    action_card_reassign_requires_assignee: "Pick someone before reassigning.",
    action_card_assignee_not_a_member: "That person isn't an active member of this workspace.",
    action_card_item_already_decided: "This one's already been handled.",
    action_card_decision_already_resolved: "This one's already been handled.",
    action_card_item_not_undoable: "The undo window has passed — this can't be undone anymore."
  }
};

const FALLBACK_ACTION_CARD_ERROR_TEXT: Record<"zh-CN" | "en-US", string> = {
  "zh-CN": "没弄成，稍后再试一次。",
  "en-US": "That didn't go through — try again in a moment."
};

export function mapActionCardDecisionError(error: ActionCardDecisionErrorSource, locale: "zh-CN" | "en-US"): string {
  const table = ACTION_CARD_ERROR_TEXT[locale];
  const code = error?.code;
  if (code && Object.prototype.hasOwnProperty.call(table, code)) {
    return table[code]!;
  }
  return FALLBACK_ACTION_CARD_ERROR_TEXT[locale];
}

// 409 already_decided/already_resolved 是"我们本地的快照比服务端权威状态旧了"的信号（比如另一个人
// 抢先点了、或者上一次点击其实已经成功但响应丢了）——这两种情况本地状态确定过期，触发一次消息重取
// 对账（view.ts 的 refreshActionCardMessage）比只展示错误文案更诚实。其它错误码（403/422/404/500等）
// 不代表本地状态过期，不需要重拉。
export function shouldReconcileActionCardOnError(code: string | undefined): boolean {
  return code === "action_card_item_already_decided" || code === "action_card_decision_already_resolved";
}
