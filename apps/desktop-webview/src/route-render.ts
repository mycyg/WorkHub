import type { WorkHubApiClient } from "@workhub/api-client";
import type { ProposalConflict, ProposalDetailVM, WorkHubLocale } from "@workhub/contracts";
import { renderProposalDetail } from "@workhub/ui/proposal";
import { bindReplayRevertActions, renderAgentRunReplay, type ReplayRevertRoot } from "@workhub/ui/replay";

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

export function loadDesktopAgentRunReplay(client: WorkHubApiClient, runId: string) {
  return client.replayAgentRun(runId);
}

export async function renderDesktopAgentRunReplay(client: WorkHubApiClient, runId: string, locale?: WorkHubLocale) {
  return renderAgentRunReplay(await loadDesktopAgentRunReplay(client, runId), "desktop", locale ? { locale } : undefined);
}

// R20 DSK-UX（R19-3）：桌面壳挂上 replay 的 HTML 后调这里，给「撤销此次改动」按钮接真回调——桌面本就是
// 本地客户端，可直接执行 POST /api/agent-runs/:id/revert（snapshot_id 走 body）。web 端不接这条、由既有
// data-requires-desktop 拦截渲成「需在桌面端操作」。二次确认 + 刷新都在 @workhub/ui 的 bindReplayRevertActions
// 里，这里只做「传 client + 回调」的薄接线。缺 revertAgentRun（旧 client）则安静退化成 no-op。
export function bindDesktopAgentRunReplayRevert(
  root: ReplayRevertRoot,
  client: WorkHubApiClient,
  options?: { onReverted?: (info: { runId: string; snapshotId: string }) => void }
): () => void {
  const revert = client.revertAgentRun;
  if (!revert) {
    return () => {};
  }
  return bindReplayRevertActions(root, {
    revert: (runId, payload) => revert(runId, payload),
    ...(options?.onReverted ? { onReverted: options.onReverted } : {})
  });
}
