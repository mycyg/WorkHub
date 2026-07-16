// WorkHub 桌面 · 工作台变更编辑器的数据访问薄层。R16-W3。
// 编辑器是「变更审阅器」——只读渲染 base 与 proposed 的 tracked changes，动作全走既有提议 review/merge
// 端点。故这里只声明两个取数：①逐行 diff（新增的 GET /api/proposals/:id/files/:path/diff，走 client.request
// 转发口——照 drive/api.ts 顶部注释，为一个工作台专属特性扩 packages/api-client 公共面不划算）；
// ②提议详情 VM（复用既有 client.pages.proposal，拿 status + review_actions.merge 的 request_json 供合并）。

import type { PageRequestOptions, WorkHubApiClient } from "@workhub/api-client";
import type { ProposalChangeDiffVM, ProposalDetailVM } from "@workhub/contracts";

export type EditorApiClient = Pick<WorkHubApiClient, "request" | "pages" | "mergeProposal" | "reviewProposal">;

export function proposalChangeDiffPath(proposalId: string, path: string): string {
  return `/api/proposals/${encodeURIComponent(proposalId)}/files/${encodeURIComponent(path)}/diff`;
}

export function fetchProposalChangeDiff(
  client: Pick<WorkHubApiClient, "request">,
  proposalId: string,
  path: string
): Promise<ProposalChangeDiffVM> {
  return client.request<ProposalChangeDiffVM>(proposalChangeDiffPath(proposalId, path));
}

export function fetchProposalDetail(
  client: Pick<WorkHubApiClient, "pages">,
  proposalId: string,
  options?: PageRequestOptions
): Promise<ProposalDetailVM> {
  return client.pages.proposal(proposalId, options);
}
