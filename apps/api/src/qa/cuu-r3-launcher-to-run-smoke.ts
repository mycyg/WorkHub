import { createApiClient } from "@workhub/api-client";

import {
  createCuuR3SmokeApp,
  cuuR3SmokeClientToken,
  runCuuR3LauncherToRunSmoke
} from "./cuu-r3-launcher-harness.js";

async function main() {
  const { app, workItems } = createCuuR3SmokeApp();
  const fetchFn: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    return app.request(`${url.pathname}${url.search}`, init);
  };
  const client = createApiClient({
    baseUrl: "http://workhub-cuu-r3-smoke.local",
    fetchFn,
    getClientToken: () => cuuR3SmokeClientToken
  });

  const result = await runCuuR3LauncherToRunSmoke({
    client,
    workItems,
    transport: "in-process-hono"
  });
  console.log(JSON.stringify(result, null, 2));
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
