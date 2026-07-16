// WorkHub 桌面 · 军团面板/军团总览的数据访问薄层（R13 批 P1）。
// 两个只读端点（GET /api/conversations/:id/army、GET /api/me/army）批 5 就写好挂载了，但从没有专门的
// WorkHubApiClient 具名方法——照 chat/api.ts、drive/api.ts 顶部注释的先例，走 client.request<T> 这个既有
// 的类型安全转发口（自动解 {ok,data} 信封），不为这一个批次特性扩大 packages/api-client 的公共方法面。
//
// run 详情下钻的完整时间线复用既有具名方法 client.getAgentRun(runId)——这不是新协议：Spotlight 的回放
// 视图（spotlight/views/replay.ts）就是靠同一个端点/同一份 AgentRunLiveVM 渲出时间线的，这里只是第二个
// 消费方。「看回放」按钮因此可以是一次真实调用，而不是一个假装能深链却没接线的按钮（04 §4 铁律 3）。

import type { AgentRunLiveVM, ArmyBackgroundPageVM, ArmyOverviewPageVM, ConversationArmyPanelVM } from "@workhub/contracts";

export type ArmyRunListQueryInput = {
  afterCreatedAt?: string;
  afterId?: string;
  limit?: number;
};

export type ArmyPanelApiClient = {
  request: <T>(path: string, init?: RequestInit) => Promise<T>;
  getAgentRun: (runId: string) => Promise<AgentRunLiveVM>;
  // R17 G3(#19)：既有具名方法(POST /agent-runs/:id/abort)——军团面板取消一个 queued/running 的 run。
  abortAgentRun: (runId: string) => Promise<AgentRunLiveVM>;
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

// R17 G3(#8)：后台任务区(定时任务 + 主动性动态)只读端点——走 client.request<T> 既有转发口(同上，不为
// 一个特性扩大 api-client 公共方法面)。无查询参数。
export function fetchArmyBackground(
  client: Pick<ArmyPanelApiClient, "request">
): Promise<ArmyBackgroundPageVM> {
  return client.request<ArmyBackgroundPageVM>("/api/army/background");
}

export function fetchAgentRunTrace(
  client: Pick<ArmyPanelApiClient, "getAgentRun">,
  runId: string
): Promise<AgentRunLiveVM> {
  return client.getAgentRun(runId);
}

// R17 G3(#19)：取消一个 run——既有具名方法 client.abortAgentRun(runId)(POST /agent-runs/:id/abort)，
// 与 fetchAgentRunTrace 同款薄封装，返回落定后的 run 快照(status 通常翻成 cancelled)。
export function abortAgentRun(
  client: Pick<ArmyPanelApiClient, "abortAgentRun">,
  runId: string
): Promise<AgentRunLiveVM> {
  return client.abortAgentRun(runId);
}
