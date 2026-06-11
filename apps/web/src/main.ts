import { createApiClient, type WorkHubApiClient } from "@workhub/api-client";
import { defaultPorts } from "@workhub/config";
import type { CreateSessionRequest, CreateWorkItemRequest, ProposalConflict, ProposalDetailVM, StartAgentRunRequest } from "@workhub/contracts";
import { renderAgentRunLive } from "@workhub/ui/agent-run";
import { renderGoldPathSurface, type WorkHubLocale } from "@workhub/ui/gold-path";
import { renderIntakeSession } from "@workhub/ui/intake";
import { renderWorkItemDetail } from "@workhub/ui/workitem";
import { renderProposalDetail } from "@workhub/ui/proposal";
import { renderAgentRunReplay } from "@workhub/ui/replay";

export const webSurface = {
  name: "C-WEB",
  description: "Browser SPA surface; it is a thin view over the headless WorkHub daemon.",
  devPort: defaultPorts.web,
  apiBaseUrlEnv: "VITE_API_BASE_URL",
  defaultDaemonUrl: `http://127.0.0.1:${defaultPorts.api}`,
  pages: [
    "/api/auth/me",
    "/api/auth/preferences",
    "/api/pages/attention",
    "/api/sessions",
    "/api/sessions/:id",
    "/api/workitems",
    "/api/workitems/:id/agent-runs",
    "/api/agent-runs/:id",
    "/api/agent-runs/:id/trace",
    "/api/knowledge/search",
    "/api/pages/gold-path",
    "/intake/:sessionId",
    "/knowledge/search",
    "/api/pages/workitems/:id",
    "/api/workitems/:id/conflicts",
    "/api/pages/proposals/:id",
    "/api/pages/drive",
    "/api/pages/approvals",
    "/api/pages/cost",
    "/api/pages/settings",
    "/api/agent-runs/:id/replay",
    "/settings"
  ],
  consumesTypedClient: "@workhub/api-client"
} as const;

export const webApiClient = createApiClient({
  baseUrl: ""
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
