import type { WorkHubApiClient } from "@workhub/api-client";
import type { ProposalConflict, ProposalDetailVM, WorkHubLocale } from "@workhub/contracts";
import { renderProposalDetail } from "@workhub/ui/proposal";

// D-01（R23 精简批）：这组渲染/接线函数原来住在 apps/desktop-webview/src/main.ts（一个从没被任何 HTML
// 入口加载的死 barrel，真实桌面壳走 Spotlight，不走这条客户端渲染路径）。main.ts 里其余的
// gold-path/workitem/intake/agent-run-live/agent-army/Cuu 卡包装函数与 pet-surface 等模块的转出口
// re-export 确认零生产调用（或已由各自模块的独立测试覆盖），随 barrel 一起删了；只留下这三个：
// - renderDesktopProposalDetail 仍被 scripts/qa/r1-route-visual-qa.ts 的 route 视觉 QA 截图直接调用。
// - renderDesktopAgentRunReplay 同上，且是 bindDesktopAgentRunReplayRevert 的渲染前置。
// - bindDesktopAgentRunReplayRevert 目前零生产调用，但它是桌面 replay 详情页「撤销此次改动」按钮的
//   接线点（挂上 replay HTML 之后调用），属于待接线的桌面能力（非死代码），保留等桌面 replay 详情视图
//   接上它。

export function loadDesktopProposalDetail(client: WorkHubApiClient, proposalId: string, locale?: WorkHubLocale) {
  return client.pages.proposal(proposalId, locale ? { locale } : undefined);
}

export async function loadDesktopProposalConflicts(client: WorkHubApiClient, proposal: ProposalDetailVM): Promise<ProposalConflict[]> {
  const result = await client.listWorkItemConflicts(proposal.work_item_id);
  return result.conflicts.filter((conflict) => conflict.proposal_id === proposal.proposal_id);
}

export async function renderDesktopProposalDetail(client: WorkHubApiClient, proposalId: string, locale?: WorkHubLocale) {
  const proposal = await loadDesktopProposalDetail(client, proposalId, locale);
  return renderProposalDetail(proposal, "desktop", {
    ...(locale ? { locale } : {}),
    conflicts: await loadDesktopProposalConflicts(client, proposal)
  });
}

// 回放三件（load/render/bind revert）的唯一实现在 desktop-agent-run-replay.ts（Spotlight 回放视图也从那里 import）；
// 这里只转出口，供 scripts/qa/r1-route-visual-qa.ts 等按「路由渲染入口」取用。
export {
  bindDesktopAgentRunReplayRevert,
  loadDesktopAgentRunReplay,
  renderDesktopAgentRunReplay
} from "./desktop-agent-run-replay.js";
