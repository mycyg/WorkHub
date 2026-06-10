import assert from "node:assert/strict";

import { serve } from "@hono/node-server";

import { createApiClient, parseWorkHubSse } from "@workhub/api-client";
import type { WorkHubEvent } from "@workhub/contracts";

import {
  cuuR3SmokeClientToken,
  createCuuR3SmokeApp,
  runCuuR3LauncherToRunSmoke
} from "./cuu-r3-launcher-harness.js";

const { app, workItems } = createCuuR3SmokeApp({
  runStream: true,
  runOutcome: "failed",
  runDelayMs: 3500,
  modelDelayMs: 220
});

let server: ReturnType<typeof serve>;
const serverInfo = await new Promise<{ address: string; port: number }>((resolve) => {
  server = serve(
    {
      fetch: app.fetch,
      hostname: "127.0.0.1",
      port: 0
    },
    (info) => resolve(info)
  );
});

try {
  const baseUrl = `http://127.0.0.1:${serverInfo.port}`;
  const client = createApiClient({
    baseUrl,
    getClientToken: () => cuuR3SmokeClientToken
  });
  const result = await runCuuR3LauncherToRunSmoke({
    client,
    workItems,
    transport: "http-dev-server",
    apiBaseUrl: baseUrl
  });
  const connectedEvent = await waitForStreamConnected(result.stream_url);
  const finalRun = await waitForRunStatus(client, result.run_id, "failed");

  assert.equal(connectedEvent.event, "connected");
  assert.equal(finalRun.status, "failed");
  assert.match(finalRun.trace.at(-1)?.output_excerpt ?? "", /run-failure/u);

  console.log(JSON.stringify({
    ok: true,
    smoke: "cuu-r3-run-failure",
    auth: "client-token-fetch-sse",
    run_id: result.run_id,
    sse_event: connectedEvent.event,
    terminal_source: "agent-run-rest-fallback",
    final_status: finalRun.status,
    stream_url: result.stream_url
  }, null, 2));
} finally {
  server!.close();
}

async function waitForStreamConnected(streamUrl: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);
  try {
    const response = await fetch(streamUrl, {
      headers: {
        Accept: "text/event-stream",
        "X-WorkHub-Client-Token": cuuR3SmokeClientToken,
        "X-YQGL-Client-Token": cuuR3SmokeClientToken
      },
      signal: controller.signal
    });
    assert.equal(response.ok, true);
    assert.ok(response.body);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      for (;;) {
        const result = await reader.read();
        if (result.done) {
          break;
        }
        buffer += decoder.decode(result.value, { stream: true });
        const connected = findConnectedEvent(buffer);
        if (connected) {
          controller.abort();
          return connected;
        }
      }
    } catch (error) {
      if (!isAbortError(error)) {
        throw error;
      }
    }
    const connected = findConnectedEvent(buffer + decoder.decode());
    if (connected) {
      return connected;
    }
    throw new Error("Timed out before receiving Cuu R3 run-failure connected SSE frame.");
  } finally {
    clearTimeout(timeout);
  }
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

function findConnectedEvent(input: string) {
  for (const message of parseWorkHubSse<WorkHubEvent<unknown>>(input)) {
    if (message.event === "connected") {
      return message;
    }
  }
  return undefined;
}

async function waitForRunStatus(
  client: ReturnType<typeof createApiClient>,
  runId: string,
  status: "failed"
) {
  const deadline = Date.now() + 6000;
  let latest: Awaited<ReturnType<typeof client.getAgentRun>> | undefined;
  do {
    const run = await client.getAgentRun(runId);
    latest = run;
    if (run.status === status) {
      return run;
    }
    await new Promise((resolve) => setTimeout(resolve, 80));
  } while (Date.now() < deadline);
  throw new Error(`Timed out waiting for run ${runId} to reach ${status}; latest=${JSON.stringify({
    status: latest?.status,
    trace: latest?.trace?.slice(-3)
  })}`);
}
