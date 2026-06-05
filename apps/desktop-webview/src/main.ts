import { createApiClient, type WorkHubApiClient } from "@workhub/api-client";
import { defaultPorts } from "@workhub/config";
import { renderGoldPathSurface } from "@workhub/ui/gold-path";
import { renderProposalDetail } from "@workhub/ui/proposal";

export const desktopWebviewSurface = {
  name: "C-PET webview",
  description: "Tauri webview surface; Rust owns local shell capabilities and this view consumes typed daemon APIs.",
  devPort: defaultPorts.desktopWebview,
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
  rustOwns: ["device_token", "tray", "deep_link", "local_sync", "system_notification"]
} as const;

export function createDesktopWebviewApiClient(input: {
  baseUrl: string;
  getClientToken: () => string | undefined;
}) {
  return createApiClient({
    baseUrl: input.baseUrl,
    getClientToken: input.getClientToken
  });
}

export function loadDesktopGoldPathSurface(client: WorkHubApiClient) {
  return client.pages.goldPath();
}

export async function renderDesktopGoldPathSurface(client: WorkHubApiClient) {
  return renderGoldPathSurface(await loadDesktopGoldPathSurface(client), "desktop");
}

export function loadDesktopProposalDetail(client: WorkHubApiClient, proposalId: string) {
  return client.pages.proposal(proposalId);
}

export async function renderDesktopProposalDetail(client: WorkHubApiClient, proposalId: string) {
  return renderProposalDetail(await loadDesktopProposalDetail(client, proposalId), "desktop");
}
