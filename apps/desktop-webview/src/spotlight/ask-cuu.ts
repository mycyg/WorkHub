// WorkHub 桌面 · Spotlight「问问 Cuu」——命令面板无命中时，把用户原话交给服务端一次轻量意图分类
// （POST /api/spotlight/intent，见 apps/api/src/routes/spotlight-intent.ts），按分类结果决定盒子怎么
// 生长：跳到某个已知能力、预填新建项目、走既有任务创建路径，或者盒内直接给一段回答。
// 本文件是纯逻辑（无 DOM），高度可单测；controller.ts 负责把这里的决策接到真实渲染/事件上。

import { escapeHtml } from "@workhub/web-runtime";

import { commandRegistry, type CommandId } from "../command-palette.js";

// 命令面板无命中时，输入达到这个字数才露出「问问 Cuu」这一行——太短的残词（如正在打字的一两个字）
// 不值得触发一次网络往返+LLM 调用。
export const ASK_CUU_MIN_QUERY_LENGTH = 4;

export type AskCuuConfidence = "high" | "low";

// 与服务端 packages/agent/src/spotlight-intent/schema.ts 的 spotlightIntentResultSchema 同构——客户端
// 这份类型只用于本地判定分支，真正的边界校验在服务端；这里保持宽松（page 只是 string），下游用
// commandRegistry 兜底解析成已知的 CommandId。
export type AskCuuResult =
  | { intent: "open_page"; confidence: AskCuuConfidence; page: string }
  | { intent: "new_project"; confidence: AskCuuConfidence; project_name: string }
  | { intent: "create_task"; confidence: AskCuuConfidence; task_title: string }
  | { intent: "answer"; confidence: AskCuuConfidence; answer_md: string };

export type AskCuuCapability = { id: string; label: string; hint?: string };

// 请求体——与服务端 createSpotlightIntentRequestSchema 对齐（query + 可用能力清单）。
export type AskCuuRequestPayload = { query: string; capabilities: AskCuuCapability[] };

export function buildAskCuuCapabilities(locale: "zh-CN" | "en"): AskCuuCapability[] {
  return commandRegistry.map((command) => ({
    id: command.id,
    label: command.label[locale],
    hint: command.hint[locale]
  }));
}

export function buildAskCuuRequestPayload(query: string, locale: "zh-CN" | "en"): AskCuuRequestPayload {
  return { query: query.trim(), capabilities: buildAskCuuCapabilities(locale) };
}

// ── 结果 → 呈现决策（低把握先确认矩阵） ──────────────────────────────────────────────
//
// 规则（r13-workbench-refinement/00-plan.md 批 S1）：
// - open_page / new_project：high 直接执行 + 事后可撤回条；low 先给确认条，用户点确认才执行。
// - create_task：无论置信度都先给确认条——建任务是比翻页更重的动作，多问一句更稳妥（且它最终会
//   经过既有 intake 澄清流程，这里的确认只是第一道、最轻的一道）。
// - answer：不是一个「动作」，没有确认条，直接盒内展示。
export type AskCuuPresentation =
  | { kind: "auto"; commandId: CommandId; understoodText: string }
  | { kind: "confirm_open_page"; commandId: CommandId; understoodText: string }
  | { kind: "auto_new_project"; understoodText: string }
  | { kind: "confirm_new_project"; understoodText: string }
  | { kind: "confirm_create_task"; taskTitle: string; understoodText: string }
  | { kind: "answer"; answerMd: string };

function pageLabel(page: string, locale: "zh-CN" | "en"): string {
  return commandRegistry.find((command) => command.id === page)?.label[locale] ?? page;
}

export function decideAskCuuPresentation(result: AskCuuResult, locale: "zh-CN" | "en"): AskCuuPresentation {
  const zh = locale === "zh-CN";
  switch (result.intent) {
    case "open_page": {
      const label = pageLabel(result.page, locale);
      const understoodText = zh ? `Cuu 理解为：打开「${label}」` : `Cuu understood: open "${label}"`;
      const commandId = result.page as CommandId;
      return result.confidence === "high"
        ? { kind: "auto", commandId, understoodText }
        : { kind: "confirm_open_page", commandId, understoodText };
    }
    case "new_project": {
      const understoodText = zh
        ? `Cuu 理解为：新建项目「${result.project_name}」`
        : `Cuu understood: new project "${result.project_name}"`;
      return result.confidence === "high"
        ? { kind: "auto_new_project", understoodText }
        : { kind: "confirm_new_project", understoodText };
    }
    case "create_task": {
      const understoodText = zh
        ? `Cuu 理解为：新建任务「${result.task_title}」`
        : `Cuu understood: new task "${result.task_title}"`;
      return { kind: "confirm_create_task", taskTitle: result.task_title, understoodText };
    }
    case "answer":
      return { kind: "answer", answerMd: result.answer_md };
  }
}

// ── 「问问 Cuu」微状态机（纯 reducer，controller.ts 只负责按状态渲染/触发副作用） ──────────────────

export type AskCuuUiState =
  | { phase: "idle" }
  | { phase: "asking"; query: string }
  | { phase: "presenting"; presentation: AskCuuPresentation }
  | { phase: "error"; message: string };

export type AskCuuAction =
  | { type: "ask"; query: string }
  | { type: "resolved"; presentation: AskCuuPresentation }
  | { type: "failed"; message: string }
  | { type: "dismiss" };

export const initialAskCuuState: AskCuuUiState = { phase: "idle" };

export function askCuuReducer(state: AskCuuUiState, action: AskCuuAction): AskCuuUiState {
  switch (action.type) {
    case "ask":
      return { phase: "asking", query: action.query };
    case "resolved":
      return { phase: "presenting", presentation: action.presentation };
    case "failed":
      return { phase: "error", message: action.message };
    case "dismiss":
      return { phase: "idle" };
    default:
      return state;
  }
}

// ── markdown-lite：不引库，只做「转义 + 换行」——够用即可，answer_md 从模型来，必须先转义再排版。 ──

export function renderAskCuuAnswerHtml(answerMd: string): string {
  return escapeHtml(answerMd).replace(/\n/gu, "<br>");
}
