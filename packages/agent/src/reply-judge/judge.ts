import { DEFAULT_CUU_DISPLAY_NAME, applyReplyJudgeRules, mentionsDisplayName } from "./rules.js";
import type { ReplyJudgeInput, ReplyJudgeLlmClassifier, ReplyJudgeVerdict } from "./types.js";

// R13 批4c/G1（回话判定器）：唯一的编排入口——门禁 → 规则前置 → 便宜档 LLM 兜底，纯函数（LLM 调用
// 通过回调注入，本模块不碰网络/DB/provider registry，方便单测；真正的 LLM 接线在
// apps/api/src/services/conversation-reply-judge.ts）。
//
// 优先级（自上而下，命中即返回，不再往下走）：
// 1. cuu_enabled=false —— 最高优先级的静音开关，用户显式关掉的，任何内容信号都不能覆盖（哪怕被 @）。
// 2. participantCount<=1 —— 单聊必回特例（今天的 1:1 协同会话本来就是"创建者 + Cuu"，没有别的人类
//    成员）；这个分支即使命中 cuu_enabled=true 之后才检查，保证"关闭开关"始终最优先。
// 3. 规则前置：被 @ / 命令式请求 → 回；纯寒暄 → 不回。
// 4. 规则给不出结论（undetermined）→ 便宜档模型二级判定；模型也给不出结果（未接线/超时/解析失败）
//    时保守收口为"不回"——PM 宁可少说话，也不该在判断都做不出来的时候硬猜着开口。
export async function judgeReply(
  input: ReplyJudgeInput & {
    // 便宜档分类用的少量上下文（最近几条消息，按时间升序）；调用方（服务层）从 DB 拉取并摊平好，
    // 本模块只负责原样透传给 classifyWithLlm，不做任何截断/摘要（那部分逻辑在 prompt.ts）。
    recentMessages?: Array<{ senderLabel: string; text: string }>;
    classifyWithLlm?: ReplyJudgeLlmClassifier;
  }
): Promise<ReplyJudgeVerdict> {
  if (!input.cuuEnabled) {
    return { shouldReply: false, reason: "cuu_disabled", source: "gate" };
  }
  if (input.participantCount <= 1) {
    return { shouldReply: true, reason: "single_participant", source: "gate" };
  }

  const displayName = input.cuuDisplayName ?? DEFAULT_CUU_DISPLAY_NAME;
  const mentioned = mentionsDisplayName(input.text, displayName);
  const rule = applyReplyJudgeRules({ text: input.text, mentioned });

  if (rule === "reply") {
    return { shouldReply: true, reason: mentioned ? "mentioned" : "rule_imperative", source: "rule" };
  }
  if (rule === "silent") {
    return { shouldReply: false, reason: "rule_chitchat", source: "rule" };
  }

  if (!input.classifyWithLlm) {
    return { shouldReply: false, reason: "llm_unavailable_default_silent", source: "llm" };
  }
  const classified = await input.classifyWithLlm({ recentMessages: input.recentMessages ?? [], candidateText: input.text });
  if (!classified) {
    return { shouldReply: false, reason: "llm_unavailable_default_silent", source: "llm" };
  }
  return { shouldReply: classified.shouldReply, reason: classified.shouldReply ? "llm_yes" : "llm_no", source: "llm" };
}
