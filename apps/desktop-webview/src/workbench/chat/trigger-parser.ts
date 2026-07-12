// WorkHub 桌面 · composer 的 @/#// 引用触发符解析——纯函数，无 DOM 依赖，照
// reference/wisp-science/ui/src/app_support.rs:494-559 的形态：触发符必须紧跟「行首」或「空白」才算
// 激活（避免邮箱地址里的 @、路径分数里的 / 被误判为触发），触发符和光标之间一旦出现空白，说明这段
// 引用已经打完，不再是选择态（picker 应该关闭）。
//
// `/` 只在整条消息最开头触发——技能唤起是斜杠命令语义（照 Slack 等既有产品心智），不是任意位置引用，
// 否则会和正文里写路径/写分数的场景冲突。
//
// chip 只存 id，不存内容（01 §6 安全红线，见 render.ts/view.ts 的用法）：这个模块本身不关心 id，只负责
// 「光标现在处在哪个触发符的查询态」和「选中一项后如何把查询文本替换成插入内容」两件事。

export type ComposerTriggerKind = "mention" | "conversation_ref" | "skill_ref";

export type ComposerTriggerMatch = {
  kind: ComposerTriggerKind;
  trigger: "@" | "#" | "/";
  // 触发符在文本中的位置（含触发符本身）。
  start: number;
  // 光标位置（= 触发符后已输入查询串的结尾）。
  end: number;
  // 触发符与光标之间的查询文本（不含触发符本身）。
  query: string;
};

const TRIGGER_KIND: Record<"@" | "#" | "/", ComposerTriggerKind> = {
  "@": "mention",
  "#": "conversation_ref",
  "/": "skill_ref"
};

function isTriggerBoundaryChar(ch: string | undefined): boolean {
  return ch === " " || ch === "\n" || ch === "\t";
}

// 从光标位置往回扫描，找离光标最近、且满足边界规则的触发符。一旦遇到空白就停（说明当前这段连续
// 非空白文本里没有触发符，不是选择态）；一旦遇到触发符字符就直接判定并返回（不管结果是不是有效
// 触发——同一段连续文本里更早的触发符对"光标现在打的这个词"无意义，见模块顶部注释的举例）。
export function detectComposerTrigger(text: string, cursor: number): ComposerTriggerMatch | null {
  const end = Math.max(0, Math.min(cursor, text.length));
  for (let i = end - 1; i >= 0; i -= 1) {
    const ch = text[i]!;
    if (isTriggerBoundaryChar(ch)) {
      return null;
    }
    if (ch === "@" || ch === "#" || ch === "/") {
      const atLineStart = i === 0;
      const validPosition = ch === "/" ? atLineStart : atLineStart || isTriggerBoundaryChar(text[i - 1]);
      if (!validPosition) {
        return null;
      }
      return {
        kind: TRIGGER_KIND[ch],
        trigger: ch,
        start: i,
        end,
        query: text.slice(i + 1, end)
      };
    }
  }
  return null;
}

// 把 [match.start, match.end) 这段（触发符 + 查询文本）替换成 insertion，光标落在插入内容之后。
export function applyComposerChipInsertion(
  text: string,
  match: Pick<ComposerTriggerMatch, "start" | "end">,
  insertion: string
): { text: string; cursor: number } {
  const nextText = `${text.slice(0, match.start)}${insertion}${text.slice(match.end)}`;
  return { text: nextText, cursor: match.start + insertion.length };
}
