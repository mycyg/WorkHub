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
  | "shell.localeAria"
  | "empty.evidence"
  | "home.kicker"
  | "home.emptyTitle"
  | "home.emptySummary"
  | "home.decisionTitle"
  | "home.decisionEmpty"
  | "home.aiWorkingTitle"
  | "home.aiWorkingEmpty"
  | "home.entryTitle"
  | "home.entryText"
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
  | "replay.recommended"
  | "replay.chosen"
  | "replay.noChoice"
  | "cost.kicker"
  | "cost.title"
  | "cost.summary"
  | "cost.tokenTitle"
  | "cost.estimatedTitle"
  | "cost.statusTitle"
  | "cost.statusFallback"
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
  | "runtime.actionPending";

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
    "shell.navTitle": "Gold Path",
    "shell.navAria": "Gold Path",
    "shell.typedApi": "typed API",
    "shell.localeAria": "语言切换",
    "empty.evidence": "没有找到可展示的证据。",
    "home.kicker": "AI-first home",
    "home.emptyTitle": "现在没有阻塞你的事",
    "home.emptySummary": "AI 会在需要你判断时把事项递过来。",
    "home.decisionTitle": "需要你决定",
    "home.decisionEmpty": "暂无",
    "home.aiWorkingTitle": "AI 正在做",
    "home.aiWorkingEmpty": "没有后台运行。",
    "home.entryTitle": "当前入口",
    "home.entryText": "看板只是兜底，主路径从这一件事开始。",
    "intake.kicker": "Option intake",
    "intake.bodyFallback": "先点一个选项，我再继续。",
    "intake.recommended": "AI 推荐",
    "intake.progressLabel": "clarification progress",
    "intake.otherSummary": "其他 / 补充",
    "intake.freeTextFallback": "需要时再补一句。",
    "intake.continue": "继续",
    "approvals.kicker": "Approval center",
    "approvals.emptyTitle": "没有等你点头的事",
    "approvals.reasonFallback": "审批中心只放阻塞用户的事项，完整看板继续下沉。",
    "approvals.pendingTitle": "待处理",
    "approvals.pendingUnit": " 件",
    "approvals.slaTitle": "SLA",
    "approvals.slaEmpty": "没有即将超时的审批。",
    "approvals.ruleTitle": "规则",
    "approvals.ruleText": "打回必须说明原因，AI 会据此继续改。",
    "approvals.factsTitle": "审批事实",
    "approvals.unrouted": "未路由",
    "workitem.kicker": "Work item",
    "workitem.statusTitle": "状态",
    "workitem.deliverableTitle": "交付物",
    "workitem.emptyDeliverable": "暂无",
    "workitem.traceTitle": "AI 轨迹预览",
    "workitem.openProposal": "查看变更申请",
    "workitem.openReplay": "看 AI 怎么做的",
    "proposal.kicker": "Deliverable change request",
    "proposal.riskTitle": "风险",
    "proposal.rollbackTitle": "回滚",
    "proposal.evidenceTitle": "证据",
    "proposal.evidenceUnit": " 条来源",
    "proposal.changedTitle": "改了什么",
    "proposal.checksTitle": "检查结果",
    "replay.kicker": "Replay Work",
    "replay.title": "查看 AI 怎么做的",
    "replay.empty": "关键步骤、证据、快照和成本都在这里。",
    "replay.stepFallback": "记录了一步。",
    "replay.tokenTitle": "Token",
    "replay.costTitle": "估算成本",
    "replay.snapshotTitle": "快照",
    "replay.snapshotUnit": " 个回滚点",
    "replay.deliverableTitle": "正式交付物",
    "replay.deliverableUnit": " 份",
    "replay.openDeliverable": "下载",
    "replay.previewDeliverable": "预览",
    "replay.restoreDeliverable": "还原",
    "replay.decisionTitle": "决策记录",
    "replay.decisionUnit": " 次",
    "replay.decisionFallback": "已记录",
    "replay.decisionConflict": "遇到撞车",
    "replay.decisionMerged": "已采纳",
    "replay.keepCurrent": "保留正式版",
    "replay.acceptIncoming": "采纳这次版本",
    "replay.recommended": "推荐",
    "replay.chosen": "已选择",
    "replay.noChoice": "未选择",
    "cost.kicker": "Cost governance",
    "cost.title": "预算与成本",
    "cost.summary": "普通用户只看个人切片；管理者再看团队视图。",
    "cost.tokenTitle": "本期 token",
    "cost.estimatedTitle": "估算成本",
    "cost.statusTitle": "预算状态",
    "cost.statusFallback": "ok",
    "settings.kicker": "Settings",
    "settings.title": "应用设置",
    "settings.summary": "这里管理应用运行、语言、预算和桌面客户端连接；桌宠形象只在独立桌宠窗口里配置和验收。",
    "settings.runtimeTitle": "AI 运行时",
    "settings.runtimeBody": "模型路由、工具权限和执行日志走统一契约，页面只展示可判断的信息。",
    "settings.desktopTitle": "桌面客户端",
    "settings.desktopBody": "本地执行、同步目录、托盘和独立桌宠窗口属于客户端能力，不嵌入 Web 页面。",
    "settings.costTitle": "预算",
    "settings.costBody": "预算与成本使用独立页面和告警事件，不把成本状态混进看板。",
    "settings.languageTitle": "语言",
    "settings.languageBody": "顶部语言切换会同步页面固定文案；动态内容后续继续接入 locale。",
    "boot.web.title": "正在打开 WorkHub",
    "boot.web.message": "连接 API daemon，读取 P0.5 Gold Path 页面 VM。",
    "boot.web.errorTitle": "API daemon 还没连上",
    "boot.web.errorMessage": "请先启动 WorkHub API daemon，再刷新这个页面。",
    "boot.desktop.title": "正在打开 WorkHub Desktop",
    "boot.desktop.message": "连接 daemon，读取同一份 P0.5 Gold Path 页面 VM。",
    "boot.desktop.errorTitle": "daemon 还没连上",
    "boot.desktop.errorMessage": "请先启动 WorkHub API daemon，再刷新桌面 webview。",
    "runtime.actionFail": "动作提交失败，请稍后再试。",
    "runtime.optionSelectedPrefix": "已选择「",
    "runtime.optionSelectedSuffix": "」，AI 会继续推进。",
    "runtime.reason.evidence": "证据不足",
    "runtime.reason.tone": "口吻要改",
    "runtime.reason.scope": "范围太大",
    "runtime.reason.format": "交付格式要改",
    "runtime.rejectNeedsReason": "打回必须说明原因。先点一个原因，AI 会带着它继续改。",
    "runtime.rejectReasonFirst": "先点一个打回原因，AI 会把它放进下一轮修改。",
    "runtime.actionPending": "这个动作还在等待对应服务接线。"
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
    "shell.navTitle": "Gold Path",
    "shell.navAria": "Gold Path",
    "shell.typedApi": "typed API",
    "shell.localeAria": "Language",
    "empty.evidence": "No evidence is ready to show.",
    "home.kicker": "AI-first home",
    "home.emptyTitle": "Nothing is blocking you right now",
    "home.emptySummary": "AI will bring work forward when your judgment is needed.",
    "home.decisionTitle": "Needs your decision",
    "home.decisionEmpty": "Nothing yet",
    "home.aiWorkingTitle": "AI is working",
    "home.aiWorkingEmpty": "No background run.",
    "home.entryTitle": "Current entry",
    "home.entryText": "The board is fallback only. The main path starts from this one thing.",
    "intake.kicker": "Option intake",
    "intake.bodyFallback": "Pick one option and I will keep going.",
    "intake.recommended": "AI recommends",
    "intake.progressLabel": "clarification progress",
    "intake.otherSummary": "Other / add context",
    "intake.freeTextFallback": "Add a short note only when needed.",
    "intake.continue": "Continue",
    "approvals.kicker": "Approval center",
    "approvals.emptyTitle": "Nothing is waiting for your approval",
    "approvals.reasonFallback": "Only user-blocking items appear here; the full board stays in the background.",
    "approvals.pendingTitle": "Pending",
    "approvals.pendingUnit": " item(s)",
    "approvals.slaTitle": "SLA",
    "approvals.slaEmpty": "No approval is close to timing out.",
    "approvals.ruleTitle": "Rule",
    "approvals.ruleText": "Rejected work must include a reason so AI can revise it.",
    "approvals.factsTitle": "Approval facts",
    "approvals.unrouted": "Unrouted",
    "workitem.kicker": "Work item",
    "workitem.statusTitle": "Status",
    "workitem.deliverableTitle": "Deliverable",
    "workitem.emptyDeliverable": "None yet",
    "workitem.traceTitle": "AI trace preview",
    "workitem.openProposal": "Review change request",
    "workitem.openReplay": "See how AI did it",
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
    "replay.recommended": "Recommended",
    "replay.chosen": "Chosen",
    "replay.noChoice": "Not chosen",
    "cost.kicker": "Cost governance",
    "cost.title": "Budget and cost",
    "cost.summary": "Regular users see their own slice; managers can open the team view.",
    "cost.tokenTitle": "Current tokens",
    "cost.estimatedTitle": "Estimated cost",
    "cost.statusTitle": "Budget status",
    "cost.statusFallback": "ok",
    "settings.kicker": "Settings",
    "settings.title": "App settings",
    "settings.summary": "Manage app runtime, language, budgets, and desktop connectivity here; the pet look is configured and validated only in the independent pet window.",
    "settings.runtimeTitle": "AI runtime",
    "settings.runtimeBody": "Model routing, tool permissions, and execution logs use shared contracts while pages show only decision-ready information.",
    "settings.desktopTitle": "Desktop client",
    "settings.desktopBody": "Local execution, sync folders, tray behavior, and the independent pet window stay in the client layer, not inside Web pages.",
    "settings.costTitle": "Budget",
    "settings.costBody": "Budget and cost use their own page and warning events instead of being mixed into the board.",
    "settings.languageTitle": "Language",
    "settings.languageBody": "The top language switch updates fixed page copy; dynamic content will keep moving onto locale-aware payloads.",
    "boot.web.title": "Opening WorkHub",
    "boot.web.message": "Connecting to the API daemon and loading the P0.5 Gold Path page VM.",
    "boot.web.errorTitle": "API daemon is not connected",
    "boot.web.errorMessage": "Start the WorkHub API daemon, then refresh this page.",
    "boot.desktop.title": "Opening WorkHub Desktop",
    "boot.desktop.message": "Connecting to the daemon and loading the shared P0.5 Gold Path page VM.",
    "boot.desktop.errorTitle": "daemon is not connected",
    "boot.desktop.errorMessage": "Start the WorkHub API daemon, then refresh the desktop webview.",
    "runtime.actionFail": "Action failed. Please try again later.",
    "runtime.optionSelectedPrefix": "Selected \"",
    "runtime.optionSelectedSuffix": "\". AI will keep going.",
    "runtime.reason.evidence": "Evidence is not enough",
    "runtime.reason.tone": "Tone needs work",
    "runtime.reason.scope": "Scope is too large",
    "runtime.reason.format": "Delivery format needs work",
    "runtime.rejectNeedsReason": "Choose a rejection reason first. AI will use it in the next revision.",
    "runtime.rejectReasonFirst": "Choose a rejection reason first. AI will carry it into the next revision.",
    "runtime.actionPending": "This action is still waiting for its service wiring."
  }
} as const satisfies Record<WorkHubLocale, Record<GoldPathCopyKey, string>>;

export function goldPathT(locale: unknown, key: GoldPathCopyKey): string {
  return goldPathCopy[normalizeWorkHubLocaleContract(locale)][key];
}
