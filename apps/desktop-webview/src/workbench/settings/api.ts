// WorkHub 桌面 · 工作台「项目设置」标签的数据访问薄层（R13 批 P3：功能审查 B3——项目治理参数
// 观察者开关/静默窗口秒数/安静时段/Granular 桌面端此前零代码路径，连只读展示都没有）。
// 两个既有端点（GET/PATCH /api/projects/:id/ai-governance，apps/api/src/routes/ai-settings.ts 已挂载）
// 从没有任何 UI 消费方——照 army/api.ts、chat/api.ts 顶部注释的先例，走 client.request<T> 这个既有的
// 类型安全转发口，不为这一个批次特性扩大 packages/api-client 的具名方法面。

import type { PatchProjectAiGovernanceRequest, ProjectAiGovernanceVM } from "@workhub/contracts";

export type ProjectSettingsApiClient = {
  request: <T>(path: string, init?: RequestInit) => Promise<T>;
};

function governancePath(projectId: string): string {
  return `/api/projects/${encodeURIComponent(projectId)}/ai-governance`;
}

export function fetchProjectAiGovernance(
  client: ProjectSettingsApiClient,
  projectId: string
): Promise<ProjectAiGovernanceVM> {
  return client.request<ProjectAiGovernanceVM>(governancePath(projectId));
}

export function patchProjectAiGovernance(
  client: ProjectSettingsApiClient,
  projectId: string,
  patch: PatchProjectAiGovernanceRequest
): Promise<ProjectAiGovernanceVM> {
  return client.request<ProjectAiGovernanceVM>(governancePath(projectId), {
    method: "PATCH",
    body: JSON.stringify(patch)
  });
}
