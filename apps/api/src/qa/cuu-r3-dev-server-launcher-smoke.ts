import assert from "node:assert/strict";

import { serve, type ServerType } from "@hono/node-server";
import { createApiClient } from "@workhub/api-client";

import {
  createCuuR3SmokeApp,
  cuuR3SmokeClientToken,
  runCuuR3LauncherToRunSmoke,
  type CuuR3SmokeApp
} from "./cuu-r3-launcher-harness.js";

type SmokeServer = {
  baseUrl: string;
  server: ServerType;
};

async function listenOnEphemeralPort(app: CuuR3SmokeApp["app"]): Promise<SmokeServer> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const server = serve(
      {
        fetch: app.fetch,
        hostname: "127.0.0.1",
        port: 0
      },
      (info) => {
        settled = true;
        resolve({
          baseUrl: `http://127.0.0.1:${info.port}`,
          server
        });
      }
    );
    server.once("error", (error) => {
      if (!settled) {
        reject(error);
      }
    });
  });
}

async function closeServer(server: ServerType) {
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
}

async function main() {
  const { app, workItems } = createCuuR3SmokeApp();
  const { baseUrl, server } = await listenOnEphemeralPort(app);
  try {
    const client = createApiClient({
      baseUrl,
      getClientToken: () => cuuR3SmokeClientToken
    });

    const health = await client.health();
    assert.equal(health.ok, true);
    assert.equal(health.service, "workhub-cuu-r3-smoke");
    assert.equal(health.runtime, "node-hono");

    const result = await runCuuR3LauncherToRunSmoke({
      client,
      workItems,
      transport: "http-dev-server",
      apiBaseUrl: baseUrl
    });
    assert.equal(result.stream_url.startsWith(`${baseUrl}/api/push/stream/run/`), true);

    console.log(
      JSON.stringify(
        {
          ...result,
          health
        },
        null,
        2
      )
    );
  } finally {
    await closeServer(server);
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
