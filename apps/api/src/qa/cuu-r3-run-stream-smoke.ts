import assert from "node:assert/strict";

import { serve } from "@hono/node-server";

import { createApiClient, parseWorkHubSse } from "@workhub/api-client";
import { eventTypes, type WorkHubEvent } from "@workhub/contracts";

import {
  cuuR3SmokeClientToken,
  createCuuR3SmokeApp,
  runCuuR3LauncherToRunSmoke
} from "./cuu-r3-launcher-harness.js";

const { app, workItems } = createCuuR3SmokeApp({
  runStream: true,
  runDelayMs: 900,
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
  const doneEvent = await waitForRunDoneEvent(result.stream_url);
  const finalRun = await waitForRunStatus(client, result.run_id, "succeeded");
  assert.equal(doneEvent.type, eventTypes.agentRunStep);
  assert.equal((doneEvent.data as Record<string, unknown>).kind, "done");
  assert.equal(finalRun.status, "succeeded");

  console.log(JSON.stringify({
    ok: true,
    smoke: "cuu-r3-run-stream",
    auth: "client-token-fetch-sse",
    run_id: result.run_id,
    sse_event: doneEvent.type,
    final_status: finalRun.status,
    stream_url: result.stream_url
  }, null, 2));
} finally {
  server!.close();
}

async function waitForRunDoneEvent(streamUrl: string): Promise<WorkHubEvent<unknown>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);
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
    for (;;) {
      const result = await reader.read();
      if (result.done) {
        break;
      }
      buffer += decoder.decode(result.value, { stream: true });
      const event = findDoneEvent(buffer);
      if (event) {
        controller.abort();
        return event;
      }
    }
    const event = findDoneEvent(buffer + decoder.decode());
    if (event) {
      return event;
    }
    throw new Error("Timed out before receiving Cuu R3 run-stream done event.");
  } finally {
    clearTimeout(timeout);
  }
}

function findDoneEvent(input: string): WorkHubEvent<unknown> | undefined {
  for (const message of parseWorkHubSse<WorkHubEvent<unknown>>(input)) {
    const event = message.json;
    if (
      event &&
      event.type === eventTypes.agentRunStep &&
      typeof event.data === "object" &&
      event.data !== null &&
      (event.data as Record<string, unknown>).kind === "done"
    ) {
      return event;
    }
  }
  return undefined;
}

async function waitForRunStatus(
  client: ReturnType<typeof createApiClient>,
  runId: string,
  status: "succeeded"
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
