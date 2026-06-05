import assert from "node:assert/strict";
import test from "node:test";

import { createApiClient, joinApiUrl, parseWorkHubSse, WorkHubApiError } from "./index.js";

test("joinApiUrl preserves relative mode and absolute daemon base URLs", () => {
  assert.equal(joinApiUrl(undefined, "/api/health"), "/api/health");
  assert.equal(joinApiUrl("http://127.0.0.1:8787/", "/api/health"), "http://127.0.0.1:8787/api/health");
});

test("api client unwraps WorkHub envelopes and injects the desktop token headers", async () => {
  const seenHeaders: Record<string, string | null> = {};
  const client = createApiClient({
    baseUrl: "http://127.0.0.1:8787",
    getClientToken: () => "device-token",
    fetchFn: async (_input, init) => {
      const headers = new Headers(init?.headers);
      seenHeaders.workhub = headers.get("X-WorkHub-Client-Token");
      seenHeaders.legacy = headers.get("X-YQGL-Client-Token");
      return new Response(JSON.stringify({ ok: true, data: { ok: true, service: "workhub-api", runtime: "node", port: 8787 } }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
  });

  const health = await client.health();
  assert.equal(health.service, "workhub-api");
  assert.equal(seenHeaders.workhub, "device-token");
  assert.equal(seenHeaders.legacy, "device-token");
});

test("api client converts error envelopes to WorkHubApiError", async () => {
  const client = createApiClient({
    fetchFn: async () =>
      new Response(JSON.stringify({ ok: false, error: { code: "budget_exhausted", message: "预算用完了。" } }), {
        status: 402,
        headers: { "Content-Type": "application/json" }
      })
  });

  await assert.rejects(
    () => client.request("/api/agent-runs/demo"),
    (error) => error instanceof WorkHubApiError && error.code === "budget_exhausted"
  );
});

test("SSE parser keeps event names and parses JSON payloads", () => {
  const events = parseWorkHubSse<{ topic: string }>('event: connected\ndata: {"topic":"user:1"}\n\n: ping\n\n');
  assert.equal(events.length, 1);
  assert.equal(events[0]?.event, "connected");
  assert.equal(events[0]?.json?.topic, "user:1");
});
