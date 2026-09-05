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
  capabilities: "能力列表",
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
  nothingMatchedYouCanAskCuu: "没找到对应的功能，你可以直接问问 Cuu",
  pending: "待处理",
  pleaseEnterAProjectNameFirst: "请先填写项目名称。",
  pressEscAgainToDiscardYour: "再按一次 Esc 放弃未提交的内容",
  pressThisAnytimeToBringThe: "随时按这个组合键唤起（隐藏后也一样）",
  projectCreatedThisPreviewCanT: "项目已创建，这个预览环境打不开工作台窗口。",
  projectNameEGMarketingOps: "项目名称，例如：市场部日常",
  recordedOneStep: "记录了一个步骤。",
  retry: "重试",
  step: "步骤",
  toolResultReceivedAiIsOrganizing: "工具已返回，AI 正在整理下一步。",
  undo: "撤回",
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
  capabilities: "Capabilities",
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
  nothingMatchedYouCanAskCuu: "Nothing matched — you can ask Cuu directly",
  pending: "pending",
  pleaseEnterAProjectNameFirst: "Please enter a project name first.",
  pressEscAgainToDiscardYour: "Press Esc again to discard your input",
  pressThisAnytimeToBringThe: "Press this anytime to bring the box back — even while hidden",
  projectCreatedThisPreviewCanT: "Project created — this preview can't open the workbench window.",
  projectNameEGMarketingOps: "Project name, e.g. Marketing ops",
  recordedOneStep: "Recorded one step.",
  retry: "Retry",
  step: "Step",
  toolResultReceivedAiIsOrganizing: "Tool result received; AI is organizing the next step.",
  undo: "Undo",
  whatDoYouNeedNewTask: "What do you need? new task / approve / drive…",
  workhubHandWorkToCuuYou: "WorkHub · hand work to Cuu, you decide<br>Type or pick one to start; Esc to close",
} as const satisfies Record<keyof typeof zh, string>;

export type SpotlightCopyKey = keyof typeof zh;

// 第一参数收 `boolean` 是过渡口子：这一层的渲染函数历史上大量以 `zh: boolean` 传语言，
// 把这些签名一起改成 `locale` 是另一件事，不该和「文案搬家」混在一批里。
export function spotlightT(locale: WorkHubLocale | boolean, key: SpotlightCopyKey): string {
  const isZh = typeof locale === "boolean" ? locale : normalizeWorkHubLocale(locale) === "zh-CN";
  return (isZh ? zh : en)[key];
}
