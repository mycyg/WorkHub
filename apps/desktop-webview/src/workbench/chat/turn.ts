// WorkHub 桌面 · 协同会话 turn 的纯逻辑——发一条文本消息后要不要自动请求 Cuu 回话、SSE 增量怎么拼、
// 409/429 怎么翻译成温和文案。全部纯函数（照本目录既有分工：view.ts 只接线，逻辑在这类 colocated
// 模块里单测），因为这个 workspace 的测试运行器没有真实 DOM（见 view.test.ts 顶部注释）。
//
// 服务端契约见 apps/api/src/services/conversation-turns.ts 顶部注释与
// r12-desktop-workbench/reports/batch-4a-turns.md：
// - 只有 kind='collab' 的会话能发起 turn；主区（kind='main'）请求会被服务端 409
//   conversation_turn_not_collab 拒绝——shouldRequestConversationTurn 就是把这条红线搬到前端，
//   在请求发出去之前先本地判断，不依赖服务端兜底（省一次必然失败的往返，也让"主区绝不调 turns"
//   这条要求能被纯函数单测锁死，而不必依赖没有 DOM 的 view.ts）。
// - Cuu 落库的回复消息**不会**触发任何 "message.created" 广播事件（见批 4a 报告"已知设计冲突"一节：
//   conversationMessageCreatedEventSchema 的 superRefine 硬编码要求人类发言人，没有给 AI 发言者开口子，
//   范围围栏也没批准放宽这条既有契约）。发起 turn 的客户端从 POST /conversations/:id/turns 的 HTTP
//   响应本身就能拿到带真实 id/seq 的完整消息 VM——这是本模块认定"这一轮说完了"的唯一权威信号，不是
//   等一个不存在的 SSE 事件。

import type { ConversationKind } from "@workhub/contracts";

// 主区归静默观察者（批3）处理；只有单聊（协同会话）才走这条"发消息后自动请 Cuu 回一句"的通道。
export function shouldRequestConversationTurn(conversationKind: ConversationKind): boolean {
  return conversationKind === "collab";
}

// —— 流式增量拼接 —— //
//
// conversation.message.delta 事件（packages/contracts/src/events.ts 的
// conversationMessageDeltaEventSchema）只携带 {conversation_id, turn_id, delta_text, ordinal}，没有
// seq、不落库、不参与任何 reconcile——纯瞬态的"正在打字"信号。ordinal 从 0 递增，但 SSE 重连/网络抖动
// 下不保证严格的到达顺序或不重复；用 Map<ordinal, text> 存（同一个 ordinal 再来一次是幂等覆盖，不是
// 重复拼接），渲染时按 ordinal 排序拼接，而不是假设"先到先拼"。
export type TurnDeltaState = {
  turnId: string | undefined;
  chunks: ReadonlyMap<number, string>;
};

export const EMPTY_TURN_DELTA_STATE: TurnDeltaState = { turnId: undefined, chunks: new Map() };

// 服务端并发闸保证同一会话同时只有一个进行中的 turn，正常情况下不会看到 turn_id 中途切换；这里仍然
// 防御性处理"万一切换了"——换 turn 就丢弃旧分片重新累积，不会把上一轮和这一轮的文字拼在一起。
export function appendTurnDelta(
  state: TurnDeltaState,
  event: { turnId: string; deltaText: string; ordinal: number }
): TurnDeltaState {
  const chunks = state.turnId === event.turnId ? new Map(state.chunks) : new Map<number, string>();
  chunks.set(event.ordinal, event.deltaText);
  return { turnId: event.turnId, chunks };
}

export function renderTurnDeltaText(state: TurnDeltaState): string {
  return [...state.chunks.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, text]) => text)
    .join("");
}

// —— 409/429 错误 → 温和的行内提示 —— //
//
// 不弹阻断式对话框——服务端的错误码/文案见 apps/api/src/services/conversation-turns.ts 里对应的
// ConversationTurnServiceError 抛出点；这里维护一份独立的、更口语化的桌面端文案（服务端的 message
// 字段是给 API 消费者看的通用文案，不一定是这个具体表面最合适的措辞）。apps/api/src/app.ts 已经给
// ConversationTurnServiceError 注册了透传专属分支（不是内部 500 兜底吞掉真实 code——上一版注释在这里
// 记错了，R13 批 G1 顺手更正），未识别的 code 才会落到下面的通用重试文案，不暴露内部错误码。
export type ConversationTurnErrorSource = { status?: number; code?: string } | undefined;

const TURN_ERROR_TEXT: Record<"zh-CN" | "en-US", Record<string, string>> = {
  "zh-CN": {
    conversation_turn_busy: "Cuu 正忙着上一轮，等它说完再试。",
    conversation_turn_mode_observe_only: "你的模式是只观察，点输入框旁的「模式」切换后再试。",
    conversation_turn_budget_exhausted: "这段时间用得有点多，稍后再试。",
    conversation_turn_not_collab: "这个会话没法单独请 Cuu 回话。",
    conversation_turn_message_not_found: "这条消息有点旧了，重新说一句试试。",
    // R13 批 G1（小群）：cuu_enabled 硬闸——用户在这个会话里手动关掉了 Cuu，不是失败，如实说明。
    conversation_turn_cuu_disabled: "这个会话关掉了 Cuu，不会有回应——想让它说话，去开一下「Cuu 参与」。",
    // R13 批 G1：回话判定接缝的拒绝码——4c 判定器接入前几乎不会触发（默认判定器永远放行），
    // 触发时说明这一句消息被判定为不需要 Cuu 主动接话，@Cuu 可以强制它回应。
    conversation_turn_not_warranted: "这句话看起来不用 Cuu 接话——想让它回应，@Cuu 一下。",
    conversation_turn_failed: "Cuu 这次没接上，你可以再说一句试试。"
  },
  "en-US": {
    conversation_turn_busy: "Cuu is still finishing the last reply — try again in a moment.",
    conversation_turn_mode_observe_only: "Your mode is observe-only — switch it with the Mode control next to the composer.",
    conversation_turn_budget_exhausted: "Usage has been high lately — try again later.",
    conversation_turn_not_collab: "This conversation can't request a one-on-one reply.",
    conversation_turn_message_not_found: "That message is a bit stale — try saying it again.",
    conversation_turn_cuu_disabled: "Cuu is turned off in this chat — flip on \"Cuu takes part\" to hear from it again.",
    conversation_turn_not_warranted: "That message didn't look like it needed a reply — @Cuu it to make sure.",
    conversation_turn_failed: "Cuu couldn't get a reply out — try saying it again."
  }
};

const FALLBACK_TURN_ERROR_TEXT: Record<"zh-CN" | "en-US", string> = {
  "zh-CN": "Cuu 这次没接上，你可以再说一句试试。",
  "en-US": "Cuu couldn't get a reply out — try saying it again."
};

export function mapConversationTurnError(error: ConversationTurnErrorSource, locale: "zh-CN" | "en-US"): string {
  const table = TURN_ERROR_TEXT[locale];
  const code = error?.code;
  if (code && Object.prototype.hasOwnProperty.call(table, code)) {
    return table[code]!;
  }
  return FALLBACK_TURN_ERROR_TEXT[locale];
}
