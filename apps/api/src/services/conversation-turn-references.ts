// R23 F-07（聊天「#会话引用」/「/技能唤起」服务端解析）：把一条人类消息正文里的 `#会话标题` /
// `/技能名` 解析回真实的会话 id / 技能行。纯函数，无 DB、无网络——数据（可见会话清单、活跃技能清单）
// 由 apps/api/src/services/conversation-turns.ts 用既有仓库方法查好后传进来。
//
// 为什么是「正文里的可读名字 + 服务端解析」而不是消息体上的结构化字段（决策见
// .agents/notes/implemented/2026-09-05-chat-conversation-and-skill-references.md）：
//  1. 与 @ 提及同一套机制。@某人 / @Cuu 从来都只是纯文本，服务端按名字解析（本文件的近邻先例：
//     conversation-turns.ts 的 mentionsCuu 按显示名做词边界匹配；approvals.ts 的 parseMentions 用
//     正则从评论正文里抽 @昵称 再查 findActiveByNickname）。# 和 / 沿用同一套，不新造第二种引用机制。
//  2. 人类消息的 content_json 在仓库层被钉死成「有且只有 text 一个键」
//     （packages/db/src/repositories/conversations.ts 的 assertMessageContent），加结构化字段要一路
//     改契约/仓库/openapi/SDK。
//  3. 结构化字段对别的客户端（web）是隐形的：聊天框里看不出这句话额外喂了 Cuu 哪条会话，而引用会
//     真的改变 Cuu 看到的东西。可读的正文让房间里每个人都看得见被引用了什么。
//
// 代价（如实记录，不假装没有）：会话被改名后旧消息里的引用就解析不上了——正文对人仍然读得通，只是
// Cuu 这一轮不再拿到那条会话的上下文。宁可如此，也不要一个「文字说引用了 A、实际喂进 B」的错位。

// 一条引用最多带回多少条被引会话的近期消息（越界的老消息不进 prompt）。
export const TURN_CONVERSATION_REF_MESSAGE_LIMIT = 12;
// 一轮最多认几条 `#会话` 引用——上下文预算有限，多写的引用按正文出现顺序取前几条。
export const MAX_TURN_CONVERSATION_REFS = 2;
// 一轮最多认几条 `/技能` 唤起。斜杠命令语义天然只有一条（只在整条消息最开头触发）。
export const MAX_TURN_SKILL_REFS = 1;
// 单条被引消息进 prompt 的截断长度——防一条超长发言把整个上下文吃满。
export const TURN_CONVERSATION_REF_TEXT_LIMIT = 400;
// 被唤起技能正文进 prompt 的截断长度。
export const TURN_SKILL_CONTENT_LIMIT = 4_000;

export type ConversationRefCandidate = {
  id: string;
  title: string;
};

export type SkillRefCandidate = {
  skillKey: string;
  name: string;
  whenToUse: string;
  contentMd: string;
};

// 触发符左边界规则与桌面端解析器逐字同款（apps/desktop-webview/src/workbench/chat/trigger-parser.ts
// 的 detectComposerTrigger）：`#` 必须紧跟行首或空白，否则 "a#b" 这类正文里的井号会被误判成引用。
function hasTriggerBoundaryBefore(text: string, index: number): boolean {
  if (index === 0) {
    return true;
  }
  const previous = text[index - 1];
  return previous === " " || previous === "\n" || previous === "\t";
}

// 右边界：名字后面必须是文本结尾或空白。要求这一条是为了「#预算复盘」不会去命中一条叫「预算复」的
// 会话——同时配合下面的「长标题优先」排序，让「#预算复盘 二轮」优先于「#预算复盘」被命中。
function hasTriggerBoundaryAfter(text: string, index: number): boolean {
  if (index >= text.length) {
    return true;
  }
  const next = text[index];
  return next === " " || next === "\n" || next === "\t";
}

function byNameLengthDesc<T>(items: readonly T[], nameOf: (item: T) => string): T[] {
  return [...items].sort((a, b) => nameOf(b).length - nameOf(a).length);
}

// 便宜的预判：正文里根本没有合法位置的 `#` 时，调用方可以完全跳过「查该项目可见会话清单」这条 DB
// 读——绝大多数消息都不带引用，不该为它们多付一次查询。
export function mayReferenceConversation(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "#" && hasTriggerBoundaryBefore(text, index)) {
      return true;
    }
  }
  return false;
}

// `/技能` 只在整条消息最开头触发（与桌面端解析器同一条规则——斜杠命令语义，避免正文里写路径/分数
// 被误判）。这个预判不查任何清单，只看形状。
export function mayInvokeSkill(text: string): boolean {
  return text.length > 1 && text.startsWith("/") && !hasTriggerBoundaryAfter(text, 1);
}

// 从正文里解析出被引用的会话。命中口径：正文里出现 `#<会话标题>`，`#` 前是行首/空白，标题后是结尾/
// 空白。候选清单必须由调用方按「发起人本人可见」查好（listVisibleForProject 带 viewerUserId）——本函数
// 不做任何权限判断，传进来什么就能被引用什么，这条红线由调用方守。
// 排除自引用：正在发言的这条会话本身被 `#` 到时跳过（它的历史本来就在这一轮上下文里，重复注入只是
// 浪费预算）。
export function resolveConversationRefs(
  text: string,
  candidates: readonly ConversationRefCandidate[],
  options: { excludeConversationId?: string; max?: number } = {}
): ConversationRefCandidate[] {
  const max = options.max ?? MAX_TURN_CONVERSATION_REFS;
  if (max <= 0 || text.length === 0) {
    return [];
  }
  const excluded = options.excludeConversationId?.toLowerCase();
  // 长标题优先 + 占位：先匹配长的，并把命中的那段正文占住，短标题就不能再在同一段里命中——
  // 「#预算复盘 二轮」只算引用了《预算复盘 二轮》，不会顺带把《预算复盘》也算上。
  const ordered = byNameLengthDesc(candidates, (candidate) => candidate.title);
  const hits: Array<{ index: number; candidate: ConversationRefCandidate }> = [];
  const claimed: Array<{ start: number; end: number }> = [];
  const seen = new Set<string>();
  for (const candidate of ordered) {
    const title = candidate.title;
    if (title.length === 0 || seen.has(candidate.id)) {
      continue;
    }
    if (excluded && candidate.id.toLowerCase() === excluded) {
      continue;
    }
    const needle = `#${title}`;
    let from = 0;
    for (;;) {
      const index = text.indexOf(needle, from);
      if (index === -1) {
        break;
      }
      const end = index + needle.length;
      const overlaps = claimed.some((span) => index < span.end && end > span.start);
      if (!overlaps && hasTriggerBoundaryBefore(text, index) && hasTriggerBoundaryAfter(text, end)) {
        hits.push({ index, candidate });
        claimed.push({ start: index, end });
        seen.add(candidate.id);
        break;
      }
      from = index + 1;
    }
  }
  // 结果按正文出现顺序返回（超出上限时保留写在前面的那几条，符合「先写先算」的直觉）。
  return hits
    .sort((a, b) => a.index - b.index)
    .slice(0, max)
    .map((hit) => hit.candidate);
}

// 从正文开头解析出被唤起的技能。命中口径：正文以 `/<技能名>` 开头，名字后是结尾/空白。候选清单由
// 调用方按工作区查好（teamSkills.listActive，本来这一轮就已经查过一次，不额外多查）。
export function resolveSkillRefs(
  text: string,
  candidates: readonly SkillRefCandidate[],
  options: { max?: number } = {}
): SkillRefCandidate[] {
  const max = options.max ?? MAX_TURN_SKILL_REFS;
  if (max <= 0 || !text.startsWith("/")) {
    return [];
  }
  const ordered = byNameLengthDesc(candidates, (candidate) => candidate.name);
  const picked: SkillRefCandidate[] = [];
  for (const candidate of ordered) {
    if (candidate.name.length === 0) {
      continue;
    }
    const needle = `/${candidate.name}`;
    if (text.startsWith(needle) && hasTriggerBoundaryAfter(text, needle.length)) {
      picked.push(candidate);
      if (picked.length >= max) {
        break;
      }
    }
  }
  return picked;
}
