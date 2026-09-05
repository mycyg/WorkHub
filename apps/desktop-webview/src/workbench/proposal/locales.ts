// apps/desktop-webview/src/workbench/proposal 的用户可见文案单一来源。
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
  loadFailedZh,
  loadingEn,
  loadingZh
} from "../../load-state-copy.js";

const zh = {
  addAShortReasonFirst: "先写一句打回说明。",
  approveFirstThenMergeTheSnapshot: "确认通过后再合入交付物，随时能还原到改之前。",
  approvedOnlyTheDeliverableMergeRemains: "已确认通过，只差合入交付物。",
  approving: "确认中…",
  backToArmyPanel: "‹ 返回小队面板",
  changes: "处改动",
  couldnTLoadTheProposal: loadFailedZh("变更申请详情"),
  describeWhatNeedsToChangeCuu: "具体写哪里需要改，Cuu 会带着这段反馈继续修。",
  feedbackForChanges: "打回说明",
  loadingTheProposal: loadingZh("变更申请详情"),
  markApproved: "确认通过",
  mergeDeliverable: "合入交付物",
  merging: "合入中…",
  requestChanges: "打回修改",
  reviewTheSummaryAndChangesBefore: "先看总结和改动，再决定是否采纳。",
  sendFeedback: "发送打回说明",
  sendingBack: "打回中…",
  summary: "总结",
  thatDidnTGoThroughTry: "没提交成功，稍后重试。",
  thisChangeConflictsWithSomeoneElse: "这份变更和别人的改动冲突了，得先在审批工作台里逐个处理冲突再合入。",
  thisProposalIsnTYoursTo: "这份提议不归你审（可能不是你的工作区，或已交给别人）。",
  thisProposalSStatusAlreadyChanged: "这份提议的状态已经变了（可能别人刚处理过），刷新后再看。",
  tryAgain: "重试",
} as const;

const en = {
  addAShortReasonFirst: "Add a short reason first.",
  approveFirstThenMergeTheSnapshot: "Approve first, then merge — you can always restore the version from before.",
  approvedOnlyTheDeliverableMergeRemains: "Approved; only the deliverable merge remains.",
  approving: "Approving…",
  backToArmyPanel: "‹ Back to the squad panel",
  changes: "changes",
  couldnTLoadTheProposal: loadFailedEn("the change request"),
  describeWhatNeedsToChangeCuu: "Describe what needs to change; Cuu will revise with this feedback.",
  feedbackForChanges: "Feedback for changes",
  loadingTheProposal: loadingEn("the change request"),
  markApproved: "Mark approved",
  mergeDeliverable: "Merge deliverable",
  merging: "Merging…",
  requestChanges: "Request changes",
  reviewTheSummaryAndChangesBefore: "Review the summary and changes before deciding.",
  sendFeedback: "Send feedback",
  sendingBack: "Sending back…",
  summary: "Summary",
  thatDidnTGoThroughTry: "That didn't go through — try again in a moment.",
  thisChangeConflictsWithSomeoneElse: "This change conflicts with someone else's edits — resolve them in the approvals workspace before merging.",
  thisProposalIsnTYoursTo: "This proposal isn't yours to review — it may be in another workspace, or handed to someone else.",
  thisProposalSStatusAlreadyChanged: "This proposal's status already changed (someone may have just handled it) — reload to see the latest.",
  tryAgain: "Try again",
} as const satisfies Record<keyof typeof zh, string>;

export type ProposalCopyKey = keyof typeof zh;

// 第一参数收 `boolean` 是过渡口子：这一层的渲染函数历史上大量以 `zh: boolean` 传语言，
// 把这些签名一起改成 `locale` 是另一件事，不该和「文案搬家」混在一批里。
export function proposalT(locale: WorkHubLocale | boolean, key: ProposalCopyKey): string {
  const isZh = typeof locale === "boolean" ? locale : normalizeWorkHubLocale(locale) === "zh-CN";
  return (isZh ? zh : en)[key];
}
