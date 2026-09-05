// 命令面板（../command-palette.ts 的 commandRegistry）展示文案词典。用户可见文案由 locale 独占
// （scripts/dev/check-ui-i18n.ts）：每条命令的 label/hint 双语文本住在这里，commandRegistry 里的
// 条目只留 CommandId 这一个 key，调用点用 commandPaletteCopy(id) 取回 { label, hint } 双语对。
// keywords 搜索词数组不是展示文案，原地留在 command-palette.ts（该文件 F1 处已有注释说明）。
//
// 形状照本仓 per-package locales.ts 的约定：中文对象是 key 集事实源，并直接 satisfies
// Record<CommandId, …>——少一个命令或多写一个都编译不过，不需要额外脚本盯注册表与词典是否同步；
// 英文对象同样 satisfies 对齐两侧字段。文案从 command-palette.ts 搬来时逐字未改。

import type { CommandId } from "../command-palette.js";

type CommandCopyEntry = { label: string; hint: string };

const zh = {
  intake: { label: "新任务 / 交给 AI", hint: "说清需求，AI 来做，你过目" },
  approvals: { label: "审批队列", hint: "待你拍板的审批与升级" },
  proposals: { label: "看改动", hint: "逐行看 AI 改了什么，再决定合不合" },
  workitem: { label: "任务", hint: "进行中的任务与交付物" },
  agents: { label: "Cuu 的小队", hint: "分工方案、子任务和卡点" },
  drive: { label: "网盘", hint: "文件、文档与 AI 交付物" },
  projects: { label: "项目", hint: "项目工作区与概览" },
  replay: { label: "回放", hint: "AI 每一步做了什么，可回退" },
  search: { label: "搜索全部", hint: "跨会话·网盘·任务·会议" },
  knowledge: { label: "知识检索", hint: "搜索攒下的知识与证据" },
  meetings: { label: "会议", hint: "转写、纪要与洞察卡片" },
  cost: { label: "成本", hint: "AI 花费、预算与分账" },
  team: { label: "团队", hint: "成员、日历与技能库" },
  notifications: { label: "通知", hint: "通知箱与按类型静音" },
  settings: { label: "设置", hint: "偏好、桌宠与账户" },
  memory: { label: "Cuu 的记忆", hint: "关于我的偏好、团队技能库" },
  workbench: { label: "打开工作台", hint: "项目群聊、网盘、小队在一个窗口里" },
  new_project: { label: "新建项目", hint: "自动配好群聊、网盘和 Cuu" }
} satisfies Record<CommandId, CommandCopyEntry>;

const en = {
  intake: { label: "New task / Ask AI", hint: "Clarify, let AI work, you review" },
  approvals: { label: "Approvals", hint: "Decisions waiting on you" },
  proposals: { label: "Review changes", hint: "See what changed line by line, then merge" },
  workitem: { label: "Tasks", hint: "Tasks and deliverables" },
  agents: { label: "Cuu's squads", hint: "Plans, subtasks, blockers" },
  drive: { label: "Drive", hint: "Files, docs, AI deliverables" },
  projects: { label: "Projects", hint: "Project workspaces" },
  replay: { label: "Replay", hint: "Every step the AI took, with rollback points" },
  search: { label: "Search all", hint: "Across chat, drive, tasks, meetings" },
  knowledge: { label: "Knowledge", hint: "Search knowledge and evidence" },
  meetings: { label: "Meetings", hint: "Transcripts, minutes, and insight cards" },
  cost: { label: "Cost", hint: "Spend, budget, labor split" },
  team: { label: "Team", hint: "Members, calendar, skills" },
  notifications: { label: "Notifications", hint: "Inbox and per-type mute" },
  settings: { label: "Settings", hint: "Preferences, pet, account" },
  memory: { label: "Cuu's memory", hint: "What Cuu knows about you and your team" },
  workbench: { label: "Open workbench", hint: "Team chat, drive, and squads in one window" },
  new_project: { label: "New project", hint: "Sets up chat, drive, and Cuu for you" }
} satisfies Record<CommandId, CommandCopyEntry>;

export type CommandPaletteBilingual = { "zh-CN": string; en: string };

/** 某条命令的 label/hint 双语对；commandRegistry 逐条 `...commandPaletteCopy(id)` 展开使用。 */
export function commandPaletteCopy(id: CommandId): { label: CommandPaletteBilingual; hint: CommandPaletteBilingual } {
  return {
    label: { "zh-CN": zh[id].label, en: en[id].label },
    hint: { "zh-CN": zh[id].hint, en: en[id].hint }
  };
}
