// apps/desktop-webview/src/workbench/files 的用户可见文案单一来源。
//
// 形状照 deepseek-harness 的 per-package `locales.ts`（MIT, Copyright (c) 2026 DeepSeek）：
// **中文对象是 key 集的事实源**，英文对象用 `satisfies Record<keyof typeof zh, string>` 做
// 编译期对齐——少一个键或多一个键都编译不过，不需要额外的门禁脚本来盯对称性。
//
// 这些字符串原本以 `zh ? "中文" : "English"` 内联在渲染代码里；搬进来时一个字都没改。
// 门禁见 scripts/dev/check-ui-i18n.ts（含汉字的字面量只许住在词典文件里）。

import { normalizeWorkHubLocale, type WorkHubLocale } from "@workhub/contracts";

const zh = {
  allFiles: "所有文件",
  changed: "变动文件",
  changedProposalManifestChangeSetOpen: "变动 = 提议 manifest 的变更集（待审 / 已合），点文件看逐句对照。",
  couldnTLoadTryAgain: "没拉到，请重试",
  loadingChangedFiles: "正在拉变动文件…",
  loadingDrive: "正在拉网盘…",
  noOpenChangeProposalsInThis: "这个会话还没有开着的变更提议。",
  preview: "预览",
  thisProjectSDriveIsEmpty: "这个项目的网盘还是空的。",
  tryAgain: "重试",
} as const;

const en = {
  allFiles: "All files",
  changed: "Changed",
  changedProposalManifestChangeSetOpen: "Changed = proposal manifest change set; open a file for the line-by-line diff.",
  couldnTLoadTryAgain: "Couldn't load — try again",
  loadingChangedFiles: "Loading changed files…",
  loadingDrive: "Loading drive…",
  noOpenChangeProposalsInThis: "No open change proposals in this conversation yet.",
  preview: "Preview",
  thisProjectSDriveIsEmpty: "This project's drive is empty.",
  tryAgain: "Try again",
} as const satisfies Record<keyof typeof zh, string>;

export type FilesCopyKey = keyof typeof zh;

// 第一参数收 `boolean` 是过渡口子：这一层的渲染函数历史上大量以 `zh: boolean` 传语言，
// 把这些签名一起改成 `locale` 是另一件事，不该和「文案搬家」混在一批里。
export function filesT(locale: WorkHubLocale | boolean, key: FilesCopyKey): string {
  const isZh = typeof locale === "boolean" ? locale : normalizeWorkHubLocale(locale) === "zh-CN";
  return (isZh ? zh : en)[key];
}
