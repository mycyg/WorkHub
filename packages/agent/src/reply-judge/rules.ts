// R13 批4c/G1（回话判定器）：规则前置——纯函数，零依赖，已知是粗启发式（中文口语场景下的关键词/
// 句式匹配，不追求完美，只求"够用且可解释"）。命中即短路，不需要走便宜档模型；没命中则交给 judge.ts
// 的下一级（LLM 分类）。

export const DEFAULT_CUU_DISPLAY_NAME = "Cuu";

// 只把 ASCII 字母/数字/下划线当"会延伸同一个词"的字符——中日韩表意文字不算。这是刻意的选择，不是
// 疏漏：JS 正则原生的 \b 断言只认 \w=[A-Za-z0-9_]，如果直接用 `\bCuu\b` 去匹配一个中文显示名（比如
// "小助手"），\b 在"小"这种非 \w 字符的两侧都不成立（\b 要求断言位置一侧是 \w、另一侧不是——两侧都
// 非 \w 时压根没有断言点），会导致中文名永远匹配不上，不管前后是什么字符。手写扫描版本按同样的口径
// （只拿 ASCII 字母数字下划线判断"是否会把匹配延伸成另一个词"）在两种显示名下都正确：
// - "叫Cuu帮忙"："叫"/"帮"都不是 ASCII 词字符 → 边界成立 → 命中。
// - "cuubot 也在群里"：匹配后紧跟 "b"（ASCII 词字符）→ 边界不成立 → 不命中（不误配子串）。
// - "@小助手 在吗"（自定义中文显示名）："@"/" " 都不是 ASCII 词字符 → 边界成立 → 命中。
function isAsciiWordChar(ch: string | undefined): boolean {
  return ch !== undefined && /[A-Za-z0-9_]/u.test(ch);
}

export function mentionsDisplayName(text: string, displayName: string = DEFAULT_CUU_DISPLAY_NAME): boolean {
  const trimmed = displayName.trim();
  if (trimmed.length === 0) {
    return false;
  }
  const lowerText = text.toLowerCase();
  const lowerName = trimmed.toLowerCase();
  let fromIndex = 0;
  for (;;) {
    const index = lowerText.indexOf(lowerName, fromIndex);
    if (index === -1) {
      return false;
    }
    const before = index > 0 ? lowerText[index - 1] : undefined;
    const after = index + lowerName.length < lowerText.length ? lowerText[index + lowerName.length] : undefined;
    if (!isAsciiWordChar(before) && !isAsciiWordChar(after)) {
      return true;
    }
    fromIndex = index + 1;
  }
}

// 命令式请求——请求/委托语气的关键词，命中即视为"该说话"（PM 该接话的场景：有人在明确地要东西/要
// 帮忙）。刻意保守偏中文口语，不追求覆盖所有措辞。
const IMPERATIVE_MARKERS = [
  "帮我",
  "帮忙",
  "麻烦你",
  "麻烦",
  "请你",
  "请帮",
  "能不能",
  "可以帮",
  "谁能",
  "谁来",
  "有没有人",
  "查一下",
  "找一下",
  "建一个",
  "建个",
  "发一下",
  "同步一下",
  "跟进一下",
  "安排一下",
  "需要你",
  "辛苦一下"
] as const;

const ACTION_VERBS = ["找", "发", "建", "查", "看", "写", "生成", "处理", "安排", "整理", "统计", "汇总", "上传", "下载"] as const;

export function looksImperative(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (normalized.length === 0) {
    return false;
  }
  if (IMPERATIVE_MARKERS.some((marker) => normalized.includes(marker))) {
    return true;
  }
  // 问句 + 常见任务动词的粗启发式："谁把xx发一下？" 这类没命中关键词表但明显在请求行动的句子。
  const endsWithQuestion = /[?？]\s*$/u.test(normalized);
  return endsWithQuestion && ACTION_VERBS.some((verb) => normalized.includes(verb));
}

// 纯人际寒暄——短促、无请求、无问号的应答词。长度阈值和白名单都刻意保守（宁可漏判为 undetermined
// 交给下一级，也不要把带请求的话错杀成寒暄）。
const CHITCHAT_ONLY = new Set([
  "哈哈",
  "哈哈哈",
  "哈哈哈哈",
  "嗯",
  "嗯嗯",
  "好的",
  "好",
  "好滴",
  "ok",
  "okay",
  "谢谢",
  "感谢",
  "收到",
  "在的",
  "打卡",
  "1",
  "+1",
  "666",
  "牛",
  "顶",
  "赞",
  "哈",
  "嗯好"
]);

const MAX_CHITCHAT_CHARS = 6;

export function looksLikeChitchat(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (normalized.length === 0) {
    return true;
  }
  if (CHITCHAT_ONLY.has(normalized)) {
    return true;
  }
  if (normalized.length > MAX_CHITCHAT_CHARS) {
    return false;
  }
  if (/[?？]/u.test(normalized)) {
    return false;
  }
  return !looksImperative(normalized);
}

export type ReplyJudgeRuleVerdict = "reply" | "silent" | "undetermined";

// 规则前置的唯一入口——顺序即优先级：被 @ > 命令式 > 纯寒暄 > 交给下一级。
export function applyReplyJudgeRules(input: { text: string; mentioned: boolean }): ReplyJudgeRuleVerdict {
  if (input.mentioned) {
    return "reply";
  }
  if (looksImperative(input.text)) {
    return "reply";
  }
  if (looksLikeChitchat(input.text)) {
    return "silent";
  }
  return "undetermined";
}
