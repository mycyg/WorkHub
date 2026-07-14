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

// 主区归静默观察者（批3）处理；协同会话（单聊/小群）走"发消息后自动请 Cuu 回一句"通道。
// R13 终验修复（个人空间单聊必回）：个人空间的默认线程是该项目的 main 会话（S3 设计），它是
// 纯 1:1 单聊——同样放行。团队项目的 main 仍然绝不调 turns（这条红线不变），由 personalProject
// 标志把两种 main 区分开，服务端 conversation-turns.ts 有同一条语义的镜像闸。
export function shouldRequestConversationTurn(
  conversationKind: ConversationKind,
  context: { personalProject?: boolean | undefined } = {}
): boolean {
  return conversationKind === "collab" || (conversationKind === "main" && context.personalProject === true);
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

// —— R14 P1-11：turn 进行中发第二条消息不能被晾住 —— //
//
// 病灶：view.ts 的 issueSend 只要 shouldRequestConversationTurn 为真就无条件调 beginTurn——发第一条
// 消息之后、它的 POST /conversations/:id/turns 响应回来之前，composer 的"禁发"闸门（turnActive）还没
// 翻成 true（beginTurn 是在第一条消息落库的 HTTP 响应里才被调用，turnActive 在那之前一直是 false），
// 用户来得及在这个窗口里再发一条。两条消息的创建请求前后脚落库，两个 issueSend 的 .then 都会尝试调
// beginTurn——第二次调用撞上服务端会话级忙碌闸（conversation-turns.ts 的 activeTurns），拿到 409
// conversation_turn_busy，然后就没有任何重试：第二条消息被静默晾住，永远等不到 Cuu 回应。
//
// 修复契约（不改服务端语义，只改客户端行为）：维护一个"待回应锚点"——turn 进行中又有新文本消息落库时，
// 只记住最新一条的 id（不排队列表，旧锚点被直接覆盖）；当前这一轮 turn 结束（成功/失败/超时都算）后，
// 自动为锚点补发一轮新 turn，发出去之后清空锚点。补发本身也可能再次撞见 409 busy（小群的回话判定器
// tick 抢先、或者本地这次也是撞见另一端并发发起的 turn）——这种情况原地重试，连续撞见 3 次才放弃并给
// 一条独立于"忙碌中"的温和提示（要求用户自己再问一次），不无限重试。
//
// 下面这组类型/函数全部是纯状态机（不碰 DOM/网络），由 view.ts 在 beginTurn 的调用点/settle 回调里
// 驱动：queueTurnAnchor 在"已经有一轮在飞时收到新消息"调用；beginTurnPursuit 在每次真正发起
// POST /turns 请求前调用（决定这次尝试算不算同一条消息的连续重试，从而决定连败计数要不要延续）；
// settleTurnPursuit 在每次请求的 .then/.catch 里调用，返回"接下来该做什么"的决策。

export type TurnQueueState = {
  // 排队等待的下一条消息 id——只记最新一条；当前没有排队的新消息时是 undefined。
  readonly pendingAnchorMessageId: string | undefined;
  // 正在追（发起/重试）的消息 id——决定下一次 409 busy 算不算"同一条消息的连续失利"。
  readonly pursuitMessageId: string | undefined;
  // pursuitMessageId 连续撞见 409 busy 的次数；换成一条新消息（不同 id）时清零。
  readonly consecutiveBusyFailures: number;
};

export const EMPTY_TURN_QUEUE_STATE: TurnQueueState = {
  pendingAnchorMessageId: undefined,
  pursuitMessageId: undefined,
  consecutiveBusyFailures: 0
};

// 连续撞见 409 busy 达到这个次数就放弃自动重试，交回给用户手动决定要不要再问一次。
export const TURN_QUEUE_MAX_CONSECUTIVE_BUSY_FAILURES = 3;

// 已经有一轮 turn 在飞（本地 turnActive 为真）时，一条新文本消息落库——记下它的 id 等这一轮结束后
// 自动补发。只覆盖 pendingAnchorMessageId，不动 pursuit/连败计数（那两个字段描述的是"正在飞的这一轮"，
// 跟"排队等下一轮"是两件独立的事）。多次调用只保留最新一次的 messageId，不排队列表——旧的锚点对应的
// 消息已经被更新的对话内容取代，没必要单独追一轮回应。
export function queueTurnAnchor(state: TurnQueueState, messageId: string): TurnQueueState {
  return { ...state, pendingAnchorMessageId: messageId };
}

// 每次真正发起 POST /turns 之前调用（不管这次发起是用户发消息直接触发、还是排队锚点被自动取用触发、
// 还是撞见 busy 之后原地重试）。追的还是同一条消息 id——保留连败计数，继续累计；换了一条不同的消息 id
// ——说明这是一次全新的追单，给它一轮全新的连败预算（清零）。
export function beginTurnPursuit(state: TurnQueueState, messageId: string): TurnQueueState {
  if (state.pursuitMessageId === messageId) {
    return state;
  }
  return { pendingAnchorMessageId: state.pendingAnchorMessageId, pursuitMessageId: messageId, consecutiveBusyFailures: 0 };
}

// "busy"：这一轮以 409 conversation_turn_busy 收场；"settled"：其它任何收场方式（成功、not_warranted
// 静默、其它错误码、网络失败/超时）——这些在"要不要自动重试"这层看来是一回事：追单结束，看看有没有
// 排队的新锚点。busy/settled 的区分只影响是否要重试同一条消息，不影响是否展示错误文案（那是 view.ts
// 自己按错误码另外判断的事，见 classifyTurnErrorOutcome）。
export type TurnSettleOutcome = "busy" | "settled";

export type TurnSettleDecision =
  // 撞 busy 但还没到连败上限——原地重试同一条消息。
  | { readonly action: "retry_same"; readonly messageId: string; readonly state: TurnQueueState }
  // 撞 busy 且已经连败到上限——放弃这条消息的自动追单，交给用户手动决定（连排队中的锚点一起清空，
  // 不做级联重试——真要再问一次，用户自己重新发一句最省心，不做"放弃一条、偷偷再战另一条"的隐藏行为）。
  | { readonly action: "give_up"; readonly state: TurnQueueState }
  // 这一轮结束（非 busy），有排队的新锚点——追它，给一轮全新的连败预算。
  | { readonly action: "retry_anchor"; readonly messageId: string; readonly state: TurnQueueState }
  // 这一轮结束，没有排队的新锚点——什么都不用做。
  | { readonly action: "idle"; readonly state: TurnQueueState };

export function settleTurnPursuit(state: TurnQueueState, outcome: TurnSettleOutcome): TurnSettleDecision {
  if (outcome === "busy" && state.pursuitMessageId) {
    const consecutiveBusyFailures = state.consecutiveBusyFailures + 1;
    if (consecutiveBusyFailures >= TURN_QUEUE_MAX_CONSECUTIVE_BUSY_FAILURES) {
      return {
        action: "give_up",
        state: { pendingAnchorMessageId: undefined, pursuitMessageId: undefined, consecutiveBusyFailures: 0 }
      };
    }
    return {
      action: "retry_same",
      messageId: state.pursuitMessageId,
      state: { ...state, consecutiveBusyFailures }
    };
  }
  if (state.pendingAnchorMessageId) {
    return {
      action: "retry_anchor",
      messageId: state.pendingAnchorMessageId,
      state: { pendingAnchorMessageId: undefined, pursuitMessageId: undefined, consecutiveBusyFailures: 0 }
    };
  }
  return { action: "idle", state: { pendingAnchorMessageId: undefined, pursuitMessageId: undefined, consecutiveBusyFailures: 0 } };
}

// —— 409 错误码 → 三种界面处理方式 —— //
//
// "busy"：转入上面的自动重试队列，界面不展示任何文字（重试本身对用户透明，只有连败到上限才会看到
// 温和提示，见 turnQueueGiveUpText）。
// "silent"：conversation_turn_not_warranted——回话判定器判定"这句话不需要 Cuu 接话"，这是正常业务态，
// 不是失败，界面保持静默，不展示 mapConversationTurnError 那句"@Cuu 一下"的提示（那句话是给"用户主动
// 点了个会被拒的操作"场景用的，比如小群里对着一条已经判定不用回的话手动要求；这里不是那个场景，是
// 自动发起，用户根本没有主动请求"一定要回应"，不该被打扰）。
// "error"：其它任何错误码（含未知码/网络失败）——照旧展示 mapConversationTurnError 的温和文案。
export type TurnErrorClassification = "busy" | "silent" | "error";

export function classifyTurnErrorOutcome(code: string | undefined): TurnErrorClassification {
  if (code === "conversation_turn_busy") {
    return "busy";
  }
  if (code === "conversation_turn_not_warranted") {
    return "silent";
  }
  return "error";
}

const TURN_QUEUE_GIVE_UP_TEXT: Record<"zh-CN" | "en-US", string> = {
  "zh-CN": "Cuu 正忙，这条稍后手动再问。",
  "en-US": "Cuu is swamped right now — ask again on this one a bit later."
};

// 自动补请连败到上限后的独立提示——跟 mapConversationTurnError 的 conversation_turn_busy 文案
// （"Cuu 正忙着上一轮，等它说完再试"）故意不同：那句暗示"马上再试就行"，这里已经自动试过 3 次，
// 需要说清楚"已经放弃自动重试，要靠你自己再问一次"。
export function turnQueueGiveUpText(locale: "zh-CN" | "en-US"): string {
  return TURN_QUEUE_GIVE_UP_TEXT[locale];
}
