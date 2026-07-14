// WorkHub 桌面 · 工作台「项目设置」标签的数据访问薄层（R13 批 P3：功能审查 B3——项目治理参数
// 观察者开关/静默窗口秒数/安静时段/Granular 桌面端此前零代码路径，连只读展示都没有）。
// 两个既有端点（GET/PATCH /api/projects/:id/ai-governance，apps/api/src/routes/ai-settings.ts 已挂载）
// 从没有任何 UI 消费方——照 army/api.ts、chat/api.ts 顶部注释的先例，走 client.request<T> 这个既有的
// 类型安全转发口，不为这一个批次特性扩大 packages/api-client 的具名方法面。

import type {
  GithubBindingRequest,
  GithubBindingStatusVM,
  GithubTestConnectionRequest,
  GithubTestConnectionResult,
  PatchProjectAiGovernanceRequest,
  ProjectAiGovernanceVM
} from "@workhub/contracts";

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

// R14 批 GH（07-gh-design.md §3）：GitHub 绑定卡的数据访问薄层——同上面 governance 的手法，走
// client.request<T> 这个既有转发口，不为这一个批次特性扩大 packages/api-client 的具名方法面
// （集成裁定：api-client 加方法必须两侧穷举 mock，能用 request<T> 就不加）。
export type GithubBindingApiClient = ProjectSettingsApiClient;

function githubBindingPath(projectId: string): string {
  return `/api/projects/${encodeURIComponent(projectId)}/github-binding`;
}

export function fetchGithubBindingStatus(
  client: GithubBindingApiClient,
  projectId: string
): Promise<GithubBindingStatusVM> {
  return client.request<GithubBindingStatusVM>(githubBindingPath(projectId));
}

export function putGithubBinding(
  client: GithubBindingApiClient,
  projectId: string,
  payload: GithubBindingRequest
): Promise<GithubBindingStatusVM> {
  return client.request<GithubBindingStatusVM>(githubBindingPath(projectId), {
    method: "PUT",
    body: JSON.stringify(payload)
  });
}

export function deleteGithubBinding(client: GithubBindingApiClient, projectId: string): Promise<void> {
  return client.request<void>(githubBindingPath(projectId), { method: "DELETE" });
}

export function testGithubBindingConnection(
  client: GithubBindingApiClient,
  projectId: string,
  payload: GithubTestConnectionRequest
): Promise<GithubTestConnectionResult> {
  return client.request<GithubTestConnectionResult>(`${githubBindingPath(projectId)}/test`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}
