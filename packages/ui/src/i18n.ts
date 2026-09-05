import {
  normalizeWorkHubLocale,
  type AgentRunStatus,
  type AgentStepPhase,
  type DeliverableTargetKind,
  type EvidenceSourceType,
  type TaskPlanItemRole,
  type TaskPlanItemStatus,
  type TaskPlanStatus,
  type WorkHubLocale,
  type WorkItemStatus
} from "@workhub/contracts";

export type UiRenderOptions = {
  locale?: WorkHubLocale;
};

type Copy = Record<WorkHubLocale, string>;

const copy = {
  // R9 i18n：与 gold-path 词典的 intake.kicker（「新任务」）同名不同义——改名消歧。
  "intake.sessionKicker": { "zh-CN": "选项澄清", "en-US": "Option intake" },
  "intake.aiRecommended": { "zh-CN": "AI 推荐", "en-US": "AI recommended" },
  "intake.freeText": { "zh-CN": "其他 / 补充", "en-US": "Other / add context" },
  "intake.freeTextPlaceholder": { "zh-CN": "需要时再补一句。", "en-US": "Add one sentence only if needed." },
  "intake.defaultBody": { "zh-CN": "先点一个选项，我再继续。", "en-US": "Pick one option and I will keep going." },
  "intake.progressAria": { "zh-CN": "澄清进度", "en-US": "Clarification progress" },
  "intake.continue": { "zh-CN": "继续", "en-US": "Continue" },

  "generic.status": { "zh-CN": "状态", "en-US": "Status" },
  "generic.acceptance": { "zh-CN": "验收", "en-US": "Acceptance" },
  "generic.evidence": { "zh-CN": "证据", "en-US": "Evidence" },
  "generic.risk": { "zh-CN": "风险", "en-US": "Risk" },
  "generic.changes": { "zh-CN": "改动", "en-US": "Changes" },
  "generic.checks": { "zh-CN": "检查", "en-US": "Checks" },
  "generic.steps": { "zh-CN": "步骤", "en-US": "Steps" },
  "generic.budget": { "zh-CN": "预算", "en-US": "Budget" },
  "generic.tokens": { "zh-CN": "token", "en-US": "tokens" },
  "generic.model": { "zh-CN": "模型", "en-US": "Model" },
  "generic.rollback": { "zh-CN": "回滚", "en-US": "Rollback" },
  "generic.snapshot": { "zh-CN": "快照", "en-US": "Snapshot" },
  "generic.open": { "zh-CN": "打开", "en-US": "Open" },
  "generic.openSource": { "zh-CN": "打开来源", "en-US": "Open source" },
  "generic.continueViewing": { "zh-CN": "继续查看", "en-US": "Keep reviewing" },
  "generic.aiStatus": { "zh-CN": "AI 状态", "en-US": "AI status" },
  "generic.currentThing": { "zh-CN": "当前一件事", "en-US": "Current focus" },
  "generic.noEvidence": { "zh-CN": "没有找到可展示的证据。", "en-US": "No displayable evidence yet." },

  "workitem.kicker": { "zh-CN": "任务", "en-US": "Work item" },
  "workitem.defaultSummary": {
    "zh-CN": "AI 会把这件事拆成可执行的下一步。",
    "en-US": "AI will turn this into a clear next step."
  },
  "workitem.emptyTrace": {
    "zh-CN": "AI 待命中——点上方「生成任务计划」或「让 AI 开工」它才会动手。",
    "en-US": "AI is standing by — it starts only after you hit Draft task plan or Start AI."
  },
  "workitem.stepFallback": { "zh-CN": "记录了一步。", "en-US": "Recorded one step." },
  "workitem.emptyAcceptance": { "zh-CN": "暂无验收项。", "en-US": "No acceptance items yet." },
  "workitem.acceptanceItem": { "zh-CN": "验收项", "en-US": "Acceptance item" },
  "workitem.liveTitle": { "zh-CN": "AI 实时执行", "en-US": "Live AI work" },
  "workitem.acceptanceTitle": { "zh-CN": "验收清单", "en-US": "Acceptance checklist" },
  "workitem.deliveryPending": { "zh-CN": "交付物待确认", "en-US": "Deliverable needs review" },
  "workitem.started": { "zh-CN": "我开始处理了", "en-US": "AI has started" },
  "workitem.currentStatus": { "zh-CN": "当前状态", "en-US": "Current status" },
  "workitem.proposalReady": {
    "zh-CN": "AI 已经把改动整理成一份可审的变更申请。",
    "en-US": "AI has packaged the changes into a reviewable request."
  },
  "workitem.willReadEvidence": {
    "zh-CN": "开工后 AI 会先看证据，再生成可供审批的交付物——记得点「生成任务计划」让它开工。",
    "en-US": "Once started, AI reads evidence first, then prepares a reviewable deliverable — hit Draft task plan to kick it off."
  },

  "proposal.kicker": { "zh-CN": "交付物变更申请", "en-US": "Deliverable change request" },
  "proposal.displayTitleFallback": { "zh-CN": "交付物变更申请", "en-US": "Deliverable change request" },
  "proposal.summaryHeading": { "zh-CN": "总结", "en-US": "Summary" },
  "proposal.railComplete": { "zh-CN": "已完成", "en-US": "Finished" },
  "proposal.railCarrying": { "zh-CN": "带着交付物", "en-US": "Carrying a deliverable" },
  "proposal.railRejected": { "zh-CN": "已打回", "en-US": "Sent back" },
  "proposal.terminalMerged": { "zh-CN": "这份改动已采纳进正式版。无需再操作。", "en-US": "This change was adopted into the official version. Nothing more to do." },
  "proposal.terminalRejected": { "zh-CN": "这份改动已打回，打回理由已回灌给 AI，它会带着反馈继续改。", "en-US": "This change was sent back; the reason was fed to the AI, which will revise with your feedback." },
  "proposal.rollbackAvailable": { "zh-CN": "留有回滚快照（需人工恢复）", "en-US": "Rollback snapshot kept (manual restore)" },
  "proposal.rollbackUnavailable": { "zh-CN": "无回滚快照", "en-US": "No rollback snapshot" },
  "proposal.changeSummary": { "zh-CN": "这次改了什么", "en-US": "What changed" },
  "proposal.checkResults": { "zh-CN": "检查结果", "en-US": "Check results" },
  "proposal.comments": { "zh-CN": "负责人意见", "en-US": "Owner comments" },
  "proposal.conflictTitle": { "zh-CN": "和别人的改动冲突了", "en-US": "Conflicting change detected" },
  "proposal.conflictBody": {
    "zh-CN": "不用看技术细节，直接选一个处理方式。",
    "en-US": "No technical review needed. Choose how to continue."
  },
  "proposal.conflictRecommended": { "zh-CN": "建议", "en-US": "Recommended" },
  "proposal.conflictKeepCurrent": { "zh-CN": "保留正式版", "en-US": "Keep current" },
  "proposal.conflictAcceptIncoming": { "zh-CN": "采纳这次版本", "en-US": "Use this version" },
  "proposal.conflictAiFusion": { "zh-CN": "AI 融合建议", "en-US": "AI fusion draft" },
  "proposal.conflictApplyAiFusion": { "zh-CN": "采用 AI 融合稿", "en-US": "Use AI fusion draft" },
  "proposal.conflictExisting": { "zh-CN": "正式版", "en-US": "Current" },
  "proposal.conflictIncoming": { "zh-CN": "这次版本", "en-US": "This version" },
  "proposal.conflictTarget": { "zh-CN": "对象", "en-US": "Target" },
  "proposal.conflictWorkbenchTitle": { "zh-CN": "批量冲突检查", "en-US": "Bulk conflict review" },
  "proposal.conflictWorkbenchBody": {
    "zh-CN": "默认先处理最需要你拿主意的一项；展开后可以查看全部冲突，并对相同情况批量处理。",
    "en-US": "Start with the highest-signal decision; expand to review every conflict and the safe bulk choices."
  },
  "proposal.conflictWorkbenchDefault": { "zh-CN": "默认仍是一件事优先", "en-US": "One thing first by default" },
  "proposal.conflictWorkbenchRecommended": { "zh-CN": "建议", "en-US": "Recommended" },
  "proposal.conflictWorkbenchBulkKeep": { "zh-CN": "全部保留正式版", "en-US": "Keep all current" },
  "proposal.conflictWorkbenchBulkIncoming": { "zh-CN": "全部采纳这次版本", "en-US": "Use all incoming" },
  "proposal.patchTitle": { "zh-CN": "采用前预览", "en-US": "Preview before apply" },
  "proposal.patchChanged": { "zh-CN": "有改动", "en-US": "Changed" },
  "proposal.patchUnchanged": { "zh-CN": "无改动", "en-US": "Unchanged" },
  "proposal.patchBaseAvailable": { "zh-CN": "可对比原始版本", "en-US": "Original version available" },
  "proposal.patchBaseMissing": { "zh-CN": "缺原始版本可对比", "en-US": "No original to compare" },
  "proposal.patchRiskUnknown": { "zh-CN": "风险未知", "en-US": "Risk unknown" },
  "proposal.patchRiskLow": { "zh-CN": "低重叠风险", "en-US": "Low overlap risk" },
  "proposal.patchRiskReview": { "zh-CN": "需要复核", "en-US": "Review required" },
  "proposal.patchHunks": { "zh-CN": "改动处", "en-US": "Changes" },
  "proposal.patchLines": { "zh-CN": "行数", "en-US": "Lines" },
  "proposal.patchFoldedLines": { "zh-CN": "已折叠行", "en-US": "Folded lines" },
  "proposal.patchFoldedHunks": { "zh-CN": "已折叠段落", "en-US": "Folded hunks" },
  "proposal.diff3Title": { "zh-CN": "文本合并检查", "en-US": "Text merge check" },
  "proposal.diff3Auto": { "zh-CN": "已自动合并", "en-US": "Auto-merged" },
  "proposal.diff3Review": { "zh-CN": "需逐项确认", "en-US": "Needs line review" },
  "proposal.diff3Current": { "zh-CN": "正式版改动段", "en-US": "Current hunks" },
  "proposal.diff3Incoming": { "zh-CN": "这次版本改动段", "en-US": "Incoming hunks" },
  "proposal.diff3Conflict": { "zh-CN": "重叠段", "en-US": "Overlaps" },
  "proposal.diff3Ranges": { "zh-CN": "影响行", "en-US": "Affected lines" },
  "proposal.overlapReviewHunk": { "zh-CN": "重叠段", "en-US": "Overlap hunk" },
  "proposal.overlapReviewKeepCurrent": { "zh-CN": "保留正式版", "en-US": "Keep current" },
  "proposal.overlapReviewAcceptIncoming": { "zh-CN": "采纳这次版本", "en-US": "Use this version" },
  "proposal.overlapReviewAiFusion": { "zh-CN": "采用 AI 融合稿", "en-US": "Use AI fusion draft" },
  "proposal.lineEditorTitle": { "zh-CN": "逐行选择器", "en-US": "Line editor" },
  "proposal.lineEditorSearch": { "zh-CN": "搜索行号或文本", "en-US": "Search lines" },
  "proposal.lineEditorApply": { "zh-CN": "应用逐段选择", "en-US": "Apply line choices" },
  "proposal.structuredPatchTitle": { "zh-CN": "结构化字段检查", "en-US": "Structured field check" },
  "proposal.structuredPatchFields": { "zh-CN": "将写入字段", "en-US": "Fields to write" },
  "proposal.structuredPatchChanged": { "zh-CN": "声明改动字段", "en-US": "Declared fields" },
  "proposal.structuredPatchMissing": { "zh-CN": "缺少字段", "en-US": "Missing fields" },
  "proposal.structuredPatchUnknown": { "zh-CN": "额外字段", "en-US": "Extra fields" },
  "proposal.structuredPatchDryRun": { "zh-CN": "试运行检查", "en-US": "Pre-check" },
  "proposal.structuredPatchIssues": { "zh-CN": "问题", "en-US": "Issues" },
  "proposal.fieldEditorTitle": { "zh-CN": "高级字段编辑", "en-US": "Advanced field editor" },
  "proposal.fieldEditorBody": {
    "zh-CN": "默认采用 AI 综合后的版本；需要微调时再展开。",
    "en-US": "The default path uses the AI fusion draft; expand only when a field needs a precise adjustment."
  },
  "proposal.fieldEditorAcceptOnly": { "zh-CN": "只采用此字段", "en-US": "Use this field only" },
  "proposal.fieldEditorKeep": { "zh-CN": "保留当前字段", "en-US": "Keep current field" },
  "proposal.fieldEditorCustom": { "zh-CN": "使用自定义值", "en-US": "Use custom value" },
  "proposal.fieldEditorCustomPlaceholder": { "zh-CN": "输入自定义字段值", "en-US": "Enter a custom field value" },
  "proposal.fieldEditorField": { "zh-CN": "字段", "en-US": "Field" },
  "proposal.subrecordEditorTitle": { "zh-CN": "高级子记录编辑", "en-US": "Advanced item editor" },
  "proposal.subrecordEditorBody": {
    "zh-CN": "默认采用 AI 的整套建议；需要单独调整验收项或任务项时再逐项选择。",
    "en-US": "The default path uses the full AI suggestion; expand only when an acceptance or task item needs a precise choice."
  },
  "proposal.subrecordReplayTitle": { "zh-CN": "子记录逐项变化", "en-US": "Subrecord item changes" },
  "proposal.subrecordAcceptance": { "zh-CN": "验收项", "en-US": "Acceptance items" },
  "proposal.subrecordTask": { "zh-CN": "任务项", "en-US": "Task items" },
  "proposal.subrecordAdded": { "zh-CN": "新增", "en-US": "Added" },
  "proposal.subrecordRemoved": { "zh-CN": "删除", "en-US": "Removed" },
  "proposal.subrecordModified": { "zh-CN": "修改", "en-US": "Modified" },
  "proposal.subrecordUnchanged": { "zh-CN": "未变", "en-US": "Unchanged" },
  "proposal.subrecordCurrent": { "zh-CN": "当前", "en-US": "Current" },
  "proposal.subrecordIncoming": { "zh-CN": "AI 建议", "en-US": "AI suggestion" },
  "proposal.subrecordAcceptIncoming": { "zh-CN": "采纳此项", "en-US": "Use this item" },
  "proposal.subrecordKeepCurrent": { "zh-CN": "保留当前项", "en-US": "Keep current item" },
  "proposal.taskPlanScopeTitle": { "zh-CN": "先选目标计划", "en-US": "Choose target plan first" },
  "proposal.taskPlanScopeBody": {
    "zh-CN": "这个事项有多个计划，写入任务项前请先选择目标计划。",
    "en-US": "This work item has multiple plans; choose the target before writing task items."
  },
  "proposal.taskPlanScopeRecommended": { "zh-CN": "建议", "en-US": "Recommended" },

  "agent.kicker": { "zh-CN": "实时轨迹", "en-US": "Live replay" },
  "agent.emptyTrace": {
    "zh-CN": "AI 已排队，开始后会把关键步骤放在这里。",
    "en-US": "AI is queued. Key steps will appear here after it starts."
  },
  "agent.stepFallback": { "zh-CN": "记录了一步。", "en-US": "Recorded one step." },
  "agent.stepThinkingPublic": { "zh-CN": "AI 正在整理材料，稍后给你下一步。", "en-US": "AI is organizing the materials and preparing the next step." },
  "agent.stepToolCallGeneric": { "zh-CN": "正在调用工具。", "en-US": "Calling a tool." },
  "agent.stepToolResultGeneric": {
    "zh-CN": "工具已返回，AI 正在整理下一步。",
    "en-US": "Tool result received; AI is organizing the next step."
  },
  "agent.stepFinalOutput": { "zh-CN": "最终输出已生成。", "en-US": "Final output is ready." },
  "agent.emptyHandoff": { "zh-CN": "暂无交接事项。", "en-US": "No handoff items yet." },
  "agent.defaultSummary": {
    "zh-CN": "AI 会把关键步骤和证据变化记录在这里。",
    "en-US": "AI will record key steps and evidence changes here."
  },
  "agent.fallbackTitle": { "zh-CN": "AI 执行", "en-US": "AI run" },
  "agent.liveTitle": { "zh-CN": "AI 实时执行", "en-US": "Live AI work" },
  "agent.handoff": { "zh-CN": "交接", "en-US": "Handoff" },
  "agent.viewReplay": { "zh-CN": "查看回放", "en-US": "View replay" },
  "agent.backToTask": { "zh-CN": "回到任务", "en-US": "Back to task" },
  "agent.abort": { "zh-CN": "取消执行", "en-US": "Cancel run" },
  "agent.done": { "zh-CN": "已完成", "en-US": "Done" },
  "agent.needsAttention": { "zh-CN": "需要关注", "en-US": "Needs attention" },
  "agent.thinking": { "zh-CN": "正在思考", "en-US": "Thinking" },
  "agent.celebratingBody": {
    "zh-CN": "AI 已经把这次执行整理好了，可以查看回放和交付物。",
    "en-US": "AI has organized this run. You can review the replay and deliverables."
  },
  "agent.runningBody": {
    "zh-CN": "这里只显示关键节点，完整过程在回放里。",
    "en-US": "AI will surface only key moments here; the full process stays in replay."
  },
  "agent.handoffDone": { "zh-CN": "已完成", "en-US": "Done" },
  "agent.handoffRemaining": { "zh-CN": "还剩", "en-US": "Remaining" },
  "agent.handoffNext": { "zh-CN": "下一步", "en-US": "Next" },
  "agent.handoffBlocker": { "zh-CN": "阻塞", "en-US": "Blocked" }
} satisfies Record<string, Copy>;

const workItemStatusLabels = {
  intake: { "zh-CN": "收集需求", "en-US": "Intake" },
  ai_clarifying: { "zh-CN": "AI 澄清中", "en-US": "AI clarifying" },
  spec_ready: { "zh-CN": "规格已就绪", "en-US": "Spec ready" },
  ai_working: { "zh-CN": "AI 正在处理", "en-US": "AI working" },
  escalated: { "zh-CN": "需要负责人介入", "en-US": "Needs owner" },
  pm_mode: { "zh-CN": "PM 模式处理中", "en-US": "PM mode" },
  in_review: { "zh-CN": "等待确认", "en-US": "In review" },
  merged: { "zh-CN": "已采纳", "en-US": "Adopted" },
  done: { "zh-CN": "已完成", "en-US": "Done" },
  cancelled: { "zh-CN": "已取消", "en-US": "Cancelled" }
} satisfies Record<WorkItemStatus, Copy>;

const taskPlanStatusLabels = {
  draft: { "zh-CN": "草稿", "en-US": "Draft" },
  proposed: { "zh-CN": "待审阅", "en-US": "Proposed" },
  approved: { "zh-CN": "已批准", "en-US": "Approved" },
  // R5 词表：跨实体「正在跑」统一为「进行中 / In progress」（plan/item/run 同词，中英同策略）。
  dispatching: { "zh-CN": "进行中", "en-US": "In progress" },
  paused: { "zh-CN": "已暂停", "en-US": "Paused" },
  done: { "zh-CN": "已完成", "en-US": "Done" },
  cancelled: { "zh-CN": "已取消", "en-US": "Cancelled" }
} satisfies Record<TaskPlanStatus, Copy>;

const taskPlanItemRoleLabels = {
  research: { "zh-CN": "调研", "en-US": "Research" },
  produce: { "zh-CN": "产出", "en-US": "Produce" },
  review: { "zh-CN": "复核", "en-US": "Review" },
  integrate: { "zh-CN": "整合", "en-US": "Integrate" }
} satisfies Record<TaskPlanItemRole, Copy>;

const taskPlanItemStatusLabels = {
  pending: { "zh-CN": "待开始", "en-US": "Waiting" },
  dispatched: { "zh-CN": "进行中", "en-US": "In progress" },
  succeeded: { "zh-CN": "已成功", "en-US": "Succeeded" },
  failed: { "zh-CN": "失败", "en-US": "Failed" },
  skipped: { "zh-CN": "已跳过", "en-US": "Skipped" }
} satisfies Record<TaskPlanItemStatus, Copy>;

const agentRunStatusLabels = {
  queued: { "zh-CN": "排队中", "en-US": "Queued" },
  running: { "zh-CN": "进行中", "en-US": "In progress" },
  succeeded: { "zh-CN": "已完成", "en-US": "Succeeded" },
  failed: { "zh-CN": "失败", "en-US": "Failed" },
  escalated: { "zh-CN": "需要负责人介入", "en-US": "Needs owner" },
  cancelled: { "zh-CN": "已取消", "en-US": "Cancelled" }
} satisfies Record<AgentRunStatus, Copy>;

const agentStepPhaseLabels = {
  think: { "zh-CN": "思考", "en-US": "Thinking" },
  tool_call: { "zh-CN": "调用工具", "en-US": "Tool call" },
  tool_result: { "zh-CN": "工具结果", "en-US": "Tool result" },
  final: { "zh-CN": "最终整理", "en-US": "Final" }
} satisfies Record<AgentStepPhase, Copy>;

const deliverableTargetLabels = {
  structured_record: { "zh-CN": "结构化记录", "en-US": "Structured record" },
  text_doc: { "zh-CN": "文档", "en-US": "Text document" },
  binary_doc: { "zh-CN": "二进制文档", "en-US": "Binary document" },
  spreadsheet: { "zh-CN": "表格", "en-US": "Spreadsheet" },
  slide_deck: { "zh-CN": "演示文稿", "en-US": "Slide deck" },
  image: { "zh-CN": "图片", "en-US": "Image" },
  folder: { "zh-CN": "文件夹", "en-US": "Folder" },
  archive: { "zh-CN": "归档包", "en-US": "Archive" },
  spec_doc: { "zh-CN": "规格文档", "en-US": "Spec document" }
} satisfies Record<DeliverableTargetKind, Copy>;

const evidenceSourceLabels = {
  drive_file: { "zh-CN": "网盘文件", "en-US": "Drive file" },
  meeting: { "zh-CN": "会议", "en-US": "Meeting" },
  comment: { "zh-CN": "评论", "en-US": "Comment" },
  work_item: { "zh-CN": "任务", "en-US": "Work item" },
  spec_doc: { "zh-CN": "规格文档", "en-US": "Spec document" },
  agent_step: { "zh-CN": "执行步骤", "en-US": "Agent step" },
  audit_log: { "zh-CN": "审计记录", "en-US": "Audit log" },
  external_url: { "zh-CN": "外部链接", "en-US": "External URL" }
} satisfies Record<EvidenceSourceType, Copy>;

const checkStatusLabels: Record<string, Copy> = {
  passed: { "zh-CN": "通过", "en-US": "Passed" },
  failed: { "zh-CN": "失败", "en-US": "Failed" },
  warning: { "zh-CN": "有提醒", "en-US": "Warning" },
  skipped: { "zh-CN": "已跳过", "en-US": "Skipped" },
  open: { "zh-CN": "待确认", "en-US": "Open" },
  done: { "zh-CN": "已完成", "en-US": "Done" },
  // 验收项的判定状态（之前漏映射，给中文用户直接渲染了 met/unmet/waived 英文 token）
  met: { "zh-CN": "已满足", "en-US": "Met" },
  unmet: { "zh-CN": "未满足", "en-US": "Unmet" },
  waived: { "zh-CN": "已豁免", "en-US": "Waived" }
};

// 预算用量状态：之前成本页把 ok/warning/critical/exhausted 英文 token 直接渲染成药丸。
const budgetStatusLabels: Record<string, Copy> = {
  ok: { "zh-CN": "正常", "en-US": "OK" },
  warning: { "zh-CN": "接近上限", "en-US": "Warning" },
  critical: { "zh-CN": "严重", "en-US": "Critical" },
  exhausted: { "zh-CN": "已用尽", "en-US": "Exhausted" }
};

// 提议状态：看改动页头此前把 opened/reviewed/merged/rejected 英文 token 直接渲染成徽章，
// 即便中文用户也读到裸枚举（同页其它徽章如工作项/回放都已人话化）。
const proposalStatusLabels: Record<string, Copy> = {
  opened: { "zh-CN": "待你审阅", "en-US": "Open for review" },
  reviewed: { "zh-CN": "已审阅", "en-US": "Reviewed" },
  merged: { "zh-CN": "已采纳", "en-US": "Adopted" },
  rejected: { "zh-CN": "已退回", "en-US": "Changes requested" }
};

const changeTypeLabels: Record<string, Copy> = {
  created: { "zh-CN": "新建", "en-US": "Created" },
  updated: { "zh-CN": "更新", "en-US": "Updated" },
  deleted: { "zh-CN": "删除", "en-US": "Deleted" },
  renamed: { "zh-CN": "重命名", "en-US": "Renamed" },
  moved: { "zh-CN": "移动", "en-US": "Moved" },
  replaced: { "zh-CN": "替换", "en-US": "Replaced" },
  generated: { "zh-CN": "生成", "en-US": "Generated" }
};

const previewKindLabels: Record<string, Copy> = {
  text: { "zh-CN": "文本预览", "en-US": "Text preview" },
  image: { "zh-CN": "图片预览", "en-US": "Image preview" },
  pdf: { "zh-CN": "PDF 预览", "en-US": "PDF preview" },
  office_preview: { "zh-CN": "Office 预览", "en-US": "Office preview" },
  download: { "zh-CN": "下载", "en-US": "Download" }
};

export type UiCopyKey = keyof typeof copy;

export function uiLocale(options?: UiRenderOptions | WorkHubLocale): WorkHubLocale {
  if (typeof options === "string") {
    return normalizeWorkHubLocale(options);
  }
  return normalizeWorkHubLocale(options?.locale);
}

export function uiT(locale: WorkHubLocale, key: UiCopyKey): string {
  return copy[key][locale];
}

export function uiCount(locale: WorkHubLocale, count: number, zhUnit: string, enSingular: string, enPlural = `${enSingular}s`) {
  return locale === "zh-CN" ? `${count} ${zhUnit}` : `${count} ${count === 1 ? enSingular : enPlural}`;
}

// UI-02：全站时间戳统一本地时区渲染——此前大量 slice(0,10)/slice(0,16) 直切 ISO 串，UTC 直出，
// 北京时间下午的事显示成当天上午。统一走 new Date + 本地分量格式化；形状保持既有的
// 「YYYY-MM-DD HH:MM」（两 locale 同形，沿用原视觉约定，不引入 toLocaleString 的 locale 标点差异）。
// 无效输入原样返回——渲染层不因为一条脏时间戳把整页搞炸。
export function formatLocalTimestamp(iso: string | undefined): string {
  if (!iso) {
    return "";
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// 纯日期渲染（YYYY-MM-DD）。输入本身已是日期串（无时刻，如 scope.date/due_at 日期字段）时原样透传——
// 那种值是按「日」存的，转成 Date 再按本地时区格式化会被时区挪到前一天。
export function formatLocalDate(iso: string | undefined): string {
  if (!iso) {
    return "";
  }
  if (/^\d{4}-\d{2}-\d{2}$/u.test(iso)) {
    return iso;
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function uiHumanize(value: string) {
  // 防御：上游枚举可能为 undefined/null(如 fixture 未填 run.status)，别让 label 查找崩在 .replace 上。
  return String(value ?? "").replace(/_/gu, " ");
}

export function uiFormatCny(value: string | number | null | undefined, locale: WorkHubLocale = "zh-CN") {
  // R3（en 用户）：裸 ¥ 对国际用户是「日元还是人民币」的歧义——en 用 CN¥ 国际写法，zh 保持 ¥。
  const prefix = locale === "en-US" ? "CN¥" : "¥";
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  if (!Number.isFinite(parsed)) {
    const fallback = String(value ?? "0").trim() || "0";
    return `${prefix}${fallback}`;
  }
  if (parsed > 0 && parsed < 0.005) {
    return `<${prefix}0.01`;
  }
  const amount = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0
  }).format(parsed);
  return `${prefix}${amount}`;
}

// WEB-09：成本页 token 大数字此前直出（0/5000000）——大数难读。统一千分位分组（zh-CN/en-US 的
// Intl 分组符同为逗号）。非法输入原样返回——同 formatLocalTimestamp 的「渲染层不因脏数据炸整页」纪律。
export function uiFormatCount(value: number | string | null | undefined, locale: WorkHubLocale = "zh-CN") {
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  if (!Number.isFinite(parsed)) {
    const fallback = String(value ?? "0").trim();
    return fallback || "0";
  }
  return new Intl.NumberFormat(locale === "en-US" ? "en-US" : "zh-CN", { maximumFractionDigits: 0 }).format(parsed);
}

// G4 #22/#35（通知类型标签，双端共享）：通知类型是点分命名空间
// （comment.mention / workitem.escalated / work_item.due_soon / conversation.message / agent_run.succeeded …）。
// 精确类型映射（双语）→ 命名空间前缀兜底（双语）→ 最后才 humanize，绝不把裸机器 token 抛给用户。
// 此前是 route-components.ts 里的私有函数（只 web 用）；#35 桌面「静音此类」文案也要走同一份标签，故上提到
// i18n（uiFormatCny 同款共享层），route-components 与桌面 dashboards 都从这里导入，不再各留一份。
// 自留注释：新增可静音/可展示的通知类型时，若中文界面会裸显英文 token，就在下方 exact 表补一条。
const NOTIFICATION_TYPE_EXACT: Record<string, [string, string]> = {
  "comment.mention": ["提到你", "Mention"],
  "workitem.claimed": ["已认领", "Claimed"],
  "workitem.escalated": ["需要负责人介入", "Needs owner"],
  "escalation.opened": ["需要负责人介入", "Needs owner"],
  "proposal.ready": ["改动待审", "Proposal ready"],
  "proposal.opened": ["改动待审", "Proposal ready"],
  "agent_run.step": ["AI 进展", "AI progress"], // term-allow：key 是事件名标识符，值已人话
  "agent_run.succeeded": ["AI 完成", "AI done"], // term-allow：key 是事件名标识符，值已人话
  "agent_run.failed": ["AI 失败", "AI failed"], // term-allow：key 是事件名标识符，值已人话
  "approval.decided": ["审批已定", "Decided"],
  "approval.delegated": ["审批转交", "Delegated"],
  "approval.expired": ["审批过期", "Expired"],
  "approval.commented": ["审批评论", "Comment"],
  "meeting.insight.pending": ["会议待办", "Meeting insight"],
  "drive.page": ["网盘更新", "Drive"],
  "system.notice": ["系统通知", "System"],
  milestone: ["里程碑", "Milestone"],
  "notification.created": ["新通知", "Update"],
  // R12 功能审查 F5：观察者派活问询（此前落进 humanize 兜底，渲成裸英文 "Action Card Item Dispatch Ask"）。
  "action_card_item.dispatch_ask": ["派活问询", "Dispatch ask"],
  // G-web 止血批：project.* 无命名空间前缀兜底（prefix 表没有 "project" key），此前渲出裸英文 "Project Risk Digest"。
  "project.risk_digest": ["风险巡检摘要", "Risk digest"],
  // G4 #22：R15 四阶梯 DDL 提醒（services/ddl-chase.ts 真实 publish 的 type 串，注意前缀是 work_item.）
  // 与会话消息通知（services/notifications.ts：conversation.message / conversation.mention）——此前中文界面
  // 裸显大写英文 token（"Work Item.due Soon" 等），补精确映射。
  "work_item.due_soon": ["到期提醒", "Due soon"],
  "work_item.overdue": ["已逾期", "Overdue"],
  "work_item.escalated_ddl": ["逾期需负责人介入", "Overdue — needs owner"],
  "work_item.needs_owner": ["待认领提醒", "Needs owner"],
  "conversation.message": ["新消息", "New message"],
  "conversation.mention": ["有人提到你", "Mentioned you"]
};

const NOTIFICATION_TYPE_PREFIX: Record<string, [string, string]> = {
  comment: ["评论", "Comment"],
  workitem: ["工作项", "Work item"],
  work_item: ["工作项", "Work item"],
  conversation: ["会话", "Conversation"],
  agent_run: ["AI 运行", "AI run"], // term-allow：key 是事件名前缀标识符，值已人话
  approval: ["审批", "Approval"],
  proposal: ["改动", "Proposal"],
  escalation: ["需要负责人介入", "Needs owner"],
  drive: ["网盘", "Drive"],
  drive_comment: ["网盘评论", "Drive comment"],
  meeting: ["会议", "Meeting"],
  budget: ["预算", "Budget"],
  system: ["系统", "System"],
  action_card_item: ["行动卡", "Action card"]
};

export function notificationTypeLabel(type: string, zh: boolean): string {
  const hit = NOTIFICATION_TYPE_EXACT[type];
  if (hit) {
    return zh ? hit[0] : hit[1];
  }
  const ns = NOTIFICATION_TYPE_PREFIX[type.split(".")[0] ?? type];
  if (ns) {
    return zh ? ns[0] : ns[1];
  }
  // uiHumanize 只 `_`→空格；点分命名空间还要把 `.` 也摊平后首字母大写，别渲成 "Foo.bar baz"。
  return type
    .replace(/[._]/gu, " ")
    .replace(/\b\w/gu, (char) => char.toUpperCase())
    .trim();
}

function labelFromMap(locale: WorkHubLocale, value: string, map: Record<string, Copy>) {
  return map[value]?.[locale] ?? uiHumanize(value);
}

export function workItemStatusLabel(locale: WorkHubLocale, status: WorkItemStatus | string) {
  return labelFromMap(locale, status, workItemStatusLabels);
}

export function taskPlanStatusLabel(locale: WorkHubLocale, status: TaskPlanStatus | string) {
  return labelFromMap(locale, status, taskPlanStatusLabels);
}

export function taskPlanItemRoleLabel(locale: WorkHubLocale, role: TaskPlanItemRole | string) {
  return labelFromMap(locale, role, taskPlanItemRoleLabels);
}

export function taskPlanItemStatusLabel(locale: WorkHubLocale, status: TaskPlanItemStatus | string) {
  return labelFromMap(locale, status, taskPlanItemStatusLabels);
}

export function agentRunStatusLabel(locale: WorkHubLocale, status: AgentRunStatus | string) {
  return labelFromMap(locale, status, agentRunStatusLabels);
}

export function agentStepPhaseLabel(locale: WorkHubLocale, phase: AgentStepPhase | string) {
  return labelFromMap(locale, phase, agentStepPhaseLabels);
}

export function agentStepPublicSummary(
  locale: WorkHubLocale,
  step: { phase?: AgentStepPhase | string | undefined; tool_name?: string | undefined; output_excerpt?: string | undefined }
) {
  switch (step.phase) {
    case "think":
      return uiT(locale, "agent.stepThinkingPublic");
    case "tool_call":
      return uiT(locale, "agent.stepToolCallGeneric");
    case "tool_result":
      return uiT(locale, "agent.stepToolResultGeneric");
    case "final":
      return step.output_excerpt ?? uiT(locale, "agent.stepFinalOutput");
    default:
      return step.output_excerpt ?? uiT(locale, "agent.stepFallback");
  }
}

export function deliverableTargetLabel(locale: WorkHubLocale, kind: DeliverableTargetKind | string) {
  return labelFromMap(locale, kind, deliverableTargetLabels);
}

export function evidenceSourceLabel(locale: WorkHubLocale, source: EvidenceSourceType | string) {
  return labelFromMap(locale, source, evidenceSourceLabels);
}

export function changeTypeLabel(locale: WorkHubLocale, type: string) {
  return labelFromMap(locale, type, changeTypeLabels);
}

export function checkStatusLabel(locale: WorkHubLocale, status: string) {
  return labelFromMap(locale, status, checkStatusLabels);
}

export function budgetStatusLabel(locale: WorkHubLocale, status: string) {
  return labelFromMap(locale, status, budgetStatusLabels);
}

export function proposalStatusLabel(locale: WorkHubLocale, status: string) {
  return labelFromMap(locale, status, proposalStatusLabels);
}

export function previewKindLabel(locale: WorkHubLocale, kind: string) {
  return labelFromMap(locale, kind, previewKindLabels);
}
