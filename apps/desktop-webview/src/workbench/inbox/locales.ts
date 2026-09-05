// apps/desktop-webview/src/workbench/inbox 的用户可见文案单一来源。
//
// 形状照 deepseek-harness 的 per-package `locales.ts`（MIT, Copyright (c) 2026 DeepSeek）：
// **中文对象是 key 集的事实源**，英文对象用 `satisfies Record<keyof typeof zh, string>` 做
// 编译期对齐——少一个键或多一个键都编译不过，不需要额外的门禁脚本来盯对称性。
//
// 这些字符串原本以 `zh ? "中文" : "English"` 内联在渲染代码里；搬进来时一个字都没改。
// 门禁见 scripts/dev/check-ui-i18n.ts（含汉字的字面量只许住在词典文件里）。

import { normalizeWorkHubLocale, type WorkHubLocale } from "@workhub/contracts";

const zh = {
  approveAll: "全部通过",
  cancel: "取消",
  decisions: "待拍板",
  everythingWaitingOnYourCallIn: "所有要你拍板的，都汇到这里",
  noneApprovedTheyMayAlreadyBe: "没有审批通过（可能都已被处理）",
  nothingUnderThisFilter: "当前筛选下没有待办。",
  openThisInItsCapabilityIn: "这项要在主窗口里打开",
  thisOneDidnTGoThrough: "批量通过时这条没成功，单独再试一次。",
  working: "处理中…",
} as const;

const en = {
  approveAll: "Approve all",
  cancel: "Cancel",
  decisions: "Decisions",
  everythingWaitingOnYourCallIn: "Everything waiting on your call, in one place",
  noneApprovedTheyMayAlreadyBe: "None approved (they may already be handled)",
  nothingUnderThisFilter: "Nothing under this filter.",
  openThisInItsCapabilityIn: "Open this from the main window",
  thisOneDidnTGoThrough: "This one didn't go through in the batch — try it individually.",
  working: "Working…",
} as const satisfies Record<keyof typeof zh, string>;

export type InboxCopyKey = keyof typeof zh;

// 第一参数收 `boolean` 是过渡口子：这一层的渲染函数历史上大量以 `zh: boolean` 传语言，
// 把这些签名一起改成 `locale` 是另一件事，不该和「文案搬家」混在一批里。
export function inboxT(locale: WorkHubLocale | boolean, key: InboxCopyKey): string {
  const isZh = typeof locale === "boolean" ? locale : normalizeWorkHubLocale(locale) === "zh-CN";
  return (isZh ? zh : en)[key];
}
