// WorkHub R8 客户端 · Cuu 能力注册表 + 模糊匹配路由（desktop-only）。
// 「极简交互 + 所有后端功能有机集成」的核心：一个输入框，输入意图 → 模糊匹配 → 直达任意能力
// （派活/澄清·审批·改动diff·网盘·项目·工作项·回放·成本·知识·团队·设置）。
// 匹配是纯逻辑（高度可单测），由 Spotlight launcher（spotlight/state.ts）消费。
// WIRE-05：旧的玻璃命令面板渲染层（renderCommandPalette/commandPaletteCss/resolveCommandAction）
// 自死 boot() 删除后零活调用方，已删——能力打开走 Spotlight 盒子，不再有独立浮层面板。

export type CommandId =
  | "intake"
  | "approvals"
  | "proposals"
  | "workitem"
  | "agents"
  | "drive"
  | "projects"
  | "replay"
  // R14 批 SEARCH：跨会话·网盘·工单·会议的统一检索入口——注册顺序刻意排在 knowledge 之前，两者
  // 的 keywords 都含「搜索/search」，注册表顺序即打平分时的默认胜出方（见 command-palette.test.ts）。
  | "search"
  | "knowledge"
  // F-09：会议（转写/纪要/洞察卡）——项目内能力，紧挨 knowledge（同属"项目内容检索/浏览"一类）。
  | "meetings"
  | "cost"
  | "team"
  | "notifications"
  | "settings"
  // R14 批 MEM：Cuu 的记忆——独立能力视图（不是塞进 settings 内联区块，见 spotlight/views/memory.ts
  // 顶部注释）。两个 tab：关于我（用户记忆）/ 团队技能。
  | "memory"
  // R12 批 1：工作台是独立原生窗口（workhub://workbench 深链），不是盒子内联能力——这两条的 view
  // 只 invoke Tauri command "open_workbench" 打开/聚焦那个窗口，见 spotlight/views/workbench-open.ts。
  | "workbench"
  | "new_project";

// 命令落到客户端的两类动作：开一个临时玻璃窗，或触发一次流程（如开始 intake）。
export type CommandActionKind = "open-window" | "start-flow";

export type DesktopCommand = {
  id: CommandId;
  label: { "zh-CN": string; en: string };
  hint: { "zh-CN": string; en: string };
  keywords: string[];
  icon: string; // 内联 SVG inner markup（viewBox 0 0 24 24，stroke=currentColor），离线安全、非 emoji
  action: { kind: CommandActionKind; target: string };
};

export type CommandMatch = { command: DesktopCommand; score: number };

type PaletteLocale = "zh-CN" | "en";

function normalizeLocale(locale: string | undefined): PaletteLocale {
  return locale && locale.toLowerCase().startsWith("zh") ? "zh-CN" : "en";
}

// 简单内联 SVG 图标（stroke 线性，几何简单可控、currentColor 跟随强调色）。
const ic = (inner: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;

// 能力注册表（覆盖全部后端能力，默认顺序即空查询时的优先序）。
export const commandRegistry: DesktopCommand[] = [
  {
    id: "intake",
    label: { "zh-CN": "新任务 / 交给 AI", en: "New task / Ask AI" },
    hint: { "zh-CN": "说清需求，AI 来做，你过目", en: "Clarify, let AI work, you review" },
    keywords: ["派活", "新任务", "提需求", "干活", "澄清", "dispatch", "new task", "intake", "clarify"],
    icon: ic('<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>'),
    action: { kind: "start-flow", target: "intake" }
  },
  {
    id: "approvals",
    label: { "zh-CN": "审批队列", en: "Approvals" },
    hint: { "zh-CN": "待你拍板的审批与升级", en: "Decisions waiting on you" },
    keywords: ["审批", "待办", "通过", "打回", "决策", "approve", "approvals", "review", "queue"],
    icon: ic('<path d="M5 13l4 4L19 7"/>'),
    action: { kind: "open-window", target: "approvals" }
  },
  {
    id: "proposals",
    label: { "zh-CN": "看改动", en: "Review changes" },
    hint: { "zh-CN": "逐行看 AI 改了什么，再决定合不合", en: "See what changed line by line, then merge" },
    keywords: ["改动", "提案", "diff", "proposal", "pr", "pull request", "审阅", "合并", "merge"],
    icon: ic('<circle cx="7" cy="6" r="2.2"/><circle cx="7" cy="18" r="2.2"/><circle cx="17" cy="12" r="2.2"/><path d="M7 8v8M9 18h4a2 2 0 0 0 2-2v-2"/>'),
    action: { kind: "open-window", target: "proposals" }
  },
  {
    id: "workitem",
    label: { "zh-CN": "任务", en: "Tasks" },
    hint: { "zh-CN": "进行中的任务与交付物", en: "Tasks and deliverables" },
    // keywords 是搜索词不是展示文案：旧叫法（工作项 / work item）刻意保留，用户按记忆里的词也搜得到。
    keywords: ["工作项", "任务", "事项", "work item", "issue", "ticket", "task"],
    icon: ic('<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2"/>'),
    action: { kind: "open-window", target: "workitem" }
  },
  {
    id: "agents",
    label: { "zh-CN": "Cuu 的小队", en: "Cuu's squads" },
    hint: { "zh-CN": "分工方案、子任务和卡点", en: "Plans, subtasks, blockers" },
    // 同上：「军团 / army」是旧叫法，只留在搜索词里，不出现在任何展示位。
    keywords: ["军团", "小队", "分工", "计划", "agents", "agent army", "army", "squad", "task plan"],
    icon: ic('<circle cx="7" cy="8" r="2.5"/><circle cx="17" cy="8" r="2.5"/><circle cx="12" cy="16" r="2.5"/><path d="M9 9.5l2 4M15 9.5l-2 4M9.5 16h5"/>'),
    action: { kind: "open-window", target: "agents" }
  },
  {
    id: "drive",
    label: { "zh-CN": "网盘", en: "Drive" },
    hint: { "zh-CN": "文件、文档与 AI 交付物", en: "Files, docs, AI deliverables" },
    keywords: ["网盘", "文件", "文档", "drive", "files", "folder", "documents"],
    icon: ic('<path d="M3 8a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
    action: { kind: "open-window", target: "drive" }
  },
  {
    id: "projects",
    label: { "zh-CN": "项目", en: "Projects" },
    hint: { "zh-CN": "项目工作区与概览", en: "Project workspaces" },
    keywords: ["项目", "工作区", "project", "repo", "workspace"],
    icon: ic('<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>'),
    action: { kind: "open-window", target: "projects" }
  },
  {
    id: "replay",
    label: { "zh-CN": "回放", en: "Replay" },
    hint: { "zh-CN": "AI 每一步做了什么，可回退", en: "Every step the AI took, with rollback points" },
    keywords: ["回放", "记录", "历史", "replay", "history", "trace", "timeline"],
    icon: ic('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
    action: { kind: "open-window", target: "replay" }
  },
  {
    // R14 批 SEARCH：全局搜索——跨会话/网盘/工单/会议一次搜到底，与 knowledge（单项目内的知识/证据
    // 检索）区分：knowledge=知识/证据，search=全局跨源，文案上明确「全部」。
    id: "search",
    label: { "zh-CN": "搜索全部", en: "Search all" },
    hint: { "zh-CN": "跨会话·网盘·任务·会议", en: "Across chat, drive, tasks, meetings" },
    keywords: ["搜索", "查找", "全局", "search", "find", "global"],
    icon: ic('<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.3-4.3"/>'),
    action: { kind: "open-window", target: "search" }
  },
  {
    id: "knowledge",
    label: { "zh-CN": "知识检索", en: "Knowledge" },
    hint: { "zh-CN": "搜索攒下的知识与证据", en: "Search knowledge and evidence" },
    keywords: ["知识", "检索", "搜索", "knowledge", "search", "wiki", "docs"],
    icon: ic('<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.3-4.3"/>'),
    action: { kind: "open-window", target: "knowledge" }
  },
  {
    // F-09：会议列表 → 转写/纪要/洞察详情，与 web /meetings 页同源数据（packages/contracts
    // meetingPageVmSchema）。桌面此前完全没有会议视图，搜索结果只能诚实降级——本能力落地后
    // 两处都直达同一个视图（见 spotlight/views/meetings.ts、spotlight/views/search.ts）。
    id: "meetings",
    label: { "zh-CN": "会议", en: "Meetings" },
    hint: { "zh-CN": "转写、纪要与洞察卡片", en: "Transcripts, minutes, and insight cards" },
    keywords: ["会议", "纪要", "转写", "洞察", "会议记录", "meeting", "meetings", "minutes", "transcript"],
    icon: ic('<path d="M4 5h16v11H9l-4 4z"/><path d="M8 9h8M8 12.5h5"/>'),
    action: { kind: "open-window", target: "meetings" }
  },
  {
    id: "cost",
    label: { "zh-CN": "成本", en: "Cost" },
    hint: { "zh-CN": "AI 花费、预算与分账", en: "Spend, budget, labor split" },
    keywords: ["成本", "花费", "预算", "cost", "budget", "spend", "billing"],
    icon: ic('<circle cx="12" cy="12" r="9"/><path d="M9 9h4.5a2 2 0 0 1 0 4H9m0-4v8m0-4h5"/>'),
    action: { kind: "open-window", target: "cost" }
  },
  {
    id: "team",
    label: { "zh-CN": "团队", en: "Team" },
    hint: { "zh-CN": "成员、日历与技能库", en: "Members, calendar, skills" },
    keywords: ["团队", "成员", "日历", "技能", "team", "members", "calendar", "skills"],
    icon: ic('<circle cx="9" cy="9" r="3"/><path d="M3 19a6 6 0 0 1 12 0"/><path d="M16 7a3 3 0 0 1 0 6M21 19a6 6 0 0 0-4-5.6"/>'),
    action: { kind: "open-window", target: "team" }
  },
  {
    // R5 双端一致：web 有完整通知中心+按类型静音偏好，桌面此前零入口——通知只能被动挨弹。
    id: "notifications",
    label: { "zh-CN": "通知", en: "Notifications" },
    hint: { "zh-CN": "通知箱与按类型静音", en: "Inbox and per-type mute" },
    keywords: ["通知", "消息", "静音", "notifications", "inbox", "mute"],
    icon: ic('<path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6"/><path d="M10 19a2 2 0 0 0 4 0"/>'),
    action: { kind: "open-window", target: "notifications" }
  },
  {
    id: "settings",
    label: { "zh-CN": "设置", en: "Settings" },
    hint: { "zh-CN": "偏好、桌宠与账户", en: "Preferences, pet, account" },
    keywords: ["设置", "偏好", "账户", "settings", "preferences", "config"],
    icon: ic('<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/>'),
    action: { kind: "open-window", target: "settings" }
  },
  {
    // R14 批 MEM：设置区旁挂的记忆管理面——settings.ts 里也有一行可点导航能直达同一个视图。
    id: "memory",
    label: { "zh-CN": "Cuu 的记忆", en: "Cuu's memory" },
    hint: { "zh-CN": "关于我的偏好、团队技能库", en: "What Cuu knows about you and your team" },
    keywords: ["记忆", "偏好", "技能", "memory", "preferences", "skills", "about me", "team skills"],
    icon: ic('<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.4.9 1 .9 1.7V16h5.2v-.4c0-.7.3-1.3.9-1.7A6 6 0 0 0 12 3z"/>'),
    action: { kind: "open-window", target: "memory" }
  },
  {
    id: "workbench",
    label: { "zh-CN": "打开工作台", en: "Open workbench" },
    hint: { "zh-CN": "项目群聊、网盘、小队在一个窗口里", en: "Team chat, drive, and squads in one window" },
    keywords: ["工作台", "群聊", "workbench", "project window", "team chat"],
    icon: ic('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M9 9v11"/>'),
    action: { kind: "open-window", target: "workbench" }
  },
  {
    id: "new_project",
    label: { "zh-CN": "新建项目", en: "New project" },
    hint: { "zh-CN": "自动配好群聊、网盘和 Cuu", en: "Sets up chat, drive, and Cuu for you" },
    keywords: ["新建项目", "建项目", "new project", "create project"],
    icon: ic('<path d="M3 8a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M12 11v5M9.5 13.5h5"/>'),
    action: { kind: "open-window", target: "new_project" }
  }
];

function isSubsequence(needle: string, haystack: string): boolean {
  if (!needle) {
    return true;
  }
  let i = 0;
  for (const ch of haystack) {
    if (ch === needle[i]) {
      i += 1;
      if (i === needle.length) {
        return true;
      }
    }
  }
  return false;
}

// 单条命令对查询的打分：完全相等>前缀>子串>子序列(模糊)，取所有可搜索串里的最佳。
function scoreCommand(query: string, command: DesktopCommand, locale: PaletteLocale): number {
  const q = query.trim().toLowerCase();
  if (!q) {
    return 0;
  }
  const other: PaletteLocale = locale === "zh-CN" ? "en" : "zh-CN";
  const haystacks = [command.label[locale], command.label[other], ...command.keywords].map((s) =>
    s.toLowerCase()
  );
  let best = 0;
  for (const h of haystacks) {
    if (h === q) {
      best = Math.max(best, 100);
    } else if (h.startsWith(q)) {
      best = Math.max(best, 80);
    } else if (h.includes(q)) {
      best = Math.max(best, 60);
    } else if (isSubsequence(q, h)) {
      best = Math.max(best, 30);
    }
  }
  return best;
}

// 路由核心：查询 → 排序后的能力匹配。空查询返回全部（注册表默认优先序）。
export function matchCommands(query: string, locale: string | undefined = "zh-CN"): CommandMatch[] {
  const loc = normalizeLocale(locale);
  if (!query.trim()) {
    return commandRegistry.map((command) => ({ command, score: 0 }));
  }
  return commandRegistry
    .map((command, index) => ({ command, score: scoreCommand(query, command, loc), index }))
    .filter((entry) => entry.score > 0)
    // 同分维持注册表默认序（稳定、可预期）。
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ command, score }) => ({ command, score }));
}
