// WorkHub 桌面 · Spotlight 能力视图注册表。
// CommandId → 能力内联视图。已内联的能力用真视图；未内联的用占位视图（S3–S11 逐片替换）。
// 切片只需把某能力从 placeholder 换成真视图，其它代码不动。

import type { CommandId } from "../command-palette.js";
import { createAttentionView } from "./views/attention.js";
import {
  createAgentsView,
  createCalendarView,
  createCostView,
  createKnowledgeView,
  createProjectsView, createNotificationsView } from "./views/dashboards.js";
import { createDriveView } from "./views/drive.js";
import { createIntakeView } from "./views/intake.js";
import { createMeetingsView } from "./views/meetings.js";
import { createMemoryView } from "./views/memory.js";
import { createPlaceholderView } from "./views/placeholder.js";
import { createProposalsView } from "./views/proposals.js";
import { createReplayView } from "./views/replay.js";
import { createSearchView } from "./views/search.js";
import { createSettingsView } from "./views/settings.js";
import { createWorkbenchOpenView } from "./views/workbench-open.js";
import { createWorkItemView } from "./views/workitem.js";
import type { SpotlightCapabilityView } from "./view-context.js";

// 已做成内联的能力工厂表（12/12 全部内联；placeholder 仅作未知 id 的兜底）。
// R12 批 1：workbench/new_project 不是「内联」能力——它们的 view 只 invoke Tauri open_workbench
// 开一个独立原生窗口，见 views/workbench-open.ts 顶部注释。
const builtViews: Partial<Record<CommandId, () => SpotlightCapabilityView>> = {
  approvals: createAttentionView,
  intake: createIntakeView,
  projects: createProjectsView,
  agents: createAgentsView,
  cost: createCostView,
  team: createCalendarView,
  knowledge: createKnowledgeView,
  // F-09：会议列表 → 转写/纪要/洞察详情。
  meetings: createMeetingsView,
  search: createSearchView,
  drive: createDriveView,
  replay: createReplayView,
  proposals: createProposalsView,
  workitem: createWorkItemView,
  notifications: createNotificationsView,
  settings: createSettingsView,
  // R14 批 MEM：独立能力视图（list→detail 多层交互），不是 settings.ts 内联区块——见 views/memory.ts。
  memory: createMemoryView,
  workbench: () => createWorkbenchOpenView("workbench", { bare: false }),
  new_project: () => createWorkbenchOpenView("new_project", { bare: true })
};

export function resolveCapabilityView(id: CommandId): SpotlightCapabilityView {
  const factory = builtViews[id];
  return factory ? factory() : createPlaceholderView(id);
}
