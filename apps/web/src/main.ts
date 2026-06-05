import { createApiClient, type WorkHubApiClient } from "@workhub/api-client";
import { defaultPorts } from "@workhub/config";
import type { WorkHubEvent } from "@workhub/contracts";
import { cardFromEvent, cardFromProposalDetail, type CuuCard } from "@workhub/cuu";
import { renderGoldPathSurface } from "@workhub/ui/gold-path";
import { renderProposalDetail } from "@workhub/ui/proposal";

export const webSurface = {
  name: "C-WEB",
  description: "Browser SPA surface; it is a thin view over the headless WorkHub daemon.",
  devPort: defaultPorts.web,
  apiBaseUrlEnv: "VITE_API_BASE_URL",
  defaultDaemonUrl: `http://127.0.0.1:${defaultPorts.api}`,
  pages: [
    "/api/pages/attention",
    "/api/pages/gold-path",
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
