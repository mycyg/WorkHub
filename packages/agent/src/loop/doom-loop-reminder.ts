/**
 * R26 批 B6 —— 重复动作「先劝再断」的档位与提醒话术。
 *
 * ## 来源与许可
 *
 * 设计借鉴 deepseek-harness（dsh）的 `packages/guard/repeat-tool-reminder`，
 * 该项目以 **MIT License** 发布（记法先例见 `packages/agent/src/loop2/NOTICE.md`）。
 * 这里**没有复制它的源码**（本工作树没有 `reference/deepseek-harness/`），借的是它的三条做法：
 *
 *  1. **观察不否决**：计数与提醒都不改变工具执行结果，也不中止这一步；只往对话里追加一条提醒。
 *  2. **三档阈值 [3, 5, 8]**：第一档温和一句，第二档报工具名 + 连续步数 + 规范化参数预览，
 *     第三档才升级交给人。
 *  3. **预览截断、指纹不截断**：参数预览截到 500 字符只是为了少占上下文；判定重复用的指纹
 *     永远走全串（见 `control.ts` 的 `fingerprintAssistantBlocks`）。
 *
 * 落地方式与 dsh 不同：dsh 把提醒挂在工具决策的 `additionalContexts` 上，我们没有这条管道，
 * 改为由两套引擎各自往对话里追加一条 user 消息（`loop/loop.ts` 与 `loop2/config-builder.ts`）。
 * dsh 还有「用户插话即重置计数」，AgentRun 跑起来之后没有人插话这回事，因此不实现。
 *
 * ## 为什么话术要被 golden 钉住
 *
 * 这三档文本会原样进入模型上下文，属于 AGENTS.md 纪律条里的「模型可见文本」：
 * 改一个标点都可能改变模型的后续行为。渲染函数因此写成不读时钟、不读环境的纯函数，
 * 由 `packages/agent/src/golden/loop-reminder.golden.test.ts` 逐字节钉住。
 */
import type { AgentAssistantBlock } from "./types.js";

/** 重复形态：每步完全相同 / 两步一循环来回切换。 */
export type DoomLoopShape = "identical" | "alternating";

/** 档位：1=温和提醒，2=详细提醒，3=升级交人。 */
export type DoomLoopTier = 1 | 2 | 3;

/** 三档阈值（连续重复步数），必须单调递增。 */
export type DoomLoopTierThresholds = readonly [number, number, number];

/**
 * 阈值相对「判定窗口」的偏移。窗口默认 3（`AgentLoopBudget.doomLoopWindow`），
 * 因此默认三档正好是 [3, 5, 8]；把窗口调大时三档整体平移，不会出现「窗口还没开始判定，
 * 阈值就已经越过」的错位。
 */
export const DOOM_LOOP_TIER_OFFSETS: readonly [number, number, number] = [0, 2, 5];

/** 由判定窗口推出三档阈值。 */
export function doomLoopTiersForWindow(windowSize: number): DoomLoopTierThresholds {
  return [
    windowSize + DOOM_LOOP_TIER_OFFSETS[0],
    windowSize + DOOM_LOOP_TIER_OFFSETS[1],
    windowSize + DOOM_LOOP_TIER_OFFSETS[2]
  ];
}

/** 默认三档阈值：连续 3 步温和提醒、5 步详细提醒、8 步升级。 */
export const DEFAULT_DOOM_LOOP_TIERS: DoomLoopTierThresholds = doomLoopTiersForWindow(3);

/** 单个动作的参数预览字符上限。指纹不受它影响（指纹用全串）。 */
export const DOOM_LOOP_ARGUMENTS_PREVIEW_CHARS = 500;

/** 第三档（升级）时写进 StructuredHandoff 的原因。两套引擎共用。 */
export const DOOM_LOOP_ESCALATION_REASON = "连续多步执行了相同动作，已自动升级。";

/** 一步里被重复执行的动作摘要（工具名 + 规范化参数预览）。 */
export type DoomLoopAction = {
  /** 该步调用的工具名，按调用顺序去重。没有工具调用时为空数组。 */
  toolNames: string[];
  /** 该步的规范化参数预览，已截到 DOOM_LOOP_ARGUMENTS_PREVIEW_CHARS。没有工具调用时为空串。 */
  preview: string;
};

/** DoomLoopDetector 命中后交给循环消费的信号。 */
export type DoomLoopSignal = {
  /** 触发这次判定的指纹（沿用加档位之前 push() 的返回值语义）。 */
  signature: string;
  tier: DoomLoopTier;
  /** 连续重复的步数：全同形态=同指纹连续步数；交替形态=构成 A-B-A-B 的连续步数。 */
  repeats: number;
  shape: DoomLoopShape;
  /** 参与重复的动作：全同形态 1 条；交替形态 2 条（按一个周期内的先后顺序）。 */
  actions: DoomLoopAction[];
};

/** 命中某档需要的连续步数是否已达到；未达第一档返回 null。 */
export function resolveDoomLoopTier(repeats: number, tiers: DoomLoopTierThresholds): DoomLoopTier | null {
  if (repeats >= tiers[2]) {
    return 3;
  }
  if (repeats >= tiers[1]) {
    return 2;
  }
  if (repeats >= tiers[0]) {
    return 1;
  }
  return null;
}

/**
 * 确定性 JSON：对象键排序后序列化，因此属性顺序不同的同一份参数渲染结果相同
 * （与 `control.ts` 的 canonical 同口径，但这里**不做** 500 字符的哈希折叠——
 * 那是指纹的做法，预览要的是人和模型都读得懂的原文）。
 */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function truncatePreview(text: string): string {
  if (text.length <= DOOM_LOOP_ARGUMENTS_PREVIEW_CHARS) {
    return text;
  }
  return `${text.slice(0, DOOM_LOOP_ARGUMENTS_PREVIEW_CHARS)}…（后续 ${text.length - DOOM_LOOP_ARGUMENTS_PREVIEW_CHARS} 个字符未显示）`;
}

/** 把一步的 assistant 块压成动作摘要，供档位提醒引用。纯文本步（无工具调用）返回空摘要。 */
export function summarizeDoomLoopAction(blocks: AgentAssistantBlock[]): DoomLoopAction {
  const toolCalls = blocks.filter(
    (block): block is Extract<AgentAssistantBlock, { type: "tool_use" }> => block.type === "tool_use"
  );
  const toolNames: string[] = [];
  for (const call of toolCalls) {
    if (!toolNames.includes(call.name)) {
      toolNames.push(call.name);
    }
  }
  const preview = truncatePreview(toolCalls.map((call) => `${call.name}(${stableStringify(call.input)})`).join("\n"));
  return { toolNames, preview };
}

const SOURCE_NOTE = "这条提醒由运行环境自动发出，不是人发给你的话，不用回复它。";

function shapePhrase(shape: DoomLoopShape): string {
  return shape === "identical" ? "重复同一个动作" : "在两个动作之间来回切换";
}

function toolsLabel(shape: DoomLoopShape): string {
  return shape === "identical" ? "重复的工具" : "来回切换的工具";
}

function mergedToolNames(actions: DoomLoopAction[]): string[] {
  const names: string[] = [];
  for (const action of actions) {
    for (const name of action.toolNames) {
      if (!names.includes(name)) {
        names.push(name);
      }
    }
  }
  return names;
}

/**
 * 渲染某一档的提醒正文。第三档不产生提醒（走升级），调用方不应该拿 tier 3 来渲染；
 * 真传进来时按第二档渲染并在结尾说明已经升级，好过抛错把整条运行搞崩。
 */
export function buildDoomLoopReminder(signal: DoomLoopSignal): string {
  const lines: string[] = [];
  const names = mergedToolNames(signal.actions);
  const previews = signal.actions.map((action) => action.preview).filter((preview) => preview.length > 0);
  if (signal.tier === 1) {
    lines.push(
      `[自动提醒] 你已经连续 ${signal.repeats} 步${shapePhrase(signal.shape)}，结果没有变化。先判断这条路是不是走不通，再决定继续还是换一种做法。`
    );
    lines.push(SOURCE_NOTE);
    return lines.join("\n");
  }
  lines.push(`[自动提醒] 你已经连续 ${signal.repeats} 步${shapePhrase(signal.shape)}，结果仍然没有变化。`);
  if (names.length > 0) {
    lines.push(`${toolsLabel(signal.shape)}：${names.join("、")}`);
  }
  lines.push(`连续步数：${signal.repeats}`);
  if (previews.length > 0) {
    lines.push(`调用参数（每条最多显示 ${DOOM_LOOP_ARGUMENTS_PREVIEW_CHARS} 个字符）：`);
    lines.push(previews.join("\n"));
  }
  lines.push(
    "请换一种做法：改用别的工具或参数、先核对这一步的前提是否成立，或者直接说明为什么必须重复这一步。若继续这样重复，这次执行会被自动中止并转交给人处理。"
  );
  lines.push(SOURCE_NOTE);
  return lines.join("\n");
}
