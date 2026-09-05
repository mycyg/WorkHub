// 网页运行时提示（网络/会话/超时/兜底、任务计划与执行开始、澄清与理由卡）的用户可见文案单一来源。
// 文案 locale 独占门禁：含汉字的字面量只许住在词典文件里，见 scripts/dev/check-ui-i18n.ts。

import { normalizeWorkHubLocale, type WorkHubLocale } from "@workhub/ui/gold-path";

const zh = {
  offline: "连不上服务器——请检查网络后重试。",
  sessionExpired: "登录已过期——刷新页面重新登录后再试。",
  requestTimeout: "请求超时了——检查网络后再试一次。",
  requestRejected: "请求没有通过。刷新后再试一次。",
  requestRejectedWithCode: "请求没有通过（{code}）。刷新后再试一次。",
  taskPlanDrafted: "任务计划已生成，请先审阅再开始执行。",
  agentRunQueued: "AI 已开始处理。做出改动或有回放时会提醒你。",
  pickDirectionFirst: "先选一个方向再创建——没选时不会创建。",
  cancel: "取消"
} as const;

const en = {
  offline: "Could not reach the server — check your connection and try again.",
  sessionExpired: "Your session expired — refresh the page to sign in again.",
  requestTimeout: "The request timed out — check your connection and try again.",
  requestRejected: "The request was rejected. Refresh and try again.",
  requestRejectedWithCode: "The request was rejected ({code}). Refresh and try again.",
  taskPlanDrafted: "Task plan drafted. Review the plan before work starts.",
  agentRunQueued: "AI started. You'll be notified when there's a change to review or a replay to watch.",
  pickDirectionFirst: "Pick a direction before creating — nothing is created until you do.",
  cancel: "Cancel"
} as const satisfies Record<keyof typeof zh, string>;

export type NoticeCopyKey = keyof typeof zh;

export function noticeT(locale: WorkHubLocale, key: NoticeCopyKey): string {
  return (normalizeWorkHubLocale(locale) === "zh-CN" ? zh : en)[key];
}

export function noticeTf(locale: WorkHubLocale, key: NoticeCopyKey, vars: Record<string, string>): string {
  return Object.entries(vars).reduce(
    (text, [name, value]) => text.replaceAll(`{${name}}`, value),
    noticeT(locale, key)
  );
}
