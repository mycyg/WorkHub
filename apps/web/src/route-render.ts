import type { WorkHubApiClient } from "@workhub/api-client";
import type { ProposalConflict, ProposalDetailVM, WorkHubLocale } from "@workhub/contracts";
import { renderProposalDetail } from "@workhub/ui/proposal";
import { renderAgentRunReplay } from "@workhub/ui/replay";

// D-01（R23 精简批）：这两组渲染函数原来住在 apps/web/src/main.ts（一个从没被任何 HTML 入口加载的
// 死 barrel，真实 web 页面走服务端渲染的 /api/pages/gold-path，不走这条客户端渲染路径）。main.ts 里
// 其余的 gold-path/workitem/intake/agent-run-live 包装函数确认零生产调用，随 barrel 一起删了；只有这
// 两组仍有真实调用方——scripts/qa/r1-route-visual-qa.ts 的 route 视觉 QA 截图直接调用它们渲染 Proposal
// 与 Replay 路由——所以搬到这个独立文件，不再挂在 barrel 下面。

export function loadWebProposalDetail(client: WorkHubApiClient, proposalId: string, locale?: WorkHubLocale) {
  return client.pages.proposal(proposalId, locale ? { locale } : undefined);
}

export async function loadWebProposalConflicts(client: WorkHubApiClient, proposal: ProposalDetailVM): Promise<ProposalConflict[]> {
  const result = await client.listWorkItemConflicts(proposal.work_item_id);
  return result.conflicts.filter((conflict) => conflict.proposal_id === proposal.proposal_id);
}

export async function renderWebProposalDetail(client: WorkHubApiClient, proposalId: string, locale?: WorkHubLocale) {
  const proposal = await loadWebProposalDetail(client, proposalId, locale);
  return renderProposalDetail(proposal, "web", {
    ...(locale ? { locale } : {}),
    conflicts: await loadWebProposalConflicts(client, proposal)
  });
}

export function loadWebAgentRunReplay(client: WorkHubApiClient, runId: string, locale?: WorkHubLocale) {
  return client.replayAgentRun(runId, locale ? { locale } : undefined);
}

export async function renderWebAgentRunReplay(client: WorkHubApiClient, runId: string, locale?: WorkHubLocale) {
  return renderAgentRunReplay(await loadWebAgentRunReplay(client, runId, locale), "web", locale ? { locale } : undefined);
}
