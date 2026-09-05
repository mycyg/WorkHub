// 服务层产出的用户可见文案（错误消息、升级说明、审阅结论）的单一来源。
//
// 形状照 packages/ui/src/locales.ts：中文对象是 key 集事实源，英文对象用
// `satisfies Record<keyof typeof zh, string>` 做编译期对齐。
// 文案 locale 独占门禁：含汉字的字面量只许住在词典文件里，见 scripts/dev/check-ui-i18n.ts。
//
// 说明：这一层的多数调用点历史上没有 locale（服务层错误只产中文），迁进来时先按原行为
// 传 "zh-CN"；把 locale 一路传下去是另一件事，不该和「文案搬家」混在一批里。

import { normalizeWorkHubLocale, type WorkHubLocale } from "@workhub/contracts";

const zh = {
  // 只能人来做（human-reserved-guard）
  humanReservedHandoff: "「{title}」被标记为只能人来做，已经转给负责人接手。",
  humanReservedHighRisk: "「{title}」这一步涉及{category}类高风险动作，已经停下来等人确认。",
  humanReservedDone: "已确认这件事被标记为只能人来做。",
  humanReservedOwnerNext: "请负责人确认接手人和下一步计划。",
  humanReservedBlocker: "这件事被指定为只能人来做。",
  highRiskToolDone: "已停下{category}类高风险动作。",
  highRiskToolTodo: "请负责人确认是否允许这个动作，并由人来做或调整任务范围。",
  highRiskToolBlocker: "法务、财务、身份、对外发布、外部系统这几类高风险动作，AI 不会自己做。",

  // 项目计划（project-planner）
  planUnusable: "这次没能生成可用的计划，请补充一下规划意图再试一次。",
  planNotApproved: "只有已批准的计划才能生成任务。",
  planCycleRejected: "这份计划里的任务互相依赖成了死循环，没有生成任何任务。请调整依赖后重新生成计划。",
  planCycleError: "这份计划里的任务互相依赖成了死循环，没有生成任何任务，计划已打回。",

  // 变更申请与字段合并（proposals）
  fieldDuplicateChoice: "「{field}」被选了两次，请只保留一个选择。",
  fieldNotInSuggestion: "「{field}」不在这次字段建议里。",
  fieldItemDuplicateChoice: "「{field}」里有一条被选了两次，请只保留一个选择。",
  fieldNotItemized: "「{field}」不能逐条编辑。",
  fieldItemNotInSuggestion: "「{field}」里有一条不在这次字段建议里。",
  fieldPatchPrecheckFailed: "这份字段建议没通过写入前的检查，不能直接采纳。",
  fieldTitle: "标题",
  fieldSummary: "说明",
  fieldPriority: "优先级",
  fieldDueAt: "截止时间",
  fieldAcceptanceItems: "验收项",
  fieldTaskItems: "任务项",
  fieldFallback: "这一项",

  // 审批（approvals）
  anotherMember: "其他成员",

  // 预算（escalations）
  budgetUsageLine: "已用掉 {pct}% 的预算（{used} / {max}），还剩 {left}。",

  // AI 复核（cross-agent-judge）
  judgeAdopted: "采用了：{name}",
  judgeAdoptedFallback: "其中一份产出",
  judgeLowConfidence: "AI 对这次结论把握不足，建议人来确认。",
  judgeSelectedMissing: "复核选中的那份产出已经不存在了。",
  judgeSelectedMissingSummary: "复核说要采用其中一份产出，但没有指明是哪一份，已停下等人确认。",
  judgeMergeNoContent: "复核说要合并，却没有给出合并后的内容。",
  judgeMergeNoContentSummary: "复核说要合并多份产出，但没有给出合并结果，已停下等人确认。",
  judgeHighRiskEscalated: "这是高风险改动，多轮复核里至少有一轮建议交给人确认。",
  judgeHighRiskEscalatedSummary: "高风险复核建议交给人确认。",
  judgeHighRiskSplit: "这是高风险改动，多轮复核没有形成一致结论。",
  judgeHighRiskSplitSummary: "高风险复核意见不一致，没有可靠的多数结论。",
  judgeHighRiskMajority: "高风险复核形成了一致结论：{decision}。",
  judgeHighRiskMajoritySummary: "高风险复核形成了一致结论。",
  judgeUnreadable: "复核这次没有给出可读的结论。",
  judgeUnreadableSummary: "复核这次没有给出可读的结论，已停下等人确认。",
  judgeTooFewCandidates: "只有一份产出，没有可比对的第二份。",
  judgeTooFewCandidatesSummary: "只有一份产出，无法互相比对，已停下等人确认。",
  judgeTooManyCandidates: "一次最多比对 {max} 份产出，这次超出了。",
  judgeTooManyCandidatesSummary: "一次最多比对 {max} 份产出，这次超出了，已停下等人确认，不会悄悄丢掉多出来的部分。",
  judgeMissingProvenance: "有一份产出缺少可追溯的来源，没法确认复核是独立的。",
  judgeMissingProvenanceSummary: "有一份产出缺少可追溯的来源，没法确认复核是独立的，已停下等人确认。",
  judgeNotIndependent: "复核和产出用的是同一来源，不算独立复核。",
  judgeNotIndependentSummary: "复核和产出用的是同一来源，不算独立复核，已停下等人确认。",
  judgeProviderMissing: "还没有配置可用的 AI 服务，复核跑不了。",
  judgeProviderMissingSummary: "还没有配置可用的 AI 服务，这次没有复核，已停下等人确认。",

  // 文本逐段合并（proposals）
  textCurrentUnreadable: "这个文件读不出来，或者不是纯文本，没法逐段合并。",
  textBaseMissing: "找不到改动前的原始版本，没法逐段合并——请整篇采纳，或让 AI 重新生成建议。",
  textBaseUnreadable: "改动前的原始版本读不出来，或者不是纯文本，没法逐段合并。",
  textBaseStale: "原始版本已经变了，请让 AI 重新生成合并建议。",
  textIncomingUnreadable: "这次版本的文件读不出来，或者不是纯文本，没法逐段合并。",
  mergeSuggestionNotFound: "没有找到这个合并建议，请刷新后重试。",
  proposalWrongTask: "这份变更申请不属于这个任务，请刷新后重试。",

  // 任务计划（task-plans）
  planStructureCheck: "每个子任务都写了验收标准，任务之间没有互相等待的死循环，预算加起来正好 100%。",

  // 任务（work-items）
  clarifyTitleFallback: "这次交付要依据哪份材料？",
  scopeDocumentDescription: "适合周报、方案、说明书、变更说明。",
  scopeDocumentImpact: "只改文件，不动其他东西，风险最低。",
  pendingClarification: "待澄清的任务",
  pendingClarificationSentence: "待澄清的任务。",
  clarifyQuestionGone: "这个会话的澄清问题还没生成或已失效。请重新进入这个任务的澄清流程再试一次。",
  taskViewForbidden: "你没有权限查看这个任务。",
  taskEditForbidden: "你没有权限修改这个任务。",
  taskDeliverableEditForbidden: "你没有权限修改这个任务的正式交付物。",
  taskNotFound: "没有找到这个任务。",
  taskCannotRefinalize: "这个任务的当前状态不允许重新定稿；若刚提交过新的澄清回答，请刷新后重试。",
  knowledgeSearchScopeRequired: "请在具体任务或项目内检索。",

  // 执行（agent-runner）
  subtaskStuck: "这个子任务卡住了，自动恢复也没成功。到决策收件箱里选：重试、转成我来做，或取消。",
  runStuck: "这次执行卡住了，自动恢复也没成功。到决策收件箱里选：重试、转成我来做，或取消。",
  fullAutonomyAdopted: "在「全托管」下，AI 复核通过后按你的授权直接采纳。",
  budgetUncheckable: "预算暂时算不出来，这次没有启动，请稍后再试。",
  budgetFullyReserved: "正在跑的任务已经占满了预算，这次没能开始。等其中一个跑完，或者先调高预算。",
  runRecoveredRequeued: "这次执行已恢复，正在重新排队。"
} as const;

const en = {
  humanReservedHandoff: "\"{title}\" is marked people-only, so it's been handed to its owner.",
  humanReservedHighRisk: "\"{title}\" involves a high-risk {category} action, so it's paused for a person to confirm.",
  humanReservedDone: "Confirmed this item is marked people-only.",
  humanReservedOwnerNext: "Ask the owner to confirm who takes it over and what happens next.",
  humanReservedBlocker: "This item is marked people-only.",
  highRiskToolDone: "Stopped a high-risk {category} action.",
  highRiskToolTodo: "Ask the owner whether this action is allowed, then do it by hand or narrow the task.",
  highRiskToolBlocker: "AI never performs legal, finance, identity, external-publishing or external-system actions on its own.",

  planUnusable: "Couldn't produce a usable plan this time. Add a bit more detail to your goal and try again.",
  planNotApproved: "Only an approved plan can create its tasks.",
  planCycleRejected: "Tasks in this plan depend on each other in a loop, so nothing was created. Adjust the dependencies and plan again.",
  planCycleError: "Tasks in this plan depend on each other in a loop, so nothing was created and the plan was sent back.",

  fieldDuplicateChoice: "\"{field}\" was chosen twice; keep just one choice.",
  fieldNotInSuggestion: "\"{field}\" is not part of this field suggestion.",
  fieldItemDuplicateChoice: "One entry under \"{field}\" was chosen twice; keep just one choice.",
  fieldNotItemized: "\"{field}\" can't be edited entry by entry.",
  fieldItemNotInSuggestion: "One entry under \"{field}\" is not part of this field suggestion.",
  fieldPatchPrecheckFailed: "This field suggestion failed its pre-check and can't be adopted directly.",
  fieldTitle: "Title",
  fieldSummary: "Summary",
  fieldPriority: "Priority",
  fieldDueAt: "Due date",
  fieldAcceptanceItems: "Acceptance items",
  fieldTaskItems: "Task items",
  fieldFallback: "This field",

  anotherMember: "Another member",

  budgetUsageLine: "Used {pct}% of the budget ({used} of {max}); {left} left.",

  judgeAdopted: "Adopted: {name}",
  judgeAdoptedFallback: "one of the outputs",
  judgeLowConfidence: "AI isn't confident about this call — a person should confirm it.",
  judgeSelectedMissing: "The output the review picked no longer exists.",
  judgeSelectedMissingSummary: "The review said to adopt one output but didn't say which, so it stopped for a person to confirm.",
  judgeMergeNoContent: "The review said to merge but gave no merged content.",
  judgeMergeNoContentSummary: "The review said to merge the outputs but gave no merged result, so it stopped for a person to confirm.",
  judgeHighRiskEscalated: "This is a high-risk change and at least one review round asked for a person to confirm.",
  judgeHighRiskEscalatedSummary: "The high-risk review asks for a person to confirm.",
  judgeHighRiskSplit: "This is a high-risk change and the review rounds did not agree.",
  judgeHighRiskSplitSummary: "The high-risk review rounds disagreed, with no reliable majority.",
  judgeHighRiskMajority: "The high-risk review agreed on: {decision}.",
  judgeHighRiskMajoritySummary: "The high-risk review reached agreement.",
  judgeUnreadable: "The review didn't return a readable conclusion this time.",
  judgeUnreadableSummary: "The review didn't return a readable conclusion, so it stopped for a person to confirm.",
  judgeTooFewCandidates: "There is only one output, so there's nothing to compare it with.",
  judgeTooFewCandidatesSummary: "There is only one output to compare, so it stopped for a person to confirm.",
  judgeTooManyCandidates: "At most {max} outputs can be compared at once, and this exceeded that.",
  judgeTooManyCandidatesSummary: "At most {max} outputs can be compared at once. This exceeded that, so it stopped for a person to confirm rather than quietly dropping the rest.",
  judgeMissingProvenance: "One output has no traceable source, so independence can't be confirmed.",
  judgeMissingProvenanceSummary: "One output has no traceable source, so independence can't be confirmed and it stopped for a person to confirm.",
  judgeNotIndependent: "The review and the output came from the same source, so it isn't an independent review.",
  judgeNotIndependentSummary: "The review and the output came from the same source, so it isn't independent and it stopped for a person to confirm.",
  judgeProviderMissing: "No AI service is configured, so the review can't run.",
  judgeProviderMissingSummary: "No AI service is configured, so there was no review and it stopped for a person to confirm.",

  textCurrentUnreadable: "This file can't be read as plain text, so it can't be merged section by section.",
  textBaseMissing: "The original version is missing, so section-by-section merging isn't possible — adopt the whole file, or ask AI to regenerate the suggestion.",
  textBaseUnreadable: "The original version can't be read as plain text, so it can't be merged section by section.",
  textBaseStale: "The original changed — ask AI to regenerate the merge suggestion.",
  textIncomingUnreadable: "This version's file can't be read as plain text, so it can't be merged section by section.",
  mergeSuggestionNotFound: "That merge suggestion wasn't found — refresh and try again.",
  proposalWrongTask: "This change request doesn't belong to this task. Refresh and try again.",

  planStructureCheck: "Every subtask has acceptance criteria, none of them wait on each other in a loop, and the budget adds up to 100%.",

  clarifyTitleFallback: "Which material should this be based on?",
  scopeDocumentDescription: "Good for weekly updates, proposals, specs and change notes.",
  scopeDocumentImpact: "Only files change — nothing else is touched, so the risk is lowest.",
  pendingClarification: "Task awaiting clarification",
  pendingClarificationSentence: "Task awaiting clarification.",
  clarifyQuestionGone: "This session's clarification questions haven't been generated or have expired. Start the task's clarification again.",
  taskViewForbidden: "You don't have permission to view this task.",
  taskEditForbidden: "You don't have permission to edit this task.",
  taskDeliverableEditForbidden: "You don't have permission to edit this task's accepted deliverables.",
  taskNotFound: "That task wasn't found.",
  taskCannotRefinalize: "This task's current status doesn't allow re-finalizing. If you just submitted new answers, refresh and try again.",
  knowledgeSearchScopeRequired: "Search inside a specific task or project.",

  subtaskStuck: "This subtask is stuck and auto-recovery failed. In your decision inbox choose retry, take it over, or cancel.",
  runStuck: "This run is stuck and auto-recovery failed. In your decision inbox choose retry, take it over, or cancel.",
  fullAutonomyAdopted: "Under full autonomy, AI adopts its own work after its review, as you authorized.",
  budgetUncheckable: "Budget couldn't be checked just now, so this didn't start. Try again shortly.",
  budgetFullyReserved: "Running tasks are already using the full budget, so this one didn't start. Wait for one to finish, or raise the budget.",
  runRecoveredRequeued: "This run recovered and is back in the queue."
} as const satisfies Record<keyof typeof zh, string>;

export type ServiceCopyKey = keyof typeof zh;

export function serviceT(locale: WorkHubLocale, key: ServiceCopyKey): string {
  return (normalizeWorkHubLocale(locale) === "zh-CN" ? zh : en)[key];
}

/** 带占位符的词典条目：`{name}` 按 vars 替换。整句留在词典里，调用点只提供值。 */
export function serviceTf(
  locale: WorkHubLocale,
  key: ServiceCopyKey,
  vars: Record<string, string | number>
): string {
  return Object.entries(vars).reduce(
    (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
    serviceT(locale, key)
  );
}
