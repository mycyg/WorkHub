import { createApiClient, type WorkHubApiClient } from "@workhub/api-client";
import { defaultPorts } from "@workhub/config";
import { renderGoldPathSurface } from "@workhub/ui/gold-path";

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
  consumesTypedClient: "@workhub/api-client"
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
