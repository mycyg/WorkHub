// apps/desktop-webview/src/spotlight 的用户可见文案单一来源。
//
// 形状照 deepseek-harness 的 per-package `locales.ts`（MIT, Copyright (c) 2026 DeepSeek）：
// **中文对象是 key 集的事实源**，英文对象用 `satisfies Record<keyof typeof zh, string>` 做
// 编译期对齐——少一个键或多一个键都编译不过，不需要额外的门禁脚本来盯对称性。
//
// 这些字符串原本以 `zh ? "中文" : "English"` 内联在渲染代码里；搬进来时一个字都没改。
// 门禁见 scripts/dev/check-ui-i18n.ts（含汉字的字面量只许住在词典文件里）。

import { normalizeWorkHubLocale, type WorkHubLocale } from "@workhub/contracts";

const zh = {
  aProjectIsWhereYourTeam: "项目是团队协作和 Cuu 干活的地方——建好就直接带你进去。",
  aiIsOrganizingTheMaterialsAnd: "AI 正在整理材料，稍后给你下一步。",
  askCuu: "问问 Cuu",
  back: "返回",
  callingATool: "正在调用工具。",
  cancel: "取消",
  capabilities: "功能列表",
  confirm: "确认",
  couldnTCreateTheProjectRetry: "创建失败，请重试。",
  createAndOpen: "创建并打开",
  createYourFirstProject: "建你的第一个项目",
  creating: "创建中…",
  cuuCouldnTWorkThatOut: "Cuu 没能理解这句话，请再试一次或换个说法。",
  enter: "回车",
  finalOutputIsReady: "最终输出已生成。",
  gotIt: "知道了",
  handThisToCuuAsA: "把这句话当新任务交给 Cuu",
  notAConversationNothingIsSaved: "这不是会话，不会保存",
  otherNote: "其它记录",
  nothingMatchedYouCanAskCuu: "没找到对应的功能，你可以直接问问 Cuu",
  pending: "待处理",
  pleaseEnterAProjectNameFirst: "请先填写项目名称。",
  pressEscAgainToDiscardYour: "再按一次 Esc 放弃未提交的内容",
  pressThisAnytimeToBringThe: "随时按这个组合键唤起（隐藏后也一样）",
  projectCreatedThisPreviewCanT: "项目已创建。在 WorkHub 桌面应用里打开它的工作台。",
  projectNameEGMarketingOps: "项目名称，例如：市场部日常",
  recordedOneStep: "记录了一个步骤。",
  // R26 批 B6 观测面：重复动作「先劝再断」的两档提醒在回放时间线上的人话行。八条都是完整句子
  // （档位 × 重复形态 × 有没有工具名），与 web 端 packages/ui i18n.ts 的 agent.reminder* 同口径、同措辞。
  // {repeats} 是连续重复步数，{tools} 是已人话化并加引号的工具名。
  reminderPhase: "换个做法",
  reminderIdenticalToolFirst: "第一次提醒：Cuu 连续 {repeats} 步做了同一件事（重复的是{tools}），已让它换个做法再继续。",
  reminderIdenticalPlainFirst: "第一次提醒：Cuu 连续 {repeats} 步做了同一件事，已让它换个做法再继续。",
  reminderAlternatingToolFirst: "第一次提醒：Cuu 连续 {repeats} 步在两个动作之间来回切换（来回切换的是{tools}），已让它换个做法再继续。",
  reminderAlternatingPlainFirst: "第一次提醒：Cuu 连续 {repeats} 步在两个动作之间来回切换，已让它换个做法再继续。",
  reminderIdenticalToolSecond: "第二次提醒：Cuu 连续 {repeats} 步做了同一件事（重复的是{tools}）。再重复下去，这次执行会自动交给人接手。",
  reminderIdenticalPlainSecond: "第二次提醒：Cuu 连续 {repeats} 步做了同一件事。再重复下去，这次执行会自动交给人接手。",
  reminderAlternatingToolSecond: "第二次提醒：Cuu 连续 {repeats} 步在两个动作之间来回切换（来回切换的是{tools}）。再重复下去，这次执行会自动交给人接手。",
  reminderAlternatingPlainSecond: "第二次提醒：Cuu 连续 {repeats} 步在两个动作之间来回切换。再重复下去，这次执行会自动交给人接手。",
  restorePoint: "还原点",
  retry: "重试",
  step: "步骤",
  toolResultReceivedAiIsOrganizing: "工具已返回，AI 正在整理下一步。",
  undo: "撤回",
  unknownRiskLevel: "风险未知",
  unknownStatus: "未知状态",
  unspecified: "未标注",
  whatDoYouNeedNewTask: "想做点什么？新任务 / 审批 / 网盘 / 项目…",
  workhubHandWorkToCuuYou: "WorkHub · 把活交给 Cuu，你来拍板<br>输入关键词，或选一个开始；Esc 关闭",
} as const;

const en = {
  aProjectIsWhereYourTeam: "A project is where your team and Cuu get to work — we'll open it as soon as it's ready.",
  aiIsOrganizingTheMaterialsAnd: "AI is organizing the materials and preparing the next step.",
  askCuu: "Ask Cuu",
  back: "Back",
  callingATool: "Calling a tool.",
  cancel: "Cancel",
  capabilities: "Features",
  confirm: "Confirm",
  couldnTCreateTheProjectRetry: "Couldn't create the project — retry.",
  createAndOpen: "Create and open",
  createYourFirstProject: "Create your first project",
  creating: "Creating…",
  cuuCouldnTWorkThatOut: "Cuu couldn't work that out — try again or rephrase.",
  enter: "Enter",
  finalOutputIsReady: "Final output is ready.",
  gotIt: "Got it",
  handThisToCuuAsA: "Hand this to Cuu as a new task",
  notAConversationNothingIsSaved: "Not a conversation — nothing is saved",
  otherNote: "Other note",
  nothingMatchedYouCanAskCuu: "Nothing matched — you can ask Cuu directly",
  pending: "pending",
  pleaseEnterAProjectNameFirst: "Please enter a project name first.",
  pressEscAgainToDiscardYour: "Press Esc again to discard your input",
  pressThisAnytimeToBringThe: "Press this anytime to bring the box back — even while hidden",
  projectCreatedThisPreviewCanT: "Project created. Open its workbench from the WorkHub desktop app.",
  projectNameEGMarketingOps: "Project name, e.g. Marketing ops",
  recordedOneStep: "Recorded one step.",
  reminderPhase: "Change of approach",
  reminderIdenticalToolFirst: "First reminder: Cuu repeated the same action for {repeats} steps (it kept using {tools}). Asked it to try another approach.",
  reminderIdenticalPlainFirst: "First reminder: Cuu repeated the same action for {repeats} steps. Asked it to try another approach.",
  reminderAlternatingToolFirst: "First reminder: Cuu kept switching between two actions for {repeats} steps (switching between {tools}). Asked it to try another approach.",
  reminderAlternatingPlainFirst: "First reminder: Cuu kept switching between two actions for {repeats} steps. Asked it to try another approach.",
  reminderIdenticalToolSecond: "Second reminder: Cuu repeated the same action for {repeats} steps (it kept using {tools}). If it keeps going, this run is handed to a person.",
  reminderIdenticalPlainSecond: "Second reminder: Cuu repeated the same action for {repeats} steps. If it keeps going, this run is handed to a person.",
  reminderAlternatingToolSecond: "Second reminder: Cuu kept switching between two actions for {repeats} steps (switching between {tools}). If it keeps going, this run is handed to a person.",
  reminderAlternatingPlainSecond: "Second reminder: Cuu kept switching between two actions for {repeats} steps. If it keeps going, this run is handed to a person.",
  restorePoint: "Restore point",
  retry: "Retry",
  step: "Step",
  toolResultReceivedAiIsOrganizing: "Tool result received; AI is organizing the next step.",
  undo: "Undo",
  unknownRiskLevel: "Risk unknown",
  unknownStatus: "Unknown status",
  unspecified: "Unspecified",
  whatDoYouNeedNewTask: "What do you need? new task / approve / drive…",
  workhubHandWorkToCuuYou: "WorkHub · hand work to Cuu, you decide<br>Type or pick one to start; Esc to close",
} as const satisfies Record<keyof typeof zh, string>;

export type SpotlightCopyKey = keyof typeof zh;

// 第一参数收 `boolean` 是过渡口子：这一层的渲染函数历史上大量以 `zh: boolean` 传语言，
// 把这些签名一起改成 `locale` 是另一件事，不该和「文案搬家」混在一批里。
export function spotlightT(locale: WorkHubLocale | boolean, key: SpotlightCopyKey): string {
  return (isZhLocale(locale) ? zh : en)[key];
}

function isZhLocale(locale: WorkHubLocale | boolean): boolean {
  return typeof locale === "boolean" ? locale : normalizeWorkHubLocale(locale) === "zh-CN";
}

// —— 枚举 → 标签的对照表 ——
// 原本以 `["中文", "English"]` 元组内联在 labels.ts 里。元组读不出「哪个是中文」，也没法让编译器
// 盯住两侧对称，所以搬进来时拆成 zh/en 两张表：中文表是 key 集事实源，英文表 satisfies 对齐——
// 少一个枚举取值或多一个都编译不过。文案逐字未改。
const zhEnumLabels = {
  agentRunStatus: {
    queued: "排队中",
    running: "进行中",
    succeeded: "已完成",
    failed: "失败",
    escalated: "已升级",
    cancelled: "已取消"
  },
  agentStepPhase: {
    think: "思考",
    tool_call: "调用工具",
    tool_result: "工具结果",
    final: "最终整理"
  },
  meetingInsightKind: {
    new_requirement: "新需求",
    requirement_change: "需求变更",
    normal_note: "普通记录"
  },
  meetingInsightStatus: {
    pending: "待确认",
    confirmed: "已确认",
    dismissed: "已忽略"
  },
  meetingRecordStatus: {
    transcribed: "转写已导入",
    processing: "处理中",
    ready: "已就绪",
    failed: "失败"
  },
  riskHint: {
    low: "低风险",
    medium: "中风险",
    high: "高风险"
  },
  snapshotKind: {
    pre_step: "这一步执行前的还原点",
    merge: "合并前的还原点",
    manual: "你手动存的还原点",
    base: "最初的还原点"
  },
  workItemPriority: {
    low: "低",
    normal: "普通",
    high: "高",
    urgent: "紧急"
  },
  workItemStatus: {
    intake: "接收中",
    ai_clarifying: "澄清中",
    spec_ready: "规格已就绪",
    ai_working: "AI 正在处理",
    in_progress: "进行中",
    in_review: "待审阅",
    delivery_ready: "待交付",
    escalated: "已升级",
    pm_mode: "人工接管",
    merged: "已合并",
    accepted: "已采纳",
    done: "已完成",
    cancelled: "已取消"
  }
} as const;

const enEnumLabels = {
  agentRunStatus: {
    queued: "Queued",
    running: "In progress",
    succeeded: "Succeeded",
    failed: "Failed",
    escalated: "Escalated",
    cancelled: "Cancelled"
  },
  agentStepPhase: {
    think: "Thinking",
    tool_call: "Tool call",
    tool_result: "Tool result",
    final: "Final"
  },
  meetingInsightKind: {
    new_requirement: "New requirement",
    requirement_change: "Requirement change",
    normal_note: "Note"
  },
  meetingInsightStatus: {
    pending: "Pending",
    confirmed: "Confirmed",
    dismissed: "Dismissed"
  },
  meetingRecordStatus: {
    transcribed: "Transcript imported",
    processing: "Processing",
    ready: "Ready",
    failed: "Failed"
  },
  riskHint: {
    low: "Low risk",
    medium: "Medium risk",
    high: "High risk"
  },
  snapshotKind: {
    pre_step: "Restore point before this step",
    merge: "Restore point before the merge",
    manual: "Restore point you created",
    base: "Original restore point"
  },
  workItemPriority: {
    low: "Low",
    normal: "Normal",
    high: "High",
    urgent: "Urgent"
  },
  workItemStatus: {
    intake: "Intake",
    ai_clarifying: "Clarifying",
    spec_ready: "Spec ready",
    ai_working: "AI working",
    in_progress: "In progress",
    in_review: "In review",
    delivery_ready: "Delivery ready",
    escalated: "Escalated",
    pm_mode: "Handled by a person",
    merged: "Merged",
    accepted: "Accepted",
    done: "Done",
    cancelled: "Cancelled"
  }
} as const satisfies {
  [Group in keyof typeof zhEnumLabels]: Record<keyof (typeof zhEnumLabels)[Group], string>;
};

export type SpotlightEnumGroup = keyof typeof zhEnumLabels;

/**
 * 查一个枚举取值的本地化标签。
 * @returns 表里没有这个取值时返回 undefined——兜底怎么说由调用方决定（有的原样渲染裸值，
 *   有的换一句人话），这里不替它决定。
 */
export function spotlightEnumLabel(
  group: SpotlightEnumGroup,
  value: string,
  locale: WorkHubLocale | boolean
): string | undefined {
  const table: Record<string, string | undefined> = (isZhLocale(locale) ? zhEnumLabels : enEnumLabels)[group];
  return table[value];
}
