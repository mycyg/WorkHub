import { createApiClient, type WorkHubApiClient } from "@workhub/api-client";
import { defaultPorts } from "@workhub/config";
import type { CreateSessionRequest, CreateWorkItemRequest, WorkHubEvent } from "@workhub/contracts";
import { cardFromEvent, cardFromProposalDetail, cardFromSessionVm, cardFromWorkItemDetail, type CuuCard } from "@workhub/cuu";
import { renderGoldPathSurface } from "@workhub/ui/gold-path";
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
    "/api/pages/gold-path",
    "/intake/:sessionId",
    "/api/pages/workitems/:id",
    "/api/pages/proposals/:id",
    "/api/pages/approvals",
    "/api/pages/cost",
    "/api/agent-runs/:id/replay"
  ],
  consumesTypedClient: "@workhub/api-client",
  cuuCardAdapter: "@workhub/cuu"
} as const;

export const webApiClient = createApiClient({
  baseUrl: ""
});

export function loadWebGoldPathSurface(client: WorkHubApiClient = webApiClient) {
  return client.pages.goldPath();
}

export async function renderWebGoldPathSurface(client: WorkHubApiClient = webApiClient) {
  return renderGoldPathSurface(await loadWebGoldPathSurface(client), "web");
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

export function loadWebProposalDetail(client: WorkHubApiClient, proposalId: string) {
  return client.pages.proposal(proposalId);
}

export async function renderWebProposalDetail(client: WorkHubApiClient, proposalId: string) {
  return renderProposalDetail(await loadWebProposalDetail(client, proposalId), "web");
}

export function webCuuCardFromEvent(event: WorkHubEvent<unknown>): CuuCard {
  return cardFromEvent(event);
}

export async function loadWebProposalCuuCard(
  client: WorkHubApiClient = webApiClient,
  proposalId: string
): Promise<CuuCard> {
  return cardFromProposalDetail(await loadWebProposalDetail(client, proposalId));
}

export async function loadWebIntakeCuuCard(
  client: WorkHubApiClient = webApiClient,
  payload: CreateSessionRequest = {}
): Promise<CuuCard> {
  return cardFromSessionVm(await startWebIntakeSession(client, payload));
}

export async function createWebWorkItemCuuCard(
  payload: CreateWorkItemRequest,
  client: WorkHubApiClient = webApiClient
): Promise<CuuCard> {
  return cardFromWorkItemDetail(await createWebWorkItem(payload, client));
}

export async function loadWebWorkItemCuuCard(
  client: WorkHubApiClient = webApiClient,
  workItemId: string
): Promise<CuuCard> {
  return cardFromWorkItemDetail(await loadWebWorkItemDetail(client, workItemId));
}
