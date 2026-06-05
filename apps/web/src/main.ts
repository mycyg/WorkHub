import { createApiClient } from "@workhub/api-client";
import { defaultPorts } from "@workhub/config";

export const webSurface = {
  name: "C-WEB",
  description: "Browser SPA surface; it is a thin view over the headless WorkHub daemon.",
  devPort: defaultPorts.web,
  apiBaseUrlEnv: "VITE_API_BASE_URL",
  defaultDaemonUrl: `http://127.0.0.1:${defaultPorts.api}`,
  pages: ["/api/pages/attention", "/api/pages/approvals", "/api/pages/cost"],
  consumesTypedClient: "@workhub/api-client"
} as const;

export const webApiClient = createApiClient({
  baseUrl: ""
});
