// 加载态 / 加载失败 / 失败提示的**统一句式**：整个桌面端只在这里写一次。
//
// 背景：这几句话原先在 60 多处词典条目里各写一遍，措辞也各走各的（「正在拉…」「没拉到」
// 「拉不到」是开发口里的 fetch/pull，不是用户语言）。现在各模块词典只提供「加载的是什么」
// 这个主语，句式由本文件给，改一次全端一起变。
//
// 文件名带 `-copy` 后缀，故属于 scripts/dev/check-ui-i18n.ts 认的词典文件——中文文案可以住在这里。

import { normalizeWorkHubLocale, type WorkHubLocale } from "@workhub/contracts";

/** 报错详情在界面上的最长长度：再长就不是「次级信息」而是刷屏了。 */
const DETAIL_MAX = 120;

/** 「正在加载{主语}…」 */
export function loadingZh(subject: string): string {
  return `正在加载${subject}…`;
}

/** `Loading {subject}…` */
export function loadingEn(subject: string): string {
  return `Loading ${subject}…`;
}

/** 「{主语}没加载出来」——用在自带「重试」按钮的错误块里，句子里不再重复一遍重试。 */
export function loadFailedZh(subject: string): string {
  return `${subject}没加载出来`;
}

/** `Couldn't load {subject}` —— for error blocks that already render a retry button. */
export function loadFailedEn(subject: string): string {
  return `Couldn't load ${subject}`;
}

/** 「{主语}没加载出来，稍后重试」——用在没有重试按钮、只能靠用户自己再来一次的地方。 */
export function loadFailedRetryZh(subject: string): string {
  return `${subject}没加载出来，稍后重试`;
}

/** `Couldn't load {subject} — try again` —— for surfaces with no retry affordance. */
export function loadFailedRetryEn(subject: string): string {
  return `Couldn't load ${subject} — try again`;
}

/**
 * 失败提示的组装：**产品文案在前**，原始报错只作为括号里的次级信息。
 *
 * 历史写法是 `error instanceof Error ? error.message : "产品文案"`——真出错时用户看到的
 * 是服务端/网络层的裸英文串，产品文案反而永远不显示。这里反过来：先说发生了什么、
 * 该做什么，技术细节留在后面给愿意截图报障的人。
 *
 * @param locale 语言（收 boolean 是这一层的历史签名，见各 `*T()` 函数）。
 * @param message 已本地化的产品句子。
 * @param error 捕获到的异常，非 Error 或空消息时只返回产品句子。
 */
export function withErrorDetail(locale: WorkHubLocale | boolean, message: string, error: unknown): string {
  const isZh = typeof locale === "boolean" ? locale : normalizeWorkHubLocale(locale) === "zh-CN";
  const raw = error instanceof Error ? error.message.trim() : "";
  if (!raw) return message;
  const detail = raw.length > DETAIL_MAX ? `${raw.slice(0, DETAIL_MAX - 1)}…` : raw;
  return isZh ? `${message}（${detail}）` : `${message} (${detail})`;
}
