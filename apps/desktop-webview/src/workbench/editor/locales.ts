// apps/desktop-webview/src/workbench/editor 的用户可见文案单一来源。
//
// 形状照 deepseek-harness 的 per-package `locales.ts`（MIT, Copyright (c) 2026 DeepSeek）：
// **中文对象是 key 集的事实源**，英文对象用 `satisfies Record<keyof typeof zh, string>` 做
// 编译期对齐——少一个键或多一个键都编译不过，不需要额外的门禁脚本来盯对称性。
//
// 这些字符串原本以 `zh ? "中文" : "English"` 内联在渲染代码里；搬进来时一个字都没改。
// 门禁见 scripts/dev/check-ui-i18n.ts（含汉字的字面量只许住在词典文件里）。

import { normalizeWorkHubLocale, type WorkHubLocale } from "@workhub/contracts";

const zh = {
  approveFirstThenMergeTheSnapshot: "确认通过后再合入交付物，可用快照回滚。",
  approvedOnlyTheDeliverableMergeRemains: "已确认通过，只差合入交付物。",
  approving: "确认中…",
  close: "关闭",
  closeEditor: "关闭编辑器",
  collapseUnchanged: "收起未变更段落",
  conflict: "有冲突",
  couldnTCompareAgainstThePrevious: "无法比对改动前的版本（快照已不可读），下面只展示提议后的内容。",
  couldnTOpenTheChangeRetry: "变更没打开，稍后重试",
  couldnTOpenThisFileRetry: "这个文件没打开，稍后重试",
  markApproved: "确认通过",
  merging: "合入中…",
  nextFile: "下一个文件",
  openingTheChange: "正在打开变更…",
  previousFile: "上一个文件",
  requestChanges: "打回修改",
  thatDidnTGoThroughTry: "没提交成功，稍后重试。",
  thisChangeHasNoBodyTo: "这条变更没有可展示的正文。",
  thisChangeHasNoLineComparable: "这条变更没有可逐行对照的文本内容。采纳后可到工作项或网盘查看正式版。",
  thisChangeIsLargeTheLine: "这份变更较大，逐行对照已被截断，仅供参考。",
  thisProposalIsnTYoursTo: "这份提议不归你审（可能不是你的工作区，或已交给别人）。",
  thisProposalSStatusAlreadyChanged: "这份提议的状态已经变了，刷新后再看。",
  tryAgain: "重试",
} as const;

const en = {
  approveFirstThenMergeTheSnapshot: "Approve first, then merge; the snapshot can roll back.",
  approvedOnlyTheDeliverableMergeRemains: "Approved; only the deliverable merge remains.",
  approving: "Approving…",
  close: "Close",
  closeEditor: "Close editor",
  collapseUnchanged: "Collapse unchanged",
  conflict: "Conflict",
  couldnTCompareAgainstThePrevious: "Couldn't compare against the previous version (snapshot unreadable) — showing the proposed content only.",
  couldnTOpenTheChangeRetry: "Couldn't open the change — retry",
  couldnTOpenThisFileRetry: "Couldn't open this file — retry",
  markApproved: "Mark approved",
  merging: "Merging…",
  nextFile: "Next file",
  openingTheChange: "Opening the change…",
  previousFile: "Previous file",
  requestChanges: "Request changes",
  thatDidnTGoThroughTry: "That didn't go through — try again in a moment.",
  thisChangeHasNoBodyTo: "This change has no body to show.",
  thisChangeHasNoLineComparable: "This change has no line-comparable text. After it's merged, view the final version in the work item or drive.",
  thisChangeIsLargeTheLine: "This change is large; the line-by-line diff is truncated.",
  thisProposalIsnTYoursTo: "This proposal isn't yours to review.",
  thisProposalSStatusAlreadyChanged: "This proposal's status already changed — reload to see the latest.",
  tryAgain: "Try again",
} as const satisfies Record<keyof typeof zh, string>;

export type EditorCopyKey = keyof typeof zh;

// 第一参数收 `boolean` 是过渡口子：这一层的渲染函数历史上大量以 `zh: boolean` 传语言，
// 把这些签名一起改成 `locale` 是另一件事，不该和「文案搬家」混在一批里。
export function editorT(locale: WorkHubLocale | boolean, key: EditorCopyKey): string {
  const isZh = typeof locale === "boolean" ? locale : normalizeWorkHubLocale(locale) === "zh-CN";
  return (isZh ? zh : en)[key];
}
