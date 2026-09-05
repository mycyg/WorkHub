// apps/desktop-webview/src/workbench/drive 的用户可见文案单一来源。
//
// 形状照 deepseek-harness 的 per-package `locales.ts`（MIT, Copyright (c) 2026 DeepSeek）：
// **中文对象是 key 集的事实源**，英文对象用 `satisfies Record<keyof typeof zh, string>` 做
// 编译期对齐——少一个键或多一个键都编译不过，不需要额外的门禁脚本来盯对称性。
//
// 这些字符串原本以 `zh ? "中文" : "English"` 内联在渲染代码里；搬进来时一个字都没改。
// 门禁见 scripts/dev/check-ui-i18n.ts（含汉字的字面量只许住在词典文件里）。

import { normalizeWorkHubLocale, type WorkHubLocale } from "@workhub/contracts";

import {
  loadFailedEn,
  loadFailedRetryEn,
  loadFailedRetryZh,
  loadFailedZh,
  loadingEn,
  loadingZh
} from "../../load-state-copy.js";

const zh = {
  aiDeliverable: "AI 交付",
  backToFiles: "← 返回文件",
  clickAFileToPreviewIt: "点文件查看预览，或打开版本历史。",
  couldnTLoadTheDriveRetry: loadFailedRetryZh("网盘"),
  couldnTLoadVersionHistory: loadFailedZh("版本历史"),
  couldnTRecoverTryAgain: "找回失败，请重试。",
  current: "当前版本",
  deleteFailed: "删除失败",
  deleted: "已删除",
  deletedFilesLandHereRecoverThem: "删除的文件先进这里，可以随时找回",
  download: "下载",
  downloadFailed: "下载失败",
  downloadFullFile: "下载完整文件",
  everyFileKeepsVersionsAutomaticallyAlways: "全部文件自动留版本 · 可回滚",
  history: "版本",
  items: "项",
  largeFileShowingTheFirstPart: "内容较长，仅显示前一部分。",
  loadingPreview: "正在预览…",
  loadingTheDrive: loadingZh("网盘"),
  loadingVersions: loadingZh("版本"),
  moveToTrash: "移到回收站",
  movedToTheRecycleBinRecoverable: "已移到回收站，可在回收站找回。",
  noFilesHereYet: "这里还没有文件",
  openFolder: "打开文件夹",
  preview: "预览",
  previewFailed: "预览失败",
  previewFile: "预览文件",
  recover: "找回",
  recoverThisVersion: "找回这个版本",
  recovered: "已找回。",
  recovering: "找回中…",
  recoveryFailedRetry: "找回失败，请重试",
  recycleBin: "回收站",
  retry: "重试",
  sureClickAgain: "确定？再点一次",
  sureClickAgainToRecover: "确定？再点一次找回",
  theRecycleBinIsEmpty: "回收站是空的",
  thisCreatesANewCurrentVersion: "会把这一版的内容存成一个新的当前版本，原来的版本历史都还在。5 秒内再点一次确认，否则自动取消。",
  thisFileTypeCanTBe: "这类文件暂不支持在线预览，请下载查看。",
  upload: "上传文件",
  uploadFailed: "上传失败",
  uploading: "上传中…",
  versionHistory: "版本历史",
} as const;

const en = {
  aiDeliverable: "AI deliverable",
  backToFiles: "← Back to files",
  clickAFileToPreviewIt: "Click a file to preview it, or open its version history.",
  couldnTLoadTheDriveRetry: loadFailedRetryEn("the drive"),
  couldnTLoadVersionHistory: loadFailedEn("version history"),
  couldnTRecoverTryAgain: "Couldn't recover — try again.",
  current: "Current",
  deleteFailed: "Delete failed",
  deleted: "deleted",
  deletedFilesLandHereRecoverThem: "Deleted files land here — recover them anytime",
  download: "Download",
  downloadFailed: "Download failed",
  downloadFullFile: "Download full file",
  everyFileKeepsVersionsAutomaticallyAlways: "Every file keeps versions automatically — always recoverable",
  history: "History",
  items: "items",
  largeFileShowingTheFirstPart: "Large file — showing the first part.",
  loadingPreview: "Loading preview…",
  loadingTheDrive: loadingEn("the drive"),
  loadingVersions: loadingEn("versions"),
  moveToTrash: "Move to trash",
  movedToTheRecycleBinRecoverable: "Moved to the recycle bin — recoverable there.",
  noFilesHereYet: "No files here yet",
  openFolder: "Open folder",
  preview: "Preview",
  previewFailed: "Preview failed",
  previewFile: "Preview file",
  recover: "Recover",
  recoverThisVersion: "Recover this version",
  recovered: "Recovered.",
  recovering: "Recovering…",
  recoveryFailedRetry: "Recovery failed — retry",
  recycleBin: "Recycle bin",
  retry: "Retry",
  sureClickAgain: "Sure? Click again",
  sureClickAgainToRecover: "Sure? Click again to recover",
  theRecycleBinIsEmpty: "The recycle bin is empty",
  thisCreatesANewCurrentVersion: "This creates a new current version from this content — the rest of the history stays. Click again within 5 seconds to confirm, or it cancels automatically.",
  thisFileTypeCanTBe: "This file type can't be previewed here — download it instead.",
  upload: "Upload",
  uploadFailed: "Upload failed",
  uploading: "Uploading…",
  versionHistory: "Version history",
} as const satisfies Record<keyof typeof zh, string>;

export type DriveCopyKey = keyof typeof zh;

// 第一参数收 `boolean` 是过渡口子：这一层的渲染函数历史上大量以 `zh: boolean` 传语言，
// 把这些签名一起改成 `locale` 是另一件事，不该和「文案搬家」混在一批里。
export function driveT(locale: WorkHubLocale | boolean, key: DriveCopyKey): string {
  const isZh = typeof locale === "boolean" ? locale : normalizeWorkHubLocale(locale) === "zh-CN";
  return (isZh ? zh : en)[key];
}
