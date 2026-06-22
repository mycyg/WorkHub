// WorkHub 桌面 · Spotlight 能力视图注册表。
// CommandId → 能力内联视图。已内联的能力用真视图；未内联的用占位视图（S3–S11 逐片替换）。
// 切片只需把某能力从 placeholder 换成真视图，其它代码不动。

import type { CommandId } from "../command-palette.js";
import { createAttentionView } from "./views/attention.js";
import {
  createCalendarView,
  createCostView,
  createKnowledgeView,
  createProjectsView
} from "./views/dashboards.js";
import { createDriveView } from "./views/drive.js";
import { createIntakeView } from "./views/intake.js";
import { createPlaceholderView } from "./views/placeholder.js";
import { createProposalsView } from "./views/proposals.js";
import { createReplayView } from "./views/replay.js";
import type { SpotlightCapabilityView } from "./view-context.js";

// 已做成内联的能力工厂表。
const builtViews: Partial<Record<CommandId, () => SpotlightCapabilityView>> = {
  approvals: createAttentionView,
  intake: createIntakeView,
  projects: createProjectsView,
  cost: createCostView,
  team: createCalendarView,
  knowledge: createKnowledgeView,
  drive: createDriveView,
  replay: createReplayView,
  proposals: createProposalsView
};

export function resolveCapabilityView(id: CommandId): SpotlightCapabilityView {
  const factory = builtViews[id];
  return factory ? factory() : createPlaceholderView(id);
}
