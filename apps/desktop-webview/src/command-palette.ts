// WorkHub R8 客户端 · Cuu 命令面板 + 能力路由（desktop-only）。
// 「极简交互 + 所有后端功能有机集成」的核心：一个输入框，输入意图 → 模糊匹配 → 直达任意能力
// （派活/澄清·审批·改动diff·网盘·项目·工作项·回放·成本·知识·团队·设置）。
// 匹配是纯逻辑（高度可单测）；渲染产出带 data-command-* 的玻璃面板 HTML，点击由壳层路由到对应玻璃窗。
// 用设计系统类名（design-system.ts），不进共享 @workhub/ui。

import { designSystem } from "./design-system.js";

export type CommandId =
  | "intake"
  | "approvals"
  | "proposals"
  | "workitem"
  | "drive"
  | "projects"
  | "replay"
  | "knowledge"
  | "cost"
  | "team"
  | "settings";

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
    label: { "zh-CN": "派个活 / 新任务", en: "Dispatch a task" },
    hint: { "zh-CN": "需求澄清后让 AI 干，你过目", en: "Clarify, let AI work, you review" },
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
    label: { "zh-CN": "看改动 / diff", en: "Review changes" },
    hint: { "zh-CN": "AI 改动的 diff、审阅与合并", en: "Diff, review and merge" },
    keywords: ["改动", "提案", "diff", "proposal", "pr", "pull request", "审阅", "合并", "merge"],
    icon: ic('<circle cx="7" cy="6" r="2.2"/><circle cx="7" cy="18" r="2.2"/><circle cx="17" cy="12" r="2.2"/><path d="M7 8v8M9 18h4a2 2 0 0 0 2-2v-2"/>'),
    action: { kind: "open-window", target: "proposals" }
  },
  {
    id: "workitem",
    label: { "zh-CN": "工作项 / 任务", en: "Work items" },
    hint: { "zh-CN": "进行中的任务与交付物", en: "Tasks and deliverables" },
    keywords: ["工作项", "任务", "事项", "work item", "issue", "ticket", "task"],
    icon: ic('<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2"/>'),
    action: { kind: "open-window", target: "workitem" }
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
    hint: { "zh-CN": "AI 运行的时间线与快照", en: "Run timeline and snapshots" },
    keywords: ["回放", "记录", "历史", "replay", "history", "trace", "timeline"],
    icon: ic('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
    action: { kind: "open-window", target: "replay" }
  },
  {
    id: "knowledge",
    label: { "zh-CN": "知识检索", en: "Knowledge" },
    hint: { "zh-CN": "搜索沉淀的知识与证据", en: "Search knowledge and evidence" },
    keywords: ["知识", "检索", "搜索", "knowledge", "search", "wiki", "docs"],
    icon: ic('<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.3-4.3"/>'),
    action: { kind: "open-window", target: "knowledge" }
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
    id: "settings",
    label: { "zh-CN": "设置", en: "Settings" },
    hint: { "zh-CN": "偏好、桌宠与账户", en: "Preferences, pet, account" },
    keywords: ["设置", "偏好", "账户", "settings", "preferences", "config"],
    icon: ic('<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/>'),
    action: { kind: "open-window", target: "settings" }
  }
];

export function resolveCommandAction(id: CommandId): DesktopCommand["action"] | undefined {
  return commandRegistry.find((command) => command.id === id)?.action;
}

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

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] ?? c));
}

export type CommandPaletteRenderInput = {
  query?: string;
  locale?: string;
  badges?: Partial<Record<CommandId, number>>; // 如 approvals:3 在行尾显数字
};

// 渲染玻璃命令面板。每行带 data-command-id / data-command-kind / data-command-target，壳层点击委托用它路由。
export function renderCommandPalette(input: CommandPaletteRenderInput = {}): string {
  const loc = normalizeLocale(input.locale);
  const query = input.query ?? "";
  const matches = matchCommands(query, loc);
  const ds = designSystem;
  const placeholder = loc === "zh-CN" ? "想做什么？派活 / 审批 / 网盘 / 项目…" : "What do you need? dispatch / approve / drive…";
  const emptyHint = loc === "zh-CN" ? "没有匹配的能力，换个说法试试" : "No matching capability — try another phrase";

  const rows =
    matches.length === 0
      ? `<div class="wh-cmd-empty ds-subtle">${escapeHtml(emptyHint)}</div>`
      : `<div class="wh-cmd-list ${ds.stagger}">${matches
          .map(({ command }) => {
            const badge = input.badges?.[command.id];
            const badgeHtml =
              typeof badge === "number" && badge > 0
                ? `<span class="wh-cmd-badge">${badge}</span>`
                : "";
            return `<button type="button" class="wh-cmd-row ${ds.interactive}" data-command-id="${command.id}" data-command-kind="${command.action.kind}" data-command-target="${escapeHtml(command.action.target)}">
              <span class="wh-cmd-icon">${command.icon}</span>
              <span class="wh-cmd-text"><span class="wh-cmd-label">${escapeHtml(command.label[loc])}</span><span class="wh-cmd-hint">${escapeHtml(command.hint[loc])}</span></span>
              ${badgeHtml}
            </button>`;
          })
          .join("")}</div>`;

  return `<div class="wh-cmd ${ds.glassStrong} ${ds.panel} ${ds.springIn}" data-wh-command-palette>
    <div class="wh-cmd-field-wrap">
      <span class="wh-cmd-field-icon">${ic('<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.3-4.3"/>')}</span>
      <input class="wh-cmd-field" type="search" data-command-input value="${escapeHtml(query)}" placeholder="${escapeHtml(placeholder)}" aria-label="${escapeHtml(placeholder)}" />
    </div>
    ${rows}
  </div>`;
}

// 命令面板自身的样式（依赖 design-system 的 token；只补面板特有的布局）。
export const commandPaletteCss = [
  ".wh-cmd{width:min(460px,calc(100vw - 32px));box-sizing:border-box;display:flex;flex-direction:column;gap:var(--ds-s3)}",
  ".wh-cmd-field-wrap{display:flex;align-items:center;gap:10px;border:1px solid var(--ds-glass-border);background:rgba(255,255,255,.6);border-radius:var(--ds-radius-md);padding:10px 13px}",
  ".wh-cmd-field-icon{display:inline-flex;width:18px;height:18px;color:var(--ds-ink-muted);flex:0 0 auto}",
  ".wh-cmd-field-icon svg{width:18px;height:18px}",
  ".wh-cmd-field{flex:1 1 auto;min-width:0;border:0;background:transparent;outline:none;font:500 15px/1.3 var(--ds-font);color:var(--ds-ink)}",
  ".wh-cmd-field::placeholder{color:var(--ds-ink-faint)}",
  ".wh-cmd-list{display:flex;flex-direction:column;gap:2px;max-height:min(360px,60vh);overflow-y:auto;overscroll-behavior:contain}",
  ".wh-cmd-row{display:flex;align-items:center;gap:12px;width:100%;text-align:left;border:0;background:transparent;border-radius:var(--ds-radius-md);padding:9px 11px;cursor:pointer;color:var(--ds-ink)}",
  ".wh-cmd-row:hover,.wh-cmd-row:focus-visible{background:rgba(255,255,255,.7)}",
  ".wh-cmd-row[data-active=true]{background:rgba(124,131,255,.16);box-shadow:inset 0 0 0 1px rgba(124,131,255,.3)}",
  ".wh-cmd-icon{display:inline-flex;width:22px;height:22px;flex:0 0 auto;color:var(--ds-accent)}",
  ".wh-cmd-icon svg{width:22px;height:22px}",
  ".wh-cmd-text{display:flex;flex-direction:column;gap:1px;min-width:0}",
  ".wh-cmd-label{font:600 14px/1.3 var(--ds-font);color:var(--ds-ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
  ".wh-cmd-hint{font:500 11.5px/1.3 var(--ds-font);color:var(--ds-ink-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
  ".wh-cmd-badge{margin-left:auto;flex:0 0 auto;min-width:18px;height:18px;padding:0 5px;border-radius:999px;background:var(--ds-danger);color:#fff;font:700 11px/18px var(--ds-font);text-align:center}",
  ".wh-cmd-empty{padding:18px 8px;text-align:center}",
  // 命令面板浮层（Spotlight 风：顶部居中召出）+ 背景遮罩。
  ".wh-cmd-backdrop{position:fixed;inset:0;z-index:70;display:flex;align-items:flex-start;justify-content:center;padding:12vh 24px 24px;box-sizing:border-box;background:rgba(40,30,70,.18);backdrop-filter:blur(2px);-webkit-backdrop-filter:blur(2px)}",
  // 常驻召唤入口（玻璃小药丸，点它或按 ⌘K 召出面板）。
  ".wh-cmd-launcher{position:fixed;top:14px;left:50%;transform:translateX(-50%);z-index:55;display:inline-flex;align-items:center;gap:8px;border:1px solid var(--ds-glass-border);background:var(--ds-glass-strong);backdrop-filter:blur(20px) saturate(180%);-webkit-backdrop-filter:blur(20px) saturate(180%);border-radius:var(--ds-radius-pill);box-shadow:var(--ds-shadow-2);color:var(--ds-ink-soft);font:600 12.5px/1 var(--ds-font);padding:8px 14px;cursor:pointer;transition:transform var(--ds-dur-fast) var(--ds-spring),box-shadow var(--ds-dur-fast)}",
  ".wh-cmd-launcher:hover{transform:translateX(-50%) translateY(1px)}.wh-cmd-launcher:active{transform:translateX(-50%) scale(.97)}",
  ".wh-cmd-launcher kbd{font:700 11px/1 var(--ds-font);color:var(--ds-accent);background:var(--ds-accent-soft);border-radius:6px;padding:3px 6px}"
].join("");
