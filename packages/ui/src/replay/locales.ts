// 回放页的用户可见文案单一来源（文案 locale 独占门禁：含汉字的字面量只许住在词典文件里，
// 见 scripts/dev/check-ui-i18n.ts）。原本内联在 render.ts 顶部，搬过来时形状一字未改。

import type { WorkHubLocale } from "@workhub/contracts";

type ReplayCopy = Record<WorkHubLocale, string>;

const replayCopy = {
  "replay.kicker": { "zh-CN": "执行回放", "en-US": "Replay Work" },
  "replay.title": { "zh-CN": "查看 AI 怎么做的", "en-US": "See how AI did it" },
  "replay.emptySummary": {
    "zh-CN": "关键步骤、证据、还原点和成本都在这里。",
    "en-US": "Key steps, evidence, restore points and cost are all here."
  },
  "replay.keyStepsTitle": { "zh-CN": "关键步骤", "en-US": "Key steps" },
  "replay.acceptedDeliverablesTitle": { "zh-CN": "正式交付物", "en-US": "Accepted deliverables" },
  "replay.decisionRecordTitle": { "zh-CN": "决策记录", "en-US": "Decision record" },
  "replay.fieldAuditTitle": { "zh-CN": "字段审计", "en-US": "Field audit" },
  "replay.fieldWritebackAuditTitle": { "zh-CN": "字段写回审计", "en-US": "Field writeback audit" },
  "replay.backToWorkItem": { "zh-CN": "← 返回任务", "en-US": "← Back to work item" },
  "replay.railKicker": { "zh-CN": "回放摘要", "en-US": "Replay summary" },
  "replay.tokenTitle": { "zh-CN": "Token 用量", "en-US": "Tokens used" },
  "replay.costTitle": { "zh-CN": "估算成本", "en-US": "Estimated cost" },
  "replay.snapshotTitle": { "zh-CN": "还原点", "en-US": "Restore points" },
  "replay.deliverablePreview": { "zh-CN": "预览", "en-US": "Preview" },
  "replay.deliverableDownload": { "zh-CN": "下载", "en-US": "Download" },
  "replay.deliverableRestore": { "zh-CN": "还原", "en-US": "Restore" },
  "replay.optionKeepCurrent": { "zh-CN": "保留正式版", "en-US": "Keep accepted version" },
  "replay.optionAcceptIncoming": { "zh-CN": "采纳这次版本", "en-US": "Accept this version" },
  "replay.optionAiFusion": { "zh-CN": "AI 融合建议", "en-US": "AI fusion draft" },
  "replay.attemptConflict": { "zh-CN": "出现冲突", "en-US": "Conflict found" },
  "replay.attemptMerged": { "zh-CN": "已采纳", "en-US": "Accepted" },
  "replay.recordedFallback": { "zh-CN": "已记录", "en-US": "Recorded" },
  "replay.decisionKeepCurrent": { "zh-CN": "保留正式版", "en-US": "Kept accepted version" },
  "replay.decisionAcceptIncoming": { "zh-CN": "采纳这次版本", "en-US": "Accepted this version" },
  "replay.decisionAiFusion": { "zh-CN": "采用 AI 融合稿", "en-US": "Used AI fusion draft" },
  "replay.hunkDecisionReplayTitle": { "zh-CN": "逐段选择回放", "en-US": "Hunk decision replay" },
  "replay.hunkAuditRowTitle": { "zh-CN": "重叠段", "en-US": "Overlapping section" },
  "replay.bulkClickedScope": { "zh-CN": "点击范围", "en-US": "Clicked scope" },
  "replay.bulkAcceptedScope": { "zh-CN": "采纳范围", "en-US": "Accepted scope" },
  "replay.bulkResolved": { "zh-CN": "已处理", "en-US": "Resolved" },
  "replay.bulkBlocked": { "zh-CN": "被阻断", "en-US": "Blocked" },
  "replay.bulkActionReplayTitle": { "zh-CN": "批量动作回放", "en-US": "Bulk action replay" },
  "replay.patchPreviewTitle": { "zh-CN": "改动预览", "en-US": "Change preview" },
  "replay.structuredFieldCheckTitle": { "zh-CN": "结构化字段检查", "en-US": "Structured field check" },
  "replay.recommendedBadge": { "zh-CN": "推荐", "en-US": "Recommended" },
  "replay.chosenBadge": { "zh-CN": "已选择", "en-US": "Chosen" },
  "replay.noChoiceLabel": { "zh-CN": "未选择", "en-US": "Not chosen" },
  "replay.conflictAtPrefix": { "zh-CN": "冲突位置", "en-US": "Conflict at" },
  // R20 DSK-UX（R19-3）：改动快照的「撤销此次改动」动作——把文件还原到某个快照。二次确认（武装→再点执行）
  // 沿用仓库既有 5 秒先例（decideRollbackConfirmation/网盘删除），文案键在这里统一，binder 只读 data-* 取字。
  "replay.snapshotListTitle": { "zh-CN": "改动还原点", "en-US": "Restore points" },
  "replay.snapshotListHint": {
    "zh-CN": "撤销会把文件还原到这个还原点，之后的改动会被覆盖；这一步要在桌面客户端做。",
    "en-US": "Undoing restores the files to that point and overwrites later changes; do it in the desktop app."
  },
  "replay.snapshotRevert": { "zh-CN": "撤销此次改动", "en-US": "Undo these changes" },
  "replay.snapshotRevertArm": { "zh-CN": "确认撤销？再点一次", "en-US": "Undo? Click again" },
  "replay.snapshotReverting": { "zh-CN": "撤销中…", "en-US": "Undoing…" },
  "replay.snapshotReverted": { "zh-CN": "已回滚", "en-US": "Reverted" },
  "replay.snapshotRevertRetry": { "zh-CN": "撤销失败，点此重试", "en-US": "Undo failed — retry" },
  "replay.snapshotKindPreStep": { "zh-CN": "执行前", "en-US": "Before the step" },
  "replay.snapshotKindMerge": { "zh-CN": "采纳前", "en-US": "Before adopting" },
  "replay.snapshotKindManual": { "zh-CN": "手动存的", "en-US": "Saved manually" },
  "replay.snapshotKindBase": { "zh-CN": "改动前的原始版本", "en-US": "Original version" },
  // WIRE-07：进行中的 run 在回放页给「中止执行」入口（POST /api/agent-runs/:id/abort）。渲染层只吐
  // 带 data-* 的静态标记，两段式确认与调用都在 web 的 api-action 分发里（armConfirmButton 先例）。
  "replay.abortRun": { "zh-CN": "中止执行", "en-US": "Abort run" }
} satisfies Record<string, ReplayCopy>;

export type ReplayCopyKey = keyof typeof replayCopy;

export function replayT(locale: WorkHubLocale, key: ReplayCopyKey): string {
  return replayCopy[key][locale];
}
