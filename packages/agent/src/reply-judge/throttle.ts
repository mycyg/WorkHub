// R13 批4c/G1（回话判定器）：限频合并——纯函数。任务书原话「同会话 30s 合并」：群里连续发的一串消息
// 只应该触发一次判定（判最后一条），而不是每条都问一次便宜档模型。
//
// 实现思路是"安静期"而不是"定时器合并"：调用方（apps/api/src/services/conversation-reply-judge.ts）
// 是一个周期性 tick 的 worker，不是逐条消息的事件钩子——每次 tick 只对"距最新一条用户消息已经过了
// mergeWindowMs 且没有更晚消息追上"的会话做判定。同一个会话在窗口内又来新消息，下次 tick 会看到更新的
// lastMessageCreatedAtMs，判定被自然推迟到新的安静点，天然实现"合并到最后一条"，不需要为每个会话维护
// 一个真实定时器。

export const DEFAULT_REPLY_JUDGE_MERGE_WINDOW_MS = 30_000;

export function shouldEvaluateReplyJudgeNow(input: {
  lastMessageCreatedAtMs: number;
  nowMs: number;
  mergeWindowMs?: number;
}): boolean {
  const windowMs = input.mergeWindowMs ?? DEFAULT_REPLY_JUDGE_MERGE_WINDOW_MS;
  return input.nowMs - input.lastMessageCreatedAtMs >= windowMs;
}

// 已经判过的消息不用重复判——调用方按 conversationId 维护"最后一次判定过的消息 id"（进程内内存态，
// 与 conversation-turns.ts 的 activeTurns Set 同一类已知缺口：多进程/重启会丢失这份状态，见服务
// 汇报"范围外发现"）。这里只是把比较逻辑抽成纯函数方便单测。
export function isAlreadyJudgedMessage(input: {
  lastJudgedMessageId: string | undefined;
  candidateMessageId: string;
}): boolean {
  return input.lastJudgedMessageId === input.candidateMessageId;
}
