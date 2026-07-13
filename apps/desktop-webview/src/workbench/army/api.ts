// WorkHub 桌面 · 军团面板/军团总览的数据访问薄层（R13 批 P1）。
// 两个只读端点（GET /api/conversations/:id/army、GET /api/me/army）批 5 就写好挂载了，但从没有专门的
// WorkHubApiClient 具名方法——照 chat/api.ts、drive/api.ts 顶部注释的先例，走 client.request<T> 这个既有
// 的类型安全转发口（自动解 {ok,data} 信封），不为这一个批次特性扩大 packages/api-client 的公共方法面。
//
// run 详情下钻的完整时间线复用既有具名方法 client.getAgentRun(runId)——这不是新协议：Spotlight 的回放
// 视图（spotlight/views/replay.ts）就是靠同一个端点/同一份 AgentRunLiveVM 渲出时间线的，这里只是第二个
// 消费方。「看回放」按钮因此可以是一次真实调用，而不是一个假装能深链却没接线的按钮（04 §4 铁律 3）。

import type { AgentRunLiveVM, ArmyOverviewPageVM, ConversationArmyPanelVM } from "@workhub/contracts";

export type ArmyRunListQueryInput = {
  afterCreatedAt?: string;
  afterId?: string;
  limit?: number;
};

export type ArmyPanelApiClient = {
  request: <T>(path: string, init?: RequestInit) => Promise<T>;
  getAgentRun: (runId: string) => Promise<AgentRunLiveVM>;
};

function buildArmyRunListQuery(input: ArmyRunListQueryInput): string {
  const query = new URLSearchParams();
  if (input.afterCreatedAt !== undefined) {
    query.set("afterCreatedAt", input.afterCreatedAt);
  }
  if (input.afterId !== undefined) {
    query.set("afterId", input.afterId);
  }
  if (input.limit !== undefined) {
    query.set("limit", String(input.limit));
  }
  const qs = query.toString();
  return qs ? `?${qs}` : "";
}

export function fetchConversationArmyPanel(
  client: Pick<ArmyPanelApiClient, "request">,
  conversationId: string,
  input: ArmyRunListQueryInput = {}
): Promise<ConversationArmyPanelVM> {
  return client.request<ConversationArmyPanelVM>(
    `/api/conversations/${encodeURIComponent(conversationId)}/army${buildArmyRunListQuery(input)}`
  );
}

export function fetchArmyOverview(
  client: Pick<ArmyPanelApiClient, "request">,
  input: ArmyRunListQueryInput = {}
): Promise<ArmyOverviewPageVM> {
  return client.request<ArmyOverviewPageVM>(`/api/me/army${buildArmyRunListQuery(input)}`);
}

export function fetchAgentRunTrace(
  client: Pick<ArmyPanelApiClient, "getAgentRun">,
  runId: string
): Promise<AgentRunLiveVM> {
  return client.getAgentRun(runId);
}
