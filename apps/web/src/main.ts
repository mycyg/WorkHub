import { createApiClient, type WorkHubApiClient } from "@workhub/api-client";
import { defaultPorts } from "@workhub/config";
import type { CreateSessionRequest, CreateWorkItemRequest, StartAgentRunRequest } from "@workhub/contracts";
import { renderAgentRunLive } from "@workhub/ui/agent-run";
import { renderGoldPathSurface, type WorkHubLocale } from "@workhub/ui/gold-path";
import { renderIntakeSession } from "@workhub/ui/intake";
import { renderWorkItemDetail } from "@workhub/ui/workitem";
import { renderProposalDetail } from "@workhub/ui/proposal";

export const webSurface = {
  name: "C-WEB",
  description: "Browser SPA surface; it is a thin view over the headless WorkHub daemon.",
  devPort: defaultPorts.web,
  apiBaseUrlEnv: "VITE_API_BASE_URL",
  defaultDaemonUrl: `http://127.0.0.1:${defaultPorts.api}`,
  pages: [
    "/api/pages/attention",
    "/api/sessions",
    "/api/workitems",
    "/api/workitems/:id/agent-runs",
    "/api/agent-runs/:id",
    "/api/agent-runs/:id/trace",
    "/api/pages/gold-path",
    "/intake/:sessionId",
    "/api/pages/workitems/:id",
    "/api/pages/proposals/:id",
    "/api/pages/approvals",
    "/api/pages/cost",
    "/api/agent-runs/:id/replay"
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
  payload: CreateSessionRequest = {}
) {
  return renderIntakeSession(await startWebIntakeSession(client, payload), "web");
}

export function createWebWorkItem(
  payload: CreateWorkItemRequest,
  client: WorkHubApiClient = webApiClient
) {
  return client.createWorkItem(payload);
}

export function loadWebWorkItemDetail(client: WorkHubApiClient, workItemId: string) {
  return client.pages.workItem(workItemId);
}

export async function renderWebWorkItemDetail(client: WorkHubApiClient, workItemId: string) {
  return renderWorkItemDetail(await loadWebWorkItemDetail(client, workItemId), "web");
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

export async function renderWebAgentRunLive(client: WorkHubApiClient, runId: string) {
  return renderAgentRunLive(await loadWebAgentRun(client, runId), "web");
}

export function loadWebProposalDetail(client: WorkHubApiClient, proposalId: string) {
  return client.pages.proposal(proposalId);
}

export async function renderWebProposalDetail(client: WorkHubApiClient, proposalId: string) {
  return renderProposalDetail(await loadWebProposalDetail(client, proposalId), "web");
}
