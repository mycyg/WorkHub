/**
 * 第三方文本进「模型可见通道」前的中和与上限——一份纯函数，供 plugin-host（工具描述符文案、
 * 工具执行结果）与后续 `packages/mcp-client`（R25 M1，规格见 M-MCP 客户端设计 4.2「共享一小块」）
 * 共用同一套判断，而不是各包各写一份、口径慢慢漂移。
 *
 * 背景（R25 M-MCP 客户端设计 4.4 安全 第 2 条、5.2 插件那侧的同源缺口）：
 * 工具执行结果是不可信数据。它本身进的是 `tool_result` 消息（不在我们自己的围栏标签里），
 * 但常被工人原样抄进 `outputs/` 与自述，而那两条确实会被 `packages/agent/src/loop/loop.ts`
 * 的 `fenced()` / `collectOutputExcerpts` 装进围栏——一段字面的 `</outputs>` 就能提前闭合
 * 围栏、伪造其它围栏冒充指令，击穿只信自己写出的定界符这条假设。中和成本 O(len)，
 * 堵的正是这条二段式逃逸；这与工具描述符文案（也是第三方给的、也会被喂进模型可见通道）
 * 是同一类风险，因此中和与截断收在一处。
 *
 * 长度上限防的是另一件事：第三方（插件 / MCP 服务器）想返回多少内容就是多少，不设上限的话
 * 一次调用就能把 agent 宿主内存、审计日志、快照全部撑爆——与 `file-tools.ts` 的 `read_file`
 * 2MB 上限（"超过 cap 只读前 cap 字节并标 [truncated]（这是唯一没有预算约束的 ingest 路径）"）
 * 是同一个判断，只是这里的口径是「任意第三方文本」而不是「沙箱内一个文件」。默认上限即照那个
 * 先例的数值取值（见 {@link DEFAULT_MODEL_FACING_TEXT_MAX_CHARS}），需要更紧的上限（工具执行
 * 结果、MCP `content[]`）的调用方显式传 `maxChars` 覆盖。
 *
 * ## 围栏标签清单为什么在这里有一份拷贝
 *
 * 围栏标签登记表的单一事实源是 `packages/agent/src/loop/loop.ts` 的 `FENCE_TAG_NAMES`
 * （该文件头部注释："所有『把不可信内容夹进围栏』的拼接点……用到的标签名都必须在这里登记，
 * 否则内容里一行字面的 `</tag>` 就能提前闭合围栏"）。`packages/agent` 依赖 `@workhub/tools`
 * （方向已确认：`packages/agent/package.json` 的 dependencies 里有 `@workhub/tools`），
 * 反过来 `packages/tools` 不能依赖 `packages/agent`——这意味着理想状态下应该是 loop.ts
 * 从这里 re-export `FENCE_TAG_NAMES`，把两份表收成一份。R26 M1b 这个工包的文件白名单不包含
 * `packages/agent`，做不了那次迁移，所以退而求其次：本文件的 {@link DEFAULT_FENCE_TAG_NAMES}
 * 是 loop.ts 那份表当前内容的一份快照拷贝，且 `sanitizeModelFacingText` 把标签清单做成
 * 显式参数（`fenceTagNames`）——真正在意口径一致的调用方应显式传入自己持有的清单；
 * 不传时退回这份拷贝。**维护两份表同步是当前的已知负债**，见 Agent Note
 * `.agents/notes/implemented/2026-09-05-mcp-m1b-shared-sanitize.md`。
 */

/** 围栏标签登记表——单一事实源与同步维护义务见文件头注释。 */
export const DEFAULT_FENCE_TAG_NAMES = [
  "outputs",
  "worker_claim",
  "task",
  "acceptance",
  "changes",
  "work_item_context",
  "user_memory",
  "agent_private_memory",
  "task_plan_objective"
] as const;

/** `read_file`（`file-tools.ts` 的 `READ_FILE_MAX_BYTES`）2MB 上限的字符版——没人显式给 `maxChars` 时的兜底。 */
export const DEFAULT_MODEL_FACING_TEXT_MAX_CHARS = 2 * 1024 * 1024;

/**
 * - `tail`：只保留头部，砍到上限后加一个省略号（`sanitizePluginText` 的既有行为，
 *   为了让插件工具描述符文案的中和结果逐字不变，这个口径原样保留)。
 * - `head-tail`：头尾各留一段、中段省略并插入一条说明（新调用方——工具执行结果——的默认档，
 *   措辞风格与 `packages/agent/src/loop/loop.ts` 的 `truncateForContext` 一致：给一条真实
 *   可行的说明而不是「见 trace」这类兜不住的承诺）。
 */
export type ModelFacingTextTruncationStyle = "tail" | "head-tail";

export interface SanitizeModelFacingTextOptions {
  /** 超过此长度（`string.length`，UTF-16 code unit 计数，与仓库里其它 maxChars 口径一致）才截断。缺省 {@link DEFAULT_MODEL_FACING_TEXT_MAX_CHARS}。 */
  maxChars?: number;
  /** 截断风格，见 {@link ModelFacingTextTruncationStyle}。缺省 `"head-tail"`。 */
  truncation?: ModelFacingTextTruncationStyle;
  /** 去掉 C0 控制字符与 DEL（保留换行/回车/制表）。缺省 `true`。 */
  stripControlChars?: boolean;
  /** 中和围栏标签的尖括号（`<`/`>` → `‹`/`›`），并覆盖 `candidate_\d+` 这类动态标签。缺省 `false`——
   * 不是每个调用方的文本最终都会被装进围栏，强行默认开启会让「行为不变」这条约束没法达成
   * （见插件工具描述符文案调用方：它不进围栏，这里必须保持关闭）。 */
  neutralizeFenceTags?: boolean;
  /** `neutralizeFenceTags` 为 `true` 时使用的标签清单。缺省 {@link DEFAULT_FENCE_TAG_NAMES}。 */
  fenceTagNames?: readonly string[];
}

/**
 * C0 控制字符与 DEL 的字符类。用 `String.fromCharCode` 拼字符类而不是在正则字面量里直接写
 * `\u0000` 这类转义序列——语义与 `to-tool-spec.ts` 旧版 `sanitizePluginText` 用的写法
 * `/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu` 完全一致，只是构造方式不同。
 */
const CONTROL_CHAR_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x00, 0x08],
  [0x0b, 0x0b],
  [0x0c, 0x0c],
  [0x0e, 0x1f],
  [0x7f, 0x7f]
];
function controlCharClassRange(startCode: number, endCode: number): string {
  const start = String.fromCharCode(startCode);
  const end = String.fromCharCode(endCode);
  return startCode === endCode ? start : `${start}-${end}`;
}
const CONTROL_CHAR_PATTERN = new RegExp(
  `[${CONTROL_CHAR_RANGES.map(([startCode, endCode]) => controlCharClassRange(startCode, endCode)).join("")}]`,
  "gu"
);

function fenceTagPattern(tagNames: readonly string[]): RegExp {
  return new RegExp(`<\\/?(?:${tagNames.join("|")}|candidate_\\d+)\\s*>`, "giu");
}

/**
 * 中和围栏标签——与 `packages/agent/src/loop/loop.ts` 的 `neutralizeFenceTags` 同一算法
 * （仅替换被识别为围栏标签 token 的尖括号，普通文本里的 `<`/`>` 不受影响），标签清单由调用方给。
 */
function neutralizeFences(text: string, tagNames: readonly string[]): string {
  const pattern = fenceTagPattern(tagNames);
  return text.replace(pattern, (match) => match.replace(/</gu, "‹").replace(/>/gu, "›"));
}

/**
 * 避免在 UTF-16 代理对（surrogate pair）中间切割字符串——`index` 若落在一个低代理项
 * （U+DC00–U+DFFF）上，说明它紧跟着的高代理项会被劈开，退 1 位把整个字符对留在同一侧。
 * `String.prototype.slice` 本身不会因此抛错，但切出来的半个代理项转 UTF-8 或渲染时会
 * 变成替换字符（U+FFFD）——AGENTS.md 评审规则第 7 条明确要求覆盖多字节边界。
 */
function avoidSplittingSurrogatePair(text: string, index: number): number {
  if (index > 0 && index < text.length) {
    const code = text.charCodeAt(index);
    if (code >= 0xdc00 && code <= 0xdfff) {
      return index - 1;
    }
  }
  return index;
}

function truncateTail(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }
  const end = avoidSplittingSurrogatePair(text, maxChars);
  return `${text.slice(0, end)}…`;
}

function truncateHeadTail(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }
  const headEnd = avoidSplittingSurrogatePair(text, Math.floor(maxChars * 0.75));
  const tailStart = avoidSplittingSurrogatePair(text, text.length - Math.floor(maxChars * 0.15));
  const omitted = Math.max(0, tailStart - headEnd);
  // findings 对齐 loop.ts truncateForContext 的措辞纪律："trace 并不保存被截断的完整内容，
  // 旧文案「完整内容见 trace」是误导"——这里同样只给一条真实可行的路径（让来源返回更小的结果），
  // 不承诺我们没有的能力。中英各一句，供不同语言的模型/人工读者。
  const marker =
    `\n…[已截断：全文共 ${text.length} 字符，此处省略中间 ${omitted} 字符，仅保留首尾；这份内容不会被完整保留，如需全文请让来源返回更小的结果或分批返回。` +
    `Truncated: ${text.length} characters total, ${omitted} omitted from the middle, head and tail kept; the full text is not retained here — ask the source for a smaller or paginated result if you need what's missing.]\n`;
  return `${text.slice(0, headEnd)}${marker}${text.slice(tailStart)}`;
}

/**
 * 第三方文本进模型可见通道前的中和与上限。纯函数、零 IO。
 *
 * @param text 待处理的原始文本。
 * @param options 一个 {@link SanitizeModelFacingTextOptions}，或者作为简写直接传 `maxChars`
 *   数字（其余选项取缺省值）——`sanitizeModelFacingText(desc, 4000)` 这种调用形态见
 *   R25 M-MCP 客户端设计 4.2「逐字段映射表」`description` 一行。
 */
export function sanitizeModelFacingText(
  text: string,
  options: number | SanitizeModelFacingTextOptions = {}
): string {
  const resolved: SanitizeModelFacingTextOptions = typeof options === "number" ? { maxChars: options } : options;
  const {
    maxChars = DEFAULT_MODEL_FACING_TEXT_MAX_CHARS,
    truncation = "head-tail",
    stripControlChars = true,
    neutralizeFenceTags = false,
    fenceTagNames = DEFAULT_FENCE_TAG_NAMES
  } = resolved;
  const safeMaxChars = Math.max(0, maxChars);

  let result = stripControlChars ? text.replace(CONTROL_CHAR_PATTERN, " ") : text;
  if (neutralizeFenceTags) {
    result = neutralizeFences(result, fenceTagNames);
  }
  return truncation === "tail" ? truncateTail(result, safeMaxChars) : truncateHeadTail(result, safeMaxChars);
}
