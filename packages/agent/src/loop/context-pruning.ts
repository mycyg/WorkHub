/**
 * R26 批 B10 —— 两段式上下文压缩（第一段：免费剪枝）+ 超大工具结果落盘（spill）。
 *
 * ## 来源与许可
 *
 * 设计借鉴 deepseek-harness（dsh，**MIT License**；记法先例见 `loop2/NOTICE.md`、
 * `loop/doom-loop-reminder.ts`）的 `packages/compaction/compaction-tool-result-pruner`
 * 与 `packages/spill/spill-policy`。**没有复制它的源码**（本工作树没有
 * `reference/deepseek-harness/`），借的是三条做法：
 *
 *  1. **先剪后摘**：压缩触发时先做一次不花钱的工具结果剪枝，重算上下文压力；够了就完全
 *     不发那次摘要请求（我们的摘要走独立计费的 `context_compact` 路由，省下的是真金白银）。
 *  2. **剪枝只在压缩触发时跑**：压力线以下的会话一个字不动——顺序纪律照抄。
 *  3. **保留窗口 + 配对守卫**：最近若干条工具结果不剪（`retainRatio`，dsh 取 0.16）；
 *     剪的是**内容**不是消息，`tool_use` / `tool_result` 的配对结构一个都不动。
 *
 * 落地方式与 dsh 不同：dsh 的 spill 是一个 `SpillStore` 服务缝，我们已经有沙箱文件工具，
 * 所以落盘就写进 run workdir 下的 `.spill/`，模型用现成的 `read_file` 自己去取。
 *
 * ## 为什么这一整个文件都归「模型可见文本」纪律管
 *
 * 剪枝标记、截断标记、spill 定位提示都会**原样进入模型上下文**。按 AGENTS.md 的纪律条，
 * 这类文本改一个标点都要有可见的评审证据，因此这里的渲染函数一律写成不读时钟、不读环境、
 * 不做 IO 的纯函数，由 `packages/agent/src/golden/context-pruning.golden.test.ts` 逐字节钉住。
 * 唯一碰磁盘的是 {@link createSpillWriter}，它只负责写文件并返回路径，文本仍由纯函数渲染。
 *
 * ## 两套引擎共用
 *
 * `loop/loop.ts`（传统循环）与 `loop2/config-builder.ts`（vendored pi）各自只写一层薄适配：
 * 把自己的历史投影成「工具结果文本数组」，调用同一份 {@link planToolResultPruning} /
 * {@link truncateForContext}，再把结果写回去。文本与判定逻辑绝不双份。
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

// ── 参数与默认值 ──────────────────────────────────────────────────────────────

/** 写回对话上下文的单条 `tool_result` 字符上限（`AgentLoopBudget.toolResultContextChars` 的默认值）。 */
export const DEFAULT_TOOL_RESULT_CONTEXT_CHARS = 8000;

/**
 * 第一段剪枝时单条 `tool_result` 的字符预算（默认 2000）。
 *
 * 为什么是 2000 而不是别的数：进入历史的工具结果**已经**被 `truncateForContext` 砍到
 * `toolResultContextChars`（默认 8000），剪枝要想真的腾出空间，预算必须显著更小；2000 与
 * 摘要转写里单条工具结果的上限 `COMPACTION_TRANSCRIPT_TOOL_RESULT_CHARS`（`loop.ts`，同样
 * 参考 pi）同口径——「一条工具结果值得占多少上下文」在本仓库只有这一个答案。
 */
export const DEFAULT_PRUNE_TOOL_RESULT_CHARS = 2000;

/**
 * 保留窗口比例（默认 0.16，取自 dsh 的 `retainRatio`）：历史里最近 `ceil(总数 × 0.16)` 条
 * 工具结果不剪，且至少保留 1 条。
 *
 * 理由：最近那几条结果正是模型当前这一步在推理的东西，剪掉它们等于让模型对刚发生的事失忆，
 * 换来的空间又最少（越老的结果越可能已经没用）。至少 1 条是硬下限——哪怕历史里只有一条工具
 * 结果，也不能把模型刚拿到的输出剪掉。
 */
export const DEFAULT_PRUNE_RETAIN_RATIO = 0.16;

/**
 * 上下文压力估算用的「字符/token」比值。
 *
 * 取 2 是保守值：中文大致 1.5 字符/token、英文大致 3.5–4，取 2 会**高估**英文为主的历史的
 * token 数。高估的后果是「以为还不够、照常发一次摘要请求」，低估的后果是「以为够了、结果撑爆
 * 上下文窗口」——两者代价不对称，所以往贵但安全的一侧取整。
 */
export const CHARS_PER_TOKEN = 2;

/** run workdir 下存放完整工具结果的目录名。 */
export const SPILL_DIR_NAME = ".spill";

/**
 * 单次 run 允许落盘的总字节上限（默认 16 MiB）。
 *
 * 落盘文件位于 workdir 内，因此会计入沙箱字节预算（`sandboxStats` 走整棵树），也会被
 * `pre_step` 全树快照拷贝。超过上限后停止落盘、退回纯截断话术——宁可少一条恢复路径，
 * 也不要让一个疯狂 `run_command` 的运行把快照撑爆。
 */
export const DEFAULT_SPILL_MAX_TOTAL_BYTES = 16 * 1024 * 1024;

/** 截断/剪枝的首尾比例：保留头部 75%、尾部 15%（与 `loop.ts` 既有的截断口径一致）。 */
const HEAD_RATIO = 0.75;
const TAIL_RATIO = 0.15;

// ── 模型可见文本（纯函数，golden 钉住） ────────────────────────────────────────

/**
 * spill 定位提示：截断文本末尾附的两行（中英各一句），告诉模型完整内容在哪、怎么取。
 * 放在**末尾**而不是中段标记里，是为了让第二段剪枝能整体保留它（见 {@link splitSpillHint}）。
 */
export function spillLocatorHint(spillPath: string): string {
  return [
    `[完整内容已保存到 ${spillPath}，需要时用 read_file 读取它]`,
    `[The full output is saved at ${spillPath}; use read_file to read the rest.]`
  ].join("\n");
}

/** 判断某段文本是不是 {@link spillLocatorHint} 生成的定位提示（用于剪枝时整体保留）。 */
function isSpillLocatorHint(text: string): boolean {
  const lines = text.split("\n");
  return (
    lines.length === 2 &&
    lines[0]!.startsWith("[完整内容已保存到 ") &&
    lines[1]!.startsWith("[The full output is saved at ")
  );
}

/**
 * 把一条 `tool_result` 文本拆成「正文 + 末尾的 spill 定位提示」。没有提示时 `hint` 为空串。
 * 剪枝只动正文，提示原样跟回去——否则剪掉定位符就等于把恢复路径也剪没了。
 */
export function splitSpillHint(content: string): { body: string; hint: string } {
  const lines = content.split("\n");
  if (lines.length < 2) {
    return { body: content, hint: "" };
  }
  const candidate = lines.slice(-2).join("\n");
  if (!isSpillLocatorHint(candidate)) {
    return { body: content, hint: "" };
  }
  return { body: lines.slice(0, -2).join("\n"), hint: candidate };
}

/** 首尾截断的公共实现：头 75% + 中段标记 + 尾 15%。`marker` 由调用方按场景渲染。 */
function headTail(content: string, maxChars: number, marker: (omitted: number) => string): string {
  const headChars = Math.floor(maxChars * HEAD_RATIO);
  const tailChars = Math.floor(maxChars * TAIL_RATIO);
  const omitted = content.length - headChars - tailChars;
  return `${content.slice(0, headChars)}\n${marker(omitted)}\n${content.slice(content.length - tailChars)}`;
}

/**
 * 第二段：单条工具结果写回上下文前的截断。
 *
 * - 没落盘（无 workdir / 写失败）：保持既有的纯截断话术。它已经不撒谎——trace 里确实没有存
 *   被截掉的原文，所以给的是一条真能走通的恢复路径（重读该文件或用 run_command 抽取）。
 * - 落了盘：中段标记只说截断事实，**完整内容的位置放在末尾**的定位提示里（中英各一句），
 *   模型可以直接 `read_file` 那个路径把原文取回来。
 */
export function truncateForContext(content: string, maxChars: number, options: { spillPath?: string } = {}): string {
  if (content.length <= maxChars) {
    return content;
  }
  const spillPath = options.spillPath;
  if (!spillPath) {
    return headTail(
      content,
      maxChars,
      (omitted) => `…[已截断 ${omitted} 字符，中段省略；需要完整内容请重读该文件或用 run_command 抽取]`
    );
  }
  return `${headTail(content, maxChars, (omitted) => `…[已截断 ${omitted} 字符，中段省略]`)}\n${spillLocatorHint(spillPath)}`;
}

/** 剪枝标记的固定前缀，同时用于「这条已经剪过了」的判定。 */
export const PRUNE_MARKER_PREFIX = "…[中段已剪枝：";

/**
 * 第一段：剪枝标记。中英各一句，两句都要说清三件事——**被剪了**、**不是原始输出缺失**、
 * **原文在哪**。有 spill 定位提示时指向本条末尾的文件，否则只能诚实地说「重跑那一步」。
 */
export function pruneMarker(omitted: number, hasSpillLocator: boolean): string {
  if (hasSpillLocator) {
    return [
      `…[中段已剪枝：为节省上下文省略 ${omitted} 个字符；这是运行环境删的，不是原始输出缺失。完整内容在本条末尾给出的文件里。]`,
      `…[middle pruned: ${omitted} characters were removed here to save context, not missing from the original output. The full text is in the file named at the end of this result.]`
    ].join("\n");
  }
  return [
    `…[中段已剪枝：为节省上下文省略 ${omitted} 个字符；这是运行环境删的，不是原始输出缺失。需要完整内容请重新执行产生它的那一步。]`,
    `…[middle pruned: ${omitted} characters were removed here to save context, not missing from the original output. Re-run the step that produced it to get the full text.]`
  ].join("\n");
}

/**
 * 把一条工具结果文本剪到 `maxChars`：头 75% + 剪枝标记 + 尾 15%，末尾的 spill 定位提示原样保留。
 * 已经在预算内的文本原样返回（幂等：剪过一次的文本再剪也不会二次加标记，因为它已经在预算内）。
 */
export function pruneToolResultText(content: string, maxChars: number): string {
  const { body, hint } = splitSpillHint(content);
  // 幂等靠标记识别，不靠长度：剪完的文本是「头 + 双语标记 + 尾」，标记本身有几百字符，
  // 结果长度天然会略微超出预算——按长度判会没完没了地一轮轮再剪。
  if (body.length <= maxChars || body.includes(PRUNE_MARKER_PREFIX)) {
    return content;
  }
  const pruned = headTail(body, maxChars, (omitted) => pruneMarker(omitted, hint.length > 0));
  return hint ? `${pruned}\n${hint}` : pruned;
}

// ── 第一段：剪枝计划（纯函数，两套引擎共用） ──────────────────────────────────

export type ToolResultPruningOptions = {
  /** 单条工具结果的剪枝预算，默认 {@link DEFAULT_PRUNE_TOOL_RESULT_CHARS}。 */
  maxChars?: number;
  /** 保留窗口比例，默认 {@link DEFAULT_PRUNE_RETAIN_RATIO}。 */
  retainRatio?: number;
};

export type ToolResultPruningPlan = {
  /** 保留窗口大小：历史末尾这么多条工具结果一个字都不剪。 */
  retainCount: number;
  /** 被剪的条目（下标是传入数组的下标，升序）及剪后文本。 */
  pruned: { index: number; content: string }[];
  /** 本次剪枝一共省下多少字符（剪前后长度差之和）。 */
  prunedChars: number;
};

/**
 * 算出一份剪枝计划：历史里**保留窗口之外**、**超过单条预算**的工具结果全部剪掉中段。
 *
 * 为什么一次剪完而不是「刚好够就停」：剪枝是纯函数、零请求、零成本，留着半截超预算的条目
 * 只会让下一步立刻再触发一次压缩判定。真要省的是摘要那次模型调用，不是剪枝本身。
 *
 * 传入的是**按历史顺序**排列的工具结果文本（越靠前越老）；返回的下标与之一一对应。调用方
 * 只按下标改写文本，不增删消息——`tool_use` / `tool_result` 的配对结构因此天然不变。
 */
export function planToolResultPruning(
  contents: readonly string[],
  options: ToolResultPruningOptions = {}
): ToolResultPruningPlan {
  const maxChars = options.maxChars ?? DEFAULT_PRUNE_TOOL_RESULT_CHARS;
  const retainRatio = options.retainRatio ?? DEFAULT_PRUNE_RETAIN_RATIO;
  const total = contents.length;
  const retainCount = total === 0 ? 0 : Math.max(1, Math.ceil(total * retainRatio));
  const pruned: { index: number; content: string }[] = [];
  let prunedChars = 0;
  for (let index = 0; index < total - retainCount; index += 1) {
    const original = contents[index]!;
    const next = pruneToolResultText(original, maxChars);
    if (next === original) {
      continue;
    }
    pruned.push({ index, content: next });
    prunedChars += original.length - next.length;
  }
  return { retainCount, pruned, prunedChars };
}

// ── 压力重算 ─────────────────────────────────────────────────────────────────

/** 由字符数估算 token 数（保守口径，见 {@link CHARS_PER_TOKEN}）。 */
export function estimateTokensFromChars(chars: number): number {
  return Math.ceil(chars / CHARS_PER_TOKEN);
}

export type PruningDecision = {
  /** 剪枝后估出的上下文 token 数。 */
  estimatedContextTokens: number;
  /** 触发压缩的 token 线（`contextWindowTokens × compactThreshold`）；未配置窗口时为 0。 */
  thresholdTokens: number;
  /** true = 剪枝已经把压力压回线下，这次不发摘要请求。 */
  sufficient: boolean;
};

/**
 * 剪枝之后重算上下文压力，判断还要不要发那次摘要请求。
 *
 * 判定口径有意收紧成两个条件同时成立：
 *  1. **这次剪枝真的剪到了东西**（`prunedChars > 0`）。历史里没有超预算的工具结果时，
 *     剪枝什么也没做，行为必须与加这一段之前逐字一致——照常走摘要。
 *  2. **剪后估算的上下文 token 已经回到压缩线以下**。注意这里量的是「当前历史有多大」，
 *     而触发压缩用的 `usage.totalTokens` 是**整条运行的累计**用量（一个偏早的代理指标）。
 *     只有前者才回答得了「现在还挤不挤」这个问题。
 *
 * 窗口没配置（`contextWindowTokens` 缺省/为 0）时线为 0，永远判不够——保持既有行为。
 */
export function decidePruningSufficient(params: {
  prunedChars: number;
  contextChars: number;
  contextWindowTokens?: number;
  compactThreshold?: number;
}): PruningDecision {
  const estimatedContextTokens = estimateTokensFromChars(params.contextChars);
  const thresholdTokens = Math.floor((params.contextWindowTokens ?? 0) * (params.compactThreshold ?? 0.8));
  const sufficient = params.prunedChars > 0 && thresholdTokens > 0 && estimatedContextTokens < thresholdTokens;
  return { estimatedContextTokens, thresholdTokens, sufficient };
}

// ── 第二段：落盘（唯一碰磁盘的部分） ──────────────────────────────────────────

/**
 * 把完整工具结果写进 `<workdir>/.spill/`，返回模型可见的相对路径（写不成时返回 undefined）。
 * 相对路径直接喂给 `read_file` 即可：沙箱 `safeResolvePath` 以 workdir 为根解析，`.spill/`
 * 在根内，既不越界也不被点号规则排除。
 */
export type SpillWriter = (params: { stepNo: number; toolName: string; content: string }) => Promise<string | undefined>;

/** 文件名安全化：只保留字母数字与 `._-`，其余一律换成下划线。 */
function safeFileSegment(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9._-]/gu, "_").slice(0, 64);
  return cleaned.length > 0 ? cleaned : "tool";
}

/**
 * 建一个 run 级落盘器。
 *
 * - 没有 workdir（单测 / 无沙箱）→ 恒返回 undefined，调用方退回纯截断话术。
 * - 文件名 `<四位步号>-<工具名>.txt`；同一步里同名工具再调用时依次加 `-2`、`-3`
 *   （按调用顺序确定，可复现）。
 * - 总字节超过 `maxTotalBytes` 后停止落盘；任何 IO 错误一律吞掉返回 undefined——
 *   落盘是尽力而为的便利，绝不能因为它挂掉一条运行。
 */
export function createSpillWriter(options: { workdir?: string; maxTotalBytes?: number }): SpillWriter {
  const workdir = options.workdir;
  const maxTotalBytes = options.maxTotalBytes ?? DEFAULT_SPILL_MAX_TOTAL_BYTES;
  const usedNames = new Map<string, number>();
  let writtenBytes = 0;
  let dirReady = false;
  return async ({ stepNo, toolName, content }) => {
    if (!workdir) {
      return undefined;
    }
    const bytes = Buffer.byteLength(content, "utf8");
    if (writtenBytes + bytes > maxTotalBytes) {
      return undefined;
    }
    const base = `${String(stepNo).padStart(4, "0")}-${safeFileSegment(toolName)}`;
    const seen = usedNames.get(base) ?? 0;
    usedNames.set(base, seen + 1);
    const fileName = seen === 0 ? `${base}.txt` : `${base}-${seen + 1}.txt`;
    const relative = `${SPILL_DIR_NAME}/${fileName}`;
    try {
      const dir = path.join(workdir, SPILL_DIR_NAME);
      if (!dirReady) {
        await mkdir(dir, { recursive: true });
        dirReady = true;
      }
      await writeFile(path.join(dir, fileName), content, "utf8");
      writtenBytes += bytes;
      return relative;
    } catch {
      // 磁盘满 / 权限 / 目录被删：退回纯截断话术，运行照常。
      return undefined;
    }
  };
}


// ── 引擎适配层（两套引擎共用同一份计划与判定） ────────────────────────────────

/**
 * 一条可剪枝的工具结果「槽位」：当前文本 + 写回它的方法。
 *
 * 引擎的差别到这里为止：传统 `loop.ts` 的槽位落在 `LlmMessage` 的 `tool_result` 块上，
 * loop2 的落在 pi `ToolResultMessage` 的文本块上。**改的只是槽位里的字符串**，消息本身
 * 一条不增、一条不删、顺序不动——`tool_use` / `tool_result` 的配对因此结构性地不可能被切开。
 */
export type ToolResultSlot = { content: string; write: (next: string) => void };

/**
 * 一段历史的上下文压力投影。两套引擎必须按**同一口径**构造，否则同一段历史会算出不同的压力、
 * 进而在「剪枝够不够」上分叉（shadow-assert 的等价性检查会红）。口径：
 *
 *  - `slots`：所有 `tool_result` 的文本，按历史顺序（越靠前越老）。
 *  - `otherChars`：其余进入模型上下文的文本字符量——纯字符串消息内容、`text` / `thinking`
 *    块的正文、工具调用的名字加上参数的 `JSON.stringify` 长度。**不含**任何 wire 结构本身
 *    （块类型名、id、角色字段），因为那些恰好是两套引擎唯一形状不同的地方。
 */
export type ContextProjection = { slots: ToolResultSlot[]; otherChars: number };

export type ToolResultPruningResult = {
  /** 被剪的工具结果条数。 */
  prunedResults: number;
  /** 剪掉的字符总量。 */
  prunedChars: number;
  /** 剪枝之后这段历史的字符总量（`otherChars` + 剪后所有工具结果文本）。 */
  contextChars: number;
};

/** 按计划就地改写槽位文本，并算出剪后的上下文字符量。 */
export function applyToolResultPruning(
  projection: ContextProjection,
  options: ToolResultPruningOptions = {}
): ToolResultPruningResult {
  const { slots, otherChars } = projection;
  const plan = planToolResultPruning(slots.map((slot) => slot.content), options);
  const contents = slots.map((slot) => slot.content);
  for (const item of plan.pruned) {
    contents[item.index] = item.content;
    slots[item.index]!.write(item.content);
  }
  return {
    prunedResults: plan.pruned.length,
    prunedChars: plan.prunedChars,
    contextChars: contents.reduce((total, content) => total + content.length, 0) + otherChars
  };
}

/** {@link projectWireContext} 需要的最小消息形状（`LlmMessage` 就是这个形状）。 */
export type WireMessage = { role: string; content: unknown };

/** 工具调用参数计入 `otherChars` 的口径：`JSON.stringify` 的长度（不可序列化时退回 String）。 */
function argumentChars(value: unknown): number {
  try {
    return (JSON.stringify(value) ?? "null").length;
  } catch {
    return String(value).length;
  }
}

/**
 * 传统 `loop.ts` 的历史投影：`LlmMessage[]` → {@link ContextProjection}。
 * 口径见 {@link ContextProjection}；loop2 侧的 `projectPiContext` 必须与本函数逐条对齐。
 */
export function projectWireContext(messages: readonly WireMessage[]): ContextProjection {
  const slots: ToolResultSlot[] = [];
  let otherChars = 0;
  for (const message of messages) {
    if (typeof message.content === "string") {
      otherChars += message.content.length;
      continue;
    }
    if (!Array.isArray(message.content)) {
      continue;
    }
    const blocks = message.content as Record<string, unknown>[];
    blocks.forEach((block, blockIndex) => {
      if (!block || typeof block !== "object") {
        return;
      }
      if (block.type === "tool_result" && typeof block.content === "string") {
        slots.push({
          content: block.content,
          write: (next) => {
            blocks[blockIndex] = { ...block, content: next };
          }
        });
        return;
      }
      if ((block.type === "text" || block.type === "thinking") && typeof block.text === "string") {
        otherChars += block.text.length;
        return;
      }
      if (block.type === "tool_use") {
        otherChars += (typeof block.name === "string" ? block.name.length : 0) + argumentChars(block.input);
      }
    });
  }
  return { slots, otherChars };
}
