import { createApiClient, type CreateTaskPlanRequest, type WorkHubApiClient } from "@workhub/api-client";
import { defaultPorts } from "@workhub/config/ports";
import type { CreateSessionRequest, CreateWorkItemRequest, ProposalConflict, ProposalDetailVM, StartAgentRunRequest } from "@workhub/contracts";
import { renderAgentRunLive } from "@workhub/ui/agent-run";
import { renderGoldPathSurface, type WorkHubLocale } from "@workhub/ui/gold-path";
import { renderIntakeSession } from "@workhub/ui/intake";
import { renderWorkItemDetail } from "@workhub/ui/workitem";
import { renderProposalDetail } from "@workhub/ui/proposal";
import { renderAgentRunReplay } from "@workhub/ui/replay";

export const webSurface = {
  name: "C-WEB",
  description: "Browser SPA surface; it is a thin view over the headless WorkHub backend service.",
  devPort: defaultPorts.web,
  apiBaseUrlEnv: "VITE_API_BASE_URL",
  defaultDaemonUrl: `http://127.0.0.1:${defaultPorts.api}`,
  // G-web 止血批：本目录自 R10（f986360e）后没再跟 routes.ts 同步过，R11-R14 陆续新增的
  // 路由（projects/health/cost 独立页 pattern、R14 SEARCH/MEM/GH 批）从没补进来。以
  // apps/web/src/routes.ts 的 webRouteRegistry（pattern + apiBaseLabel）为准补全；GitHub 绑定
  // 端点（/api/projects/:id/github-binding 等）核实后确认只有桌面工作台设置页调用，web 端
  // 没有任何调用点，不虚构进目录。
  pages: [
    "/",
    "/api/auth/me",
    "/api/auth/preferences",
    "/api/pages/attention",
    "/api/projects",
    "/projects",
    "/api/pages/project/:id",
    "/projects/:id",
    "/api/sessions",
    "/api/sessions/:id",
    "/api/workitems",
    "/api/workitems/:id/task-plan",
    "/api/workitems/:id/agent-runs",
    "/api/agent-runs/:id",
    "/api/agent-runs/:id/trace",
    "/api/knowledge/search",
    "/api/pages/gold-path",
    "/intake/:sessionId",
    "/knowledge/search",
    "/api/pages/workitems/:id",
    "/workitems/:id",
    "/api/workitems/:id/conflicts",
    "/api/pages/proposals/:id",
    "/proposals/:id",
    // R15 批 web-mirror：只读会话镜像页 + 消费的会话消息读端点。
    "/api/conversations/:id/messages",
    "/conversations/:id",
    "/api/pages/drive",
    "/drive",
    "/api/pages/meetings",
    "/api/pages/notifications",
    "/api/pages/calendar",
    "/meetings",
    "/notifications",
    "/calendar",
    "/api/drive/projects/:projectId/files",
    "/api/drive/projects/:projectId/items/:itemId/delete",
    "/api/drive/projects/:projectId/items/:itemId/restore",
    "/api/drive/projects/:projectId/comments/:commentId/draft",
    "/api/drive/workitems/:workItemId/proposal-draft",
    "/api/meetings/projects/:projectId/insights/:insightId/draft",
    "/api/meetings/projects/:projectId/insights/:insightId/dismiss",
    "/api/meetings/workitems/:workItemId/proposal-draft",
    "/api/notifications/:id/read",
    "/api/notifications/read-all",
    "/api/notifications/:id/dismiss",
    "/api/notifications/:id/complete",
    "/api/notifications/preferences",
    "/api/pages/approvals",
    "/approvals",
    "/api/pages/health",
    "/dashboard/health",
    "/api/pages/cost",
    "/dashboard/cost",
    "/api/pages/agents",
    "/dashboard/agents",
    // R14 批 SEARCH：全局搜索页。
    "/api/search",
    "/dashboard/search",
    // R14 批团队技能管理页。
    "/api/pages/skills",
    "/dashboard/skills",
    // R14 批 MEM：我的记忆 + 团队技能治理（两 tab 共用 /settings/memory，服务端只透传 query）。
    "/api/me/memories",
    "/settings/memory",
    "/api/pages/settings",
    "/api/agent-runs/:id/replay",
    "/settings"
  ],
  consumesTypedClient: "@workhub/api-client"
} as const;

export const webApiClient = createApiClient({
  baseUrl: "",
  // R10-P1-5：web 侧统一 60s 请求超时——不设超时的挂死请求会把动作锁焊死到刷新。
  requestTimeoutMs: 60_000
});

export function loadWebGoldPathSurface(client: WorkHubApiClient = webApiClient, locale?: WorkHubLocale) {
  return client.pages.goldPath(locale ? { locale } : undefined);
}

export async function renderWebGoldPathSurface(client: WorkHubApiClient = webApiClient, locale?: WorkHubLocale) {
  return renderGoldPathSurface(await loadWebGoldPathSurface(client, locale), "web", { locale });
}

export function startWebIntakeSession(
  client: WorkHubApiClient = webApiClient,
  payload: CreateSessionRequest = {}
) {
  return client.createSession(payload);
}

export async function renderWebIntakeSession(
  client: WorkHubApiClient = webApiClient,
  payload: CreateSessionRequest = {},
  locale?: WorkHubLocale
) {
  return renderIntakeSession(await startWebIntakeSession(client, payload), "web", locale ? { locale } : undefined);
}

export function createWebWorkItem(
  payload: CreateWorkItemRequest,
  client: WorkHubApiClient = webApiClient
) {
  return client.createWorkItem(payload);
}

export function loadWebWorkItemDetail(client: WorkHubApiClient, workItemId: string, locale?: WorkHubLocale) {
  return client.pages.workItem(workItemId, locale ? { locale } : undefined);
}

export async function renderWebWorkItemDetail(client: WorkHubApiClient, workItemId: string, locale?: WorkHubLocale) {
  return renderWorkItemDetail(await loadWebWorkItemDetail(client, workItemId, locale), "web", locale ? { locale } : undefined);
}

export function createWebTaskPlan(
  client: WorkHubApiClient = webApiClient,
  workItemId: string,
  payload: CreateTaskPlanRequest = {},
  locale?: WorkHubLocale
) {
  return client.createTaskPlan(workItemId, payload, locale ? { locale } : undefined);
}

export function startWebAgentRun(
  client: WorkHubApiClient = webApiClient,
  workItemId: string,
  payload: StartAgentRunRequest = {}
) {
  return client.startAgentRun(workItemId, payload);
}

export function loadWebAgentRun(client: WorkHubApiClient, runId: string) {
  return client.getAgentRun(runId);
}

export function loadWebAgentRunTrace(client: WorkHubApiClient, runId: string, after?: number) {
  return client.getAgentRunTrace(runId, after);
}

export function loadWebAgentRunReplay(client: WorkHubApiClient, runId: string, locale?: WorkHubLocale) {
  return client.replayAgentRun(runId, locale ? { locale } : undefined);
}

export async function renderWebAgentRunReplay(client: WorkHubApiClient, runId: string, locale?: WorkHubLocale) {
  return renderAgentRunReplay(await loadWebAgentRunReplay(client, runId, locale), "web", locale ? { locale } : undefined);
}

export async function renderWebAgentRunLive(client: WorkHubApiClient, runId: string, locale?: WorkHubLocale) {
  return renderAgentRunLive(await loadWebAgentRun(client, runId), "web", locale ? { locale } : undefined);
}

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
