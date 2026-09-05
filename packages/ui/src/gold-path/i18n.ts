import {
  normalizeWorkHubLocale as normalizeWorkHubLocaleContract,
  type WorkHubLocale
} from "@workhub/contracts";

export {
  defaultWorkHubLocale,
  normalizeWorkHubLocale,
  workHubLocaleSchema,
  workHubLocaleStorageKey,
  type WorkHubLocale
} from "@workhub/contracts";

export type WorkHubLocaleOption = {
  locale: WorkHubLocale;
  label: string;
  shortLabel: string;
};

export const workHubLocaleOptions = [
  { locale: "zh-CN", label: "中文", shortLabel: "中" },
  { locale: "en-US", label: "English", shortLabel: "EN" }
] as const satisfies WorkHubLocaleOption[];

type ApprovalQueuePageInfo = {
  limit: number;
  offset?: number | undefined;
  returned: number;
  has_more: boolean;
};

export function approvalQueuePageInfoText(
  locale: WorkHubLocale,
  pageInfo: ApprovalQueuePageInfo | undefined,
  counts: Record<string, number>
) {
  if (!pageInfo || (!pageInfo.has_more && counts["pending_total_capped"] !== 1)) {
    return "";
  }
  const returned = Math.max(0, pageInfo?.returned ?? 0);
  const total = counts["pending_total"];
  const hasTotal = typeof total === "number" && Number.isFinite(total) && total > returned;
  const capped = counts["pending_total_capped"] === 1;
  if (locale === "zh-CN") {
    if (capped) {
      return `已显示 ${returned} 条审批，还有更多未展开；总数是当前扫描范围的下限。`;
    }
    return hasTotal
      ? `已显示 ${returned}/${total} 条审批，还有更多未展开。`
      : `已显示 ${returned} 条审批，还有更多未展开。`;
  }
  if (capped) {
    return `Showing ${returned} approvals. More are available; the total is a lower bound from the current scan.`;
  }
  return hasTotal
    ? `Showing ${returned} of ${total} approvals. More approvals are available.`
    : `Showing ${returned} approvals. More approvals are available.`;
}

export type GoldPathCopyKey =
  | "state.idle"
  | "state.thinking"
  | "state.asking_approval"
  | "state.carrying_document"
  | "state.searching_evidence"
  | "state.syncing_files"
  | "state.worried"
  | "state.revision_requested"
  | "state.celebrating"
  | "state.offline"
  | "shell.navTitle"
  | "shell.navAria"
  | "shell.typedApi"
  | "shell.desktopSync"
  | "shell.localeAria"
  | "empty.evidence"
  | "home.kicker"
  | "home.inboxTitle"
  | "home.inboxSummary"
  | "home.emptyTitle"
  | "home.emptySummary"
  | "home.emptyCta"
  | "home.decisionTitle"
  | "home.decisionEmpty"
  | "home.aiWorkingTitle"
  | "home.aiWorkingEmpty"
  | "home.entryTitle"
  | "home.entryText"
  | "home.evidenceTitle"
  | "intake.kicker"
  | "intake.bodyFallback"
  | "intake.recommended"
  | "intake.progressLabel"
  | "intake.otherSummary"
  | "intake.freeTextFallback"
  | "intake.continue"
  | "approvals.kicker"
  | "approvals.emptyTitle"
  | "approvals.reasonFallback"
  | "approvals.pendingTitle"
  | "approvals.pendingUnit"
  | "approvals.slaTitle"
  | "approvals.slaEmpty"
  | "approvals.ruleTitle"
  | "approvals.ruleText"
  | "approvals.factsTitle"
  | "approvals.unrouted"
  | "approvals.detailTitle"
  | "approvals.evidenceTitle"
  | "approvals.evidenceEmpty"
  | "approvals.myActions"
  | "approvals.noSelection"
  | "approvals.diffTitle"
  | "approvals.checksTitle"
  | "approvals.aiTitle"
  | "approvals.benefitTitle"
  | "approvals.conflictsTitle"
  | "approvals.affectedTitle"
  | "approvals.timelineTitle"
  | "approvals.discussionTitle"
  | "approvals.commentsEmpty"
  | "approvals.commentsOverflow"
  | "approvals.commentPlaceholder"
  | "approvals.commentSubmit"
  | "approvals.reasonLabel"
  | "approvals.reasonPlaceholder"
  | "approvals.rememberLabel"
  | "approvals.rememberHelp"
  | "workitem.kicker"
  | "workitem.statusTitle"
  | "workitem.deliverableTitle"
  | "workitem.emptyDeliverable"
  | "workitem.traceTitle"
  | "workitem.openProposal"
  | "workitem.openReplay"
  | "proposal.kicker"
  | "proposal.riskTitle"
  | "proposal.rollbackTitle"
  | "proposal.evidenceTitle"
  | "proposal.evidenceUnit"
  | "proposal.changedTitle"
  | "proposal.checksTitle"
  | "replay.kicker"
  | "replay.title"
  | "replay.empty"
  | "replay.stepFallback"
  | "replay.tokenTitle"
  | "replay.costTitle"
  | "replay.snapshotTitle"
  | "replay.snapshotUnit"
  | "replay.deliverableTitle"
  | "replay.deliverableUnit"
  | "replay.openDeliverable"
  | "replay.previewDeliverable"
  | "replay.restoreDeliverable"
  | "replay.decisionTitle"
  | "replay.decisionUnit"
  | "replay.decisionFallback"
  | "replay.decisionConflict"
  | "replay.decisionMerged"
  | "replay.keepCurrent"
  | "replay.acceptIncoming"
  | "replay.aiFusion"
  | "replay.recommended"
  | "replay.chosen"
  | "replay.noChoice"
  | "replay.patchTitle"
  | "replay.patchChanged"
  | "replay.patchUnchanged"
  | "replay.patchBaseAvailable"
  | "replay.patchBaseMissing"
  | "replay.patchRiskUnknown"
  | "replay.patchRiskLow"
  | "replay.patchRiskReview"
  | "replay.diff3Title"
  | "replay.diff3Auto"
  | "replay.diff3Review"
  | "replay.diff3Current"
  | "replay.diff3Incoming"
  | "replay.diff3Conflict"
  | "replay.diff3Ranges"
  | "replay.structuredPatchTitle"
  | "replay.structuredPatchFields"
  | "replay.structuredPatchChanged"
  | "replay.structuredPatchMissing"
  | "replay.structuredPatchUnknown"
  | "replay.structuredPatchDryRun"
  | "replay.structuredPatchIssues"
  | "cost.kicker"
  | "cost.title"
  | "cost.summary"
  | "cost.tokenTitle"
  | "cost.estimatedTitle"
  | "cost.statusTitle"
  | "cost.statusFallback"
  | "cost.emptyRisks"
  | "cost.emptyBudgets"
  | "cost.emptyModels"
  | "settings.kicker"
  | "settings.title"
  | "settings.summary"
  | "settings.runtimeTitle"
  | "settings.runtimeBody"
  | "settings.desktopTitle"
  | "settings.desktopBody"
  | "settings.costTitle"
  | "settings.costBody"
  | "settings.languageTitle"
  | "settings.languageBody"
  | "boot.web.title"
  | "boot.web.message"
  | "boot.web.errorTitle"
  | "boot.web.errorMessage"
  | "boot.desktop.title"
  | "boot.desktop.message"
  | "boot.desktop.errorTitle"
  | "boot.desktop.errorMessage"
  | "runtime.actionFail"
  | "runtime.optionSelectedPrefix"
  | "runtime.optionSelectedSuffix"
  | "runtime.reason.evidence"
  | "runtime.reason.tone"
  | "runtime.reason.scope"
  | "runtime.reason.format"
  | "runtime.rejectNeedsReason"
  | "runtime.rejectReasonFirst"
  | "runtime.actionPending"
  | "runtime.actionInProgress"
  | "runtime.logoutFailedBody"
  | "runtime.notice.inProgressTitle"
  | "runtime.notice.logoutFailedTitle"
  | "runtime.notice.actionSuccessTitle"
  | "runtime.notice.actionErrorTitle"
  | "runtime.notice.selectionTitle"
  | "runtime.notice.reasonRequiredTitle"
  | "runtime.notice.pendingTitle"
  | "runtime.notice.desktopRequiredTitle"
  | "runtime.notice.desktopRequiredBody"
  | "runtime.notice.mergeConflictTitle"
  | "runtime.notice.mergeConflictBody"
  | "runtime.notice.sseRefreshTitle"
  | "runtime.notice.sseRefreshBody"
  | "runtime.notice.sseDirtyGuardTitle"
  | "runtime.notice.sseDirtyGuardBody"
  | "runtime.notice.sseDirtyGuardAction"
  | "runtime.notice.budgetWarningTitle"
  | "runtime.notice.budgetWarningBody"
  | "runtime.notice.fieldValueRequiredTitle"
  | "runtime.notice.fieldValueRequiredBody"
  | "runtime.notice.intakeOptionRequiredTitle"
  | "runtime.notice.intakeOptionRequiredBody"
  | "runtime.notice.localePersistenceFailedTitle"
  | "runtime.notice.localePersistenceFailedBody";

const goldPathCopy = {
  "zh-CN": {
    "state.idle": "待命",
    "state.thinking": "整理中",
    "state.asking_approval": "等你点一下",
    "state.carrying_document": "带着交付物",
    "state.searching_evidence": "找证据",
    "state.syncing_files": "同步中",
    "state.worried": "需要留意",
    "state.revision_requested": "继续修改",
    "state.celebrating": "完成啦",
    "state.offline": "离线",
    "shell.navTitle": "WorkHub",
    "shell.navAria": "主导航",
    "shell.typedApi": "已连接",
    "shell.desktopSync": "本地同步正常",
    "shell.localeAria": "语言切换",
    "empty.evidence": "没有找到可展示的证据 (´；ω；`)",
    "home.kicker": "今日焦点",
    "home.inboxTitle": "决策收件箱",
    "home.inboxSummary": "AI 替你扛了大半，这儿只留要你拍板的。",
    "home.emptyTitle": "现在没有要你拍板的事 (=^･ω･^=)",
    "home.emptySummary": "需要你拿主意时，AI 会第一时间把事项端到你面前，先安心忙别的吧 (=^･ω･^=)",
    "home.emptyCta": "去提个需求，让 AI 开干 ٩(◜◡◝)۶",
    "home.decisionTitle": "需要你决定",
    "home.decisionEmpty": "暂无",
    "home.aiWorkingTitle": "AI 正在做",
    "home.aiWorkingEmpty": "AI 都忙完啦，歇会儿~ (๑˃ᴗ˂)ﻭ",
    "home.entryTitle": "其余待办",
    "home.entryText": "没有其他待处理项了。",
    "home.evidenceTitle": "支撑证据",
    "intake.kicker": "新任务",
    "intake.bodyFallback": "先点一个选项，我再继续 (=^･ω･^=)",
    "intake.recommended": "AI 推荐",
    "intake.progressLabel": "澄清进度",
    "intake.otherSummary": "其他 / 补充",
    "intake.freeTextFallback": "需要时再补一句。",
    "intake.continue": "继续澄清",
    "approvals.kicker": "审批中心",
    "approvals.emptyTitle": "没有等你点头的事啦 ٩(◜◡◝)۶",
    "approvals.reasonFallback": "这里只放需要你拍板的事，完整看板在后台保留。",
    "approvals.pendingTitle": "待处理",
    "approvals.pendingUnit": " 件",
    "approvals.slaTitle": "截止时间",
    "approvals.slaEmpty": "没有即将超时的审批，节奏稳稳的 (๑˃ᴗ˂)",
    "approvals.ruleTitle": "规则",
    "approvals.ruleText": "打回时请说明原因，AI 会照着继续改。",
    "approvals.factsTitle": "审批事实",
    "approvals.unrouted": "未路由",
    "approvals.detailTitle": "变更详情",
    "approvals.evidenceTitle": "用到的证据",
    "approvals.evidenceEmpty": "这条没有附证据。",
    "approvals.myActions": "你来拍板",
    "approvals.noSelection": "左边选一条，这里看详情 (=^･ω･^=)",
    "approvals.diffTitle": "变更对比",
    "approvals.checksTitle": "合规检查",
    "approvals.aiTitle": "AI 解释与依据",
    "approvals.benefitTitle": "预期收益",
    "approvals.conflictsTitle": "冲突与建议",
    "approvals.affectedTitle": "影响目标",
    "approvals.timelineTitle": "审批流程",
    "approvals.discussionTitle": "相关讨论",
    "approvals.commentsEmpty": "还没有讨论，来说两句 (=^･ω･^=)",
    "approvals.commentsOverflow": "仅显示最新的讨论，较早内容未在此处展开。",
    "approvals.commentPlaceholder": "写下你的看法…",
    "approvals.commentSubmit": "发表",
    "approvals.reasonLabel": "意见说明",
    "approvals.reasonPlaceholder": "可填：补充说明审批理由",
    "approvals.rememberLabel": "以后同类审批自动通过",
    "approvals.rememberHelp": "「同类」指相同动作类型的 AI 变更。这是一条只对你自己生效、持续有效的规则：通过时队列里已有的同类待审会一并通过，之后的也自动通过。",
    "workitem.kicker": "任务详情",
    "workitem.statusTitle": "状态",
    "workitem.deliverableTitle": "交付物",
    "workitem.emptyDeliverable": "暂无",
    "workitem.traceTitle": "AI 工作过程",
    "workitem.openProposal": "查看变更申请",
    "workitem.openReplay": "查看回放",
    "proposal.kicker": "变更申请",
    "proposal.riskTitle": "风险",
    "proposal.rollbackTitle": "回滚",
    "proposal.evidenceTitle": "证据",
    "proposal.evidenceUnit": " 条来源",
    "proposal.changedTitle": "改了什么",
    "proposal.checksTitle": "检查结果",
    "replay.kicker": "执行回放",
    "replay.title": "查看 AI 怎么做的",
    "replay.empty": "关键步骤、证据、快照和成本都在这里。",
    "replay.stepFallback": "记录了一步。",
    "replay.tokenTitle": "Token",
    "replay.costTitle": "估算成本",
    "replay.snapshotTitle": "快照",
    "replay.snapshotUnit": " 个可恢复版本",
    "replay.deliverableTitle": "正式交付物",
    "replay.deliverableUnit": " 份",
    "replay.openDeliverable": "下载",
    "replay.previewDeliverable": "预览",
    "replay.restoreDeliverable": "还原",
    "replay.decisionTitle": "决策记录",
    "replay.decisionUnit": " 次",
    "replay.decisionFallback": "已记录",
    "replay.decisionConflict": "出现冲突",
    "replay.decisionMerged": "已采纳",
    "replay.keepCurrent": "保留正式版",
    "replay.acceptIncoming": "采纳这次版本",
    "replay.aiFusion": "AI 综合建议",
    "replay.recommended": "推荐",
    "replay.chosen": "已选择",
    "replay.noChoice": "未选择",
    "replay.patchTitle": "改动预览",
    "replay.patchChanged": "有改动",
    "replay.patchUnchanged": "无改动",
    "replay.patchBaseAvailable": "有原始版本",
    "replay.patchBaseMissing": "无原始版本",
    "replay.patchRiskUnknown": "风险未知",
    "replay.patchRiskLow": "低风险",
    "replay.patchRiskReview": "需要复核",
    "replay.diff3Title": "文本合并检查",
    "replay.diff3Auto": "已自动合并",
    "replay.diff3Review": "需逐项确认",
    "replay.diff3Current": "当前版本改动",
    "replay.diff3Incoming": "新版本改动",
    "replay.diff3Conflict": "重叠段",
    "replay.diff3Ranges": "影响行",
    "replay.structuredPatchTitle": "结构化字段检查",
    "replay.structuredPatchFields": "将写入字段",
    "replay.structuredPatchChanged": "声明改动字段",
    "replay.structuredPatchMissing": "缺少字段",
    "replay.structuredPatchUnknown": "额外字段",
    "replay.structuredPatchDryRun": "试运行检查",
    "replay.structuredPatchIssues": "问题",
    "cost.kicker": "成本与预算",
    "cost.title": "预算与成本",
    "cost.summary": "普通成员只看自己的成本，管理员可以看团队汇总。",
    "cost.tokenTitle": "本期用量",
    "cost.estimatedTitle": "估算成本",
    "cost.statusTitle": "预算状态",
    "cost.statusFallback": "ok",
    "cost.emptyRisks": "暂无预算风险",
    "cost.emptyBudgets": "还没有预算记录",
    "cost.emptyModels": "还没有模型用量",
    "settings.kicker": "设置",
    "settings.title": "应用设置",
    "settings.summary": "在这里管理运行、语言和桌面客户端连接；预算与成本在「成本」页查看。桌宠形象在独立的桌宠窗口里设置。",
    "settings.runtimeTitle": "AI 运行",
    "settings.runtimeBody": "模型选择、工具权限和执行记录都统一管理，页面只展示你需要判断的关键信息。",
    "settings.desktopTitle": "桌面客户端",
    "settings.desktopBody": "本地执行、文件同步、托盘和独立桌宠窗口属于桌面客户端，不放进网页里。",
    "settings.costTitle": "预算",
    "settings.costBody": "预算与成本使用独立页面和告警事件，不把成本状态混进看板。",
    "settings.languageTitle": "语言",
    "settings.languageBody": "顶部切换语言会同步页面文字；部分动态内容仍在逐步支持多语言。",
    "boot.web.title": "正在打开 WorkHub",
    "boot.web.message": "正在连接后台服务，加载页面内容。",
    "boot.web.errorTitle": "后台服务还没连上",
    "boot.web.errorMessage": "请先启动 WorkHub 后台服务，再刷新页面。",
    "boot.desktop.title": "正在打开 WorkHub Desktop",
    "boot.desktop.message": "正在连接后台服务，加载页面内容。",
    "boot.desktop.errorTitle": "后台服务还没连上",
    "boot.desktop.errorMessage": "请先启动 WorkHub 后台服务，再刷新桌面窗口。",
    "runtime.actionFail": "动作提交失败，请稍后再试。",
    "runtime.optionSelectedPrefix": "已选择「",
    "runtime.optionSelectedSuffix": "」，AI 会继续推进。",
    "runtime.reason.evidence": "证据不足",
    "runtime.reason.tone": "口吻要改",
    "runtime.reason.scope": "范围太大",
    "runtime.reason.format": "交付格式要改",
    "runtime.rejectNeedsReason": "打回时请说明原因。先选一个原因，AI 会带着它继续改。",
    "runtime.rejectReasonFirst": "先选一个打回原因，AI 会在下一轮带上它继续改。",
    // UI-10：未知/未接线的服务端动作曾静默退化为「处理中」式提示——用户会傻等一个永远不会来的结果。
    // 明确告知「暂未支持」；真实 in-flight 请求走 runtime.actionInProgress（注意两套 key 别混用）。
    "runtime.actionPending": "此动作暂未支持。",
    "runtime.actionInProgress": "正在处理，请稍候，别重复点击。处理结果会在这里提示。",
    "runtime.logoutFailedBody": "网络或服务端出错，退出没有完成——这台设备上的登录可能仍然有效。请检查网络后再试一次；共享设备请务必重试到看到退出成功为止。",
    "runtime.notice.inProgressTitle": "处理中",
    "runtime.notice.logoutFailedTitle": "退出登录失败",
    "runtime.notice.actionSuccessTitle": "已提交",
    "runtime.notice.actionErrorTitle": "提交失败",
    "runtime.notice.selectionTitle": "已记录选择",
    "runtime.notice.reasonRequiredTitle": "需要打回原因",
    "runtime.notice.pendingTitle": "暂不可用",
    "runtime.notice.desktopRequiredTitle": "请在桌面端继续",
    "runtime.notice.desktopRequiredBody": "这个操作需要本地权限或独立窗口，网页端只保留入口和状态。",
    "runtime.notice.mergeConflictTitle": "需要处理冲突",
    "runtime.notice.mergeConflictBody": "这次变更和正式版本撞车了，先选一个处理方式。",
    "runtime.notice.sseRefreshTitle": "页面已刷新",
    "runtime.notice.sseRefreshBody": "有新动态，页面已加载最新数据。",
    "runtime.notice.sseDirtyGuardTitle": "有新更新，已先保留编辑",
    "runtime.notice.sseDirtyGuardBody": "你正在编辑未提交内容，页面不会自动刷新以免丢失选择或输入。",
    "runtime.notice.sseDirtyGuardAction": "手动刷新",
    "runtime.notice.budgetWarningTitle": "预算需要留意",
    "runtime.notice.budgetWarningBody": "成本状态有新变化，页面已重新读取最新预算数据。",
    "runtime.notice.fieldValueRequiredTitle": "需要字段值",
    "runtime.notice.fieldValueRequiredBody": "请先填写自定义字段，空内容不会被提交。",
    "runtime.notice.intakeOptionRequiredTitle": "请先选择一个选项",
    "runtime.notice.intakeOptionRequiredBody": "请先选择一个选项，没选时不会提交。",
    "runtime.notice.localePersistenceFailedTitle": "语言偏好未保存",
    "runtime.notice.localePersistenceFailedBody": "服务端偏好没有更新，页面已保留当前语言。"
  },
  "en-US": {
    "state.idle": "Idle",
    "state.thinking": "Organizing",
    "state.asking_approval": "Waiting for you",
    "state.carrying_document": "Carrying a draft",
    "state.searching_evidence": "Finding evidence",
    "state.syncing_files": "Syncing",
    "state.worried": "Needs attention",
    "state.revision_requested": "Revising",
    "state.celebrating": "Done",
    "state.offline": "Offline",
    "shell.navTitle": "WorkHub",
    "shell.navAria": "Main navigation",
    "shell.typedApi": "Connected",
    "shell.desktopSync": "Local sync OK",
    "shell.localeAria": "Language",
    "empty.evidence": "No evidence is ready to show (´；ω；`)",
    "home.kicker": "AI-first home",
    "home.inboxTitle": "Decision inbox",
    "home.inboxSummary": "AI handles the rest — only decisions that need you land here.",
    "home.emptyTitle": "Nothing needs your call right now (=^･ω･^=)",
    "home.emptySummary": "AI brings work forward the moment your judgment is needed — relax for now (=^･ω･^=)",
    "home.emptyCta": "Start a request — let AI take it ٩(◜◡◝)۶",
    "home.decisionTitle": "Needs your decision",
    "home.decisionEmpty": "Nothing yet",
    "home.aiWorkingTitle": "AI is working",
    "home.aiWorkingEmpty": "AI is all caught up (๑˃ᴗ˂)ﻭ",
    "home.entryTitle": "More in your queue",
    "home.entryText": "Nothing else queued.",
    "home.evidenceTitle": "Supporting evidence",
    "intake.kicker": "New task",
    "intake.bodyFallback": "Pick one option and I will keep going (=^･ω･^=)",
    "intake.recommended": "AI recommends",
    "intake.progressLabel": "clarification progress",
    "intake.otherSummary": "Other / add context",
    "intake.freeTextFallback": "Add a short note only when needed.",
    "intake.continue": "Continue intake",
    "approvals.kicker": "Approval center",
    "approvals.emptyTitle": "Nothing is waiting for your approval ٩(◜◡◝)۶",
    "approvals.reasonFallback": "Only user-blocking items appear here; the full board stays in the background.",
    "approvals.pendingTitle": "Pending",
    "approvals.pendingUnit": " item(s)",
    "approvals.slaTitle": "Due by",
    "approvals.slaEmpty": "No approval is close to timing out — steady pace (๑˃ᴗ˂)",
    "approvals.ruleTitle": "Rule",
    "approvals.ruleText": "Rejected work must include a reason so AI can revise it.",
    "approvals.factsTitle": "Approval facts",
    "approvals.unrouted": "Unrouted",
    "approvals.detailTitle": "Change detail",
    "approvals.evidenceTitle": "Evidence used",
    "approvals.evidenceEmpty": "No evidence attached to this one.",
    "approvals.myActions": "Your call",
    "approvals.noSelection": "Pick an item on the left to see details (=^･ω･^=)",
    "approvals.diffTitle": "Before → after",
    "approvals.checksTitle": "Compliance checks",
    "approvals.aiTitle": "AI rationale",
    "approvals.benefitTitle": "Expected benefit",
    "approvals.conflictsTitle": "Conflicts & suggestions",
    "approvals.affectedTitle": "Affected targets",
    "approvals.timelineTitle": "Approval flow",
    "approvals.discussionTitle": "Discussion",
    "approvals.commentsEmpty": "No discussion yet — say something (=^･ω･^=)",
    "approvals.commentsOverflow": "Showing the latest discussion only. Older comments are not expanded here.",
    "approvals.commentPlaceholder": "Write a comment…",
    "approvals.commentSubmit": "Comment",
    "approvals.reasonLabel": "Your note",
    "approvals.reasonPlaceholder": "Optional: explain your decision",
    "approvals.rememberLabel": "Auto-approve future requests of this type",
    "approvals.rememberHelp": "\"This type\" means AI changes of the same action type. A standing rule for you only: approving also clears queued approvals of this type, and future ones pass automatically.",
    "workitem.kicker": "Work item",
    "workitem.statusTitle": "Status",
    "workitem.deliverableTitle": "Deliverable",
    "workitem.emptyDeliverable": "None yet",
    "workitem.traceTitle": "AI trace preview",
    "workitem.openProposal": "Review change request",
    "workitem.openReplay": "Open replay",
    "proposal.kicker": "Deliverable change request",
    "proposal.riskTitle": "Risk",
    "proposal.rollbackTitle": "Rollback",
    "proposal.evidenceTitle": "Evidence",
    "proposal.evidenceUnit": " source(s)",
    "proposal.changedTitle": "What changed",
    "proposal.checksTitle": "Check results",
    "replay.kicker": "Replay Work",
    "replay.title": "See how AI did it",
    "replay.empty": "Key steps, evidence, snapshots, and cost are shown here.",
    "replay.stepFallback": "Recorded one step.",
    "replay.tokenTitle": "Token",
    "replay.costTitle": "Estimated cost",
    "replay.snapshotTitle": "Snapshot",
    "replay.snapshotUnit": " rollback point(s)",
    "replay.deliverableTitle": "Accepted deliverables",
    "replay.deliverableUnit": " file(s)",
    "replay.openDeliverable": "Download",
    "replay.previewDeliverable": "Preview",
    "replay.restoreDeliverable": "Restore",
    "replay.decisionTitle": "Decision record",
    "replay.decisionUnit": " attempt(s)",
    "replay.decisionFallback": "Recorded",
    "replay.decisionConflict": "Conflict found",
    "replay.decisionMerged": "Accepted",
    "replay.keepCurrent": "Keep accepted version",
    "replay.acceptIncoming": "Accept this version",
    "replay.aiFusion": "AI fusion draft",
    "replay.recommended": "Recommended",
    "replay.chosen": "Chosen",
    "replay.noChoice": "Not chosen",
    "replay.patchTitle": "Change preview",
    "replay.patchChanged": "Changed",
    "replay.patchUnchanged": "Unchanged",
    "replay.patchBaseAvailable": "Base available",
    "replay.patchBaseMissing": "No base",
    "replay.patchRiskUnknown": "Risk unknown",
    "replay.patchRiskLow": "Low risk",
    "replay.patchRiskReview": "Review required",
    "replay.diff3Title": "Text merge check",
    "replay.diff3Auto": "Auto-merged",
    "replay.diff3Review": "Needs line review",
    "replay.diff3Current": "Current hunks",
    "replay.diff3Incoming": "Incoming hunks",
    "replay.diff3Conflict": "Overlaps",
    "replay.diff3Ranges": "Affected lines",
    "replay.structuredPatchTitle": "Structured field check",
    "replay.structuredPatchFields": "Fields to write",
    "replay.structuredPatchChanged": "Declared fields",
    "replay.structuredPatchMissing": "Missing fields",
    "replay.structuredPatchUnknown": "Extra fields",
    "replay.structuredPatchDryRun": "Pre-check",
    "replay.structuredPatchIssues": "Issues",
    "cost.kicker": "Cost governance",
    "cost.title": "Budget and cost",
    "cost.summary": "Regular users see their own slice; managers can open the team view.",
    "cost.tokenTitle": "Current usage",
    "cost.estimatedTitle": "Estimated cost",
    "cost.statusTitle": "Budget status",
    "cost.statusFallback": "ok",
    "cost.emptyRisks": "No budget risks",
    "cost.emptyBudgets": "No budgets yet",
    "cost.emptyModels": "No model usage yet",
    "settings.kicker": "Settings",
    "settings.title": "App settings",
    "settings.summary": "Manage app runtime, language, and desktop connectivity here; budgets and cost live on the Cost page. The pet look is configured and validated only in the independent pet window.",
    "settings.runtimeTitle": "AI runtime",
    "settings.runtimeBody": "Model routing, tool permissions, and execution logs use shared contracts while pages show only decision-ready information.",
    "settings.desktopTitle": "Desktop client",
    "settings.desktopBody": "Local execution, sync folders, tray behavior, and the independent pet window stay in the client layer, not inside Web pages.",
    "settings.costTitle": "Budget",
    "settings.costBody": "Budget and cost use their own page and warning events instead of being mixed into the board.",
    "settings.languageTitle": "Language",
    "settings.languageBody": "The top language switch updates fixed page copy; dynamic content will keep moving onto locale-aware payloads.",
    "boot.web.title": "Opening WorkHub",
    "boot.web.message": "Connecting to the backend service and loading the page.",
    "boot.web.errorTitle": "Backend service is not connected",
    "boot.web.errorMessage": "Start the WorkHub backend service, then refresh this page.",
    "boot.desktop.title": "Opening WorkHub Desktop",
    "boot.desktop.message": "Connecting to the backend service and loading the page.",
    "boot.desktop.errorTitle": "Backend service is not connected",
    "boot.desktop.errorMessage": "Start the WorkHub backend service, then refresh the desktop window.",
    "runtime.actionFail": "Action failed. Please try again later.",
    "runtime.optionSelectedPrefix": "Selected \"",
    "runtime.optionSelectedSuffix": "\". AI will keep going.",
    "runtime.reason.evidence": "Evidence is not enough",
    "runtime.reason.tone": "Tone needs work",
    "runtime.reason.scope": "Scope is too large",
    "runtime.reason.format": "Delivery format needs work",
    "runtime.rejectNeedsReason": "Choose a rejection reason first. AI will use it in the next revision.",
    "runtime.rejectReasonFirst": "Choose a rejection reason first. AI will carry it into the next revision.",
    "runtime.actionPending": "This action isn't supported yet.",
    "runtime.actionInProgress": "Working on it — no need to click again. The result will show up here.",
    "runtime.logoutFailedBody": "A network or server error interrupted sign-out — you may still be signed in on this device. Check your connection and try again; on a shared device, retry until you see it succeed.",
    "runtime.notice.inProgressTitle": "In progress",
    "runtime.notice.logoutFailedTitle": "Sign-out failed",
    "runtime.notice.actionSuccessTitle": "Submitted",
    "runtime.notice.actionErrorTitle": "Submission failed",
    "runtime.notice.selectionTitle": "Selection saved",
    "runtime.notice.reasonRequiredTitle": "Reason required",
    "runtime.notice.pendingTitle": "Not available yet",
    "runtime.notice.desktopRequiredTitle": "Continue in Desktop",
    "runtime.notice.desktopRequiredBody": "This action needs local permissions or a separate window, so Web keeps only the entry point and status.",
    "runtime.notice.mergeConflictTitle": "Resolve the conflict",
    "runtime.notice.mergeConflictBody": "This change conflicts with the current version. Choose how to continue.",
    "runtime.notice.sseRefreshTitle": "Page refreshed",
    "runtime.notice.sseRefreshBody": "A background event arrived, and this page has reloaded the latest data.",
    "runtime.notice.sseDirtyGuardTitle": "New update held while you edit",
    "runtime.notice.sseDirtyGuardBody": "This page kept your unsaved choices or input instead of refreshing automatically.",
    "runtime.notice.sseDirtyGuardAction": "Refresh manually",
    "runtime.notice.budgetWarningTitle": "Budget needs attention",
    "runtime.notice.budgetWarningBody": "Cost status changed, and this page has reloaded the latest budget data.",
    "runtime.notice.fieldValueRequiredTitle": "Field value required",
    "runtime.notice.fieldValueRequiredBody": "Enter a custom field value first. Web will not submit an empty advanced edit.",
    "runtime.notice.intakeOptionRequiredTitle": "Choose an option first",
    "runtime.notice.intakeOptionRequiredBody": "Intake stays option-first, so Web will not submit an empty clarification.",
    "runtime.notice.localePersistenceFailedTitle": "Language preference was not saved",
    "runtime.notice.localePersistenceFailedBody": "The server preference did not update, so this page kept the current language."
  }
} as const satisfies Record<WorkHubLocale, Record<GoldPathCopyKey, string>>;

export function goldPathT(locale: unknown, key: GoldPathCopyKey): string {
  return goldPathCopy[normalizeWorkHubLocaleContract(locale)][key];
}
