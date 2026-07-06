import { normalizeWorkHubLocale, type WorkHubLocale } from "@workhub/contracts";

export type CuuLocaleOptions = {
  locale?: WorkHubLocale | undefined;
};

export type CuuCopyKey =
  | "agentRun.doneTitle"
  | "agentRun.attentionTitle"
  | "agentRun.startedTitle"
  | "agentRun.workingTitle"
  | "agentRun.progressFallback"
  | "agentRun.thinkingStatus"
  | "agentRun.toolCallStatus"
  | "agentRun.toolCallStatusGeneric"
  | "agentRun.toolResultStatus"
  | "agentRun.phase.think"
  | "agentRun.phase.toolCall"
  | "agentRun.phase.toolResult"
  | "agentRun.phase.final"
  | "agentRun.viewReplay"
  | "agentRun.openWorkItem"
  | "agentRun.abort"
  | "agentRun.progressSection"
  | "agentRun.budgetSection"
  | "agentRun.handoffSection"
  | "agentRun.queued"
  | "question.bodyFallback"
  | "question.submit"
  | "question.submitAnswer"
  | "evidence.missingSection"
  | "evidence.titleFound"
  | "evidence.titleDefault"
  | "proposal.changesSection"
  | "proposal.reviewTitle"
  | "proposal.mergeTitle"
  | "proposal.mergeTitleNamed"
  | "proposal.mergeStatus"
  | "proposal.summarySection"
  | "proposal.summaryFallback"
  | "proposal.nextStepSection"
  | "proposal.nextStepOpenReview"
  | "proposal.nextStepOpened"
  | "proposal.nextStepReviewed"
  | "proposal.nextStepMerged"
  | "proposal.nextStepRejected"
  | "proposal.planNextStepOpened"
  | "proposal.planNextStepReviewed"
  | "proposal.openReview"
  | "proposal.openPlanReview"
  | "proposal.approveReview"
  | "proposal.approvePlanReview"
  | "proposal.approvePlanAndStart"
  | "proposal.approvePlanHold"
  | "proposal.startHeldPlan"
  | "proposal.requestChanges"
  | "proposal.requestReplan"
  | "proposal.riskSection"
  | "proposal.rollbackAvailable"
  | "proposal.rollbackUnavailable"
  | "proposal.checksSection"
  | "proposal.checkStatus.passed"
  | "proposal.checkStatus.failed"
  | "proposal.checkStatus.warning"
  | "proposal.checkStatus.skipped"
  | "proposal.conflictTitle"
  | "proposal.conflictOpenProposal"
  | "proposal.conflictKeepCurrent"
  | "proposal.conflictAcceptIncoming"
  | "proposal.conflictAiFusion"
  | "proposal.conflictApplyAiFusion"
  | "proposal.conflictTargetSection"
  | "proposal.conflictVersionSection"
  | "workItem.open"
  | "workItem.openProposal"
  | "workItem.viewReplay"
  | "workItem.startAgent"
  | "workItem.statusSection"
  | "workItem.readyFallback"
  | "workItem.acceptanceSection"
  | "workItem.acceptanceFallback"
  | "workItem.acceptanceStatus.open"
  | "workItem.acceptanceStatus.met"
  | "workItem.acceptanceStatus.unmet"
  | "workItem.acceptanceStatus.waived"
  | "workItem.startedFallback"
  | "budget.scope.workitem"
  | "budget.scope.task"
  | "budget.scope.objective"
  | "budget.scope.user"
  | "budget.scope.team"
  | "budget.scope.curation"
  | "budget.scope.eval"
  | "budget.scopeDesc.workitem"
  | "budget.scopeDesc.task"
  | "budget.scopeDesc.objective"
  | "budget.scopeDesc.user"
  | "budget.scopeDesc.team"
  | "budget.scopeDesc.curation"
  | "budget.scopeDesc.eval"
  | "budget.handle"
  | "budget.view"
  | "budget.exhaustedTitle"
  | "budget.warningTitle"
  | "budget.usageDescription"
  | "cost.summarySection"
  | "cost.risksSection"
  | "cost.total"
  | "cost.input"
  | "cost.output"
  | "cost.remaining"
  | "cost.status.ok"
  | "cost.status.warning"
  | "cost.status.critical"
  | "cost.status.exhausted"
  | "cost.title"
  | "cost.notConnected"
  | "cost.usedToday"
  | "replay.summarySection"
  | "replay.costSection"
  | "replay.title"
  | "replay.readyFallback"
  | "event.defaultTitle"
  | "event.defaultMessage"
  | "offline.retryingTitle"
  | "offline.closedTitle"
  | "offline.retryingMessage"
  | "offline.closedMessage"
  | "offline.retryingChip"
  | "offline.closedChip"
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
  | "notice.prefix"
  | "action.reasonRequired"
  | "action.approved"
  | "action.denied"
  | "action.evidenceFound"
  | "action.noEvidence"
  | "action.evidenceBound"
  | "action.nextQuestion"
  | "cuuStart.title"
  | "cuuStart.message"
  | "cuuStart.documentDraft"
  | "cuuStart.documentDraftDesc"
  | "cuuStart.documentDraftAcceptancePrimary"
  | "cuuStart.documentDraftAcceptanceEvidence"
  | "cuuStart.structuredData"
  | "cuuStart.structuredDataDesc"
  | "cuuStart.structuredDataAcceptancePrimary"
  | "cuuStart.structuredDataAcceptanceEvidence"
  | "cuuStart.codeTemplate"
  | "cuuStart.codeTemplateDesc"
  | "cuuStart.codeTemplateAcceptancePrimary"
  | "cuuStart.codeTemplateAcceptanceSafety"
  | "cuuStart.action"
  | "cuuStart.defaultTitle"
  | "cuuStart.defaultIntent"
  | "cuuStart.placeholder"
  | "cuuStart.analysisTitle"
  | "cuuStart.analysisMessage"
  | "cuuStart.analysisToolIntent"
  | "cuuStart.analysisToolFiles"
  | "cuuStart.analysisToolModel"
  | "cuuStart.analysisPrivacy"
  | "cuuStart.started"
  | "cuuStart.restored"
  | "cuuStart.clarificationNeeded"
  | "cuuStart.unavailable"
  | "cuuStart.reducedMotion"
  | "cuuStart.progressIntent"
  | "cuuStart.progressTask"
  | "cuuStart.progressRun"
  | "cuuStart.streamUpdated"
  | "cuuStart.errorBudgetTitle"
  | "cuuStart.errorBudgetMessage"
  | "cuuStart.errorPermissionTitle"
  | "cuuStart.errorPermissionMessage"
  | "cuuStart.errorOfflineTitle"
  | "cuuStart.errorOfflineMessage"
  | "cuuStart.errorGenericTitle"
  | "cuuStart.errorGenericMessage"
  | "cuuStart.errorRestartMessage"
  | "cuuStart.errorChip.budget"
  | "cuuStart.errorChip.permission"
  | "cuuStart.errorChip.offline"
  | "cuuStart.errorChip.generic"
  | "cuuStart.errorViewReplay"
  | "cuuStart.errorOpenWorkItem"
  | "cuuStart.errorRestartAction"
  | "cuuStart.restartReady"
  | "pet.aria"
  | "pet.windowModeExpanding"
  | "pet.reducedMotionOffline"
  | "pet.selectedWithLabel"
  | "pet.selectedFallback"
  | "pet.optionRequired"
  | "pet.reasonRequired"
  | "pet.reasonDefault"
  | "pet.actionFail"
  | "pet.action.approve"
  | "pet.action.requestChanges"
  | "pet.action.open"
  | "pet.reject.evidence"
  | "pet.reject.scope"
  | "pet.reject.format"
  | "pet.reject.cancel"
  | "pet.evidenceTitle"
  | "pet.evidenceMore"
  | "pet.input.optionWithText"
  | "pet.input.optionOnly"
  | "pet.input.textNeeded"
  | "pet.kind.question"
  | "pet.kind.approval"
  | "pet.kind.proposal"
  | "pet.kind.evidence"
  | "pet.kind.budget"
  | "pet.kind.sync"
  | "pet.kind.trace"
  | "pet.kind.completion"
  | "pet.kind.offline"
  | "pet.kind.bubble"
  | "pet.priority.urgent"
  | "pet.priority.high"
  | "pet.priority.low"
  | "pet.priority.normal"
  | "pet.emotion.idle"
  | "pet.emotion.thinking"
  | "pet.emotion.approval"
  | "pet.emotion.worried"
  | "pet.emotion.celebrating";

const cuuCopy = {
  "zh-CN": {
    "agentRun.doneTitle": "这次执行完成了",
    "agentRun.attentionTitle": "这次执行需要关注",
    "agentRun.startedTitle": "Cuu 开始处理了",
    "agentRun.workingTitle": "Cuu 正在处理",
    "agentRun.progressFallback": "Cuu 正在整理执行进度。",
    "agentRun.thinkingStatus": "AI 正在整理材料，稍后给你下一步。",
    "agentRun.toolCallStatus": "正在调用工具：{tool}",
    "agentRun.toolCallStatusGeneric": "正在调用工具。",
    "agentRun.toolResultStatus": "工具已返回，Cuu 正在整理下一步。",
    "agentRun.phase.think": "AI 正在整理材料",
    "agentRun.phase.toolCall": "工具调用",
    "agentRun.phase.toolResult": "工具已返回",
    "agentRun.phase.final": "完成输出",
    "agentRun.viewReplay": "查看回放",
    "agentRun.openWorkItem": "回到任务",
    "agentRun.abort": "取消执行",
    "agentRun.progressSection": "执行进度",
    "agentRun.budgetSection": "预算",
    "agentRun.handoffSection": "交接",
    "agentRun.queued": "Cuu 已排队，稍后开始处理。",
    "question.bodyFallback": "点一个选项，Cuu 就继续往下做。",
    "question.submit": "确认选项",
    "question.submitAnswer": "提交回答",
    "evidence.missingSection": "缺口",
    "evidence.titleFound": "找到和「{query}」相关的证据",
    "evidence.titleDefault": "Cuu 找到了证据",
    "proposal.changesSection": "这次改了什么",
    "proposal.reviewTitle": "Cuu 等你确认变更",
    "proposal.mergeTitle": "Cuu 等你合入变更",
    "proposal.mergeTitleNamed": "「{title}」待合入",
    "proposal.mergeStatus": "有变更待合入",
    "proposal.summarySection": "总结",
    "proposal.summaryFallback": "变更申请已生成。先看总结和改动，再决定是否合入。",
    "proposal.nextStepSection": "下一步",
    "proposal.nextStepOpenReview": "点「查看变更申请」会打开变更详情，里面有总结、改动和确认按钮。",
    "proposal.nextStepOpened": "先看总结和改动，再确认通过或打回修改。",
    "proposal.nextStepReviewed": "已确认通过，下一步合入交付物。",
    "proposal.nextStepMerged": "已合入正式版本。",
    "proposal.nextStepRejected": "已打回，Cuu 会带着反馈继续修。",
    "proposal.planNextStepOpened": "先确认计划；不满意就打回重拆。",
    "proposal.planNextStepReviewed": "计划已确认，可以开始执行，也可以先暂缓。",
    "proposal.openReview": "查看变更申请",
    "proposal.openPlanReview": "查看计划提议",
    "proposal.approveReview": "确认通过",
    "proposal.approvePlanReview": "确认计划",
    "proposal.approvePlanAndStart": "批准并开始执行",
    "proposal.approvePlanHold": "批准但先不跑",
    "proposal.startHeldPlan": "开始执行计划",
    "proposal.requestChanges": "打回修改",
    "proposal.requestReplan": "打回重拆",
    "proposal.riskSection": "风险与回滚",
    "proposal.rollbackAvailable": "可回滚",
    "proposal.rollbackUnavailable": "不可完整回滚",
    "proposal.checksSection": "检查结果",
    "proposal.checkStatus.passed": "通过",
    "proposal.checkStatus.failed": "未通过",
    "proposal.checkStatus.warning": "有提醒",
    "proposal.checkStatus.skipped": "已跳过",
    "proposal.conflictTitle": "变更撞车了",
    "proposal.conflictOpenProposal": "查看变更申请",
    "proposal.conflictKeepCurrent": "保留正式版",
    "proposal.conflictAcceptIncoming": "合入这次版本",
    "proposal.conflictAiFusion": "AI 融合建议",
    "proposal.conflictApplyAiFusion": "采用 AI 融合稿",
    "proposal.conflictTargetSection": "撞车对象",
    "proposal.conflictVersionSection": "版本选择",
    "workItem.open": "查看任务",
    "workItem.openProposal": "查看变更",
    "workItem.viewReplay": "查看回放",
    "workItem.startAgent": "开始 AI 执行",
    "workItem.statusSection": "当前状态",
    "workItem.readyFallback": "Cuu 已准备继续处理。",
    "workItem.acceptanceSection": "验收",
    "workItem.acceptanceFallback": "验收项 {index}",
    "workItem.acceptanceStatus.open": "待处理",
    "workItem.acceptanceStatus.met": "已满足",
    "workItem.acceptanceStatus.unmet": "未满足",
    "workItem.acceptanceStatus.waived": "已豁免",
    "workItem.startedFallback": "Cuu 开始处理这件事了。",
    "budget.scope.workitem": "任务预算",
    "budget.scope.task": "军团计划预算",
    "budget.scope.objective": "目标预算",
    "budget.scope.user": "个人预算",
    "budget.scope.team": "团队预算",
    "budget.scope.curation": "蒸馏预算",
    "budget.scope.eval": "评测预算",
    "budget.scopeDesc.workitem": "当前任务",
    "budget.scopeDesc.task": "当前任务计划",
    "budget.scopeDesc.objective": "当前目标",
    "budget.scopeDesc.user": "当前用户",
    "budget.scopeDesc.team": "当前团队",
    "budget.scopeDesc.curation": "团队蒸馏范围",
    "budget.scopeDesc.eval": "评测范围",
    "budget.handle": "处理预算",
    "budget.view": "查看预算",
    "budget.exhaustedTitle": "预算用完了",
    "budget.warningTitle": "预算快到线了",
    "budget.usageDescription": "预算使用率",
    "cost.summarySection": "今日成本",
    "cost.risksSection": "预算风险",
    "cost.total": "总成本",
    "cost.input": "输入",
    "cost.output": "输出",
    "cost.remaining": "还剩 ¥{cost}",
    "cost.status.ok": "正常",
    "cost.status.warning": "接近上限",
    "cost.status.critical": "严重",
    "cost.status.exhausted": "已用尽",
    "cost.title": "AI 成本与预算",
    "cost.notConnected": "成本数据还没有接入。",
    "cost.usedToday": "今天已使用 ¥{cost}。",
    "replay.summarySection": "Replay 摘要",
    "replay.costSection": "成本",
    "replay.title": "执行回放已就绪",
    "replay.readyFallback": "Cuu 整理好了这次执行轨迹。",
    "event.defaultTitle": "WorkHub 更新",
    "event.defaultMessage": "Cuu 收到一条新的状态更新。",
    "offline.retryingTitle": "连接有点不稳",
    "offline.closedTitle": "WorkHub 连接断开了",
    "offline.retryingMessage": "Cuu 正在重新连接，恢复后会继续把提醒送到你这里。",
    "offline.closedMessage": "Cuu 会安静等连接回来，重要事项不会被丢掉。",
    "offline.retryingChip": "重连中",
    "offline.closedChip": "已断开",
    "state.idle": "待命",
    "state.thinking": "思考中",
    "state.asking_approval": "等你点选",
    "state.carrying_document": "拿来变更",
    "state.searching_evidence": "找到证据",
    "state.syncing_files": "同步中",
    "state.worried": "需要留意",
    "state.revision_requested": "继续修改",
    "state.celebrating": "完成了",
    "state.offline": "离线",
    "notice.prefix": "Cuu：{title}",
    "action.reasonRequired": "打回需要先选择一个原因。",
    "action.approved": "Cuu 已收到：这步已批准。",
    "action.denied": "Cuu 已带着原因打回，会继续改。",
    "action.evidenceFound": "Cuu 找到了一组项目证据。",
    "action.noEvidence": "这张证据卡里没有可绑定的证据。",
    "action.evidenceBound": "Cuu 已把这些证据放进当前任务。",
    "action.nextQuestion": "下一题：{title}",
    "cuuStart.title": "要让 Cuu 做什么？",
    "cuuStart.message": "先写一句真实需求，Cuu 会结合项目文件反问关键点，再创建事项执行。",
    "cuuStart.documentDraft": "文档/方案草稿",
    "cuuStart.documentDraftDesc": "周报、说明、PR 式变更说明",
    "cuuStart.documentDraftAcceptancePrimary": "输出可审阅的文档或方案草稿，包含结构、正文和后续修改点。",
    "cuuStart.documentDraftAcceptanceEvidence": "标明依据、假设和待确认内容，不把未确认内容写成事实。",
    "cuuStart.structuredData": "结构化数据",
    "cuuStart.structuredDataDesc": "JSON、YAML、CSV、配置",
    "cuuStart.structuredDataAcceptancePrimary": "输出结构化文件或表格，包含字段说明、样例和校验方式。",
    "cuuStart.structuredDataAcceptanceEvidence": "保留数据来源、转换规则和异常项说明。",
    "cuuStart.codeTemplate": "小型代码/模板",
    "cuuStart.codeTemplateDesc": "低风险片段、模板、配置改动",
    "cuuStart.codeTemplateAcceptancePrimary": "输出可运行的小型代码或模板，包含入口、使用说明和验证命令。",
    "cuuStart.codeTemplateAcceptanceSafety": "列出改动范围、风险点和回滚方式。",
    "cuuStart.action": "开始处理",
    "cuuStart.defaultTitle": "Cuu 桌面入口任务",
    "cuuStart.defaultIntent": "从 Cuu 桌宠入口创建一个 AI 可执行事项，先根据用户需求和项目文件反问关键澄清点。",
    "cuuStart.placeholder": "写下需求，例如：根据项目网盘里的文件生成三条验收要点。",
    "cuuStart.analysisTitle": "Cuu 正在分析材料",
    "cuuStart.analysisMessage": "AI 正在阅读需求和项目文件，稍后只展示反问结果。",
    "cuuStart.analysisToolIntent": "已收到你的需求",
    "cuuStart.analysisToolFiles": "正在读取项目网盘上下文",
    "cuuStart.analysisToolModel": "正在调用澄清模型生成反问",
    "cuuStart.analysisPrivacy": "界面只显示工具调用和当前状态。",
    "cuuStart.started": "Cuu 已启动：{title}",
    "cuuStart.restored": "Cuu 已恢复：{title}",
    "cuuStart.clarificationNeeded": "Cuu 还需要你补充：{title}",
    "cuuStart.unavailable": "Cuu 当前缺少启动 AI 执行的客户端能力。",
    "cuuStart.reducedMotion": "Cuu 正在等你写下需求。",
    "cuuStart.progressIntent": "需求",
    "cuuStart.progressTask": "事项",
    "cuuStart.progressRun": "执行",
    "cuuStart.streamUpdated": "Cuu 更新了进度：{title}",
    "cuuStart.errorBudgetTitle": "预算挡住了这次执行",
    "cuuStart.errorBudgetMessage": "这次任务已到预算线，需要你确认下一步。",
    "cuuStart.errorPermissionTitle": "这步需要权限",
    "cuuStart.errorPermissionMessage": "Cuu 没有权限直接继续，需要你打开详情处理。",
    "cuuStart.errorOfflineTitle": "Cuu 暂时收不到进度",
    "cuuStart.errorOfflineMessage": "连接中断或服务暂不可用，Cuu 会等连接恢复后继续。",
    "cuuStart.errorGenericTitle": "这次启动没有成功",
    "cuuStart.errorGenericMessage": "Cuu 没能完成这步操作，请打开详情查看原因。",
    "cuuStart.errorRestartMessage": "可以重新开始，Cuu 会再读一次需求和项目文件。",
    "cuuStart.errorChip.budget": "预算",
    "cuuStart.errorChip.permission": "权限",
    "cuuStart.errorChip.offline": "离线",
    "cuuStart.errorChip.generic": "异常",
    "cuuStart.errorViewReplay": "查看回放",
    "cuuStart.errorOpenWorkItem": "打开事项",
    "cuuStart.errorRestartAction": "重新开始",
    "cuuStart.restartReady": "已回到需求输入。",
    "pet.aria": "Cuu 桌宠",
    "pet.windowModeExpanding": "Cuu 轻卡窗口正在展开。",
    "pet.reducedMotionOffline": "Cuu 遇到连接问题，正在提醒你。",
    "pet.selectedWithLabel": "已选：{label}，点确认继续。",
    "pet.selectedFallback": "已调整选项，点确认继续。",
    "pet.optionRequired": "先点一个选项，Cuu 再继续。",
    "pet.reasonRequired": "先点一个原因，Cuu 会带着它继续改。",
    "pet.reasonDefault": "需要调整",
    "pet.actionFail": "动作提交失败，请稍后再试。",
    "pet.action.approve": "同意",
    "pet.action.requestChanges": "打回",
    "pet.action.open": "打开详情",
    "pet.reject.evidence": "证据不足",
    "pet.reject.scope": "范围太大",
    "pet.reject.format": "交付格式要改",
    "pet.reject.cancel": "先不打回",
    "pet.evidenceTitle": "证据",
    "pet.evidenceMore": "还有 {count} 条证据",
    "pet.input.optionWithText": "点选项即可，补充文字已折叠",
    "pet.input.optionOnly": "点选项即可继续",
    "pet.input.textNeeded": "Cuu 需要你补一句",
    "pet.kind.question": "澄清",
    "pet.kind.approval": "审批",
    "pet.kind.proposal": "变更",
    "pet.kind.evidence": "证据",
    "pet.kind.budget": "预算",
    "pet.kind.sync": "同步",
    "pet.kind.trace": "进度",
    "pet.kind.completion": "完成",
    "pet.kind.offline": "离线",
    "pet.kind.bubble": "提醒",
    "pet.priority.urgent": "急",
    "pet.priority.high": "高",
    "pet.priority.low": "低",
    "pet.priority.normal": "普通",
    "pet.emotion.idle": "待命中 (=^･ω･^=)",
    "pet.emotion.thinking": "忙着干活 (๑˃ᴗ˂)",
    "pet.emotion.approval": "等你拍板 (｡･ω･｡)ﾉ",
    "pet.emotion.worried": "有点担心 (>﹏<)",
    "pet.emotion.celebrating": "搞定啦 ٩(◜◡◝)۶"
  },
  "en-US": {
    "agentRun.doneTitle": "This run is complete",
    "agentRun.attentionTitle": "This run needs attention",
    "agentRun.startedTitle": "Cuu started working",
    "agentRun.workingTitle": "Cuu is working",
    "agentRun.progressFallback": "Cuu is organizing the run progress.",
    "agentRun.thinkingStatus": "AI is organizing the materials and preparing the next step.",
    "agentRun.toolCallStatus": "Calling tool: {tool}",
    "agentRun.toolCallStatusGeneric": "Calling a tool.",
    "agentRun.toolResultStatus": "Tool result received; Cuu is organizing the next step.",
    "agentRun.phase.think": "AI is organizing materials",
    "agentRun.phase.toolCall": "Tool call",
    "agentRun.phase.toolResult": "Tool result received",
    "agentRun.phase.final": "Final output",
    "agentRun.viewReplay": "View replay",
    "agentRun.openWorkItem": "Back to task",
    "agentRun.abort": "Cancel run",
    "agentRun.progressSection": "Run progress",
    "agentRun.budgetSection": "Budget",
    "agentRun.handoffSection": "Handoff",
    "agentRun.queued": "Cuu is queued and will start shortly.",
    "question.bodyFallback": "Pick one option and Cuu will keep going.",
    "question.submit": "Confirm option",
    "question.submitAnswer": "Submit answer",
    "evidence.missingSection": "Gap",
    "evidence.titleFound": "Evidence related to \"{query}\"",
    "evidence.titleDefault": "Cuu found evidence",
    "proposal.changesSection": "What changed",
    "proposal.reviewTitle": "Cuu has a change for review",
    "proposal.mergeTitle": "Cuu is ready to merge the change",
    "proposal.mergeTitleNamed": "\"{title}\" is ready to merge",
    "proposal.mergeStatus": "Change ready to merge",
    "proposal.summarySection": "Summary",
    "proposal.summaryFallback": "The change request is ready. Review the summary and changes before deciding.",
    "proposal.nextStepSection": "Next step",
    "proposal.nextStepOpenReview": "View change request opens the change detail with the summary, diff, and decision buttons.",
    "proposal.nextStepOpened": "Review the summary and changes, then mark approved or request changes.",
    "proposal.nextStepReviewed": "Approved. Merge the deliverable next.",
    "proposal.nextStepMerged": "Merged into the official version.",
    "proposal.nextStepRejected": "Sent back. Cuu will revise with your feedback.",
    "proposal.planNextStepOpened": "Review the plan; request a replan if it needs changes.",
    "proposal.planNextStepReviewed": "Plan approved. Start it now or hold it for later.",
    "proposal.openReview": "View change request",
    "proposal.openPlanReview": "View plan proposal",
    "proposal.approveReview": "Mark approved",
    "proposal.approvePlanReview": "Approve plan",
    "proposal.approvePlanAndStart": "Approve and start",
    "proposal.approvePlanHold": "Approve but hold",
    "proposal.startHeldPlan": "Start plan",
    "proposal.requestChanges": "Request changes",
    "proposal.requestReplan": "Request replan",
    "proposal.riskSection": "Risk and rollback",
    "proposal.rollbackAvailable": "Rollback available",
    "proposal.rollbackUnavailable": "Not fully rollbackable",
    "proposal.checksSection": "Check results",
    "proposal.checkStatus.passed": "Passed",
    "proposal.checkStatus.failed": "Failed",
    "proposal.checkStatus.warning": "Warning",
    "proposal.checkStatus.skipped": "Skipped",
    "proposal.conflictTitle": "Change conflict",
    "proposal.conflictOpenProposal": "View change request",
    "proposal.conflictKeepCurrent": "Keep current",
    "proposal.conflictAcceptIncoming": "Use this version",
    "proposal.conflictAiFusion": "AI fusion draft",
    "proposal.conflictApplyAiFusion": "Use AI fusion draft",
    "proposal.conflictTargetSection": "Conflicting item",
    "proposal.conflictVersionSection": "Version choice",
    "workItem.open": "Open task",
    "workItem.openProposal": "Open change",
    "workItem.viewReplay": "View replay",
    "workItem.startAgent": "Start AI run",
    "workItem.statusSection": "Current status",
    "workItem.readyFallback": "Cuu is ready to continue.",
    "workItem.acceptanceSection": "Acceptance",
    "workItem.acceptanceFallback": "Acceptance item {index}",
    "workItem.acceptanceStatus.open": "Pending",
    "workItem.acceptanceStatus.met": "Met",
    "workItem.acceptanceStatus.unmet": "Not met",
    "workItem.acceptanceStatus.waived": "Waived",
    "workItem.startedFallback": "Cuu started working on this task.",
    "budget.scope.workitem": "Task budget",
    "budget.scope.task": "Plan budget",
    "budget.scope.objective": "Objective budget",
    "budget.scope.user": "Personal budget",
    "budget.scope.team": "Team budget",
    "budget.scope.curation": "Curation budget",
    "budget.scope.eval": "Eval budget",
    "budget.scopeDesc.workitem": "Current task",
    "budget.scopeDesc.task": "Current task plan",
    "budget.scopeDesc.objective": "Current objective",
    "budget.scopeDesc.user": "Current user",
    "budget.scopeDesc.team": "Current team",
    "budget.scopeDesc.curation": "Team curation scope",
    "budget.scopeDesc.eval": "Evaluation scope",
    "budget.handle": "Handle budget",
    "budget.view": "View budget",
    "budget.exhaustedTitle": "Budget exhausted",
    "budget.warningTitle": "Budget is close to the limit",
    "budget.usageDescription": "Budget usage",
    "cost.summarySection": "Today's cost",
    "cost.risksSection": "Budget risks",
    "cost.total": "Total cost",
    "cost.input": "Input",
    "cost.output": "Output",
    "cost.remaining": "¥{cost} remaining",
    "cost.status.ok": "OK",
    "cost.status.warning": "Warning",
    "cost.status.critical": "Critical",
    "cost.status.exhausted": "Exhausted",
    "cost.title": "AI cost and budget",
    "cost.notConnected": "Cost data is not connected yet.",
    "cost.usedToday": "Used ¥{cost} today.",
    "replay.summarySection": "Replay summary",
    "replay.costSection": "Cost",
    "replay.title": "Execution replay is ready",
    "replay.readyFallback": "Cuu organized this execution trace.",
    "event.defaultTitle": "WorkHub update",
    "event.defaultMessage": "Cuu received a new status update.",
    "offline.retryingTitle": "Connection is unstable",
    "offline.closedTitle": "WorkHub is disconnected",
    "offline.retryingMessage": "Cuu is reconnecting and will keep bringing important reminders back.",
    "offline.closedMessage": "Cuu will wait quietly for the connection to recover. Important items will not be lost.",
    "offline.retryingChip": "Reconnecting",
    "offline.closedChip": "Disconnected",
    "state.idle": "Idle",
    "state.thinking": "Thinking",
    "state.asking_approval": "Waiting for you",
    "state.carrying_document": "Change ready",
    "state.searching_evidence": "Evidence found",
    "state.syncing_files": "Syncing",
    "state.worried": "Needs attention",
    "state.revision_requested": "Revising",
    "state.celebrating": "Done",
    "state.offline": "Offline",
    "notice.prefix": "Cuu: {title}",
    "action.reasonRequired": "Choose a reason before sending it back.",
    "action.approved": "Cuu got it: this step is approved.",
    "action.denied": "Sent back; Cuu will revise.",
    "action.evidenceFound": "Cuu found a set of project evidence.",
    "action.noEvidence": "This evidence card has nothing bindable yet.",
    "action.evidenceBound": "Cuu added this evidence to the current task.",
    "action.nextQuestion": "Next question: {title}",
    "cuuStart.title": "What should Cuu do?",
    "cuuStart.message": "Write the real request first. Cuu will use project files to ask the key follow-up before it runs.",
    "cuuStart.documentDraft": "Document draft",
    "cuuStart.documentDraftDesc": "Reports, briefs, PR-style change notes",
    "cuuStart.documentDraftAcceptancePrimary": "Deliver a reviewable document or plan draft with structure, body copy, and next revision points.",
    "cuuStart.documentDraftAcceptanceEvidence": "Mark evidence, assumptions, and open confirmations without presenting unknowns as facts.",
    "cuuStart.structuredData": "Structured data",
    "cuuStart.structuredDataDesc": "JSON, YAML, CSV, config",
    "cuuStart.structuredDataAcceptancePrimary": "Deliver a structured file or table with field notes, examples, and validation steps.",
    "cuuStart.structuredDataAcceptanceEvidence": "Preserve data sources, transformation rules, and exception notes.",
    "cuuStart.codeTemplate": "Small code/template",
    "cuuStart.codeTemplateDesc": "Low-risk snippets, templates, config changes",
    "cuuStart.codeTemplateAcceptancePrimary": "Deliver runnable small code or a template with entry point, usage notes, and validation command.",
    "cuuStart.codeTemplateAcceptanceSafety": "List change scope, risks, and rollback path.",
    "cuuStart.action": "Start work",
    "cuuStart.defaultTitle": "Cuu desktop entry task",
    "cuuStart.defaultIntent": "Create an AI-runnable task from the Cuu desktop pet entry, then ask the key clarification from the user's request and project files.",
    "cuuStart.placeholder": "Describe the request, e.g. use project drive files to draft three acceptance points.",
    "cuuStart.analysisTitle": "Cuu is analyzing the materials",
    "cuuStart.analysisMessage": "AI is reading the request and project files; only the follow-up question will be shown.",
    "cuuStart.analysisToolIntent": "Request received",
    "cuuStart.analysisToolFiles": "Reading project-drive context",
    "cuuStart.analysisToolModel": "Calling the clarifier model",
    "cuuStart.analysisPrivacy": "Only tool calls and current status are shown.",
    "cuuStart.started": "Cuu started: {title}",
    "cuuStart.restored": "Cuu restored: {title}",
    "cuuStart.clarificationNeeded": "Cuu needs one more detail: {title}",
    "cuuStart.unavailable": "Cuu is missing the client capability to start an AI run.",
    "cuuStart.reducedMotion": "Cuu is waiting for your request.",
    "cuuStart.progressIntent": "Request",
    "cuuStart.progressTask": "Task",
    "cuuStart.progressRun": "Run",
    "cuuStart.streamUpdated": "Cuu updated progress: {title}",
    "cuuStart.errorBudgetTitle": "Budget stopped this run",
    "cuuStart.errorBudgetMessage": "This task reached its budget limit and needs your decision.",
    "cuuStart.errorPermissionTitle": "This step needs permission",
    "cuuStart.errorPermissionMessage": "Cuu cannot continue directly. Open the detail view to handle it.",
    "cuuStart.errorOfflineTitle": "Cuu cannot receive progress",
    "cuuStart.errorOfflineMessage": "The connection or service is unavailable. Cuu will continue when it recovers.",
    "cuuStart.errorGenericTitle": "This start did not finish",
    "cuuStart.errorGenericMessage": "Cuu could not complete this step. Open the detail view to inspect the reason.",
    "cuuStart.errorRestartMessage": "Start again and Cuu will reread the request and project files.",
    "cuuStart.errorChip.budget": "Budget",
    "cuuStart.errorChip.permission": "Permission",
    "cuuStart.errorChip.offline": "Offline",
    "cuuStart.errorChip.generic": "Error",
    "cuuStart.errorViewReplay": "View replay",
    "cuuStart.errorOpenWorkItem": "Open task",
    "cuuStart.errorRestartAction": "Start again",
    "cuuStart.restartReady": "Back at the request input.",
    "pet.aria": "Cuu desktop pet",
    "pet.windowModeExpanding": "Cuu is expanding the light card window.",
    "pet.reducedMotionOffline": "Cuu hit a connection issue and is notifying you.",
    "pet.selectedWithLabel": "Selected: {label}. Confirm to continue.",
    "pet.selectedFallback": "Selection updated. Confirm to continue.",
    "pet.optionRequired": "Choose one option before Cuu continues.",
    "pet.reasonRequired": "Choose one reason so Cuu can revise with it.",
    "pet.reasonDefault": "Needs adjustment",
    "pet.actionFail": "Action failed. Please try again later.",
    "pet.action.approve": "Approve",
    "pet.action.requestChanges": "Request changes",
    "pet.action.open": "Open details",
    "pet.reject.evidence": "Not enough evidence",
    "pet.reject.scope": "Scope is too large",
    "pet.reject.format": "Delivery format needs work",
    "pet.reject.cancel": "Keep reviewing",
    "pet.evidenceTitle": "Evidence",
    "pet.evidenceMore": "{count} more evidence item(s)",
    "pet.input.optionWithText": "Choose an option; text is folded away",
    "pet.input.optionOnly": "Choose an option to continue",
    "pet.input.textNeeded": "Cuu needs one short note",
    "pet.kind.question": "Clarify",
    "pet.kind.approval": "Approval",
    "pet.kind.proposal": "Change",
    "pet.kind.evidence": "Evidence",
    "pet.kind.budget": "Budget",
    "pet.kind.sync": "Sync",
    "pet.kind.trace": "Progress",
    "pet.kind.completion": "Done",
    "pet.kind.offline": "Offline",
    "pet.kind.bubble": "Notice",
    "pet.priority.urgent": "Urgent",
    "pet.priority.high": "High",
    "pet.priority.low": "Low",
    "pet.priority.normal": "Normal",
    "pet.emotion.idle": "On standby (=^･ω･^=)",
    "pet.emotion.thinking": "On it (๑˃ᴗ˂)",
    "pet.emotion.approval": "Your call (｡･ω･｡)ﾉ",
    "pet.emotion.worried": "A bit worried (>﹏<)",
    "pet.emotion.celebrating": "All done ٩(◜◡◝)۶"
  }
} as const satisfies Record<WorkHubLocale, Record<CuuCopyKey, string>>;

export function cuuT(locale: unknown, key: CuuCopyKey): string {
  return cuuCopy[normalizeWorkHubLocale(locale)][key];
}

export function cuuFormat(locale: unknown, key: CuuCopyKey, values: Record<string, string | number>) {
  let copy = cuuT(locale, key);
  for (const [name, value] of Object.entries(values)) {
    copy = copy.replaceAll(`{${name}}`, String(value));
  }
  return copy;
}
