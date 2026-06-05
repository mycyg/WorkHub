import assert from "node:assert/strict";
import test from "node:test";

import { deliverableManifestFixtures } from "@workhub/contracts";

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

test("api client exposes P0.5 gold path page and replay endpoints", async () => {
  const calls: string[] = [];
  const client = createApiClient({
    fetchFn: async (input, init) => {
      calls.push(`${init?.method ?? "GET"} ${input}`);
      return new Response(JSON.stringify({ ok: true, data: { id: "ok" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
  });

  await client.pages.goldPath();
  await client.pages.workItem("work-1");
  await client.pages.proposal("proposal-1");
  await client.createProposalFromManifest("work-1", { manifest: deliverableManifestFixtures[0]! });
  await client.listWorkItemProposals("work-1");
  await client.getProposal("proposal-1");
  await client.nextQuestion("session-1");
  await client.searchKnowledge({ q: "weekly" });
  await client.costUsage();
  await client.reviewProposal("proposal-1", { decision: "approve", remember: "once" });
  await client.mergeProposal("proposal-1");
  await client.replayAgentRun("run-1");

  assert.deepEqual(calls, [
    "GET /api/pages/gold-path",
    "GET /api/pages/workitems/work-1",
    "GET /api/pages/proposals/proposal-1",
    "POST /api/workitems/work-1/proposals",
    "GET /api/workitems/work-1/proposals",
    "GET /api/proposals/proposal-1",
    "POST /api/sessions/session-1/next-question",
    "POST /api/knowledge/search",
    "GET /api/cost/usage",
    "POST /api/proposals/proposal-1/review",
    "POST /api/proposals/proposal-1/merge",
    "GET /api/agent-runs/run-1/replay"
  ]);
});

test("SSE parser keeps event names and parses JSON payloads", () => {
  const events = parseWorkHubSse<{ topic: string }>('event: connected\ndata: {"topic":"user:1"}\n\n: ping\n\n');
  assert.equal(events.length, 1);
  assert.equal(events[0]?.event, "connected");
  assert.equal(events[0]?.json?.topic, "user:1");
});
