// R13 批4c/G1（回话判定器）：共享类型——纯类型定义，不含逻辑。
//
// 用户终裁的判定口径（00-plan.md §6 表 N9 + 「Cuu = 项目经理」总纲）：
// - 被 @ 必回（mentioned，最高优先级的内容信号）。
// - 未被 @ 时走判定器：规则前置（命令式请求=回 / 纯人际寒暄=不回）+ 便宜档模型二级判定。
// - 单聊（collab 会话只有 1 个参与者，即只有创建者本人、没有别的人类成员）＝必回特例，不过判定器。
// - cuu_enabled=false 是最高优先级的静音开关——比单聊必回还优先（用户显式关掉的，任何内容信号都不能
//   覆盖），且与"判定器认为这波不该插嘴"是两种不同的静默，不能共用同一个 reason。

export type ReplyJudgeReason =
  // 门禁（gate）：在规则/LLM 之前就决定了结果，根本不看消息内容。
  | "cuu_disabled"
  | "single_participant"
  // 规则前置（rule）：内容信号足够明确，不需要问模型。
  | "mentioned"
  | "rule_imperative"
  | "rule_chitchat"
  // 便宜档模型二级判定（llm）。
  | "llm_yes"
  | "llm_no"
  // LLM 不可用/未接线/预算耗尽时的保守默认——PM 宁可少说话，不该在花钱判断都做不了的时候硬猜着开口。
  | "llm_unavailable_default_silent";

export type ReplyJudgeVerdictSource = "gate" | "rule" | "llm";

export type ReplyJudgeVerdict = {
  shouldReply: boolean;
  reason: ReplyJudgeReason;
  source: ReplyJudgeVerdictSource;
};

// 判定器的输入——调用方（apps/api/src/services/conversation-reply-judge.ts）负责把会话行/消息行
// 摊平成这个窄形状，本包不碰 DB。
export type ReplyJudgeInput = {
  // G1 的 cuu_enabled 迁移尚未落地时，调用方按「视为 true」注入这个字段（见任务书：判定器把
  // cuu_enabled 当注入布尔处理，不依赖它的迁移/schema）。
  cuuEnabled: boolean;
  // conversation_participants 的行数（不含 Cuu——Cuu 不是参与者行）。<=1 即「单聊」必回特例。
  participantCount: number;
  // 触发判定的最新一条用户消息文本。
  text: string;
  // Cuu 的显示名，默认 "Cuu"；@ 提及检测按这个名字做词边界匹配（大小写不敏感）。
  cuuDisplayName?: string;
};

export type ReplyJudgeLlmClassifyInput = {
  // 便宜档分类用的少量上下文（最近几条消息），调用方决定窗口大小。
  recentMessages: Array<{ senderLabel: string; text: string }>;
  candidateText: string;
};

export type ReplyJudgeLlmClassifyResult = { shouldReply: boolean; reason?: string };

// 返回 undefined 表示"这次分类不可用"（LLM 调用失败/预算耗尽/未接线）——judge.ts 据此保守收口成
// llm_unavailable_default_silent，不是当作"分类结果是不回"直接归为 llm_no（reason 要如实区分）。
export type ReplyJudgeLlmClassifier = (
  input: ReplyJudgeLlmClassifyInput
) => Promise<ReplyJudgeLlmClassifyResult | undefined>;
