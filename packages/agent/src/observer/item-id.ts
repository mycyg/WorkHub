import { createHash } from "node:crypto";

// R13 H1（自审 backlog 项2：观察者先派发后建卡）：行动卡条目 id 从 randomUUID() 改成对
// (conversationId, analyzedToSeq, ordinal) 的确定性派生。
//
// 病根（见 apps/api/src/workers/conversation-observer.ts 顶部注释）：execute/decide 的派发
// （建真实 work_item/enqueue agent_run/发通知）发生在 createOrAppendCard 把条目落库、推进水位线
// 之前；这些派发写不进同一个事务，回不了滚。若 createOrAppendCard 这一步失败，水位线不会推进，
// 下一 tick 会对同一批消息重新分析——此前每次都用 randomUUID() 生成全新 id，同一批消息的同一个
// 计划条目每次重扫都会造出一个全新的真实 work_item/agent_run，是货真价实的重复。
//
// 用确定性 id 之后：同一个 (conversationId, analyzedToSeq, ordinal) 三元组任何时候派生出的都是
// 同一个 id，靠 action_card_items 表的既有唯一约束（id 是主键，另见
// action_card_items_id_conversation_workspace_uq）天然幂等——重扫同一批消息、且 LLM 计划的第 N 条
// 条目位置不变时，第二次尝试落库会撞主键冲突而不是造出第二条重复记录（冲突处理见
// conversation-observer.ts 的 isUniqueViolation 分支）。
//
// 实现手法与 packages/agent/src/deliverables/manifest.ts 的私有 deterministicUuid 一致（sha256
// 摘要截断成 16 字节，打上 UUID v4 的版本/变体位，拼成合法 UUID 字符串）——那份是模块私有实现，
// 这里独立成一份而不是跨包导出它：两处都只有几行，不值得为复用单独抽一个共享包（该文件也不在
// 本批改动范围内）。
export function deriveActionCardItemId(conversationId: string, analyzedToSeq: number, ordinal: number): string {
  const bytes = Buffer.from(
    createHash("sha256")
      .update(`workhub:action-card-item\0${conversationId}\0${analyzedToSeq}\0${ordinal}`)
      .digest()
      .subarray(0, 16)
  );
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40; // version 4
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80; // variant 10
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
